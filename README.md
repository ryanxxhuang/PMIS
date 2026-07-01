# PMIS — Construction Project Management Information System

> A web PMIS for Taiwan public‑works **contractors**. It ingests the government **PCCES**
> bill of quantities and turns it into a live backbone for **cost, cash‑flow, schedule,
> quality and safety** — with AI that reads site whiteboards and parses contract deadlines,
> multi‑tenant, every project's data isolated by Postgres Row Level Security.

**▶ Live demo: https://ryanxxhuang.github.io/PMIS/**

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS%20%2B%20Edge-3FCF8E?logo=supabase&logoColor=white)
![OpenAI](https://img.shields.io/badge/AI-GPT--4o%20vision-412991?logo=openai&logoColor=white)

---

## What it does

Public construction in Taiwan runs on a standard procurement contract and a structured
**PCCES eTender** budget — the 標單 (bill of quantities). PMIS treats that bill of quantities
as the **spine**: import it once and estimating, cash‑flow, scheduling, quality and cost all
hang off the same work‑item tree, so quantities never get re‑keyed and the numbers always
reconcile.

### 總覽 · Overview
- 📊 **Dashboard** — contract value, billed‑to‑date, completion %, schedule status, open
  defects/inspections at a glance.
- 🔔 **Alert center (提醒中心)** — one place that surfaces everything due or overdue: contract
  deadlines, defect remediation, unfinished safety issues, and 已核定‑未請款 / 已請款‑未收款
  payments. Each row links to its source screen.
- 📅 **Contract control (契約管制)** — **AI parses the uploaded contract** into every time‑based
  obligation (start‑work‑within‑X‑days, monthly reports, submittals…), each with its trigger,
  computed due date, penalty and source clause. Due dates recompute live from a few anchor dates.

### 成本與進度 · Cost & schedule
- 📋 **Bill of quantities** — upload a PCCES budget XML; it is parsed **in the browser** into a
  3,000+ row work‑item tree (項次 / 數量 / 單價 / 複價) and stored per project.
- 📝 **Daily site logs** — record completed quantity per work item, per day, with site photos.
  📷 **Snap a whiteboard → AI fills the log**: the day's work items and quantities are read off
  the photo and matched back to the BOQ.
- 💰 **Progress valuations (估驗計價)** — quantity‑based monthly billing that **auto‑fills its
  cumulative quantities from the daily logs**, then computes retention and net payable.
- 🧾 **Billing & receipts (請款收款)** — per‑period 本期估驗 / 保留款 / 應領, invoice & payment
  tracking (待請款 / 已請款 / 已收款) and a cash‑flow summary.
- 🧮 **Cost & margin (成本管理)** — budget vs. actual cost by category (材料/人工/機具/分包/管理費),
  subcontracts as cost lines, and live **gross margin** = contract revenue − cost.
- 📈 **S‑curve** — planned vs. actual progress (actual derived live from valuations) with a
  behind‑schedule indicator.
- 🗓️ **Per‑item schedule (逐工項排程)** — set planned start/finish on key work items; status
  (未開始 / 進行中 / 落後 / 已完成) is derived from today vs. plan and the latest valuation's
  completed quantity.
- 🖨 **Valuation certificate** — print / export a formal payment document as PDF.

### 品質與工安 · Quality & safety
- 🔍 **Quality — three‑tier QC (三級品管)** — raise an inspection, record pass/fail; a failure
  **auto‑opens a linked defect** that moves 開立 → 改善中 → 待複查 → 已結案.
- 🦺 **Safety (工安管理)** — self‑checks, safety deficiencies (with a remediation flow),
  training and hazard‑notice records — public‑works required, exportable per type.

Every list — cost, payments, defects, daily logs, safety, schedule — **exports to CSV**
(UTF‑8 BOM, so Excel renders Chinese correctly). The whole UI is **mobile‑responsive** with a
drawer nav for use on site.

### Multi‑tenant
Sign up, create a project, and work in your own isolated workspace. Owners can switch between
projects, add members, and delete projects. Row Level Security guarantees a user only ever sees
rows for the projects they belong to.

### Features by screen

| Route | Screen | What you do there |
|---|---|---|
| `/login` | **Login / Sign‑up** | Email + password auth. Sign‑up captures `org_type` (施工廠商 / 監造 / 機關) and role. |
| `/project/new` | **Project setup** | Create a project (owner / contractor / supervisor / dates). First‑run gate: the workspace won't open until a project exists. |
| `/dashboard` | **Dashboard** | Contract value, item counts, billed‑to‑date and schedule status at a glance. |
| `/alerts` | **Alert center** | Aggregates 逾期 / 即將到期(7日) / 待處理 across contract obligations, defects, safety issues and payments. |
| `/contract` | **Contract control** | Set anchor dates → upload contract → **AI extracts obligations + penalties**; phase‑grouped list with live due dates, countdowns and source clauses. |
| `/boq` | **Bill of quantities** | Drag‑drop a PCCES XML → parsed in‑browser → imported into `work_items` in batches. Browse the 3,000‑row tree; re‑import resets the project. |
| `/site-log` | **Daily site log** | One record per day; enter completed quantity per work item + photos. 📷 whiteboard‑OCR auto‑fill. Feeds valuations. |
| `/valuation` | **Progress valuation (估驗計價)** | Per‑period billing; "fill from site logs" sums daily quantities; auto‑computes cum %, amount, retention, net payable; status workflow 草稿→送審→監造審核→已核定→已請款. |
| `/payments` | **Billing & receipts** | Per‑period 本期估驗 / 保留款 / 應領; invoice & payment dates + amount; cash‑flow totals. CSV export. |
| `/cost` | **Cost & margin** | Budget vs. actual cost by category + subcontracts; live gross‑margin (budget & actual). CSV export. |
| `/progress` | **S‑curve** | Planned baseline (smoothstep S‑curve over project months) vs. actual derived from valuations; flags behind‑schedule. |
| `/schedule` | **Per‑item schedule** | Assign planned start/finish to key items; per‑item 未開始/進行中/落後/已完成 from plan + valuation. CSV export. |
| `/quality` | **Quality (三級品管)** | Raise inspections, record pass/fail. A fail auto‑opens a linked defect (開立→改善中→待複查→已結案). CSV export. |
| `/safety` | **Safety (工安)** | Self‑checks, safety deficiencies (remediation flow), training & hazard notices. CSV per type. |
| `/valuation/print` | **Valuation certificate** | Print/PDF a formal payment document (standalone route, no app chrome). |

---

## How it fits together

```mermaid
flowchart LR
  XML["PCCES budget XML"] -->|browser parse| WI["work_items<br/>(BOQ spine)"]
  WI --> LOG["daily logs"]
  WB["site whiteboard photo"] -->|AI vision| LOG
  LOG -->|sum quantity| VAL["valuations"]
  WI --> VAL
  VAL --> PAY["billing / receipts"]
  VAL --> CRV["S-curve"]
  VAL --> SCH["per-item schedule"]
  VAL --> PDF["valuation certificate"]
  WI --> COST["cost / margin"]
  WI --> INS["inspections"]
  INS -->|fail| DEF["defects"]
  WI --> SAF["safety"]
  DOC["contract document"] -->|AI parse| OBL["contract obligations"]
  OBL --> ALERT["alert center"]
  DEF --> ALERT
  SAF --> ALERT
  PAY --> ALERT
```

---

## System architecture

PMIS is a **static React SPA** talking straight to **Supabase** over PostgREST/GoTrue with a
*publishable* anon key. The database does the heavy lifting — auth, authorization (RLS),
constraints, and the operations that need elevated rights (SECURITY DEFINER RPCs). The only
custom server code is two **Edge Functions** that call an LLM for the AI features (they never
touch the DB; they take a file in and return structured JSON).

```mermaid
flowchart TB
  subgraph Browser["Browser — React 18 SPA (static, GitHub Pages)"]
    P["pages/web/*"] --> S["store.jsx<br/>(single context: all reads/writes)"]
    S --> L["lib/parsePcces · boqCalc · contractDue · exportCsv"]
  end
  S -->|"supabase-js (anon key)"| API
  S -->|"invoke"| FN
  subgraph Supabase
    API["PostgREST + GoTrue"] --> RLS["Row Level Security<br/>is_project_member()"]
    RLS --> DB[("Postgres")]
    API --> RPC["RPCs (SECURITY DEFINER)<br/>create_project · delete_project"]
    RPC --> DB
    STG["Storage (photos bucket, RLS)"]
    FN["Edge Functions (Deno)<br/>parse-contract · read-whiteboard"] -->|OpenAI gpt-4o| AI(("LLM"))
  end
  S -->|"upload/signed URL"| STG
```

**One store, two modes.** [`src/store.jsx`](src/store.jsx) is the single source of truth — it
owns React state *and* every Supabase call. A `dbMode` flag (`isSupabaseConfigured && a real
project is selected && its BOQ lives in the DB`) decides where data comes from:

- **DB mode** — work items, valuations, schedule, site logs, quality, cost, safety, contract
  obligations and per‑item schedules all load from / persist to Postgres, scoped to the project.
- **Sample fallback** — if Supabase env vars are unset, or a project has no imported BOQ yet, the
  app degrades to the bundled sample BOQ so the demo always runs. The UI shape is identical.

**Request lifecycle.** Sign in → load this user's projects → pick the last‑used (or first) →
load its `work_items` (paged 1,000 rows at a time past the PostgREST cap) → derive lookup maps
(`item_key ↔ uuid`) → load valuations / schedule / site logs / quality / cost / safety / contract
obligations / item schedules for that project.

**The BOQ spine.** Import maps each parsed item to a client‑generated UUID so parent/child links
survive the round‑trip (`parent_key → parent_id`), then inserts in `sort_order` so parents land
before children (FK‑safe). Everything downstream references `work_item_id`, so quantities are
never re‑keyed. Cumulative valuation amounts are computed as `contract_amount × (done_qty /
contract_qty)` and rolled up the tree ([`lib/boqCalc.js`](src/lib/boqCalc.js)) — using
amount×ratio (not unit‑price×qty) so a 100 %‑complete item bills exactly its contract amount with
no rounding drift.

**AI features.** Both are Supabase Edge Functions calling OpenAI `gpt-4o` with structured
(json‑schema) output:
- **read‑whiteboard** — a site whiteboard photo → `{ log_date, weather, work_summary, items[] }`;
  items are fuzzy‑matched back to BOQ leaves before filling the daily log.
- **parse‑contract** — a contract (digital PDF/Word → text extracted in‑browser via `pdf.js` /
  `mammoth`; scanned/image → base64 vision) → a list of obligations matching `contract_obligations`.
  Deadlines are stored as **rules** (trigger event + offset days), so one parse re‑resolves against
  the project's anchor dates and recomputes if a date slips.

### Data model

All domain tables are project‑scoped and cascade from `projects`. Every one has RLS enabled with
the same `is_project_member(project_id)` predicate.

| Table | Role |
|---|---|
| `profiles` | Extends `auth.users`; auto‑created on sign‑up via trigger (`org_type`, company, role). |
| `projects` · `project_members` | A project and its membership; creator auto‑added as `admin`. Anchor dates (award/notice/commencement) live here. |
| `work_items` | **The BOQ spine** — the PCCES work‑item tree (項次/數量/單價/複價, kind, leaf/rollup, billable, weight). |
| `valuations` · `valuation_items` | Progress billing per period; items hold cumulative quantity + derived cum %/amount, tagged `source = manual \| daily_log`; invoice/payment fields for cash‑flow. |
| `schedule_periods` | Planned‑progress baseline (monthly `planned_pct`) for the S‑curve. |
| `item_schedules` | Per‑item planned start/finish (own table so re‑importing the BOQ doesn't wipe it). |
| `daily_logs` · `daily_log_items` | One log per day; per‑item completed quantity that feeds valuations. |
| `photos` | Site‑log photo metadata; files live in the `photos` Storage bucket (object‑level RLS by project). |
| `inspections` · `defects` | Three‑tier QC; a failed inspection auto‑opens a linked defect. |
| `contract_obligations` | AI‑extracted time‑based duties + penalties (deadline stored as a rule). |
| `cost_items` | Cost ledger — budget vs. actual by category, subcontracts (vendor). |
| `safety_records` | Safety log — self‑checks / deficiencies / training / hazard notices. |

Two `SECURITY DEFINER` RPCs cover operations RLS alone can't express atomically:
`create_project` (insert + add creator as member) and `delete_project` (member‑gated cascade).

---

## Tech stack

| Layer | Choices |
|---|---|
| Frontend | React 18 · Vite 5 · React Router 6 (HashRouter) · Tailwind CSS 4 |
| Backend | Supabase — Postgres, Auth (email/password), Row Level Security, Storage, Edge Functions (Deno) |
| AI | OpenAI `gpt-4o` (vision + structured output) via Edge Functions; in‑browser text extraction with `pdf.js` (`pdfjs-dist`) and `mammoth` |
| BOQ parsing | PCCES eTender XML via in‑browser `DOMParser` ([`src/lib/parsePcces.js`](src/lib/parsePcces.js)); a Python port lives in [`scripts/import_boq.py`](scripts/import_boq.py) |
| Hosting | GitHub Pages (static SPA) |

The SPA ships only a *publishable* key; security is the database's job (RLS). The
`service_role` / secret key and the `OPENAI_API_KEY` live only as server‑side secrets (Edge
Functions), never in the browser.

---

## Getting started

```bash
git clone https://github.com/ryanxxhuang/PMIS.git
cd PMIS
npm install
cp .env.example .env        # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev                 # http://localhost:5173
```

Backend (Supabase project + schema): see **[supabase/SETUP.md](supabase/SETUP.md)**.
The full, idempotent database schema is one file: **[supabase/schema.sql](supabase/schema.sql)** —
paste it into the SQL editor and run.

**AI features** (optional) need the two Edge Functions deployed and an OpenAI key set:

```bash
supabase functions deploy parse-contract
supabase functions deploy read-whiteboard
supabase secrets set OPENAI_API_KEY=sk-...
```

## Deploy

GitHub Pages in one command (build + push to the `gh-pages` branch):

```bash
npm run deploy
```

The app uses `HashRouter` and relative asset paths, so it runs from any static host or
sub‑path with no server‑side routing config.

---

## Project structure

```
src/
  lib/
    supabase.js      Supabase client (guarded — falls back to a sample mode if unset)
    parsePcces.js    PCCES budget XML → work-item tree (browser DOMParser)
    boqCalc.js       tree building + cumulative-amount maths (shared by valuation/progress/cost)
    contractDue.js   resolve an obligation's due date from trigger + rule + anchor dates
    exportCsv.js     table → CSV download (UTF-8 BOM for Excel CJK)
  pages/
    Login.jsx        auth (sign-in / sign-up)
    web/             ProjectSetup · Dashboard · Alerts · Contract · BOQ · SiteLog ·
                     Valuation · ValuationPrint · Payments · Cost · Progress ·
                     Schedule · Quality · Safety
  components/        Layout.jsx (app shell + responsive nav) · ui.jsx (shared primitives)
  data/              workItems.json (sample BOQ) · seed.js (small no-Supabase fallback)
  store.jsx          single context: all React state + every Supabase read/write
  App.jsx            routes + auth/project gating
supabase/
  schema.sql         complete database schema, RLS + RPCs (idempotent)
  functions/         Edge Functions — parse-contract · read-whiteboard (OpenAI)
  SETUP.md           backend setup guide
scripts/
  import_boq.py      offline PCCES XML → JSON importer (used to seed the sample BOQ)
```

## Security

Every table has Row Level Security enabled, sharing one `is_project_member()` predicate; the
`photos` Storage bucket is gated the same way at the object level. The publishable key is
designed to be public — it is RLS, not the key, that protects data. Secret keys
(`service_role`, `OPENAI_API_KEY`) live only in Edge Function secrets, never in the browser.

---

<sub>Sample data is the public PCCES budget for the 國際原住民族文化創意產業園區新建工程 tender
(~NT$0.94B, 3,262 work items), used purely to demonstrate the BOQ pipeline.</sub>
