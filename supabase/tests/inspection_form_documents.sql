-- P3c 監造查驗表單 pgTAP:inspections 加欄與 guard(正規化、判定僅監造、簽署專屬欄、已判定不可改申報資料、有確認量不可撤銷判定)、
-- 不合格／部分合格自動開缺失下沉 DB、示範範本與規則推導(人填欄=判定＋確認量;階段鍵依 ITP 必填)、create_inspection_form_draft、
-- AI 版本不得帶入判定／確認量、sign_field_document 的 inspection_form 分支(只有監造能簽;簽署即判定;寫入確認量且不超過申報量;
-- 單位不符拒絕;部分合格開缺失;同批重複簽署不重複累加;簽後改量只能走撤銷;多階段以 ITP H 點;跨案;三角色＋非成員)、
-- 與 P4b 聯動(簽署後 list_billable_backlog 出現可估驗量、未簽署為 0)、提送對象矩陣、專案刪除 cascade。
-- 對應 migration 20260919222000_inspection_form_documents.sql;設計 field-documents-lifecycle.md §2.2／§4／§5、confirmed-quantity-valuation.md §16.6。
-- P3e(20260920004000)交接 P4e:簽署分支 6 處數量訊息與缺失說明「申報／確認／差額」經 fn_cq_txt,斷言訊息無 .0000。
begin;

select plan(152);

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else jsonb_build_object('sub', u::text, 'role', 'authenticated', 'aal', 'aal1')::text end, true);
end $$;
select pg_temp.become(null);
create or replace function pg_temp.today() returns date language sql stable as $$ select (now() at time zone 'Asia/Taipei')::date $$;
create or replace function pg_temp.hash_of(d uuid, v int) returns text language sql security definer as $$
  select content_hash from public.field_document_versions where document_id = d and version_no = v;
$$;
create or replace function pg_temp.doc_of(insp uuid) returns uuid language sql security definer as $$
  select id from public.field_documents where doc_type = 'inspection_form' and target_key = insp::text
    and status not in ('discarded', 'superseded') order by created_at limit 1;
$$;
create or replace function pg_temp.save(d uuid, base int, c jsonb, s jsonb, att jsonb default null, note text default null) returns jsonb language sql as $$
  select public.save_field_document_version(d, base, c, s, att, note);
$$;
create or replace function pg_temp.sign(d uuid, v int) returns jsonb language sql as $$
  select public.sign_field_document(d, v, pg_temp.hash_of(d, v), '本人確認判定與確認數量');
$$;
create or replace function pg_temp.items_ins() returns jsonb language sql as $$
  select '[{"no":"B1","group":"澆置前","item":"鋼筋保護層符合圖說","kind":"bool","standard":"依圖說"},
           {"no":"C2","group":"澆置中","item":"坍度","kind":"num","min":15.5,"max":20.5,"unit":"cm","standard":"18±2.5"}]'::jsonb;
