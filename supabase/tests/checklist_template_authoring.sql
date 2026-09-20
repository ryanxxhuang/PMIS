-- P3g 檢查表／監造查驗表單範本的建立與編輯 pgTAP:checklist_templates_guard(權限、kind／stage_key／applies_to／
-- items 的結構約束與正規化、版本編號、已使用的範本不可改內容)與 checklist_templates_del_guard(被引用不可刪)。
-- 對應 migration 20260920050000_checklist_template_authoring.sql。
-- 三角色(廠商／監造／機關)＋專案 admin ＋非成員都各走一遍;寫入一律 `set local role authenticated`＋JWT claims,
-- 「service」=無 JWT 的 superuser 敘述(模擬 Edge／遷移)。
begin;

select plan(60);

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else jsonb_build_object('sub', u::text, 'role', 'authenticated', 'aal', 'aal1')::text end, true);
end $$;
select pg_temp.become(null);

-- 以 owner 讀(斷言「列長什麼樣」不能被 RLS「看不到」混過)
create or replace function pg_temp.tpl(t uuid) returns public.checklist_templates language sql security definer as $$
  select * from public.checklist_templates where id = t;
$$;
create or replace function pg_temp.tpl_count(t uuid) returns int language sql security definer as $$
  select count(*)::int from public.checklist_templates where id = t;
$$;
-- 建立一張範本(呼叫端已 set role;id 自帶方便後續斷言)
create or replace function pg_temp.mk(
  t uuid, p uuid, title text, kind text, items jsonb,
  applies jsonb default null, stage text default null, src text default null, ver int default 1)
returns void language sql as $$
  insert into public.checklist_templates (id, project_id, title, source, kind, items, applies_to, stage_key, version)
  values (t, p, title, src, kind, items, applies, stage, ver);
$$;
create or replace function pg_temp.items_ok() returns jsonb language sql as $$
  select '[{"no":"A1","group":"澆置前","item":"模板無積水","kind":"bool","standard":"目視","source":"3.1.1"},
           {"no":"A2","item":"坍度","kind":"num","min":15.5,"max":20.5,"unit":"cm"}]'::jsonb;
$$;

-- ── 1. 結構與執行權限 ───────────────────────────────────────────────────────────
select has_function('public', 'fn_checklist_applies_to', array['jsonb'], 'fn_checklist_applies_to 存在');
select has_function('public', 'fn_checklist_items_normalize', array['jsonb'], 'fn_checklist_items_normalize 存在');
select has_trigger('public', 'checklist_templates', 'checklist_templates_guard', '寫入 guard 掛上');
select has_trigger('public', 'checklist_templates', 'checklist_templates_del_guard', '刪除 guard 掛上');
select is(has_function_privilege('authenticated', 'public.checklist_templates_guard()', 'execute'), false,
  'trigger 函式不開給 authenticated');
select is(has_function_privilege('authenticated', 'public.fn_checklist_applies_to(jsonb)', 'execute'), false,
  '正規化函式不進 authenticated 允許清單(使用者路徑走 RLS 直接寫表)');
select is(has_function_privilege('anon', 'public.fn_checklist_items_normalize(jsonb)', 'execute'), false,
  'anon 不可執行正規化函式');

