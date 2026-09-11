# Agent 工具邊界（第一與第三條紅線的執行機制）

> 狀態：**CURRENT** ｜ 最後核對：2026-09-11（分支 `refactor/product-wide`；B4 拆檔 commit `eddcf18` 與 `handoff_sent` 留痕已提交、未合併 `main`、未部署）
> 對應程式：`supabase/functions/agent-run/index.ts`、`_shared/agent.ts`（迴圈）、`agentTools.ts`（分派器）、`agentToolDefs.ts`（定義與角色分發）、`agentQueryTools.ts`（唯讀七支）、`agentToolCommon.ts`、`ballInCourt.ts`、`draftDailyLog.ts`、`draftInspection.ts`、`draftSubmittalReview.ts`、`raiseTo.ts`、`integrityAuditTool.ts`／`integrityAudit.ts`、`agentPersona.ts`、`agentRole.ts`；前端 `src/store/slices/agent.js`
> 對應 migration：`20260725000000_agent_actions.sql`、`20260812000100_three_party_agent_roles.sql`
> 決策依據：[`../DECISIONS.md`](../DECISIONS.md) D-002（三方角色）、D-003（AI 只做草稿）、D-008（`/agent` 唯一入口）；角色模型見 [`three-party-role-model.md`](three-party-role-model.md)。本文件寫機制，不重述決策理由。

## 1. 紅線一的保證是工具白名單，不是 prompt

DEVELOPMENT.md §4 的 AI 工具邊界：「核定／判定／結案／驗收／凍結——agent 的工具箱裡根本沒有這些工具。靠工具白名單保證，不是靠 prompt 約束。」`agentPersona.ts` 的 `COMMON_RULES` 也叫模型不要宣稱已核定，但那是第二層；第一層是**模型呼叫得到的函式集合裡沒有任何一支能寫業務資料表**。

現行白名單：**12 支工具 ＝ 7 支唯讀 ＋ 5 支草稿**，三個角色的聯集不多不少。

| 工具 | 種類 | 角色 | 讀什麼／寫哪裡 |
|---|---|---|---|
| `search_boq` | 唯讀 | 全部 | `work_items`（item_no／ref_item_code／description ilike） |
| `list_daily_logs` | 唯讀 | 全部 | `daily_logs` ＋ `daily_log_items`；區間上限 60 天 |
| `get_valuation` | 唯讀 | 全部 | `valuations` ＋ `valuation_items`；預設最新一期 |
| `get_requirements` | 唯讀 | 全部 | `contract_obligations`（排除「不適用」）＋ `requirements`（只取 `approved`） |
| `list_my_open_items` | 唯讀 | 全部 | `collectOpenBallItems`（`ballInCourt.ts`）；「我方」由 `my_org_type` RPC 決定 |
| `find_evidence` | 唯讀 | 全部 | 日誌數量／查驗／檢查表／照片；試體誠實降級（`test_samples` 無 `work_item_id`） |
| `get_record` | 唯讀 | 全部 | `RECORD_SELECTS` 白名單八張表的單筆全欄位 |
| `draft_daily_log` | 草稿 | contractor | 只寫 `agent_actions`（kind `draft_daily_log`） |
| `draft_inspection` | 草稿 | contractor | 只寫 `agent_actions`（kind `draft_inspection`） |
| `draft_submittal_review` | 草稿 | supervisor | 只寫 `agent_actions`（kind `draft_submittal_review`） |
| `run_integrity_audit` | 唯讀＋可選草稿 | supervisor、owner | `create_draft: true` 時只寫 `agent_actions`（kind `audit_note`） |
| `raise_to` | 草稿 | 全部 | 只寫 `agent_actions` 兩筆（kind `handoff`、`handoff_sent`，見 §5） |

角色分發（`toolsForRole`）：
- contractor ＝ 唯讀七支 ＋ `draft_daily_log` ＋ `draft_inspection` ＋ `raise_to`
- supervisor ＝ 唯讀七支 ＋ `run_integrity_audit` ＋ `draft_submittal_review` ＋ `raise_to`
- owner ＝ 唯讀七支 ＋ `run_integrity_audit` ＋ `raise_to`（送審審查是監造的法定職掌，不給機關）

