-- P3e 共用補值 pgTAP:set_intake_shared_input／list_intake_shared_inputs、共用鍵目錄、套用規則(人填=confirmed、人親自確認
-- 的欄不覆蓋)、補一次多份草稿各建人工版本(雜湊由 DB 算、附件原樣)、冪等、已簽署／簽後更正不動、他方與他案文件不動、
-- 三角色＋非成員、跨案工項、捨棄批次;角色隔離再確認:補值後的日誌仍因監造照片當證據被簽署擋下(PD005)。
-- 對應 migration 20260920004000_intake_shared_inputs.sql;設計 docs/architecture/field-documents-lifecycle.md §2.4、§3.4。
begin;

select plan(95);

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else jsonb_build_object('sub', u::text, 'role', 'authenticated', 'aal', 'aal1')::text end, true);
end $$;
select pg_temp.become(null);

-- 目前版本／版本號／版本數(security definer=以 owner 讀:斷言他案文件「沒被改」,不能被 RLS「看不到」混過)
create or replace function pg_temp.cur(d uuid) returns public.field_document_versions language sql security definer as $$
  select v.* from public.field_document_versions v join public.field_documents f on f.id = v.document_id
   where f.id = d and v.version_no = f.current_version_no;
$$;
create or replace function pg_temp.vno(d uuid) returns int language sql security definer as $$
  select current_version_no from public.field_documents where id = d;
$$;
create or replace function pg_temp.vcount(d uuid) returns int language sql security definer as $$
  select count(*)::int from public.field_document_versions where document_id = d;
$$;
-- service 起稿(模擬 Edge):文件＋AI 版本 1＋版本指標
create or replace function pg_temp.ai_doc(p_id uuid, p_project uuid, p_type text, p_intake uuid, p_target text, p_template uuid,
  p_by uuid, p_content jsonb, p_sources jsonb, p_att jsonb, p_required jsonb) returns void language plpgsql as $$
begin
  insert into public.field_documents (id, project_id, doc_type, doc_date, intake_id, target_key, template_id, status, required_fields, created_by)
    values (p_id, p_project, p_type, '2026-09-18', p_intake, p_target, p_template, 'pending_input', p_required, p_by);
  insert into public.field_document_versions (document_id, author_kind, content, field_sources, attachments, change_note)
    values (p_id, 'ai', p_content, p_sources, p_att, '系統依照片起稿');
  update public.field_documents set current_version_no = 1 where id = p_id;
end $$;
-- 呼叫 RPC 的簡寫
create or replace function pg_temp.put(k text, v jsonb, i uuid default 'a3e50000-0000-0000-0000-00000000000b') returns jsonb language sql as $$
  select public.set_intake_shared_input(i, k, v);
$$;
create or replace function pg_temp.res(r jsonb, d uuid) returns text language sql as $$
  select e ->> 'result' from jsonb_array_elements(r -> 'documents') e where e ->> 'document_id' = d::text;
$$;

-- RPC 回傳值暫存(postgres 建、authenticated 可寫;RPC 以 authenticated 呼叫)
create temp table outs (label text primary key, r jsonb);
grant all on outs to authenticated;

-- ── 1. 結構與執行權限 ─────────────────────────────────────────────────────────────
select has_function('public', 'set_intake_shared_input', array['uuid','text','jsonb'], 'set_intake_shared_input 存在');
select has_function('public', 'list_intake_shared_inputs', array['uuid'], 'list_intake_shared_inputs 存在');
select is(has_function_privilege('authenticated', 'public.set_intake_shared_input(uuid,text,jsonb)', 'execute'), true, 'authenticated 可補值(允許清單)');
select is(has_function_privilege('authenticated', 'public.list_intake_shared_inputs(uuid)', 'execute'), true, 'authenticated 可讀清單(允許清單)');
select is(has_function_privilege('anon', 'public.set_intake_shared_input(uuid,text,jsonb)', 'execute'), false, 'anon 不可補值');
select is(has_function_privilege('anon', 'public.list_intake_shared_inputs(uuid)', 'execute'), false, 'anon 不可讀清單');
select is(has_function_privilege('authenticated', 'public.fn_field_document_apply_shared_inputs(text,date,jsonb,jsonb,jsonb)', 'execute'), false,
  '套用函式不開給 authenticated(只經 RPC 存成人工版本)');
select is(has_function_privilege('anon', 'public.fn_field_document_apply_shared_inputs(text,date,jsonb,jsonb,jsonb)', 'execute'), false,
  '套用函式不開給 anon');
select is(has_function_privilege('authenticated', 'public.fn_field_document_shared_keys(text,date,jsonb)', 'execute'), false, '共用鍵目錄不開給 authenticated');
select is(has_function_privilege('authenticated', 'public.fn_intake_documents(photo_intakes)', 'execute'), false, '批次文件集合不開給 authenticated');

-- ── 2. 共用鍵目錄與值(純函式) ─────────────────────────────────────────────────────
select results_eq($$ select field, key_date, work_item_id from public.fn_intake_shared_key_parts('location:2026-09-18:a3e30000-0000-0000-0000-000000000001') $$,
  $$ values ('location'::text, '2026-09-18'::date, 'a3e30000-0000-0000-0000-000000000001'::uuid) $$, '位置鍵=欄位:日期:工項');
select results_eq($$ select field, key_date, work_item_id from public.fn_intake_shared_key_parts('weather_am:2026-09-18') $$,
  $$ values ('weather_am'::text, '2026-09-18'::date, null::uuid) $$, '天氣鍵=欄位:日期');
