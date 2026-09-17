-- P3a 監造日誌後端 pgTAP:supervisor_logs 事實表(每日唯一、監造寫／廠商與機關不可寫／成員可讀／非成員與跨案不可)、
-- 示範範本與人填欄規則(到場不可由 AI／service 帶入;人標 filled 仍待確認)、sign_field_document 的 supervisor_log 分支
-- (aal2、必填、附件角色隔離:廠商照片不能作證據、引用必須是本案的)、通用事實表 guard(簽後不可直接改刪)。
-- 對應 migration 20260917221000_supervisor_logs.sql;設計 docs/architecture/field-documents-lifecycle.md §2.2、§3.4、§5。
-- daily_log 分支與 daily_logs guard 的回歸在 field_document_sign.sql(同一套 RPC、同一支通用 guard)。
begin;

select plan(128);

create or replace function pg_temp.become(u uuid, aal text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else (jsonb_build_object('sub', u::text, 'role', 'authenticated')
               || case when aal is null then '{}'::jsonb else jsonb_build_object('aal', aal) end)::text end, true);
end $$;
select pg_temp.become(null);

create or replace function pg_temp.hash_of(d uuid, v int) returns text language sql as $$
  select content_hash from public.field_document_versions where document_id = d and version_no = v;
$$;
-- 一份齊備的監造日誌內容(到場 s1 本人;監造事項引用 WI-1 與監造照片 p1;當日查驗 I1;通知引用缺失 DF1;追蹤引用查驗 I1;
-- 收件情形引用廠商施工日誌文件 DL1;範本=示範範本)
create or replace function pg_temp.content_ok() returns jsonb language sql as $$
  select '{"log_date":"2026-09-17","weather_am":"晴","weather_pm":"多雲",
           "attendance":[{"user_id":"e0000000-0000-0000-0000-000000000001","name":"監造工程師","from":"08:30","to":"17:00"}],
           "supervision_items":[{"time":"09:10","item":"抽查 3F 版牆鋼筋綁紮","location":"3F","work_item_id":"e3000000-0000-0000-0000-000000000001",
                                 "note":"間距符合","source":"ai:photo","photo_ids":["e6000000-0000-0000-0000-000000000001"]}],
           "inspection_ids":["e9000000-0000-0000-0000-000000000001"],
           "notices":[{"to":"contractor","content":"缺失通知:3F 柱箍筋間距過大","ref_type":"defect","ref_id":"ea000000-0000-0000-0000-000000000001"}],
           "followups":[{"ref_type":"inspection","ref_id":"e9000000-0000-0000-0000-000000000001","content":"鋼筋查驗合格,待混凝土澆置前複查","status":"open"}],
           "contractor_summary":"3F 版牆鋼筋綁紮(依廠商施工日誌 v1)",
           "daily_log_receipt":{"document_id":"e7000000-0000-0000-0000-000000000009","version_no":1,"status":"draft"},
           "note":null,"template":{"key":"supervisor_log_demo","version":1}}'::jsonb;
$$;
create or replace function pg_temp.sources_ok() returns jsonb language sql as $$
  select '{"log_date":{"status":"filled","source":"intake"},
           "weather_am":{"status":"filled","source":"cwa"},"weather_pm":{"status":"filled","source":"cwa"},
           "attendance":{"status":"confirmed"},
           "supervision_items":{"status":"filled","source":"ai:photo","refs":["e6000000-0000-0000-0000-000000000001"]},
           "inspection_ids":{"status":"filled","source":"system:inspections"},
           "notices":{"status":"filled","source":"system:defects"},
           "followups":{"status":"filled","source":"system:inspections"},
           "contractor_summary":{"status":"filled","source":"field_document:e7000000-0000-0000-0000-000000000009:v1"},
           "daily_log_receipt":{"status":"filled","source":"system:field_documents"}}'::jsonb;
$$;
-- 附件:p1 監造證據、p2 廠商照片只作 reference
create or replace function pg_temp.att_ok() returns jsonb language sql as $$
  select '[{"photo_id":"e6000000-0000-0000-0000-000000000001"},
           {"photo_id":"e6000000-0000-0000-0000-000000000002","role":"reference"}]'::jsonb;
$$;