-- ── 2. fixtures:A 案三方＋admin(非正式模式,admin_override 有效);B 案外人 ──────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c7100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ct-con@example.test', '', now(), '{}', '{"full_name":"廠商品管","org_type":"contractor"}', now(), now()),
  ('c7100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ct-sup@example.test', '', now(), '{}', '{"full_name":"監造工程師","org_type":"supervisor"}', now(), now()),
  ('c7100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ct-own@example.test', '', now(), '{}', '{"full_name":"機關承辦","org_type":"owner"}', now(), now()),
  ('c7100000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ct-out@example.test', '', now(), '{}', '{"full_name":"外案廠商","org_type":"contractor"}', now(), now()),
  ('c7100000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ct-admin@example.test', '', now(), '{}', '{"full_name":"技術管理","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode) values
  ('c7200000-0000-0000-0000-00000000000a', '範本測試案', '機關', '廠商', '監造', 'c7100000-0000-0000-0000-000000000005', false),
  ('c7200000-0000-0000-0000-00000000000b', '外案', '機關', '廠商', '監造', 'c7100000-0000-0000-0000-000000000005', false);
alter table public.projects enable trigger on_project_created;
insert into public.project_members (project_id, user_id, role) values
  ('c7200000-0000-0000-0000-00000000000a', 'c7100000-0000-0000-0000-000000000001', 'member'),
  ('c7200000-0000-0000-0000-00000000000a', 'c7100000-0000-0000-0000-000000000002', 'member'),
  ('c7200000-0000-0000-0000-00000000000a', 'c7100000-0000-0000-0000-000000000003', 'member'),
  ('c7200000-0000-0000-0000-00000000000a', 'c7100000-0000-0000-0000-000000000005', 'admin'),
  ('c7200000-0000-0000-0000-00000000000b', 'c7100000-0000-0000-0000-000000000004', 'member');
insert into public.work_items (id, project_id, item_key, item_no, description, unit, quantity, unit_price, amount, is_leaf, sort_order) values
  ('c7300000-0000-0000-0000-000000000001', 'c7200000-0000-0000-0000-00000000000a', 'W1', '壹.一.1', '場鑄結構用混凝土', 'M3', 100, 3000, 300000, true, 1),
  ('c7300000-0000-0000-0000-000000000002', 'c7200000-0000-0000-0000-00000000000a', 'W2', '壹.一.2', '鋼筋組立', 'TON', 50, 30000, 1500000, true, 2),
  ('c7300000-0000-0000-0000-00000000000b', 'c7200000-0000-0000-0000-00000000000b', 'WB', '壹.一.1', '外案工項', 'M3', 1, 1, 1, true, 1);

-- ── 3. 三角色＋非成員:誰能建立哪一種範本 ────────────────────────────────────────
select pg_temp.become('c7100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-000000000001','c7200000-0000-0000-0000-00000000000a','混凝土 自主檢查表','self_check',pg_temp.items_ok()) $$,
  '廠商可建立自主檢查表範本(既有 can_write 權限)');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000f1','c7200000-0000-0000-0000-00000000000a','混凝土 查驗表','inspection_form',pg_temp.items_ok()) $$,
  'CT006', '監造查驗表單範本只有監造成員可建立或編輯', '廠商不能建立監造查驗表單範本 → CT006');
reset role;

select pg_temp.become('c7100000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-000000000002','c7200000-0000-0000-0000-00000000000a','混凝土 查驗表','inspection_form',pg_temp.items_ok(),
       '{"work_item_ids":["c7300000-0000-0000-0000-000000000001"],"keywords":["  混凝土  ","澆置","混凝土"]}'::jsonb, '  澆置前  ', 'ITP 3.1') $$,
  '監造可建立監造查驗表單範本(kind／適用條件／查驗階段一起登錄)');
select lives_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-000000000003','c7200000-0000-0000-0000-00000000000a','鋼筋 自主檢查表','self_check',pg_temp.items_ok()) $$,
  '監造也能建立自主檢查表範本(can_write 未縮)');
reset role;

select pg_temp.become('c7100000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000f2','c7200000-0000-0000-0000-00000000000a','機關的範本','self_check',pg_temp.items_ok()) $$,
  '42501', null, '機關(非 admin)不能建立範本 → RLS 擋下');
reset role;

select pg_temp.become('c7100000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000f3','c7200000-0000-0000-0000-00000000000a','外人的範本','self_check',pg_temp.items_ok()) $$,
  '42501', null, '非成員不能建立 A 案範本 → RLS 擋下');
reset role;

select pg_temp.become('c7100000-0000-0000-0000-000000000005');
set local role authenticated;
select lives_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-000000000004','c7200000-0000-0000-0000-00000000000a','模板 查驗表','inspection_form',pg_temp.items_ok()) $$,
  '專案 admin(非正式模式)可建立查驗表單範本(admin_override,不是新角色)');
reset role;

