# GovAgent／PMIS 文件索引

> 狀態：**ACTIVE**
> 最後盤點：2026-08-13
> 用途：說明每份文件的責任、時效與能不能作為開發依據。

## 文件狀態

| 狀態 | 意義 | 可否直接作為開發依據 |
|---|---|---|
| `CURRENT` | 已實作現況，需與程式及實測一致 | 可以 |
| `ACCEPTED`／`ACTIVE` | 已定案決策、規則或仍有效的操作文件 | 可以 |
| `PLANNED`／`CANDIDATE` | 待討論或待核准 | 不可以 |
| `HISTORICAL`／`EVIDENCE` | 舊規劃、測試或事件證據 | 不可以 |

## 開發必讀

| 順序 | 文件 | 責任 |
|---|---|---|
| 1 | [`../DEVELOPMENT.md`](../DEVELOPMENT.md) | 開發流程、簡單化原則與完成定義 |
| 2 | [`../CURRENT.md`](../CURRENT.md) | 目前產品與實作現況 |
| 3 | [`DECISIONS.md`](DECISIONS.md) | 已定案決策 |
| 4 | [`ROADMAP.md`](ROADMAP.md) | 候選改動；未核准前不得實作 |
| 5 | [`architecture/README.md`](architecture/README.md) | 架構文件狀態與閱讀入口 |
| 6 | [`PROJECT_TREE.md`](PROJECT_TREE.md) | 詳細目錄、模組責任與修改入口 |
| 7 | [`REAL_BACKEND_E2E.md`](REAL_BACKEND_E2E.md) | 手動真 Supabase staging 測試與清理 |

目前產品整理評估見 [`產品全案評估報告-2026-08-12.md`](產品全案評估報告-2026-08-12.md)；全產品 UI/UX 第二版重新評估、36 路由處置與已核准 W8 分階段計畫見 [`W8-0-UIUX-全產品評估與改版藍圖-2026-08-13.md`](W8-0-UIUX-全產品評估與改版藍圖-2026-08-13.md)。W8-1 已由 PR #11 完成；後續工作以 `ROADMAP.md` 的第一個未完成 W8 工作包為準。Requirement／obligation 的決策與正式庫匿名基線見 [`W5-1-Requirement-Obligation-決策書.md`](W5-1-Requirement-Obligation-決策書.md)；已實作現況以 `CURRENT.md` 為準。

長期方向見 [`北極星-政府機關-Agent-平台.md`](北極星-政府機關-Agent-平台.md)。專案入口、啟動與驗證指令見 [`../README.md`](../README.md)。AI 工具的 repo 指令見 [`../AGENTS.md`](../AGENTS.md)；[`../CLAUDE.md`](../CLAUDE.md) 是相同原則的 Claude 相容入口。

## 現行架構

架構文件的逐份狀態集中在 [`architecture/README.md`](architecture/README.md)。目前主要文件：

- [`architecture/three-party-role-model.md`](architecture/three-party-role-model.md)：廠商／監造／機關三方角色，以及雙成員模型的唯一判斷規則。
- [`architecture/contract-first-foundation.md`](architecture/contract-first-foundation.md)：工程財務與文件履約兩條資料脊椎。
- [`architecture/traceable-document-ingestion.md`](architecture/traceable-document-ingestion.md)：文件版本、分頁、AI 擷取與來源。
- [`architecture/requirement-review-boundary.md`](architecture/requirement-review-boundary.md)：Requirement 人工審查與產物連結。
- [`architecture/audit-events.md`](architecture/audit-events.md)：不可改寫的稽核事件。
- [`architecture/dual-engine-sync.md`](architecture/dual-engine-sync.md)：Demo 與正式規則的同步清單。
- [`architecture/project-delete-contract-first-hotfix.md`](architecture/project-delete-contract-first-hotfix.md)：真專案、BOQ 模式與刪案的現行窄邊界。
- [`architecture/project-party-role-model.md`](architecture/project-party-role-model.md)：`HISTORICAL`，只保留 P0-02 建模背景。

資料庫實際結構永遠以 [`../supabase/migrations/`](../supabase/migrations/) 為準。

## 操作、部署與驗收

| 文件 | 狀態 | 用途 |
|---|---|---|
| [`../supabase/SETUP.md`](../supabase/SETUP.md) | `ACTIVE` | 本機 Supabase、Edge、Email 與 pgTAP 設定 |
| [`上線前-真案-dry-run-檢查清單-2026-07-13.md`](上線前-真案-dry-run-檢查清單-2026-07-13.md) | `ACTIVE CHECKLIST` | 正式站真案驗收；以執行當日環境為準 |
| [`Cloudflare搬家-逐步設定指南.md`](Cloudflare搬家-逐步設定指南.md) | `HISTORICAL RUNBOOK` | 2026-08-11 搬遷紀錄，不是目前部署規格 |
| [`上線設定指南-2026-07-16.md`](上線設定指南-2026-07-16.md) | `HISTORICAL` | 舊 GitHub Pages／Supabase 設定快照 |
| [`上線衝刺-課表-2026-08.md`](上線衝刺-課表-2026-08.md) | `PLANNING SNAPSHOT` | 2026-08 商業上線時程，不是產品規格 |

