-- 退場 AI 功能的平台總開關(pgTAP):assistant.chat(20260812000300)、contract.parse
-- (20260911100100)與 audit.summary(20260919130400,P6c／D-026 §4)在從零套用後必須仍是
-- enabled=false。seed 用 on conflict do nothing,但若日後有人重寫 seed、或加一支「全部開回」
-- 的 migration,伺服器端閘門(ai_feature_allowed)就會放行——parse-contract 產出的 obligations
-- 繞過 sourceVerify / document_ingestion_runs / requirements 權威(D-012);audit-summary 則是
-- 已無前端呼叫端、產品上不再存在的 AI 用途(勾稽檢核改由確定性引擎在估驗流程給結果)。
-- 退場的定義是「只翻總開關」:列、用量歷史、專案覆寫都不動,所以這裡同時釘住
--   * 閘門對 pro 專案也拒絕、專案覆寫翻不過(否則後台一個誤操作就重開退場功能);
--   * 用量歷史仍查得到:record_ai_usage 記下的 audit.summary 事件(含被閘門擋下的 blocked)
--     能被 admin_ai_usage_by_feature 以原 label 對到(列若被刪,FK cascade 會把歷史一起刪掉);
--   * 回復路徑:後台 RPC 開回即放行(退場沒有動方案門檻)。
-- 執行方式:一次性資料庫(npm run test:db)+容器內 psql,整份在交易內執行並 rollback。
begin;

select plan(17);

-- login helper(同 ai_platform.sql 慣例:兩種 claim 寫法都設,涵蓋不同 auth.uid() 實作)
create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 平台總開關:三支退場功能從零套用後仍關閉、列仍在 ──────────────────────────
select is((select enabled from public.ai_features where key = 'contract.parse'), false,
  'contract.parse 平台總開關關閉(D-012:requirements 是唯一權威)');
select is((select enabled from public.ai_features where key = 'assistant.chat'), false,
  'assistant.chat 平台總開關關閉(W3-3/D-008:/agent 是唯一對話入口)');
select is((select enabled from public.ai_features where key = 'audit.summary'), false,
  'audit.summary 平台總開關關閉(P6c/D-026 §4:獨立風險稽核工作區退出新作業)');
select is((select count(*)::int from public.ai_features where key in ('contract.parse', 'assistant.chat', 'audit.summary')), 3,
  '退場功能列保留(後台清單與 ai_usage_events 歷史要能對到)');

-- ── 閘門效果:連 pro 方案的專案也拿不到;覆寫翻不過;取代路徑與同方案的其他功能仍開放 ──
alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, ai_plan)
values ('b5e20000-0000-0000-0000-00000000000a', '退場功能閘門測試案', 'pro');
alter table public.projects enable trigger on_project_created;

select is(public.ai_feature_allowed('b5e20000-0000-0000-0000-00000000000a', 'contract.parse'), false,
  'pro 專案也不可用 contract.parse(平台總開關優先於方案)');
select is(public.ai_feature_allowed('b5e20000-0000-0000-0000-00000000000a', 'audit.summary'), false,
  'pro 專案也不可用 audit.summary(平台總開關優先於方案;Edge 閘門據此回 403)');
select is(public.ai_feature_allowed('b5e20000-0000-0000-0000-00000000000a', 'submittal.review'), true,
  '同為 pro 門檻的 submittal.review 對 pro 專案仍開放(擋下 audit.summary 的是總開關,不是方案)');
-- 專案覆寫也翻不過平台總開關(否則後台一個誤操作就重開退場功能)
insert into public.project_ai_overrides (project_id, feature_key, enabled) values
  ('b5e20000-0000-0000-0000-00000000000a', 'contract.parse', true),
  ('b5e20000-0000-0000-0000-00000000000a', 'audit.summary', true);
select is(public.ai_feature_allowed('b5e20000-0000-0000-0000-00000000000a', 'contract.parse'), false,
  '專案覆寫 enabled=true 仍翻不過 contract.parse 的平台總開關');
select is(public.ai_feature_allowed('b5e20000-0000-0000-0000-00000000000a', 'audit.summary'), false,
  '專案覆寫 enabled=true 仍翻不過 audit.summary 的平台總開關');
select is(public.ai_feature_allowed('b5e20000-0000-0000-0000-00000000000a', 'requirements.extract'), true,
  '取代路徑 requirements.extract 仍開放');

-- ── 用量歷史保留:退場後記下的事件(含被擋的 blocked)仍能以原 label 對到 ─────────
-- superuser 直呼 record_ai_usage = 模擬 service role 路徑(Edge 閘門記帳走這裡)
select public.record_ai_usage(
  'audit.summary', 'audit-summary',
  'b5e20000-0000-0000-0000-00000000000a', null, 'user',
  'claude-sonnet-4-5', 1200, 300, 0, 0, 2100, 'ok', null);
select public.record_ai_usage(
  'audit.summary', 'audit-summary',
  'b5e20000-0000-0000-0000-00000000000a', null, 'user',
  null, 0, 0, 0, 0, 15, 'blocked', 'feature_disabled');
select is((select count(*)::int from public.ai_usage_events where feature_key = 'audit.summary'), 2,
  'audit.summary 的用量事件照記(ok 與 blocked 各一)');
select is((select label from public.ai_features where key = 'audit.summary'), '機關稽核意見草稿',
  '功能列與 label 保留,用量報表左接得到原名');

-- 平台管理員(bootstrap 名單內 email 註冊即升級;同 ai_platform.sql 固定資料做法)
insert into public.platform_admin_bootstrap (email) values ('boss@retired.test');
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b5e10000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'boss@retired.test', '', now(), '{}',
   '{"full_name":"退場測試平台管理員","org_type":"owner"}', now(), now());
select is((select is_platform_admin from public.profiles where id = 'b5e10000-0000-0000-0000-000000000002'), true,
  '固定資料:bootstrap 名單內的 email 註冊即成為平台管理員');

select pg_temp.become('b5e10000-0000-0000-0000-000000000002');
set local role authenticated;

select results_eq($$
  select f.feature_key, f.label, f.calls, f.error_calls, f.blocked_calls
  from public.admin_ai_usage_by_feature(null, null) f
  where f.feature_key = 'audit.summary'
$$, $$ values ('audit.summary'::text, '機關稽核意見草稿'::text, 2::bigint, 0::bigint, 1::bigint) $$,
  '平台管理員的逐功能用量報表仍列出 audit.summary:2 次呼叫、1 次被閘門擋下,label 是原名');
select is((select enabled from public.ai_features where key = 'audit.summary'), false,
  '登入者讀 ai_features 看到 audit.summary 關閉(前端 aiEnabled 據此不顯示任何入口)');

-- ── 回復路徑:後台 RPC 開回即放行(退場只翻總開關,沒動方案門檻;rollback 檔做的是同一件事)──
select is((select r.enabled from public.admin_set_feature_enabled('audit.summary', true) r), true,
  '平台管理員可由後台 RPC 開回 audit.summary');
select is(public.ai_feature_allowed('b5e20000-0000-0000-0000-00000000000a', 'audit.summary'), true,
  '開回後閘門即放行(剛才擋下的只有總開關)');

select * from finish();
rollback;
