-- P0 恢復批2(P0-05):自 ba8a5ec 取回(supabase/migrations/20260710000400),重新編號部署。
-- 修改(相對原版):guard_audit_event_immutability 改為無條件 append-only——
--   service role 走一般 API(auth.uid() is null)也不得改寫歷史;唯一放行=專案刪除
--   cascade(以「父專案列已不存在」判定)。維護性修正需明確 disable trigger(DBA 邊界)。
--   原版豁免 uid-null 會讓 service key 靜默改史;且無條件 raise 會擋專案刪除 cascade(P0 事故類型)。
-- 依賴前移:record_audit_event 引用 project_parties.is_active(原屬 P0-03/04,批 3 未恢復)。
--   以 additive 一行補上(預設 true=現有 parties 全部有效);批 3 的 add column if not exists 將無害跳過。
alter table public.project_parties add column if not exists is_active boolean not null default true;
-- P0-05 - Persistent append-only project audit events.
-- Critical events are emitted by database triggers in the same transaction as
-- the authoritative row change. The browser has read-only project-scoped
-- access and cannot manufacture, edit, or delete evidence.

-- -- P0-05 §1: append-only event domain -------------------------------------
create table if not exists public.audit_events (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  actor_user_id          uuid,
  actor_project_party_id uuid,
  actor_party_type       text,
  actor_project_role     text,
  actor_is_project_admin boolean,
  event_type             text not null check (btrim(event_type) <> ''),
  entity_type            text not null check (btrim(entity_type) <> ''),
  entity_id              uuid,
  action                 text not null check (btrim(action) <> ''),
  before_data            jsonb,
  after_data             jsonb,
  metadata               jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  correlation_id         uuid,
  occurred_at            timestamptz not null default now()
);

create index if not exists audit_events_project_time_idx
  on public.audit_events(project_id, occurred_at desc);
create index if not exists audit_events_entity_time_idx
  on public.audit_events(project_id, entity_type, entity_id, occurred_at desc);
create index if not exists audit_events_actor_time_idx
  on public.audit_events(project_id, actor_user_id, occurred_at desc);
create index if not exists audit_events_type_time_idx
  on public.audit_events(project_id, event_type, occurred_at desc);
create index if not exists audit_events_correlation_idx
  on public.audit_events(correlation_id) where correlation_id is not null;

alter table public.audit_events enable row level security;
drop policy if exists "audit_events_select" on public.audit_events;
create policy "audit_events_select" on public.audit_events for select to authenticated
  using (project_id in (select public.my_project_ids()));

-- There are deliberately no INSERT / UPDATE / DELETE policies. Revoke the
-- table privileges too; SECURITY DEFINER trigger functions remain the only
-- application path that can append an event.
revoke insert, update, delete on public.audit_events from public, anon, authenticated;
grant select on public.audit_events to authenticated;

-- 無條件 append-only:authenticated 與 service role(uid null)一律不得 update/delete。
-- 唯一放行=專案刪除 cascade(父專案列已不存在);維護性修正需明確 disable trigger(DBA 邊界)。
create or replace function public.guard_audit_event_immutability()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return old; -- 專案刪除 cascade:稽核列隨案刪除
  end if;
  raise exception 'audit events are append-only';
end; $$;
drop trigger if exists audit_events_immutable on public.audit_events;
create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function public.guard_audit_event_immutability();
revoke all on function public.guard_audit_event_immutability()
  from public, anon, authenticated;

