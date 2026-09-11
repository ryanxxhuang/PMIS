# 真專案模式與刪案邊界

> CURRENT｜2026-09-11。D-022 本分支已實作，正式 migration 尚未套用。

`isPersistedProject` 表示已登入且選取真實 Supabase 專案，文件、契約重點、基準日與義務不需等待標單匯入。`hasDbBoq`／`dbMode` 表示真案已載入 DB 工項；依標單的流程仍用較窄的條件，避免把 Demo 工項 ID 寫入真案。

[delete_project](../../supabase/migrations/20260911110000_project_admin_single_source.sql) 只由 `is_project_admin` 授權，再刪專案根列。admin 來源是 project_members，不是 created_by，也不增加業務核定權。

子列護欄使用「父列已不存在」識別 FK cascade；目前不使用 `pmis.project_delete_id` GUC。不能從單列直接刪稽核歷史、已審契約內容或受保護商務紀錄。文件刪除另走 `delete_document`，不可拿整案 cascade 當一般文件刪除權限。

`projects_record_deletion` 在根列刪除前寫入 `project_deletion_records`，獨立保存誰刪了哪案及原事件數；它不取代原事件封存。

[專案刪除 pgTAP](../../supabase/tests/project_deletion_records.sql)、[成員 admin 矩陣](../../supabase/tests/invite_org_confirm.sql)、[真案寫入測試](../../src/store/slices/persistedWrites.test.js) 覆蓋上述分界。整案 DB 刪除不等於所有外部 Storage 已清乾淨，需依實際清理流程核對。
