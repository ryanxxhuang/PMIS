-- H2＋H3 anon 與函式 EXECUTE 權限（pgTAP）：對應 migration 20260919003000_anon_and_function_execute_privileges.sql。
-- 釘住六件事：
--   1. anon 對 public **每一個**關聯（表／view／外部表）與序列沒有任何權限，對 **每一支** 函式沒有 EXECUTE——
--      全庫迴圈，日後 migration 新增的物件自動納入；例外清單為空（盤點見 migration 檔頭）；
--   2. PUBLIC 偽角色在 public 的表／序列／函式 ACL 上零殘留；
--   3. authenticated 可執行的函式集合 **精確等於** 允許清單（新 RPC 要給前端／Edge user client 用，
--      migration 明示 grant 之後也要把名字加進這裡；trigger 函式一律不在清單內）；
--   4. default privileges：新建表／序列不再給 anon，新建函式對 anon／authenticated／PUBLIC 都不可執行
--      （測試內以 postgres 新建證明；service_role 照平台預設可執行），`extensions` schema 的新函式維持 PUBLIC 可執行；
--   5. trigger 觸發不需要呼叫者對 trigger 函式有 EXECUTE（handle_new_user／各 guard 不受影響的依據）；
--   6. 行為：anon 直連 42501；authenticated 的 policy 路徑與允許清單 RPC 照常，trigger 函式／內部 helper 42501。
-- 只涵蓋非 extension 物件（pgtap 裝在 extensions schema；正式庫的 pg_net 屬 supabase_admin），且要求全部由
-- postgres 擁有（default privileges 依建物件的角色計算）。
-- 執行方式：npm run test:db（一次性資料庫），整份在交易內執行並 rollback。
begin;

create temporary view h23_rels as
  select c.oid, c.relname::text as relname, c.relkind::text as relkind, pg_get_userbyid(c.relowner) as owner
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e');
create temporary view h23_seqs as
  select c.oid, c.relname::text as relname, pg_get_userbyid(c.relowner) as owner
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S'
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e');
create temporary view h23_fns as
  select p.oid, p.proname::text as proname, pg_get_function_identity_arguments(p.oid) as args,
         pg_get_userbyid(p.proowner) as owner, (p.prorettype = 'trigger'::regtype) as is_trigger, p.prosecdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');

-- 每個關聯、每個序列、每支函式各一條 anon 斷言 + 固定 37 條
select plan((select count(*)::int from h23_rels) + (select count(*)::int from h23_seqs)
            + (select count(*)::int from h23_fns) + 37);

-- ── 0. 前提：迴圈不是空跑，且物件全部由 postgres 擁有 ─────────────────────────────
select cmp_ok((select count(*)::int from h23_rels), '>=', 50, 'public 至少 50 個關聯');
select is((select string_agg(relname, ',' order by relname) from h23_rels where owner <> 'postgres'), null,
  'public 關聯全部由 postgres 擁有');
select cmp_ok((select count(*)::int from h23_fns), '>=', 150, 'public 至少 150 支函式');
select is((select string_agg(proname, ',' order by proname) from h23_fns where owner <> 'postgres'), null,
  'public 函式全部由 postgres 擁有（default privileges 依建函式角色生效）');

-- ── 1. 全庫迴圈：anon 對每個關聯／序列／函式零權限 ───────────────────────────────────
select is(
  array_to_string(array_remove(array[
    case when has_table_privilege('anon', t.oid, 'SELECT')     then 'SELECT'     end,
    case when has_table_privilege('anon', t.oid, 'INSERT')     then 'INSERT'     end,
    case when has_table_privilege('anon', t.oid, 'UPDATE')     then 'UPDATE'     end,
    case when has_table_privilege('anon', t.oid, 'DELETE')     then 'DELETE'     end,
    case when has_table_privilege('anon', t.oid, 'TRUNCATE')   then 'TRUNCATE'   end,
    case when has_table_privilege('anon', t.oid, 'REFERENCES') then 'REFERENCES' end,
    case when has_table_privilege('anon', t.oid, 'TRIGGER')    then 'TRIGGER'    end,
    case when has_table_privilege('anon', t.oid, 'MAINTAIN')   then 'MAINTAIN'   end
  ], null), ','), '',
  format('anon 對 public.%s（%s）無任何表級權限', t.relname, t.relkind))