**業務表零寫入**：草稿工具寫的是 `agent_actions`——一張系統管理表，不是業務表。真正的業務寫入發生在使用者於收件匣按「接受」之後，由前端走既有 store action 完成，既有 RLS 與 guard trigger 全部照常生效（§4）。

**`resolve_agent_action` 不在 agent 手上**：工具層能呼叫的 RPC 只有兩支唯讀（`my_org_type`、`list_project_members`）。狀態轉移 RPC 只有前端在人按下接受／編修／拒絕時才呼叫。

這些不是約定，是 `agentToolWhitelist.scan.test.ts` 以**原始碼掃描**釘住的：唯讀模組（`agentQueryTools`／`ballInCourt`／`agentToolCommon`／`agentToolDefs`）不得出現 `.insert/.update/.upsert/.delete(`；草稿模組每一次寫入動詞的前一個 `.from()` 必須是 `'agent_actions'`；全部模組的 `.rpc('…')` 集合恰為那兩支；分派器 `agentTools.ts` 的 `case` 行裡，唯讀七支拿不到 `service`、草稿五支才有。加第 13 支工具或讓查詢工具碰到 service role client，測試會紅。

現查方式：`grep "case '" supabase/functions/_shared/agentTools.ts`（分派清單）、`npx vitest run supabase/functions/_shared/agentToolWhitelist.scan.test.ts`。

## 2. 一次 `agent-run` 的執行流程

1. `openAiGate(req, { feature: 'agent.run', projectId })`：登入、成員資格、功能開關（fail-closed，見 [`ai-gate-and-metering.md`](ai-gate-and-metering.md)）。輸入上限：`message` 4,000 字元、`facts` 序列化後 100,000 字元、`history` 最多 20 則、每則 4,000 字元；淨化後 history 若以 assistant 開頭會丟掉開頭的 assistant 訊息（Anthropic 要求第一則是 user）。
2. **角色由伺服器決定**：`userClient.rpc('my_org_type')` → `agentRoleOf()`（`contractor`／`supervisor`／`owner`，未知一律 `contractor`）。不信任 client 傳值；不讀 `project_memberships.project_role`。
3. `claudeAgent({ system: personaSystem(role), tools: toolsForRole(role), exec: makeToolExec(userClient, projectId, serviceClient, userId, role), facts, history })`。
4. 迴圈（`agent.ts`）：最多 `maxSteps` 8 輪；模型回 `tool_use` 就平行執行全部工具、把所有 `tool_result` 放同一則 user 訊息；單一工具失敗回 `is_error` 的 tool_result（遮罩短語）不中斷整輪；單一工具輸出超過 20,000 字元截斷；`refusal`／`max_tokens`／`max_steps` 各自收尾。
5. `recordAiUsage`（彙總多輪 usage 一筆）→ 回前端 `{ text, role, steps: [{ tool, ok, ms }], usage, stop_reason, error? }`。**工具的輸入、輸出與 `step.error` 原文都不回前端**（前端只該看到最終回答）。

權限模型：所有業務查詢都走呼叫者 JWT 建的 `userClient`（自動套 RLS），**但每個查詢仍逐一 `.eq('project_id', …)` 綁定本案**——縱深防禦，不單靠 RLS；明細表沒有 `project_id` 的（`daily_log_items`、`valuation_items`）用 `!inner` join 綁定。`serviceClient` 只用於寫 `agent_actions`（該表 authenticated 無寫入權限），缺 `SUPABASE_SERVICE_ROLE_KEY` 時查詢工具照常可用，草稿工具回「伺服器未設定，暫時無法建立草稿」。

輸入防護（`agentToolCommon.ts`）：日期／UUID／範圍逐項驗，不合法回 `{ error }` 而非丟例外，讓模型能據 tool_result 自行修正；`likePattern` 跳脫 ilike 萬用字元並移除 PostgREST `or()` 的分隔字元（逗號、括號），否則關鍵字會被當成條件分隔符注入額外條件；`get_record` 的表名用 `hasOwnProperty` 檢查白名單（`in` 會命中原型鏈讓 `toString` 之類過關）；`capList` 把 embed 明細限在 200 筆。PostgREST 錯誤一律經 `maskDbError` 遮罩後才進 tool_result（模型會把原文複述給使用者），P0001 業務規則的繁中訊息照規則放行。

