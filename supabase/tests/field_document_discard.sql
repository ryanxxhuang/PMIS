-- P3f 捨棄現場文書草稿 pgTAP:discard_field_document、field_documents_discard_guard、捨棄稽核帶原因、
-- 指向文件的待覆核 AI 草稿標 rejected、捨棄後同一目標可重新起稿(日誌類每日一份、起稿批次＋目標、每個查驗一份表單)
-- 且新草稿可簽署;P3e 共用補值不再以捨棄的文件為對象。
-- 對應 migration 20260920021000_field_document_discard.sql;設計 docs/architecture/field-documents-lifecycle.md §2.2、§4、§5。
-- RPC 一律以 `set local role authenticated`＋JWT claims 呼叫;「service」=無 JWT 的 superuser 敘述(模擬 Edge service)。
begin;

select plan(78);

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else jsonb_build_object('sub', u::text, 'role', 'authenticated', 'aal', 'aal1')::text end, true);
end $$;
select pg_temp.become(null);

-- 以 owner 讀(斷言「列還在、沒被改」不能被 RLS「看不到」混過)
create or replace function pg_temp.doc(d uuid) returns public.field_documents language sql security definer as $$
  select * from public.field_documents where id = d;
$$;
create or replace function pg_temp.vcount(d uuid) returns int language sql security definer as $$
  select count(*)::int from public.field_document_versions where document_id = d;
$$;
create or replace function pg_temp.hash_of(d uuid, v int) returns text language sql security definer as $$
  select content_hash from public.field_document_versions where document_id = d and version_no = v;
$$;
create or replace function pg_temp.discard(d uuid, r text, q text default null) returns jsonb language sql as $$
  select public.discard_field_document(d, r, q);
$$;
-- 一份齊備、可簽署的施工日誌內容/來源/附件(W1 12 M3;W2 本日不適用;廠商照片為證據)
create or replace function pg_temp.content_ok() returns jsonb language sql as $$
  select '{"weather_am":"晴","weather_pm":"晴","work_summary":"3F 版牆混凝土澆置",
           "labor":[{"type":"泥作","count":8}],"equipment":[{"name":"泵浦車","count":1}],
           "materials":[{"name":"混凝土","unit":"M3","qty":12}],
           "items":{"f3f30000-0000-0000-0000-000000000001":{"qty_today":12},
                    "f3f30000-0000-0000-0000-000000000002":{"qty_today":null}}}'::jsonb;
$$;
create or replace function pg_temp.sources_ok() returns jsonb language sql as $$
  select '{"weather_am":{"status":"confirmed","source":"cwa"},"weather_pm":{"status":"confirmed","source":"cwa"},
           "work_summary":{"status":"confirmed"},"labor":{"status":"confirmed"},
           "equipment":{"status":"confirmed"},"materials":{"status":"confirmed"},
           "items.f3f30000-0000-0000-0000-000000000001.qty_today":{"status":"confirmed"},
           "items.f3f30000-0000-0000-0000-000000000002.qty_today":{"status":"na","reason":"本日未施作"}}'::jsonb;
$$;
create or replace function pg_temp.att_ok() returns jsonb language sql as $$
  select '[{"photo_id":"f3f60000-0000-0000-0000-000000000001"}]'::jsonb;
$$;

create temp table outs (label text primary key, r jsonb);
grant all on outs to authenticated;

-- ── 1. 結構與執行權限 ─────────────────────────────────────────────────────────────
select has_function('public', 'discard_field_document', array['uuid','text','text'], 'discard_field_document 存在');
select is(has_function_privilege('authenticated', 'public.discard_field_document(uuid,text,text)', 'execute'), true, 'authenticated 可捨棄(允許清單)');
select is(has_function_privilege('anon', 'public.discard_field_document(uuid,text,text)', 'execute'), false, 'anon 不可捨棄');
select is(has_function_privilege('authenticated', 'public.field_documents_discard_guard()', 'execute'), false, 'trigger 函式不開給 authenticated');
select has_trigger('public', 'field_documents', 'field_documents_discard_guard', '捨棄紀錄 guard 掛上');
select columns_are('public', 'field_documents', array[
  'id','project_id','doc_type','owner_org','target_table','target_id','target_key','intake_id','doc_date','status',
  'current_version_no','template_id','template_version','required_fields','recheck','created_by','created_at','updated_at',
  'discard_reason','discarded_by','discarded_at','discard_request_id'], '文件本體多四個捨棄紀錄欄');
