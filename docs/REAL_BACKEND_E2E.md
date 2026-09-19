# 真後端 E2E

> ACTIVE RUNBOOK｜2026-09-11。對隔離 Supabase 驗產品流程；結果集中在 [BASELINE](BASELINE.md)。

## 環境

依 [後端設定](../supabase/SETUP.md) 起本機 Supabase，或使用一次性 staging 並套完整 migrations。複製 `.env.e2e.real.example` 為未追蹤的 `.env.e2e.real`，填 E2E_REAL_SUPABASE_URL、E2E_REAL_SUPABASE_ANON_KEY、E2E_REAL_SERVICE_ROLE_KEY；所有測試自行建立／清理臨時帳號，不再依賴常駐 smoke 帳密。需要 DBA 邊界重現歷史資料的鏈（9、11）以 `docker exec` 連本機 postgres，預設容器 `supabase_db_PMIS`；另起隔離棧（不同 `project_id`，例如共用開發棧不宜先套自己的 migration 時）以 `E2E_REAL_DB_CONTAINER` 指定容器，URL／金鑰以同名環境變數覆寫 `.env.e2e.real`（環境變數優先）。

[playwright.real.config.js](../playwright.real.config.js) 在瀏覽器啟動前檢查缺值／URL，拒絕已知正式 Supabase host。這是已知 host 黑名單，不保證辨識未登記的新正式環境；執行者仍須確認目標是 staging。帳密／金鑰不可提交。

受測的 dev server（埠 5189）用與 Demo E2E 共用的 [vite.e2e.config.js](../vite.e2e.config.js)：與 `vite.config.js` 相同，只關掉檔案監看、埠被佔用就失敗。一般 dev server 下，同一 worktree 任何未 gitignore 的檔案被改（連 `touch` 一支 e2e spec 都算）都會讓頁面整頁重載、打斷開著的對話框；2026-09-19 chain 6 卡在「提送」對話框直到 420 秒逾時即此原因（T1）。所以跑測期間改檔不影響頁面，但改了程式碼要重跑才會生效。5189 已被別的 worktree 佔用時，Playwright 直接報「is already used」、不沿用那個 server（T2），等對方跑完再跑。

```bash
npm run test:e2e:real
```

十六條鏈：Auth 冒煙、建案／三方邀請與正式模式、估驗金流、契約／履約、BOQ 交易回滾、原檔預覽／下載、現場文書（chain 5）、監造日誌（chain 6）、監造確認量與估驗聯動（chain 7）、自主檢查表（chain 8）、未確認量不可請款（chain 9）、監造查驗表單（chain 10）、撤銷／減量／補證／調整（chain 11，P4d；說明在該 spec 檔頭）、共用補值（chain 12）、月報與佐證包重用已簽署資料（chain 13）、捨棄草稿後重新起稿（chain 14）（chain 5–10、12–14 見下節）。Demo E2E 仍以 `npm run test:e2e` 執行；兩套不能互相取代。

## 契約測試的兩種模式

| 模式 | 選擇方式 | 實際驗證 |
|---|---|---|
| 固定 fixture | ANTHROPIC_API_KEY 為空／未設 | 真 Storage、文件／版本、人工待確認 Requirement、三方 RLS、確認 RPC 與義務物化 |
| Live Edge | 有有效 ANTHROPIC_API_KEY，且 Edge 已 serve | 另驗真模型抽取、completed run、AI-origin Requirement 與原文 citation |

```bash
# 明確選 fixture;空值會覆蓋 env-file 中的模型 key。
ANTHROPIC_API_KEY= npm run test:e2e:real

# Live:先在另一個 terminal 啟動函式，再跑 chain 3。
supabase functions serve --env-file .env.e2e.real
npm run test:e2e:real -- e2e-real/chain3-requirements.spec.js
```

Live 會使用模型額度；Edge 未起、金鑰失效或未抽出契約期限應失敗，不能偷偷改成 fixture 後宣稱 Live 通過。D-019 的 AI 項可已自動確認，不再要求每筆都由監造人工批准。fixture 則仍驗人工確認。

