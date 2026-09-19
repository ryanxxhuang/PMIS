-- P4b 監造確認量的表、guard、RPC 與鎖(pgTAP):對應 migration 20260919040000_confirmed_quantity_enforcement.sql,
-- 逐條對應實作指令 §8「監造確認量與計價」與設計文件 §14。全部以真實 authenticated＋JWT 路徑呼叫 RPC 與直接寫表(R1 起簽發不要求 aal2,claims 的 aal 只是證據);
-- 併發(兩個 session 同時搶同一可用量)在 confirmed_quantity_concurrency.sql 以 dblink 真併發驗證。
-- 執行方式:npm run test:db(一次性資料庫),整份在交易內執行並 rollback。
begin;

select plan(294);

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. 結構與授權
-- ═══════════════════════════════════════════════════════════════════════════
select has_table('public', 'inspection_confirmations', '確認表存在');
select has_table('public', 'valuation_item_sources', '來源分配表存在');
select has_table('public', 'valuation_adjustments', '調整表存在');
select has_table('public', 'work_item_pricing_basis', '計價依據表存在');
select has_column('public', 'valuations', 'recheck_required', 'valuations.recheck_required');
select has_column('public', 'valuation_items', 'backing', 'valuation_items.backing');
select has_column('public', 'inspection_points', 'stage_key', 'inspection_points.stage_key');
select has_trigger('public', 'valuations', 'valuations_checkpoint_guard', '檢查點 trigger 掛上');
select has_trigger('public', 'inspection_confirmations', 'inspection_confirmations_after_change', '確認變動自動同步 trigger 掛上');
select has_trigger('public', 'work_items', 'work_items_confirmation_guard', '工項刪除／改單位 guard 掛上');
select has_trigger('public', 'inspection_points', 'inspection_points_stage_guard', 'ITP 階段變更 guard 掛上');
select is(
  (select string_agg(t, ',' order by t) from unnest(array['inspection_confirmations','valuation_item_sources','valuation_adjustments','work_item_pricing_basis']) t
    where has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE')),
  null, 'authenticated 對四張新表沒有 INSERT／UPDATE／DELETE(寫入只走 RPC)');
select ok(has_table_privilege('authenticated', 'public.inspection_confirmations', 'SELECT')
  and has_table_privilege('authenticated', 'public.valuation_item_sources', 'SELECT'), 'authenticated 可 SELECT(RLS 限成員)');
select ok(has_function_privilege('authenticated', 'public.sync_valuation_from_confirmations(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_valuation_item_cum(uuid,uuid,numeric)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.transition_valuation(uuid,text,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.revoke_inspection_confirmation(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.issue_supervisor_certificate(uuid,uuid,text,text,text,text,numeric,text,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.void_valuation_adjustment(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.admin_adjust_valuation_item(uuid,uuid,numeric,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_work_item_pricing_basis(uuid,text,jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_valuation_state(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_billable_backlog(uuid)', 'EXECUTE'), '十支 RPC authenticated 可執行');
select ok(not has_function_privilege('authenticated', 'public.fn_cq_item_state_internal(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.fn_cq_allocate_internal(uuid,uuid,numeric)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.fn_cq_backfill_legacy_internal(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.sync_valuation_from_confirmations(uuid)', 'EXECUTE'), '內部函式與 anon 不可執行');

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 測試資料
-- ═══════════════════════════════════════════════════════════════════════════
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('c4b10000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cq-contractor@example.test', '', now(), '{}', '{"full_name":"廠商","org_type":"contractor"}', now(), now()),
  ('c4b10000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cq-supervisor@example.test', '', now(), '{}', '{"full_name":"監造","org_type":"supervisor"}', now(), now()),
  ('c4b10000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cq-owner@example.test', '', now(), '{}', '{"full_name":"機關","org_type":"owner"}', now(), now()),
  ('c4b10000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cq-outsider@example.test', '', now(), '{}', '{"full_name":"外人","org_type":"supervisor"}', now(), now()),
  ('c4b10000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cq-admin@example.test', '', now(), '{}', '{"full_name":"管理者(廠商)","org_type":"contractor"}', now(), now()),
  ('c4b10000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cq-platform@example.test', '', now(), '{}', '{"full_name":"平台管理員","org_type":"contractor"}', now(), now()),
  ('c4b10000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cq-supervisor-b@example.test', '', now(), '{}', '{"full_name":"監造B","org_type":"supervisor"}', now(), now());
update public.profiles set is_platform_admin = true where id = 'c4b10000-0000-0000-0000-000000000006';

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by) values
  ('c4b20000-0000-0000-0000-00000000000a', '確認量測試案A', '機關', '廠商', '監造', 'c4b10000-0000-0000-0000-000000000005'),
  ('c4b20000-0000-0000-0000-00000000000b', '確認量測試案B(舊資料)', '機關', '廠商', '監造', 'c4b10000-0000-0000-0000-000000000005');
alter table public.projects enable trigger on_project_created;
insert into public.project_members (project_id, user_id, role) values
  ('c4b20000-0000-0000-0000-00000000000a', 'c4b10000-0000-0000-0000-000000000001', 'member'),
  ('c4b20000-0000-0000-0000-00000000000a', 'c4b10000-0000-0000-0000-000000000002', 'member'),
  ('c4b20000-0000-0000-0000-00000000000a', 'c4b10000-0000-0000-0000-000000000003', 'member'),
  ('c4b20000-0000-0000-0000-00000000000a', 'c4b10000-0000-0000-0000-000000000005', 'admin'),
  ('c4b20000-0000-0000-0000-00000000000b', 'c4b10000-0000-0000-0000-000000000001', 'member'),
  ('c4b20000-0000-0000-0000-00000000000b', 'c4b10000-0000-0000-0000-000000000003', 'member'),
  ('c4b20000-0000-0000-0000-00000000000b', 'c4b10000-0000-0000-0000-000000000007', 'member'),
  ('c4b20000-0000-0000-0000-00000000000b', 'c4b10000-0000-0000-0000-000000000005', 'admin');

insert into public.work_items (id, project_id, item_no, description, unit, quantity, unit_price, is_leaf, is_billable, is_rollup) values
  ('c4b30000-0000-0000-0000-000000000001', 'c4b20000-0000-0000-0000-00000000000a', '1.1', '混凝土', 'm2', 1000, 100, true, true, false),
  ('c4b30000-0000-0000-0000-000000000002', 'c4b20000-0000-0000-0000-00000000000a', '1.2', '鋼筋', 'kg', 500, 30, true, true, false),
  ('c4b30000-0000-0000-0000-000000000003', 'c4b20000-0000-0000-0000-00000000000a', '1.3', '基礎', 'm3', 100, 3000, true, true, false),
  ('c4b30000-0000-0000-0000-000000000004', 'c4b20000-0000-0000-0000-00000000000a', '1.4', '假設工程', '式', 1, 50000, true, true, false),
  ('c4b30000-0000-0000-0000-000000000005', 'c4b20000-0000-0000-0000-00000000000a', '1', '第一章', null, null, null, false, true, true),
  ('c4b30000-0000-0000-0000-000000000006', 'c4b20000-0000-0000-0000-00000000000a', '1.6', '鋪面', 'm2', 100, 200, true, true, false),
  ('c4b30000-0000-0000-0000-000000000007', 'c4b20000-0000-0000-0000-00000000000a', '1.7', '無單位工項', null, 10, 1, true, true, false),
  ('c4b30000-0000-0000-0000-000000000011', 'c4b20000-0000-0000-0000-00000000000b', '1.1', '混凝土', 'm2', 100, 100, true, true, false);
