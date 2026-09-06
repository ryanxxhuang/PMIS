> 稽核代理原始報告（2026-09-06，唯讀讀碼）。燈號與數字以主報告 `docs/全案健檢-2026-09-06.md` 的「校正」節為準。

# 全案健檢 維度 A：安全與權限（唯讀稽核）

稽核日：2026-09-06　基準：`main`（ba6ab45）　方法：逐檔讀 migrations／tests／functions／src，不執行任何寫入。

## 總評（3 行）

- 🔴 0 項｜🟡 9 項｜🟢 16 項（另 4 項標「待驗證」，需登入 hosted 專案或 GitHub 設定才能確認）。
- 資料庫邊界（51 表 RLS 100%、guard trigger、append-only 稽核、平台管理員防升權）是全案最強的一塊，且 927 筆 pgTAP／33 檔釘住；**沒有發現可越權讀寫他案資料的 P0 路徑**。
- 主要缺口集中在「營運面」：AI 呼叫**沒有任何成本上限／速率限制**（欄位有、執行沒有）、帳號安全（鎖定／MFA 入口）與 hosted 設定漂移無法從 repo 證明，以及 `agent_actions`／`ai_usage_events` 未做到與 `audit_events` 同等級的不可竄改。

---

## 檢查項目

### A-01｜AI 功能無成本上限、無速率限制、無輸入尺寸上限｜P1｜🟡

**證據**
- `supabase/migrations/20260728000100_ai_platform.sql:105-109`：`projects.ai_monthly_token_quota bigint` 註解明寫「本批只留欄位不做任何」；`ai_feature_allowed()`（同檔 :178-207）只看 enabled／min_plan／override，**完全不讀 quota**。
- `supabase/functions/_shared/aiGate.ts:100-170`：`openAiGate` 只做 JWT → 成員 → 開關三步，無任何每人／每案／每日呼叫次數或 token 累計檢查。
- `supabase/functions/agent-run/index.ts:118`：`facts: body?.facts` 原樣送進 system prompt（`_shared/agent.ts:141-145`），無大小上限；`history` 有截斷（:95-104）但 `facts` 沒有。
- `supabase/functions/describe-defect/index.ts:36`、`read-whiteboard`、`classify-site-photo`、`analyze-safety-photo`：`image_base64` 無長度檢查即送 Claude。
- `supabase/functions/*/index.ts` grep `MAX_|byteLength` 無任何尺寸上限。

**影響**：任一專案成員（含試用帳號）可用迴圈打 edge function 燒 Anthropic 額度；每案 `max_tokens` 只是單次上限（512～8000），不是總量。記憶中「上線硬缺口＝AI 成本上限」至今未實作。這是財務風險而非資料外洩，但對「SaaS 套裝型」交付而言是必答題。

**建議修法**
1. 在 `ai_feature_allowed` 或新 RPC `ai_quota_remaining(p_project)` 讀 `ai_monthly_token_quota` 對 `ai_usage_events` 當月 sum，超額回 false（fail-closed 語意已存在，只要接上）。
2. `openAiGate` 加簡單 per-user 滑動窗（例如 `ai_usage_events` 近 60 秒 > N 筆即 429）。
3. `agent-run` 對 `facts` 序列化後長度設上限（例如 60 KB）；影像函式對 `image_base64.length` 設上限（例如 6 MB）。
4. 平台層加一個全域日成本上限（環境變數）作為最後保險。

**工作量**：M

---

### A-02｜帳號安全：無帳戶鎖定、MFA 無前端入口、密碼效期／歷史未做｜P1｜🟡

**證據**
- `docs/資安/資通系統防護基準-普通級-符合性對照.md` 構面四：自評明列「登入失敗 5 次鎖 15 分鐘 ❌」「密碼效期 ⚠️」「密碼歷史 ❌」，核對日 2026-08-08，至今 migrations 與 src 均無對應實作。
- `src/` grep `mfa|enroll|totp` 零命中：即使 hosted 已開 TOTP enroll（文件稱 2026-08-11 查證），使用者**沒有任何 UI 可以 enroll**，等於 MFA 不存在。
- `supabase/config.toml` `[auth.mfa.totp] enroll_enabled = false`：本機與 hosted 不一致（見 A-08）。
- `supabase/config.toml` `[auth.rate_limit] sign_in_sign_ups = 30`：只有 IP 級 5 分鐘 30 次的速率限制，不是帳號鎖定。
- 密碼強度：`minimum_password_length = 8`、`password_requirements = "lower_upper_letters_digits"`（config.toml）與 `src/lib/errorMessage.js:21-24` 的訊息一致 → 這一項 🟢。

