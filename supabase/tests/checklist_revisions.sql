-- 自主檢查表修訂版次(pgTAP):第三輪驗收 P1-07/§12-7。
-- 對應 migration 20260712001600_checklist_revisions.sql。
-- 規則:存檔後不可就地修改(UPDATE 一律拒);更正=Rev.N(supersedes_id+必填原因,
-- rev/root_id 由 guard 計算不吃前端值);鏈線性(supersedes 唯一);
-- 已判定/被引用不可刪、未判定可刪;缺失以 source_checklist_record_id 指鏈根,
-- 部分唯一索引保證同鏈最多一筆未結案缺失(不重複開)。
begin;

select plan(35);

-- ── 結構 ─────────────────────────────────────────────────────────────────────
select has_column('public', 'checklist_records', 'rev', '版次欄位存在');
select has_column('public', 'checklist_records', 'supersedes_id', '前版指標欄位存在');
select has_column('public', 'checklist_records', 'root_id', '鏈根欄位存在');
select has_column('public', 'checklist_records', 'revision_reason', '更正原因欄位存在');
select has_column('public', 'defects', 'source_checklist_record_id', '缺失的檢查表來源欄位存在');
select has_trigger('public', 'checklist_records', 'checklist_records_guard', 'guard trigger 掛上');
select has_index('public', 'checklist_records', 'checklist_records_supersedes_uidx', '修訂鏈線性唯一索引存在');
select has_index('public', 'defects', 'defects_open_per_checklist_uidx', '同鏈未結案缺失唯一索引存在');

