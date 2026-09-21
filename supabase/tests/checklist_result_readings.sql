-- G 包 pgTAP:檢查項目的分列讀數(兩向尺寸 13×11 mm、不同編號 編號 1／編號 4)可保存、判定、簽署。
-- 判定引擎(與前端 lib/qc.judgeChecklist 同一組案例)、fn_checklist_result_check 值型別檢核、自檢表與監造查驗表單簽署端到端
-- (只標 filled 仍 PD004、value 與 readings 擇一、事實列保存完整讀數、超規讀數判不合格並開缺失、查驗項目不合格不得判合格)、
-- 人填欄 AI 版本不得帶讀數(防回歸)。
-- 對應 migration 20260921030000_checklist_result_readings.sql;設計 docs/architecture/field-documents-lifecycle.md §3.6。
begin;

select plan(58);

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
create or replace function pg_temp.sign(d uuid, v int) returns jsonb language sql as $$
  select public.sign_field_document(d, v, pg_temp.hash_of(d, v), '本人確認內容屬實並簽署');
$$;
-- 範本:W1 線徑(兩向都須 10–14 mm)、W2 網目(14–16 cm)、B1 勾選(P3g 範本 guard 要求實測項目至少有上限或下限)
create or replace function pg_temp.items() returns jsonb language sql as $$
  select '[{"no":"W1","item":"鋼線網線徑","kind":"num","min":10,"max":14,"unit":"mm","standard":"依圖說"},
           {"no":"W2","item":"鋼線網網目","kind":"num","min":14,"max":16,"unit":"cm","standard":"依圖說"},
           {"no":"B1","item":"搭接位置錯開","kind":"bool","standard":"依圖說"}]'::jsonb;
$$;
create or replace function pg_temp.j(r jsonb) returns jsonb language sql as $$ select public.fn_checklist_judge(pg_temp.items(), r); $$;
create or replace function pg_temp.rd() returns jsonb language sql as $$
  select '[{"entry_no":"1","value":13,"value2":11,"raw_text":"13 * 11 MM"},{"entry_no":"4","value":11,"value2":11,"raw_text":"11 * 11 MM"}]'::jsonb;
$$;
create or replace function pg_temp.chk(v jsonb, na boolean default false, kind text default 'num') returns void language sql as $$
  select public.fn_checklist_result_check('W1', jsonb_build_object('no', 'W1', 'kind', kind), v, na);
$$;

-- ── 1. 結構與權限 ─────────────────────────────────────────────────────────────────
select has_function('public', 'fn_checklist_num', array['jsonb'], '數字轉換 helper 存在');
select has_function('public', 'fn_checklist_result_check', array['text','jsonb','jsonb','boolean'], '單項值型別檢核 helper 存在');
select is(has_function_privilege('authenticated', 'public.fn_checklist_num(jsonb)', 'execute'), false, 'fn_checklist_num 不開給 authenticated');
select is(has_function_privilege('anon', 'public.fn_checklist_num(jsonb)', 'execute'), false, 'fn_checklist_num 不開給 anon');
select is(has_function_privilege('authenticated', 'public.fn_checklist_result_check(text,jsonb,jsonb,boolean)', 'execute'), false, 'fn_checklist_result_check 不開給 authenticated');
select is(has_function_privilege('anon', 'public.fn_checklist_result_check(text,jsonb,jsonb,boolean)', 'execute'), false, 'fn_checklist_result_check 不開給 anon');

-- ── 2. 判定引擎:分列讀數(與前端 judgeChecklist 同一組案例,見 src/lib/qc.test.js「分列讀數」)────────────
select is(pg_temp.j(jsonb_build_object('W1', jsonb_build_object('value', null, 'readings', pg_temp.rd()))) -> 'results' -> 'W1',
  jsonb_build_object('value', null, 'pass', true, 'readings', pg_temp.rd()), '兩個編號、兩向都在 10–14 內 → 合格,事實列帶回完整讀數');
select is(pg_temp.j('{"W1":{"value":null,"readings":[{"entry_no":"1","value":15,"value2":11}]}}') - 'results',
  '{"overall":"不合格","failed":["W1"]}'::jsonb, '第一向超出 max → 不合格,failed 列出該項');
select is(pg_temp.j('{"W1":{"value":null,"readings":[{"entry_no":"1","value":13,"value2":9}]}}') -> 'results' -> 'W1' -> 'pass',
  'false'::jsonb, '第二向低於 min → 不合格(兩向都要判,不只看第一個數)');
