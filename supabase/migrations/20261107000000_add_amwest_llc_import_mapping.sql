-- AMWEST LLC Rippling roster mapping.
-- The source workbook uses the `sheet` worksheet.

insert into public.import_column_mappings
  (organization_id, source_system, source_sheet_name, source_column, target_field, transform_rule, is_required)
select o.id, 'rippling', 'sheet', m.source_column, m.target_field, m.transform_rule, m.is_required
from public.organizations o
cross join (values
  ('Employee - ID', 'source_employee_id', null::text, true),
  ('Employee', 'display_name', 'trim', true),
  ('Department', 'department', 'trim', false),
  ('Work location', 'work_location', 'trim', false),
  ('Employment type', 'employment_type', 'trim', false),
  ('Start date', 'hire_date', 'date', false),
  ('Employment status', 'employment_status', 'trim', false)
) as m(source_column, target_field, transform_rule, is_required)
where o.slug = 'amwest-llc'
on conflict (organization_id, source_system, source_sheet_name, source_column)
do update set target_field = excluded.target_field,
              transform_rule = excluded.transform_rule,
              is_required = excluded.is_required,
              is_active = true,
              updated_at = now();
