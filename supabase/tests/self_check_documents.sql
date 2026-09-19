-- P3b 自主檢查表文件 pgTAP:示範框架範本、由本案檢查表範本推導必填／人填／須確認欄、判定引擎(與前端同案例)、
-- 使用者路徑 INSERT 伺服器重算判定＋不合格自動開缺失、AI 版本不得帶入實測值、sign_field_document 的 self_check 分支
-- (必填逐項確認、附件角色、越權、跨案、值型別、修訂鏈 Rev.N 與更正原因、已綁定紀錄不可刪)、提送對象矩陣、專案刪除 cascade。
-- 對應 migration 20260919141500_self_check_documents.sql;設計 docs/architecture/field-documents-lifecycle.md §2.2、§3.4、§5。
-- 既有自檢直接寫入路徑的回歸在 checklist_revisions.sql／inspection_checklist_link.sql(同一支 guard)。
begin;

select plan(127);

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else jsonb_build_object('sub', u::text, 'role', 'authenticated', 'aal', 'aal1')::text end, true);
end $$;
select pg_temp.become(null);

create or replace function pg_temp.hash_of(d uuid, v int) returns text language sql as $$
  select content_hash from public.field_document_versions where document_id = d and version_no = v;
$$;
-- 範本 T1:B1 勾選、C2 坍度 15.5–20.5、C3 上下層間隔 ≤45
create or replace function pg_temp.items_t1() returns jsonb language sql as $$
  select '[{"no":"B1","group":"澆置前","item":"澆置 24 小時前已通知監造","kind":"bool","standard":"≥24 小時前通知"},
           {"no":"C2","group":"澆置中","item":"坍度","kind":"num","min":15.5,"max":20.5,"unit":"cm","standard":"18±2.5"},
           {"no":"C3","group":"澆置中","item":"上下層澆置間隔","kind":"num","max":45,"unit":"分","standard":"≤45 分鐘"}]'::jsonb;
$$;
-- 一份齊備的自檢表內容(範本 T1、工項 WI-1、三項皆由人填並確認)
create or replace function pg_temp.content_ok() returns jsonb language sql as $$
  select '{"check_date":"2026-09-17","template_id":"f4000000-0000-0000-0000-000000000001","template_title":"混凝土自主檢查表",
           "work_item_id":"f3000000-0000-0000-0000-000000000001","location":"3F 版牆",
           "results":{"B1":{"value":true},"C2":{"value":18},"C3":{"value":40}},
           "note":null,"template":{"key":"self_check_demo","version":1}}'::jsonb;
$$;
create or replace function pg_temp.sources_ok() returns jsonb language sql as $$
  select '{"check_date":{"status":"filled","source":"intake"},
           "template_id":{"status":"filled","source":"system:template_match"},
           "work_item_id":{"status":"filled","source":"ai:photo"},
           "location":{"status":"filled","source":"ai:photo"},
           "results.B1":{"status":"confirmed","source":"human"},
           "results.C2":{"status":"confirmed","source":"human"},
           "results.C3":{"status":"confirmed","source":"human"}}'::jsonb;
$$;
create or replace function pg_temp.att_ok() returns jsonb language sql as $$
  select '[{"photo_id":"f6000000-0000-0000-0000-000000000001"}]'::jsonb;
$$;

-- ── 1. 結構、函式、trigger、執行權限 ────────────────────────────────────────────────
select has_function('public', 'fn_checklist_judge', array['jsonb','jsonb'], '判定引擎存在');
select has_function('public', 'fn_field_document_checklist_items', array['jsonb'], '本案範本項目讀取函式存在');
select has_function('public', 'fn_field_document_self_check_item_keys', array['jsonb','text'], '自檢表項目鍵推導函式存在');
select has_function('public', 'fn_field_document_confirm_required_keys', array['text','jsonb'], '須確認欄推導函式存在');
select has_function('public', 'fn_field_document_human_only_keys', array['text','jsonb'], '人填欄推導改為 (doc_type, content)');
select hasnt_function('public', 'fn_field_document_human_only_keys', array['text'], '單參數人填欄推導已移除');
select has_function('public', 'fn_field_document_unmet_fields', array['text','jsonb','jsonb','jsonb'], '待補判定改為四參數');
select hasnt_function('public', 'fn_field_document_unmet_fields', array['text','jsonb','jsonb'], '三參數待補判定已移除');
select has_function('public', 'field_document_sign_self_check_internal', array['field_documents','field_document_versions','uuid'], 'self_check 簽署分支內部函式存在');
select has_function('public', 'checklist_records_defect_sync', '{}'::text[], '不合格自動開缺失 trigger 函式存在');
select has_trigger('public', 'checklist_records', 'checklist_records_defect_sync', '自動開缺失 trigger 掛上');
select has_trigger('public', 'checklist_records', 'checklist_records_guard', '既有 guard 仍掛著');
select is(has_function_privilege('authenticated', 'public.fn_field_document_template(text)', 'execute'), true, 'authenticated 可取範本');
select is(has_function_privilege('anon', 'public.fn_field_document_template(text)', 'execute'), false, 'anon 不可取範本');
select is(has_function_privilege('authenticated', 'public.fn_checklist_judge(jsonb,jsonb)', 'execute'), false, '判定引擎不開給 authenticated(只在 guard／RPC 內)');
select is(has_function_privilege('authenticated', 'public.field_document_sign_self_check_internal(field_documents,field_document_versions,uuid)', 'execute'), false, '簽署分支內部函式不開給 authenticated');
select is(has_function_privilege('authenticated', 'public.fn_field_document_confirm_required_keys(text,jsonb)', 'execute'), false, '須確認欄推導不開給 authenticated');
select is(has_function_privilege('authenticated', 'public.checklist_records_defect_sync()', 'execute'), false, 'trigger 函式不開給 authenticated');