select is((select count(*)::int from public.fn_intake_shared_key_parts('qty:2026-02-30:a3e30000-0000-0000-0000-000000000001')), 0, '不存在的日期不是合法鍵');
select is((select count(*)::int from public.fn_intake_shared_key_parts('location:2026-09-18:A3E30000-0000-0000-0000-000000000001')), 0, '工項 uuid 須小寫正規形');
select is((select count(*)::int from public.fn_intake_shared_key_parts('labor:2026-09-18')), 0, '出工不在共用目錄(清單欄在日誌頁編)');
select results_eq($$ select key, path from public.fn_field_document_shared_keys('daily_log', '2026-09-18',
    '{"items":{"a3e30000-0000-0000-0000-000000000001":{"qty_today":null},"legacy-key":{"qty_today":1}}}') order by key $$,
  $$ values ('location:2026-09-18:a3e30000-0000-0000-0000-000000000001'::text, 'items.a3e30000-0000-0000-0000-000000000001.location'::text),
            ('qty:2026-09-18:a3e30000-0000-0000-0000-000000000001', 'items.a3e30000-0000-0000-0000-000000000001.qty_today'),
            ('weather_am:2026-09-18', 'weather_am'), ('weather_pm:2026-09-18', 'weather_pm') $$,
  '施工日誌:天氣＋每個工項列的位置與當日數量(非 uuid 的舊鍵不共用)');
select results_eq($$ select key, path from public.fn_field_document_shared_keys('self_check', '2026-09-18', '{"work_item_id":"a3e30000-0000-0000-0000-000000000001"}') $$,
  $$ values ('location:2026-09-18:a3e30000-0000-0000-0000-000000000001'::text, 'location'::text) $$, '自檢表:對應工項的檢查位置');
select is((select count(*)::int from public.fn_field_document_shared_keys('inspection_form', '2026-09-18',
    '{"work_item_id":"a3e30000-0000-0000-0000-000000000001","location":"A區"}')), 0,
  '監造查驗表單不共用位置(位置是確認數量的批次鍵,只能逐份確認)');
select results_eq($$ select key from public.fn_field_document_shared_keys('supervisor_log', '2026-09-18', '{}') order by key $$,
  $$ values ('weather_am:2026-09-18'::text), ('weather_pm:2026-09-18') $$, '監造日誌:只共用天氣');
select is(public.fn_intake_shared_value('location', '"  A區 3F  "'), '"A區 3F"'::jsonb, '位置去頭尾空白');
select is(public.fn_intake_shared_value('qty', '-1'), null, '負數量不合法');
select is(public.fn_intake_shared_value('qty', '"12"'), null, '數量必須是 JSON 數字(不收字串)');
select is(public.fn_intake_shared_value('qty', '12.5'), '12.5'::jsonb, '數量 12.5 合法');
select is(public.fn_field_document_shared_effect('{"status":"confirmed","source":"human"}', '"B棟"', 'location:2026-09-18:x', '"A區"'), 'human_value',
  '人在文件頁親自確認的值不覆蓋');
select is(public.fn_field_document_shared_effect('{"status":"filled","source":"ai:photo"}', '"A區"', 'location:2026-09-18:x', '"A區"'), 'update',
  '系統帶入(待核對)的值由人補值確認');
select is(public.fn_field_document_shared_effect('{"status":"confirmed","source":"shared:location:2026-09-18:x"}', '"A區"', 'location:2026-09-18:x', '"A區"'), 'applied',
  '值與來源已是同一個補值=不動');