## 資安與採購

| 文件 | 狀態 | 用途 |
|---|---|---|
| [`資安/日誌留存政策.md`](資安/日誌留存政策.md) | `ACTIVE POLICY` | 日誌種類與至少六個月留存政策 |
| [`資安/資通系統防護基準-普通級-符合性對照.md`](資安/資通系統防護基準-普通級-符合性對照.md) | `DATED ASSESSMENT` | 2026-08-08 普通級控制對照；交付前須重查現況 |
| [`資安/中央大學-雲端SaaS採購資安要求-查證結果.md`](資安/中央大學-雲端SaaS採購資安要求-查證結果.md) | `DATED RESEARCH` | 中央大學採購資安一手資料整理 |
| [`資安/中央大學-個資委外與境外傳輸-對策.md`](資安/中央大學-個資委外與境外傳輸-對策.md) | `DATED RESEARCH` | 個資委外與境外傳輸對策 |
| [`資安/弱點掃描-2026-08-11/掃描結果與處置對照.md`](資安/弱點掃描-2026-08-11/掃描結果與處置對照.md) | `EVIDENCE` | 兩次弱掃的處置摘要 |
| `資安/弱點掃描-2026-08-11/zap-report-*.md` | `GENERATED EVIDENCE` | ZAP 原始報告，不作產品規格 |
| [`採購/中央大學-小額採購簽辦-簽稿範本與法源.md`](採購/中央大學-小額採購簽辦-簽稿範本與法源.md) | `DATED TEMPLATE` | 特定機關簽辦草稿與法源；送件前重查 |

## 對外與會議資料

| 文件 | 狀態 | 用途 |
|---|---|---|
| [`pitch/pptx/README.md`](pitch/pptx/README.md) | `ACTIVE BUILD NOTE` | 簡報重建方式，不是產品規格 |
| `pitch/*.html`、`pitch/*.pptx` | `DATED DELIVERABLE` | 特定日期對外簡報 |
| [`會議小抄-中央大學營繕組-2026-08-12.md`](會議小抄-中央大學營繕組-2026-08-12.md) | `HISTORICAL` | 特定會議準備 |

## 歷史產品、研究與驗收

以下文件完整保留當時判斷，但不得用來決定目前功能、角色或測試基線：

| 文件 | 原用途 |
|---|---|
| [`../PRD.md`](../PRD.md) | 早期 PMIS AI／Procore 原型 PRD |
| [`../SCOPE.md`](../SCOPE.md) | 2026-07-09 現況與路線快照 |
| [`AI-Agent-大改版-產品重定位報告-2026-07-25.md`](AI-Agent-大改版-產品重定位報告-2026-07-25.md) | 已被三方模型取代的四 Agent 改版分析 |
| [`PMIS-UX-AI-體驗檢視-2026-07-13.md`](PMIS-UX-AI-體驗檢視-2026-07-13.md) | 特定站點與版本的 UX／AI 檢視 |
| [`PMIS-全案優化報告-2026-07-16.md`](PMIS-全案優化報告-2026-07-16.md) | 特定 commit 的程式盤點 |
| [`正式版三角色全功能驗收報告-2026-07-12.md`](正式版三角色全功能驗收報告-2026-07-12.md) | 第一輪正式版三方驗收 |
| [`PMIS-正式版三角色深度驗收測試-第二輪-2026-07-12.md`](PMIS-正式版三角色深度驗收測試-第二輪-2026-07-12.md) | 第二輪驗收證據 |
| [`PMIS-正式版三角色深度驗收測試-第三輪-2026-07-12.md`](PMIS-正式版三角色深度驗收測試-第三輪-2026-07-12.md) | 第三輪驗收證據 |
| [`PMIS-正式版三角色終極驗收-第四輪-2026-07-13.md`](PMIS-正式版三角色終極驗收-第四輪-2026-07-13.md) | 第四輪驗收證據 |

## 維護規則

1. 現況改變就更新 `CURRENT.md`。
2. 已確認的新決策寫入 `DECISIONS.md`；未確認想法只放 `ROADMAP.md`。
3. 架構責任改變時更新對應文件與 `architecture/README.md`。
4. 新日期式報告必須標示 `HISTORICAL`、`EVIDENCE` 或 `DATED`，不能自稱永久現況。
5. 歷史文件不逐段改寫；以狀態標示保留原始證據。