-- ── 2. 示範框架範本 ───────────────────────────────────────────────────────────────
select is((select t ->> 'key' || '/' || (t ->> 'version') || '/' || (t ->> 'is_demo') || '/' || (t ->> 'demo_label')
           from public.fn_field_document_template('self_check') t),
  'self_check_demo/1/true/示範範本', '自檢表框架範本=示範範本(is_demo、demo_label 供介面／列印標示)');
select ok((select t ->> 'disclaimer' from public.fn_field_document_template('self_check') t) like '%非任何機關公定或法定格式%',
  '框架範本附免責聲明:非機關公定或法定格式');
select is((select jsonb_array_length(t -> 'sections') from public.fn_field_document_template('self_check') t), 3, '框架範本三節');
select is((select f -> 'item_rules' from public.fn_field_document_template('self_check') t,
             jsonb_array_elements(t -> 'sections') s, jsonb_array_elements(s -> 'fields') f where f ->> 'key' = 'results'),
  '{"num":{"human_only":true,"confirm_required":true},"bool":{"human_only":false,"confirm_required":true}}'::jsonb,
  '項目規則:實測值只能人填且須確認;勾選項可由系統建議但須人確認');
select is((select t ->> 'key' from public.fn_field_document_template('supervisor_log') t), 'supervisor_log_demo', '監造日誌範本不變(回歸)');
select is(public.fn_field_document_template('daily_log'), null, '施工日誌仍無範本');
select is(public.fn_field_document_template_required_keys('self_check'), array['check_date','template_id'], '框架必填=檢查日期、範本');

-- ── 3. 判定引擎:與前端 judgeChecklist 同一組案例 ────────────────────────────────────
create or replace function pg_temp.j(items jsonb, r jsonb) returns jsonb language sql as $$ select public.fn_checklist_judge(items, r); $$;
create or replace function pg_temp.num_item() returns jsonb language sql as $$ select '[{"no":"C1","item":"澆置溫度","kind":"num","min":13,"max":32}]'::jsonb; $$;
select is(pg_temp.j(pg_temp.num_item(), '{"C1":{"value":25}}') -> 'results' -> 'C1' -> 'pass', 'true'::jsonb, 'num 範圍內合格');
select is(pg_temp.j(pg_temp.num_item(), '{"C1":{"value":12.9}}') -> 'results' -> 'C1' -> 'pass', 'false'::jsonb, 'num 低於 min 不合格');
select is(pg_temp.j(pg_temp.num_item(), '{"C1":{"value":33}}') -> 'results' -> 'C1' -> 'pass', 'false'::jsonb, 'num 高於 max 不合格');
select is(pg_temp.j('[{"no":"C5","kind":"num","min":7000}]', '{"C5":{"value":7000}}') -> 'results' -> 'C5' -> 'pass', 'true'::jsonb, '只有 min:等於 min 合格');
select is(pg_temp.j('[{"no":"C5","kind":"num","min":7000}]', '{"C5":{"value":6999}}') -> 'results' -> 'C5' -> 'pass', 'false'::jsonb, '只有 min:低於不合格');
select is(pg_temp.j('[{"no":"C4","kind":"num","max":45}]', '{"C4":{"value":45}}') -> 'results' -> 'C4' -> 'pass', 'true'::jsonb, '只有 max:等於 max 合格');
select is(pg_temp.j('[{"no":"C4","kind":"num","max":45}]', '{"C4":{"value":46}}') -> 'results' -> 'C4' -> 'pass', 'false'::jsonb, '只有 max:高於不合格');
select is(pg_temp.j(pg_temp.num_item(), '{"C1":{"value":""}}') -> 'results' -> 'C1', '{"value":"","pass":null}'::jsonb, 'num 空字串=未檢(值保留)');
select is(pg_temp.j(pg_temp.num_item(), '{"C1":{"value":null}}') -> 'results' -> 'C1', '{"value":null,"pass":null}'::jsonb, 'num null=未檢');
select is(pg_temp.j(pg_temp.num_item(), '{}') -> 'results' -> 'C1', '{"value":null,"pass":null}'::jsonb, 'num 缺鍵=未檢(範本每項都有結果列)');
select is(pg_temp.j(pg_temp.num_item(), '{"C1":{"value":"25"}}') -> 'results' -> 'C1' -> 'pass', 'true'::jsonb, 'num 可轉數字的字串照數值判(與前端 Number 相同)');
select is(pg_temp.j(pg_temp.num_item(), '{"C1":{"value":"abc"}}') -> 'results' -> 'C1' -> 'pass', 'null'::jsonb, 'num 非數字字串=未檢');
select is(pg_temp.j('[{"no":"B1","kind":"bool"}]', '{"B1":{"value":true}}') -> 'results' -> 'B1' -> 'pass', 'true'::jsonb, 'bool 勾=合格');
select is(pg_temp.j('[{"no":"B1","kind":"bool"}]', '{"B1":{"value":false}}') -> 'results' -> 'B1' -> 'pass', 'false'::jsonb, 'bool 明確否=不合格');
select is(pg_temp.j('[{"no":"B1","kind":"bool"}]', '{"B1":{"value":1}}') -> 'results' -> 'B1' -> 'pass', 'null'::jsonb, 'bool 非布林=未檢');
select is(pg_temp.j('[{"no":"C1","kind":"num","min":13,"max":32},{"no":"C5","kind":"num","min":7000},{"no":"B1","kind":"bool"}]',
    '{"C1":{"value":20},"C5":{"value":7500},"B1":{"value":true}}') ->> 'overall', '合格', '全部合格 → 合格');
