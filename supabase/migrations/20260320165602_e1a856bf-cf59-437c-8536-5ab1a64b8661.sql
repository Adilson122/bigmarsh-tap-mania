create or replace function public.tap_marsh(_telegram_id bigint, _tap_at timestamptz default now())
returns table(earned_bmh int, combo int, energy int, bmh_balance bigint, level int, next_regen_in int)
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.users;
  rg record;
  factory_level int := 0;
  viral_level int := 0;
  ref_mult numeric := 1;
  base_reward int := 1;
  reward int := 1;
  referrer bigint;
  ref_share int := 0;
  delta interval;
begin
  select * into u from public.users where telegram_id = _telegram_id for update;
  if not found then raise exception 'user_not_found'; end if;
  if u.is_banned then raise exception 'user_banned'; end if;

  select * into rg from public.compute_regen(u.energy, u.max_energy, u.last_energy_at);
  u.energy := rg.new_energy;
  u.last_energy_at := rg.new_last_energy_at;

  if u.energy <= 0 then
    return query select 0, u.combo_count, u.energy, u.bmh_balance, u.level, greatest(0, 3 - floor(extract(epoch from (now() - u.last_energy_at)))::int);
    return;
  end if;

  select up.level into factory_level from public.upgrades up where up.user_id = _telegram_id and up.upgrade_type = 'marsh_factory';
  select up.level into viral_level from public.upgrades up where up.user_id = _telegram_id and up.upgrade_type = 'viral_boost';
  select (1 + up.level * 0.05)::numeric into ref_mult from public.upgrades up where up.user_id = _telegram_id and up.upgrade_type = 'referral_multiplier';

  if u.last_tap is not null then
    delta := _tap_at - u.last_tap;
    if extract(epoch from delta) <= 0.8 then u.combo_count := least(20, u.combo_count + 1); else u.combo_count := 1; end if;
  else u.combo_count := 1; end if;

  base_reward := 1 + greatest(0, coalesce(factory_level,0));
  reward := floor(base_reward * (1 + least(10, u.combo_count) * 0.1) * (1 + coalesce(viral_level,0) * 0.03))::int;

  u.energy := u.energy - 1;
  u.bmh_balance := u.bmh_balance + reward;
  u.weekly_bmh := u.weekly_bmh + reward;
  u.total_taps := u.total_taps + 1;
  u.last_tap := _tap_at;

  if u.bmh_balance >= (u.level::bigint * 5000) then
    u.level := u.level + 1;
    u.max_energy := least(10000, u.max_energy + 25);
    u.energy := least(u.max_energy, u.energy + 25);
  end if;

  update public.users set energy=u.energy,max_energy=u.max_energy,combo_count=u.combo_count,bmh_balance=u.bmh_balance,weekly_bmh=u.weekly_bmh,total_taps=u.total_taps,last_tap=u.last_tap,last_energy_at=u.last_energy_at,level=u.level where telegram_id=_telegram_id;

  select r.referrer_id into referrer from public.referrals r where r.referred_id = _telegram_id;
  if referrer is not null then
    ref_share := greatest(0, floor((reward * 0.05) * coalesce(ref_mult,1))::int);
    if ref_share > 0 then
      update public.users set bmh_balance = bmh_balance + ref_share, weekly_bmh = weekly_bmh + ref_share, total_referral_reward = total_referral_reward + ref_share where telegram_id = referrer;
    end if;
  end if;

  return query select reward, u.combo_count, u.energy, u.bmh_balance, u.level, greatest(0, 3 - floor(extract(epoch from (now() - u.last_energy_at)))::int);
end;
$$;