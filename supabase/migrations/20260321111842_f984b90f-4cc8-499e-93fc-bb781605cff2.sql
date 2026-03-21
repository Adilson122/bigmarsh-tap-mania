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
      'weekly_bmh', u.weekly_bmh,
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