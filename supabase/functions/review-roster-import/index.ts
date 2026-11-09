import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'npm:xlsx@0.18.5'

const corsHeaders = {
  'access-control-allow-origin': 'https://workforceos-six.vercel.app',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' } })
type Payload = { action?: 'list' | 'validate' | 'approve'; import_run_id?: string; organization_slug?: string }

const asText = (value: unknown) => value == null ? null : String(value).trim() || null

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('authorization')
  if (!url || !anonKey || !serviceRoleKey || !authorization) return json({ error: 'Unauthorized.' }, 401)

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData } = await userClient.auth.getUser()
  if (!userData.user) return json({ error: 'Unauthorized.' }, 401)
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: administrator, error: administratorError } = await admin.from('workforce_admins').select('user_id').eq('user_id', userData.user.id).maybeSingle()
  if (administratorError) return json({ error: 'Could not verify administrator access.' }, 500)
  if (!administrator) return json({ error: 'Administrator access is required.' }, 403)

  let payload: Payload
  try { payload = await request.json() } catch { return json({ error: 'Request body must be JSON.' }, 400) }

  if (payload.action === 'list') {
    const query = admin.from('import_runs').select('id,status,source_file_name,uploaded_at,total_rows,valid_rows,invalid_rows,organizations!inner(slug,name)').order('uploaded_at', { ascending: false }).limit(25)
    if (payload.organization_slug) query.eq('organizations.slug', payload.organization_slug)
    const { data, error } = await query
    if (error) return json({ error: 'Could not load import runs.' }, 500)
    return json({ runs: data ?? [] })
  }

  if (!payload.import_run_id || !['validate', 'approve'].includes(payload.action ?? '')) return json({ error: 'Choose an import run and action.' }, 400)
  const { data: run, error: runError } = await admin.from('import_runs').select('id,organization_id,source_system,source_sheet_name,storage_bucket,storage_path,status').eq('id', payload.import_run_id).maybeSingle()
  if (runError || !run) return json({ error: 'Import run was not found.' }, 404)

  if (payload.action === 'validate') {
    if (!['uploaded', 'needs_review', 'failed'].includes(run.status)) return json({ error: 'This import cannot be validated in its current state.' }, 409)
    const { data: file, error: fileError } = await admin.storage.from(run.storage_bucket).download(run.storage_path)
    if (fileError || !file) return json({ error: 'Could not read the private import file.' }, 500)
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
    const sheetName = run.source_sheet_name && workbook.SheetNames.includes(run.source_sheet_name) ? run.source_sheet_name : workbook.SheetNames[0]
    if (!sheetName) return json({ error: 'The workbook contains no sheets.' }, 400)
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: null })
    const { data: mappings, error: mappingError } = await admin.from('import_column_mappings').select('source_column,target_field,is_required,transform_rule').eq('organization_id', run.organization_id).eq('source_system', run.source_system).eq('source_sheet_name', sheetName).eq('is_active', true)
    if (mappingError || !mappings?.length) return json({ error: 'No active mapping exists for this worksheet.' }, 422)

    const expected = new Map(mappings.map((mapping) => [mapping.source_column, mapping]))
    const missingColumns = [...expected.keys()].filter((column) => !rows.some((row) => Object.hasOwn(row, column)))
    const staged = rows.map((row, index) => {
      const normalized: Record<string, unknown> = {}
      const errors: string[] = missingColumns.map((column) => `Missing column: ${column}`)
      for (const mapping of mappings) {
        let value = row[mapping.source_column]
        if (typeof value === 'string' && mapping.transform_rule === 'trim') value = value.trim()
        if (typeof value === 'string' && mapping.transform_rule === 'lowercase_trim') value = value.trim().toLowerCase()
        if (value instanceof Date && mapping.transform_rule === 'date') value = value.toISOString().slice(0, 10)
        normalized[mapping.target_field] = value
        if (mapping.is_required && !asText(value)) errors.push(`${mapping.source_column} is required`)
      }
      return { import_run_id: run.id, row_number: index + 2, row_status: errors.length ? 'invalid' : 'valid', source_employee_id: asText(normalized.source_employee_id), raw_data: row, normalized_data: normalized, validation_errors: errors }
    })
    await admin.from('people_import_rows').delete().eq('import_run_id', run.id)
    if (staged.length) {
      const { error } = await admin.from('people_import_rows').insert(staged)
      if (error) return json({ error: 'Could not save validation results.' }, 500)
    }
    const validRows = staged.filter((row) => row.row_status === 'valid').length
    const { error: updateError } = await admin.from('import_runs').update({ status: 'needs_review', total_rows: staged.length, valid_rows: validRows, invalid_rows: staged.length - validRows, error_summary: missingColumns.map((column) => ({ message: `Missing column: ${column}` })), processed_at: new Date().toISOString() }).eq('id', run.id)
    if (updateError) return json({ error: 'Could not update import status.' }, 500)
    return json({ status: 'needs_review', total_rows: staged.length, valid_rows: validRows, invalid_rows: staged.length - validRows })
  }

  if (run.status !== 'needs_review') return json({ error: 'Validate this import before approving it.' }, 409)
  const { data: validRows, error: rowsError } = await admin.from('people_import_rows').select('normalized_data').eq('import_run_id', run.id).eq('row_status', 'valid')
  if (rowsError || !validRows?.length) return json({ error: 'This import has no valid rows to approve.' }, 422)
  const people = validRows.map(({ normalized_data: row }) => ({ organization_id: run.organization_id, source_system: run.source_system, source_employee_id: asText(row.source_employee_id), display_name: asText(row.display_name), employment_status: asText(row.employment_status), employment_type: asText(row.employment_type), department: asText(row.department), job_title: asText(row.job_title), manager_source_employee_id: asText(row.manager_source_employee_id), work_location: asText(row.work_location), work_state: asText(row.work_state), hire_date: asText(row.hire_date), regularization_date: asText(row.regularization_date), separation_date: asText(row.separation_date), last_work_date: asText(row.last_work_date), is_manager: row.is_manager === true || row.is_manager === 'true', source_last_seen_at: new Date().toISOString(), active: true, latest_import_run_id: run.id })).filter((row) => row.source_employee_id && row.display_name)
  const { error: peopleError } = await admin.from('people').upsert(people, { onConflict: 'organization_id,source_system,source_employee_id' })
  if (peopleError) return json({ error: 'Could not approve this import.' }, 500)
  await admin.from('people_import_rows').update({ row_status: 'imported' }).eq('import_run_id', run.id).eq('row_status', 'valid')
  await admin.from('import_runs').update({ status: 'imported', processed_at: new Date().toISOString() }).eq('id', run.id)
  return json({ status: 'imported', imported_rows: people.length })
})