select is(has_column_privilege('authenticated', 'public.field_documents', 'discard_reason', 'INSERT'), false,
  'authenticated 不能在建立草稿時寫捨棄原因(欄位級 INSERT grant 不含)');
select is(has_table_privilege('authenticated', 'public.field_documents', 'UPDATE'), false,
  'authenticated 仍沒有 field_documents UPDATE(捨棄只經 RPC)');

-- ── 2. fixtures:A 案三方(廠商兩人)＋B 案外人;A 為正式模式 ─────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('f3f00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dc-con@example.test', '', now(), '{}', '{"full_name":"廠商工地主任","org_type":"contractor"}', now(), now()),
  ('f3f00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dc-con2@example.test', '', now(), '{}', '{"full_name":"廠商品管","org_type":"contractor"}', now(), now()),
  ('f3f00000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dc-sup@example.test', '', now(), '{}', '{"full_name":"監造工程師","org_type":"supervisor"}', now(), now()),
  ('f3f00000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dc-own@example.test', '', now(), '{}', '{"full_name":"機關承辦","org_type":"owner"}', now(), now()),
  ('f3f00000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dc-out@example.test', '', now(), '{}', '{"full_name":"外案廠商","org_type":"contractor"}', now(), now()),
  ('f3f00000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dc-admin@example.test', '', now(), '{}', '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode) values
  ('f3f10000-0000-0000-0000-00000000000a', '捨棄測試案', '機關', '廠商', '監造', 'f3f00000-0000-0000-0000-000000000006', true),
  ('f3f10000-0000-0000-0000-00000000000b', '外案', '機關', '廠商', '監造', 'f3f00000-0000-0000-0000-000000000006', true);
alter table public.projects enable trigger on_project_created;
insert into public.project_members (project_id, user_id, role) values
  ('f3f10000-0000-0000-0000-00000000000a', 'f3f00000-0000-0000-0000-000000000001', 'member'),
  ('f3f10000-0000-0000-0000-00000000000a', 'f3f00000-0000-0000-0000-000000000002', 'member'),
  ('f3f10000-0000-0000-0000-00000000000a', 'f3f00000-0000-0000-0000-000000000003', 'member'),
  ('f3f10000-0000-0000-0000-00000000000a', 'f3f00000-0000-0000-0000-000000000004', 'member'),
  ('f3f10000-0000-0000-0000-00000000000a', 'f3f00000-0000-0000-0000-000000000006', 'admin'),
  ('f3f10000-0000-0000-0000-00000000000b', 'f3f00000-0000-0000-0000-000000000005', 'member'),
  ('f3f10000-0000-0000-0000-00000000000b', 'f3f00000-0000-0000-0000-000000000006', 'admin');
insert into public.work_items (id, project_id, item_key, item_no, description, unit, quantity, unit_price, amount, is_leaf, sort_order) values
  ('f3f30000-0000-0000-0000-000000000001', 'f3f10000-0000-0000-0000-00000000000a', 'W1', '壹.一.1', '結構混凝土', 'M3', 100, 3000, 300000, true, 1),
  ('f3f30000-0000-0000-0000-000000000002', 'f3f10000-0000-0000-0000-00000000000a', 'W2', '壹.一.2', '模板', 'M2', 500, 500, 250000, true, 2),
  ('f3f30000-0000-0000-0000-000000000003', 'f3f10000-0000-0000-0000-00000000000b', 'WB', '壹.一.1', '外案工項', 'M3', 1, 1, 1, true, 1);
insert into public.photos (id, project_id, storage_path, uploaded_by) values
  ('f3f60000-0000-0000-0000-000000000001', 'f3f10000-0000-0000-0000-00000000000a', 'f3f10000-0000-0000-0000-00000000000a/misc/c.jpg', 'f3f00000-0000-0000-0000-000000000001');
insert into public.photo_intakes (id, project_id, created_by, log_date) values
  ('f3f50000-0000-0000-0000-00000000000a', 'f3f10000-0000-0000-0000-00000000000a', 'f3f00000-0000-0000-0000-000000000001', '2026-09-15');

-- service 起稿(模擬 Edge):D1 施工日誌 09-15(批次 IA;AI 版本 1,天氣待補)＋指向它的待覆核 AI 草稿
insert into public.field_documents (id, project_id, doc_type, doc_date, intake_id, status, required_fields, created_by)
  values ('f3f70000-0000-0000-0000-000000000001', 'f3f10000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-15',
          'f3f50000-0000-0000-0000-00000000000a', 'pending_input', '[]', 'f3f00000-0000-0000-0000-000000000001');
insert into public.field_document_versions (document_id, author_kind, content, field_sources, attachments, change_note)
  values ('f3f70000-0000-0000-0000-000000000001', 'ai', '{"weather_am":"","work_summary":"照片判錯的日期"}',
          '{"weather_am":{"status":"pending"},"work_summary":{"status":"filled","source":"ai:photo"}}', pg_temp.att_ok(), '系統依照片起稿');
update public.field_documents set current_version_no = 1 where id = 'f3f70000-0000-0000-0000-000000000001';
insert into public.agent_actions (id, project_id, actor_user, agent_role, kind, target_table, target_id, summary, evidence) values
  ('f3f90000-0000-0000-0000-000000000001', 'f3f10000-0000-0000-0000-00000000000a', 'f3f00000-0000-0000-0000-000000000001', 'contractor',
   'draft_field_document', 'field_documents', 'f3f70000-0000-0000-0000-000000000001', '施工日誌草稿 2026-09-15', '{"version_no":1}'),
  ('f3f90000-0000-0000-0000-000000000002', 'f3f10000-0000-0000-0000-00000000000a', 'f3f00000-0000-0000-0000-000000000001', 'contractor',
   'suggest_field_update', 'field_documents', 'f3f70000-0000-0000-0000-000000000001', '重新辨識的建議', '{}'),
  ('f3f90000-0000-0000-0000-000000000003', 'f3f10000-0000-0000-0000-00000000000a', 'f3f00000-0000-0000-0000-000000000001', 'contractor',
   'draft_field_document', 'field_documents', 'f3f70000-0000-0000-0000-000000000009', '別份文件的草稿', '{}');
-- 批次候選也指向 D1(P2b 形狀):共用補值的對象集合以此納入
update public.photo_intakes set status = 'ready',
  candidates = '[{"doc_type":"daily_log","doc_date":"2026-09-15","state":"drafted","document_id":"f3f70000-0000-0000-0000-000000000001"}]'
  where id = 'f3f50000-0000-0000-0000-00000000000a';
-- B 案文件(跨案)
insert into public.field_documents (id, project_id, doc_type, doc_date, status, created_by)
  values ('f3f70000-0000-0000-0000-000000000006', 'f3f10000-0000-0000-0000-00000000000b', 'daily_log', '2026-09-15', 'draft',
          'f3f00000-0000-0000-0000-000000000005');

-- ── 3. 越權:未登入、他方、機關、非成員、跨案 ─────────────────────────────────────────
set local role authenticated;
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000001', '擬錯') $$,
  'PD006', null, '未登入 → PD006');
