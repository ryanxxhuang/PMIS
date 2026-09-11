-- W13 抽取續跑的併發保證(pgTAP):同一 document_version 同時最多一條
-- pending/processing 的抽取 run,由 partial unique index
-- document_ingestion_runs_one_active_per_version 收口。
--
-- 為什麼要有這支測試:這個 index 是「唯一擋得住併發重複抽取的那一層」
-- (20260822000100 的檔頭寫得很清楚——前端防連點與伺服器 select 防呆都有
-- 時間窗,2026-08-21 正式站實測兩個相隔 17ms 的請求同穿防呆並行抽取、
-- 雙倍燒 token)。extract-requirements 把 insert 的 23505 轉成 409
-- 「這份文件已在解析中」,續跑認領也靠它保證只有一個 claimer。
-- 但它在 supabase/tests/ 原本零覆蓋——刪掉或改錯 where 條件不會有任何紅燈,
-- 而後果是靜默的雙倍 token 帳單與互相覆寫的抽取結果。
--
-- 覆蓋:終態不受限(completed/failed 可多筆)、進行中同版本唯一、
-- 不同版本互不影響、終態讓位給新的進行中 run(重試路徑)。
-- 執行方式:本地 supabase(colima)+容器內 psql,整份在交易內執行並 rollback。
begin;

select plan(8);

-- ── 測試資料 ─────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c9a10000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'iru-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by) values
  ('c9a20000-0000-0000-0000-00000000000a', '抽取併發測試案', '機關', '廠商', '監造',
   'c9a10000-0000-0000-0000-000000000001');
alter table public.projects enable trigger on_project_created;

insert into public.documents (id, project_id, title, document_type, status) values
  ('c9a30000-0000-0000-0000-000000000001', 'c9a20000-0000-0000-0000-00000000000a', '契約書', 'contract', 'active');

-- 同一份文件的兩個版本:用來證明唯一性是「每個版本各自一條」,不是全域一條
insert into public.document_versions (id, document_id, version_label) values
  ('c9a40000-0000-0000-0000-000000000001', 'c9a30000-0000-0000-0000-000000000001', 'v1'),
  ('c9a40000-0000-0000-0000-000000000002', 'c9a30000-0000-0000-0000-000000000001', 'v2');

-- ── 1. index 存在且 where 條件正確 ──────────────────────────────────────────
-- 直接釘住 indexdef:改到 where 條件(例如漏掉 pending)就等於打開競態,
-- 而那種改動在功能測試上完全看不出來。
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'document_ingestion_runs_one_active_per_version'
      and indexdef like '%UNIQUE%'
      and indexdef like '%document_version_id%'
      and indexdef like '%pending%'
      and indexdef like '%processing%'
  ),
  'partial unique index 存在,且同時涵蓋 pending 與 processing'
);

-- ── 2. 第一條進行中的 run 可以建立 ──────────────────────────────────────────
select lives_ok($$
  insert into public.document_ingestion_runs (id, project_id, document_version_id, status)
  values ('c9a50000-0000-0000-0000-000000000001', 'c9a20000-0000-0000-0000-00000000000a',
          'c9a40000-0000-0000-0000-000000000001', 'processing')
$$, '同版本第一條 processing run:可建立');

-- ── 3. 同版本第二條進行中 → 23505(這是 409 的來源) ────────────────────────
select throws_ok($$
  insert into public.document_ingestion_runs (project_id, document_version_id, status)
  values ('c9a20000-0000-0000-0000-00000000000a', 'c9a40000-0000-0000-0000-000000000001', 'pending')
$$, '23505', null,
  '同版本第二條進行中 run 被唯一索引擋下(extract-requirements 轉成 409「已在解析中」)');

select throws_ok($$
  insert into public.document_ingestion_runs (project_id, document_version_id, status)
  values ('c9a20000-0000-0000-0000-00000000000a', 'c9a40000-0000-0000-0000-000000000001', 'processing')
$$, '23505', null,
  'pending 與 processing 互相排斥,不是各自獨立計數');

-- ── 4. 不同版本互不影響 ─────────────────────────────────────────────────────
-- 同一份文件的 v2 可以同時解析:唯一性的粒度是版本,不是文件也不是專案。
select lives_ok($$
  insert into public.document_ingestion_runs (id, project_id, document_version_id, status)
  values ('c9a50000-0000-0000-0000-000000000002', 'c9a20000-0000-0000-0000-00000000000a',
          'c9a40000-0000-0000-0000-000000000002', 'processing')
$$, '不同 document_version 可各有一條進行中 run');

-- ── 5. 終態不受唯一性限制 ───────────────────────────────────────────────────
-- 一份文件會被重試多次,歷史必須留得下來;partial index 的 where 條件就是為此。
update public.document_ingestion_runs
set status = 'failed', completed_at = now()
where id = 'c9a50000-0000-0000-0000-000000000001';

select lives_ok($$
  insert into public.document_ingestion_runs (project_id, document_version_id, status, completed_at)
  values ('c9a20000-0000-0000-0000-00000000000a', 'c9a40000-0000-0000-0000-000000000001', 'failed', now())
$$, '同版本可累積多筆 failed(重試歷史要留得住)');

select lives_ok($$
  insert into public.document_ingestion_runs (project_id, document_version_id, status, completed_at)
  values ('c9a20000-0000-0000-0000-00000000000a', 'c9a40000-0000-0000-0000-000000000001', 'completed', now())
$$, '同版本可累積多筆 completed');

-- ── 6. 終態讓位給新的進行中 run(重試路徑) ─────────────────────────────────
-- 上一輪標成 failed 之後,重新啟動解析必須能建立新的 processing run,
-- 否則使用者會卡在「已在解析中」而永遠重試不了。
select lives_ok($$
  insert into public.document_ingestion_runs (project_id, document_version_id, status)
  values ('c9a20000-0000-0000-0000-00000000000a', 'c9a40000-0000-0000-0000-000000000001', 'processing')
$$, '前一輪收斂成終態後,可重新啟動解析(不會被歷史列卡住)');

select * from finish();
rollback;
