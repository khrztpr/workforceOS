# Clean WorkforceOS setup

1. Apply the migration with `supabase db push --linked`.
2. Create a new user from the website sign-up screen and verify its email if your Auth settings require it.
3. In Supabase SQL Editor, grant the first user administrator access:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'your-email@example.com';
```

Only administrators can view or change the directory. The app uses no SharePoint, Power Automate, storage bucket, or Edge Function.