select is(pg_temp.j('[{"no":"C1","kind":"num","min":13,"max":32},{"no":"C5","kind":"num","min":7000},{"no":"B1","kind":"bool"}]',
    '{"C1":{"value":35},"C5":{"value":7500},"B1":{"value":true}}') - 'results', '{"overall":"不合格","failed":["C1"]}'::jsonb, '任一不合格 → 不合格,failed 列出該項');
select is(pg_temp.j('[{"no":"C1","kind":"num","min":13,"max":32},{"no":"C5","kind":"num","min":7000},{"no":"B1","kind":"bool"}]',
    '{"C1":{"value":20}}') ->> 'overall', '合格', '部分未檢不影響判定');
select is(pg_temp.j('[{"no":"C1","kind":"num","min":13,"max":32}]', '{}') ->> 'overall', null, '全未檢 overall=null');
select is(pg_temp.j(pg_temp.num_item(), '{"C1":{"value":20},"Z9":{"value":1}}') -> 'results' ? 'Z9', false, '範本外的鍵丟掉(與前端相同)');
select is(pg_temp.j(pg_temp.num_item(), '{"C1":20}') -> 'results' -> 'C1' -> 'pass', 'true'::jsonb, '值直接放在項次下也接受');

-- ── 4. fixtures:A 案三方(廠商兩人)＋B 案外人＋C 案非正式 ────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sc-contractor@example.test', '', now(), '{}', '{"full_name":"廠商工地主任","org_type":"contractor"}', now(), now()),
  ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sc-contractor2@example.test', '', now(), '{}', '{"full_name":"廠商品管","org_type":"contractor"}', now(), now()),
  ('f0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sc-supervisor@example.test', '', now(), '{}', '{"full_name":"監造工程師","org_type":"supervisor"}', now(), now()),
  ('f0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sc-owner@example.test', '', now(), '{}', '{"full_name":"機關承辦","org_type":"owner"}', now(), now()),
  ('f0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sc-outsider@example.test', '', now(), '{}', '{"full_name":"外案廠商","org_type":"contractor"}', now(), now()),
  ('f0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sc-admin@example.test', '', now(), '{}', '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode) values
  ('f1000000-0000-0000-0000-00000000000a', '自檢表測試案', '機關', '廠商', '監造', 'f0000000-0000-0000-0000-000000000006', true),
  ('f1000000-0000-0000-0000-00000000000b', '外案', '機關', '廠商', '監造', 'f0000000-0000-0000-0000-000000000006', true);
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'member'),
  ('f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002', 'member'),
  ('f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000003', 'member'),
  ('f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000004', 'member'),
  ('f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000006', 'admin'),
  ('f1000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-000000000005', 'member'),
  ('f1000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-000000000006', 'admin');

insert into public.work_items (id, project_id, item_key, item_no, description, unit, quantity, unit_price, amount, is_leaf) values
  ('f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-00000000000a', 'WI-1', '壹.一.1', '結構混凝土', 'M3', 100, 3000, 300000, true),
  ('f3000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-00000000000b', 'WI-B', '壹.一.1', '外案工項', 'M3', 1, 1, 1, true);

insert into public.checklist_templates (id, project_id, title, source, items) values
  ('f4000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-00000000000a', '混凝土自主檢查表', '03310', pg_temp.items_t1()),
  ('f4000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-00000000000a', '空範本', '—', '[]'),
  ('f4000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-00000000000b', '外案範本', '03310', pg_temp.items_t1());

-- 照片(service 插入:上傳方依 uploaded_by 的 profile 推得;p3 推不出=未知)
insert into public.photos (id, project_id, storage_path, uploaded_by) values
  ('f6000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a/misc/c1.jpg', 'f0000000-0000-0000-0000-000000000001'),
  ('f6000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a/misc/s1.jpg', 'f0000000-0000-0000-0000-000000000003'),
  ('f6000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a/misc/x.jpg', null);

-- ── 5. 由本案範本推導:必填、人填、須確認 ─────────────────────────────────────────────
select is(public.fn_field_document_required_fields('self_check', pg_temp.content_ok(), '["results.Z9","note"]'::jsonb),
  '["check_date","note","results.B1","results.C2","results.C3","template_id"]'::jsonb,
  '必填鍵=stored(範本項目鍵一律由內容重算,Z9 丟掉)∪ 框架 required ∪ 範本每項 results.<no>');
