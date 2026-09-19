-- 品質查驗快速判定與自主檢查紀錄直接登錄退場(pgTAP;P6b-3,migration 20260920030000_quality_direct_writes_retire)。
-- 釘住:
--   1. grant／policy 形狀:checklist_records 只剩 SELECT;inspections 收回 UPDATE,INSERT(查驗申請)與 DELETE(待查驗)照舊;
--   2. 直接寫入被資料庫拒絕(42501):三角色、專案管理者(override)、非成員都不能直接改查驗判定或寫檢查紀錄——不是只有前端沒按鈕;
--      廠商仍可提查驗申請(判定欄一律清空)與刪除自己的待查驗申請;
--   3. guard 縱深防禦(模擬日後新增的 security definer 路徑:superuser＋登入者 claims):使用者路徑改判定欄一律拒、改非判定欄照舊;
--      使用者路徑寫檢查紀錄一律拒——只有同案自主檢查表的簽署交易(GUC pmis.field_document_sign)放行;查驗表單簽署路徑照常改判定;
--   4. service role(auth.uid() 為 null)修復路徑照舊;歷史列無損。
-- 真正的簽署 RPC 仍可寫兩表由 self_check_documents.sql／inspection_form_documents.sql 端到端釘住。
begin;

select plan(50);

-- ── 1. grant 與 policy 形狀 ───────────────────────────────────────────────────
select is(has_table_privilege('authenticated', 'public.checklist_records', 'SELECT'), true, 'checklist_records:authenticated 仍可 SELECT(歷史查閱)');
select is(has_table_privilege('authenticated', 'public.checklist_records', 'INSERT'), false, 'checklist_records:authenticated 無 INSERT');
select is(has_table_privilege('authenticated', 'public.checklist_records', 'UPDATE'), false, 'checklist_records:authenticated 無 UPDATE');
select is(has_table_privilege('authenticated', 'public.checklist_records', 'DELETE'), false, 'checklist_records:authenticated 無 DELETE');
select is(
  has_table_privilege('anon', 'public.checklist_records', 'INSERT') or has_table_privilege('anon', 'public.checklist_records', 'UPDATE')
    or has_table_privilege('anon', 'public.checklist_records', 'DELETE'),
  false, 'checklist_records:anon 沒有任何寫入權限');
select is(
  (select string_agg(policyname || ':' || cmd, ',' order by policyname) from pg_policies where schemaname = 'public' and tablename = 'checklist_records'),
  'checklist_records_select:SELECT', 'checklist_records 只剩 SELECT policy');
select is(has_table_privilege('authenticated', 'public.inspections', 'SELECT'), true, 'inspections:authenticated 仍可 SELECT');
select is(has_table_privilege('authenticated', 'public.inspections', 'INSERT'), true, 'inspections:authenticated 仍可 INSERT(查驗申請)');
select is(has_table_privilege('authenticated', 'public.inspections', 'DELETE'), true, 'inspections:authenticated 仍可 DELETE(待查驗申請;已判定由 delete guard 擋)');
select is(has_table_privilege('authenticated', 'public.inspections', 'UPDATE'), false, 'inspections:authenticated 無 UPDATE(判定只經簽署)');
select is(has_table_privilege('anon', 'public.inspections', 'UPDATE'), false, 'inspections:anon 無 UPDATE');
select is(
  (select string_agg(policyname || ':' || cmd, ',' order by policyname) from pg_policies where schemaname = 'public' and tablename = 'inspections'),
  'inspections_delete:DELETE,inspections_insert:INSERT,inspections_select:SELECT', 'inspections 的 UPDATE policy 已移除');
select is(has_function_privilege('authenticated', 'public.fn_checklist_sign_bypass(uuid)', 'EXECUTE'), false, 'fn_checklist_sign_bypass 不開給 authenticated(內部 helper)');

