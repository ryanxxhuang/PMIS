-- Migration: acceptance_events 階段×專案角色 RBAC(additive,不動既有資料)
-- 與 supabase/schema.sql「驗收事件 RBAC」段逐字一致;先套 staging 驗證再上 production。
-- ── 驗收事件 RBAC:階段×專案角色 + 他方原始事件保護 + 更正稽核 ────────────────
-- 規則(伺服器強制;前端 can 只是 UX):
--   report/fix=施工廠商;confirm/reinspect=監造或機關;
--   initial/final/certificate=機關承辦(授權主驗=專案管理者亦可);warranty=機關。
--   未知階段一律拒絕。非建立者不可覆寫/刪除「他方」(不同 org)建立的事件——
--   專案管理者也不例外(跨方原始紀錄完整性優先於管理便利)。
--   更正(UPDATE)與撤銷(DELETE)由 trigger 寫入 acceptance_event_audits。
--   專案刪除的 cascade 一律放行(以「父專案列已不存在」判定;pg_trigger_depth 對
--   RI cascade 不可靠,已實測),勿重演「專案刪不掉」事故。

create or replace function public.acceptance_stage_allowed(p_stage text, p_org text)
returns boolean language sql immutable as $$
  select case p_stage
    when 'report'      then p_org = 'contractor'
    when 'confirm'     then p_org in ('supervisor','owner')
    when 'initial'     then p_org = 'owner'
    when 'fix'         then p_org = 'contractor'
    when 'reinspect'   then p_org in ('supervisor','owner')
    when 'final'       then p_org = 'owner'
    when 'certificate' then p_org = 'owner'
    when 'warranty'    then p_org = 'owner'
    else false
  end
$$;

create or replace function public.acceptance_stage_owner_desc(p_stage text)
returns text language sql immutable as $$
  select case p_stage
    when 'report' then '施工廠商' when 'fix' then '施工廠商'
    when 'confirm' then '監造或機關' when 'reinspect' then '監造或機關'
    else '機關承辦(或授權主驗=專案管理者)'
  end
$$;

create or replace function public.acceptance_events_guard()
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

  if tg_op = 'INSERT' and new.stage_key not in
    ('report','confirm','initial','fix','reinspect','final','certificate','warranty') then
    raise exception '未知的驗收階段「%」', new.stage_key;
  end if;

  -- (1) 他方原始事件保護:非建立者不可覆寫/刪除不同 org 建立的事件(管理者也不例外)
  if tg_op in ('UPDATE','DELETE') and old.created_by is not null and old.created_by <> uid then
    select p.org_type into creator_org from public.profiles p where p.id = old.created_by;
    if creator_org is not null and creator_org is distinct from public.my_org_type() then
      raise exception '不可覆寫或刪除他方登錄的驗收事件;如需更正請由原登錄方(%)辦理',
        case creator_org when 'contractor' then '施工廠商'
                         when 'supervisor' then '監造' else '機關' end;
    end if;
  end if;

  -- (2) 事件身分欄位不可變更(改階段=撤銷後重登,稽核軌跡才完整)
  if tg_op = 'UPDATE' and (
       new.stage_key  is distinct from old.stage_key
    or new.project_id is distinct from old.project_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception '驗收事件的階段/專案/建立者不可變更;請撤銷後重新登錄';
  end if;

  -- (3) 階段×角色矩陣;專案管理者=授權主驗,放行全部階段
  if not public.is_project_admin(r.project_id)
     and not public.acceptance_stage_allowed(r.stage_key, public.my_org_type()) then
    raise exception '驗收階段「%」僅限%登錄/異動',
      r.stage_key, public.acceptance_stage_owner_desc(r.stage_key);
  end if;

  -- (4) 登錄者即建立者,不可冒名
  if tg_op = 'INSERT' then new.created_by := uid; end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists acceptance_events_guard on public.acceptance_events;
create trigger acceptance_events_guard before insert or update or delete on public.acceptance_events
  for each row execute function public.acceptance_events_guard();

-- 更正/撤銷稽核:登入者唯讀(select 限專案成員),寫入僅由 trigger(security definer)。
create table if not exists public.acceptance_event_audits (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  acceptance_event_id uuid not null,   -- 不掛 FK:事件刪除後稽核仍須留存
  action              text not null check (action in ('correct','delete')),
  stage_key           text not null,
  old_row             jsonb not null,
  new_row             jsonb,           -- delete 時為 null
  acted_by            uuid references auth.users(id),
  acted_at            timestamptz not null default now()
);
create index if not exists acceptance_event_audits_project_idx
  on public.acceptance_event_audits(project_id);
alter table public.acceptance_event_audits enable row level security;
drop policy if exists "acceptance_event_audits_select" on public.acceptance_event_audits;
create policy "acceptance_event_audits_select" on public.acceptance_event_audits
  for select to authenticated
  using (project_id in (select public.my_project_ids()));
-- 刻意不開 insert/update/delete policy → RLS 預設拒絕,稽核不可竄改。

create or replace function public.acceptance_events_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 專案刪除的 cascade 不記:父專案列已刪,寫稽核會踩 FK;稽核列本身也隨專案 cascade 刪
  if not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);
  end if;
  insert into public.acceptance_event_audits
    (project_id, acceptance_event_id, action, stage_key, old_row, new_row, acted_by)
  values (
    old.project_id, old.id,
    case tg_op when 'UPDATE' then 'correct' else 'delete' end,
    old.stage_key, to_jsonb(old),
    case tg_op when 'UPDATE' then to_jsonb(new) else null end,
    auth.uid()
  );
  return coalesce(new, old);
end; $$;
drop trigger if exists acceptance_events_audit on public.acceptance_events;
create trigger acceptance_events_audit after update or delete on public.acceptance_events
  for each row execute function public.acceptance_events_audit();

