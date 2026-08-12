-- 邀請時確認三方身分(pgTAP)——W4-3/D-009。
-- 對應 migration 20260812000400_invite_org_confirm.sql。
-- 核心主張:邀請方宣告的受邀方身分與被邀帳號註冊身分不符時,伺服器拒絕入案;
-- 未帶宣告(null)維持舊行為相容;舊 3 參數 overload 必須移除(PostgREST 300)。
-- 執行:本地 supabase(colima)+容器內 psql;整份交易內執行並 rollback。
begin;

select plan(11);

-- ── 結構 ─────────────────────────────────────────────────────────────────────
select has_function('public', 'add_member_by_email', array['uuid','text','text','text'], '4 參數版存在');
select hasnt_function('public', 'add_member_by_email', array['uuid','text','text'], '舊 3 參數 overload 已移除(避免 PostgREST ambiguous)');

-- ── 測試資料 ─────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('cc000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-creator@example.test', '', now(), '{}',
   '{"full_name":"Creator","org_type":"contractor"}', now(), now()),
  ('cc000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-sup@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('cc000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-con@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by)
values ('cc100000-0000-0000-0000-000000000001', '邀請確認測試案', '機關', '廠商', '監造',
        'cc000000-0000-0000-0000-000000000001');
alter table public.projects enable trigger on_project_created;
insert into public.project_members (project_id, user_id, role) values
  ('cc100000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'admin');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $fn$;

-- ── 宣告身分相符 → 入案 ──────────────────────────────────────────────────────
select pg_temp.become('cc000000-0000-0000-0000-000000000001');
select is(
  public.add_member_by_email('cc100000-0000-0000-0000-000000000001', 'inv-sup@example.test', 'member', 'supervisor'),
  'ok', '宣告監造+對方註冊監造 → 入案');
select is((select count(*)::int from public.project_members
  where project_id = 'cc100000-0000-0000-0000-000000000001'
    and user_id = 'cc000000-0000-0000-0000-000000000002'), 1, '監造成員已加入');

-- ── 宣告身分不符 → 拒絕且不入案(驗收核心) ───────────────────────────────────
select throws_ok($$ select public.add_member_by_email('cc100000-0000-0000-0000-000000000001',
    'inv-con@example.test', 'member', 'supervisor') $$,
  'P0001',
  '身分不符:該帳號的註冊身分是「施工廠商」,不是你要邀請的「監造單位」。請對方確認註冊身分無誤,或依其實際身分重新邀請。',
  '想邀監造但對方註冊成廠商 → 明確錯誤');
select is((select count(*)::int from public.project_members
  where project_id = 'cc100000-0000-0000-0000-000000000001'
    and user_id = 'cc000000-0000-0000-0000-000000000003'), 0, '錯配未入案');

-- ── 相容與參數驗證 ───────────────────────────────────────────────────────────
select is(
  public.add_member_by_email('cc100000-0000-0000-0000-000000000001', 'inv-con@example.test'),
  'ok', '未帶宣告身分(null)維持舊行為(相容既有呼叫端;前端一律帶值)');
select is(
  public.add_member_by_email('cc100000-0000-0000-0000-000000000001', 'no-such@example.test', 'member', 'supervisor'),
  'not_found', '查無帳號回 not_found(不因宣告身分改變)');
select throws_ok($$ select public.add_member_by_email('cc100000-0000-0000-0000-000000000001',
    'inv-sup@example.test', 'member', 'boss') $$,
  'P0001', '無效的受邀方身分:boss', '宣告值域外身分被拒');

-- ── 權限 ─────────────────────────────────────────────────────────────────────
select pg_temp.become('cc000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.add_member_by_email('cc100000-0000-0000-0000-000000000001',
    'inv-con@example.test', 'member', 'contractor') $$,
  'P0001', '只有專案建立者可以管理成員', '非建立者不可邀請');
select pg_temp.become(null);
select throws_ok($$ select public.add_member_by_email('cc100000-0000-0000-0000-000000000001',
    'inv-con@example.test', 'member', 'contractor') $$,
  'P0001', 'not authenticated', '未登入不可邀請');

select * from finish();
rollback;
