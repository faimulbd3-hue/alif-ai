# Supabase setup

1. Create a Supabase project and open **SQL Editor**.
2. Run [`supabase-schema.sql`](./supabase-schema.sql).
3. Copy these values into the server `.env` file:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-publishable-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_STORAGE_BUCKET=alif-files
```

`SUPABASE_SERVICE_ROLE_KEY` is a server secret. Never put it in `public/`, commit it, or send it in chat.

For testing, email confirmation can be disabled in Supabase **Authentication → Providers → Email**. In production, keep confirmation enabled and configure an SMTP provider.

After restarting the Express server, sign-up/sign-in, cloud chat history, and private file storage use Supabase. Without these variables, the app keeps its local demo/file behavior but secure authentication is unavailable.
