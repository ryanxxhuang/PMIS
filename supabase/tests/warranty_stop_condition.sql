-- P5e 保固類循環義務的停止條件(pgTAP)。對應 migration 20260920021500_warranty_stop_condition.sql。
-- 釘七件事:1) 保固期滿日的唯一日期規則(始日不算入、月底無相當日取月末、閏年、跨年、以日計;不受 session 時區影響)
-- ——案例與共用 fixture tests/fixtures/ball-in-court.cases.json 的 warranty.expiry_cases 同一組(Vitest 釘住兩邊一致);
-- 2) 兩項齊全(正式驗收合格日＋引用本案已確認條文的保固期間)才計算,缺任一項不產生期次、列缺哪一項(文字與共用規則同口徑);
-- 3) 保固類期次只在保固期間:起算＝合格日、只產生到期滿日(期間起日 ≤ 期滿日),不看觸發點;非保固類不受影響;
-- 4) 保固期間更正留版(changed_keys warranty_term、warranty 快照、effects),只重算沒動過的待辦期,動過的保留並記 kept;
-- 5) 驗收日更正／改不合格／引用條文被取代 → 只移除／補回沒動過的待辦期,歷史不變;
-- 6) guard 與權限:只能引用本案 approved 條文、期間與條文成對、非管理者不可改、直接 REST 同樣受 guard 與留版;
--    RPC get_project_warranty 成員與 service 可讀、非成員／anon 不可;
-- 7) 義務類別在保固／非保固間變動視同規則變更。
begin;

select plan(105);

-- ── 結構與授權 ──────────────────────────────────────────────────────────────
select has_column('public', 'projects', 'warranty_term_value', '專案有保固期間數值欄');
select has_column('public', 'projects', 'warranty_term_unit', '專案有保固期間單位欄');
select has_column('public', 'projects', 'warranty_source_requirement_id', '專案有保固期間引用條文欄');
select has_column('public', 'project_anchor_versions', 'warranty', '版本列有保固期間快照欄');
select has_trigger('public', 'projects', 'projects_warranty_term_guard', '保固期間 guard 掛上');
select has_trigger('public', 'requirements', 'requirements_warranty_source_sync', '引用條文狀態變更同步期次 trigger 掛上');
select is(has_function_privilege('authenticated', 'public.get_project_warranty(uuid)', 'EXECUTE'), true, 'authenticated 可讀保固事實 RPC');
select is(has_function_privilege('anon', 'public.get_project_warranty(uuid)', 'EXECUTE'), false, 'anon 不可讀保固事實 RPC');
select is(has_function_privilege('service_role', 'public.get_project_warranty(uuid)', 'EXECUTE'), true, 'service_role 可讀(早報／Agent 收集器)');
select is(has_function_privilege('authenticated', 'public.fn_project_warranty(uuid)', 'EXECUTE')
  or has_function_privilege('authenticated', 'public.fn_warranty_expiry(date, integer, text)', 'EXECUTE')
  or has_function_privilege('authenticated', 'public.fn_warranty_bound_of(uuid, date, jsonb)', 'EXECUTE'), false, '內部函式不對 authenticated 開放');