-- W3 三個必要階段(H 點);R／W 點不構成階段
insert into public.inspection_points (id, project_id, work_item_id, point_type, title, stage_key) values
  ('c4b50000-0000-0000-0000-000000000001', 'c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', 'H', '鋼筋查驗', '鋼筋'),
  ('c4b50000-0000-0000-0000-000000000002', 'c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', 'H', '模板查驗', '模板'),
  ('c4b50000-0000-0000-0000-000000000003', 'c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', 'H', '澆置前查驗', '澆置'),
  ('c4b50000-0000-0000-0000-000000000004', 'c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'R', '文審', 'x'),
  ('c4b50000-0000-0000-0000-000000000005', 'c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'W', '見證', 'y');
select is(public.fn_cq_required_stages_internal('c4b30000-0000-0000-0000-000000000003'), array['模板','澆置','鋼筋']::text[], 'W3 必要階段=三個 H 點(正規化排序)');
select is(public.fn_cq_required_stages_internal('c4b30000-0000-0000-0000-000000000001'), '{}'::text[], 'R／W 點不構成必要階段');
-- W6:核准變更 +50(Qc 150),未核准變更 +1000 不計
insert into public.change_orders (id, project_id, title, status) values
  ('c4b70000-0000-0000-0000-000000000001', 'c4b20000-0000-0000-0000-00000000000a', '追加鋪面', '核准'),
  ('c4b70000-0000-0000-0000-000000000002', 'c4b20000-0000-0000-0000-00000000000a', '未核准追加', '提出');
insert into public.change_order_items (change_order_id, project_id, work_item_id, description, qty_delta) values
  ('c4b70000-0000-0000-0000-000000000001', 'c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000006', '鋪面追加', 50),
  ('c4b70000-0000-0000-0000-000000000002', 'c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000006', '鋪面追加(未核准)', 1000);
select is(public.fn_cq_contract_qty_internal('c4b30000-0000-0000-0000-000000000006'), 150::numeric, '契約量=標單 100＋核准變更 50(未核准不計)');
select is(public.fn_cq_basis_internal('c4b30000-0000-0000-0000-000000000004'), null, '總價類(式×1)缺依據→null(Q3 暫時隔離)');
select is(public.fn_cq_basis_internal('c4b30000-0000-0000-0000-000000000001'), 'inspection', '實體工項缺列→inspection');

create or replace function pg_temp.today() returns date language sql stable as $$ select (now() at time zone 'Asia/Taipei')::date $$;
create or replace function pg_temp.become(u uuid, aal text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated', 'aal', coalesce(aal, 'aal1'))::text end, true);
end $$;
create or replace function pg_temp.st(p uuid, w uuid, v uuid) returns public.cq_item_state language sql as $$
  select public.fn_cq_item_state_internal(p, w, v) $$;
create or replace function pg_temp.codes(v uuid, cp text) returns text[] language sql as $$
  select coalesce(array_agg(e ->> 'code' order by e ->> 'code'), '{}'::text[]) from jsonb_array_elements(public.fn_cq_period_check_internal(v, cp)) e $$;
create or replace function pg_temp.item(s jsonb, w uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(s -> 'items') e where e ->> 'work_item_id' = w::text limit 1 $$;
create or replace function pg_temp.src_qty(v uuid, w uuid, b text, k text) returns numeric language sql as $$
  select qty from public.valuation_item_sources where valuation_id = v and work_item_id = w and batch_key = b and kind = k $$;
create or replace function pg_temp.cum(v uuid, w uuid) returns numeric language sql as $$
  select cum_qty from public.valuation_items where valuation_id = v and work_item_id = w $$;
create or replace function pg_temp.cert(p uuid, w uuid, b text, s text, u text, q numeric, r text, req text, cover uuid default null) returns jsonb language sql as $$
  select public.issue_supervisor_certificate(p, w, b, b, s, u, q, r, req, cover) $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 申報 100 未經監造通過 → 可新增 0;任何路徑都不能送審
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.valuations (id, project_id, period_no, status)
  values ('c4b40000-0000-0000-0000-000000000001', 'c4b20000-0000-0000-0000-00000000000a', 1, '草稿') $$, '廠商建第 1 期草稿');
select throws_ok($$ insert into public.valuations (project_id, period_no, status)
  values ('c4b20000-0000-0000-0000-00000000000a', 99, '已核定') $$, 'VQ002', null, '登入者不可直接建立已核定期(繞過送審／核定)');
select throws_ok($$ insert into public.valuations (project_id, period_no, status, recheck_required)
  values ('c4b20000-0000-0000-0000-00000000000a', 98, '草稿', true) $$, 'VQ010', null, 'recheck 欄位不可自行設定');
-- 舊前端路徑:直接 upsert 明細(P4e 前保留),金額由 DB 算、客戶端金額忽略
select lives_ok($$ insert into public.valuation_items (valuation_id, work_item_id, cum_qty, amount_cum, cum_pct, source)
  values ('c4b40000-0000-0000-0000-000000000001', 'c4b30000-0000-0000-0000-000000000001', 100, 999999, 99, 'daily_log') $$,
  '舊前端／日誌帶入仍可寫草稿明細(P4e 才收回)');
select is((select amount_cum from public.valuation_items where valuation_id = 'c4b40000-0000-0000-0000-000000000001'
  and work_item_id = 'c4b30000-0000-0000-0000-000000000001'), 10000::numeric, '金額由 DB 算 round(100×100)=10000,客戶端 999999 忽略');
select is((select cum_pct from public.valuation_items where valuation_id = 'c4b40000-0000-0000-0000-000000000001'
  and work_item_id = 'c4b30000-0000-0000-0000-000000000001'), 10::numeric, '百分比由 DB 算');
select is((select backing from public.valuation_items where valuation_id = 'c4b40000-0000-0000-0000-000000000001'
  and work_item_id = 'c4b30000-0000-0000-0000-000000000001'), 'legacy', '非重算路徑寫入的數量標 legacy(無依據)');
select throws_ok($$ insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
  values ('c4b40000-0000-0000-0000-000000000001', 'c4b30000-0000-0000-0000-000000000005', 1) $$, 'VQ005', null,
  '非末端／彙總列(契約量 0)不可計價');
select throws_ok($$ insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
  values ('c4b40000-0000-0000-0000-000000000001', 'c4b30000-0000-0000-0000-000000000011', 1) $$, 'VQ008', null,
  '跨專案工項不可寫入明細');
select throws_ok($$ update public.valuation_items set cum_qty = 2000
  where valuation_id = 'c4b40000-0000-0000-0000-000000000001' and work_item_id = 'c4b30000-0000-0000-0000-000000000001' $$,
  'VQ005', null, '超契約量寫入即拒絕');
select throws_ok($$ update public.valuation_items set cum_qty = -1
  where valuation_id = 'c4b40000-0000-0000-0000-000000000001' and work_item_id = 'c4b30000-0000-0000-0000-000000000001' $$,
  'P0001', null, '負值拒絕');
select throws_ok($$ select public.set_valuation_item_cum('c4b40000-0000-0000-0000-000000000001', 'c4b30000-0000-0000-0000-000000000001', 100) $$,
  'VQ006', null, '申報 100 未經監造通過:RPC 上限 0');
select throws_ok($$ update public.valuations set status = '監造審核', period_end = pg_temp.today()
  where id = 'c4b40000-0000-0000-0000-000000000001' $$, 'VQ004', null, '直接 REST 送審:增量 100 無來源 → 擋');
select throws_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000001', '草稿', '監造審核') $$,
  'VQ004', null, 'RPC 送審同樣被擋(檢查在 trigger)');
reset role;
select is((pg_temp.st('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'c4b40000-0000-0000-0000-000000000001')).cap,
  0::numeric, '未通過:cap=0');
select is((pg_temp.st('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'c4b40000-0000-0000-0000-000000000001')).delta,
  100::numeric, '本期增量 100');
select ok(pg_temp.codes('c4b40000-0000-0000-0000-000000000001', 'review') @> array['source_mismatch', 'period_end_missing'],
  '送審檢查列出「缺來源」與「截止日未填」');
-- service role 無 bypass、admin_override 只放行角色
set local role service_role;
select throws_ok($$ update public.valuations set status = '監造審核', period_end = pg_temp.today()
  where id = 'c4b40000-0000-0000-0000-000000000001' $$, 'VQ004', null, 'service role 送審同樣被數量檢查擋下(無 bypass)');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000001', '草稿', '監造審核') $$,
  'VQ004', null, '非正式模式管理者(admin_override)只放行角色,不放行數量');
reset role;
select is((select status from public.valuations where id = 'c4b40000-0000-0000-0000-000000000001'), '草稿', '第 1 期仍是草稿');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. 監造通過 60 → 最多 60;已計價 20 → 剩 40;同批不累加;不同位置不混;改善後只增 40;減量收斂
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become('c4b10000-0000-0000-0000-000000000001', 'aal2');
set local role authenticated;
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'A區', null, 'm2', 60, '依查驗', 'req-1') $$,
  'VQ001', null, '廠商不可簽發確認單');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000003', 'aal2');
set local role authenticated;
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'A區', null, 'm2', 60, '依查驗', 'req-1') $$,
  'VQ001', null, '機關不可簽發確認單');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000004', 'aal2');
set local role authenticated;
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'A區', null, 'm2', 60, '依查驗', 'req-1') $$,
  'VQ008', null, '非成員(監造身分)看不到專案');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'A區', null, 'm2', 60, '  ', 'req-1') $$,
  'VQ005', null, '確認單必須填依據');
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'A區', null, 'm3', 60, '依查驗', 'req-1') $$,
  'P0001', null, '單位不一致(m3≠m2)拒絕');
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'A區', '鋼筋', 'm2', 60, '依查驗', 'req-1') $$,
  'VQ005', null, '單階段工項不可帶階段');
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', '  ', null, 'm2', 60, '依查驗', 'req-1') $$,
  'P0001', null, '批次鍵不可為空');
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000011', 'A區', null, 'm2', 60, '依查驗', 'req-1') $$,
  'VQ008', null, '別案工項(跨專案)拒絕');
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000007', 'A區', null, 'm2', 1, '依查驗', 'req-1') $$,
  'VQ005', null, '工項沒有單位不可簽確認量');
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'A區', null, 'm2', -5, '依查驗', 'req-1') $$,
  'P0001', null, '負數確認量拒絕');
