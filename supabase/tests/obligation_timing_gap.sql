-- F1 單次契約義務的時點缺口(pgTAP)。
-- 對應 migration 20260920214557_obligation_timing_gap.sql。
-- 釘三件事:1) fn_obligation_timing_gap 對共用案例(tests/fixtures/ball-in-court.cases.json expected.timing_gaps)
-- 每一條回同一句——Vitest(src/lib/ballInCourt.cases.test.js)核對本檔含案例表的每一條呼叫與期望值,改一邊另一邊紅;
-- 2) 「推不出到期日」不再靜默:單次未結義務只要 fn_obligation_single_due 回 null,就一定落在
--    時點缺口／基準日缺口／依條件觸發(非期限型無時點、觸發點其他)三者之一,沒有第四種;
-- 3) 函式不對 authenticated／anon 開放、IMMUTABLE(確定性)。
begin;

select plan(21);

-- ── 結構與授權 ──────────────────────────────────────────────────────────────
select has_function('public', 'fn_obligation_timing_gap', array['text','text','integer','date','text'], '時點缺口函式存在');
select is((select provolatile from pg_proc where proname = 'fn_obligation_timing_gap' and pronamespace = 'public'::regnamespace), 'i', '時點缺口函式 IMMUTABLE(確定性)');
select is(has_function_privilege('authenticated', 'public.fn_obligation_timing_gap(text, text, integer, date, text)', 'EXECUTE'), false, 'authenticated 不可直接呼叫');
select is(has_function_privilege('anon', 'public.fn_obligation_timing_gap(text, text, integer, date, text)', 'EXECUTE'), false, 'anon 不可直接呼叫');

-- ── 共用案例逐條(與 expected.timing_gaps.cases 同序同值;引號內就是共用規則 timingGap 的句子)────────────
select is(public.fn_obligation_timing_gap('deadline', 'fixed', null, null, null), '指定日期未填', '指定日期未填');
select is(public.fn_obligation_timing_gap('deadline', 'fixed', null, '2026-06-15', null), null, '指定日期有填');
select is(public.fn_obligation_timing_gap('report', 'monthly', null, null, null), '觸發點為每月，循環規則未設定', '觸發點每月缺頻率');
select is(public.fn_obligation_timing_gap('report', 'monthly', null, null, 'monthly'), null, '觸發點每月且有循環規則');
select is(public.fn_obligation_timing_gap('checklist', null, 14, null, null), '有 14 日期限，起算事件未設定', '有期限缺起算事件');
select is(public.fn_obligation_timing_gap('deadline', null, null, null, null), '期限型契約重點未設定觸發點或頻率', '期限型無觸發點無頻率');
select is(public.fn_obligation_timing_gap('checklist', null, null, null, null), null, '非期限型無明確時點');
select is(public.fn_obligation_timing_gap(null, null, null, null, null), null, '類型未知無時點');
select is(public.fn_obligation_timing_gap('deadline', 'other', 7, null, null), null, '觸發點其他依事件觸發');
select is(public.fn_obligation_timing_gap('deadline', 'commencement', 15, null, null), null, '有基準日觸發點由基準日缺口判');
select is(public.fn_obligation_timing_gap('deadline', null, null, null, 'weekly'), null, '循環義務由循環規則缺口判');

-- ── 沒有第四種「無到期日」:單次義務 single_due 回 null ⇒ 時點缺口 ∨ 基準日缺口 ∨ 依條件觸發 ──────────────
-- 觸發點值域 × 三種契約重點類型 × 有無日期／天數,窮舉單次義務會遇到的組合;基準日全給(所以 single_due 為 null
-- 只可能是「觸發點推不出」),再用「基準日全缺」對照基準日缺口那一邊。
create temp table timing_matrix as
select t.trigger_event, r.requirement_type, d.fixed_date, o.offset_days
from (values ('award'), ('notice'), ('commencement'), ('completion'), ('monthly'), ('fixed'), ('other'), (null)) as t(trigger_event)
cross join (values ('deadline'), ('checklist'), (null)) as r(requirement_type)
cross join (values ('2026-06-15'::date), (null::date)) as d(fixed_date)
cross join (values (14), (null::int)) as o(offset_days);

select is(
  (select count(*)::int from timing_matrix m
    where public.fn_obligation_single_due(m.trigger_event, m.offset_days, 'after', m.fixed_date, '2026-01-10', '2026-01-20', '2026-02-01', '2026-12-31') is null
      and public.fn_obligation_timing_gap(m.requirement_type, m.trigger_event, m.offset_days, m.fixed_date, null) is null
      and public.fn_obligation_single_anchor_key(m.trigger_event) is null
      and not (m.trigger_event = 'other' or (m.trigger_event is null and coalesce(m.offset_days, 0) = 0 and m.requirement_type is distinct from 'deadline'))),
  0, '基準日齊全下推不出到期日的單次義務,不是時點缺口就是依條件觸發(觸發點其他／非期限型無時點),沒有靜默的第四種');
select is(
  (select count(*)::int from timing_matrix m
    where public.fn_obligation_single_due(m.trigger_event, m.offset_days, 'after', m.fixed_date, null, null, null, null) is null
      and public.fn_obligation_timing_gap(m.requirement_type, m.trigger_event, m.offset_days, m.fixed_date, null) is null
      and public.fn_obligation_single_anchor_key(m.trigger_event) is null
      and not (m.trigger_event = 'other' or (m.trigger_event is null and coalesce(m.offset_days, 0) = 0 and m.requirement_type is distinct from 'deadline'))),
  0, '基準日全缺下同樣成立:多出來的 null 全由基準日缺口(fn_obligation_single_anchor_key)承接');
select is(
  (select count(*)::int from timing_matrix m
    where public.fn_obligation_timing_gap(m.requirement_type, m.trigger_event, m.offset_days, m.fixed_date, null) is not null
      and public.fn_obligation_single_due(m.trigger_event, m.offset_days, 'after', m.fixed_date, '2026-01-10', '2026-01-20', '2026-02-01', '2026-12-31') is not null),
  0, '有時點缺口的組合一定推不出到期日(缺口不會蓋掉算得出來的日期)');
select is(
  (select count(*)::int from timing_matrix m
    where public.fn_obligation_timing_gap(m.requirement_type, m.trigger_event, m.offset_days, m.fixed_date, null) is not null
      and public.fn_obligation_single_anchor_key(m.trigger_event) is not null),
  0, '時點缺口與基準日缺口互斥(同一條義務不會兩邊都列)');

-- ── 循環義務不歸本函式(循環規則缺口另判),與 fn_obligation_recurrence_gap 不重疊 ──────────────────────
select is(public.fn_obligation_timing_gap('deadline', 'fixed', null, null, 'monthly'), null, '循環 fixed 缺起算日由 fn_obligation_recurrence_gap 判(本函式回 null)');
select is(public.fn_obligation_recurrence_gap('monthly', 5, null, null, 'fixed', null), '指定日期缺起算日', '對照:循環規則缺口那一邊有接住');

select * from finish();
rollback;
