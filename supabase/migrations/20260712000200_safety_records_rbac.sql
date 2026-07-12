-- Migration: safety_records 三方資料權責 RBAC(additive,不動既有資料)
-- 與 supabase/schema.sql「工安紀錄 RBAC」段逐字一致;先本地 pgTAP 驗證再上 production。
-- ── 工安紀錄 RBAC:三方資料權責 + 已完成保護 + 更正稽核 ───────────────────────
-- 規則(伺服器強制;前端 can 只是 UX):
--   廠商=自主檢查/工安缺失/教育訓練/危害告知;監造=監造觀察/監造查驗/監造複查;
--   機關唯讀(僅 select)。未知類型一律拒絕。專案管理者放行類型矩陣(單人試用不卡死),
--   但「他方原始紀錄不可改寫/刪除」與「已完成保護」對管理者同樣生效。
--   已完成紀錄不可 DELETE;UPDATE 已完成紀錄必須填寫新的 correction_reason。
--   更正(UPDATE)與刪除(DELETE)由 trigger 寫入 safety_record_audits(含原因)。
--   select policy 一律以列欄位求值,絕不自我回查(INSERT..RETURNING 會踩 RLS)。

alter table public.safety_records add column if not exists correction_reason text;

create or replace function public.safety_record_type_allowed(p_type text, p_org text)
returns boolean language sql immutable as $$
  select case p_type
    when '自主檢查' then p_org = 'contractor'
    when '工安缺失' then p_org = 'contractor'
    when '教育訓練' then p_org = 'contractor'
    when '危害告知' then p_org = 'contractor'
    when '監造觀察' then p_org = 'supervisor'
    when '監造查驗' then p_org = 'supervisor'
    when '監造複查' then p_org = 'supervisor'
    else false
  end
$$;

create or replace function public.safety_records_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r record;
  creator_org text;
begin
  -- service role/SQL Editor/遷移放行
  if uid is null then return coalesce(new, old); end if;
  -- 專案刪除 cascade:父專案列已先刪 → 放行,勿擋整案刪除
  if tg_op in ('UPDATE','DELETE')
     and not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);
  end if;
  r := coalesce(new, old);

  if tg_op = 'INSERT' and new.record_type not in
    ('自主檢查','工安缺失','教育訓練','危害告知','監造觀察','監造查驗','監造複查') then
    raise exception '未知的工安紀錄類型「%」', new.record_type;
  end if;

  -- (1) 他方原始紀錄保護:非建立者不可改寫/刪除不同 org 建立的紀錄(管理者也不例外)
  if tg_op in ('UPDATE','DELETE') and old.created_by is not null and old.created_by <> uid then
    select p.org_type into creator_org from public.profiles p where p.id = old.created_by;
    if creator_org is not null and creator_org is distinct from public.my_org_type() then
      raise exception '不可改寫或刪除他方登錄的工安紀錄;如需更正請由原登錄方(%)辦理',
        case creator_org when 'contractor' then '施工廠商'
                         when 'supervisor' then '監造' else '機關' end;
    end if;
  end if;

  -- (2) 紀錄身分欄位不可變更
  if tg_op = 'UPDATE' and (
       new.record_type is distinct from old.record_type
    or new.project_id  is distinct from old.project_id
    or new.created_by  is distinct from old.created_by
    or new.created_at  is distinct from old.created_at
  ) then
    raise exception '工安紀錄的類型/專案/建立者不可變更;請另建新紀錄';
  end if;

  -- (3) 已完成保護:不可刪除;更正必附新原因(管理者也不例外)
  if tg_op = 'DELETE' and old.status = '已完成' then
    raise exception '已完成的工安紀錄不可刪除;如需更正請用更正功能並註明原因';
  end if;
  if tg_op = 'UPDATE' and old.status = '已完成'
     and (new.correction_reason is null or btrim(new.correction_reason) = ''
          or new.correction_reason is not distinct from old.correction_reason) then
    raise exception '更正已完成的工安紀錄必須填寫更正原因';
  end if;

  -- (4) 類型×角色矩陣;專案管理者放行(單人試用不被 org_type 卡死)
  if not public.is_project_admin(r.project_id)
     and not public.safety_record_type_allowed(r.record_type, public.my_org_type()) then
    raise exception '工安紀錄類型「%」僅限%登錄/異動', r.record_type,
      case when r.record_type like '監造%' then '監造' else '施工廠商' end;
  end if;

  -- (5) 登錄者即建立者,不可冒名
  if tg_op = 'INSERT' then new.created_by := uid; end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists safety_records_guard on public.safety_records;
create trigger safety_records_guard before insert or update or delete on public.safety_records
  for each row execute function public.safety_records_guard();

-- 更正/刪除稽核:登入者唯讀(select 限專案成員),寫入僅由 trigger(security definer)。
create table if not exists public.safety_record_audits (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  safety_record_id uuid not null,   -- 不掛 FK:紀錄刪除後稽核仍須留存
  action           text not null check (action in ('correct','delete')),
  record_type      text not null,
  reason           text,            -- 更正已完成紀錄時的必填原因
  old_row          jsonb not null,
  new_row          jsonb,           -- delete 時為 null
  acted_by         uuid references auth.users(id),
  acted_at         timestamptz not null default now()
);
create index if not exists safety_record_audits_project_idx
  on public.safety_record_audits(project_id);
alter table public.safety_record_audits enable row level security;
drop policy if exists "safety_record_audits_select" on public.safety_record_audits;
create policy "safety_record_audits_select" on public.safety_record_audits
  for select to authenticated
  using (project_id in (select public.my_project_ids()));
-- 刻意不開 insert/update/delete policy → RLS 預設拒絕,稽核不可竄改。

create or replace function public.safety_records_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 專案刪除的 cascade 不記:父專案列已刪,寫稽核會踩 FK;稽核列本身也隨專案 cascade 刪
  if not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);
  end if;
  insert into public.safety_record_audits
    (project_id, safety_record_id, action, record_type, reason, old_row, new_row, acted_by)
  values (
    old.project_id, old.id,
    case tg_op when 'UPDATE' then 'correct' else 'delete' end,
    old.record_type,
    case tg_op when 'UPDATE' then new.correction_reason else old.correction_reason end,
    to_jsonb(old),
    case tg_op when 'UPDATE' then to_jsonb(new) else null end,
    auth.uid()
  );
  return coalesce(new, old);
end; $$;
drop trigger if exists safety_records_audit on public.safety_records;
create trigger safety_records_audit after update or delete on public.safety_records
  for each row execute function public.safety_records_audit();

