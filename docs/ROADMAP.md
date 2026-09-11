# 未完成工作與候選

> ACTIVE｜2026-09-11。唯一續接清單；候選不是實作授權。已完成交付查 Git／PR，不在此累積歷程。先核 CURRENT 與程式，避免重新實作已完成項。

## 本輪：程式與文件精簡（已核准，實作與驗證完成）

問題：預定進度計算重複六份；入口與歷史報告重複耗用閱讀成本，部分狀態過期。
目標：六處共用預定進度內插，入口只保留現行規則，過時文件由 Git 追溯。
不做：不新增產品功能、不改三方權限或 DB、不合併 main、不部署。
影響：進度計算 lib／六個呼叫端與測試；根目錄、docs 索引、現況；過時 UI handoff。
驗收：①既有提交推送；②進度測試、lint、單元、Demo E2E、build 通過；③必要閱讀量下降；④保留決策與未完成項；⑤現行文件連結有效。

- [x] 原有未推送提交：`refactor/product-wide` 的 `f638d65`／`c39e395`，`ui/apple-foundation` 的 `d047437` 已推送。
- [x] 預定進度共用化與文件精簡，驗證見 [BASELINE](BASELINE.md)。本輪交付由同一提交保存並推送。

本輪使用者已明確要求 commit／push；不含合併 main、部署或正式 migration。

## 合併與上線前仍待處理

以下需要部署任務的明確授權，不是本輪的隱含工作。

- `refactor/product-wide` 尚未合併 main。DB／Edge／前端部署順序與冒煙依 [部署指南](operations/deploy.md)。
- 正式庫先核 migration tracker；三支新 migration `20260911100000`／`20260911100100`／`20260911110000` 尚未套用。D-022 已提交，不是待實作。
- `_shared/` 改動需要 17 支 Edge 一併重佈並核版本；用有效模型金鑰重跑六條真後端 E2E。Deno 型別檢查仍未完成。
- 真人手機輪、真案三角色操作、抽取準確率／召回率與還原／提醒送達演練仍待驗證。

## 待使用者決策

- 導覽 hidden 工作面的恢復策略、成員頁入口、機關多案落地；D-014 五步初始化條文同步。
- AI 成本上限與超額行為（原定監看不擋）、定價與 DB plan 對應、條款／隱私／DPA 與境外模型揭露。
- `demo_requests` 個資保存期／清除；Agent 唯讀呼叫軌跡粒度；刪案後原稽核事件保存責任；Edge log 可能含 DB 失敗列內容的存取／留存。
- 客戶簡報與 D-019 自動確認語意、品牌／買方／銷售路徑的敘事對齊。
- 後台設定：模型金鑰、Anthropic 月上限、Auth leaked-password／autoconfirm／SMTP、repo 可見性、正式殘留專案與 Storage 孤兒清理。現值須重新查證，舊盤點不代表目前數量。

## 候選工作（CANDIDATE，依任務另行核准）

### 履約與可達性

- 機關自有期限未進 `todayTasks`；正式且已匯標單時成員頁缺一般入口。驗收應從首頁可見控制到目的頁，三方期限不混入別方。
- 五個 hidden 工作面依決策復出、補點擊可達性 E2E；補 `/requirements/review`、`/deadlines`、`/project/new` 手機 a11y 與 Portfolio error state。
- 循環義務目前只算下次日期；逐期資料、月末／跨年／29～31 日、基準日更正與準時率需產品決策＋migration／pgTAP。先揭露限制，再接送審／佐證流程。
- 後端依身分回義務集合與 `canAct` 才可刪前端 `VISIBLE`；`report-issue`／`re-extract` 專用端點仍未做。
- `/deadlines` 無期限列是否隱藏、義務預警窗 7→14 天、機關撤銷已核准變更的 UI 入口、工項重設 guard 訊息均待決。
- 「契約義務」可見字串、同領域多個名稱與「逾期 N 天／日」統一；`dueText` 被 regex／E2E 使用，需一併核對。

### 資料與安全

- `item_schedules` 缺 `guard_project_identity`，可能跨案引用 work_item；需 migration 與跨案 pgTAP。
- `work_items(project_id,item_key)` 部分唯一索引；正式資料重查重複後再做。部分領域狀態欄無 CHECK（含 obligation）；processing run 無轉移 guard。
- DB 顧問問題需重核：熱點／FK 索引、auth_rls_initplan、重複 permissive policy、search_path、security-definer grants、pg_net schema。public 表 anon 的 TRUNCATE default grant 不受 RLS 控制，PostgREST 不暴露該操作。
- 刪案串 Storage 清理並留 deletion record；目前 DB 備份不包含 Storage 物件，需獨立備份與 restore/RTO 演練。rollback 判準／缺口與 `repair_` 命名尚待整理。
- `agent_actions`／`ai_usage_events` append-only、防個資送模型、唯讀軌跡留存、使用量記帳失敗留 audit；不得自行決定個資保存粒度。
- CSV formula injection 的前置空白／tab、CR quote、科學記號判定邊界仍存在，測試只記錄現況。
- AI 成本原子預留／rate limit、MFA／鎖定／停用、試用申請分頁／清理須依前節政策實作。

### 抽取與 Agent

- 真契約評測集應覆蓋掃描件、表格、附件、補充條款、中文數字、民國年、跨頁與衝突；量測出處、條款召回、責任方、期限、重複率、人工修正時間。24 批上限、OCR、語意漏抽尚未解決。
- 契約包 status 在上傳後才由前端重算；stale 修復／重新分類後可能未同步，轉 needs_attention 沒留痕。
- 抽取某批 upsert 失敗時 run 仍可 completed，verified_source_count 可能含未落庫批次；要調整行為需獨立測試。
- ai_usage_events.error_code 仍為泛用 claude_error／exception，未保存限流／逾時細分類；Deno 型別檢查須涵蓋已修正過的 PublicError 回傳型別。
- Agent 模型呼叫 timeout／重試、回答 sources、前後端球權涵蓋差異、cron timeout 與提醒成功留痕未完成；見 [雙引擎同步](architecture/dual-engine-sync.md)。

### 工程維護與其餘產品

- CI 綠後才部署的流程、Deno check 進 CI；ESLint 與 React hooks lint 已完成，不再重做。大 bundle／字型載入、Sentry Replay lazy load、Demo requirements 種子、真後端 preflight、頁面層測試與 RPC 簽章比對待評估。
- 共用進度內插由本輪處理；S 曲線產生與伺服器公式仍依 [雙引擎](architecture/dual-engine-sync.md) 管理。其他死碼與 effect 要先查使用點，不能按舊報告直接刪。
- Apple 清單／詳情殼已用在契約與工安；其餘業務頁、原文高亮、登入頁／行銷站、品牌四色點整合仍未完成。
- 機關模板估驗套版／全標單列印、查驗正式列印、排程驅動施作提醒、請款收款資訊層級與估驗／佐證包入口待另立工作包。
- 關閉舊 Pages 站點、清理已合併分支、依賴漏洞與大版升級分開處理，不藉文件清理刪遠端資源。
- `project-delete-contract-first-hotfix.md` 的舊刪案 guard 敘述與實際 parent-row-gone 模式待核對；資料脊椎圖中 cost_items 的專案層歸屬待查 schema。

歷史研究、驗收與已完成包已移出工作樹；需要當時證據時用 `git show c39e395:<原路徑>`，不要預先重讀。
