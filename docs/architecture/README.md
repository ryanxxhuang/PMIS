# 架構文件索引

> 狀態：**ACTIVE**
> 最後盤點：2026-09-11（補四份紅線與治理機制文件）
> 架構文件說明設計責任與**機制怎麼運作**；為什麼這樣定看 [`../DECISIONS.md`](../DECISIONS.md)；資料庫實際狀態仍以 `supabase/migrations/` 為準。

## 現行文件

| 文件 | 狀態 | 責任 |
|---|---|---|
| [`ai-gate-and-metering.md`](ai-gate-and-metering.md) | `CURRENT` | 第四條紅線本體：三份功能註冊表、`ai_feature_allowed` 三段判定、D-010 fail-closed 語意、記帳絕不影響回應、平台管理員自我升權防護、新增 AI 功能的完整路徑 |
| [`agent-tool-boundary.md`](agent-tool-boundary.md) | `CURRENT` | 第一與第三條紅線的執行機制：12 支工具白名單（7 唯讀＋5 草稿）、順序＝prompt cache 前提、`agent_actions` 與 `resolve_agent_action` 留痕、`handoff`／`handoff_sent` 對應、紅線二在工具層的落實、唯讀軌跡不落庫的已知缺口 |
| [`three-party-role-model.md`](three-party-role-model.md) | `ACCEPTED` | 廠商／監造／機關三方授權、Agent 身分與雙成員模型的唯一規則 |
| [`contract-first-foundation.md`](contract-first-foundation.md) | `CURRENT` | 文件、Requirement 與 BOQ 兩條資料脊椎 |
| [`traceable-document-ingestion.md`](traceable-document-ingestion.md) | `CURRENT` | 文件攝取、版本、分頁與 AI 擷取 |
| [`resumable-extraction.md`](resumable-extraction.md) | `CURRENT` | W13 契約重點抽取的跨 request 續跑：瀏覽器 driver、CAS 認領與過期標記、partial unique index 與 23505→409、活鎖防護、改批次參數作廢在途 run、逐頁讀取完整性檢查 |
| [`requirement-review-boundary.md`](requirement-review-boundary.md) | `CURRENT` | Requirement 審查、來源凍結與履約產物連結 |
| [`route-registry-governance.md`](route-registry-governance.md) | `CURRENT` | D-013 的實作：`routeRegistry` fail-closed、`hidden` ≠ 移除權限、公開與列印必須明確標記、`platformAdminOnly` 獨立維度、現況現查方式 |
| [`audit-events.md`](audit-events.md) | `CURRENT` | append-only 稽核事件與 actor snapshot |
| [`dual-engine-sync.md`](dual-engine-sync.md) | `ACTIVE CHECKLIST` | Demo 前端與正式伺服器規則的人工同步點 |
| [`project-delete-contract-first-hotfix.md`](project-delete-contract-first-hotfix.md) | `CURRENT NOTE` | 真專案、BOQ 模式與刪案的窄邊界 |

## 歷史文件

| 文件 | 狀態 | 注意事項 |
|---|---|---|
| [`project-party-role-model.md`](project-party-role-model.md) | `HISTORICAL FOUNDATION` | 保留 P0-02 原始建模；跨案角色與 `project_role` 授權方向已取消 |

## 閱讀原則

0. 碰四條紅線（CLAUDE.md §2）的程式，先讀 `ai-gate-and-metering.md`（第四條）與 `agent-tool-boundary.md`（第一、三條）；碰前端路由先讀 `route-registry-governance.md`；碰 `extract-requirements` 先讀 `resumable-extraction.md`。
1. 角色問題先讀 `three-party-role-model.md`，不要依 P0-02 舊角色清單開發。
2. `schema.sql` 已凍結；Schema、RLS、RPC 與 Trigger 只看 migrations。
3. 文件寫 `CURRENT` 但與 migration 或實測不符時，先修文件並停止擴充，不自行猜測目標行為。
4. 尚未核准的架構候選放在 [`../ROADMAP.md`](../ROADMAP.md)，不能混入現行文件。