**影響**：附表十普級「身分驗證管理」第三點（鎖定）是**明文要求**；MFA 雖普級不要求，但簽辦包文件已寫成加分項，若機關實測發現無入口會反噬信任。

**建議修法**
- 鎖定：Supabase 無原生機制。最小實作＝Auth Hook（`password_verification_attempt`）或 Edge Function 代理登入 + `login_attempts` 表計數；或至少把 hosted rate limit 調到與「5 次／15 分」等價並在文件改口為「以速率限制達成等效」。
- MFA：加 `/settings/security` 頁走 `supabase.auth.mfa.enroll/challenge/verify`，並在 `routeRegistry` 登記。
- 密碼效期／歷史：`profiles.password_changed_at` + 180 天提醒；歷史需 Auth Hook 存 hash 比對。

**工作量**：M（鎖定 S、MFA UI S、效期 S、歷史 M）

---

### A-03｜`agent_actions`／`ai_usage_events` 未做 append-only trigger，與留存政策陳述不符｜P2｜🟡

**證據**
- `supabase/migrations/20260725000000_agent_actions.sql:44-46`：只 `revoke insert, update, delete … from authenticated` + `resolve_agent_action` RPC；**無** `before update or delete` immutability trigger。
- `supabase/migrations/20260728000100_ai_platform.sql:158-166`：`ai_usage_events` 同樣只 revoke，無 trigger。
- 對照 `audit_events`（`20260712000500_p0_05_audit_events.sql:56-68`）與 `project_deletion_records`（`20260811000200:44-52`）：兩者有「service role 也擋」的 trigger。
- `docs/資安/日誌留存政策.md` §三-2 寫「稽核表沒有 UPDATE／DELETE 政策…即使以服務端金鑰連線也不能改寫歷史（觸發器會 raise）」，但 §一把 `agent_actions`、`ai_usage_events` 也列為四類日誌之一 → 對這兩表的陳述目前**不成立**。
- 額外：`resolve_agent_action`（agent_actions.sql:60-113）本身有 pending-only、本人限定與 audit 留痕，人為路徑是安全的；缺口只在 service role／SQL console。

**影響**：機關若依政策文件現場驗證，會發現 AI 行為紀錄可被 service key 改寫；也是「第三條紅線：每個 agent 動作都留痕」的完整性缺口。

**建議修法**：新增 migration，為 `agent_actions` 加 `before delete` 一律 raise（除父專案已刪 cascade）、`before update` 只允許 `status/resolved_by/resolved_at` 由 pending 轉終態（含 `expired`）；`ai_usage_events` 加無條件 append-only trigger（同 project_deletion_records 模式）；補 pgTAP。

**工作量**：S

---

### A-04｜Edge Function 錯誤回應把上游原始訊息直接回給呼叫端｜P2｜🟡

**證據**
- `supabase/functions/_shared/aiGate.ts:126`：`json({ error: projectError.message }, 500)`（PostgREST 原始錯誤）。
- `supabase/functions/agent-run/index.ts:66`、`:142`：`projectError.message`、`String(e.message)`。
- `supabase/functions/describe-defect/index.ts:44-50`（及其他 12 支同形）：Claude 失敗時 `json({ error }, 502)`，而 `_shared/claude.ts:87` 的 error 含 `Claude ${status}: ${body.slice(0,500)}`（Anthropic 回應本文前 500 字）；catch 區塊回 `e.message`。
- `supabase/functions/extract-requirements/index.ts:220,232,241,279,295,344,374,669,731,768`：多處回 `xxxError.message`。
- 緩解：前端 `src/lib/errorMessage.js:66-96` 對非 CJK、非 P0001 訊息一律遮蔽成「情境 + 代碼」，`src/lib/errorLeak.scan.test.js` 凍結畫面層；**沒有 stack trace 外洩**（grep `stack` 零命中）。

**影響**：畫面層已合規；但直接呼叫 API 的人（或 Sentry breadcrumb）可拿到 Postgres／Anthropic 原始訊息。附表十構面五「錯誤時僅顯示簡短訊息及代碼」是對「使用者頁面」的要求，故降為 P2。

**建議修法**：在 `_shared/claude.ts` 的 `jsonResponse` 之外加 `errorResponse(code, publicMessage)`，原始訊息只 `console.error`（Supabase 函式日誌可查）；`claudeJson` 的 `error` 欄位改回固定代碼，Anthropic 本文只進 log。

**工作量**：S

---

