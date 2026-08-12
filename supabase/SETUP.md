# Backend setup (Supabase)

> **文件狀態：ACTIVE RUNBOOK。** 指令與本 repo migration 鏈同步；正式環境操作仍需明確授權。

The app talks to a Supabase project (Postgres + Auth) over the public **publishable** key.
Access control is enforced by Row Level Security, RPCs and guard triggers. The database source of
truth is [`migrations/`](./migrations); [`schema.sql`](./schema.sql) is frozen historical reference.

## 1. Create the project

[supabase.com](https://supabase.com) → **New project** (free tier is fine). Pick a region close to
your users (Tokyo / Singapore for Taiwan).

## 2. Apply the schema

> ⚠ **2026-07 起單一真相來源是 [`migrations/`](./migrations)**;`schema.sql` 已凍結為
> 歷史參考,不要再用它初始化或同步。

```bash
supabase link --project-ref <你的 project ref>
supabase db push          # 依序套用 migrations/(baseline + 後續全部)
```

本地開發:`colima start && supabase start`(空庫會自動由 migrations 重建),
pgTAP 測試見 [`tests/`](./tests)。Storage bucket(`photos`、`contract-documents`)
與其物件 policies 都由 migration 建立,不需手動設定。

The full migration chain currently creates 50 tables across project identity, BOQ and finance,
documents and Requirements, quality and safety, collaboration, acceptance, audit, Agent drafts,
and AI operations. Do not maintain a duplicate table list here; inspect the migrations or
[`../CURRENT.md`](../CURRENT.md) for the current domain map.

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

## 5. Edge Functions and server secrets

There are currently 16 Edge Functions. Their feature metadata is mirrored in
[`../src/lib/aiFeatures.js`](../src/lib/aiFeatures.js) and
[`functions/_shared/aiFeatures.ts`](./functions/_shared/aiFeatures.ts); runtime availability is
decided by the database `ai_features` table through the server-side AI gate.

Claude-backed functions share [`functions/_shared/claude.ts`](./functions/_shared/claude.ts):
Haiku handles vision and short drafts, Sonnet handles long-document extraction and Agent runs,
and Opus handles high-judgment review scenarios. Forced tool use provides structured output.
The Anthropic key lives only in server secrets and never reaches the browser.

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase`), then:

```bash
supabase login
supabase link --project-ref <your-project-ref>   # ref is in your Project URL
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... # console.anthropic.com → API Keys
supabase secrets set CWA_API_KEY=...              # 中央氣象署，fetch-weather 使用
supabase functions deploy <function-name> --use-api
```

Functions called by users keep JWT verification enabled. `send-reminders` is the deliberate
exception: it is invoked by cron and authenticates with `x-cron-secret`.

## 6. Daily reminder emails (提醒推播)

The `send-reminders` Edge Function ([`functions/send-reminders/index.ts`](./functions/send-reminders/index.ts))
scans every project for **overdue / due-within-7-days** items (contract obligations, quality
defects, safety deficiencies, unbilled/unpaid valuations — the same rules as the in-app alert
center) and emails a digest to all project members via [Resend](https://resend.com).
It only sends when something is overdue or due soon; plain "待處理" items don't trigger mail.

```bash
supabase secrets set RESEND_API_KEY=re_...       # resend.com → API Keys (free tier ok)
supabase secrets set CRON_SECRET=$(openssl rand -hex 24)   # keep the value for cron.sql
supabase secrets set REMINDER_FROM='GovAgent 提醒 <alerts@gov-agent.ai>'  # requires a
                                                  # verified domain on Resend. Default uses
                                                  # onboarding@resend.dev (test only: it can
                                                  # deliver ONLY to your own Resend account email)
supabase functions deploy send-reminders --no-verify-jwt --use-api  # auth = x-cron-secret header instead
```

Schedule it daily at 08:00 Taipei with **pg_cron**: open [`cron.sql`](./cron.sql), replace
`<PROJECT_REF>` and `<CRON_SECRET>`, run it in the SQL Editor.

Test without sending anything (dry run — returns the digest as JSON):

```bash
curl -s -X POST "https://<ref>.supabase.co/functions/v1/send-reminders?dry=1" \
  -H "x-cron-secret: <CRON_SECRET>"
```

## 7. 正式環境 pre-flight

送正式站給外部使用者前，跑過這張清單。Supabase Auth、SMTP、Resend 與 DNS 都是外部
設定，不能只靠 repository 內的程式碼驗證。

### 7.1　讓廠商能自己註冊登入（**必做**）

註冊流程有兩種走法，pilot 建議選 A：

- **A（建議，最省事）— 關掉信箱驗證，即時登入。**
  *Authentication → Sign In / Providers → Email → 關閉 **Confirm email***。
  廠商填完註冊表 → 立刻有 session 直接進 App，全程不碰 email。
- **B — 保留信箱驗證（較安全，但要能寄信）。** Supabase 內建寄信有速率限制
  （約每小時數封）且常進垃圾桶，正式用要接自訂 SMTP：
  *Authentication → Emails → SMTP Settings*（可用 Resend / SendGrid）。
  App 端已帶 `emailRedirectTo` 把驗證連結導回本站，登入頁的「驗證信已寄出」畫面也有
  **重寄驗證信** 按鈕。

不論 A / B，都要把 App 網址加進白名單，否則導回會被擋：
*Authentication → URL Configuration* → **Site URL** 填 `https://gov-agent.ai`，
**Redirect URLs** 加入 `https://gov-agent.ai/**`（本機測試另加 `http://localhost:5173/**`）。

### 7.2　提醒信要真的寄到廠商（可等，但要知道）

預設寄件者 `onboarding@resend.dev` **只能寄到你自己 Resend 帳號的信箱**，寄給廠商不會到。
要讓每日提醒真的寄到外部信箱：先在 Resend 驗證 `gov-agent.ai` 的寄件網域，再設定
`REMINDER_FROM` 並重新部署 `send-reminders`。未驗證前只能用 Resend 測試寄件者寄到帳號本人。

### 7.3　伺服器端 RBAC

角色權限已從 UI 層下沉到資料庫層。新環境必須用 `supabase db push` 依序套用完整
`migrations/`，不可重跑已凍結的 `schema.sql`：

- **RLS 層**：機關(owner)對日常填報唯讀（寫入被 `can_write()` 擋）；
  成本管理 `cost_items` 連「讀」都限廠商成員/admin（毛利機密）；
  `delete_project` 收緊為建立者/admin 限定。
- **Trigger 層**（狀態轉移防護）：估驗核定、查驗判定、缺失結案、送審審定＝監造限定；
  變更設計核准/駁回＝機關/監造；機關在估驗只能寫請款/撥款三欄；
  **已核定估驗與已核准變更的明細凍結**；加入他人專案後不可自改 org_type（防提權）。
- 非正式模式下，專案 admin 可以跨角色操作，方便單人試用；開啟 `formal_mode` 後會關閉跨角色 override，admin 只保留成員、設定、刪案等專案管理權限；
  service role / SQL Editor（`auth.uid()` 為 null）不受 trigger 限制。

已在線上 DB 以 18 項權限矩陣測試驗證（模擬三方角色 JWT，測完 rollback）。

### 7.4　發之前快速驗一次

1. 開無痕視窗 → `https://gov-agent.ai` → 用一個測試 email 註冊（org 選施工廠商）
   → 確認能進 Dashboard。
2. 你的帳號在 **專案成員** 頁用該測試 email 加進一個案 → 換回測試帳號 → 確認看得到那個案、
   且**看不到**別的案。
3. `/boq` 上傳一份 PCCES XML → 工項樹進得來。
4. `send-reminders?dry=1`（上面的 curl）→ 回傳 JSON 不報錯。