select is((select (pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'A 區', null, 'M2', 60, '依查驗紀錄', 'req-1')) ->> 'qty_delta')::numeric,
  60::numeric, '監造通過 A區 60(批次鍵與單位正規化:「A 區」「M2」)');
select is((select batch_key from public.inspection_confirmations where client_request_id = 'req-1'), 'a區', '批次鍵存成正規化值');
select is((select (pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'A區', null, 'm2', 60, '依查驗紀錄', 'req-1')) ->> 'applied')::boolean,
  false, '重播同一 client_request_id 不重複入帳');
select is((select count(*)::int from public.inspection_confirmations where work_item_id = 'c4b30000-0000-0000-0000-000000000001'), 1, '確認紀錄仍是一筆');
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'A區', null, 'm2', 70, '依查驗紀錄', 'req-1') $$,
  'VQ009', null, '同 client_request_id 不同內容 → 冪等衝突');
reset role;
-- 自動同步:草稿第 1 期的 100(無依據)被確認量 60 取代
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000001', 'c4b30000-0000-0000-0000-000000000001'), 60::numeric, '確認後自動同步:第 1 期累計=60(舊的 100 無依據被取代)');
select is((select backing from public.valuation_items where valuation_id = 'c4b40000-0000-0000-0000-000000000001'
  and work_item_id = 'c4b30000-0000-0000-0000-000000000001'), 'confirmed', '依據標 confirmed');
select is(pg_temp.src_qty('c4b40000-0000-0000-0000-000000000001', 'c4b30000-0000-0000-0000-000000000001', 'a區', 'confirmation'), 60::numeric, '來源分配 A區 60');
select is((select amount_cum from public.valuation_items where valuation_id = 'c4b40000-0000-0000-0000-000000000001'
  and work_item_id = 'c4b30000-0000-0000-0000-000000000001'), 6000::numeric, '金額 60×100');
-- sync 冪等與角色
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000001') $$, '廠商可同步');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000001', 'c4b30000-0000-0000-0000-000000000001'), 60::numeric, '重跑同步結果相同(冪等)');
select is((select count(*)::int from public.valuation_item_sources where valuation_id = 'c4b40000-0000-0000-0000-000000000001'), 1, '來源列不增加');
select throws_ok($$ select public.set_valuation_item_cum('c4b40000-0000-0000-0000-000000000001', 'c4b30000-0000-0000-0000-000000000001', 61) $$,
  'VQ006', null, '通過 60:本期最多 60,61 拒絕');
select lives_ok($$ select public.set_valuation_item_cum('c4b40000-0000-0000-0000-000000000001', 'c4b30000-0000-0000-0000-000000000001', 20) $$,
  '廠商在上限內調整為 20');
select is((pg_temp.item(public.get_valuation_state('c4b40000-0000-0000-0000-000000000001'), 'c4b30000-0000-0000-0000-000000000001') ->> 'cap')::numeric, 60::numeric, 'get_valuation_state:cap 60');
select is((pg_temp.item(public.get_valuation_state('c4b40000-0000-0000-0000-000000000001'), 'c4b30000-0000-0000-0000-000000000001') ->> 'headroom')::numeric, 40::numeric, 'get_valuation_state:還可再加 40');
select is((pg_temp.item(public.get_valuation_state('c4b40000-0000-0000-0000-000000000001'), 'c4b30000-0000-0000-0000-000000000001') ->> 'delta')::numeric, 20::numeric, 'get_valuation_state:本期增量 20');
select is(jsonb_array_length(pg_temp.item(public.get_valuation_state('c4b40000-0000-0000-0000-000000000001'), 'c4b30000-0000-0000-0000-000000000001') -> 'sources'), 1, 'get_valuation_state:來源展開 1 筆');
select is(((select e from jsonb_array_elements(public.list_billable_backlog('c4b20000-0000-0000-0000-00000000000a')) e
  where e ->> 'work_item_id' = 'c4b30000-0000-0000-0000-000000000001') ->> 'available')::numeric, 40::numeric, '可估驗清單:W1 尚可計價 40(60 − 草稿占用 20)');
select is(((select e from jsonb_array_elements(public.list_billable_backlog('c4b20000-0000-0000-0000-00000000000a')) e
  where e ->> 'work_item_id' = 'c4b30000-0000-0000-0000-000000000001') -> 'occupied_by' -> 0 ->> 'period_no')::int, 1, '可估驗清單:標示被第 1 期草稿占用');
select throws_ok($$ update public.valuations set status = '監造審核' where id = 'c4b40000-0000-0000-0000-000000000001' $$,
  'VQ004', null, '截止日未填不可送審');
select lives_ok($$ update public.valuations set status = '監造審核', period_end = pg_temp.today() where id = 'c4b40000-0000-0000-0000-000000000001' $$,
  '廠商補截止日並送審(增量 20=來源 20)');
select throws_ok($$ update public.valuations set status = '草稿' where id = 'c4b40000-0000-0000-0000-000000000001' $$, 'P0001', null, '廠商不可自行退回');
select throws_ok($$ update public.valuations set status = '已核定' where id = 'c4b40000-0000-0000-0000-000000000001' $$, 'P0001', null, '廠商不可核定');
select throws_ok($$ update public.valuations set period_end = pg_temp.today() + 1 where id = 'c4b40000-0000-0000-0000-000000000001' $$, 'VQ010', null, '送審後截止日不可改');
select throws_ok($$ update public.valuation_items set cum_qty = 30 where valuation_id = 'c4b40000-0000-0000-0000-000000000001' $$, 'P0001', null, '送審中明細凍結(直接寫)');
select throws_ok($$ delete from public.valuation_items where valuation_id = 'c4b40000-0000-0000-0000-000000000001' $$, 'P0001', null, '送審中明細不可刪');
select throws_ok($$ insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
  values ('c4b40000-0000-0000-0000-000000000001', 'c4b30000-0000-0000-0000-000000000002', 1) $$, 'P0001', null, '送審中不可追加明細');
