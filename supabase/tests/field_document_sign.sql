-- P2d 施工日誌存版／簽署／提送 RPC pgTAP:save_field_document_version、sign_field_document(daily_log 分支)、
-- submit／receive／return_field_document、daily_logs_guard／daily_log_items_guard、resolve_agent_action_internal。
-- 對應 migration 20260917205000_field_document_rpcs.sql;設計 docs/architecture/field-documents-lifecycle.md §5–§7。
-- 所有 RPC 都以 `set local role authenticated`＋JWT claims 呼叫(真實路徑:security definer 窄門);
-- 「service」=無 JWT(auth.uid() null)的 superuser 敘述,模擬 Edge service／遷移。
begin;

select plan(139);

create or replace function pg_temp.become(u uuid, aal text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else (jsonb_build_object('sub', u::text, 'role', 'authenticated')
               || case when aal is null then '{}'::jsonb else jsonb_build_object('aal', aal) end)::text end, true);
end $$;
select pg_temp.become(null);

-- 目前版本的雜湊(前端會從 field_document_versions 讀到同一值)
create or replace function pg_temp.hash_of(d uuid, v int) returns text language sql as $$
  select content_hash from public.field_document_versions where document_id = d and version_no = v;
$$;
-- 一份齊備的施工日誌內容/來源/附件(WI-1 12 M3;WI-2 本日不適用;p1 廠商證據、p2 監造提供)
create or replace function pg_temp.content_ok() returns jsonb language sql as $$
  select '{"weather_am":"晴","weather_pm":"晴","work_summary":"3F 版牆混凝土澆置",
           "labor":[{"type":"泥作","count":8}],"equipment":[{"name":"泵浦車","count":1}],
           "materials":[{"name":"混凝土","unit":"M3","qty":12}],"extras":{"sampling":"本日無取樣"},
           "items":{"d3000000-0000-0000-0000-000000000001":{"qty_today":12,"note":"3F 版牆"},
                    "d3000000-0000-0000-0000-000000000002":{"qty_today":null}}}'::jsonb;
$$;
create or replace function pg_temp.sources_ok() returns jsonb language sql as $$
  select '{"weather_am":{"status":"confirmed","source":"cwa"},"weather_pm":{"status":"confirmed","source":"cwa"},
           "work_summary":{"status":"filled","source":"ai:photo"},"labor":{"status":"confirmed"},
           "equipment":{"status":"confirmed"},"materials":{"status":"confirmed"},
           "extras.sampling":{"status":"na","reason":"本日無取樣"},
           "items.d3000000-0000-0000-0000-000000000001.qty_today":{"status":"confirmed","source":"whiteboard:d6000000-0000-0000-0000-000000000001"},
           "items.d3000000-0000-0000-0000-000000000002.qty_today":{"status":"na","reason":"本日未施作"}}'::jsonb;
$$;
create or replace function pg_temp.att_ok() returns jsonb language sql as $$
  select '[{"photo_id":"d6000000-0000-0000-0000-000000000001"},
           {"photo_id":"d6000000-0000-0000-0000-000000000002","role":"reference"}]'::jsonb;
$$;

-- ── 1. 結構、觸發器、索引、執行權限 ───────────────────────────────────────────
select has_function('public', 'save_field_document_version', array['uuid','integer','jsonb','jsonb','jsonb','text'], 'save_field_document_version 存在');
select has_function('public', 'sign_field_document', array['uuid','integer','text','text'], 'sign_field_document 存在');
select has_function('public', 'submit_field_document', array['uuid','integer','text','text'], 'submit_field_document 存在');
select has_function('public', 'receive_field_document', array['uuid','integer','text'], 'receive_field_document 存在');
select has_function('public', 'return_field_document', array['uuid','integer','text','text'], 'return_field_document 存在');
select has_function('public', 'resolve_agent_action_internal', array['uuid','uuid','text'], 'resolve_agent_action_internal 存在');
select has_function('public', 'fn_field_document_required_fields', array['text','jsonb','jsonb'], '必填鍵推導函式存在');
select has_function('public', 'fn_field_document_unmet_fields', array['text','jsonb','jsonb','jsonb'], '待補判定函式存在(P3a 帶 doc_type、P3b 帶 content)');
select has_function('public', 'fn_field_document_attachment_issues', array['text','uuid','jsonb'], '附件角色隔離函式存在');
select has_trigger('public', 'daily_logs', 'daily_logs_guard', 'daily_logs guard 掛上');
select has_trigger('public', 'daily_log_items', 'daily_log_items_guard', 'daily_log_items guard 掛上');
select ok((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'field_documents_target_uidx') like '%superseded%',
  '事實列綁定唯一索引只算活文件(排除 discarded／superseded)');
select is(has_function_privilege('authenticated', 'public.save_field_document_version(uuid,int,jsonb,jsonb,jsonb,text)', 'execute'), true, 'authenticated 可執行 save');
select is(has_function_privilege('authenticated', 'public.sign_field_document(uuid,int,text,text)', 'execute'), true, 'authenticated 可執行 sign');
select is(has_function_privilege('authenticated', 'public.submit_field_document(uuid,int,text,text)', 'execute'), true, 'authenticated 可執行 submit');
select is(has_function_privilege('authenticated', 'public.receive_field_document(uuid,int,text)', 'execute'), true, 'authenticated 可執行 receive');
select is(has_function_privilege('authenticated', 'public.return_field_document(uuid,int,text,text)', 'execute'), true, 'authenticated 可執行 return');
select is(has_function_privilege('authenticated', 'public.resolve_agent_action_internal(uuid,uuid,text)', 'execute'), false, 'resolve_agent_action_internal 只供 RPC 內部');
select is(has_function_privilege('authenticated', 'public.field_document_respond_internal(uuid,int,text,text,text)', 'execute'), false, 'respond_internal 只供 RPC 內部');
select is(has_function_privilege('authenticated', 'public.fn_field_document_attachment_issues(text,uuid,jsonb)', 'execute'), false, '附件檢查函式不開給 authenticated');
select is(has_function_privilege('anon', 'public.sign_field_document(uuid,int,text,text)', 'execute'), false, 'anon 不可執行 sign');
select is(has_function_privilege('anon', 'public.submit_field_document(uuid,int,text,text)', 'execute'), false, 'anon 不可執行 submit');

