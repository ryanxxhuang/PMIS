# 架構文件索引

> 狀態：**ACTIVE**
> 最後盤點：2026-08-12
> 架構文件說明設計責任；資料庫實際狀態仍以 `supabase/migrations/` 為準。

## 現行文件

| 文件 | 狀態 | 責任 |
|---|---|---|
| [`three-party-role-model.md`](three-party-role-model.md) | `ACCEPTED` | 廠商／監造／機關三方授權與 Agent 身分 |
| [`contract-first-foundation.md`](contract-first-foundation.md) | `CURRENT` | 文件、Requirement 與 BOQ 兩條資料脊椎 |
| [`traceable-document-ingestion.md`](traceable-document-ingestion.md) | `CURRENT` | 文件攝取、版本、分頁與 AI 擷取 |
| [`requirement-review-boundary.md`](requirement-review-boundary.md) | `CURRENT` | Requirement 審查、來源凍結與履約產物連結 |
| [`audit-events.md`](audit-events.md) | `CURRENT` | append-only 稽核事件與 actor snapshot |
| [`dual-engine-sync.md`](dual-engine-sync.md) | `ACTIVE CHECKLIST` | Demo 前端與正式伺服器規則的人工同步點 |
| [`project-delete-contract-first-hotfix.md`](project-delete-contract-first-hotfix.md) | `CURRENT NOTE` | 真專案、BOQ 模式與刪案的窄邊界 |

## 歷史文件

| 文件 | 狀態 | 注意事項 |
|---|---|---|
| [`project-party-role-model.md`](project-party-role-model.md) | `HISTORICAL FOUNDATION` | 保留 P0-02 原始建模；跨案角色與 `project_role` 授權方向已取消 |

## 閱讀原則

1. 角色問題先讀 `three-party-role-model.md`，不要依 P0-02 舊角色清單開發。
2. `schema.sql` 已凍結；Schema、RLS、RPC 與 Trigger 只看 migrations。
3. 文件寫 `CURRENT` 但與 migration 或實測不符時，先修文件並停止擴充，不自行猜測目標行為。
4. 尚未核准的架構候選放在 [`../ROADMAP.md`](../ROADMAP.md)，不能混入現行文件。
