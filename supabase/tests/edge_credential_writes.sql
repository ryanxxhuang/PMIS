-- F2｜服務憑證(Edge service role)與 DBA 直連不得寫入監造確認量與估驗狀態(migration 20260920230000)。
-- 對應 F2 實測缺口:service_role(auth.uid() 為 null)可憑空 insert 一筆內容合法的 active 確認、可替監造撤銷、
-- 可直接建立／改寫非草稿估驗期別。這裡釘住:
--   1. service_role 直寫確認量:INSERT 一進 guard 就 VQ010(不看內容),active→revoked 也 VQ010;DELETE 照舊 VQ010。
--   2. service_role 直寫期別:INSERT 非草稿 VQ010;UPDATE status／invoice_date／paid_date／paid_amount VQ010;
--      草稿期的 note 等一般欄位不在此列(照舊)。計價依據(work_item_pricing_basis)insert／update／delete 同樣 VQ010。
--   3. superuser(DBA 直連)同樣被擋;開內部旗標(交易內 pmis.cq_internal='1')才是 DBA 邊界。
--   4. 合法路徑照常:監造 issue_supervisor_certificate 落 active、revoke_inspection_confirmation 落 revoked,
--      旗標用完即還原(fn_cq_internal() 回 false);廠商建草稿→送審→監造核定的狀態機不受影響。
--   5. 旗標不會放寬內容檢查:旗標內塞單位不符的確認仍被 fn_cq_check_unit 擋(P0001),且例外後旗標隨子交易還原。
--   查驗表單簽署分支(field_document_sign_inspection_form_internal)的旗標由 inspection_form_documents.sql 的簽署情境
--   與 e2e-real chain 10／16 覆蓋——那裡簽署後 inspection_confirmations 必須落一筆,沒開旗標就會 VQ010 轉紅。
-- 執行方式:npm run test:db(一次性資料庫從零套 migrations＋seed),整份在交易內執行並 rollback。
begin;

select plan(50);

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. 測試資料(廠商＝建案管理者、監造、機關;一個可計價工項 m3;一筆已判定的查驗供查驗依據)
-- ═══════════════════════════════════════════════════════════════════════════
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('f2b10000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'f2-contractor@example.test', '', now(), '{}', '{"full_name":"廠商","org_type":"contractor"}', now(), now()),
  ('f2b10000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'f2-supervisor@example.test', '', now(), '{}', '{"full_name":"監造","org_type":"supervisor"}', now(), now()),
  ('f2b10000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'f2-owner@example.test', '', now(), '{}', '{"full_name":"機關","org_type":"owner"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode) values
  ('f2b20000-0000-0000-0000-00000000000a', 'F2 服務憑證封堵案', '機關', '廠商', '監造', 'f2b10000-0000-0000-0000-000000000001', true);
alter table public.projects enable trigger on_project_created;
insert into public.project_members (project_id, user_id, role) values
  ('f2b20000-0000-0000-0000-00000000000a', 'f2b10000-0000-0000-0000-000000000001', 'admin'),
  ('f2b20000-0000-0000-0000-00000000000a', 'f2b10000-0000-0000-0000-000000000002', 'member'),
  ('f2b20000-0000-0000-0000-00000000000a', 'f2b10000-0000-0000-0000-000000000003', 'member');
insert into public.work_items (id, project_id, item_no, description, unit, quantity, unit_price, is_leaf, is_billable, is_rollup) values
  ('f2b30000-0000-0000-0000-000000000001', 'f2b20000-0000-0000-0000-00000000000a', '1.1', '結構混凝土', 'm3', 100, 1000, true, true, false);
insert into public.inspections (id, project_id, work_item_id, title, status) values
  ('f2b60000-0000-0000-0000-000000000001', 'f2b20000-0000-0000-0000-00000000000a', 'f2b30000-0000-0000-0000-000000000001', 'A區查驗', '待查驗');
update public.inspections set status = '合格' where id = 'f2b60000-0000-0000-0000-000000000001';

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then '' else json_build_object('sub', u::text, 'role', 'authenticated', 'aal', 'aal1')::text end, true);
end $$;
-- DBA 邊界:只在這一句開內部旗標(失敗時隨 throws_ok 的子交易一起回滾)
create or replace function pg_temp.internal(p_sql text) returns void language plpgsql as $$
begin
  perform set_config('pmis.cq_internal', '1', true);
  execute p_sql;
  perform set_config('pmis.cq_internal', '', true);
end $$;
create or replace function pg_temp.active_count() returns int language sql as $$
  select count(*)::int from public.inspection_confirmations where project_id = 'f2b20000-0000-0000-0000-00000000000a' and status = 'active' $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. service_role(Edge 憑證;auth.uid() 為 null)直寫確認量:內容再合法也 VQ010
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become(null);
set local role service_role;
select is(auth.uid(), null, 'service_role 沒有 auth.uid()(Edge service client 的實際條件)');
select throws_ok($$ insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, confirmed_by)
  values ('f2b20000-0000-0000-0000-00000000000a', 'f2b30000-0000-0000-0000-000000000001', 'A區', 'm3', 60, 'supervisor_certificate', 'f2b10000-0000-0000-0000-000000000002') $$,
  'VQ010', null, 'service_role:內容合法(監造成員為確認人)的監造確認單 insert 仍 VQ010(F2 修正前會落庫)');
select throws_ok($$ insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, inspection_id, confirmed_by)
  values ('f2b20000-0000-0000-0000-00000000000a', 'f2b30000-0000-0000-0000-000000000001', 'A區', 'm3', 60, 'inspection', 'f2b60000-0000-0000-0000-000000000001', 'f2b10000-0000-0000-0000-000000000002') $$,
  'VQ010', null, 'service_role:掛在已判定查驗上的確認 insert 仍 VQ010(不是 VQ005／VQ001——在內容檢查之前就擋)');