-- ── 2. 純函式:必填鍵推導與待補判定 ───────────────────────────────────────────
select is(public.fn_field_document_required_fields('daily_log',
    '{"items":{"d3000000-0000-0000-0000-000000000001":{"qty_today":1},"d3000000-0000-0000-0000-000000000002":{}}}'::jsonb, '[]'::jsonb),
  '["equipment","items.d3000000-0000-0000-0000-000000000001.qty_today","items.d3000000-0000-0000-0000-000000000002.qty_today","labor","materials","weather_am","weather_pm","work_summary"]'::jsonb,
  '施工日誌必填鍵=固定六欄＋內容每個工項的當日數量(排序、去重)');
select is(public.fn_field_document_required_fields('daily_log', '{}'::jsonb, '["extras.sampling","labor"]'::jsonb),
  '["equipment","extras.sampling","labor","materials","weather_am","weather_pm","work_summary"]'::jsonb,
  'stored required_fields 與固定欄聯集(不會被客戶端清空)');
select is(public.fn_field_document_required_fields('daily_log',
    '{"items":{"d3000000-0000-0000-0000-000000000001":{"qty_today":1}}}'::jsonb,
    '["items.d3000000-0000-0000-0000-000000000003.qty_today","items.d3000000-0000-0000-0000-000000000001.qty_today"]'::jsonb),
  '["equipment","items.d3000000-0000-0000-0000-000000000001.qty_today","labor","materials","weather_am","weather_pm","work_summary"]'::jsonb,
  'stored 裡的工項數量鍵一律忽略、由本版內容重算(已移除的工項不會永遠卡住簽署)');
select is(public.fn_field_document_required_fields('self_check', '{"items":{"x":{}}}'::jsonb, '["a"]'::jsonb),
  '["a","check_date","template_id"]'::jsonb, '自檢表:stored ∪ 框架範本 required;沒有範本項目時不推導 results 鍵(P3b)');
select is(public.fn_field_document_unmet_fields('daily_log', '["a","b","c","d","e","f","g"]'::jsonb,
    '{"a":{"status":"filled"},"b":{"status":"confirmed"},"c":{"status":"na","reason":"本日無"},
      "d":{"status":"na"},"e":{"status":"pending"},"g":{"status":"weird"}}'::jsonb, null),
  '[{"key":"d","status":"na_without_reason"},{"key":"e","status":"pending"},{"key":"f","status":"missing"},{"key":"g","status":"unknown_status"}]'::jsonb,
  '待補判定:filled／confirmed／na＋reason 可簽;na 無 reason、pending、缺鍵、未知狀態皆待補');
select is(public.fn_field_document_unmet_fields('daily_log', '[]'::jsonb, null, null), '[]'::jsonb, '無必填鍵 → 無待補');

-- ── 3. fixtures:A 案三方＋同方第二人;B 案外人;C 案非正式(admin_override 有效) ─────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sg-contractor@example.test', '', now(), '{}', '{"full_name":"廠商工地主任","org_type":"contractor"}', now(), now()),
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sg-contractor2@example.test', '', now(), '{}', '{"full_name":"廠商品管","org_type":"contractor"}', now(), now()),
  ('d0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sg-supervisor@example.test', '', now(), '{}', '{"full_name":"監造工程師","org_type":"supervisor"}', now(), now()),
  ('d0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sg-owner@example.test', '', now(), '{}', '{"full_name":"機關承辦","org_type":"owner"}', now(), now()),
  ('d0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sg-outsider@example.test', '', now(), '{}', '{"full_name":"外案廠商","org_type":"contractor"}', now(), now()),
  ('d0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sg-admin@example.test', '', now(), '{}', '{"full_name":"Admin","org_type":"contractor"}', now(), now()),
  ('d0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sg-supervisor-admin@example.test', '', now(), '{}', '{"full_name":"監造主任(C 案 admin)","org_type":"supervisor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode) values
  ('d1000000-0000-0000-0000-00000000000a', '簽署測試案', '機關', '廠商', '監造', 'd0000000-0000-0000-0000-000000000006', true),
  ('d1000000-0000-0000-0000-00000000000b', '外案', '機關', '廠商', '監造', 'd0000000-0000-0000-0000-000000000006', true),
  ('d1000000-0000-0000-0000-00000000000c', '非正式案', '機關', '廠商', '監造', 'd0000000-0000-0000-0000-000000000006', false);
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('d1000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'member'),
  ('d1000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'member'),
  ('d1000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'member'),
  ('d1000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004', 'member'),
  ('d1000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000006', 'admin'),
  ('d1000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000005', 'member'),
  ('d1000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000006', 'admin'),
  ('d1000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-000000000001', 'member'),
  ('d1000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-000000000007', 'admin');

insert into public.work_items (id, project_id, item_key, item_no, description, unit, quantity, unit_price, amount, is_leaf) values
  ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'WI-1', '壹.一.1', '結構混凝土', 'M3', 100, 3000, 300000, true),
  ('d3000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000a', 'WI-2', '壹.一.2', '鋼筋', 'T', 10, 30000, 300000, true),
  ('d3000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-00000000000b', 'WI-B', '壹.一.1', '外案工項', 'M3', 1, 1, 1, true),
  ('d3000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-00000000000c', 'WI-C', '壹.一.1', 'C 案工項', 'M3', 1, 1, 1, true);

-- 照片(service 插入:上傳方依 uploaded_by 的 profile 推得;p3 推不出=未知)
insert into public.photos (id, project_id, storage_path, uploaded_by) values
  ('d6000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a/misc/p1.jpg', 'd0000000-0000-0000-0000-000000000001'),
  ('d6000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a/misc/p2.jpg', 'd0000000-0000-0000-0000-000000000003'),
  ('d6000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a/misc/p3.jpg', null);
select results_eq($$ select uploader_org from public.photos where project_id = 'd1000000-0000-0000-0000-00000000000a' order by id $$,
  $$ values ('contractor'::text), ('supervisor'::text), (null::text) $$, '照片上傳方:廠商／監造／未知');

-- 既有(未簽署)日誌:舊路徑直接寫入的相容範圍
insert into public.daily_logs (id, project_id, log_date, work_summary, status) values
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', '2026-09-10', '舊日誌', '已送出');

-- AI 草稿:指向 D1 的 draft_field_document(P2b 形狀)與舊 draft_daily_log(不指向文件)
-- (D1 於下一節由廠商建立;agent_actions 只存指標,可先寫)
-- ── 4. save_field_document_version ────────────────────────────────────────────
select pg_temp.become('d0000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date)
  values ('d7000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-17') $$,
  '廠商建立施工日誌草稿 D1(2026-09-17)');
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date)
  values ('d7000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-18') $$,
  '廠商建立施工日誌草稿 D3(2026-09-18)');
select throws_ok($$ select public.save_field_document_version('d7000000-0000-0000-0000-000000000001', 0, '[]'::jsonb) $$,
  'PD010', null, '內容不是物件 → PD010');
select is((select public.save_field_document_version('d7000000-0000-0000-0000-000000000001', 0,
    '{"work_summary":"混凝土澆置","items":{"d3000000-0000-0000-0000-000000000001":{"qty_today":null}}}'::jsonb,
    '{"work_summary":{"status":"filled","source":"ai:photo"},"items.d3000000-0000-0000-0000-000000000001.qty_today":{"status":"pending"}}'::jsonb)
    - 'content_hash'),
  '{"document_id":"d7000000-0000-0000-0000-000000000001","version_no":1,"status":"pending_input","amended_from_version":null,
    "required_fields":["equipment","items.d3000000-0000-0000-0000-000000000001.qty_today","labor","materials","weather_am","weather_pm","work_summary"],
    "recheck":[{"key":"equipment","status":"missing"},{"key":"items.d3000000-0000-0000-0000-000000000001.qty_today","status":"pending"},
               {"key":"labor","status":"missing"},{"key":"materials","status":"missing"},{"key":"weather_am","status":"missing"},{"key":"weather_pm","status":"missing"}]}'::jsonb,
  'v1:數量待補、固定欄缺來源 → pending_input,必填鍵與待補清單由伺服器算並回傳');
