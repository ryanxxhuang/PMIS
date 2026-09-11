# 契約包收件、分類與處理狀態

> CURRENT｜2026-09-11。主路徑的檔案保存、分類與進度；來源驗證見 [版本與引註](traceable-document-ingestion.md)，模型接力見 [抽取續跑](resumable-extraction.md)。

## 檔案流程

```text
選檔 → PCCES XML 分流 BOQ → 逐檔有界併發
→ checksum／文字 → 確定性分類 → 同包同檔名找文件
→ 同 checksum 找版本 → 私有原檔 → 分批存頁
→ 必要時 AI 分類第二意見 → 信任的義務型別才抽取 → 收尾
```

[packageUpload](../../src/lib/packageUpload.js) 管逐檔流程與彙總，[packageRuns](../../src/lib/packageRuns.js) 管純讀 loadPackageRuns、過期修復 healStaleRuns、改分類／重試 reclassifyProcessingRun；頁面決定寫入權與切案取消條件。單檔失敗不拖垮整包，同版本重試更新同一 processing row。

[packageFileSupport](../../src/lib/packageFileSupport.js) 區分可收件與可分析：PDF／DOCX／TXT 抽文字，圖片／試算表／舊格式僅保存。掃描件沒有 OCR，不假裝分析成功。PCCES 匯入走獨立交易 RPC。

## 分類與抽取門檻

[documentClassifier](../../src/lib/documentClassifier.js) 先比檔名，再比前段內文，最後 other。價格／標單／單價分析 guard 優先，避免把價目表當契約。檔名判定 0.85、內文 0.7、兜底 0.4；0.8 以上 auto_accepted，其餘 needs_review，人確認為 confirmed。

AI 只對「新文件、needs_review、有文字」提供第二意見，讀前 3 頁至多 4,000 字，限既有 documentTypes 值域。失敗退回原確定性建議；高信心同步 documents.document_type 並留分類修正事件。既有文件不再問 AI。

只有 contract／specification／quality_plan／itp，且分類 auto_accepted／confirmed 才抽取；圖說、報告、送審副本、表單、other 僅保存。409 run_conflict 維持 processing，不能蓋成 failed。重試僅針對抽取失敗，缺文字／原檔失敗須重傳；改成非抽取型別標 skipped，但保留歷史建議。

## 包、權限與原檔

契約包由 project／package_type／counterparty 唯一識別，類型與乙方不可變。機關看全部，監造看施工包＋自己的，廠商看自己乙方包；未歸包維持 legacy 專案可讀。寫入須 can_manage_documents 且可見該包，RLS／trigger 遞迴保護文件、版本、頁、run 與來源；包沒有一般 DELETE policy。

私有 Storage 路徑含 project、package、document、version 與 ASCII 檔名；原中文檔名在版本欄位。storage_path 在 INSERT 決定，重用版本只接受合法 key；上傳 duplicate 視為冪等成功。前端 MAX_UPLOAD_BYTES 須與後端上限共同核對，不能以重試解決超限。

原檔不可 UPDATE；刪除先走 delete_document RPC，再清不再被版本引用的孤兒物件。開檔入口依 runFileLanded 檢查真正落地，不只看 stage。讀取留痕失敗時拒絕開檔。

## 兩種 run

| 表 | 寫入者／粒度 | 用途 |
|---|---|---|
| document_processing_runs | 上傳者 JWT，一版本一列覆寫 | UX 階段、分類、storage_path、page_count、心跳與警示 |
| document_ingestion_runs | service role，每次抽取新列 | 模型／prompt 來源、建議、計數與續跑快照 |

processing 是 UX 狀態，不是契約權威。received → uploaded → extracting_text → classifying → extracting_requirements → 終態；status／stage／completed_at 的合法組合由 DB CHECK 保護：pending／processing 無完成時間，completed 對 completed，partial／failed 對 failed，unsupported 對 unsupported 且 parser_type=none。沒有轉移順序 guard。

processing 過期看 started_at 與 extraction_progress_at 較新者，20 分鐘才標 partial；healStaleRuns 僅管理文件者呼叫，每筆再檢查 shouldContinue。重試重設 started_at。ingestion 另有 10 分鐘時鐘，兩者不能混用。

## 彙總與已知限制

packageStatusFromRuns：空包 draft、有活躍列 processing、有 failed／partial／覆蓋警示／待分類則 needs_attention，其餘 ready；unsupported 不擋 ready。面板母數固定選檔總數。每版本最新 completed ingestion 的警示可在純讀時還原，不能用另一份成功結果蓋掉缺漏。

包狀態只在上傳開始／整批結束寫回；修復與重試不重算包狀態，needs_attention 沒有專屬事件。processing 合法狀態組合／documentTypes 與 SQL 值域仍有測試覆蓋缺口。舊單檔 documentIngestion 不保存原檔或 processing run。

## 驗證

[上傳](../../src/lib/packageUpload.test.js)、[run 狀態](../../src/lib/packageRuns.test.js)、[分類](../../src/lib/documentClassifier.test.js)、[頁面](../../src/pages/web/Contract.flow.test.jsx)、[契約包 pgTAP](../../supabase/tests/p0_07_5_contract_packages.sql)、[刪文件 pgTAP](../../supabase/tests/document_delete.sql)、[三角色文件 E2E](../../e2e/contract-flow.spec.js)。
