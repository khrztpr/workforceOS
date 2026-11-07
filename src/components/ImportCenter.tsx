import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, FileSpreadsheet, LoaderCircle, ShieldCheck, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from './AuthProvider'
import { Button } from './ui/button'
import { supabase } from '../lib/supabase'

type Organization = { id: string; slug: string; name: string }
type ImportOption = Organization & {
  expectedSheet: string | null
  expectedFilename: string | null
  mappedFields: number
  enabled: boolean
}

const importConfiguration: Record<string, Omit<ImportOption, 'id' | 'slug' | 'name'>> = {
  ocs: { expectedSheet: 'ROSTER', expectedFilename: 'one-call-solution_people_*.xlsx', mappedFields: 13, enabled: true },
  'amwest-inc': { expectedSheet: 'sheet', expectedFilename: 'america-west-inc_people_*.xlsx', mappedFields: 12, enabled: true },
  'amwest-llc': { expectedSheet: 'sheet', expectedFilename: 'america-west-llc_people_*.xlsx', mappedFields: 7, enabled: true },
}

export function ImportCenter({ onBack }: { onBack: () => void }) {
  const { configured, session } = useAuth()
  const [organizations, setOrganizations] = useState<ImportOption[]>([])
  const [selectedSlug, setSelectedSlug] = useState('ocs')
  const [file, setFile] = useState<File | null>(null)
  const [loadingOrganizations, setLoadingOrganizations] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completedPath, setCompletedPath] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase || !session) { setLoadingOrganizations(false); return }
    let active = true
    void supabase.from('organizations').select('id,slug,name').order('name').then(({ data, error: queryError }) => {
      if (!active) return
      if (queryError) setError('Could not load the organization list. Confirm your signed-in account has administrator access.')
      else setOrganizations((data ?? []).filter((item) => item.slug in importConfiguration).map((item) => ({ ...item, ...importConfiguration[item.slug] })))
      setLoadingOrganizations(false)
    })
    return () => { active = false }
  }, [session])

  const selected = useMemo(() => organizations.find((organization) => organization.slug === selectedSlug) ?? null, [organizations, selectedSlug])

  const chooseFile = (nextFile: File | undefined) => {
    setError(null)
    setCompletedPath(null)
    if (!nextFile) { setFile(null); return }
    if (!nextFile.name.toLowerCase().endsWith('.xlsx')) { setFile(null); setError('Choose an Excel .xlsx roster export.'); return }
    if (nextFile.size > 25 * 1024 * 1024) { setFile(null); setError('This file is larger than the 25 MB Import Center limit.'); return }
    setFile(nextFile)
  }

  const upload = async () => {
    if (!supabase || !configured || !session) { setError('Sign in again before uploading a roster.'); return }
    if (!selected?.enabled) { setError('This organization does not have an approved import mapping yet.'); return }
    if (!file) { setError('Choose an Excel roster export first.'); return }
    setError(null)
    setCompletedPath(null)
    setUploading(true)
    const now = new Date()
    const stamp = now.toISOString().replace(/[:.]/g, '-').replace('Z', '')
    const path = `${selected.slug}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${selected.slug}_people_${stamp}.xlsx`
    const bucket = supabase.storage.from('hr-raw-imports')
    const { error: uploadError } = await bucket.upload(path, file, { upsert: false, contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    if (uploadError) { setUploading(false); setError(`Upload failed: ${uploadError.message}`); return }
    const { error: runError } = await supabase.from('import_runs').insert({
      organization_id: selected.id,
      source_system: 'rippling',
      source_file_name: file.name,
      source_sheet_name: selected.expectedSheet,
      storage_bucket: 'hr-raw-imports',
      storage_path: path,
      status: 'uploaded',
    })
    if (runError) {
      await bucket.remove([path])
      setUploading(false)
      setError(`The file was not queued: ${runError.message}`)
      return
    }
    setUploading(false)
    setCompletedPath(path)
    setFile(null)
    toast.success('Roster upload queued for review.')
  }

  return <div className="motion-enter">
    <button onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-sky-700 transition hover:text-sky-900"><ArrowLeft className="size-4" />Back to rosters</button>
    <div className="mt-5 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold text-sky-700">Employee management / Import Center</p><h1 className="mt-1 text-3xl font-black tracking-tight">Upload a roster for review</h1><p className="mt-2 max-w-2xl text-slate-600">The original export is stored privately and queued as an import run. Employee records are not created or changed at this step.</p></div><div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800"><ShieldCheck className="size-4" />Private raw storage</div></div>

    <div className="mt-8 grid gap-6 xl:grid-cols-[1.25fr_.75fr]"><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold">1. Choose the organization</h2><p className="mt-1 text-sm text-slate-500">Every upload remains scoped to exactly one company.</p><div className="mt-5 grid gap-3 sm:grid-cols-3">{loadingOrganizations ? <p className="col-span-full text-sm text-slate-500">Loading organizations…</p> : organizations.map((organization) => <button key={organization.slug} disabled={!organization.enabled} onClick={() => { setSelectedSlug(organization.slug); setFile(null); setError(null); setCompletedPath(null) }} className={`rounded-xl border p-4 text-left transition ${selectedSlug === organization.slug ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-100' : 'border-slate-200 hover:border-sky-300'} ${!organization.enabled ? 'cursor-not-allowed opacity-55' : ''}`}><p className="font-semibold text-slate-900">{organization.name}</p><p className="mt-2 text-xs text-slate-500">{organization.enabled ? `${organization.mappedFields} mapped fields` : 'Mapping required'}</p></button>)}</div>
      {selected && <div className="mt-6 rounded-xl bg-slate-50 p-5"><div className="flex items-start gap-3"><FileSpreadsheet className="mt-0.5 size-5 text-sky-700" /><div><p className="font-semibold">2. Upload the Rippling export</p><p className="mt-1 text-sm text-slate-600">Expected sheet: <span className="font-medium text-slate-900">{selected.expectedSheet ?? 'Not configured'}</span></p><p className="mt-1 text-sm text-slate-600">Expected name: <span className="font-mono text-xs text-slate-800">{selected.expectedFilename ?? 'Mapping must be configured first'}</span></p></div></div>
        <label className={`mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-5 py-8 text-center transition ${selected.enabled ? 'border-slate-300 bg-white hover:border-sky-400 hover:bg-sky-50/40' : 'cursor-not-allowed border-slate-200 bg-slate-100'}`}><UploadCloud className="size-7 text-sky-700" /><span className="mt-3 text-sm font-semibold">{file ? file.name : 'Choose .xlsx file'}</span><span className="mt-1 text-xs text-slate-500">Excel only · maximum 25 MB</span><input className="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!selected.enabled || uploading} onChange={(event) => chooseFile(event.target.files?.[0])} /></label>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-5 text-slate-500">Files are kept in private Supabase Storage. Row validation and approval happen in the next phase.</p><Button onClick={() => void upload()} disabled={!selected.enabled || !file || uploading}>{uploading ? <><LoaderCircle className="size-4 animate-spin" />Queueing upload…</> : <><UploadCloud className="size-4" />Upload and queue</>}</Button></div></div>}</section>
      <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="font-bold">What happens next</h2><ol className="mt-5 space-y-5 text-sm text-slate-600"><li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-sky-100 text-xs font-bold text-sky-800">1</span><span>The file is saved under the organization’s private storage path.</span></li><li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-sky-100 text-xs font-bold text-sky-800">2</span><span>An <strong className="text-slate-800">uploaded</strong> import run is recorded for review and auditability.</span></li><li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-sky-100 text-xs font-bold text-sky-800">3</span><span>A future validator will check columns and stage rows before anyone approves changes.</span></li></ol></aside></div>
    {error && <div role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-900">{error}</div>}
    {completedPath && <div className="mt-6 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" /><div><p className="font-bold">Import run created. No employee record changed.</p><p className="mt-1 text-emerald-800">Private storage path: <span className="font-mono text-xs">{completedPath}</span></p></div></div>}
  </div>
}