select is(public.fn_field_document_human_only_keys('self_check', pg_temp.content_ok()), array['results.C2','results.C3'],
  '人填欄=實測值項目(num);勾選項不在內');
select is(public.fn_field_document_confirm_required_keys('self_check', pg_temp.content_ok()), array['results.B1','results.C2','results.C3'],
  '須確認欄=全部項目(勾選項的系統建議也要人逐項確認)');
select is(public.fn_field_document_confirm_required_keys('supervisor_log', null), array['attendance'], '監造日誌須確認欄=到場(human_only 蘊含)');
select is(public.fn_field_document_human_only_keys('self_check', jsonb_set(pg_temp.content_ok(), '{template_id}', '"f4000000-0000-0000-0000-000000000002"'::jsonb)),
  '{}'::text[], '空範本:沒有項目鍵');
select is(public.fn_field_document_required_fields('self_check', jsonb_set(pg_temp.content_ok(), '{template_id}', '"not-a-uuid"'::jsonb), '[]'::jsonb),
  '["check_date","template_id"]'::jsonb, 'template_id 不合法:只有框架必填,不猜項目');
select is(public.fn_field_document_unmet_fields('self_check', '["results.B1","results.C2","location"]'::jsonb,
    '{"results.B1":{"status":"filled","source":"ai:photo","reason":"照片可見通知單"},"results.C2":{"status":"filled","source":"legacy:x"},"location":{"status":"filled","source":"ai:photo"}}'::jsonb,
    pg_temp.content_ok()),
  '[{"key":"results.B1","status":"needs_confirmation"},{"key":"results.C2","status":"needs_confirmation"}]'::jsonb,
  '項目只被標 filled(系統建議／既有紀錄)→ 待確認;位置 filled 可簽');
select is(public.fn_field_document_unmet_fields('self_check', '["results.B1","results.C2"]'::jsonb,
    '{"results.B1":{"status":"confirmed","source":"human"},"results.C2":{"status":"na","reason":"本次未量測坍度"}}'::jsonb, pg_temp.content_ok()),
  '[]'::jsonb, '項目 confirmed 或 na＋reason 齊備');
select is(public.fn_field_document_unmet_fields('supervisor_log', '["attendance","weather_am"]'::jsonb,
    '{"attendance":{"status":"filled","source":"human"},"weather_am":{"status":"filled","source":"cwa"}}'::jsonb, null),
  '[{"key":"attendance","status":"needs_confirmation"}]'::jsonb, '監造日誌:到場 filled 待確認、天氣 filled 可簽(回歸)');

-- ── 6. 使用者路徑(簽署交易內)伺服器重算判定、不合格自動開缺失;service 路徑不重算 ────────────────────
-- P6b-3:直接登錄退場(authenticated 無 INSERT、guard 只放行自檢表簽署交易)。guard 的判定重算／開缺失以同案自檢表文件的
-- 交易 GUC 模擬簽署路徑(superuser＋廠商 claims);簽署 RPC 端到端見 §9 起
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ insert into public.checklist_records (project_id, template_id, check_date, results)
  values ('f1000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-000000000001', '2026-09-10', '{}') $$,
  '42501', null, '廠商直接寫入(舊路徑)已退場:表級 INSERT 收回');
reset role;
insert into public.field_documents (id, project_id, doc_type, doc_date) values
  ('f6f00000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-00000000000a', 'self_check', '2026-09-10');
select set_config('pmis.field_document_sign', 'f6f00000-0000-0000-0000-000000000001', true);
select lives_ok($$ insert into public.checklist_records (id, project_id, template_id, check_date, location, results, overall)
  values ('f5000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-000000000001',
          '2026-09-10', '2F 版牆', '{"C2":{"value":30,"pass":true},"B1":{"value":true,"pass":true}}', '合格') $$,
  '簽署交易內寫入事實列(guard 放行)');
select set_config('pmis.field_document_sign', '', true);
select results_eq($$ select overall, results -> 'C2' -> 'pass', results -> 'C3' -> 'pass', results -> 'B1' -> 'value' from public.checklist_records where id = 'f5000000-0000-0000-0000-000000000001' $$,
  $$ values ('不合格'::text, 'false'::jsonb, 'null'::jsonb, 'true'::jsonb) $$,
  '判定由伺服器依範本重算:客戶端送的 pass／overall 作廢(30cm 超規)、未給的項目=未檢');
select results_eq($$ select title, status, location, source_checklist_record_id from public.defects where project_id = 'f1000000-0000-0000-0000-00000000000a' $$,
  $$ values ('自主檢查不合格：混凝土自主檢查表'::text, '開立'::text, '2F 版牆'::text, 'f5000000-0000-0000-0000-000000000001'::uuid) $$,
  '不合格 → 同交易自動開缺失(掛鏈根)');
select ok((select description from public.defects where source_checklist_record_id = 'f5000000-0000-0000-0000-000000000001') like '不合格項目：C2 坍度（標準 18±2.5）%',
  '缺失說明列出不合格項目與標準');
select pg_temp.become(null);
select lives_ok($$ insert into public.checklist_records (id, project_id, template_id, check_date, results, overall)
  values ('f5000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-000000000001',
          '2026-09-01', '{"C2":{"value":30,"pass":true}}', '合格') $$, 'service 路徑(還原)照原值保存…');
