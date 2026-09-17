-- P1b（D-026 §4／§5）：成本／毛利／分包記帳退出新作業——由資料庫收回 cost_items 的寫入。
--
-- 為什麼在 DB 做：退場不能只拿掉前端按鈕（直接 REST、舊客戶端、Agent 都還能寫）。
-- 兩層同時收：(1) 表級 GRANT 收回 anon／authenticated 的 INSERT／UPDATE／DELETE，
-- PostgREST 直接回 42501；(2) RLS 原本一條 `for all` policy（含 with check）改成只有
-- SELECT policy——日後即使有人再下廣域 grant（如 20260712001200 的基線寫法），RLS 仍擋寫入，
-- 不靠單一機制。歷史讀取條件一字不改：仍是 can_access_contractor_private（廠商成員或專案
-- 管理者可讀；監造／機關讀不到廠商成本），前端 /cost 只剩唯讀查閱與 CSV 匯出。
--
-- 資料保留：不刪表、不刪任何列、不動索引；正式庫 11 列／4 案照舊可查。
-- 相容：前端 ledger slice 同一 PR 移除 createCostItem／updateCostItem／deleteCostItem，
-- 沒有任何程式路徑仍嘗試寫入（Edge 與 Agent 工具本來就不碰 cost_items）。
-- service_role 仍可寫（bypass RLS＋原有 grant），供資料修復；一般帳號沒有任何寫入路徑。
-- 回復：supabase/rollbacks/20260917210000_cost_items_retire.down.sql（重授權＋回復 for all policy）。
-- pgTAP：supabase/tests/cost_items_retired.sql。

revoke insert, update, delete on public.cost_items from public, anon, authenticated;

drop policy if exists "cost_items_contractor_only" on public.cost_items;
create policy "cost_items_contractor_read" on public.cost_items for select to authenticated
  using (public.can_access_contractor_private(project_id));