### A-05｜hosted Auth／MFA／JWT 設定無法由 repo 證明，本機 config.toml 與文件不一致｜P2｜🟡（待驗證）

**證據**
- `supabase/config.toml`：`[auth.mfa.totp] enroll_enabled=false`、`enable_confirmations=false`、`secure_password_change=false`、`jwt_expiry=3600`、`[db.network_restrictions] enabled=false`。
- `docs/資安/…符合性對照.md` 構面四稱 hosted「MFA enroll 已開啟」「mailer_autoconfirm = true 刻意先不關」。
- `supabase/config.toml` 無任何 `[functions.<name>]` 區段：`send-reminders` 的 `--no-verify-jwt` 只存在於檔頭註解（`send-reminders/index.ts:20`）與部署指令，不在版控設定 → 換人部署可能忘記或誤套到其他函式。
- `supabase/seed.sql:11-15`：本機為 service_role 補齊表級權限以對齊 hosted 預設，註解已說明只在 `db reset` 執行；這是正確的對齊方式（🟢），但反向提醒：**hosted 的 service_role 全表可寫是既定事實**，A-03 的重要性由此而來。

**影響**：「本機測過、正式不同」目前的差異點是 MFA、確認信、JWT 效期、network restrictions；pgTAP 不受影響（只測 RLS／trigger）。

**建議修法**：把 hosted 的 Auth 設定用 Management API 匯出一份 `docs/資安/hosted-auth-settings-YYYYMMDD.json` 當佐證並定期比對；在 `config.toml` 加 `[functions.send-reminders] verify_jwt = false` 讓部署行為版控化；正式收客前照文件順序「先自訂 SMTP → 關 autoconfirm」。

**工作量**：S

---

### A-06｜pgTAP 覆蓋缺口：4 張業務表與 contract-documents storage policy 無專屬測試｜P2｜🟡

**證據**（見 §RLS 覆蓋矩陣）
- `change_order_items`、`item_schedules`、`observations`：policy 存在（baseline.sql:590-600、618-628、770-780），但 `supabase/tests/` 無任何檔案引用這三表；`change_order_items_guard` 凍結邏輯（formal_mode.sql :149-160）也沒有測試。
- `demo_requests`：RLS 零 policy fail-closed（`20260824123253:26`），無測試證明 authenticated 讀不到（此表含姓名／Email／電話／IP）。
- storage：`supabase/tests/photos_storage.sql` 只測 `photos` bucket；`contract-documents` 的 select／insert／delete policy（`20260712000800:551-557`、`20260822000300:111-117`）與 `storage_path_in_use` 護欄無 pgTAP。
- `document_pages`（契約全文）select policy（`20260712000300:138-142`）僅被其他測試間接觸及。

**影響**：這些是「已寫好但沒釘住」，未來 policy 改動時不會被 CI 抓到；`demo_requests` 與 `contract-documents` 是個資／契約原始檔，值得補。

**建議修法**：補一檔 `supabase/tests/rls_gaps.sql`：三張表 CRUD × 三方角色；`demo_requests` 匿名／登入皆 0 列；`storage.objects` 對 contract-documents 路徑的跨案 select／delete 拒絕。

**工作量**：S

---

### A-07｜baseline 11 支 security definer RPC 未 revoke from anon／public｜P3｜🟡

**證據**：以腳本比對 146 支函式後，以下 security definer 非 trigger 函式沒有任何 `revoke all … from public, anon`：`can_access_contractor_private`、`can_write`、`create_project`、`delete_project`、`is_project_admin`、`is_project_member`、`list_project_members`、`my_org_type`、`my_party`、`my_project_ids`、`remove_member`（全在 `20260711000000_baseline.sql`／`20260712000400`）。PostgreSQL 預設把 EXECUTE 給 PUBLIC，故 anon 可經 PostgREST `/rpc/` 呼叫。
- 已讀本體確認全部以 `auth.uid()` 為門檻（`create_project` :raise 'not authenticated'；`delete_project` 走 `is_project_admin`；`list_project_members` 有 `exists(... me.user_id = auth.uid())`；helper 回 false／空集合）→ 匿名呼叫得不到資料。

**影響**：無實質越權；屬縱深防禦與一致性（後期 migration 全部有 revoke）。

**建議修法**：一支 migration 統一 `revoke all on function … from public, anon`；順手把 `acceptance_stage_allowed`、`safety_record_type_allowed`、`obligation_party` 等 7 支純函式補 `set search_path`（目前無 search_path 但非 security definer，風險低）。

**工作量**：S

---

### A-08｜send-reminders：秘密比對非常數時間、CRON_SECRET 明碼寫在 cron.job｜P3｜🟡