select throws_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000001') $$, 'VQ010', null, '送審中不可同步');
select throws_ok($$ select public.set_valuation_item_cum('c4b40000-0000-0000-0000-000000000001', 'c4b30000-0000-0000-0000-000000000001', 30) $$, 'VQ010', null, '送審中不可改量');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000001') $$, 'VQ010', null, '監造(can_write 允許協助填報)也不能動送審中的期別');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ update public.valuations set status = '已核定' where id = 'c4b40000-0000-0000-0000-000000000001' $$, 'P0001', null, '機關不可核定');
select throws_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000001') $$, 'VQ001', null, '機關不可同步');
select lives_ok($$ select public.list_billable_backlog('c4b20000-0000-0000-0000-00000000000a') $$, '機關(成員)可讀可估驗清單');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ select public.get_valuation_state('c4b40000-0000-0000-0000-000000000001') $$, 'VQ008', null, '非成員讀期別狀態 → 找不到');
select throws_ok($$ select public.list_billable_backlog('c4b20000-0000-0000-0000-00000000000a') $$, 'VQ008', null, '非成員讀可估驗清單 → 找不到');
select throws_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000001') $$, 'VQ008', null, '非成員同步 → 找不到');
select is((select count(*)::int from public.inspection_confirmations), 0, '非成員看不到任何確認紀錄(RLS)');
select is((select count(*)::int from public.valuation_item_sources), 0, '非成員看不到任何來源分配(RLS)');
reset role;

-- 送審中的期別不被後續確認靜默改寫;同批多次查驗不累加
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select is((select (pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'A區', null, 'm2', 60, '第二次查驗同批', 'req-1b')) ->> 'qty_delta')::numeric,
  0::numeric, '同一批第二次查驗簽同樣累計 60:增量 0');
reset role;
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000001', 'c4b30000-0000-0000-0000-000000000001'), 20::numeric, '送審中的第 1 期不被改寫(仍 20)');
select is((pg_temp.st('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', null)).effective_now, 60::numeric, '有效確認量仍 60,不累加');
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ update public.valuations set status = '已核定' where id = 'c4b40000-0000-0000-0000-000000000001' $$, '監造核定第 1 期(已計價 20)');
reset role;
select is((select count(*)::int from public.audit_events where entity_id = 'c4b40000-0000-0000-0000-000000000001' and event_type = 'valuation.approved'), 1, '核定留稽核');

-- 已計價 20 → 第 2 期最多 40
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('c4b40000-0000-0000-0000-000000000002', 'c4b20000-0000-0000-0000-00000000000a', 2, pg_temp.today(), '草稿');
select is(((select e from jsonb_array_elements(public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000002') -> 'items') e
  where e ->> 'work_item_id' = 'c4b30000-0000-0000-0000-000000000001') ->> 'cap')::numeric, 40::numeric, '第 2 期上限 = 60 − 已計價 20 = 40');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000002', 'c4b30000-0000-0000-0000-000000000001'), 60::numeric, '第 2 期累計 60(增量 40)');
select is(pg_temp.src_qty('c4b40000-0000-0000-0000-000000000002', 'c4b30000-0000-0000-0000-000000000001', 'a區', 'confirmation'), 40::numeric, '第 2 期來源 A區 40');
reset role;
-- 不同位置同工項不誤混:B區 30 → 自動進第 2 期草稿
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select lives_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'B區', null, 'm2', 30, '依查驗', 'req-2') $$, 'B區通過 30');
reset role;
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000002', 'c4b30000-0000-0000-0000-000000000001'), 90::numeric, '第 2 期累計 90(A 40＋B 30,各批相加)');
select is((select count(*)::int from public.valuation_item_sources where valuation_id = 'c4b40000-0000-0000-0000-000000000002' and work_item_id = 'c4b30000-0000-0000-0000-000000000001'), 2, '兩個批次各一筆來源');
-- 不合格 40 改善後通過:A區累計 100 → 只增 40
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select is((select (pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'A區', null, 'm2', 100, '複查通過', 'req-3')) ->> 'qty_delta')::numeric, 40::numeric, '複查簽累計 100:增量 40');
reset role;
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000002', 'c4b30000-0000-0000-0000-000000000001'), 130::numeric, '第 2 期累計 130(只增新確認的 40,不再累加先前 60)');
select is(pg_temp.src_qty('c4b40000-0000-0000-0000-000000000002', 'c4b30000-0000-0000-0000-000000000001', 'a區', 'confirmation'), 80::numeric, 'A區來源 80(40＋40)');
-- 減量(重簽較小累計):草稿期最晚分配先減
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select is((select (pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'A區', null, 'm2', 90, '複查減量', 'req-4')) ->> 'qty_delta')::numeric, -10::numeric, '減量簽累計 90:增量 −10');
reset role;
select is(pg_temp.src_qty('c4b40000-0000-0000-0000-000000000002', 'c4b30000-0000-0000-0000-000000000001', 'a區', 'confirmation'), 70::numeric, '草稿第 2 期 A區分配縮減為 70(第 1 期已核定的 20 不動)');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000002', 'c4b30000-0000-0000-0000-000000000001'), 120::numeric, '第 2 期累計 120');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. 多階段必要查驗(W3:鋼筋→模板→澆置)
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select lives_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', 'F1', '鋼筋', 'm3', 50, '鋼筋查驗', 'req-5') $$, 'F1 鋼筋階段 50');
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', 'F1', '養護', 'm3', 50, 'x', 'req-5x') $$, 'VQ005', null, '不在 ITP 的階段拒絕');
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', 'F1', null, 'm3', 50, 'x', 'req-5y') $$, 'VQ005', null, '多階段工項不可無階段');
reset role;
select is((pg_temp.st('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', null)).effective_now, 0::numeric, '缺模板／澆置階段:有效量 0');
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select is(jsonb_array_length((select e from jsonb_array_elements(public.list_billable_backlog('c4b20000-0000-0000-0000-00000000000a')) e
  where e ->> 'work_item_id' = 'c4b30000-0000-0000-0000-000000000003') -> 'batches' -> 0 -> 'missing_stages'), 2, '可估驗清單標示缺 2 個階段');
select ok(((select e from jsonb_array_elements(public.list_billable_backlog('c4b20000-0000-0000-0000-00000000000a')) e
  where e ->> 'work_item_id' = 'c4b30000-0000-0000-0000-000000000003') -> 'batches' -> 0 -> 'missing_stages') @> '["模板","澆置"]'::jsonb, '缺的是模板與澆置');
select lives_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', 'F1', '模板', 'm3', 50, '模板查驗', 'req-6') $$, 'F1 模板 50');
select lives_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', 'F1', '澆置', 'm3', 40, '澆置前查驗', 'req-7') $$, 'F1 澆置 40');
reset role;
select is((pg_temp.st('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', null)).effective_now, 40::numeric, '三階段齊全取最小=40');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000002', 'c4b30000-0000-0000-0000-000000000003'), 40::numeric, 'W3 自動進第 2 期 40');
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select lives_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', 'F1', '澆置', 'm3', 60, '澆置追加', 'req-8') $$, 'F1 澆置 60');
reset role;
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000002', 'c4b30000-0000-0000-0000-000000000003'), 50::numeric, '澆置 60 後有效量=min(50,50,60)=50');
-- 撤銷最新的澆置 60 → 回到前一筆 40
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.revoke_inspection_confirmation((select id from public.inspection_confirmations where client_request_id = 'req-8'), '澆置量誤植') $$, '監造撤銷澆置 60');
reset role;
select is((pg_temp.st('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', null)).effective_now, 40::numeric, '撤銷後回到前一筆累計 40');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000002', 'c4b30000-0000-0000-0000-000000000003'), 40::numeric, '草稿第 2 期 W3 縮減為 40');

-- 第 2 期送審／核定(W1 增量 100=A 70＋B 30;W3 40)
select is(pg_temp.codes('c4b40000-0000-0000-0000-000000000002', 'review'), '{}'::text[], '第 2 期送審檢查無違反');
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000002', '草稿', '監造審核') $$, '廠商送第 2 期');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000002', '監造審核', '已核定') $$, '監造核定第 2 期');
reset role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 截止日:確認日晚於截止日不計價
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('c4b40000-0000-0000-0000-000000000003', 'c4b20000-0000-0000-0000-00000000000a', 3, pg_temp.today() - 1, '草稿');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select lives_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000002', 'L1', null, 'kg', 200, '依查驗', 'req-9') $$, 'W2 L1 通過 200(今天)');
reset role;
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000003', 'c4b30000-0000-0000-0000-000000000002'), null, '截止日昨天的草稿不是自動同步目標');
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000003') $$, '同步截止日昨天的第 3 期');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000003', 'c4b30000-0000-0000-0000-000000000002'), null, '截止日前無確認 → 不建明細');
select throws_ok($$ select public.set_valuation_item_cum('c4b40000-0000-0000-0000-000000000003', 'c4b30000-0000-0000-0000-000000000002', 200) $$, 'VQ006', null, '截止日不符:上限 0');
select lives_ok($$ update public.valuations set period_end = pg_temp.today() where id = 'c4b40000-0000-0000-0000-000000000003' $$, '草稿可改截止日');
select lives_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000003') $$, '截止日改今天後同步');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000003', 'c4b30000-0000-0000-0000-000000000002'), 200::numeric, 'W2 第 3 期 200');
reset role;
-- 內部旗標也擋不住截止日(列級 guard)
update public.valuations set period_end = pg_temp.today() - 1 where id = 'c4b40000-0000-0000-0000-000000000003';
select set_config('pmis.cq_internal', '1', true);
select throws_ok($$ insert into public.valuation_item_sources (project_id, valuation_id, work_item_id, batch_key, qty, kind)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b40000-0000-0000-0000-000000000003', 'c4b30000-0000-0000-0000-000000000002', 'L1', 10, 'confirmation') $$,
  'VQ004', null, '列級 guard:超出截止日前有效量的分配拒絕(即使是內部重算路徑)');
