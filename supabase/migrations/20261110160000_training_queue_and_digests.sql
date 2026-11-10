-- Separate HR interview stages from the Training team's operational queue.

alter table public.people
  add column if not exists training_start_at timestamptz,
  add column if not exists training_notes text;

alter table public.people drop constraint if exists people_workflow_status_check;
alter table public.people add constraint people_workflow_status_check check (
  workflow_status in (
    'new', 'initial_interview', 'for_final_interview', 'endorsed_to_training',
    'training_scheduled', 'training_in_progress', 'passed', 'failed', 'terminated'
  )
);

alter table public.employee_workflow_history drop constraint if exists employee_workflow_history_next_status_check;
alter table public.employee_workflow_history add constraint employee_workflow_history_next_status_check check (
  next_status in (
    'new', 'initial_interview', 'for_final_interview', 'endorsed_to_training',
    'training_scheduled', 'training_in_progress', 'passed', 'failed', 'terminated'
  )
);

create table if not exists public.training_digest_log (
  id uuid primary key default gen_random_uuid(),
  digest_date date not null,
  recipient_group text not null,
  trainee_count integer not null,
  sent_at timestamptz not null default now(),
  unique (digest_date, recipient_group)
);

alter table public.training_digest_log enable row level security;
create policy "authorized staff read training digest log"
on public.training_digest_log for select to authenticated
using (public.can_view_directory());

create or replace function public.set_employee_workflow_status(
  target_person_id uuid,
  next_workflow_status text,
  workflow_note text default null
)
returns void language plpgsql security definer set search_path = public
as $$
declare previous_workflow_status text;
begin
  if not public.can_manage_employee_workflow() then raise exception 'Not authorized to manage employee workflow status'; end if;
  if next_workflow_status not in ('new', 'initial_interview', 'for_final_interview', 'endorsed_to_training', 'training_scheduled', 'training_in_progress', 'passed', 'failed', 'terminated') then raise exception 'Invalid workflow status'; end if;
  select workflow_status into previous_workflow_status from public.people where id = target_person_id for update;
  if previous_workflow_status is null then raise exception 'Employee profile not found'; end if;
  update public.people set workflow_status = next_workflow_status, workflow_updated_at = now(), updated_at = now() where id = target_person_id;
  insert into public.employee_workflow_history (person_id, previous_status, next_status, note, changed_by) values (target_person_id, previous_workflow_status, next_workflow_status, nullif(trim(workflow_note), ''), auth.uid());
end;
$$;
