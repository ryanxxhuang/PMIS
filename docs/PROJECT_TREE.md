# GovAgent／PMIS 專案樹狀圖

> 狀態：**CURRENT**
> 最後盤點：2026-08-13
> 用途：回答「功能放在哪裡、要改哪一層」。數量以本次盤點為準，新增或移動主要模組時要同步更新。

## 根目錄

```text
PMIS/
├── AGENTS.md                 AI 協作者入口規則
├── CLAUDE.md                 Claude 相容規則與環境地雷
├── CURRENT.md                目前產品與實作真相
├── DEVELOPMENT.md            後續開發流程與完成定義
├── README.md                 專案入口、啟動、測試與部署
├── PRD.md                    HISTORICAL：早期原型 PRD
├── SCOPE.md                  HISTORICAL：2026-07-09 路線快照
├── package.json              Node scripts 與依賴
├── package-lock.json         鎖定依賴版本
├── index.html                Vite HTML 入口
├── vite.config.js            Vite／React／Tailwind 設定
├── playwright.config.js      Demo E2E 設定
├── playwright.real.config.js 真 Supabase 手動 E2E 設定
├── wrangler.jsonc            Cloudflare Workers 部署設定
├── .env.example              可提交的環境變數範例
├── .env.e2e.real.example     真後端 E2E 環境變數範例
├── .nvmrc                    Node 版本
├── .github/workflows/ci.yml  CI：測試與建置
├── .github/workflows/pgtap.yml CI：資料庫 pgTAP
├── src/                      React 前端與確定性領域邏輯
├── supabase/                 DB migrations、Edge Functions、pgTAP
├── e2e/                      Playwright 三方流程
├── e2e-real/                 Playwright 真 Supabase 冒煙（不進 CI）
├── public/                   靜態檔、安全標頭與 security.txt
├── docs/                     現行文件、決策、證據與對外資料
└── scripts/                  一次性 BOQ 資料整理工具
```

本機產物與資料不屬於程式架構：`.env`、`node_modules/`、`dist/`、`test-results/`、`tmp/`、`.DS_Store`、`supabase/.temp/`、`.playwright-mcp/`。`發包圖說20200715/` 是大型真案測試素材，不是應用程式碼；不得在未確認資料權利與敏感性前提交或外傳。

## 前端 `src/`

```text
src/
├── main.jsx                  React 掛載點
├── App.jsx                   頁面對應與共同登入／角色守衛
├── index.css                 全域樣式與設計 token
├── store.jsx                 Store 組合根、共用狀態與派生資料
├── components/               跨頁 UI 與互動元件
├── data/                     Demo／內建工程資料
├── lib/                      純函式、確定性引擎與共用整合
├── pages/                    頁面入口
├── store/                    DB 載入、tracked context、領域 slices
└── testUtils/                測試用 Supabase/PostgREST fake
```

### `src/components/`

```text
components/
├── Layout.jsx                主版面、側欄與頁框
├── ui.jsx                    Card、Button、Input 等共用 UI
├── confirm.jsx               統一確認對話框
├── CopilotFab.jsx            浮動 Agent 入口
├── CopilotChat.jsx           Agent 對話介面
├── InsightsPanel.jsx         AI 洞察呈現
├── DefectTracker.jsx         缺失共用呈現
└── MarkupEditor.jsx          圖片標註編輯器
```

原則：只有兩頁以上確實共用的視覺或互動才放這裡；單頁內容留在 page。

### `src/data/`

```text
data/
├── seed.js                   基本 Demo 資料
├── demoSeed.js               完整 Demo 專案資料
├── checklist03310.js         03310 混凝土自主檢查範本
├── workItems.json            原始內建工項資料
└── workItems.compact.json    壓縮後工項資料
```

### `src/lib/`

