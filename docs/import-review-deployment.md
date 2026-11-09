# Import review deployment

The SharePoint function only accepts and queues raw `.xlsx` files. Apply the
review migration and deploy `review-roster-import` before using the WorkforceOS
review screen. This function requires an authenticated Supabase user and checks
the server-side `workforce_admins` allow-list before it reads or changes HR data.

## Deploy

```powershell
supabase db push --project-ref kixcawrqzinkfqfktiop
supabase functions deploy review-roster-import --project-ref kixcawrqzinkfqfktiop
```

## Grant the first reviewer

In Supabase Dashboard, open **SQL Editor** and run this once, replacing the
email address with the account that should be permitted to validate and approve
imports:

```sql
insert into public.workforce_admins (user_id)
select id from auth.users where email = 'your-admin-email@example.com'
on conflict (user_id) do nothing;
```

Do not grant browser access to `people`, `people_private`, `people_import_rows`,
or the raw storage bucket. The Edge Function is the authorization boundary.

## Workflow

1. Power Automate sends the `.xlsx` file to `sharepoint-roster-ingest`.
2. In WorkforceOS, select **Employee Management** then **Review imports**.
3. Select **Validate** to stage rows and see counts only.
4. Investigate rows with validation issues in the secured Supabase tables.
5. Select **Approve** to upsert valid rows into `people`.
