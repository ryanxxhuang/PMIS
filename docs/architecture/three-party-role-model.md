# 三方角色模型

> 狀態：**ACTIVE**
> 決策日期：2026-08-12

## 決策

PMIS 的系統角色只有三種：

| 角色值 | 顯示名稱 | 授權範圍 |
|---|---|---|
| `contractor` | 施工廠商 | 填報、提送、成本、施工、品質與工安工作 |
| `supervisor` | 監造單位 | 查驗、審查、覆核與監造判定 |
| `owner` | 主辦機關 | 契約監督、付款、驗收與機關核定 |

現場工程師、工地主任、品管工程師與工安人員是廠商的職稱或內部分工，**不是系統角色，也不是權限來源**。所有廠商成員具備相同的廠商功能邊界，由廠商自行決定人員實際承辦事項。

## 三個身分資料來源

| 資料 | 唯一責任 | 不負責 |
|---|---|---|
| `profiles.org_type` | 目前三方業務角色與 Agent 身分 | 專案是否可進入、專案管理權 |
| `project_members` | 專案存取資格與 legacy `admin/member` 管理旗標 | 現場／品管分工、文件契約方身分 |
| `project_parties` + `project_memberships` | 文件歸屬、契約相對方、稽核 actor 身分快照 | 業務授權與 Agent persona |

`project_memberships.project_role` 暫時保留作歷史相容與描述性職稱，不得用於 RLS、功能導覽、Agent 工具或提醒分流。

## Agent 模型

Agent 身分與三方角色一對一：

- `contractor` → 廠商 Agent，同時提供施工日誌與自主檢查草稿工具。
- `supervisor` → 監造 Agent。
- `owner` → 機關 Agent。

舊的 `field` 與 `qc` Agent 草稿會由資料庫相容 Trigger 正規化成 `contractor`。新程式不得再產生 `field` 或 `qc` 角色值。

## 非目標

這次決策不建立廠商內部派工、職務簽核或額外權限矩陣。如果未來確實需要派工，新增的只能是「工作指派／通知對象」，不能讓它變成第四套授權角色。

## 驗證條件

1. `AGENT_ROLES` 只有 `contractor/supervisor/owner`。
2. 廠商 Agent 同時可使用 `draft_daily_log` 與 `draft_inspection`。
3. Agent、每日提醒與交接不讀 `project_memberships.project_role` 決定角色。
4. `agent_actions.agent_role` 最終只儲存三方值；舊 `field/qc` 寫入會自動轉成 `contractor`。
