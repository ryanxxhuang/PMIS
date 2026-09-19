-- valuation_items 收回直接寫入(P4e 20260920001500)＋核定凍結＋可見範圍(pgTAP)。
-- 估驗明細=本期／累計數量與金額,是請款底稿。P4b 起它必須是「來源分配的投影」,P4e 收回全部直接寫入:
--   authenticated(三角色、專案管理者、非成員)→ 表級 GRANT 已收回 → 42501;RLS 只剩 SELECT policy;
--   service role 與 DBA 直連 → valuation_items_guard 對非重算路徑一律 VQ010(所有寫入者一體適用);
--   RPC(set_valuation_item_cum／sync_valuation_from_confirmations／確認量自動同步)照常,金額由 DB 算;
--   cascade(單一工項刪除、草稿期刪除)照常;已核定期明細連重算路徑也不可改、不可被 cascade 刪。
-- 歷史資料(P4e 之前舊前端直接寫入／歷史遷移的 legacy 明細)以 DBA 邊界重現:交易內開重算旗標、明示 backing='legacy'。
-- 執行方式:npm run test:db(一次性資料庫),整份在交易內執行並 rollback。
begin;

select plan(50);

select has_trigger('public', 'valuation_items', 'valuation_items_guard', '估驗明細 guard 掛上');

-- ── 權限結構:authenticated 只有 SELECT、anon 全無、RLS 只剩讀取 policy ─────────────────
select is(has_table_privilege('authenticated', 'public.valuation_items', 'SELECT'), true, 'authenticated 可讀估驗明細(RLS 限成員)');
select is(has_table_privilege('authenticated', 'public.valuation_items', 'INSERT'), false, 'authenticated 無 INSERT');
select is(has_table_privilege('authenticated', 'public.valuation_items', 'UPDATE'), false, 'authenticated 無 UPDATE');
select is(has_table_privilege('authenticated', 'public.valuation_items', 'DELETE'), false, 'authenticated 無 DELETE');
select is(has_table_privilege('anon', 'public.valuation_items', 'SELECT,INSERT,UPDATE,DELETE'), false, 'anon 沒有任何權限');
select policies_are('public', 'valuation_items', array['valuation_items_select'], 'RLS 只剩 SELECT policy(寫入 policy 已刪)');

