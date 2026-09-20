-- 回復 20260920214557:移除單次義務時點缺口的 DB 純函式。
-- 該 migration 只新增函式、不動任何資料列;回復後 DB 不再有與共用規則 timingGap 同口徑的判定
-- (前端／Edge 的「時點待補」仍由共用規則產生,pgTAP obligation_timing_gap.sql 會因函式不存在而紅)。
drop function if exists public.fn_obligation_timing_gap(text, text, integer, date, text);