```text
lib/
├── 身分與導覽
│   ├── agentRole.js          三方 Agent 角色正規化
│   ├── projectIdentity.js    專案／成員身分解析
│   └── navConfig.js          routeRegistry、導覽與路由角色限制單一來源
├── AI 與助理
│   ├── aiFeatures.js         前端 AI 功能註冊鏡像
│   ├── aiInsights.js         洞察組裝
│   ├── assistantData.js      助理資料組裝
│   ├── assistantFacts.js     可引用事實
│   ├── assistantQA.js        問答組裝
│   ├── factsValidator.js     事實驗證
│   └── requirementInbox.js   Requirement 草稿收件匣
├── 工程數量、金額與進度
│   ├── parsePcces.js         PCCES XML 解析
│   ├── boqCalc.js            標單／估驗計算
│   ├── changeOrders.js       核准變更回饋
│   ├── coDiff.js             變更前後標單差異
│   ├── penaltyCalc.js        罰款計算
│   ├── siteLogHelpers.js     施工日誌彙整
│   └── supervisorReport.js   監造報表資料
├── 契約、文件與 Requirement
│   ├── contractDue.js        契約期限計算
│   ├── contractPackages.js   契約包規則
│   ├── documentClassifier.js 文件分類
│   ├── documentExtract.js    瀏覽器文件抽字
│   ├── documentIngestion.js  文件攝取協調
│   ├── packageFileSupport.js 檔案支援判定
│   ├── packageUpload.js      契約包上傳流程
│   ├── requirements.js       Requirement 共用規則
│   └── requirementReview.js  審查清單呈現規則
├── 品質、安全與佐證
│   ├── qc.js                 檢查表、試體判定與 Demo 缺失冪等純函式
│   ├── itp.js                ITP 規則
│   ├── evidence.js           佐證鏈
│   ├── photoMatch.js         照片對應
│   ├── riskAudit.js          風險稽核
│   └── integrityAudit.js     完整性稽核
├── 基礎工具
│   ├── acceptance.js         驗收期限與階段
│   ├── auditEvents.js        稽核事件呈現
│   ├── ballInCourt.js        待辦責任方
│   ├── dates.js              台灣本地日期處理
│   ├── errorMessage.js       錯誤文案
│   ├── exportCsv.js          CSV 匯出
│   ├── pagedQuery.js         PostgREST 分頁與安全 in 查詢
│   ├── sentry.js             Sentry 初始化
│   ├── supabase.js           Supabase client
│   ├── theme.js              主題
│   └── weatherMetrics.js     天氣資料整理
└── *.test.js                 與同名模組相鄰的 Vitest
```

### `src/pages/`

```text
pages/
├── Login.jsx                登入、註冊與 demo 入口
├── Security.jsx             公開資安頁
└── web/
    ├── 核心入口
    │   ├── Dashboard.jsx     專案總覽
    │   ├── Portfolio.jsx     機關跨案總覽
    │   ├── ProjectSetup.jsx  建案與基本資料
    │   ├── Members.jsx       成員管理
    │   ├── Agent.jsx         三方 Agent 主頁
    │   ├── Assistant.jsx     傳統助理頁
    │   ├── Admin.jsx         平台營運管理
    │   └── Activity.jsx      稽核事件
    ├── 工程、數量與財務
    │   ├── BOQ.jsx
    │   ├── SiteLog.jsx
    │   ├── SiteLogPrint.jsx
    │   ├── Valuation.jsx
    │   ├── ValuationPrint.jsx
    │   ├── ValuationPackage.jsx
    │   ├── Payments.jsx
    │   ├── Cost.jsx
    │   ├── Progress.jsx
    │   ├── Schedule.jsx
    │   ├── ChangeOrders.jsx
    │   └── MonthlyReport.jsx
    ├── 契約與協作
    │   ├── Contract.jsx
    │   ├── Requirements.jsx
    │   ├── Submittals.jsx
    │   ├── RFI.jsx
    │   ├── Acceptance.jsx
    │   └── Alerts.jsx
    ├── 品質與工安
    │   ├── Quality.jsx
    │   ├── ChecklistPrint.jsx
    │   ├── ITP.jsx
    │   ├── Safety.jsx
    │   └── RiskAudit.jsx
    └── 監造報表
        └── SupervisorReport.jsx
```

### `src/store/`

```text
store/
├── db.js                    跨頁資料的分頁載入
├── tracked.jsx              tracked context，降低無關 rerender
└── slices/
    ├── auth.js              登入、profile、角色與 can
    ├── projects.js          專案、成員與切案
    ├── ledger.js            BOQ、契約、估驗、付款、驗收
    ├── site.js              日誌、成本、排程、變更
    ├── quality.js           品質、試驗、缺失、工安
    ├── collab.js            送審、RFI、ITP、文件關聯
    ├── agent.js             Agent actions 與 AI 入口
    ├── billing.js           方案與帳務狀態
    └── admin.js             平台管理
```

## 後端 `supabase/`

```text
supabase/
├── SETUP.md                 本機與後端設定 runbook
├── config.toml              Supabase local／function 設定
├── migrations/              36 個依序套用的資料庫變更；唯一 schema 真相
├── functions/               16 個 Edge Functions + `_shared`
├── tests/                   23 組 pgTAP 權限與狀態流程測試
├── rollbacks/               3 個明確支援的 down script
├── cron.sql                 排程參考
└── schema.sql               凍結歷史參考，不再初始化 DB
```

### migrations 分段

