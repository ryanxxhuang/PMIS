-- ── 查驗申請檢附自主檢查表(W8-5 真人驗收 S-2)────────────────────────────────
-- 使用者原句:「正常申請查驗會送查驗單,還會檢附廠商的自主檢查表」。
-- 三級品管的第一級(廠商自主檢查)與第二級(監造查驗)在資料上原本斷鏈:
-- inspections 只有純文字欄位,checklist_records 與查驗無任何關聯。這裡補一條
-- 單向引用:查驗申請「檢附」一張自主檢查紀錄,監造據以現場查驗;查驗執行
-- 結果不回寫檢查紀錄(檢查紀錄是第一級證據,存檔後只能走修訂版次)。
-- on delete set null:檢查紀錄被刪(checklist_records_guard 只放行未判定且未被
-- 修訂引用的紀錄)不連坐查驗單——查驗本身仍是獨立的第二級證據。
-- RLS 不需改:inspections 四條 policy 均為列級(my_project_ids/can_write),
-- 無欄位白名單,新欄自動涵蓋(已對照 baseline 20260711000000 查證)。
-- grants 亦不需補:20260712001200 對既有表是 table 級 grant
-- select/insert/update/delete to authenticated,加欄位即生效。
alter table public.inspections
  add column if not exists checklist_record_id uuid
    references public.checklist_records(id) on delete set null;

-- FK 欄照本 repo 慣例補索引(如 checklist_records_wi_idx):沒有它,
-- 刪檢查紀錄時 set null 要全表掃 inspections。
create index if not exists inspections_checklist_record_idx
  on public.inspections(checklist_record_id);
