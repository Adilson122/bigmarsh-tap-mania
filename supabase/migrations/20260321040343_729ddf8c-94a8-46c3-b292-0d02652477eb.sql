ALTER TYPE public.task_kind ADD VALUE IF NOT EXISTS 'link_visit';

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS link_url text;

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
        'next_cost', (level + 1) * 2500
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
BEGIN
  PERFORM public.ensure_daily_tasks();

  SELECT * INTO t
  FROM public.tasks
  WHERE id = _task_id
    AND active_date = current_date;

  IF NOT FOUND THEN
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
  ELSIF t.kind IN ('watch_ad', 'ad_watch') THEN
    metric_ok := true;
  ELSIF t.kind = 'link_visit' THEN
    metric_ok := COALESCE(NULLIF(btrim(t.link_url), ''), '') <> '';
  END IF;

  IF NOT metric_ok THEN
    RETURN QUERY SELECT false, 0, (SELECT bmh_balance FROM public.users WHERE telegram_id = _telegram_id);
    RETURN;
  END IF;

  INSERT INTO public.task_completions(task_id, user_id)
  VALUES (_task_id, _telegram_id);

  UPDATE public.users
  SET bmh_balance = bmh_balance + t.reward_bmh,
      weekly_bmh = weekly_bmh + t.reward_bmh
  WHERE telegram_id = _telegram_id;

  RETURN QUERY
  SELECT true, t.reward_bmh, (SELECT bmh_balance FROM public.users WHERE telegram_id = _telegram_id);
END;
$function$;