chain 3 會以 staging 的平台 admin bootstrap 設定測試案方案，既有 bootstrap 帳號可能被沿用；只能用專用隔離環境。colima 要掛載 repo 磁碟；本機 service_role 權限依 seed.sql 準備。不要把帳號已存在當作禁止正式執行的可靠保護。

## 清理

[helpers](../e2e-real/helpers.js) 與各 spec 的 afterAll 清本次 fixture：先分頁清 project Storage，再以測試建立者呼叫 delete_project（依 admin 列授權），最後用 admin API 刪帳號。只找測試帳號建立的案，不刪僅受邀的案；cleanup error 必須讓測試失敗。

Storage 不隨 DB cascade 清除：contract-documents 以 projects/<id>/ 為前綴，photos 以 <id>/ 為前綴。帳號使用唯一 email；smoke 帳號由本次建立並清理，先前已存在的 bootstrap 帳號不隨意移除。舊成功紀錄從 Git 追溯，不當成目前版本已通過。

## 現場文書鏈（chain 5，P2c）

`e2e-real/chain5-field-docs.spec.js`：廠商上傳→伺服器起稿→補缺→簽署（登入的平台帳號，沒有驗證碼步驟；R1）→提送→監造退回→廠商更正版本重簽再送→監造收件→機關查閱（P3d：退回歷史含退回人姓名、回執編號＝DB 送件列、`/site-log/print` 印簽署版本 3 且雜湊前 12 碼＝DB）；另驗重新整理恢復、同一張照片重傳不重建、簽舊版本 `PD001`。前置一項：

1. **本機 Edge stub 模型**：另一個 terminal `supabase functions serve --env-file e2e-real/stub.env`。`PMIS_VISION_STUB=1` 只在 `SUPABASE_URL` 為本機 http 位址時生效（`_shared/visionStub.ts stubAllowed`，正式 Edge 永遠 false；有單元測試釘住），輸出固定：每張都是可辨的工地照、無告示板、工項關鍵詞＝`PMIS_VISION_STUB_HINT`（chain 5 匯入的「結構工程」）。stub 仍過各功能開關並記用量（`model=stub:local`），起稿回應 `notes` 明示「模型輸出為本機 stub」。**stub 只證明流程，不證明辨識正確**；真模型品質見續接清單 P7b。

```bash
supabase functions serve --env-file e2e-real/stub.env   # terminal A
npm run test:e2e:real -- e2e-real/chain5-field-docs.spec.js   # terminal B
```

## 監造日誌鏈（chain 6，P3a 頁面）

`e2e-real/chain6-supervisor-log.spec.js`（前置同 chain 5：Edge stub）：監造上傳監造照片→伺服器起稿監造日誌（示範範本；到場永遠留空且 pending）→`/site` 現場文書清單直達 `/supervisor-log?doc=`→帶入本人為到場人員、補天氣、廠商施工情形標不適用→存檔→以 RPC 直打證明到場只 `filled` 簽署回 `PD004 needs_confirmation`、廠商照片當監造證據存版列附件問題且簽署 `PD005`→回頁面重新載入、廠商照片改為參考、確認到場人員→存檔→簽署（`supervisor_logs` 落庫，到場含 `user_id` 與時段，不適用的摘要為 null 不寫「無」）→列印頁印簽署版本（版本、雜湊前 12 碼、示範範本、簽署者）→提送機關→廠商可讀但唯讀→機關（1024）退回並填原因→監造（375）看到原因、補備註成新版本、重簽再送、無水平溢位→機關收件；最後核對提送列 `submit:4→return:4→submit:5→receive:5`、diff 由 DB 算、文件 `received` 綁同一 `supervisor_logs` 列。工具鏈限制同 chain 5：本機 `functions serve` 需暫移 `supabase/functions/deno.lock`（跑完還原，不提交）。

```bash
npm run test:e2e:real -- e2e-real/chain6-supervisor-log.spec.js
```

## 監造確認量鏈（chain 7，P4b 後端）

