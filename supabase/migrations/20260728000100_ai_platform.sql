-- ── 批 A(AI 平台化):AI 用量、功能開關、方案 ───────────────────────────────
-- 為什麼要這一層:AI 功能(LLM 呼叫)是本產品唯一的邊際變動成本,平台要能
-- 回答三個營運問題:(1) 每個功能/專案/使用者燒了多少 token 與美金;
-- (2) 哪些功能對哪個方案開放;(3) 出事時能不能一鍵關掉單一功能。
-- 資料模型四件套:
--   * ai_model_pricing     —— 模型定價(算成本用,可熱更新不需部署)
--   * ai_features          —— 功能註冊表(平台級總開關 + 最低方案)
--   * project_ai_overrides —— 專案級覆寫(白名單試用 / 黑名單停用)
--   * ai_usage_events      —— 用量事件(append-only,跨租戶,只有平台管理員可讀)
-- 前端/edge 的功能靜態中繼資料在 src/lib/aiFeatures.js 與
-- supabase/functions/_shared/aiFeatures.ts(值域由測試釘住);DB 這份是執行期
-- 唯一真相——「可不可以用」一律問 ai_feature_allowed()。
-- 依賴:20260728000000_platform_admin.sql(is_platform_admin)。
-- 純加法 migration:不動任何既有表的既有欄位 / policy / trigger 語意。

-- ── 模型定價表 ──────────────────────────────────────────────────────────────
-- 單位:USD / 每百萬 token。cache_write 用 5 分鐘 ephemeral cache 的 1.25 倍率
-- (本專案只用 ephemeral cache,不用 1h cache 的 2 倍率)。
-- 注意:Sonnet 5 於 2026-08-31 前有 $2/$10 的導入價,此表存「正式價」
-- (偏保守高估);要精算可直接 update 此表——record_ai_usage 每次即時查價,
-- 改價不需重新部署任何程式。查無 model 的用量以 0 成本記錄、不可失敗
-- (寧可少算成本也不能掉用量事件)。
create table if not exists public.ai_model_pricing (
  model                    text primary key,
  input_usd_per_mtok       numeric not null,
  output_usd_per_mtok      numeric not null,
  cache_read_usd_per_mtok  numeric not null,
  cache_write_usd_per_mtok numeric not null,
  updated_at               timestamptz not null default now()
);

insert into public.ai_model_pricing
  (model, input_usd_per_mtok, output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok)
values
  ('claude-opus-5',              5,    25,   0.50, 6.25),
  ('claude-sonnet-5',            3,    15,   0.30, 3.75),
  ('claude-haiku-4-5-20251001',  1,     5,   0.10, 1.25)
on conflict (model) do nothing;  -- 重放時不覆蓋人工調過的價格

alter table public.ai_model_pricing enable row level security;
-- 定價是平台營運資料,一般使用者無關(前端不顯示成本);寫入只走 service role
-- / SQL console(security definer 的 record_ai_usage 只讀不寫此表)。
drop policy if exists "ai_model_pricing_select_platform_admin" on public.ai_model_pricing;
create policy "ai_model_pricing_select_platform_admin" on public.ai_model_pricing
  for select to authenticated using (public.is_platform_admin());
-- 基線(20260712001200)alter default privileges 會讓新表自動帶寫入授權,必須收回
revoke insert, update, delete on public.ai_model_pricing from public, anon, authenticated;

-- ── AI 功能註冊表(平台級總開關)─────────────────────────────────────────────
-- enabled 是平台級 kill switch:某功能出事(成本暴衝/輸出品質事故)時,
-- 平台管理員一鍵關閉,所有專案(含覆寫)立即停用——覆寫只翻轉「方案」判定,
-- 翻不過平台總開關(見 ai_feature_allowed)。
-- is_llm=false(weather.fetch / reminder.daily)代表不打 LLM、不算 token/成本,
-- 但仍是可獨立開關、需要計次的模組——用量事件照記,只是 token 與 cost 為 0。
create table if not exists public.ai_features (
  key           text primary key,
  label         text not null,
  category      text not null,
  edge_function text not null,
  min_plan      text not null check (min_plan in ('trial','standard','pro')),
  is_llm        boolean not null default true,
  enabled       boolean not null default true,
  sort_order    int not null default 0,
  updated_at    timestamptz not null default now()
);