-- ── 1. 保固期滿日的日期規則(與共用 fixture warranty.expiry_cases 同一組)──────────────────────
select is(public.fn_warranty_expiry('2025-03-15', 2, 'year'), '2027-03-15'::date, 'expiry:2025-03-15＋2 年 → 2027-03-15(相當日之前一日)');
select is(public.fn_warranty_expiry('2025-04-30', 1, 'month'), '2025-05-31'::date, 'expiry:2025-04-30＋1 個月 → 2025-05-31(次日為月初,末日為月末)');
select is(public.fn_warranty_expiry('2025-01-30', 1, 'month'), '2025-02-28'::date, 'expiry:2025-01-30＋1 個月 → 2025-02-28(無相當日取月末)');
select is(public.fn_warranty_expiry('2024-01-28', 1, 'month'), '2024-02-28'::date, 'expiry:2024-01-28＋1 個月 → 2024-02-28(閏年有相當日 29 日)');
select is(public.fn_warranty_expiry('2025-01-28', 1, 'month'), '2025-02-28'::date, 'expiry:2025-01-28＋1 個月 → 2025-02-28(平年無相當日 29 日)');
select is(public.fn_warranty_expiry('2023-02-28', 1, 'year'), '2024-02-29'::date, 'expiry:2023-02-28＋1 年 → 2024-02-29(始日不算入,跨閏年)');
select is(public.fn_warranty_expiry('2024-02-29', 1, 'year'), '2025-02-28'::date, 'expiry:2024-02-29＋1 年 → 2025-02-28');
select is(public.fn_warranty_expiry('2025-12-31', 2, 'year'), '2027-12-31'::date, 'expiry:2025-12-31＋2 年 → 2027-12-31(跨年月底)');
select is(public.fn_warranty_expiry('2025-08-31', 6, 'month'), '2026-02-28'::date, 'expiry:2025-08-31＋6 個月 → 2026-02-28');
select is(public.fn_warranty_expiry('2025-03-15', 180, 'day'), '2025-09-11'::date, 'expiry:2025-03-15＋180 日 → 2025-09-11');
select is(public.fn_warranty_expiry(null, 2, 'year'), null, '缺合格日 → null');
select is(public.fn_warranty_expiry('2025-03-15', null, null), null, '缺期間 → null');
select is(public.fn_warranty_expiry('2025-03-15', 2, 'week'), null, '未知單位 → null(不臆測)');
set local timezone to 'Pacific/Kiritimati';
select is(public.fn_warranty_expiry('2025-04-30', 1, 'month')::text || ',' || public.fn_warranty_expiry('2023-02-28', 1, 'year')::text,
  '2025-05-31,2024-02-29', '時區:session 換成 UTC+14 結果不變(純 date 運算)');
set local timezone to 'America/Los_Angeles';
select is(public.fn_warranty_expiry('2025-01-30', 1, 'month')::text || ',' || public.fn_warranty_expiry('2025-12-31', 2, 'year')::text,
  '2025-02-28,2027-12-31', '時區:session 換成 UTC-8 結果不變');
reset timezone;

-- ── 2. 缺口文字(與 _shared/ballInCourtRules.ts warrantyGap 同口徑;fixture warranty.scenarios 的 gap)──────
select is(public.fn_warranty_gap_text(null, null, false), '缺正式驗收合格日、缺契約保固期間，無法判定保固期滿日', 'gap:兩項皆缺');
select is(public.fn_warranty_gap_text('2025-03-15', null, false), '缺契約保固期間，無法判定保固期滿日', 'gap:缺保固期間');
select is(public.fn_warranty_gap_text(null, 2, true), '缺正式驗收合格日，無法判定保固期滿日', 'gap:缺合格日');
select is(public.fn_warranty_gap_text('2025-03-15', 2, false), '保固期間引用的契約條文已不是已確認狀態，無法判定保固期滿日', 'gap:引用條文失效');
select is(public.fn_warranty_gap_text('2025-03-15', 2, true), null, 'gap:兩項齊全 → 無缺口');
select is(public.fn_obligation_recurrence_stop_gap('保固', '2026-12-31', '2026-08-24', '2026-09-20'), '缺正式驗收合格日、缺契約保固期間，無法判定保固期滿日',
  '停止條件:保固類不看竣工日,未帶保固事實=兩項皆缺');
select is(public.fn_obligation_recurrence_stop_gap('保固', null, null, '2026-09-20', '{"acceptance_date": "2025-03-15", "term_value": 2, "source_ok": true}'::jsonb), null,
  '停止條件:保固類兩項齊全 → 無缺口(竣工日缺也不影響)');
select is(public.fn_obligation_recurrence_stop_gap('施工中', null, null, '2026-09-20', '{"acceptance_date": "2025-03-15", "term_value": 2, "source_ok": true}'::jsonb), '缺竣工日，無法判定循環何時結束',
  '停止條件:非保固類不看保固事實(P5c 規則不變)');

