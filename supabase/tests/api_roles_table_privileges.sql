-- H1 API 角色表級 DDL／維護類權限（pgTAP）：對應 migration 20260917213900_api_roles_table_ddl_privileges.sql。
-- 釘住四件事：
--   1. anon／authenticated／service_role 對 public **每一張**表（含 view）都沒有
--      TRUNCATE／REFERENCES／TRIGGER／MAINTAIN——全表迴圈，日後任何 migration 新增的表自動納入；
--   2. default privileges 已修正：測試內以 postgres 新建一張表，四種權限仍不會自動出現，
--      而基線／seed 給的 DML 照舊（authenticated 與 service_role 的 SELECT／INSERT／UPDATE／DELETE）；
--   3. 行為：三個角色 TRUNCATE `cost_items`（P1b 退場）與 `field_document_versions`（P2a 不可變）皆 42501；
--   4. 前提：public 表全部由 postgres 擁有（default privileges 是按建表角色算的，換 owner 就得重看）。
-- 只涵蓋 postgres 擁有、非 extension 的物件：一次性資料庫把 pgtap 裝在 public，其 view 屬 supabase_admin。
-- 執行方式：npm run test:db（一次性資料庫），整份在交易內執行並 rollback。
begin;

create temporary view h1_public_rels as
  select c.oid, c.relname::text as relname, pg_get_userbyid(c.relowner) as owner
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e');

-- 每表 × 三角色一條斷言 + 固定 23 條
select plan((select count(*)::int * 3 from h1_public_rels) + 23);

-- ── 0. 前提：owner 全是 postgres，且表數量非零（迴圈不是空跑）────────────────
select cmp_ok((select count(*)::int from h1_public_rels), '>=', 50, 'public 至少 50 個關聯（迴圈確實涵蓋全庫）');
select is((select string_agg(relname, ',' order by relname) from h1_public_rels where owner <> 'postgres'), null,
  'public 關聯全部由 postgres 擁有（default privileges 依建表角色生效）');

-- ── 1. 全表迴圈：任一角色殘留任一 DDL／維護類權限就列出名稱 ────────────────────
select is(
  array_to_string(array_remove(array[
    case when has_table_privilege(r.role, t.oid, 'TRUNCATE')   then 'TRUNCATE'   end,
    case when has_table_privilege(r.role, t.oid, 'REFERENCES') then 'REFERENCES' end,
    case when has_table_privilege(r.role, t.oid, 'TRIGGER')    then 'TRIGGER'    end,
    case when has_table_privilege(r.role, t.oid, 'MAINTAIN')   then 'MAINTAIN'   end
  ], null), ','), '',
  format('%s 對 public.%s 無 TRUNCATE／REFERENCES／TRIGGER／MAINTAIN', r.role, t.relname))
from h1_public_rels t
cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
order by t.relname, r.role;