-- ── 測試資料:廠商/監造/管理者 + 兩個專案 + 範本 ──────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by) values
  ('42000000-0000-0000-0000-000000000001', '檢查表修訂測試案', '機關', '廠商', '監造',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5'),
  ('42000000-0000-0000-0000-000000000002', '跨專案對照案', '機關', '廠商', '監造',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('42000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', 'member'),
  ('42000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', 'member'),
  ('42000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5', 'admin'),
  ('42000000-0000-0000-0000-000000000002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5', 'admin');

insert into public.checklist_templates (id, project_id, title, source, items) values
  ('43000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001',
   '混凝土自主檢查表', '03310',
   '[{"no":"C2","group":"澆置中","item":"坍度","kind":"num","min":15.5,"max":20.5,"unit":"cm","standard":"18±2.5"}]'),
  ('43000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000001',
   '另一張範本', '03310', '[]');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── Rev.0 開立:rev/root/created_by 由 guard 決定,前端傳值無效 ────────────────
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1');
select lives_ok($$ insert into public.checklist_records
  (id, project_id, template_id, check_date, location, results, overall, rev, root_id, created_by)
  values ('52000000-0000-0000-0000-000000000001','42000000-0000-0000-0000-000000000001',
          '43000000-0000-0000-0000-000000000001', current_date, '4F 版牆',
          '{"C2":{"value":18,"pass":true}}', '合格',
          7, '52000000-0000-0000-0000-0000000000ff', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5') $$,
  '廠商可存檔自主檢查(Rev.0)');
select is((select rev from public.checklist_records where id = '52000000-0000-0000-0000-000000000001'),
  0, '首版 rev 強制為 0(前端傳值無效)');
select is((select root_id from public.checklist_records where id = '52000000-0000-0000-0000-000000000001'),
  '52000000-0000-0000-0000-000000000001'::uuid, '首版 root_id 強制為自身(鏈根)');
select is((select created_by from public.checklist_records where id = '52000000-0000-0000-0000-000000000001'),
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1'::uuid, 'created_by 一律強制為登錄者本人(不可冒名)');

-- ── 舊證據不可覆寫:UPDATE 一律拒絕(建立者/監造都不行) ────────────────────────
select throws_ok($$ update public.checklist_records
  set results = '{"C2":{"value":30,"pass":false}}', overall = '不合格'
  where id = '52000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '建立者不可就地改寫實測值/判定');
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2');
select throws_ok($$ update public.checklist_records set note = '補註'
  where id = '52000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '監造也不可就地修改(更正一律走修訂版次)');

-- ── 已判定=證據,不可刪除 ─────────────────────────────────────────────────────
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1');
select throws_ok($$ delete from public.checklist_records
  where id = '52000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '已判定的檢查紀錄不可刪除');

-- ── 修訂版次:原因必填;rev/root 由鏈計算;鏈線性 ─────────────────────────────
select throws_ok($$ insert into public.checklist_records
  (project_id, template_id, check_date, results, overall, supersedes_id)
  values ('42000000-0000-0000-0000-000000000001','43000000-0000-0000-0000-000000000001',
          current_date, '{"C2":{"value":30,"pass":false}}', '不合格',
          '52000000-0000-0000-0000-000000000001') $$, 'P0001', null,
  '修訂未填更正原因 → 拒絕');
select throws_ok($$ insert into public.checklist_records
  (project_id, template_id, check_date, results, overall, supersedes_id, revision_reason)
  values ('42000000-0000-0000-0000-000000000001','43000000-0000-0000-0000-000000000001',
          current_date, '{"C2":{"value":30,"pass":false}}', '不合格',
          '52000000-0000-0000-0000-000000000001', '   ') $$, 'P0001', null,
  '更正原因空白 → 拒絕');
select lives_ok($$ insert into public.checklist_records
  (id, project_id, template_id, check_date, results, overall, supersedes_id, revision_reason, rev)
  values ('52000000-0000-0000-0000-000000000002','42000000-0000-0000-0000-000000000001',
          '43000000-0000-0000-0000-000000000001', current_date,
          '{"C2":{"value":30,"pass":false}}', '不合格',
          '52000000-0000-0000-0000-000000000001', '複核取樣紀錄,坍度登載錯誤,更正為 30cm', 99) $$,
  '附原因可建立修訂版(合格改判不合格)');
select is((select rev from public.checklist_records where id = '52000000-0000-0000-0000-000000000002'),
  1, '修訂版 rev 由鏈計算為 1(前端傳 99 無效)');
select is((select root_id from public.checklist_records where id = '52000000-0000-0000-0000-000000000002'),
  '52000000-0000-0000-0000-000000000001'::uuid, '修訂版 root_id 指向鏈根');
select throws_ok($$ insert into public.checklist_records
  (project_id, template_id, check_date, results, overall, supersedes_id, revision_reason)
  values ('42000000-0000-0000-0000-000000000001','43000000-0000-0000-0000-000000000001',
          current_date, '{}', null,
          '52000000-0000-0000-0000-000000000001', '再改一次') $$, '23505', null,
  '同一版只能被修訂一次(鏈線性,不可分叉)');
select lives_ok($$ insert into public.checklist_records
  (id, project_id, template_id, check_date, results, overall, supersedes_id, revision_reason)
  values ('52000000-0000-0000-0000-000000000003','42000000-0000-0000-0000-000000000001',
          '43000000-0000-0000-0000-000000000001', current_date,
          '{"C2":{"value":18,"pass":true}}', '合格',
          '52000000-0000-0000-0000-000000000002', '複驗坍度回歸配比設計值') $$,
  '修訂版可再修訂(鏈可延伸)');
select is((select rev from public.checklist_records where id = '52000000-0000-0000-0000-000000000003'),
  2, '第二次修訂 rev=2');

-- ── 修訂必須同範本、同專案 ───────────────────────────────────────────────────
select throws_ok($$ insert into public.checklist_records
  (project_id, template_id, check_date, results, supersedes_id, revision_reason)
  values ('42000000-0000-0000-0000-000000000001','43000000-0000-0000-0000-000000000002',
          current_date, '{}', '52000000-0000-0000-0000-000000000003', '換範本') $$, 'P0001', null,
  '修訂不可換檢查表範本');
select throws_ok($$ insert into public.checklist_records
  (project_id, template_id, check_date, results, supersedes_id, revision_reason)
  values ('42000000-0000-0000-0000-000000000002','43000000-0000-0000-0000-000000000001',
          current_date, '{}', '52000000-0000-0000-0000-000000000003', '跨案修訂') $$, 'P0001', null,
  '修訂不可跨專案');

-- ── 刪除門檻:未判定可刪;被修訂引用不可刪 ────────────────────────────────────
insert into public.checklist_records
  (id, project_id, template_id, check_date, results, overall)
values ('52000000-0000-0000-0000-000000000010','42000000-0000-0000-0000-000000000001',
        '43000000-0000-0000-0000-000000000001', current_date, '{}', null);
insert into public.checklist_records
  (id, project_id, template_id, check_date, results, overall, supersedes_id, revision_reason)
values ('52000000-0000-0000-0000-000000000011','42000000-0000-0000-0000-000000000001',
        '43000000-0000-0000-0000-000000000001', current_date, '{}', null,
        '52000000-0000-0000-0000-000000000010', '補檢前先修訂');
select throws_ok($$ delete from public.checklist_records
  where id = '52000000-0000-0000-0000-000000000010' $$, 'P0001', null,
  '已被修訂版引用的紀錄不可刪除(未判定也一樣)');
select lives_ok($$ delete from public.checklist_records
  where id = '52000000-0000-0000-0000-000000000011' $$, '未判定且未被引用的鏈尾可刪除');
select lives_ok($$ delete from public.checklist_records
  where id = '52000000-0000-0000-0000-000000000010' $$, '鏈尾刪除後,未判定的原紀錄可刪除');

-- ── 缺失關聯:同鏈最多一筆未結案缺失(不重複開);結案後可再開 ──────────────────
select lives_ok($$ insert into public.defects
  (id, project_id, title, status, source_checklist_record_id)
  values ('53000000-0000-0000-0000-000000000001','42000000-0000-0000-0000-000000000001',
          '自主檢查不合格:坍度超規', '開立', '52000000-0000-0000-0000-000000000001') $$,
  '不合格自動開缺失並關聯鏈根');
select throws_ok($$ insert into public.defects
  (project_id, title, status, source_checklist_record_id)
  values ('42000000-0000-0000-0000-000000000001','重複開立','開立',
          '52000000-0000-0000-0000-000000000001') $$, '23505', null,
  '同一張檢查表(鏈)已有未結案缺失 → 不可重複開');
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2');
select lives_ok($$ update public.defects set status = '已結案', closed_at = now()
  where id = '53000000-0000-0000-0000-000000000001' $$, '監造可結案原缺失');
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1');
select lives_ok($$ insert into public.defects
  (project_id, title, status, source_checklist_record_id)
  values ('42000000-0000-0000-0000-000000000001','結案後複發','開立',
          '52000000-0000-0000-0000-000000000001') $$,
  '原缺失結案後,同鏈再判不合格可開新缺失');

-- ── 回歸:guard 不得害專案刪不掉(cascade 放行) ────────────────────────────────
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5');
select lives_ok($$ select public.delete_project('42000000-0000-0000-0000-000000000001') $$,
  '含修訂鏈與關聯缺失的專案,管理者仍可整案刪除');
select is((select count(*)::int from public.checklist_records
  where project_id = '42000000-0000-0000-0000-000000000001'), 0, '檢查紀錄隨專案 cascade 清除');
select is((select count(*)::int from public.defects
  where project_id = '42000000-0000-0000-0000-000000000001'), 0, '關聯缺失隨專案 cascade 清除');

select * from finish();
rollback;