## 3. 工具順序是 prompt cache 的前提——不能動

`agent.ts` 用 Anthropic prompt caching，斷點上限 4 個：① persona（`system[0]`，同角色跨使用者共用）② facts 快照（`system[1]`，跨輪共用；放 system 而不是第一則 user 訊息，否則前綴含逐輪增長的 history、輪輪 cache write）③ tools 的最後一個定義 ④ messages 的「滾動斷點」（每輪清掉先前設的、移到最後一則訊息尾）。前綴必須逐位元組穩定，所以：

- `QUERY_TOOLS` 陣列順序固定、每個角色的工具陣列是**模組層常數**（`CONTRACTOR_TOOLS`／`SUPERVISOR_TOOLS`／`OWNER_TOOLS` 只建一次），`toolsForRole(role)` 多次呼叫回同一參考；排列固定為「唯讀七支在前、角色專屬草稿工具居中、`raise_to` 殿後」。
- persona 內容不得含時間戳或隨機值；facts 用 `stableStringify`（遞迴排序 key）序列化。
- `claudeAgent` 會複製一份 tools 再在最後一個下斷點，不改動呼叫端的陣列。

`agentTools.test.ts` 釘住：三個角色的組成、唯讀七支的名稱與順序逐項、`toolsForRole(role)` 的參考同一性（`toBe`）；`agentToolWhitelist.scan.test.ts` 釘住每個角色都以唯讀七支開頭。重排＝快取前綴失效＋測試紅。

## 4. `agent_actions`：草稿收件匣的欄位語意與人的覆核留痕

```text
agent_actions (
  id, project_id, actor_user,          -- 草稿是提給誰的（SELECT policy 的「本人」）
  agent_role  contractor|supervisor|owner   -- 三方值；BEFORE trigger 把舊 field/qc 正規化成 contractor
  kind        text                     -- 現查：grep "kind: '" supabase/functions/_shared/*.ts
  target_table, target_id              -- 關聯單據（可空；raise_to 走白名單）
  summary, rationale                   -- 給人看的一句話與理由
  evidence    jsonb                    -- 草稿 payload／發現清單／交接對應
  status      pending|accepted|edited|rejected|expired
  resolved_by, resolved_at, created_at
)
```

存取模型（照 `audit_events`／`document_ingestion_runs` 的 append-only 慣例）：

- **SELECT**：`actor_user = auth.uid() and project_id in my_project_ids()`。草稿是尚未送出的私人工作狀態，同案他人不可見；`my_project_ids()` 是縱深防禦（`actor_user` 誤植也不會跨案外洩）。
- **INSERT**：只有 service role（agent-run）。刻意不建 INSERT／UPDATE／DELETE policy，並明確 `revoke` 表級寫入權限（基線 `alter default privileges` 會讓新表自動帶授權）。
- **狀態轉移唯一路徑**：`resolve_agent_action(p_id, p_status)`（`security definer`）——只接受 `accepted`／`edited`／`rejected` 三個人為終態；本人限定（`where id = p_id and actor_user = auth.uid() for update`；「不存在」與「非本人」回同一訊息，不洩漏他人草稿存在）；`pending` 是唯一可轉移態，終態不可逆；蓋 `resolved_by = auth.uid()`、`resolved_at = now()`；同交易呼叫 `record_audit_event('agent_action_resolved', …, before, after, { kind, agent_role })` 留痕。`expired` 保留給之後的 service 端排程，**目前沒有任何路徑會產生它**。
- 前端 `src/store/slices/agent.js`：真實模式讀 `agent_actions`、呼叫 `resolve_agent_action`；接受 `draft_inspection` 帶 `template_id` 或 `draft_submittal_review` 帶 `submittal_id` 時走既有 store action 建立業務資料（RLS／guard 照常）；`audit_note`／`handoff` 的接受＝「知道了／收下」，不產生任何業務資料，只標 `accepted`。

pgTAP `supabase/tests/agent_actions.sql`（plan 32）釘住結構、表級權限、RLS 隔離（同案他人與跨案皆不可見）、`resolve_agent_action` 狀態機與審計留痕；`three-party-role-model.md` 的驗證條件 4 釘住 `agent_role` 只存三方值。