-- -- P0-05 §2: controlled insertion + actor-at-time snapshot ----------------
create or replace function public.record_audit_event(
  p_project uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_before jsonb,
  p_after jsonb,
  p_metadata jsonb,
  p_correlation uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  actor_uid uuid := auth.uid();
  actor_project_party_id uuid;
  actor_party_type text;
  actor_project_role text;
  actor_is_admin boolean;
  event_id uuid;
  event_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  -- During project deletion, child cascades must not create transient audit
  -- rows against a parent that is already disappearing.
  if p_project is null or not exists (
    select 1 from public.projects p where p.id = p_project
  ) then
    return null;
  end if;

  if actor_uid is null then
    event_metadata := event_metadata || jsonb_build_object('actor_kind', 'system');
  else
    select m.project_party_id, pp.party_type, m.project_role,
           m.is_project_admin
      into actor_project_party_id, actor_party_type, actor_project_role,
           actor_is_admin
    from public.project_memberships m
    join public.project_parties pp on pp.id = m.project_party_id
    where m.project_id = p_project
      and m.user_id = actor_uid
      and pp.is_active
    limit 1;

    event_metadata := event_metadata || jsonb_build_object(
      'actor_kind',
      case when actor_project_party_id is null
        then 'authenticated_unresolved' else 'project_member' end
    );
  end if;

  insert into public.audit_events (
    project_id, actor_user_id, actor_project_party_id, actor_party_type,
    actor_project_role, actor_is_project_admin, event_type, entity_type,
    entity_id, action, before_data, after_data, metadata, correlation_id
  ) values (
    p_project, actor_uid, actor_project_party_id, actor_party_type,
    actor_project_role, actor_is_admin, p_event_type, p_entity_type,
    p_entity_id, p_action, p_before, p_after, event_metadata, p_correlation
  ) returning id into event_id;

  return event_id;
end; $$;
revoke all on function public.record_audit_event(
  uuid, text, text, uuid, text, jsonb, jsonb, jsonb, uuid
) from public, anon, authenticated;

-- -- P0-05 §3: focused semantic workflow triggers ---------------------------
create or replace function public.audit_valuation_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  event_name text;
  event_action text;
  payment_fields text[] := array[]::text[];
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'valuation.created',
      'valuation', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'valuation.deleted',
      'valuation', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;

  if new.status is distinct from old.status then
    if old.status = '草稿' and new.status in ('送審','監造審核') then
      event_name := 'valuation.submitted'; event_action := 'submitted';
    elsif old.status in ('送審','監造審核','已核定') and new.status = '草稿' then
      event_name := 'valuation.returned'; event_action := 'returned';
    elsif new.status = '已核定' then
      event_name := 'valuation.approved'; event_action := 'approved';
    elsif old.status = '已核定' and new.status = '已請款' then
      event_name := 'valuation.claimed'; event_action := 'claimed';
    end if;
    if event_name is not null then
      perform public.record_audit_event(new.project_id, event_name,
        'valuation', new.id, event_action, to_jsonb(old), to_jsonb(new),
        '{}'::jsonb, null);
    end if;
  end if;

  if new.invoice_date is distinct from old.invoice_date then
    payment_fields := array_append(payment_fields, 'invoice_date');
  end if;
  if new.paid_date is distinct from old.paid_date then
    payment_fields := array_append(payment_fields, 'paid_date');
  end if;
  if new.paid_amount is distinct from old.paid_amount then
    payment_fields := array_append(payment_fields, 'paid_amount');
  end if;
  if cardinality(payment_fields) > 0 then
    perform public.record_audit_event(new.project_id, 'valuation.payment_updated',
      'valuation', new.id, 'payment_updated', to_jsonb(old), to_jsonb(new),
      jsonb_build_object('changed_fields', payment_fields), null);
  end if;
  return new;
end; $$;
drop trigger if exists valuations_audit_event on public.valuations;
create trigger valuations_audit_event after insert or update or delete on public.valuations
  for each row execute function public.audit_valuation_event();

create or replace function public.audit_inspection_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'inspection.created',
      'inspection', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'inspection.deleted',
      'inspection', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if old.status in ('合格','不合格') and new.status = '待查驗' then
    perform public.record_audit_event(new.project_id, 'inspection.reopened',
      'inspection', new.id, 'reopened', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  elsif new.status in ('合格','不合格') and (
       new.status is distinct from old.status
    or new.result_note is distinct from old.result_note
    or new.inspected_by is distinct from old.inspected_by
    or new.inspected_at is distinct from old.inspected_at
  ) then
    perform public.record_audit_event(new.project_id, 'inspection.decided',
      'inspection', new.id, 'decided', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists inspections_audit_event on public.inspections;
create trigger inspections_audit_event after insert or update or delete on public.inspections
  for each row execute function public.audit_inspection_event();

create or replace function public.audit_defect_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'defect.created',
      'defect', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'defect.deleted',
      'defect', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if old.status <> '已結案' and new.status = '已結案' then
    perform public.record_audit_event(new.project_id, 'defect.closed',
      'defect', new.id, 'closed', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  elsif old.status = '已結案' and new.status <> '已結案' then
    perform public.record_audit_event(new.project_id, 'defect.reopened',
      'defect', new.id, 'reopened', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  elsif new.status is distinct from old.status
     or new.improvement_note is distinct from old.improvement_note then
    perform public.record_audit_event(new.project_id, 'defect.remediation_updated',
      'defect', new.id, 'remediation_updated', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists defects_audit_event on public.defects;
create trigger defects_audit_event after insert or update or delete on public.defects
  for each row execute function public.audit_defect_event();

create or replace function public.audit_submittal_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_name text; event_action text;
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'submittal.created',
      'submittal', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'submittal.deleted',
      'submittal', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if new.status is distinct from old.status then
    if old.status = '退回補正' and new.status = '已提送' then
      event_name := 'submittal.resubmitted'; event_action := 'resubmitted';
    elsif new.status = '核准' then
      event_name := 'submittal.approved'; event_action := 'approved';
    elsif new.status = '核備' then
      event_name := 'submittal.approved_as_noted'; event_action := 'approved_as_noted';
    elsif new.status = '退回補正' then
      event_name := 'submittal.returned'; event_action := 'returned';
    elsif new.status = '駁回' then
      event_name := 'submittal.rejected'; event_action := 'rejected';
    end if;
  end if;
  if event_name is not null then
    perform public.record_audit_event(new.project_id, event_name, 'submittal',
      new.id, event_action, to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists submittals_audit_event on public.submittals;
create trigger submittals_audit_event after insert or update or delete on public.submittals
  for each row execute function public.audit_submittal_event();

create or replace function public.audit_rfi_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'rfi.created', 'rfi',
      new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'rfi.deleted', 'rfi',
      old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if old.status <> '已結案' and new.status = '已結案' then
    perform public.record_audit_event(new.project_id, 'rfi.closed', 'rfi',
      new.id, 'closed', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  elsif (old.status <> '已回覆' and new.status = '已回覆')
     or new.answer is distinct from old.answer
     or new.answered_date is distinct from old.answered_date then
    perform public.record_audit_event(new.project_id, 'rfi.answered', 'rfi',
      new.id, 'answered', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists rfis_audit_event on public.rfis;
create trigger rfis_audit_event after insert or update or delete on public.rfis
  for each row execute function public.audit_rfi_event();

create or replace function public.audit_change_order_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_name text; event_action text;
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'change_order.created',
      'change_order', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'change_order.deleted',
      'change_order', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if new.status is distinct from old.status then
    if old.status = '提出' and new.status = '審核中' then
      event_name := 'change_order.review_started'; event_action := 'review_started';
    elsif old.status = '審核中' and new.status = '提出' then
      event_name := 'change_order.returned'; event_action := 'returned';
    elsif old.status = '審核中' and new.status = '核准' then
      event_name := 'change_order.approved'; event_action := 'approved';
    elsif old.status = '審核中' and new.status = '駁回' then
      event_name := 'change_order.rejected'; event_action := 'rejected';
    elsif old.status = '核准' and new.status = '審核中' then
      event_name := 'change_order.ratification_reopened'; event_action := 'ratification_reopened';
    end if;
  end if;
  if event_name is not null then
    perform public.record_audit_event(new.project_id, event_name,
      'change_order', new.id, event_action, to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists change_orders_audit_event on public.change_orders;
create trigger change_orders_audit_event after insert or update or delete on public.change_orders
  for each row execute function public.audit_change_order_event();

create or replace function public.audit_requirement_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_name text; event_action text;
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'requirement.created',
      'requirement', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'requirement.deleted',
      'requirement', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      event_name := 'requirement.approved'; event_action := 'approved';
    elsif new.status = 'rejected' then
      event_name := 'requirement.rejected'; event_action := 'rejected';
    elsif new.status = 'superseded' then
      event_name := 'requirement.superseded'; event_action := 'superseded';
    end if;
  end if;
  if event_name is not null then
    perform public.record_audit_event(new.project_id, event_name,
      'requirement', new.id, event_action, to_jsonb(old), to_jsonb(new),
      jsonb_build_object('responsible_project_party_id', new.responsible_project_party_id), null);
  end if;
  return new;
end; $$;
drop trigger if exists requirements_audit_event on public.requirements;
create trigger requirements_audit_event after insert or update or delete on public.requirements
  for each row execute function public.audit_requirement_event();

create or replace function public.audit_document_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit_event(new.project_id, 'document.created',
    'document', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
  return new;
end; $$;
drop trigger if exists documents_audit_event on public.documents;
create trigger documents_audit_event after insert on public.documents
  for each row execute function public.audit_document_event();

create or replace function public.audit_document_version_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select d.project_id into pid from public.documents d where d.id = new.document_id;
  perform public.record_audit_event(pid, 'document.version_created',
    'document_version', new.id, 'version_created', null, to_jsonb(new),
    jsonb_build_object(
      'document_id', new.document_id,
      'version_label', new.version_label,
      'revision_number', new.revision_number,
      'original_filename', new.original_filename,
      'checksum', new.checksum
    ), null);
  return new;
end; $$;
drop trigger if exists document_versions_audit_event on public.document_versions;
create trigger document_versions_audit_event after insert on public.document_versions
  for each row execute function public.audit_document_version_event();

create or replace function public.audit_project_party_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'project_party.created',
      'project_party', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
  elsif old.is_active and not new.is_active then
    perform public.record_audit_event(new.project_id, 'project_party.deactivated',
      'project_party', new.id, 'deactivated', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  elsif new.party_type is distinct from old.party_type
     or new.display_name is distinct from old.display_name
     or new.organization_id is distinct from old.organization_id
     or new.is_active is distinct from old.is_active then
    perform public.record_audit_event(new.project_id, 'project_party.updated',
      'project_party', new.id, 'updated', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists project_parties_audit_event on public.project_parties;
create trigger project_parties_audit_event after insert or update on public.project_parties
  for each row execute function public.audit_project_party_event();

create or replace function public.audit_project_membership_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'project_membership.created',
      'project_membership', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'project_membership.removed',
      'project_membership', old.id, 'removed', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if new.project_role is distinct from old.project_role
     or new.project_party_id is distinct from old.project_party_id then
    perform public.record_audit_event(new.project_id, 'project_membership.role_changed',
      'project_membership', new.id, 'role_changed', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  if new.is_project_admin is distinct from old.is_project_admin then
    perform public.record_audit_event(new.project_id, 'project_membership.admin_changed',
      'project_membership', new.id, 'admin_changed', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists project_memberships_audit_event on public.project_memberships;
-- BEFORE preserves the actor's pre-change membership when an admin demotes or
-- removes themselves. Any later guard failure rolls the event back atomically.
create trigger project_memberships_audit_event before insert or update or delete on public.project_memberships
  for each row execute function public.audit_project_membership_event();

create or replace function public.audit_acceptance_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'acceptance.stage_recorded',
      'acceptance_event', new.id, 'stage_recorded', null, to_jsonb(new),
      jsonb_build_object('stage_key', new.stage_key), null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'acceptance.stage_removed',
      'acceptance_event', old.id, 'stage_removed', to_jsonb(old), null,
      jsonb_build_object('stage_key', old.stage_key), null);
    return old;
  end if;
  if to_jsonb(new) is distinct from to_jsonb(old) then
    perform public.record_audit_event(new.project_id, 'acceptance.stage_updated',
      'acceptance_event', new.id, 'stage_updated', to_jsonb(old), to_jsonb(new),
      jsonb_build_object('stage_key', new.stage_key), null);
  end if;
  return new;
end; $$;
drop trigger if exists acceptance_events_audit_event on public.acceptance_events;
create trigger acceptance_events_audit_event after insert or update or delete on public.acceptance_events
  for each row execute function public.audit_acceptance_event();

do $$
declare fn text;
begin
  foreach fn in array array[
    'audit_valuation_event','audit_inspection_event','audit_defect_event',
    'audit_submittal_event','audit_rfi_event','audit_change_order_event',
    'audit_requirement_event','audit_document_event',
    'audit_document_version_event','audit_project_party_event',
    'audit_project_membership_event','audit_acceptance_event'
  ] loop
    execute format('revoke all on function public.%I() from public, anon, authenticated', fn);
  end loop;
end $$;

-- No trigger is installed on cost_items. Contractor cost, margin, and
-- subcontract values are intentionally excluded from the shared audit stream.
-- Correlation IDs remain null until a controlled request context exists.
-- -- End P0-05 audit events -------------------------------------------------
