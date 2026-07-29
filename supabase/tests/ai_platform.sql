-- ai_platform pgTAP 套件:批 A(AI 平台化資料層)。
-- 涵蓋:結構與表級權限契約(用量事件/定價/bootstrap 名單全部收乾淨)、
-- 平台管理員 bootstrap(名單內 email 註冊即升級、自我升權被 trigger 擋下)、
-- record_ai_usage 計價(已知模型/未知模型 0 成本/cache 分價)與唯一寫入路徑、
-- ai_feature_allowed 三段邏輯(平台總開關/方案門檻/專案覆寫,含 kill switch
-- 蓋過覆寫)、admin_* RPC 守門與行為(開關/方案/覆寫/用量彙總)。
-- 執行:本地 supabase(colima)+容器內 psql,整份交易內執行並 rollback。
-- 對應 migration 20260728000000_platform_admin.sql / 20260728000100_ai_platform.sql。
begin;

select plan(69);

-- login helper(同 p0_05 慣例:兩種 claim 寫法都設,涵蓋不同 auth.uid() 實作)
create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

select pg_temp.become(null);

-- ── 結構契約 ────────────────────────────────────────────────────────────────
select has_table('public', 'ai_model_pricing', '模型定價表存在');
select has_table('public', 'ai_features', 'AI 功能註冊表存在');
select has_table('public', 'project_ai_overrides', '專案級覆寫表存在');
select has_table('public', 'ai_usage_events', '用量事件表存在');
select has_table('public', 'platform_admin_bootstrap', '超級帳號 bootstrap 名單存在');
select has_column('public', 'profiles', 'is_platform_admin', '平台管理員旗標欄位存在');
select has_column('public', 'projects', 'ai_plan', '專案 AI 方案欄位存在');
select has_column('public', 'projects', 'ai_monthly_token_quota', '月配額欄位存在(本批只留欄位)');
select has_function('public', 'is_platform_admin', '{}'::name[], '平台管理員判定函式存在');
select has_function('public', 'ai_feature_allowed', array['uuid','text'], '功能可用性判定函式存在');
select has_function('public', 'record_ai_usage',
  array['text','text','uuid','uuid','text','text','integer','integer','integer','integer','integer','text','text'],
  '用量記錄函式存在');

-- ── 表級權限契約(基線 default privileges 的自動授權必須被收回)──────────────
select is(has_table_privilege('authenticated', 'public.ai_usage_events', 'INSERT'), false,
  'authenticated 無 ai_usage_events INSERT 權限(不可偽造用量)');
select is(has_table_privilege('authenticated', 'public.ai_usage_events', 'UPDATE'), false,
  'authenticated 無 ai_usage_events UPDATE 權限(append-only)');
select is(has_table_privilege('authenticated', 'public.ai_usage_events', 'DELETE'), false,
  'authenticated 無 ai_usage_events DELETE 權限(append-only)');
select is(has_table_privilege('authenticated', 'public.ai_usage_events', 'SELECT'), true,
  'ai_usage_events SELECT 走表級授權+RLS(policy 只放行平台管理員)');
select is(has_table_privilege('authenticated', 'public.platform_admin_bootstrap', 'SELECT'), false,
  'bootstrap 名單對 authenticated 連 SELECT 都不給(名單不可枚舉)');
select is(has_table_privilege('authenticated', 'public.ai_features', 'SELECT'), true,
  'ai_features 一般使用者可讀(前端據此隱藏按鈕)');
select is(has_table_privilege('authenticated', 'public.ai_features', 'UPDATE'), false,
  'ai_features 寫入只走 admin RPC');
select is(has_table_privilege('authenticated', 'public.ai_model_pricing', 'UPDATE'), false,
  'ai_model_pricing 寫入只走 service role');
select is(has_table_privilege('authenticated', 'public.project_ai_overrides', 'INSERT'), false,
  'project_ai_overrides 寫入只走 admin RPC');
select is(has_function_privilege('authenticated',
  'public.record_ai_usage(text,text,uuid,uuid,text,text,integer,integer,integer,integer,integer,text,text)',
  'EXECUTE'), false,
  'record_ai_usage 不授權 authenticated(唯一寫入路徑=service role)');