## 5. `raise_to`：`handoff`／`handoff_sent` 兩筆的對應

`raise_to` 是唯一「寫給別人」的工具，仍只寫 `agent_actions`，但寫兩筆：

| 筆 | `actor_user` | `agent_role` | `kind` | 用途 |
|---|---|---|---|---|
| 第一筆 | 對方 | `to_role` | `handoff` | 對方的私人待辦；`evidence = { from_user, from_role, to_role, note }` |
| 第二筆 | 發起人 | 發起人角色（伺服器決定，不信模型） | `handoff_sent` | 發起方留痕；`evidence.handoff_action_id` 指向第一筆，兩筆可對應 |

為什麼要第二筆（B4，2026-09-11 補）：SELECT policy 是「本人」，所以對方那筆呼叫者看不到——A 的 agent 以 A 的名義送出了什麼、A 自己完全查不到，被 prompt 誘導亂發交接時發起人無從察覺。不改 RLS（那是安全邊界），改成兩筆各落各的名下；第二筆 `status` 沿用預設 `pending`，出現在發起人自己的收件匣，按「知道了」即完成覆核（`resolved_by`／`resolved_at` 留痕）。前端 `src/lib/agentRole.js` 把 `handoff_sent` 顯示為「已送出交接」、用低調色，因為球不在自己手上。

失敗語意：第二筆寫入失敗**不弄掛主要動作**（對方那筆已落地，回傳如實標註「發起人留痕未寫入」，原文只進 log）；對方那筆寫入失敗則回錯誤、不補登第二筆。

收件人怎麼找：`list_project_members` RPC（已依本案成員資格限縮）→ `org_type === to_role` 且不是自己；同方多人時取 RPC 順序第一位；`project_role`／職稱不參與分流。找不到就回「本案沒有其他『X』成員，無法交接」。`target_table` 白名單 ＝ `RECORD_SELECTS` 八張 ＋ `checklist_records` ＋ `test_samples`，且 `target_table`／`target_id` 必須成對。

工具描述與回傳都明講「使用者自己的收件匣只會多一筆『已交接給對方』的留痕，不是待辦」，免得 agent 叫使用者去自己的收件匣「接手」它。`agentTools.test.ts` 釘住兩筆的 `actor_user`／`kind`／對應關係與失敗語意。

## 6. 紅線二（數字由確定性引擎算）在工具層怎麼落實

| 工具 | 確定性引擎 | AI 的角色 |
|---|---|---|
| `get_requirements` | `computeObligationDueUTC`（`_shared/contractDue.ts`，與前端 `src/lib/contractDue.js` 共用同一組測試案例，見 [`dual-engine-sync.md`](dual-engine-sync.md) #4）算 `due_date`／`days_left`（負數＝已逾期）；基準日從 `projects` 讀 | 只能原樣引用回傳的日期與天數；引條款只准照 `source_clause` |
| `run_integrity_audit` | `buildIntegrityFindings`（`integrityAudit.ts`，與前端 `src/lib/integrityAudit.js` 逐行等價、同一組案例對照）；六個輸入的組法與 `RiskAudit.jsx` 一致；大表用 `fetchAllRows` 分頁抓齊（PostgREST 1,000 列上限） | 工具**不過濾、不重排、不改寫** findings；persona 規定機關端只能以「值得複查的異常提示」轉述 |
| `draft_daily_log` | `buildDailyLogDraft` 純函式（不呼叫 Claude）：工項清單由照片的 `work_item_id` 確定性比對帶出；**數量一律 `qty_today: null` ＋ `needs_input: true` ＋ `source: null`**，昨日同工項數量只寫進 `rationale` 供參考、絕不預填；出工／機具／材料複製昨日標 `source: 'yesterday'`；天氣來自 `fetch-weather` 標 `source: 'cwa'` | 只決定「要不要擬」；擬的內容不經模型 |
| `draft_inspection` | `buildInspectionDraft`：`kind: 'num'` 實測項**一律 `value: null` ＋ `needs_input`，不存在任何賦值路徑**；不呼叫 `judgeChecklist`（`overall` 留 null）；範本由 `pickChecklistTemplate` 關鍵字相符挑選 | 只有 `kind: 'bool'` 項可經 `bool_suggestions` 給建議，且每筆必附 `basis`（缺依據直接拒絕）、逐項標 `ai_suggested` 由人確認 |
| `draft_submittal_review` | 包既有 `review-submittal` Edge Function；需求撈法與前端 `collab.js` 的 `reviewSubmittal` 同步 | `suggested_decision` 一律以「建議」呈現；不碰 `submittals` 任何欄位 |