select is(pg_temp.j('{"W1":{"value":null,"readings":[{"entry_no":"1","value":13,"value2":11},{"entry_no":"4","value":9.5,"value2":null}]}}') -> 'results' -> 'W1' -> 'pass',
  'false'::jsonb, '任一編號超規 → 整項不合格');
select is(public.fn_checklist_judge('[{"no":"X1","kind":"num","unit":"cm"}]', '{"X1":{"value":null,"readings":[{"entry_no":"1","value":15,"value2":15}]}}') -> 'results' -> 'X1' -> 'pass',
  'true'::jsonb, '判定引擎本身:無量化上下限時有數值即合格(與單一值同一條規則;實際範本由 P3g guard 要求上下限)');
select is(pg_temp.j('{"W1":{"value":12,"readings":[]}}') -> 'results' -> 'W1', '{"value":12,"pass":true}'::jsonb, '空讀數陣列=沒有讀數,照單一值判定,不回 readings');
select is(pg_temp.j('{"W1":{"value":null,"readings":[{"value":"x"},{"value":null}]}}') -> 'results' -> 'W1' -> 'pass',
  'null'::jsonb, '讀數全部不是數字 → 未檢');
select is(pg_temp.j('{"W1":{"value":null,"readings":[{"entry_no":"1","value":"13","value2":"11"}]}}') -> 'results' -> 'W1' -> 'pass',
  'true'::jsonb, '可轉數字的字串照數值判(與前端 Number 相同)');
select is(pg_temp.j('{"B1":{"value":true,"readings":[{"value":999}]}}') -> 'results' -> 'B1', '{"value":true,"pass":true}'::jsonb,
  '勾選項不吃讀數:照布林判定、不回 readings');
select is(pg_temp.j('{"W1":{"value":12}}') -> 'results' -> 'W1', '{"value":12,"pass":true}'::jsonb, '回歸:只有單一值時輸出形狀與舊版完全相同');
select is(pg_temp.j('{"W1":{"value":null,"readings":[{"entry_no":"1","value":13,"value2":11}]},"W2":{"value":15},"B1":{"value":true}}') ->> 'overall',
  '合格', '讀數與單一值、勾選項混用 → 合格');

-- ── 3. fn_checklist_result_check:value 與 readings 擇一、讀數形狀、不適用 ───────────────────────────
select lives_ok($$ select pg_temp.chk(jsonb_build_object('value', null, 'readings', pg_temp.rd())) $$, '合法分列讀數');
select lives_ok($$ select pg_temp.chk('{"value":12}') $$, '合法單一值(回歸)');
select lives_ok($$ select pg_temp.chk('{"value":null,"readings":[]}', true) $$, '不適用:值與讀數皆空');
select lives_ok($$ select pg_temp.chk('{"value":true}', false, 'bool') $$, '勾選項布林(回歸)');
select throws_ok($$ select pg_temp.chk(jsonb_build_object('value', 12, 'readings', pg_temp.rd())) $$, 'PD010',
  '項次「W1」以分列讀數記錄時,單一值 value 須為空(兩種寫法擇一)', 'value 與 readings 並存 → 拒絕');
select throws_ok($$ select pg_temp.chk('{"value":null,"readings":[{"entry_no":"1","value":"13"}]}') $$, 'PD010',
  '項次「W1」第 1 筆讀數須為數字', '讀數是字串 → 拒絕(判定引擎寬鬆,簽署嚴格)');
select throws_ok($$ select pg_temp.chk('{"value":null,"readings":[{"entry_no":"1","value":13,"value2":"11"}]}') $$, 'PD010',
  '項次「W1」第 1 筆的第二向讀數須為數字或留空', '第二向是字串 → 拒絕');
select throws_ok($$ select pg_temp.chk('{"value":null,"readings":[{"entry_no":1,"value":13}]}') $$, 'PD010',
  '項次「W1」第 1 筆的編號須為文字', '編號是數字 → 拒絕');
select throws_ok($$ select pg_temp.chk('{"value":null,"readings":[13]}') $$, 'PD010', '項次「W1」第 1 筆讀數須為物件', '讀數不是物件 → 拒絕');
select throws_ok($$ select pg_temp.chk('{"value":null,"readings":{"value":13}}') $$, 'PD010', '項次「W1」的分列讀數 readings 須為陣列', 'readings 不是陣列 → 拒絕');
select throws_ok($$ select pg_temp.chk('{"value":true,"readings":[{"value":1}]}', false, 'bool') $$, 'PD010',
  '項次「W1」是勾選項,不可有分列讀數', '勾選項帶讀數 → 拒絕');