-- ── 固定資料:bootstrap 名單→使用者→專案 ───────────────────────────────────
-- 名單必須先於 auth.users 插入:handle_new_user 建 profile 時查名單
insert into public.platform_admin_bootstrap (email) values ('boss@aiplat.test');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('ab100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'member@aiplat.test', '', now(), '{}',
   '{"full_name":"平台測試成員","org_type":"contractor"}', now(), now()),
  ('ab100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'boss@aiplat.test', '', now(), '{}',
   '{"full_name":"平台管理員","org_type":"contractor"}', now(), now());

-- 名單內 email 註冊 → handle_new_user 自動升級;名單外 → 一般使用者。
-- (metadata 沒有任何 is_platform_admin 欄位——它本來就不可從 metadata 取值)
select is((select is_platform_admin from public.profiles
  where id = 'ab100000-0000-0000-0000-000000000002'), true,
  'bootstrap 名單內的 email 註冊即成為平台管理員');
select is((select is_platform_admin from public.profiles
  where id = 'ab100000-0000-0000-0000-000000000001'), false,
  '名單外使用者不是平台管理員');

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, ai_plan) values
  ('ab200000-0000-0000-0000-00000000000a', 'AI 平台測試案 A', 'standard'),
  ('ab200000-0000-0000-0000-00000000000b', 'AI 平台測試案 B', 'trial');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('ab200000-0000-0000-0000-00000000000a', 'ab100000-0000-0000-0000-000000000001', 'member');

-- ── record_ai_usage 計價(superuser 直呼=模擬 service role 路徑)──────────────
create temp table _usage_ids (label text primary key, id bigint not null);
insert into _usage_ids values ('opus_ok', public.record_ai_usage(
  'agent.run', 'agent-run',
  'ab200000-0000-0000-0000-00000000000a', 'ab100000-0000-0000-0000-000000000001', 'user',
  'claude-opus-5', 1000000, 0, 0, 0, 1500, 'ok', null));
insert into _usage_ids values ('unknown_model', public.record_ai_usage(
  'contract.parse', 'parse-contract',
  'ab200000-0000-0000-0000-00000000000a', 'ab100000-0000-0000-0000-000000000001', 'user',
  'model-x-unknown', 500000, 100000, 0, 0, 800, 'error', 'upstream_500'));
insert into _usage_ids values ('haiku_cache', public.record_ai_usage(
  'photo.classify', 'classify-site-photo',
  'ab200000-0000-0000-0000-00000000000b', 'ab100000-0000-0000-0000-000000000001', 'user',
  'claude-haiku-4-5-20251001', 0, 0, 1000000, 1000000, 900, 'ok', null));
insert into _usage_ids values ('blocked', public.record_ai_usage(
  'submittal.review', 'review-submittal',
  'ab200000-0000-0000-0000-00000000000a', null, 'system',
  null, 0, 0, 0, 0, null, 'blocked', 'feature_disabled'));

select is((select cost_usd from public.ai_usage_events
  where id = (select id from _usage_ids where label = 'opus_ok')), 5.000000::numeric,
  'Opus 一百萬 input token 計價 5 USD');
select is((select cost_usd from public.ai_usage_events
  where id = (select id from _usage_ids where label = 'unknown_model')), 0.000000::numeric,
  '查無模型 → 0 成本記錄、不失敗(事件完整性優先於成本精確性)');
select is((select cost_usd from public.ai_usage_events
  where id = (select id from _usage_ids where label = 'haiku_cache')), 1.350000::numeric,
  'cache 讀/寫分開計價(0.10 + 1.25)');
select throws_ok($$
  insert into public.ai_usage_events (feature_key, edge_function, status)
  values ('x', 'y', 'weird')
$$, '23514', null, 'status check 擋下非法狀態值');

-- ── 一般使用者:讀不到用量、寫不進、升不了權 ────────────────────────────────
select pg_temp.become('ab100000-0000-0000-0000-000000000001');
set local role authenticated;

select is((select count(*)::integer from public.ai_usage_events), 0,
  '一般使用者 select 用量事件回 0 列(跨租戶資料只有平台管理員可讀)');
select throws_ok($$
  insert into public.ai_usage_events (feature_key, edge_function, status)
  values ('agent.run', 'agent-run', 'ok')
$$, '42501', null, 'authenticated 不可直接插入用量事件');
select throws_ok($$
  select public.record_ai_usage('agent.run', 'agent-run', null, null, 'user',
    null, 0, 0, 0, 0, null, 'ok', null)
$$, '42501', null, 'authenticated 不可 execute record_ai_usage(否則可偽造用量)');
select throws_ok($$
  update public.profiles set is_platform_admin = true
  where id = 'ab100000-0000-0000-0000-000000000001'
$$, 'P0001', '不可自行變更平台管理員身分',
  '自我升權被 guard trigger 擋下(profiles_update_own 政策允許更新自己整列,trigger 是唯一防線)');