**證據**
- `supabase/functions/send-reminders/index.ts:44-47`：`req.headers.get('x-cron-secret') !== secret` 字串比較；無 JWT（設計如此）。
- `supabase/cron.sql:14-27`：`x-cron-secret` 以字面值寫進 `cron.schedule` 的 SQL 本文（`cron.job` 表僅 superuser 可讀，風險低）。
- `?dry=1` 會回傳全平台成員 email 與待辦（:170-175），但同樣受 secret 保護。
- 跨案隔離靠逐查詢 `.eq('project_id')`（:88-131）而非 RLS——已在檔頭註明並與 `collectOpenBallItems` 共用。

**建議修法**：改用 `crypto.subtle.timingSafeEqual`（或 hash 後比對）；cron.sql 改讀 Vault（`vault.decrypted_secrets`）。

**工作量**：S

---

### A-09｜`demo_requests` 存 IP 與 User-Agent，無保存期限與清除機制｜P3｜🟡

**證據**：`20260824123253_create_demo_requests.sql:10-22` 含 `email/phone/ip/user_agent`；無 retention 註解、無 cron 清理；日誌留存政策也未涵蓋此表（它不是稽核日誌而是行銷個資）。

**建議修法**：在個資委外文件補「Demo 申請資料保存 12 個月」並加 pg_cron 清理；或至少把 `ip` 改成 `/24` 遮罩。

**工作量**：S

---

### A-10｜Prompt injection 面：前端提供的 facts／findings／history 直接進 prompt｜P3｜🟢（設計上可接受）

**證據**：`agent-run/index.ts:118`（facts）、`audit-summary/index.ts:29-36`（findings 由前端算好帶上來）、`review-submittal` 等；`agent.ts:139-147` 把 facts 放 system[1]。
**為何綠燈**：三條紅線落實——agent 工具白名單無核定類工具（`agentTools.ts:1738-1742` 只有 draft_*／raise_to／run_integrity_audit），所有寫入只到 `agent_actions`（:894-905、:1690）；查詢走 `userClient` 套 RLS。注入最多讓「自己的草稿」變差，且成本面歸 A-01。

---

### A-11｜CORS `Access-Control-Allow-Origin: *`｜P3｜🟢

**證據**：`_shared/claude.ts:115-119`。所有函式都要求 Bearer JWT（`openAiGate` 或自驗），無 cookie 憑證，`*` 不會造成 CSRF；`send-reminders` 無 CORS（不需瀏覽器呼叫）。建議上線後收斂為 `https://app.gov-agent.ai`，屬加分。

---

### A-12｜Session／保持登入｜P3｜🟢

**證據**：`src/lib/supabase.js:8-31` 「保持登入」預設勾選 → token 進 localStorage；取消 → sessionStorage；`config.toml` `enable_refresh_token_rotation=true`、`jwt_expiry=3600`。無閒置逾時（grep `idle|inactiv` 零命中）。附表十普級對 session 逾時無要求；中級才要求。記錄以備升級。

---

### A-13｜CI 護欄「只叫不擋」｜P2｜🟡（待驗證）

**證據**：`.github/workflows/pgtap.yml:6-20` 只在 `supabase/**` 路徑變更時跑；`ci.yml` 跑 `npm test`+`build`。記憶檔案記載 main 無 branch protection。repo 內無法讀取 GitHub 設定，需登入確認。
**影響**：RLS／trigger 改壞而 pgTAP 紅燈時仍可直接 push 到 main 並被 Cloudflare 自動部署。
**建議**：開 branch protection 要求 `pgTAP`、`ci` 兩個 status check。**工作量**：S

---

## 🟢 已確認無問題的項目

### A-14｜RLS 覆蓋率 51/51｜🟢
全部 51 張 `create table` 均有 `enable row level security`（腳本比對）。`platform_admin_bootstrap`（`20260728000000:83-86`）與 `demo_requests` 刻意零 policy＋revoke，fail-closed。無任何 `to anon`／`to public` policy。詳見文末矩陣。