from h23_rels t order by t.relname;

select is(
  array_to_string(array_remove(array[
    case when has_sequence_privilege('anon', s.oid, 'SELECT') then 'SELECT' end,
    case when has_sequence_privilege('anon', s.oid, 'USAGE')  then 'USAGE'  end,
    case when has_sequence_privilege('anon', s.oid, 'UPDATE') then 'UPDATE' end
  ], null), ','), '',
  format('anon 對序列 public.%s 無任何權限', s.relname))
from h23_seqs s order by s.relname;

select is(has_function_privilege('anon', f.oid, 'EXECUTE'), false,
  format('anon 不可執行 public.%s(%s)', f.proname, f.args))
from h23_fns f order by f.proname, f.args;

-- ── 2. PUBLIC 偽角色零殘留（anon 迴圈已隱含，這裡直接看 ACL）──────────────────────────
select is((select count(*)::int from h23_fns f join pg_proc p on p.oid = f.oid, aclexplode(p.proacl) a
           where a.grantee = 0), 0, 'public 函式 ACL 沒有 PUBLIC 的任何權限');
select is((select count(*)::int from h23_rels t join pg_class c on c.oid = t.oid, aclexplode(c.relacl) a
           where a.grantee = 0), 0, 'public 關聯 ACL 沒有 PUBLIC 的任何權限');
select is((select count(*)::int from h23_seqs s join pg_class c on c.oid = s.oid, aclexplode(c.relacl) a
           where a.grantee = 0), 0, 'public 序列 ACL 沒有 PUBLIC 的任何權限');

-- ── 3. authenticated 允許清單精確相等（84 支：68 支來源與理由見 migration 檔頭＋P5c update_project_anchors＋P4b 20260919140000 十支估驗 RPC＋P3c create_inspection_form_draft＋P3e set_intake_shared_input／list_intake_shared_inputs＋P3f discard_field_document＋P5e get_project_warranty）─
select is(
  (select string_agg(proname, ',' order by proname collate "C") from h23_fns
    where has_function_privilege('authenticated', oid, 'EXECUTE')),
  'add_member_by_email,admin_adjust_valuation_item,admin_ai_usage_by_feature,admin_ai_usage_by_project,admin_ai_usage_by_user,'
  'admin_ai_usage_daily,admin_ai_usage_overview,admin_list_projects_for_ai,admin_override,'
  'admin_set_feature_enabled,admin_set_feature_min_plan,admin_set_project_override,admin_set_project_plan,'
  'ai_feature_allowed,can_access_contract_package,can_access_contractor_private,can_manage_documents,'
  'can_read_audit_entity,can_read_contract_package,can_read_document_version,can_read_field_document,'
  'can_read_project_document,can_read_requirement_provenance,can_read_requirement_row,can_read_requirement_scope,'
  'can_review_requirement,can_upload_contract_package,can_write,can_write_document,can_write_document_version,'
  'can_write_project_document,create_inspection_form_draft,create_project,delete_document,delete_project,discard_field_document,ensure_project_identity,'
  'fn_field_document_owner_org,fn_field_document_target_table,fn_field_document_template,get_project_warranty,get_valuation_state,import_work_items,'
  'is_platform_admin,is_project_admin,is_project_admin_v2,is_project_member,is_project_member_v2,'
  'issue_supervisor_certificate,list_billable_backlog,list_intake_shared_inputs,list_project_members,log_document_access,materialize_obligation_periods,my_org_type,my_party,'
  'my_project_ids,my_project_ids_v2,my_project_membership,my_project_party_type,my_project_role,'
  'obligation_party,photo_storage_path_in_use,portfolio_summary,receive_field_document,remove_member,'
  'reset_project_boq,resolve_agent_action,return_field_document,review_requirement,revoke_inspection_confirmation,'
  'save_field_document_version,set_intake_shared_input,set_valuation_item_cum,set_work_item_pricing_basis,shares_project_with,sign_field_document,storage_path_in_use,'
  'submit_field_document,sync_valuation_from_confirmations,transition_obligation_period,transition_valuation,update_project_anchors,void_valuation_adjustment',
  'authenticated 可執行的函式＝允許清單（新 RPC 要在 migration 明示 grant 並加進這裡）');
