-- 專案刪除留痕:讓「日誌至少保存六個月」不會被一次專案刪除悄悄變成假話。
-- 釘住:①刪除會留痕且數得到當時事件數 ②留痕本身 append-only ③只有平台管理員讀得到
begin;

select plan(11);

-- -- 結構與權限契約 ----------------------------------------------------------
select has_table('public', 'project_deletion_records', '專案刪除留痕表存在');
select col_type_is('public', 'project_deletion_records', 'project_id', 'uuid',
  '記下被刪專案的 id');
select is(
  (select count(*)::int from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'project_deletion_records'
      and constraint_type = 'FOREIGN KEY'),
  0, '刻意不掛外鍵——有外鍵就會隨被刪專案一起消失');
select is(has_table_privilege('authenticated', 'public.project_deletion_records', 'INSERT'),
  false, 'authenticated 不得直接寫入刪除紀錄');
select is(has_table_privilege('authenticated', 'public.project_deletion_records', 'DELETE'),
  false, 'authenticated 不得刪除刪除紀錄');

-- -- 端到端:刪專案會留痕,且帶當時的稽核事件數 ------------------------------
alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name)
  values ('c9200000-0000-0000-0000-0000000000b1'::uuid, '刪除留痕測試案');
alter table public.projects enable trigger on_project_created;

select public.record_audit_event(
  'c9200000-0000-0000-0000-0000000000b1'::uuid, 'test.a', 'test', null,
  'created', null, null, '{}'::jsonb, null);
select public.record_audit_event(
  'c9200000-0000-0000-0000-0000000000b1'::uuid, 'test.b', 'test', null,
  'created', null, null, '{}'::jsonb, null);

select lives_ok($$
  delete from public.projects where id = 'c9200000-0000-0000-0000-0000000000b1'::uuid
$$, '專案仍刪得掉(留痕不能變成刪不掉專案的地雷)');

select is(
  (select count(*)::int from public.project_deletion_records
    where project_id = 'c9200000-0000-0000-0000-0000000000b1'::uuid),
  1, '刪除留下一筆紀錄');
select is(
  (select audit_event_count from public.project_deletion_records
    where project_id = 'c9200000-0000-0000-0000-0000000000b1'::uuid),
  2, '記下刪除當時該案有多少稽核事件(BEFORE DELETE 才數得到)');
select is(
  (select project_name from public.project_deletion_records
    where project_id = 'c9200000-0000-0000-0000-0000000000b1'::uuid),
  '刪除留痕測試案', '記下被刪專案名稱(專案列已不存在,只剩這裡查得到)');

-- -- append-only ------------------------------------------------------------
select throws_ok($$
  update public.project_deletion_records set project_name = '竄改'
  where project_id = 'c9200000-0000-0000-0000-0000000000b1'::uuid
$$, 'P0001', 'deletion records are append-only', '刪除紀錄不可竄改');
select throws_ok($$
  delete from public.project_deletion_records
  where project_id = 'c9200000-0000-0000-0000-0000000000b1'::uuid
$$, 'P0001', 'deletion records are append-only', '刪除紀錄不可湮滅');

select * from finish();
rollback;