select set_config('pmis.cq_internal', '', true);
update public.valuations set period_end = pg_temp.today() where id = 'c4b40000-0000-0000-0000-000000000003';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. 撤銷／減量:草稿縮減、送審中標記 recheck、已核定走調整;作廢;刪草稿釋放
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select lives_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000002', 'L2', null, 'kg', 100, '依查驗', 'req-10') $$, 'W2 L2 通過 100');
reset role;
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000003', 'c4b30000-0000-0000-0000-000000000002'), 300::numeric, '自動同步:第 3 期 300');
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ select public.revoke_inspection_confirmation((select id from public.inspection_confirmations where client_request_id = 'req-10'), '不算') $$, 'VQ001', null, '廠商不可撤銷確認');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ select public.revoke_inspection_confirmation('00000000-0000-0000-0000-000000000000', 'x') $$, 'VQ008', null, '非成員撤銷 → 找不到');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$ select public.revoke_inspection_confirmation((select id from public.inspection_confirmations where client_request_id = 'req-10'), ' ') $$, 'VQ005', null, '撤銷必填原因');
select is((select (public.revoke_inspection_confirmation((select id from public.inspection_confirmations where client_request_id = 'req-10'), '查驗程序瑕疵')) ->> 'applied')::boolean, true, '監造撤銷 L2');
select is((select (public.revoke_inspection_confirmation((select id from public.inspection_confirmations where client_request_id = 'req-10'), '再撤一次')) ->> 'applied')::boolean, false, '重複撤銷不重複處理');
reset role;
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000003', 'c4b30000-0000-0000-0000-000000000002'), 200::numeric, '草稿第 3 期縮減為 200');
select is(pg_temp.src_qty('c4b40000-0000-0000-0000-000000000003', 'c4b30000-0000-0000-0000-000000000002', 'l2', 'confirmation'), null, 'L2 來源釋放');
select is((select status from public.inspection_confirmations where client_request_id = 'req-10'), 'revoked', '確認紀錄留痕為 revoked');
-- 送審中被減量 → recheck,核定擋,退回重算後清除
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000003', '草稿', '監造審核') $$, '送第 3 期');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select lives_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000002', 'L1', null, 'kg', 150, '複查減量', 'req-11') $$, 'L1 減量為 150(第 3 期送審中)');
reset role;
select is((select recheck_required from public.valuations where id = 'c4b40000-0000-0000-0000-000000000003'), true, '送審中期別標 recheck_required');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000003', 'c4b30000-0000-0000-0000-000000000002'), 200::numeric, '送審中的數字不被改寫');
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000003', '監造審核', '已核定') $$, 'VQ004', null, 'recheck 未清除不可核定');
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000003', '監造審核', '草稿') $$, '監造退回第 3 期');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000003') $$, '廠商重算');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000003', 'c4b30000-0000-0000-0000-000000000002'), 150::numeric, '重算後 150');
select is((select recheck_required from public.valuations where id = 'c4b40000-0000-0000-0000-000000000003'), false, 'recheck 清除');
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000003', '草稿', '監造審核') $$, '再送審');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000003', '監造審核', '已核定') $$, '核定第 3 期(W2 已計價 150)');
-- 已核定後撤銷 → 保留歷史,建立 pending 調整
select lives_ok($$ select public.revoke_inspection_confirmation((select id from public.inspection_confirmations where client_request_id = 'req-9'), '舊紀錄已被 150 取代') $$, '撤銷被取代的 L1 200 列');
reset role;
select is((select count(*)::int from public.valuation_adjustments), 0, '撤銷非最新列不影響有效量,不產生調整');
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.revoke_inspection_confirmation((select id from public.inspection_confirmations where client_request_id = 'req-11'), '查驗不成立') $$, '撤銷 L1 150(已核定使用中)');
reset role;
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000003', 'c4b30000-0000-0000-0000-000000000002'), 150::numeric, '已核定期數字保留');
select is((select qty_delta from public.valuation_adjustments where origin_valuation_id = 'c4b40000-0000-0000-0000-000000000003'), -150::numeric, '產生 pending 調整 −150');
select is((select status from public.valuation_adjustments where origin_valuation_id = 'c4b40000-0000-0000-0000-000000000003'), 'pending', '狀態 pending');
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('c4b40000-0000-0000-0000-000000000004', 'c4b20000-0000-0000-0000-00000000000a', 4, pg_temp.today(), '草稿');
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000004', '草稿', '監造審核') $$, '第 4 期(空)送審');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000004', '監造審核', '已核定') $$, 'VQ004', null, '有 pending 調整不可核定');
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000004', '監造審核', '草稿') $$, '退回第 4 期');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select is((public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000004') ->> 'adjustments_applied')::int, 1, '同步第 4 期併入 1 筆扣回');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000004', 'c4b30000-0000-0000-0000-000000000002'), 0::numeric, '第 4 期 W2 累計 0(150 − 150)');
select is(pg_temp.src_qty('c4b40000-0000-0000-0000-000000000004', 'c4b30000-0000-0000-0000-000000000002', 'l1', 'clawback'), -150::numeric, '扣回來源 −150');
reset role;
select is((pg_temp.st('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000002', 'c4b40000-0000-0000-0000-000000000004')).delta, -150::numeric, '增量 −150');
select is(pg_temp.codes('c4b40000-0000-0000-0000-000000000004', 'review'), '{}'::text[], '負增量有扣回來源 → 無違反');
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000004', '草稿', '監造審核') $$, '送第 4 期');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000004', '監造審核', '已核定') $$, '核定第 4 期(扣回入帳)');
reset role;
select is((select status from public.valuation_adjustments where origin_valuation_id = 'c4b40000-0000-0000-0000-000000000003'), 'applied', '調整已 applied');
-- 作廢(機關):接受已計價量,不再阻擋核定與請款,但永不產生新的可用量
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select lives_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000002', 'L3', null, 'kg', 100, '依查驗', 'req-12') $$, 'W2 L3 100');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('c4b40000-0000-0000-0000-000000000005', 'c4b20000-0000-0000-0000-00000000000a', 5, pg_temp.today(), '草稿');
select lives_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000005') $$, '同步第 5 期');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000005', 'c4b30000-0000-0000-0000-000000000002'), 100::numeric, '第 5 期 W2 100(前期 0＋L3 100)');
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000005', '草稿', '監造審核') $$, '送第 5 期');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000005', '監造審核', '已核定') $$, '核定第 5 期');
select lives_ok($$ select public.revoke_inspection_confirmation((select id from public.inspection_confirmations where client_request_id = 'req-12'), '查驗不成立') $$, '撤銷 L3');
reset role;
select is((select count(*)::int from public.valuation_adjustments where origin_valuation_id = 'c4b40000-0000-0000-0000-000000000005' and status = 'pending'), 1, 'L3 產生 pending 調整');
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ select public.void_valuation_adjustment((select id from public.valuation_adjustments where origin_valuation_id = 'c4b40000-0000-0000-0000-000000000005'), '不扣') $$, 'VQ001', null, '廠商不可作廢調整');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ select public.void_valuation_adjustment((select id from public.valuation_adjustments where origin_valuation_id = 'c4b40000-0000-0000-0000-000000000005'), ' ') $$, 'VQ005', null, '作廢必填原因');
select is((select (public.void_valuation_adjustment((select id from public.valuation_adjustments where origin_valuation_id = 'c4b40000-0000-0000-0000-000000000005'), '機關同意不扣回')) ->> 'applied')::boolean, true, '機關作廢調整');
select is((select (public.void_valuation_adjustment((select id from public.valuation_adjustments where origin_valuation_id = 'c4b40000-0000-0000-0000-000000000005'), '再作廢')) ->> 'applied')::boolean, false, '重複作廢不處理');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('c4b40000-0000-0000-0000-000000000006', 'c4b20000-0000-0000-0000-00000000000a', 6, pg_temp.today(), '草稿');
select lives_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000006') $$, '同步第 6 期');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000006', 'c4b30000-0000-0000-0000-000000000002'), null, '作廢後 W2 不產生新可用量(E 0、已計價 100)');
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000006', '草稿', '監造審核') $$, '送第 6 期');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000006', '監造審核', '已核定') $$, '作廢後核定不再被擋');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$ update public.valuations set invoice_date = pg_temp.today() where id = 'c4b40000-0000-0000-0000-000000000005' $$, '作廢後第 5 期可登錄請款日');
reset role;
-- 刪除草稿:釋放占用;已併入的扣回回到 pending(W3 加簽澆置 60 → 第 7 期 +10 → 撤銷 → 第 8 期扣回 → 刪第 8 期)
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select lives_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', 'F1', '澆置', 'm3', 60, '澆置補簽', 'req-13') $$, 'W3 澆置再簽 60');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('c4b40000-0000-0000-0000-000000000007', 'c4b20000-0000-0000-0000-00000000000a', 7, pg_temp.today(), '草稿');
select lives_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000007') $$, '同步第 7 期');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000007', 'c4b30000-0000-0000-0000-000000000003'), 50::numeric, '第 7 期 W3 50(＋10)');
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000007', '草稿', '監造審核') $$, '送第 7 期');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000007', '監造審核', '已核定') $$, '核定第 7 期');
select lives_ok($$ select public.revoke_inspection_confirmation((select id from public.inspection_confirmations where client_request_id = 'req-13'), '澆置補簽有誤') $$, '撤銷澆置 60');
reset role;
select is((select qty_delta from public.valuation_adjustments where origin_valuation_id = 'c4b40000-0000-0000-0000-000000000007'), -10::numeric, '第 7 期產生調整 −10');
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('c4b40000-0000-0000-0000-000000000008', 'c4b20000-0000-0000-0000-00000000000a', 8, pg_temp.today(), '草稿');
select lives_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000008') $$, '同步第 8 期(併入扣回)');
select is((select status from public.valuation_adjustments where origin_valuation_id = 'c4b40000-0000-0000-0000-000000000007'), 'applied', '扣回已併入第 8 期');
select lives_ok($$ delete from public.valuations where id = 'c4b40000-0000-0000-0000-000000000008' $$, '廠商刪除第 8 期草稿');
reset role;
select is((select status from public.valuation_adjustments where origin_valuation_id = 'c4b40000-0000-0000-0000-000000000007'), 'pending', '刪草稿後扣回回到 pending(不消失)');
select is((select count(*)::int from public.valuation_item_sources where valuation_id = 'c4b40000-0000-0000-0000-000000000008'), 0, '草稿的來源分配隨期別釋放');
select pg_temp.become('c4b10000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$ select public.void_valuation_adjustment((select id from public.valuation_adjustments where origin_valuation_id = 'c4b40000-0000-0000-0000-000000000007'), '機關同意不扣回') $$, '機關作廢第 7 期調整');
reset role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. 舊資料過渡(案 B):legacy 來源=歷史遷移;請款須人工補證;草稿無依據數量送審被擋
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become(null);
insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('c4b40000-0000-0000-0000-000000000011', 'c4b20000-0000-0000-0000-00000000000b', 1, pg_temp.today(), '草稿');
insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
  values ('c4b40000-0000-0000-0000-000000000011', 'c4b30000-0000-0000-0000-000000000011', 50);
alter table public.valuations disable trigger valuations_checkpoint_guard;   -- 遷移前的歷史核定
update public.valuations set status = '已核定' where id = 'c4b40000-0000-0000-0000-000000000011';
alter table public.valuations enable trigger valuations_checkpoint_guard;
select is(public.fn_cq_backfill_legacy_internal('c4b20000-0000-0000-0000-00000000000b'), 1, '回填 1 筆 legacy 來源');
select is(public.fn_cq_backfill_legacy_internal('c4b20000-0000-0000-0000-00000000000b'), 0, '回填冪等');
select is(pg_temp.src_qty('c4b40000-0000-0000-0000-000000000011', 'c4b30000-0000-0000-0000-000000000011', '__legacy__', 'legacy'), 50::numeric, 'legacy 來源 50(標明歷史遷移)');
select is((pg_temp.st('c4b20000-0000-0000-0000-00000000000b', 'c4b30000-0000-0000-0000-000000000011', null)).billed, 50::numeric, '已計價 50 計入 B');
select is((pg_temp.st('c4b20000-0000-0000-0000-00000000000b', 'c4b30000-0000-0000-0000-000000000011', null)).cap, 0::numeric, '無確認 → 可新增 0');
select pg_temp.become('c4b10000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ update public.valuations set invoice_date = pg_temp.today() where id = 'c4b40000-0000-0000-0000-000000000011' $$, 'VQ004', null, '歷史已核定期新請款:缺依據明示擋下');
reset role;
select ok(pg_temp.codes('c4b40000-0000-0000-0000-000000000011', 'invoice') @> array['legacy_source'], '請款檢查列出 legacy_source');
select pg_temp.become('c4b10000-0000-0000-0000-000000000007', 'aal2');
set local role authenticated;
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000b', 'c4b30000-0000-0000-0000-000000000011', '補證批次', null, 'm2', 40, '補證:既有紀錄', 'req-b1', 'c4b40000-0000-0000-0000-000000000011') $$,
  'VQ004', null, '補證確認量 40 不足以涵蓋歷史 50 → 整筆拒絕');
select is((select count(*)::int from public.inspection_confirmations where project_id = 'c4b20000-0000-0000-0000-00000000000b'), 0, '被拒絕的補證不留確認紀錄');
select lives_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000b', 'c4b30000-0000-0000-0000-000000000011', '補證批次', null, 'm2', 50, '補證:既有紀錄', 'req-b2', 'c4b40000-0000-0000-0000-000000000011') $$,
  '監造確認單 50 補證歷史期');