select is((select overall from public.checklist_records where id = 'f5000000-0000-0000-0000-000000000002'), '合格', '…不重算(範本日後修改不得改判歷史證據)…');
select is((select count(*)::int from public.defects where project_id = 'f1000000-0000-0000-0000-00000000000a'), 1, '…也不自動開缺失');

-- ── 7. 文件與 AI 版本:實測值不可由 AI 帶入;勾選項可建議但只能 filled ───────────────────────
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date, template_id)
  values ('f7000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-00000000000a', 'self_check', '2026-09-17', 'f4000000-0000-0000-0000-000000000001') $$,
  '廠商建立自檢表草稿 D1(帶本案範本)');
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date, template_id)
  values ('f1000000-0000-0000-0000-00000000000a', 'self_check', '2026-09-17', 'f4000000-0000-0000-0000-000000000003') $$,
  'P0001', null, '文件掛別案範本 → 拒絕(P2a guard)');
reset role;
select pg_temp.become('f0000000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date)
  values ('f1000000-0000-0000-0000-00000000000a', 'self_check', '2026-09-17') $$,
  '42501', null, '監造不能建立自檢表文件(責任方=廠商)');
reset role;
select pg_temp.become(null);
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values ('f7000000-0000-0000-0000-000000000001', 'ai',
          jsonb_set(pg_temp.content_ok(), '{results}', '{"C2":{"value":18}}'::jsonb), '{"results.C2":{"status":"pending"}}') $$,
  'P0001', null, 'AI 版本帶入實測值 → 拒絕(實測值只能人量測)');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values ('f7000000-0000-0000-0000-000000000001', 'ai',
          jsonb_set(pg_temp.content_ok(), '{results}', '{"C2":{"value":null}}'::jsonb), '{"results.C2":{"status":"filled","source":"whiteboard:x"}}') $$,
  'P0001', null, 'AI 版本把實測值標 filled → 拒絕(告示板讀數只能當提示)');
select lives_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values ('f7000000-0000-0000-0000-000000000001', 'ai',
          jsonb_set(pg_temp.content_ok(), '{results}', '{"B1":{"value":true},"C2":{"value":null},"C3":{"value":null}}'::jsonb),
          '{"results.B1":{"status":"filled","source":"ai:photo","reason":"照片可見通知單"},
            "results.C2":{"status":"pending","reason":"實測值由人親自量測填寫","hint":{"value":18,"source":"whiteboard:p1"}},
            "results.C3":{"status":"pending"}}') $$,
  'AI 版本:勾選項附依據建議、實測值留空 pending(讀數放 hint)→ 允許(v1)');
update public.field_documents set current_version_no = 1, status = 'pending_input' where id = 'f7000000-0000-0000-0000-000000000001';
insert into public.agent_actions (id, project_id, actor_user, agent_role, kind, target_table, target_id, summary, evidence) values
  ('f8000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'contractor',
   'draft_field_document', 'field_documents', 'f7000000-0000-0000-0000-000000000001', '自檢表草稿', '{"version_no":1,"doc_type":"self_check"}');

-- ── 8. 存版與簽署:範本本案、逐項確認、附件角色、越權 ─────────────────────────────────────
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 1,
    jsonb_set(pg_temp.content_ok(), '{template_id}', '"f4000000-0000-0000-0000-000000000003"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok()) $$,
  'PD010', null, '存版:內容指定別案範本 → PD010');
select is((select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 1,
    pg_temp.content_ok(), pg_temp.sources_ok() || '{"results.B1":{"status":"filled","source":"ai:photo","reason":"照片可見通知單"}}'::jsonb, pg_temp.att_ok())
    -> 'recheck'),
  '[{"key":"results.B1","status":"needs_confirmation"}]'::jsonb,
  'v2:勾選項只被系統建議 → 存版 recheck 列 needs_confirmation(pending_input)');
select is((select template_id from public.field_documents where id = 'f7000000-0000-0000-0000-000000000001'),
  'f4000000-0000-0000-0000-000000000001'::uuid, '存版同步文件的範本欄');
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 2,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 2), '簽') $$,
  'PD004', null, '勾選項未經人確認 → PD004');
select is((select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 2,
    pg_temp.content_ok(), pg_temp.sources_ok() || '{"results.C2":{"status":"pending"}}'::jsonb, pg_temp.att_ok()) ->> 'status'),
  'pending_input', 'v3:實測值待補 → pending_input');
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 3,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 3), '簽') $$,
  'PD004', null, '實測值未填 → PD004(數值欄永遠要人填)');
select is((select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 3,
    pg_temp.content_ok(), pg_temp.sources_ok(), '[{"photo_id":"f6000000-0000-0000-0000-000000000002"}]'::jsonb) -> 'recheck'),
  '[{"key":"attachments.f6000000-0000-0000-0000-000000000002","status":"uploader_org:supervisor"}]'::jsonb,
  'v4:監造照片當施作證據 → 存版 recheck 列角色不符');
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 4,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 4), '簽') $$,
  'PD005', null, '監造照片冒充施作證據 → PD005');