-- seed:與 src/lib/aiFeatures.js / _shared/aiFeatures.ts 同一份 16 筆
-- (順序=sort_order;重放時不覆蓋後台調過的 enabled / min_plan)
insert into public.ai_features (key, label, category, edge_function, min_plan, is_llm, enabled, sort_order) values
  ('agent.run',            'AI Agent 主控台',        'agent',       'agent-run',               'standard', true,  true, 10),
  ('assistant.chat',       'AI 問答助理',            'agent',       'assistant-chat',          'standard', true,  true, 20),
  ('contract.parse',       '契約解析(時程/罰則)',  'document',    'parse-contract',          'standard', true,  true, 30),
  ('requirements.extract', '規範需求抽取',           'document',    'extract-requirements',    'pro',      true,  true, 40),
  ('submittal.read',       '送審文件讀取',           'document',    'read-submittal',          'pro',      true,  true, 50),
  ('submittal.review',     '監造送審審查意見',       'draft',       'review-submittal',        'pro',      true,  true, 60),
  ('rfi.draft_reply',      'RFI 回覆草稿',           'draft',       'draft-rfi-reply',         'pro',      true,  true, 70),
  ('audit.summary',        '機關稽核意見草稿',       'draft',       'audit-summary',           'pro',      true,  true, 80),
  ('report.monthly',       '施工月報草稿',           'draft',       'draft-monthly-review',    'standard', true,  true, 90),
  ('valuation.summary',    '估驗施工說明草稿',       'draft',       'draft-valuation-summary', 'standard', true,  true, 100),
  ('sitelog.whiteboard',   '工程告示板辨識',         'vision',      'read-whiteboard',         'trial',    true,  true, 110),
  ('defect.describe',      '缺失照片描述',           'vision',      'describe-defect',         'trial',    true,  true, 120),
  ('photo.classify',       '施工照片分類',           'vision',      'classify-site-photo',     'trial',    true,  true, 130),
  ('safety.photo',         '工安照片判讀',           'vision',      'analyze-safety-photo',    'standard', true,  true, 140),
  ('weather.fetch',        '天氣帶入(中央氣象署)', 'integration', 'fetch-weather',           'trial',    false, true, 150),
  ('reminder.daily',       '每日 agent 早報',        'automation',  'send-reminders',          'standard', false, true, 160)
on conflict (key) do nothing;

alter table public.ai_features enable row level security;
-- 一般 authenticated 也能 select:前端要據 enabled/min_plan 隱藏 AI 按鈕,
-- 這張表沒有機密(功能名稱與方案門檻本來就是公開的產品資訊)。
drop policy if exists "ai_features_select_all" on public.ai_features;
create policy "ai_features_select_all" on public.ai_features
  for select to authenticated using (true);
-- 寫入只走 admin RPC(admin_set_feature_enabled / admin_set_feature_min_plan)
revoke insert, update, delete on public.ai_features from public, anon, authenticated;

-- ── 專案方案 ────────────────────────────────────────────────────────────────
-- ai_plan:trial < standard < pro(rank 見 ai_feature_allowed);既有專案一律
-- 落在 standard(目前所有正式客戶的實質待遇,加欄位不改變任何人的體驗)。
alter table public.projects
  add column if not exists ai_plan text not null default 'standard';
alter table public.projects drop constraint if exists projects_ai_plan_check;
alter table public.projects
  add constraint projects_ai_plan_check check (ai_plan in ('trial','standard','pro'));
-- ai_monthly_token_quota:每月 token 上限(null=不限)。本批只留欄位不做任何
-- 強制——配額強制(超量降級/擋呼叫)牽涉「月」的定義與寬限策略,屬之後批次;
-- 先有欄位讓後台可以開始標記,強制邏輯落地時不需再改 schema。
alter table public.projects
  add column if not exists ai_monthly_token_quota bigint;

-- ── 專案級覆寫 ──────────────────────────────────────────────────────────────
-- 用途:白名單試用(trial 專案先體驗某個 pro 功能)或黑名單停用(某專案
-- 出包先關單一功能)。覆寫只翻轉「方案門檻」判定,翻不過平台總開關。
create table if not exists public.project_ai_overrides (
  project_id  uuid references public.projects(id) on delete cascade,
  feature_key text references public.ai_features(key) on delete cascade,
  enabled     boolean not null,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  primary key (project_id, feature_key)
);
alter table public.project_ai_overrides enable row level security;
-- 專案成員可讀(前端要知道本專案實際開了哪些功能);平台管理員可讀全部
-- (後台看覆寫明細)。寫入只走 admin RPC(admin_set_project_override)。
drop policy if exists "project_ai_overrides_select" on public.project_ai_overrides;
create policy "project_ai_overrides_select" on public.project_ai_overrides
  for select to authenticated
  using (project_id in (select public.my_project_ids()) or public.is_platform_admin());