$$;
-- 基準內容:查驗 I1(工項 WI-1 M3、位置 3F 版牆、申報 100)判部分合格、確認 60
create or replace function pg_temp.c(over jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select (jsonb_build_object(
    'inspection_date', pg_temp.today()::text, 'inspection_id', 'e5000000-0000-0000-0000-000000000001',
    'inspection_title', '3F 版牆混凝土查驗', 'work_item_id', 'e3000000-0000-0000-0000-000000000001',
    'location', '3F 版牆', 'stage_key', null, 'unit', 'M3', 'declared_qty', 100, 'self_check_record_id', null,
    'template_id', null, 'template_title', null, 'results', '{}'::jsonb,
    'verdict', '部分合格', 'confirmed_qty', 60, 'result_note', '版牆東側 40 M3 蜂窩待修補', 'note', null,
    'template', '{"key":"inspection_form_demo","version":1}'::jsonb, 'photo_ids', '[]'::jsonb, 'unmatched_photo_ids', '[]'::jsonb)
    || over);
$$;
create or replace function pg_temp.s(over jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select ('{"inspection_date":{"status":"confirmed","source":"human"},"inspection_id":{"status":"confirmed","source":"human"},
           "work_item_id":{"status":"confirmed","source":"human"},"location":{"status":"confirmed","source":"human"},
           "unit":{"status":"confirmed","source":"human"},"declared_qty":{"status":"confirmed","source":"human"},
           "verdict":{"status":"confirmed","source":"human"},"confirmed_qty":{"status":"confirmed","source":"human"}}'::jsonb || over);
$$;

-- ── 1. 結構、函式、trigger、執行權限 ────────────────────────────────────────────────
select has_column('public', 'inspections', 'declared_qty', 'inspections.declared_qty');
select has_column('public', 'inspections', 'confirmed_qty', 'inspections.confirmed_qty');
select has_column('public', 'inspections', 'batch_key', 'inspections.batch_key');
select has_column('public', 'inspections', 'document_id', 'inspections.document_id');
select has_column('public', 'inspections', 'results', 'inspections.results');
select has_column('public', 'checklist_templates', 'kind', 'checklist_templates.kind');
select has_column('public', 'checklist_templates', 'stage_key', 'checklist_templates.stage_key');
select has_column('public', 'checklist_templates', 'applies_to', 'checklist_templates.applies_to');
select has_column('public', 'checklist_templates', 'version', 'checklist_templates.version');
select has_trigger('public', 'inspections', 'inspections_guard', 'inspections_guard 掛上(改 BEFORE INSERT OR UPDATE)');
select has_trigger('public', 'inspections', 'inspections_defect_sync', '不合格／部分合格自動開缺失 trigger 掛上');
select has_function('public', 'create_inspection_form_draft', array['uuid'], '建表單草稿 RPC 存在');
select has_function('public', 'field_document_sign_inspection_form_internal', array['field_documents','field_document_versions','uuid'], 'inspection_form 簽署分支內部函式存在');
select has_function('public', 'fn_field_document_item_keys', array['text','jsonb','text'], '通用項目鍵推導函式存在');
select has_function('public', 'fn_field_document_self_check_item_keys', array['jsonb','text'], 'P3b 自檢表項目鍵函式仍在(wrapper)');
select has_function('public', 'fn_field_document_stage_required', array['text','jsonb'], '階段鍵必填判定函式存在');
select has_function('public', 'fn_inspection_sign_bypass', array['uuid'], '簽署路徑放行判定存在');
select is(has_function_privilege('authenticated', 'public.create_inspection_form_draft(uuid)', 'execute'), true, 'authenticated 可建表單草稿');
select is(has_function_privilege('anon', 'public.create_inspection_form_draft(uuid)', 'execute'), false, 'anon 不可');
select is(has_function_privilege('authenticated', 'public.field_document_sign_inspection_form_internal(field_documents,field_document_versions,uuid)', 'execute'), false, '簽署分支內部函式不開給 authenticated');
select is(has_function_privilege('authenticated', 'public.fn_field_document_item_keys(text,jsonb,text)', 'execute'), false, '項目鍵推導不開給 authenticated');
select is(has_function_privilege('authenticated', 'public.inspections_defect_sync()', 'execute'), false, 'trigger 函式不開給 authenticated');

-- ── 2. 示範範本與規則推導 ───────────────────────────────────────────────────────────
select is((select t ->> 'key' || '/' || (t ->> 'version') || '/' || (t ->> 'is_demo') || '/' || (t ->> 'demo_label')
           from public.fn_field_document_template('inspection_form') t),
  'inspection_form_demo/1/true/示範範本', '查驗表單範本=示範範本(is_demo、demo_label 供介面／列印標示)');
select ok((select t ->> 'disclaimer' from public.fn_field_document_template('inspection_form') t) like '%非任何機關公定或法定格式%',
  '範本附免責聲明:非機關公定或法定格式');
select is((select jsonb_array_length(t -> 'sections') from public.fn_field_document_template('inspection_form') t), 5, '範本五節');
select is((select t ->> 'key' from public.fn_field_document_template('supervisor_log') t), 'supervisor_log_demo', '監造日誌範本不變(回歸)');
select is((select t ->> 'key' from public.fn_field_document_template('self_check') t), 'self_check_demo', '自檢表框架不變(回歸)');
select is(public.fn_field_document_template_required_keys('inspection_form'),
  array['confirmed_qty','declared_qty','inspection_date','inspection_id','location','unit','verdict','work_item_id'],
  '範本必填=日期、查驗、工項、位置、單位、申報量、判定、確認量');
select is(public.fn_field_document_human_only_keys('inspection_form', pg_temp.c()), array['confirmed_qty','verdict'],
  '人填欄=判定與確認量(AI 版本不得帶入)');
select is(public.fn_field_document_confirm_required_keys('inspection_form', pg_temp.c()), array['confirmed_qty','declared_qty','location','stage_key','verdict'],
  '須確認欄=人填欄 ∪ 位置／階段／申報量(帶入的要人核對)');

-- ── 3. fixtures:A 案三方＋B 案外人(監造)＋admin(正式模式無 override) ──────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'if-contractor@example.test', '', now(), '{}', '{"full_name":"廠商工地主任","org_type":"contractor"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'if-supervisor@example.test', '', now(), '{}', '{"full_name":"監造工程師","org_type":"supervisor"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'if-owner@example.test', '', now(), '{}', '{"full_name":"機關承辦","org_type":"owner"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'if-outsider@example.test', '', now(), '{}', '{"full_name":"外案監造","org_type":"supervisor"}', now(), now()),
  ('e0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'if-admin@example.test', '', now(), '{}', '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode) values
  ('e1000000-0000-0000-0000-00000000000a', '查驗表單測試案', '機關', '廠商', '監造', 'e0000000-0000-0000-0000-000000000005', true),
  ('e1000000-0000-0000-0000-00000000000b', '外案', '機關', '廠商', '監造', 'e0000000-0000-0000-0000-000000000005', true);
alter table public.projects enable trigger on_project_created;
insert into public.project_members (project_id, user_id, role) values
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 'member'),
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 'member'),
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000003', 'member'),
  ('e1000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000005', 'admin'),
  ('e1000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000004', 'member'),
  ('e1000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000005', 'admin');

insert into public.work_items (id, project_id, item_key, item_no, description, unit, quantity, unit_price, amount, is_leaf, is_billable, is_rollup) values
  ('e3000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'WI-1', '壹.一.1', '結構混凝土', 'M3', 100, 3000, 300000, true, true, false),
  ('e3000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', 'WI-2', '壹.一.2', '鋼筋(多階段)', 'M2', 50, 100, 5000, true, true, false),
  ('e3000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', 'WI-3', '壹', '第一章', null, null, null, null, false, true, true),
  ('e3000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b', 'WI-B', '壹.一.1', '外案工項', 'M3', 1, 1, 1, true, true, false);
-- WI-2 兩個必要階段(ITP H 點)
insert into public.inspection_points (id, project_id, work_item_id, point_type, title, stage_key) values
  ('e8000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-000000000002', 'H', '鋼筋查驗', 'rebar'),
  ('e8000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-000000000002', 'H', '澆置前查驗', 'pour');
insert into public.checklist_templates (id, project_id, title, source, items, kind) values
  ('e4000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', '混凝土監造查驗表', '03310', pg_temp.items_ins(), 'inspection_form'),
  ('e4000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', '混凝土自主檢查表', '03310', pg_temp.items_ins(), 'self_check');
insert into public.photos (id, project_id, storage_path, uploaded_by) values
  ('e6000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a/misc/c1.jpg', 'e0000000-0000-0000-0000-000000000001'),
  ('e6000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a/misc/s1.jpg', 'e0000000-0000-0000-0000-000000000002');

select is((select kind from public.checklist_templates where id = 'e4000000-0000-0000-0000-000000000002'), 'self_check', '既有範本 kind 預設 self_check');
select is(public.fn_field_document_required_fields('inspection_form', pg_temp.c('{"work_item_id":"e3000000-0000-0000-0000-000000000002"}'), '[]'::jsonb) ? 'stage_key',
  true, '工項有 ITP 必要階段 → stage_key 必填');
select is(public.fn_field_document_required_fields('inspection_form', pg_temp.c(), '["stage_key"]'::jsonb) ? 'stage_key',
  false, '單階段工項 → stage_key 不必填(stored 的 stage_key 一律由內容重算)');
select is(public.fn_field_document_required_fields('inspection_form', pg_temp.c('{"template_id":"e4000000-0000-0000-0000-000000000001"}'), '[]'::jsonb),
  '["confirmed_qty","declared_qty","inspection_date","inspection_id","location","results.B1","results.C2","unit","verdict","work_item_id"]'::jsonb,
  '有查驗表範本 → 每個項目 results.<no> 必填');
select is(public.fn_field_document_human_only_keys('inspection_form', pg_temp.c('{"template_id":"e4000000-0000-0000-0000-000000000001"}')),
  array['confirmed_qty','results.C2','verdict'], '人填欄含實測值項目(num)');
select is(public.fn_field_document_required_fields('self_check', '{"template_id":"e4000000-0000-0000-0000-000000000002"}'::jsonb, '[]'::jsonb),
  '["check_date","results.B1","results.C2","template_id"]'::jsonb, '自檢表必填鍵不變(回歸;wrapper 同一條規則)');
select is(public.fn_field_document_unmet_fields('inspection_form', '["declared_qty","verdict"]'::jsonb,
    '{"declared_qty":{"status":"filled","source":"inspection:x"},"verdict":{"status":"confirmed","source":"human"}}'::jsonb, pg_temp.c()),
  '[{"key":"declared_qty","status":"needs_confirmation"}]'::jsonb, '申報量只被帶入 → 待確認;判定 confirmed 齊備');

-- ── 4. inspections guard:正規化、建立只能待查驗、簽署專屬欄、判定僅監造、已判定不可改申報、部分合格只走簽署 ─────
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.inspections (id, project_id, work_item_id, title, location, requested_date, declared_qty, requested_by)
  values ('e5000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-000000000001',
          '3F 版牆混凝土查驗', '3F 版牆', pg_temp.today(), 100, 'e0000000-0000-0000-0000-000000000001') $$,
  '廠商提查驗申請 I1(工項 WI-1、位置、申報 100)');
select results_eq($$ select batch_key, unit, declared_qty, status from public.inspections where id = 'e5000000-0000-0000-0000-000000000001' $$,
  $$ values ('3f版牆'::text, 'M3'::text, 100.0000::numeric, '待查驗'::text) $$, 'guard 正規化:批次鍵由位置、單位由工項、申報量四位小數');
select throws_ok($$ insert into public.inspections (project_id, work_item_id, title, status)
  values ('e1000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-000000000001', 'x', '合格') $$,
  'P0001', null, '廠商建立時直接判合格 → 拒絕');
select throws_ok($$ insert into public.inspections (project_id, work_item_id, title, confirmed_qty)
  values ('e1000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-000000000001', 'x', 1) $$,
  'P0001', null, '廠商建立時帶確認量 → 拒絕(只由簽署寫入)');
select lives_ok($$ insert into public.inspections (id, project_id, work_item_id, title, location, requested_date, declared_qty, stage_key)
  values ('e5000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-000000000002', 'A區鋼筋查驗', 'A區', pg_temp.today(), 50, ' Rebar ') $$,
  '廠商提 I2(多階段工項 WI-2、階段 rebar、申報 50)');
select is((select stage_key from public.inspections where id = 'e5000000-0000-0000-0000-000000000002'), 'rebar', '階段鍵正規化(去空白、小寫)');
select lives_ok($$ insert into public.inspections (id, project_id, work_item_id, title, location, requested_date)
  values ('e5000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-000000000001', '舊式查驗(無申報量)', '2F', pg_temp.today()) $$,
  '廠商提 I3(未載明申報量)');
select throws_ok($$ update public.inspections set status = '合格' where id = 'e5000000-0000-0000-0000-000000000001' $$,
  '42501', null, '廠商不能直接判定(P6b-3:表級 UPDATE 已收回)');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$ update public.inspections set status = '不合格', result_note = '鋼筋間距超出容許值' where id = 'e5000000-0000-0000-0000-000000000003' $$,
  '42501', null, '監造也不能快速判定(P6b-3 快速判定退場;判定只經監造查驗表單簽署)');