為什麼日誌數量與查驗實測值不讓 AI 填：照片能證明「有做」，不能證明「做了多少」；實測值驅動 `judgeChecklist` 的合格判定，是有法律效力的品質紀錄——AI 讀錯一個數字就是一張假的「合格」檢查表。`agentTools.test.ts` 的「數量誠實原則」與「實測值紅線」兩組測試釘住這兩條（即使昨日有同工項數量、即使同時給了 bool 建議，num 項仍是 null）。

## 7. 三方角色與 persona

`AGENT_ROLES = ['contractor', 'supervisor', 'owner']`；`agentRoleOf(org_type)` 一對一映射；`SIDE_BY_AGENT_ROLE` 讓 Agent 身分與 ball-in-court 陣營一對一。現場、品管、工安是廠商內部分工，不拆成不同 persona（`ROLE_PERSONA.contractor` 明寫）。`personaSystem(role)` 的組成是「共同開頭 ＋ 角色段 ＋ `COMMON_RULES`」；`COMMON_RULES` 七條是 prompt 層的反幻覺紀律（只依快照與工具、嚴禁自行計算、查無就說沒有、只擬草稿、資料矛盾要指出、條款只引工具回傳的出處、繁中純文字）。

## 8. 測試釘住

| 測試 | 釘什麼 |
|---|---|
| `agentToolWhitelist.scan.test.ts` | 12＝7＋5、每角色以唯讀七支開頭、唯讀模組無寫入動詞、草稿寫入只落 `agent_actions`、RPC 只有兩支唯讀、分派器 service 只給草稿工具 |
| `agentTools.test.ts` | 角色分發組成與順序、參考同一性、數量誠實原則、實測值紅線、`raise_to` 兩筆與失敗語意、`toolError` 遮罩 |
| `agent.test.ts` | 迴圈行為（多個 tool_result 同在一則 user 訊息、工具例外走 `is_error` 且原文不給模型、快取斷點佈局與滾動斷點總數 ≤ 4、`max_steps`／HTTP 錯誤的 stop_reason、body 不含 temperature 等禁用參數） |
| `agentRole.test.ts` | `agentRoleOf` 只回三方值 |
| `integrityAudit.test.ts` | 與前端同一組案例對照 |
| `supabase/tests/agent_actions.sql` | 表結構、權限、RLS 隔離、`resolve_agent_action` 狀態機、審計留痕 |

## 9. 已知缺口（如實記錄，未修）

- **紅線三缺口：唯讀工具的呼叫軌跡不落庫。** `agent-run` 只把 `steps` 的 `tool`／`ok`／`ms` 回前端；工具輸入（查了哪張表、帶什麼參數）、工具輸出與 `step.error` 既不回前端也不落庫；`ai_usage_events` 沒有欄位可放。一旦有爭議（agent 講了錯誤金額），無法重建它查了哪些資料。已登記在 [`../ROADMAP.md`](../ROADMAP.md) 「未排入」清單：最小改法是 `ai_usage_events` 加 `metadata jsonb`，完整作法是 append-only `agent_runs` 表；「記錄每一次查詢與參數」牽涉個資最小化，要先決定記到什麼粒度，屬決策而非工程。草稿類動作則已完整留痕（`agent_actions` ＋ `agent_action_resolved` 稽核事件）。
- `agent_actions.status = 'expired'` 沒有任何產生路徑（排程不存在）。
- `find_evidence` 對試體誠實降級：`test_samples` 沒有 `work_item_id`，無法依工項調閱（批 5 evidence_links 之前不做模糊猜測）。
- `list_my_open_items` 與前端 `todayTasks.js` 的涵蓋類型與責任歸屬有已知差異，見 [`dual-engine-sync.md`](dual-engine-sync.md) #5。
- 前端 `agent.js` 的 demo 分支（未設 Supabase 時的本地草稿）不在本文件範圍，未逐行核對。