-- ── 1. 結構、guard、函式、執行權限 ────────────────────────────────────────────────
select has_table('public', 'supervisor_logs', 'supervisor_logs 存在');
select col_is_unique('public', 'supervisor_logs', array['project_id','log_date'], '每案每日唯一');
select has_trigger('public', 'supervisor_logs', 'supervisor_logs_guard', 'supervisor_logs guard 掛上');
select has_trigger('public', 'daily_logs', 'daily_logs_guard', 'daily_logs guard 仍掛著(改呼叫通用實作)');
select has_trigger('public', 'daily_log_items', 'daily_log_items_guard', 'daily_log_items guard 仍掛著');
select has_function('public', 'fn_field_document_template', array['text'], '範本函式存在');
select has_function('public', 'fn_field_document_human_only_keys', array['text'], '人填欄推導函式存在');
select has_function('public', 'fn_field_document_unmet_fields', array['text','jsonb','jsonb'], '待補判定改為帶 doc_type');
select hasnt_function('public', 'fn_field_document_unmet_fields', array['jsonb','jsonb'], '舊二參數待補判定已移除(只有一份實作)');
select has_function('public', 'fn_field_document_fact_guard', array['text','text','uuid','uuid','date','uuid','uuid','date'], '通用事實表 guard 規則存在');
select has_function('public', 'fn_field_document_target_signed', array['text','uuid'], '通用「已簽署」判定存在');
select has_function('public', 'fn_field_document_sign_bypass', array['text','uuid','date'], '通用 GUC 放行判定存在');
select hasnt_function('public', 'fn_daily_log_signed', array['uuid'], 'P2d 專用 fn_daily_log_signed 已退場');
select hasnt_function('public', 'fn_daily_log_sign_bypass', array['uuid','date'], 'P2d 專用 fn_daily_log_sign_bypass 已退場');
select has_function('public', 'field_document_sign_daily_log_internal', array['field_documents','field_document_versions','uuid'], 'daily_log 簽署分支內部函式存在');
select has_function('public', 'field_document_sign_supervisor_log_internal', array['field_documents','field_document_versions','uuid'], 'supervisor_log 簽署分支內部函式存在');
select has_function('public', 'fn_project_ref_exists', array['uuid','text','uuid'], '本案引用存在性函式存在');
select is(has_table_privilege('authenticated', 'public.supervisor_logs', 'SELECT'), true, 'authenticated 可 SELECT');
select is(has_table_privilege('authenticated', 'public.supervisor_logs', 'INSERT'), true, 'authenticated 有 INSERT(RLS 限監造)');
select is(has_table_privilege('authenticated', 'public.supervisor_logs', 'UPDATE'), true, 'authenticated 有 UPDATE(RLS 限監造)');
select is(has_table_privilege('authenticated', 'public.supervisor_logs', 'DELETE'), true, 'authenticated 有 DELETE(RLS 限監造;guard 擋已簽署)');
select is(has_table_privilege('anon', 'public.supervisor_logs', 'SELECT'), false, 'anon 不可讀');
select is(has_function_privilege('authenticated', 'public.fn_field_document_template(text)', 'execute'), true, 'authenticated 可取範本(介面／列印標示示範範本)');
select is(has_function_privilege('anon', 'public.fn_field_document_template(text)', 'execute'), false, 'anon 不可取範本');
select is(has_function_privilege('authenticated', 'public.fn_field_document_human_only_keys(text)', 'execute'), false, '人填欄推導不開給 authenticated');
select is(has_function_privilege('authenticated', 'public.field_document_sign_supervisor_log_internal(field_documents,field_document_versions,uuid)', 'execute'), false, '簽署分支內部函式不開給 authenticated');
select is(has_function_privilege('authenticated', 'public.field_document_sign_daily_log_internal(field_documents,field_document_versions,uuid)', 'execute'), false, 'daily_log 分支內部函式不開給 authenticated');
select is(has_function_privilege('authenticated', 'public.fn_field_document_fact_guard(text,text,uuid,uuid,date,uuid,uuid,date)', 'execute'), false, '通用 guard 規則不開給 authenticated');

-- ── 2. 示範範本與純函式 ───────────────────────────────────────────────────────────
select is((select t ->> 'key' || '/' || (t ->> 'version') || '/' || (t ->> 'is_demo') || '/' || (t ->> 'demo_label')
           from public.fn_field_document_template('supervisor_log') t),
  'supervisor_log_demo/1/true/示範範本', '監造日誌範本=示範範本(is_demo、demo_label 供介面／列印標示)');
select ok((select t ->> 'disclaimer' from public.fn_field_document_template('supervisor_log') t) like '%非任何機關公定或法定格式%',
  '範本附免責聲明:非機關公定或法定格式');
select is((select jsonb_array_length(t -> 'sections') from public.fn_field_document_template('supervisor_log') t), 8, '範本八節');
select is(public.fn_field_document_template('daily_log'), null, '施工日誌無範本(公定格式,固定欄在必填函式)');
select is(public.fn_field_document_human_only_keys('supervisor_log'), array['attendance'], '監造日誌人填欄=到場人員');
select is(public.fn_field_document_human_only_keys('daily_log'), '{}'::text[], '施工日誌無人填欄');
select is(public.fn_field_document_required_fields('supervisor_log', '{}'::jsonb, '[]'::jsonb),
  '["attendance","contractor_summary","log_date","supervision_items","weather_am","weather_pm"]'::jsonb,
  '監造日誌必填鍵由範本 required 推導(排序)');
