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
`valuation_items`, `schedule_periods`, `daily_logs`, `daily_log_items`, `photos`,
`contract_obligations`, `inspections`, `defects` — all with RLS — plus the
`create_project` / `delete_project` RPCs.

It also creates the private **`photos`** Storage bucket and its object-level RLS policies (a
member of a project can read/write only files under that project's folder). Photo files are
uploaded to the bucket; the `photos` table holds their metadata and links to the daily log /
work item. Object path convention: `<project_id>/<daily_log_id>/<photo_id>.jpg`.

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

## 5. Whiteboard OCR Edge Function (AI autofill)

The `read-whiteboard` Edge Function ([`functions/read-whiteboard/index.ts`](./functions/read-whiteboard/index.ts))
takes a site-board photo and returns structured daily-log fields via an OpenAI vision model
(`gpt-4o`). The OpenAI API key lives **only** in the function's secrets — it never reaches the
browser.

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase`), then:

```bash
supabase login
supabase link --project-ref <your-project-ref>   # ref is in your Project URL
supabase secrets set OPENAI_API_KEY=sk-...        # your OpenAI key
supabase functions deploy read-whiteboard
```

`verify_jwt` stays on (the default), so only signed-in users can invoke it — the frontend attaches
the user's JWT automatically via `supabase.functions.invoke('read-whiteboard', …)`.

The `parse-contract` function ([`functions/parse-contract/index.ts`](./functions/parse-contract/index.ts))
reads an uploaded contract (PDF / scanned PDF / image) and returns the structured time-based
obligation list for the **contract deadlines** page. It reuses the same `OPENAI_API_KEY` secret:

```bash
supabase functions deploy parse-contract
```

(Word/Excel contracts: export to PDF first for v1.)
