# 開發規則

> ACTIVE｜2026-09-11

## 1. 最小閱讀路徑

每次開發先讀 [CURRENT.md](CURRENT.md) 與 [決策](docs/DECISIONS.md)。只有續接既有工作才讀 [ROADMAP](docs/ROADMAP.md)；按改動主題從 [架構索引](docs/architecture/README.md) 選相關文件。UI 改動讀 [Apple 設計規範](docs/UIUX-Apple-設計規範.md)。不要掃讀全部 docs、簡報或歷史紀錄。

## 2. 開始前

在當前工作包或 PR 寫五行：**問題、目標、不做、影響、驗收**（驗收最多五項），不用另開報告。只實作使用者已授權範圍；`PLANNED`／`CANDIDATE` 不是授權。改產品邊界、角色、資料責任或安全規則，先更新 Decision／架構文件並取得使用者確認。

## 3. 最小改動

- 一個概念只有一個主要資料來源；第二個實際使用點出現後才抽共用層。
- 跨頁共享資料放 Store；單頁有界資料可直接查 Supabase；不為形式統一加 repository、service 或 DSL。
- 只做公共工程；不為假想的其他業務預建框架，不順手重寫相鄰模組。
- 移除相容層前盤點資料、讀寫端與回復方式。
- 繁體中文、台灣工程用語；註解說明原因。

## 4. 不可跨越的邊界

- 專案業務角色只有 `contractor`、`supervisor`、`owner`。現場／品管／工安是廠商內部分工。
- AI 只查詢、彙整、擬稿；人執行業務核定、判定、結案與驗收。契約轉錄自動確認依 D-019 例外，必須揭露原文優先與核對疑慮。
- 金額、期限、合格判定由確定性程式／DB 計算。Agent 草稿與動作留 `agent_actions`。
- AI 功能須在前端／Edge 註冊鏡像與 DB `ai_features` 登記，伺服器過閘門並記用量，呼叫帶 `project_id`；閘門失敗拒絕服務，記帳失敗不阻擋回應。
- RLS、RPC、Guard Trigger 是安全邊界；前端 `can` 只是 UX。所有路由登記在 `src/lib/navConfig.js`，未登記拒絕，公開與列印路由須明確標註。
- 只有 `approved` Requirement 是契約要求權威；obligation 是單向產生的履約 runtime。
- `project_members` 管專案存取／admin；`profiles.org_type` 管三方業務身分；`project_memberships` 管契約方快照，不能由 `project_role`／party 推導權限。詳見 [三方模型](docs/architecture/three-party-role-model.md)。

## 5. 資料與測試

- `supabase/migrations/` 是 DB 唯一真相（舊 `schema.sql` 已移除，可由 Git 追溯）。已套用 migration 不回改，新增 migration 並附資料保留、相容與回復說明及 pgTAP；新表檢查 default grants。
- 權限／狀態轉移必須有 pgTAP；確定性計算必須有單元測試。
- 可能超過 1,000 列的查詢使用既有分頁工具，避免 PostgREST 靜默截斷。
- 驗證：`npm run check:docs`、`npm run lint`、`npm test`、`npm run build`；Edge 改動跑 `npm run check:edge`；依範圍跑 Demo E2E、真後端 E2E／`npm run test:db`，操作見 [README](README.md) 與 [Supabase 設定](supabase/SETUP.md)。
- 本機 npm 若因全域 `os=linux` 缺 darwin binding，使用 `npm i --os=darwin --cpu=arm64`；Edge 部署在 colima 下需 `--use-api`。

## 6. 完成定義

實作在授權範圍、相關驗證通過，並同步 **CURRENT、受影響架構／操作指南、BASELINE**。未驗證能力不能寫成已完成；正式 migration／Edge 部署版本記入 CURRENT §6.3。commit、push、部署、正式 migration 都需使用者明確要求。

## 7. 文件維護

現在怎麼運作以程式／migration／實測為證據；應該怎麼運作以已接受 Decision 為準，衝突先停在文件階段。CURRENT 只留現況，ROADMAP 只留未完成事項，BASELINE 只留驗證結果；交付歷程寫 commit／PR。過時規格與重複報告可依使用者授權刪除，由 Git 追溯，不能改寫歷史報告來假裝符合現況。