select is(public.fn_field_document_required_fields('supervisor_log', '{"items":{"x":{}}}'::jsonb, '["notices"]'::jsonb),
  '["attendance","contractor_summary","log_date","notices","supervision_items","weather_am","weather_pm"]'::jsonb,
  'stored 聯集;監造日誌不推導工項數量鍵');
select is(public.fn_field_document_required_fields('daily_log', '{"items":{"e3000000-0000-0000-0000-000000000001":{}}}'::jsonb, '[]'::jsonb),
  '["equipment","items.e3000000-0000-0000-0000-000000000001.qty_today","labor","materials","weather_am","weather_pm","work_summary"]'::jsonb,
  '施工日誌必填鍵不變(回歸)');
select is(public.fn_field_document_unmet_fields('supervisor_log', '["attendance","weather_am"]'::jsonb,
    '{"attendance":{"status":"filled","source":"ai:photo"},"weather_am":{"status":"filled","source":"cwa"}}'::jsonb),
  '[{"key":"attendance","status":"needs_confirmation"}]'::jsonb,
  '人填欄標 filled 仍待確認(needs_confirmation);一般欄 filled 可簽');
select is(public.fn_field_document_unmet_fields('supervisor_log', '["attendance"]'::jsonb, '{"attendance":{"status":"confirmed"}}'::jsonb),
  '[]'::jsonb, '人填欄 confirmed 齊備');
select is(public.fn_field_document_unmet_fields('supervisor_log', '["attendance"]'::jsonb, '{"attendance":{"status":"na","reason":"本日未到場"}}'::jsonb),
  '[]'::jsonb, '人填欄 na＋reason 齊備(人宣告的不適用)');
select is(public.fn_field_document_unmet_fields('daily_log', '["attendance"]'::jsonb, '{"attendance":{"status":"filled"}}'::jsonb),
  '[]'::jsonb, '施工日誌沒有人填欄:filled 照舊可簽(回歸)');