### A-15｜狀態轉移 Guard Trigger 全數存在且有 pgTAP｜🟢
| 流程 | Guard | 定義位置 | pgTAP |
|---|---|---|---|
| 估驗 | `valuations_guard`、`valuation_items_guard`、`valuations_payment_gate`、`valuations_delete_guard` | formal_mode.sql:40-84、valuation_payment_gate.sql:28、evidence_guards.sql:69 | formal_mode、valuation_payment_gate、payment_flow、evidence_guards |
| 變更設計 | `change_orders_guard`（D-016 機關專屬＋順序 gate）、`change_order_items_guard` | 20260819111252:13-49、formal_mode.sql:149-160 | change_order_approval、formal_mode（items 凍結無專測，見 A-06） |
| 送審 | `submittals_guard`、`submittals_delete_guard` | formal_mode.sql:111-121、evidence_guards.sql:36 | submittal_flow、evidence_guards |
| RFI | `rfis_guard`（含洗狀態修補）、`rfis_delete_guard`（answer is null 判準） | 20260822000200:22-53 | rfi_flow |
| 驗收 | `acceptance_events_guard`（階段×角色、他方事件保護、created_by 不可冒名） | formal_mode.sql:250-300 | acceptance_events_rbac、formal_mode |
| 缺失 | `defects_guard`（統一缺失引擎）、`defects_audit` | 20260712001400:112、formal_mode.sql:98-108 | defect_engine、evidence_guards |
| 工安 | `safety_records_guard` | formal_mode.sql:186-247 | safety_records_rbac |
| 查驗 | `inspections_guard`、`inspections_delete_guard`、`checklist_records_guard` | formal_mode.sql:87-96、evidence_guards.sql:58、checklist_revisions:100 | formal_mode、evidence_guards、checklist_revisions、inspection_checklist_link |
| 正式模式 | `projects_formal_mode_guard`（單向；登入者不可關） | formal_mode.sql:19-27 | formal_mode |
| 文件刪除 | `delete_document` RPC（無 DELETE policy）+ `documents_audit_delete_event` + storage `storage_path_in_use` | 20260822000300:55-117 | document_delete |
| 照片 | `photos_delete_guard`／`photos_update_guard` + storage delete `photo_storage_path_in_use` | 20260822010000:86-160 | photos_storage |

**admin_override 旁路**：`admin_override(p) = is_project_admin(p) and not formal_mode`（formal_mode.sql:30-36），十個 guard 一致改用；`evidence_delete_bypass` 亦以 admin_override 為準（evidence_guards.sql）。正式模式一開即失效，且不可由登入者關閉 → 符合「旁路只在非正式模式」要求。`auth.uid() is null` 放行（service role）是所有 guard 共同的信任邊界，與 A-03 的觀察一致。

### A-16｜Edge Functions 逐支檢查｜🟢（缺口已拆到 A-01／A-04）
| 函式 | JWT／getUser | project 成員驗證（非只信 body） | service_role 用途 | aiGate＋ai_usage_events | 錯誤外洩 | CORS | 限流／上限 |
|---|---|---|---|---|---|---|---|
| agent-run | ✅ :55-60 自驗 | ✅ RLS 讀 projects :63-68 | 只寫 agent_actions（agentTools :894, :1104, :1404, :1583, :1690） | 內嵌同判定 gateVerdict :72-86；recordAiUsage :123-129 | 🟡 A-04 | * | ❌ A-01（facts 無上限） |
| extract-requirements | ✅ openAiGate :197 | ✅ 版本 RLS 讀＋body project 交叉比對 :214-227＋can_manage_documents :230-233 | 寫 ingestion_runs／requirements／sources（表對 authenticated 無寫權，project 來自 DB 解出的 doc.project_id） | ✅ :663,707,713 | 🟡 A-04 | * | 批次／續跑有設計；無次數上限 |
| send-reminders | 無 JWT，x-cron-secret :44-47 | 逐案 `.eq('project_id')` | 全表讀＋auth.admin.getUserById | 逐案 ai_feature_allowed :63-84；recordAiUsage | — | 無 | 由 cron 觸發 |
| fetch-weather | ✅ openAiGate | ✅ | 無 | ✅（isLlm=false 仍記） | 🟡 | * | ❌ |
| 其餘 13 支（analyze-safety-photo、assistant-chat、audit-summary、classify-document、classify-site-photo、describe-defect、draft-monthly-review、draft-rfi-reply、draft-valuation-summary、parse-contract、read-submittal、read-whiteboard、review-submittal） | ✅ openAiGate | ✅ RLS 讀 projects | 無（grep SERVICE_ROLE=0） | ✅ open/close 皆有 | 🟡 A-04 | * | ❌ A-01 |

補充：`ANTHROPIC_API_KEY`／`CWA_API_KEY`／`RESEND_API_KEY` 只在 Deno.env（`claude.ts:47`、`fetch-weather:78`、`send-reminders:54`），未進前端；`record_ai_usage` 只 grant service_role（ai_platform.sql:249-252），前端無法灌用量；`ai_feature_allowed` 查詢失敗 fail-closed（gatePolicy.ts:24-30，D-010）。

