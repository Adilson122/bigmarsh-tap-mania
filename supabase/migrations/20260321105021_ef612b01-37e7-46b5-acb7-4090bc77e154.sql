-- Wallet + checkout + pass effects + continuous ad slots

-- 1) App settings for TON checkout receiver
CREATE TABLE IF NOT EXISTS public.app_settings (
  id integer PRIMARY KEY DEFAULT 1,
  ton_receiver_address text NOT NULL DEFAULT '',
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (id, ton_receiver_address)
VALUES (1, '')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'app_settings' AND policyname = 'service_role_only_app_settings'
  ) THEN
    CREATE POLICY service_role_only_app_settings
    ON public.app_settings
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- 2) Wallet binding
CREATE TABLE IF NOT EXISTS public.user_wallets (
  user_id bigint PRIMARY KEY REFERENCES public.users(telegram_id) ON DELETE CASCADE,
  wallet_address text NOT NULL UNIQUE,
  wallet_provider text NOT NULL DEFAULT 'ton',
  connected_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_wallets' AND policyname = 'service_role_only_user_wallets'
  ) THEN
    CREATE POLICY service_role_only_user_wallets
    ON public.user_wallets
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- 3) Pass purchases + active passes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_status') THEN
    CREATE TYPE public.purchase_status AS ENUM ('pending', 'paid', 'expired', 'failed');
  END IF;
END $$;

ALTER TABLE public.monetization_passes
ADD COLUMN IF NOT EXISTS price_ton numeric(20,9) NOT NULL DEFAULT 0.1;

UPDATE public.monetization_passes
SET price_ton = CASE
  WHEN pass_type = 'weekly' THEN 0.12
  WHEN pass_type = 'monthly' THEN 0.42
  ELSE GREATEST(price_ton, 0.08)
END
WHERE price_ton <= 0;

CREATE TABLE IF NOT EXISTS public.pass_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL REFERENCES public.users(telegram_id) ON DELETE CASCADE,
  pass_type text NOT NULL,
  amount_ton numeric(20,9) NOT NULL,
  amount_nano bigint NOT NULL,
  recipient_address text NOT NULL,
  payment_comment text NOT NULL UNIQUE,
  status public.purchase_status NOT NULL DEFAULT 'pending',
  tx_hash text,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '30 minutes'),
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pass_purchases_user_status ON public.pass_purchases(user_id, status, created_at DESC);

ALTER TABLE public.pass_purchases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pass_purchases' AND policyname = 'service_role_only_pass_purchases'
  ) THEN
    CREATE POLICY service_role_only_pass_purchases
    ON public.pass_purchases
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL REFERENCES public.users(telegram_id) ON DELETE CASCADE,
  pass_type text NOT NULL,
  starts_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  source_purchase_id uuid REFERENCES public.pass_purchases(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_passes_user_expires ON public.user_passes(user_id, expires_at DESC);

ALTER TABLE public.user_passes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_passes' AND policyname = 'service_role_only_user_passes'
  ) THEN
    CREATE POLICY service_role_only_user_passes
    ON public.user_passes
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- 4) Continuous 10 ad slots per user
CREATE TABLE IF NOT EXISTS public.user_ad_slots (
  user_id bigint NOT NULL REFERENCES public.users(telegram_id) ON DELETE CASCADE,
  slot_no integer NOT NULL,
  cycle_no integer NOT NULL DEFAULT 1,
  kind public.task_kind NOT NULL,
  reward_bmh integer NOT NULL,
  next_available_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot_no)
);

ALTER TABLE public.user_ad_slots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_ad_slots' AND policyname = 'service_role_only_user_ad_slots'
  ) THEN
    CREATE POLICY service_role_only_user_ad_slots
    ON public.user_ad_slots
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- 5) Remove one-per-kind/day restriction so manual link tasks can coexist
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_kind_active_date_key;

-- 6) Functions
CREATE OR REPLACE FUNCTION public.get_user_pass_effects(_telegram_id bigint)
RETURNS TABLE(reward_multiplier numeric, regen_interval_seconds integer, referral_bonus_multiplier numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  has_weekly boolean := false;
  has_monthly boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.user_passes p
    WHERE p.user_id = _telegram_id
      AND p.pass_type = 'weekly'
      AND p.expires_at > now()
  ) INTO has_weekly;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_passes p
    WHERE p.user_id = _telegram_id
      AND p.pass_type = 'monthly'
      AND p.expires_at > now()
  ) INTO has_monthly;

  reward_multiplier := 1.0;
  regen_interval_seconds := 3;
  referral_bonus_multiplier := 1.0;

  IF has_weekly THEN
    reward_multiplier := GREATEST(reward_multiplier, 1.2);
    regen_interval_seconds := LEAST(regen_interval_seconds, 2);
    referral_bonus_multiplier := GREATEST(referral_bonus_multiplier, 1.1);
  END IF;

  IF has_monthly THEN
    reward_multiplier := GREATEST(reward_multiplier, 1.45);
    regen_interval_seconds := LEAST(regen_interval_seconds, 2);
    referral_bonus_multiplier := GREATEST(referral_bonus_multiplier, 1.2);
  END IF;

  RETURN QUERY SELECT reward_multiplier, regen_interval_seconds, referral_bonus_multiplier;
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_regen(_energy integer, _max_energy integer, _last_energy_at timestamp with time zone, _regen_interval_seconds integer DEFAULT 3)
RETURNS TABLE(new_energy integer, new_last_energy_at timestamp with time zone)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  elapsed_seconds int;
  regen_steps int;
  candidate int;
  step_seconds int := GREATEST(1, COALESCE(_regen_interval_seconds, 3));
