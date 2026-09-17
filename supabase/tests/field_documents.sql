-- P2a 現場文書家族 pgTAP:photo_intakes、photos 加欄與 uploader_org 伺服器決定、
-- field_documents／_versions／_signatures／_submissions 的 RLS(三角色＋非成員＋跨案)、
-- 欄位級 grants、版本不可變、雜湊只由 DB 計算、簽署／提送列不可直接寫入、狀態轉移結構要件、稽核事件。
-- 對應 migration 20260917201000_field_documents.sql;設計 docs/architecture/field-documents-lifecycle.md。
-- 「RPC 情境」= superuser 帶 JWT claims(auth.uid() 不為 null、繞過 grant 與 RLS,但 trigger 照跑),
-- 模擬 P2d 的 security definer RPC;「service」= 無 JWT(auth.uid() null)。
begin;

select plan(215);

create or replace function pg_temp.become(u uuid, aal text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else (jsonb_build_object('sub', u::text, 'role', 'authenticated')
               || case when aal is null then '{}'::jsonb else jsonb_build_object('aal', aal) end)::text end, true);
end $$;
select pg_temp.become(null);

-- ── 1. 結構 ─────────────────────────────────────────────────────────────────
select has_table('public', 'photo_intakes', 'photo_intakes 存在');
select has_table('public', 'field_documents', 'field_documents 存在');
select has_table('public', 'field_document_versions', 'field_document_versions 存在');
select has_table('public', 'field_document_signatures', 'field_document_signatures 存在');
select has_table('public', 'field_document_submissions', 'field_document_submissions 存在');
select has_column('public', 'photos', 'uploader_org', 'photos.uploader_org 存在');
select has_column('public', 'photos', 'intake_id', 'photos.intake_id 存在');
select has_column('public', 'photos', 'ai_status', 'photos.ai_status 存在');
select has_column('public', 'photos', 'ai_result', 'photos.ai_result 存在');
select has_column('public', 'photos', 'work_item_hint', 'photos.work_item_hint 存在');
select has_column('public', 'photos', 'content_sha256', 'photos.content_sha256 存在');
select has_trigger('public', 'photos', 'photos_org_stamp', 'photos 上傳方 stamp trigger 掛上');
select has_trigger('public', 'photo_intakes', 'photo_intakes_guard', 'photo_intakes guard 掛上');
select has_trigger('public', 'field_documents', 'field_documents_guard', 'field_documents guard 掛上');
select has_trigger('public', 'field_document_versions', 'field_document_versions_guard', '版本 guard 掛上');
select has_trigger('public', 'field_document_signatures', 'field_document_signatures_guard', '簽署 guard 掛上');
select has_trigger('public', 'field_document_submissions', 'field_document_submissions_guard', '提送 guard 掛上');
select has_function('public', 'fn_field_document_content_hash', array['jsonb','jsonb'], '內容雜湊函式存在');
select has_index('public', 'field_documents', 'field_documents_daily_uidx', '日誌類每日唯一索引存在');
select has_index('public', 'field_documents', 'field_documents_intake_target_uidx', '起稿冪等索引存在');
select has_index('public', 'field_document_submissions', 'field_document_submissions_request_uidx', '送件請求唯一索引存在');
select has_index('public', 'photos', 'photos_intake_idx', 'photos 批次索引存在');
select is(
  public.fn_field_document_content_hash('{"b":1,"a":"x"}'::jsonb, null),
  encode(sha256(convert_to('{"a": "x", "b": 1}' || E'\n' || 'null', 'UTF8')), 'hex'),
  '雜湊=sha256(jsonb 正規化文字 + 換行 + attachments 或 null);鍵序由 jsonb 正規化');
select is(
  public.fn_field_document_content_hash('{"a":1}'::jsonb, '[]'::jsonb),
  public.fn_field_document_content_hash('{"a": 1}'::jsonb, '[]'::jsonb),
  '同值不同寫法的 jsonb 雜湊相同');