-- ── 測試資料:A 案(三方＋管理者)、B 案(外人) ─────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('d6b30000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'q6-contractor@example.test', '', now(), '{}', '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('d6b30000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'q6-supervisor@example.test', '', now(), '{}', '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('d6b30000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'q6-owner@example.test', '', now(), '{}', '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('d6b30000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'q6-admin@example.test', '', now(), '{}', '{"full_name":"Admin","org_type":"contractor"}', now(), now()),
  ('d6b30000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'q6-outsider@example.test', '', now(), '{}', '{"full_name":"Outsider","org_type":"supervisor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by) values
  ('d6b31000-0000-0000-0000-00000000000a', '品質直接寫入退場 A', '機關', '廠商', '監造', 'd6b30000-0000-0000-0000-000000000004'),
  ('d6b31000-0000-0000-0000-00000000000b', '品質直接寫入退場 B', '機關', '廠商', '監造', 'd6b30000-0000-0000-0000-000000000005');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('d6b31000-0000-0000-0000-00000000000a', 'd6b30000-0000-0000-0000-000000000001', 'member'),
  ('d6b31000-0000-0000-0000-00000000000a', 'd6b30000-0000-0000-0000-000000000002', 'member'),
  ('d6b31000-0000-0000-0000-00000000000a', 'd6b30000-0000-0000-0000-000000000003', 'member'),
  ('d6b31000-0000-0000-0000-00000000000a', 'd6b30000-0000-0000-0000-000000000004', 'admin'),
  ('d6b31000-0000-0000-0000-00000000000b', 'd6b30000-0000-0000-0000-000000000005', 'admin');

insert into public.checklist_templates (id, project_id, title, source, items) values
  ('d6b32000-0000-0000-0000-000000000001', 'd6b31000-0000-0000-0000-00000000000a', '混凝土自主檢查表', '03310',
   '[{"no":"C2","item":"坍度","kind":"num","min":15.5,"max":20.5,"unit":"cm"}]');

-- 歷史列(superuser、無登入者=舊流程／遷移):一筆舊流程直接登錄的檢查紀錄、一筆快速判定的查驗、一筆待查驗
insert into public.checklist_records (id, project_id, template_id, check_date, results, overall) values
  ('d6b33000-0000-0000-0000-000000000001', 'd6b31000-0000-0000-0000-00000000000a', 'd6b32000-0000-0000-0000-000000000001',
   current_date, '{"C2":{"value":18,"pass":true}}', '合格');
insert into public.inspections (id, project_id, title, status, result_note, requested_date, inspected_at) values
  ('d6b34000-0000-0000-0000-000000000001', 'd6b31000-0000-0000-0000-00000000000a', '舊流程快速判定', '合格', '符合設計圖說', current_date, now()),
  ('d6b34000-0000-0000-0000-000000000002', 'd6b31000-0000-0000-0000-00000000000a', '待查驗申請', '待查驗', null, current_date, null);
-- 兩份文件草稿:A 案自主檢查表、A 案監造查驗表單(target_key=待查驗申請);B 案自主檢查表(跨案不放行)
insert into public.field_documents (id, project_id, doc_type, doc_date, target_key) values
  ('d6b35000-0000-0000-0000-000000000001', 'd6b31000-0000-0000-0000-00000000000a', 'self_check', current_date, null),
  ('d6b35000-0000-0000-0000-000000000002', 'd6b31000-0000-0000-0000-00000000000a', 'inspection_form', current_date, 'd6b34000-0000-0000-0000-000000000002'),
  ('d6b35000-0000-0000-0000-000000000003', 'd6b31000-0000-0000-0000-00000000000b', 'self_check', current_date, null);

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then '' else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 2. 直接寫入矩陣(PostgREST 同權限:set role authenticated) ─────────────────
select pg_temp.become('d6b30000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*)::int from public.checklist_records where project_id = 'd6b31000-0000-0000-0000-00000000000a'), 1, '廠商仍讀得到舊流程檢查紀錄');
select throws_ok($$ insert into public.checklist_records (project_id, template_id, check_date, results)
  values ('d6b31000-0000-0000-0000-00000000000a', 'd6b32000-0000-0000-0000-000000000001', current_date, '{"C2":{"value":18}}') $$,
  '42501', null, '廠商不可直接登錄檢查紀錄(直接登錄退場)');
select throws_ok($$ insert into public.checklist_records (project_id, template_id, check_date, results, supersedes_id, revision_reason)
  values ('d6b31000-0000-0000-0000-00000000000a', 'd6b32000-0000-0000-0000-000000000001', current_date, '{}', 'd6b33000-0000-0000-0000-000000000001', '更正') $$,
  '42501', null, '廠商不可直接建立修訂版次(更正走文件新版本再簽)');
select throws_ok($$ delete from public.checklist_records where id = 'd6b33000-0000-0000-0000-000000000001' $$,
  '42501', null, '廠商不可直接刪除檢查紀錄');
select throws_ok($$ update public.inspections set location = '改位置' where id = 'd6b34000-0000-0000-0000-000000000002' $$,
  '42501', null, '廠商不可直接改查驗(表級 UPDATE 已收回)');
select lives_ok($$ insert into public.inspections (id, project_id, title, status, requested_date, result_note)
  values ('d6b34000-0000-0000-0000-000000000003', 'd6b31000-0000-0000-0000-00000000000a', '廠商新申請', '待查驗', current_date, '廠商亂填的判定說明') $$,
  '廠商仍可提查驗申請');
select is((select result_note from public.inspections where id = 'd6b34000-0000-0000-0000-000000000003'), null::text,
  '查驗申請帶的判定說明被清空(判定欄只由簽署寫)');
select throws_ok($$ insert into public.inspections (project_id, title, status, requested_date)
  values ('d6b31000-0000-0000-0000-00000000000a', '直接建成合格', '合格', current_date) $$,
  'P0001', null, '查驗申請不可直接建成已判定');
select lives_ok($$ delete from public.inspections where id = 'd6b34000-0000-0000-0000-000000000003' $$, '廠商仍可刪除待查驗申請');
reset role;

select pg_temp.become('d6b30000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$ update public.inspections set status = '合格', result_note = '快速判定' where id = 'd6b34000-0000-0000-0000-000000000002' $$,
  '42501', null, '監造不可快速判定(直接改 status)');
select throws_ok($$ update public.inspections set status = '待查驗' where id = 'd6b34000-0000-0000-0000-000000000001' $$,
  '42501', null, '監造不可直接撤銷舊判定');
select throws_ok($$ insert into public.checklist_records (project_id, template_id, check_date, results)
  values ('d6b31000-0000-0000-0000-00000000000a', 'd6b32000-0000-0000-0000-000000000001', current_date, '{}') $$,
  '42501', null, '監造不可直接寫檢查紀錄');
reset role;

select pg_temp.become('d6b30000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ update public.inspections set status = '不合格' where id = 'd6b34000-0000-0000-0000-000000000002' $$,
  '42501', null, '機關不可改查驗判定');
select throws_ok($$ delete from public.checklist_records where id = 'd6b33000-0000-0000-0000-000000000001' $$,
  '42501', null, '機關不可刪檢查紀錄');
reset role;

select pg_temp.become('d6b30000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ update public.inspections set status = '合格' where id = 'd6b34000-0000-0000-0000-000000000002' $$,
  '42501', null, '專案管理者(override)也不可快速判定');
select throws_ok($$ insert into public.checklist_records (project_id, template_id, check_date, results)
  values ('d6b31000-0000-0000-0000-00000000000a', 'd6b32000-0000-0000-0000-000000000001', current_date, '{}') $$,
  '42501', null, '專案管理者也不可直接登錄檢查紀錄');
reset role;

select pg_temp.become('d6b30000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$ update public.inspections set status = '合格' where id = 'd6b34000-0000-0000-0000-000000000002' $$,
  '42501', null, '非成員不可改 A 案查驗');
select is((select count(*)::int from public.checklist_records where project_id = 'd6b31000-0000-0000-0000-00000000000a'), 0, '非成員讀不到 A 案檢查紀錄(RLS 原條件不變)');
reset role;

-- ── 3. guard 縱深防禦:superuser＋登入者 claims(模擬日後新增的 security definer 路徑) ────────
select pg_temp.become('d6b30000-0000-0000-0000-000000000002');
select throws_like($$ update public.inspections set status = '合格' where id = 'd6b34000-0000-0000-0000-000000000002' $$,
  '查驗判定只能經監造查驗表單簽署%', 'guard:使用者路徑改 status 一律拒(不再分監造／非監造)');
select throws_like($$ update public.inspections set result_note = '事後補判定說明' where id = 'd6b34000-0000-0000-0000-000000000001' $$,
  '查驗判定只能經監造查驗表單簽署%', 'guard:改判定說明一律拒');
select throws_like($$ update public.inspections set inspected_at = now() - interval '1 day' where id = 'd6b34000-0000-0000-0000-000000000001' $$,
  '查驗判定只能經監造查驗表單簽署%', 'guard:改判定時間一律拒');
select throws_like($$ update public.inspections set status = '待查驗' where id = 'd6b34000-0000-0000-0000-000000000001' $$,
  '查驗判定只能經監造查驗表單簽署%', 'guard:撤銷舊快速判定一律拒(更正=建立查驗表單再簽)');
select lives_ok($$ update public.inspections set location = 'A 區 2F' where id = 'd6b34000-0000-0000-0000-000000000002' $$,
  'guard:待查驗申請的非判定欄照舊可改');
select throws_like($$ update public.inspections set location = 'B 區' where id = 'd6b34000-0000-0000-0000-000000000001' $$,
  '已判定的查驗不可變更%', 'guard:已判定查驗的申報資料不可改(沿用 P3c)');
select pg_temp.become('d6b30000-0000-0000-0000-000000000004');
select throws_like($$ update public.inspections set status = '合格' where id = 'd6b34000-0000-0000-0000-000000000002' $$,
  '查驗判定只能經監造查驗表單簽署%', 'guard:admin override 也翻不過判定欄');

select pg_temp.become('d6b30000-0000-0000-0000-000000000001');
select throws_like($$ insert into public.checklist_records (project_id, template_id, check_date, results)
  values ('d6b31000-0000-0000-0000-00000000000a', 'd6b32000-0000-0000-0000-000000000001', current_date, '{"C2":{"value":18}}') $$,
  '自主檢查紀錄只由自主檢查表文件簽署寫入%', 'guard:使用者路徑不在簽署交易內 → 拒');
select set_config('pmis.field_document_sign', 'd6b35000-0000-0000-0000-000000000003', true);
select throws_like($$ insert into public.checklist_records (project_id, template_id, check_date, results)
  values ('d6b31000-0000-0000-0000-00000000000a', 'd6b32000-0000-0000-0000-000000000001', current_date, '{"C2":{"value":18}}') $$,
  '自主檢查紀錄只由自主檢查表文件簽署寫入%', 'guard:簽署 GUC 指向他案文件 → 拒');
select set_config('pmis.field_document_sign', 'd6b35000-0000-0000-0000-000000000002', true);
select throws_like($$ insert into public.checklist_records (project_id, template_id, check_date, results)
  values ('d6b31000-0000-0000-0000-00000000000a', 'd6b32000-0000-0000-0000-000000000001', current_date, '{"C2":{"value":18}}') $$,
  '自主檢查紀錄只由自主檢查表文件簽署寫入%', 'guard:簽署 GUC 指向非自檢表文件 → 拒');
select set_config('pmis.field_document_sign', 'not-a-uuid', true);
select throws_like($$ insert into public.checklist_records (project_id, template_id, check_date, results)
  values ('d6b31000-0000-0000-0000-00000000000a', 'd6b32000-0000-0000-0000-000000000001', current_date, '{"C2":{"value":18}}') $$,
  '自主檢查紀錄只由自主檢查表文件簽署寫入%', 'guard:GUC 不是 UUID → 拒(不因轉型錯誤放行)');
select set_config('pmis.field_document_sign', 'd6b35000-0000-0000-0000-000000000001', true);
select lives_ok($$ insert into public.checklist_records (id, project_id, template_id, check_date, results, overall, created_by)
  values ('d6b33000-0000-0000-0000-000000000002', 'd6b31000-0000-0000-0000-00000000000a', 'd6b32000-0000-0000-0000-000000000001', current_date,
          '{"C2":{"value":30}}', '合格', 'd6b30000-0000-0000-0000-000000000004') $$,
  'guard:同案自檢表簽署交易內 → 放行(簽署路徑)');
select results_eq($$ select overall, created_by, rev from public.checklist_records where id = 'd6b33000-0000-0000-0000-000000000002' $$,
  $$ values ('不合格'::text, 'd6b30000-0000-0000-0000-000000000001'::uuid, 0) $$,
  '簽署路徑照舊:判定由範本重算(30cm 超規)、建立者=登錄者、Rev.0');
select set_config('pmis.field_document_sign', 'd6b35000-0000-0000-0000-000000000002', true);
select pg_temp.become('d6b30000-0000-0000-0000-000000000002');
select lives_ok($$ update public.inspections set status = '不合格', result_note = '保護層不足', inspected_by = 'd6b30000-0000-0000-0000-000000000002', inspected_at = now()
  where id = 'd6b34000-0000-0000-0000-000000000002' $$,
  'guard:本查驗的監造查驗表單簽署交易內 → 可寫判定(簽署路徑)');
select is((select count(*)::int from public.defects where inspection_id = 'd6b34000-0000-0000-0000-000000000002' and status <> '已結案'), 1,
  '簽署路徑判不合格 → DB 同交易開缺失(inspections_defect_sync 照舊)');
select set_config('pmis.field_document_sign', '', true);

-- ── 4. service role(無登入者)修復路徑照舊;歷史列無損 ─────────────────────────
select pg_temp.become(null);
select lives_ok($$ update public.inspections set result_note = '修復:補登判定說明' where id = 'd6b34000-0000-0000-0000-000000000001' $$,
  'service／遷移路徑仍可修復查驗(auth.uid() 為 null)');
select lives_ok($$ insert into public.checklist_records (id, project_id, template_id, check_date, results, overall)
  values ('d6b33000-0000-0000-0000-000000000003', 'd6b31000-0000-0000-0000-00000000000a', 'd6b32000-0000-0000-0000-000000000001', current_date, '{}', null) $$,
  'service／遷移路徑仍可還原檢查紀錄');
select results_eq($$ select status, title from public.inspections where id = 'd6b34000-0000-0000-0000-000000000001' $$,
  $$ values ('合格'::text, '舊流程快速判定'::text) $$, '舊流程快速判定的查驗照常保留(判定不變)');
select results_eq($$ select overall, results -> 'C2' ->> 'value' from public.checklist_records where id = 'd6b33000-0000-0000-0000-000000000001' $$,
  $$ values ('合格'::text, '18'::text) $$, '舊流程直接登錄的檢查紀錄照常保留');

select * from finish();
rollback;