-- ── 3. fixtures:A 案三方(廠商兩人)＋B 案外人 ─────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a3e00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'si-con@example.test', '', now(), '{}', '{"full_name":"廠商工地主任","org_type":"contractor"}', now(), now()),
  ('a3e00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'si-con2@example.test', '', now(), '{}', '{"full_name":"廠商品管","org_type":"contractor"}', now(), now()),
  ('a3e00000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'si-sup@example.test', '', now(), '{}', '{"full_name":"監造工程師","org_type":"supervisor"}', now(), now()),
  ('a3e00000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'si-own@example.test', '', now(), '{}', '{"full_name":"機關承辦","org_type":"owner"}', now(), now()),
  ('a3e00000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'si-out@example.test', '', now(), '{}', '{"full_name":"外案廠商","org_type":"contractor"}', now(), now()),
  ('a3e00000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'si-admin@example.test', '', now(), '{}', '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode) values
  ('a3e10000-0000-0000-0000-00000000000a', '共用補值測試案', '機關', '廠商', '監造', 'a3e00000-0000-0000-0000-000000000006', true),
  ('a3e10000-0000-0000-0000-00000000000b', '外案', '機關', '廠商', '監造', 'a3e00000-0000-0000-0000-000000000006', true);
alter table public.projects enable trigger on_project_created;
insert into public.project_members (project_id, user_id, role) values
  ('a3e10000-0000-0000-0000-00000000000a', 'a3e00000-0000-0000-0000-000000000001', 'member'),
  ('a3e10000-0000-0000-0000-00000000000a', 'a3e00000-0000-0000-0000-000000000002', 'member'),
  ('a3e10000-0000-0000-0000-00000000000a', 'a3e00000-0000-0000-0000-000000000003', 'member'),
  ('a3e10000-0000-0000-0000-00000000000a', 'a3e00000-0000-0000-0000-000000000004', 'member'),
  ('a3e10000-0000-0000-0000-00000000000a', 'a3e00000-0000-0000-0000-000000000006', 'admin'),
  ('a3e10000-0000-0000-0000-00000000000b', 'a3e00000-0000-0000-0000-000000000005', 'member'),
  ('a3e10000-0000-0000-0000-00000000000b', 'a3e00000-0000-0000-0000-000000000006', 'admin');
insert into public.work_items (id, project_id, item_key, item_no, description, unit, quantity, unit_price, amount, is_leaf, sort_order) values
  ('a3e30000-0000-0000-0000-000000000001', 'a3e10000-0000-0000-0000-00000000000a', 'W1', '壹.一.1', '結構混凝土', 'M3', 100, 3000, 300000, true, 1),
  ('a3e30000-0000-0000-0000-000000000002', 'a3e10000-0000-0000-0000-00000000000a', 'W2', '壹.一.2', '模板', 'M2', 500, 500, 250000, true, 2),
  ('a3e30000-0000-0000-0000-000000000003', 'a3e10000-0000-0000-0000-00000000000b', 'WB', '壹.一.1', '外案工項', 'M3', 1, 1, 1, true, 1);
insert into public.checklist_templates (id, project_id, title, source, items) values
  ('a3e40000-0000-0000-0000-000000000001', 'a3e10000-0000-0000-0000-00000000000a', '混凝土自主檢查表', '03310',
   '[{"no":"B1","item":"澆置前已通知監造","kind":"bool"}]'),
  ('a3e40000-0000-0000-0000-000000000002', 'a3e10000-0000-0000-0000-00000000000a', '模板自主檢查表', '03110',
   '[{"no":"F1","item":"支撐間距符合施工圖","kind":"bool"}]');
-- 照片(service:上傳方依 uploaded_by 推得):pc 廠商、ps 監造、pb 外案
insert into public.photos (id, project_id, storage_path, uploaded_by) values
  ('a3e60000-0000-0000-0000-000000000001', 'a3e10000-0000-0000-0000-00000000000a', 'a3e10000-0000-0000-0000-00000000000a/misc/c.jpg', 'a3e00000-0000-0000-0000-000000000001'),
  ('a3e60000-0000-0000-0000-000000000002', 'a3e10000-0000-0000-0000-00000000000a', 'a3e10000-0000-0000-0000-00000000000a/misc/s.jpg', 'a3e00000-0000-0000-0000-000000000003'),
  ('a3e60000-0000-0000-0000-000000000003', 'a3e10000-0000-0000-0000-00000000000b', 'a3e10000-0000-0000-0000-00000000000b/misc/b.jpg', 'a3e00000-0000-0000-0000-000000000005');
-- 批次:IA 廠商第一批(建了當日施工日誌)、IB 廠商第二批(同日;兩份自檢表,候選接手 IA 的施工日誌)、IS 監造批次、
-- IX 廠商另一批(會被捨棄)、IE 外案
insert into public.photo_intakes (id, project_id, created_by, log_date) values
  ('a3e50000-0000-0000-0000-00000000000a', 'a3e10000-0000-0000-0000-00000000000a', 'a3e00000-0000-0000-0000-000000000001', '2026-09-18'),
  ('a3e50000-0000-0000-0000-00000000000b', 'a3e10000-0000-0000-0000-00000000000a', 'a3e00000-0000-0000-0000-000000000001', '2026-09-18'),
  ('a3e50000-0000-0000-0000-00000000000c', 'a3e10000-0000-0000-0000-00000000000a', 'a3e00000-0000-0000-0000-000000000003', '2026-09-18'),
  ('a3e50000-0000-0000-0000-00000000000d', 'a3e10000-0000-0000-0000-00000000000a', 'a3e00000-0000-0000-0000-000000000001', '2026-09-18'),
  ('a3e50000-0000-0000-0000-00000000000e', 'a3e10000-0000-0000-0000-00000000000b', 'a3e00000-0000-0000-0000-000000000005', '2026-09-18');

-- DL 施工日誌(IA 起稿):天氣上午、兩個工項的位置與數量待補;監造照片 ps 被當證據附上(簽署時應被擋)
select pg_temp.ai_doc('a3e70000-0000-0000-0000-000000000001', 'a3e10000-0000-0000-0000-00000000000a', 'daily_log', 'a3e50000-0000-0000-0000-00000000000a',
  '2026-09-18', null, 'a3e00000-0000-0000-0000-000000000001',
  '{"log_date":"2026-09-18","weather_am":null,"weather_pm":"晴","work_summary":"3F 版牆澆置","labor":[{"type":"泥作","count":6}],
    "equipment":[{"name":"泵浦車","count":1}],"materials":[{"name":"混凝土","qty":12}],"extras":{},
    "items":{"a3e30000-0000-0000-0000-000000000001":{"item_no":"壹.一.1","description":"結構混凝土","unit":"M3","qty_today":null,"location":null,"note":null},
             "a3e30000-0000-0000-0000-000000000002":{"item_no":"壹.一.2","description":"模板","unit":"M2","qty_today":null,"location":null,"note":null}}}',
  '{"log_date":{"status":"filled","source":"intake"},"weather_am":{"status":"pending","source":null},"weather_pm":{"status":"filled","source":"cwa"},
    "work_summary":{"status":"filled","source":"ai:photo"},"labor":{"status":"filled","source":"legacy:x"},"equipment":{"status":"filled","source":"legacy:x"},
    "materials":{"status":"filled","source":"legacy:x"},
    "items.a3e30000-0000-0000-0000-000000000001.qty_today":{"status":"pending","source":null},
    "items.a3e30000-0000-0000-0000-000000000001.location":{"status":"pending","source":null},
    "items.a3e30000-0000-0000-0000-000000000002.qty_today":{"status":"pending","source":null},
    "items.a3e30000-0000-0000-0000-000000000002.location":{"status":"pending","source":null}}',
  '[{"photo_id":"a3e60000-0000-0000-0000-000000000001"},{"photo_id":"a3e60000-0000-0000-0000-000000000002"}]',
  '["log_date","weather_am","weather_pm","work_summary","labor","equipment","materials"]');
-- SC1／SC2 自檢表(IB 起稿;同工項兩張範本):SC1 位置待補、SC2 位置由照片帶入待核對
select pg_temp.ai_doc('a3e70000-0000-0000-0000-000000000002', 'a3e10000-0000-0000-0000-00000000000a', 'self_check', 'a3e50000-0000-0000-0000-00000000000b',
  '2026-09-18:a3e30000-0000-0000-0000-000000000001', 'a3e40000-0000-0000-0000-000000000001', 'a3e00000-0000-0000-0000-000000000001',
  '{"check_date":"2026-09-18","template_id":"a3e40000-0000-0000-0000-000000000001","work_item_id":"a3e30000-0000-0000-0000-000000000001",
    "location":null,"results":{"B1":{"value":null}},"note":null,"template":{"key":"self_check_demo","version":1}}',
  '{"check_date":{"status":"filled","source":"intake"},"template_id":{"status":"filled","source":"system:template_match"},
    "work_item_id":{"status":"filled","source":"ai:photo"},"location":{"status":"pending","source":null},"results.B1":{"status":"pending","source":null}}',
  '[{"photo_id":"a3e60000-0000-0000-0000-000000000001"}]', '["check_date","template_id","results.B1"]');
