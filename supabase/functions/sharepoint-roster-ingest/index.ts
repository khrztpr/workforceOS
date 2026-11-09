import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'npm:xlsx@0.18.5'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const BUCKET = 'hr-raw-imports'
const validOrganizations = new Set(['ocs', 'amwest-inc', 'amwest-llc'])

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
})

const safeEquals = (received: string, expected: string) => {
  const receivedBytes = new TextEncoder().encode(received)
  const expectedBytes = new TextEncoder().encode(expected)
  const length = Math.max(receivedBytes.length, expectedBytes.length)
  let difference = receivedBytes.length ^ expectedBytes.length
  for (let index = 0; index < length; index += 1) difference |= (receivedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0)
  return difference === 0
}

const fromBase64 = (encoded: string) => {
  const normalized = encoded.includes(',') ? encoded.slice(encoded.indexOf(',') + 1) : encoded
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const sha256 = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const asText = (value: unknown) => value == null ? null : String(value).trim() || null
const normalizeDate = (value: unknown): string | null | undefined => {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10)
  const text = String(value).trim()
  if (['not yet set', 'n/a', 'na', 'none', 'not applicable', '-'].includes(text.toLowerCase())) return null
  const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (parts) return `${parts[3]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
  return undefined
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const expectedSecret = Deno.env.get('POWER_AUTOMATE_INGEST_SECRET')
  const receivedSecret = request.headers.get('x-workforce-ingest-secret') ?? ''
  if (!expectedSecret || !safeEquals(receivedSecret, expectedSecret)) return json({ error: 'Unauthorized.' }, 401)

  let payload: { organization_slug?: string; source_file_name?: string; file_base64?: string; exported_at?: string }
  try { payload = await request.json() } catch { return json({ error: 'Request body must be JSON.' }, 400) }

  const organizationSlug = payload.organization_slug?.trim().toLowerCase()
  const sourceFileName = payload.source_file_name?.trim()
  if (!organizationSlug || !validOrganizations.has(organizationSlug)) return json({ error: 'Unknown organization.' }, 400)
  if (!sourceFileName?.toLowerCase().endsWith('.xlsx')) return json({ error: 'Only .xlsx roster exports are accepted.' }, 400)
  if (!payload.file_base64) return json({ error: 'Missing file content.' }, 400)

  let bytes: Uint8Array
  try { bytes = fromBase64(payload.file_base64) } catch { return json({ error: 'File content is not valid base64.' }, 400) }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) return json({ error: 'File must be between 1 byte and 20 MB.' }, 413)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) return json({ error: 'Function is missing server configuration.' }, 500)
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: organization, error: organizationError } = await admin.from('organizations').select('id').eq('slug', organizationSlug).maybeSingle()
  if (organizationError || !organization) return json({ error: 'Organization configuration is unavailable.' }, 500)

  const checksum = await sha256(bytes)
  const { data: duplicate, error: duplicateError } = await admin
    .from('import_runs')
    .select('id,status,storage_path')
    .eq('organization_id', organization.id)
    .eq('source_checksum', checksum)
    .limit(1)
    .maybeSingle()
  if (duplicateError) return json({ error: 'Could not check prior imports.' }, 500)
  if (duplicate) return json({ status: duplicate.status === 'imported' ? 'already_imported' : 'already_queued', import_run_id: duplicate.id, storage_path: duplicate.storage_path })

  const now = new Date()
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('Z', '')
  const storagePath = `${organizationSlug}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${organizationSlug}_people_${timestamp}_${checksum.slice(0, 12)}.xlsx`
  const { error: storageError } = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: false,
  })
  if (storageError) return json({ error: 'Could not store roster file.' }, 500)

  const { data: importRun, error: importRunError } = await admin.from('import_runs').insert({
    organization_id: organization.id,
    source_system: 'rippling',
    source_file_name: sourceFileName,
    source_sheet_name: organizationSlug === 'ocs' ? 'ROSTER' : 'sheet',
    storage_bucket: BUCKET,
    storage_path: storagePath,
    source_checksum: checksum,
    status: 'validating',
    exported_at: payload.exported_at ?? null,
  }).select('id,status').single()
  if (importRunError) {
    await admin.storage.from(BUCKET).remove([storagePath])
    return json({ error: 'Could not create import run.' }, 500)
  }

  const fail = async (message: string, status = 422) => {
    await admin.from('import_runs').update({ status: 'failed', error_summary: [{ message }], processed_at: new Date().toISOString() }).eq('id', importRun.id)
    return json({ error: message, import_run_id: importRun.id }, status)
  }
  let workbook: XLSX.WorkBook
  try { workbook = XLSX.read(bytes, { type: 'array', cellDates: true }) } catch { return fail('The uploaded file could not be read as an Excel workbook.') }
  const expectedSheet = organizationSlug === 'ocs' ? 'ROSTER' : 'sheet'
  const sheetName = workbook.SheetNames.includes(expectedSheet) ? expectedSheet : undefined
  if (!sheetName) return fail(`The workbook must contain the ${expectedSheet} worksheet.`)
  const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: null })
  const { data: mappings, error: mappingError } = await admin.from('import_column_mappings').select('source_column,target_field,is_required,transform_rule').eq('organization_id', organization.id).eq('source_system', 'rippling').eq('source_sheet_name', sheetName).eq('is_active', true)
  if (mappingError || !mappings?.length) return fail('No active column mapping exists for this organization and worksheet.', 500)
  const missingColumns = mappings.filter((mapping) => !sourceRows.some((row) => Object.hasOwn(row, mapping.source_column))).map((mapping) => mapping.source_column)
  const staged = sourceRows.map((row, index) => {
    const normalized: Record<string, unknown> = {}
    const errors = missingColumns.map((column) => `Missing column: ${column}`)
    for (const mapping of mappings) {
      let value = row[mapping.source_column]
      if (typeof value === 'string' && mapping.transform_rule === 'trim') value = value.trim()
      if (typeof value === 'string' && mapping.transform_rule === 'lowercase_trim') value = value.trim().toLowerCase()
      if (mapping.transform_rule === 'date') {
        const date = normalizeDate(value)
        if (date === undefined) errors.push(`${mapping.source_column} must be a valid date`)
        else value = date
      }
      normalized[mapping.target_field] = value
      if (mapping.is_required && !asText(value)) errors.push(`${mapping.source_column} is required`)
    }
    return { import_run_id: importRun.id, row_number: index + 2, row_status: errors.length ? 'invalid' : 'valid', source_employee_id: asText(normalized.source_employee_id), raw_data: row, normalized_data: normalized, validation_errors: errors }
  })
  if (staged.length) {
    const { error: stagedError } = await admin.from('people_import_rows').insert(staged)
    if (stagedError) return fail('Could not save import validation results.', 500)
  }
  const invalidRows = staged.filter((row) => row.row_status === 'invalid').length
  if (invalidRows) {
    await admin.from('import_runs').update({ status: 'failed', total_rows: staged.length, valid_rows: staged.length - invalidRows, invalid_rows: invalidRows, error_summary: [{ message: 'The import contains invalid rows and no people were changed.' }], processed_at: new Date().toISOString() }).eq('id', importRun.id)
    return json({ error: 'The import contains invalid rows and no people were changed.', import_run_id: importRun.id, invalid_rows: invalidRows }, 422)
  }
  const nowIso = new Date().toISOString()
  const people = staged.map(({ normalized_data: row }) => ({ organization_id: organization.id, source_system: 'rippling', source_employee_id: asText(row.source_employee_id), display_name: asText(row.display_name), employment_status: asText(row.employment_status), employment_type: asText(row.employment_type), department: asText(row.department), job_title: asText(row.job_title), manager_source_employee_id: asText(row.manager_source_employee_id), work_location: asText(row.work_location), work_state: asText(row.work_state), hire_date: asText(row.hire_date), regularization_date: asText(row.regularization_date), separation_date: asText(row.separation_date), last_work_date: asText(row.last_work_date), is_manager: row.is_manager === true || row.is_manager === 'true', source_last_seen_at: nowIso, active: true, latest_import_run_id: importRun.id }))
  const { data: insertedPeople, error: peopleError } = await admin.from('people').upsert(people, { onConflict: 'organization_id,source_system,source_employee_id' }).select('id,source_employee_id')
  if (peopleError || !insertedPeople) return fail(`Could not update the people directory: ${peopleError?.message ?? 'unknown error'}`, 500)
  const ids = new Map(insertedPeople.map((person) => [person.source_employee_id, person.id]))
  const privateRows = staged.map(({ normalized_data: row }) => ({ person_id: ids.get(asText(row.source_employee_id) ?? ''), first_name: asText(row.first_name), middle_name: asText(row.middle_name), last_name: asText(row.last_name), personal_email: asText(row.personal_email), updated_at: nowIso })).filter((row) => row.person_id)
  if (privateRows.length) {
    const { error: privateError } = await admin.from('people_private').upsert(privateRows)
    if (privateError) return fail(`Could not update protected people details: ${privateError.message}`, 500)
  }
  await admin.from('people_import_rows').update({ row_status: 'imported' }).eq('import_run_id', importRun.id)
  await admin.from('import_runs').update({ status: 'imported', total_rows: staged.length, valid_rows: staged.length, invalid_rows: 0, processed_at: nowIso }).eq('id', importRun.id)
  return json({ status: 'imported', import_run_id: importRun.id, imported_rows: people.length, storage_path: storagePath }, 201)
})
