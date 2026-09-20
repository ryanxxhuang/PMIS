-- P4b 併發(pgTAP＋dblink 真併發):兩個期別／兩個使用者同時搶同一可用量不能都拿到量。
-- 對應 migration 20260919140000_confirmed_quantity_enforcement.sql §8(逐工項 advisory lock＋valuations for update)。
-- 這一檔「不」包在交易裡:dblink 開的是獨立 session,只看得到已提交的資料;fixture 先提交,
-- 兩個 session 各自持鎖／阻塞,最後由本 session 刪專案與帳號清場(cascade),留 0 列。
-- 執行方式:npm run test:db(一次性資料庫)。ON_ERROR_STOP 關閉:任何一步意外失敗都要跑到清場,
-- 少印出的斷言會讓 planned ≠ passed 而整檔紅。
\set ON_ERROR_STOP off
create extension if not exists dblink with schema extensions;

select plan(31);
create or replace function pg_temp.today() returns date language sql stable as $f$ select (now() at time zone 'Asia/Taipei')::date $f$;

-- ── fixture(提交) ─────────────────────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('c4c10000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cqc-contractor@example.test', '', now(), '{}', '{"full_name":"廠商","org_type":"contractor"}', now(), now()),
  ('c4c10000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cqc-supervisor@example.test', '', now(), '{}', '{"full_name":"監造","org_type":"supervisor"}', now(), now());
alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by)
  values ('c4c20000-0000-0000-0000-00000000000a', '確認量併發測試案', '機關', '廠商', '監造', 'c4c10000-0000-0000-0000-000000000001');
alter table public.projects enable trigger on_project_created;
insert into public.project_members (project_id, user_id, role) values
  ('c4c20000-0000-0000-0000-00000000000a', 'c4c10000-0000-0000-0000-000000000001', 'member'),
  ('c4c20000-0000-0000-0000-00000000000a', 'c4c10000-0000-0000-0000-000000000002', 'member');
insert into public.work_items (id, project_id, item_no, description, unit, quantity, unit_price, is_leaf, is_billable, is_rollup) values
  ('c4c30000-0000-0000-0000-000000000001', 'c4c20000-0000-0000-0000-00000000000a', '1.1', '混凝土', 'm2', 1000, 1, true, true, false),
  ('c4c30000-0000-0000-0000-000000000002', 'c4c20000-0000-0000-0000-00000000000a', '1.2', '鋼筋', 'kg', 1000, 1, true, true, false);
-- 監造確認(直接寫,等同簽署路徑落庫):W1 100;此時沒有草稿期,不自動分配
insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, confirmed_by, reason) values
  ('c4c20000-0000-0000-0000-00000000000a', 'c4c30000-0000-0000-0000-000000000001', 'A', 'm2', 100, 'supervisor_certificate', 'c4c10000-0000-0000-0000-000000000002', '併發測試');
insert into public.valuations (id, project_id, period_no, period_end, status) values
  ('c4c40000-0000-0000-0000-000000000001', 'c4c20000-0000-0000-0000-00000000000a', 1, pg_temp.today(), '草稿'),
  ('c4c40000-0000-0000-0000-000000000002', 'c4c20000-0000-0000-0000-00000000000a', 2, pg_temp.today(), '草稿');
select is((select count(*)::int from public.valuation_item_sources where project_id = 'c4c20000-0000-0000-0000-00000000000a'), 0, 'fixture:尚無分配');

-- ── 兩個獨立 session(dblink),同一個一次性資料庫 ─────────────────────────────────
-- 本機 postgres 不是 superuser:dblink 要求連線用了密碼;loopback 是 trust,所以連 runner 交來的 docker 網路位址(scram)
create or replace function pg_temp.conn() returns text language sql as $f$
  select format('host=%s port=%s dbname=%s user=postgres password=postgres',
                coalesce(nullif(current_setting('pmis.pgtap_db_host', true), ''), '127.0.0.1'),
                current_setting('port'), current_database()) $f$;
