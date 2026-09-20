-- F1(廠商驗收修正 2026-09-20):單次契約義務的「時點缺口」——DB 側的同口徑判定。
--
-- 問題:推不出到期日的單次義務,前端／Edge／DB 都只回 null(fn_obligation_single_due),畫面只寫「無到期日」,
-- 使用者不知道是「本來就沒有時點」還是「設定沒填」。廠商驗收 E 列為未通過:「缺頻率／缺觸發點」不列待補。
-- 共用規則 _shared/ballInCourtRules.ts timingGap 自本版起把它分成兩類(與本函式逐字同口徑,pgTAP
-- supabase/tests/obligation_timing_gap.sql 對 tests/fixtures/ball-in-court.cases.json 的 expected.timing_gaps
-- 逐條斷言,Vitest 核對兩邊是同一組案例):
--   缺口(前端／Agent／早報列「時點待補」,導擷取審核廢止取代後補登):
--     fixed 沒有 fixed_date;觸發點 'monthly'(抽取器仍會給的舊值)卻沒有 recurring(缺頻率);
--     有 offset_days 卻沒有觸發點(缺起算事件);期限型契約重點(requirement_type='deadline')既無觸發點也無頻率
--     ——期限型沒有時點就物化不出到期日,人工補登表單(lib/manualRequirement.js)本來就擋,AI 抽取與舊資料沒這道關。
--   不是缺口:非期限型沒有時點(依條件觸發);觸發點 'other'(事件發生才起算,系統不追蹤該事件)。
-- 循環義務不在此函式範圍(循環規則缺口 fn_obligation_recurrence_gap、基準日缺口 fn_obligation_recurrence_anchor_key
-- 各自判);有基準日對應的觸發點也不在(基準日缺口)。
--
-- 只新增一支 IMMUTABLE 純函式,不動任何資料列、不改任何既有函式;rollback 見
-- supabase/rollbacks/20260920214557_obligation_timing_gap.down.sql(drop function)。

-- 匿名 preflight:正式庫有幾條未結單次義務會自此列為「時點待補」(只記數量,不記專案／標題／條款)。
do $$
declare
  n_fixed bigint; n_monthly bigint; n_offset bigint; n_deadline bigint;
begin
  select
    count(*) filter (where o.trigger_event = 'fixed' and o.fixed_date is null),
    count(*) filter (where o.trigger_event = 'monthly'),
    count(*) filter (where coalesce(o.trigger_event, '') = '' and coalesce(o.offset_days, 0) > 0),
    count(*) filter (where coalesce(o.trigger_event, '') = '' and coalesce(o.offset_days, 0) <= 0 and r.requirement_type = 'deadline')
    into n_fixed, n_monthly, n_offset, n_deadline
  from public.contract_obligations o
  left join public.requirements r on r.id = o.requirement_id
  where o.status not in ('已提送', '已完成', '不適用')
    and (o.recurring is null or o.recurring not in ('daily','weekly','monthly','quarterly','yearly'));
  raise notice 'obligation-timing-gap preflight fixed_no_date=%, monthly_no_rule=%, offset_no_trigger=%, deadline_no_timing=%',
    n_fixed, n_monthly, n_offset, n_deadline;
end; $$;

-- 單次義務的時點缺口(與 _shared/ballInCourtRules.ts timingGap 同口徑):完整或不適用回 null;缺項回中文說明。
create or replace function public.fn_obligation_timing_gap(
  p_requirement_type text, p_trigger_event text, p_offset_days integer, p_fixed_date date, p_recurring text
) returns text language sql immutable as $$
  select case
    when p_recurring in ('daily','weekly','monthly','quarterly','yearly') then null
    when p_trigger_event in ('award','notice','commencement','completion') then null
    when p_trigger_event = 'fixed' then (case when p_fixed_date is null then '指定日期未填' else null end)
    when p_trigger_event = 'monthly' then '觸發點為每月，循環規則未設定'
    when p_trigger_event = 'other' then null
    when coalesce(p_offset_days, 0) > 0 then '有 ' || p_offset_days || ' 日期限，起算事件未設定'
    when p_requirement_type = 'deadline' then '期限型契約重點未設定觸發點或頻率'
    else null end;
$$;
revoke all on function public.fn_obligation_timing_gap(text, text, integer, date, text) from public, anon, authenticated;
comment on function public.fn_obligation_timing_gap(text, text, integer, date, text) is
  'F1 單次義務時點缺口:與 _shared/ballInCourtRules.ts timingGap 同口徑(pgTAP obligation_timing_gap.sql 對共用案例逐條斷言)';