select throws_ok($$ update public.inspections set confirmed_qty = 10 where id = 'e5000000-0000-0000-0000-000000000001' $$,
  '42501', null, '監造也不能直接寫確認量');
reset role;
-- 判定的 DB 後果(缺失、稽核)在簽署交易內:以 I3 的表單草稿＋交易 GUC 模擬簽署路徑(superuser＋監造 claims;端到端簽署見 §6 起)
insert into public.field_documents (id, project_id, doc_type, doc_date, target_key) values
  ('e6f00000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', 'inspection_form', pg_temp.today(), 'e5000000-0000-0000-0000-000000000003');
select throws_like($$ update public.inspections set status = '部分合格' where id = 'e5000000-0000-0000-0000-000000000001' $$,
  '查驗判定只能經監造查驗表單簽署%', 'guard:非簽署路徑改判定一律拒(含部分合格)');
select set_config('pmis.field_document_sign', 'e6f00000-0000-0000-0000-000000000003', true);
select lives_ok($$ update public.inspections set status = '不合格', result_note = '鋼筋間距超出容許值', inspected_by = 'e0000000-0000-0000-0000-000000000002', inspected_at = now()
  where id = 'e5000000-0000-0000-0000-000000000003' $$, '簽署路徑判 I3 不合格');
select results_eq($$ select title, status, created_by from public.defects where inspection_id = 'e5000000-0000-0000-0000-000000000003' $$,
  $$ values ('查驗不合格：舊式查驗(無申報量)'::text, '開立'::text, 'e0000000-0000-0000-0000-000000000002'::uuid) $$,
  '不合格 → DB trigger 同交易開缺失(前端 insert 退場)');