revoke insert, update, delete on public.project_ai_overrides from public, anon, authenticated;

-- ── 用量事件(append-only)───────────────────────────────────────────────────
-- 每一次 AI 呼叫(成功/失敗/被擋)都落一筆——這是成本儀表板與濫用偵測的
-- 原始資料。project_id / user_id 用 on delete set null:專案或帳號刪除後,
-- 歷史成本仍要留著對帳(錢已經花了,不能跟著消失)。
create table if not exists public.ai_usage_events (
  id                 bigint generated always as identity primary key,
  occurred_at        timestamptz not null default now(),
  feature_key        text not null,
  edge_function      text not null,
  project_id         uuid references public.projects(id) on delete set null,
  user_id            uuid references auth.users(id) on delete set null,
  actor              text not null default 'user' check (actor in ('user','system')),
  model              text,
  input_tokens       int not null default 0,
  output_tokens      int not null default 0,
  cache_read_tokens  int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd           numeric(14,6) not null default 0,
  duration_ms        int,
  status             text not null check (status in ('ok','error','blocked')),
  error_code         text
);
create index if not exists ai_usage_events_occurred_idx on public.ai_usage_events (occurred_at desc);
create index if not exists ai_usage_events_feature_idx  on public.ai_usage_events (feature_key, occurred_at desc);
create index if not exists ai_usage_events_project_idx  on public.ai_usage_events (project_id, occurred_at desc);
create index if not exists ai_usage_events_user_idx     on public.ai_usage_events (user_id, occurred_at desc);

alter table public.ai_usage_events enable row level security;
-- SELECT 只給平台管理員:token 用量是「跨租戶」營運資料,專案成員看得到
-- 彼此的呼叫量會洩漏他人工作模式,一般使用者一列都不該看到。
drop policy if exists "ai_usage_events_select_platform_admin" on public.ai_usage_events;
create policy "ai_usage_events_select_platform_admin" on public.ai_usage_events
  for select to authenticated using (public.is_platform_admin());
-- 寫入唯一路徑:record_ai_usage()(security definer,只 grant 給 service_role)。
-- 基線 alter default privileges 自動授權必須明確收回,否則 authenticated 可偽造用量。
revoke insert, update, delete on public.ai_usage_events from public, anon, authenticated;

-- ── ai_feature_allowed:執行期唯一的「可不可以用」判定 ──────────────────────
-- 三段邏輯(edge function 呼叫前必問;前端也可問,但以 edge 端為準):
--   1) 平台總開關:enabled=false → 一律 false(kill switch,覆寫翻不過)
--   2) 專案覆寫:有覆寫 → 以覆寫為準(白名單試用/黑名單停用)
--   3) 方案門檻:專案 ai_plan rank >= 功能 min_plan rank
-- 查無 feature → false(拼錯 key 要 fail-closed,不能 fail-open)。
-- p_project 為 null(無專案脈絡,如個人層級呼叫)→ 只看平台 enabled 且
-- min_plan='trial'(無方案可查,取最保守門檻)。
-- security definer:authenticated 對 projects 只看得到自己的專案,但 edge
-- function 以呼叫者身分查任意專案時判定必須一致;stable:同一交易內可快取。
create or replace function public.ai_feature_allowed(p_project uuid, p_feature text)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare
  v_feature  public.ai_features;
  v_plan     text;
  v_override boolean;
begin
  select * into v_feature from public.ai_features where key = p_feature;
  if not found or not v_feature.enabled then
    return false;  -- 未註冊或平台已關閉:fail-closed
  end if;

  if p_project is null then
    return v_feature.min_plan = 'trial';
  end if;

  select ai_plan into v_plan from public.projects where id = p_project;
  if not found then
    return false;  -- 專案不存在:fail-closed
  end if;

  select enabled into v_override
  from public.project_ai_overrides
  where project_id = p_project and feature_key = p_feature;
  if found then
    return v_override;  -- 覆寫優先於方案門檻(但翻不過上面的平台總開關)
  end if;

  return (case v_plan          when 'trial' then 0 when 'standard' then 1 when 'pro' then 2 end)
      >= (case v_feature.min_plan when 'trial' then 0 when 'standard' then 1 when 'pro' then 2 end);
end $$;
revoke all on function public.ai_feature_allowed(uuid, text) from public, anon;
grant execute on function public.ai_feature_allowed(uuid, text) to authenticated, service_role;

