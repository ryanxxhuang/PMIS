-- ── authenticated 表級權限基線 ───────────────────────────────────────────────
-- 本專案的存取模型:RLS policy + guard trigger 控權;表級 GRANT 是前提。
-- 舊 Supabase bootstrap 會自動把 public 表授權給 authenticated,正式站因此一直
-- 可用;新版 CLI/新專案改為 secure-by-default(不再自動授權),導致本地
-- `supabase db reset` 後,凡是真正 `set role authenticated` 的 pgTAP 套件全數
-- permission denied。把前提明寫成 migration:正式站上是冪等 no-op,本地 reset
-- 後與正式站一致。
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- append-only 表:上面的廣域 grant 之後,重申既有 revoke(migration 順序保證晚於原宣告)。
--  * audit_events(20260712000500):僅 trigger 可寫
--  * document_ingestion_runs(20260712000600):僅 service 路徑可寫
revoke insert, update, delete on public.audit_events from public, anon, authenticated;
revoke insert, update, delete on public.document_ingestion_runs from public, anon, authenticated;
