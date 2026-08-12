-- agent_actions pgTAP 套件:AI 草稿收件匣(批 1 agent runtime)。
-- 涵蓋:結構與 check 約束、表級權限(authenticated 只可讀不可寫)、
-- RLS 隔離(草稿僅本人可見:同案他人與跨案皆不可見)、
-- resolve_agent_action 狀態機(本人限定/終態不可逆/非法值擋下)、審計留痕。
-- 執行:本地 supabase(colima)+容器內 psql,整份交易內執行並 rollback。
-- 對應 migrations 20260725000000_agent_actions.sql、20260812000100_three_party_agent_roles.sql。
begin;

select plan(32);

-- login helper(同 p0_05 慣例:兩種 claim 寫法都設,涵蓋不同 auth.uid() 實作)
create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

select pg_temp.become(null);

-- ── 結構與權限契約 ──────────────────────────────────────────────────────────
select has_table('public', 'agent_actions', 'agent_actions 草稿收件匣存在');
select has_column('public', 'agent_actions', 'agent_role', 'agent 角色欄位存在');
select has_column('public', 'agent_actions', 'kind', '草稿種類欄位存在');
select has_column('public', 'agent_actions', 'summary', '草稿摘要欄位存在');
select has_column('public', 'agent_actions', 'status', '狀態欄位存在');
select has_column('public', 'agent_actions', 'resolved_at', '處理時間欄位存在');
select has_function('public', 'resolve_agent_action', array['uuid','text'],
  '狀態轉移 RPC 存在');

-- authenticated 對草稿收件匣只可讀不可寫(寫入僅 service role;轉移僅走 RPC)
select is(has_table_privilege('authenticated', 'public.agent_actions', 'INSERT'), false,
  'authenticated 無 INSERT 表級權限');
select is(has_table_privilege('authenticated', 'public.agent_actions', 'UPDATE'), false,
  'authenticated 無 UPDATE 表級權限');
select is(has_table_privilege('authenticated', 'public.agent_actions', 'DELETE'), false,
  'authenticated 無 DELETE 表級權限');
select is(has_table_privilege('authenticated', 'public.agent_actions', 'SELECT'), true,
  'authenticated 有 SELECT 表級權限');

-- ── 固定資料:確定性 UUID 使用者與兩個專案 ──────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('aa100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'field@agent.test', '', now(), '{}',
   '{"full_name":"Field Engineer","org_type":"contractor"}', now(), now()),
  ('aa100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'peer@agent.test', '', now(), '{}',
   '{"full_name":"Peer Member","org_type":"contractor"}', now(), now()),
  ('aa100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'other@agent.test', '', now(), '{}',
   '{"full_name":"Project B Member","org_type":"supervisor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name) values
  ('aa200000-0000-0000-0000-00000000000a', 'Agent 測試案 A'),
  ('aa200000-0000-0000-0000-00000000000b', 'Agent 測試案 B');
alter table public.projects enable trigger on_project_created;

-- RLS 熱路徑 my_project_ids() 讀 project_members(批 3 未恢復,見 p0_05 套件註記)。
-- 本套件聚焦 agent_actions,actor 快照解析已由 p0_05 覆蓋,故不再播種 parties/memberships。
insert into public.project_members (project_id, user_id, role) values
  ('aa200000-0000-0000-0000-00000000000a', 'aa100000-0000-0000-0000-000000000001', 'member'),
  ('aa200000-0000-0000-0000-00000000000a', 'aa100000-0000-0000-0000-000000000002', 'member'),
  ('aa200000-0000-0000-0000-00000000000b', 'aa100000-0000-0000-0000-000000000003', 'member');

-- 草稿種子(superuser 直插=模擬 service role 寫入路徑;authenticated 已被 revoke)
insert into public.agent_actions (id, project_id, actor_user, agent_role, kind, summary) values
  ('aa400000-0000-0000-0000-000000000001', 'aa200000-0000-0000-0000-00000000000a',
   'aa100000-0000-0000-0000-000000000001', 'field', 'draft_daily_log', '0724 施工日誌草稿'),
  ('aa400000-0000-0000-0000-000000000002', 'aa200000-0000-0000-0000-00000000000a',
   'aa100000-0000-0000-0000-000000000001', 'field', 'answer', '契約疑義問答草稿'),
  ('aa400000-0000-0000-0000-000000000003', 'aa200000-0000-0000-0000-00000000000a',
   'aa100000-0000-0000-0000-000000000001', 'qc', 'draft_inspection', '查驗申請草稿'),
  ('aa400000-0000-0000-0000-00000000000b', 'aa200000-0000-0000-0000-00000000000b',
   'aa100000-0000-0000-0000-000000000003', 'supervisor', 'answer', 'B 案問答草稿');

select results_eq($$
  select distinct agent_role from public.agent_actions order by agent_role
$$, $$ values ('contractor'::text), ('supervisor'::text) $$,
  '舊版 field/qc 寫入自動正規化為 contractor，資料只保留三方角色');

-- check 約束有效(FK 皆已就緒,非法值必須被 check 擋下)
select throws_ok($$
  insert into public.agent_actions (project_id, actor_user, agent_role, kind, summary, status)
  values ('aa200000-0000-0000-0000-00000000000a', 'aa100000-0000-0000-0000-000000000001',
          'field', 'answer', '非法狀態', 'bogus')
$$, '23514', null, 'status check 擋下非法狀態值');
select throws_ok($$
  insert into public.agent_actions (project_id, actor_user, agent_role, kind, summary)
  values ('aa200000-0000-0000-0000-00000000000a', 'aa100000-0000-0000-0000-000000000001',
          'boss', 'answer', '非法角色')
$$, '23514', null, 'agent_role check 擋下非法角色值');

-- 清掉 fixture 產生的系統稽核事件,後面的審計斷言才是確定性計數
alter table public.audit_events disable trigger audit_events_immutable;
delete from public.audit_events;
alter table public.audit_events enable trigger audit_events_immutable;

-- ── RLS 隔離(草稿僅本人可見)+ 直接寫入不可行 ─────────────────────────────
select pg_temp.become('aa100000-0000-0000-0000-000000000001');
set local role authenticated;

select is((select count(*)::integer from public.agent_actions
  where project_id = 'aa200000-0000-0000-0000-00000000000a'), 3,
  '本人看得到自己在 A 案的 AI 草稿');
select is((select count(*)::integer from public.agent_actions
  where project_id = 'aa200000-0000-0000-0000-00000000000b'), 0,
  'A 案成員看不到 B 案的 AI 草稿');

-- 新語意:草稿是尚未送出的私人工作狀態——同專案的另一個成員也看不到
-- (與 resolve_agent_action 的本人限定一致,不會出現「看得到卻無權處理」)
reset role;
select pg_temp.become('aa100000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*)::integer from public.agent_actions
  where project_id = 'aa200000-0000-0000-0000-00000000000a'), 0,
  '同案他人看不到別人的 AI 草稿');
