-- 回復 20260920050000_checklist_template_authoring（P3g 檢查表／監造查驗表單範本的建立與編輯）
--
-- 這支 migration 只新增兩個 trigger 與三支函式，沒有加欄、沒有改資料。回復＝把 trigger 與函式拿掉，
-- checklist_templates 回到「RLS policy(can_write)決定誰能寫、寫什麼形狀都收」的 P3c 狀態。
--
-- 資料影響：無。執行本檔之前由 guard 正規化過的列（標題去空白、items 只保留九個鍵、applies_to 去重排序、
-- version 由伺服器編號）維持正規化後的樣子——那是合法形狀的子集，P3c 的程式與 Edge 候選推斷都讀得懂，
-- 不需要也不應該還原成原始輸入（原始輸入沒有留存）。
--
-- 回復後重新出現的風險（與 P3c 當時相同，這也是本 migration 的理由）：
--   * 任何 can_write 成員都能建立／編輯 kind='inspection_form' 的監造查驗表單範本。
--   * 已被檢查紀錄或查驗引用的範本可以被就地改標題與檢查項目（等於改動已簽署紀錄的呈現）。
--   * 刪除被引用的範本會經 checklist_records.template_id 的 on delete cascade 一併刪掉那些檢查紀錄。
-- 因此本檔只在必須回退時使用，回退後請避免從介面編輯已使用的範本。

begin;

drop trigger if exists checklist_templates_del_guard on public.checklist_templates;
drop trigger if exists checklist_templates_guard     on public.checklist_templates;

drop function if exists public.checklist_templates_del_guard();
drop function if exists public.checklist_templates_guard();
drop function if exists public.fn_checklist_items_normalize(jsonb);
drop function if exists public.fn_checklist_applies_to(jsonb);

commit;