select lives_ok($$
  update public.profiles set full_name = '改個名字'
  where id = 'ab100000-0000-0000-0000-000000000001'
$$, 'guard 只擋 is_platform_admin,其他 profile 欄位照常可改');
select is((select count(*)::integer from public.ai_features), 16,
  'ai_features 一般使用者讀得到全部 16 個功能');

-- ai_feature_allowed 三段邏輯(先驗方案門檻;覆寫與總開關在後台段驗)
select is(public.ai_feature_allowed('ab200000-0000-0000-0000-00000000000a', 'sitelog.whiteboard'), true,
  'standard 專案可用 trial 功能');
select is(public.ai_feature_allowed('ab200000-0000-0000-0000-00000000000a', 'agent.run'), true,
  'standard 專案可用 standard 功能');
select is(public.ai_feature_allowed('ab200000-0000-0000-0000-00000000000a', 'submittal.review'), false,
  '方案不足:standard 專案不可用 pro 功能');
select is(public.ai_feature_allowed('ab200000-0000-0000-0000-00000000000b', 'agent.run'), false,
  '方案不足:trial 專案不可用 standard 功能');
select is(public.ai_feature_allowed(null, 'sitelog.whiteboard'), true,
  '無專案脈絡:trial 功能可用');
select is(public.ai_feature_allowed(null, 'assistant.chat'), false,
  '無專案脈絡:standard 功能不可用(取最保守門檻)');
select is(public.ai_feature_allowed('ab200000-0000-0000-0000-00000000000a', 'no.such_feature'), false,
  '未註冊 key 一律 false(fail-closed)');

-- admin RPC 守門:非平台管理員一律 raise
select throws_ok($$
  select * from public.admin_ai_usage_overview(null, null)
$$, 'P0001', '需要平台管理員權限', '非平台管理員不可看用量總覽');
select throws_ok($$
  select public.admin_set_feature_enabled('agent.run', false)
$$, 'P0001', '需要平台管理員權限', '非平台管理員不可動平台總開關');
select throws_ok($$
  select public.admin_set_project_plan('ab200000-0000-0000-0000-00000000000b', 'pro')
$$, 'P0001', '需要平台管理員權限', '非平台管理員不可改專案方案');

-- ── 平台管理員:用量彙總與開關/方案/覆寫 ────────────────────────────────────
reset role;
select pg_temp.become('ab100000-0000-0000-0000-000000000002');
set local role authenticated;

select is((select count(*)::integer from public.ai_usage_events), 4,
  '平台管理員看得到全部用量事件');
select results_eq($$
  select o.total_calls, o.ok_calls, o.error_calls, o.blocked_calls,
         o.input_tokens, o.output_tokens, o.cost_usd, o.distinct_users, o.distinct_projects
  from public.admin_ai_usage_overview(null, null) o
$$, $$ values (4::bigint, 2::bigint, 1::bigint, 1::bigint,
               1500000::bigint, 100000::bigint, 6.35::numeric, 1::bigint, 2::bigint) $$,
  '用量總覽:呼叫數/狀態分佈/token/成本/去重數全部正確');
select results_eq($$
  select f.feature_key, f.label, f.calls, f.cost_usd
  from public.admin_ai_usage_by_feature(null, null) f
  where f.feature_key = 'agent.run'
$$, $$ values ('agent.run'::text, 'AI Agent 主控台'::text, 1::bigint, 5::numeric) $$,
  '逐功能彙總帶中文 label 與成本');
select results_eq($$
  select p.project_name, p.ai_plan, p.calls, p.cost_usd
  from public.admin_ai_usage_by_project(null, null) p
  where p.project_id = 'ab200000-0000-0000-0000-00000000000a'
$$, $$ values ('AI 平台測試案 A'::text, 'standard'::text, 3::bigint, 5::numeric) $$,
  '逐專案彙總正確(error/blocked 也計次)');
select results_eq($$
  select u.calls, u.cost_usd from public.admin_ai_usage_by_user(null, null) u
  where u.user_id = 'ab100000-0000-0000-0000-000000000001'
$$, $$ values (3::bigint, 6.35::numeric) $$,
  '逐使用者彙總正確');
select is((select count(*)::integer from public.admin_ai_usage_daily(null, null)), 1,
  '逐日趨勢:同交易的事件落在同一天(台灣時區)');