-- ── 3. fixtures:A 案三方(監造兩人)＋B 案外人＋C 案非正式(廠商 admin) ─────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sl-supervisor@example.test', '', now(), '{}', '{"full_name":"監造工程師","org_type":"supervisor"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sl-supervisor2@example.test', '', now(), '{}', '{"full_name":"監造主任","org_type":"supervisor"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sl-contractor@example.test', '', now(), '{}', '{"full_name":"廠商工地主任","org_type":"contractor"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sl-owner@example.test', '', now(), '{}', '{"full_name":"機關承辦","org_type":"owner"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sl-outsider@example.test', '', now(), '{}', '{"full_name":"外案監造","org_type":"supervisor"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sl-admin@example.test', '', now(), '{}', '{"full_name":"Admin","org_type":"contractor"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sl-contractor-admin@example.test', '', now(), '{}', '{"full_name":"廠商主管(C 案 admin)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode) values
  ('e1000000-0000-0000-0000-00000000000a', '監造日誌測試案', '機關', '廠商', '監造', 'e0000000-0000-0000-0000-000000000006', true),
  ('e1000000-0000-0000-0000-00000000000b', '外案', '機關', '廠商', '監造', 'e0000000-0000-0000-0000-000000000006', true),
  ('e1000000-0000-0000-0000-00000000000c', '非正式案', '機關', '廠商', '監造', 'e0000000-0000-0000-0000-000000000006', false);
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 'member'),
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 'member'),
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000003', 'member'),
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000004', 'member'),
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000006', 'admin'),
  ('e1000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000005', 'member'),
  ('e1000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000006', 'admin'),
  ('e1000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-000000000007', 'admin');

insert into public.work_items (id, project_id, item_key, item_no, description, unit, quantity, unit_price, amount, is_leaf) values
  ('e3000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'WI-1', '壹.一.1', '結構混凝土', 'M3', 100, 3000, 300000, true),
  ('e3000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000b', 'WI-B', '壹.一.1', '外案工項', 'M3', 1, 1, 1, true);

-- 照片(service 插入:上傳方依 uploaded_by 的 profile 推得;p3 推不出=未知)
insert into public.photos (id, project_id, storage_path, uploaded_by) values
  ('e6000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a/misc/s1.jpg', 'e0000000-0000-0000-0000-000000000001'),
  ('e6000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a/misc/c1.jpg', 'e0000000-0000-0000-0000-000000000003'),
  ('e6000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a/misc/x.jpg', null);
select results_eq($$ select uploader_org from public.photos where project_id = 'e1000000-0000-0000-0000-00000000000a' order by id $$,
  $$ values ('supervisor'::text), ('contractor'::text), (null::text) $$, '照片上傳方:監造／廠商／未知');

-- 查驗、缺失(A 案與 B 案各一)
insert into public.inspections (id, project_id, work_item_id, title, status, requested_date, inspected_by, inspected_at) values
  ('e9000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-000000000001', '3F 鋼筋查驗', '合格', '2026-09-17', 'e0000000-0000-0000-0000-000000000001', '2026-09-17 02:00+00'),
  ('e9000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000b', 'e3000000-0000-0000-0000-000000000002', '外案查驗', '待查驗', '2026-09-17', null, null);
insert into public.defects (id, project_id, inspection_id, title, status) values
  ('ea000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', null, '3F 柱箍筋間距過大', '開立'),
  ('ea000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000b', null, '外案缺失', '開立');
select is(public.fn_project_ref_exists('e1000000-0000-0000-0000-00000000000a', 'inspection', 'e9000000-0000-0000-0000-000000000001'), true, '本案查驗引用存在');
select is(public.fn_project_ref_exists('e1000000-0000-0000-0000-00000000000a', 'inspection', 'e9000000-0000-0000-0000-000000000002'), false, '外案查驗不算本案引用');
select is(public.fn_project_ref_exists('e1000000-0000-0000-0000-00000000000a', 'weird', 'e9000000-0000-0000-0000-000000000001'), false, '未知引用類型=不存在');

-- 廠商施工日誌文件 DL1(草稿即可;收件情形引用只驗「本案的施工日誌文件」)
select pg_temp.become('e0000000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date)
  values ('e7000000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-17') $$,
  '廠商建立施工日誌草稿 DL1');
reset role;

-- ── 4. supervisor_logs 直接寫入:監造可、廠商／機關／非成員不可、成員可讀、每日唯一 ────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.supervisor_logs (id, project_id, log_date, note, created_by)
  values ('eb000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', '2026-09-10', '未簽署的手填列', 'e0000000-0000-0000-0000-000000000003') $$,
  '監造成員可直接建立(未簽署)監造日誌列');
select is((select created_by from public.supervisor_logs where id = 'eb000000-0000-0000-0000-000000000001'),
  'e0000000-0000-0000-0000-000000000001'::uuid, '建立者由伺服器蓋成登錄者(冒名無效)');
select throws_ok($$ insert into public.supervisor_logs (project_id, log_date)
  values ('e1000000-0000-0000-0000-00000000000a', '2026-09-10') $$,
  '23505', null, '每案每日唯一:同日第二列被擋');
select lives_ok($$ update public.supervisor_logs set note = '監造改' where id = 'eb000000-0000-0000-0000-000000000001' $$,
  '未簽署列監造可直接修改');
select throws_ok($$ update public.supervisor_logs set created_by = 'e0000000-0000-0000-0000-000000000002'
  where id = 'eb000000-0000-0000-0000-000000000001' $$,
  'P0001', null, '建立者不可變更');
select throws_ok($$ insert into public.supervisor_logs (project_id, log_date)
  values ('e1000000-0000-0000-0000-00000000000b', '2026-09-10') $$,
  '42501', null, '監造對非成員的 B 案不可寫(跨案)');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ insert into public.supervisor_logs (project_id, log_date)
  values ('e1000000-0000-0000-0000-00000000000a', '2026-09-11') $$,
  '42501', null, '廠商不可建立監造日誌列');
select lives_ok($$ update public.supervisor_logs set note = '廠商改' where id = 'eb000000-0000-0000-0000-000000000001' $$,
  '廠商 UPDATE 不報錯(RLS 過濾)…');
select is((select note from public.supervisor_logs where id = 'eb000000-0000-0000-0000-000000000001'), '監造改',
  '…但列未被改動(廠商不可寫)');
select lives_ok($$ delete from public.supervisor_logs where id = 'eb000000-0000-0000-0000-000000000001' $$, '廠商 DELETE 不報錯…');
select is((select count(*)::int from public.supervisor_logs where id = 'eb000000-0000-0000-0000-000000000001'), 1, '…但列仍在(廠商不可刪)');
select is((select count(*)::int from public.supervisor_logs where project_id = 'e1000000-0000-0000-0000-00000000000a'), 1,
  '廠商成員可讀監造日誌(Q4 暫行:專案成員可讀)');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ insert into public.supervisor_logs (project_id, log_date)
  values ('e1000000-0000-0000-0000-00000000000a', '2026-09-11') $$,
  '42501', null, '機關(正式模式唯讀)不可建立監造日誌列');
select is((select count(*)::int from public.supervisor_logs where project_id = 'e1000000-0000-0000-0000-00000000000a'), 1,
  '機關可讀監造日誌');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000005');
set local role authenticated;
select is((select count(*)::int from public.supervisor_logs), 0, '非成員讀不到任何監造日誌');
select throws_ok($$ insert into public.supervisor_logs (project_id, log_date)
  values ('e1000000-0000-0000-0000-00000000000a', '2026-09-11') $$,
  '42501', null, '非成員(外案監造)不可寫 A 案');
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.supervisor_logs $$, '42501', null, 'anon 無表級權限');
reset role;
-- 非正式案 admin_override:廠商身分的專案管理者可代寫(與其他事實表一致)
select pg_temp.become('e0000000-0000-0000-0000-000000000007');
set local role authenticated;
select lives_ok($$ insert into public.supervisor_logs (project_id, log_date)
  values ('e1000000-0000-0000-0000-00000000000c', '2026-09-10') $$,
  '非正式案的廠商 admin 可代建監造日誌列(admin_override)');
reset role;

-- ── 5. 到場欄不可由 AI／service 帶入:版本 guard ────────────────────────────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date)
  values ('e7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'supervisor_log', '2026-09-17') $$,
  '監造建立監造日誌草稿 D1(2026-09-17)');
reset role;
select pg_temp.become(null);
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values ('e7000000-0000-0000-0000-000000000001', 'ai', '{"attendance":[{"name":"監造工程師"}]}',
          '{"attendance":{"status":"pending"}}') $$,
  'P0001', null, 'AI 版本帶入到場人員內容 → 拒絕');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values ('e7000000-0000-0000-0000-000000000001', 'ai', '{"attendance":[]}', '{"attendance":{"status":"filled","source":"ai:photo"}}') $$,
  'P0001', null, 'AI 版本把到場標 filled → 拒絕(照片不能證明到場)');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values ('e7000000-0000-0000-0000-000000000001', 'ai', '{"attendance":[]}', '{"attendance":{"status":"confirmed"}}') $$,
  'P0001', null, 'AI／service 版本把到場標 confirmed → 拒絕');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values ('e7000000-0000-0000-0000-000000000001', 'ai', '{"attendance":[]}', '{"attendance":{"status":"na","reason":"本日未到場"}}') $$,
  'P0001', null, 'AI 版本把到場標不適用 → 拒絕(未到場也只能人宣告)');