select throws_ok($$ select pg_temp.chk(jsonb_build_object('value', null, 'readings', pg_temp.rd()), true) $$, 'PD010',
  '項次「W1」標為不適用,但仍有值', '不適用仍有讀數 → 拒絕');
select throws_ok($$ select pg_temp.chk('{"value":null,"readings":[]}') $$, 'PD010',
  '項次「W1」已確認但沒有值;未檢請標不適用並填原因', '已確認但值與讀數皆空 → 拒絕');
select throws_ok($$ select pg_temp.chk(jsonb_build_object('value', null, 'readings',
    (select jsonb_agg(jsonb_build_object('value', g)) from generate_series(1, 51) g))) $$, 'PD010',
  '項次「W1」的分列讀數最多 50 筆', '超過 50 筆 → 拒絕');

-- ── 4. fixtures:A 案廠商／監造 ───────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('ab000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rd-contractor@example.test', '', now(), '{}', '{"full_name":"廠商品管","org_type":"contractor"}', now(), now()),
  ('ab000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rd-supervisor@example.test', '', now(), '{}', '{"full_name":"監造工程師","org_type":"supervisor"}', now(), now()),
  ('ab000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rd-admin@example.test', '', now(), '{}', '{"full_name":"Admin","org_type":"contractor"}', now(), now());
alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode) values
  ('ab100000-0000-0000-0000-00000000000a', '分列讀數測試案', '機關', '廠商', '監造', 'ab000000-0000-0000-0000-000000000003', true);
alter table public.projects enable trigger on_project_created;
insert into public.project_members (project_id, user_id, role) values
  ('ab100000-0000-0000-0000-00000000000a', 'ab000000-0000-0000-0000-000000000001', 'member'),
  ('ab100000-0000-0000-0000-00000000000a', 'ab000000-0000-0000-0000-000000000002', 'member'),
  ('ab100000-0000-0000-0000-00000000000a', 'ab000000-0000-0000-0000-000000000003', 'admin');
insert into public.work_items (id, project_id, item_key, item_no, description, unit, quantity, unit_price, amount, is_leaf, is_billable, is_rollup) values
  ('ab300000-0000-0000-0000-000000000001', 'ab100000-0000-0000-0000-00000000000a', 'WM-1', '壹.二.1', '鋼線網', 'M2', 500, 100, 50000, true, true, false);
insert into public.checklist_templates (id, project_id, title, source, items, kind) values
  ('ab400000-0000-0000-0000-000000000001', 'ab100000-0000-0000-0000-00000000000a', '鋼線網自主檢查表', '圖說', pg_temp.items(), 'self_check'),
  ('ab400000-0000-0000-0000-000000000002', 'ab100000-0000-0000-0000-00000000000a', '鋼線網監造查驗表', '圖說', pg_temp.items(), 'inspection_form');
insert into public.photos (id, project_id, storage_path, uploaded_by) values
  ('ab600000-0000-0000-0000-000000000001', 'ab100000-0000-0000-0000-00000000000a', 'ab100000-0000-0000-0000-00000000000a/misc/paper.jpg', 'ab000000-0000-0000-0000-000000000001');

create or replace function pg_temp.sc(results jsonb) returns jsonb language sql as $$
  select jsonb_build_object('check_date', '2026-08-04', 'template_id', 'ab400000-0000-0000-0000-000000000001',
    'template_title', '鋼線網自主檢查表', 'work_item_id', 'ab300000-0000-0000-0000-000000000001', 'location', '4-4-25M',
    'results', results, 'note', null, 'template', '{"key":"self_check_demo","version":1}'::jsonb);
$$;
create or replace function pg_temp.scs(w1 text, w2 text) returns jsonb language sql as $$
  select jsonb_build_object(
    'check_date', '{"status":"confirmed","source":"human"}'::jsonb, 'template_id', '{"status":"confirmed","source":"human"}'::jsonb,
    'work_item_id', '{"status":"confirmed","source":"human"}'::jsonb, 'location', '{"status":"confirmed","source":"human"}'::jsonb,
    'results.W1', jsonb_build_object('status', w1, 'source', 'record:ab600000-0000-0000-0000-000000000001'),
    'results.W2', jsonb_build_object('status', w2, 'source', 'record:ab600000-0000-0000-0000-000000000001'),
    'results.B1', '{"status":"confirmed","source":"human"}'::jsonb);