-- ── 2. grants:authenticated 只有指定欄位可寫;子表只讀;anon 全無 ───────────────
select is(has_table_privilege('authenticated', 'public.field_document_versions', 'INSERT'), false, '版本表 authenticated 無 INSERT');
select is(has_table_privilege('authenticated', 'public.field_document_versions', 'UPDATE'), false, '版本表 authenticated 無 UPDATE');
select is(has_table_privilege('authenticated', 'public.field_document_versions', 'DELETE'), false, '版本表 authenticated 無 DELETE');
select is(has_any_column_privilege('authenticated', 'public.field_document_versions', 'INSERT'), false, '版本表 authenticated 連欄位級 INSERT 都沒有');
select is(has_table_privilege('authenticated', 'public.field_document_signatures', 'INSERT'), false, '簽署表 authenticated 無 INSERT');
select is(has_any_column_privilege('authenticated', 'public.field_document_signatures', 'INSERT'), false, '簽署表 authenticated 無欄位級 INSERT');
select is(has_table_privilege('authenticated', 'public.field_document_signatures', 'UPDATE'), false, '簽署表 authenticated 無 UPDATE');
select is(has_table_privilege('authenticated', 'public.field_document_signatures', 'DELETE'), false, '簽署表 authenticated 無 DELETE');
select is(has_any_column_privilege('authenticated', 'public.field_document_submissions', 'INSERT'), false, '提送表 authenticated 無欄位級 INSERT');
select is(has_table_privilege('authenticated', 'public.field_document_submissions', 'UPDATE'), false, '提送表 authenticated 無 UPDATE');
select is(has_table_privilege('authenticated', 'public.field_document_submissions', 'DELETE'), false, '提送表 authenticated 無 DELETE');
select is(has_table_privilege('authenticated', 'public.field_document_submissions', 'SELECT'), true, '提送表 authenticated 可讀');
select is(has_table_privilege('authenticated', 'public.field_documents', 'UPDATE'), false, 'field_documents authenticated 無 UPDATE');
select is(has_any_column_privilege('authenticated', 'public.field_documents', 'UPDATE'), false, 'field_documents authenticated 無欄位級 UPDATE');
select is(has_table_privilege('authenticated', 'public.field_documents', 'DELETE'), false, 'field_documents authenticated 無 DELETE');
select is(has_table_privilege('authenticated', 'public.field_documents', 'INSERT'), false, 'field_documents authenticated 無表級 INSERT(只有欄位級)');
select is(has_column_privilege('authenticated', 'public.field_documents', 'doc_type', 'INSERT'), true, 'field_documents.doc_type 可由使用者建立');
select is(has_column_privilege('authenticated', 'public.field_documents', 'status', 'INSERT'), false, 'field_documents.status 使用者不可指定');
select is(has_column_privilege('authenticated', 'public.field_documents', 'current_version_no', 'INSERT'), false, 'current_version_no 使用者不可指定');
select is(has_column_privilege('authenticated', 'public.field_documents', 'required_fields', 'INSERT'), false, 'required_fields 使用者不可指定');
select is(has_column_privilege('authenticated', 'public.field_documents', 'target_id', 'INSERT'), false, 'target_id 使用者不可指定(簽署 RPC 綁定)');
select is(has_column_privilege('authenticated', 'public.photo_intakes', 'uploader_org', 'INSERT'), false, 'photo_intakes.uploader_org 使用者不可指定');
select is(has_column_privilege('authenticated', 'public.photo_intakes', 'photo_count', 'UPDATE'), false, 'photo_intakes 進度欄使用者不可改');
select is(has_column_privilege('authenticated', 'public.photo_intakes', 'shared_inputs', 'UPDATE'), false, 'shared_inputs 使用者不可直接改(走 RPC)');
select is(has_column_privilege('authenticated', 'public.photo_intakes', 'status', 'UPDATE'), true, 'photo_intakes.status 使用者可改(guard 限只能捨棄)');
select is(has_column_privilege('authenticated', 'public.photos', 'uploader_org', 'INSERT'), false, 'photos.uploader_org 使用者不可指定');
select is(has_column_privilege('authenticated', 'public.photos', 'uploader_org', 'UPDATE'), false, 'photos.uploader_org 使用者不可改');
select is(has_column_privilege('authenticated', 'public.photos', 'ai_status', 'UPDATE'), false, 'photos.ai_status 使用者不可改');
select is(has_column_privilege('authenticated', 'public.photos', 'ai_result', 'UPDATE'), false, 'photos.ai_result 使用者不可改');
select is(has_column_privilege('authenticated', 'public.photos', 'work_item_hint', 'INSERT'), false, 'photos.work_item_hint 使用者不可指定');
select is(has_column_privilege('authenticated', 'public.photos', 'caption', 'UPDATE'), true, 'photos.caption 既有欄仍可改');
select is(has_column_privilege('authenticated', 'public.photos', 'location', 'INSERT'), true, 'photos.location 既有欄仍可建立');
select is(has_table_privilege('authenticated', 'public.photos', 'DELETE'), true, 'photos DELETE 表級不變');
select is(has_any_column_privilege('anon', 'public.field_documents', 'SELECT'), false, 'anon 不可讀 field_documents');
select is(has_any_column_privilege('anon', 'public.photo_intakes', 'SELECT'), false, 'anon 不可讀 photo_intakes');

-- ── 3. fixtures:A 案三方＋同方第二人;B 案外人;建案者為獨立 admin;皆正式模式 ─────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fd-contractor@example.test', '', now(), '{}',
   '{"full_name":"廠商工地主任","org_type":"contractor"}', now(), now()),
  ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fd-contractor2@example.test', '', now(), '{}',
   '{"full_name":"廠商品管","org_type":"contractor"}', now(), now()),
  ('f0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fd-supervisor@example.test', '', now(), '{}',
   '{"full_name":"監造工程師","org_type":"supervisor"}', now(), now()),
  ('f0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fd-owner@example.test', '', now(), '{}',
   '{"full_name":"機關承辦","org_type":"owner"}', now(), now()),
  ('f0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fd-outsider@example.test', '', now(), '{}',
   '{"full_name":"外案廠商","org_type":"contractor"}', now(), now()),
  ('f0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fd-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode) values
  ('f1000000-0000-0000-0000-00000000000a', '現場文書測試案', '機關', '廠商', '監造',
   'f0000000-0000-0000-0000-000000000006', true),
  ('f1000000-0000-0000-0000-00000000000b', '外案', '機關', '廠商', '監造',
   'f0000000-0000-0000-0000-000000000006', true);
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'member'),
  ('f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002', 'member'),
  ('f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000003', 'member'),
  ('f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000004', 'member'),
  ('f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000006', 'admin'),
  ('f1000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-000000000005', 'member'),
  ('f1000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-000000000006', 'admin');

insert into public.work_items (id, project_id, item_key, item_no, description, unit, quantity, unit_price, amount, is_leaf)
values ('f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-00000000000a',
        'WI-1', '壹.一.1', '結構混凝土', 'M3', 100, 3000, 300000, true);
insert into public.checklist_templates (id, project_id, title, source, items) values
  ('f4000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-00000000000a', 'A 案自檢範本', '03310', '[]'),
  ('f4000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-00000000000b', 'B 案自檢範本', '03310', '[]');

-- ── 4. photo_intakes:建立、身分 stamp、三角色與非成員 ──────────────────────────
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.photo_intakes (id, project_id, log_date)
  values ('f5000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-00000000000a', '2026-09-17') $$,
  '廠商可建立上傳批次');
select results_eq($$ select uploader_org, created_by, status, photo_count from public.photo_intakes
  where id = 'f5000000-0000-0000-0000-000000000001' $$,
  $$ values ('contractor'::text, 'f0000000-0000-0000-0000-000000000001'::uuid, 'received'::text, 0) $$,
  '批次的上傳方／建立者／狀態由伺服器決定');
select throws_ok($$ insert into public.photo_intakes (project_id, log_date, uploader_org)
  values ('f1000000-0000-0000-0000-00000000000a', '2026-09-17', 'supervisor') $$,
  '42501', null, '廠商不能自稱監造上傳批次(欄位無 INSERT 權限)');
select throws_ok($$ insert into public.photo_intakes (project_id, log_date, status)
  values ('f1000000-0000-0000-0000-00000000000a', '2026-09-17', 'ready') $$,
  '42501', null, '使用者不能指定批次處理狀態');
select throws_ok($$ insert into public.photo_intakes (project_id)
  values ('f1000000-0000-0000-0000-00000000000b') $$,
  '42501', null, '廠商不能在非成員專案建立批次(跨案)');
reset role;

select pg_temp.become('f0000000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$ insert into public.photo_intakes (id, project_id, log_date)
  values ('f5000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-00000000000a', '2026-09-17') $$,
  '監造可建立自己的上傳批次');
select is((select uploader_org from public.photo_intakes where id = 'f5000000-0000-0000-0000-000000000002'),
  'supervisor', '監造批次 stamp 為 supervisor');
select is((select count(*)::int from public.photo_intakes where project_id = 'f1000000-0000-0000-0000-00000000000a'),
  2, '監造(專案成員)看得到本案所有批次');
