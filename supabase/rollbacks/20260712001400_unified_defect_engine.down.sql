-- ── 回退 20260712001400_unified_defect_engine(SQL Editor / psql 以 service role 執行)──
-- 效果:domain='safety' 的缺失整批搬回 safety_records(工安缺失),狀態反映射
--   開立→待改善、改善中→改善中、待複查→改善中(舊機無複查段)、已結案→已完成;
--   defects 引擎欄位與觸發器還原為 formal_mode(20260712001300)版;
--   safety_records_guard 還原(工安缺失類型恢復)。
-- 保留不動:defect_audits 表與其資料(稽核=證據,不刪);source_safety_record_id
--   欄位一併移除前先確認無其他相依。整段單一交易,失敗即全部回滾。
begin;

-- 搬移期間關觸發器:回退是搬家不是使用者刪除,不留 correct/delete 稽核
alter table public.safety_records disable trigger safety_records_guard;
alter table public.safety_records disable trigger safety_records_audit;
alter table public.defects        disable trigger defects_guard;
alter table public.defects        disable trigger defects_audit;

insert into public.safety_records
  (id, project_id, record_type, title, location, record_date,
   severity, status, due_date, note, correction_reason, created_by, created_at)
select
  d.id, d.project_id, '工安缺失', d.title, d.location, d.record_date,
  coalesce(d.severity, '一般'),
  case d.status when '開立'   then '待改善'
                when '改善中' then '改善中'
                when '待複查' then '改善中'
                when '已結案' then '已完成'
                else '待改善' end,
  d.due_date, d.description, d.correction_reason, d.created_by, d.created_at
from public.defects d
where d.domain = 'safety'
on conflict (id) do nothing;

delete from public.defects where domain = 'safety';

alter table public.safety_records enable trigger safety_records_guard;
alter table public.safety_records enable trigger safety_records_audit;

-- 缺失稽核觸發器除掛(defect_audits 表與既有稽核列保留)
drop trigger if exists defects_audit on public.defects;
drop function if exists public.defects_audit();

-- defects_guard 還原 formal_mode 版(僅 UPDATE、僅結案權限)
drop trigger if exists defects_guard on public.defects;
create or replace function public.defects_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.admin_override(new.project_id) then return new; end if;
  if new.status is distinct from old.status
     and (new.status = '已結案' or old.status = '已結案')
     and public.my_org_type() <> 'supervisor' then
    raise exception '缺失結案僅監造可執行';
  end if;
  return new;
end; $$;
create trigger defects_guard before update on public.defects
  for each row execute function public.defects_guard();

-- defects 引擎欄位移除(domain 先清 constraint)
alter table public.defects drop constraint if exists defects_domain_check;
alter table public.defects
  drop column if exists domain,
  drop column if exists record_date,
  drop column if exists correction_reason,
  drop column if exists source_safety_record_id;

-- safety_records_guard 還原 formal_mode(20260712001300)版:工安缺失類型恢復
create or replace function public.safety_records_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r record;
  creator_org text;
begin
  if uid is null then return coalesce(new, old); end if;
  if tg_op in ('UPDATE','DELETE')
     and not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);
  end if;
  r := coalesce(new, old);

  if tg_op = 'INSERT' and new.record_type not in
    ('自主檢查','工安缺失','教育訓練','危害告知','監造觀察','監造查驗','監造複查') then
    raise exception '未知的工安紀錄類型「%」', new.record_type;
  end if;

  if tg_op in ('UPDATE','DELETE') and old.created_by is not null and old.created_by <> uid then
    select p.org_type into creator_org from public.profiles p where p.id = old.created_by;
    if creator_org is not null and creator_org is distinct from public.my_org_type() then
      raise exception '不可改寫或刪除他方登錄的工安紀錄;如需更正請由原登錄方(%)辦理',
        case creator_org when 'contractor' then '施工廠商'
                         when 'supervisor' then '監造' else '機關' end;
    end if;
  end if;

  if tg_op = 'UPDATE' and (
       new.record_type is distinct from old.record_type
    or new.project_id  is distinct from old.project_id
    or new.created_by  is distinct from old.created_by
    or new.created_at  is distinct from old.created_at
  ) then
    raise exception '工安紀錄的類型/專案/建立者不可變更;請另建新紀錄';
  end if;

  if tg_op = 'DELETE' and old.status = '已完成' then
    raise exception '已完成的工安紀錄不可刪除;如需更正請用更正功能並註明原因';
  end if;
  if tg_op = 'UPDATE' and old.status = '已完成'
     and (new.correction_reason is null or btrim(new.correction_reason) = ''
          or new.correction_reason is not distinct from old.correction_reason) then
    raise exception '更正已完成的工安紀錄必須填寫更正原因';
  end if;

  if not public.admin_override(r.project_id)
     and not public.safety_record_type_allowed(r.record_type, public.my_org_type()) then
    raise exception '工安紀錄類型「%」僅限%登錄/異動', r.record_type,
      case when r.record_type like '監造%' then '監造' else '施工廠商' end;
  end if;

  if tg_op = 'INSERT' then new.created_by := uid; end if;
  return coalesce(new, old);
end; $$;

-- 遷移紀錄表同步移除(讓 supabase migration list 與實際 schema 一致)
delete from supabase_migrations.schema_migrations where version = '20260712001400';

commit;