reset role;
select is(pg_temp.src_qty('c4b40000-0000-0000-0000-000000000011', 'c4b30000-0000-0000-0000-000000000011', '__legacy__', 'legacy'), null, 'legacy 來源已改掛');
select is(pg_temp.src_qty('c4b40000-0000-0000-0000-000000000011', 'c4b30000-0000-0000-0000-000000000011', '補證批次', 'confirmation'), 50::numeric, '改掛到確認單批次 50(數量不變)');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000011', 'c4b30000-0000-0000-0000-000000000011'), 50::numeric, '歷史期累計不變');
select is((select backing from public.valuation_items where valuation_id = 'c4b40000-0000-0000-0000-000000000011'), 'confirmed', '依據改為 confirmed');
select pg_temp.become('c4b10000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$ update public.valuations set invoice_date = pg_temp.today() where id = 'c4b40000-0000-0000-0000-000000000011' $$, '補證後可登錄請款日');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('c4b40000-0000-0000-0000-000000000012', 'c4b20000-0000-0000-0000-00000000000b', 2, pg_temp.today(), '草稿');
insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
  values ('c4b40000-0000-0000-0000-000000000012', 'c4b30000-0000-0000-0000-000000000011', 80);
select throws_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000012', '草稿', '監造審核') $$, 'VQ004', null, '舊前端寫的 80 無來源 → 送審擋');
select lives_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000012') $$, '重算');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000012', 'c4b30000-0000-0000-0000-000000000011'), 50::numeric, '重算後累計=前期 50(確認 50 已全數計價)');
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000012', '草稿', '監造審核') $$, '增量 0 可送審');
reset role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. 總價／間接費隔離(Q3)與計價依據;核准變更後契約量;無單位工項
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select lives_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000004', '全案', null, '式', 1, '完成', 'req-14') $$, '總價工項可簽確認單');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('c4b40000-0000-0000-0000-000000000009', 'c4b20000-0000-0000-0000-00000000000a', 9, pg_temp.today(), '草稿');
select lives_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000009') $$, '同步第 9 期');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000009', 'c4b30000-0000-0000-0000-000000000004'), null, '缺計價依據 → 不分配');
select is(pg_temp.item(public.get_valuation_state('c4b40000-0000-0000-0000-000000000009'), 'c4b30000-0000-0000-0000-000000000004') ->> 'basis', null, '狀態顯示依據待設定(null)');
select is((pg_temp.item(public.get_valuation_state('c4b40000-0000-0000-0000-000000000009'), 'c4b30000-0000-0000-0000-000000000004') ->> 'cap')::numeric, 0::numeric, 'cap 0');
select throws_like($$ select public.set_valuation_item_cum('c4b40000-0000-0000-0000-000000000009', 'c4b30000-0000-0000-0000-000000000004', 1) $$, '%隔離%', '缺依據不放行並說明隔離');
select throws_ok($$ select public.set_work_item_pricing_basis('c4b30000-0000-0000-0000-000000000004', 'supervisor_certificate') $$, 'VQ001', null, '廠商不可設定計價依據');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$ select public.set_work_item_pricing_basis('c4b30000-0000-0000-0000-000000000004', 'bogus') $$, 'VQ005', null, '依據值不明拒絕');
select lives_ok($$ select public.set_work_item_pricing_basis('c4b30000-0000-0000-0000-000000000004', 'supervisor_certificate', '{"clause":"契約第X條"}') $$, '監造設定依據');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ select public.sync_valuation_from_confirmations('c4b40000-0000-0000-0000-000000000009') $$, '再同步');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000009', 'c4b30000-0000-0000-0000-000000000004'), 1::numeric, '設定依據後可計價 1');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select lives_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000006', 'R1', null, 'm2', 200, '依查驗', 'req-15') $$, 'W6 確認 200');
reset role;
select is((pg_temp.st('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000006', null)).effective_now, 150::numeric, '有效量受契約量(100＋核准變更 50)約束=150');
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000009', 'c4b30000-0000-0000-0000-000000000006'), 150::numeric, '第 9 期 W6 150');
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ select public.set_valuation_item_cum('c4b40000-0000-0000-0000-000000000009', 'c4b30000-0000-0000-0000-000000000006', 160) $$, 'VQ005', null, '超契約量拒絕');
reset role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. 工項／ITP guard 與標單重匯
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become(null);
select throws_ok($$ delete from public.work_items where id = 'c4b30000-0000-0000-0000-000000000001' $$, 'VQ010', null, '有有效確認的工項不可刪');
select throws_ok($$ update public.work_items set unit = 'm3' where id = 'c4b30000-0000-0000-0000-000000000001' $$, 'VQ010', null, '有有效確認的工項不可改單位');
select lives_ok($$ update public.work_items set description = '混凝土(改名)' where id = 'c4b30000-0000-0000-0000-000000000001' $$, '改名不受影響');
select pg_temp.become('c4b10000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$ select public.reset_project_boq('c4b20000-0000-0000-0000-00000000000a') $$, 'VQ010', null, '標單重設被有效確認擋下(先撤銷)');
reset role;
select is((select count(*)::int from public.work_items where project_id = 'c4b20000-0000-0000-0000-00000000000a'), 7, '重設被擋後工項原封不動(原子)');
select pg_temp.become(null);
select throws_ok($$ insert into public.inspection_points (project_id, work_item_id, point_type, title, stage_key)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', 'H', '養護', '養護') $$, 'VQ010', null,
  '有有效確認的工項不可新增必要階段');
select lives_ok($$ update public.inspection_points set title = '鋼筋查驗(改)' where id = 'c4b50000-0000-0000-0000-000000000001' $$, '改標題不影響階段集合');
select lives_ok($$ insert into public.inspection_points (project_id, work_item_id, point_type, title, stage_key)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000003', 'W', '見證', '見證') $$, 'W 點不構成階段,可加');
select lives_ok($$ insert into public.inspection_points (project_id, work_item_id, point_type, title, stage_key)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000002', 'H', '鋼筋', '綁紮') $$, 'W2 目前無有效確認,可加階段');

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. 直接寫表:authenticated 42501;service role 經 guard;superuser 不可改寫確認紀錄
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, confirmed_by)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'Z', 'm2', 1, 'supervisor_certificate', 'c4b10000-0000-0000-0000-000000000002') $$,
  '42501', null, 'authenticated 不可直接寫確認紀錄');
