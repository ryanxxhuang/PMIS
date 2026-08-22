-- 佐證照片保全 pgTAP 套件:photos 表 RLS 三方行為、佐證凍結 guard 與刪除留痕、
-- storage.objects 兩個 bucket 的路徑解析政策(photos=[1]專案、contract-documents=[4]契約包)。
-- 對應 migration 20260822010000_photo_evidence_guard.sql(體檢 P1:佐證照片可被無痕滅證)。
begin;

select plan(41);

-- ── 結構契約 ────────────────────────────────────────────────────────────────
select has_trigger('public', 'photos', 'photos_delete_guard', '照片刪除防護掛上');
select has_trigger('public', 'photos', 'photos_update_guard', '照片改掛防護掛上');
select has_function('public', 'photo_frozen_reason',
  array['uuid', 'uuid', 'timestamptz', 'timestamptz', 'uuid'], '凍結判定函式存在');
select has_function('public', 'photo_storage_path_in_use', array['text'],
  '活檔判定 helper 存在(photos bucket 只准清孤兒檔)');
select is((select public from storage.buckets where id = 'photos'), false,
  'photos bucket 為私有');
select is((select count(*)::int from pg_policies where schemaname = 'storage'
  and policyname in ('photos_objects_select', 'photos_objects_insert', 'photos_objects_delete')),
  3, 'photos bucket 三條物件政策齊備');
select is((select count(*)::int from pg_policies where schemaname = 'storage'
  and policyname in ('contract_documents_objects_select', 'contract_documents_objects_insert')),
  0, '誤用路徑首段的舊 contract-documents 政策維持移除(P0-08 迴歸)');
select has_index('public', 'photos', 'photos_storage_path_idx', '活檔判定索引存在');

-- ── fixtures:A 案三方(廠商/監造/機關)+B 案外人;正式模式(無試用例外) ─────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ph-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ph-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ph-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ph-outsider@example.test', '', now(), '{}',
   '{"full_name":"Outsider","org_type":"contractor"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ph-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode)
values
  ('e1000000-0000-0000-0000-00000000000a', '照片保全測試案', '機關', '廠商', '監造',
   'e0000000-0000-0000-0000-000000000005', true),
  ('e1000000-0000-0000-0000-00000000000b', '外案', '機關', '廠商', '監造',
   'e0000000-0000-0000-0000-000000000005', true);
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 'member'),
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 'member'),
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000003', 'member'),
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000005', 'admin'),
  ('e1000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000004', 'member');

-- 契約方身分(contract-documents 的 [4]=契約包政策吃 project_memberships)
insert into public.project_parties (id, project_id, party_type, display_name) values
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'contractor', '厚德營造'),
  ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', 'supervisor', '大衍工程顧問'),
  ('e2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', 'agency', '工務局');
insert into public.project_memberships
  (project_id, user_id, project_party_id, project_role, is_project_admin) values
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001',
   'e2000000-0000-0000-0000-000000000001', 'contractor_pm', false),
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002',
   'e2000000-0000-0000-0000-000000000002', 'supervisor_engineer', false),
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000003',
   'e2000000-0000-0000-0000-000000000003', 'agency_engineer', false);

insert into public.work_items (id, project_id, item_key, item_no, description, unit, quantity, unit_price, amount, is_leaf)
values ('e3000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a',
        'WI-1', '壹.一.1', '結構混凝土', 'M3', 100, 3000, 300000, true);

insert into public.daily_logs (id, project_id, log_date) values
  ('e4000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', '2026-08-05');

-- ph1:期別內佐證(將被核定估驗凍結);ph2:同工項但 taken_at 晚於 period_end;
-- ph3:被契約重點 evidence 連結
insert into public.photos (id, project_id, daily_log_id, work_item_id, storage_path, taken_at) values
  ('e5000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a',
   'e4000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-00000000000a/e4000000-0000-0000-0000-000000000001/ph1.jpg', '2026-08-05'),
  ('e5000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a',
   null, 'e3000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-00000000000a/e4000000-0000-0000-0000-000000000001/ph2.jpg', '2026-08-15'),
  ('e5000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a',
   null, null,
   'e1000000-0000-0000-0000-00000000000a/e4000000-0000-0000-0000-000000000001/ph3.jpg', '2026-08-05');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── photos 表 RLS:三方 select/insert/delete ─────────────────────────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.photos (id, project_id, storage_path)
  values ('e5000000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-00000000000a',
          'e1000000-0000-0000-0000-00000000000a/misc/ph9.jpg') $$,
  '廠商成員可新增照片');
