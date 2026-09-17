-- 本機 staging 環境對齊(不是正式資料、也不是 migration):
-- hosted Supabase 的 service_role 對 public schema 一律有完整表級權限(平台預設),
-- Edge Functions 的 service client 與其觸發的 trigger 都依賴這件事;新版 CLI 的
-- 本機 stack secure-by-default 什麼都沒給——導致 W6-4 live 驗收在寫 ingestion run
-- /requirements 時 permission denied(逐表補會被 trigger 的間接查詢打地鼠,
-- 2026-08-15 實測 document_versions 就是這樣漏掉的)。
-- 這裡把本機 service_role 對齊到 hosted 的平台預設;產品的安全邊界仍在
-- RLS/RPC/guard trigger(service_role 本來就是伺服器端信任邊界內的角色)。
-- seed.sql 只在 `supabase start`/`supabase db reset` 執行,永遠不進正式部署。
-- 表只給 DML(select/insert/update/delete):H1(20260917213900)已把 TRUNCATE/REFERENCES/
-- TRIGGER/MAINTAIN 從三個 API 角色與 default privileges 收回,hosted 的 service_role 也只剩
-- DML;seed 在 migration 之後執行,若這裡仍 `grant all` 會把四種權限加回來、本機與正式不一致。
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
-- 函式也要對齊(P2c 實測):hosted 的 postgres 角色 default privileges 對 public 新函式一律
-- `grant execute to anon, authenticated, service_role`,所以 migration 寫 `revoke ... from public, anon`
-- 後 hosted 的 service_role 仍可執行(例如 P2a 的 fn_field_document_owner_org——field_documents 的
-- generated column 用它,Edge service client INSERT 文件時會跑到);本機的 postgres default ACL 只有
-- postgres 自己,revoke 掉 PUBLIC 後 service_role 就 42501(2026-09-17 本機 Edge 起稿實測)。
-- 只補 service_role(Edge 服務端信任邊界內);anon／authenticated 的執行權由各 migration 明示
-- grant／revoke 管,不在 seed 放寬。
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant execute on functions to service_role;

