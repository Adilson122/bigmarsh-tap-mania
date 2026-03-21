CREATE OR REPLACE FUNCTION public.ensure_daily_tasks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  cfg public.task_settings%ROWTYPE;
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
      format('Faça %s taps hoje', cfg.tap_goal),
      cfg.tap_reward_bmh,
      format('Toque %s vezes no Marsh hoje.', cfg.tap_goal),
      'taps_500',
      current_date,
      cfg.tap_goal
    );
  ELSE
    UPDATE public.tasks
    SET title = format('Faça %s taps hoje', cfg.tap_goal),
        reward_bmh = cfg.tap_reward_bmh,
        description = format('Toque %s vezes no Marsh hoje.', cfg.tap_goal),
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
      format('Convide %s amigo(s)', cfg.referral_goal),
      cfg.referral_reward_bmh,
      format('Convide pelo menos %s amigo(s) hoje.', cfg.referral_goal),
      'invite_1',
      current_date,
      cfg.referral_goal
    );
  ELSE
    UPDATE public.tasks
    SET title = format('Convide %s amigo(s)', cfg.referral_goal),
        reward_bmh = cfg.referral_reward_bmh,
        description = format('Convide pelo menos %s amigo(s) hoje.', cfg.referral_goal),
        target_value = cfg.referral_goal
    WHERE id = (
      SELECT id FROM public.tasks
      WHERE kind = 'invite_1' AND active_date = current_date
      ORDER BY created_at ASC
      LIMIT 1
    );
  END IF;
END;
$$;

-- Cleanup duplicated daily core tasks left from previous runs
DELETE FROM public.tasks t
USING public.tasks k
WHERE t.active_date = current_date
  AND k.active_date = current_date
  AND t.kind IN ('taps_500', 'invite_1')
  AND k.kind = t.kind
  AND k.created_at < t.created_at;