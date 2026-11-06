-- WorkforceOS People import foundation
-- Raw HR files and staged rows are intentionally private.  Access is granted later
-- through narrowly scoped, server-enforced RLS policies after the role model is live.

create extension if not exists pgcrypto;

create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  source_system text not null default 'rippling',
  source_file_name text not null,
  source_sheet_name text,
  storage_bucket text not null default 'hr-raw-imports',
  storage_path text not null unique,
  source_checksum text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'validating', 'needs_review', 'approved', 'rejected', 'imported', 'failed')),
  exported_at timestamptz,
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz,
  total_rows integer,
  valid_rows integer,
  invalid_rows integer,
  duplicate_rows integer,
  error_summary jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_column_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_system text not null default 'rippling',
  source_sheet_name text not null,
  source_column text not null,
  target_field text not null,
  transform_rule text,
  is_required boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_system, source_sheet_name, source_column)
);

create table if not exists public.people_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  row_status text not null default 'pending'
    check (row_status in ('pending', 'valid', 'invalid', 'duplicate', 'approved', 'rejected', 'imported')),
  source_employee_id text,
  raw_data jsonb not null,
  normalized_data jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_run_id, row_number)
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  source_system text not null default 'rippling',
  source_employee_id text not null,
  display_name text not null,
  employment_status text,
  employment_type text,
  department text,
  job_title text,
  manager_source_employee_id text,
  work_location text,
  work_state text,
  hire_date date,
  regularization_date date,
  separation_date date,
  last_work_date date,
  is_manager boolean,
  source_last_seen_at timestamptz,
  active boolean not null default true,
  latest_import_run_id uuid references public.import_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_system, source_employee_id)
);

-- Contact and other sensitive identity data are isolated from the directory table.
create table if not exists public.people_private (
  person_id uuid primary key references public.people(id) on delete cascade,
  first_name text,
  middle_name text,
  last_name text,
  personal_email text,
  birth_date date,
  gender text,
  updated_at timestamptz not null default now()
);

create index if not exists people_org_active_idx on public.people (organization_id, active);
create index if not exists import_runs_org_status_idx on public.import_runs (organization_id, status, uploaded_at desc);
create index if not exists people_import_rows_run_status_idx on public.people_import_rows (import_run_id, row_status);

alter table public.import_runs enable row level security;
alter table public.import_column_mappings enable row level security;
alter table public.people_import_rows enable row level security;
alter table public.people enable row level security;
alter table public.people_private enable row level security;

-- Deliberately no public policies: browser clients cannot read raw HR exports,
-- staging rows, contact data, or the People directory until role-aware policies exist.

insert into public.import_column_mappings
  (organization_id, source_system, source_sheet_name, source_column, target_field, transform_rule, is_required)
select o.id, 'rippling', 'sheet', m.source_column, m.target_field, m.transform_rule, m.is_required
from public.organizations o
cross join (values
  ('Employee - ID', 'source_employee_id', null::text, true),
  ('Employee', 'display_name', 'trim', true),
  ('Manager - ID', 'manager_source_employee_id', null, false),
  ('Personal email', 'personal_email', 'lowercase_trim', false),
  ('Start date as employee (non-contractor)', 'hire_date', 'date', false),
  ('Employment type name', 'employment_type', 'trim', false),
  ('Employment status', 'employment_status', 'trim', false),
  ('Department', 'department', 'trim', false),
  ('Work location name', 'work_location', 'trim', false),
  ('Last work date', 'last_work_date', 'date', false),
  ('Is a manager', 'is_manager', 'boolean', false),
  ('Work in state(s)', 'work_state', 'trim', false)
) as m(source_column, target_field, transform_rule, is_required)
where o.slug = 'america-west'
on conflict (organization_id, source_system, source_sheet_name, source_column)
do update set target_field = excluded.target_field,
              transform_rule = excluded.transform_rule,
              is_required = excluded.is_required,
              is_active = true,
              updated_at = now();

insert into public.import_column_mappings
  (organization_id, source_system, source_sheet_name, source_column, target_field, transform_rule, is_required)
select o.id, 'rippling', 'ROSTER', m.source_column, m.target_field, m.transform_rule, m.is_required
from public.organizations o
cross join (values
  ('Employee ID', 'source_employee_id', null::text, true),
  ('FULL NAME', 'display_name', 'trim', true),
  ('First Name', 'first_name', 'trim', false),
  ('Middle Name', 'middle_name', 'trim', false),
  ('Last Name', 'last_name', 'trim', false),
  ('Department', 'department', 'trim', false),
  ('Location', 'work_location', 'trim', false),
  ('Immediate Supervisor', 'manager_name', 'trim', false),
  ('Position', 'job_title', 'trim', false),
  ('Employee Status', 'employment_status', 'trim', false),
  ('Hire Date', 'hire_date', 'date', false),
  ('Regularization Date', 'regularization_date', 'date', false),
  ('Separation Date', 'separation_date', 'date', false)
) as m(source_column, target_field, transform_rule, is_required)
where o.slug = 'one-call-solution'
on conflict (organization_id, source_system, source_sheet_name, source_column)
do update set target_field = excluded.target_field,
              transform_rule = excluded.transform_rule,
              is_required = excluded.is_required,
              is_active = true,
              updated_at = now();

comment on table public.people_import_rows is 'Private staging rows from HR import files. Never expose to normal application users.';
comment on table public.people_private is 'Sensitive identity and contact data, separate from the general workforce directory.';