select results_eq($$ select current_version_no, status, required_fields, jsonb_array_length(recheck)
  from public.field_documents where id = 'd7000000-0000-0000-0000-000000000001' $$,
  $$ values (1, 'pending_input'::text,
     '["equipment","items.d3000000-0000-0000-0000-000000000001.qty_today","labor","materials","weather_am","weather_pm","work_summary"]'::jsonb, 6) $$,
  '文件列:版本指標 1、狀態 pending_input、required_fields／recheck 寫回');
select throws_ok($$ select public.save_field_document_version('d7000000-0000-0000-0000-000000000001', 0, '{}'::jsonb) $$,
  'PD001', null, '基準版本已過期(畫面是舊版)→ PD001');
reset role;
-- 雜湊核對用 superuser(fn_field_document_content_hash 不開給 authenticated;前端只讀 DB 存的值)
select is((select content_hash from public.field_document_versions where document_id = 'd7000000-0000-0000-0000-000000000001' and version_no = 1),
  (select public.fn_field_document_content_hash(v.content, v.attachments) from public.field_document_versions v
     where v.document_id = 'd7000000-0000-0000-0000-000000000001' and v.version_no = 1),
  '版本雜湊由 DB 計算(RPC 回傳的 content_hash 即此值)');

-- 越權:監造／機關／外人不能存廠商文件的版本
select pg_temp.become('d0000000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ select public.save_field_document_version('d7000000-0000-0000-0000-000000000001', 1, '{}'::jsonb) $$,
  'PD006', null, '監造不能編輯施工日誌 → PD006');
reset role;
select pg_temp.become('d0000000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ select public.save_field_document_version('d7000000-0000-0000-0000-000000000001', 1, '{}'::jsonb) $$,
  'PD006', null, '機關(正式模式唯讀)不能編輯 → PD006');
reset role;
select pg_temp.become('d0000000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$ select public.save_field_document_version('d7000000-0000-0000-0000-000000000001', 1, '{}'::jsonb) $$,
  'PD006', null, '非成員(跨案)不能編輯 → PD006');
reset role;

-- service 補了範本推導的必填鍵 → 與固定欄聯集;同方第二人可接手編輯
select pg_temp.become(null);
update public.field_documents set required_fields = '["extras.sampling"]'::jsonb where id = 'd7000000-0000-0000-0000-000000000001';
insert into public.agent_actions (id, project_id, actor_user, agent_role, kind, target_table, target_id, summary, evidence) values
  ('d8000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'contractor',
   'draft_field_document', 'field_documents', 'd7000000-0000-0000-0000-000000000001', '施工日誌草稿 2026-09-17',
   '{"version_no":1,"doc_type":"daily_log"}'),
  ('d8000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'contractor',
   'draft_daily_log', 'daily_logs', null, '舊工具的日誌草稿', '{}');
select pg_temp.become('d0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select public.save_field_document_version('d7000000-0000-0000-0000-000000000001', 1,
    pg_temp.content_ok() - 'extras', pg_temp.sources_ok() - 'extras.sampling', pg_temp.att_ok()) - 'content_hash'),
  '{"document_id":"d7000000-0000-0000-0000-000000000001","version_no":2,"status":"pending_input","amended_from_version":null,
    "required_fields":["equipment","extras.sampling","items.d3000000-0000-0000-0000-000000000001.qty_today","items.d3000000-0000-0000-0000-000000000002.qty_today","labor","materials","weather_am","weather_pm","work_summary"],
    "recheck":[{"key":"extras.sampling","status":"missing"}]}'::jsonb,
  'v2(同方第二人):固定欄齊備但 service 補的必填鍵 extras.sampling 缺來源 → 仍 pending_input');
select is((select public.save_field_document_version('d7000000-0000-0000-0000-000000000001', 2,
    pg_temp.content_ok(), pg_temp.sources_ok(), pg_temp.att_ok(), '補取樣說明') ->> 'status'),
  'draft', 'v3:extras.sampling 以 na＋reason 補齊 → draft(可簽)');
