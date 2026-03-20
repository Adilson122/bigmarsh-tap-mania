create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'moderator', 'user');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_kind as enum ('taps_500', 'invite_1');
exception when duplicate_object then null; end $$;

create table if not exists public.users (
  telegram_id bigint primary key,
  username text,
  first_name text,
  avatar_url text,
  bmh_balance bigint not null default 0,
  energy int not null default 1000,
  max_energy int not null default 1000,
  level int not null default 1,
  combo_count int not null default 0,
  last_tap timestamptz,
  last_energy_at timestamptz not null default now(),
  daily_streak int not null default 0,
  referrals_count int not null default 0,
  last_login date,
  total_taps bigint not null default 0,
  weekly_bmh bigint not null default 0,
  weekly_reset_at timestamptz not null default now(),
  total_referral_reward bigint not null default 0,
  is_banned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.users(telegram_id) on delete cascade,
  role app_role not null,
  unique (user_id, role)
);

create table if not exists public.upgrades (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.users(telegram_id) on delete cascade,
  upgrade_type text not null check (upgrade_type in ('marsh_factory', 'viral_boost', 'referral_multiplier')),
  level int not null default 0,
  unique(user_id, upgrade_type)
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id bigint not null references public.users(telegram_id) on delete cascade,
  referred_id bigint not null references public.users(telegram_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(referred_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  reward_bmh int not null,
  description text,
  completed_by_user boolean not null default false,
  kind task_kind not null,
  active_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique(kind, active_date)
);

create table if not exists public.task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id bigint not null references public.users(telegram_id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique(task_id, user_id)
);

create table if not exists public.admin_sessions (
  token text primary key,
  telegram_id bigint references public.users(telegram_id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked boolean not null default false
);

create index if not exists idx_users_balance on public.users(bmh_balance desc);
create index if not exists idx_users_weekly on public.users(weekly_bmh desc);
create index if not exists idx_referrals_referrer on public.referrals(referrer_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at before update on public.users for each row execute function public.touch_updated_at();

create or replace function public.has_role(_user_id bigint, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.ensure_daily_tasks()
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.tasks(title, reward_bmh, description, kind, active_date)
  values ('Faça 500 taps hoje', 6000, 'Toque 500 vezes no Marsh hoje.', 'taps_500', current_date)
  on conflict (kind, active_date) do nothing;

  insert into public.tasks(title, reward_bmh, description, kind, active_date)
  values ('Convide 1 amigo', 8000, 'Convide pelo menos 1 amigo hoje.', 'invite_1', current_date)
  on conflict (kind, active_date) do nothing;
end;
$$;

create or replace function public.compute_regen(_energy int, _max_energy int, _last_energy_at timestamptz)
returns table(new_energy int, new_last_energy_at timestamptz)
language plpgsql stable as $$
declare elapsed_seconds int; regen_steps int; candidate int;
begin
  elapsed_seconds := greatest(0, floor(extract(epoch from (now() - _last_energy_at)))::int);
  regen_steps := floor(elapsed_seconds / 3.0)::int;
  candidate := least(_max_energy, _energy + regen_steps);
  if regen_steps > 0 then
    return query select candidate, (_last_energy_at + make_interval(secs => regen_steps * 3));
  else
    return query select _energy, _last_energy_at;
  end if;
end;
$$;

create or replace function public.tg_auth_upsert(_telegram_id bigint, _username text, _first_name text, _avatar_url text, _start_param text default null)
returns public.users language plpgsql security definer set search_path = public as $$
declare existing_user public.users; ref_id bigint; streak_bonus bigint := 0; days_gap int := 0; inserted_count int := 0;
begin
  perform public.ensure_daily_tasks();

  insert into public.users(telegram_id, username, first_name, avatar_url, last_login)
  values (_telegram_id, _username, _first_name, _avatar_url, current_date)
  on conflict (telegram_id) do update
    set username = excluded.username,
        first_name = excluded.first_name,
        avatar_url = excluded.avatar_url
  returning * into existing_user;

  if existing_user.last_login is null then
    update public.users set daily_streak = 1, bmh_balance = bmh_balance + 1000, last_login = current_date where telegram_id = _telegram_id;
  elsif existing_user.last_login < current_date then
    days_gap := current_date - existing_user.last_login;
    if days_gap = 1 then
      update public.users set daily_streak = least(30, daily_streak + 1), last_login = current_date where telegram_id = _telegram_id;
    else
      update public.users set daily_streak = 1, last_login = current_date where telegram_id = _telegram_id;
    end if;

    select case
      when daily_streak >= 7 then 10000
      when daily_streak = 6 then 8000
      when daily_streak = 5 then 6000
      when daily_streak = 4 then 4500
      when daily_streak = 3 then 3000
      when daily_streak = 2 then 2000
      else 1000
    end into streak_bonus
    from public.users where telegram_id = _telegram_id;

    update public.users set bmh_balance = bmh_balance + streak_bonus where telegram_id = _telegram_id;
  end if;

  if _start_param is not null and _start_param ~ '^[0-9]+$' then
    ref_id := _start_param::bigint;
    if ref_id <> _telegram_id and exists(select 1 from public.users where telegram_id = ref_id)
      and not exists(select 1 from public.referrals where referred_id = _telegram_id) then
      insert into public.referrals(referrer_id, referred_id) values (ref_id, _telegram_id) on conflict do nothing;
      get diagnostics inserted_count = row_count;
      if inserted_count > 0 then
        update public.users set bmh_balance = bmh_balance + 10000, referrals_count = referrals_count + 1 where telegram_id = ref_id;
        update public.users set bmh_balance = bmh_balance + 5000 where telegram_id = _telegram_id;
      end if;
    end if;
  end if;

  insert into public.upgrades(user_id, upgrade_type, level)
  values (_telegram_id, 'marsh_factory', 0), (_telegram_id, 'viral_boost', 0), (_telegram_id, 'referral_multiplier', 0)
  on conflict (user_id, upgrade_type) do nothing;

  return (select u from public.users u where u.telegram_id = _telegram_id);
end;
$$;

create or replace function public.tap_marsh(_telegram_id bigint, _tap_at timestamptz default now())
returns table(earned_bmh int, combo int, energy int, bmh_balance bigint, level int, next_regen_in int)
language plpgsql security definer set search_path = public as $$
declare u public.users; rg record; factory_level int := 0; viral_level int := 0; ref_mult numeric := 1; base_reward int := 1; reward int := 1; referrer bigint; ref_share int := 0; delta interval;
begin
  select * into u from public.users where telegram_id = _telegram_id for update;
  if not found then raise exception 'user_not_found'; end if;
  if u.is_banned then raise exception 'user_banned'; end if;

  select * into rg from public.compute_regen(u.energy, u.max_energy, u.last_energy_at);
  u.energy := rg.new_energy; u.last_energy_at := rg.new_last_energy_at;

  if u.energy <= 0 then
    return query select 0, u.combo_count, u.energy, u.bmh_balance, u.level, greatest(0, 3 - floor(extract(epoch from (now() - u.last_energy_at)))::int);
    return;
  end if;

  select level into factory_level from public.upgrades where user_id = _telegram_id and upgrade_type = 'marsh_factory';
  select level into viral_level from public.upgrades where user_id = _telegram_id and upgrade_type = 'viral_boost';
  select (1 + level * 0.05)::numeric into ref_mult from public.upgrades where user_id = _telegram_id and upgrade_type = 'referral_multiplier';

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

create or replace function public.buy_upgrade(_telegram_id bigint, _upgrade_type text)
returns table(ok boolean, new_level int, new_balance bigint)
language plpgsql security definer set search_path = public as $$
declare current_level int; cost bigint; balance bigint;
begin
  if _upgrade_type not in ('marsh_factory', 'viral_boost', 'referral_multiplier') then raise exception 'invalid_upgrade'; end if;

  insert into public.upgrades(user_id, upgrade_type, level) values (_telegram_id, _upgrade_type, 0)
  on conflict (user_id, upgrade_type) do nothing;

  select level into current_level from public.upgrades where user_id = _telegram_id and upgrade_type = _upgrade_type for update;
  cost := (current_level + 1) * 2500;

  select bmh_balance into balance from public.users where telegram_id = _telegram_id for update;
  if balance < cost then return query select false, current_level, balance; return; end if;

  update public.users set bmh_balance = bmh_balance - cost where telegram_id = _telegram_id;
  update public.upgrades set level = current_level + 1 where user_id = _telegram_id and upgrade_type = _upgrade_type;

  return query select true, current_level + 1, (select bmh_balance from public.users where telegram_id = _telegram_id);
end;
$$;

create or replace function public.claim_task(_telegram_id bigint, _task_id uuid)
returns table(ok boolean, reward int, new_balance bigint)
language plpgsql security definer set search_path = public as $$
declare t public.tasks; already boolean; metric_ok boolean := false; today_invites bigint := 0;
begin
  perform public.ensure_daily_tasks();
  select * into t from public.tasks where id = _task_id and active_date = current_date;
  if not found then return query select false, 0, (select bmh_balance from public.users where telegram_id = _telegram_id); return; end if;

  select exists(select 1 from public.task_completions where task_id = _task_id and user_id = _telegram_id) into already;
  if already then return query select false, 0, (select bmh_balance from public.users where telegram_id = _telegram_id); return; end if;

  if t.kind = 'taps_500' then
    metric_ok := (select total_taps >= 500 from public.users where telegram_id = _telegram_id);
  elsif t.kind = 'invite_1' then
    select count(*) into today_invites from public.referrals where referrer_id = _telegram_id and created_at::date = current_date;
    metric_ok := today_invites >= 1;
  end if;

  if not metric_ok then return query select false, 0, (select bmh_balance from public.users where telegram_id = _telegram_id); return; end if;

  insert into public.task_completions(task_id, user_id) values (_task_id, _telegram_id);
  update public.users set bmh_balance = bmh_balance + t.reward_bmh, weekly_bmh = weekly_bmh + t.reward_bmh where telegram_id = _telegram_id;

  return query select true, t.reward_bmh, (select bmh_balance from public.users where telegram_id = _telegram_id);
end;
$$;

create or replace function public.get_state(_telegram_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u public.users; rg record; tasks_json jsonb; refs_json jsonb; upgrades_json jsonb; next_regen int;
begin
  perform public.ensure_daily_tasks();
  select * into u from public.users where telegram_id = _telegram_id for update;
  if not found then raise exception 'user_not_found'; end if;

  select * into rg from public.compute_regen(u.energy, u.max_energy, u.last_energy_at);
  if rg.new_energy <> u.energy then
    update public.users set energy = rg.new_energy, last_energy_at = rg.new_last_energy_at where telegram_id = _telegram_id;
    u.energy := rg.new_energy; u.last_energy_at := rg.new_last_energy_at;
  end if;

  next_regen := greatest(0, 3 - floor(extract(epoch from (now() - u.last_energy_at)))::int);

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'description', t.description, 'reward_bmh', t.reward_bmh, 'kind', t.kind,
    'completed', exists(select 1 from public.task_completions c where c.task_id=t.id and c.user_id=_telegram_id)) order by t.created_at), '[]'::jsonb)
  into tasks_json from public.tasks t where t.active_date = current_date;

  select coalesce(jsonb_agg(jsonb_build_object('telegram_id', u2.telegram_id, 'username', u2.username, 'first_name', u2.first_name, 'avatar_url', u2.avatar_url, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
  into refs_json from public.referrals r join public.users u2 on u2.telegram_id = r.referred_id where r.referrer_id = _telegram_id;

  select coalesce(jsonb_agg(jsonb_build_object('upgrade_type', upgrade_type, 'level', level, 'next_cost', (level + 1) * 2500)), '[]'::jsonb)
  into upgrades_json from public.upgrades where user_id = _telegram_id;

  return jsonb_build_object(
    'user', jsonb_build_object('telegram_id', u.telegram_id, 'username', u.username, 'first_name', u.first_name, 'avatar_url', u.avatar_url, 'bmh_balance', u.bmh_balance, 'energy', u.energy, 'max_energy', u.max_energy, 'level', u.level, 'daily_streak', u.daily_streak, 'referrals_count', u.referrals_count, 'total_taps', u.total_taps, 'next_regen_in', next_regen, 'referral_link', 'https://t.me/BigMarshBot?startapp=' || u.telegram_id),
    'tasks', tasks_json,
    'referrals', refs_json,
    'upgrades', upgrades_json,
    'airdrop_placeholder', 'Airdrop BMH em breve para usuários ativos'
  );
end;
$$;

create or replace function public.get_leaderboard(_telegram_id bigint, _scope text default 'all_time')
returns table(rank_no bigint, telegram_id bigint, username text, first_name text, avatar_url text, bmh_balance bigint, weekly_bmh bigint)
language sql security definer set search_path = public as $$
  with base as (
    select u.telegram_id, u.username, u.first_name, u.avatar_url, u.bmh_balance, u.weekly_bmh,
      row_number() over (order by case when _scope = 'weekly' then u.weekly_bmh else u.bmh_balance end desc, u.telegram_id asc) as rn
    from public.users u
    where not u.is_banned
      and (_scope <> 'friends' or u.telegram_id = _telegram_id or exists(select 1 from public.referrals r where (r.referrer_id = _telegram_id and r.referred_id = u.telegram_id) or (r.referred_id = _telegram_id and r.referrer_id = u.telegram_id)))
  )
  select rn as rank_no, telegram_id, username, first_name, avatar_url, bmh_balance, weekly_bmh
  from base where rn <= 100 order by rn;
$$;

create or replace function public.get_admin_stats()
returns jsonb language sql security definer set search_path = public as $$
  with growth as (
    select to_char(created_at::date, 'YYYY-MM-DD') as day, count(*)::int as users
    from public.users where created_at >= now() - interval '14 day' group by 1 order by 1
  )
  select jsonb_build_object(
    'total_users', (select count(*) from public.users),
    'total_bmh_distributed', (select coalesce(sum(bmh_balance),0) from public.users),
    'dau', (select count(*) from public.users where last_login = current_date),
    'growth', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'users', users)), '[]'::jsonb) from growth)
  );
$$;

alter table public.users enable row level security;
alter table public.user_roles enable row level security;
alter table public.upgrades enable row level security;
alter table public.referrals enable row level security;
alter table public.tasks enable row level security;
alter table public.task_completions enable row level security;
alter table public.admin_sessions enable row level security;

select public.ensure_daily_tasks();