-- 他方批次:RLS 過濾 → 0 列受影響、資料不變
update public.photo_intakes set log_date = '2026-01-01' where id = 'f5000000-0000-0000-0000-000000000001';
select is((select log_date from public.photo_intakes where id = 'f5000000-0000-0000-0000-000000000001'),
  '2026-09-17'::date, '監造改不動廠商的批次(RLS 依上傳方隔離)');
reset role;

select pg_temp.become('f0000000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ insert into public.photo_intakes (project_id, log_date)
  values ('f1000000-0000-0000-0000-00000000000a', '2026-09-17') $$,
  '42501', null, '機關(正式模式唯讀)不可建立上傳批次');
select is((select count(*)::int from public.photo_intakes where project_id = 'f1000000-0000-0000-0000-00000000000a'),
  2, '機關可讀本案批次');
reset role;

select pg_temp.become('f0000000-0000-0000-0000-000000000005');
set local role authenticated;
select is((select count(*)::int from public.photo_intakes where project_id = 'f1000000-0000-0000-0000-00000000000a'),
  0, '非成員看不到 A 案批次');
reset role;

-- ── 5. photos:uploader_org 由伺服器決定、批次一致性、AI 欄不可由客戶端寫 ─────────
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.photos (id, project_id, storage_path, intake_id, content_sha256, uploaded_by)
  values ('f6000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-00000000000a',
          'f1000000-0000-0000-0000-00000000000a/intake/f5000000-0000-0000-0000-000000000001/p1.jpg',
          'f5000000-0000-0000-0000-000000000001',
          repeat('a', 64), 'f0000000-0000-0000-0000-000000000002') $$,
  '廠商可把照片掛進自己方的批次');
select results_eq($$ select uploader_org, uploaded_by, ai_status from public.photos
  where id = 'f6000000-0000-0000-0000-000000000001' $$,
  $$ values ('contractor'::text, 'f0000000-0000-0000-0000-000000000001'::uuid, 'pending'::text) $$,
  '上傳方 stamp 為 contractor、uploaded_by 蓋成登錄者(客戶端冒名無效)、批次照片預設待辨識');
select throws_ok($$ insert into public.photos (project_id, storage_path, uploader_org)
  values ('f1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a/misc/x.jpg', 'supervisor') $$,
  '42501', null, '客戶端不能指定 uploader_org');
select throws_ok($$ insert into public.photos (project_id, storage_path, ai_status, ai_result)
  values ('f1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a/misc/x.jpg',
          'done', '{"whiteboard":{"qty":100}}') $$,
  '42501', null, '客戶端不能自稱辨識結果(ai_status／ai_result 無 INSERT 權限)');
select throws_ok($$ update public.photos set ai_status = 'done'
  where id = 'f6000000-0000-0000-0000-000000000001' $$,
  '42501', null, '客戶端不能改 ai_status');
select throws_ok($$ insert into public.photos (project_id, storage_path, intake_id)
  values ('f1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a/misc/y.jpg',
          'f5000000-0000-0000-0000-000000000002') $$,
  'P0001', null, '廠商照片不能掛進監造的批次(上傳方不一致)');