select is((select count(*)::int from h23_fns where is_trigger and has_function_privilege('authenticated', oid, 'EXECUTE')), 0,
  'trigger 函式一律不給 authenticated EXECUTE（觸發不需要，直接呼叫沒有用途）');
select is((select bool_and(has_function_privilege('service_role', oid, 'EXECUTE')) from h23_fns
           where proname in ('ai_feature_allowed', 'record_ai_usage', 'apply_transcription_triage', 'list_project_members', 'my_org_type')),
  true, 'Edge service client 會呼叫的五支 RPC，service_role 的 EXECUTE 保留（本機由 migration 明示對齊 hosted）');

-- ── 4. default privileges（pg_default_acl 內容）──────────────────────────────────────
select is((select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
           where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
             and d.defaclobjtype = 'r' and (a.grantee = 0 or a.grantee = 'anon'::regrole)), 0,
  'default ACL（public，tables）：anon 與 PUBLIC 什麼都沒有');
select is((select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
           where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
             and d.defaclobjtype = 'S' and (a.grantee = 0 or a.grantee = 'anon'::regrole)), 0,
  'default ACL（public，sequences）：anon 與 PUBLIC 什麼都沒有');
select is((select count(*)::int from pg_default_acl d
           where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
             and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0)), 1,
  'default ACL（全域，functions）：postgres 有一列且不含 PUBLIC——內建的 PUBLIC EXECUTE 已被覆蓋');
select is((select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
           where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
             and d.defaclobjtype = 'f'
             and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)), 0,
  'default ACL（public，functions）：anon／authenticated／PUBLIC 都沒有 EXECUTE');
select is((select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
           where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
             and d.defaclobjtype = 'f' and a.grantee = 'service_role'::regrole and a.privilege_type = 'EXECUTE'), 1,
  'default ACL（public，functions）：service_role 維持 hosted 平台預設（本機由 seed.sql 對齊；它繞過 RLS，DML 會撞到欄位 default 用的函式）');
