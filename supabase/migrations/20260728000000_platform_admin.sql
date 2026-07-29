-- ── 批 A(AI 平台化):平台管理員(超級帳號)─────────────────────────────────
-- 為什麼要有這個角色:AI 用量(token/成本)是跨租戶資料、功能開關與方案是
-- 平台級設定,不能掛在任何專案角色(org_type / project_role)底下——那些都是
-- 「單一專案內」的權限模型。平台管理員是產品營運者本人,用來看全平台用量
-- 儀表板、開關 AI 功能、調整專案方案(RPC 見 20260728000100_ai_platform.sql)。
-- 純加法 migration:profiles 加一欄 + 一個 guard trigger + bootstrap 名單表;
-- handle_new_user 是唯一改寫的既有函式,且只加 is_platform_admin 這一段。

-- ── profiles.is_platform_admin ──────────────────────────────────────────────
alter table public.profiles
  add column if not exists is_platform_admin boolean not null default false;

-- 平台管理員判定(RLS policy / admin RPC 共用的窄門判定)。
-- security definer:policy 內呼叫時不觸發 profiles 自身 policy,避免遞迴;
-- stable + 無參數:planner 以 initplan 快取一次(同 my_org_type 慣例)。
create or replace function public.is_platform_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(
    (select is_platform_admin from public.profiles where id = auth.uid()),
    false
  );
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- ── 自我升權防護(關鍵)───────────────────────────────────────────────────────
-- 既有政策 profiles_update_own 允許使用者 update 自己的整列 profile,而表級
-- UPDATE 權限是整表授權(20260712001200 的基線 grant)——也就是說,沒有這個
-- trigger,任何登入使用者都能把自己的 is_platform_admin 改成 true,直接拿到
-- 全平台用量與開關權。RLS 管「誰能碰這列」,這裡照專案慣例用 trigger 管
-- 「誰能做這種欄位變更」。
-- 放行條件(兩種合法路徑):
--   * auth.uid() is null —— service role / migration / SQL console(無 JWT 情境),
--     這是指派平台管理員的正規路徑;
--   * 既有平台管理員 —— 允許管理員互相指派/卸任(注意:卸任自己是單向門,
--     卸下後就不能再把自己加回來)。
create or replace function public.profiles_guard_platform_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin
     and auth.uid() is not null
     and not public.is_platform_admin() then
    raise exception '不可自行變更平台管理員身分';
  end if;
  return new;
end; $$;

drop trigger if exists profiles_guard_platform_admin on public.profiles;
create trigger profiles_guard_platform_admin
  before update on public.profiles
  for each row execute function public.profiles_guard_platform_admin();

-- ── 超級帳號 bootstrap 名單 ─────────────────────────────────────────────────
-- 為什麼要一張名單表而不是直接 update:名單內的 email 可能「之後才註冊」——
-- handle_new_user 建 profile 時查這張表,晚註冊也會自動成為平台管理員,
-- 不需要人工補 SQL。
-- 存取模型:enable RLS 且刻意不建任何 policy + revoke 全部表級權限——
-- 只有 security definer 函式(handle_new_user)與 service role 讀得到;
-- 對 authenticated 而言這張表等於不存在(平台管理員名單本身不該被枚舉)。
create table if not exists public.platform_admin_bootstrap (
  email      text primary key,
  created_at timestamptz not null default now()
);
alter table public.platform_admin_bootstrap enable row level security;
-- 基線 migration(20260712001200)的 alter default privileges 會讓新表自動帶
-- select/insert/update/delete 授權,必須明確收回(select 也收:無 policy 的
-- RLS 已擋列,但表級權限一併收乾淨才是零信任)。
revoke all on public.platform_admin_bootstrap from public, anon, authenticated;

-- 名單一律小寫存放,比對時兩邊 lower() 對齊(email 大小寫不敏感)
insert into public.platform_admin_bootstrap (email)
values ('ryanxhuang1212@gmail.com')
on conflict (email) do nothing;

-- 已註冊的名單使用者:直接升級(migration 內 auth.uid() 為 null,guard 放行)
update public.profiles p
   set is_platform_admin = true
  from auth.users u
  join public.platform_admin_bootstrap b on lower(u.email) = lower(b.email)
 where p.id = u.id
   and not p.is_platform_admin;

-- ── handle_new_user:註冊時查 bootstrap 名單 ────────────────────────────────
-- 與 baseline(20260711000000)版本唯一差異:多帶 is_platform_admin 欄位,
-- 其值由 bootstrap 名單決定。
-- ⚠ 安全關鍵:is_platform_admin 絕對不可從 raw_user_meta_data 取值——
-- metadata 是註冊者自己送上來的(使用者可控),從那裡取值等於開放任何人
-- 註冊時自封平台管理員。唯一來源是 server 側的 bootstrap 名單表。
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, company, org_type, role, is_platform_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'company', ''),
    coalesce(new.raw_user_meta_data->>'org_type', 'contractor'),
    coalesce(new.raw_user_meta_data->>'role', ''),
    exists (
      select 1 from public.platform_admin_bootstrap b
      where lower(b.email) = lower(new.email)
    )
  ) on conflict (id) do nothing;
  return new;
end; $$;