### A-17｜前端金鑰與 bundle｜🟢
- `src/lib/supabase.js:4-5` 只用 `VITE_SUPABASE_URL`／`VITE_SUPABASE_ANON_KEY`；全 src 的 `import.meta.env.VITE_*` 僅 6 個（另 SENTRY_DSN／SENTRY_ENV／APP_VERSION／SECURITY_CONTACT），無 service key；`grep service_role src` 零命中。
- `.gitignore` 含 `.env`、`.env.local`、`.env.e2e.real`；`git ls-files` 只有 `.env.example`／`.env.e2e.real.example`。
- localStorage 內容：`pmis-auth-ephemeral`、Supabase session（sb-*）、`pmis-current-project`（uuid）、側欄收合、主題、demo 角色 id（`auth.js:14-35`，僅未設定 Supabase 時）。**無敏感業務資料**。
- `dangerouslySetInnerHTML`／`innerHTML =`／`document.write`：零命中。
- Sentry（`src/lib/sentry.js:9-15`）：replay `maskAllText/maskAllInputs/blockAllMedia`，未設 `sendDefaultPii`。
- 安全標頭：`public/_headers` 有 CSP（script-src 'self'）、HSTS、XFO DENY、nosniff、Referrer-Policy、Permissions-Policy、COOP；ZAP 複測 High=0。
- `errorLeak.scan.test.js`：只掃 `src/pages`、`src/components` 的 `.jsx`；`src/store/slices/*.js` 與 `src/lib/*.js` 不在範圍（其 throw 的中文訊息會被 friendlyError 原樣放行，故只要 slice 不拼接 raw error 即安全——目前靠 code review）。→ 列為 P3 觀察，不另開項。

### A-18｜稽核留痕：actor／IP／時間／不可竄改／保存｜🟢（agent_actions 見 A-03）
- `audit_events`：`actor_user_id`＋party／role 快照、`occurred_at timestamptz`、`actor_ip inet`（`20260811000100:16`）由 `current_request_ip()` 伺服器端從 `cf-connecting-ip > x-forwarded-for[0] > x-real-ip` 解析（:29-58），不收前端參數；`record_audit_event` 只 security definer trigger 可呼叫（revoke :123-125）。
- 不可竄改：`audit_events_immutable`（p0_05:56-68）、`project_deletion_records_immutable`（:44-52）對 service role 一樣 raise；authenticated 無 INSERT／UPDATE／DELETE（revoke :47）。
- 讀取：`audit_events_select` 限 `my_project_ids()`；`project_deletion_records` 限平台管理員。
- 文件存取：`log_document_access` RPC（`20260824000100`）補齊預覽／下載留痕，權限同 storage policy。
- 保存：無任何自動清除（`comment on table audit_events` 明文）；專案刪除 cascade 前先寫 `project_deletion_records`（含事件數與 IP）。政策書面在 `docs/資安/日誌留存政策.md`。
- 缺：「日誌處理失效之回應」（告警）仍無機制，文件自評已列 ⚠️。

### A-19｜平台管理員自我升權防護｜🟢
`profiles_guard_platform_admin`（`20260728000000:38-49`）；`handle_new_user` 只從 `platform_admin_bootstrap` 判定，不讀 `raw_user_meta_data`（:117-131）；`is_platform_admin` 欄位已從 authenticated 的 SELECT grant 剔除（`20260822010100:50-51`）。pgTAP：`ai_platform.sql`、`profiles_select_scope.sql`。

### A-20｜org_type 自我提權與邀請比對｜🟢
`profiles_guard`（`20260728000200:59-70`）擋登入者改 org_type；註冊時自選（`handle_new_user` 讀 metadata，設計 D-009）由 `add_member_by_email(p_expected_org)`（`20260812000400:15-46`）在入案時比對，錯配 raise。pgTAP：`profiles_org_type_guard.sql`、`invite_org_confirm.sql`。

### A-21｜profiles 跨租戶枚舉已收斂｜🟢
`profiles_select_scoped`：自己／共案／平台管理員（`20260822010100:34-41`），並以欄位級 grant 排除 `is_platform_admin`。

### A-22｜Storage bucket policies｜🟢（測試缺口見 A-06）
`photos`：路徑首段 project_id → `is_project_member`／`can_write`；delete 加 `photo_storage_path_in_use` 護欄。`contract-documents`：路徑第 4 段 package id → `can_read_contract_package`／`can_upload_contract_package`；無 UPDATE policy（版本不可變）；delete 只准孤兒檔。2026-07-13 已移除誤用 `[1]::uuid` 的衝突 policy。兩個 bucket 皆 `public=false`。