select cmp_ok((select count(*)::int from public.audit_events where entity_id = 'e5000000-0000-0000-0000-000000000003' and event_type = 'inspection.decided'), '>=', 1, '稽核 inspection.decided');
select lives_ok($$ update public.inspections set status = '合格' where id = 'e5000000-0000-0000-0000-000000000003' $$, '簽署路徑更正判定…');
select lives_ok($$ update public.inspections set status = '不合格' where id = 'e5000000-0000-0000-0000-000000000003' $$, '再判不合格…');
select is((select count(*)::int from public.defects where inspection_id = 'e5000000-0000-0000-0000-000000000003'), 1, '…同查驗已有未結案缺失不重開');
select set_config('pmis.field_document_sign', '', true);
select throws_like($$ update public.inspections set declared_qty = 5 where id = 'e5000000-0000-0000-0000-000000000003' $$,
  '已判定的查驗不可變更%', 'guard:已判定的查驗不可改申報量');
select throws_like($$ update public.inspections set status = '待查驗' where id = 'e5000000-0000-0000-0000-000000000003' $$,
  '查驗判定只能經監造查驗表單簽署%', 'guard:撤銷判定回待查驗也只經簽署路徑');
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ update public.inspections set declared_qty = 5 where id = 'e5000000-0000-0000-0000-000000000003' $$,
  '42501', null, '廠商也不能改已判定查驗的申報量');
reset role;
select pg_temp.become(null);
select throws_ok($$ insert into public.inspections (project_id, work_item_id, title, status)
  values ('e1000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-000000000001', 'x', '待審') $$,
  '23514', null, '狀態只能是四值(check)');
insert into public.inspections (id, project_id, work_item_id, title, location, requested_date, declared_qty) values
  ('e5000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-000000000001', '3F 版牆補查', '3F 版牆', pg_temp.today(), 30),
  ('e5000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-000000000002', 'A區澆置前查驗', 'A區', pg_temp.today(), 50),
  ('e5000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-000000000001', 'B區查驗', 'B區', pg_temp.today(), 20),
  ('e5000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-000000000001', 'C區查驗(有範本)', 'C區', pg_temp.today(), 10),
  ('e5000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b', 'e3000000-0000-0000-0000-00000000000b', '外案查驗', 'X', pg_temp.today(), 1);

-- ── 5. create_inspection_form_draft:只有監造;一份查驗一份活文件;跨案拒絕 ─────────────────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ select public.create_inspection_form_draft('e5000000-0000-0000-0000-000000000001') $$, 'PD006', null, '廠商不能建監造查驗表單');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ select public.create_inspection_form_draft('e5000000-0000-0000-0000-000000000001') $$, 'PD006', null, '機關不能建');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ select public.create_inspection_form_draft('e5000000-0000-0000-0000-000000000001') $$, 'PD006', null, '外案監造(非成員)不能建');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select d ->> 'owner_org' || '/' || (d ->> 'target_key') || '/' || (d ->> 'doc_date') || '/' || (d ->> 'status') || '/' || (d ->> 'created')
           from public.create_inspection_form_draft('e5000000-0000-0000-0000-000000000001') d),
  'supervisor/e5000000-0000-0000-0000-000000000001/' || pg_temp.today()::text || '/draft/true', '監造建 D1:責任方監造、target_key=查驗、業務日期今天');
select is((select (d ->> 'id')::uuid = pg_temp.doc_of('e5000000-0000-0000-0000-000000000001') and (d ->> 'created') = 'false'
           from public.create_inspection_form_draft('e5000000-0000-0000-0000-000000000001') d), true, '再建 → 回同一份(created=false)');
select throws_ok($$ select public.create_inspection_form_draft('e5000000-0000-0000-0000-00000000000b') $$, 'PD006', null, '外案查驗不能建(跨案)');
reset role;
select pg_temp.become(null);
select throws_ok($$ insert into public.field_documents (project_id, doc_type, doc_date, target_key)
  values ('e1000000-0000-0000-0000-00000000000a', 'inspection_form', pg_temp.today(), 'e5000000-0000-0000-0000-000000000001') $$,
  '23505', null, '同一查驗第二份活文件撞唯一索引(service 亦然)');

-- ── 6. AI 版本:判定與確認量不得帶入 ───────────────────────────────────────────────────
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values (pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 'ai', pg_temp.c('{"verdict":"合格","confirmed_qty":null}'), '{"verdict":{"status":"pending"}}') $$,
  'P0001', null, 'AI 版本帶入判定 → 拒絕');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values (pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 'ai', pg_temp.c('{"verdict":null,"confirmed_qty":null}'), '{"confirmed_qty":{"status":"filled","source":"whiteboard:x"}}') $$,
  'P0001', null, 'AI 版本把確認量標 filled → 拒絕');