reset role;
select pg_temp.become('f3f00000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000001', '擬錯') $$,
  'PD006', '此文件屬施工廠商方,只有該方成員可捨棄', '監造不能捨棄施工日誌(他方)→ PD006');
reset role;
select pg_temp.become('f3f00000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000001', '擬錯') $$,
  'PD006', null, '機關不能捨棄(非責任方、正式模式唯讀)→ PD006');
reset role;
select pg_temp.become('f3f00000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000001', '擬錯') $$,
  'PD006', '找不到文件或無權存取', '非成員(外案廠商)捨棄 A 案文件 → PD006');
reset role;
select pg_temp.become('f3f00000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000006', '擬錯') $$,
  'PD006', '找不到文件或無權存取', '跨案:A 案廠商捨棄 B 案文件 → PD006');
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-0000000000ff', '擬錯') $$,
  'PD006', null, '不存在的文件 → PD006(不洩漏存在與否)');
-- 原因必填
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000001', '   ') $$,
  'PD010', '捨棄必須填寫原因', '原因空白 → PD010');
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000001', null) $$,
  'PD010', null, '原因 null → PD010');
reset role;
select is((pg_temp.doc('f3f70000-0000-0000-0000-000000000001')).status, 'pending_input', '被拒絕的請求沒有改變文件狀態');

