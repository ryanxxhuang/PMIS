-- P5c 基準日版本、期次重算只動未完成、單次義務到期快照、循環停止條件(pgTAP)。
-- 對應 migration 20260919021500_project_anchor_versions.sql。
-- 釘七件事:1) 版本留存不可竄改(append-only:authenticated 無寫入 grant、postgres／service 的 UPDATE／DELETE
-- 被 guard 拒,只放行專案刪除 cascade);2) projects 基準日 INSERT／UPDATE 都自動留版(直接改也留、RPC 帶依據);
-- 3) 重算只動沒動過的待辦期,已提送／已完成／掛證據的期保留原到期日與依據並記 kept,差異寫進 effects;
-- 4) 單次義務完成時留到期日快照與版號、退回清空、client 值作廢、基準日事後更正不改快照;5) RPC 權限矩陣
-- (管理者可、成員／非成員／未登入不可、未知類別／欄位／日期／別案變更被拒)、RLS 可見性沿用專案;
-- 6) 循環停止條件:保固類不由竣工日界定(P5e 起改由保固期滿日,見 warranty_stop_condition.sql;本檔的保固案未登錄合格日與保固期間
--    → 不產生)、竣工日缺不產生、竣工日已過停在竣工日、登錄竣工後之後的待辦期移除且清除後補回;
-- 7) 時區與月末:生效日預設台北今天、月末基準日(31 日)之後的期照月末夾住規則對齊。
begin;

select plan(124);

-- ── 結構與授權 ──────────────────────────────────────────────────────────────
select has_table('public', 'project_anchor_versions', '基準日版本表存在');
select has_function('public', 'update_project_anchors', array['uuid','jsonb','text','text','text','uuid','date'], '附依據的基準日變更 RPC 存在');
select has_trigger('public', 'projects', 'projects_anchor_versions_sync', 'projects 基準日留版 trigger 掛上');
select hasnt_trigger('public', 'projects', 'projects_obligation_periods_sync', 'P5b 只補期次的 projects trigger 已由留版重算取代');
select has_trigger('public', 'project_anchor_versions', 'project_anchor_versions_guard', 'append-only guard 掛上');
select has_trigger('public', 'contract_obligations', 'contract_obligations_due_snapshot', '單次義務到期快照 trigger 掛上');
select has_trigger('public', 'acceptance_events', 'acceptance_events_obligation_periods_sync', '竣工登錄同步期次 trigger 掛上');
select has_column('public', 'contract_obligations', 'due_date_snapshot', '義務到期日快照欄存在');
select has_column('public', 'contract_obligations', 'anchor_version_no', '義務基準日版號欄存在');
select is(has_table_privilege('authenticated', 'public.project_anchor_versions', 'SELECT'), true, 'authenticated 可讀版本');
select is(has_table_privilege('authenticated', 'public.project_anchor_versions', 'INSERT')
  or has_table_privilege('authenticated', 'public.project_anchor_versions', 'UPDATE')
  or has_table_privilege('authenticated', 'public.project_anchor_versions', 'DELETE'), false, 'authenticated 對版本表沒有任何寫入 grant');
select is(has_function_privilege('authenticated', 'public.update_project_anchors(uuid, jsonb, text, text, text, uuid, date)', 'EXECUTE'), true, 'authenticated 可執行 update_project_anchors');
select is(has_function_privilege('anon', 'public.update_project_anchors(uuid, jsonb, text, text, text, uuid, date)', 'EXECUTE'), false, 'anon 不可執行 update_project_anchors');
select is(has_function_privilege('authenticated', 'public.fn_record_project_anchor_version(uuid, jsonb, jsonb, text, text, text, uuid, date, date)', 'EXECUTE'), false, 'authenticated 不可直接呼叫內部留版函式');
select is(has_function_privilege('authenticated', 'public.fn_recompute_obligations_for_anchor_version(uuid, integer, jsonb, jsonb, date)', 'EXECUTE'), false, 'authenticated 不可直接呼叫重算函式');
select is(has_function_privilege('authenticated', 'public.fn_apply_obligation_recurrence_bound(uuid)', 'EXECUTE'), false, 'authenticated 不可直接套用界限日');
select is((select prosecdef from pg_proc where proname = 'update_project_anchors' and pronamespace = 'public'::regnamespace), true,
  'update_project_anchors 是 security definer(內部留版函式不對 authenticated 開放),第一行以 is_project_admin() 把關(與 projects update policy 同一個函式)');

