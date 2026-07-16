-- ── W-01 義務佐證鏈 ──────────────────────────────────────────────────────────
-- 契約義務「已提送」原本只是一顆 toggle,沒有連到實際提送了什麼——機關稽核
-- 勾稽鏈(估驗↔日誌↔查驗↔試體)在義務這環是斷的。加一欄把義務掛上送審文件:
-- 標為已提送時可選一筆 submittal 當佐證,義務卡顯示佐證連結。
-- on delete set null:送審被刪時義務不受牽連,只是失去佐證連結(義務狀態不回退)。
alter table public.contract_obligations
  add column if not exists evidence_submittal_id uuid references public.submittals(id) on delete set null;

comment on column public.contract_obligations.evidence_submittal_id
  is 'W-01 義務佐證:提送此義務時對應的送審文件(submittals.id);null=未掛佐證';