-- ── 4. 責任方捨棄(同方第二人,非建立者;AI 起稿的文件沒有人類建立者) ─────────────────────────
select pg_temp.become('f3f00000-0000-0000-0000-000000000002');
set local role authenticated;
insert into outs values ('d1', pg_temp.discard('f3f70000-0000-0000-0000-000000000001', '  照片日期判錯，重新上傳  ', 'req-d1'));
reset role;
select is((select r - 'discarded_at' from outs where label = 'd1'),
  jsonb_build_object('document_id', 'f3f70000-0000-0000-0000-000000000001', 'doc_type', 'daily_log', 'doc_date', '2026-09-15',
    'status', 'discarded', 'version_no', 1, 'discard_reason', '照片日期判錯，重新上傳',
    'discarded_by', 'f3f00000-0000-0000-0000-000000000002', 'client_request_id', 'req-d1',
    'agent_actions_resolved', 2, 'idempotent', false),
  '回傳:狀態 discarded、原因去頭尾空白、捨棄者＝本人、處理 2 筆指向本文件的待覆核 AI 草稿');
select results_eq($$ select status, discard_reason, discarded_by, discard_request_id, discarded_at is not null
  from pg_temp.doc('f3f70000-0000-0000-0000-000000000001') $$,
  $$ values ('discarded'::text, '照片日期判錯，重新上傳'::text, 'f3f00000-0000-0000-0000-000000000002'::uuid, 'req-d1'::text, true) $$,
  '文件列:捨棄紀錄由伺服器寫入(原因、捨棄者、時間、請求編號)');
select is(pg_temp.vcount('f3f70000-0000-0000-0000-000000000001'), 1, '版本列保留(捨棄不刪任何版本)');
select is((select attachments from public.field_document_versions where document_id = 'f3f70000-0000-0000-0000-000000000001'),
  pg_temp.att_ok(), '版本內容與附件原樣(照片是證據,不動)');
select results_eq($$ select id, status, resolved_by from public.agent_actions where id::text like 'f3f90000%' order by id $$,
  $$ values ('f3f90000-0000-0000-0000-000000000001'::uuid, 'rejected'::text, 'f3f00000-0000-0000-0000-000000000002'::uuid),
            ('f3f90000-0000-0000-0000-000000000002'::uuid, 'rejected'::text, 'f3f00000-0000-0000-0000-000000000002'::uuid),
            ('f3f90000-0000-0000-0000-000000000003'::uuid, 'pending'::text, null::uuid) $$,
  '指向本文件的待覆核草稿(起稿與建議)標 rejected、處理人＝捨棄者;指向別份文件的不動');
select is((select count(*)::int from public.audit_events
  where event_type = 'agent_action_resolved' and entity_id in ('f3f90000-0000-0000-0000-000000000001', 'f3f90000-0000-0000-0000-000000000002')
    and metadata ->> 'resolved_via' = 'discard_field_document' and action = 'rejected'), 2,
  'AI 草稿處理留稽核(resolved_via=discard_field_document)');
select results_eq($$ select actor_user_id, metadata ->> 'reason', metadata ->> 'client_request_id', metadata ->> 'doc_type', after_data ->> 'discard_reason'
  from public.audit_events where event_type = 'field_document.discarded' and entity_id = 'f3f70000-0000-0000-0000-000000000001' $$,
  $$ values ('f3f00000-0000-0000-0000-000000000002'::uuid, '照片日期判錯，重新上傳'::text, 'req-d1'::text, 'daily_log'::text, '照片日期判錯，重新上傳'::text) $$,
  '稽核:一筆 field_document.discarded,執行者＝捨棄者,metadata 帶原因與請求編號');