### A-23｜文件刪除單一守門路徑｜🟢
`documents` 無 DELETE policy；`delete_document` RPC 先驗包／文件管理權，未審 AI 建議隨文件刪、已審者由 FK RESTRICT 擋（`20260822000300:55-95`）。pgTAP：`document_delete.sql`。

### A-24｜成員模型與權限 helper｜🟢
`is_project_member`／`my_project_ids`／`is_project_admin`／`can_write` 全走 `project_members`＋`profiles.org_type`，未從 `project_memberships.project_role` 推導（符合 three-party-role-model）。`members_manage_by_creator` 與 `add_member_by_email`／`remove_member` 一致限制建立者。

### A-25｜service role 寫入範圍｜🟢
唯二使用 service key 的使用者觸發函式：agent-run 只寫 `agent_actions`（actor＝呼叫者或交接對象，project＝已驗證的 projectId）；extract-requirements 寫 ingestion 相關表且 project 來自 DB 解出的文件（body 只做交叉比對，:225-227）。`seed.sql` 的 service_role grant 只在本機。

---

## 本維度檢查項清單（含綠燈）

| 編號 | 項目 | 燈號 | 等級 |
|---|---|---|---|
| A-01 | AI 成本上限／速率限制／輸入尺寸 | 🟡 | P1 |
| A-02 | 帳戶鎖定／MFA 入口／密碼效期歷史 | 🟡 | P1 |
| A-03 | agent_actions／ai_usage_events 不可竄改 | 🟡 | P2 |
| A-04 | Edge Function 錯誤回應含上游原始訊息 | 🟡 | P2 |
| A-05 | hosted Auth 設定與 config.toml 漂移（待驗證） | 🟡 | P2 |
| A-06 | pgTAP 覆蓋缺口（3 表＋demo_requests＋contract-documents storage） | 🟡 | P2 |
| A-07 | baseline RPC 未 revoke from anon | 🟡 | P3 |
| A-08 | send-reminders 秘密比對／cron 明碼 | 🟡 | P3 |
| A-09 | demo_requests 個資保存期限 | 🟡 | P3 |
| A-10 | Prompt injection 面（工具白名單有效） | 🟢 | — |
| A-11 | CORS * | 🟢 | — |
| A-12 | Session／保持登入／閒置逾時 | 🟢 | — |
| A-13 | CI 護欄 branch protection（待驗證） | 🟡 | P2 |
| A-14 | RLS 覆蓋率 51/51 | 🟢 | — |
| A-15 | Guard trigger 全流程＋admin_override 受正式模式限制 | 🟢 | — |
| A-16 | Edge Functions 17 支逐一（JWT／成員／service／閘門／CORS） | 🟢 | — |
| A-17 | 前端金鑰、localStorage、XSS、bundle、安全標頭 | 🟢 | — |
| A-18 | audit_events 留痕欄位、IP、append-only、保存 | 🟢 | — |
| A-19 | 平台管理員自我升權防護 | 🟢 | — |
| A-20 | org_type 提權與邀請身分比對 | 🟢 | — |
| A-21 | profiles 跨租戶枚舉 | 🟢 | — |
| A-22 | Storage bucket policies | 🟢 | — |
| A-23 | 文件刪除單一路徑 | 🟢 | — |
| A-24 | 成員模型 helper 未誤用身分快照 | 🟢 | — |
| A-25 | service role 寫入範圍最小化 | 🟢 | — |

待驗證（需登入 hosted／GitHub）：A-05 hosted MFA／autoconfirm／JWT 效期／network restrictions；A-13 branch protection；hosted 是否真的以 `--no-verify-jwt` 部署 send-reminders 且其他函式 verify_jwt=true；hosted rate limit 實際值。

---

## 附錄：RLS 覆蓋矩陣（51 表）

