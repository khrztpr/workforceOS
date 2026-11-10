import * as XLSX from 'xlsx'

export type RosterPerson = {
  employee_id: string
  display_name: string
  first_name: string | null
  last_name: string | null
  department: string | null
  job_title: string | null
  employment_status: string | null
  employment_type: string | null
  work_location: string | null
  work_state: string | null
  hire_date: string | null
  active: boolean
}

const asText = (value: unknown) => String(value ?? '').trim()
const asOptionalText = (value: unknown) => asText(value) || null

function sourceField(row: Record<string, unknown>, ...headers: string[]) {
  const key = Object.keys(row).find((candidate) => headers.some((header) => candidate.trim().toLowerCase() === header.toLowerCase()))
  return key ? row[key] : undefined
}

function asDate(value: unknown) {
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value)
    return date ? `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}` : null
  }
  const valueText = asText(value)
  if (!valueText) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(valueText)) return valueText
  const match = valueText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : null
}

export async function readRoster(file: File): Promise<{ rows: RosterPerson[]; skipped: number }> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
  const worksheet = workbook.Sheets[workbook.SheetNames[0]]
  const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '', raw: true })
  const rows: RosterPerson[] = []
  let skipped = 0

  for (const row of sourceRows) {
    const employeeId = asText(sourceField(row, 'Employee - ID', 'Employee ID'))
    const firstName = asOptionalText(sourceField(row, 'First Name'))
    const lastName = asOptionalText(sourceField(row, 'Last Name'))
    const displayName = asText(sourceField(row, 'Employee', 'FULL NAME')) || [firstName, asOptionalText(sourceField(row, 'Middle Name')), lastName].filter(Boolean).join(' ')
    if (!employeeId || !displayName) { skipped += 1; continue }
    const status = asOptionalText(sourceField(row, 'Employment status', 'Employee Status'))
    rows.push({
      employee_id: employeeId,
      display_name: displayName,
      first_name: firstName,
      last_name: lastName,
      department: asOptionalText(sourceField(row, 'Department')),
      job_title: asOptionalText(sourceField(row, 'Position')),
      employment_status: status,
      employment_type: asOptionalText(sourceField(row, 'Employment type name', 'Employment type')),
      work_location: asOptionalText(sourceField(row, 'Work location name', 'Work location', 'Location')),
      work_state: asOptionalText(sourceField(row, 'Work in state(s)')),
      hire_date: asDate(sourceField(row, 'Start date as employee (non-contractor)', 'Start date', 'Hire Date')),
      active: !/terminated|separated|inactive|offboard/i.test(status ?? ''),
    })
  }

  return { rows, skipped }
}
