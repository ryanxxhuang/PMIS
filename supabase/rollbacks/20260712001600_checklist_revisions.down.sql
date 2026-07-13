-- 回退 20260712001600_checklist_revisions.sql:
-- 拆 guard 與索引、移除版次欄位與缺失來源關聯。
-- 注意:回退會抹掉修訂鏈資訊(rev/supersedes/原因),僅在尚未產生修訂資料時使用。

drop trigger if exists checklist_records_guard on public.checklist_records;
drop function if exists public.checklist_records_guard();

drop index if exists public.defects_open_per_checklist_uidx;
alter table public.defects drop column if exists source_checklist_record_id;

drop index if exists public.checklist_records_supersedes_uidx;
drop index if exists public.checklist_records_root_idx;
alter table public.checklist_records
  drop column if exists revision_reason,
  drop column if exists root_id,
  drop column if exists supersedes_id,
  drop column if exists rev;