-- ── 純函式 ───────────────────────────────────────────────────────────────────
select is(public.fn_obligation_single_due('award', 14, 'after', null, '2026-01-10', '2026-01-20', '2026-02-01', '2026-12-31'), '2026-01-24'::date, '決標後 14 日');
select is(public.fn_obligation_single_due('completion', 7, 'before', null, '2026-01-10', '2026-01-20', '2026-02-01', '2026-12-31'), '2026-12-24'::date, '竣工前 7 日');
select is(public.fn_obligation_single_due('commencement', 30, null, null, '2026-01-10', '2026-01-20', '2026-02-01', '2026-12-31'), '2026-03-03'::date, '開工後 30 日(offset_dir 預設 after)');
select is(public.fn_obligation_single_due('fixed', 30, 'after', '2026-06-15', '2026-01-10', '2026-01-20', '2026-02-01', '2026-12-31'), '2026-06-15'::date, 'fixed 直接用指定日期,不加偏移');
select is(public.fn_obligation_single_due('commencement', 10, 'after', null, '2026-01-10', '2026-01-20', null, '2026-12-31'), null, '基準日缺 → null(不臆測)');
select is(public.fn_obligation_single_due('other', 10, 'after', null, '2026-01-10', '2026-01-20', '2026-02-01', '2026-12-31'), null, '無時點 → null');
select is(public.fn_obligation_recurrence_bound('施工中', '2026-12-31', '2026-08-24'), '2026-08-24'::date, '界限日:實際竣工日優先');
select is(public.fn_obligation_recurrence_bound('施工中', '2026-12-31', null), '2026-12-31'::date, '界限日:未登錄竣工 → 契約竣工日');
select is(public.fn_obligation_recurrence_bound(null, null, null), null, '界限日:竣工日缺且未登錄竣工 → 判不出');
select is(public.fn_obligation_recurrence_bound('保固', '2026-12-31', '2026-08-24'), null, '界限日:保固類不由竣工日界定(P5e 起由保固期滿日界定,呼叫端分流)');
select is(public.fn_obligation_recurrence_stop_gap('施工中', '2026-12-31', null, '2026-09-19'), null, '停止條件:竣工日未到 → 無缺口');
select is(public.fn_obligation_recurrence_stop_gap('施工中', null, '2026-08-24', '2026-09-19'), null, '停止條件:已登錄竣工 → 無缺口(即使竣工日缺)');
select is(public.fn_obligation_recurrence_stop_gap('保固', '2026-12-31', null, '2026-09-19'), '缺正式驗收合格日、缺契約保固期間，無法判定保固期滿日', '停止條件:保固類未登錄合格日與保固期間 → 明示缺哪兩項(P5e)');
select is(public.fn_obligation_recurrence_stop_gap('施工中', null, null, '2026-09-19'), '缺竣工日，無法判定循環何時結束', '停止條件:缺竣工日');
select is(public.fn_obligation_recurrence_stop_gap('施工中', '2026-06-30', null, '2026-09-19'), '竣工日 2026-06-30 已過，尚未登錄竣工或展延', '停止條件:竣工日已過未登錄竣工');
select is(public.fn_anchors_json(null, null, '2026-02-20', null), '{"award_date": null, "notice_date": null, "commencement_date": "2026-02-20", "end_date": null}'::jsonb, '基準日快照鍵永遠齊、null 保留');