`e2e-real/chain7-confirmed-qty.spec.js`（前置：本機 stack 已套用 `20260919140000`，`supabase migration up --local`）：廠商建第 1 期（計價截止日必填）→在估驗頁填累計 100，`set_valuation_item_cum` 回 `VQ006`（上限 0），畫面列出前期累計／本期起算值／本期最多可新增／可用確認量、輸入框回到 DB 的值（100 沒有寫進去）→廠商簽確認單 `VQ001`→監造以登入身分 `issue_supervisor_certificate` A區 60（R1 起不要求兩步驟驗證），同 `client_request_id` 重播不重複入帳→DB 自動同步到草稿期，重新整理看到 60、來源展開列出批次與確認人→填 61 再被擋→「同步確認量」冪等→送審→監造核定。chain 2 亦改為送審前補截止日（該期無明細，沒有數量要驗）。

```bash
npm run test:e2e:real -- chain7 chain2
```

## 自主檢查表鏈（chain 8，P3b）

`e2e-real/chain8-self-check.spec.js`（前置同 chain 5：Edge stub）：廠商以 API 建本案檢查表範本（B1 勾選、C2 坍度 15.5–20.5）→ 上傳一張照片→伺服器起施工日誌＋自主檢查表草稿（範本只有一張直接用；`target_key`＝日期:工項；每個項目 `pending`、實測值不帶值、內容帶 `template:{self_check_demo v1}`）→`/site` 現場文書清單直達 `/self-check?doc=`（示範範本章、免責聲明、「依工項挑選範本」與「照片 AI 說明」來源、無簽署鈕）→ 只勾 B1 存檔「版本 2，尚有 1 項待補」→ 以 RPC 直打：實測值未填簽署回 `PD004`（detail 含 `results.C2 pending`）、監造簽署回 `PD006`→ 親自填坍度 18（判定預覽合格）→ 存檔「版本 3，可簽署」→ 簽署（`checklist_records` 落庫 Rev.0：`results` 逐項 `pass` 與 `overall` 由 DB 算、`work_item_id`＝stub 配到的工項、`created_by`＝簽署者）→ 列印頁「【示範範本】框架 self_check_demo v1」、雜湊前 12 碼、簽署者、無「草稿・未簽署」→「提出查驗申請（檢附此表）」預填既有查驗申請（下拉選中該紀錄並標「已簽署文件 v3」）→ 送出（`inspections.checklist_record_id` 掛上）→ 文件頁顯示「已檢附於查驗」→ 提送監造→ 監造（1024）`/site` 待收件、開頁唯讀、收件、查驗詳情「附自主檢查表（已簽署 v3）」→ RPC 直打第二份文件：簽署 Rev.0 → 更正存版（`amended_from_version`）無原因簽署 `PD010` → 填原因重簽落 Rev.1（`supersedes_id`／`root_id`／`revision_reason`、改判不合格）且 DB trigger 同交易開一筆缺失掛鏈根。工具鏈限制同 chain 5／6。

```bash
npm run test:e2e:real -- e2e-real/chain8-self-check.spec.js
```

## 未確認量不可請款鏈（chain 9，P4c／P4e）

`e2e-real/chain9-unconfirmed-blocked.spec.js`（前置：本機 stack 已套用 `20260920001500`；容器 `supabase_db_PMIS` 在跑）：廠商建第 1 期→舊客戶端路徑以 REST 直接 upsert／update／delete `valuation_items` 全部明確失敗（`42501`，P4e）→以 DBA 邊界（`e2e-real/helpers.js` 的 `dbaSql`：本機 postgres、交易內 `set local pmis.cq_internal='1'`）重現 P4e 之前舊前端寫進草稿的申報 100（`backing='legacy'`、無來源；正式庫仍有這類草稿明細）→新 UI 標「缺監造確認來源・申報,不計價」、本期可請款金額 0、缺件卡列出處理入口→「送監造審核」被 DB 檢查點擋下並列出原因、狀態仍草稿→「同步確認量」歸零、缺件消失→送審成功。

```bash
npm run test:e2e:real -- e2e-real/chain9-unconfirmed-blocked.spec.js
```

## 撤銷／補證／調整鏈（chain 11，P4d）