-- ── 4. 正規化結果 ───────────────────────────────────────────────────────────────
select is((pg_temp.tpl('c7400000-0000-0000-0000-000000000002')).stage_key, '澆置前', '查驗階段去頭尾空白');
select is((pg_temp.tpl('c7400000-0000-0000-0000-000000000002')).applies_to,
  jsonb_build_object('work_item_ids', jsonb_build_array('c7300000-0000-0000-0000-000000000001'),
                     'keywords', jsonb_build_array('混凝土', '澆置')),
  '適用條件去空白、去重、排序');
select is((pg_temp.tpl('c7400000-0000-0000-0000-000000000002')).items -> 1,
  '{"no":"A2","item":"坍度","kind":"num","unit":"cm","min":15.5,"max":20.5}'::jsonb,
  '檢查項目只保留已知鍵、型別維持數字');
select is((pg_temp.tpl('c7400000-0000-0000-0000-000000000001')).applies_to, null, '沒填適用條件 → null(不是空物件)');

-- ── 5. kind 與 stage_key 的約束 ──────────────────────────────────────────────────
select pg_temp.become('c7100000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000f4','c7200000-0000-0000-0000-00000000000a','帶階段的自檢表','self_check',pg_temp.items_ok(),null,'澆置前') $$,
  'CT010', null, '自主檢查表範本不得指定查驗階段 → CT010');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000f5','c7200000-0000-0000-0000-00000000000a','怪用途','audit_form',pg_temp.items_ok()) $$,
  '23514', null, 'kind 只能是三個列舉值(欄位 check)');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000f6','c7200000-0000-0000-0000-00000000000a','   ','inspection_form',pg_temp.items_ok()) $$,
  'CT010', '範本必須有標題', '標題全空白 → CT010');

-- ── 6. applies_to 的結構約束 ────────────────────────────────────────────────────
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000e1','c7200000-0000-0000-0000-00000000000a','A','inspection_form',pg_temp.items_ok(),'"文字"'::jsonb) $$,
  'CT010', '適用條件(applies_to)必須是 JSON 物件', 'applies_to 非物件 → CT010');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000e2','c7200000-0000-0000-0000-00000000000a','A','inspection_form',pg_temp.items_ok(),'{"any":true}'::jsonb) $$,
  'CT010', null, 'applies_to 不認得的鍵 → CT010(不默默忽略)');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000e3','c7200000-0000-0000-0000-00000000000a','A','inspection_form',pg_temp.items_ok(),'{"work_item_ids":"x"}'::jsonb) $$,
  'CT010', '適用工項(work_item_ids)必須是陣列', 'work_item_ids 非陣列 → CT010');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000e4','c7200000-0000-0000-0000-00000000000a','A','inspection_form',pg_temp.items_ok(),'{"work_item_ids":["W1"]}'::jsonb) $$,
  'CT010', null, 'work_item_ids 不是 uuid → CT010');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000e5','c7200000-0000-0000-0000-00000000000a','A','inspection_form',pg_temp.items_ok(),
       '{"work_item_ids":["c7300000-0000-0000-0000-00000000000b"]}'::jsonb) $$,
  'CT010', '適用工項必須是本專案的工項', '跨案工項 → CT010(候選推斷不會挑到別案範本)');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000e6','c7200000-0000-0000-0000-00000000000a','A','inspection_form',pg_temp.items_ok(),'{"keywords":{"a":1}}'::jsonb) $$,
  'CT010', '關鍵字(keywords)必須是陣列', 'keywords 非陣列 → CT010');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000e7','c7200000-0000-0000-0000-00000000000a','A','inspection_form',pg_temp.items_ok(),'{"keywords":[3]}'::jsonb) $$,
  'CT010', '關鍵字必須是文字', 'keywords 元素非字串 → CT010');
select lives_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-000000000005','c7200000-0000-0000-0000-00000000000a','全空適用條件','inspection_form',pg_temp.items_ok(),'{"keywords":["  "]}'::jsonb) $$,
  '關鍵字全空白 → 收下但正規化');
reset role;
select is((pg_temp.tpl('c7400000-0000-0000-0000-000000000005')).applies_to, null, '適用條件全空 → 存成 null');