-- ── 測試資料 ──────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c5e00000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5e-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('c5e00000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5e-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('c5e00000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5e-outsider@example.test', '', now(), '{}',
   '{"full_name":"Outsider","org_type":"owner"}', now(), now()),
  ('c5e00000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5e-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, commencement_date, end_date)
values
  ('c5e10000-0000-0000-0000-000000000001', '保固停止條件測試案', '機關', '廠商', '監造', 'c5e00000-0000-0000-0000-0000000000a5', '2023-01-10', '2023-12-31'),
  ('c5e10000-0000-0000-0000-000000000002', '別案', '機關', '廠商', '監造', 'c5e00000-0000-0000-0000-0000000000a4', '2023-01-10', '2023-12-31');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('c5e10000-0000-0000-0000-000000000001', 'c5e00000-0000-0000-0000-0000000000a1', 'member'),
  ('c5e10000-0000-0000-0000-000000000001', 'c5e00000-0000-0000-0000-0000000000a3', 'member'),
  ('c5e10000-0000-0000-0000-000000000001', 'c5e00000-0000-0000-0000-0000000000a5', 'admin'),
  ('c5e10000-0000-0000-0000-000000000002', 'c5e00000-0000-0000-0000-0000000000a4', 'admin');

-- 條文:C1 保固期間(已確認)、C2 同案待確認、C3 別案已確認;W 保固每月 10 日巡檢(觸發點刻意設開工)、N 施工中每月 5 日
insert into public.requirements (id, project_id, title, requirement_type, lifecycle_phase, status, origin) values
  ('c5e20000-0000-0000-0000-0000000000c1', 'c5e10000-0000-0000-0000-000000000001', '保固期間自驗收合格日起 1 年', 'other', '保固', 'approved', 'manual'),
  ('c5e20000-0000-0000-0000-0000000000c2', 'c5e10000-0000-0000-0000-000000000001', '植栽保固 6 個月(待確認)', 'other', '保固', 'needs_review', 'manual'),
  ('c5e20000-0000-0000-0000-0000000000c3', 'c5e10000-0000-0000-0000-000000000002', '別案保固 2 年', 'other', '保固', 'approved', 'manual'),
  ('c5e20000-0000-0000-0000-0000000000c4', 'c5e10000-0000-0000-0000-000000000001', '保固期間每月巡檢', 'deadline', '保固', 'approved', 'manual'),
  ('c5e20000-0000-0000-0000-0000000000c5', 'c5e10000-0000-0000-0000-000000000001', '每月施工月報', 'deadline', '施工中', 'approved', 'manual');
insert into public.contract_obligations (id, project_id, requirement_id, title, category, responsible, status, trigger_event, recurring, recurring_day) values
  ('c5e30000-0000-0000-0000-0000000000f1', 'c5e10000-0000-0000-0000-000000000001', 'c5e20000-0000-0000-0000-0000000000c4', '保固期間每月巡檢', '保固', '廠商', '待辦', 'commencement', 'monthly', 10),
  ('c5e30000-0000-0000-0000-0000000000f2', 'c5e10000-0000-0000-0000-000000000001', 'c5e20000-0000-0000-0000-0000000000c5', '每月施工月報', '施工中', '廠商', '待辦', null, 'monthly', 5);

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;
create or replace function pg_temp.keys(ob uuid) returns text language sql as $$
  select coalesce(string_agg(period_key, ',' order by period_key), '') from public.obligation_periods where obligation_id = ob
$$;
create or replace function pg_temp.period_id(ob uuid, k text) returns uuid language sql as $$
  select id from public.obligation_periods where obligation_id = ob and period_key = k
$$;
create or replace function pg_temp.w() returns jsonb language sql as $$
  select public.fn_project_warranty('c5e10000-0000-0000-0000-000000000001')
$$;
create or replace function pg_temp.latest() returns public.project_anchor_versions language sql as $$
  select * from public.project_anchor_versions where project_id = 'c5e10000-0000-0000-0000-000000000001' order by version_no desc limit 1
$$;
create or replace function pg_temp.effects(kind text) returns text language sql as $$
  select coalesce(string_agg(e ->> 'period_key', ',' order by e ->> 'period_key'), '')
  from jsonb_array_elements((pg_temp.latest()).effects) e
  where e ->> 'kind' = kind and (e ->> 'obligation_id')::uuid = 'c5e30000-0000-0000-0000-0000000000f1'
$$;

-- ── 2'. 兩項皆缺:不產生、列兩項 ─────────────────────────────────────────────────
select is(pg_temp.keys('c5e30000-0000-0000-0000-0000000000f1'), '', '兩項皆缺 → 保固類不產生期次');
select ok(pg_temp.keys('c5e30000-0000-0000-0000-0000000000f2') <> '', '非保固類照 P5c 產生(對照)');
select is(pg_temp.w() -> 'needs', '["acceptance", "term"]'::jsonb, 'needs=[acceptance, term]');
select is(pg_temp.w() ->> 'gap', '缺正式驗收合格日、缺契約保固期間，無法判定保固期滿日', 'gap:兩項皆缺');
select is(pg_temp.w() ->> 'expiry', null, 'expiry 不計算');
select is(public.fn_obligation_recurrence_stop_gap('保固', '2023-12-31', null, '2026-09-20', pg_temp.w()), pg_temp.w() ->> 'gap', 'DB 停止條件與保固事實同一句');

-- 只有正式驗收合格(缺保固期間):仍不產生
insert into public.acceptance_events (id, project_id, stage_key, event_date, result) values
  ('c5e40000-0000-0000-0000-0000000000e1', 'c5e10000-0000-0000-0000-000000000001', 'final', '2024-03-15', '合格');
select is(pg_temp.keys('c5e30000-0000-0000-0000-0000000000f1'), '', '只有合格日、缺保固期間 → 仍不產生');
select is(pg_temp.w() -> 'needs', '["term"]'::jsonb, 'needs=[term]');
select is((pg_temp.w() ->> 'acceptance_date') || '/' || (pg_temp.w() ->> 'acceptance_event_id'), '2024-03-15/c5e40000-0000-0000-0000-0000000000e1', '合格日與驗收事件都記下');

-- ── 6. guard 與權限 ─────────────────────────────────────────────────────────────
select pg_temp.become('c5e00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok($$ select public.update_project_anchors('c5e10000-0000-0000-0000-000000000001', '{"warranty_term_value": 1, "warranty_term_unit": "year", "warranty_source_requirement_id": "c5e20000-0000-0000-0000-0000000000c1"}'::jsonb, 'edit', null, null, null, null) $$,
  'P0001', '未生效:僅專案管理者可修改基準日', '非管理者(廠商成員)不可登錄保固期間');
select is((select count(*)::int from (select 1 from public.projects where id = 'c5e10000-0000-0000-0000-000000000001') x), 1, '成員看得到專案(對照)');
update public.projects set warranty_term_value = 5, warranty_term_unit = 'year', warranty_source_requirement_id = 'c5e20000-0000-0000-0000-0000000000c1'
  where id = 'c5e10000-0000-0000-0000-000000000001';
reset role;
select is((select warranty_term_value from public.projects where id = 'c5e10000-0000-0000-0000-000000000001'), null, '非管理者直接 REST 改 → RLS 0 列,值不變');
select pg_temp.become('c5e00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select throws_ok($$ select public.update_project_anchors('c5e10000-0000-0000-0000-000000000001', '{"warranty_term_value": 6, "warranty_term_unit": "month", "warranty_source_requirement_id": "c5e20000-0000-0000-0000-0000000000c2"}'::jsonb, 'edit', null, null, null, null) $$,
  'P0001', null, '引用待確認條文 → 拒');
select throws_ok($$ select public.update_project_anchors('c5e10000-0000-0000-0000-000000000001', '{"warranty_term_value": 2, "warranty_term_unit": "year", "warranty_source_requirement_id": "c5e20000-0000-0000-0000-0000000000c3"}'::jsonb, 'edit', null, null, null, null) $$,
  'P0001', '引用的契約條文不存在、不屬於本案或你無權查閱', '引用別案條文 → 拒');
select throws_ok($$ select public.update_project_anchors('c5e10000-0000-0000-0000-000000000001', '{"warranty_term_value": 1, "warranty_term_unit": "year"}'::jsonb, 'edit', null, null, null, null) $$,
  'P0001', '保固期間須引用已確認的契約條文(契約載明的保固期間)', '有期間沒引用條文 → 拒');
select throws_ok($$ select public.update_project_anchors('c5e10000-0000-0000-0000-000000000001', '{"warranty_source_requirement_id": "c5e20000-0000-0000-0000-0000000000c1"}'::jsonb, 'edit', null, null, null, null) $$,
  'P0001', '未登錄保固期間時不可單獨引用契約條文', '只引用條文沒有期間 → 拒');
select throws_ok($$ select public.update_project_anchors('c5e10000-0000-0000-0000-000000000001', '{"warranty_term_value": 1, "warranty_term_unit": "week", "warranty_source_requirement_id": "c5e20000-0000-0000-0000-0000000000c1"}'::jsonb, 'edit', null, null, null, null) $$,
  'P0001', '保固期間單位必須是 year／month／day', '未知單位 → 拒');
select throws_ok($$ select public.update_project_anchors('c5e10000-0000-0000-0000-000000000001', '{"warranty_term_value": 1.5, "warranty_term_unit": "year", "warranty_source_requirement_id": "c5e20000-0000-0000-0000-0000000000c1"}'::jsonb, 'edit', null, null, null, null) $$,
  'P0001', '保固期間數值必須是正整數或 null', '非整數期間 → 拒');
select throws_ok($$ select public.update_project_anchors('c5e10000-0000-0000-0000-000000000001', '{"warranty_term_value": 0, "warranty_term_unit": "year", "warranty_source_requirement_id": "c5e20000-0000-0000-0000-0000000000c1"}'::jsonb, 'edit', null, null, null, null) $$,
  '23514', null, '期間 0 → check 拒');
select throws_ok($$ update public.projects set warranty_term_value = 1, warranty_term_unit = 'year', warranty_source_requirement_id = 'c5e20000-0000-0000-0000-0000000000c2' where id = 'c5e10000-0000-0000-0000-000000000001' $$,
  'P0001', null, '管理者直接 REST 引用待確認條文 → guard 同樣拒(不可繞過)');
reset role;
select is(pg_temp.keys('c5e30000-0000-0000-0000-0000000000f1'), '', '被拒的寫入沒有留下任何期次');

-- ── 3/4. 登錄保固期間(兩項齊全)→ 只在保固期間產生、留版與依據 ─────────────────────────────
select pg_temp.become('c5e00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select ok((select version_no from public.update_project_anchors('c5e10000-0000-0000-0000-000000000001',
  '{"warranty_term_value": 1, "warranty_term_unit": "year", "warranty_source_requirement_id": "c5e20000-0000-0000-0000-0000000000c1"}'::jsonb,
  'edit', '依契約保固條款登錄', '契約第 16 條', null, null)) is not null, '管理者登錄保固期間 1 年(引用已確認條文)→ 留一版');
