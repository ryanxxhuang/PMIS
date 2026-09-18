-- H2＋H3（D-026 瘦身續接；H1 回報補列，使用者 2026-09-17 於主 session 同意執行）：
--   H2 收回 anon（與 PUBLIC 偽角色）對 public 所有表／view／序列的全部權限，並修正 default privileges；
--   H3 收回 anon／PUBLIC 對 public 所有函式的 EXECUTE，authenticated 的 EXECUTE 改為逐支明示
--      （允許清單 68 支），其餘（trigger 函式、內部 helper）一併收回；default privileges 改為
--      「新函式預設不可被任何 API 角色執行、需明示 grant」。
--
-- 為什麼：
--   * 正式庫 pg_default_acl（Supabase 平台預設）仍讓 postgres 在 public 建的新表自動帶
--     anon 的 SELECT／INSERT／UPDATE／DELETE、新序列帶 anon 的 SELECT／USAGE／UPDATE、新函式帶
--     anon／authenticated／service_role 的 EXECUTE；再加上 PostgreSQL 內建預設：新函式一律給
--     PUBLIC EXECUTE。本機 CLI（secure-by-default）不給 anon 表級 DML，但函式一樣有 PUBLIC。
--     57 表 RLS 全開、沒有任何 anon／public policy，列級目前擋得住；但這是「每支 migration 都要
--     記得 revoke」的債（既有 migration 靠逐支 `revoke all on function … from public, anon`），
--     漏一支就是 anon 直接呼叫 security definer 函式、或未來一條 `to public` policy／關掉 RLS
--     就露出的路。根本解是把預設改成 fail-closed，並把既有物件一次收齊。
--
-- 盤點（2026-09-17／09-19，程式搜尋＋正式庫唯讀查詢；詳 supabase/SETUP.md 與 CURRENT §6.5）：
--   * 登入前路徑：登入／註冊／密碼重設／MFA 全部走 GoTrue（auth schema），不經 PostgREST；
--     `/login` `/security` `/terms` `/privacy` 四條公開路由是靜態頁（`navConfig` 標 public 的只有
--     這四條；列印路由全部 authenticated）；profile 只在 session 存在後才讀；沒有邀請碼機制
--     （邀請＝admin 以 `add_member_by_email` 加既有帳號，authenticated RPC）。
--   * Edge：所有 user client 都帶呼叫者 JWT（PostgREST 切成 authenticated），沒有 JWT 先回 401；
--     `send-reminders`（verify_jwt=false，cron secret）與行銷站的 `demo-request` 都用 service role。
--   * 行銷站／demo 站：demo 站 Supabase 留空（純前端）；行銷站只 POST 到 Edge `demo-request`。
--   * Storage policy：六條全部 `to authenticated`，呼叫的 helper 都在 authenticated 允許清單。
--   ⇒ anon 需要的表／序列／函式：**零**。例外清單為空。
--   * authenticated 允許清單（68 支）＝在 authenticated 執行情境被呼叫的函式：前端 `.rpc()`（30）、
--     Edge user client `.rpc()`（my_org_type／can_manage_documents／list_project_members／
--     ai_feature_allowed）、RLS／Storage policy 引用（pg_depend，29）、欄位 default（2）、既有
--     migration 明示 grant 給 authenticated 的 helper 與現場文書／期次 RPC；security invoker 的
--     根函式（obligation_party、fn_field_document_*）不再呼叫其他 public 函式，遞移封閉集不增加。
--     正式庫目前 authenticated 可執行 126 支，其中 50 支 trigger 函式（trigger 觸發不檢查呼叫者
--     的 EXECUTE，直接呼叫也只會得到「trigger functions can only be called as triggers」）與
--     8 支只被 security definer 函式內部呼叫的 helper（acceptance_stage_allowed／
--     acceptance_stage_owner_desc／safety_record_type_allowed／zh_numeral／number_in_text／
--     date_in_text／evidence_delete_bypass／transcription_doubts）沒有任何 authenticated 情境的
--     呼叫者，一併收回。
--   * service_role：**維持 hosted 平台預設（既有與新函式都可執行）**。它是伺服器端信任邊界、本來就
--     繞過 RLS，收回函式 EXECUTE 擋不住任何事，卻會在它做 DML 時撞上欄位 default／generated column
--     ／check 用到的函式（P2c 實測：Edge service client INSERT field_documents 會跑到
--     fn_field_document_owner_org；本機 seed.sql 因此補了 service_role 的函式 EXECUTE）。正式庫
--     227 支本來就全部可執行；本機 CLI 沒給 service_role 預設、只靠 PUBLIC，收回 PUBLIC 後會 42501，
--     所以這裡把既有函式的 service_role EXECUTE 明示對齊（正式庫是 no-op），default 不動。
--   * 全庫 security definer 函式 `search_path` 全部固定；authenticated 可執行的 RPC 都以
--     auth.uid()／成員資格／is_platform_admin 檢查身分（admin_* 十支全部過 is_platform_admin）；
--     `ai_feature_allowed` 不驗成員資格是設計（只回功能開關布林，成員資格由 openAiGate 另證）。
--
-- default privileges 的寫法（實測，見 pgTAP）：
--   * per-schema 的 `ALTER DEFAULT PRIVILEGES … IN SCHEMA public REVOKE` 只能反轉 per-schema 的
--     GRANT（平台給 anon／authenticated／service_role 的就是這種），**拿不掉 PostgreSQL 內建的
--     PUBLIC EXECUTE**（PostgreSQL 文件：per-schema REVOKE 對全域授的權無效）——這正是正式庫與本機
--     的 defacl 都沒列 PUBLIC、卻有 66 支函式帶 PUBLIC EXECUTE 的原因。要拿掉內建 PUBLIC 只能用
--     全域形式 `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON ROUTINES FROM PUBLIC`。
--   * 全域形式會影響 postgres 之後在**任何** schema 建的函式（含 `create extension`）。
--     `extensions` schema 以 per-schema GRANT 補回 PUBLIC，維持 PostgreSQL 內建預設（pgcrypto／
--     uuid-ossp 那類函式本來就該讓 API 角色可用）；pg_temp 的測試 helper 由 pgTAP runner 對
--     該 session 的 temp namespace 補回（scripts/test-pgtap.js），正式環境沒有這條路。
--   * 明示 `for role postgres`：正式庫與本機都是以 postgres 身分建物件（同 H1）。
--
-- 影響：
--   * anon：任何直連表／view／序列／函式一律 42501（PostgREST 對 anon 的請求本來就沒有合法用途）。
--   * authenticated：允許清單內的 68 支照舊；trigger 照常觸發；policy 照常評估。
--   * 新 migration：新表仍自動帶 authenticated 的 DML（基線，migration 內要收窄）；新函式對
--     anon／authenticated／PUBLIC 都**不可執行**（service_role 照平台預設可執行），要給前端／Edge
--     user client 用就 `grant execute … to authenticated`，並把名字加進 pgTAP
--     `anon_and_function_privileges.sql` 的允許清單（fail-closed：忘了 grant 是 42501，不是靜默放行）。
--
-- 資料保留：只改 ACL；不動任何列、欄、索引、policy、trigger。
-- 相容：前端／Edge 不需改動（盤點證明沒有 anon 路徑；authenticated 路徑全部保留）；部署順序無
--       先後要求。
-- 回復：supabase/rollbacks/20260919003000_anon_and_function_execute_privileges.down.sql
--       （依正式庫 2026-09-17／09-19 快照逐表／逐函式還原原本的 ACL 與 default privileges）。
-- pgTAP：supabase/tests/anon_and_function_privileges.sql（全表／全序列／全函式 × anon 迴圈、PUBLIC
--       零殘留、authenticated 允許清單精確相等、default ACL 內容、測試內新建表／序列／函式仍無、
--       trigger 不需 EXECUTE 也會觸發、行為 42501）。