select is((select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
           where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'extensions'::regnamespace
             and d.defaclobjtype = 'f' and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 1,
  'default ACL（extensions，functions）：PUBLIC EXECUTE 補回，維持 PostgreSQL 內建預設');

-- ── 5. 測試內新建：表／序列／函式的 default privileges 真的生效 ───────────────────────
create table public.h23_probe (id int primary key, note text);
select is(has_table_privilege('anon', 'public.h23_probe', 'SELECT') or has_table_privilege('anon', 'public.h23_probe', 'INSERT')
  or has_table_privilege('anon', 'public.h23_probe', 'UPDATE') or has_table_privilege('anon', 'public.h23_probe', 'DELETE'), false,
  '新建表：anon 沒有自動拿到 SELECT／INSERT／UPDATE／DELETE');
select is(has_table_privilege('authenticated', 'public.h23_probe', 'SELECT') and has_table_privilege('authenticated', 'public.h23_probe', 'INSERT')
  and has_table_privilege('authenticated', 'public.h23_probe', 'UPDATE') and has_table_privilege('authenticated', 'public.h23_probe', 'DELETE'), true,
  '新建表：authenticated 的 DML default（基線 20260712001200）照舊——新表仍要在 migration 內收窄');
select is(has_table_privilege('service_role', 'public.h23_probe', 'SELECT') and has_table_privilege('service_role', 'public.h23_probe', 'INSERT'), true,
  '新建表：service_role 的 DML default 照舊（Edge service client 路徑不變）');
create sequence public.h23_seq;
select is(has_sequence_privilege('anon', 'public.h23_seq', 'SELECT') or has_sequence_privilege('anon', 'public.h23_seq', 'USAGE')
  or has_sequence_privilege('anon', 'public.h23_seq', 'UPDATE'), false, '新建序列：anon 沒有自動拿到任何權限');
create function public.h23_fn() returns int language sql as 'select 1';
select is(has_function_privilege('anon', 'public.h23_fn()', 'EXECUTE') or has_function_privilege('authenticated', 'public.h23_fn()', 'EXECUTE')
  or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.h23_fn()'::regprocedure and a.grantee = 0), false,
  '新建函式：anon／authenticated／PUBLIC 都不可執行——要給 authenticated 用就得明示 grant');
select is(has_function_privilege('service_role', 'public.h23_fn()', 'EXECUTE'), true,
  '新建函式：service_role 照平台預設可執行（伺服器端信任邊界；本機由 seed.sql 對齊）');
create function extensions.h23_ext_fn() returns int language sql as 'select 1';
select is(has_function_privilege('authenticated', 'extensions.h23_ext_fn()', 'EXECUTE'), true,
  'extensions schema 的新函式維持 PostgreSQL 內建預設（PUBLIC 可執行）');
drop function extensions.h23_ext_fn();
drop function public.h23_fn();
drop sequence public.h23_seq;

-- trigger 觸發不檢查呼叫者對 trigger 函式的 EXECUTE：authenticated 對新建的 trigger 函式沒有 EXECUTE，
-- 但 INSERT 仍會觸發它（這就是 handle_new_user／各 guard 在收回 PUBLIC 之後照常運作的依據）。
create function public.h23_trig_fn() returns trigger language plpgsql security definer set search_path = public as $$
begin raise exception 'H23_TRIGGER_FIRED' using errcode = 'P0001'; end $$;
create trigger h23_trig_bi before insert on public.h23_probe for each row execute function public.h23_trig_fn();
select is(has_function_privilege('authenticated', 'public.h23_trig_fn()', 'EXECUTE'), false,
  '新建 trigger 函式：authenticated 沒有 EXECUTE');
set local role authenticated;
select throws_ok($$ insert into public.h23_probe (id) values (1) $$, 'P0001', 'H23_TRIGGER_FIRED',
  'authenticated 的 INSERT 仍觸發沒有 EXECUTE 的 trigger 函式');
reset role;
drop table public.h23_probe;
drop function public.h23_trig_fn();

-- ── 6. 行為 ───────────────────────────────────────────────────────────────────────────
set local role anon;
select throws_ok($$ select count(*) from public.projects $$, '42501', null, 'anon SELECT projects 被表級權限擋');
select throws_ok($$ select count(*) from public.authoritative_requirements $$, '42501', null, 'anon SELECT view 被擋');
select throws_ok($$ insert into public.profiles (id, full_name) values (gen_random_uuid(), 'x') $$, '42501', null, 'anon INSERT profiles 被擋');
select throws_ok($$ select nextval('public.ai_usage_events_id_seq') $$, '42501', null, 'anon nextval 序列被擋');
select throws_ok($$ select public.my_project_ids() $$, '42501', null, 'anon 不可執行 my_project_ids（security definer）');
select throws_ok($$ select public.is_project_member(gen_random_uuid()) $$, '42501', null, 'anon 不可執行 is_project_member');
reset role;

set local role authenticated;
select lives_ok($$ select public.my_project_ids() $$, 'authenticated 可執行允許清單內的 my_project_ids');
select lives_ok($$ select count(*) from public.projects $$, 'authenticated 走 policy（my_project_ids）讀 projects 照常');
select throws_ok($$ select public.acceptance_events_guard() $$, '42501', null, 'authenticated 不可直接呼叫 trigger 函式');
select throws_ok($$ select public.transcription_doubts(gen_random_uuid()) $$, '42501', null, 'authenticated 不可執行只供內部呼叫的 transcription_doubts');
select throws_ok($$ select public.evidence_delete_bypass(gen_random_uuid()) $$, '42501', null, 'authenticated 不可執行只供 guard 呼叫的 evidence_delete_bypass');
reset role;

set local role service_role;
select lives_ok($$ select public.ai_feature_allowed(null, 'reminder.daily') $$, 'service_role 的 ai_feature_allowed 照常（send-reminders 路徑）');
reset role;

select * from finish();
rollback;
