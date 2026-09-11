# 持久化稽核事件

> CURRENT｜2026-09-11。`/activity` 讀歷史事件；`/audit` 依現有資料計算風險，兩者分工不同。

## 寫入與不可變性

`audit_events` 保存專案、entity、語意 event_type、動作時間、before／after、metadata 與操作時的身分快照。業務 AFTER trigger 呼叫內部 `record_audit_event`；業務變更與事件同交易成功或回滾。前端不 INSERT 事件，已移除 Store 內無作用的 `log()` 相容層。

authenticated 只有 SELECT，INSERT／UPDATE／DELETE grants 收回；immutable guard 也擋有 JWT 的特權寫入，沒有專案 admin 例外。`auth.uid() is null` 的 DBA 維護是獨立邊界。刪專案的 FK cascade 依父列已消失放行，不提供使用者刪改單筆歷史的 API。

專案 BEFORE DELETE trigger 將案名、操作人、時間、IP 與原事件數寫入獨立的 `project_deletion_records`；該表不掛專案 FK，只供平台管理員讀取，禁止 UPDATE／DELETE。它保留刪除證據，不保留原 audit_events 的內容。

## 身分與可見性

actor 快照由 auth.uid → 本案 project_memberships → active project_party 解析；找不到保留 user id 並標 authenticated_unresolved，無 JWT 則 actor_kind=system，不虛造操作人。party／project_role 只是當時身分紀錄，不是目前授權。IP 留存依 [政策](../資安/日誌留存政策.md)。

SELECT 同時要求 project_members 存取資格與 `can_read_audit_entity`：文件、版本、包與抽取來源依契約分級；實體已刪除則退回專案可讀。不能宣稱所有事件永遠全案公開，也不能宣稱刪除後仍有原實體分級保證。

不對 cost_items 建共享稽核；before／after 不包含廠商私有預算、成本或利潤。`/activity` 單頁有界查詢，依時間降冪、每頁 50 筆，過濾條件送到伺服器，不在 Store 初始化載全歷史。

## 事件範圍

估驗／金流、查驗、缺失、送審、RFI、變更、Requirement、文件版本與分類、契約包、三方身分快照、驗收與 Agent 動作覆核都有各自語意 trigger；精確值域與中文標籤以 [auditEvents](../../src/lib/auditEvents.js) 及 migrations 為準。建立只需 after、刪除只需 before，轉移保留兩者；不為每個無害編輯發 generic updated。

correlation_id 已有欄位但沒有跨請求 context，現行 trigger 多傳 null。平台 AI 設定不屬單一專案，不寫此表；另由 updated_by／updated_at 與用量表記錄。稽核不是法律認證、加密簽章或 SIEM，也沒有應用層保留期／封存 API。

## 驗證

[稽核 pgTAP](../../supabase/tests/p0_05_audit_events.sql)、[actor IP](../../supabase/tests/audit_events_actor_ip.sql)、[文件讀取留痕](../../supabase/tests/document_access_audit.sql)、[Agent 覆核](../../supabase/tests/agent_actions.sql)。
