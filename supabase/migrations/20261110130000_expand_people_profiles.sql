-- Extends the clean directory schema for the three approved roster formats.

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('super_admin', 'admin', 'hr', 'training', 'viewer'));

alter table public.people
  add column if not exists rippling_profile_number text,
  add column if not exists department_path text,
  add column if not exists manager_employee_id text,
  add column if not exists manager_name text,
  add column if not exists is_manager boolean not null default false,
  add column if not exists offer_accepted_date date,
  add column if not exists title_effective_date date,
  add column if not exists regularization_date date,
  add column if not exists policy_effective_date date,
  add column if not exists last_work_date date,
  add column if not exists separation_date date;

create table if not exists public.people_private (
  person_id uuid primary key references public.people(id) on delete cascade,
  personal_email text,
  birth_date date,
  gender text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.can_view_directory()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.user_roles
  where user_id = auth.uid()
    and role in ('super_admin', 'admin', 'hr', 'training')
) $$;

create or replace function public.can_manage_private_people()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.user_roles
  where user_id = auth.uid()
    and role in ('super_admin', 'admin', 'hr')
) $$;

grant execute on function public.can_view_directory() to authenticated;
grant execute on function public.can_manage_private_people() to authenticated;

alter table public.people_private enable row level security;

create policy "hr and training read directory"
on public.people for select to authenticated
using (public.can_view_directory());

create policy "hr and training read organizations"
on public.organizations for select to authenticated
using (public.can_view_directory());

create policy "authorized staff read private profiles"
on public.people_private for select to authenticated
using (public.can_view_directory());

create policy "hr manages private profiles"
on public.people_private for all to authenticated
using (public.can_manage_private_people())
with check (public.can_manage_private_people());