select is(pg_temp.active_count(), 0, 'service_role 直寫後沒有任何 active 確認落庫');
reset role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. superuser(DBA 直連)同樣被擋;開內部旗標才是 DBA 邊界;旗標不放寬內容檢查、例外後旗標還原
-- ═══════════════════════════════════════════════════════════════════════════
select throws_ok($$ insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, confirmed_by)
  values ('f2b20000-0000-0000-0000-00000000000a', 'f2b30000-0000-0000-0000-000000000001', 'A區', 'm3', 60, 'supervisor_certificate', 'f2b10000-0000-0000-0000-000000000002') $$,
  'VQ010', null, 'superuser 直連 insert 確認量同樣 VQ010');
select throws_ok($$ select pg_temp.internal('insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, confirmed_by)
  values (''f2b20000-0000-0000-0000-00000000000a'', ''f2b30000-0000-0000-0000-000000000001'', ''A區'', ''kg'', 60, ''supervisor_certificate'', ''f2b10000-0000-0000-0000-000000000002'')') $$,
  'P0001', '單位不一致:確認單位「kg」≠ 工項單位「m3」', '旗標內單位不符(kg vs m3)仍被 fn_cq_check_unit 擋:旗標只證明「誰在寫」,不放寬內容檢查');
select is(public.fn_cq_internal(), false, '旗標內的敘述失敗後,旗標隨子交易還原(不外洩)');
select lives_ok($$ select pg_temp.internal('insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, confirmed_by, reason)
  values (''f2b20000-0000-0000-0000-00000000000a'', ''f2b30000-0000-0000-0000-000000000001'', ''歷史'', ''m3'', 10, ''supervisor_certificate'', ''f2b10000-0000-0000-0000-000000000002'', ''歷史遷移'')') $$,
  'DBA 邊界:交易內開旗標可重現歷史確認(pgTAP／遷移 fixture 的唯一合法直寫方式)');
select is(pg_temp.active_count(), 1, 'DBA 邊界那一筆確實落庫(active 1)');
select is(public.fn_cq_internal(), false, 'DBA 邊界用完旗標即還原');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. 合法路徑照常:監造簽發確認單、撤銷;旗標只包住那一句
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become('f2b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.issue_supervisor_certificate('f2b20000-0000-0000-0000-00000000000a', 'f2b30000-0000-0000-0000-000000000001',
  'A區', 'A區', null, 'm3', 60, '監造親簽', 'f2-req-1') $$, '監造 issue_supervisor_certificate 照常');
reset role;
select is(public.fn_cq_internal(), false, 'RPC 回來後旗標已還原(交易內看不到旗標)');
select is(pg_temp.active_count(), 2, '簽發後 active 2(歷史 10＋A區 60)');
select is((select qty_delta from public.inspection_confirmations where client_request_id = 'f2-req-1'), 60::numeric, 'A區首筆增量 60');
select is((select confirmed_by from public.inspection_confirmations where client_request_id = 'f2-req-1'), 'f2b10000-0000-0000-0000-000000000002'::uuid, '確認人=簽發的監造本人(auth.uid())');
-- 再簽一張累計 80(同批次):guard 在旗標內照常算 prev_cum 與 supersedes
select pg_temp.become('f2b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.issue_supervisor_certificate('f2b20000-0000-0000-0000-00000000000a', 'f2b30000-0000-0000-0000-000000000001',
  'A區', 'A區', null, 'm3', 80, '追加確認', 'f2-req-2') $$, '同批次再簽累計 80');