select throws_ok($$ update public.inspection_confirmations set qty_cum = 999 $$, '42501', null, 'authenticated 不可改確認紀錄');
select throws_ok($$ delete from public.inspection_confirmations $$, '42501', null, 'authenticated 不可刪確認紀錄');
select throws_ok($$ insert into public.valuation_item_sources (project_id, valuation_id, work_item_id, batch_key, qty, kind)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b40000-0000-0000-0000-000000000009', 'c4b30000-0000-0000-0000-000000000006', 'r1', 1, 'confirmation') $$,
  '42501', null, 'authenticated 不可直接寫來源分配');
select throws_ok($$ insert into public.valuation_adjustments (project_id, work_item_id, batch_key, qty_delta, reason)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000006', 'r1', 1, 'x') $$, '42501', null, 'authenticated 不可直接寫調整');
select throws_ok($$ insert into public.work_item_pricing_basis (work_item_id, project_id, basis)
  values ('c4b30000-0000-0000-0000-000000000006', 'c4b20000-0000-0000-0000-00000000000a', 'excluded') $$, '42501', null, 'authenticated 不可直接寫計價依據');
select cmp_ok((select count(*)::int from public.inspection_confirmations), '>', 0, '成員可讀本案確認紀錄');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000007');
set local role authenticated;
select is((select count(*)::int from public.inspection_confirmations where project_id = 'c4b20000-0000-0000-0000-00000000000a'), 0, '別案監造(只是案 B 成員)看不到案 A 的確認紀錄(RLS)');
reset role;
select pg_temp.become(null);
insert into public.inspections (id, project_id, work_item_id, title, status) values
  ('c4b60000-0000-0000-0000-000000000001', 'c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'C區查驗', '待查驗');
set local role service_role;
select throws_ok($$ insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, confirmed_by)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'C區', 'm2', 10, 'inspection', 'c4b10000-0000-0000-0000-000000000002') $$,
  'VQ005', null, 'service:查驗依據必須連結查驗');
select throws_ok($$ insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, inspection_id, confirmed_by)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'C區', 'm2', 10, 'inspection', 'c4b60000-0000-0000-0000-000000000001', 'c4b10000-0000-0000-0000-000000000002') $$,
  'VQ005', null, 'service:查驗未判定不可寫確認量');
reset role;
select pg_temp.become(null);
update public.inspections set status = '合格' where id = 'c4b60000-0000-0000-0000-000000000001';
set local role service_role;
select throws_ok($$ insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, inspection_id, confirmed_by)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'C區', 'm2', 10, 'inspection', 'c4b60000-0000-0000-0000-000000000001', 'c4b10000-0000-0000-0000-000000000001') $$,
  'VQ001', null, 'service:確認人非監造成員拒絕');
select throws_ok($$ insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, inspection_id, confirmed_by)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'C區', 'm2', 10, 'inspection', 'c4b60000-0000-0000-0000-000000000001', 'c4b10000-0000-0000-0000-000000000007') $$,
  'VQ001', null, 'service:別案監造不是本案成員拒絕');
select lives_ok($$ insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, inspection_id, confirmed_by)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'C區', 'm2', 10, 'inspection', 'c4b60000-0000-0000-0000-000000000001', 'c4b10000-0000-0000-0000-000000000002') $$,
  'service(簽署路徑):查驗判定後由監造成員確認 C區 10');
