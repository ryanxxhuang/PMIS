-- 轉錄分流 pgTAP 套件(migration 20260824130000,D-017)。
-- 涵蓋:數字引擎誤配防護、引文核對門檻、期限數字交叉核對、自動確認+義務物化、
-- 疑慮標記、人工列不動、未完成 run 擋下、稽核事件。
begin;

select plan(17);

-- ── 數字引擎:錨定防誤配 ────────────────────────────────────────────────────
select ok(public.number_in_text(14, '開工之日起十四日內'), '中文數字 14 命中');
select ok(not public.number_in_text(14, '開工後140日內'), '140 不得讓 14 過關');
select ok(not public.number_in_text(14, '開工後二十四日內'), '「二十四」不得讓「十四」過關');
select ok(public.date_in_text('2026-10-31', '應於民國115年10月31日前完工'), '民國年月日命中');
select ok(not public.date_in_text('2026-10-31', '應於115年10月13日前完工'), '日錯=不命中');

-- ── fixtures:完整 ingestion 鏈 ─────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('d7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'con@tt.test', '', now(), '{}',
   '{"full_name":"TT 廠商","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name) values ('d7100000-0000-0000-0000-000000000001', 'Triage Project');
alter table public.projects enable trigger on_project_created;

insert into public.documents (id, project_id, title, document_type) values
  ('d7400000-0000-0000-0000-000000000001', 'd7100000-0000-0000-0000-000000000001', '工程契約書.pdf', 'contract');
insert into public.document_versions (id, document_id, version_label, checksum, storage_path) values
  ('d7500000-0000-0000-0000-000000000001', 'd7400000-0000-0000-0000-000000000001', 'v1', 'sha256:tt1',
   'projects/d7100000-0000-0000-0000-000000000001/contract-packages/p/d/v/file.pdf');
insert into public.document_ingestion_runs (id, project_id, document_version_id, run_type, status, started_at, completed_at) values
  ('d7600000-0000-0000-0000-000000000001', 'd7100000-0000-0000-0000-000000000001',
   'd7500000-0000-0000-0000-000000000001', 'requirement_extraction', 'completed', now(), now()),
  ('d7600000-0000-0000-0000-000000000002', 'd7100000-0000-0000-0000-000000000001',
   'd7500000-0000-0000-0000-000000000001', 'requirement_extraction', 'processing', now(), null);

-- AI 待審列六種形狀 + 一筆人工列
insert into public.requirements (id, project_id, title, requirement_type, status, origin, ingestion_run_id,
  trigger_type, trigger_config, frequency_type, frequency_config) values
  -- 1 期限:天數與引文一致 → 自動確認+物化
  ('d7a00000-0000-0000-0000-000000000001', 'd7100000-0000-0000-0000-000000000001',
   '開工後 14 日內提送施工計畫', 'deadline', 'needs_review', 'ai', 'd7600000-0000-0000-0000-000000000001',
   'commencement', '{"offset_days":14,"offset_dir":"after"}', null, '{}'),
  -- 2 期限:天數對不上 → 待確認+疑慮
  ('d7a00000-0000-0000-0000-000000000002', 'd7100000-0000-0000-0000-000000000001',
   '開工後 14 日內投保', 'deadline', 'draft_ai', 'ai', 'd7600000-0000-0000-0000-000000000001',
   'commencement', '{"offset_days":14,"offset_dir":"after"}', null, '{}'),
  -- 3 無已核對引文 → 待確認+疑慮
  ('d7a00000-0000-0000-0000-000000000003', 'd7100000-0000-0000-0000-000000000001',
   '無引註項', 'other', 'needs_review', 'ai', 'd7600000-0000-0000-0000-000000000001',
   null, '{}', null, '{}'),
  -- 4 指定日期一致 → 自動確認
  ('d7a00000-0000-0000-0000-000000000004', 'd7100000-0000-0000-0000-000000000001',
   '2026-10-31 前完工', 'deadline', 'needs_review', 'ai', 'd7600000-0000-0000-0000-000000000001',
   'fixed', '{"fixed_date":"2026-10-31"}', null, '{}'),
  -- 5 每月幾號一致 → 自動確認
  ('d7a00000-0000-0000-0000-000000000005', 'd7100000-0000-0000-0000-000000000001',
   '每月 5 日前提送估驗', 'deadline', 'needs_review', 'ai', 'd7600000-0000-0000-0000-000000000001',
   'monthly', '{}', 'monthly', '{"day":5}'),
  -- 6 非期限型:引文已核對即自動確認(不物化)
  ('d7a00000-0000-0000-0000-000000000006', 'd7100000-0000-0000-0000-000000000001',
   '工地主任常駐', 'other', 'needs_review', 'ai', 'd7600000-0000-0000-0000-000000000001',
   null, '{}', null, '{}');
insert into public.requirements (id, project_id, title, requirement_type, status, origin) values
  -- 7 人工列:分流不碰
  ('d7a00000-0000-0000-0000-000000000007', 'd7100000-0000-0000-0000-000000000001',
   '人工補登項', 'other', 'needs_review', 'manual');

insert into public.requirement_sources (requirement_id, document_version_id, source_kind, source_verified, source_text) values
  ('d7a00000-0000-0000-0000-000000000001', 'd7500000-0000-0000-0000-000000000001', 'document', true,
   '乙方應於開工之日起十四日內檢送施工計畫書。'),
  ('d7a00000-0000-0000-0000-000000000002', 'd7500000-0000-0000-0000-000000000001', 'document', true,
   '乙方應於開工之日起三十日內投保營造綜合保險。'),
  ('d7a00000-0000-0000-0000-000000000004', 'd7500000-0000-0000-0000-000000000001', 'document', true,
   '應於民國115年10月31日前完成全部工程。'),
  ('d7a00000-0000-0000-0000-000000000005', 'd7500000-0000-0000-0000-000000000001', 'document', true,
   '乙方應於每月五日前檢送上月份估驗計價單。'),
  ('d7a00000-0000-0000-0000-000000000006', 'd7500000-0000-0000-0000-000000000001', 'document', true,
   '乙方應指派工地主任常駐工地。');

-- ── 套用分流 ────────────────────────────────────────────────────────────────
select results_eq(
  $$ select * from public.apply_transcription_triage('d7600000-0000-0000-0000-000000000001') $$,
  $$ values (4, 2) $$,
  '4 筆自動確認、2 筆標記疑慮');

select is((select status from public.requirements where id = 'd7a00000-0000-0000-0000-000000000001'),
  'approved', '數字一致的期限自動確認');
select is((select triage_doubts from public.requirements where id = 'd7a00000-0000-0000-0000-000000000001'),
  '{}'::text[], '自動確認列疑慮為空陣列');
select is((select count(*)::int from public.contract_obligations where requirement_id = 'd7a00000-0000-0000-0000-000000000001'),
  1, '自動確認的期限已物化義務(D-012)');

select is((select status from public.requirements where id = 'd7a00000-0000-0000-0000-000000000002'),
  'needs_review', '天數對不上 → 待確認');
select is((select triage_doubts from public.requirements where id = 'd7a00000-0000-0000-0000-000000000002'),
  array['期限天數與引文對不上'], '疑慮原因寫明天數不符');
select is((select triage_doubts from public.requirements where id = 'd7a00000-0000-0000-0000-000000000003'),
  array['來源未核對'], '無已核對引文=來源未核對');

select is((select count(*)::int from public.requirements
  where id in ('d7a00000-0000-0000-0000-000000000004','d7a00000-0000-0000-0000-000000000005','d7a00000-0000-0000-0000-000000000006')
    and status = 'approved'), 3, '指定日期/每月/非期限型(引文已核對)都自動確認');
select is((select count(*)::int from public.contract_obligations where requirement_id = 'd7a00000-0000-0000-0000-000000000006'),
  0, '非期限型不物化義務');

select is((select status || ':' || coalesce(triage_doubts::text, 'null')
  from public.requirements where id = 'd7a00000-0000-0000-0000-000000000007'),
  'needs_review:null', '人工列分流不碰(狀態與疑慮欄皆不動)');

select throws_ok(
  $$ select * from public.apply_transcription_triage('d7600000-0000-0000-0000-000000000002') $$,
  '轉錄分流只能套用在已完成的抽取 run',
  '未完成的 run 不可分流(AI approve 需 completed run 的紅線同義)');

select is((select count(*)::int from public.audit_events
  where event_type = 'requirement.approved' and project_id = 'd7100000-0000-0000-0000-000000000001'),
  4, '自動確認每筆都留稽核事件(actor=system)');

select * from finish();
rollback;