select lives_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values (pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 'ai', pg_temp.c('{"verdict":null,"confirmed_qty":null}'),
          pg_temp.s('{"verdict":{"status":"pending","reason":"由監造親自判定"},"confirmed_qty":{"status":"pending"},"declared_qty":{"status":"filled","source":"inspection:e5000000-0000-0000-0000-000000000001"}}')) $$,
  'AI 版本:判定與確認量留空 pending、申報量帶入待核對 → 允許(v1)');
update public.field_documents set current_version_no = 1, status = 'pending_input',
  required_fields = public.fn_field_document_required_fields('inspection_form', pg_temp.c(), '[]'::jsonb)
  where id = pg_temp.doc_of('e5000000-0000-0000-0000-000000000001');
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*)::int from jsonb_array_elements(public.list_billable_backlog('e1000000-0000-0000-0000-00000000000a'))), 0, '未簽署前 backlog 為空(可估驗量 0)');
reset role;

-- ── 7. 簽署 D1:三角色＋非成員、待確認、單位／數量／判定／階段／查驗一致性、附件角色 ─────────────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 1) $$, 'PD006', null, '廠商簽監造查驗表單 → PD006');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 1) $$, 'PD006', null, '機關簽 → PD006');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ select public.sign_field_document(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 1, repeat('a', 64), '簽') $$, 'PD006', null, '非成員簽 → PD006');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 1) $$, 'PD006', null, '正式模式的廠商 admin 也不能簽(無 override)');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 1, pg_temp.c(),
    pg_temp.s('{"declared_qty":{"status":"filled","source":"inspection:e5000000-0000-0000-0000-000000000001"}}')) -> 'recheck'),
  '[{"key":"declared_qty","status":"needs_confirmation"}]'::jsonb, 'v2:申報量只被帶入 → 存版列待確認');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 2) $$, 'PD004', null, '申報量未經監造確認 → PD004');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 2, pg_temp.c('{"unit":"M2"}'), pg_temp.s()) ->> 'status'), 'draft', 'v3 單位 M2 可存版…');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 3) $$, 'PD010', null, '…但單位與標單工項不一致 → 拒簽');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 3, pg_temp.c('{"confirmed_qty":120}'), pg_temp.s()) ->> 'status'), 'draft', 'v4 確認 120');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 4) $$, 'PD010',
  '本次確認數量 120 超過申報數量 100', '確認量超過申報量 → 拒簽(訊息數量經 fn_cq_txt,無 .0000;P3e 交接)');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 4, pg_temp.c('{"verdict":"合格"}'), pg_temp.s()) ->> 'status'), 'draft', 'v5 判合格但確認 60');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 5) $$, 'PD010',
  '判定合格時本次確認數量須等於申報數量 100(目前 60);未全數通過請判部分合格', '合格須確認量=申報量 → 拒簽(訊息無 .0000)');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 5, pg_temp.c('{"stage_key":"rebar"}'), pg_temp.s('{"stage_key":{"status":"confirmed","source":"human"}}')) ->> 'status'), 'draft', 'v6 單階段工項帶階段');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 6) $$, 'PD010', null, '單階段工項不可帶階段 → 拒簽');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 6, pg_temp.c('{"verdict":"不合格","confirmed_qty":0,"result_note":null}'), pg_temp.s()) ->> 'status'), 'draft', 'v7 不合格無說明');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 7) $$, 'PD010', null, '不合格須填判定說明 → 拒簽');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 7, pg_temp.c('{"inspection_id":"e5000000-0000-0000-0000-000000000002"}'), pg_temp.s()) ->> 'status'), 'draft', 'v8 內容指到另一份查驗');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 8) $$, 'PD010', null, '內容查驗與表單綁定的查驗不同 → 拒簽');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 8, pg_temp.c(), pg_temp.s(), '[{"photo_id":"e6000000-0000-0000-0000-000000000001"}]'::jsonb) -> 'recheck'),
  '[{"key":"attachments.e6000000-0000-0000-0000-000000000001","status":"uploader_org:contractor"}]'::jsonb, 'v9 廠商照片當監造證據 → 存版列附件問題');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 9) $$, 'PD005', null, '廠商照片不能作監造證據 → PD005');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 9, pg_temp.c(), pg_temp.s(),
    '[{"photo_id":"e6000000-0000-0000-0000-000000000002"},{"photo_id":"e6000000-0000-0000-0000-000000000001","role":"reference"}]'::jsonb) ->> 'status'),
  'draft', 'v10:監造照片為證據、廠商照片為參考 → 可簽');
select is((select r ->> 'target_table' || '/' || (r ->> 'target_id') || '/' || (r ->> 'status') || '/' || (r ->> 'idempotent')
           from pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 10) r),
  'inspections/e5000000-0000-0000-0000-000000000001/signed/false', '監造簽署 v10 → 文件綁定查驗');
select results_eq($$ select status, confirmed_qty, declared_qty, document_id = pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), document_version_no, inspected_by,
                            inspected_at = (select signed_at from public.field_document_signatures where document_id = pg_temp.doc_of('e5000000-0000-0000-0000-000000000001') and version_no = 10)
                     from public.inspections where id = 'e5000000-0000-0000-0000-000000000001' $$,
  $$ values ('部分合格'::text, 60.0000::numeric, 100.0000::numeric, true, 10, 'e0000000-0000-0000-0000-000000000002'::uuid, true) $$,
  '簽署即判定:inspections 狀態、確認量、文件版本、判定人、判定時間=簽署時間');