-- ── 5. 冪等與衝突 ─────────────────────────────────────────────────────────────────
select pg_temp.become('f3f00000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select pg_temp.discard('f3f70000-0000-0000-0000-000000000001', '照片日期判錯，重新上傳', 'req-d1') - 'discarded_at'),
  (select r - 'discarded_at' - 'agent_actions_resolved' - 'idempotent' from outs where label = 'd1')
    || '{"agent_actions_resolved":0,"idempotent":true}'::jsonb,
  '同一請求重送 → 回原結果(idempotent=true,不再處理草稿)');
select is((select pg_temp.discard('f3f70000-0000-0000-0000-000000000001', '照片日期判錯，重新上傳') ->> 'idempotent'), 'true',
  '同一人同一原因、沒帶請求編號 → 仍是同一件事,回原結果');
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000001', '換個原因', 'req-d1') $$,
  'PD009', null, '同請求編號換原因 → PD009');
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000001', '換個原因') $$,
  'PD008', null, '已捨棄的文件以其他原因再捨棄 → PD008');
reset role;
select pg_temp.become('f3f00000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000001', '照片日期判錯，重新上傳', 'req-d1') $$,
  'PD009', null, '他人拿同一請求編號 → PD009');
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000001', '照片日期判錯，重新上傳') $$,
  'PD008', null, '已由他人捨棄 → PD008');
-- 捨棄是終態:不可再存版本
select throws_ok($$ select public.save_field_document_version('f3f70000-0000-0000-0000-000000000001', 1, '{}'::jsonb) $$,
  'PD008', null, '捨棄的文件不可再存版本 → PD008');
reset role;
select is((select count(*)::int from public.audit_events
  where event_type = 'field_document.discarded' and entity_id = 'f3f70000-0000-0000-0000-000000000001'), 1,
  '冪等重送與被拒的請求都不增加稽核事件');
select is((pg_temp.doc('f3f70000-0000-0000-0000-000000000001')).discard_reason, '照片日期判錯，重新上傳', '原因未被後來的請求改寫');

-- ── 6. 捨棄紀錄 guard(所有寫入者,含 service) ─────────────────────────────────────────
select pg_temp.become(null);
select throws_ok($$ update public.field_documents set discard_reason = '改寫原因' where id = 'f3f70000-0000-0000-0000-000000000001' $$,
  'P0001', '捨棄紀錄(原因／捨棄者／時間／請求編號)寫下後不可變更', 'service 也不能改寫捨棄原因');
select throws_ok($$ update public.field_documents set discarded_at = now() - interval '1 day' where id = 'f3f70000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'service 也不能改捨棄時間');
select throws_ok($$ update public.field_documents set status = 'draft' where id = 'f3f70000-0000-0000-0000-000000000001' $$,
  'P0001', null, '捨棄為終態(P2a guard)');
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date, discard_reason)
  values ('f3f10000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-20', '預先寫原因') $$,
  'P0001', '捨棄紀錄只能在捨棄文件時由伺服器寫入', '建立時不能帶捨棄紀錄');
-- service 捨棄同樣要原因;捨棄者為 null(沒有登入者)、時間由伺服器蓋
insert into public.field_documents (id, project_id, doc_type, doc_date, status)
  values ('f3f70000-0000-0000-0000-000000000007', 'f3f10000-0000-0000-0000-00000000000a', 'supervisor_log', '2026-09-20', 'draft');
select throws_ok($$ update public.field_documents set status = 'discarded' where id = 'f3f70000-0000-0000-0000-000000000007' $$,
  'P0001', '捨棄文件必須填寫原因', 'service 捨棄沒有原因 → 拒絕(原因必填是所有寫入者的不變量)');
select lives_ok($$ update public.field_documents set status = 'discarded', discard_reason = ' 系統清理 ',
    discarded_by = 'f3f00000-0000-0000-0000-000000000004', discarded_at = '2000-01-01'
  where id = 'f3f70000-0000-0000-0000-000000000007' $$, 'service 帶原因可捨棄');