select lives_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values ('e7000000-0000-0000-0000-000000000001', 'ai', '{"attendance":[],"weather_am":"晴"}',
          '{"attendance":{"status":"pending","reason":"到場只能人填"},"weather_am":{"status":"filled","source":"cwa"}}') $$,
  'AI 版本到場留空＋pending → 允許(v1)');
update public.field_documents set current_version_no = 1, status = 'pending_input' where id = 'e7000000-0000-0000-0000-000000000001';
select lives_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values ('e7000000-0000-0000-0000-000000000009', 'ai', '{"attendance":[{"name":"x"}]}', '{"attendance":{"status":"filled"}}') $$,
  '施工日誌沒有人填欄:AI 版本不受此規則影響(回歸)');
update public.field_documents set current_version_no = 1, status = 'pending_input' where id = 'e7000000-0000-0000-0000-000000000009';
-- AI 草稿指向 D1(簽署時處理)
insert into public.agent_actions (id, project_id, actor_user, agent_role, kind, target_table, target_id, summary, evidence) values
  ('e8000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 'supervisor',
   'draft_field_document', 'field_documents', 'e7000000-0000-0000-0000-000000000001', '監造日誌草稿 2026-09-17',
   '{"version_no":1,"doc_type":"supervisor_log"}');

-- ── 6. 存版與簽署:人填欄待確認、附件角色、aal2、越權、引用驗證 ─────────────────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000001', 'aal2');
set local role authenticated;
select is((select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 1,
    pg_temp.content_ok(), pg_temp.sources_ok() || '{"attendance":{"status":"filled","source":"ai:photo"}}'::jsonb, pg_temp.att_ok())
    -> 'recheck'),
  '[{"key":"attendance","status":"needs_confirmation"}]'::jsonb,
  'v2:到場只被標 filled → 存版 recheck 列 needs_confirmation(pending_input)');
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 2,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 2), '本人確認內容無誤並簽署') $$,
  'PD004', null, '到場未經人確認 → PD004');
select is((select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 2,
    pg_temp.content_ok(), pg_temp.sources_ok(), '[{"photo_id":"e6000000-0000-0000-0000-000000000002"}]'::jsonb) -> 'recheck'),
  '[{"key":"attachments.e6000000-0000-0000-0000-000000000002","status":"uploader_org:contractor"}]'::jsonb,
  'v3:廠商照片當監造證據 → 存版 recheck 列角色不符');
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 3,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 3), '本人確認內容無誤並簽署') $$,
  'PD005', null, '廠商照片冒充監造證據 → PD005');
select is((select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 3,
    pg_temp.content_ok(), pg_temp.sources_ok(), '[{"photo_id":"e6000000-0000-0000-0000-000000000003"}]'::jsonb) -> 'recheck'),
  '[{"key":"attachments.e6000000-0000-0000-0000-000000000003","status":"uploader_unknown"}]'::jsonb,
  'v4:上傳方未知的舊照片不能當證據');