select results_eq($$ select version_no, created_by, author_kind, change_note from public.field_document_versions
  where document_id = 'd7000000-0000-0000-0000-000000000001' and version_no = 3 $$,
  $$ values (3, 'd0000000-0000-0000-0000-000000000002'::uuid, 'human'::text, '補取樣說明'::text) $$,
  '人工版本的建立者=登錄者(同方第二人)、備註保存');
reset role;

-- ── 5. sign_field_document:政策檢查(版本、雜湊、越權、意願、類型、待補、附件、工項) ──
-- (P3a 起 sign 依 doc_type 分派到內部函式;daily_log 分支行為不變,以下全部為回歸。R1 起沒有 aal2 政策:
--  全部以一般登入的 JWT(aal1)執行,下列拒絕都是版本／雜湊／意願等實質原因,不是登入等級)
select pg_temp.become('d0000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000001', 2,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000001', 2), '本人確認內容無誤並簽署') $$,
  'PD001', null, '簽舊版本(畫面是舊版)→ PD001');
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000001', 3, repeat('f', 64), '本人確認內容無誤並簽署') $$,
  'PD002', null, '雜湊不符 → PD002');
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000001', 3,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000001', 3), '   ') $$,
  'PD010', null, '簽署意願聲明空白 → PD010');
reset role;
select pg_temp.become('d0000000-0000-0000-0000-000000000003', 'aal1');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000001', 3,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000001', 3), '本人確認內容無誤並簽署') $$,
  'PD006', null, '監造簽施工日誌(非責任方)→ PD006');
-- 監造日誌:存版四類共用;固定欄(示範範本)與簽署分支自 P3a 起存在,完整情境見 supervisor_logs.sql
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date)
  values ('d7000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000a', 'supervisor_log', '2026-09-17') $$,
  '監造建立監造日誌草稿 D2');
select is((select public.save_field_document_version('d7000000-0000-0000-0000-000000000002', 0,
    '{"attendance":[{"name":"監造工程師","from":"08:00","to":"17:00"}]}'::jsonb, '{"attendance":{"status":"confirmed"}}'::jsonb) ->> 'status'),
  'pending_input', '監造日誌可存版本(四類共用);示範範本的其餘必填欄缺來源 → pending_input');
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000002', 1,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000002', 1), '本人確認內容無誤並簽署') $$,
  'PD004', null, '監造日誌必填欄待補 → PD004(簽署分支已支援,以待補拒絕)');
reset role;
select pg_temp.become('d0000000-0000-0000-0000-000000000004', 'aal1');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000001', 3,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000001', 3), '本人確認內容無誤並簽署') $$,
  'PD006', null, '機關簽施工日誌 → PD006');
reset role;
select pg_temp.become('d0000000-0000-0000-0000-000000000005', 'aal1');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000001', 3,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000001', 3), '本人確認內容無誤並簽署') $$,
  'PD006', null, '非成員簽 A 案文件(跨案取件)→ PD006');
reset role;

-- 待補、附件角色、工項驗證(用 D3)
select pg_temp.become('d0000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select is((select public.save_field_document_version('d7000000-0000-0000-0000-000000000003', 0,
    pg_temp.content_ok(), pg_temp.sources_ok() - 'labor', pg_temp.att_ok()) ->> 'status'),
  'pending_input', 'D3 v1:labor 缺來源 → pending_input');
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000003', 1,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000003', 1), '本人確認內容無誤並簽署') $$,
  'PD004', null, '必填欄位待補 → PD004(不可簽署)');
select is((select public.save_field_document_version('d7000000-0000-0000-0000-000000000003', 1,
    pg_temp.content_ok(), pg_temp.sources_ok(),
    '[{"photo_id":"d6000000-0000-0000-0000-000000000002"}]'::jsonb) -> 'recheck'),
  '[{"key":"attachments.d6000000-0000-0000-0000-000000000002","status":"uploader_org:supervisor"}]'::jsonb,
  'D3 v2:監造照片當施作證據 → 存版時 recheck 列出角色不符');
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000003', 2,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000003', 2), '本人確認內容無誤並簽署') $$,
  'PD005', null, '監造照片冒充施工證據 → PD005');
select is((select public.save_field_document_version('d7000000-0000-0000-0000-000000000003', 2,
    pg_temp.content_ok(), pg_temp.sources_ok(),
    '[{"photo_id":"d6000000-0000-0000-0000-000000000003"}]'::jsonb) -> 'recheck'),
  '[{"key":"attachments.d6000000-0000-0000-0000-000000000003","status":"uploader_unknown"}]'::jsonb,
  'D3 v3:上傳方未知的舊照片不能當證據');
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000003', 3,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000003', 3), '本人確認內容無誤並簽署') $$,
  'PD005', null, '上傳方未知的照片當證據 → PD005');
select public.save_field_document_version('d7000000-0000-0000-0000-000000000003', 3,
  jsonb_set(pg_temp.content_ok(), '{items}', '{"d3000000-0000-0000-0000-000000000003":{"qty_today":1}}'::jsonb),
  pg_temp.sources_ok() || '{"items.d3000000-0000-0000-0000-000000000003.qty_today":{"status":"confirmed"}}'::jsonb);
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000003', 4,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000003', 4), '本人確認內容無誤並簽署') $$,
  'PD010', null, '內容含外案工項 → PD010');
select public.save_field_document_version('d7000000-0000-0000-0000-000000000003', 4,
  jsonb_set(pg_temp.content_ok(), '{items,d3000000-0000-0000-0000-000000000001,qty_today}', '-1'::jsonb), pg_temp.sources_ok());
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000003', 5,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000003', 5), '本人確認內容無誤並簽署') $$,
  'PD010', null, '當日數量為負 → PD010');
select public.save_field_document_version('d7000000-0000-0000-0000-000000000003', 5,
  jsonb_set(pg_temp.content_ok(), '{items,d3000000-0000-0000-0000-000000000001,qty_today}', 'null'::jsonb), pg_temp.sources_ok());
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000003', 6,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000003', 6), '本人確認內容無誤並簽署') $$,
  'PD010', null, '來源標已確認但數量缺值 → PD010(不信任客戶端形狀)');