reset role;
select is((select array_to_string(changed_keys, ',') || '/' || change_kind || '/' || source_ref from pg_temp.latest()), 'warranty_term/edit/契約第 16 條', '版本:changed_keys=warranty_term、依據函文');
select is((pg_temp.latest()).warranty, '{"term_unit": "year", "term_value": 1, "source_requirement_id": "c5e20000-0000-0000-0000-0000000000c1"}'::jsonb, '版本記保固期間快照(含引用條文)');
select is((pg_temp.latest()).anchors, '{"award_date": null, "notice_date": null, "commencement_date": "2023-01-10", "end_date": "2023-12-31"}'::jsonb, '版本的四日期快照形狀不變(保固期間另存)');
select is(pg_temp.w() ->> 'expiry', '2025-03-15', '保固期滿日＝2024-03-15＋1 年＝2025-03-15');
select is(pg_temp.w() -> 'needs', '[]'::jsonb, '兩項齊全 → 無缺口');
select is((pg_temp.w() ->> 'source_ok') || '/' || (pg_temp.w() ->> 'source_status'), 'true/approved', '引用條文狀態 approved');
select is(pg_temp.keys('c5e30000-0000-0000-0000-0000000000f1'), '2024-04,2024-05,2024-06,2024-07,2024-08,2024-09,2024-10,2024-11,2024-12,2025-01,2025-02,2025-03',
  '期次只在保固期間:起於合格日後第一個到期日(2024-03-10 早於合格日不列)、止於期滿日所在期(不看開工觸發點)');