select is((select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 4,
    pg_temp.content_ok(), pg_temp.sources_ok(), pg_temp.att_ok()) ->> 'status'),
  'draft', 'v5:到場 confirmed、監造照片證據、廠商照片 reference → draft(可簽)');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 5,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 5), '本人確認內容無誤並簽署') $$,
  'PD003', null, 'aal1 簽署 → PD003');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000003', 'aal2');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 5,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 5), '本人確認內容無誤並簽署') $$,
  'PD006', null, '廠商簽監造日誌 → PD006');
select throws_ok($$ select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 5, '{}'::jsonb) $$,
  'PD006', null, '廠商不能編輯監造日誌 → PD006');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000004', 'aal2');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 5,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 5), '本人確認內容無誤並簽署') $$,
  'PD006', null, '機關簽監造日誌 → PD006');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000005', 'aal2');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 5,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 5), '本人確認內容無誤並簽署') $$,
  'PD006', null, '非成員(外案監造)簽 A 案監造日誌 → PD006');
reset role;

-- 內容引用驗證(每次存新版本再簽 → PD010)
select pg_temp.become('e0000000-0000-0000-0000-000000000001', 'aal2');
set local role authenticated;
select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 5,
  jsonb_set(pg_temp.content_ok(), '{inspection_ids}', '["e9000000-0000-0000-0000-000000000002"]'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 6,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 6), '簽') $$,
  'PD010', null, '當日查驗引用外案查驗 → PD010');
select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 6,
  jsonb_set(pg_temp.content_ok(), '{supervision_items,0,work_item_id}', '"e3000000-0000-0000-0000-000000000002"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 7,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 7), '簽') $$,
  'PD010', null, '監造事項引用外案工項 → PD010');
select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 7,
  jsonb_set(pg_temp.content_ok(), '{attendance,0,user_id}', '"e0000000-0000-0000-0000-000000000003"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 8,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 8), '簽') $$,
  'PD010', null, '到場人員 user_id 是廠商成員 → PD010(到場只能是本案監造方)');
select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 8,
  jsonb_set(pg_temp.content_ok(), '{attendance}', '[]'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 9,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 9), '簽') $$,
  'PD010', null, '到場已確認但人員為空 → PD010(未到場請標不適用)');
select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 9,
  pg_temp.content_ok(), pg_temp.sources_ok() || '{"attendance":{"status":"na","reason":"本日未到場"}}'::jsonb, pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 10,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 10), '簽') $$,
  'PD010', null, '到場標不適用但內容仍有人員 → PD010');
select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 10,
  jsonb_set(pg_temp.content_ok(), '{notices,0,ref_id}', '"ea000000-0000-0000-0000-000000000002"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 11,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 11), '簽') $$,
  'PD010', null, '通知引用外案缺失 → PD010');
select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 11,
  jsonb_set(pg_temp.content_ok(), '{followups,0,status}', '"maybe"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 12,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 12), '簽') $$,
  'PD010', null, '追蹤狀態不合法 → PD010');
select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 12,
  jsonb_set(pg_temp.content_ok(), '{template,key}', '"agency_official_form"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 13,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 13), '簽') $$,
  'PD010', null, '範本鍵不是目前範本 → PD010(不能宣稱別的格式)');
select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 13,
  jsonb_set(pg_temp.content_ok(), '{daily_log_receipt,document_id}', '"e7000000-0000-0000-0000-000000000001"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 14,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 14), '簽') $$,
  'PD010', null, '收件情形引用的不是施工日誌文件 → PD010');
select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 14,
  jsonb_set(pg_temp.content_ok(), '{log_date}', '"2026-09-18"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 15,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 15), '簽') $$,
  'PD010', null, '內容日期與文件業務日期不符 → PD010');
select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 15,
  jsonb_set(pg_temp.content_ok(), '{attendance}', '"監造工程師"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 16,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 16), '簽') $$,
  'PD010', null, '到場不是陣列 → PD010');
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 15,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 15), '簽') $$,
  'PD001', null, '簽舊版本 → PD001');
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 16, repeat('f', 64), '簽') $$,
  'PD002', null, '雜湊不符 → PD002');
reset role;

-- ── 7. 簽署成功:事實列、綁定、簽署列、稽核、草稿處理、冪等 ───────────────────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000001', 'aal2');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.10","user-agent":"pgTAP/P3a"}', true);
set local role authenticated;
select is((select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 16,
    pg_temp.content_ok(), pg_temp.sources_ok(), pg_temp.att_ok(), '到場人員親自確認') ->> 'status'),
  'draft', 'v17:齊備 → draft');
select is((select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 17,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 17), '本人確認 2026-09-17 監造日誌內容無誤並簽署')
    - 'signature_id' - 'signed_at' - 'target_id' - 'content_hash'),
  '{"document_id":"e7000000-0000-0000-0000-000000000001","version_no":17,"signer_id":"e0000000-0000-0000-0000-000000000001",
    "status":"signed","target_table":"supervisor_logs","agent_actions_resolved":1,"idempotent":false}'::jsonb,
  '監造以 aal2 簽署 v17 成功:狀態 signed、事實表 supervisor_logs、處理 1 筆草稿');