reset role;
select is((select qty_delta from public.inspection_confirmations where client_request_id = 'f2-req-2'), 20::numeric, '第二筆增量 20(80−60):累計語意在旗標內照舊');
select is((select supersedes_id from public.inspection_confirmations where client_request_id = 'f2-req-2'),
  (select id from public.inspection_confirmations where client_request_id = 'f2-req-1'), '第二筆 supersedes 第一筆(鏈未分岔)');

-- service_role 撤銷:直接 update 成 revoked(連原因都填了)仍 VQ010
select pg_temp.become(null);
set local role service_role;
select throws_ok($$ update public.inspection_confirmations set status = 'revoked', reason = '服務憑證撤銷'
  where client_request_id = 'f2-req-2' $$, 'VQ010', null, 'service_role:填了原因的 active→revoked 仍 VQ010(F2 修正前會成功)');
select throws_ok($$ delete from public.inspection_confirmations where client_request_id = 'f2-req-2' $$, 'VQ010', null, 'service_role:刪除確認紀錄照舊 VQ010');
reset role;
select is((select status from public.inspection_confirmations where client_request_id = 'f2-req-2'), 'active', '被拒後仍是 active');

-- 監造撤銷(RPC)照常;撤銷後旗標還原
select pg_temp.become('f2b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.revoke_inspection_confirmation((select id from public.inspection_confirmations where client_request_id = 'f2-req-2'), '量測複核有誤') $$,
  '監造 revoke_inspection_confirmation 照常');
reset role;
select is((select status || '/' || coalesce(reason, '') from public.inspection_confirmations where client_request_id = 'f2-req-2'), 'revoked/量測複核有誤', '撤銷落庫(狀態與原因)');
select is((select revoked_by from public.inspection_confirmations where client_request_id = 'f2-req-2'), 'f2b10000-0000-0000-0000-000000000002'::uuid, '撤銷人=登入的監造');
select is(public.fn_cq_internal(), false, '撤銷 RPC 回來後旗標已還原');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. service_role 直寫估驗期別:非草稿 insert、狀態／請款／撥款 update 一律 VQ010;草稿一般欄位照舊
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become(null);
set local role service_role;
select throws_ok($$ insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('f2b40000-0000-0000-0000-000000000001', 'f2b20000-0000-0000-0000-00000000000a', 1, current_date, '已核定') $$,
  'VQ010', null, 'service_role:直接建立已核定期別 VQ010(F2 修正前會成功;INSERT 不經檢查點)');
select throws_ok($$ insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('f2b40000-0000-0000-0000-000000000001', 'f2b20000-0000-0000-0000-00000000000a', 1, current_date, '監造審核') $$,
  'VQ010', null, 'service_role:直接建立送審中期別 VQ010');
select lives_ok($$ insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('f2b40000-0000-0000-0000-000000000001', 'f2b20000-0000-0000-0000-00000000000a', 1, current_date, '草稿') $$,
  'service_role:建立草稿期別照舊(非草稿才是狀態機的事)');
select throws_ok($$ update public.valuations set status = '監造審核' where id = 'f2b40000-0000-0000-0000-000000000001' $$,
  'VQ010', null, 'service_role:草稿→監造審核 VQ010(狀態機只對登入者開放)');
select throws_ok($$ update public.valuations set status = '已核定' where id = 'f2b40000-0000-0000-0000-000000000001' $$,
  'VQ010', null, 'service_role:草稿→已核定 VQ010');
select throws_ok($$ update public.valuations set invoice_date = current_date where id = 'f2b40000-0000-0000-0000-000000000001' $$,
  'VQ010', null, 'service_role:登錄請款日 VQ010(只有機關可登錄)');
select throws_ok($$ update public.valuations set paid_date = current_date, paid_amount = 1 where id = 'f2b40000-0000-0000-0000-000000000001' $$,
  'VQ010', null, 'service_role:登錄撥款 VQ010');
select lives_ok($$ update public.valuations set note = '服務端備註' where id = 'f2b40000-0000-0000-0000-000000000001' $$,
  'service_role:草稿期的備註等一般欄位不在封堵範圍(照舊)');