select results_eq($$ select discard_reason, discarded_by, discarded_at > now() - interval '1 minute'
  from pg_temp.doc('f3f70000-0000-0000-0000-000000000007') $$,
  $$ values ('系統清理'::text, null::uuid, true) $$, '捨棄者／時間由伺服器蓋(客戶端帶的值作廢)');

-- ── 7. 已簽署／已提送／簽後更正:拒絕 ───────────────────────────────────────────────
select pg_temp.become('f3f00000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date)
  values ('f3f70000-0000-0000-0000-000000000003', 'f3f10000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-16') $$,
  '廠商建立施工日誌 D3(09-16)');
insert into outs values ('d3v1', public.save_field_document_version('f3f70000-0000-0000-0000-000000000003', 0,
  pg_temp.content_ok(), pg_temp.sources_ok(), pg_temp.att_ok()));
select is((select r ->> 'status' from outs where label = 'd3v1'), 'draft', 'D3 v1 齊備(可簽)');
select is((public.sign_field_document('f3f70000-0000-0000-0000-000000000003', 1,
    pg_temp.hash_of('f3f70000-0000-0000-0000-000000000003', 1), '本人確認內容無誤並簽署')) ->> 'status', 'signed', 'D3 簽署');
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000003', '想撤掉') $$,
  'PD008', '文件狀態為「已簽署」,只有未簽署、未提送的草稿可以捨棄;已簽署的文件要更正請建立新版本', '已簽署 → PD008');
select is((public.submit_field_document('f3f70000-0000-0000-0000-000000000003', 1, 'supervisor', 'sub-d3')) ->> 'status', 'submitted', 'D3 提送監造');
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000003', '想撤掉') $$,
  'PD008', null, '已提送 → PD008');
-- 簽後更正:存新版本回到草稿;狀態是 draft 但曾經簽署與提送 → 仍拒絕
select is((public.save_field_document_version('f3f70000-0000-0000-0000-000000000003', 1,
    pg_temp.content_ok() || '{"work_summary":"更正概況"}', pg_temp.sources_ok(), pg_temp.att_ok(), '簽後更正')) ->> 'status', 'draft',
  'D3 簽後更正版本 2 → draft');
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000003', '想撤掉') $$,
  'PD008', '此文件曾經簽署或提送(目前是簽後更正的草稿),不可捨棄;請完成更正後重新簽署', '簽後更正的草稿曾經簽署 → PD008');
reset role;
select results_eq($$ select status, discard_reason from pg_temp.doc('f3f70000-0000-0000-0000-000000000003') $$,
  $$ values ('draft'::text, null::text) $$, '被拒後 D3 不變');
-- trigger 層同樣擋(service 直接改也不行;P2a guard)
select throws_ok($$ update public.field_documents set status = 'discarded', discard_reason = 'x' where id = 'f3f70000-0000-0000-0000-000000000003' $$,
  'P0001', null, 'service 直接捨棄曾簽署的文件 → guard 拒絕');

-- ── 8. 捨棄後同一目標重新起稿:日誌類同日、同批次同目標;新草稿可簽署 ─────────────────────────
-- P3e 共用補值:捨棄的文件不再是批次對象(候選仍指向 D1,但只算活文件)
select pg_temp.become('f3f00000-0000-0000-0000-000000000001');
set local role authenticated;
select is((public.list_intake_shared_inputs('f3f50000-0000-0000-0000-00000000000a')) -> 'fields', '[]'::jsonb,
  '共用補值清單:批次唯一的文件已捨棄 → 沒有欄位(捨棄的文件不列)');
select throws_ok($$ select public.set_intake_shared_input('f3f50000-0000-0000-0000-00000000000a', 'weather_am:2026-09-15', '"晴"') $$,
  'PD010', null, '共用補值不寫捨棄的文件(沒有活文件用到此欄 → PD010)');