select public.save_field_document_version('d7000000-0000-0000-0000-000000000003', 6,
  pg_temp.content_ok() || '{"log_date":"2026-09-17"}'::jsonb, pg_temp.sources_ok());
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000003', 7,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000003', 7), '本人確認內容無誤並簽署') $$,
  'PD010', null, '內容日期與文件業務日期不符 → PD010');
select public.save_field_document_version('d7000000-0000-0000-0000-000000000003', 7,
  jsonb_set(pg_temp.content_ok(), '{labor}', '"八人"'::jsonb), pg_temp.sources_ok());
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000003', 8,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000003', 8), '本人確認內容無誤並簽署') $$,
  'PD010', null, 'labor 不是陣列 → PD010');
reset role;

-- ── 6. 簽署成功:簽署列、狀態、事實表、agent_actions、稽核、冪等 ──────────────────
select pg_temp.become('d0000000-0000-0000-0000-000000000001', 'aal1');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.9","user-agent":"pgTAP/P2d"}', true);
set local role authenticated;
select is((select public.sign_field_document('d7000000-0000-0000-0000-000000000001', 3,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000001', 3), '本人確認 2026-09-17 施工日誌內容無誤並簽署')
    - 'signature_id' - 'signed_at' - 'target_id' - 'content_hash'),
  '{"document_id":"d7000000-0000-0000-0000-000000000001","version_no":3,"signer_id":"d0000000-0000-0000-0000-000000000001",
    "status":"signed","target_table":"daily_logs","agent_actions_resolved":1,"idempotent":false}'::jsonb,
  '廠商以一般登入(aal1)簽署 v3 成功:回簽署結果(狀態 signed、事實表 daily_logs、處理 1 筆草稿)');
select results_eq($$ select version_no, content_hash = pg_temp.hash_of('d7000000-0000-0000-0000-000000000001', 3), signer_org, signer_name_snapshot,
    method, aal, host(request_ip), user_agent, intent from public.field_document_signatures
  where document_id = 'd7000000-0000-0000-0000-000000000001' $$,
  $$ values (3, true, 'contractor'::text, '廠商工地主任'::text, 'platform_account'::text, 'aal1'::text,
             '203.0.113.9'::text, 'pgTAP/P2d'::text, '本人確認 2026-09-17 施工日誌內容無誤並簽署'::text) $$,
  '簽署列:版本 3、雜湊=版本雜湊、方式 platform_account、簽署者資料／aal(如實 aal1)／IP／UA 由伺服器取、意願原文保存');
select results_eq($$ select d.status, d.current_version_no, d.recheck, (d.target_id = l.id)
  from public.field_documents d join public.daily_logs l on l.project_id = d.project_id and l.log_date = d.doc_date
  where d.id = 'd7000000-0000-0000-0000-000000000001' $$,
  $$ values ('signed'::text, 3, '[]'::jsonb, true) $$,
  '文件 signed、待補清空、target_id 綁定該日 daily_logs 列');
select results_eq($$ select weather_am, weather_pm, work_summary, labor, equipment, materials, extras, status, created_by
  from public.daily_logs where project_id = 'd1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  $$ values ('晴'::text, '晴'::text, '3F 版牆混凝土澆置'::text, '[{"type":"泥作","count":8}]'::jsonb,
             '[{"name":"泵浦車","count":1}]'::jsonb, '[{"name":"混凝土","unit":"M3","qty":12}]'::jsonb,
             '{"sampling":"本日無取樣"}'::jsonb, '已簽署'::text, 'd0000000-0000-0000-0000-000000000001'::uuid) $$,
  '事實表 daily_logs 以簽署版本內容落庫(狀態 已簽署)');
select results_eq($$ select i.work_item_id, i.qty_today, i.note from public.daily_log_items i
  join public.daily_logs l on l.id = i.daily_log_id
  where l.project_id = 'd1000000-0000-0000-0000-00000000000a' and l.log_date = '2026-09-17' order by i.work_item_id $$,
  $$ values ('d3000000-0000-0000-0000-000000000001'::uuid, 12::numeric, '3F 版牆'::text) $$,
  'daily_log_items 只有有數量的工項(WI-2 本日不適用不落庫)');
select results_eq($$ select status, resolved_by, (resolved_at is not null) from public.agent_actions
  where id = 'd8000000-0000-0000-0000-000000000001' $$,
  $$ values ('edited'::text, 'd0000000-0000-0000-0000-000000000001'::uuid, true) $$,
  '指向本文件的 AI 草稿標 edited(文件有人工版本),resolved_by=簽署者');
select is((select status from public.agent_actions where id = 'd8000000-0000-0000-0000-000000000002'),
  'pending', '舊 draft_daily_log 草稿(不指向文件)維持 pending');
select is((select count(*)::int from public.audit_events
  where event_type = 'agent_action_resolved' and entity_id = 'd8000000-0000-0000-0000-000000000001'
    and metadata ->> 'resolved_via' = 'sign_field_document' and action = 'edited'),
  1, '草稿處理留 agent_action_resolved 稽核(resolved_via=sign_field_document)');
select is((select count(*)::int from public.audit_events
  where event_type = 'field_document.signed' and entity_id = 'd7000000-0000-0000-0000-000000000001'
    and metadata ->> 'aal' = 'aal1' and metadata ->> 'method' = 'platform_account'), 1, '簽署留一筆 field_document.signed(method platform_account、aal 如實 aal1)');
-- 冪等重試:同人同版本再呼叫 → 同一筆簽署,不重複
select is((select public.sign_field_document('d7000000-0000-0000-0000-000000000001', 3,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000001', 3), '再送一次') ->> 'idempotent'),
  'true', '同人同版本重試 → 冪等回原簽署');
select is((select count(*)::int from public.field_document_signatures where document_id = 'd7000000-0000-0000-0000-000000000001'),
  1, '重試不新增簽署列');
select is((select count(*)::int from public.field_document_signatures where method <> 'platform_account'),
  0, 'R1:RPC 寫入的簽署方式一律 platform_account(沒有 platform_account_mfa 路徑)');
reset role;
select pg_temp.become('d0000000-0000-0000-0000-000000000002', 'aal1');
set local role authenticated;
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000001', 3,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000001', 3), '我也簽') $$,
  'PD008', null, '同方另一人對已簽署版本再簽 → PD008');
reset role;