-- ── 測試資料 ──────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c5c00000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5c-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('c5c00000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5c-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('c5c00000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5c-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('c5c00000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5c-outsider@example.test', '', now(), '{}',
   '{"full_name":"Outsider","org_type":"owner"}', now(), now()),
  ('c5c00000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5c-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by,
                             award_date, notice_date, commencement_date, end_date)
values
  ('c5c10000-0000-0000-0000-000000000001', '基準日版本測試案', '機關', '廠商', '監造',
   'c5c00000-0000-0000-0000-0000000000a5', '2026-01-10', '2026-01-20', '2026-02-20', '2026-12-31'),
  ('c5c10000-0000-0000-0000-000000000002', '別案', '機關', '廠商', '監造',
   'c5c00000-0000-0000-0000-0000000000a4', '2026-01-10', null, '2026-02-20', '2026-12-31'),
  ('c5c10000-0000-0000-0000-000000000003', '基準日未設案', '機關', '廠商', '監造',
   'c5c00000-0000-0000-0000-0000000000a5', null, null, null, null);
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('c5c10000-0000-0000-0000-000000000001', 'c5c00000-0000-0000-0000-0000000000a1', 'member'),
  ('c5c10000-0000-0000-0000-000000000001', 'c5c00000-0000-0000-0000-0000000000a2', 'member'),
  ('c5c10000-0000-0000-0000-000000000001', 'c5c00000-0000-0000-0000-0000000000a3', 'member'),
  ('c5c10000-0000-0000-0000-000000000001', 'c5c00000-0000-0000-0000-0000000000a5', 'admin'),
  ('c5c10000-0000-0000-0000-000000000002', 'c5c00000-0000-0000-0000-0000000000a4', 'admin'),
  ('c5c10000-0000-0000-0000-000000000003', 'c5c00000-0000-0000-0000-0000000000a1', 'member'),
  ('c5c10000-0000-0000-0000-000000000003', 'c5c00000-0000-0000-0000-0000000000a5', 'admin');

insert into public.change_orders (id, project_id, co_no, title, status) values
  ('c5c40000-0000-0000-0000-000000000001', 'c5c10000-0000-0000-0000-000000000001', 'CO-P5C-1', '展延工期 90 日', '核准'),
  ('c5c40000-0000-0000-0000-000000000002', 'c5c10000-0000-0000-0000-000000000002', 'CO-P5C-2', '別案變更', '核准');

insert into public.requirements (id, project_id, title, requirement_type) values
  ('c5c20000-0000-0000-0000-000000000001', 'c5c10000-0000-0000-0000-000000000001', '每月施工月報', 'deadline'),
  ('c5c20000-0000-0000-0000-000000000002', 'c5c10000-0000-0000-0000-000000000001', '開工後 15 日提送施工計畫', 'deadline'),
  ('c5c20000-0000-0000-0000-000000000003', 'c5c10000-0000-0000-0000-000000000001', '竣工前 7 日提送竣工圖說', 'deadline'),
  ('c5c20000-0000-0000-0000-000000000004', 'c5c10000-0000-0000-0000-000000000001', '指定日期撥付', 'deadline'),
  ('c5c20000-0000-0000-0000-000000000005', 'c5c10000-0000-0000-0000-000000000001', '保固期每月巡檢', 'deadline'),
  ('c5c20000-0000-0000-0000-000000000006', 'c5c10000-0000-0000-0000-000000000001', '接獲開工通知起每月 15 日環境監測', 'deadline'),
  ('c5c20000-0000-0000-0000-000000000007', 'c5c10000-0000-0000-0000-000000000003', '未設案每月 10 日', 'deadline');

-- R1 每月 5 日(廠商;開工日起算) R2 開工後 15 日(廠商) R3 竣工前 7 日(監造) R4 指定日期(機關)
-- R5 保固類每月 10 日(廠商) R6 接獲開工通知起每月 15 日(監造) R7 未設案每月 10 日(機關;開工日起算)
insert into public.contract_obligations (id, project_id, requirement_id, title, category, responsible, status, trigger_event, offset_days, offset_dir, recurring, recurring_day, fixed_date) values
  ('c5c30000-0000-0000-0000-000000000001', 'c5c10000-0000-0000-0000-000000000001', 'c5c20000-0000-0000-0000-000000000001', '每月施工月報', '施工中', '廠商', '待辦', null, null, null, 'monthly', 5, null),
  ('c5c30000-0000-0000-0000-000000000002', 'c5c10000-0000-0000-0000-000000000001', 'c5c20000-0000-0000-0000-000000000002', '開工後 15 日提送施工計畫', '開工前', '廠商', '待辦', 'commencement', 15, 'after', null, null, null),
  ('c5c30000-0000-0000-0000-000000000003', 'c5c10000-0000-0000-0000-000000000001', 'c5c20000-0000-0000-0000-000000000003', '竣工前 7 日提送竣工圖說', '完工', '監造', '待辦', 'completion', 7, 'before', null, null, null),
  ('c5c30000-0000-0000-0000-000000000004', 'c5c10000-0000-0000-0000-000000000001', 'c5c20000-0000-0000-0000-000000000004', '指定日期撥付', '施工中', '機關', '待辦', 'fixed', null, null, null, null, '2026-06-30'),
  ('c5c30000-0000-0000-0000-000000000005', 'c5c10000-0000-0000-0000-000000000001', 'c5c20000-0000-0000-0000-000000000005', '保固期每月巡檢', '保固', '廠商', '待辦', 'completion', null, null, 'monthly', 10, null),
  ('c5c30000-0000-0000-0000-000000000006', 'c5c10000-0000-0000-0000-000000000001', 'c5c20000-0000-0000-0000-000000000006', '接獲開工通知起每月 15 日環境監測', '施工中', '監造', '待辦', 'notice', null, null, 'monthly', 15, null),
  ('c5c30000-0000-0000-0000-000000000007', 'c5c10000-0000-0000-0000-000000000003', 'c5c20000-0000-0000-0000-000000000007', '未設案每月 10 日', '施工中', '機關', '待辦', null, null, null, 'monthly', 10, null);

-- 模擬登入者
create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;
create or replace function pg_temp.period_id(ob uuid, k text) returns uuid language sql as $$
  select id from public.obligation_periods where obligation_id = ob and period_key = k
$$;
create or replace function pg_temp.ver(p uuid, n integer) returns public.project_anchor_versions language sql as $$
  select * from public.project_anchor_versions where project_id = p and version_no = n
$$;
create or replace function pg_temp.effects_of(p uuid, n integer, kind text, ob uuid) returns text language sql as $$
  select string_agg(coalesce(e ->> 'period_key', '單次') || ':' || coalesce(e ->> 'old_due', '-') || '→' || coalesce(e ->> 'new_due', '-'), ',' order by e ->> 'period_key')
  from public.project_anchor_versions v, jsonb_array_elements(v.effects) e
  where v.project_id = p and v.version_no = n and e ->> 'kind' = kind and (e ->> 'obligation_id')::uuid = ob
$$;

-- ── 版本 1:專案插入時的基準日快照;期次蓋版號 ────────────────────────────────────
select is((select count(*)::int from public.project_anchor_versions where project_id = 'c5c10000-0000-0000-0000-000000000001'), 1, '有基準日的專案插入即留 version 1');
select is((select change_kind || '/' || array_to_string(changed_keys, ',') || '/' || (effects::text) from pg_temp.ver('c5c10000-0000-0000-0000-000000000001', 1)),
  'initial/award_date,notice_date,commencement_date,end_date/[]', 'version 1:initial、changed_keys=已填的四欄、無受影響事項');
select is((select anchors from pg_temp.ver('c5c10000-0000-0000-0000-000000000001', 1)),
  '{"award_date": "2026-01-10", "notice_date": "2026-01-20", "commencement_date": "2026-02-20", "end_date": "2026-12-31"}'::jsonb, 'version 1 快照=插入值');
select is((select effective_from from pg_temp.ver('c5c10000-0000-0000-0000-000000000001', 1)), public.fn_taipei_today(), '生效日預設=台北今天(時區)');
select is((select count(*)::int from public.project_anchor_versions where project_id = 'c5c10000-0000-0000-0000-000000000003'), 0, '四個基準日全空的專案沒有版本');
select is((select due_date from public.obligation_periods where id = pg_temp.period_id('c5c30000-0000-0000-0000-000000000001', '2026-03')), '2026-03-05'::date, 'R1 插入即物化(2026-03 到期 3/5)');
select is((select anchor_version_no from public.obligation_periods where id = pg_temp.period_id('c5c30000-0000-0000-0000-000000000001', '2026-03')), 1, '期次蓋產生當時的基準日版本 1');
select is((select basis ->> 'bound_date' from public.obligation_periods where id = pg_temp.period_id('c5c30000-0000-0000-0000-000000000001', '2026-03')), '2026-12-31', 'basis 記界限日(契約竣工日)');
select is((select count(*)::int from public.obligation_periods where obligation_id = 'c5c30000-0000-0000-0000-000000000005'), 0, '保固類循環義務:未登錄正式驗收合格日與保固期間 → 不產生期次(停止條件待補,P5e)');
select is((select count(*)::int from public.obligation_periods where obligation_id = 'c5c30000-0000-0000-0000-000000000007'), 0, '基準日未設案:開工日缺 → 不產生');
select is((select due_date from public.obligation_periods where id = pg_temp.period_id('c5c30000-0000-0000-0000-000000000006', '2026-02')), '2026-02-15'::date, 'R6 接獲開工通知 1/20 起算:2026-02 到期 2/15');

-- ── 重算只動未完成:先把 R1 的 2026-04 期標已提送(動過),再由管理者改開工日 ─────────────
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5c30000-0000-0000-0000-000000000001', '2026-04'), '已提送') $$, '廠商先標 2026-04 已提送(動過的期)');
reset role;

select pg_temp.become('c5c00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select is((select version_no from public.update_project_anchors('c5c10000-0000-0000-0000-000000000001', '{"commencement_date": "2026-04-10"}'::jsonb, 'edit', '實際開工日更正', null, null, null)),
  2, '管理者改開工日 → version 2');
reset role;
select is((select array_to_string(changed_keys, ',') || '/' || change_kind || '/' || coalesce(reason, '') || '/' || created_by::text from pg_temp.ver('c5c10000-0000-0000-0000-000000000001', 2)),
  'commencement_date/edit/實際開工日更正/c5c00000-0000-0000-0000-0000000000a5', 'version 2:改了開工日、類別、理由、建立者');
select is((select anchors ->> 'commencement_date' from pg_temp.ver('c5c10000-0000-0000-0000-000000000001', 2)), '2026-04-10', 'version 2 快照=新開工日');
select is((select commencement_date from public.projects where id = 'c5c10000-0000-0000-0000-000000000001'), '2026-04-10'::date, 'projects 現行值已更新');
select is(pg_temp.effects_of('c5c10000-0000-0000-0000-000000000001', 2, 'removed', 'c5c30000-0000-0000-0000-000000000001'), '2026-03:2026-03-05→-',
  'R1 沒動過的 2026-03 期(到期早於新開工日)移除,記 removed');
select is(pg_temp.effects_of('c5c10000-0000-0000-0000-000000000001', 2, 'kept', 'c5c30000-0000-0000-0000-000000000001'), '2026-04:2026-04-05→-',
  'R1 已提送的 2026-04 期(到期早於新開工日)保留,記 kept');
select is((select due_date || '/' || status || '/' || anchor_version_no from public.obligation_periods where id = pg_temp.period_id('c5c30000-0000-0000-0000-000000000001', '2026-04')),
  '2026-04-05/已提送/1', '已提送的期原到期日、狀態、原版號都不動');
select is(pg_temp.period_id('c5c30000-0000-0000-0000-000000000001', '2026-03'), null, '2026-03 期已不存在');
select is((select anchor_version_no from public.obligation_periods where id = pg_temp.period_id('c5c30000-0000-0000-0000-000000000001', '2026-05')), 1,
  '不受影響的 2026-05 期維持版本 1(產生當時的依據)');
select is(pg_temp.effects_of('c5c10000-0000-0000-0000-000000000001', 2, 'rescheduled', 'c5c30000-0000-0000-0000-000000000002'), '單次:2026-03-07→2026-04-25',
  '單次「開工後 15 日」未完成 → 記改期 3/7→4/25');
select is(pg_temp.effects_of('c5c10000-0000-0000-0000-000000000001', 2, 'removed', 'c5c30000-0000-0000-0000-000000000006'), null,
  'R6(接獲開工通知起算)不受開工日變更影響');
select is((select count(*)::int from public.project_anchor_versions v, jsonb_array_elements(v.effects) e where v.project_id = 'c5c10000-0000-0000-0000-000000000001' and v.version_no = 2 and (e ->> 'obligation_id')::uuid = 'c5c30000-0000-0000-0000-000000000003'), 0,
  '竣工類單次義務不受開工日變更影響');

-- ── 展延(附依據與變更案):竣工日往後 → 竣工類單次義務改期 ─────────────────────────────
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select is((select version_no from public.update_project_anchors('c5c10000-0000-0000-0000-000000000001', '{"end_date": "2027-03-31"}'::jsonb, 'extension', '機關核准展延 90 日', '府工字第 1130001234 號', 'c5c40000-0000-0000-0000-000000000001', '2026-09-01')),
  3, '展延 → version 3');
reset role;
select is((select change_kind || '/' || source_ref || '/' || source_change_order_id::text || '/' || effective_from::text from pg_temp.ver('c5c10000-0000-0000-0000-000000000001', 3)),
  'extension/府工字第 1130001234 號/c5c40000-0000-0000-0000-000000000001/2026-09-01', 'version 3:類別、函文、變更案、生效日都留下');
select is(pg_temp.effects_of('c5c10000-0000-0000-0000-000000000001', 3, 'rescheduled', 'c5c30000-0000-0000-0000-000000000003'), '單次:2026-12-24→2027-03-24',
  '「竣工前 7 日」隨展延改期 12/24→3/24');
select is((select count(*)::int from public.project_anchor_versions v, jsonb_array_elements(v.effects) e where v.project_id = 'c5c10000-0000-0000-0000-000000000001' and v.version_no = 3 and (e ->> 'obligation_id')::uuid = 'c5c30000-0000-0000-0000-000000000001'), 0,
  '界限日往後、前瞻窗口內沒有新期 → 循環義務無差異');

-- ── 停工:四日期未變也留一版(工期依據);直接改值沒變不留版 ─────────────────────────────
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select is((select version_no from public.update_project_anchors('c5c10000-0000-0000-0000-000000000001', '{}'::jsonb, 'suspension', '颱風停工', '監造函 456', null, '2026-09-10')),
  4, '停工(四日期未變)仍留 version 4');
select is((select public.update_project_anchors('c5c10000-0000-0000-0000-000000000001', '{"end_date": "2027-03-31"}'::jsonb, 'edit', null, null, null, null)), null,
  '直接修改但值沒變 → 回 null、不留版');
reset role;
select is((select array_to_string(changed_keys, ',') || '/' || effective_from::text || '/' || (effects::text) from pg_temp.ver('c5c10000-0000-0000-0000-000000000001', 4)),
  '/2026-09-10/[]', 'version 4:沒改欄位、生效日=停工日、無受影響事項');
select is((select count(*)::int from public.project_anchor_versions where project_id = 'c5c10000-0000-0000-0000-000000000001'), 4, '仍是 4 版');

-- ── 直接 REST 改 projects(管理者):trigger 仍留版,類別 edit、無依據 ─────────────────────
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select lives_ok($$ update public.projects set notice_date = '2026-03-31' where id = 'c5c10000-0000-0000-0000-000000000001' $$, '管理者直接改接獲開工通知日(月末)');
reset role;
select is((select change_kind || '/' || array_to_string(changed_keys, ',') || '/' || coalesce(source_ref, '無') || '/' || created_by::text from pg_temp.ver('c5c10000-0000-0000-0000-000000000001', 5)),
  'edit/notice_date/無/c5c00000-0000-0000-0000-0000000000a5', '直接改也留 version 5:edit、無依據、建立者');
select is(pg_temp.effects_of('c5c10000-0000-0000-0000-000000000001', 5, 'removed', 'c5c30000-0000-0000-0000-000000000006'), '2026-02:2026-02-15→-,2026-03:2026-03-15→-',
  'R6 的 2、3 月期(到期早於新基準日 3/31)移除;4 月起維持');
select is((select due_date from public.obligation_periods where id = pg_temp.period_id('c5c30000-0000-0000-0000-000000000006', '2026-04')), '2026-04-15'::date, '月末基準日之後的期照規則對齊(4/15 不動)');

-- ── 版本留存不可竄改 ──────────────────────────────────────────────────────────────
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select throws_ok($$ update public.project_anchor_versions set reason = '改寫' where project_id = 'c5c10000-0000-0000-0000-000000000001' $$, '42501', null, 'authenticated 沒有 UPDATE grant');
select throws_ok($$ delete from public.project_anchor_versions where project_id = 'c5c10000-0000-0000-0000-000000000001' $$, '42501', null, 'authenticated 沒有 DELETE grant');
select throws_ok($$ insert into public.project_anchor_versions (project_id, version_no) values ('c5c10000-0000-0000-0000-000000000001', 99) $$, '42501', null, 'authenticated 沒有 INSERT grant(只走 trigger／RPC)');
reset role;
select throws_ok($$ update public.project_anchor_versions set reason = '改寫' where project_id = 'c5c10000-0000-0000-0000-000000000001' and version_no = 2 $$, 'P0001', null, '擁有者／service 的 UPDATE 也被 guard 拒(append-only)');
select throws_ok($$ delete from public.project_anchor_versions where project_id = 'c5c10000-0000-0000-0000-000000000001' and version_no = 2 $$, 'P0001', null, '擁有者／service 的 DELETE 也被 guard 拒');
select is((select reason from pg_temp.ver('c5c10000-0000-0000-0000-000000000001', 2)), '實際開工日更正', '版本內容原封不動');

-- ── RPC 權限矩陣與輸入檢查 ─────────────────────────────────────────────────────────
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok($$ select public.update_project_anchors('c5c10000-0000-0000-0000-000000000001', '{"award_date": "2026-01-11"}'::jsonb, 'edit', null, null, null, null) $$,
  'P0001', '未生效:僅專案管理者可修改基準日', '一般成員(廠商)不可改基準日(projects update policy)');
reset role;
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a3');
set local role authenticated;
select throws_ok($$ select public.update_project_anchors('c5c10000-0000-0000-0000-000000000001', '{"award_date": "2026-01-11"}'::jsonb, 'edit', null, null, null, null) $$,
  'P0001', '未生效:僅專案管理者可修改基準日', '一般成員(機關)不可改基準日');
reset role;
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a4');
set local role authenticated;
select throws_ok($$ select public.update_project_anchors('c5c10000-0000-0000-0000-000000000001', '{"award_date": "2026-01-11"}'::jsonb, 'edit', null, null, null, null) $$,
  'P0001', '未生效:僅專案管理者可修改基準日', '非成員(別案管理者)不可改,且不洩漏存在');
select is((select count(*)::int from public.project_anchor_versions where project_id = 'c5c10000-0000-0000-0000-000000000001'), 0, 'RLS:非成員看不到本案版本');
select is((select count(*)::int from public.project_anchor_versions where project_id = 'c5c10000-0000-0000-0000-000000000002'), 1, 'RLS:自己案的版本看得到');
reset role;
select pg_temp.become(null);
set local role authenticated;
select throws_ok($$ select public.update_project_anchors('c5c10000-0000-0000-0000-000000000001', '{"award_date": "2026-01-11"}'::jsonb, 'edit', null, null, null, null) $$,
  'P0001', 'not authenticated', '未登入不可');
reset role;
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select throws_ok($$ select public.update_project_anchors('c5c10000-0000-0000-0000-000000000001', '{"award_date": "2026-01-11"}'::jsonb, 'typhoon', null, null, null, null) $$,
  'P0001', 'unknown anchor change kind: typhoon', '未知變更類別被拒');
select throws_ok($$ select public.update_project_anchors('c5c10000-0000-0000-0000-000000000001', '{"start_date": "2026-01-11"}'::jsonb, 'edit', null, null, null, null) $$,
  'P0001', '未知的基準日欄位: start_date', '不是四個基準日的欄位被拒(不能藉此改別的欄)');
select throws_ok($$ select public.update_project_anchors('c5c10000-0000-0000-0000-000000000001', '{"award_date": "not-a-date"}'::jsonb, 'edit', null, null, null, null) $$,
  '22007', null, '非日期被拒');
select throws_ok($$ select public.update_project_anchors('c5c10000-0000-0000-0000-000000000001', '{"award_date": "2026-01-11"}'::jsonb, 'change_order', null, null, 'c5c40000-0000-0000-0000-000000000002', null) $$,
  'P0001', '依據的變更設計不屬於本案', '別案的變更設計不能當依據');
select is((select count(*)::int from public.project_anchor_versions where project_id = 'c5c10000-0000-0000-0000-000000000001'), 5, '被拒的呼叫不留版(仍 5 版)');
select is((select count(*)::int from public.project_anchor_versions where project_id = 'c5c10000-0000-0000-0000-000000000001' and created_by = 'c5c00000-0000-0000-0000-0000000000a5'), 4,
  'RLS:成員看得到本案全部版本;建立者欄位如實(4 版由管理者建立、v1 由系統)');
reset role;

-- ── 單次義務:完成時留快照與版號、退回清空、client 值作廢、基準日更正不改快照 ─────────────
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a3');
set local role authenticated;
select lives_ok($$ update public.contract_obligations set status = '已完成' where id = 'c5c30000-0000-0000-0000-000000000004' $$, '機關標記指定日期撥付已完成');
reset role;
select is((select due_date_snapshot || '/' || anchor_version_no from public.contract_obligations where id = 'c5c30000-0000-0000-0000-000000000004'),
  '2026-06-30/5', 'fixed 義務完成:快照=指定日期、版號=當時最新版 5');
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$ update public.contract_obligations set status = '已提送', due_date_snapshot = '2020-01-01', anchor_version_no = 99 where id = 'c5c30000-0000-0000-0000-000000000003' $$,
  '42501', null, 'client 不能寫快照欄(contract_obligations 只開放 status／evidence 欄位級 UPDATE);trigger 的作廢是第二道');