select is((select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 4,
    pg_temp.content_ok(), pg_temp.sources_ok(), '[{"photo_id":"f6000000-0000-0000-0000-000000000003"}]'::jsonb) -> 'recheck'),
  '[{"key":"attachments.f6000000-0000-0000-0000-000000000003","status":"uploader_unknown"}]'::jsonb,
  'v5:上傳方未知的舊照片不能當證據');
select is((select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 5,
    pg_temp.content_ok(), pg_temp.sources_ok(), pg_temp.att_ok()) ->> 'status'),
  'draft', 'v6:三項皆已確認、廠商照片證據 → draft(可簽)');
reset role;
select pg_temp.become('f0000000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 6,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 6), '簽') $$,
  'PD006', null, '監造簽自檢表 → PD006(廠商簽、監造不可簽)');
select throws_ok($$ select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 6, '{}'::jsonb) $$,
  'PD006', null, '監造不能編輯自檢表 → PD006');
reset role;
select pg_temp.become('f0000000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 6,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 6), '簽') $$,
  'PD006', null, '機關簽自檢表 → PD006');
reset role;
select pg_temp.become('f0000000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 6,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 6), '簽') $$,
  'PD006', null, '非成員(外案廠商)簽 A 案自檢表 → PD006(跨案)');
reset role;

-- 內容驗證(每次存新版本再簽 → PD010)
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
set local role authenticated;
select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 6,
  jsonb_set(pg_temp.content_ok(), '{results,Z9}', '{"value":true}'::jsonb), pg_temp.sources_ok() || '{"results.Z9":{"status":"confirmed"}}'::jsonb, pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 7,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 7), '簽') $$,
  'PD010', null, '項次不在範本內 → PD010');
select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 7,
  jsonb_set(pg_temp.content_ok(), '{results,C2,value}', '"18"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 8,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 8), '簽') $$,
  'PD010', null, '實測值不是數字 → PD010');
select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 8,
  jsonb_set(pg_temp.content_ok(), '{results,B1,value}', '1'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 9,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 9), '簽') $$,
  'PD010', null, '勾選項不是布林 → PD010');
select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 9,
  jsonb_set(pg_temp.content_ok(), '{results,C3,value}', 'null'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 10,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 10), '簽') $$,
  'PD010', null, '已確認但沒有值 → PD010(未檢請標不適用)');
select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 10,
  pg_temp.content_ok(), pg_temp.sources_ok() || '{"results.C3":{"status":"na","reason":"本次未量測"}}'::jsonb, pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 11,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 11), '簽') $$,
  'PD010', null, '標不適用但仍有值 → PD010');
select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 11,
  jsonb_set(pg_temp.content_ok(), '{check_date}', '"2026-09-18"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 12,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 12), '簽') $$,
  'PD010', null, '檢查日期與文件業務日期不符 → PD010');
select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 12,
  jsonb_set(pg_temp.content_ok(), '{work_item_id}', '"f3000000-0000-0000-0000-000000000002"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 13,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 13), '簽') $$,
  'PD010', null, '對應工項是外案工項 → PD010');
select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 13,
  jsonb_set(pg_temp.content_ok(), '{template,key}', '"agency_official_form"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 14,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 14), '簽') $$,
  'PD010', null, '框架範本鍵不是目前範本 → PD010(不能宣稱別的格式)');
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 13,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 13), '簽') $$,
  'PD001', null, '簽舊版本 → PD001');
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 14, repeat('f', 64), '簽') $$,
  'PD002', null, '雜湊不符 → PD002');
-- 空範本:存版可過(沒有項目=沒有項目必填),簽署擋
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date)
  values ('f7000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-00000000000a', 'self_check', '2026-09-17') $$,
  '同日可再建第二份自檢表文件 D2(自檢表不受每日唯一限制)');
select is((select public.save_field_document_version('f7000000-0000-0000-0000-000000000002', 0,
    jsonb_set(pg_temp.content_ok() - 'work_item_id', '{template_id}', '"f4000000-0000-0000-0000-000000000002"'::jsonb) || '{"results":{}}'::jsonb,
    '{"check_date":{"status":"confirmed"},"template_id":{"status":"confirmed"}}'::jsonb) ->> 'status'),
  'draft', 'D2 v1:空範本沒有項目必填 → draft');
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000002', 1,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000002', 1), '簽') $$,
  'PD010', null, '範本沒有任何檢查項目 → 不可簽署');
reset role;

-- ── 9. 簽署成功:checklist_records Rev.0、判定由 DB 算、綁定、簽署列、稽核、草稿處理、冪等 ──────────
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.11","user-agent":"pgTAP/P3b"}', true);
set local role authenticated;
select is((select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 14,
    pg_temp.content_ok(), pg_temp.sources_ok(), pg_temp.att_ok(), '實測值已親自量測') ->> 'status'),
  'draft', 'v15:齊備 → draft');
select is((select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 15,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 15), '本人確認 2026-09-17 自主檢查表內容屬實並簽署')
    - 'signature_id' - 'signed_at' - 'target_id' - 'content_hash'),
  '{"document_id":"f7000000-0000-0000-0000-000000000001","version_no":15,"signer_id":"f0000000-0000-0000-0000-000000000001",
    "status":"signed","target_table":"checklist_records","agent_actions_resolved":1,"idempotent":false}'::jsonb,
  '廠商以一般登入簽署 v15 成功:狀態 signed、事實表 checklist_records、處理 1 筆草稿');