create or replace function pg_temp.claims(u uuid) returns text language sql as $f$
  select format($j$select set_config('request.jwt.claims', '%s', false), set_config('request.jwt.claim.sub', '%s', false)$j$,
                json_build_object('sub', u::text, 'role', 'authenticated')::text, u::text) $f$;
-- 等待 session 進入鎖等待(最多 5 秒);回傳是否真的被鎖住
-- dblink 非同步協定:取完結果後要再呼叫一次 dblink_get_result 清空,連線才能送下一個查詢
create or replace function pg_temp.drain(p_conn text) returns int language sql as $f$
  select count(*)::int from dblink_get_result(p_conn) as t(x text) $f$;
create or replace function pg_temp.wait_blocked(p_app text) returns boolean language plpgsql as $f$
declare i int := 0; blocked boolean := false;
begin
  while i < 50 loop
    select exists (select 1 from pg_stat_activity where application_name = p_app and state = 'active'
                   and wait_event_type = 'Lock') into blocked;
    exit when blocked;
    perform pg_sleep(0.1);
    i := i + 1;
  end loop;
  return blocked;
end $f$;

select dblink_connect('a', pg_temp.conn() || ' application_name=cq_sess_a');
select dblink_connect('b', pg_temp.conn() || ' application_name=cq_sess_b');
select dblink_exec('a', 'set role authenticated');
select dblink_exec('b', 'set role authenticated');
select * from dblink('a', pg_temp.claims('c4c10000-0000-0000-0000-000000000001')) as t(x text, y text);
select * from dblink('b', pg_temp.claims('c4c10000-0000-0000-0000-000000000001')) as t(x text, y text);

-- ── 情境 1:兩個期別同時同步同一可用量(W1 100):第一個拿走 100,第二個等鎖後只拿到 0 ───
select dblink_exec('a', 'begin');
select is((select (x::jsonb -> 'items' -> 0 ->> 'cum_qty')::numeric
           from dblink('a', $q$select public.sync_valuation_from_confirmations('c4c40000-0000-0000-0000-000000000001')$q$) as t(x text)),
  100::numeric, 'session A:第 1 期同步拿到 100(交易未提交,持逐工項鎖)');
select dblink_send_query('b', $q$select public.sync_valuation_from_confirmations('c4c40000-0000-0000-0000-000000000002')$q$);
select ok(pg_temp.wait_blocked('cq_sess_b'), 'session B:第 2 期同步在鎖上等待(真併發,不是序列模擬)');
select is((select count(*)::int from public.valuation_item_sources where project_id = 'c4c20000-0000-0000-0000-00000000000a'), 0,
  '主 session:A 未提交前看不到任何分配');
select dblink_exec('a', 'commit');
select is((select (x::jsonb -> 'items' -> 0 ->> 'added')::numeric
           from dblink_get_result('b') as t(x text)), 0::numeric, 'session B:A 提交後才執行,看到已扣的量,第 2 期新增 0');
select is((select cum_qty from public.valuation_items where valuation_id = 'c4c40000-0000-0000-0000-000000000001' and work_item_id = 'c4c30000-0000-0000-0000-000000000001'),
  100::numeric, '第 1 期 W1 100');
select is(pg_temp.drain('b'), 0, 'session B:非同步結果已清空');
select is((select cum_qty from public.valuation_items where valuation_id = 'c4c40000-0000-0000-0000-000000000002' and work_item_id = 'c4c30000-0000-0000-0000-000000000001'),
  null, '第 2 期 W1 新增 0 → 不建明細列(沒有重複入帳)');
select is((select sum(qty) from public.valuation_item_sources where work_item_id = 'c4c30000-0000-0000-0000-000000000001'), 100::numeric,
  'W1 全部期別分配合計 100=有效確認量,不多不少');

