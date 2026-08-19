-- 查驗申請檢附自主檢查表(pgTAP):W8-5 真人驗收 S-2。
-- 對應 migration 20260819120100_inspection_checklist_link.sql。
-- 規則:查驗 insert 可帶 checklist_record_id(三級品管第一級→第二級的單向引用);
-- 檢查紀錄被刪(guard 只放行未判定)時 on delete set null,不連坐查驗單;
-- 已判定紀錄仍受 checklist_records_guard 保護——被查驗檢附不成為刪證據的後門。
begin;

select plan(11);

-- ── 結構 ─────────────────────────────────────────────────────────────────────
select has_column('public', 'inspections', 'checklist_record_id', '查驗的檢附自主檢查欄位存在');
select fk_ok('public', 'inspections', 'checklist_record_id',
             'public', 'checklist_records', 'id', 'FK 指向 checklist_records(id)');

-- ── 測試資料:廠商/管理者 + 專案 + 範本 + 已判定/未判定各一筆檢查紀錄 ─────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('44f00000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'icl-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('44f00000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'icl-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by) values
  ('44100000-0000-0000-0000-000000000001', '查驗檢附測試案', '機關', '廠商', '監造',
   '44f00000-0000-0000-0000-0000000000f5');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('44100000-0000-0000-0000-000000000001', '44f00000-0000-0000-0000-0000000000f1', 'member'),
  ('44100000-0000-0000-0000-000000000001', '44f00000-0000-0000-0000-0000000000f5', 'admin');

insert into public.checklist_templates (id, project_id, title, source, items) values
  ('44200000-0000-0000-0000-000000000001', '44100000-0000-0000-0000-000000000001',
   '混凝土自主檢查表', '03310',
   '[{"no":"C2","group":"澆置中","item":"坍度","kind":"num","min":15.5,"max":20.5,"unit":"cm","standard":"18±2.5"}]');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- 廠商建立:一筆已判定(合格)、一筆未判定的自主檢查紀錄
select pg_temp.become('44f00000-0000-0000-0000-0000000000f1');
insert into public.checklist_records (id, project_id, template_id, check_date, location, results, overall) values
  ('44300000-0000-0000-0000-000000000001', '44100000-0000-0000-0000-000000000001',
   '44200000-0000-0000-0000-000000000001', current_date, '4F 版牆',
   '{"C2":{"value":18,"pass":true}}', '合格'),
  ('44300000-0000-0000-0000-000000000002', '44100000-0000-0000-0000-000000000001',
   '44200000-0000-0000-0000-000000000001', current_date, '4F 版牆', '{}', null);

-- ── 廠商申請查驗可檢附自主檢查紀錄 ───────────────────────────────────────────
select lives_ok($$ insert into public.inspections
  (id, project_id, title, inspection_type, requested_date, status, checklist_record_id)
  values ('44400000-0000-0000-0000-000000000001', '44100000-0000-0000-0000-000000000001',
          '4F 版牆混凝土澆置前查驗', '施工查驗', current_date, '待查驗',
          '44300000-0000-0000-0000-000000000001') $$,
  '廠商申請查驗可檢附已判定的自主檢查紀錄');
select is((select checklist_record_id from public.inspections
  where id = '44400000-0000-0000-0000-000000000001'),
  '44300000-0000-0000-0000-000000000001'::uuid, '檢附關聯落庫');

-- ── on delete set null:刪檢查紀錄不連坐查驗單 ────────────────────────────────
-- DB 只驗 FK 存在(「僅限已判定」是 UI 的收斂,不是資料庫約束):先掛未判定的
-- 紀錄,才能走 guard 放行的刪除路徑驗 set null。
select lives_ok($$ insert into public.inspections
  (id, project_id, title, inspection_type, requested_date, status, checklist_record_id)
  values ('44400000-0000-0000-0000-000000000002', '44100000-0000-0000-0000-000000000001',
          '4F 版牆鋼筋查驗', '施工查驗', current_date, '待查驗',
          '44300000-0000-0000-0000-000000000002') $$,
  '未判定的檢查紀錄也掛得上(FK 只驗存在)');
select lives_ok($$ delete from public.checklist_records
  where id = '44300000-0000-0000-0000-000000000002' $$,
  '未判定紀錄可刪:被查驗檢附不擋 guard 放行的刪除');
select is((select count(*)::int from public.inspections
  where id = '44400000-0000-0000-0000-000000000002'), 1, '刪檢查紀錄不連坐查驗單');
select is((select checklist_record_id from public.inspections
  where id = '44400000-0000-0000-0000-000000000002'), null::uuid,
  '被刪紀錄的檢附自動斷開(on delete set null)');

-- ── 已判定=第一級品質證據:被檢附也不因 set null 變成可刪 ─────────────────────
select throws_ok($$ delete from public.checklist_records
  where id = '44300000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '已判定的檢查紀錄仍不可刪除(檢附不是刪證據的後門)');

-- ── 回歸:FK 不得害專案刪不掉(cascade 放行) ──────────────────────────────────
select pg_temp.become('44f00000-0000-0000-0000-0000000000f5');
select lives_ok($$ select public.delete_project('44100000-0000-0000-0000-000000000001') $$,
  '含檢附關聯的專案,管理者仍可整案刪除');
select is((select count(*)::int from public.inspections
  where project_id = '44100000-0000-0000-0000-000000000001'), 0, '查驗隨專案 cascade 清除');

select * from finish();
rollback;