select lives_ok($$ update public.contract_obligations set status = '已提送' where id = 'c5c30000-0000-0000-0000-000000000003' $$,
  '監造標記竣工前 7 日已提送');
reset role;
select is((select due_date_snapshot || '/' || anchor_version_no from public.contract_obligations where id = 'c5c30000-0000-0000-0000-000000000003'),
  '2027-03-24/5', '快照由伺服器依當時竣工日 2027-03-31 算 3/24、版號 5');
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select is((select version_no from public.update_project_anchors('c5c10000-0000-0000-0000-000000000001', '{"end_date": "2027-06-30"}'::jsonb, 'change_order', '核准變更工期', null, 'c5c40000-0000-0000-0000-000000000001', '2026-09-15')),
  6, '核准變更工期 → version 6');
reset role;
select is((select due_date_snapshot || '/' || anchor_version_no from public.contract_obligations where id = 'c5c30000-0000-0000-0000-000000000003'),
  '2027-03-24/5', '已提送義務的快照不因竣工日再變而改(歷史不變)');
select is(pg_temp.effects_of('c5c10000-0000-0000-0000-000000000001', 6, 'kept', 'c5c30000-0000-0000-0000-000000000003'), '單次:2027-03-24→-',
  'version 6 記已提送義務 kept(保留原依據)');
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$ update public.contract_obligations set status = '待辦' where id = 'c5c30000-0000-0000-0000-000000000003' $$, '監造退回待辦');
reset role;
select is((select due_date_snapshot is null and anchor_version_no is null from public.contract_obligations where id = 'c5c30000-0000-0000-0000-000000000003'), true, '退回待辦清空快照與版號');
select is((select due_date_snapshot from public.contract_obligations where id = 'c5c30000-0000-0000-0000-000000000001'), null, '循環義務永遠沒有義務層快照');
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$ update public.contract_obligations set status = '已完成' where id = 'c5c30000-0000-0000-0000-000000000003' $$, '監造再標已完成');
reset role;
select is((select due_date_snapshot || '/' || anchor_version_no from public.contract_obligations where id = 'c5c30000-0000-0000-0000-000000000003'),
  '2027-06-23/6', '再完成:依現行竣工日 2027-06-30 重新留快照、版號 6');