select results_eq($$ select version_no, content_hash = pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 17), signer_org, signer_name_snapshot,
    method, aal, host(request_ip), user_agent from public.field_document_signatures
  where document_id = 'e7000000-0000-0000-0000-000000000001' $$,
  $$ values (17, true, 'supervisor'::text, '監造工程師'::text, 'platform_account_mfa'::text, 'aal2'::text, '203.0.113.10'::text, 'pgTAP/P3a'::text) $$,
  '簽署列:版本 17、雜湊=版本雜湊、簽署者資料／aal／IP／UA 由伺服器取');
select results_eq($$ select d.status, d.recheck, (d.target_id = l.id)
  from public.field_documents d join public.supervisor_logs l on l.project_id = d.project_id and l.log_date = d.doc_date
  where d.id = 'e7000000-0000-0000-0000-000000000001' $$,
  $$ values ('signed'::text, '[]'::jsonb, true) $$,
  '文件 signed、待補清空、target_id 綁定該日 supervisor_logs 列');
select results_eq($$ select weather_am, weather_pm, attendance, inspection_ids, jsonb_array_length(supervision_items), notices -> 0 ->> 'ref_type',
    followups -> 0 ->> 'status', contractor_summary, daily_log_receipt ->> 'document_id', template_key, template_version, created_by
  from public.supervisor_logs where project_id = 'e1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  $$ values ('晴'::text, '多雲'::text,
             '[{"user_id":"e0000000-0000-0000-0000-000000000001","name":"監造工程師","from":"08:30","to":"17:00"}]'::jsonb,
             array['e9000000-0000-0000-0000-000000000001']::uuid[], 1, 'defect'::text, 'open'::text,
             '3F 版牆鋼筋綁紮(依廠商施工日誌 v1)'::text, 'e7000000-0000-0000-0000-000000000009'::text,
             'supervisor_log_demo'::text, 1, 'e0000000-0000-0000-0000-000000000001'::uuid) $$,
  '事實表 supervisor_logs 以簽署版本內容落庫(到場、查驗、通知、追蹤、收件情形、示範範本鍵)');
select results_eq($$ select status, resolved_by from public.agent_actions where id = 'e8000000-0000-0000-0000-000000000001' $$,
  $$ values ('edited'::text, 'e0000000-0000-0000-0000-000000000001'::uuid) $$,
  '指向本文件的 AI 草稿標 edited(有人工版本),resolved_by=簽署者');
select is((select count(*)::int from public.audit_events
  where event_type = 'field_document.signed' and entity_id = 'e7000000-0000-0000-0000-000000000001'
    and metadata ->> 'doc_type' = 'supervisor_log' and metadata ->> 'aal' = 'aal2'), 1, '簽署留一筆 field_document.signed(supervisor_log, aal2)');
select is((select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 17,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 17), '再送一次') ->> 'idempotent'),
  'true', '同人同版本重試 → 冪等回原簽署');
select is((select count(*)::int from public.field_document_signatures where document_id = 'e7000000-0000-0000-0000-000000000001'), 1,
  '重試不新增簽署列');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000002', 'aal2');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 17,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 17), '我也簽') $$,
  'PD008', null, '同方另一位監造對已簽署版本再簽 → PD008');
reset role;

-- ── 8. 事實表 guard:已簽署列不可直接改刪;未簽署列照常;service／偽造 GUC 也不行 ────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ update public.supervisor_logs set note = '改寫'
  where project_id = 'e1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  'P0001', null, '已簽署監造日誌:直接 UPDATE 被擋');