select results_eq($$ select version_no, content_hash = pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 15), signer_org, signer_name_snapshot,
    method, aal, host(request_ip), user_agent from public.field_document_signatures
  where document_id = 'f7000000-0000-0000-0000-000000000001' $$,
  $$ values (15, true, 'contractor'::text, '廠商工地主任'::text, 'platform_account'::text, 'aal1'::text, '203.0.113.11'::text, 'pgTAP/P3b'::text) $$,
  '簽署列:版本 15、雜湊=版本雜湊、方式 platform_account、簽署者資料由伺服器取');
select results_eq($$ select r.template_id, r.check_date, r.location, r.work_item_id, r.results, r.overall, r.rev, r.root_id = r.id, r.supersedes_id, r.created_by, d.status, d.recheck
  from public.field_documents d join public.checklist_records r on r.id = d.target_id
  where d.id = 'f7000000-0000-0000-0000-000000000001' $$,
  $$ values ('f4000000-0000-0000-0000-000000000001'::uuid, '2026-09-17'::date, '3F 版牆'::text, 'f3000000-0000-0000-0000-000000000001'::uuid,
             '{"B1":{"value":true,"pass":true},"C2":{"value":18,"pass":true},"C3":{"value":40,"pass":true}}'::jsonb, '合格'::text, 0, true, null::uuid,
             'f0000000-0000-0000-0000-000000000001'::uuid, 'signed'::text, '[]'::jsonb) $$,
  '事實列 checklist_records Rev.0:範本、日期、位置、工項、逐項判定與 overall 由 DB 計算;文件綁 target_id、待補清空');
select results_eq($$ select status, resolved_by from public.agent_actions where id = 'f8000000-0000-0000-0000-000000000001' $$,
  $$ values ('edited'::text, 'f0000000-0000-0000-0000-000000000001'::uuid) $$,
  '指向本文件的 AI 草稿標 edited(有人工版本),resolved_by=簽署者');
select is((select count(*)::int from public.audit_events
  where event_type = 'field_document.signed' and entity_id = 'f7000000-0000-0000-0000-000000000001'
    and metadata ->> 'doc_type' = 'self_check' and metadata ->> 'method' = 'platform_account'), 1, '簽署留一筆 field_document.signed(self_check)');
select is((select count(*)::int from public.defects where project_id = 'f1000000-0000-0000-0000-00000000000a'), 1, '合格不開缺失(仍只有 §6 那一筆)');
select is((select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 15,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 15), '再送一次') ->> 'idempotent'),
  'true', '同人同版本重試 → 冪等回原簽署');
select is((select count(*)::int from public.checklist_records where project_id = 'f1000000-0000-0000-0000-00000000000a'), 3,
  '重試不新增事實列(§6 兩列＋本次一列)');
reset role;
select pg_temp.become('f0000000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 15,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 15), '我也簽') $$,
  'PD008', null, '同方另一位廠商對已簽署版本再簽 → PD008');
reset role;

-- ── 10. 已簽署的事實列:不可就地改、不可刪;綁定文件的未判定列也不可刪 ─────────────────────────
-- P6b-3 起 authenticated 已無 UPDATE／DELETE(42501,見 quality_direct_writes_retired.sql);這裡以 superuser＋廠商 claims
-- 驗 guard 本身的證據規則(縱深防禦,擋日後新增的 security definer 路徑)
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
select throws_ok($$ update public.checklist_records set note = '改寫'
  where id = (select target_id from public.field_documents where id = 'f7000000-0000-0000-0000-000000000001') $$,
  'P0001', null, '已簽署自檢紀錄:直接 UPDATE 被擋(既有 guard)');
select throws_ok($$ delete from public.checklist_records
  where id = (select target_id from public.field_documents where id = 'f7000000-0000-0000-0000-000000000001') $$,
  'P0001', null, '已簽署自檢紀錄:直接 DELETE 被擋');
set local role authenticated;
-- D3:全部項目不適用 → overall null(未判定)但簽署綁定 → 仍不可刪
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date, template_id)
  values ('f7000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-00000000000a', 'self_check', '2026-09-17', 'f4000000-0000-0000-0000-000000000001') $$,
  '建立 D3');
select public.save_field_document_version('f7000000-0000-0000-0000-000000000003', 0,
  jsonb_set(pg_temp.content_ok(), '{results}', '{"B1":{"value":null},"C2":{"value":null},"C3":{"value":null}}'::jsonb),
  pg_temp.sources_ok() || '{"results.B1":{"status":"na","reason":"本次未檢"},"results.C2":{"status":"na","reason":"本次未檢"},"results.C3":{"status":"na","reason":"本次未檢"}}'::jsonb);
