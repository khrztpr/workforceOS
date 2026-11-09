-- Server-enforced access for sensitive workforce import review.
create table if not exists public.workforce_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.workforce_admins enable row level security;

create or replace function public.is_workforce_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workforce_admins where user_id = auth.uid()
  );
$$;

revoke all on function public.is_workforce_admin() from public;
grant execute on function public.is_workforce_admin() to authenticated;

-- The browser never receives raw imports or personnel data. The review function
-- below uses the service role after it has checked this capability.