-- ── 情境 2:兩個期別同時「設定累計」搶同一可用量(W2 50):後到者看到前者已拿走,增量 0 ───
-- W2 的確認在有草稿期之後才寫入,以 defer 旗標避免自動分配,讓「可用量」只由 session A 的交易拿走
select set_config('pmis.cq_defer_allocate', '1', false);
insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, confirmed_by, reason) values
  ('c4c20000-0000-0000-0000-00000000000a', 'c4c30000-0000-0000-0000-000000000002', 'L', 'kg', 50, 'supervisor_certificate', 'c4c10000-0000-0000-0000-000000000002', '併發測試');
select set_config('pmis.cq_defer_allocate', '', false);
select is((select count(*)::int from public.valuation_item_sources where work_item_id = 'c4c30000-0000-0000-0000-000000000002'), 0, 'W2 尚未分配');
select dblink_exec('a', 'begin');
select lives_ok($o$ select * from dblink('a', $q$select public.set_valuation_item_cum('c4c40000-0000-0000-0000-000000000001', 'c4c30000-0000-0000-0000-000000000002', 50)$q$) as t(x text) $o$,
  'session A:第 1 期 W2 設 50(未提交)');
select dblink_send_query('b', $q$select public.set_valuation_item_cum('c4c40000-0000-0000-0000-000000000002', 'c4c30000-0000-0000-0000-000000000002', 50)$q$);
select ok(pg_temp.wait_blocked('cq_sess_b'), 'session B:第 2 期 W2 設 50 在鎖上等待');
select dblink_exec('a', 'commit');
select is((select (x::jsonb ->> 'delta')::numeric from dblink_get_result('b') as t(x text)), 0::numeric,
  'session B:輪到它時第 1 期已拿走 50,第 2 期增量 0(沒有鎖會各拿 50、合計 100 超額)');
select is(pg_temp.drain('b'), 0, 'session B:非同步結果已清空(2)');
select is((select sum(qty) from public.valuation_item_sources where work_item_id = 'c4c30000-0000-0000-0000-000000000002'), 50::numeric,
  'W2 分配合計 50,沒有超額');

-- ── 情境 3:同一期同一工項兩個操作序列化(第二個等 valuations 列鎖,終值一致) ─────────────
select dblink_exec('a', 'begin');
select lives_ok($o$ select * from dblink('a', $q$select public.set_valuation_item_cum('c4c40000-0000-0000-0000-000000000001', 'c4c30000-0000-0000-0000-000000000002', 30)$q$) as t(x text) $o$,
  'session A:第 1 期 W2 改 30(未提交)');
select dblink_send_query('b', $q$select public.set_valuation_item_cum('c4c40000-0000-0000-0000-000000000001', 'c4c30000-0000-0000-0000-000000000002', 50)$q$);
select ok(pg_temp.wait_blocked('cq_sess_b'), 'session B:同一期同一工項在鎖上等待');
select dblink_exec('a', 'commit');
select lives_ok($o$ select * from dblink_get_result('b') as t(x text) $o$, 'session B:A 釋放後套用 50(在上限內)');
select is(pg_temp.drain('b'), 0, 'session B:非同步結果已清空(3)');
select is((select cum_qty from public.valuation_items where valuation_id = 'c4c40000-0000-0000-0000-000000000001' and work_item_id = 'c4c30000-0000-0000-0000-000000000002'),
  50::numeric, '終值為最後一個序列化操作的 50');
select is((select sum(qty) from public.valuation_item_sources where work_item_id = 'c4c30000-0000-0000-0000-000000000002'), 50::numeric,
  '分配合計仍不超過 50');