select throws_ok($$ update public.photos set intake_id = null
  where id = 'f6000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '照片登錄批次後不可移除或改掛');
select throws_ok($$ update public.photos set content_sha256 = repeat('b', 64)
  where id = 'f6000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '內容雜湊登錄後不可變更');
select throws_ok($$ update public.photos set uploaded_by = 'f0000000-0000-0000-0000-000000000002'
  where id = 'f6000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '上傳者不可變更');
select throws_ok($$ insert into public.photos (project_id, storage_path, content_sha256)
  values ('f1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a/misc/z.jpg', 'not-a-hash') $$,
  '23514', null, 'content_sha256 必須是 64 位十六進位');
select lives_ok($$ update public.photos set caption = '澆置中'
  where id = 'f6000000-0000-0000-0000-000000000001' $$,
  '既有註記欄照常可改(舊前端路徑不受影響)');
select lives_ok($$ insert into public.photos (id, project_id, storage_path, intake_id, content_sha256)
  values ('f6000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-00000000000a',
          'f1000000-0000-0000-0000-00000000000a/intake/f5000000-0000-0000-0000-000000000001/p2.jpg',
          'f5000000-0000-0000-0000-000000000001', repeat('a', 64)) $$,
  '同批次同雜湊的重複照片仍可保存(由 Edge 標 duplicate,不刪)');
reset role;

-- RPC 情境(有 JWT、繞過 grant)也改不了伺服器事實
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
select throws_ok($$ update public.photos set uploader_org = 'supervisor'
  where id = 'f6000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '有 JWT 的特權路徑也不能改 uploader_org');
-- 跨案批次
select throws_ok($$ insert into public.photos (project_id, storage_path, intake_id)
  values ('f1000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-00000000000b/misc/x.jpg',
          'f5000000-0000-0000-0000-000000000001') $$,
  'P0001', null, '照片與批次必須同一專案');
select pg_temp.become(null);

-- service(無 JWT)路徑:依 uploaded_by 的 profile 推得才回填,推不出=null(未知),不猜
select lives_ok($$ insert into public.photos (id, project_id, storage_path, uploaded_by)
  values ('f6000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-00000000000a',
          'f1000000-0000-0000-0000-00000000000a/misc/legacy1.jpg', 'f0000000-0000-0000-0000-000000000003') $$,
  'service 路徑可插入(模擬舊資料)');
select is((select uploader_org from public.photos where id = 'f6000000-0000-0000-0000-000000000003'),
  'supervisor', '舊照片依上傳者 profile 推得 uploader_org');
select lives_ok($$ insert into public.photos (id, project_id, storage_path)
  values ('f6000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-00000000000a',
          'f1000000-0000-0000-0000-00000000000a/misc/legacy2.jpg') $$,
  '無上傳者的舊照片可插入');
select is((select uploader_org from public.photos where id = 'f6000000-0000-0000-0000-000000000004'),
  null, '推不出上傳方的舊照片維持 null(未知),不猜');
select throws_ok($$ update public.photos set intake_id = 'f5000000-0000-0000-0000-000000000001'
  where id = 'f6000000-0000-0000-0000-000000000004' $$,
  'P0001', null, '上傳方未知的照片不能掛進批次');
select is((select ai_status from public.photos where id = 'f6000000-0000-0000-0000-000000000004'),
  null, '非批次照片 ai_status 維持 null');

-- ── 6. photo_intakes:狀態／候選／刪除規則 ───────────────────────────────────────
select pg_temp.become(null);
update public.photo_intakes set status = 'ready', photo_count = 2,
  candidates = '[{"doc_type":"daily_log","target_key":null,"reason":"當日照片"},{"doc_type":"self_check","target_key":"wi-1","reason":"配到工項"}]'
  where id = 'f5000000-0000-0000-0000-000000000001';
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ update public.photo_intakes set status = 'received'
  where id = 'f5000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '使用者不能把批次改回其他處理狀態');
select throws_ok($$ update public.photo_intakes set photo_count = 99
  where id = 'f5000000-0000-0000-0000-000000000001' $$,
  '42501', null, '使用者不能改進度欄');
select lives_ok($$ update public.photo_intakes
  set candidates = '[{"doc_type":"daily_log","target_key":null,"reason":"當日照片"},{"doc_type":"self_check","target_key":"wi-1","reason":"配到工項","excluded":true}]'
  where id = 'f5000000-0000-0000-0000-000000000001' $$,
  '使用者可排除候選文書(只改 excluded)');
select throws_ok($$ update public.photo_intakes
  set candidates = '[{"doc_type":"daily_log","target_key":null,"reason":"當日照片"},{"doc_type":"inspection_form","target_key":"wi-1","reason":"配到工項","excluded":true}]'
  where id = 'f5000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '使用者不能改候選清單本身(換文書類型)');
select throws_ok($$ update public.photo_intakes set candidates = '[]'
  where id = 'f5000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '使用者不能清空候選清單');
select throws_ok($$ delete from public.photo_intakes where id = 'f5000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '已有照片的批次不可刪除');
select lives_ok($$ insert into public.photo_intakes (id, project_id)
  values ('f5000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-00000000000a') $$,
  '建立空批次');
select lives_ok($$ delete from public.photo_intakes where id = 'f5000000-0000-0000-0000-000000000003' $$,
  'received 且無照片的空批次可刪');
select lives_ok($$ update public.photo_intakes set status = 'discarded'
  where id = 'f5000000-0000-0000-0000-000000000001' $$,
  '使用者可捨棄自己方的批次');
select throws_ok($$ update public.photo_intakes set log_date = '2026-09-18'
  where id = 'f5000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '已捨棄的批次不可再變更');
reset role;
select pg_temp.become(null);
-- 供後續文件測試:把廠商批次還原為 ready(service 路徑)
update public.photo_intakes set status = 'ready' where id = 'f5000000-0000-0000-0000-000000000001';

-- ── 7. field_documents:建立、owner_org 由類型決定、三角色與非成員、唯一性 ──────────
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date, intake_id)
  values ('f7000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-00000000000a',
          'daily_log', '2026-09-17', 'f5000000-0000-0000-0000-000000000001') $$,
  '廠商可建立施工日誌草稿');
select results_eq($$ select owner_org, target_table, status, current_version_no, created_by
  from public.field_documents where id = 'f7000000-0000-0000-0000-000000000001' $$,
  $$ values ('contractor'::text, 'daily_logs'::text, 'draft'::text, 0, 'f0000000-0000-0000-0000-000000000001'::uuid) $$,
  '責任方／事實表由類型產生;狀態草稿、版本 0、建立者=登錄者');
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date)
  values ('f1000000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-17') $$,
  '23505', null, '同案同日只能有一份活的施工日誌文件');
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date)
  values ('f1000000-0000-0000-0000-00000000000a', 'supervisor_log', '2026-09-17') $$,
  '42501', null, '廠商不能建立監造日誌(責任方不符,RLS 擋)');
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date)
  values ('f1000000-0000-0000-0000-00000000000a', 'inspection_form', '2026-09-17') $$,
  '42501', null, '廠商不能建立監造查驗表單');
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date, status)
  values ('f1000000-0000-0000-0000-00000000000a', 'self_check', '2026-09-17', 'signed') $$,
  '42501', null, '使用者不能指定文件狀態');
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date, template_id)
  values ('f1000000-0000-0000-0000-00000000000a', 'self_check', '2026-09-17', 'f4000000-0000-0000-0000-000000000002') $$,
  'P0001', null, '範本必須屬於同一專案');
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date, intake_id)
  values ('f1000000-0000-0000-0000-00000000000a', 'self_check', '2026-09-17', 'f5000000-0000-0000-0000-000000000002') $$,
  'P0001', null, '監造的照片批次不能起稿廠商文件');
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date, template_id)
  values ('f7000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-00000000000a',
          'self_check', '2026-09-17', 'f4000000-0000-0000-0000-000000000001') $$,
  '廠商可建立自主檢查表草稿(同案範本)');
select throws_ok($$ update public.field_documents set doc_date = '2026-09-18'
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  '42501', null, '使用者不能直接改文件(無 UPDATE 權限;走 RPC)');
select throws_ok($$ delete from public.field_documents where id = 'f7000000-0000-0000-0000-000000000001' $$,
  '42501', null, '使用者不能直接刪文件');
reset role;

select pg_temp.become('f0000000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date, intake_id)
  values ('f7000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-00000000000a',
          'supervisor_log', '2026-09-17', 'f5000000-0000-0000-0000-000000000002') $$,
  '監造可建立監造日誌草稿(自己的批次)');
select is((select owner_org from public.field_documents where id = 'f7000000-0000-0000-0000-000000000003'),
  'supervisor', '監造日誌責任方=supervisor');
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date, intake_id)
  values ('f1000000-0000-0000-0000-00000000000a', 'supervisor_log', '2026-09-18', 'f5000000-0000-0000-0000-000000000001') $$,
  'P0001', null, '廠商的照片批次不能起稿監造日誌');
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date)
  values ('f1000000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-18') $$,
  '42501', null, '監造不能建立施工日誌');
select is((select count(*)::int from public.field_documents where project_id = 'f1000000-0000-0000-0000-00000000000a'),
  3, '監造看得到本案全部文件');
reset role;

select pg_temp.become('f0000000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date)
  values ('f1000000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-18') $$,
  '42501', null, '機關不能建立任何現場文書');
select is((select count(*)::int from public.field_documents where project_id = 'f1000000-0000-0000-0000-00000000000a'),
  3, '機關可讀本案全部文件(含監造日誌)');
reset role;

select pg_temp.become('f0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*)::int from public.field_documents where doc_type = 'supervisor_log'),
  1, '廠商成員可讀監造日誌(Q4 暫行:專案成員可讀)');
reset role;

