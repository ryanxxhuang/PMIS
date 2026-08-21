-- W10 契約期限追蹤鏈:手填契約總價。
-- 逾期違約金多為「契約總價千分之X/日」的百分比制,沒有契約總價就算不出來。
-- 現行唯一來源是 BOQ 標單的 billable_total——但契約期限追蹤鏈的價值主張正是
-- 「不需要標單就能跑」(上傳契約→抽期限→提醒),所以補一個手填欄位:
-- 有填以手填為準(契約價金總額未必等於標單加總),沒填前端 fallback 到 BOQ。
-- 寫入沿用 projects 既有的 creator-only update 政策,不另開權限。
alter table public.projects
  add column if not exists contract_total numeric
  check (contract_total is null or contract_total >= 0);

comment on column public.projects.contract_total is
  '契約價金總額(手填)。罰款試算基準:有值優先於 BOQ billable_total;null=未填。';