-- ── 情境 4(E 包 20260920170000):查驗表單簽署寫確認量,必須在同一把逐工項鎖內 ───────────
-- 為什麼要這條:簽署分支是「讀此 (工項, 批次, 階段) 最新 active 的 qty_cum,再插入 prev_cum + 本次確認」。
-- 這段 read-then-insert 以前沒取 fn_cq_lock_internal(issue_supervisor_certificate 有),所以另一個
-- 確認寫入者只要還沒提交,簽署就會讀到舊的 prev_cum,把累計鏈寫叉:Σqty_delta 與最新一筆的 qty_cum 不再一致。
-- 這條用「A 持鎖並寫入 30、B 同時簽署確認 60」把它逼出來:修好=B 等到 A 提交才讀 → 90;
-- 沒修好=B 在 A 提交前就讀到 0 → 寫成 60(AFTER trigger 仍會擋在鎖上,所以只看「有沒有被鎖住」分辨不出來,
-- 要看最後落庫的 qty_cum)。
insert into public.work_items (id, project_id, item_no, description, unit, quantity, unit_price, is_leaf, is_billable, is_rollup) values
  ('c4c30000-0000-0000-0000-000000000003', 'c4c20000-0000-0000-0000-00000000000a', '1.3', '版牆混凝土', 'M3', 1000, 1, true, true, false);
insert into public.inspections (id, project_id, work_item_id, title, location, requested_date, declared_qty, requested_by) values
  ('c4c50000-0000-0000-0000-000000000001', 'c4c20000-0000-0000-0000-00000000000a', 'c4c30000-0000-0000-0000-000000000003',
   '3F 版牆混凝土查驗', '3F 版牆', pg_temp.today(), 100, 'c4c10000-0000-0000-0000-000000000001');