-- ── 循環停止條件:登錄竣工 → 之後沒動過的待辦期移除、清除後補回 ──────────────────────────
-- R1 現有期次:2026-04(已提送)、05 起到今天＋31 日(至少含 09)。以 postgres(uid null)登錄,guard 放行。
select pg_temp.become(null);
select ok((select count(*) from public.obligation_periods where obligation_id = 'c5c30000-0000-0000-0000-000000000001' and period_start > '2026-06-30') > 0,
  '登錄竣工前:R1 有 7 月以後的期');
insert into public.acceptance_events (id, project_id, stage_key, event_date)
values ('c5c50000-0000-0000-0000-000000000001', 'c5c10000-0000-0000-0000-000000000001', 'report', '2026-06-20');
select is((select count(*)::int from public.obligation_periods where obligation_id = 'c5c30000-0000-0000-0000-000000000001' and period_start > '2026-06-30'), 0,
  '廠商報竣 6/20 → 7 月以後沒動過的待辦期移除');
select is((select period_key from public.obligation_periods where obligation_id = 'c5c30000-0000-0000-0000-000000000001' order by period_key desc limit 1), '2026-06',
  '含報竣日的 6 月期保留(期間起日 ≤ 界限日)');
select is((select status from public.obligation_periods where id = pg_temp.period_id('c5c30000-0000-0000-0000-000000000001', '2026-04')), '已提送', '已提送的 4 月期不受影響');
insert into public.acceptance_events (id, project_id, stage_key, event_date)
values ('c5c50000-0000-0000-0000-000000000002', 'c5c10000-0000-0000-0000-000000000001', 'confirm', '2026-05-28');
select is((select period_key from public.obligation_periods where obligation_id = 'c5c30000-0000-0000-0000-000000000001' order by period_key desc limit 1), '2026-05',
  '竣工確認 5/28 優先於報竣:6 月期移除,最後一期 2026-05');