`e2e-real/chain11-adjustments.spec.js`（前置：本機 stack 已套用 `20260920001500`；容器 `supabase_db_PMIS` 在跑）：11a 監造確認 60→廠商建期同步送審→監造核定→監造在估驗頁撤銷該筆確認→已核定量轉成待處理扣回→機關登錄請款日被擋→機關作廢（接受已計價）→請款日可登錄。11b 以 DBA 邊界（`dbaSql`：交易內開重算旗標寫 legacy 明細、停用檢查點 trigger 核定、`fn_cq_backfill_legacy_internal`，與正式庫 P4b 回填同一支）建立歷史遷移期別→監造首頁「待監造補證」→缺件卡→「補證此期」→缺件清空→請款日登錄。DBA 邊界只給「產品已不允許產生、但正式庫仍存在」的歷史資料用。

```bash
npm run test:e2e:real -- e2e-real/chain11-adjustments.spec.js
```

## 監造查驗表單鏈（chain 10，P3c）

`e2e-real/chain10-inspection-form.spec.js`（前置同 chain 5：Edge stub；本機 stack 已套用 `20260919222000`）：廠商以 RPC 簽自主檢查表→提出查驗申請（申報 100 M3、位置 3F 版牆、檢附自檢；`inspections_guard` 由工項帶單位、由位置算批次鍵）→ 未簽署前 `list_billable_backlog` 為空 → 監造上傳一張監造照片→伺服器起監造日誌＋監造查驗表單草稿（`target_key`＝查驗 id、`pending_input`；查驗申請資料帶入標 `inspection:<id>`；`verdict`／`confirmed_qty` 為 null＋pending——不替監造判定、不填確認量）→ `/site` 現場文書清單直達 `/inspection-form?doc=`（示範範本章、免責聲明、確認數量區並列申報 100 M3／此批次已確認累計 0 M3）→ 逐項「確認」帶入資料、判部分合格、本次確認 60（簽署後累計 60）、判定說明→存檔「版本 2，可簽署」→ RPC 直打廠商簽署 `PD006` → 簽署（意願聲明下與確認框明示「可估驗的依據」；`inspections` 部分合格／確認 60／文件 v2／判定人；`inspection_confirmations` 累計 60、增量 60、批次 `3f版牆`、追溯文件版本；缺失「查驗部分合格：…」說明含差額 40；同人同版本重簽冪等、確認紀錄仍一筆）→ 列印頁「【示範範本】範本 inspection_form_demo v1」、雜湊、簽署者、「■ 部分合格」→ 提送給施工廠商、提送給機關（各一鈕、送完鈕消失）→ RPC 直打：更正版改確認 70 重簽 `PD008`（先撤銷）、`revoke_inspection_confirmation` 後重簽成功（撤銷列保留、新確認 70、`inspections.confirmed_qty` 70）、廠商 `list_billable_backlog` 可估驗 70 → 廠商估驗頁建期、「同步確認量」累計 70、來源展開列批次／查驗連結／文件版本 v3、`set_valuation_item_cum` 71 回 `VQ006`（其餘不可請）→ 廠商開表單頁唯讀並看到確認 70。工具鏈限制同 chain 5／6；5189 被其他 worktree 佔用時以臨時設定改埠（跑完即刪）。

```bash
npm run test:e2e:real -- e2e-real/chain10-inspection-form.spec.js
```

## 共用補值鏈（chain 12，P3e）

`e2e-real/chain12-shared-inputs.spec.js`（前置同 chain 5：Edge stub；本機 stack 已套用 `20260920004000`）：廠商上傳一張照片→伺服器起施工日誌＋自主檢查表草稿（位置、數量待補）→上傳結果的「一次補齊」列出「施作位置・二 結構工程」影響施工日誌與自主檢查表（皆「將寫入」）→填一次位置按「套用」→「已更新 2 份（施工日誌 版本 2、自主檢查表 版本 2）」，兩個新版本都是人工版本（建立者＝廠商）、來源 `confirmed`／`shared:location:<日期>:<工項>`、雜湊由 DB 算、附件原樣、版本說明記錄是哪一個補值→補當日數量只更新施工日誌（版本 3）→以 RPC 填檢查項目並簽署自主檢查表→重新整理（375 寬）從「上傳批次」接續，自主檢查表標「已簽署，不受影響」→再補另一個位置→「已更新 1 份（施工日誌 版本 4）；1 份已簽署或提送，未變更」，已簽署自主檢查表的版本、內容、雜湊與 `checklist_records.location` 不變；無水平溢位、套用鈕高 ≥44→同值時按鈕不可按，RPC 直打同值 `updated=0`（冪等）→監造對廠商批次補值 `PD006`。工具鏈限制同 chain 5／6。