reset role;
select is((select status from public.valuations where id = 'f2b40000-0000-0000-0000-000000000001'), '草稿', '被拒後期別仍是草稿');

-- superuser 同樣被擋;DBA 邊界(旗標＋停用檢查點)可重現歷史核定期(與 e2e-real chain 11b、既有 pgTAP fixture 同一條路)
select throws_ok($$ update public.valuations set status = '已核定' where id = 'f2b40000-0000-0000-0000-000000000001' $$,
  'VQ010', null, 'superuser 直連改狀態同樣 VQ010');
alter table public.valuations disable trigger valuations_checkpoint_guard;
select lives_ok($$ select pg_temp.internal('update public.valuations set status = ''已核定'' where id = ''f2b40000-0000-0000-0000-000000000001''') $$,
  'DBA 邊界:旗標內可重現歷史核定期');
alter table public.valuations enable trigger valuations_checkpoint_guard;
select is((select status from public.valuations where id = 'f2b40000-0000-0000-0000-000000000001'), '已核定', 'DBA 邊界那一句確實落庫');
select throws_ok($$ update public.valuations set period_end = current_date - 1 where id = 'f2b40000-0000-0000-0000-000000000001' $$,
  'VQ010', null, 'superuser 直連改非草稿期別的截止日 VQ010');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4b. 計價依據:service_role／superuser 直寫 VQ010;監造 set_work_item_pricing_basis 照常、旗標還原;直接刪除 VQ010
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become(null);
set local role service_role;
select throws_ok($$ insert into public.work_item_pricing_basis (work_item_id, project_id, basis)
  values ('f2b30000-0000-0000-0000-000000000001', 'f2b20000-0000-0000-0000-00000000000a', 'excluded') $$,
  'VQ010', null, 'service_role:直接把工項標 excluded VQ010(F2 修正前會成功)');
reset role;
select throws_ok($$ insert into public.work_item_pricing_basis (work_item_id, project_id, basis, rule)
  values ('f2b30000-0000-0000-0000-000000000001', 'f2b20000-0000-0000-0000-00000000000a', 'pro_rata', '{"pct":1}') $$,
  'VQ010', null, 'superuser 直連寫計價依據同樣 VQ010');
select pg_temp.become('f2b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.set_work_item_pricing_basis('f2b30000-0000-0000-0000-000000000001', 'supervisor_certificate', '{"clause":"契約第 5 條"}') $$,
  '監造 set_work_item_pricing_basis 照常');
select lives_ok($$ select public.set_work_item_pricing_basis('f2b30000-0000-0000-0000-000000000001', 'inspection') $$,
  '監造再設一次(upsert 的 update 分支)照常');
reset role;
select is((select basis || '/' || set_by::text from public.work_item_pricing_basis where work_item_id = 'f2b30000-0000-0000-0000-000000000001'),
  'inspection/f2b10000-0000-0000-0000-000000000002', '計價依據落庫,設定者=登入的監造');
select is(public.fn_cq_internal(), false, '計價依據 RPC 回來後旗標已還原');
set local role service_role;
select throws_ok($$ update public.work_item_pricing_basis set basis = 'excluded' where work_item_id = 'f2b30000-0000-0000-0000-000000000001' $$,
  'VQ010', null, 'service_role:改寫既有計價依據 VQ010');
select throws_ok($$ delete from public.work_item_pricing_basis where work_item_id = 'f2b30000-0000-0000-0000-000000000001' $$,
  'VQ010', null, 'service_role:刪除計價依據 VQ010(只放行工項／專案 cascade)');
reset role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 登入者的狀態機不受影響:廠商建草稿→送審;監造核定(空期別,檢查點無數量可驗)
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.become('f2b10000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.valuations (id, project_id, period_no, period_end, status)
  values ('f2b40000-0000-0000-0000-000000000002', 'f2b20000-0000-0000-0000-00000000000a', 2, current_date, '草稿');
select lives_ok($$ select public.transition_valuation('f2b40000-0000-0000-0000-000000000002', '草稿', '監造審核') $$, '廠商送審照常');
reset role;
select pg_temp.become('f2b10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.transition_valuation('f2b40000-0000-0000-0000-000000000002', '監造審核', '已核定') $$, '監造核定照常');
reset role;
select is((select status from public.valuations where id = 'f2b40000-0000-0000-0000-000000000002'), '已核定', '登入者經狀態機核定落庫');
select is(public.fn_cq_internal(), false, '登入者路徑全程沒有旗標外洩');

select * from finish();
rollback;