-- ── 2. default privileges：defacl 本身與新建表都不再帶四種權限 ───────────────
select is((select count(*)::int
  from pg_default_acl d, aclexplode(d.defaclacl) a
  where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
    and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
    and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')), 0,
  'postgres 對 public 的 default ACL 已無三角色的 TRUNCATE／REFERENCES／TRIGGER／MAINTAIN');
select is((select count(*)::int
  from pg_default_acl d, aclexplode(d.defaclacl) a
  where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
    and a.grantee = 0 and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')), 0,
  'default ACL 對 PUBLIC 也沒有這四種權限');

create table public.h1_probe (id int primary key, note text);
select is(has_table_privilege('anon', 'public.h1_probe', 'TRUNCATE') or has_table_privilege('anon', 'public.h1_probe', 'REFERENCES')
  or has_table_privilege('anon', 'public.h1_probe', 'TRIGGER') or has_table_privilege('anon', 'public.h1_probe', 'MAINTAIN'), false,
  '新建表：anon 沒有自動拿到四種權限');
select is(has_table_privilege('authenticated', 'public.h1_probe', 'TRUNCATE') or has_table_privilege('authenticated', 'public.h1_probe', 'REFERENCES')
  or has_table_privilege('authenticated', 'public.h1_probe', 'TRIGGER') or has_table_privilege('authenticated', 'public.h1_probe', 'MAINTAIN'), false,
  '新建表：authenticated 沒有自動拿到四種權限');
select is(has_table_privilege('service_role', 'public.h1_probe', 'TRUNCATE') or has_table_privilege('service_role', 'public.h1_probe', 'REFERENCES')
  or has_table_privilege('service_role', 'public.h1_probe', 'TRIGGER') or has_table_privilege('service_role', 'public.h1_probe', 'MAINTAIN'), false,
  '新建表：service_role 沒有自動拿到四種權限');
-- DML default 不受影響（基線 20260712001200 給 authenticated；seed／hosted 平台預設給 service_role）
select is(has_table_privilege('authenticated', 'public.h1_probe', 'SELECT') and has_table_privilege('authenticated', 'public.h1_probe', 'INSERT')
  and has_table_privilege('authenticated', 'public.h1_probe', 'UPDATE') and has_table_privilege('authenticated', 'public.h1_probe', 'DELETE'), true,
  '新建表：authenticated 的 DML default（基線）照舊——新表仍要在 migration 內收窄');
select is(has_table_privilege('service_role', 'public.h1_probe', 'SELECT') and has_table_privilege('service_role', 'public.h1_probe', 'INSERT')
  and has_table_privilege('service_role', 'public.h1_probe', 'UPDATE') and has_table_privilege('service_role', 'public.h1_probe', 'DELETE'), true,
  '新建表：service_role 的 DML default 照舊（Edge service client 路徑不變）');
drop table public.h1_probe;

-- ── 3. 既有表的 DML 未被動到（本支只收四種 DDL／維護類）────────────────────────
select is(has_table_privilege('authenticated', 'public.cost_items', 'SELECT'), true, 'cost_items：authenticated 仍可 SELECT（P1b 歷史查閱）');
select is(has_table_privilege('authenticated', 'public.daily_logs', 'INSERT') and has_table_privilege('authenticated', 'public.daily_logs', 'UPDATE'), true,
  'daily_logs：authenticated 的 INSERT／UPDATE 表級權限不變');
select is(has_table_privilege('service_role', 'public.field_document_versions', 'INSERT') and has_table_privilege('service_role', 'public.field_document_versions', 'DELETE'), true,
  'field_document_versions：service_role 仍有 DML（不可變由列級 guard 擋，不靠 grant）');
select is(has_table_privilege('service_role', 'public.cost_items', 'INSERT') and has_table_privilege('service_role', 'public.cost_items', 'UPDATE')
  and has_table_privilege('service_role', 'public.cost_items', 'DELETE'), true, 'cost_items：service_role 仍可寫供修復');

-- ── 4. 行為：TRUNCATE 被表級權限擋（42501），不是靠 RLS 或 guard ──────────────
set local role authenticated;
select throws_ok($$ truncate table public.cost_items $$, '42501', null, 'authenticated TRUNCATE cost_items 被擋');
select throws_ok($$ truncate table public.field_document_versions $$, '42501', null, 'authenticated TRUNCATE field_document_versions 被擋');
select throws_ok($$ truncate table public.audit_events $$, '42501', null, 'authenticated TRUNCATE audit_events 被擋');
reset role;

set local role anon;
select throws_ok($$ truncate table public.cost_items $$, '42501', null, 'anon TRUNCATE cost_items 被擋');
select throws_ok($$ truncate table public.field_document_versions $$, '42501', null, 'anon TRUNCATE field_document_versions 被擋');
reset role;

set local role service_role;
select throws_ok($$ truncate table public.field_document_versions $$, '42501', null,
  'service_role TRUNCATE field_document_versions 被擋（TRUNCATE 不觸發列級 guard，是唯一要收的 DML 類操作）');
select throws_ok($$ truncate table public.audit_events $$, '42501', null, 'service_role TRUNCATE audit_events 被擋');
select lives_ok($$ select count(*) from public.field_document_versions $$, 'service_role 的 SELECT 照常');
reset role;

-- ── 5. 建 FK／掛 trigger 是 owner 的事：authenticated 沒有 REFERENCES／TRIGGER ─
select is(has_table_privilege('authenticated', 'public.projects', 'REFERENCES'), false, 'authenticated 對 projects 無 REFERENCES');
select is(has_table_privilege('authenticated', 'public.projects', 'TRIGGER'), false, 'authenticated 對 projects 無 TRIGGER');

select * from finish();
rollback;
