# People import mapping

Each organization has an independent mapping. A source file is validated against the selected organization and sheet before any staging rows are created. Do not append the two source files together.

## Shared destination fields

`people` holds the minimum workforce directory fields. `people_private` holds personal contact or identity fields. Every record carries its organization scope.

| Destination field | Purpose | Storage |
|---|---|---|
| `source_employee_id` | Stable source identifier; required per organization | `people` |
| `display_name` | Workforce directory name; required | `people` |
| `employment_status` | Current source status | `people` |
| `department` | Source department | `people` |
| `work_location` | Source work location | `people` |
| `job_title` | Source role/title | `people` |
| `hire_date` | First employee hire date | `people` |
| `separation_date` / `last_work_date` | Source offboarding date where supplied | `people` |
| `personal_email` | Sensitive contact value | `people_private` |
| `first_name`, `middle_name`, `last_name` | Sensitive identity fields | `people_private` |
| `birth_date`, `gender` | Sensitive identity fields; do not use for analytics by default | `people_private` |

## One Call Solution

Source workbook sheet: `ROSTER`.

| Source header | Destination field | Transform | Import rule |
|---|---|---|---|
| `Employee ID` | `source_employee_id` | Preserve as text | Required |
| `FULL NAME` | `display_name` | Trim | Required |
| `First Name` | `first_name` | Trim | Private |
| `Middle Name` | `middle_name` | Trim | Private |
| `Last Name` | `last_name` | Trim | Private |
| `Department` | `department` | Trim | Optional |
| `Location` | `work_location` | Trim | Optional |
| `Immediate Supervisor` | `manager_name` | Trim; review before relationship matching | Optional |
| `Position` | `job_title` | Trim | Optional |
| `Employee Status` | `employment_status` | Trim | Optional |
| `Hire Date` | `hire_date` | Parse date | Optional |
| `Regularization Date` | `regularization_date` | Parse date | Optional |
| `Separation Date` | `separation_date` | Parse date | Optional |

Excluded for now: `Gender`, `Birthday`, duplicate `x` columns, calculated duplicate-name columns, `Hire Month`, `Hire Year`, `OFFBOARDED`, and the workbook's Pivot Table/Offboarding sheets. They remain in the raw private file and are not copied into the directory without an explicit feature need.

## AMWEST Inc

Source workbook sheet: `sheet`.

| Source header | Destination field | Transform | Import rule |
|---|---|---|---|
| `Employee - ID` | `source_employee_id` | Preserve as text | Required |
| `Employee` | `display_name` | Trim | Required |
| `Manager - ID` | `manager_source_employee_id` | Preserve as text | Optional |
| `Personal email` | `personal_email` | Lowercase and trim | Private |
| `Start date as employee (non-contractor)` | `hire_date` | Parse date | Optional |
| `Employment type name` | `employment_type` | Trim | Optional |
| `Employment status` | `employment_status` | Trim | Optional |
| `Department` | `department` | Trim | Optional |
| `Work location name` | `work_location` | Trim | Optional |
| `Last work date` | `last_work_date` | Parse date | Optional |
| `Is a manager` | `is_manager` | Parse boolean | Optional |
| `Work in state(s)` | `work_state` | Trim | Optional |

Excluded for now: Rippling profile number, offer acceptance fields, and policy effective date. These remain available in the encrypted raw source object but are not part of the first directory import.

## AMWEST LLC

No LLC roster source is configured yet. It must have its own organization record, storage path, and mapping before any file can be imported. It must not reuse or append the AMWEST Inc mapping.

## Import controls

1. The importer receives an organization ID and one storage object.
2. It requires the expected sheet and both required headers for that organization.
3. It stages the original row as private JSON, records validation errors, and does not update `people` until an authorized reviewer approves the run.
4. Upsert identity is `(organization_id, source_system, source_employee_id)`.
5. Browser users never receive raw files, staging rows, or `people_private` data.