reset role;

select pg_temp.become('e0000000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ insert into public.photos (project_id, storage_path)
  values ('e1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a/misc/x.jpg') $$,
  '42501', null, '機關(唯讀)不可新增照片');
reset role;

select pg_temp.become('e0000000-0000-0000-0000-000000000004');
set local role authenticated;
select is((select count(*)::int from public.photos
  where project_id = 'e1000000-0000-0000-0000-00000000000a'), 0, '外案成員看不到照片');
reset role;

select pg_temp.become('e0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*)::int from public.photos
  where project_id = 'e1000000-0000-0000-0000-00000000000a'), 4, '監造(專案成員)看得到全部照片');
reset role;

-- 未凍結照片可刪,且刪除必留痕
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ delete from public.photos where id = 'e5000000-0000-0000-0000-000000000009' $$,
  '未凍結照片廠商可刪');
reset role;
select ok(exists (select 1 from public.audit_events
  where event_type = 'photo.deleted'
    and entity_id = 'e5000000-0000-0000-0000-000000000009'
    and before_data ->> 'storage_path' = 'e1000000-0000-0000-0000-00000000000a/misc/ph9.jpg'),
  '刪除留痕(photo.deleted 含 storage_path 快照)');

-- ── 佐證凍結:已核定估驗涵蓋 ─────────────────────────────────────────────────
-- 追加試體:wi2=無估驗明細的工項(參照動作放行案例用);ph4=taken_at null
-- (凍結判定退回 created_at 的後備路徑);ph5=掛 wi2 的契約重點佐證;
-- ph6=台北 8/11 凌晨拍(UTC 仍是 8/10)的次期照片——時區回歸釘
insert into public.work_items (id, project_id, item_key, item_no, description, unit, quantity, unit_price, amount, is_leaf)
values ('e3000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a',
        'WI-2', '壹.一.2', '模板組立', 'M2', 50, 500, 25000, true);
insert into public.photos (id, project_id, work_item_id, storage_path, taken_at, created_at) values
  ('e5000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-00000000000a',
   'e3000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-00000000000a/misc/ph4.jpg', null, '2026-08-05'),
  ('e5000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-00000000000a',
   'e3000000-0000-0000-0000-000000000002',
   'e1000000-0000-0000-0000-00000000000a/misc/ph5.jpg', '2026-08-05', '2026-08-05'),
  ('e5000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-00000000000a',
   'e3000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-00000000000a/misc/ph6.jpg', '2026-08-11 00:30:00+08', '2026-08-11 00:30:00+08');

select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.valuations (id, project_id, period_no, period_start, period_end, status)
values ('e6000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a',
        1, '2026-08-01', '2026-08-10', '草稿');
insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
values ('e6000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 40);
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000002');
set local role authenticated;
update public.valuations set status = '已核定' where id = 'e6000000-0000-0000-0000-000000000001';
reset role;

select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ delete from public.photos where id = 'e5000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '已核定估驗涵蓋的照片不可刪除');
select is((select count(*)::int from public.photos
  where id = 'e5000000-0000-0000-0000-000000000001'), 1, '被擋的照片仍在');
select throws_ok($$ update public.photos set work_item_id = null
  where id = 'e5000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '凍結照片不可改掛工項(先洗欄位再刪的繞道被擋)');
-- taken_at null 的照片以 created_at 當凍結依據:洗 created_at 到 period_end
-- 之後=解凍事由①,必須擋
select throws_ok($$ update public.photos set created_at = '2026-09-01'
  where id = 'e5000000-0000-0000-0000-000000000004' $$,
  'P0001', null, '凍結照片不可竄改 created_at(taken_at 為 null 時的解凍繞道被擋)');
select lives_ok($$ update public.photos set caption = '八月澆置'
  where id = 'e5000000-0000-0000-0000-000000000001' $$,
  '凍結照片仍可補註記(caption 等非身分欄)');
select throws_ok($$ delete from public.daily_logs where id = 'e4000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '刪整筆日誌級聯滅證同樣被擋');
select lives_ok($$ delete from public.photos where id = 'e5000000-0000-0000-0000-000000000002' $$,
  'taken_at 晚於核定期別 period_end 的照片不受凍結(後續期別照常清理)');
-- 台北 8/11 00:30 = UTC 8/10 16:30:凍結判定必須以台北日曆日比 period_end,
-- 否則次期凌晨照片被上一期誤凍結(業務日期=台北日曆日的全站原則)
select lives_ok($$ delete from public.photos where id = 'e5000000-0000-0000-0000-000000000006' $$,
  '台北凌晨拍的次期照片不被上一期誤凍結(UTC 時區坑迴歸)');
reset role;

-- ── 佐證凍結:契約重點 evidence 連結 ─────────────────────────────────────────
select pg_temp.become(null);
insert into public.requirements (id, project_id, title, requirement_type, status, origin)
values ('e7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a',
        '澆置佐證照片留存', 'photo', 'approved', 'manual');
insert into public.requirement_artifact_links (requirement_id, artifact_type, artifact_id) values
  ('e7000000-0000-0000-0000-000000000001', 'evidence', 'e5000000-0000-0000-0000-000000000003'),
  ('e7000000-0000-0000-0000-000000000001', 'evidence', 'e5000000-0000-0000-0000-000000000005');

select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ delete from public.photos where id = 'e5000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '被契約重點連結為佐證的照片不可刪除');
-- requirement_artifact_links 是多型連結無 FK:改 PK 會讓連結懸空、凍結事由②
-- 瞬間消失,再刪就無人攔——id 必須在凍結白名單內
select throws_ok($$ update public.photos set id = 'e5000000-0000-0000-0000-000000000099'
  where id = 'e5000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '凍結照片不可改 id(洗掉多型佐證連結的繞道被擋)');
-- 參照動作放行 vs 手動洗欄位:同樣是 work_item_id→null,手動 update 要擋,
-- work_items 刪除的 FK set null(reset_project_boq 標單重匯)要放行——
-- 否則正式模式下一張契約重點佐證照就能把 BOQ 重匯入永久擋死
select throws_ok($$ update public.photos set work_item_id = null
  where id = 'e5000000-0000-0000-0000-000000000005' $$,
  'P0001', null, '手動洗 work_item_id 仍被擋(佐證照片不可徒手解掛工項)');
select lives_ok($$ delete from public.work_items
  where id = 'e3000000-0000-0000-0000-000000000002' $$,
  '刪工項的 FK set null 屬參照動作,凍結照片不擋(標單重匯不被卡死)');
reset role;
select is((select count(*)::int from public.photos
  where id = 'e5000000-0000-0000-0000-000000000005' and work_item_id is null), 1,
  '參照動作只解掛不滅證:照片本體仍在、工項連結已清空');

select pg_temp.become(null);
delete from public.requirement_artifact_links
  where artifact_id = 'e5000000-0000-0000-0000-000000000003';
select lives_ok($$ delete from public.photos where id = 'e5000000-0000-0000-0000-000000000003' $$,
  '解除連結後 service role(遷移/支援)可刪');

-- ── storage.objects:photos bucket 路徑解析([1]=project_id)──────────────────
-- 新版 storage-api 有 protect_objects_delete(擋「非 Storage API 的直刪」防孤兒檔);
-- Storage API 執行刪除時會帶 storage.allow_delete_query,這裡比照設定,
-- 讓測試打到真正的安全邊界(RLS delete policy),而不是被防呆擋在門外
select set_config('storage.allow_delete_query', 'true', true);

insert into storage.objects (bucket_id, name) values
  ('photos', 'e1000000-0000-0000-0000-00000000000a/e4000000-0000-0000-0000-000000000001/ph1.jpg'),
  ('photos', 'e1000000-0000-0000-0000-00000000000a/misc/orphan.jpg'),
  ('photos', 'e1000000-0000-0000-0000-00000000000b/misc/other.jpg');

select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'photos'), 2,
  '廠商只看得到自案路徑前綴的照片檔');
reset role;

select pg_temp.become('e0000000-0000-0000-0000-000000000004');
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'photos'), 1,
  '外案成員只看得到自己專案的照片檔');
