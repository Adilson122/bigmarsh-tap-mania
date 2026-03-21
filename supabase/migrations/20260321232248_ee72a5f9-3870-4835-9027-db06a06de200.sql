CREATE OR REPLACE FUNCTION public.claim_ad_slot(_telegram_id bigint, _slot_no integer)
RETURNS TABLE(ok boolean, reward integer, new_balance bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  RETURN QUERY SELECT true, s.reward_bmh, (SELECT bmh_balance FROM public.users WHERE telegram_id = _telegram_id);
END;
$function$;