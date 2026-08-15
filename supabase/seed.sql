-- 本機 staging 環境對齊(不是正式資料、也不是 migration):
-- hosted Supabase 的 service_role 對 public schema 一律有完整表級權限(平台預設),
-- Edge Functions 的 service client 與其觸發的 trigger 都依賴這件事;新版 CLI 的
-- 本機 stack secure-by-default 什麼都沒給——導致 W6-4 live 驗收在寫 ingestion run
-- /requirements 時 permission denied(逐表補會被 trigger 的間接查詢打地鼠,
-- 2026-08-15 實測 document_versions 就是這樣漏掉的)。
-- 這裡把本機 service_role 對齊到 hosted 的平台預設;產品的安全邊界仍在
-- RLS/RPC/guard trigger(service_role 本來就是伺服器端信任邊界內的角色)。
-- seed.sql 只在 `supabase start`/`supabase db reset` 執行,永遠不進正式部署。
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
