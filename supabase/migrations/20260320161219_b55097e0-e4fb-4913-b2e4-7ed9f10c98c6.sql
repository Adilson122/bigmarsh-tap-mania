create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.compute_regen(_energy int, _max_energy int, _last_energy_at timestamptz)
returns table(new_energy int, new_last_energy_at timestamptz)
language plpgsql
stable
set search_path = public
as $$
declare
  elapsed_seconds int;
  regen_steps int;
  candidate int;
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

-- Explicit restrictive policies to satisfy linter while keeping direct client access blocked

drop policy if exists "service_role_only_users" on public.users;
create policy "service_role_only_users" on public.users
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service_role_only_user_roles" on public.user_roles;
create policy "service_role_only_user_roles" on public.user_roles
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service_role_only_upgrades" on public.upgrades;
create policy "service_role_only_upgrades" on public.upgrades
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service_role_only_referrals" on public.referrals;
create policy "service_role_only_referrals" on public.referrals
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service_role_only_tasks" on public.tasks;
create policy "service_role_only_tasks" on public.tasks
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service_role_only_task_completions" on public.task_completions;
create policy "service_role_only_task_completions" on public.task_completions
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "service_role_only_admin_sessions" on public.admin_sessions;
create policy "service_role_only_admin_sessions" on public.admin_sessions
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');