-- Organization boundaries for the three approved roster sources.
-- Keep people in one table; organization_id controls roster separation and access scope.

insert into public.organizations (name, slug) values
  ('America West Transportation Inc', 'america-west-inc'),
  ('America West Transportation LLC', 'america-west-llc'),
  ('One Call Solution', 'one-call-solution')
on conflict (slug) do nothing;