$$;
create or replace function pg_temp.results_ok() returns jsonb language sql as $$
  select jsonb_build_object(
    'W1', jsonb_build_object('value', null, 'readings', pg_temp.rd()),
    'W2', '{"value":null,"readings":[{"entry_no":"1","value":15,"value2":15,"raw_text":"15 * 15 CM"},{"entry_no":"4","value":15,"value2":15,"raw_text":"15 * 15 CM"}]}'::jsonb,
    'B1', '{"value":true}'::jsonb);
$$;

-- ── 5. 自主檢查表:AI 版本抄錄讀數(filled)→ 人沒逐項確認簽不下去 → 值型別錯拒簽 → 確認後簽署,事實列保存讀數 ──────────
select pg_temp.become('ab000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date, template_id)
  values ('ab700000-0000-0000-0000-000000000001', 'ab100000-0000-0000-0000-00000000000a', 'self_check', '2026-08-04', 'ab400000-0000-0000-0000-000000000001') $$,
  '廠商建立自檢表 D1');
reset role;
select pg_temp.become(null);
select lives_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values ('ab700000-0000-0000-0000-000000000001', 'ai', pg_temp.sc(pg_temp.results_ok() || '{"B1":{"value":null}}'),
          pg_temp.scs('filled', 'filled') || '{"results.B1":{"status":"pending"}}') $$,
  'AI 版本 v1:紙上實測欄的兩向尺寸／多編號抄成讀數、標 filled → 允許(實測值不是人填欄)');
update public.field_documents set current_version_no = 1, status = 'pending_input' where id = 'ab700000-0000-0000-0000-000000000001';
select pg_temp.become('ab000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select public.save_field_document_version('ab700000-0000-0000-0000-000000000001', 1,
    pg_temp.sc(pg_temp.results_ok()), pg_temp.scs('filled', 'filled'), '[{"photo_id":"ab600000-0000-0000-0000-000000000001"}]') -> 'recheck'),
  '[{"key":"results.W1","status":"needs_confirmation"},{"key":"results.W2","status":"needs_confirmation"}]'::jsonb,
  'v2:讀數只被抄錄(filled)→ 待親自確認');
select throws_ok($$ select pg_temp.sign('ab700000-0000-0000-0000-000000000001', 2) $$, 'PD004', null, '抄錄的讀數未經人逐項確認 → PD004');
select is((select public.save_field_document_version('ab700000-0000-0000-0000-000000000001', 2,
    pg_temp.sc(pg_temp.results_ok() || jsonb_build_object('W1', jsonb_build_object('value', 12, 'readings', pg_temp.rd()))),
    pg_temp.scs('confirmed', 'confirmed'), '[{"photo_id":"ab600000-0000-0000-0000-000000000001"}]') ->> 'status'),
  'draft', 'v3:W1 同時有單一值與讀數,狀態仍可存(存版不擋內容形狀)…');
select throws_ok($$ select pg_temp.sign('ab700000-0000-0000-0000-000000000001', 3) $$, 'PD010',
  '項次「W1」以分列讀數記錄時,單一值 value 須為空(兩種寫法擇一)', '…簽署時擋下(value 與 readings 擇一)');
select is((select public.save_field_document_version('ab700000-0000-0000-0000-000000000001', 3,
    pg_temp.sc(pg_temp.results_ok()), pg_temp.scs('confirmed', 'confirmed'), '[{"photo_id":"ab600000-0000-0000-0000-000000000001"}]') ->> 'status'),
  'draft', 'v4:讀數逐項確認 → draft(可簽)');
select is((select r ->> 'status' from pg_temp.sign('ab700000-0000-0000-0000-000000000001', 4) r), 'signed', '廠商簽署 v4');
select results_eq($$ select r.results, r.overall from public.checklist_records r join public.field_documents d on d.target_id = r.id
  where d.id = 'ab700000-0000-0000-0000-000000000001' $$,
  $$ values (jsonb_build_object(
      'W1', jsonb_build_object('value', null, 'pass', true, 'readings', pg_temp.rd()),
      'W2', '{"value":null,"pass":true,"readings":[{"entry_no":"1","value":15,"value2":15,"raw_text":"15 * 15 CM"},{"entry_no":"4","value":15,"value2":15,"raw_text":"15 * 15 CM"}]}'::jsonb,
      'B1', '{"value":true,"pass":true}'::jsonb), '合格'::text) $$,
  '事實列 checklist_records:每一項保存完整讀數(兩向、編號、紙上原文),判定由 DB 依範本計算');
