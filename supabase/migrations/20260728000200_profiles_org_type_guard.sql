-- ── 修補:profiles.org_type 自我提權 ─────────────────────────────────────────
-- 純加法 migration(不改既有 migration 檔),只重寫 baseline 的 profiles_guard()
-- 函式本體;trigger 綁定與名稱維持不變。
--
-- 【漏洞】
-- profiles 的 RLS 是 `profiles_update_own`(for update using auth.uid() = id),
-- 沒有欄位層級限制;表級 UPDATE 又在 20260712001200 廣域授權給 authenticated。
-- 也就是說,登入者可以寫自己那一列的「任何欄位」,包含 org_type。而 org_type 是
-- 整個伺服器端 RBAC 的根:my_org_type() 直接讀它,can_write() /
-- can_access_contractor_private() 建在它之上,多支 RLS policy 與前端 navConfig
-- 的角色可見性也都依它。一句
--     update profiles set org_type = 'owner' where id = auth.uid();
-- 就能讓廠商自稱機關或監造,是伺服器端 RBAC 的實質繞道。
--
-- 【既有 profiles_guard 為何擋不住】
-- baseline(20260711000000)的 profiles_guard() 只在「使用者目前已加入他人建立
-- 的專案」時才擋。實測有三個破口(對應 supabase/tests/profiles_org_type_guard.sql):
--   1. 尚未加入任何專案時可自由改 —— 先把自己改成 owner,再接受邀請入案,
--      guard 只看變更當下的成員資格,不回溯,等於形同虛設(最主要的攻擊路徑);
--   2. 專案 created_by 為 NULL 時,判斷式 `p.created_by <> old.id` 求值為 NULL,
--      exists() 永遠不成立,guard 直接失效;
--   3. 先退出專案 → 改身分別 → 再加回來,同樣繞過。
--
-- 【修補方式:直接擋死,不再有「自家專案可自由修正」的例外】
-- 原本放寬是為了「單人/自家專案可自己修正身分別」,但實際盤點 src/ 後確認:
-- 全站沒有任何一處寫入 profiles(只有 store/slices/auth.js 的 select 讀取),
-- 註冊後根本沒有任何 UI 能改 org_type,這個放寬只剩破口、沒有使用者。
--
-- 【正當的變更管道(刻意只留這三條)】
--   1. 註冊當下 —— handle_new_user() 從 raw_user_meta_data 帶入。那是 auth.users
--      的 INSERT trigger,情境中 auth.uid() 為 null,由下面第一個條件放行;
--      (註冊當下自選身分是合理的,真正的把關在「入案要被邀請」那一層。)
--   2. service role / migration / SQL console —— 同樣 auth.uid() 為 null,放行。
--      這是營運上改組織別的正規路徑;
--   3. 平台管理員 —— is_platform_admin()(20260728000000 批 A)。注意 RLS 的
--      profiles_update_own 仍限制他只能寫「自己那一列」,要改別人的組織別依然
--      得走 service role;這裡放行是為了不讓平台管理員被自己的 guard 鎖死。
-- 未來若要開放使用者自助改組織別,不可放寬這支 trigger 或 policy,而應新增一支
-- security definer RPC(在 RPC 內做審核/通知/留痕),維持「RLS 管誰能碰這列,
-- trigger 管誰能做這種欄位變更」的既有分工。
--
-- 【與 profiles_guard_platform_admin 的分工】
-- 同一張表上另有批 A 的 profiles_guard_platform_admin(BEFORE UPDATE),專責
-- is_platform_admin 欄位。兩支 trigger 各自守不同欄位、互不重疊,語意不會打架,
-- 因此刻意不合併,也不動批 A 那一支——org_type 的語意本來就住在 profiles_guard,
-- 擴充它才是對的位置。
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 無 JWT 情境(handle_new_user / service role / migration / SQL console)一律放行
  if auth.uid() is null then
    return new;
  end if;

  if new.org_type is distinct from old.org_type
     and not public.is_platform_admin() then
    raise exception '不可自行變更組織別(org_type),請聯絡平台管理者';
  end if;

  return new;
end; $$;

-- trigger 函式不需要任何人「直接」呼叫(直接呼叫本來就會被 postgres 拒絕),
-- 收乾淨表級以外的執行權,與批 A 對 is_platform_admin() 的處理一致。
-- 註:trigger 觸發不檢查 EXECUTE 權限(只在 CREATE TRIGGER 當下檢查),
-- 因此 revoke 不影響既有 profiles_guard trigger 正常運作。
revoke all on function public.profiles_guard() from public, anon, authenticated;
