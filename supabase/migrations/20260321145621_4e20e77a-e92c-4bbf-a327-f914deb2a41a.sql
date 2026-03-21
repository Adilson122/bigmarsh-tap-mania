-- Add explicit fake-user flag to avoid heuristic misclassification
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS is_fake boolean NOT NULL DEFAULT false;

-- Mark known generated/debug accounts as fake (one-time backfill)
UPDATE public.users
SET is_fake = true
WHERE username IN ('ref_master', 'new_marsh', 'bigmarsh_dev')
   OR telegram_id BETWEEN 900000 AND 999999;

-- Accept TON friendly and raw wallet formats
CREATE OR REPLACE FUNCTION public.connect_user_wallet(_telegram_id bigint, _wallet_address text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  normalized text := btrim(COALESCE(_wallet_address, ''));
BEGIN
  IF normalized = '' THEN
    RAISE EXCEPTION 'wallet_address_required';
  END IF;

  -- Friendly/base64url (EQ... / UQ...) or raw format (0:...64hex)
  IF NOT (
    normalized ~ '^[EU]Q[0-9A-Za-z_-]{46,120}$'
    OR normalized ~ '^-?[0-9]+:[0-9A-Fa-f]{64}$'
    OR normalized ~ '^[0-9A-Fa-f]{64}$'
  ) THEN
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
$function$;

-- Accept referral start params as numeric or ref_<id>
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
  parsed_start text := COALESCE(_start_param, '');
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

  IF parsed_start ~ '^ref_[0-9]+$' THEN
    parsed_start := substring(parsed_start from 5);
  END IF;

  IF parsed_start ~ '^[0-9]+$' THEN
    ref_id := parsed_start::bigint;
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