BEGIN
  elapsed_seconds := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - _last_energy_at)))::int);
  regen_steps := FLOOR(elapsed_seconds::numeric / step_seconds)::int;
  candidate := LEAST(_max_energy, _energy + regen_steps);

  IF regen_steps > 0 THEN
    RETURN QUERY SELECT candidate, (_last_energy_at + make_interval(secs => regen_steps * step_seconds));
  ELSE
    RETURN QUERY SELECT _energy, _last_energy_at;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_user_ad_slots(_telegram_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  i int;
  reward int;
  k public.task_kind;
BEGIN
  FOR i IN 1..10 LOOP
    k := CASE WHEN i % 2 = 0 THEN 'ad_watch'::public.task_kind ELSE 'watch_ad'::public.task_kind END;
    reward := 90 + ((i * 13 + FLOOR(EXTRACT(EPOCH FROM now()) / 60)::int) % 61);

    INSERT INTO public.user_ad_slots(user_id, slot_no, kind, reward_bmh, next_available_at)
    VALUES (_telegram_id, i, k, reward, now())
    ON CONFLICT (user_id, slot_no) DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_ad_slot(_telegram_id bigint, _slot_no integer)
RETURNS TABLE(ok boolean, reward integer, new_balance bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s public.user_ad_slots%ROWTYPE;
  next_kind public.task_kind;
  next_reward int;
BEGIN
  PERFORM public.ensure_user_ad_slots(_telegram_id);

  SELECT * INTO s
  FROM public.user_ad_slots
  WHERE user_id = _telegram_id
    AND slot_no = _slot_no
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, (SELECT bmh_balance FROM public.users WHERE telegram_id = _telegram_id);
    RETURN;
  END IF;

  IF s.next_available_at > now() THEN
    RETURN QUERY SELECT false, 0, (SELECT bmh_balance FROM public.users WHERE telegram_id = _telegram_id);
    RETURN;
  END IF;

  UPDATE public.users
  SET bmh_balance = bmh_balance + s.reward_bmh,
      weekly_bmh = weekly_bmh + s.reward_bmh
  WHERE telegram_id = _telegram_id;

  next_kind := CASE WHEN s.kind = 'watch_ad' THEN 'ad_watch'::public.task_kind ELSE 'watch_ad'::public.task_kind END;
  next_reward := 90 + (((s.cycle_no + 1) * 17 + s.slot_no * 11 + FLOOR(EXTRACT(EPOCH FROM now()) / 60)::int) % 61);

  UPDATE public.user_ad_slots
  SET cycle_no = s.cycle_no + 1,
      kind = next_kind,
      reward_bmh = next_reward,
      next_available_at = now() + interval '2 minutes',
      updated_at = now()
  WHERE user_id = _telegram_id
    AND slot_no = _slot_no;

  -- If all 10 were just consumed (none claimable), immediately refresh all 10
  IF NOT EXISTS (
    SELECT 1 FROM public.user_ad_slots
    WHERE user_id = _telegram_id
      AND next_available_at <= now()
  ) THEN
    UPDATE public.user_ad_slots
    SET next_available_at = now(),
        updated_at = now()
    WHERE user_id = _telegram_id;
  END IF;

  RETURN QUERY SELECT true, s.reward_bmh, (SELECT bmh_balance FROM public.users WHERE telegram_id = _telegram_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.connect_user_wallet(_telegram_id bigint, _wallet_address text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  normalized text := btrim(COALESCE(_wallet_address, ''));
BEGIN
  IF normalized = '' THEN
    RAISE EXCEPTION 'wallet_address_required';
  END IF;

  IF normalized !~ '^[A-Za-z0-9_-]{20,120}$' THEN
    RAISE EXCEPTION 'wallet_address_invalid';
  END IF;

  INSERT INTO public.user_wallets(user_id, wallet_address, wallet_provider, connected_at, updated_at)
  VALUES (_telegram_id, normalized, 'ton', now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET wallet_address = EXCLUDED.wallet_address,
        wallet_provider = EXCLUDED.wallet_provider,
        updated_at = now();

  RETURN normalized;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_pass_checkout(_telegram_id bigint, _pass_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pass_row public.monetization_passes%ROWTYPE;
  wallet_row public.user_wallets%ROWTYPE;
  app_cfg public.app_settings%ROWTYPE;
  amount_nano bigint;
  purchase_id uuid;
  comment text;
  purchase_row public.pass_purchases%ROWTYPE;
BEGIN
  SELECT * INTO pass_row
  FROM public.monetization_passes
  WHERE pass_type = _pass_type
    AND is_enabled = true
    AND is_visible = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pass_not_available';
  END IF;

  SELECT * INTO wallet_row
  FROM public.user_wallets
  WHERE user_id = _telegram_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_not_connected';
  END IF;

  SELECT * INTO app_cfg
  FROM public.app_settings
  WHERE id = 1;

  IF app_cfg.ton_receiver_address IS NULL OR btrim(app_cfg.ton_receiver_address) = '' THEN
    RAISE EXCEPTION 'checkout_receiver_not_configured';
  END IF;

  amount_nano := FLOOR(pass_row.price_ton * 1000000000)::bigint;
  IF amount_nano <= 0 THEN
    RAISE EXCEPTION 'pass_price_invalid';
  END IF;

  SELECT * INTO purchase_row
  FROM public.pass_purchases
  WHERE user_id = _telegram_id
    AND pass_type = _pass_type
    AND status = 'pending'
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'purchase_id', purchase_row.id,
      'amount_nano', purchase_row.amount_nano,
      'amount_ton', purchase_row.amount_ton,
      'recipient_address', purchase_row.recipient_address,
      'payment_comment', purchase_row.payment_comment,
      'expires_at', purchase_row.expires_at
    );
  END IF;

  purchase_id := gen_random_uuid();
  comment := format('BMH:%s:%s:%s', _telegram_id, _pass_type, replace(left(purchase_id::text, 8), '-', ''));

  INSERT INTO public.pass_purchases(
    id, user_id, pass_type, amount_ton, amount_nano, recipient_address, payment_comment, status, expires_at
  ) VALUES (
    purchase_id,
    _telegram_id,
    pass_row.pass_type,
    pass_row.price_ton,
    amount_nano,
    app_cfg.ton_receiver_address,
    comment,
    'pending',
    now() + interval '30 minutes'
  );

  RETURN jsonb_build_object(
    'purchase_id', purchase_id,
    'amount_nano', amount_nano,
    'amount_ton', pass_row.price_ton,
    'recipient_address', app_cfg.ton_receiver_address,
    'payment_comment', comment,
    'expires_at', (now() + interval '30 minutes')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_pass_checkout(_telegram_id bigint, _purchase_id uuid, _tx_hash text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  p public.pass_purchases%ROWTYPE;
  pass_row public.monetization_passes%ROWTYPE;
  active_row public.user_passes%ROWTYPE;
  new_expiry timestamp with time zone;
BEGIN
  SELECT * INTO p
  FROM public.pass_purchases
  WHERE id = _purchase_id
    AND user_id = _telegram_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_not_found';
  END IF;

  IF p.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true);
  END IF;

  IF p.expires_at <= now() THEN
    UPDATE public.pass_purchases
    SET status = 'expired'
    WHERE id = p.id;
    RAISE EXCEPTION 'purchase_expired';
  END IF;

  SELECT * INTO pass_row
  FROM public.monetization_passes
  WHERE pass_type = p.pass_type
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pass_not_found';
  END IF;

  UPDATE public.pass_purchases
  SET status = 'paid',
      paid_at = now(),
      tx_hash = NULLIF(btrim(COALESCE(_tx_hash, '')), '')
  WHERE id = p.id;

  SELECT * INTO active_row
  FROM public.user_passes
  WHERE user_id = _telegram_id
    AND pass_type = p.pass_type
    AND expires_at > now()
  ORDER BY expires_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    new_expiry := active_row.expires_at + make_interval(days => pass_row.duration_days);
    UPDATE public.user_passes
    SET expires_at = new_expiry
    WHERE id = active_row.id;
  ELSE
    new_expiry := now() + make_interval(days => pass_row.duration_days);
    INSERT INTO public.user_passes(user_id, pass_type, starts_at, expires_at, source_purchase_id)
    VALUES (_telegram_id, p.pass_type, now(), new_expiry, p.id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'pass_type', p.pass_type, 'expires_at', new_expiry);
END;
$$;

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

  INSERT INTO public.tasks(title, reward_bmh, description, kind, active_date, target_value, link_url)
  VALUES (
    format('Faça %s taps hoje', cfg.tap_goal),
    cfg.tap_reward_bmh,
    format('Toque %s vezes no Marsh hoje.', cfg.tap_goal),
    'taps_500',
    current_date,
    cfg.tap_goal,
    null
  )
  ON CONFLICT DO NOTHING;

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

CREATE OR REPLACE FUNCTION public.tap_marsh(_telegram_id bigint, _tap_at timestamp with time zone DEFAULT now())
RETURNS TABLE(earned_bmh integer, combo integer, energy integer, bmh_balance bigint, level integer, next_regen_in integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  u public.users;
  rg record;
  pass_fx record;
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
  regen_secs int := 3;
BEGIN
  SELECT * INTO u FROM public.users WHERE telegram_id = _telegram_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF u.is_banned THEN RAISE EXCEPTION 'user_banned'; END IF;

  SELECT * INTO pass_fx FROM public.get_user_pass_effects(_telegram_id);
  IF pass_fx IS NOT NULL THEN
    regen_secs := GREATEST(1, COALESCE(pass_fx.regen_interval_seconds, 3));
  END IF;

  SELECT COALESCE(up.level, 0) INTO factory_level FROM public.upgrades up WHERE up.user_id = _telegram_id AND up.upgrade_type = 'marsh_factory';
  SELECT COALESCE(up.level, 0) INTO viral_level FROM public.upgrades up WHERE up.user_id = _telegram_id AND up.upgrade_type = 'viral_boost';
  SELECT COALESCE(up.level, 0) INTO precision_level FROM public.upgrades up WHERE up.user_id = _telegram_id AND up.upgrade_type = 'precision_tap';
  SELECT COALESCE(up.level, 0) INTO energy_core_level FROM public.upgrades up WHERE up.user_id = _telegram_id AND up.upgrade_type = 'energy_core';
  SELECT (1 + COALESCE(up.level, 0) * 0.03)::numeric INTO ref_mult FROM public.upgrades up WHERE up.user_id = _telegram_id AND up.upgrade_type = 'referral_multiplier';

  target_max_energy := LEAST(12000, GREATEST(u.max_energy, 1000 + (energy_core_level * 75)));
  IF target_max_energy <> u.max_energy THEN
    UPDATE public.users SET max_energy = target_max_energy WHERE telegram_id = _telegram_id;
    u.max_energy := target_max_energy;
    u.energy := LEAST(u.energy, u.max_energy);
  END IF;

  SELECT * INTO rg FROM public.compute_regen(u.energy, u.max_energy, u.last_energy_at, regen_secs);
  u.energy := rg.new_energy;
  u.last_energy_at := rg.new_last_energy_at;

  IF u.energy <= 0 THEN
    RETURN QUERY SELECT 0, u.combo_count, u.energy, u.bmh_balance, u.level, GREATEST(0, regen_secs - floor(extract(epoch from (now() - u.last_energy_at)))::int);
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

  IF pass_fx IS NOT NULL THEN
    reward := floor(reward * GREATEST(1.0, COALESCE(pass_fx.reward_multiplier, 1.0)));
  END IF;

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
    ref_share := GREATEST(0, floor((reward * 0.05) * COALESCE(ref_mult, 1) * COALESCE(pass_fx.referral_bonus_multiplier, 1.0))::int);
    IF ref_share > 0 THEN
      UPDATE public.users
      SET bmh_balance = bmh_balance + ref_share,
          weekly_bmh = weekly_bmh + ref_share,
          total_referral_reward = total_referral_reward + ref_share
      WHERE telegram_id = referrer;
    END IF;
  END IF;

  RETURN QUERY
  SELECT reward::int, u.combo_count, u.energy, u.bmh_balance, u.level, GREATEST(0, regen_secs - floor(extract(epoch from (now() - u.last_energy_at)))::int);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_state(_telegram_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  WHERE t.active_date = current_date
    AND t.kind NOT IN ('watch_ad', 'ad_watch');

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', ('ad_slot_' || s.slot_no::text),
        'title', format('Ads Boost #%s', s.slot_no),
        'description', 'Assista anúncio e colete BMH. Slot renova automaticamente.',
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
    'airdrop_placeholder', 'Airdrop BMH em breve para usuários ativos'
  );
END;
$$;

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
$$;

-- Make existing passes visible/enabled so they appear in app
UPDATE public.monetization_passes
SET is_visible = true,
    is_enabled = true,
    benefits = CASE
      WHEN pass_type = 'weekly' THEN '✅ +20% ganho por tap · ✅ regen de energia mais rápido · ✅ +10% bônus de referral'
      WHEN pass_type = 'monthly' THEN '🔥 +45% ganho por tap · ⚡ regen premium · 🚀 +20% bônus de referral · 🎯 vantagem competitiva'
      ELSE benefits
    END
WHERE pass_type IN ('weekly', 'monthly');