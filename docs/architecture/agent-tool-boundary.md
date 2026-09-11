# Agent 工具與人的覆核

> CURRENT｜2026-09-11。D-002／D-003／D-008；業務核定不在模型工具箱裡。

## 執行與角色

[agent-run](../../supabase/functions/agent-run/index.ts) 過 AI 閘門，以 my_org_type RPC 取得三方角色，不信任瀏覽器 role。message／history／facts 有輸入上限；[agent](../../supabase/functions/_shared/agent.ts) 最多 8 輪，同輪 tool calls 平行執行，工具失敗以遮罩後 is_error 回模型，輸出長度有上限。

[agentToolDefs](../../supabase/functions/_shared/agentToolDefs.ts) 與 [agentTools](../../supabase/functions/_shared/agentTools.ts) 分別定義／分派白名單：

| 集合 | 工具與權限 |
|---|---|
| 全角色唯讀七支 | search_boq、list_daily_logs、get_valuation、get_requirements、list_my_open_items、find_evidence、get_record |
| 廠商 | draft_daily_log、draft_inspection |
| 監造 | run_integrity_audit、draft_submittal_review |
| 機關 | run_integrity_audit |
| 全角色交接 | raise_to |

唯讀工具拿不到 service client，業務查詢走 caller JWT／RLS，仍逐一限制 project_id；明細透過 parent join 限案。工具寫入只到 agent_actions；工具可叫的 RPC 僅 my_org_type／list_project_members。日期、UUID、範圍、表名白名單與 PostgREST 搜尋字元都由程式驗證；get_record 用 hasOwnProperty 防原型鏈名稱，embed 明細 cap 200。

工具陣列維持固定順序與參考：唯讀在前、角色草稿居中、raise_to 最後。persona、stableStringify facts、tools 與最後一則訊息共四個快取斷點；改順序／注入時間戳會破壞快取前綴。

## 草稿與確定性

- 日誌工項來自照片對應，數量永遠 null／needs_input，昨日數量只供參考；出工／機具等可複製昨日並標來源，天氣標 CWA。
- 自主檢查 num 實測值永遠 null，overall 不代判；bool 建議必附 basis、標 ai_suggested，由人確認。
- 送審意見包既有 review-submittal，需求挑選與 collab slice 同步；suggested_decision 只是建議，不寫 submittals。
- 稽核工具用 deterministic findings，不過濾／重排／改寫；可選擇將結果存 audit_note。
- 契約期限由 contractDue 算；find_evidence 對沒有 work_item_id 的試體明示無法依工項查，不模糊猜測。

## agent_actions

actor_user 是收件人，SELECT 同時限本人與專案存取資格；只有 service role 建立，不開 authenticated 寫入 grant／policy。角色只有三方，舊 field／qc 由 trigger 正規化成 contractor。

人按接受／編修／拒絕後，前端 [agent slice](../../src/store/slices/agent.js) 才叫 resolve_agent_action；只允許本人 pending → accepted／edited／rejected，伺服器蓋 resolved_by／at 並同交易留 audit。expired 尚無排程路徑。需要寫業務資料的接受動作仍走既有 store action／RLS／guard，收下 handoff／audit_note 僅標覆核，不創造業務資料。

raise_to 依本案成員 org_type 找非本人收件人，同方多人取 RPC 第一位。寫兩筆：對方 handoff、發起人 handoff_sent，後者的 evidence.handoff_action_id 對應前者。第二筆失敗不撤掉第一筆，回應必須揭露發起方留痕失敗。target_table／id 成對，表名限 get_record 白名單加 checklist_records／test_samples。

## 留痕與驗證限制

HTTP steps 只回 tool／ok／ms，工具輸入／輸出與原始 step.error 不回前端，也未落庫。只有草稿動作與人的覆核可追溯；無法完整重建唯讀查詢軌跡，記錄粒度涉及個資最小化，仍待決策。用量紀錄不等於查詢軌跡。

[工具白名單掃描](../../supabase/functions/_shared/agentToolWhitelist.scan.test.ts)、[工具測試](../../supabase/functions/_shared/agentTools.test.ts)、[迴圈測試](../../supabase/functions/_shared/agent.test.ts)、[草稿 pgTAP](../../supabase/tests/agent_actions.sql)。待辦與提醒的範圍差異見 [雙引擎](dual-engine-sync.md)，不宣稱網頁與 Agent 待辦完全相同。