select is(public.fn_project_completion_date('c5c10000-0000-0000-0000-000000000001'), '2026-05-28'::date, '實際竣工日=竣工確認會勘日');
delete from public.acceptance_events where project_id = 'c5c10000-0000-0000-0000-000000000001';
select ok((select count(*) from public.obligation_periods where obligation_id = 'c5c30000-0000-0000-0000-000000000001' and period_start > '2026-06-30') > 0,
  '清除竣工登錄 → 期次依契約竣工日補回');
select is((select anchor_version_no from public.obligation_periods where obligation_id = 'c5c30000-0000-0000-0000-000000000001' order by period_key desc limit 1), 6,
  '補回的期蓋現行版本 6');

-- 竣工日缺且未登錄竣工 → 不產生;補上竣工日 → 產生;竣工日已過 → 只到竣工日為止
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select is((select version_no from public.update_project_anchors('c5c10000-0000-0000-0000-000000000003', '{"commencement_date": "2026-03-15"}'::jsonb, 'edit', null, null, null, null)),
  1, '基準日未設案補開工日 → version 1(第一次留版走 UPDATE)');
reset role;
select is((select change_kind from pg_temp.ver('c5c10000-0000-0000-0000-000000000003', 1)), 'edit', 'UPDATE 產生的第一版類別是 edit(initial 只給插入時已有值)');
select is((select count(*)::int from public.obligation_periods where obligation_id = 'c5c30000-0000-0000-0000-000000000007'), 0,
  '有開工日但缺竣工日且未登錄竣工 → 判不出停止條件,不產生期次');
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select is((select version_no from public.update_project_anchors('c5c10000-0000-0000-0000-000000000003', '{"end_date": "2026-06-30"}'::jsonb, 'edit', null, null, null, null)),
  2, '補竣工日(已過)→ version 2');
