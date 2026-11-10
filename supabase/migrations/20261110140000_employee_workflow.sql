-- HR and Training workflow: separate from employment status and fully auditable.

alter table public.people
  add column if not exists workflow_status text not null default 'new',
  add column if not exists workflow_updated_at timestamptz not null default now();

alter table public.people drop constraint if exists people_workflow_status_check;
alter table public.people add constraint people_workflow_status_check
  check (workflow_status in ('new', 'in_review', 'endorsed', 'passed', 'failed', 'terminated'));

create table if not exists public.employee_workflow_history (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  previous_status text,
  next_status text not null check (next_status in ('new', 'in_review', 'endorsed', 'passed', 'failed', 'terminated')),
  note text,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);

create or replace function public.can_manage_employee_workflow()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.user_roles
  where user_id = auth.uid()
    and role in ('super_admin', 'admin', 'hr', 'training')
) $$;

create or replace function public.set_employee_workflow_status(
  target_person_id uuid,
  next_workflow_status text,
  workflow_note text default null
)
returns void language plpgsql security definer set search_path = public
as $$
declare previous_workflow_status text;
begin
  if not public.can_manage_employee_workflow() then
    raise exception 'Not authorized to manage employee workflow status';
  end if;
  if next_workflow_status not in ('new', 'in_review', 'endorsed', 'passed', 'failed', 'terminated') then
    raise exception 'Invalid workflow status';
  end if;

  select workflow_status into previous_workflow_status
  from public.people where id = target_person_id for update;
  if previous_workflow_status is null then
    raise exception 'Employee profile not found';
  end if;

  update public.people
  set workflow_status = next_workflow_status,
      workflow_updated_at = now(),
      updated_at = now()
  where id = target_person_id;

  insert into public.employee_workflow_history (person_id, previous_status, next_status, note, changed_by)
  values (target_person_id, previous_workflow_status, next_workflow_status, nullif(trim(workflow_note), ''), auth.uid());
end;
$$;

grant execute on function public.can_manage_employee_workflow() to authenticated;
grant execute on function public.set_employee_workflow_status(uuid, text, text) to authenticated;

alter table public.employee_workflow_history enable row level security;

create policy "authorized staff read employee workflow history"
on public.employee_workflow_history for select to authenticated
using (public.can_view_directory());
