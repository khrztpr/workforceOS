import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  if (duplicate) return json({ status: 'already_queued', import_run_id: duplicate.id, storage_path: duplicate.storage_path })

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
    status: 'uploaded',
    exported_at: payload.exported_at ?? null,
  }).select('id,status').single()
  if (importRunError) {
    await admin.storage.from(BUCKET).remove([storagePath])
    return json({ error: 'Could not create import run.' }, 500)
  }

  return json({ status: importRun.status, import_run_id: importRun.id, storage_path: storagePath }, 201)
})
