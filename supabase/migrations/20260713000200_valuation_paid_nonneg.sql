-- Migration: 實收金額非負約束(Codex UX/AI 報告 P1-07 補強)。
-- 請款→收款序列與「未核定不可有金流」由 20260712001800 payment_flow trigger 已強制;
-- 此處補「實收不得為負」的硬約束(前端 + store 亦擋)。既有資料實收皆為正,加約束安全。
alter table public.valuations drop constraint if exists valuations_paid_amount_nonneg;
alter table public.valuations add constraint valuations_paid_amount_nonneg
  check (paid_amount is null or paid_amount >= 0);