reset role;
select results_eq(
  $$ select period_key, due_date from public.obligation_periods where obligation_id = 'c5c30000-0000-0000-0000-000000000007' order by period_key $$,
  $$ values ('2026-04', '2026-04-10'::date), ('2026-05', '2026-05-10'::date), ('2026-06', '2026-06-10'::date) $$,
  '竣工日 6/30 已過:只產生到 6 月(3 月 10 日早於開工日不列),7 月起停止');
select is(pg_temp.effects_of('c5c10000-0000-0000-0000-000000000003', 2, 'added', 'c5c30000-0000-0000-0000-000000000007'), '2026-04:-→2026-04-10,2026-05:-→2026-05-10,2026-06:-→2026-06-10',
  'version 2 effects 記新增的三期');
select is((select anchor_version_no from public.obligation_periods where id = pg_temp.period_id('c5c30000-0000-0000-0000-000000000007', '2026-04')), 2, '新增的期蓋版本 2');
select is(public.materialize_all_obligation_periods(), 0, '每日推進不會越過界限日補期(0 新增)');
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select is((select version_no from public.update_project_anchors('c5c10000-0000-0000-0000-000000000003', '{"end_date": "2027-12-31"}'::jsonb, 'extension', '展延', '函 789', null, '2026-07-01')),
  3, '展延竣工日 → version 3');
