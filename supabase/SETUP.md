# Backend setup (Supabase)

The app talks to a Supabase project (Postgres + Auth) over the public **publishable** key.
All access control is enforced by Row Level Security — see [`schema.sql`](./schema.sql).

## 1. Create the project

[supabase.com](https://supabase.com) → **New project** (free tier is fine). Pick a region close to
your users (Tokyo / Singapore for Taiwan).

## 2. Apply the schema

**SQL Editor** → **New query** → paste all of [`schema.sql`](./schema.sql) → **Run**.
It's idempotent, so you can re-run it any time to re-sync tables, policies, functions and RPCs.

This creates: `profiles`, `projects`, `project_members`, `work_items`, `valuations`,
`valuation_items`, `schedule_periods`, `daily_logs`, `daily_log_items`, `inspections`, `defects`
— all with RLS — plus the `create_project` / `delete_project` RPCs.

## 3. Wire up the frontend

**Project Settings → API** → copy the **Project URL** and the **publishable** key
(`sb_publishable_…`, safe for the browser — never the `service_role`/secret key). Put them in `.env`:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
```

## 4. Auth

Email + password is enabled by default. For local development it's convenient to turn **off**
*Authentication → Sign In / Providers → Email → Confirm email* (instant sign-in). For a shared /
production deployment, turn it **on** and set *Authentication → URL Configuration → Site URL* to
your deployed URL so the verification link points back.
