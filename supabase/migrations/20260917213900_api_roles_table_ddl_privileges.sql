-- H1（D-026 瘦身續接，P1b 發現補列）：收回 API 角色對 public 所有表的
-- TRUNCATE／REFERENCES／TRIGGER／MAINTAIN，並修正 default privileges，讓日後新表不再自動帶。
--
-- 為什麼：RLS 只約束 SELECT／INSERT／UPDATE／DELETE，TRUNCATE 不受 RLS 管、也不觸發
-- 列級 guard trigger（P2a／P2d 的不可變保證、P1b 的 cost_items 退場都是列級 guard＋DML grant）。
-- PostgREST 雖不會發 TRUNCATE／DDL，但任何以呼叫者身分執行動態 SQL 的函式或未來路徑都碰得到；
-- 表級 ACL 是這條路的最後一道門，不能開著。REFERENCES／TRIGGER／MAINTAIN 同屬 DDL／維護類
-- 權限（建 FK、掛 trigger、VACUUM／REINDEX／CLUSTER／LOCK TABLE），只有表 owner（postgres）
-- 做 migration 時需要；anon／authenticated／service_role 都只透過 PostgREST 做 DML。
--
-- 查證（2026-09-17，正式庫唯讀 + 本機從零建庫）：
--   * 正式庫 57 個 public 關聯全部由 postgres 擁有；anon／authenticated 各在 50 個上有
--     TRUNCATE／REFERENCES／TRIGGER（唯一例外是既有 migration 已 `revoke all` 的 7 表），
--     service_role 57／57 全有；來源是 pg_default_acl 中 postgres 對 public 的
--     `{anon=arwdDxtm,authenticated=arwdDxtm,service_role=arwdDxtm}`（Supabase 平台預設）。
--   * 本機 CLI secure-by-default 只拿掉 anon 的 arwd，default acl 仍是 `anon=Dxtm`、
--     authenticated／service_role `arwdDxtm`（後兩者來自基線 20260712001200 與 seed.sql）。
--   * 事件觸發器全部由 supabase_admin 擁有，postgres 在正式庫非 superuser，不能加 event
--     trigger；但 default privileges 的 defaclrole 就是 postgres，migration 角色可直接修。
--   * repo 內 Edge／前端／腳本／測試零 TRUNCATE；FK 由 owner 建，trigger 由 migration 建；
--     沒有任何合法功能依賴這四種權限。三個 API 角色皆 NOLOGIN，只能經 authenticator 切換。
--
-- service_role 也一併收回（不是只收 anon／authenticated）：
--   (1) 它只經 PostgREST／Edge service client 做 DML，PostgREST 不發 TRUNCATE；
--   (2) 列級 guard 對 service 路徑一體適用是已文件化的不可變邊界（field-documents-lifecycle、
--       audit-events），TRUNCATE 是唯一能跳過列級 guard 的 DML 類操作，留著等於邊界有洞；
--   (3) 資料修復要清表是 owner 的事（SQL Editor 以 postgres 執行），不受影響。
--   service_role 的 SELECT／INSERT／UPDATE／DELETE 全部保留（Edge 與修復路徑不變）。
--
-- default privileges：明示 `for role postgres`——正式庫由 CLI 以 cli_login_postgres 登入後以
-- postgres 身分建表，本機也是 postgres；寫死角色避免因登入角色不同而修到別的 defacl。
-- 基線 20260712001200 給 authenticated 的 SELECT／INSERT／UPDATE／DELETE default 不動
--（新表仍要在 migration 內收窄 DML，見 DEVELOPMENT.md §5）；本支只拿掉四種 DDL／維護類。
-- 這裡不用 `if exists` 迴圈：`on all tables in schema public` 涵蓋表、view、外部表；非
-- postgres 擁有的物件（正式庫沒有）只會得到 WARNING，不會中斷。
--
-- 資料保留：只改 ACL；不動任何列、欄、索引、policy、trigger。
-- 相容：舊前端／Edge 不受影響（沒有路徑使用這四種權限）；部署順序無先後要求。
-- 回復：supabase/rollbacks/20260917213900_api_roles_table_ddl_privileges.down.sql。
-- pgTAP：supabase/tests/api_roles_table_privileges.sql（全表迴圈＋測試內新建表證明 default 生效）。
-- 本機 seed.sql 同步改為只給 service_role DML（原本 `grant all` 會在 seed 階段把四種權限加回來）。

revoke truncate, references, trigger, maintain on all tables in schema public
  from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables
  from public, anon, authenticated, service_role;
