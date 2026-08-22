-- W14 文件刪除 pgTAP 套件:delete_document RPC 的守門與佐證鏈護欄。
-- 涵蓋:單一刪除路徑(documents 無 RLS DELETE、RPC 才能刪)、權限(文件管理
-- 才可刪、外案成員擋下)、佐證鏈(已審/人工契約重點引用的文件 FK 擋下且整包
-- 回滾)、級聯(版本/逐頁/處理與抽取 run/未審 AI 建議跟著走)、留痕
-- (document.deleted 稽核事件)與 storage 刪除政策存在。
-- 對應 migration 20260822000300_document_delete.sql。
begin;

select plan(20);

create or replace function pg_temp.become(u uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

select pg_temp.become(null);

-- ── 結構契約 ────────────────────────────────────────────────────────────────
select has_function('public', 'delete_document', array['uuid'], '守門刪除 RPC 存在');
select is(has_function_privilege('anon', 'public.delete_document(uuid)', 'EXECUTE'), false,
  'anon 不可呼叫刪除 RPC');
select is(has_function_privilege('authenticated', 'public.delete_document(uuid)', 'EXECUTE'), true,
  'authenticated 可呼叫刪除 RPC(權限檢查在函式內)');
select is((select count(*)::int from pg_policies
  where schemaname = 'public' and tablename = 'documents' and cmd = 'DELETE'), 0,
  'documents 沒有 RLS DELETE policy——刪除只走 RPC 單一路徑');
select ok(exists (select 1 from pg_policies
  where schemaname = 'storage' and policyname = 'contract_documents_delete'),
  'storage 原始檔刪除政策存在(判權沿用契約包上傳)');
select has_trigger('public', 'documents', 'documents_audit_delete_event',
  '文件刪除留痕 trigger 存在');
select has_function('public', 'storage_path_in_use', array['text'],
  '活檔判定 helper 存在(storage 刪除政策只准清孤兒檔)');

-- ── fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('dd000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'manager-a@dd.test', '', now(), '{}',
   '{"full_name":"Doc Manager A","org_type":"contractor"}', now(), now()),
  ('dd000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'manager-b@dd.test', '', now(), '{}',
   '{"full_name":"Doc Manager B","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name) values
  ('dd100000-0000-0000-0000-00000000000a', 'DocDelete Project A'),
  ('dd100000-0000-0000-0000-00000000000b', 'DocDelete Project B');
alter table public.projects enable trigger on_project_created;

insert into public.project_parties (id, project_id, party_type, display_name) values
  ('dd200000-0000-0000-0000-000000000001', 'dd100000-0000-0000-0000-00000000000a', 'contractor', 'DD Builder A'),
  ('dd200000-0000-0000-0000-000000000002', 'dd100000-0000-0000-0000-00000000000b', 'contractor', 'DD Builder B');

insert into public.project_members (project_id, user_id, role) values
  ('dd100000-0000-0000-0000-00000000000a', 'dd000000-0000-0000-0000-000000000001', 'admin'),
  ('dd100000-0000-0000-0000-00000000000b', 'dd000000-0000-0000-0000-000000000002', 'admin');

insert into public.project_memberships
  (project_id, user_id, project_party_id, project_role, is_project_admin) values
  ('dd100000-0000-0000-0000-00000000000a', 'dd000000-0000-0000-0000-000000000001',
   'dd200000-0000-0000-0000-000000000001', 'contractor_pm', true),
  ('dd100000-0000-0000-0000-00000000000b', 'dd000000-0000-0000-0000-000000000002',
   'dd200000-0000-0000-0000-000000000002', 'contractor_pm', true);

-- doc1:乾淨文件(版本+逐頁+抽取 run+未審 AI 建議)→ 可刪,全鏈跟著走
-- doc2:有人工建立的契約重點引用 → 佐證鏈護欄擋刪
insert into public.documents (id, project_id, title, document_type) values
  ('dd400000-0000-0000-0000-000000000001', 'dd100000-0000-0000-0000-00000000000a', 'A案投標須知.pdf', 'other'),
  ('dd400000-0000-0000-0000-000000000002', 'dd100000-0000-0000-0000-00000000000a', 'A案契約.pdf', 'contract');

insert into public.document_versions (id, document_id, version_label, checksum, storage_path) values
  ('dd500000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000001', 'v1', 'sha256:dd1',
   'projects/dd100000-0000-0000-0000-00000000000a/contract-packages/p1/d1/v1/file.pdf'),
  ('dd500000-0000-0000-0000-000000000002', 'dd400000-0000-0000-0000-000000000002', 'v1', 'sha256:dd2', null);

insert into public.document_pages (document_version_id, page_number, extracted_text, extraction_method) values
  ('dd500000-0000-0000-0000-000000000001', 1, '投標須知內容', 'pdf_text');

insert into public.document_ingestion_runs
  (id, project_id, document_version_id, status) values
  ('dd600000-0000-0000-0000-000000000001', 'dd100000-0000-0000-0000-00000000000a',
   'dd500000-0000-0000-0000-000000000001', 'completed');

insert into public.requirements
  (id, project_id, title, requirement_type, status, origin, confidence, ingestion_run_id) values
  ('dd700000-0000-0000-0000-000000000001', 'dd100000-0000-0000-0000-00000000000a',
   '未審的AI建議', 'submittal', 'draft_ai', 'ai', 0.8, 'dd600000-0000-0000-0000-000000000001');
insert into public.requirements
  (id, project_id, title, requirement_type, status, origin) values
  ('dd700000-0000-0000-0000-000000000002', 'dd100000-0000-0000-0000-00000000000a',
   '人工建立的契約重點', 'submittal', 'needs_review', 'manual');

insert into public.requirement_sources (id, requirement_id, document_version_id, source_text) values
  ('dd800000-0000-0000-0000-000000000001', 'dd700000-0000-0000-0000-000000000001',
   'dd500000-0000-0000-0000-000000000001', '投標須知引註'),
  ('dd800000-0000-0000-0000-000000000002', 'dd700000-0000-0000-0000-000000000002',
   'dd500000-0000-0000-0000-000000000002', '契約引註');

-- ── 權限:外案成員擋下 ──────────────────────────────────────────────────────
select pg_temp.become('dd000000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select public.delete_document('dd400000-0000-0000-0000-000000000001') $$,
  'P0001', '無文件管理權限,不可刪除文件',
  '外案成員不可刪除別案文件');
reset role;

-- ── 佐證鏈護欄:被人審/人工契約重點引用 → 擋刪且整包回滾 ─────────────────────
select pg_temp.become('dd000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.delete_document('dd400000-0000-0000-0000-000000000002') $$,
  'P0001', '已有審查過的契約重點引用此文件;為保留佐證鏈,不可刪除(可改分類或上傳新版取代)',
  '有人工契約重點引用的文件不可刪除');
reset role;
select is((select count(*)::int from public.documents
  where id = 'dd400000-0000-0000-0000-000000000002'), 1, '被擋的文件仍在');
select is((select count(*)::int from public.requirements
  where id = 'dd700000-0000-0000-0000-000000000002'), 1, '引用它的人工契約重點仍在');

-- ── 成功刪除:回傳 storage 路徑,全鏈跟著走 ─────────────────────────────────
select pg_temp.become('dd000000-0000-0000-0000-000000000001');
set local role authenticated;
select is(
  (select public.delete_document('dd400000-0000-0000-0000-000000000001')),
  array['projects/dd100000-0000-0000-0000-00000000000a/contract-packages/p1/d1/v1/file.pdf']::text[],
  '管理者刪除成功並取回 storage 路徑');
reset role;

select is((select count(*)::int from public.documents
  where id = 'dd400000-0000-0000-0000-000000000001'), 0, '文件已刪除');
select is((select count(*)::int from public.document_versions
  where document_id = 'dd400000-0000-0000-0000-000000000001'), 0, '版本級聯刪除');
select is((select count(*)::int from public.document_pages
  where document_version_id = 'dd500000-0000-0000-0000-000000000001'), 0, '逐頁級聯刪除');
select is((select count(*)::int from public.document_ingestion_runs
  where id = 'dd600000-0000-0000-0000-000000000001'), 0, '抽取 run 級聯刪除');
select is((select count(*)::int from public.requirements
  where id = 'dd700000-0000-0000-0000-000000000001'), 0, '未審 AI 建議跟著刪除');
select is((select count(*)::int from public.requirement_sources
  where id = 'dd800000-0000-0000-0000-000000000001'), 0, '建議引註跟著刪除');
select ok(exists (select 1 from public.audit_events
  where event_type = 'document.deleted'
    and entity_id = 'dd400000-0000-0000-0000-000000000001'),
  '刪除行為留痕(document.deleted 稽核事件)');

-- ── 不存在的文件 ───────────────────────────────────────────────────────────
select pg_temp.become('dd000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.delete_document('dd400000-0000-0000-0000-0000000000ff') $$,
  'P0001', '找不到文件或無權限', '不存在的文件回一致訊息');
reset role;

select * from finish();
rollback;