select is(pg_temp.effects('added'), '2024-04,2024-05,2024-06,2024-07,2024-08,2024-09,2024-10,2024-11,2024-12,2025-01,2025-02,2025-03', '版本 effects 記新增的期');
select is((select basis ->> 'anchor_key' || '/' || (basis ->> 'anchor_date') || '/' || (basis ->> 'bound_date') || '/' || (basis ->> 'bound_kind') || '/' || (basis -> 'warranty' ->> 'term_value') || (basis -> 'warranty' ->> 'term_unit') || '/' || (basis -> 'warranty' ->> 'source_requirement_id')
  from public.obligation_periods where id = pg_temp.period_id('c5e30000-0000-0000-0000-0000000000f1', '2024-04')),
  'acceptance_pass_date/2024-03-15/2025-03-15/warranty_expiry/1year/c5e20000-0000-0000-0000-0000000000c1', '期次依據記合格日、期滿日、保固期間與引用條文');
select is((select anchor_version_no from public.obligation_periods where id = pg_temp.period_id('c5e30000-0000-0000-0000-0000000000f1', '2024-04')), (pg_temp.latest()).version_no, '期次蓋登錄保固期間那一版');
select is((select count(*)::int from jsonb_array_elements((pg_temp.latest()).effects) e where (e ->> 'obligation_id')::uuid = 'c5e30000-0000-0000-0000-0000000000f2'), 0, '非保固類義務不受保固期間變更影響');
select is(public.materialize_all_obligation_periods(), 0, '每日推進不越過保固期滿日(0 新增)');