```bash
supabase functions serve --env-file e2e-real/stub.env   # terminal A
npm run test:e2e:real -- e2e-real/chain12-shared-inputs.spec.js
```

## 月報與佐證包重用已簽署資料鏈（chain 13，P6a）

`e2e-real/chain13-report-reuse.spec.js`（不需 Edge stub；本機 stack 需已套用 `20260919222000`）：佈置全走產品 RPC／RLS 窄門（簽署 UI 已由 chain 5／6／8／10 走過）——廠商施工日誌 d1（10 M3）、d2（20 M3）簽署、d3（999 M3）只存版不簽→自主檢查表簽署→查驗申請（申報 100、檢附自檢）→監造上傳一張照片、監造查驗表單判部分合格確認 60（照片以證據附上）簽署、d2 監造日誌（到場已確認）簽署、d3 直接寫一列未經文件的監造日誌事實列→廠商建第 1 期（截止日＝月底）、同步確認量 60、送監造審核→送審後更正 d1 為 15 M3 重簽 v2。驗：廠商 `/monthly-report` 只彙整 d1（v2）＋d2＝35、施工天數 2、雨天 1、出工 12、每份附版本與雜湊、d3 列「未簽署、不列入（草稿）」、判定只列簽署表單；監造 `/supervisor-report`（標題「監造月報」）列已簽署監造日誌（到場、版本）、d3 未經文件簽署不列入、簽署表單判定「申報 100／確認 60 M3」與版本、本月確認「+60 M3（累計 60）」、「另 1 日未簽署、不列入」與施工月報一致；`/valuation/package` 本期確認來源列查驗表單版本雜湊、簽署者、檢附自檢 Rev.0、證據照片 1 張，施工日誌取送審時點的 d1 v1（10 M3，標「之後另有 v2」）與 d2，d3 標送審時尚未簽署不列入。帳號與專案本次產生、`afterAll` 清除。

```bash
npm run test:e2e:real -- e2e-real/chain13-report-reuse.spec.js
```

## 捨棄草稿後重新起稿鏈（chain 14，P3f）

`e2e-real/chain14-discard-draft.spec.js`（前置同 chain 5：Edge stub；本機 stack 已套用 `20260920021000`）：廠商上傳一張照片→伺服器起施工日誌＋自主檢查表草稿（兩筆 AI 草稿待覆核）→ `/site` 現場文書清單在自主檢查表那一列按「捨棄」（確認鈕在填原因前不可按）→ 列消失、頁面說明已捨棄與原因 → 開施工日誌頁按「捨棄草稿」、填原因（前後空白由伺服器去掉）→ 回 `/site` 說明已捨棄並給「施工日誌頁」重新填寫的連結 → DB：兩份 `discarded`、原因／捨棄者／時間／請求編號由伺服器寫、版本仍 1 個、兩筆 AI 草稿 `rejected`（處理人＝廠商）、稽核 `field_document.discarded` 一筆且 metadata 帶原因 → RPC 直打：監造捨棄廠商文件 `PD006`、同一請求重送 `idempotent:true` → 重新上傳另一張照片 → 伺服器起一份新的同日施工日誌（不是捨棄的那份，捨棄的仍只有版本 1）、清單上新草稿有捨棄入口 → 補齊存版、簽署（`daily_logs` 落庫並綁定）→ 已簽署再捨棄 `PD008`、清單不再顯示捨棄入口。工具鏈限制同 chain 5／6（本機 `functions serve` 需暫移 `deno.lock`，跑完還原）。

```bash
supabase functions serve --env-file e2e-real/stub.env   # terminal A
npm run test:e2e:real -- e2e-real/chain14-discard-draft.spec.js
```