-- 表單草稿與可簽版本都走產品 RPC,以監造身分建立(session 級 claims,用完還原)
select set_config('request.jwt.claims',
  json_build_object('sub', 'c4c10000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, false);
select set_config('request.jwt.claim.sub', 'c4c10000-0000-0000-0000-000000000002', false);
set role authenticated;
create or replace function pg_temp.insp_doc() returns uuid language sql as $f$
  select id from public.field_documents where doc_type = 'inspection_form'
    and target_key = 'c4c50000-0000-0000-0000-000000000001' and status not in ('discarded', 'superseded')
  order by created_at limit 1 $f$;
select ok((select (public.create_inspection_form_draft('c4c50000-0000-0000-0000-000000000001') ->> 'id')) is not null,
  'fixture:監造建立查驗表單草稿');
select is((select public.save_field_document_version(pg_temp.insp_doc(),
    (select coalesce(max(version_no), 0) from public.field_document_versions where document_id = pg_temp.insp_doc()),
    jsonb_build_object(
      'inspection_date', pg_temp.today()::text, 'inspection_id', 'c4c50000-0000-0000-0000-000000000001',
      'inspection_title', '3F 版牆混凝土查驗', 'work_item_id', 'c4c30000-0000-0000-0000-000000000003',
      'location', '3F 版牆', 'stage_key', null, 'unit', 'M3', 'declared_qty', 100, 'self_check_record_id', null,
      'template_id', null, 'template_title', null, 'results', '{}'::jsonb,
      'verdict', '部分合格', 'confirmed_qty', 60, 'result_note', '版牆東側 40 M3 蜂窩待修補', 'note', null,
      'template', '{"key":"inspection_form_demo","version":1}'::jsonb, 'photo_ids', '[]'::jsonb, 'unmatched_photo_ids', '[]'::jsonb),
    '{"inspection_date":{"status":"confirmed","source":"human"},"inspection_id":{"status":"confirmed","source":"human"},
      "work_item_id":{"status":"confirmed","source":"human"},"location":{"status":"confirmed","source":"human"},
      "unit":{"status":"confirmed","source":"human"},"declared_qty":{"status":"confirmed","source":"human"},
      "verdict":{"status":"confirmed","source":"human"},"confirmed_qty":{"status":"confirmed","source":"human"}}'::jsonb)
    ->> 'status'), 'draft', 'fixture:存出可簽版本(確認 60)');
reset role;
select set_config('request.jwt.claims', '', false);
select set_config('request.jwt.claim.sub', '', false);
-- session B 改用監造身分(只有監造能簽);session A 回到 postgres 才寫得進確認表
select * from dblink('b', pg_temp.claims('c4c10000-0000-0000-0000-000000000002')) as t(x text, y text);
select dblink_exec('a', 'reset role');
select dblink_exec('a', 'begin');
select lives_ok($o$ select * from dblink('a', $q$
    select public.fn_cq_lock_internal('c4c20000-0000-0000-0000-00000000000a', 'c4c30000-0000-0000-0000-000000000003')::text $q$) as t(x text) $o$,
  'session A:持有 W3 的逐工項鎖(模擬另一個確認寫入者)');
select lives_ok($o$ select dblink_exec('a', $q$
    insert into public.inspection_confirmations (project_id, work_item_id, batch_key, unit, qty_cum, basis, confirmed_by, reason)
    values ('c4c20000-0000-0000-0000-00000000000a', 'c4c30000-0000-0000-0000-000000000003', '3f版牆', 'M3', 30,
            'supervisor_certificate', 'c4c10000-0000-0000-0000-000000000002', '併發測試') $q$) $o$,
  'session A:同批次先確認累計 30(未提交)');
select dblink_send_query('b', $q$
  select public.sign_field_document(
    (select id from public.field_documents where doc_type = 'inspection_form'
       and target_key = 'c4c50000-0000-0000-0000-000000000001' and status not in ('discarded', 'superseded')
     order by created_at limit 1),
    (select max(version_no) from public.field_document_versions
      where document_id = (select id from public.field_documents where doc_type = 'inspection_form'
        and target_key = 'c4c50000-0000-0000-0000-000000000001' and status not in ('discarded', 'superseded')
        order by created_at limit 1)),
    (select content_hash from public.field_document_versions
      where document_id = (select id from public.field_documents where doc_type = 'inspection_form'
        and target_key = 'c4c50000-0000-0000-0000-000000000001' and status not in ('discarded', 'superseded')
        order by created_at limit 1)
      order by version_no desc limit 1),
    '本人確認判定與確認數量')$q$);
select ok(pg_temp.wait_blocked('cq_sess_b'), 'session B:查驗表單簽署在同一把鎖上等待');
select dblink_exec('a', 'commit');
select lives_ok($o$ select * from dblink_get_result('b') as t(x text) $o$, 'session B:A 釋放後完成簽署');
select is(pg_temp.drain('b'), 0, 'session B:非同步結果已清空(4)');
select results_eq($$ select qty_cum, qty_delta from public.inspection_confirmations
                      where work_item_id = 'c4c30000-0000-0000-0000-000000000003' and basis = 'inspection' $$,
  $$ values (90.0000::numeric, 60.0000::numeric) $$,
  '簽署讀到的是 A 提交後的累計 30,落庫 90(=30+60);沒有鎖會讀到 0 而寫成 60,累計鏈就分岔');
select is((select count(*)::int from public.inspection_confirmations
             where work_item_id = 'c4c30000-0000-0000-0000-000000000003' and status = 'active'
               and supersedes_id is null), 1,
  '累計鏈仍是單一條(只有最初那筆沒有前手),沒有兩筆並列的鏈頭');

-- ── 清場(cascade;確認紀錄 guard 對專案刪除放行) ────────────────────────────────────
select dblink_disconnect('a');
select dblink_disconnect('b');
delete from public.projects where id = 'c4c20000-0000-0000-0000-00000000000a';
delete from auth.users where id in ('c4c10000-0000-0000-0000-000000000001', 'c4c10000-0000-0000-0000-000000000002');
drop extension if exists dblink;
select is((select count(*)::int from public.inspection_confirmations where project_id = 'c4c20000-0000-0000-0000-00000000000a')
  + (select count(*)::int from public.projects where id = 'c4c20000-0000-0000-0000-00000000000a')
  + (select count(*)::int from auth.users where email like 'cqc-%@example.test'), 0, '清場後殘留 0');

select * from finish();