-- ── H2：anon 對 public 所有表（含 view、外部表）與序列的權限，及 default privileges ────────
-- 例外清單：無（盤點見檔頭）。`revoke all` 涵蓋 SELECT／INSERT／UPDATE／DELETE 與 H1 已收的四種。
revoke all privileges on all tables in schema public from public, anon;
revoke all privileges on all sequences in schema public from public, anon;
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon;

-- ── H3：函式 EXECUTE ────────────────────────────────────────────────────────────────
-- 先把 public 所有 routine 對 PUBLIC／anon／authenticated 的 EXECUTE 全部收回（同一交易內），
-- 再逐支明示 authenticated 允許清單。
revoke execute on all routines in schema public from public, anon, authenticated;

-- service_role：既有函式明示對齊 hosted 平台預設（正式庫本來就全部有，no-op；本機補上）；
-- default 維持平台預設（理由見檔頭），本機由 seed.sql 對齊。
grant execute on all routines in schema public to service_role;

-- default privileges：
--   全域：拿掉內建的 PUBLIC EXECUTE（唯一有效的寫法，見檔頭）；
--   public：反轉平台 per-schema 給 anon／authenticated 的 EXECUTE（service_role 保留）；
--   extensions：補回 PUBLIC，維持 PostgreSQL 內建預設。
alter default privileges for role postgres
  revoke execute on routines from public;