-- 覆寫翻轉:白名單(trial 專案先體驗 standard 功能)/黑名單(單案停用)
select lives_ok($$
  select public.admin_set_project_override('ab200000-0000-0000-0000-00000000000b', 'agent.run', true)
$$, '白名單覆寫:trial 專案開 agent.run');
select is(public.ai_feature_allowed('ab200000-0000-0000-0000-00000000000b', 'agent.run'), true,
  '覆寫翻轉:方案不足但白名單放行');
select lives_ok($$
  select public.admin_set_project_override('ab200000-0000-0000-0000-00000000000a', 'sitelog.whiteboard', false)
$$, '黑名單覆寫:A 案停用告示板辨識');
select is(public.ai_feature_allowed('ab200000-0000-0000-0000-00000000000a', 'sitelog.whiteboard'), false,
  '覆寫翻轉:方案夠但黑名單停用');
select is((select updated_by from public.project_ai_overrides
  where project_id = 'ab200000-0000-0000-0000-00000000000b' and feature_key = 'agent.run'),
  'ab100000-0000-0000-0000-000000000002'::uuid,
  '覆寫留下操作者(updated_by=平台管理員)——平台級變更的留痕在此,不進專案 audit_events');
select is((select count(*)::integer from public.project_ai_overrides), 2,
  '平台管理員讀得到全部專案的覆寫(非成員也可,policy 的 admin 分支)');

-- 平台總開關(kill switch)蓋過一切,含覆寫
select is((select r.enabled from public.admin_set_feature_enabled('agent.run', false) r), false,
  '平台管理員可關閉單一功能');
select is(public.ai_feature_allowed('ab200000-0000-0000-0000-00000000000b', 'agent.run'), false,
  '平台關閉:白名單覆寫也翻不過 kill switch');
select is((select r.enabled from public.admin_set_feature_enabled('agent.run', true) r), true,
  '重新開啟後恢復');
select lives_ok($$
  select public.admin_set_project_override('ab200000-0000-0000-0000-00000000000b', 'agent.run', null)
$$, 'p_enabled=null 刪除覆寫');
select is(public.ai_feature_allowed('ab200000-0000-0000-0000-00000000000b', 'agent.run'), false,
  '移除覆寫後回歸 trial 方案預設(擋)');

-- 專案方案與功能門檻調整
select is((select r.ai_plan from public.admin_set_project_plan(
  'ab200000-0000-0000-0000-00000000000b', 'pro') r), 'pro',
  '平台管理員可調整專案方案');
select is(public.ai_feature_allowed('ab200000-0000-0000-0000-00000000000b', 'submittal.review'), true,
  '升 pro 後可用 pro 功能');
select throws_ok($$
  select public.admin_set_project_plan('ab200000-0000-0000-0000-00000000000b', 'platinum')
$$, 'P0001', '不合法的方案,僅接受 trial/standard/pro', '非法方案值擋下');
select is((select r.min_plan from public.admin_set_feature_min_plan('photo.classify', 'pro') r), 'pro',
  '平台管理員可調整功能最低方案');
select throws_ok($$
  select public.admin_set_feature_min_plan('photo.classify', 'vip')
$$, 'P0001', '不合法的方案,僅接受 trial/standard/pro', '非法門檻值擋下');

-- 後台專案清單(security definer:不受成員 RLS 限制)
select is((select count(*)::integer from public.admin_list_projects_for_ai()), 2,
  '後台列得出全部專案(平台管理員非任何專案成員)');
select results_eq($$
  select l.calls_30d, l.cost_30d from public.admin_list_projects_for_ai() l
  where l.project_id = 'ab200000-0000-0000-0000-00000000000a'
$$, $$ values (3::bigint, 5::numeric) $$,
  '專案清單帶近 30 日用量');

-- ── 成員只看得到自己專案的覆寫 ──────────────────────────────────────────────
reset role;
select pg_temp.become('ab100000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*)::integer from public.project_ai_overrides), 1,
  '成員只看得到自己專案(A)的覆寫,看不到 B 案');
reset role;
select pg_temp.become(null);

-- ── service role 路徑(auth.uid() 為 null)可指派平台管理員 ──────────────────
select lives_ok($$
  update public.profiles set is_platform_admin = true
  where id = 'ab100000-0000-0000-0000-000000000001'
$$, '無 JWT 情境(service role / migration)指派平台管理員被 guard 放行');

select * from finish();
rollback;