-- ── 測試資料 ─────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b5d10000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vi-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('b5d10000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vi-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('b5d10000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vi-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('b5d10000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vi-outsider@example.test', '', now(), '{}',
   '{"full_name":"Outsider (no project)","org_type":"contractor"}', now(), now()),
  ('b5d10000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vi-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by)
values ('b5d20000-0000-0000-0000-00000000000a', '估驗明細封堵測試案', '機關', '廠商', '監造',
        'b5d10000-0000-0000-0000-000000000005');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('b5d20000-0000-0000-0000-00000000000a', 'b5d10000-0000-0000-0000-000000000001', 'member'),
  ('b5d20000-0000-0000-0000-00000000000a', 'b5d10000-0000-0000-0000-000000000002', 'member'),
  ('b5d20000-0000-0000-0000-00000000000a', 'b5d10000-0000-0000-0000-000000000003', 'member'),
  ('b5d20000-0000-0000-0000-00000000000a', 'b5d10000-0000-0000-0000-000000000005', 'admin');

insert into public.work_items (id, project_id, description, unit, quantity, unit_price, is_leaf) values
  ('b5d30000-0000-0000-0000-000000000001', 'b5d20000-0000-0000-0000-00000000000a', '鋼筋', 'kg', 10000, 30, true),
  ('b5d30000-0000-0000-0000-000000000002', 'b5d20000-0000-0000-0000-00000000000a', '混凝土', 'm3', 500, 3000, true),
  ('b5d30000-0000-0000-0000-000000000003', 'b5d20000-0000-0000-0000-00000000000a', '模板', 'm2', 100, 500, true);

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;
-- DBA 邊界:只在這一句開重算旗標(失敗時隨 throws_ok 的子交易一起回滾)
create or replace function pg_temp.internal(p_sql text) returns void language plpgsql as $$
begin
  perform set_config('pmis.cq_internal', '1', true);
  execute p_sql;
  perform set_config('pmis.cq_internal', '', true);
end $$;
-- P4e 之前舊前端直接寫入／歷史遷移的明細(backing='legacy'、無來源)
create or replace function pg_temp.legacy_item(v uuid, w uuid, q numeric) returns void language sql as $$
  select pg_temp.internal(format('insert into public.valuation_items (valuation_id, work_item_id, cum_qty, backing) values (%L, %L, %s, %L)', v, w, q, 'legacy'))
$$;
create or replace function pg_temp.cum(v uuid, w uuid) returns numeric language sql as $$
  select cum_qty from public.valuation_items where valuation_id = v and work_item_id = w $$;

-- 第 1 期:遷移前就核定的歷史期(鋼筋 2000、混凝土 100,legacy;核定檢查點以 DBA 邊界略過,再以 P4b 同一支回填 legacy 來源)
insert into public.valuations (id, project_id, period_no, period_end, status) values
  ('b5d40000-0000-0000-0000-000000000001', 'b5d20000-0000-0000-0000-00000000000a', 1, current_date, '草稿');
select pg_temp.legacy_item('b5d40000-0000-0000-0000-000000000001', 'b5d30000-0000-0000-0000-000000000001', 2000);
select pg_temp.legacy_item('b5d40000-0000-0000-0000-000000000001', 'b5d30000-0000-0000-0000-000000000002', 100);
alter table public.valuations disable trigger valuations_checkpoint_guard;
update public.valuations set status = '已核定' where id = 'b5d40000-0000-0000-0000-000000000001';
alter table public.valuations enable trigger valuations_checkpoint_guard;
select public.fn_cq_backfill_legacy_internal('b5d20000-0000-0000-0000-00000000000a');
-- 第 2 期草稿:鋼筋由監造確認單(A區累計 3000)自動同步 → 前期 2000＋1000;模板一筆 P4e 前留下的 legacy 草稿明細
insert into public.valuations (id, project_id, period_no, period_end, status) values
  ('b5d40000-0000-0000-0000-000000000002', 'b5d20000-0000-0000-0000-00000000000a', 2, (now() at time zone 'Asia/Taipei')::date, '草稿');
select pg_temp.legacy_item('b5d40000-0000-0000-0000-000000000002', 'b5d30000-0000-0000-0000-000000000003', 10);
select pg_temp.become('b5d10000-0000-0000-0000-000000000002');
set local role authenticated;
select public.issue_supervisor_certificate('b5d20000-0000-0000-0000-00000000000a', 'b5d30000-0000-0000-0000-000000000001',
  'A區', 'A區', null, 'kg', 3000, '依查驗紀錄', 'vi-req-1', null);
reset role;
select pg_temp.become(null);

-- ── 可見範圍(RLS 不變) ──────────────────────────────────────────────────────
select pg_temp.become('b5d10000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select count(*)::int from public.valuation_items), 4,
  '機關看得到兩期估驗明細(撥款前要核對數量與金額)');
reset role;
select pg_temp.become('b5d10000-0000-0000-0000-000000000004');
set local role authenticated;
select is((select count(*)::int from public.valuation_items), 0, '非成員看不到任何估驗明細');
reset role;

-- ── 直接寫入矩陣:三角色＋專案管理者(非正式模式)＋非成員 → 42501 ─────────────────────
create or replace function pg_temp.direct_writes_denied(u uuid, who text) returns setof text language plpgsql as $$
begin
  perform pg_temp.become(u);
  set local role authenticated;
  return next throws_ok($q$ insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
    values ('b5d40000-0000-0000-0000-000000000002', 'b5d30000-0000-0000-0000-000000000002', 1) $q$,
    '42501', null, who || ':直接 INSERT 明細 → 42501');
  return next throws_ok($q$ update public.valuation_items set cum_qty = 1
    where valuation_id = 'b5d40000-0000-0000-0000-000000000002' and work_item_id = 'b5d30000-0000-0000-0000-000000000001' $q$,
    '42501', null, who || ':直接 UPDATE 明細 → 42501');
  return next throws_ok($q$ delete from public.valuation_items
    where valuation_id = 'b5d40000-0000-0000-0000-000000000002' and work_item_id = 'b5d30000-0000-0000-0000-000000000001' $q$,
    '42501', null, who || ':直接 DELETE 明細 → 42501');
  reset role;
end $$;
select * from pg_temp.direct_writes_denied('b5d10000-0000-0000-0000-000000000001', '廠商');
select * from pg_temp.direct_writes_denied('b5d10000-0000-0000-0000-000000000002', '監造');
select * from pg_temp.direct_writes_denied('b5d10000-0000-0000-0000-000000000003', '機關');
select * from pg_temp.direct_writes_denied('b5d10000-0000-0000-0000-000000000005', '專案管理者(非正式模式)');
select * from pg_temp.direct_writes_denied('b5d10000-0000-0000-0000-000000000004', '非成員');
select pg_temp.become(null);

-- ── service role(保有平台預設表級 DML、繞過 RLS)與 DBA 直連:guard 一體適用 → VQ010 ─────────
set local role service_role;
select throws_ok($$ insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
  values ('b5d40000-0000-0000-0000-000000000002', 'b5d30000-0000-0000-0000-000000000002', 1) $$,
  'VQ010', null, 'service role:直接 INSERT 明細 → VQ010');
select throws_ok($$ update public.valuation_items set cum_qty = 1
  where valuation_id = 'b5d40000-0000-0000-0000-000000000002' and work_item_id = 'b5d30000-0000-0000-0000-000000000001' $$,
  'VQ010', null, 'service role:直接 UPDATE 明細 → VQ010');
select throws_ok($$ delete from public.valuation_items
  where valuation_id = 'b5d40000-0000-0000-0000-000000000002' and work_item_id = 'b5d30000-0000-0000-0000-000000000001' $$,
  'VQ010', null, 'service role:直接 DELETE 明細 → VQ010');
reset role;
select throws_ok($$ insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
  values ('b5d40000-0000-0000-0000-000000000002', 'b5d30000-0000-0000-0000-000000000002', 1) $$,
  'VQ010', null, 'DBA 直連(未開重算旗標):直接 INSERT → VQ010');
select throws_ok($$ update public.valuation_items set note = '直連補註'
  where valuation_id = 'b5d40000-0000-0000-0000-000000000002' and work_item_id = 'b5d30000-0000-0000-0000-000000000001' $$,
  'VQ010', null, 'DBA 直連:直接 UPDATE(連備註也不行)→ VQ010');
select throws_ok($$ delete from public.valuation_items
  where valuation_id = 'b5d40000-0000-0000-0000-000000000002' and work_item_id = 'b5d30000-0000-0000-0000-000000000001' $$,
  'VQ010', null, 'DBA 直連:直接 DELETE → VQ010');
select is(pg_temp.cum('b5d40000-0000-0000-0000-000000000002', 'b5d30000-0000-0000-0000-000000000001'), 3000::numeric,
  '被拒後第 2 期鋼筋仍是 3000(前期 2000＋確認 1000)');
select is((select count(*)::int from public.valuation_items), 4, '被拒後明細仍是 4 列');

-- ── RPC 路徑照常(金額與百分比由 DB 算) ─────────────────────────────────────────
select pg_temp.become('b5d10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ select public.set_valuation_item_cum('b5d40000-0000-0000-0000-000000000002', 'b5d30000-0000-0000-0000-000000000001', 2500) $$,
  '廠商以 set_valuation_item_cum 把第 2 期鋼筋設為 2500');
select is(pg_temp.cum('b5d40000-0000-0000-0000-000000000002', 'b5d30000-0000-0000-0000-000000000001'), 2500::numeric, '累計 2500');
select is((select amount_cum from public.valuation_items where valuation_id = 'b5d40000-0000-0000-0000-000000000002'
  and work_item_id = 'b5d30000-0000-0000-0000-000000000001'), 75000::numeric, '金額由 DB 算 2500×30');
select lives_ok($$ select public.sync_valuation_from_confirmations('b5d40000-0000-0000-0000-000000000002') $$, '廠商同步確認量');
select is(pg_temp.cum('b5d40000-0000-0000-0000-000000000002', 'b5d30000-0000-0000-0000-000000000001'), 3000::numeric, '同步後回到可估驗上限 3000');
select is((select backing from public.valuation_items where valuation_id = 'b5d40000-0000-0000-0000-000000000002'
  and work_item_id = 'b5d30000-0000-0000-0000-000000000001'), 'confirmed', '依據 confirmed');
select is((select cum_pct from public.valuation_items where valuation_id = 'b5d40000-0000-0000-0000-000000000002'
  and work_item_id = 'b5d30000-0000-0000-0000-000000000001'), 30::numeric, '百分比由 DB 算 3000/10000');
reset role;
select pg_temp.become(null);

-- ── 重算路徑本身也受凍結與數量規則約束 ──────────────────────────────────────────────
select throws_ok($$ select pg_temp.internal('update public.valuation_items set cum_qty = 1 where valuation_id = ''b5d40000-0000-0000-0000-000000000001'' and work_item_id = ''b5d30000-0000-0000-0000-000000000001''') $$,
  'P0001', null, '已核定期明細數量連重算路徑也不可改寫');
select throws_ok($$ select pg_temp.internal('update public.valuation_items set note = ''核定後補註'' where valuation_id = ''b5d40000-0000-0000-0000-000000000001'' and work_item_id = ''b5d30000-0000-0000-0000-000000000001''') $$,
  'P0001', null, '已核定期明細備註也凍結(只有補證可改 backing)');
select throws_ok($$ select pg_temp.internal('insert into public.valuation_items (valuation_id, work_item_id, cum_qty) values (''b5d40000-0000-0000-0000-000000000001'', ''b5d30000-0000-0000-0000-000000000003'', 1)') $$,
  'P0001', null, '已核定期不可追加明細');
select throws_ok($$ select pg_temp.internal('insert into public.valuation_items (valuation_id, work_item_id, cum_qty) values (''b5d40000-0000-0000-0000-000000000002'', ''b5d30000-0000-0000-0000-000000000002'', 501)') $$,
  'VQ005', '累計量 501 超過契約量 500', '超契約量拒絕,訊息數字無 numeric 小數尾');

-- ── cascade 放行:單一工項刪除、草稿期刪除;已核定期明細不可被連帶刪除 ───────────────────
select pg_temp.become('b5d10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ delete from public.work_items where id = 'b5d30000-0000-0000-0000-000000000003' $$,
  '廠商刪除模板工項(第 2 期草稿有 legacy 明細)→ cascade 放行');
reset role;
select is(pg_temp.cum('b5d40000-0000-0000-0000-000000000002', 'b5d30000-0000-0000-0000-000000000003'), null, '該工項的草稿明細隨工項刪除');
select pg_temp.become(null);
select throws_ok($$ delete from public.work_items where id = 'b5d30000-0000-0000-0000-000000000002' $$,
  'P0001', '估驗目前為「已核定」,明細不可刪除;請由監造退回後重編', '已核定期有明細的工項不可刪除:明細不隨工項 cascade 消失(訊息不再印成「估驗已已核定」)');
select is(pg_temp.cum('b5d40000-0000-0000-0000-000000000001', 'b5d30000-0000-0000-0000-000000000002'), 100::numeric, '已核定期混凝土 100 仍在');

-- ── 訊息數字(P4e 改經 fn_cq_txt) ──────────────────────────────────────────────
select is((select e ->> 'message' from jsonb_array_elements(public.fn_cq_period_check_internal('b5d40000-0000-0000-0000-000000000001', 'invoice')) e
  where e ->> 'code' = 'legacy_source' and e ->> 'work_item_id' = 'b5d30000-0000-0000-0000-000000000001'),
  '數量 2000 來自歷史遷移,不是監造確認;需人工補證(監造確認單)', '缺件訊息:歷史遷移量 2000(不是 2000.0000)');

select pg_temp.become('b5d10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ delete from public.valuations where id = 'b5d40000-0000-0000-0000-000000000002' $$, '廠商刪除第 2 期草稿 → 明細 cascade 放行');
reset role;
select is((select count(*)::int from public.valuation_items where valuation_id = 'b5d40000-0000-0000-0000-000000000002'), 0, '第 2 期明細隨期別刪除');

select * from finish();
rollback;
