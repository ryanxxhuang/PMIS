# 未完成工作與候選

> ACTIVE｜2026-09-11。唯一續接清單；候選不是實作授權。已完成交付查 Git／PR，不在此累積歷程。先核 CURRENT 與程式，避免重新實作已完成項。

## 正式後端與驗收仍待處理

2026-09-11 前端、DB（含 D-022）與 17 支 Edge 已三面同步（版本見 CURRENT §6.3）；以下驗收仍待執行。

- 本機 `ANTHROPIC_API_KEY` 仍失效（2026-09-11 實測 401），live 真後端 E2E 與抽取評測都被擋；換有效金鑰後依 [部署指南](operations/deploy.md) 與 [E2E 指南](REAL_BACKEND_E2E.md) 重跑。
- 真人手機輪、真案三角色操作、抽取準確率／召回率與還原／提醒送達演練仍待驗證。

## 待使用者決策

- 導覽 hidden 工作面的恢復策略、成員頁入口、機關多案落地；D-014 五步初始化條文同步。
- AI 成本上限與超額行為（原定監看不擋）、定價與 DB plan 對應、DPA 附約內容。`/terms`／`/privacy` 已於 2026-09-11 依現行架構草擬上線（版本 0.9，含境外模型揭露），**待律師審閱**後升 1.0。
- `demo_requests` 個資保存期／清除；Agent 唯讀呼叫軌跡粒度；刪案後原稽核事件保存責任；Edge log 可能含 DB 失敗列內容的存取／留存。
- 客戶簡報與 D-019 自動確認語意、品牌／買方／銷售路徑的敘事對齊。
- 後台設定：模型金鑰、Anthropic 月上限、Auth leaked-password／autoconfirm／SMTP、repo 可見性、正式殘留專案與 Storage 孤兒清理。現值須重新查證，舊盤點不代表目前數量。

## 候選工作（CANDIDATE，依任務另行核准）

### 履約與可達性

- 正式且已匯標單時成員頁缺一般入口（待實測確認是否仍成立）。驗收應從首頁可見控制到目的頁，三方期限不混入別方；機關責任期限已於 2026-09-11 進 `todayTasks`。
- 五個 hidden 工作面依決策復出、補點擊可達性 E2E；補 `/requirements/review`、`/deadlines`、`/project/new` 手機 a11y 與 Portfolio error state。
- 循環義務目前只算下次日期；逐期資料、月末／跨年／29～31 日、基準日更正與準時率需產品決策＋migration／pgTAP。先揭露限制，再接送審／佐證流程。
- 後端依身分回義務集合與 `canAct` 才可刪前端 `VISIBLE`；`report-issue`／`re-extract` 專用端點仍未做。
- `/deadlines` 無期限列是否隱藏、義務預警窗 7→14 天、機關撤銷已核准變更的 UI 入口、工項重設 guard 訊息均待決。
- 「契約義務」可見字串、同領域多個名稱與「逾期 N 天／日」統一；`dueText` 被 regex／E2E 使用，需一併核對。

### 資料與安全

- `item_schedules` 缺 `guard_project_identity`，可能跨案引用 work_item；需 migration 與跨案 pgTAP。
- `work_items(project_id,item_key)` 部分唯一索引；正式資料重查重複後再做。部分領域狀態欄無 CHECK（含 obligation）；processing run 無轉移 guard。
- DB 顧問問題需重核：熱點／FK 索引、auth_rls_initplan、重複 permissive policy、search_path、security-definer grants、pg_net schema。public 表 anon 的 TRUNCATE default grant 不受 RLS 控制，PostgREST 不暴露該操作。
- 刪案串 Storage 清理；`project_deletion_records` 已留刪除行為與事件數，不保存原事件內容。DB 備份不含 Storage 物件：`scripts/backup-storage.mjs` 與 [備份 runbook](operations/backup.md) 已就位，但**未對正式 bucket 實跑、未做 restore/RTO 演練**。rollback 判準／缺口與 `repair_` 命名尚待整理。
- `agent_actions`／`ai_usage_events` append-only、防個資送模型、唯讀軌跡留存、使用量記帳失敗留 audit；不得自行決定個資保存粒度。
- CSV formula injection 的前置空白／tab、CR quote、科學記號判定邊界仍存在，測試只記錄現況。
- AI 成本原子預留／rate limit、MFA／鎖定／停用、試用申請分頁／清理須依前節政策實作。

### 抽取與 Agent

- 真契約評測集應覆蓋掃描件、表格、附件、補充條款、中文數字、民國年、跨頁與衝突；量測出處、條款召回、責任方、期限、重複率、人工修正時間。24 批上限、OCR、語意漏抽尚未解決。
- 契約包 status 在上傳後才由前端重算；stale 修復／重新分類後可能未同步，轉 needs_attention 沒留痕。
- 抽取某批 upsert 失敗時 run 仍可 completed，verified_source_count 可能含未落庫批次；要調整行為需獨立測試。
- ai_usage_events.error_code 仍為泛用 claude_error／exception，未保存限流／逾時細分類。
- Agent 模型呼叫 timeout／重試、回答 sources、前後端球權涵蓋差異、cron timeout 與提醒成功留痕未完成；見 [雙引擎同步](architecture/dual-engine-sync.md)。

### 工程維護與其餘產品

- CI 綠後才部署的流程；Deno check、文件連結、ESLint 與 React hooks lint 已納 CI。大 bundle／字型載入、Sentry Replay lazy load、Demo requirements 種子、真後端 preflight、頁面層測試與 RPC 簽章比對待評估。
- Apple 清單／詳情殼已用在契約與工安；其餘業務頁、原文高亮、登入頁／行銷站、品牌四色點整合仍未完成。
- 機關模板估驗套版／全標單列印、查驗正式列印、排程驅動施作提醒、請款收款資訊層級與估驗／佐證包入口待另立工作包。
- 關閉舊 Pages 站點、依賴漏洞與大版升級分開處理，不藉文件清理刪遠端資源。

歷史研究、驗收與已完成包已移出工作樹；需要當時證據時用 `git show c39e395:<原路徑>`，不要預先重讀。