reset role;
select pg_temp.become('aa100000-0000-0000-0000-000000000001');
set local role authenticated;

select throws_ok($$
  insert into public.agent_actions (project_id, actor_user, agent_role, kind, summary)
  values ('aa200000-0000-0000-0000-00000000000a', 'aa100000-0000-0000-0000-000000000001',
          'field', 'answer', '偽造草稿')
$$, '42501', null, 'authenticated 不可直接插入 AI 草稿');
select throws_ok($$
  update public.agent_actions set status = 'accepted'
  where id = 'aa400000-0000-0000-0000-000000000001'
$$, '42501', null, 'authenticated 不可繞過 RPC 直接改狀態');
select throws_ok($$
  delete from public.agent_actions
  where id = 'aa400000-0000-0000-0000-000000000001'
$$, '42501', null, 'authenticated 不可刪除 AI 草稿');

-- ── resolve_agent_action:本人 + pending + 合法狀態 → 成功 ──────────────────
select results_eq($$
  select r.status, r.resolved_by, (r.resolved_at is not null)
  from public.resolve_agent_action('aa400000-0000-0000-0000-000000000001', 'accepted') r
$$, $$ values ('accepted'::text, 'aa100000-0000-0000-0000-000000000001'::uuid, true) $$,
  '本人處理 pending 草稿成功且回傳更新後的列');

reset role;
select pg_temp.become(null);
select is((select status from public.agent_actions
  where id = 'aa400000-0000-0000-0000-000000000001'), 'accepted',
  '資料表狀態已持久化為 accepted');

-- 審計留痕:resolve 後 audit_events 多一筆對應事件
select is((select count(*)::integer from public.audit_events
  where event_type = 'agent_action_resolved'), 1,
  'resolve 產生一筆 agent_action_resolved 稽核事件');
select results_eq($$
  select entity_type, entity_id, action from public.audit_events
  where event_type = 'agent_action_resolved'
$$, $$ values ('agent_action'::text, 'aa400000-0000-0000-0000-000000000001'::uuid,
  'accepted'::text) $$,
  '稽核事件指向該 AI 草稿並記下處理結果');

-- ── 他人(同案成員)不能替本人處理 ──────────────────────────────────────────
select pg_temp.become('aa100000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$
  select public.resolve_agent_action('aa400000-0000-0000-0000-000000000002', 'accepted')
$$, 'P0001', '無權處理此 AI 草稿', '同案他人不能替本人處理草稿');
reset role;

-- ── 本人:不存在 / 終態 / 非法狀態值皆擋下,其餘合法終態可用 ────────────────
select pg_temp.become('aa100000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$
  select public.resolve_agent_action('aa400000-0000-0000-0000-0000000000ff', 'accepted')
$$, 'P0001', '無權處理此 AI 草稿', '不存在的草稿與無權訊息一致(不洩漏存在性)');
select throws_ok($$
  select public.resolve_agent_action('aa400000-0000-0000-0000-000000000001', 'rejected')
$$, 'P0001', '此 AI 草稿已處理過', '終態不可再改');
select throws_ok($$
  select public.resolve_agent_action('aa400000-0000-0000-0000-000000000002', 'accepted_x')
$$, 'P0001', '不合法的處理狀態,僅接受 accepted/edited/rejected',
  '非法狀態值 accepted_x 擋下');
select throws_ok($$
  select public.resolve_agent_action('aa400000-0000-0000-0000-000000000002', 'pending')
$$, 'P0001', '不合法的處理狀態,僅接受 accepted/edited/rejected',
  '不得把草稿改回 pending');
select is((select status from public.resolve_agent_action(
  'aa400000-0000-0000-0000-000000000002', 'rejected')), 'rejected',
  '本人可 rejected');
select is((select status from public.resolve_agent_action(
  'aa400000-0000-0000-0000-000000000003', 'edited')), 'edited',
  '本人可 edited');
reset role;
select pg_temp.become(null);

-- 三次成功處理 = 三筆稽核事件(失敗嘗試不留痕)
select is((select count(*)::integer from public.audit_events
  where event_type = 'agent_action_resolved'), 3,
  '每次成功處理各留一筆稽核事件');

select * from finish();
rollback;
