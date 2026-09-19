# 真後端 E2E

> ACTIVE RUNBOOK｜2026-09-11。對隔離 Supabase 驗產品流程；結果集中在 [BASELINE](BASELINE.md)。

## 環境

依 [後端設定](../supabase/SETUP.md) 起本機 Supabase，或使用一次性 staging 並套完整 migrations。複製 `.env.e2e.real.example` 為未追蹤的 `.env.e2e.real`，填 E2E_REAL_SUPABASE_URL、E2E_REAL_SUPABASE_ANON_KEY、E2E_REAL_SERVICE_ROLE_KEY；所有測試自行建立／清理臨時帳號，不再依賴常駐 smoke 帳密。

[playwright.real.config.js](../playwright.real.config.js) 在瀏覽器啟動前檢查缺值／URL，拒絕已知正式 Supabase host。這是已知 host 黑名單，不保證辨識未登記的新正式環境；執行者仍須確認目標是 staging。帳密／金鑰不可提交。

```bash
npm run test:e2e:real
```

九條鏈：Auth 冒煙、建案／三方邀請與正式模式、估驗金流、契約／履約、BOQ 交易回滾、原檔預覽／下載、現場文書（chain 5）、監造日誌（chain 6）、監造確認量與估驗聯動（chain 7）（後三條見下節）。Demo E2E 仍以 `npm run test:e2e` 執行；兩套不能互相取代。

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

`e2e-real/chain5-field-docs.spec.js`：廠商上傳→伺服器起稿→補缺→簽署（登入的平台帳號，沒有驗證碼步驟；R1）→提送→監造退回→廠商更正版本重簽再送→監造收件→機關查閱；另驗重新整理恢復、同一張照片重傳不重建、簽舊版本 `PD001`。前置一項：

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

`e2e-real/chain7-confirmed-qty.spec.js`（前置：本機 stack 已套用 `20260919040000`，`supabase migration up --local`）：廠商建第 1 期→以廠商身分補計價截止日（截止日欄位由 P4c 進估驗頁）→在估驗頁直接填累計 100（舊前端路徑，P4e 前仍可寫草稿）→「送監造審核」被 DB 檢查點擋下、畫面原樣顯示「缺監造確認來源」、狀態仍是草稿→直接 REST 改狀態與 `transition_valuation` 都回 `VQ004`、`get_valuation_state` 顯示 cap 0→廠商簽確認單 `VQ001`→監造以登入身分 `issue_supervisor_certificate` A區 60（R1 起不要求兩步驟驗證），同 `client_request_id` 重播不重複入帳→廠商 `sync_valuation_from_confirmations` 後累計 60、設 61 回 `VQ006`、`violations` 空→重新載入頁面看到 60、送審成功→監造核定。chain 2 亦改為送審前補截止日（該期無明細，沒有數量要驗）。

```bash
npm run test:e2e:real -- chain7 chain2
```