-- ── 7. 事實表 guard:已簽署日誌不可被舊路徑改寫;未簽署日誌照常 ─────────────────
select pg_temp.become('d0000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ update public.daily_logs set work_summary = '改寫'
  where project_id = 'd1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  'P0001', null, '已簽署日誌:直接 UPDATE 被擋');
select throws_ok($$ insert into public.daily_logs (project_id, log_date, work_summary, status)
  values ('d1000000-0000-0000-0000-00000000000a', '2026-09-17', '舊路徑 upsert', '已送出')
  on conflict (project_id, log_date) do update set work_summary = excluded.work_summary, status = excluded.status $$,
  'P0001', null, '已簽署日誌:舊 saveSiteLog 的 upsert 被擋(不是靜默改寫)');
select throws_ok($$ delete from public.daily_logs
  where project_id = 'd1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  'P0001', null, '已簽署日誌:直接 DELETE 被擋');
select throws_ok($$ insert into public.daily_log_items (daily_log_id, work_item_id, qty_today)
  select id, 'd3000000-0000-0000-0000-000000000002', 5 from public.daily_logs
  where project_id = 'd1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  'P0001', null, '已簽署日誌:直接新增工項數量被擋');
select throws_ok($$ update public.daily_log_items set qty_today = 99
  where daily_log_id in (select id from public.daily_logs where project_id = 'd1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17') $$,
  'P0001', null, '已簽署日誌:直接改數量被擋');
select throws_ok($$ delete from public.daily_log_items
  where daily_log_id in (select id from public.daily_logs where project_id = 'd1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17') $$,
  'P0001', null, '已簽署日誌:直接刪數量被擋');
-- 未簽署的既有日誌:舊路徑照常(P2c 改接前的相容範圍)
select lives_ok($$ update public.daily_logs set work_summary = '舊日誌(改)' where id = 'd2000000-0000-0000-0000-000000000001' $$,
  '未簽署日誌:直接 UPDATE 照常');
select lives_ok($$ insert into public.daily_log_items (daily_log_id, work_item_id, qty_today)
  values ('d2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 3) $$,
  '未簽署日誌:直接新增數量照常');
select lives_ok($$ delete from public.daily_logs where id = 'd2000000-0000-0000-0000-000000000001' $$,
  '未簽署日誌:直接 DELETE 照常');
reset role;
-- service(無 JWT)與偽造 GUC 也不能改寫
select pg_temp.become(null);
select throws_ok($$ update public.daily_logs set work_summary = 'service 改寫'
  where project_id = 'd1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  'P0001', null, '已簽署日誌:service 路徑也不能直接改寫');
select set_config('pmis.field_document_sign', 'd7000000-0000-0000-0000-000000000003', true);
select throws_ok($$ update public.daily_logs set work_summary = 'GUC 指向別日文件'
  where project_id = 'd1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  'P0001', null, 'GUC 指向其他日期的文件 → 不放行(放行只認同案同日的簽署文件)');
select set_config('pmis.field_document_sign', '', true);

-- ── 8. 簽後更正:新版本回草稿、舊簽署綁舊版、事實列等重簽才更新 ───────────────────
select pg_temp.become('d0000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select is((select public.save_field_document_version('d7000000-0000-0000-0000-000000000001', 3,
    jsonb_set(pg_temp.content_ok(), '{work_summary}', '"3F 版牆混凝土澆置(更正)"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok(), '更正施工概況')
    - 'content_hash' - 'required_fields' - 'recheck'),
  '{"document_id":"d7000000-0000-0000-0000-000000000001","version_no":4,"status":"draft","amended_from_version":3}'::jsonb,
  '簽後更正:v4 amended_from_version=3,狀態回 draft');
select is((select work_summary from public.daily_logs where project_id = 'd1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17'),
  '3F 版牆混凝土澆置', '更正尚未簽署:事實列仍是 v3 的簽署內容');
select results_eq($$ select version_no from public.field_document_signatures where document_id = 'd7000000-0000-0000-0000-000000000001' $$,
  $$ values (3) $$, '舊簽署仍只綁 v3');
select throws_ok($$ update public.daily_logs set work_summary = '草稿期直接改'
  where project_id = 'd1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  'P0001', null, '更正草稿期事實列仍受保護(裡面是簽署內容)');
select throws_ok($$ select public.sign_field_document('d7000000-0000-0000-0000-000000000001', 3,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000001', 3), '沿用舊版簽') $$,
  'PD001', null, '更正後再簽舊版 → PD001');
select is((select public.sign_field_document('d7000000-0000-0000-0000-000000000001', 4,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000001', 4), '本人確認更正後內容無誤並簽署') ->> 'status'),
  'signed', '重簽 v4 成功');
select is((select work_summary from public.daily_logs where project_id = 'd1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17'),
  '3F 版牆混凝土澆置(更正)', '重簽後事實列更新為 v4 內容');
select results_eq($$ select version_no from public.field_document_signatures where document_id = 'd7000000-0000-0000-0000-000000000001' order by version_no $$,
  $$ values (3), (4) $$, '簽署列 v3、v4 各一筆(舊簽署不沿用、不刪除)');
select is((select count(*)::int from public.audit_events
  where event_type = 'field_document.amended' and entity_id = 'd7000000-0000-0000-0000-000000000001'), 1,
  '簽後更正留一筆 field_document.amended');
reset role;

-- ── 9. 提送:對象矩陣、版本、越權、client_request_id 冪等 ─────────────────────────
select pg_temp.become('d0000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select throws_ok($$ select public.submit_field_document('d7000000-0000-0000-0000-000000000001', 4, 'owner', 'req-0') $$,
  'PD010', null, '施工日誌提送給機關 → PD010(對象矩陣)');
select throws_ok($$ select public.submit_field_document('d7000000-0000-0000-0000-000000000001', 3, 'supervisor', 'req-old') $$,
  'PD001', null, '提送舊版本 → PD001');
select is((select public.submit_field_document('d7000000-0000-0000-0000-000000000001', 4, 'supervisor', 'req-1')
    - 'submission_id' - 'created_at' - 'content_hash'),
  '{"document_id":"d7000000-0000-0000-0000-000000000001","version_no":4,"action":"submit","actor_id":"d0000000-0000-0000-0000-000000000001",
    "actor_org":"contractor","to_org":"supervisor","reason":null,"diff":null,"client_request_id":"req-1","status":"submitted","idempotent":false}'::jsonb,
  '責任方提送 v4 給監造:回送件回執(首次提送無 diff),狀態 submitted');
select is((select (r ->> 'idempotent') || '/' || (r ->> 'submission_id' = (select id::text from public.field_document_submissions where client_request_id = 'req-1'))::text
    from public.submit_field_document('d7000000-0000-0000-0000-000000000001', 4, 'supervisor', 'req-1') r),
  'true/true', '同 client_request_id 重試 → 回同一張回執');
select throws_ok($$ select public.submit_field_document('d7000000-0000-0000-0000-000000000001', 4, 'owner', 'req-1') $$,
  'PD009', null, '同 client_request_id 換對象 → PD009(冪等衝突)');
select is((select public.submit_field_document('d7000000-0000-0000-0000-000000000001', 4, 'supervisor') ->> 'idempotent'),
  'true', '同版本再送同對象(無 request id)→ 自然鍵冪等,不重複');
select is((select count(*)::int from public.field_document_submissions where document_id = 'd7000000-0000-0000-0000-000000000001'),
  1, '提送列只有 1 筆');
select throws_ok($$ select public.receive_field_document('d7000000-0000-0000-0000-000000000001', 4, 'rr-c') $$,
  'PD006', null, '提送方自己收件 → PD006');
reset role;
select pg_temp.become('d0000000-0000-0000-0000-000000000003', 'aal1');
set local role authenticated;
select throws_ok($$ select public.submit_field_document('d7000000-0000-0000-0000-000000000001', 4, 'supervisor', 'req-s') $$,
  'PD006', null, '監造提送廠商文件 → PD006');
reset role;
select pg_temp.become('d0000000-0000-0000-0000-000000000005', 'aal1');
set local role authenticated;
select throws_ok($$ select public.submit_field_document('d7000000-0000-0000-0000-000000000001', 4, 'supervisor', 'req-x') $$,
  'PD006', null, '非成員提送 → PD006');
select throws_ok($$ select public.receive_field_document('d7000000-0000-0000-0000-000000000001', 4) $$,
  'PD006', null, '非成員收件 → PD006');
select throws_ok($$ select public.return_field_document('d7000000-0000-0000-0000-000000000001', 4, '外人退回') $$,
  'PD006', null, '非成員退回 → PD006');
reset role;
select pg_temp.become('d0000000-0000-0000-0000-000000000004', 'aal1');
set local role authenticated;
select throws_ok($$ select public.receive_field_document('d7000000-0000-0000-0000-000000000001', 4) $$,
  'PD006', null, '機關(非提送對象)收件施工日誌 → PD006');
reset role;

-- ── 10. 收件／退回:提送對象才可;退回必填原因;歷次保留;退回後只能新版本再送 ────────
select pg_temp.become('d0000000-0000-0000-0000-000000000003', 'aal1');
set local role authenticated;
select throws_ok($$ select public.return_field_document('d7000000-0000-0000-0000-000000000001', 3, '舊版退回') $$,
  'PD001', null, '對舊版本收件／退回 → PD001');
select is((select public.receive_field_document('d7000000-0000-0000-0000-000000000001', 4, 'rr-1')
    - 'submission_id' - 'created_at' - 'content_hash'),
  '{"document_id":"d7000000-0000-0000-0000-000000000001","version_no":4,"action":"receive","actor_id":"d0000000-0000-0000-0000-000000000003",
    "actor_org":"supervisor","to_org":"supervisor","reason":null,"diff":null,"client_request_id":"rr-1","status":"received","idempotent":false}'::jsonb,
  '監造(提送對象)收件:回收件回執,狀態 received');
select is((select public.receive_field_document('d7000000-0000-0000-0000-000000000001', 4, 'rr-2') ->> 'idempotent'),
  'true', '同版本本方再收件 → 自然鍵冪等');
select throws_ok($$ select public.return_field_document('d7000000-0000-0000-0000-000000000001', 4, '   ', 'rt-0') $$,
  'PD010', null, '退回未填原因 → PD010');
select is((select public.return_field_document('d7000000-0000-0000-0000-000000000001', 4, '出工人數與現場不符,請更正', 'rt-1')
    - 'submission_id' - 'created_at' - 'content_hash'),
  '{"document_id":"d7000000-0000-0000-0000-000000000001","version_no":4,"action":"return","actor_id":"d0000000-0000-0000-0000-000000000003",
    "actor_org":"supervisor","to_org":"supervisor","reason":"出工人數與現場不符,請更正","diff":null,"client_request_id":"rt-1","status":"returned","idempotent":false}'::jsonb,
  '監造附原因退回:回退回回執,狀態 returned');
select is((select public.return_field_document('d7000000-0000-0000-0000-000000000001', 4, '出工人數與現場不符,請更正', 'rt-1') ->> 'idempotent'),
  'true', '退回同 client_request_id 重試 → 回同一張回執');
select throws_ok($$ select public.return_field_document('d7000000-0000-0000-0000-000000000001', 4, '再退一次', 'rt-2') $$,
  'PD008', null, '已退回的文件不能再退 → PD008');
select throws_ok($$ select public.receive_field_document('d7000000-0000-0000-0000-000000000001', 4, 'rr-3') $$,
  'PD008', null, '已退回的文件不能收件 → PD008');
reset role;
select pg_temp.become('d0000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select throws_ok($$ select public.submit_field_document('d7000000-0000-0000-0000-000000000001', 4, 'supervisor', 'req-again') $$,
  'PD008', null, '退回後原版再送 → PD008(需新版本重簽)');
select is((select public.save_field_document_version('d7000000-0000-0000-0000-000000000001', 4,
    jsonb_set(jsonb_set(pg_temp.content_ok(), '{work_summary}', '"3F 版牆混凝土澆置(更正)"'::jsonb), '{labor}', '[{"type":"泥作","count":10}]'::jsonb),
    pg_temp.sources_ok(), pg_temp.att_ok(), '依監造退回意見補出工') ->> 'amended_from_version'),
  '4', '退回後建立更正版本 v5(amended_from_version=4)');
select is((select public.sign_field_document('d7000000-0000-0000-0000-000000000001', 5,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000001', 5), '本人確認更正後內容無誤並簽署') ->> 'status'),
  'signed', '重簽 v5');
select is((select public.submit_field_document('d7000000-0000-0000-0000-000000000001', 5, 'supervisor', 'req-2') -> 'diff'),
  '{"against_version_no": 4, "changed_keys": ["labor"]}'::jsonb,
  '再送 v5:diff 由 DB 比對前次退回版本(只有 labor 變更)');
select results_eq($$ select action, count(*)::int from public.field_document_submissions
  where document_id = 'd7000000-0000-0000-0000-000000000001' group by action order by action $$,
  $$ values ('receive'::text, 1), ('return'::text, 1), ('submit'::text, 2) $$,
  '歷次提送／收件／退回全部保留(提送 2、收件 1、退回 1)');
select is((select reason from public.field_document_submissions where client_request_id = 'rt-1'),
  '出工人數與現場不符,請更正', '退回原因保留在歷史列');
reset role;
select pg_temp.become('d0000000-0000-0000-0000-000000000003', 'aal1');
set local role authenticated;
select is((select public.receive_field_document('d7000000-0000-0000-0000-000000000001', 5, 'rr-5') ->> 'status'),
  'received', '監造收件 v5');
reset role;
select pg_temp.become('d0000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select throws_ok($$ select public.save_field_document_version('d7000000-0000-0000-0000-000000000001', 5, '{}'::jsonb) $$,
  'PD008', null, '對方已收件的文件不可再存版本 → PD008');
reset role;

-- ── 11. 收件後 superseded 另立新件:新文件簽署綁同一事實列(索引只算活文件) ─────────
select pg_temp.become(null);
select lives_ok($$ update public.field_documents set status = 'superseded' where id = 'd7000000-0000-0000-0000-000000000001' $$,
  '已收件文件標 superseded(service)');
select pg_temp.become('d0000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date)
  values ('d7000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-17') $$,
  '同日可再立新施工日誌文件 D4');
select public.save_field_document_version('d7000000-0000-0000-0000-000000000004', 0,
  jsonb_set(pg_temp.content_ok(), '{work_summary}', '"D4 接手的內容"'::jsonb), pg_temp.sources_ok(), pg_temp.att_ok());
select is((select public.sign_field_document('d7000000-0000-0000-0000-000000000004', 1,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000004', 1), '本人確認內容無誤並簽署') ->> 'status'),
  'signed', 'D4 簽署成功(接手同一事實列)');
select is((select target_id from public.field_documents where id = 'd7000000-0000-0000-0000-000000000004'),
  (select target_id from public.field_documents where id = 'd7000000-0000-0000-0000-000000000001'),
  'D4 與 superseded 的 D1 綁同一 daily_logs 列(索引允許)');
select is((select work_summary from public.daily_logs where project_id = 'd1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17'),
  'D4 接手的內容', '事實列更新為 D4 簽署內容');
select throws_ok($$ update public.daily_logs set work_summary = '再改'
  where project_id = 'd1000000-0000-0000-0000-00000000000a' and log_date = '2026-09-17' $$,
  'P0001', null, '接手後事實列仍受保護');
reset role;

-- ── 12. 非正式案 admin_override:可代編輯／簽署(一般登入即可;簽署列如實記錄代簽者) ─────────
select pg_temp.become('d0000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date)
  values ('d7000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-00000000000c', 'daily_log', '2026-09-17') $$,
  'C 案廠商建立施工日誌草稿 D5');
reset role;
select pg_temp.become('d0000000-0000-0000-0000-000000000007', 'aal1');
set local role authenticated;
select is((select public.save_field_document_version('d7000000-0000-0000-0000-000000000005', 0,
    '{"weather_am":"晴","weather_pm":"晴","work_summary":"C 案","labor":[],"equipment":[],"materials":[]}'::jsonb,
    '{"weather_am":{"status":"confirmed"},"weather_pm":{"status":"confirmed"},"work_summary":{"status":"confirmed"},
      "labor":{"status":"na","reason":"無"},"equipment":{"status":"na","reason":"無"},"materials":{"status":"na","reason":"無"}}'::jsonb) ->> 'status'),
  'draft', '非正式案的監造 admin 可代編輯廠商文件(admin_override)');
select is((select public.sign_field_document('d7000000-0000-0000-0000-000000000005', 1,
    pg_temp.hash_of('d7000000-0000-0000-0000-000000000005', 1), 'admin 代簽') ->> 'status'),
  'signed', '非正式案 admin 以一般登入(aal1)可代簽(R1:沒有 aal2 政策)');
select results_eq($$ select signer_org, method, aal from public.field_document_signatures where document_id = 'd7000000-0000-0000-0000-000000000005' $$,
  $$ values ('supervisor'::text, 'platform_account'::text, 'aal1'::text) $$,
  '簽署列如實記錄簽署者組織(監造代簽,不冒充廠商)、方式 platform_account、aal 如實 aal1');
reset role;

-- ── 13. 捨棄的文件不可存版本;專案刪除 cascade 通過事實表 guard ────────────────────
select pg_temp.become('d0000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date)
  values ('d7000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-00000000000a', 'daily_log', '2026-09-19') $$,
  '建立 D6');
reset role;
select pg_temp.become(null);
update public.field_documents set status = 'discarded' where id = 'd7000000-0000-0000-0000-000000000006';
select pg_temp.become('d0000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select throws_ok($$ select public.save_field_document_version('d7000000-0000-0000-0000-000000000006', 0, '{}'::jsonb) $$,
  'PD008', null, '捨棄的文件不可存版本 → PD008');
reset role;
select pg_temp.become(null);
select lives_ok($$ delete from public.projects where id = 'd1000000-0000-0000-0000-00000000000a' $$,
  '專案刪除 cascade 可通過已簽署日誌的事實表 guard');
select is((select count(*)::int from public.daily_logs where project_id = 'd1000000-0000-0000-0000-00000000000a'), 0, 'cascade 後日誌清空');
select is((select count(*)::int from public.field_document_signatures), 1, 'cascade 後只剩 C 案的簽署列');

select * from finish();
rollback;