select is((select public.sign_field_document('f7000000-0000-0000-0000-000000000003', 1,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000003', 1), '簽') ->> 'status'), 'signed', 'D3 全部不適用仍可簽(誠實的未檢)');
select is((select r.overall from public.checklist_records r join public.field_documents d on d.target_id = r.id where d.id = 'f7000000-0000-0000-0000-000000000003'),
  null, 'D3 事實列 overall=null(未判定,不寫「合格」)');
reset role;
select throws_ok($$ delete from public.checklist_records
  where id = (select target_id from public.field_documents where id = 'f7000000-0000-0000-0000-000000000003') $$,
  'P0001', null, '未判定但已綁簽署文件的紀錄不可刪(P3b 新規則;guard 層)');

-- ── 11. 簽後更正=修訂 Rev.N:更正原因取自版本變更說明;不合格自動開缺失 ────────────────────────
select pg_temp.become('f0000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 15,
    jsonb_set(pg_temp.content_ok(), '{results,C2,value}', '30'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok())
    - 'content_hash' - 'required_fields' - 'recheck'),
  '{"document_id":"f7000000-0000-0000-0000-000000000001","version_no":16,"status":"draft","amended_from_version":15}'::jsonb,
  '簽後更正:v16 amended_from_version=15,狀態回 draft');
select throws_ok($$ select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 16,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 16), '簽') $$,
  'PD010', null, '更正版本沒有變更說明 → 不能建立修訂版次(更正原因必填)');
select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 16,
  jsonb_set(pg_temp.content_ok(), '{results,C2,value}', '30'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok(), '複核取樣紀錄,坍度登載錯誤,更正為 30cm');
select is((select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 17,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 17), '本人確認更正後內容屬實並簽署') ->> 'status'),
  'signed', '重簽 v17 成功');
select results_eq($$ select r.rev, r.supersedes_id = p.id, r.root_id = p.id, r.revision_reason, r.overall, r.results -> 'C2' -> 'pass'
  from public.field_documents d join public.checklist_records r on r.id = d.target_id join public.checklist_records p on p.id = r.supersedes_id
  where d.id = 'f7000000-0000-0000-0000-000000000001' $$,
  $$ values (1, true, true, '複核取樣紀錄,坍度登載錯誤,更正為 30cm'::text, '不合格'::text, 'false'::jsonb) $$,
  '修訂 Rev.1:supersedes 指向 Rev.0、root 為 Rev.0、更正原因=版本變更說明、DB 改判不合格');
select results_eq($$ select count(*)::int, bool_and(status = '開立') from public.defects
  where source_checklist_record_id = (select root_id from public.checklist_records r join public.field_documents d on d.target_id = r.id where d.id = 'f7000000-0000-0000-0000-000000000001') $$,
  $$ values (1, true) $$, '改判不合格 → 同交易自動開一筆缺失(掛鏈根)');
select ok((select description from public.defects where source_checklist_record_id = (select root_id from public.checklist_records r join public.field_documents d on d.target_id = r.id where d.id = 'f7000000-0000-0000-0000-000000000001'))
  like '%（Rev.1 更正後判定）', '缺失說明註記 Rev.1 更正後判定');
select results_eq($$ select version_no from public.field_document_signatures where document_id = 'f7000000-0000-0000-0000-000000000001' order by version_no $$,
  $$ values (15), (17) $$, '簽署列 v15、v17 各一筆(舊簽署綁舊版)');
-- 再更正回合格:同鏈未結案缺失仍在(結案是監造權限),不重複開
select public.save_field_document_version('f7000000-0000-0000-0000-000000000001', 17,
  pg_temp.content_ok(), pg_temp.sources_ok(), pg_temp.att_ok(), '重新量測坍度 18cm');
select is((select public.sign_field_document('f7000000-0000-0000-0000-000000000001', 18,
    pg_temp.hash_of('f7000000-0000-0000-0000-000000000001', 18), '簽') ->> 'status'), 'signed', '再更正 v18 簽署成功(Rev.2)');
select results_eq($$ select r.rev, r.overall from public.field_documents d join public.checklist_records r on r.id = d.target_id where d.id = 'f7000000-0000-0000-0000-000000000001' $$,
  $$ values (2, '合格'::text) $$, 'Rev.2 合格');
select is((select count(*)::int from public.defects where project_id = 'f1000000-0000-0000-0000-00000000000a'), 2, '改回合格不動原缺失、也不新開');
-- 提送對象矩陣:自檢表只能送監造;監造收件
select is((select public.submit_field_document('f7000000-0000-0000-0000-000000000001', 18, 'supervisor', 'sc-req-1') ->> 'status'),
  'submitted', '廠商提送自檢表給監造');
select throws_ok($$ select public.submit_field_document('f7000000-0000-0000-0000-000000000001', 18, 'owner', 'sc-req-2') $$,
  'PD010', null, '自檢表不可提送給機關(對象矩陣)');
reset role;
select pg_temp.become('f0000000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select public.receive_field_document('f7000000-0000-0000-0000-000000000001', 18, 'sc-rr-1') ->> 'status'),
  'received', '監造收件自檢表');
reset role;

-- ── 12. 專案刪除 cascade 通過 guard 與 trigger ─────────────────────────────────────────
select pg_temp.become(null);
select lives_ok($$ delete from public.projects where id = 'f1000000-0000-0000-0000-00000000000a' $$,
  '專案刪除 cascade 可通過已簽署自檢紀錄的 guard');
select is((select count(*)::int from public.checklist_records where project_id = 'f1000000-0000-0000-0000-00000000000a'), 0, 'cascade 後自檢紀錄清空');

select * from finish();
rollback;