reset role;
select is(pg_temp.vcount('f3f70000-0000-0000-0000-000000000001'), 1, '捨棄的文件仍只有 1 個版本');
-- 重新起稿(service,同批次、同日、target_key null):日誌類每日唯一與起稿批次唯一都只算活文件
select pg_temp.become(null);
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date, intake_id, status, created_by)
  values ('f3f70000-0000-0000-0000-000000000011', 'f3f10000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-15',
          'f3f50000-0000-0000-0000-00000000000a', 'pending_input', 'f3f00000-0000-0000-0000-000000000001') $$,
  '捨棄後同日同批次可重新起稿(新文件 D1b)');
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date)
  values ('f3f10000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-15') $$,
  '23505', null, '同日仍只能有一份活文件(唯一索引只排除捨棄／取代)');
select pg_temp.become('f3f00000-0000-0000-0000-000000000001');
set local role authenticated;
select is((public.save_field_document_version('f3f70000-0000-0000-0000-000000000011', 0,
    pg_temp.content_ok(), pg_temp.sources_ok(), pg_temp.att_ok())) ->> 'status', 'draft', '新草稿補齊 → draft');
select is((public.list_intake_shared_inputs('f3f50000-0000-0000-0000-00000000000a') -> 'fields' -> 0 -> 'documents' -> 0 ->> 'document_id'),
  'f3f70000-0000-0000-0000-000000000011', '共用補值清單改列新草稿');
insert into outs values ('d1b', public.sign_field_document('f3f70000-0000-0000-0000-000000000011', 1,
  pg_temp.hash_of('f3f70000-0000-0000-0000-000000000011', 1), '本人確認內容無誤並簽署'));
reset role;
select is((select r ->> 'status' from outs where label = 'd1b'), 'signed', '新草稿可簽署');
select results_eq($$ select l.log_date, l.status, d.target_id = l.id from public.daily_logs l
    join public.field_documents d on d.id = 'f3f70000-0000-0000-0000-000000000011'
   where l.project_id = 'f3f10000-0000-0000-0000-00000000000a' and l.log_date = '2026-09-15' $$,
  $$ values ('2026-09-15'::date, '已簽署'::text, true) $$, '新草稿簽署落 daily_logs 並綁定(捨棄的舊文件沒有綁任何事實列)');
select is((pg_temp.doc('f3f70000-0000-0000-0000-000000000001')).target_id, null, '捨棄的文件 target_id 維持 null');

-- ── 9. 監造文書:監造日誌與監造查驗表單(每個查驗一份表單,捨棄後可重建) ─────────────────────
select pg_temp.become('f3f00000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date)
  values ('f3f70000-0000-0000-0000-000000000002', 'f3f10000-0000-0000-0000-00000000000a', 'supervisor_log', '2026-09-15') $$,
  '監造建立監造日誌 D2');
reset role;
select pg_temp.become('f3f00000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ select pg_temp.discard('f3f70000-0000-0000-0000-000000000002', '擬錯') $$,
  'PD006', '此文件屬監造方,只有該方成員可捨棄', '廠商不能捨棄監造日誌 → PD006');
select lives_ok($$ insert into public.inspections (id, project_id, work_item_id, title, location, requested_date, declared_qty, requested_by)
  values ('f3f80000-0000-0000-0000-000000000001', 'f3f10000-0000-0000-0000-00000000000a', 'f3f30000-0000-0000-0000-000000000001',
          '3F 版牆混凝土查驗', '3F 版牆', '2026-09-15', 100, 'f3f00000-0000-0000-0000-000000000001') $$,
  '廠商提查驗申請 I1');
reset role;
select pg_temp.become('f3f00000-0000-0000-0000-000000000003');
set local role authenticated;
select is((pg_temp.discard('f3f70000-0000-0000-0000-000000000002', '日期選錯')) ->> 'status', 'discarded', '監造捨棄自己的監造日誌');
select lives_ok($$ insert into public.field_documents (project_id, doc_type, doc_date)
  values ('f3f10000-0000-0000-0000-00000000000a', 'supervisor_log', '2026-09-15') $$,
  '捨棄後同日可重建監造日誌');
