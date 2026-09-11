# 契約重點確認與產物邊界

> CURRENT｜2026-09-11。D-019／D-020 是現行規則；契約原文優先。

## 確認狀態

| 路徑 | 起點 | 結果 |
|---|---|---|
| 人工 `review_requirement(..., 'approve')` | draft_ai／needs_review | approved |
| 人工 `reject` | draft_ai／needs_review | rejected |
| 人工 `supersede` | approved | superseded |
| 系統 `apply_transcription_triage` | completed run 的 AI 待確認項 | approved，保留 triage_doubts |

人工 RPC 從 Requirement 取得 project，核對 `can_review_requirement`，由伺服器蓋 reviewer／時間。只有監造／機關可確認，技術 admin 不增加此權限。一般瀏覽器不能直接 PATCH 確認狀態、origin、ingestion run 或審查身分；已確認／拒絕／取代的內容與來源快照凍結。AI-origin 項目必須連到 completed run 才能批准，service role 也受 guard 保護；manual／migration 不要求 run。

系統轉錄確認是 D-003 的明示例外：D-019 有核對疑慮仍確認，由 system 留痕，`reviewed_by` 為 null。這不授權 AI 審定估驗、查驗或其他業務單據。

## 履約與來源

所有 approved 類型由 `materialize_requirement_obligation` 同交易單向物化；supersede 只取消仍待辦 runtime。[RequirementsReview](../../src/pages/web/RequirementsReview.jsx) 在 approve／supersede 成功後刷新義務，不再只刷新 deadline。

人工補登預設 `needs_review`，經既有 RLS insert；表單在 [ManualRequirementModal](../../src/components/requirements/ManualRequirementModal.jsx)，期限／頻率轉換在 [manualRequirement](../../src/lib/manualRequirement.js)。契約歸包與來源寫入保留；主檔成功而來源寫入失敗須明示部分成功。

來源驗證由系統決定。使用者不能 INSERT 已驗證來源，改引文／頁碼等欄位會清掉驗證，不能直接 false → true；已審來源仍受快照 guard。DOCX 段落索引不得冒充頁碼。

工項連結以真實 item number 找工項 UUID，禁止跨案與模糊標題猜配；AI 只能建 suggested。`requirement_artifact_links` 只允許 approved Requirement 連到同案真實產物，建立／刪除需審查權，不能 UPDATE。目標為 inspection point、checklist template、test sample、submittal、photo、obligation；report 沒有持久化目標。UI 僅展示連結，沒有自動建立有效停留點、送審或查驗的產生器。

## 查閱流程

- `/requirements` 展示履約時程，`/requirements/review` 展示整理與確認資料；`?package=` 延續契約範圍，`?highlight=` 可直達單條。篩選只作用於 RLS 允許的資料。
- requirements／runs 採分頁，來源依 ID 分批；必要查詢失敗顯示可重試狀態。切案／選取的世代防護避免舊回應覆蓋新畫面。
- `requirementVerification` 是兩頁共用標示。只有 AI 已確認、具 reviewed_at 且 triage_doubts 明確為空，才顯示「系統核對無誤」，且限於引文／期限數字；不保證語意或無漏項。
- 「只看需留意」收核對疑慮、缺結果與待確認項；不重列已拒絕／已取代或人工確認項。歷史已確認項不因重新抽取消失。
- 每版本最近 completed run 各自揭露空白頁、拒收輸出與截斷，即使沒有任何義務也顯示警示。completed 不代表完整或正確。

## 驗證

[頁面流程](../../src/pages/web/Requirements.integrity.test.jsx)、[時點轉換](../../src/lib/manualRequirement.test.js)、[確認 RPC／來源與產物護欄](../../supabase/tests/p0_07_requirement_review.sql)、[轉錄確認](../../supabase/tests/transcription_triage.sql)、[全部類型物化](../../supabase/tests/requirement_obligation_one_way.sql)。