select pg_temp.ai_doc('a3e70000-0000-0000-0000-000000000003', 'a3e10000-0000-0000-0000-00000000000a', 'self_check', 'a3e50000-0000-0000-0000-00000000000b',
  '2026-09-18:a3e30000-0000-0000-0000-000000000001:formwork', 'a3e40000-0000-0000-0000-000000000002', 'a3e00000-0000-0000-0000-000000000001',
  '{"check_date":"2026-09-18","template_id":"a3e40000-0000-0000-0000-000000000002","work_item_id":"a3e30000-0000-0000-0000-000000000001",
    "location":"A區","results":{"F1":{"value":null}},"note":null,"template":{"key":"self_check_demo","version":1}}',
  '{"check_date":{"status":"filled","source":"intake"},"template_id":{"status":"filled","source":"system:template_match"},
    "work_item_id":{"status":"filled","source":"ai:photo"},"location":{"status":"filled","source":"ai:photo"},"results.F1":{"status":"pending","source":null}}',
  '[{"photo_id":"a3e60000-0000-0000-0000-000000000001"}]', '["check_date","template_id","results.F1"]');
-- SL 監造日誌(IS 起稿):天氣待補
select pg_temp.ai_doc('a3e70000-0000-0000-0000-000000000004', 'a3e10000-0000-0000-0000-00000000000a', 'supervisor_log', 'a3e50000-0000-0000-0000-00000000000c',
  '2026-09-18', null, 'a3e00000-0000-0000-0000-000000000003',
  '{"log_date":"2026-09-18","weather_am":null,"weather_pm":null,"attendance":[],"supervision_items":[],"inspection_ids":[],"notices":[],"followups":[],
    "contractor_summary":null,"template":{"key":"supervisor_log_demo","version":1}}',
  '{"log_date":{"status":"filled","source":"intake"},"weather_am":{"status":"pending","source":null},"weather_pm":{"status":"pending","source":null},
    "attendance":{"status":"pending","source":null}}',
  '[{"photo_id":"a3e60000-0000-0000-0000-000000000002"}]', '["log_date","weather_am","weather_pm","attendance"]');
-- DB 外案施工日誌(IE)
select pg_temp.ai_doc('a3e70000-0000-0000-0000-000000000005', 'a3e10000-0000-0000-0000-00000000000b', 'daily_log', 'a3e50000-0000-0000-0000-00000000000e',
  '2026-09-18', null, 'a3e00000-0000-0000-0000-000000000005',
  '{"log_date":"2026-09-18","weather_am":null,"items":{"a3e30000-0000-0000-0000-000000000003":{"qty_today":null,"location":null}}}',
  '{"weather_am":{"status":"pending","source":null},"items.a3e30000-0000-0000-0000-000000000003.location":{"status":"pending","source":null}}',
  '[{"photo_id":"a3e60000-0000-0000-0000-000000000003"}]', '["weather_am"]');
-- SCX 自檢表(IX 起稿;批次稍後捨棄)
select pg_temp.ai_doc('a3e70000-0000-0000-0000-000000000006', 'a3e10000-0000-0000-0000-00000000000a', 'self_check', 'a3e50000-0000-0000-0000-00000000000d',
  '2026-09-18:a3e30000-0000-0000-0000-000000000002', 'a3e40000-0000-0000-0000-000000000002', 'a3e00000-0000-0000-0000-000000000001',
  '{"check_date":"2026-09-18","template_id":"a3e40000-0000-0000-0000-000000000002","work_item_id":"a3e30000-0000-0000-0000-000000000002","location":null,"results":{"F1":{"value":null}}}',
  '{"location":{"status":"pending","source":null}}', '[{"photo_id":"a3e60000-0000-0000-0000-000000000001"}]', '["check_date","template_id","results.F1"]');
-- IB 的候選(Edge 寫):施工日誌由 IA 建立、同日由 IB 接手;兩份自檢表;另偽造兩筆指向監造日誌與外案文件(不得被波及)
update public.photo_intakes set status = 'ready', candidates = jsonb_build_array(
    jsonb_build_object('doc_type', 'daily_log', 'target_key', '2026-09-18', 'document_id', 'a3e70000-0000-0000-0000-000000000001', 'excluded', false),
    jsonb_build_object('doc_type', 'self_check', 'target_key', '2026-09-18:a3e30000-0000-0000-0000-000000000001', 'document_id', 'a3e70000-0000-0000-0000-000000000002', 'excluded', false),
    jsonb_build_object('doc_type', 'self_check', 'target_key', '2026-09-18:a3e30000-0000-0000-0000-000000000001:formwork', 'document_id', 'a3e70000-0000-0000-0000-000000000003', 'excluded', false),
    jsonb_build_object('doc_type', 'supervisor_log', 'target_key', '2026-09-18', 'document_id', 'a3e70000-0000-0000-0000-000000000004', 'excluded', false),
    jsonb_build_object('doc_type', 'daily_log', 'target_key', '2026-09-18', 'document_id', 'a3e70000-0000-0000-0000-000000000005', 'excluded', false))
 where id = 'a3e50000-0000-0000-0000-00000000000b';

