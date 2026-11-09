# SharePoint roster ingestion

This is the production path for Rippling exports. The browser Import Center remains available as a super-admin fallback, but daily imports should come from Power Automate.

## Supabase setup

1. Deploy `sharepoint-roster-ingest` with JWT verification disabled. The committed `supabase/config.toml` declares this setting.
2. In Supabase Dashboard, add an Edge Function secret named `POWER_AUTOMATE_INGEST_SECRET`. Generate a long random value and do not add it to Git, Vercel, or browser variables.
3. Add the same secret as a sensitive value in each Power Automate flow.

The function validates the secret itself, accepts only `.xlsx` files for the three approved organization slugs, stores the source file privately, records an `uploaded` import run, and returns an existing run for a retry of identical file bytes.

## Power Automate HTTP action

After **Get file content**, add an HTTP action with:

| Field | Value |
| --- | --- |
| Method | `POST` |
| URI | `https://kixcawrqzinkfqfktiop.supabase.co/functions/v1/sharepoint-roster-ingest` |
| Header `Content-Type` | `application/json` |
| Header `x-workforce-ingest-secret` | Your secret stored in Power Automate |

Use this JSON body. Replace the organization slug per flow: `ocs`, `amwest-inc`, or `amwest-llc`.

```json
{
  "organization_slug": "ocs",
  "source_file_name": "@{triggerOutputs()?['body/{FilenameWithExtension}']}",
  "file_base64": "@{base64(body('Get_file_content'))}",
  "exported_at": "@{triggerOutputs()?['body/Created']}"
}
```

Do not put a Supabase service-role key in Power Automate. The Edge Function keeps that key server-side.

## Expected response

A new file returns HTTP `201` with `status: uploaded`. A retry of identical bytes returns HTTP `200` with `status: already_queued`; that behavior prevents duplicate runs when Power Automate retries.