select pg_temp.become('f0000000-0000-0000-0000-000000000005');
set local role authenticated;
select is((select count(*)::int from public.field_documents), 0, '非成員看不到 A 案任何文件');
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date)
  values ('f1000000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-18') $$,
  '42501', null, '非成員不能在 A 案建立文件(跨案)');
reset role;

-- ── 8. 版本:只讀給使用者;雜湊由 DB;版本號連續;作者情境;不可變;附件同專案 ──────
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content)
  values ('f7000000-0000-0000-0000-000000000001', 'human', '{"work_summary":"x"}') $$,
  '42501', null, '使用者不能直接寫版本(走 save_field_document_version RPC)');
reset role;

-- service 寫 AI 版本(P2b 路徑)
select pg_temp.become(null);
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content)
  values ('f7000000-0000-0000-0000-000000000001', 'human', '{"work_summary":"x"}') $$,
  'P0001', null, '伺服器不得代寫人工版本');
select lives_ok($$ insert into public.field_document_versions (id, document_id, author_kind, content, field_sources, attachments, content_hash)
  values ('f8000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'ai',
          '{"work_summary":"混凝土澆置","items":{"f3000000-0000-0000-0000-000000000001":{"qty_today":null}}}',
          '{"work_summary":{"status":"filled","source":"ai:photo"}}',
          '[{"photo_id":"f6000000-0000-0000-0000-000000000001","storage_path":"f1000000-0000-0000-0000-00000000000a/intake/f5000000-0000-0000-0000-000000000001/p1.jpg","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]',
          repeat('0', 64)) $$,
  'service 可寫 AI 版本 1');
select results_eq($$ select version_no, created_by, content_hash from public.field_document_versions
  where id = 'f8000000-0000-0000-0000-000000000001' $$,
  $$ select 1, null::uuid, public.fn_field_document_content_hash(v.content, v.attachments)
     from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000001' $$,
  '版本號=1、AI 版本 created_by 為 null、客戶端傳的雜湊被 DB 計算值覆蓋');
select throws_ok($$ insert into public.field_document_versions (document_id, version_no, author_kind, content)
  values ('f7000000-0000-0000-0000-000000000001', 5, 'ai', '{}') $$,
  'P0001', null, '版本號必須是下一版');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, attachments)
  values ('f7000000-0000-0000-0000-000000000001', 'ai', '{}',
          '[{"photo_id":"f6000000-0000-0000-0000-0000000000ff"}]') $$,
  'P0001', null, '附件照片不存在 → 拒絕');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, attachments)
  values ('f7000000-0000-0000-0000-000000000001', 'ai', '{}',
          '[{"photo_id":"f6000000-0000-0000-0000-000000000001","storage_path":"other/path.jpg"}]') $$,
  'P0001', null, '附件路徑與照片紀錄不符 → 拒絕');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, attachments)
  values ('f7000000-0000-0000-0000-000000000001', 'ai', '{}', '[{"caption":"no id"}]') $$,
  'P0001', null, '附件缺 photo_id → 拒絕');
select throws_ok($$ update public.field_document_versions set content = '{"work_summary":"改寫"}'
  where id = 'f8000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '版本不可變:service 也不能 UPDATE');
select throws_ok($$ delete from public.field_document_versions where id = 'f8000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '版本不可變:service 也不能 DELETE');
-- AI 重跑:新增版本 2(不重寫版本 1)
select lives_ok($$ insert into public.field_document_versions (document_id, author_kind, content)
  values ('f7000000-0000-0000-0000-000000000001', 'ai', '{"work_summary":"混凝土澆置(重跑)"}') $$,
  'AI 重跑以新版本保存,不重寫舊版');
select is((select max(version_no) from public.field_document_versions
  where document_id = 'f7000000-0000-0000-0000-000000000001'), 2, '重跑後版本 2');

-- RPC 情境:人工版本
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content)
  values ('f7000000-0000-0000-0000-000000000001', 'ai', '{}') $$,
  'P0001', null, '有 JWT 的路徑不能建立 AI 版本(AI 版本只由 service)');
select lives_ok($$ insert into public.field_document_versions (id, document_id, author_kind, content, amended_from_version, created_by)
  values ('f8000000-0000-0000-0000-000000000003', 'f7000000-0000-0000-0000-000000000001', 'human',
          '{"work_summary":"混凝土澆置 3F 版牆","items":{"f3000000-0000-0000-0000-000000000001":{"qty_today":12}}}',
          2, 'f0000000-0000-0000-0000-000000000002') $$,
  'RPC 情境可建立人工版本 3');
select results_eq($$ select version_no, created_by from public.field_document_versions
  where id = 'f8000000-0000-0000-0000-000000000003' $$,
  $$ values (3, 'f0000000-0000-0000-0000-000000000001'::uuid) $$,
  '人工版本 created_by 蓋成登錄者(冒名無效)');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, amended_from_version)
  values ('f7000000-0000-0000-0000-000000000001', 'human', '{}', 9) $$,
  'P0001', null, '更正來源版本不存在 → 拒絕');
select pg_temp.become(null);
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content)
  values ('f7000000-0000-0000-0000-000000000001', 'ai', '{"work_summary":"AI 又來"}') $$,
  'P0001', null, '文件已有人工版本後 AI 不得再寫版本(重試不覆蓋人工修正)');

-- 使用者可讀版本;非成員不可
select pg_temp.become('f0000000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select count(*)::int from public.field_document_versions
  where document_id = 'f7000000-0000-0000-0000-000000000001'), 3, '監造可讀廠商文件的版本');
reset role;
select pg_temp.become('f0000000-0000-0000-0000-000000000005');
set local role authenticated;
select is((select count(*)::int from public.field_document_versions), 0, '非成員讀不到任何版本');
reset role;

-- ── 9. 文件狀態:版本指標與簽署結構要件(RPC 情境) ──────────────────────────────
select pg_temp.become('f0000000-0000-0000-0000-000000000001', 'aal2');
select throws_ok($$ update public.field_documents set current_version_no = 5
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '版本指標必須指向已存在的最新版本');
select lives_ok($$ update public.field_documents set current_version_no = 3
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  'RPC 可把版本指標推到 3');
select throws_ok($$ update public.field_documents set current_version_no = 2
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '版本指標不可回退');
select throws_ok($$ update public.field_documents set status = 'signed'
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '沒有簽署紀錄不能標 signed(狀態不能憑空宣稱)');
select throws_ok($$ update public.field_documents set status = 'submitted'
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '未簽署不能直接 submitted');
select throws_ok($$ update public.field_documents set doc_type = 'self_check'
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '文件類型不可變更');