reset role;

-- 機關唯讀:RLS delete 政策不符 → 靜默 0 列,檔案仍在
select pg_temp.become('e0000000-0000-0000-0000-000000000003');
set local role authenticated;
delete from storage.objects where bucket_id = 'photos'
  and name = 'e1000000-0000-0000-0000-00000000000a/misc/orphan.jpg';
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'photos'
  and name = 'e1000000-0000-0000-0000-00000000000a/misc/orphan.jpg'), 1,
  '機關(唯讀)刪不動照片檔');

-- 活檔(仍被 photos 列引用)不可經 Storage 直刪——DB guard 的半套繞道
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
delete from storage.objects where bucket_id = 'photos'
  and name = 'e1000000-0000-0000-0000-00000000000a/e4000000-0000-0000-0000-000000000001/ph1.jpg';
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'photos'
  and name = 'e1000000-0000-0000-0000-00000000000a/e4000000-0000-0000-0000-000000000001/ph1.jpg'), 1,
  '仍被 DB 引用的活檔不可直刪(佐證鏈半套繞道被封)');

select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
delete from storage.objects where bucket_id = 'photos'
  and name = 'e1000000-0000-0000-0000-00000000000a/misc/orphan.jpg';
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'photos'
  and name = 'e1000000-0000-0000-0000-00000000000a/misc/orphan.jpg'), 0,
  '孤兒檔(無 DB 引用)廠商可清');

select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into storage.objects (bucket_id, name)
  values ('photos', 'e1000000-0000-0000-0000-00000000000a/misc/new.jpg') $$,
  '廠商可上傳自案路徑前綴的照片檔');
reset role;

select pg_temp.become('e0000000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('photos', 'e1000000-0000-0000-0000-00000000000a/misc/owner.jpg') $$,
  '42501', null, '機關(唯讀)不可上傳照片檔');
reset role;

-- ── storage.objects:contract-documents 路徑解析([4]=契約包 id)───────────────
insert into public.contract_packages
  (id, project_id, counterparty_project_party_id, package_type, title) values
  ('e8000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a',
   'e2000000-0000-0000-0000-000000000001', 'construction', '工程契約包'),
  ('e8000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a',
   'e2000000-0000-0000-0000-000000000002', 'supervision', '監造契約包');
insert into storage.objects (bucket_id, name) values
  ('contract-documents', 'projects/e1000000-0000-0000-0000-00000000000a/contract-packages/e8000000-0000-0000-0000-000000000001/d1/v1/contract.pdf'),
  ('contract-documents', 'projects/e1000000-0000-0000-0000-00000000000a/contract-packages/e8000000-0000-0000-0000-000000000002/d2/v2/supervision.pdf');

select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'contract-documents'), 1,
  '廠商只看得到自己是相對人的契約包原始檔(監造契約包不可見)');
reset role;

select pg_temp.become('e0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'contract-documents'), 2,
  '監造看得到工程契約包(construction)與自己的監造契約包');
reset role;

select pg_temp.become('e0000000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'contract-documents'), 2,
  '機關(agency)看得到全部契約包原始檔');
reset role;

select pg_temp.become('e0000000-0000-0000-0000-000000000004');
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'contract-documents'), 0,
  '外案成員看不到任何契約包原始檔');
reset role;

select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into storage.objects (bucket_id, name)
  values ('contract-documents',
    'projects/e1000000-0000-0000-0000-00000000000a/contract-packages/e8000000-0000-0000-0000-000000000001/d1/v3/rev.pdf') $$,
  '廠商可上傳到自己是相對人的契約包路徑');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('contract-documents',
    'projects/e1000000-0000-0000-0000-00000000000a/contract-packages/e8000000-0000-0000-0000-000000000002/d2/v3/x.pdf') $$,
  '42501', null, '廠商不可上傳到監造契約包路徑(文書壟斷防線)');
reset role;

select * from finish();
rollback;
