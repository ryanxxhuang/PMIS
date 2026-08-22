-- ── 體檢 P1[D]:profiles 跨租戶可讀收斂 ─────────────────────────────────────
-- 問題:baseline 的 profiles_select_authenticated 是 using (true)——全平台任何
-- 登入者都能枚舉所有人的姓名/公司/組織別(不同機關/廠商/監造互相可見,違反
-- 個資最小化),且 is_platform_admin 欄位跟著整列外洩,管理員名單可被枚舉成
-- 釣魚目標。
-- 收斂原則(逐一盤點過所有讀取路徑,確認以下三類即足夠):
--   1. 自己的 profile(登入載入 store/slices/auth.js 只讀自己);
--   2. 經 project_members 共案的成員(成員清單走 list_project_members 這支
--      security definer RPC,本不依賴直讀;放行共案列是為了未來 PostgREST
--      embed 與除錯不必再開洞);
--   3. 平台管理員(營運後台;admin RPC 本身已是 security definer + 閘門)。
-- 其餘既有讀取(邀請對照 email、trigger 讀建立者 org_type、send-reminders、
-- admin 用量 RPC)全部走 security definer 或 service role,不受此 policy 影響。

-- 共案判定 helper。security definer:policy 內查 project_members 不能觸發
-- project_members 自身的 RLS(遞迴/放大),跟 my_project_ids() 同一模式;
-- stable:同一句查詢內可快取。
create or replace function public.shares_project_with(target uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.project_members them
    where them.user_id = target
      and them.project_id in (select public.my_project_ids())
  );
$$;
revoke all on function public.shares_project_with(uuid) from public, anon;
grant execute on function public.shares_project_with(uuid) to authenticated, service_role;

-- select policy 收斂:自己 + 共案成員 + 平台管理員。
-- is_platform_admin() 是 security definer(批 A),在 profiles 自己的 policy 裡
-- 呼叫不會遞迴。
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_select_scoped" on public.profiles;
create policy "profiles_select_scoped" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_platform_admin()
    or public.shares_project_with(id)
  );

-- is_platform_admin 欄位一併收掉(縱深防禦):就算是共案成員,也不該看得到
-- 對方是不是平台管理員——名單本身就是釣魚攻擊面。前端判定早已走
-- is_platform_admin() RPC(store/slices/admin.js),不依賴直讀欄位。
-- PostgreSQL 沒有「表級 grant 挖掉單欄」的語法,只能收回表級 SELECT 再逐欄
-- 授回;副作用是 authenticated 對 profiles 下 select * 會 42501,前端唯一一處
-- (store/slices/auth.js 讀自己的 profile)已同步改為明確欄位清單。
-- UPDATE/INSERT/DELETE 的表級授權不動(org_type / is_platform_admin 由既有
-- 兩支 guard trigger 各守一欄,profiles_org_type_guard 測試釘住這個前提)。
revoke select on public.profiles from public, anon, authenticated;
grant select (id, full_name, company, org_type, role, created_at)
  on public.profiles to authenticated;