-- ── record_ai_usage:用量事件唯一寫入路徑 ───────────────────────────────────
-- 由 edge function 以 service role 呼叫;成本以呼叫當下的 ai_model_pricing
-- 即時計價(改價即生效,不需重部署)。查無 model 以 0 成本記錄、不失敗——
-- 用量事件的完整性優先於成本精確性(成本可事後重算,掉了事件就沒了)。
-- ⚠ 絕不能 grant 給 authenticated:前端可呼叫=任何人可偽造/灌爆用量資料。
create or replace function public.record_ai_usage(
  p_feature text, p_edge_function text, p_project uuid, p_user uuid, p_actor text,
  p_model text, p_input int, p_output int, p_cache_read int, p_cache_write int,
  p_duration_ms int, p_status text, p_error_code text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_pricing public.ai_model_pricing;
  v_cost    numeric(14,6) := 0;
  v_id      bigint;
begin
  select * into v_pricing from public.ai_model_pricing where model = p_model;
  if found then
    v_cost := round((
        coalesce(p_input, 0)       * v_pricing.input_usd_per_mtok
      + coalesce(p_output, 0)      * v_pricing.output_usd_per_mtok
      + coalesce(p_cache_read, 0)  * v_pricing.cache_read_usd_per_mtok
      + coalesce(p_cache_write, 0) * v_pricing.cache_write_usd_per_mtok
    ) / 1000000.0, 6);
  end if;

  insert into public.ai_usage_events (
    feature_key, edge_function, project_id, user_id, actor, model,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    cost_usd, duration_ms, status, error_code
  ) values (
    p_feature, p_edge_function, p_project, p_user, coalesce(p_actor, 'user'), p_model,
    coalesce(p_input, 0), coalesce(p_output, 0), coalesce(p_cache_read, 0), coalesce(p_cache_write, 0),
    v_cost, p_duration_ms, p_status, p_error_code
  ) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_ai_usage(
  text, text, uuid, uuid, text, text, int, int, int, int, int, text, text
) from public, anon, authenticated;
grant execute on function public.record_ai_usage(
  text, text, uuid, uuid, text, text, int, int, int, int, int, text, text
) to service_role;

-- ── 平台後台 RPC ────────────────────────────────────────────────────────────
-- 共同模式:security definer + 第一行 is_platform_admin() 守門(raise),
-- grant execute 給 authenticated(守門在函式內,不在 grant 層)——與
-- resolve_agent_action 同一種「窄門」慣例:表級權限全收,能力收斂進可稽核
-- 的 RPC。時間區間一律半開 [p_from, p_to);參數 null = 不設界。
-- 留痕取捨:這些平台級變更「不寫」record_audit_event——audit_events 綁定
-- project_id,平台設定不屬於任一專案,硬塞會汙染專案稽核流;改以
-- ai_features.updated_at 與 project_ai_overrides.updated_by/updated_at 留痕,
-- 用量真相另有 append-only 的 ai_usage_events 佐證。

-- 全平台用量總覽(單列)
create or replace function public.admin_ai_usage_overview(p_from timestamptz, p_to timestamptz)
returns table (
  total_calls bigint, ok_calls bigint, error_calls bigint, blocked_calls bigint,
  input_tokens bigint, output_tokens bigint, cache_read_tokens bigint, cache_write_tokens bigint,
  cost_usd numeric, distinct_users bigint, distinct_projects bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception '需要平台管理員權限'; end if;
  return query
  select
    count(*),
    count(*) filter (where e.status = 'ok'),
    count(*) filter (where e.status = 'error'),
    count(*) filter (where e.status = 'blocked'),
    coalesce(sum(e.input_tokens), 0)::bigint,
    coalesce(sum(e.output_tokens), 0)::bigint,
    coalesce(sum(e.cache_read_tokens), 0)::bigint,
    coalesce(sum(e.cache_write_tokens), 0)::bigint,
    coalesce(sum(e.cost_usd), 0)::numeric,
    count(distinct e.user_id),
    count(distinct e.project_id)
  from public.ai_usage_events e
  where e.occurred_at >= coalesce(p_from, '-infinity')
    and e.occurred_at <  coalesce(p_to,  'infinity');
end $$;
revoke all on function public.admin_ai_usage_overview(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_ai_usage_overview(timestamptz, timestamptz) to authenticated;

-- 逐功能用量(label 左接 ai_features:功能若被移出註冊表,歷史用量仍要看得到)
create or replace function public.admin_ai_usage_by_feature(p_from timestamptz, p_to timestamptz)
returns table (
  feature_key text, label text, calls bigint, error_calls bigint, blocked_calls bigint,
  input_tokens bigint, output_tokens bigint, cache_read_tokens bigint, cache_write_tokens bigint,
  cost_usd numeric
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception '需要平台管理員權限'; end if;
  return query
  select
    e.feature_key,
    coalesce(f.label, e.feature_key),
    count(*),
    count(*) filter (where e.status = 'error'),
    count(*) filter (where e.status = 'blocked'),
    coalesce(sum(e.input_tokens), 0)::bigint,
    coalesce(sum(e.output_tokens), 0)::bigint,
    coalesce(sum(e.cache_read_tokens), 0)::bigint,
    coalesce(sum(e.cache_write_tokens), 0)::bigint,
    coalesce(sum(e.cost_usd), 0)::numeric
  from public.ai_usage_events e
  left join public.ai_features f on f.key = e.feature_key
  where e.occurred_at >= coalesce(p_from, '-infinity')
    and e.occurred_at <  coalesce(p_to,  'infinity')
  group by e.feature_key, f.label
  order by coalesce(sum(e.cost_usd), 0) desc;
end $$;
revoke all on function public.admin_ai_usage_by_feature(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_ai_usage_by_feature(timestamptz, timestamptz) to authenticated;

-- 逐專案用量(左接 projects:專案刪除後 project_id 為 null,歸入「無專案」列)
create or replace function public.admin_ai_usage_by_project(p_from timestamptz, p_to timestamptz)
returns table (
  project_id uuid, project_name text, ai_plan text,
  calls bigint, cost_usd numeric, input_tokens bigint, output_tokens bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception '需要平台管理員權限'; end if;
  return query
  select
    e.project_id,
    p.name,
    p.ai_plan,
    count(*),
    coalesce(sum(e.cost_usd), 0)::numeric,
    coalesce(sum(e.input_tokens), 0)::bigint,
    coalesce(sum(e.output_tokens), 0)::bigint
  from public.ai_usage_events e
  left join public.projects p on p.id = e.project_id
  where e.occurred_at >= coalesce(p_from, '-infinity')
    and e.occurred_at <  coalesce(p_to,  'infinity')
  group by e.project_id, p.name, p.ai_plan
  order by coalesce(sum(e.cost_usd), 0) desc
  limit 200;
end $$;
revoke all on function public.admin_ai_usage_by_project(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_ai_usage_by_project(timestamptz, timestamptz) to authenticated;

-- 逐使用者用量(左接 profiles:帳號刪除後 user_id 為 null,仍列一筆)
create or replace function public.admin_ai_usage_by_user(p_from timestamptz, p_to timestamptz)
returns table (
  user_id uuid, full_name text, company text, org_type text,
  calls bigint, cost_usd numeric
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception '需要平台管理員權限'; end if;
  return query
  select
    e.user_id,
    pr.full_name,
    pr.company,
    pr.org_type,
    count(*),
    coalesce(sum(e.cost_usd), 0)::numeric
  from public.ai_usage_events e
  left join public.profiles pr on pr.id = e.user_id
  where e.occurred_at >= coalesce(p_from, '-infinity')
    and e.occurred_at <  coalesce(p_to,  'infinity')
  group by e.user_id, pr.full_name, pr.company, pr.org_type
  order by coalesce(sum(e.cost_usd), 0) desc
  limit 200;
end $$;
revoke all on function public.admin_ai_usage_by_user(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_ai_usage_by_user(timestamptz, timestamptz) to authenticated;

-- 逐日用量(趨勢圖)。「日」以台灣時區切:平台營運者與所有客戶都在台灣,
-- 用 UTC 切日會讓早上 8 點前的呼叫掉到前一天,圖會對不上直覺。
create or replace function public.admin_ai_usage_daily(p_from timestamptz, p_to timestamptz)
returns table (day date, calls bigint, cost_usd numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception '需要平台管理員權限'; end if;
  return query
  select
    (e.occurred_at at time zone 'Asia/Taipei')::date,
    count(*),
    coalesce(sum(e.cost_usd), 0)::numeric
  from public.ai_usage_events e
  where e.occurred_at >= coalesce(p_from, '-infinity')
    and e.occurred_at <  coalesce(p_to,  'infinity')
  group by 1
  order by 1;
end $$;
revoke all on function public.admin_ai_usage_daily(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_ai_usage_daily(timestamptz, timestamptz) to authenticated;

-- 平台級功能開關(kill switch)
create or replace function public.admin_set_feature_enabled(p_key text, p_enabled boolean)
returns public.ai_features
language plpgsql security definer set search_path = public as $$
declare
  v_row public.ai_features;
begin
  if not public.is_platform_admin() then raise exception '需要平台管理員權限'; end if;
  update public.ai_features
     set enabled = p_enabled, updated_at = now()
   where key = p_key
   returning * into v_row;
  if not found then
    raise exception '查無此 AI 功能:%', p_key;
  end if;
  return v_row;
end $$;
revoke all on function public.admin_set_feature_enabled(text, boolean) from public, anon;
grant execute on function public.admin_set_feature_enabled(text, boolean) to authenticated;

-- 調整功能的最低方案門檻
create or replace function public.admin_set_feature_min_plan(p_key text, p_min_plan text)
returns public.ai_features
language plpgsql security definer set search_path = public as $$
declare
  v_row public.ai_features;
begin
  if not public.is_platform_admin() then raise exception '需要平台管理員權限'; end if;
  if p_min_plan is null or p_min_plan not in ('trial', 'standard', 'pro') then
    raise exception '不合法的方案,僅接受 trial/standard/pro';
  end if;
  update public.ai_features
     set min_plan = p_min_plan, updated_at = now()
   where key = p_key
   returning * into v_row;
  if not found then
    raise exception '查無此 AI 功能:%', p_key;
  end if;
  return v_row;
end $$;
revoke all on function public.admin_set_feature_min_plan(text, text) from public, anon;
grant execute on function public.admin_set_feature_min_plan(text, text) to authenticated;

-- 調整專案方案
create or replace function public.admin_set_project_plan(p_project uuid, p_plan text)
returns public.projects
language plpgsql security definer set search_path = public as $$
declare
  v_row public.projects;
begin
  if not public.is_platform_admin() then raise exception '需要平台管理員權限'; end if;
  if p_plan is null or p_plan not in ('trial', 'standard', 'pro') then
    raise exception '不合法的方案,僅接受 trial/standard/pro';
  end if;
  update public.projects
     set ai_plan = p_plan
   where id = p_project
   returning * into v_row;
  if not found then
    raise exception '查無此專案';
  end if;
  return v_row;
end $$;
revoke all on function public.admin_set_project_plan(uuid, text) from public, anon;
grant execute on function public.admin_set_project_plan(uuid, text) to authenticated;

-- 專案級覆寫 upsert;p_enabled 為 null = 刪除覆寫(回歸方案預設)
create or replace function public.admin_set_project_override(p_project uuid, p_key text, p_enabled boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception '需要平台管理員權限'; end if;
  if not exists (select 1 from public.ai_features f where f.key = p_key) then
    raise exception '查無此 AI 功能:%', p_key;
  end if;
  if not exists (select 1 from public.projects pr where pr.id = p_project) then
    raise exception '查無此專案';
  end if;
  if p_enabled is null then
    delete from public.project_ai_overrides
     where project_id = p_project and feature_key = p_key;
  else
    insert into public.project_ai_overrides (project_id, feature_key, enabled, updated_by, updated_at)
    values (p_project, p_key, p_enabled, auth.uid(), now())
    on conflict (project_id, feature_key)
    do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
end $$;
revoke all on function public.admin_set_project_override(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_project_override(uuid, text, boolean) to authenticated;

-- 後台專案清單(security definer:平台管理員看全部專案,不受成員 RLS 限制)
create or replace function public.admin_list_projects_for_ai()
returns table (
  project_id uuid, name text, code text, ai_plan text,
  override_count int, calls_30d bigint, cost_30d numeric
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception '需要平台管理員權限'; end if;
  return query
  select
    p.id,
    p.name,
    p.code,
    p.ai_plan,
    (select count(*)::int from public.project_ai_overrides o where o.project_id = p.id),
    coalesce(u.calls, 0),
    coalesce(u.cost, 0)::numeric
  from public.projects p
  left join (
    select e.project_id, count(*) as calls, sum(e.cost_usd) as cost
    from public.ai_usage_events e
    where e.occurred_at >= now() - interval '30 days'
    group by e.project_id
  ) u on u.project_id = p.id
  order by coalesce(u.cost, 0) desc, p.name;
end $$;
revoke all on function public.admin_list_projects_for_ai() from public, anon;
grant execute on function public.admin_list_projects_for_ai() to authenticated;