select is((select v.content -> 'results' -> 'W1' -> 'readings' from public.field_document_versions v
  where v.document_id = 'ab700000-0000-0000-0000-000000000001' and v.version_no = 4), pg_temp.rd(), '簽署版本內容保存讀數(不可變)');
reset role;

-- D2:讀數超規 → 簽得下去,但判定不合格並自動開缺失
select pg_temp.become('ab000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.field_documents (id, project_id, doc_type, doc_date, template_id)
  values ('ab700000-0000-0000-0000-000000000002', 'ab100000-0000-0000-0000-00000000000a', 'self_check', '2026-08-04', 'ab400000-0000-0000-0000-000000000001') $$,
  '廠商建立自檢表 D2');
select is((select public.save_field_document_version('ab700000-0000-0000-0000-000000000002', 0,
    pg_temp.sc(pg_temp.results_ok() || '{"W1":{"value":null,"readings":[{"entry_no":"1","value":13,"value2":9,"raw_text":"13 * 9 MM"}]}}'),
    pg_temp.scs('confirmed', 'confirmed'), '[{"photo_id":"ab600000-0000-0000-0000-000000000001"}]') ->> 'status'), 'draft', 'D2 v1:W1 第二向 9 mm');
select is((select r ->> 'status' from pg_temp.sign('ab700000-0000-0000-0000-000000000002', 1) r), 'signed', 'D2 簽署');
select results_eq($$ select r.overall, r.results -> 'W1' -> 'pass' from public.checklist_records r join public.field_documents d on d.target_id = r.id
  where d.id = 'ab700000-0000-0000-0000-000000000002' $$,
  $$ values ('不合格'::text, 'false'::jsonb) $$, 'D2 事實列:第二向低於下限 → 不合格');
reset role;
select is((select count(*)::int from public.defects where project_id = 'ab100000-0000-0000-0000-00000000000a'), 1, 'D2 不合格自動開一筆缺失(沿用既有 trigger)');

-- ── 6. 監造查驗表單:讀數與自檢表同一條規則;項目不合格不得判合格 ─────────────────────────────────
select pg_temp.become('ab000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.inspections (id, project_id, work_item_id, title, location, requested_date, declared_qty, requested_by)
  values ('ab500000-0000-0000-0000-000000000001', 'ab100000-0000-0000-0000-00000000000a', 'ab300000-0000-0000-0000-000000000001',
          '4-4 鋼線網查驗', '4-4-25M', pg_temp.today(), 20, 'ab000000-0000-0000-0000-000000000001') $$,
  '廠商提查驗申請(鋼線網 20 M2)');
reset role;
create or replace function pg_temp.ic(results jsonb, verdict text default '合格') returns jsonb language sql stable as $$
  select jsonb_build_object(
    'inspection_date', pg_temp.today()::text, 'inspection_id', 'ab500000-0000-0000-0000-000000000001', 'inspection_title', '4-4 鋼線網查驗',
    'work_item_id', 'ab300000-0000-0000-0000-000000000001', 'location', '4-4-25M', 'stage_key', null, 'unit', 'M2', 'declared_qty', 20,
    'self_check_record_id', null, 'template_id', 'ab400000-0000-0000-0000-000000000002', 'template_title', '鋼線網監造查驗表',
    'results', results, 'verdict', verdict, 'confirmed_qty', 20, 'result_note', null, 'note', null,
    'template', '{"key":"inspection_form_demo","version":1}'::jsonb, 'photo_ids', '[]'::jsonb, 'unmatched_photo_ids', '[]'::jsonb);
$$;
create or replace function pg_temp.ics() returns jsonb language sql as $$
  select '{"inspection_date":{"status":"confirmed","source":"human"},"inspection_id":{"status":"confirmed","source":"human"},
           "work_item_id":{"status":"confirmed","source":"human"},"location":{"status":"confirmed","source":"human"},
           "unit":{"status":"confirmed","source":"human"},"declared_qty":{"status":"confirmed","source":"human"},
           "verdict":{"status":"confirmed","source":"human"},"confirmed_qty":{"status":"confirmed","source":"human"},
           "template_id":{"status":"confirmed","source":"human"},
           "results.W1":{"status":"confirmed","source":"human"},"results.W2":{"status":"confirmed","source":"human"},
           "results.B1":{"status":"confirmed","source":"human"}}'::jsonb;