-- ── 4. 清單(批次結果頁):同方文件、效果由伺服器判定 ─────────────────────────────────────
select pg_temp.become('a3e00000-0000-0000-0000-000000000001');
set local role authenticated;
select is((public.list_intake_shared_inputs('a3e50000-0000-0000-0000-00000000000b') ->> 'can_edit')::boolean, true, '上傳方廠商可補值');
select is((select jsonb_agg(f ->> 'key' order by ord) from jsonb_array_elements(public.list_intake_shared_inputs('a3e50000-0000-0000-0000-00000000000b') -> 'fields') with ordinality t(f, ord)),
  '["weather_am:2026-09-18","weather_pm:2026-09-18","location:2026-09-18:a3e30000-0000-0000-0000-000000000001","qty:2026-09-18:a3e30000-0000-0000-0000-000000000001","location:2026-09-18:a3e30000-0000-0000-0000-000000000002","qty:2026-09-18:a3e30000-0000-0000-0000-000000000002"]'::jsonb,
  '共用欄位=本批同方文件用到的鍵(天氣在前、工項依標單順序);監造日誌與外案文件的鍵不列入');
select is((select jsonb_agg(jsonb_build_array(d ->> 'document_id', d ->> 'effect') order by d ->> 'document_id')
             from jsonb_array_elements(public.list_intake_shared_inputs('a3e50000-0000-0000-0000-00000000000b') -> 'fields') f,
                  jsonb_array_elements(f -> 'documents') d
            where f ->> 'key' = 'location:2026-09-18:a3e30000-0000-0000-0000-000000000001'),
  '[["a3e70000-0000-0000-0000-000000000001","update"],["a3e70000-0000-0000-0000-000000000002","update"],["a3e70000-0000-0000-0000-000000000003","update"]]'::jsonb,
  '位置鍵影響三份草稿(前一批建的施工日誌＋本批兩份自檢表),全部將寫入');
select is((select f -> 'work_item' ->> 'description' || '/' || (f ->> 'label') || '/' || (f ->> 'value_kind')
             from jsonb_array_elements(public.list_intake_shared_inputs('a3e50000-0000-0000-0000-00000000000b') -> 'fields') f
            where f ->> 'key' = 'qty:2026-09-18:a3e30000-0000-0000-0000-000000000001'), '結構混凝土/當日完成數量/number', '欄位帶工項、中文標籤與值型別');
