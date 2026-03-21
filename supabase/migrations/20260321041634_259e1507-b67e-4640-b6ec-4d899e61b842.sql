-- Rebalance daily automatic tasks and ad rewards
CREATE OR REPLACE FUNCTION public.ensure_daily_tasks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.task_settings%ROWTYPE;
  hour_bucket integer := floor(extract(epoch from date_trunc('hour', now())) / 3600)::integer;
  ad_interstitial_reward integer := 120 + ((hour_bucket % 4) * 20);
  ad_popup_reward integer := 180 + ((hour_bucket % 5) * 25);
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

  INSERT INTO public.tasks(title, reward_bmh, description, kind, active_date, target_value)
  VALUES (
    format('Faça %s taps hoje', cfg.tap_goal),
    cfg.tap_reward_bmh,
    format('Toque %s vezes no Marsh hoje.', cfg.tap_goal),
    'taps_500',
    current_date,
    cfg.tap_goal
  )
  ON CONFLICT (kind, active_date) DO UPDATE
    SET title = EXCLUDED.title,
        reward_bmh = EXCLUDED.reward_bmh,
        description = EXCLUDED.description,
        target_value = EXCLUDED.target_value
    WHERE public.tasks.title IS DISTINCT FROM EXCLUDED.title
       OR public.tasks.reward_bmh IS DISTINCT FROM EXCLUDED.reward_bmh
       OR public.tasks.description IS DISTINCT FROM EXCLUDED.description
       OR public.tasks.target_value IS DISTINCT FROM EXCLUDED.target_value;

  INSERT INTO public.tasks(title, reward_bmh, description, kind, active_date, target_value)
  VALUES (
    format('Convide %s amigo(s)', cfg.referral_goal),
    cfg.referral_reward_bmh,
    format('Convide pelo menos %s amigo(s) hoje.', cfg.referral_goal),
    'invite_1',
    current_date,
    cfg.referral_goal
  )
  ON CONFLICT (kind, active_date) DO UPDATE
    SET title = EXCLUDED.title,
        reward_bmh = EXCLUDED.reward_bmh,
        description = EXCLUDED.description,
        target_value = EXCLUDED.target_value
    WHERE public.tasks.title IS DISTINCT FROM EXCLUDED.title
       OR public.tasks.reward_bmh IS DISTINCT FROM EXCLUDED.reward_bmh
       OR public.tasks.description IS DISTINCT FROM EXCLUDED.description
       OR public.tasks.target_value IS DISTINCT FROM EXCLUDED.target_value;

  INSERT INTO public.tasks(title, reward_bmh, description, kind, active_date, target_value)
  VALUES (
    'Watch short ads',
    ad_interstitial_reward,
    'Rewarded Interstitial · recompensa equilibrada e diária.',
    'watch_ad',
    current_date,
    1
  )
  ON CONFLICT (kind, active_date) DO UPDATE
    SET reward_bmh = EXCLUDED.reward_bmh,
        description = EXCLUDED.description,
        target_value = EXCLUDED.target_value;

  INSERT INTO public.tasks(title, reward_bmh, description, kind, active_date, target_value)
  VALUES (
    'Click to get reward',
    ad_popup_reward,
    'Rewarded Popup · recompensa equilibrada e diária.',
    'ad_watch',
    current_date,
    1
  )
  ON CONFLICT (kind, active_date) DO UPDATE
    SET reward_bmh = EXCLUDED.reward_bmh,
        description = EXCLUDED.description,
        target_value = EXCLUDED.target_value;
END;
$function$;

-- Rebalance login streak rewards and seed more upgrade options
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
BEGIN
  PERFORM public.ensure_daily_tasks();

  INSERT INTO public.users(telegram_id, username, first_name, avatar_url, last_login)
  VALUES (_telegram_id, _username, _first_name, _avatar_url, current_date)
  ON CONFLICT (telegram_id) DO UPDATE
    SET username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        avatar_url = EXCLUDED.avatar_url
  RETURNING * INTO existing_user;

  IF existing_user.last_login IS NULL THEN
    UPDATE public.users
    SET daily_streak = 1,
        bmh_balance = bmh_balance + 150,
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

    SELECT CASE
      WHEN daily_streak >= 7 THEN 900
      WHEN daily_streak = 6 THEN 700
      WHEN daily_streak = 5 THEN 550
      WHEN daily_streak = 4 THEN 420
      WHEN daily_streak = 3 THEN 300
      WHEN daily_streak = 2 THEN 220
      ELSE 150
    END INTO streak_bonus
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