insert into outs values ('if1', public.create_inspection_form_draft('f3f80000-0000-0000-0000-000000000001'));
select is((select r ->> 'created' from outs where label = 'if1'), 'true', '監造由查驗申請建立查驗表單草稿');
reset role;
select pg_temp.become('f3f00000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ select pg_temp.discard((select (r ->> 'id')::uuid from outs where label = 'if1'), '擬錯') $$,
  'PD006', null, '廠商不能捨棄監造查驗表單 → PD006');
reset role;
select pg_temp.become('f3f00000-0000-0000-0000-000000000003');
set local role authenticated;
select is((pg_temp.discard((select (r ->> 'id')::uuid from outs where label = 'if1'), '選錯查驗申請')) ->> 'status', 'discarded',
  '監造捨棄查驗表單草稿');
insert into outs values ('if2', public.create_inspection_form_draft('f3f80000-0000-0000-0000-000000000001'));
select is((select r ->> 'created' from outs where label = 'if2'), 'true', '捨棄後同一查驗可重新建立表單(不是取回捨棄的那份)');
select isnt((select r ->> 'id' from outs where label = 'if2'), (select r ->> 'id' from outs where label = 'if1'), '新表單是另一份文件');
reset role;
select is((select status from public.inspections where id = 'f3f80000-0000-0000-0000-000000000001'), '待查驗', '捨棄查驗表單不動查驗申請(仍待查驗)');

-- ── 10. 自主檢查表:同批次同目標捨棄後可再起稿;in_review(未簽署)也可捨棄 ───────────────────────
select pg_temp.become(null);
insert into public.field_documents (id, project_id, doc_type, doc_date, intake_id, target_key, status)
  values ('f3f70000-0000-0000-0000-000000000004', 'f3f10000-0000-0000-0000-00000000000a', 'self_check', '2026-09-15',
          'f3f50000-0000-0000-0000-00000000000a', '2026-09-15:f3f30000-0000-0000-0000-000000000001', 'pending_input');
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date, intake_id, target_key)
  values ('f3f10000-0000-0000-0000-00000000000a', 'self_check', '2026-09-15',
          'f3f50000-0000-0000-0000-00000000000a', '2026-09-15:f3f30000-0000-0000-0000-000000000001') $$,
  '23505', null, '同批次同目標只有一份活自檢表(起稿冪等)');
-- service 把 D4 送內部核對(in_review;目前沒有 RPC 會進這個狀態,但它是未簽署狀態之一)
update public.field_documents set status = 'in_review' where id = 'f3f70000-0000-0000-0000-000000000004';
select pg_temp.become('f3f00000-0000-0000-0000-000000000001');
set local role authenticated;
select is((pg_temp.discard('f3f70000-0000-0000-0000-000000000004', '工項配錯')) ->> 'status', 'discarded', '內部核對中(未簽署)的自檢表可捨棄');
reset role;
select lives_ok($$ insert into public.field_documents (project_id, doc_type, doc_date, intake_id, target_key)
  values ('f3f10000-0000-0000-0000-00000000000a', 'self_check', '2026-09-15',
          'f3f50000-0000-0000-0000-00000000000a', '2026-09-15:f3f30000-0000-0000-0000-000000000001') $$,
  '捨棄後同批次同目標可再起稿');

-- ── 11. 版本 0 的空白草稿、機關與非正式案 admin_override ────────────────────────────────
select pg_temp.become('f3f00000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date)
  values ('f3f70000-0000-0000-0000-000000000005', 'f3f10000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-17') $$,
  '廠商建空白草稿 D5(尚無版本)');
select is((pg_temp.discard('f3f70000-0000-0000-0000-000000000005', '建錯日期')) ->> 'version_no', '0', '尚無版本的空白草稿可捨棄');
reset role;
select is((select count(*)::int from public.audit_events
  where event_type = 'field_document.discarded' and project_id = 'f3f10000-0000-0000-0000-00000000000a'), 6,
  '每次捨棄一筆稽核事件(D1、D7 service、D2、查驗表單、D4、D5)');
select results_eq($$ select count(*)::int from public.field_documents
  where project_id = 'f3f10000-0000-0000-0000-00000000000a' and status = 'discarded' and discard_reason is null $$,
  $$ values (0) $$, '本案每份捨棄的文件都有原因');

select * from finish();
rollback;