select results_eq($$ select qty_cum, qty_delta, basis, batch_key, stage_key, unit, inspection_id, document_version_no,
                            content_hash = pg_temp.hash_of(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 10), confirmed_by, status,
                            confirmed_at = (select signed_at from public.field_document_signatures where document_id = pg_temp.doc_of('e5000000-0000-0000-0000-000000000001') and version_no = 10)
                     from public.inspection_confirmations where inspection_id = 'e5000000-0000-0000-0000-000000000001' $$,
  $$ values (60.0000::numeric, 60.0000::numeric, 'inspection'::text, '3f版牆'::text, null::text, 'M3'::text, 'e5000000-0000-0000-0000-000000000001'::uuid, 10,
             true, 'e0000000-0000-0000-0000-000000000002'::uuid, 'active'::text, true) $$,
  '同交易寫入監造確認量(基準=查驗、追溯文件版本與雜湊、確認時間=簽署時間)');
select ok((select description from public.defects where inspection_id = 'e5000000-0000-0000-0000-000000000001') like '%申報 100 M3、確認 60 M3、差額 40 M3%'
          and (select description from public.defects where inspection_id = 'e5000000-0000-0000-0000-000000000001') not like '%.0000%'
          and (select title from public.defects where inspection_id = 'e5000000-0000-0000-0000-000000000001') = '查驗部分合格：3F 版牆混凝土查驗',
  '部分合格 → 同交易開缺失,說明含申報／確認／差額(數量經 fn_cq_txt,無 .0000)');
select is((select r ->> 'idempotent' from pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 10) r), 'true', '同人同版本重簽 → 冪等');
select is((select count(*)::int from public.inspection_confirmations where inspection_id = 'e5000000-0000-0000-0000-000000000001'), 1, '…確認量不重複累加');
reset role;
-- 其餘三處數量訊息(P3e 交接 P4e:經 fn_cq_txt,無 .0000):以已簽的 v10 內容改一個值直呼簽署分支(驗證在任何寫入之前就拒絕)
create or replace function pg_temp.sign_branch_with(over jsonb) returns uuid language sql as $$
  select public.field_document_sign_inspection_form_internal(
    (select d from public.field_documents d where d.id = pg_temp.doc_of('e5000000-0000-0000-0000-000000000001')),
    (select jsonb_populate_record(v, jsonb_build_object('content', v.content || over)) from public.field_document_versions v
      where v.document_id = pg_temp.doc_of('e5000000-0000-0000-0000-000000000001') and v.version_no = 10),
    'e0000000-0000-0000-0000-000000000002');
$$;
select throws_ok($$ select pg_temp.sign_branch_with('{"declared_qty":90}') $$, 'PD010',
  '表單申報數量 90 與查驗申請的申報數量 100 不符;申報量以查驗申請為準', '申報量與查驗申請不符 → 訊息無 .0000');
select throws_ok($$ select pg_temp.sign_branch_with('{"confirmed_qty":100}') $$, 'PD010',
  '判定部分合格時本次確認數量須大於 0 且小於申報數量 100(目前 100)', '部分合格確認量=申報 → 訊息無 .0000');
select throws_ok($$ select pg_temp.sign_branch_with('{"verdict":"不合格","confirmed_qty":5}') $$, 'PD010',
  '判定不合格時本次確認數量須為 0(目前 5)', '不合格確認量非 0 → 訊息無 .0000');
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select (b -> 0 ->> 'effective')::numeric || '/' || (b -> 0 ->> 'available') || '/' || (b -> 0 ->> 'work_item_id')
           from public.list_billable_backlog('e1000000-0000-0000-0000-00000000000a') b),
  '60.0000/60.0000/e3000000-0000-0000-0000-000000000001', '廠商看 backlog:簽署後 WI-1 可估驗 60(其餘 40 不可請)');
reset role;

-- ── 8. 簽後更正:同量重簽不累加;改量只能撤銷再重簽;已判定不可改申報、有確認量不可撤銷判定 ────────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 10, pg_temp.c('{"note":"補充備註"}'), pg_temp.s(), null, '補備註') ->> 'amended_from_version'), '10', 'v11 更正版(只改備註)');
select is((select r ->> 'status' from pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 11) r), 'signed', '同量重簽 → 可簽');
select is((select count(*)::int from public.inspection_confirmations where inspection_id = 'e5000000-0000-0000-0000-000000000001'), 1, '…同批同量不重複累加(仍一筆)');
select is((select document_version_no from public.inspections where id = 'e5000000-0000-0000-0000-000000000001'), 11, '…判定改指向新版本');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 11, pg_temp.c('{"confirmed_qty":70,"result_note":"複核後東側 30 M3 待修補"}'), pg_temp.s(), null, '複核改量') ->> 'status'), 'draft', 'v12 改確認 70');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 12) $$, 'PD008', null, '已有有效確認量,改量重簽 → 先撤銷');
select throws_like($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 12) $$,
  '此查驗已有有效的監造確認量 60(紀錄 %);更正判定或數量請先撤銷該確認紀錄再重新簽署', '…訊息的有效確認量無 .0000');
select throws_ok($$ update public.inspections set declared_qty = 90 where id = 'e5000000-0000-0000-0000-000000000001' $$, '42501', null, '已判定不可改申報量(監造亦然;P6b-3 起表級 UPDATE 已收回)');
select throws_ok($$ update public.inspections set status = '待查驗' where id = 'e5000000-0000-0000-0000-000000000001' $$, '42501', null, '監造不可直接撤銷判定(有確認量時更正走撤銷確認再重簽)');
select is((select r ->> 'applied' from public.revoke_inspection_confirmation(
    (select id from public.inspection_confirmations where inspection_id = 'e5000000-0000-0000-0000-000000000001' and status = 'active'), '複核改量') r), 'true', '監造撤銷確認(P4b RPC)');
select is((select r ->> 'status' from pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 12) r), 'signed', '撤銷後重簽 v12 → 可簽');
select results_eq($$ select status, qty_cum, qty_delta from public.inspection_confirmations where inspection_id = 'e5000000-0000-0000-0000-000000000001' order by created_at $$,
  $$ values ('revoked'::text, 60.0000::numeric, 60.0000::numeric), ('active'::text, 70.0000::numeric, 70.0000::numeric) $$,
  '撤銷列保留追溯,新確認 70(唯一鍵只算 active)');
