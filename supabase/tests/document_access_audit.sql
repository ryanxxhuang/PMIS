-- 文件原始檔讀取留痕 pgTAP 套件:log_document_access RPC。
-- 涵蓋:結構契約(grant 面)、可讀成員留痕成功且 actor 由伺服器蓋、
-- 外案成員 fail-closed(不留假紀錄)、不支援的動作擋下。
-- 對應 migration 20260824000100_document_access_audit.sql。
begin;

select plan(9);

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
select has_function('public', 'log_document_access', array['uuid', 'text'],
  '文件讀取留痕 RPC 存在');
select is(has_function_privilege('anon', 'public.log_document_access(uuid, text)', 'EXECUTE'), false,
  'anon 不可呼叫留痕 RPC');
select is(has_function_privilege('authenticated', 'public.log_document_access(uuid, text)', 'EXECUTE'), true,
  'authenticated 可呼叫留痕 RPC(權限檢查在函式內)');

-- ── fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('da000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reader-a@da.test', '', now(), '{}',
   '{"full_name":"Reader A","org_type":"contractor"}', now(), now()),
  ('da000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'outsider-b@da.test', '', now(), '{}',
   '{"full_name":"Outsider B","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name) values
  ('da100000-0000-0000-0000-00000000000a', 'DocAccess Project A'),
  ('da100000-0000-0000-0000-00000000000b', 'DocAccess Project B');
alter table public.projects enable trigger on_project_created;

insert into public.project_parties (id, project_id, party_type, display_name) values
  ('da200000-0000-0000-0000-000000000001', 'da100000-0000-0000-0000-00000000000a', 'contractor', 'DA Builder A'),
  ('da200000-0000-0000-0000-000000000002', 'da100000-0000-0000-0000-00000000000b', 'contractor', 'DA Builder B');

insert into public.project_members (project_id, user_id, role) values
  ('da100000-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-000000000001', 'admin'),
  ('da100000-0000-0000-0000-00000000000b', 'da000000-0000-0000-0000-000000000002', 'admin');

insert into public.project_memberships
  (project_id, user_id, project_party_id, project_role, is_project_admin) values
  ('da100000-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-000000000001',
   'da200000-0000-0000-0000-000000000001', 'contractor_pm', true),
  ('da100000-0000-0000-0000-00000000000b', 'da000000-0000-0000-0000-000000000002',
   'da200000-0000-0000-0000-000000000002', 'contractor_pm', true);

-- A 案施工契約包(counterparty=A 廠商)+ 一份有版本的文件
insert into public.contract_packages
  (id, project_id, counterparty_project_party_id, package_type, title) values
  ('da300000-0000-0000-0000-000000000001', 'da100000-0000-0000-0000-00000000000a',
   'da200000-0000-0000-0000-000000000001', 'construction', 'A 案施工契約');

insert into public.documents (id, project_id, contract_package_id, title, document_type) values
  ('da400000-0000-0000-0000-000000000001', 'da100000-0000-0000-0000-00000000000a',
   'da300000-0000-0000-0000-000000000001', 'A案契約.pdf', 'contract');

insert into public.document_versions (id, document_id, version_label, checksum, storage_path) values
  ('da500000-0000-0000-0000-000000000001', 'da400000-0000-0000-0000-000000000001', 'v1', 'sha256:da1',
   'projects/da100000-0000-0000-0000-00000000000a/contract-packages/p1/d1/v1/file.pdf');

-- ── 可讀成員:preview / download 各留一筆,actor 由伺服器蓋 ──────────────────
select pg_temp.become('da000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ select public.log_document_access('da500000-0000-0000-0000-000000000001', 'preview') $$,
  '可讀成員 preview 留痕成功');
select lives_ok(
  $$ select public.log_document_access('da500000-0000-0000-0000-000000000001', 'download') $$,
  '可讀成員 download 留痕成功');

select is(
  (select count(*)::int from public.audit_events
    where project_id = 'da100000-0000-0000-0000-00000000000a'
      and event_type = 'document.file_accessed'
      and entity_id = 'da500000-0000-0000-0000-000000000001'
      and actor_user_id = 'da000000-0000-0000-0000-000000000001'),
  2, '兩筆讀取事件都落在 audit_events,actor 為伺服器解析的呼叫者');

select is(
  (select array_agg(action order by action) from public.audit_events
    where event_type = 'document.file_accessed'
      and entity_id = 'da500000-0000-0000-0000-000000000001'),
  array['download', 'preview'], '動作分別記為 preview 與 download');

-- ── fail-closed:外案成員與不支援的動作 ─────────────────────────────────────
select pg_temp.become('da000000-0000-0000-0000-000000000002');

select throws_ok(
  $$ select public.log_document_access('da500000-0000-0000-0000-000000000001', 'download') $$,
  '無權限存取此契約包的文件',
  '外案成員被擋下——不留下無權限者的存取假象');

select pg_temp.become('da000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.log_document_access('da500000-0000-0000-0000-000000000001', 'delete') $$,
  '不支援的文件存取動作',
  '動作白名單:preview/download 以外一律擋下');

select * from finish();
rollback;