alter default privileges for role postgres in schema public
  revoke execute on routines from public, anon, authenticated;
alter default privileges for role postgres in schema extensions
  grant execute on routines to public;

-- authenticated 允許清單（68 支；理由見每行註解，來源見檔頭盤點）。
grant execute on function public.add_member_by_email(p_project uuid, p_email text, p_role text, p_expected_org text) to authenticated; -- 前端 RPC
grant execute on function public.admin_ai_usage_by_feature(p_from timestamp with time zone, p_to timestamp with time zone) to authenticated; -- 前端 RPC
grant execute on function public.admin_ai_usage_by_project(p_from timestamp with time zone, p_to timestamp with time zone) to authenticated; -- 前端 RPC
grant execute on function public.admin_ai_usage_by_user(p_from timestamp with time zone, p_to timestamp with time zone) to authenticated; -- 前端 RPC
grant execute on function public.admin_ai_usage_daily(p_from timestamp with time zone, p_to timestamp with time zone) to authenticated; -- 前端 RPC
grant execute on function public.admin_ai_usage_overview(p_from timestamp with time zone, p_to timestamp with time zone) to authenticated; -- 前端 RPC
grant execute on function public.admin_list_projects_for_ai() to authenticated; -- 前端 RPC
grant execute on function public.admin_override(p uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.admin_set_feature_enabled(p_key text, p_enabled boolean) to authenticated; -- 前端 RPC
grant execute on function public.admin_set_feature_min_plan(p_key text, p_min_plan text) to authenticated; -- 前端 RPC
grant execute on function public.admin_set_project_override(p_project uuid, p_key text, p_enabled boolean) to authenticated; -- 前端 RPC
grant execute on function public.admin_set_project_plan(p_project uuid, p_plan text) to authenticated; -- 前端 RPC
grant execute on function public.ai_feature_allowed(p_project uuid, p_feature text) to authenticated; -- Edge user client RPC（openAiGate／askAiFeature）
grant execute on function public.can_access_contract_package(p_project uuid, p_type text, p_counterparty uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_access_contractor_private(p uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_manage_documents(p uuid) to authenticated; -- Edge user client RPC；RLS／Storage policy
grant execute on function public.can_read_audit_entity(p_entity_type text, p_entity uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_read_contract_package(p_package uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_read_document_version(p_version uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_read_field_document(p_document uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_read_project_document(p_project uuid, p_package uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_read_requirement_provenance(p_run uuid) to authenticated; -- 既有 migration 明示 grant（文件／需求 helper，成員資格由 auth.uid() 限縮）
grant execute on function public.can_read_requirement_row(p_requirement uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_read_requirement_scope(p_run uuid, p_package uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_review_requirement(p uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_upload_contract_package(p_package uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_write(p uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_write_document(p_document uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_write_document_version(p_version uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.can_write_project_document(p_project uuid, p_package uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.create_project(p_name text, p_code text, p_owner text, p_contractor text, p_supervisor text, p_location text, p_start date, p_end date) to authenticated; -- 前端 RPC
grant execute on function public.delete_document(p_document uuid) to authenticated; -- 前端 RPC
grant execute on function public.delete_project(p_id uuid) to authenticated; -- 前端 RPC
grant execute on function public.ensure_project_identity(p uuid) to authenticated; -- 前端 RPC
grant execute on function public.fn_field_document_owner_org(p_doc_type text) to authenticated; -- 欄位 default（field_documents.owner_org，以插入者身分求值）
grant execute on function public.fn_field_document_target_table(p_doc_type text) to authenticated; -- 欄位 default（field_documents.target_table）
grant execute on function public.fn_field_document_template(p_doc_type text) to authenticated; -- P3a 範本 RPC（既有 migration 明示 grant）
grant execute on function public.import_work_items(p_project_id uuid, p_items jsonb) to authenticated; -- 前端 RPC
grant execute on function public.is_platform_admin() to authenticated; -- 前端 RPC；RLS／Storage policy
grant execute on function public.is_project_admin(p uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.is_project_admin_v2(p_project uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.is_project_member(p uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.is_project_member_v2(p_project uuid) to authenticated; -- 既有 migration 明示 grant（三方模型 helper，成員資格由 auth.uid() 限縮）
grant execute on function public.list_project_members(p_project uuid) to authenticated; -- 前端 RPC；Edge user client RPC
grant execute on function public.log_document_access(p_document_version uuid, p_action text) to authenticated; -- 前端 RPC
grant execute on function public.materialize_obligation_periods(p_project uuid) to authenticated; -- P5b 期次物化 RPC（既有 migration 明示 grant）
grant execute on function public.my_org_type() to authenticated; -- Edge user client RPC；RLS／Storage policy
grant execute on function public.my_party() to authenticated; -- RLS／Storage policy
grant execute on function public.my_project_ids() to authenticated; -- RLS／Storage policy
grant execute on function public.my_project_ids_v2() to authenticated; -- RLS／Storage policy
grant execute on function public.my_project_membership(p_project uuid) to authenticated; -- 既有 migration 明示 grant（三方模型 helper）
grant execute on function public.my_project_party_type(p_project uuid) to authenticated; -- 既有 migration 明示 grant（三方模型 helper）
grant execute on function public.my_project_role(p_project uuid) to authenticated; -- 既有 migration 明示 grant（三方模型 helper）
grant execute on function public.obligation_party(r text) to authenticated; -- RLS／Storage policy
grant execute on function public.photo_storage_path_in_use(p_name text) to authenticated; -- RLS／Storage policy
grant execute on function public.portfolio_summary() to authenticated; -- 前端 RPC
grant execute on function public.receive_field_document(p_document_id uuid, p_version_no integer, p_client_request_id text) to authenticated; -- 前端 RPC（P2c 現場紀錄頁）
grant execute on function public.remove_member(p_project uuid, p_user uuid) to authenticated; -- 前端 RPC
grant execute on function public.reset_project_boq(p_project_id uuid) to authenticated; -- 前端 RPC
grant execute on function public.resolve_agent_action(p_id uuid, p_status text) to authenticated; -- 前端 RPC
grant execute on function public.return_field_document(p_document_id uuid, p_version_no integer, p_reason text, p_client_request_id text) to authenticated; -- 前端 RPC（P2c 現場紀錄頁）
grant execute on function public.review_requirement(p_requirement_id uuid, p_decision text) to authenticated; -- 前端 RPC
grant execute on function public.save_field_document_version(p_document_id uuid, p_base_version_no integer, p_content jsonb, p_field_sources jsonb, p_attachments jsonb, p_change_note text) to authenticated; -- 前端 RPC（P2c 現場紀錄頁）
grant execute on function public.shares_project_with(target uuid) to authenticated; -- RLS／Storage policy
grant execute on function public.sign_field_document(p_document_id uuid, p_version_no integer, p_content_hash text, p_intent text) to authenticated; -- 前端 RPC（P2c 現場紀錄頁）
grant execute on function public.storage_path_in_use(p_name text) to authenticated; -- RLS／Storage policy
grant execute on function public.submit_field_document(p_document_id uuid, p_version_no integer, p_to_org text, p_client_request_id text) to authenticated; -- 前端 RPC（P2c 現場紀錄頁）
grant execute on function public.transition_obligation_period(p_period uuid, p_status text, p_evidence_submittal_id uuid, p_evidence_document_id uuid) to authenticated; -- 前端 RPC（P5b 期次狀態轉移）