-- 動過兩期:2024-06 已完成、2025-02 已提送
select pg_temp.become('c5e00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5e30000-0000-0000-0000-0000000000f1', '2024-06'), '已完成') $$, '廠商標 2024-06 已完成');
select lives_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5e30000-0000-0000-0000-0000000000f1', '2025-02'), '已提送') $$, '廠商標 2025-02 已提送');
reset role;

-- 保固期間更正為 6 個月(期滿 2024-09-15)→ 只移除沒動過的待辦期,已提送的 2025-02 保留並記 kept
select pg_temp.become('c5e00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select ok((select version_no from public.update_project_anchors('c5e10000-0000-0000-0000-000000000001',
  '{"warranty_term_value": 6, "warranty_term_unit": "month", "warranty_source_requirement_id": "c5e20000-0000-0000-0000-0000000000c1"}'::jsonb,
  'edit', '保固期間更正', null, null, null)) is not null, '保固期間更正為 6 個月 → 留一版');
reset role;
select is(pg_temp.w() ->> 'expiry', '2024-09-15', '期滿日依新期間重算:2024-09-15');
select is(pg_temp.keys('c5e30000-0000-0000-0000-0000000000f1'), '2024-04,2024-05,2024-06,2024-07,2024-08,2024-09,2025-02', '期滿後沒動過的待辦期移除;已提送的 2025-02 保留');
select is(pg_temp.effects('removed'), '2024-10,2024-11,2024-12,2025-01,2025-03', 'effects 記移除的期');
select is(pg_temp.effects('kept'), '2025-02', 'effects 記保留原依據的已提送期');
select is((select status || '/' || due_date || '/' || (basis ->> 'bound_date') from public.obligation_periods where id = pg_temp.period_id('c5e30000-0000-0000-0000-0000000000f1', '2025-02')),
  '已提送/2025-02-10/2025-03-15', '已提送期的狀態、到期日與原依據(舊期滿日)不變');
