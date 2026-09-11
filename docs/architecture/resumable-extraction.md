# 契約抽取與跨請求續跑

> CURRENT｜2026-09-11。瀏覽器接力，沒有伺服器背景工作；正式版本見 CURRENT。

## 分工與預算

[extract-requirements](../../supabase/functions/extract-requirements/index.ts) 編排閘門、載頁、批次與收尾；[ingestionRun](../../supabase/functions/_shared/ingestionRun.ts) 管新建、CAS 認領、過期、失敗；[requirementPrompt](../../supabase/functions/_shared/requirementPrompt.ts) 管 prompt 與版本；[requirementPersist](../../supabase/functions/_shared/requirementPersist.ts) 管冪等落庫；[前端接力](../../src/lib/extractRequirements.js) 遇 in_progress 帶 continue_run_id 再呼叫，最多 40 次。

現行單批預算 14,000 字元、至多 24 批；request 軟預算 60 秒、絕對上限 140 秒，呼叫最短 20 秒。這些是針對既有閘道逾時事故的應用預算，不是外部平台永遠不變的限制。參數以入口常數為準；關分頁會停止接力，之後靠重啟或過期補償復原。

## 頁面完整性

loadDocumentPages 每批要求 exact count，以實收筆數續讀，可容忍伺服器 cap 小於請求量。count 缺漏／變動、頁序非從 1 連續、尚未讀完卻回空列都拒絕；processing.metadata.page_count 存在時必須吻合，壞格式不放行。舊路徑無 page_count 時只能證明儲存文字讀齊，不能證明原檔尾頁未遺失。途中查詢失敗不將半份文字送模型。

## 認領與持久化

- 新解析先補償同專案 started_at 與 last_progress_at 都過期的 pending／processing run（10 分鐘），再建立新 run。同版本 partial unique index 保證只能一筆 active，23505 轉 409 run_conflict。
- 續跑須同版本、processing、awaiting_continue=true，以 CAS 翻旗標；搶輸回 run_conflict，已終態或不能續跑回 restart_required。
- metadata 保存完成批數、累計計數、awaiting_continue、last_progress_at，以及 pending_split_batch／depth／done labels。readResumeState 對舊／壞 metadata 用安全預設。
- 同 run／批標籤／項次 UUID 冪等；計數只在完成批或子批邊界存快照，避免半批重跑重複累加。done labels 跨 request 保留，換批才清掉。
- timeout／max_tokens 對半切，最多兩層；單頁不能再切就記 clipped。預算不足暫停並保存切分深度，下次不能重演注定逾時的原批。第一批允許在軟預算後開始，避免只有載入就空轉。
- 改批次參數若使舊計畫不符，明確 restart_required，不錯位續抽；重跑保留舊建議與人工編修，不自動 supersede 或刪除。

## 回應協定

| 結果 | 前端處理 |
|---|---|
| 200 in_progress | 保存 run_id 並接力 |
| 200 completed | 成功，仍顯示覆蓋警示 |
| 409 run_conflict | 顯示處理中，不蓋失敗 |
| 409 restart_required | 終止接力，要求重啟 |
| 舊版 409 無 code | 保守視為處理中 |
| 422 no_text | 揭露掃描／無文字限制 |
| 502／504 非 JSON | 提示逾時與已有進度保留 |
| 登入／權限／輸入拒絕 | 顯示伺服器遮罩訊息 |

模型缺 requirements 陣列為批次失敗，合法空陣列可完成。無文字頁、無效輸出、截斷、失敗批都使 coverage_incomplete=true。有先前成功批次時，後段失敗仍 completed 並揭露部分結果；一批都沒成才 failed。完成後 apply_transcription_triage 自動確認，該步失敗則保留待確認。

每 request 各記實際 AI 用量，暫停也記帳。失敗只持久化短語與 code，原文進 log。verified_source_count 仍可能包含失敗批中未落庫的驗證數，不可直接當成果列數。

## 驗證與限制

[切批／頁序](../../supabase/functions/_shared/requirementExtraction.test.ts)、[落庫](../../supabase/functions/_shared/requirementPersist.test.ts)、[接力](../../src/lib/extractRequirements.test.js)、[active unique pgTAP](../../supabase/tests/ingestion_run_active_unique.sql)、[provenance pgTAP](../../supabase/tests/p0_06_document_ingestion.sql)。

24 批上限、無 OCR、跨條款語意與漏抽未解；completed 不代表語意正確，準確率／召回率須另用真契約量測。型別與 mock 測試不等於真模型整條流程驗收。