select throws_ok($$ update public.supervisor_logs set attendance = '[]'::jsonb
  where project_id = 'e1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  'P0001', null, '已簽署監造日誌:到場欄不可事後改寫');
select throws_ok($$ delete from public.supervisor_logs
  where project_id = 'e1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  'P0001', null, '已簽署監造日誌:直接 DELETE 被擋');
select throws_ok($$ insert into public.supervisor_logs (project_id, log_date, note)
  values ('e1000000-0000-0000-0000-00000000000a', '2026-09-17', '舊路徑 upsert')
  on conflict (project_id, log_date) do update set note = excluded.note $$,
  'P0001', null, '已簽署監造日誌:upsert 被擋(不是靜默改寫)');
select lives_ok($$ update public.supervisor_logs set note = '未簽署列再改' where id = 'eb000000-0000-0000-0000-000000000001' $$,
  '未簽署列:直接 UPDATE 照常');
select lives_ok($$ delete from public.supervisor_logs where id = 'eb000000-0000-0000-0000-000000000001' $$,
  '未簽署列:直接 DELETE 照常');
reset role;
select pg_temp.become(null);
select throws_ok($$ update public.supervisor_logs set note = 'service 改寫'
  where project_id = 'e1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  'P0001', null, '已簽署監造日誌:service 路徑也不能直接改寫');
select set_config('pmis.field_document_sign', 'e7000000-0000-0000-0000-000000000009', true);
select throws_ok($$ update public.supervisor_logs set note = 'GUC 指向施工日誌文件'
  where project_id = 'e1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  'P0001', null, 'GUC 指向同日的施工日誌文件 → 不放行(放行只認同類同案同日)');
select set_config('pmis.field_document_sign', '', true);

-- ── 9. 簽後更正:新版本回草稿、事實列等重簽才更新 ─────────────────────────────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000001', 'aal2');
set local role authenticated;
select is((select public.save_field_document_version('e7000000-0000-0000-0000-000000000001', 17,
    jsonb_set(pg_temp.content_ok(), '{weather_pm}', '"陣雨"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok(), '更正下午天氣')
    - 'content_hash' - 'required_fields' - 'recheck'),
  '{"document_id":"e7000000-0000-0000-0000-000000000001","version_no":18,"status":"draft","amended_from_version":17}'::jsonb,
  '簽後更正:v18 amended_from_version=17,狀態回 draft');
select is((select weather_pm from public.supervisor_logs where project_id = 'e1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17'),
  '多雲', '更正尚未簽署:事實列仍是 v17 的簽署內容');
select throws_ok($$ update public.supervisor_logs set note = '草稿期直接改'
  where project_id = 'e1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  'P0001', null, '更正草稿期事實列仍受保護');
select is((select public.sign_field_document('e7000000-0000-0000-0000-000000000001', 18,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000001', 18), '本人確認更正後內容無誤並簽署') ->> 'status'),
  'signed', '重簽 v18 成功');
select is((select weather_pm from public.supervisor_logs where project_id = 'e1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17'),
  '陣雨', '重簽後事實列更新為 v18 內容');
select results_eq($$ select version_no from public.field_document_signatures where document_id = 'e7000000-0000-0000-0000-000000000001' order by version_no $$,
  $$ values (17), (18) $$, '簽署列 v17、v18 各一筆');
-- 提送給機關(對象矩陣:監造日誌 監造→機關),機關收件
select is((select public.submit_field_document('e7000000-0000-0000-0000-000000000001', 18, 'owner', 'sl-req-1') ->> 'status'),
  'submitted', '監造提送監造日誌給機關');
select throws_ok($$ select public.submit_field_document('e7000000-0000-0000-0000-000000000001', 18, 'contractor', 'sl-req-2') $$,
  'PD010', null, '監造日誌不可提送給廠商(對象矩陣)');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000004', 'aal2');
set local role authenticated;
select is((select public.receive_field_document('e7000000-0000-0000-0000-000000000001', 18, 'sl-rr-1') ->> 'status'),
  'received', '機關(正式模式唯讀)仍可收件監造日誌');
reset role;

-- ── 10. 收件後 superseded 另立新件:新文件簽署接手同一事實列 ───────────────────────────
select pg_temp.become(null);
update public.field_documents set status = 'superseded' where id = 'e7000000-0000-0000-0000-000000000001';
select pg_temp.become('e0000000-0000-0000-0000-000000000001', 'aal2');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date)
  values ('e7000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', 'supervisor_log', '2026-09-17') $$,
  '同日可再立新監造日誌文件 D2');
select public.save_field_document_version('e7000000-0000-0000-0000-000000000002', 0,
  jsonb_set(pg_temp.content_ok(), '{note}', '"D2 接手"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select is((select public.sign_field_document('e7000000-0000-0000-0000-000000000002', 1,
    pg_temp.hash_of('e7000000-0000-0000-0000-000000000002', 1), '本人確認內容無誤並簽署') ->> 'status'),
  'signed', 'D2 簽署成功(接手同一事實列)');
select is((select target_id from public.field_documents where id = 'e7000000-0000-0000-0000-000000000002'),
  (select target_id from public.field_documents where id = 'e7000000-0000-0000-0000-000000000001'),
  'D2 與 superseded 的 D1 綁同一 supervisor_logs 列');
select is((select note from public.supervisor_logs where project_id = 'e1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17'),
  'D2 接手', '事實列更新為 D2 簽署內容');
reset role;

-- ── 11. 專案刪除 cascade 通過 guard ────────────────────────────────────────────────
select pg_temp.become(null);
select lives_ok($$ delete from public.projects where id = 'e1000000-0000-0000-0000-00000000000a' $$,
  '專案刪除 cascade 可通過已簽署監造日誌的事實表 guard');
select is((select count(*)::int from public.supervisor_logs where project_id = 'e1000000-0000-0000-0000-00000000000a'), 0, 'cascade 後監造日誌清空');

select * from finish();
rollback;