select is((select confirmed_qty from public.inspections where id = 'e5000000-0000-0000-0000-000000000001'), 70.0000::numeric, 'inspections 確認量隨簽署更新');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select (b -> 0 ->> 'effective')::numeric from public.list_billable_backlog('e1000000-0000-0000-0000-00000000000a') b), 70::numeric, 'backlog 70');
reset role;

-- ── 9. 同批次第二份查驗(累計語意)與跨案 ─────────────────────────────────────────────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.create_inspection_form_draft('e5000000-0000-0000-0000-000000000004') $$, '監造建 D4(I4 同批次 3F 版牆、申報 30)');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000004'), 0,
    pg_temp.c('{"inspection_id":"e5000000-0000-0000-0000-000000000004","declared_qty":30,"verdict":"合格","confirmed_qty":30,"result_note":null}'), pg_temp.s()) ->> 'status'), 'draft', 'D4 v1 合格 30');
select is((select r ->> 'status' from pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000004'), 1) r), 'signed', 'D4 簽署');
select results_eq($$ select qty_cum, qty_delta from public.inspection_confirmations where inspection_id = 'e5000000-0000-0000-0000-000000000004' $$,
  $$ values (100.0000::numeric, 30.0000::numeric) $$, '同工項同批次累計:70＋30=100');
select is((select count(*)::int from public.defects where inspection_id = 'e5000000-0000-0000-0000-000000000004'), 0, '合格不開缺失');
select lives_ok($$ select public.create_inspection_form_draft('e5000000-0000-0000-0000-000000000006') $$, '監造建 D6(I6 B區 申報 20)');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000006'), 0,
    pg_temp.c('{"inspection_id":"e5000000-0000-0000-0000-00000000000b","location":"B區","declared_qty":20,"verdict":"不合格","confirmed_qty":0,"result_note":"蜂窩"}'), pg_temp.s()) ->> 'status'), 'draft', 'D6 v1 內容指到外案查驗');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000006'), 1) $$, 'PD010', null, '外案查驗 → 拒簽(跨案)');
reset role;

-- ── 10. 不合格:不寫確認量、開缺失 ────────────────────────────────────────────────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000006'), 1,
    pg_temp.c('{"inspection_id":"e5000000-0000-0000-0000-000000000006","location":"B區","declared_qty":20,"verdict":"不合格","confirmed_qty":0,"result_note":"蜂窩須打除重澆"}'), pg_temp.s()) ->> 'status'), 'draft', 'D6 v2 不合格 0');
select is((select r ->> 'status' from pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000006'), 2) r), 'signed', 'D6 簽署');
select results_eq($$ select status, confirmed_qty, (select count(*)::int from public.inspection_confirmations where inspection_id = 'e5000000-0000-0000-0000-000000000006'),
                            (select title from public.defects where inspection_id = 'e5000000-0000-0000-0000-000000000006')
                     from public.inspections where id = 'e5000000-0000-0000-0000-000000000006' $$,
  $$ values ('不合格'::text, 0.0000::numeric, 0, '查驗不合格：B區查驗'::text) $$, '不合格:判定落庫、無確認量、開缺失');
reset role;

-- ── 11. 多階段(ITP H 點):階段必填且須在集合內;全部階段確認才可估驗 ─────────────────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.create_inspection_form_draft('e5000000-0000-0000-0000-000000000002') $$, '監造建 D2(I2 WI-2 A區 rebar 申報 50)');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000002'), 0,
    pg_temp.c('{"inspection_id":"e5000000-0000-0000-0000-000000000002","work_item_id":"e3000000-0000-0000-0000-000000000002","location":"A區","unit":"M2","declared_qty":50,"verdict":"合格","confirmed_qty":50,"result_note":null}'),
    pg_temp.s()) -> 'recheck'),
  '[{"key":"stage_key","status":"missing"}]'::jsonb, 'D2 v1 未填階段 → 存版列 stage_key 待補(工項有 H 點)');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000002'), 1) $$, 'PD004', null, '階段未填 → PD004');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000002'), 1,
    pg_temp.c('{"inspection_id":"e5000000-0000-0000-0000-000000000002","work_item_id":"e3000000-0000-0000-0000-000000000002","location":"A區","unit":"M2","declared_qty":50,"verdict":"合格","confirmed_qty":50,"result_note":null,"stage_key":"bogus"}'),
    pg_temp.s('{"stage_key":{"status":"confirmed","source":"human"}}')) ->> 'status'), 'draft', 'D2 v2 階段 bogus');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000002'), 2) $$, 'PD010', null, '階段不在 ITP 集合 → 拒簽');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000002'), 2,
    pg_temp.c('{"inspection_id":"e5000000-0000-0000-0000-000000000002","work_item_id":"e3000000-0000-0000-0000-000000000002","location":"A區","unit":"M2","declared_qty":50,"verdict":"合格","confirmed_qty":50,"result_note":null,"stage_key":"Rebar"}'),
    pg_temp.s('{"stage_key":{"status":"confirmed","source":"human"}}')) ->> 'status'), 'draft', 'D2 v3 階段 Rebar');