-- ── 7. items 的結構約束 ─────────────────────────────────────────────────────────
select pg_temp.become('c7100000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000d1','c7200000-0000-0000-0000-00000000000a','A','inspection_form','{"a":1}'::jsonb) $$,
  'CT010', '檢查項目(items)必須是陣列', 'items 非陣列 → CT010');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000d2','c7200000-0000-0000-0000-00000000000a','A','inspection_form','[{"item":"沒有項次"}]'::jsonb) $$,
  'CT010', '每個檢查項目都必須有項次(no)', '項目缺 no → CT010');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000d3','c7200000-0000-0000-0000-00000000000a','A','inspection_form',
       '[{"no":"A1","item":"甲"},{"no":"A1","item":"乙"}]'::jsonb) $$,
  'CT010', '檢查項目的項次「A1」重複', '項次重複 → CT010(results 會對不起來)');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000d4','c7200000-0000-0000-0000-00000000000a','A','inspection_form','[{"no":"A1","item":"   "}]'::jsonb) $$,
  'CT010', null, '項目缺檢查內容 → CT010');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000d5','c7200000-0000-0000-0000-00000000000a','A','inspection_form','[{"no":"A1","item":"甲","kind":"text"}]'::jsonb) $$,
  'CT010', null, '檢查方式非 num／bool → CT010');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000d6','c7200000-0000-0000-0000-00000000000a','A','inspection_form','[{"no":"A1","item":"坍度","kind":"num"}]'::jsonb) $$,
  'CT010', null, '實測值項目沒有上下限 → CT010(判定不出來)');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000d7','c7200000-0000-0000-0000-00000000000a','A','inspection_form',
       '[{"no":"A1","item":"坍度","kind":"num","min":20,"max":10}]'::jsonb) $$,
  'CT010', null, '下限大於上限 → CT010');
select throws_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-0000000000d8','c7200000-0000-0000-0000-00000000000a','A','inspection_form',
       '[{"no":"A1","item":"坍度","kind":"num","min":"15"}]'::jsonb) $$,
  'CT010', null, '上下限不是數字 → CT010');
select lives_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-000000000006','c7200000-0000-0000-0000-00000000000a','預設勾選','inspection_form',
       '[{"no":" A1 ","item":" 目視 ","zzz":"未知鍵"}]'::jsonb) $$,
  '沒寫 kind 的項目收下(預設勾選)');
reset role;
select is((pg_temp.tpl('c7400000-0000-0000-0000-000000000006')).items,
  '[{"no":"A1","item":"目視","kind":"bool"}]'::jsonb, 'kind 預設 bool、去空白、未知鍵丟掉');

-- ── 8. version 由伺服器編號 ─────────────────────────────────────────────────────
select is((pg_temp.tpl('c7400000-0000-0000-0000-000000000002')).version, 1, '第一張「混凝土 查驗表」是第 1 版');
select pg_temp.become('c7100000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-000000000007','c7200000-0000-0000-0000-00000000000a','混凝土 查驗表','inspection_form',pg_temp.items_ok(),null,null,null,99) $$,
  '同名範本可再建一張(＝更正已用過的範本的正途)');
reset role;
select is((pg_temp.tpl('c7400000-0000-0000-0000-000000000007')).version, 2, '同案同用途同標題 → 版本自動 +1(前端送的 99 不算數)');

-- ── 9. 已被引用的範本:內容不可改、不可刪 ────────────────────────────────────────
-- service(無 JWT)寫入既有事實列:自主檢查紀錄引用 self_check 範本、查驗引用查驗表單範本
select pg_temp.become(null);
insert into public.checklist_records (id, project_id, template_id, check_date, location, results, overall)
  values ('c7500000-0000-0000-0000-000000000001', 'c7200000-0000-0000-0000-00000000000a',
          'c7400000-0000-0000-0000-000000000001', '2026-09-18', '3F', '{"A1":{"value":true}}', '合格');
insert into public.inspections (id, project_id, title, status, template_id)
  values ('c7600000-0000-0000-0000-000000000001', 'c7200000-0000-0000-0000-00000000000a', '3F 柱牆查驗', '待查驗',
          'c7400000-0000-0000-0000-000000000002');

select pg_temp.become('c7100000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$ update public.checklist_templates set title = '改過的標題' where id = 'c7400000-0000-0000-0000-000000000001' $$,
  'CT008', null, '已有檢查紀錄引用 → 不可改標題(列印與呈現是即時讀範本的)');
