# 持久化稽核事件

> CURRENT｜2026-09-17。`/activity` 讀歷史事件；估驗勾稽檢核在 `/valuation`「缺件與檢核」依現有資料計算（獨立的 `/audit` 頁已於 P6b 移除，舊連結導向估驗計價），兩者分工不同。

## 寫入與不可變性

`audit_events` 保存專案、entity、語意 event_type、動作時間、before／after、metadata 與操作時的身分快照。業務 AFTER trigger 呼叫內部 `record_audit_event`；業務變更與事件同交易成功或回滾。前端不 INSERT 事件，已移除 Store 內無作用的 `log()` 相容層。

authenticated 只有 SELECT，INSERT／UPDATE／DELETE grants 收回；immutable guard 也擋有 JWT 的特權寫入，沒有專案 admin 例外。`auth.uid() is null` 的 DBA 維護是獨立邊界。刪專案的 FK cascade 依父列已消失放行，不提供使用者刪改單筆歷史的 API。TRUNCATE 不受 RLS 約束也不觸發列級 guard，是唯一能繞過上述保證的 DML 類操作：自 migration `20260917213900` 起 anon／authenticated／service_role 對所有 public 表都沒有 TRUNCATE／REFERENCES／TRIGGER／MAINTAIN，default privileges 一併修正，新表不會再自動帶；只有表 owner（`postgres`，即 migration）能做。自 `20260919003000` 起 anon 對 `audit_events`（與所有 public 表／序列／函式）零權限，`record_audit_event` 等 security definer 函式對 anon／authenticated／PUBLIC 都不可執行（authenticated 只保留允許清單內的 RPC），寫入路徑只剩 trigger（觸發不需呼叫者的 EXECUTE）與 service 路徑。

專案 BEFORE DELETE trigger 將案名、操作人、時間、IP 與原事件數寫入獨立的 `project_deletion_records`；該表不掛專案 FK，只供平台管理員讀取，禁止 UPDATE／DELETE。它保留刪除證據，不保留原 audit_events 的內容。

## 身分與可見性

actor 快照由 auth.uid → 本案 project_memberships → active project_party 解析；找不到保留 user id 並標 authenticated_unresolved，無 JWT 則 actor_kind=system，不虛造操作人。party／project_role 只是當時身分紀錄，不是目前授權。IP 留存依 [政策](../資安/日誌留存政策.md)。

SELECT 同時要求 project_members 存取資格與 `can_read_audit_entity`：文件、版本、包與抽取來源依契約分級；實體已刪除則退回專案可讀。不能宣稱所有事件永遠全案公開，也不能宣稱刪除後仍有原實體分級保證。

不對 cost_items 建共享稽核；before／after 不包含廠商私有預算、成本或利潤。`/activity` 單頁有界查詢，依時間降冪、每頁 50 筆，過濾條件送到伺服器，不在 Store 初始化載全歷史。

## 事件範圍

估驗／金流、查驗、缺失、送審、RFI、變更、Requirement、文件版本與分類、契約包、三方身分快照、驗收、Agent 動作覆核與現場文書（`field_document.*`：建立、版本保存、簽署、提送、收件、退回、簽後更正、捨棄、作廢取代、其餘狀態變更；由簽署列／提送列／文件列的 AFTER trigger 寫，所有路徑一致；簽署事件 metadata 帶 `method`／`aal`，after_data 不重複存 IP／UA）都有各自語意 trigger；精確值域與中文標籤以 [auditEvents](../../src/lib/auditEvents.js) 及 migrations 為準。建立只需 after、刪除只需 before，轉移保留兩者；不為每個無害編輯發 generic updated。

correlation_id 已有欄位但沒有跨請求 context，現行 trigger 多傳 null。平台 AI 設定不屬單一專案，不寫此表；另由 updated_by／updated_at 與用量表記錄。稽核不是法律認證、加密簽章或 SIEM，也沒有應用層保留期／封存 API。

## 驗證

[稽核 pgTAP](../../supabase/tests/p0_05_audit_events.sql)、[actor IP](../../supabase/tests/audit_events_actor_ip.sql)、[文件讀取留痕](../../supabase/tests/document_access_audit.sql)、[Agent 覆核](../../supabase/tests/agent_actions.sql)。
