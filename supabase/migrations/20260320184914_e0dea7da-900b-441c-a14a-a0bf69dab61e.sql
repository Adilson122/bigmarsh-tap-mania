-- Monetization passes configured by admin
CREATE TABLE IF NOT EXISTS public.monetization_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_type text NOT NULL UNIQUE,
  title text NOT NULL,
  duration_days integer NOT NULL,
  price_usd numeric(10,2) NOT NULL,
  benefits text NOT NULL DEFAULT '',
  is_visible boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monetization_passes_type_check CHECK (pass_type IN ('weekly','monthly')),
  CONSTRAINT monetization_passes_duration_check CHECK (duration_days > 0),
  CONSTRAINT monetization_passes_price_check CHECK (price_usd >= 0)
);

ALTER TABLE public.monetization_passes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'monetization_passes'
      AND policyname = 'service_role_only_monetization_passes'
  ) THEN
    CREATE POLICY "service_role_only_monetization_passes"
      ON public.monetization_passes
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

-- Configurable daily task thresholds/rewards managed by admin
CREATE TABLE IF NOT EXISTS public.task_settings (
  id integer PRIMARY KEY DEFAULT 1,
  referral_goal integer NOT NULL DEFAULT 1,
  referral_reward_bmh integer NOT NULL DEFAULT 8000,
  tap_goal integer NOT NULL DEFAULT 500,
  tap_reward_bmh integer NOT NULL DEFAULT 6000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_settings_singleton_check CHECK (id = 1),
  CONSTRAINT task_settings_referral_goal_check CHECK (referral_goal > 0),
  CONSTRAINT task_settings_referral_reward_check CHECK (referral_reward_bmh >= 0),
  CONSTRAINT task_settings_tap_goal_check CHECK (tap_goal > 0),
  CONSTRAINT task_settings_tap_reward_check CHECK (tap_reward_bmh >= 0)
);

ALTER TABLE public.task_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'task_settings'
      AND policyname = 'service_role_only_task_settings'
  ) THEN
    CREATE POLICY "service_role_only_task_settings"
      ON public.task_settings
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

INSERT INTO public.task_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.monetization_passes (pass_type, title, duration_days, price_usd, benefits, is_visible, is_enabled, sort_order)
VALUES
  ('weekly', 'Passe Semanal', 7, 0.50, 'Bônus de evolução e vantagens exclusivas por 7 dias.', false, false, 1),
  ('monthly', 'Passe Mensal', 30, 5.00, 'Benefícios premium e progresso acelerado por 30 dias.', false, false, 2)
ON CONFLICT (pass_type) DO NOTHING;

-- Extend tasks with configurable objective target
ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS target_value integer;

UPDATE public.tasks
SET target_value = CASE
  WHEN kind = 'taps_500' THEN 500
  WHEN kind = 'invite_1' THEN 1
  ELSE target_value
END
WHERE target_value IS NULL;

-- Keep updated_at fresh on admin-managed tables
DROP TRIGGER IF EXISTS touch_monetization_passes_updated_at ON public.monetization_passes;
CREATE TRIGGER touch_monetization_passes_updated_at
BEFORE UPDATE ON public.monetization_passes
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_task_settings_updated_at ON public.task_settings;
CREATE TRIGGER touch_task_settings_updated_at
BEFORE UPDATE ON public.task_settings
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- Rework daily auto-task generation using admin settings
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
        target_value = EXCLUDED.target_value;

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
        target_value = EXCLUDED.target_value;
END;
$$;

-- Claim uses per-task objective configured in target_value
CREATE OR REPLACE FUNCTION public.claim_task(_telegram_id bigint, _task_id uuid)
RETURNS TABLE(ok boolean, reward integer, new_balance bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

-- Include target_value in state payload
CREATE OR REPLACE FUNCTION public.get_state(_telegram_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;