select is((select status from public.obligation_periods where id = pg_temp.period_id('c5e30000-0000-0000-0000-0000000000f1', '2024-06')), '已完成', '已完成期不動');
select is((select array_to_string(changed_keys, ',') from pg_temp.latest()), 'warranty_term', '更正版 changed_keys=warranty_term');

-- ── 5. 驗收日更正(延後到 2024-05-20;期滿 2024-11-20)→ 只移除／補回沒動過的待辦期 ─────────────────
select pg_temp.become(null);
update public.acceptance_events set event_date = '2024-05-20' where id = 'c5e40000-0000-0000-0000-0000000000e1';
select is(pg_temp.w() ->> 'expiry', '2024-11-20', '合格日更正後期滿日重算:2024-11-20');
select is(pg_temp.keys('c5e30000-0000-0000-0000-0000000000f1'), '2024-06,2024-07,2024-08,2024-09,2024-10,2024-11,2025-02',
  '早於新合格日的待辦期(2024-04、2024-05)移除;期滿延後補回 2024-10、2024-11;動過的 2024-06、2025-02 保留');
select is((select basis ->> 'anchor_date' from public.obligation_periods where id = pg_temp.period_id('c5e30000-0000-0000-0000-0000000000f1', '2024-11')), '2024-05-20', '補回的期依新合格日');
select is((select basis ->> 'anchor_date' from public.obligation_periods where id = pg_temp.period_id('c5e30000-0000-0000-0000-0000000000f1', '2024-06')), '2024-03-15', '已完成的期保留原依據(舊合格日)');

-- 正式驗收改記不合格 → 合格日判不出:沒動過的待辦期全部移除,動過的保留
update public.acceptance_events set result = '不合格' where id = 'c5e40000-0000-0000-0000-0000000000e1';
select is(pg_temp.w() -> 'needs', '["acceptance"]'::jsonb, '最後一筆正式驗收不合格 → 缺合格日');
select is(pg_temp.keys('c5e30000-0000-0000-0000-0000000000f1'), '2024-06,2025-02', '沒動過的待辦期移除,已完成／已提送保留');
update public.acceptance_events set result = '合格' where id = 'c5e40000-0000-0000-0000-0000000000e1';
select is(pg_temp.keys('c5e30000-0000-0000-0000-0000000000f1'), '2024-06,2024-07,2024-08,2024-09,2024-10,2024-11,2025-02', '改回合格 → 冪等補回');

-- 引用條文被取代 → 期間失去依據:不再計算、移除沒動過的待辦期
update public.requirements set status = 'superseded' where id = 'c5e20000-0000-0000-0000-0000000000c1';
select is((pg_temp.w() ->> 'source_ok') || '/' || (pg_temp.w() ->> 'source_status') || '/' || (pg_temp.w() -> 'needs')::text, 'false/superseded/["term"]', '引用條文被取代 → source_ok=false、needs=[term]');
select is(pg_temp.w() ->> 'gap', '保固期間引用的契約條文已不是已確認狀態，無法判定保固期滿日', 'gap:引用條文失效');
select is(pg_temp.keys('c5e30000-0000-0000-0000-0000000000f1'), '2024-06,2025-02', '引用條文失效 → 沒動過的待辦期移除');
-- 改引用新的已確認條文(期間 1 年)→ 恢復
select pg_temp.become(null);
insert into public.requirements (id, project_id, title, requirement_type, lifecycle_phase, status, origin) values
  ('c5e20000-0000-0000-0000-0000000000c6', 'c5e10000-0000-0000-0000-000000000001', '保固期間 1 年(更正轉錄)', 'other', '保固', 'approved', 'manual');
select pg_temp.become('c5e00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select lives_ok($$ update public.projects set warranty_term_value = 1, warranty_term_unit = 'year', warranty_source_requirement_id = 'c5e20000-0000-0000-0000-0000000000c6' where id = 'c5e10000-0000-0000-0000-000000000001' $$,
  '管理者直接 REST 改引用新條文(guard 放行)');