select is((select r ->> 'status' from pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000002'), 3) r), 'signed', 'D2 簽署(階段正規化 rebar)');
select is((select stage_key from public.inspection_confirmations where inspection_id = 'e5000000-0000-0000-0000-000000000002'), 'rebar', '確認紀錄階段鍵 rebar');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select (x ->> 'effective')::numeric || '/' || (x -> 'batches' -> 0 -> 'missing_stages')::text
           from jsonb_array_elements(public.list_billable_backlog('e1000000-0000-0000-0000-00000000000a')) x
           where x ->> 'work_item_id' = 'e3000000-0000-0000-0000-000000000002'),
  '0/["pour"]', '只確認 rebar 階段 → 可估驗 0、缺 pour');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.create_inspection_form_draft('e5000000-0000-0000-0000-000000000005') $$, '監造建 D5(I5 A區 pour)');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000005'), 0,
    pg_temp.c('{"inspection_id":"e5000000-0000-0000-0000-000000000005","work_item_id":"e3000000-0000-0000-0000-000000000002","location":"A區","unit":"M2","declared_qty":50,"verdict":"合格","confirmed_qty":50,"result_note":null,"stage_key":"pour"}'),
    pg_temp.s('{"stage_key":{"status":"confirmed","source":"human"}}')) ->> 'status'), 'draft', 'D5 v1 pour 合格 50');
select is((select r ->> 'status' from pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000005'), 1) r), 'signed', 'D5 簽署');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select (x ->> 'effective')::numeric from jsonb_array_elements(public.list_billable_backlog('e1000000-0000-0000-0000-00000000000a')) x
           where x ->> 'work_item_id' = 'e3000000-0000-0000-0000-000000000002'), 50::numeric, '兩階段皆確認 → WI-2 可估驗 50');
reset role;

-- ── 12. 查驗項目(範本 kind=inspection_form):項目不合格不得判合格;自檢表範本不可用 ──────────────────
select pg_temp.become('e0000000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.create_inspection_form_draft('e5000000-0000-0000-0000-000000000007') $$, '監造建 D7(I7 C區 申報 10、有範本)');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000007'), 0,
    pg_temp.c('{"inspection_id":"e5000000-0000-0000-0000-000000000007","location":"C區","declared_qty":10,"verdict":"合格","confirmed_qty":10,"result_note":null,"template_id":"e4000000-0000-0000-0000-000000000002","results":{"B1":{"value":true},"C2":{"value":18}}}'),
    pg_temp.s('{"results.B1":{"status":"confirmed","source":"human"},"results.C2":{"status":"confirmed","source":"human"}}')) ->> 'status'), 'draft', 'D7 v1 用自檢表範本');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000007'), 1) $$, 'PD010', null, '範本不是監造查驗用途 → 拒簽');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000007'), 1,
    pg_temp.c('{"inspection_id":"e5000000-0000-0000-0000-000000000007","location":"C區","declared_qty":10,"verdict":"合格","confirmed_qty":10,"result_note":null,"template_id":"e4000000-0000-0000-0000-000000000001","results":{"B1":{"value":true},"C2":{"value":30}}}'),
    pg_temp.s('{"results.B1":{"status":"confirmed","source":"human"},"results.C2":{"status":"confirmed","source":"human"}}')) ->> 'status'), 'draft', 'D7 v2 坍度 30 超規仍判合格');
select throws_ok($$ select pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000007'), 2) $$, 'PD010', null, '查驗項目不合格不得判合格 → 拒簽');
select is((select pg_temp.save(pg_temp.doc_of('e5000000-0000-0000-0000-000000000007'), 2,
    pg_temp.c('{"inspection_id":"e5000000-0000-0000-0000-000000000007","location":"C區","declared_qty":10,"verdict":"合格","confirmed_qty":10,"result_note":null,"template_id":"e4000000-0000-0000-0000-000000000001","results":{"B1":{"value":true},"C2":{"value":18}}}'),
    pg_temp.s('{"results.B1":{"status":"confirmed","source":"human"},"results.C2":{"status":"confirmed","source":"human"}}')) ->> 'status'), 'draft', 'D7 v3 全部合格');
select is((select r ->> 'status' from pg_temp.sign(pg_temp.doc_of('e5000000-0000-0000-0000-000000000007'), 3) r), 'signed', 'D7 簽署');
select results_eq($$ select template_id, results -> 'C2' -> 'pass', results -> 'B1' -> 'pass', status from public.inspections where id = 'e5000000-0000-0000-0000-000000000007' $$,
  $$ values ('e4000000-0000-0000-0000-000000000001'::uuid, 'true'::jsonb, 'true'::jsonb, '合格'::text) $$, '查驗項目結果由 fn_checklist_judge 算 pass 落 inspections.results');

-- ── 13. 提送對象矩陣:監造→廠商／機關;廠商收件 ─────────────────────────────────────────────
select is((select r ->> 'status' from public.submit_field_document(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 12, 'contractor', 'if-req-1') r), 'submitted', '監造提送 D1 給廠商');
select is((select r ->> 'status' from public.submit_field_document(pg_temp.doc_of('e5000000-0000-0000-0000-000000000004'), 1, 'owner', 'if-req-2') r), 'submitted', '監造提送 D4 給機關');
select throws_ok($$ select public.submit_field_document(pg_temp.doc_of('e5000000-0000-0000-0000-000000000006'), 2, 'supervisor', 'if-req-3') $$, 'PD010', null, '提送給監造自己 → 不在矩陣');
reset role;
select pg_temp.become('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select r ->> 'status' from public.receive_field_document(pg_temp.doc_of('e5000000-0000-0000-0000-000000000001'), 12, 'if-rr-1') r), 'received', '廠商收件 D1');
reset role;
select pg_temp.become(null);

-- ── 14. 專案刪除 cascade ─────────────────────────────────────────────────────────────────
select lives_ok($$ delete from public.projects where id = 'e1000000-0000-0000-0000-00000000000b' $$, '外案刪除 cascade(查驗、工項)');
select is((select count(*)::int from public.inspections where project_id = 'e1000000-0000-0000-0000-00000000000b'), 0, '…外案查驗已隨案刪除');

select * from finish();
rollback;