reset role;
select pg_temp.become('a3e00000-0000-0000-0000-000000000003');
set local role authenticated;
select is((public.list_intake_shared_inputs('a3e50000-0000-0000-0000-00000000000b') ->> 'can_edit')::boolean, false, '監造可讀廠商批次清單但不可補值');
reset role;
select pg_temp.become('a3e00000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$ select public.list_intake_shared_inputs('a3e50000-0000-0000-0000-00000000000b') $$, 'PD006', null, '非成員讀清單 → PD006');

-- ── 5. 權限與輸入 ─────────────────────────────────────────────────────────────────
select throws_ok($$ select pg_temp.put('location:2026-09-18:a3e30000-0000-0000-0000-000000000001', '"X"') $$, 'PD006', null, '非成員補值 → PD006');
reset role;
select pg_temp.become('a3e00000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ select pg_temp.put('location:2026-09-18:a3e30000-0000-0000-0000-000000000001', '"X"') $$, 'PD006', null, '監造補廠商批次 → PD006(補值不跨角色)');
reset role;
select pg_temp.become('a3e00000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ select pg_temp.put('location:2026-09-18:a3e30000-0000-0000-0000-000000000001', '"X"') $$, 'PD006', null, '機關(正式模式唯讀)補值 → PD006');
reset role;
select pg_temp.become(null);
set local role anon;
select throws_ok($$ select public.set_intake_shared_input('a3e50000-0000-0000-0000-00000000000b', 'weather_am:2026-09-18', '"晴"') $$, '42501', null, 'anon 直連 → 42501');
reset role;
select pg_temp.become('a3e00000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ select pg_temp.put('labor:2026-09-18', '[]') $$, 'PD010', null, '目錄外的鍵 → PD010');
select throws_ok($$ select pg_temp.put('location:2026-09-18:a3e30000-0000-0000-0000-000000000003', '"X"') $$, 'PD010', null, '他案工項 → PD010(跨案拒絕)');
select throws_ok($$ select pg_temp.put('qty:2026-09-18:a3e30000-0000-0000-0000-000000000001', '-3') $$, 'PD010', null, '負數量 → PD010');
select throws_ok($$ select pg_temp.put('location:2026-09-18:a3e30000-0000-0000-0000-000000000001', '"   "') $$, 'PD010', null, '空白位置 → PD010');
select throws_ok($$ select pg_temp.put('weather_am:2026-09-19', '"晴"') $$, 'PD010', null, '本批文件沒用到的鍵(別日)→ PD010');
select is((select shared_inputs from public.photo_intakes where id = 'a3e50000-0000-0000-0000-00000000000b'), '{}'::jsonb, '被拒的補值不留下任何紀錄');
select is(pg_temp.vcount('a3e70000-0000-0000-0000-000000000001') + pg_temp.vcount('a3e70000-0000-0000-0000-000000000002')
          + pg_temp.vcount('a3e70000-0000-0000-0000-000000000003'), 3, '被拒的補值不產生版本');

-- ── 6. 補一次:三份草稿各建一個人工版本(走存版規則,雜湊由 DB 算,附件原樣) ─────────────────────────
insert into outs select 'r1', pg_temp.put('location:2026-09-18:a3e30000-0000-0000-0000-000000000001', '" A區 3F "');
select is((select (r ->> 'updated')::int from outs where label = 'r1'), 3, '補一次 → 三份草稿更新');
select is((select r -> 'value' from outs where label = 'r1'), '"A區 3F"'::jsonb, '回傳正規化後的值');
select is(array[pg_temp.vno('a3e70000-0000-0000-0000-000000000001'), pg_temp.vno('a3e70000-0000-0000-0000-000000000002'), pg_temp.vno('a3e70000-0000-0000-0000-000000000003')],
  array[2, 2, 2], '三份文件都前進到版本 2');
select is((pg_temp.cur('a3e70000-0000-0000-0000-000000000001')).content #>> '{items,a3e30000-0000-0000-0000-000000000001,location}', 'A區 3F', '施工日誌工項列位置已寫入');
select is((pg_temp.cur('a3e70000-0000-0000-0000-000000000002')).content ->> 'location', 'A區 3F', '自檢表 1 位置已寫入');
select is((pg_temp.cur('a3e70000-0000-0000-0000-000000000003')).content ->> 'location', 'A區 3F', '自檢表 2 系統帶入的位置由人補值取代');
select is((select count(*)::int from public.field_document_versions v
            where v.document_id in ('a3e70000-0000-0000-0000-000000000001', 'a3e70000-0000-0000-0000-000000000002', 'a3e70000-0000-0000-0000-000000000003')
              and v.version_no = 2 and v.author_kind = 'human' and v.created_by = 'a3e00000-0000-0000-0000-000000000001'), 3,
  '三個新版本都是人工版本、建立者=補值的人');
reset role; -- 雜湊函式不開給 authenticated,以 owner 重算比對
select is((select count(*)::int from public.field_document_versions v
            where v.document_id in ('a3e70000-0000-0000-0000-000000000001', 'a3e70000-0000-0000-0000-000000000002', 'a3e70000-0000-0000-0000-000000000003')
              and v.version_no = 2 and v.content_hash = public.fn_field_document_content_hash(v.content, v.attachments)), 3,
  '三個新版本的雜湊都由 DB 以內容＋附件計算');
set local role authenticated;
select is((select jsonb_agg(e ->> 'content_hash' order by e ->> 'document_id') from outs, jsonb_array_elements(r -> 'documents') e where label = 'r1'),
  (select jsonb_agg(v.content_hash order by v.document_id::text) from public.field_document_versions v
    where v.document_id in ('a3e70000-0000-0000-0000-000000000001', 'a3e70000-0000-0000-0000-000000000002', 'a3e70000-0000-0000-0000-000000000003') and v.version_no = 2),
  'RPC 回傳的雜湊就是 DB 版本雜湊(前端簽署時原樣送回)');
select is((select count(*)::int from public.field_document_versions v
            where v.document_id in ('a3e70000-0000-0000-0000-000000000001', 'a3e70000-0000-0000-0000-000000000002', 'a3e70000-0000-0000-0000-000000000003')
              and v.version_no = 2
              and (v.field_sources -> (case when v.document_id = 'a3e70000-0000-0000-0000-000000000001'
                                            then 'items.a3e30000-0000-0000-0000-000000000001.location' else 'location' end)) - 'confirmed_at'
                  = jsonb_build_object('status', 'confirmed', 'source', 'shared:location:2026-09-18:a3e30000-0000-0000-0000-000000000001',
                                       'confirmed_by', 'a3e00000-0000-0000-0000-000000000001')), 3,
  '人補的欄一律 confirmed(來源 shared:<鍵>、確認者=本人)');
select is((pg_temp.cur('a3e70000-0000-0000-0000-000000000001')).attachments,
  (select attachments from public.field_document_versions where document_id = 'a3e70000-0000-0000-0000-000000000001' and version_no = 1),
  '附件原樣帶過(角色不因補值改變)');
select is((select change_note from public.field_document_versions where document_id = 'a3e70000-0000-0000-0000-000000000002' and version_no = 2),
  '共用補值:施作位置・壹.一.1 結構混凝土・2026-09-18', '版本說明記錄是哪一個共用補值');
select is((select status from public.field_documents where id = 'a3e70000-0000-0000-0000-000000000002'), 'pending_input', '狀態依存版規則重算(檢查項目仍待補)');
select is(pg_temp.vcount('a3e70000-0000-0000-0000-000000000004'), 1, '監造日誌(他方)沒有新版本');
select is(pg_temp.vcount('a3e70000-0000-0000-0000-000000000005'), 1, '外案文件沒有新版本(偽造候選也碰不到)');
select is(pg_temp.vcount('a3e70000-0000-0000-0000-000000000006'), 1, '另一批的自檢表(不同工項)不受影響');
select is((select (shared_inputs -> 'location:2026-09-18:a3e30000-0000-0000-0000-000000000001') - 'set_at' from public.photo_intakes where id = 'a3e50000-0000-0000-0000-00000000000b'),
  '{"value":"A區 3F","set_by":"a3e00000-0000-0000-0000-000000000001"}'::jsonb, '批次記下共用補值與補值的人');

-- ── 7. 冪等:同值重送不產生版本 ────────────────────────────────────────────────────────
insert into outs select 'ts1', shared_inputs -> 'location:2026-09-18:a3e30000-0000-0000-0000-000000000001' -> 'set_at'
  from public.photo_intakes where id = 'a3e50000-0000-0000-0000-00000000000b';
insert into outs select 'r2', pg_temp.put('location:2026-09-18:a3e30000-0000-0000-0000-000000000001', '"A區 3F"');
select is((select (r ->> 'updated')::int from outs where label = 'r2'), 0, '同值重送:沒有文件需要更新');
select is((select jsonb_agg(e ->> 'result' order by e ->> 'document_id') from outs, jsonb_array_elements(r -> 'documents') e where label = 'r2'),
  '["unchanged","unchanged","unchanged"]'::jsonb, '三份皆回 unchanged');
select is(pg_temp.vcount('a3e70000-0000-0000-0000-000000000001') + pg_temp.vcount('a3e70000-0000-0000-0000-000000000002')
          + pg_temp.vcount('a3e70000-0000-0000-0000-000000000003'), 6, '版本數不變(沒有重複版本)');
select is((select shared_inputs -> 'location:2026-09-18:a3e30000-0000-0000-0000-000000000001' ->> 'set_at' from public.photo_intakes where id = 'a3e50000-0000-0000-0000-00000000000b'),
  (select r #>> '{}' from outs where label = 'ts1'), '批次補值時間不變');
select is((select jsonb_agg(d ->> 'effect' order by d ->> 'document_id')
             from jsonb_array_elements(public.list_intake_shared_inputs('a3e50000-0000-0000-0000-00000000000b') -> 'fields') f,
                  jsonb_array_elements(f -> 'documents') d
            where f ->> 'key' = 'location:2026-09-18:a3e30000-0000-0000-0000-000000000001'),
  '["applied","applied","applied"]'::jsonb, '清單顯示三份皆已套用');

-- ── 8. 簽署其中一份、另一份由人在文件頁改寫 → 再補另一值:已簽署不變、人親自確認的不覆蓋 ───────────────
select lives_ok($$ select public.save_field_document_version('a3e70000-0000-0000-0000-000000000002', 2,
    (pg_temp.cur('a3e70000-0000-0000-0000-000000000002')).content || '{"results":{"B1":{"value":true}}}',
    (pg_temp.cur('a3e70000-0000-0000-0000-000000000002')).field_sources || '{"results.B1":{"status":"confirmed","source":"human"}}',
    (pg_temp.cur('a3e70000-0000-0000-0000-000000000002')).attachments) $$, '廠商在自檢表 1 填檢查項目(版本 3)');
select lives_ok($$ select public.sign_field_document('a3e70000-0000-0000-0000-000000000002', 3,
    (pg_temp.cur('a3e70000-0000-0000-0000-000000000002')).content_hash, '本人確認自主檢查表內容') $$, '簽署自檢表 1');
reset role;
select pg_temp.become('a3e00000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.save_field_document_version('a3e70000-0000-0000-0000-000000000003', 2,
    (pg_temp.cur('a3e70000-0000-0000-0000-000000000003')).content || '{"location":"B棟 2F"}',
    (pg_temp.cur('a3e70000-0000-0000-0000-000000000003')).field_sources || '{"location":{"status":"confirmed","source":"human"}}',
    (pg_temp.cur('a3e70000-0000-0000-0000-000000000003')).attachments) $$, '另一位廠商成員在自檢表 2 親自改位置(版本 3)');
reset role;
select pg_temp.become('a3e00000-0000-0000-0000-000000000001');
set local role authenticated;
insert into outs select 'sc1_before', to_jsonb(content_hash) from public.field_document_versions
  where document_id = 'a3e70000-0000-0000-0000-000000000002' and version_no = 3;
insert into outs select 'r3', pg_temp.put('location:2026-09-18:a3e30000-0000-0000-0000-000000000001', '"A區 4F"');
select is((select jsonb_build_array(pg_temp.res(r, 'a3e70000-0000-0000-0000-000000000001'), pg_temp.res(r, 'a3e70000-0000-0000-0000-000000000002'),
                                    pg_temp.res(r, 'a3e70000-0000-0000-0000-000000000003')) from outs where label = 'r3'),
  '["updated","locked","human_value"]'::jsonb, '再補另一值:施工日誌更新、已簽署自檢表不動、人親自確認的自檢表不覆蓋');
select is((select status || '/' || current_version_no from public.field_documents where id = 'a3e70000-0000-0000-0000-000000000002'), 'signed/3',
  '已簽署文件的狀態與版本不變');
select is((pg_temp.cur('a3e70000-0000-0000-0000-000000000002')).content_hash, (select r #>> '{}' from outs where label = 'sc1_before'), '已簽署文件內容雜湊不變');
select is((pg_temp.cur('a3e70000-0000-0000-0000-000000000002')).content ->> 'location', 'A區 3F', '已簽署文件保留簽署當時的位置');
select is((pg_temp.cur('a3e70000-0000-0000-0000-000000000003')).content ->> 'location', 'B棟 2F', '人親自確認的位置不被覆蓋');
select is((pg_temp.cur('a3e70000-0000-0000-0000-000000000001')).content #>> '{items,a3e30000-0000-0000-0000-000000000001,location}', 'A區 4F',
  '先前由同一補值寫入的欄可更正(來源後改只影響未簽署草稿)');
select is((select jsonb_agg(d ->> 'effect' order by d ->> 'document_id')
             from jsonb_array_elements(public.list_intake_shared_inputs('a3e50000-0000-0000-0000-00000000000b') -> 'fields') f,
                  jsonb_array_elements(f -> 'documents') d
            where f ->> 'key' = 'location:2026-09-18:a3e30000-0000-0000-0000-000000000001'),
  '["applied","locked","human_value"]'::jsonb, '清單同步顯示:已套用／已簽署不受影響／已個別填寫');

-- 簽後更正(回到草稿但有簽署紀錄)也不由補值改寫:更正只在文件頁由人填原因
select lives_ok($$ select public.save_field_document_version('a3e70000-0000-0000-0000-000000000002', 3,
    (pg_temp.cur('a3e70000-0000-0000-0000-000000000002')).content, (pg_temp.cur('a3e70000-0000-0000-0000-000000000002')).field_sources,
    (pg_temp.cur('a3e70000-0000-0000-0000-000000000002')).attachments, '複核後更正') $$, '自檢表 1 建立簽後更正版本(版本 4,回草稿)');
insert into outs select 'r4', pg_temp.put('location:2026-09-18:a3e30000-0000-0000-0000-000000000001', '"A區 5F"');
select is((select pg_temp.res(r, 'a3e70000-0000-0000-0000-000000000002') from outs where label = 'r4'), 'locked', '簽後更正中的文件不被補值改寫');
select is(pg_temp.vno('a3e70000-0000-0000-0000-000000000002'), 4, '更正版本號不變');

-- ── 9. 補齊其餘欄位 → 施工日誌可簽前仍被角色隔離擋下(監造照片當證據 → PD005) ─────────────────────
select is((pg_temp.put('weather_am:2026-09-18', '"陰"') ->> 'updated')::int, 1, '天氣(上午)只有施工日誌用到');
select is((pg_temp.put('qty:2026-09-18:a3e30000-0000-0000-0000-000000000001', '12.5') ->> 'updated')::int, 1, '工項 1 當日數量');
select is((pg_temp.put('qty:2026-09-18:a3e30000-0000-0000-0000-000000000002', '0') ->> 'updated')::int, 1, '工項 2 當日數量(0 也是值)');
select is((pg_temp.cur('a3e70000-0000-0000-0000-000000000001')).content #> '{items,a3e30000-0000-0000-0000-000000000001,qty_today}', '12.5'::jsonb, '數量以數字寫入');
select is((select recheck from public.field_documents where id = 'a3e70000-0000-0000-0000-000000000001'),
  '[{"key":"attachments.a3e60000-0000-0000-0000-000000000002","status":"uploader_org:supervisor"}]'::jsonb,
  '必填齊備後待補只剩附件角色問題(補值不會把監造照片變成施作證據)');
select throws_ok($$ select public.sign_field_document('a3e70000-0000-0000-0000-000000000001', pg_temp.vno('a3e70000-0000-0000-0000-000000000001'),
    (pg_temp.cur('a3e70000-0000-0000-0000-000000000001')).content_hash, '本人確認施工日誌') $$,
  'PD005', null, '簽署仍被擋:他方照片不得當本方證據');

-- ── 10. 反向:監造補自己批次,只動監造日誌;廠商文件不變 ───────────────────────────────────
reset role;
select pg_temp.become('a3e00000-0000-0000-0000-000000000003');
set local role authenticated;
insert into outs select 'r5', pg_temp.put('weather_am:2026-09-18', '"晴時多雲"', 'a3e50000-0000-0000-0000-00000000000c');
select is((select jsonb_agg(e ->> 'document_id') from outs, jsonb_array_elements(r -> 'documents') e where label = 'r5'),
  '["a3e70000-0000-0000-0000-000000000004"]'::jsonb, '監造批次只涉及監造日誌');
select is((pg_temp.cur('a3e70000-0000-0000-0000-000000000004')).content ->> 'weather_am', '晴時多雲', '監造日誌天氣已寫入');
select is((pg_temp.cur('a3e70000-0000-0000-0000-000000000001')).content ->> 'weather_am', '陰', '同日施工日誌(他方)不受影響');
reset role;
select pg_temp.become('a3e00000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ select pg_temp.put('weather_am:2026-09-18', '"雨"', 'a3e50000-0000-0000-0000-00000000000c') $$, 'PD006', null,
  '廠商補監造批次 → PD006');
select is((select (r ->> 'updated')::int from (select pg_temp.put('weather_pm:2026-09-18', '"多雲"') as r) x), 1,
  '廠商補下午天氣:只更新施工日誌(系統帶入的氣象署值由人確認取代)');
select is(pg_temp.vcount('a3e70000-0000-0000-0000-000000000004') * 10 + pg_temp.vcount('a3e70000-0000-0000-0000-000000000005'), 21,
  '偽造候選指向的監造日誌與外案文件仍未被改動');

-- ── 11. 捨棄的批次不可再補值 ─────────────────────────────────────────────────────────
update public.photo_intakes set status = 'discarded' where id = 'a3e50000-0000-0000-0000-00000000000d';
select throws_ok($$ select pg_temp.put('location:2026-09-18:a3e30000-0000-0000-0000-000000000002', '"C區"', 'a3e50000-0000-0000-0000-00000000000d') $$,
  'PD008', null, '已捨棄的批次 → PD008');
select is((public.list_intake_shared_inputs('a3e50000-0000-0000-0000-00000000000d') ->> 'can_edit')::boolean, false, '捨棄的批次清單不可編');

-- ── 12. 套用函式本身(RPC 內部):確認者與時間取自補值紀錄;人親自確認的欄列為 skipped ─────────────────
reset role;
select pg_temp.become(null);
select is((public.fn_field_document_apply_shared_inputs('self_check', '2026-09-18',
    '{"work_item_id":"a3e30000-0000-0000-0000-000000000001","location":"照片位置"}', '{"location":{"status":"filled","source":"ai:photo"}}',
    '{"location:2026-09-18:a3e30000-0000-0000-0000-000000000001":{"value":"A區 5F","set_by":"a3e00000-0000-0000-0000-000000000001","set_at":"2026-09-18T01:00:00Z"}}')
  -> 'field_sources' -> 'location'),
  '{"status":"confirmed","source":"shared:location:2026-09-18:a3e30000-0000-0000-0000-000000000001","confirmed_by":"a3e00000-0000-0000-0000-000000000001","confirmed_at":"2026-09-18T01:00:00Z"}'::jsonb,
  '寫入的來源=confirmed、shared:<鍵>、確認者與時間取自補值紀錄');
select is((public.fn_field_document_apply_shared_inputs('self_check', '2026-09-18', '{"work_item_id":"a3e30000-0000-0000-0000-000000000001"}', '{}',
    '{"location:2026-09-18:a3e30000-0000-0000-0000-000000000001":{"value":"   "}}') -> 'applied'), '[]'::jsonb,
  '不合法的補值(空白)不套用');
select is((public.fn_field_document_apply_shared_inputs('self_check', '2026-09-18',
    '{"work_item_id":"a3e30000-0000-0000-0000-000000000001","location":"B棟"}', '{"location":{"status":"na","reason":"本次不分區"}}',
    '{"location:2026-09-18:a3e30000-0000-0000-0000-000000000001":{"value":"A區"}}') -> 'skipped'),
  '[{"key":"location:2026-09-18:a3e30000-0000-0000-0000-000000000001","path":"location","effect":"human_value"}]'::jsonb,
  '人標「不適用」的欄同樣不覆蓋(列入 skipped)');

select * from finish();
rollback;
