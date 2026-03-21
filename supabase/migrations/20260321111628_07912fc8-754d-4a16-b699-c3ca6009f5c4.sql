ALTER TYPE public.task_kind ADD VALUE IF NOT EXISTS 'weekly_bmh';
ALTER TYPE public.task_kind ADD VALUE IF NOT EXISTS 'weekly_invite';

ALTER TABLE public.referrals
ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP WITH TIME ZONE;

CREATE OR REPLACE FUNCTION public.ensure_daily_tasks()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.task_settings%ROWTYPE;
  week_start date := date_trunc('week', now())::date;
BEGIN
  SELECT * INTO cfg
  FROM public.task_settings
  WHERE id = 1;

  IF NOT FOUND THEN
    INSERT INTO public.task_settings (id, referral_goal, referral_reward_bmh, tap_goal, tap_reward_bmh)
    VALUES (1, 1, 500, 300, 350)
    ON CONFLICT (id) DO NOTHING;

    SELECT * INTO cfg
    FROM public.task_settings
    WHERE id = 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE kind = 'taps_500' AND active_date = current_date
  ) THEN
    INSERT INTO public.tasks(title, reward_bmh, description, kind, active_date, target_value)
    VALUES (
      format('Do %s taps today', cfg.tap_goal),
      cfg.tap_reward_bmh,
      format('Tap %s times today.', cfg.tap_goal),
      'taps_500',
      current_date,
      cfg.tap_goal
    );
  ELSE
    UPDATE public.tasks
    SET title = format('Do %s taps today', cfg.tap_goal),
        reward_bmh = cfg.tap_reward_bmh,
        description = format('Tap %s times today.', cfg.tap_goal),
        target_value = cfg.tap_goal
    WHERE id = (
      SELECT id FROM public.tasks
      WHERE kind = 'taps_500' AND active_date = current_date
      ORDER BY created_at ASC
      LIMIT 1
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE kind = 'invite_1' AND active_date = current_date
  ) THEN
    INSERT INTO public.tasks(title, reward_bmh, description, kind, active_date, target_value)
    VALUES (
      format('Invite %s friend(s)', cfg.referral_goal),
      cfg.referral_reward_bmh,
      format('Invite at least %s friend(s) today.', cfg.referral_goal),
      'invite_1',
      current_date,
      cfg.referral_goal
    );
  ELSE
    UPDATE public.tasks
    SET title = format('Invite %s friend(s)', cfg.referral_goal),
        reward_bmh = cfg.referral_reward_bmh,
        description = format('Invite at least %s friend(s) today.', cfg.referral_goal),
        target_value = cfg.referral_goal
    WHERE id = (
      SELECT id FROM public.tasks
      WHERE kind = 'invite_1' AND active_date = current_date
      ORDER BY created_at ASC
      LIMIT 1
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE kind = 'weekly_bmh' AND active_date = week_start
  ) THEN
    INSERT INTO public.tasks(title, reward_bmh, description, kind, active_date, target_value)
    VALUES (
      'Weekly Mission: Earn 25,000 BMH',
      2200,
      'Earn 25,000 BMH this week to unlock a special bonus.',
      'weekly_bmh',
      week_start,
      25000
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE kind = 'weekly_invite' AND active_date = week_start
  ) THEN
    INSERT INTO public.tasks(title, reward_bmh, description, kind, active_date, target_value)
    VALUES (
      'Weekly Mission: Invite 3 friends',
      2800,
      'Bring 3 new players this week and claim your reward.',
      'weekly_invite',
      week_start,
      3
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_auth_upsert(_telegram_id bigint, _username text, _first_name text, _avatar_url text, _start_param text DEFAULT NULL::text)
 RETURNS users
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  existing_user public.users;
  ref_id bigint;
  streak_bonus bigint := 0;
  days_gap int := 0;
  inserted_count int := 0;
  week_anchor timestamp with time zone := date_trunc('week', now());
BEGIN
  PERFORM public.ensure_daily_tasks();

  INSERT INTO public.users(telegram_id, username, first_name, avatar_url, last_login)
  VALUES (_telegram_id, _username, _first_name, _avatar_url, current_date)
  ON CONFLICT (telegram_id) DO UPDATE
    SET username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        avatar_url = EXCLUDED.avatar_url
  RETURNING * INTO existing_user;

  IF existing_user.weekly_reset_at < week_anchor THEN
    UPDATE public.users
    SET weekly_bmh = 0,
        weekly_reset_at = week_anchor
    WHERE telegram_id = _telegram_id;
  END IF;

  IF existing_user.last_login IS NULL THEN
    UPDATE public.users
    SET daily_streak = 1,
        bmh_balance = bmh_balance + 180,
        last_login = current_date
    WHERE telegram_id = _telegram_id;
  ELSIF existing_user.last_login < current_date THEN
    days_gap := current_date - existing_user.last_login;
    IF days_gap = 1 THEN
      UPDATE public.users
      SET daily_streak = least(30, daily_streak + 1),
          last_login = current_date
      WHERE telegram_id = _telegram_id;
    ELSE
      UPDATE public.users
      SET daily_streak = 1,
          last_login = current_date
      WHERE telegram_id = _telegram_id;
    END IF;

    SELECT LEAST(1400, 180 + ((daily_streak - 1) * 140))
    INTO streak_bonus
    FROM public.users
    WHERE telegram_id = _telegram_id;

    UPDATE public.users
    SET bmh_balance = bmh_balance + streak_bonus
    WHERE telegram_id = _telegram_id;
  END IF;

  IF _start_param IS NOT NULL AND _start_param ~ '^[0-9]+$' THEN
    ref_id := _start_param::bigint;
    IF ref_id <> _telegram_id
      AND exists(select 1 from public.users where telegram_id = ref_id)
      AND NOT exists(select 1 from public.referrals where referred_id = _telegram_id) THEN
      INSERT INTO public.referrals(referrer_id, referred_id)
      VALUES (ref_id, _telegram_id)
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS inserted_count = row_count;
      IF inserted_count > 0 THEN
        UPDATE public.users
        SET bmh_balance = bmh_balance + 1200,
            referrals_count = referrals_count + 1
        WHERE telegram_id = ref_id;

        UPDATE public.users
        SET bmh_balance = bmh_balance + 500
        WHERE telegram_id = _telegram_id;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.upgrades(user_id, upgrade_type, level)
  VALUES
    (_telegram_id, 'marsh_factory', 0),
    (_telegram_id, 'viral_boost', 0),
    (_telegram_id, 'referral_multiplier', 0),
    (_telegram_id, 'energy_core', 0),
    (_telegram_id, 'precision_tap', 0)
  ON CONFLICT (user_id, upgrade_type) DO NOTHING;

  RETURN (SELECT u FROM public.users u WHERE u.telegram_id = _telegram_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_state(_telegram_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  u public.users%ROWTYPE;
  rg record;
  pass_fx record;
  tasks_json jsonb;
  refs_json jsonb;
  upgrades_json jsonb;
  ad_tasks_json jsonb;
  passes_json jsonb;
  wallet_addr text;
  next_regen int;
  week_start date := date_trunc('week', now())::date;
BEGIN
  PERFORM public.ensure_daily_tasks();
  PERFORM public.ensure_user_ad_slots(_telegram_id);

  SELECT * INTO u
  FROM public.users
  WHERE telegram_id = _telegram_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  SELECT * INTO pass_fx FROM public.get_user_pass_effects(_telegram_id);

  SELECT * INTO rg
  FROM public.compute_regen(u.energy, u.max_energy, u.last_energy_at, COALESCE(pass_fx.regen_interval_seconds, 3));

  IF rg.new_energy <> u.energy THEN
    UPDATE public.users
    SET energy = rg.new_energy,
        last_energy_at = rg.new_last_energy_at
    WHERE telegram_id = _telegram_id;

    u.energy := rg.new_energy;
    u.last_energy_at := rg.new_last_energy_at;
  END IF;

  next_regen := GREATEST(0, COALESCE(pass_fx.regen_interval_seconds, 3) - floor(extract(epoch FROM (now() - u.last_energy_at)))::int);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'description', t.description,
        'reward_bmh', t.reward_bmh,
        'kind', t.kind,
        'target_value', t.target_value,
        'link_url', t.link_url,
        'completed', EXISTS(
          SELECT 1
          FROM public.task_completions c
          WHERE c.task_id = t.id
            AND c.user_id = _telegram_id
        )
      )
      ORDER BY t.created_at
    ),
    '[]'::jsonb
  ) INTO tasks_json
  FROM public.tasks t
  WHERE (
      (t.kind IN ('weekly_bmh', 'weekly_invite') AND t.active_date = week_start)
      OR
      (t.kind NOT IN ('watch_ad', 'ad_watch', 'weekly_bmh', 'weekly_invite') AND t.active_date = current_date)
    );

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', ('ad_slot_' || s.slot_no::text),
        'title', format('Ads Boost #%s', s.slot_no),
        'description', 'Watch ad and claim BMH. Slot auto-refreshes.',
        'reward_bmh', s.reward_bmh,
        'kind', s.kind,
        'target_value', 1,
        'link_url', null,
        'completed', false,
        'claimable', s.next_available_at <= now()
      )
      ORDER BY s.slot_no
    ),
    '[]'::jsonb
  ) INTO ad_tasks_json
  FROM public.user_ad_slots s
  WHERE s.user_id = _telegram_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'telegram_id', u2.telegram_id,
        'username', u2.username,
        'first_name', u2.first_name,
        'avatar_url', u2.avatar_url,
        'created_at', r.created_at
      )
      ORDER BY r.created_at DESC
    ),
    '[]'::jsonb
  ) INTO refs_json
  FROM public.referrals r
  JOIN public.users u2 ON u2.telegram_id = r.referred_id
  WHERE r.referrer_id = _telegram_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'upgrade_type', up.upgrade_type,
        'level', up.level,
        'next_cost', CASE up.upgrade_type
          WHEN 'marsh_factory' THEN 900 + (up.level * 700)
          WHEN 'viral_boost' THEN 1100 + (up.level * 800)
          WHEN 'referral_multiplier' THEN 1000 + (up.level * 850)
          WHEN 'energy_core' THEN 1300 + (up.level * 1000)
          WHEN 'precision_tap' THEN 1250 + (up.level * 950)
          ELSE 1000 + (up.level * 900)
        END
      )
    ),
    '[]'::jsonb
  ) INTO upgrades_json
  FROM public.upgrades up
  WHERE up.user_id = _telegram_id;

  SELECT uw.wallet_address INTO wallet_addr
  FROM public.user_wallets uw
  WHERE uw.user_id = _telegram_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'pass_type', p.pass_type,
        'expires_at', p.expires_at
      )
      ORDER BY p.expires_at DESC
    ),
    '[]'::jsonb
  ) INTO passes_json
  FROM public.user_passes p
  WHERE p.user_id = _telegram_id
    AND p.expires_at > now();

  RETURN jsonb_build_object(
    'user', jsonb_build_object(
      'telegram_id', u.telegram_id,
      'username', u.username,
      'first_name', u.first_name,
      'avatar_url', u.avatar_url,
      'bmh_balance', u.bmh_balance,
      'energy', u.energy,
      'max_energy', u.max_energy,
      'level', u.level,
      'daily_streak', u.daily_streak,
      'referrals_count', u.referrals_count,
      'total_taps', u.total_taps,
      'next_regen_in', next_regen,
      'referral_link', 'https://t.me/BigMarshBot?startapp=' || u.telegram_id,
      'wallet_address', wallet_addr
    ),
    'tasks', (tasks_json || ad_tasks_json),
    'referrals', refs_json,
    'upgrades', upgrades_json,
    'active_passes', passes_json,
    'airdrop_placeholder', 'Airdrop BMH coming soon for active players'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_task(_telegram_id bigint, _task_id uuid)
 RETURNS TABLE(ok boolean, reward integer, new_balance bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks%ROWTYPE;
  already boolean;
  metric_ok boolean := false;
  today_invites bigint := 0;
  required_target integer := 1;
  week_start date := date_trunc('week', now())::date;
  pass_fx record;
  reward_to_grant int := 0;
BEGIN
  PERFORM public.ensure_daily_tasks();

  SELECT * INTO t
  FROM public.tasks
  WHERE id = _task_id
    AND (
      (kind IN ('weekly_bmh', 'weekly_invite') AND active_date = week_start)
      OR
      (kind NOT IN ('weekly_bmh', 'weekly_invite') AND active_date = current_date)
    );

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, (SELECT bmh_balance FROM public.users WHERE telegram_id = _telegram_id);
    RETURN;
  END IF;

  IF t.kind IN ('watch_ad', 'ad_watch') THEN
    RETURN QUERY SELECT false, 0, (SELECT bmh_balance FROM public.users WHERE telegram_id = _telegram_id);
    RETURN;
  END IF;

  required_target := GREATEST(1, COALESCE(t.target_value, 1));

  SELECT EXISTS(
    SELECT 1
    FROM public.task_completions
    WHERE task_id = _task_id
      AND user_id = _telegram_id
  ) INTO already;

  IF already THEN
    RETURN QUERY SELECT false, 0, (SELECT bmh_balance FROM public.users WHERE telegram_id = _telegram_id);
    RETURN;
  END IF;

  IF t.kind = 'taps_500' THEN
    metric_ok := (
      SELECT total_taps >= required_target
      FROM public.users
      WHERE telegram_id = _telegram_id
    );
  ELSIF t.kind = 'invite_1' THEN
    SELECT count(*) INTO today_invites
    FROM public.referrals
    WHERE referrer_id = _telegram_id
      AND created_at::date = current_date;

    metric_ok := today_invites >= required_target;
  ELSIF t.kind = 'weekly_invite' THEN
    SELECT count(*) INTO today_invites
    FROM public.referrals
    WHERE referrer_id = _telegram_id
      AND created_at >= week_start
      AND created_at < (week_start + interval '7 days');

    metric_ok := today_invites >= required_target;
  ELSIF t.kind = 'weekly_bmh' THEN
    metric_ok := (
      SELECT weekly_bmh >= required_target
      FROM public.users
      WHERE telegram_id = _telegram_id
    );
  ELSIF t.kind = 'link_visit' THEN
    metric_ok := COALESCE(NULLIF(btrim(t.link_url), ''), '') <> '';
  END IF;

  IF NOT metric_ok THEN
    RETURN QUERY SELECT false, 0, (SELECT bmh_balance FROM public.users WHERE telegram_id = _telegram_id);
    RETURN;
  END IF;

  SELECT * INTO pass_fx FROM public.get_user_pass_effects(_telegram_id);
  reward_to_grant := GREATEST(1, FLOOR(t.reward_bmh * GREATEST(1.0, COALESCE(pass_fx.reward_multiplier, 1.0)))::int);

  INSERT INTO public.task_completions(task_id, user_id)
  VALUES (_task_id, _telegram_id);

  UPDATE public.users
  SET bmh_balance = bmh_balance + reward_to_grant,
      weekly_bmh = weekly_bmh + reward_to_grant
  WHERE telegram_id = _telegram_id;

  RETURN QUERY
  SELECT true, reward_to_grant, (SELECT bmh_balance FROM public.users WHERE telegram_id = _telegram_id);
END;
$function$;