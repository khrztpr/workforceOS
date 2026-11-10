create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);
insert into public.organizations (name, slug) values ('WorkforceOS', 'workforceos');

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin', 'admin', 'viewer')),
  created_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employee_id text not null,
  display_name text not null,
  first_name text,
  last_name text,
  avatar_url text,
  department text,
  job_title text,
  employment_status text,
  employment_type text,
  work_location text,
  work_state text,
  hire_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_id)
);

create or replace function public.is_directory_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('super_admin', 'admin')) $$;
grant execute on function public.is_directory_admin() to authenticated;

alter table public.organizations enable row level security;
alter table public.user_roles enable row level security;
alter table public.people enable row level security;
create policy "admins manage organizations" on public.organizations for select to authenticated using (public.is_directory_admin());
create policy "admins read roles" on public.user_roles for select to authenticated using (public.is_directory_admin());
create policy "admins manage people" on public.people for all to authenticated using (public.is_directory_admin()) with check (public.is_directory_admin());
