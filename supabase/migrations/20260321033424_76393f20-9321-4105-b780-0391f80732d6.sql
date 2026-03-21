DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public'
      AND t.typname = 'task_kind'
      AND e.enumlabel = 'watch_ad'
  ) THEN
    ALTER TYPE public.task_kind ADD VALUE 'watch_ad';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public'
      AND t.typname = 'task_kind'
      AND e.enumlabel = 'ad_watch'
  ) THEN
    ALTER TYPE public.task_kind ADD VALUE 'ad_watch';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.ensure_daily_tasks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.task_settings%ROWTYPE;
  hour_bucket integer := floor(extract(epoch from date_trunc('hour', now())) / 3600)::integer;
  ad_interstitial_reward integer := 1200 + ((hour_bucket % 6) * 150);
  ad_popup_reward integer := 1800 + ((hour_bucket % 8) * 175);
BEGIN
  SELECT * INTO cfg
  FROM public.task_settings
  WHERE id = 1;

  IF NOT FOUND THEN
    INSERT INTO public.task_settings (id)
    VALUES (1)
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
    'Rewarded Interstitial · recompensa dinâmica ao longo do dia.',
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
    'Rewarded Popup · recompensa dinâmica ao longo do dia.',
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