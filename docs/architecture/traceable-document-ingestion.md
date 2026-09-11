# 文件版本、頁碼與引註驗證

> CURRENT｜2026-09-11。收件流程見 [文件管線](document-processing-pipeline.md)，續跑見 [抽取](resumable-extraction.md)，確認見 [審核邊界](requirement-review-boundary.md)。

## 原檔與文字

主路徑以契約包／檔名找邏輯文件、checksum 找不可變版本，原檔存私有 `contract-documents`，先存逐頁文字再呼叫 AI。舊 [documentIngestion](../../src/lib/documentIngestion.js) 單檔路徑仍有實際使用點，沒有 processing run／原檔 Storage，不可把主路徑的保存保證套到它。

[documentExtract](../../src/lib/documentExtract.js) 用 pdf.js 每頁抽文字、保留換行；DOCX 用 Mammoth 純文字，儲存的 page_number 只是段落索引，來源頁碼維持 null。TXT 同屬無可靠頁碼文字。OCR 未實作：圖片只收件，掃描 PDF 無文字時揭露限制；不能宣稱已解析。

## 確定性引註驗證

[sourceVerify](../../supabase/functions/_shared/sourceVerify.ts) 同時供前端與 Edge 使用：NFKC、去零寬與 Unicode 空白，再精確比對引文是否包含於儲存文字；次級比對只去固定標點，不用相似度。少於 6 個正規化字元不驗證。

| 情境 | source_verified | 來源頁碼 |
|---|---|---|
| PDF 引文在聲稱的實際頁 | true | 該頁 |
| 引文存在但頁碼錯／引文不符 | false | 聲稱頁存在才保留 |
| 聲稱頁不存在 | false | null |
| DOCX／TXT 引文在全文 | true | null |

跨 PDF 頁的引文保守視為未核對；模型與瀏覽器不能自行宣告 source_verified。後續修改來源的保護見審核邊界。

## 抽取資料與身分

`extract-requirements` 經 AI 閘門，使用 caller JWT 查文件版本並核對 project、`can_manage_documents`；只有通過後才用 service client 寫 system-managed run／建議。run 永久綁同案版本，記模型、prompt 版本、觸發人、時間、計數與覆蓋資訊；authenticated 無寫入權限，亦不能改 Requirement 的 ingestion provenance。

[requirementExtraction](../../supabase/functions/_shared/requirementExtraction.ts) 在落庫前驗證固定值域：無效類型／缺標題拒收，選填 enum 不合法則清空並記警示。模型看得到的 BOQ 目錄只含身分／敘述，不給廠商私有成本；候選 W-ref 由程式映射真實 UUID，不接受模型虛造 UUID。

[requirementPersist](../../supabase/functions/_shared/requirementPersist.ts) 以 run／批標籤／項次產生確定 UUID，ignore-duplicates upsert，使同次重試冪等。重新整理開新 run，保留舊建議與人工成果；不以 superseded 清理歷史。完成後 D-019 自動確認，即使有引註疑慮仍進 runtime；不是逐字核對放行門檻。

## 驗證與限制

[sourceVerify 測試](../../supabase/functions/_shared/sourceVerify.test.ts)、[抽文字](../../src/lib/documentExtract.test.js)、[落庫](../../supabase/functions/_shared/requirementPersist.test.ts)、[provenance pgTAP](../../supabase/tests/p0_06_document_ingestion.sql)。頁面讀取／批次覆蓋驗證見抽取文件；準確率、召回率、跨條款語意與 OCR 都沒有本輪量測保證。