| 表名 | RLS | policy（SELECT/INSERT/UPDATE/DELETE 或 ALL） | pgTAP 檔 | 風險備註 |
|---|---|---|---|---|
| acceptance_event_audits | Y | S（revoke 寫） | acceptance_events_rbac | 🟢 |
| acceptance_events | Y | ALL（members）＋guard | acceptance_events_rbac、formal_mode | 🟢 |
| agent_actions | Y | S（本人）；寫走 service／RPC | agent_actions | 🟡 A-03 無 immutability |
| ai_features | Y | S；寫 revoke（admin RPC） | ai_platform | 🟢 |
| ai_model_pricing | Y | S（平台管理員） | ai_platform | 🟢 |
| ai_usage_events | Y | S（平台管理員）；寫 revoke | ai_platform | 🟡 A-03 |
| audit_events | Y | S；寫 revoke＋immutable trigger | 13 檔 | 🟢 |
| change_order_items | Y | S/I/U/D＋guard | — | 🟡 A-06 無測試 |
| change_orders | Y | S/I/U/D＋guard | change_order_approval、formal_mode、p0_05 | 🟢 |
| checklist_records | Y | S/I/U/D＋guard | checklist_revisions、inspection_checklist_link、boq_reset_import | 🟢 |
| checklist_templates | Y | S/I/U/D | 同上 | 🟢 |
| contract_obligations | Y | S/I/U/D（authenticated 寫 revoke；由 requirement 單向產生） | 6 檔 | 🟢 |
| contract_packages | Y | S/I/U（無 D：刻意） | 4 檔 | 🟢 |
| cost_items | Y | ALL（can_access_contractor_private） | p0_05 | 🟢 |
| daily_log_items | Y | S＋ALL（can_write via daily_logs） | boq_reset_import | 🟢 |
| daily_logs | Y | S/I/U/D | boq_reset_import、photos_storage | 🟢 |
| defect_audits | Y | S；寫 revoke | defect_engine、evidence_guards | 🟢 |
| defects | Y | S/I/U/D＋guard | 5 檔 | 🟢 |
| demo_requests | Y | 零 policy（fail-closed，service 寫） | — | 🟡 A-06／A-09 |
| document_ingestion_runs | Y | S；寫 revoke＋system-managed trigger | 5 檔 | 🟢 |
| document_pages | Y | S/I/U/D（經 document_versions 可讀性） | 5 檔（間接） | 🟢 |
| document_processing_runs | Y | S/I/U | p0_07_5 | 🟢 |
| document_versions | Y | S/I/U（無 D：不可變） | 7 檔 | 🟢 |
| documents | Y | S/I/U（D 走 RPC） | 9 檔 | 🟢 |
| inspection_points | Y | S/I/U/D | p0_07 | 🟢 |
| inspections | Y | S/I/U/D＋guard | 5 檔 | 🟢 |
| item_schedules | Y | S/I/U/D | — | 🟡 A-06 |
| observations | Y | S/I/U/D | — | 🟡 A-06 |
| organizations | Y | S/I/U/D | p0_02 | 🟢 |
| photos | Y | S/I/U/D＋guard | photos_storage | 🟢 |
| platform_admin_bootstrap | Y | 零 policy＋revoke all | ai_platform | 🟢 |
| profiles | Y | S（scoped，欄位級 grant）/U（own）＋2 guard | 3 檔 | 🟢 |
| project_ai_overrides | Y | S；寫 revoke | ai_platform | 🟢 |
| project_deletion_records | Y | S（平台管理員）；immutable | project_deletion_records | 🟢 |
| project_members | Y | S（own）＋ALL（creator） | 29 檔 | 🟢 |
| project_memberships | Y | S/I/U/D＋guards | 9 檔 | 🟢 |
| project_parties | Y | S/I/U/D | 9 檔 | 🟢 |
| projects | Y | S/I/U（D 走 RPC） | 33 檔 | 🟢 |
| requirement_artifact_links | Y | S/I/D | p0_07、photos_storage | 🟢 |
| requirement_sources | Y | S/I/U/D＋guard | 7 檔 | 🟢 |
| requirement_work_items | Y | S/I/U/D | 3 檔 | 🟢 |
| requirements | Y | S/I/U/D＋多 guard | 12 檔 | 🟢 |
| rfis | Y | S/I/U/D＋guard | rfi_flow、evidence_guards、formal_mode | 🟢 |
| safety_record_audits | Y | S | safety_records_rbac | 🟢 |
| safety_records | Y | S/I/U/D＋guard | safety_records_rbac、formal_mode | 🟢 |
| schedule_periods | Y | S/I/U/D | boq_reset_import | 🟢 |
| submittals | Y | S/I/U/D＋guard | 5 檔 | 🟢 |
| test_samples | Y | S/I/U/D＋guard | evidence_guards | 🟢 |
| valuation_items | Y | S＋ALL＋guard | boq_reset_import、photos_storage | 🟢 |
| valuations | Y | S/I/U/D＋guard | 7 檔 | 🟢 |
| work_items | Y | S/I/U/D | 5 檔 | 🟢 |

註：文件自評寫「49 表」，實際 migrations 建表 51 張（多出 `demo_requests`、`project_deletion_records` 等後期表），簽辦文件數字應更新。