select throws_ok(
  $$ update public.checklist_templates set items = '[{"no":"A1","item":"放寬後的項目"}]'::jsonb where id = 'c7400000-0000-0000-0000-000000000001' $$,
  'CT008', null, '已有檢查紀錄引用 → 不可改檢查項目');
select lives_ok(
  $$ update public.checklist_templates set applies_to = '{"keywords":["混凝土"]}'::jsonb where id = 'c7400000-0000-0000-0000-000000000001' $$,
  '已使用的範本仍可調整適用條件(只影響日後候選推斷,不改既有紀錄的呈現)');
select throws_ok(
  $$ delete from public.checklist_templates where id = 'c7400000-0000-0000-0000-000000000001' $$,
  'CT008', null, '已有檢查紀錄引用 → 不可刪(cascade 會連檢查紀錄一起刪掉)');
reset role;
select is((pg_temp.tpl('c7400000-0000-0000-0000-000000000001')).version, 1, '被引用的範本版本不被 UPDATE 改動');
select is((select count(*)::int from public.checklist_records where id = 'c7500000-0000-0000-0000-000000000001'), 1,
  '檢查紀錄沒有被 cascade 掉');

select pg_temp.become('c7100000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  $$ update public.checklist_templates set items = '[{"no":"Z","item":"放水"}]'::jsonb where id = 'c7400000-0000-0000-0000-000000000002' $$,
  'CT008', null, '已被查驗引用的查驗表單範本 → 不可改檢查項目');
select throws_ok(
  $$ delete from public.checklist_templates where id = 'c7400000-0000-0000-0000-000000000002' $$,
  'CT008', null, '已被查驗引用 → 不可刪');
-- 未使用的範本:可改可刪
select lives_ok(
  $$ update public.checklist_templates set title = '模板 查驗表（修訂）', stage_key = '拆模前' where id = 'c7400000-0000-0000-0000-000000000004' $$,
  '沒被引用的範本可以就地編輯');
select lives_ok(
  $$ delete from public.checklist_templates where id = 'c7400000-0000-0000-0000-000000000006' $$,
  '沒被引用的範本可以刪除');
reset role;
select is(pg_temp.tpl_count('c7400000-0000-0000-0000-000000000006'), 0, '刪除確實生效');
select is((pg_temp.tpl('c7400000-0000-0000-0000-000000000004')).stage_key, '拆模前', '編輯後的階段鍵存下來');

-- 廠商不能改監造查驗表單範本(kind 是誰的文書就由誰維護)
select pg_temp.become('c7100000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$ update public.checklist_templates set applies_to = null where id = 'c7400000-0000-0000-0000-000000000004' $$,
  'CT006', '監造查驗表單範本只有監造成員可建立或編輯', '廠商不能編輯查驗表單範本 → CT006');
select throws_ok(
  $$ update public.checklist_templates set kind = 'inspection_form' where id = 'c7400000-0000-0000-0000-000000000003' $$,
  'CT006', null, '廠商不能把自檢表範本改成查驗表單範本 → CT006');
reset role;

-- ── 10. service 路徑(遷移／Edge)不被 guard 的權限條款擋,但一樣正規化 ──────────────
select pg_temp.become(null);
select lives_ok(
  $$ select pg_temp.mk('c7400000-0000-0000-0000-000000000008','c7200000-0000-0000-0000-00000000000a','service 建的查驗表','inspection_form',
       '[{"no":" S1 ","item":" 服務 "}]'::jsonb, '{"keywords":[" 鋼筋 "]}'::jsonb, ' 綁紮後 ') $$,
  'service(無 JWT)可建立查驗表單範本(遷移／Edge 路徑不受組織別限制)');
select is((pg_temp.tpl('c7400000-0000-0000-0000-000000000008')).applies_to, '{"keywords":["鋼筋"]}'::jsonb,
  'service 路徑一樣走正規化');
select is((pg_temp.tpl('c7400000-0000-0000-0000-000000000008')).stage_key, '綁紮後', 'service 路徑的階段鍵一樣正規化');

select * from finish();
rollback;
