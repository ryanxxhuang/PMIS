-- P2c:本機 stack 的 service_role 對 public 函式的執行權要與 hosted 平台預設一致(seed.sql 補齊)。
-- hosted 的 postgres default privileges 對新函式給 anon/authenticated/service_role EXECUTE;migration 只
-- revoke public/anon(有的再 revoke authenticated),service_role 仍可執行。Edge service client 寫
-- field_documents 時 generated column 會呼叫 fn_field_document_owner_org——本機沒補這條就 42501,
-- 真後端 E2E 起稿會失敗,而 hosted 不會(本機假紅)。這裡釘住:既有 helper 與測試內新建的函式,
-- service_role 都可執行;anon 仍不可(migration 的 revoke 沒被 seed 放寬)。
-- 執行方式:npm run test:db(一次性資料庫從零套 migrations＋seed),整份在交易內執行並 rollback。
begin;

select plan(5);

select ok(has_function_privilege('service_role', 'public.fn_field_document_owner_org(text)', 'execute'),
  'service_role 可執行 fn_field_document_owner_org(field_documents generated column;Edge service INSERT 依賴)');
select ok(has_function_privilege('service_role', 'public.fn_field_document_target_table(text)', 'execute'),
  'service_role 可執行 fn_field_document_target_table');
select ok(not has_function_privilege('anon', 'public.fn_field_document_owner_org(text)', 'execute'),
  'anon 仍不可執行(migration 的 revoke 沒被 seed 放寬)');

-- default privileges:之後 migration 新建的函式,service_role 自動可執行(與 hosted 一致);anon 不會自動拿到
create function public.p2c_probe_fn() returns int language sql immutable as 'select 1';
revoke all on function public.p2c_probe_fn() from public, anon;
select ok(has_function_privilege('service_role', 'public.p2c_probe_fn()', 'execute'),
  '新建函式 revoke public/anon 後 service_role 仍可執行(default privileges)');
select ok(not has_function_privilege('anon', 'public.p2c_probe_fn()', 'execute'),
  '新建函式 anon 不可執行');

select * from finish();
rollback;