```text
20260711000000  baseline：既有 PMIS 主資料與 RLS
202607120001-002 驗收、工安角色權限
202607120003-008 文件／Requirement／稽核／契約包 P0 基礎
202607120009-010 專案身分與邀請相容
202607120011-019 估驗付款、正式模式、缺失、檢查表、座標
202607130000-002 送審附件、Storage policy、估驗金額限制
20260716000000  義務佐證
20260725000000  Agent 草稿 actions
202607280000-002 平台管理、AI 計量、org_type 防提權
202608110001-002 稽核 IP、刪案紀錄
20260812000100  三方 Agent 角色收斂
20260812000200  W1 標單重設／匯入單一交易
20260812000300  W3 AI 閘門 fail-closed
20260812000400  W4 邀請三方身分確認
20260812000500  W5-2 Requirement → obligation 單向相容（已部署）
20260812000600  W5-3 雙成員模型 schema 註解（已部署）
```

規則：只能新增 migration；不能修改已套用檔案。權限與狀態變更同步更新 `supabase/tests/`。

### Edge Functions

```text
functions/
├── agent-run/                    三方 Agent runtime
├── assistant-chat/               助理問答
├── audit-summary/                AI 稽核摘要
├── extract-requirements/         可追溯 Requirement 擷取
├── parse-contract/               舊期限解析；檔案保留供相容／rollback，前端無 caller
├── read-submittal/               送審文件讀取
├── review-submittal/             送審 AI 審查草稿
├── draft-rfi-reply/              RFI 回覆草稿
├── draft-monthly-review/         月報草稿
├── draft-valuation-summary/      估驗摘要草稿
├── describe-defect/              缺失照片描述
├── analyze-safety-photo/         工安照片分析
├── classify-site-photo/          現場照片分類
├── read-whiteboard/              工地告示板辨識
├── fetch-weather/                天氣整合
├── send-reminders/               每日提醒寄送
└── _shared/
    ├── aiGate.ts                 伺服器功能開關、方案與用量閘門
    ├── aiFeatures.ts             Edge AI 功能註冊鏡像
    ├── claude.ts                 Claude 呼叫封裝
    ├── agentRole.ts              三方角色正規化
    ├── agentPersona.ts           Agent persona
    ├── agentTools.ts             工具白名單與執行
    ├── agentBrief.ts             專案交接摘要
    ├── agent.ts                  Agent 共用 runtime
    ├── requirementExtraction.ts  擷取 schema 與驗證
    ├── sourceVerify.ts           來源定位驗證
    └── integrityAudit.ts         完整性稽核
```

## 測試、部署與文件

```text
e2e/
├── contractor.spec.js       廠商流程
├── supervisor.spec.js       監造流程
├── owner.spec.js            機關流程
├── routes.spec.js           公開頁、列印深連結與共同守衛
└── helpers.js               共用登入與專案 fixture

e2e-real/
├── auth-smoke.spec.js          真登入、session 還原與登出
├── chain1-onboarding.spec.js  註冊、建案、三方邀請與正式模式
├── chain2-valuation.spec.js   估驗三方簽核與請款收款
├── chain3-requirements.spec.js 文件、Requirement 審查與義務物化
├── chain4-boq-rollback.spec.js 標單匯入／重設 rollback
└── helpers.js                 隔離帳號、專案與 Storage 清理

public/
├── _headers                 Cloudflare 安全標頭與 CSP
├── .well-known/security.txt 漏洞通報資訊
├── robots.txt
└── favicon.svg

scripts/
├── import_boq.py            BOQ 匯入工具
└── compact_workitems.py     內建工項壓縮工具

docs/
├── README.md                所有文件狀態與索引
├── PROJECT_TREE.md          本文件
├── DECISIONS.md             已定案決策
├── ROADMAP.md               未核准候選與順序
├── 北極星-政府機關-Agent-平台.md
├── architecture/            現行架構與一份歷史基礎文件
├── 資安/                    政策、日期式評估與弱掃證據
├── 採購/                    特定機關採購範本
└── pitch/                   日期式簡報與重建工具
```

## 改功能時從哪裡開始

| 要改的事情 | 第一個入口 | 通常還要檢查 |
|---|---|---|
| 路由或誰看得到頁面 | `src/lib/navConfig.js` 的 `routeRegistry`、`src/App.jsx` | `src/lib/navConfig.test.js`、`e2e/routes.spec.js` |
| 三方角色或 Agent 工具 | `src/lib/agentRole.js`、`functions/_shared/agentRole.ts` | `agentTools.ts`、migration、三處測試 |
| 跨頁共享資料 | `src/store.jsx`、對應 slice、`store/db.js` | 頁面讀取與 persisted write tests |
| 單頁專屬清單 | 該 `pages/web/*.jsx` | 查詢是否有上限、RLS 是否允許 |
| 金額、期限、合格判定 | 對應 `src/lib/*` 確定性引擎 | DB trigger／Edge 鏡像與測試 |
| Schema、權限、狀態轉移 | 新 migration | 對應 pgTAP、RLS、grants |
| AI 功能 | 前後端 `aiFeatures` 註冊 | `aiGate`、用量、project_id、AI tests |
| 文件或 Requirement | `Contract.jsx`／`Requirements.jsx` | ingestion Edge、P0 migrations、架構文件 |
