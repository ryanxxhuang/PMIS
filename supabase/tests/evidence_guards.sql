-- R3 證據防護(pgTAP):刪除防護五表 + 試體判定下沉 DB。
-- 執行方式:本地 supabase(colima)+容器內 psql,整份在交易內執行並 rollback。
-- 對應 migration 20260712001600_evidence_guards.sql。
begin;

select plan(22);

-- ── 結構 ─────────────────────────────────────────────────────────────────────
select has_trigger('public', 'submittals', 'submittals_delete_guard', '送審刪除防護掛上');
select has_trigger('public', 'test_samples', 'judge_test_sample', '試體判定 trigger 掛上');
select has_column('public', 'defects', 'test_sample_id', '缺失↔試體關聯欄存在');
select has_column('public', 'defect_audits', 'actor_org', '稽核 actor_org 欄存在');

-- ── 測試資料(正式模式,建立者為獨立 admin,A/B 為一般成員) ────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('ffffffff-ffff-ffff-ffff-fffffffffff1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('ffffffff-ffff-ffff-ffff-fffffffffff2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('ffffffff-ffff-ffff-ffff-fffffffffff5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode)
values ('25000000-0000-0000-0000-000000000001', '證據防護測試案', '機關', '廠商', '監造',
        'ffffffff-ffff-ffff-ffff-fffffffffff5', true);
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('25000000-0000-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-fffffffffff1', 'member'),
  ('25000000-0000-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-fffffffffff2', 'member'),
  ('25000000-0000-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-fffffffffff5', 'admin');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 送審刪除防護(P0-01 主案) ─────────────────────────────────────────────────
select pg_temp.become('ffffffff-ffff-ffff-ffff-fffffffffff1');
insert into public.submittals (id, project_id, submittal_no, title, category, status) values
  ('35000000-0000-0000-0000-000000000001','25000000-0000-0000-0000-000000000001','SUB-E1','可刪草送','施工計畫','已提送'),
  ('35000000-0000-0000-0000-000000000002','25000000-0000-0000-0000-000000000001','SUB-E2','將被受理','施工計畫','已提送');
select lives_ok($$ delete from public.submittals where id = '35000000-0000-0000-0000-000000000001' $$,
  '未經審查(已提送/rev0)的送審可刪除');

select pg_temp.become('ffffffff-ffff-ffff-ffff-fffffffffff2');
update public.submittals set status = '審核中' where id = '35000000-0000-0000-0000-000000000002';
select pg_temp.become('ffffffff-ffff-ffff-ffff-fffffffffff1');
select throws_ok($$ delete from public.submittals where id = '35000000-0000-0000-0000-000000000002' $$,
  'P0001', null, 'P0-01:已受理(審核中)的送審不可刪除(stale 分頁攻擊)');

-- ── RFI / 查驗 / 估驗刪除防護(同類缺口) ─────────────────────────────────────
insert into public.rfis (id, project_id, rfi_no, title, status) values
  ('35000000-0000-0000-0000-000000000011','25000000-0000-0000-0000-000000000001','RFI-E1','疑義','待回覆');
select pg_temp.become('ffffffff-ffff-ffff-ffff-fffffffffff2');
update public.rfis set answer = '照圖施工', status = '已回覆'
  where id = '35000000-0000-0000-0000-000000000011';
select pg_temp.become('ffffffff-ffff-ffff-ffff-fffffffffff1');
select throws_ok($$ delete from public.rfis where id = '35000000-0000-0000-0000-000000000011' $$,
  'P0001', null, '已回覆的 RFI 不可刪除');

insert into public.inspections (id, project_id, title, status) values
  ('35000000-0000-0000-0000-000000000021','25000000-0000-0000-0000-000000000001','鋼筋查驗','待查驗');
select lives_ok($$ delete from public.inspections where id = '35000000-0000-0000-0000-000000000021' $$,
  '待查驗的查驗可刪除');
insert into public.inspections (id, project_id, title, status) values
  ('35000000-0000-0000-0000-000000000022','25000000-0000-0000-0000-000000000001','模板查驗','待查驗');
select pg_temp.become('ffffffff-ffff-ffff-ffff-fffffffffff2');
update public.inspections set status = '不合格' where id = '35000000-0000-0000-0000-000000000022';
select pg_temp.become('ffffffff-ffff-ffff-ffff-fffffffffff1');
select throws_ok($$ delete from public.inspections where id = '35000000-0000-0000-0000-000000000022' $$,
  'P0001', null, '已判定的查驗不可刪除');

insert into public.valuations (id, project_id, period_no, status) values
  ('35000000-0000-0000-0000-000000000031','25000000-0000-0000-0000-000000000001', 1, '監造審核');
select throws_ok($$ delete from public.valuations where id = '35000000-0000-0000-0000-000000000031' $$,
  'P0001', null, '送審中的估驗不可刪除');
update public.valuations set status = '草稿' where id = '35000000-0000-0000-0000-000000000031';
select lives_ok($$ delete from public.valuations where id = '35000000-0000-0000-0000-000000000031' $$,
  '草稿估驗可刪除');

-- ── 試體判定下沉 DB(P0-02) ───────────────────────────────────────────────────
insert into public.test_samples (id, project_id, sample_no, fc, sampled_date, location) values
  ('35000000-0000-0000-0000-000000000041','25000000-0000-0000-0000-000000000001','TS-E1', 280, '2026-07-05', 'A區');
select is((select status from public.test_samples where id = '35000000-0000-0000-0000-000000000041'),
  '待試驗', '無 28 天值=待試驗');

update public.test_samples set d28_values = '[200,200,200]'::jsonb
  where id = '35000000-0000-0000-0000-000000000041';
select is((select status from public.test_samples where id = '35000000-0000-0000-0000-000000000041'),
  '不合格', 'P0-02:平均 200 < fc′280 → 同交易判不合格(F5 不會回退)');
select is((select count(*)::int from public.defects
  where test_sample_id = '35000000-0000-0000-0000-000000000041'), 1,
  '不合格同交易自動開缺失');

update public.test_samples set note = '再存一次'
  where id = '35000000-0000-0000-0000-000000000041';
select is((select count(*)::int from public.defects
  where test_sample_id = '35000000-0000-0000-0000-000000000041'), 1,
  '重複儲存不重複開缺失(unique by test_sample_id)');

select throws_ok($$ delete from public.test_samples where id = '35000000-0000-0000-0000-000000000041' $$,
  'P0001', null, '已判定試體不可刪除');

insert into public.test_samples (id, project_id, sample_no, fc, sampled_date, d28_values) values
  ('35000000-0000-0000-0000-000000000042','25000000-0000-0000-0000-000000000001','TS-E2', 280, '2026-07-05',
   '[300,295,310]'::jsonb);
select is((select status from public.test_samples where id = '35000000-0000-0000-0000-000000000042'),
  '合格', '平均與單顆皆達標 → 合格(INSERT 也判)');
select is((select count(*)::int from public.defects
  where test_sample_id = '35000000-0000-0000-0000-000000000042'), 0, '合格不開缺失');

-- 單顆低於 0.85fc′(238):平均達標仍不合格
insert into public.test_samples (id, project_id, sample_no, fc, sampled_date, d28_values) values
  ('35000000-0000-0000-0000-000000000043','25000000-0000-0000-0000-000000000001','TS-E3', 280, '2026-07-05',
   '[350,350,200]'::jsonb);
select is((select status from public.test_samples where id = '35000000-0000-0000-0000-000000000043'),
  '不合格', '單顆 200 < 0.85fc′ → 不合格');

-- ── 稽核 actor_org(P2-04) ────────────────────────────────────────────────────
select pg_temp.become('ffffffff-ffff-ffff-ffff-fffffffffff2');
update public.defects set status = '已結案'
  where test_sample_id = '35000000-0000-0000-0000-000000000041';
update public.defects set correction_reason = '誤判更正,退回改善', status = '改善中'
  where test_sample_id = '35000000-0000-0000-0000-000000000041';
select is((select actor_org from public.defect_audits
  where reason = '誤判更正,退回改善' limit 1), 'supervisor',
  'defect_audits 記錄 actor_org');

-- ── 回歸:整案刪除 cascade 不被任何防護擋下 ───────────────────────────────────
select pg_temp.become('ffffffff-ffff-ffff-ffff-fffffffffff5');
select lives_ok($$ select public.delete_project('25000000-0000-0000-0000-000000000001') $$,
  '含審核中送審/已判定試體/已回覆RFI 的專案仍可整案刪除');
select is((select count(*)::int from public.projects where id = '25000000-0000-0000-0000-000000000001'),
  0, '專案確實刪除');

select * from finish();
rollback;