select throws_ok($$ insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, inspection_id, confirmed_by)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'C區', 'm2', 10, 'inspection', 'c4b60000-0000-0000-0000-000000000001', 'c4b10000-0000-0000-0000-000000000002') $$,
  '23505', null, '重播同一查驗同工項同階段 → 唯一鍵擋');
select throws_ok($$ insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, confirmed_by)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'C區', 'm2', 5, 'supervisor_certificate', 'c4b10000-0000-0000-0000-000000000002') $$,
  'VQ005', null, 'service:減量未填原因拒絕');
select throws_ok($$ insert into public.valuation_item_sources (project_id, valuation_id, work_item_id, batch_key, qty, kind)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b40000-0000-0000-0000-000000000009', 'c4b30000-0000-0000-0000-000000000001', 'c區', 1, 'confirmation') $$,
  'VQ010', null, 'service:來源分配只能由重算寫入');
reset role;
select pg_temp.become(null);
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000009', 'c4b30000-0000-0000-0000-000000000001'), 130::numeric, '查驗確認 C區 10 自動進第 9 期(前期 120＋10)');
select throws_ok($$ delete from public.inspection_confirmations where client_request_id = 'req-1' $$, 'VQ010', null, 'superuser 也不可刪確認紀錄');
select throws_ok($$ update public.inspection_confirmations set qty_cum = 1 where client_request_id = 'req-1' $$, 'VQ010', null, 'superuser 也不可改確認量');
select throws_ok($$ update public.inspection_confirmations set status = 'active', revoked_at = null, reason = null where client_request_id = 'req-10' $$, 'VQ010', null, '已撤銷不可回復');
insert into public.field_documents (id, project_id, doc_type, doc_date) values
  ('c4b80000-0000-0000-0000-000000000001', 'c4b20000-0000-0000-0000-00000000000a', 'daily_log', pg_temp.today());
select throws_ok($$ insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, confirmed_by, document_id, document_version_no, content_hash)
  values ('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'D區', 'm2', 1, 'supervisor_certificate', 'c4b10000-0000-0000-0000-000000000002',
          'c4b80000-0000-0000-0000-000000000001', 1, repeat('a', 64)) $$, 'VQ005', null, '追溯的文件必須是監造查驗表單(施工日誌拒絕;版本／雜湊／簽署列另由 guard 與 FK 驗)');

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. 正式模式:管理者失去監造能力;監造照常
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become(null);
update public.projects set formal_mode = true where id = 'c4b20000-0000-0000-0000-00000000000a';
select pg_temp.become('c4b10000-0000-0000-0000-000000000005', 'aal2');
set local role authenticated;
select throws_ok($$ select pg_temp.cert('c4b20000-0000-0000-0000-00000000000a', 'c4b30000-0000-0000-0000-000000000001', 'E區', null, 'm2', 1, 'x', 'req-16') $$, 'VQ001', null, '正式模式:管理者不可簽確認單');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000009', '草稿', '監造審核') $$, '送第 9 期');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000009', '監造審核', '已核定') $$, 'P0001', null, '正式模式:管理者不可核定');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.transition_valuation('c4b40000-0000-0000-0000-000000000009', '監造審核', '已核定') $$, '監造核定第 9 期');
reset role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. 平台管理員維護調整;轉移冪等;recheck 欄位;superuser 支援路徑
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('c4b40000-0000-0000-0000-000000000010', 'c4b20000-0000-0000-0000-00000000000a', 10, pg_temp.today(), '草稿');
select throws_ok($$ select public.admin_adjust_valuation_item('c4b40000-0000-0000-0000-000000000010', 'c4b30000-0000-0000-0000-000000000002', 5, '維護') $$, 'VQ001', null, '一般成員不可維護調整');
select is((public.transition_valuation('c4b40000-0000-0000-0000-000000000010', '監造審核', '已核定') ->> 'applied')::boolean, false, 'p_from 不符 → 不套用(冪等)');
select is(public.transition_valuation('c4b40000-0000-0000-0000-000000000010', '監造審核', '已核定') ->> 'status', '草稿', '回目前狀態');
select throws_ok($$ update public.valuations set recheck_required = true where id = 'c4b40000-0000-0000-0000-000000000010' $$, 'VQ010', null, '登入者不可改 recheck');
reset role;
select pg_temp.become('c4b10000-0000-0000-0000-000000000006');
set local role authenticated;
select throws_ok($$ select public.admin_adjust_valuation_item('c4b40000-0000-0000-0000-000000000010', 'c4b30000-0000-0000-0000-000000000002', 5, ' ') $$, 'VQ005', null, '維護調整必填原因');
select throws_ok($$ select public.admin_adjust_valuation_item('c4b40000-0000-0000-0000-000000000009', 'c4b30000-0000-0000-0000-000000000002', 5, '維護') $$, 'VQ010', null, '已核定期不可維護調整');
select lives_ok($$ select public.admin_adjust_valuation_item('c4b40000-0000-0000-0000-000000000010', 'c4b30000-0000-0000-0000-000000000002', 5, '資料修正') $$, '平台管理員調整草稿');
reset role;
select is(pg_temp.cum('c4b40000-0000-0000-0000-000000000010', 'c4b30000-0000-0000-0000-000000000002'), 5::numeric, '調整後累計 5');
select is(pg_temp.src_qty('c4b40000-0000-0000-0000-000000000010', 'c4b30000-0000-0000-0000-000000000002', '__adjustment__', 'adjustment'), -95::numeric, '調整來源 −95(前期 100)');
select is((select backing from public.valuation_items where valuation_id = 'c4b40000-0000-0000-0000-000000000010' and work_item_id = 'c4b30000-0000-0000-0000-000000000002'), 'adjusted', '依據 adjusted');
select pg_temp.become('c4b10000-0000-0000-0000-000000000006');
set local role authenticated;
select lives_ok($$ select public.admin_adjust_valuation_item('c4b40000-0000-0000-0000-000000000010', 'c4b30000-0000-0000-0000-000000000002', 100, '還原') $$, '平台管理員還原');
reset role;
select is(pg_temp.src_qty('c4b40000-0000-0000-0000-000000000010', 'c4b30000-0000-0000-0000-000000000002', '__adjustment__', 'adjustment'), null, '合併歸零後調整來源移除');
select is((select count(*)::int from public.valuation_adjustments where applied_valuation_id = 'c4b40000-0000-0000-0000-000000000010'), 2, '調整紀錄 append-only 兩筆');
select pg_temp.become(null);
select lives_ok($$ update public.valuations set period_end = pg_temp.today() + 1 where id = 'c4b40000-0000-0000-0000-000000000009' $$, 'superuser(支援)可補歷史期截止日');
select pg_temp.become('c4b10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ delete from public.valuations where id = 'c4b40000-0000-0000-0000-000000000010' $$, '廠商可刪第 10 期草稿');
reset role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. 稽核事件
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become(null);
select cmp_ok((select count(*)::int from public.audit_events where event_type = 'confirmation.issued'), '>=', 16, '確認單簽發留稽核');
select cmp_ok((select count(*)::int from public.audit_events where event_type = 'confirmation.revoked'), '>=', 6, '撤銷留稽核');
select is((select count(*)::int from public.audit_events where event_type = 'valuation.allocation_reduced'), 4, '草稿縮減留稽核');
select is((select count(*)::int from public.audit_events where event_type = 'valuation.recheck_flagged'), 1, 'recheck 標記留稽核');
select is((select count(*)::int from public.audit_events where event_type = 'valuation_adjustment.created'), 3, '調整建立留稽核');
select is((select count(*)::int from public.audit_events where event_type = 'valuation_adjustment.applied'), 2, '調整併入留稽核');
select is((select count(*)::int from public.audit_events where event_type = 'valuation_adjustment.voided'), 2, '調整作廢留稽核');
select is((select count(*)::int from public.audit_events where event_type = 'valuation.admin_adjusted'), 2, '維護調整留稽核');
select is((select count(*)::int from public.audit_events where event_type = 'valuation.legacy_covered'), 1, '補證留稽核');
select is((select count(*)::int from public.audit_events where event_type = 'work_item.pricing_basis_set'), 1, '計價依據留稽核');
select cmp_ok((select count(*)::int from public.audit_events where event_type = 'valuation.synced'), '>=', 10, '同步留稽核');

select * from finish();
rollback;