reset role;
select is((select change_kind || '/' || array_to_string(changed_keys, ',') || '/' || ((warranty ->> 'source_requirement_id')) from pg_temp.latest()),
  'edit/warranty_term/c5e20000-0000-0000-0000-0000000000c6', '直接 REST 改也留版(類別 edit、無依據)');
select is(pg_temp.w() ->> 'expiry', '2025-05-20', '新依據下期滿日 2025-05-20');
select ok(pg_temp.keys('c5e30000-0000-0000-0000-0000000000f1') like '2024-06,2024-07,%,2025-05', '恢復產生到期滿日所在期(2025-05)');
select is(pg_temp.period_id('c5e30000-0000-0000-0000-0000000000f1', '2025-06'), null, '期滿日之後不產生');

-- ── 7. 類別在保固／非保固間變動 = 規則變更 ─────────────────────────────────────────────
select pg_temp.become(null);
update public.contract_obligations set category = '施工中' where id = 'c5e30000-0000-0000-0000-0000000000f1';
select is((select string_agg(distinct basis ->> 'anchor_key', ',') from public.obligation_periods
  where obligation_id = 'c5e30000-0000-0000-0000-0000000000f1' and status = '待辦'), 'commencement_date', '改非保固類 → 沒動過的待辦期依開工日與竣工界限重建');
select is((select basis ->> 'anchor_key' from public.obligation_periods where id = pg_temp.period_id('c5e30000-0000-0000-0000-0000000000f1', '2024-06')), 'acceptance_pass_date', '動過的期保留原依據');
update public.contract_obligations set category = '保固' where id = 'c5e30000-0000-0000-0000-0000000000f1';
select ok(pg_temp.keys('c5e30000-0000-0000-0000-0000000000f1') like '2024-06,2024-07,%,2025-05', '改回保固類 → 依保固期間重建');

-- ── RPC 讀取權限 ───────────────────────────────────────────────────────────────
select pg_temp.become('c5e00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((public.get_project_warranty('c5e10000-0000-0000-0000-000000000001')) ->> 'expiry', '2025-05-20', '成員(廠商)讀得到同一份保固事實');
reset role;
select pg_temp.become('c5e00000-0000-0000-0000-0000000000a4');
set local role authenticated;
select throws_ok($$ select public.get_project_warranty('c5e10000-0000-0000-0000-000000000001') $$, 'P0001', 'project not found or not a member', '非成員讀不到');
reset role;
select pg_temp.become(null);
set local role anon;
select throws_ok($$ select public.get_project_warranty('c5e10000-0000-0000-0000-000000000001') $$, '42501', null, 'anon 不可呼叫');
reset role;
select is((public.get_project_warranty('c5e10000-0000-0000-0000-000000000001')) ->> 'expiry', '2025-05-20', 'service(無 JWT)可讀');

-- ── 引用條文被刪除(FK set null):期間保留、不再計算;專案刪除 cascade 不被 guard 擋 ───────────────────
delete from public.requirements where id = 'c5e20000-0000-0000-0000-0000000000c6';
select is((select warranty_term_value || '/' || coalesce(warranty_source_requirement_id::text, '-') from public.projects where id = 'c5e10000-0000-0000-0000-000000000001'),
  '1/-', '引用條文刪除 → FK set null、期間保留(guard 放行 cascade)');
select is(pg_temp.w() -> 'needs', '["term"]'::jsonb, '引用條文不在 → needs=[term]');
select is(pg_temp.keys('c5e30000-0000-0000-0000-0000000000f1'), '2024-06,2025-02', '沒動過的待辦期移除,動過的保留');
select is((select array_to_string(changed_keys, ',') from pg_temp.latest()), 'warranty_term', 'FK set null 也留一版(可追溯)');
select lives_ok($$ delete from public.projects where id = 'c5e10000-0000-0000-0000-000000000001' $$, '有保固期間的專案可整案刪除(cascade)');
select is((select count(*)::int from public.project_anchor_versions where project_id = 'c5e10000-0000-0000-0000-000000000001'), 0, '版本隨專案 cascade 移除');

select * from finish();
rollback;