-- Support more upgrade types and fairer pricing
CREATE OR REPLACE FUNCTION public.buy_upgrade(_telegram_id bigint, _upgrade_type text)
RETURNS TABLE(ok boolean, new_level integer, new_balance bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  current_level int;
  cost bigint;
  balance bigint;
  base_cost int;
  step_cost int;
  next_level int;
  current_max_energy int;
  target_max_energy int;
BEGIN
  IF _upgrade_type NOT IN ('marsh_factory', 'viral_boost', 'referral_multiplier', 'energy_core', 'precision_tap') THEN
    RAISE EXCEPTION 'invalid_upgrade';
  END IF;

  INSERT INTO public.upgrades(user_id, upgrade_type, level)
  VALUES (_telegram_id, _upgrade_type, 0)
  ON CONFLICT (user_id, upgrade_type) DO NOTHING;

  SELECT level
  INTO current_level
  FROM public.upgrades
  WHERE user_id = _telegram_id
    AND upgrade_type = _upgrade_type
  FOR UPDATE;

  CASE _upgrade_type
    WHEN 'marsh_factory' THEN base_cost := 900; step_cost := 700;
    WHEN 'viral_boost' THEN base_cost := 1100; step_cost := 800;
    WHEN 'referral_multiplier' THEN base_cost := 1000; step_cost := 850;
    WHEN 'energy_core' THEN base_cost := 1300; step_cost := 1000;
    ELSE base_cost := 1250; step_cost := 950;
  END CASE;

  cost := base_cost + (current_level * step_cost);

  SELECT bmh_balance
  INTO balance
  FROM public.users
  WHERE telegram_id = _telegram_id
  FOR UPDATE;

  IF balance < cost THEN
    RETURN QUERY SELECT false, current_level, balance;
    RETURN;
  END IF;

  next_level := current_level + 1;

  UPDATE public.users
  SET bmh_balance = bmh_balance - cost
  WHERE telegram_id = _telegram_id;

  UPDATE public.upgrades
  SET level = next_level
  WHERE user_id = _telegram_id
    AND upgrade_type = _upgrade_type;

  IF _upgrade_type = 'energy_core' THEN
    SELECT max_energy INTO current_max_energy FROM public.users WHERE telegram_id = _telegram_id;
    target_max_energy := LEAST(12000, GREATEST(current_max_energy, 1000 + (next_level * 75)));

    UPDATE public.users
    SET max_energy = target_max_energy,
        energy = LEAST(target_max_energy, energy + 40)
    WHERE telegram_id = _telegram_id;
  END IF;

  RETURN QUERY
  SELECT true, next_level, (SELECT bmh_balance FROM public.users WHERE telegram_id = _telegram_id);
END;
$function$;

-- Fairer earning and level progression curve
CREATE OR REPLACE FUNCTION public.tap_marsh(_telegram_id bigint, _tap_at timestamp with time zone DEFAULT now())
RETURNS TABLE(earned_bmh integer, combo integer, energy integer, bmh_balance bigint, level integer, next_regen_in integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  u public.users;
  rg record;
  factory_level int := 0;
  viral_level int := 0;
  precision_level int := 0;
  energy_core_level int := 0;
  ref_mult numeric := 1;
  base_reward numeric := 1;
  combo_multiplier numeric := 1;
  reward numeric := 1;
  referrer bigint;
  ref_share int := 0;
  delta interval;
  next_level_goal bigint;
  target_max_energy int;
BEGIN
  SELECT * INTO u FROM public.users WHERE telegram_id = _telegram_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF u.is_banned THEN RAISE EXCEPTION 'user_banned'; END IF;

  SELECT COALESCE(level, 0) INTO factory_level FROM public.upgrades WHERE user_id = _telegram_id AND upgrade_type = 'marsh_factory';
  SELECT COALESCE(level, 0) INTO viral_level FROM public.upgrades WHERE user_id = _telegram_id AND upgrade_type = 'viral_boost';
  SELECT COALESCE(level, 0) INTO precision_level FROM public.upgrades WHERE user_id = _telegram_id AND upgrade_type = 'precision_tap';
  SELECT COALESCE(level, 0) INTO energy_core_level FROM public.upgrades WHERE user_id = _telegram_id AND upgrade_type = 'energy_core';
  SELECT (1 + COALESCE(level, 0) * 0.03)::numeric INTO ref_mult FROM public.upgrades WHERE user_id = _telegram_id AND upgrade_type = 'referral_multiplier';

  target_max_energy := LEAST(12000, GREATEST(u.max_energy, 1000 + (energy_core_level * 75)));
  IF target_max_energy <> u.max_energy THEN
    UPDATE public.users SET max_energy = target_max_energy WHERE telegram_id = _telegram_id;
    u.max_energy := target_max_energy;
    u.energy := LEAST(u.energy, u.max_energy);
  END IF;

  SELECT * INTO rg FROM public.compute_regen(u.energy, u.max_energy, u.last_energy_at);
  u.energy := rg.new_energy;
  u.last_energy_at := rg.new_last_energy_at;

  IF u.energy <= 0 THEN
    RETURN QUERY SELECT 0, u.combo_count, u.energy, u.bmh_balance, u.level, GREATEST(0, 3 - floor(extract(epoch from (now() - u.last_energy_at)))::int);
    RETURN;
  END IF;

  IF u.last_tap IS NOT NULL THEN
    delta := _tap_at - u.last_tap;
    IF extract(epoch from delta) <= 0.8 THEN
      u.combo_count := LEAST(20, u.combo_count + 1);
    ELSE
      u.combo_count := 1;
    END IF;
  ELSE
    u.combo_count := 1;
  END IF;

  base_reward := 1 + (factory_level * 0.6);
  combo_multiplier := 1 + (LEAST(8, u.combo_count) * 0.06);
  reward := floor(base_reward * combo_multiplier * (1 + viral_level * 0.02) * (1 + precision_level * 0.025));
  reward := GREATEST(1, reward);

  u.energy := u.energy - 1;
  u.bmh_balance := u.bmh_balance + reward;
  u.weekly_bmh := u.weekly_bmh + reward;
  u.total_taps := u.total_taps + 1;
  u.last_tap := _tap_at;

  next_level_goal := (u.level::bigint * 9000) + ((u.level::bigint * u.level::bigint) * 1200);
  IF u.bmh_balance >= next_level_goal THEN
    u.level := u.level + 1;
    u.max_energy := LEAST(12000, u.max_energy + 12);
    u.energy := LEAST(u.max_energy, u.energy + 12);
  END IF;

  UPDATE public.users
  SET energy = u.energy,
      max_energy = u.max_energy,
      combo_count = u.combo_count,
      bmh_balance = u.bmh_balance,
      weekly_bmh = u.weekly_bmh,
      total_taps = u.total_taps,
      last_tap = u.last_tap,
      last_energy_at = u.last_energy_at,
      level = u.level
  WHERE telegram_id = _telegram_id;

  SELECT r.referrer_id INTO referrer
  FROM public.referrals r
  WHERE r.referred_id = _telegram_id;

  IF referrer IS NOT NULL THEN
    ref_share := GREATEST(0, floor((reward * 0.05) * COALESCE(ref_mult, 1))::int);
    IF ref_share > 0 THEN
      UPDATE public.users
      SET bmh_balance = bmh_balance + ref_share,
          weekly_bmh = weekly_bmh + ref_share,
          total_referral_reward = total_referral_reward + ref_share
      WHERE telegram_id = referrer;
    END IF;
  END IF;

  RETURN QUERY
  SELECT reward::int, u.combo_count, u.energy, u.bmh_balance, u.level, GREATEST(0, 3 - floor(extract(epoch from (now() - u.last_energy_at)))::int);
END;
$function$;

-- Return per-upgrade next_cost aligned with buy_upgrade pricing
CREATE OR REPLACE FUNCTION public.get_state(_telegram_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  u public.users%ROWTYPE;
  rg record;
  tasks_json jsonb;
  refs_json jsonb;
  upgrades_json jsonb;
  next_regen int;
BEGIN
  PERFORM public.ensure_daily_tasks();

  SELECT * INTO u
  FROM public.users
  WHERE telegram_id = _telegram_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  SELECT * INTO rg
  FROM public.compute_regen(u.energy, u.max_energy, u.last_energy_at);

  IF rg.new_energy <> u.energy THEN
    UPDATE public.users
    SET energy = rg.new_energy,
        last_energy_at = rg.new_last_energy_at
    WHERE telegram_id = _telegram_id;

    u.energy := rg.new_energy;
    u.last_energy_at := rg.new_last_energy_at;
  END IF;

  next_regen := GREATEST(0, 3 - floor(extract(epoch FROM (now() - u.last_energy_at)))::int);

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
  WHERE t.active_date = current_date;

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
        'upgrade_type', upgrade_type,
        'level', level,
        'next_cost', CASE upgrade_type
          WHEN 'marsh_factory' THEN 900 + (level * 700)
          WHEN 'viral_boost' THEN 1100 + (level * 800)
          WHEN 'referral_multiplier' THEN 1000 + (level * 850)
          WHEN 'energy_core' THEN 1300 + (level * 1000)
          WHEN 'precision_tap' THEN 1250 + (level * 950)
          ELSE 1000 + (level * 900)
        END
      )
    ),
    '[]'::jsonb
  ) INTO upgrades_json
  FROM public.upgrades
  WHERE user_id = _telegram_id;

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
      'referral_link', 'https://t.me/BigMarshBot?startapp=' || u.telegram_id
    ),
    'tasks', tasks_json,
    'referrals', refs_json,
    'upgrades', upgrades_json,
    'airdrop_placeholder', 'Airdrop BMH em breve para usuários ativos'
  );
END;
$function$;