-- ── 10. 簽署:只在有登入者的情境;目前版本;雜湊;責任方;伺服器取簽署者資料;aal 一致 ──
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ insert into public.field_document_signatures (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000001', 'contractor', '本人確認內容無誤', 'platform_account_mfa'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  '42501', null, '使用者不能直接寫簽署列(只走 sign_field_document RPC)');
reset role;
select pg_temp.become(null);
select throws_ok($$ insert into public.field_document_signatures (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000001', 'contractor', '本人確認內容無誤', 'platform_account_mfa'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '伺服器(無 JWT)不得代簽');
-- 監造簽廠商文件
select pg_temp.become('f0000000-0000-0000-0000-000000000003', 'aal2');
select throws_ok($$ insert into public.field_document_signatures (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000003', 'supervisor', '本人確認內容無誤', 'platform_account_mfa'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '監造不能簽署施工日誌(責任方不符,越權簽署)');
-- 非成員(外案)簽 A 案文件
select pg_temp.become('f0000000-0000-0000-0000-000000000005', 'aal2');
select throws_ok($$ insert into public.field_document_signatures (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000005', 'contractor', '本人確認內容無誤', 'platform_account_mfa'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '非成員不能簽署(跨案取件受阻)');
-- 廠商:舊版本、雜湊不符、aal 不足、空白意願
select pg_temp.become('f0000000-0000-0000-0000-000000000001', 'aal1');
select throws_ok($$ insert into public.field_document_signatures (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  select 'f7000000-0000-0000-0000-000000000001', 2, v.content_hash, 'f0000000-0000-0000-0000-000000000001', 'contractor', '本人確認內容無誤', 'platform_account_mfa'
  from public.field_document_versions v where v.document_id = 'f7000000-0000-0000-0000-000000000001' and v.version_no = 2 $$,
  'P0001', null, '簽舊版本(畫面是舊版)→ 拒絕');
select throws_ok($$ insert into public.field_document_signatures (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  values ('f7000000-0000-0000-0000-000000000001', 3, repeat('f', 64), 'f0000000-0000-0000-0000-000000000001', 'contractor', '本人確認內容無誤', 'platform_account_mfa') $$,
  'P0001', null, '簽署雜湊與版本內容不符 → 拒絕');
select throws_ok($$ insert into public.field_document_signatures (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000001', 'contractor', '本人確認內容無誤', 'platform_account_mfa'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '登記為 MFA 簽署但 JWT 只有 aal1 → 拒絕(登記不得說謊)');
select pg_temp.become('f0000000-0000-0000-0000-000000000001', 'aal2');
select throws_ok($$ insert into public.field_document_signatures (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000001', 'contractor', '   ', 'platform_account_mfa'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  '23514', null, '簽署意願聲明不可空白');
select throws_ok($$ insert into public.field_document_signatures (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000001', 'contractor', '紙本', 'paper_scan'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '紙本簽回缺掃描檔證據 → 拒絕');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.9","user-agent":"pgTAP/1.0"}', true);
select lives_ok($$ insert into public.field_document_signatures (id, document_id, version_no, content_hash, signer_id, signer_org, signer_name_snapshot, signed_at, intent, method, aal)
  select 'f9000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash,
         'f0000000-0000-0000-0000-000000000002', 'supervisor', '冒名', '2000-01-01', '本人確認 2026-09-17 施工日誌內容無誤並簽署', 'platform_account_mfa', 'aal9'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  '廠商成員以 aal2 簽署目前版本成功');
select results_eq($$ select signer_id, signer_org, signer_name_snapshot, aal, host(request_ip), user_agent,
    (signed_at > now() - interval '1 minute') from public.field_document_signatures
  where id = 'f9000000-0000-0000-0000-000000000001' $$,
  $$ values ('f0000000-0000-0000-0000-000000000001'::uuid, 'contractor'::text, '廠商工地主任'::text, 'aal2'::text,
             '203.0.113.9'::text, 'pgTAP/1.0'::text, true) $$,
  '簽署者／組織／姓名快照／aal／IP／UA／簽署時間全由伺服器取,客戶端傳值作廢');
select throws_ok($$ insert into public.field_document_signatures (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000001', 'contractor', '再簽', 'platform_account_mfa'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  '23505', null, '同人同版本不可重複簽署(冪等鍵)');
select throws_ok($$ update public.field_document_signatures set intent = '改掉'
  where id = 'f9000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '簽署列不可修改');
select throws_ok($$ delete from public.field_document_signatures where id = 'f9000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '簽署列不可刪除');
select lives_ok($$ update public.field_documents set status = 'signed'
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  '有目前版本的簽署紀錄後可標 signed');
select is((select count(*)::int from public.audit_events
  where event_type = 'field_document.signed' and entity_id = 'f7000000-0000-0000-0000-000000000001'
    and metadata ->> 'aal' = 'aal2' and metadata ->> 'method' = 'platform_account_mfa'),
  1, '簽署留一筆 field_document.signed 稽核事件(含 aal／method)');
select is((select count(*)::int from public.audit_events
  where event_type = 'field_document.signed' and (after_data ? 'request_ip' or after_data ? 'user_agent')),
  0, '稽核 after_data 不重複保存 IP／UA');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content)
  values ('f7000000-0000-0000-0000-000000000001', 'ai', '{}') $$,
  'P0001', null, '簽署後 AI 也不能加版本(已有人工版本)');
select throws_ok($$ update public.field_documents set status = 'draft'
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '簽後回草稿必須先有新版本(不能沿用舊簽名改內容)');
select throws_ok($$ update public.field_documents set doc_date = '2026-09-18'
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '已有簽署紀錄的文件不可改業務日期');
select throws_ok($$ update public.field_documents set status = 'discarded'
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '已簽署的文件不可捨棄');
select throws_ok($$ delete from public.field_documents where id = 'f7000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '已簽署的文件 service 也不可刪除');

-- ── 11. 提送／收件／退回 ─────────────────────────────────────────────────────
select pg_temp.become('f0000000-0000-0000-0000-000000000001', 'aal2');
select throws_ok($$ insert into public.field_document_submissions (document_id, version_no, content_hash, actor_id, actor_org, action, to_org)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000001', 'contractor', 'submit', 'owner'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '施工日誌不能提送給機關(對象矩陣)');
select throws_ok($$ insert into public.field_document_submissions (document_id, version_no, content_hash, actor_id, actor_org, action, to_org)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000001', 'contractor', 'receive', 'supervisor'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '尚未提送不能收件');
select lives_ok($$ insert into public.field_document_submissions (id, document_id, version_no, content_hash, actor_id, actor_org, action, to_org, client_request_id, diff, created_at)
  select 'fa000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash,
         'f0000000-0000-0000-0000-000000000004', 'owner', 'submit', 'supervisor', 'req-1', '{"changed_keys":["fake"]}', '2000-01-01'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  '責任方可提送已簽署版本給監造');
select results_eq($$ select actor_id, actor_org, diff, (created_at > now() - interval '1 minute')
  from public.field_document_submissions where id = 'fa000000-0000-0000-0000-000000000001' $$,
  $$ values ('f0000000-0000-0000-0000-000000000001'::uuid, 'contractor'::text, null::jsonb, true) $$,
  '提送者／組織／回執時間由伺服器取;首次提送無 diff(客戶端傳的 diff 作廢)');
select throws_ok($$ insert into public.field_document_submissions (document_id, version_no, content_hash, actor_id, actor_org, action, to_org, client_request_id)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000001', 'contractor', 'submit', 'supervisor', 'req-1'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  '23505', null, '同 client_request_id 重送被唯一鍵擋下(送件重試防重複)');
select lives_ok($$ update public.field_documents set status = 'submitted'
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  '有提送紀錄後可標 submitted');
select throws_ok($$ insert into public.field_document_submissions (document_id, version_no, content_hash, actor_id, actor_org, action, to_org)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000001', 'contractor', 'receive', 'supervisor'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '提送方自己不能收件(收件只能由提送對象)');
-- 機關(非提送對象)收件
select pg_temp.become('f0000000-0000-0000-0000-000000000004', 'aal2');
select throws_ok($$ insert into public.field_document_submissions (document_id, version_no, content_hash, actor_id, actor_org, action, to_org)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000004', 'owner', 'receive', 'owner'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '非提送對象(機關)不能收件施工日誌');
-- 監造收件、退回
select pg_temp.become('f0000000-0000-0000-0000-000000000003', 'aal2');
select lives_ok($$ insert into public.field_document_submissions (id, document_id, version_no, content_hash, actor_id, actor_org, action, to_org)
  select 'fa000000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash,
         'f0000000-0000-0000-0000-000000000003', 'supervisor', 'receive', 'contractor'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  '監造(提送對象)可收件');
select is((select to_org from public.field_document_submissions where id = 'fa000000-0000-0000-0000-000000000002'),
  'supervisor', '收件列的 to_org 由伺服器帶入提送對象(客戶端值作廢)');
select lives_ok($$ update public.field_documents set status = 'received'
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  '有收件紀錄後可標 received');
select throws_ok($$ insert into public.field_document_submissions (document_id, version_no, content_hash, actor_id, actor_org, action, to_org)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000003', 'supervisor', 'return', 'contractor'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '退回未填原因 → 拒絕');
select lives_ok($$ insert into public.field_document_submissions (id, document_id, version_no, content_hash, actor_id, actor_org, action, to_org, reason)
  select 'fa000000-0000-0000-0000-000000000003', 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash,
         'f0000000-0000-0000-0000-000000000003', 'supervisor', 'return', 'contractor', '出工人數與現場不符,請更正'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  '監造可附原因退回');
select lives_ok($$ update public.field_documents set status = 'returned'
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  '有退回紀錄後可標 returned');
select throws_ok($$ update public.field_document_submissions set reason = '改口'
  where id = 'fa000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '退回紀錄不可修改');
select throws_ok($$ delete from public.field_document_submissions where id = 'fa000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '提送紀錄不可刪除');
-- 退回後再送:新版本→重簽→再送,diff 由 DB 算
select pg_temp.become('f0000000-0000-0000-0000-000000000001', 'aal2');
select throws_ok($$ insert into public.field_document_submissions (document_id, version_no, content_hash, actor_id, actor_org, action, to_org)
  select 'f7000000-0000-0000-0000-000000000001', 3, v.content_hash, 'f0000000-0000-0000-0000-000000000001', 'contractor', 'submit', 'supervisor'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000003' $$,
  'P0001', null, '退回後不能原版再送(狀態 returned 需新版本重簽)');
select lives_ok($$ insert into public.field_document_versions (id, document_id, author_kind, content, amended_from_version, change_note)
  values ('f8000000-0000-0000-0000-000000000004', 'f7000000-0000-0000-0000-000000000001', 'human',
          '{"work_summary":"混凝土澆置 3F 版牆","items":{"f3000000-0000-0000-0000-000000000001":{"qty_today":12}},"labor":{"total":8}}',
          3, '依監造退回意見補出工') $$,
  '退回後建立更正版本 4');
select lives_ok($$ update public.field_documents set status = 'draft', current_version_no = 4
  where id = 'f7000000-0000-0000-0000-000000000001' $$,
  '以新版本回到草稿(原簽署與提送列不動)');
select is((select count(*)::int from public.audit_events
  where event_type = 'field_document.amended' and entity_id = 'f7000000-0000-0000-0000-000000000001'), 1,
  '簽後更正留一筆 field_document.amended');
select lives_ok($$ insert into public.field_document_signatures (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  select 'f7000000-0000-0000-0000-000000000001', 4, v.content_hash, 'f0000000-0000-0000-0000-000000000001', 'contractor', '本人確認更正後內容無誤並簽署', 'platform_account_mfa'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000004' $$,
  '重簽版本 4');
update public.field_documents set status = 'signed' where id = 'f7000000-0000-0000-0000-000000000001';
select lives_ok($$ insert into public.field_document_submissions (id, document_id, version_no, content_hash, actor_id, actor_org, action, to_org, client_request_id)
  select 'fa000000-0000-0000-0000-000000000004', 'f7000000-0000-0000-0000-000000000001', 4, v.content_hash,
         'f0000000-0000-0000-0000-000000000001', 'contractor', 'submit', 'supervisor', 'req-2'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000004' $$,
  '再送版本 4');
select is((select diff from public.field_document_submissions where id = 'fa000000-0000-0000-0000-000000000004'),
  '{"against_version_no": 3, "changed_keys": ["labor"]}'::jsonb,
  '再送 diff 由 DB 比對前次退回版本:只有 labor 變更');
select is((select count(*)::int from public.field_document_submissions
  where document_id = 'f7000000-0000-0000-0000-000000000001'), 4,
  '歷次提送／收件／退回全部保留');
select results_eq($$ select event_type, count(*)::int from public.audit_events
  where entity_id = 'f7000000-0000-0000-0000-000000000001'
    and event_type in ('field_document.submitted','field_document.received','field_document.returned')
  group by event_type order by event_type $$,
  $$ values ('field_document.received'::text, 1), ('field_document.returned'::text, 1),
            ('field_document.submitted'::text, 2) $$,
  '提送／收件／退回各留稽核事件(提送 2、收件 1、退回 1)');
select is((select count(*)::int from public.audit_events
  where event_type = 'field_document.version_saved' and entity_id = 'f7000000-0000-0000-0000-000000000001'), 4,
  '每個版本各留一筆 field_document.version_saved');
select is((select count(*)::int from public.audit_events
  where event_type = 'field_document.created' and entity_id = 'f7000000-0000-0000-0000-000000000001'), 1,
  '文件建立留一筆 field_document.created');

-- 非成員(RPC 情境)不能提送 A 案文件
select pg_temp.become('f0000000-0000-0000-0000-000000000005', 'aal2');
select throws_ok($$ insert into public.field_document_submissions (document_id, version_no, content_hash, actor_id, actor_org, action, to_org)
  select 'f7000000-0000-0000-0000-000000000001', 4, v.content_hash, 'f0000000-0000-0000-0000-000000000005', 'contractor', 'submit', 'supervisor'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000004' $$,
  'P0001', null, '非成員不能提送(跨案取件受阻)');

-- 使用者可讀簽署／提送列;非成員不可
select pg_temp.become('f0000000-0000-0000-0000-000000000004');
set local role authenticated;
select is((select count(*)::int from public.field_document_signatures), 2, '機關可讀本案簽署紀錄');
select is((select count(*)::int from public.field_document_submissions), 4, '機關可讀本案提送歷史');
reset role;
select pg_temp.become('f0000000-0000-0000-0000-000000000005');
set local role authenticated;
select is((select count(*)::int from public.field_document_signatures), 0, '非成員讀不到簽署紀錄');
select is((select count(*)::int from public.field_document_submissions), 0, '非成員讀不到提送歷史');
reset role;

-- ── 12. 捨棄／取代與監造查驗表單提送矩陣 ──────────────────────────────────────
select pg_temp.become('f0000000-0000-0000-0000-000000000001', 'aal2');
select lives_ok($$ update public.field_documents set status = 'discarded'
  where id = 'f7000000-0000-0000-0000-000000000002' $$,
  '未簽署的草稿可捨棄');
select is((select count(*)::int from public.audit_events
  where event_type = 'field_document.discarded' and entity_id = 'f7000000-0000-0000-0000-000000000002'), 1,
  '捨棄留一筆 field_document.discarded');
select throws_ok($$ update public.field_documents set status = 'draft'
  where id = 'f7000000-0000-0000-0000-000000000002' $$,
  'P0001', null, '捨棄為終態');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content)
  values ('f7000000-0000-0000-0000-000000000002', 'human', '{}') $$,
  'P0001', null, '捨棄的文件不可再加版本');
-- 監造以 aal2 對監造日誌建版本、簽署、提送給機關
select pg_temp.become('f0000000-0000-0000-0000-000000000003', 'aal2');
insert into public.field_document_versions (id, document_id, author_kind, content)
  values ('f8000000-0000-0000-0000-000000000005', 'f7000000-0000-0000-0000-000000000003', 'human',
          '{"attendance":[{"name":"監造工程師","from":"08:00","to":"17:00"}]}');
update public.field_documents set current_version_no = 1 where id = 'f7000000-0000-0000-0000-000000000003';
insert into public.field_document_signatures (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  select 'f7000000-0000-0000-0000-000000000003', 1, v.content_hash, 'f0000000-0000-0000-0000-000000000003', 'supervisor', '本人確認監造日誌內容無誤並簽署', 'platform_account_mfa'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000005';
update public.field_documents set status = 'signed' where id = 'f7000000-0000-0000-0000-000000000003';
select throws_ok($$ insert into public.field_document_submissions (document_id, version_no, content_hash, actor_id, actor_org, action, to_org)
  select 'f7000000-0000-0000-0000-000000000003', 1, v.content_hash, 'f0000000-0000-0000-0000-000000000003', 'supervisor', 'submit', 'contractor'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000005' $$,
  'P0001', null, '監造日誌不能提送給廠商(只送機關)');
select lives_ok($$ insert into public.field_document_submissions (document_id, version_no, content_hash, actor_id, actor_org, action, to_org)
  select 'f7000000-0000-0000-0000-000000000003', 1, v.content_hash, 'f0000000-0000-0000-0000-000000000003', 'supervisor', 'submit', 'owner'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000005' $$,
  '監造日誌可提送給機關');
update public.field_documents set status = 'submitted' where id = 'f7000000-0000-0000-0000-000000000003';
select pg_temp.become('f0000000-0000-0000-0000-000000000004', 'aal2');
select lives_ok($$ insert into public.field_document_submissions (document_id, version_no, content_hash, actor_id, actor_org, action, to_org)
  select 'f7000000-0000-0000-0000-000000000003', 1, v.content_hash, 'f0000000-0000-0000-0000-000000000004', 'owner', 'receive', 'owner'
  from public.field_document_versions v where v.id = 'f8000000-0000-0000-0000-000000000005' $$,
  '機關(提送對象)可收件監造日誌');
select lives_ok($$ update public.field_documents set status = 'received'
  where id = 'f7000000-0000-0000-0000-000000000003' $$,
  '機關收件後標 received');
select pg_temp.become('f0000000-0000-0000-0000-000000000003', 'aal2');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content)
  values ('f7000000-0000-0000-0000-000000000003', 'human', '{}') $$,
  'P0001', null, '對方已收件的文件不可再加版本');
select lives_ok($$ update public.field_documents set status = 'superseded'
  where id = 'f7000000-0000-0000-0000-000000000003' $$,
  '已收件文件可被新文件取代(superseded)');
select lives_ok($$ insert into public.field_documents (project_id, doc_type, doc_date)
  values ('f1000000-0000-0000-0000-00000000000a', 'supervisor_log', '2026-09-17') $$,
  '取代後同日可再立新監造日誌文件(唯一索引只算活文件)');

-- ── 13. 專案刪除 cascade:已簽署／提送的文件隨案刪除不被 guard 擋 ────────────────
select pg_temp.become(null);
select lives_ok($$ delete from public.projects where id = 'f1000000-0000-0000-0000-00000000000a' $$,
  '專案刪除 cascade 可通過版本／簽署／提送的不可變 guard');
select is((select count(*)::int from public.field_document_versions), 0, 'cascade 後版本清空');
select is((select count(*)::int from public.photo_intakes), 0, 'cascade 後批次清空');

select * from finish();
rollback;