reset role;
select ok((select count(*) from public.obligation_periods where obligation_id = 'c5c30000-0000-0000-0000-000000000007' and period_key > '2026-06') > 0,
  '展延後期次恢復產生(7 月起)');
select ok((select count(*) from public.project_anchor_versions v, jsonb_array_elements(v.effects) e where v.project_id = 'c5c10000-0000-0000-0000-000000000003' and v.version_no = 3 and e ->> 'kind' = 'added') > 0,
  '展延版本記新增的期');
select pg_temp.become('c5c00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select is((select version_no from public.update_project_anchors('c5c10000-0000-0000-0000-000000000003', '{"end_date": null}'::jsonb, 'edit', null, null, null, null)),
  4, '清空竣工日 → version 4');
reset role;
select is((select count(*)::int from public.obligation_periods where obligation_id = 'c5c30000-0000-0000-0000-000000000007'), 0,
  '停止條件又判不出 → 沒動過的待辦期全部移除(記 removed),前端列停止條件待補');
select ok((select count(*) from public.project_anchor_versions v, jsonb_array_elements(v.effects) e where v.project_id = 'c5c10000-0000-0000-0000-000000000003' and v.version_no = 4 and e ->> 'kind' = 'removed') >= 3,
  'version 4 記移除的期');

-- ── 專案刪除 cascade:版本隨專案消失,guard 不擋 ─────────────────────────────────────
select pg_temp.become(null);
select lives_ok($$ delete from public.projects where id = 'c5c10000-0000-0000-0000-000000000002' $$, '刪除別案(cascade 版本列)');
select is((select count(*)::int from public.project_anchor_versions where project_id = 'c5c10000-0000-0000-0000-000000000002'), 0, '版本隨專案 cascade 移除');

select * from finish();
rollback;
