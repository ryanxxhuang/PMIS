-- B5:demo_requests 表級權限收乾淨(縱深防禦第二層)。
--
-- 為什麼:20260824123253 建表時只做「RLS 啟用 + 零 policy」,靠 RLS fail-closed 擋 API
-- 角色;但基線 20260712001200 的 `alter default privileges` 讓這張表在建表當下就自動
-- 帶著 authenticated 的 select/insert/update/delete(anon 也帶著 references/trigger/
-- truncate;TRUNCATE 不受 RLS 約束)。這張表存的是行銷站 Demo 申請的個資(姓名/
-- Email/電話/IP/User-Agent):只靠一層 RLS,日後任何人誤加一條寬鬆 policy、或 RLS 被
-- 關掉,全部申請人個資就對所有登入者敞開。platform_admin_bootstrap(20260728000000)
-- 同樣零 policy 卻有明確 revoke——這裡補齊到一致。
--
-- 寫入路徑查核(2026-09-11):repo 內 src/ 與 supabase/functions/ 對此表零引用;唯一
-- 寫入者是行銷站(PMIS.marketing,src/pages/demo.astro)POST 到正式庫的 Edge Function
-- `demo-request`(該 function 未收進本 repo,與此表同樣是當時直接套到正式庫),行銷站
-- config.ts 註明「寫入只走 function 的 service role」;且此表零 policy,anon/authenticated
-- 直連本來就寫不進去,可反證 function 必然走 service role。service_role 不在 revoke
-- 名單,寫入路徑不受影響;anon/authenticated 沒有任何現行讀寫路徑,收權不打斷功能。
--
-- 資料保留:不動任何資料列。相容:無 API 角色讀寫路徑,無相容問題。
-- 回復:supabase/rollbacks/20260911100000_demo_requests_revoke_grants.down.sql。
revoke all on public.demo_requests from public, anon, authenticated;

-- identity 欄位的序列同樣被 default privileges 授了 anon/authenticated 的 UPDATE
-- (nextval),一併收回。identity 欄位的 nextval 由 PostgreSQL 內部呼叫、不檢查序列
-- 權限,service role 插入不需要序列權限(且 service_role 仍保有 rwU)。序列名用
-- pg_get_serial_sequence 反查而不寫死,避免正式庫命名有出入時 migration 半途失敗。
do $$
declare seq text := pg_get_serial_sequence('public.demo_requests', 'id');
begin
  if seq is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated', seq);
  end if;
end $$;