$$;
create or replace function pg_temp.idoc() returns uuid language sql security definer as $$
  select id from public.field_documents where doc_type = 'inspection_form' and target_key = 'ab500000-0000-0000-0000-000000000001'
    and status not in ('discarded', 'superseded') order by created_at limit 1;
$$;
select pg_temp.become('ab000000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ select public.create_inspection_form_draft('ab500000-0000-0000-0000-000000000001') $$, '監造建查驗表單');
select is((select public.save_field_document_version(pg_temp.idoc(), 0,
    pg_temp.ic(pg_temp.results_ok() || '{"W1":{"value":null,"readings":[{"entry_no":"4","value":11,"value2":9.5,"raw_text":"11 * 9.5 MM"}]}}'),
    pg_temp.ics()) ->> 'status'), 'draft', 'v1:W1 第二向 9.5 mm(超規)卻判合格');
select throws_ok($$ select pg_temp.sign(pg_temp.idoc(), 1) $$, 'PD010', '查驗項目 W1 不合格,不得判定合格', '讀數超規 → 不得判合格');
select is((select public.save_field_document_version(pg_temp.idoc(), 1,
    pg_temp.ic(pg_temp.results_ok() || '{"W1":{"value":11,"readings":[{"entry_no":"4","value":11,"value2":11}]}}'),
    pg_temp.ics()) ->> 'status'), 'draft', 'v2:W1 單一值與讀數並存');
select throws_ok($$ select pg_temp.sign(pg_temp.idoc(), 2) $$, 'PD010',
  '項次「W1」以分列讀數記錄時,單一值 value 須為空(兩種寫法擇一)', '查驗表單同一條擇一規則');
select is((select public.save_field_document_version(pg_temp.idoc(), 2, pg_temp.ic(pg_temp.results_ok()), pg_temp.ics()) ->> 'status'),
  'draft', 'v3:讀數全部在範圍內、判合格');
select is((select r ->> 'status' from pg_temp.sign(pg_temp.idoc(), 3) r), 'signed', '監造簽署 v3(簽署即判定)');
select results_eq($$ select status, results -> 'W1', confirmed_qty from public.inspections where id = 'ab500000-0000-0000-0000-000000000001' $$,
  $$ values ('合格'::text, jsonb_build_object('value', null, 'pass', true, 'readings', pg_temp.rd()), 20.0000::numeric) $$,
  'inspections.results 保存完整讀數;確認量照常寫入');
reset role;

-- ── 7. 人填欄防回歸:若某類範本把實測值設回 human_only,AI 版本帶讀數與帶單一值一樣被拒 ─────────────────────
-- 以交易內暫換 fn_field_document_human_only_keys 模擬(測試結束 rollback 還原);guard 呼叫的就是這支
select pg_temp.become(null);
create or replace function public.fn_field_document_human_only_keys(p_doc_type text, p_content jsonb)
returns text[] language sql stable as $$ select array['results.W1']::text[] $$;
insert into public.field_documents (id, project_id, doc_type, doc_date, template_id) values
  ('ab700000-0000-0000-0000-000000000003', 'ab100000-0000-0000-0000-00000000000a', 'self_check', '2026-08-05', 'ab400000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values ('ab700000-0000-0000-0000-000000000003', 'ai', pg_temp.sc(jsonb_build_object('W1', jsonb_build_object('value', null, 'readings', pg_temp.rd()))),
          '{"results.W1":{"status":"pending"}}') $$,
  'P0001', '欄位 results.W1 只能由人填寫,AI 版本不得帶入內容(分列讀數)', '人填欄:AI 版本帶讀數 → 拒絕');
select throws_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values ('ab700000-0000-0000-0000-000000000003', 'ai', pg_temp.sc('{"W1":{"value":12}}'), '{"results.W1":{"status":"pending"}}') $$,
  'P0001', '欄位 results.W1 只能由人填寫,AI 版本不得帶入內容', '人填欄:AI 版本帶單一值 → 拒絕(回歸)');
select lives_ok($$ insert into public.field_document_versions (document_id, author_kind, content, field_sources)
  values ('ab700000-0000-0000-0000-000000000003', 'ai', pg_temp.sc('{"W1":{"value":null,"readings":[]}}'), '{"results.W1":{"status":"pending"}}') $$,
  '人填欄:空讀數陣列＋空值 → 允許(沒有帶入任何內容)');

select * from finish();
rollback;
