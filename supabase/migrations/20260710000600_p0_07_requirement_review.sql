-- P0-07 - Requirement review and artifact link boundary.
-- Human review is the only path from AI suggestion to contractual authority:
-- lifecycle decisions flow through a controlled review action that stamps the
-- reviewer and time server-side, AI approval requires a completed ingestion
-- run, citation edits can never keep a stale verified flag, and the approved
-- Requirement becomes the explicit boundary for downstream workflow artifacts.

-- -- P0-07 §1: BOQ candidate link review state --------------------------------
-- review_status is the canonical review state of a requirement -> work-item
-- link. The P0-01 `reviewed` boolean is kept as a derived compatibility field
-- (reviewed = review_status = 'approved') so older writers and readers cannot
-- drift from the new model; a writer that only sets the legacy boolean still
-- resolves to the right state. Decision authority stays with Requirement
-- reviewers (P0-03 RLS on requirement_work_items), and an application user
-- can never insert an AI suggestion that is already approved.
alter table public.requirement_work_items
  add column if not exists review_status text not null default 'suggested'
    check (review_status in ('suggested','approved','rejected'));

create or replace function public.sync_requirement_work_item_review_state()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.reviewed and new.review_status = 'suggested' then
      new.review_status := 'approved'; -- legacy boolean-only writer
    end if;
    if auth.uid() is not null and new.match_type = 'ai'
       and new.review_status <> 'suggested' then
      raise exception 'AI work-item suggestions must start as suggested';
    end if;
  else
    if new.review_status is not distinct from old.review_status
       and new.reviewed is distinct from old.reviewed then
      new.review_status := case when new.reviewed then 'approved' else 'suggested' end;
    end if;
  end if;
  new.reviewed := (new.review_status = 'approved');
  return new;
end; $$;
drop trigger if exists requirement_work_items_review_state on public.requirement_work_items;
create trigger requirement_work_items_review_state
  before insert or update on public.requirement_work_items for each row
  execute function public.sync_requirement_work_item_review_state();

-- One-time backfill for rows created before review_status existed.
update public.requirement_work_items
  set review_status = 'approved'
  where reviewed and review_status = 'suggested';

create or replace function public.audit_requirement_work_item_link_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid; event_name text; event_action text;
begin
  select project_id into pid from public.requirements where id = new.requirement_id;
  if pid is null then return new; end if; -- parent cascade in flight
  if tg_op = 'INSERT' then
    if new.match_type <> 'ai' then
      event_name := 'requirement.work_item_link_added';
      event_action := 'work_item_link_added';
    end if;
  elsif new.review_status is distinct from old.review_status then
    if new.review_status = 'approved' then
      event_name := 'requirement.work_item_link_approved';
      event_action := 'work_item_link_approved';
    elsif new.review_status = 'rejected' then
      event_name := 'requirement.work_item_link_rejected';
      event_action := 'work_item_link_rejected';
    end if;
  end if;
  if event_name is not null then
    perform public.record_audit_event(pid, event_name, 'requirement_work_item',
      new.requirement_id, event_action,
      case when tg_op = 'INSERT' then null else to_jsonb(old) end, to_jsonb(new),
      jsonb_build_object('work_item_id', new.work_item_id, 'match_type', new.match_type),
      null);
  end if;
  return new;
end; $$;
drop trigger if exists requirement_work_items_audit_event on public.requirement_work_items;
create trigger requirement_work_items_audit_event
  after insert or update on public.requirement_work_items
  for each row execute function public.audit_requirement_work_item_link_event();
revoke all on function public.audit_requirement_work_item_link_event()
  from public, anon, authenticated;

-- -- P0-07 §2: citation mutation safety ---------------------------------------
-- source_verified is a system verdict (P0-06 deterministic verification runs
-- with no authenticated JWT). An application user can never grant it, and any
-- human edit to a citation conservatively resets it to false - a stale
-- verified flag cannot survive a changed quotation. Service-role ingestion
-- writes are untouched. The P0-03 snapshot guard fires first (alphabetical
-- trigger order), so citations of reviewed Requirements stay frozen with
-- their original error message.
create or replace function public.guard_requirement_source_verification()
returns trigger language plpgsql security definer set search_path = public as $$
declare citation_changed boolean;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.source_verified then
      raise exception 'source verification is determined by the system';
    end if;
    return new;
  end if;
  citation_changed :=
       new.document_version_id is distinct from old.document_version_id
    or new.page_number         is distinct from old.page_number
    or new.page_label          is distinct from old.page_label
    or new.section             is distinct from old.section
    or new.clause              is distinct from old.clause
    or new.source_text         is distinct from old.source_text
    or new.source_start_offset is distinct from old.source_start_offset
    or new.source_end_offset   is distinct from old.source_end_offset;
  if citation_changed then
    new.source_verified := false;
  elsif new.source_verified and not old.source_verified then
    raise exception 'source verification is determined by the system';
  end if;
  return new;
end; $$;
drop trigger if exists requirement_sources_verification_guard on public.requirement_sources;
create trigger requirement_sources_verification_guard
  before insert or update on public.requirement_sources for each row
  execute function public.guard_requirement_source_verification();
revoke all on function public.guard_requirement_source_verification()
  from public, anon, authenticated;

-- -- P0-07 §3: controlled requirement review ----------------------------------
-- Lifecycle decisions (approve / reject / supersede) exist for application
-- users only as the review_requirement action below. It stamps
-- reviewed_by/reviewed_at from the server context and marks the transaction
-- with a review context that only this SECURITY DEFINER function can set
-- (PostgREST clients cannot write arbitrary GUCs), so a direct browser PATCH
-- can neither change status nor forge review metadata. Writers without an
-- authenticated JWT (service role, migrations, legacy sync fixtures) keep
-- their P0-03 behavior - except that an AI-origin Requirement can never
-- become approved without a completed ingestion run, for any writer.
create or replace function public.requirements_snapshot_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  content_changed boolean;
  metadata_changed boolean;
  review_context boolean;
  run_status text;
begin
  if tg_op = 'UPDATE'
     and new.status = 'approved' and old.status is distinct from 'approved'
     and new.origin = 'ai' then
    if new.ingestion_run_id is not null then
      select status into run_status from public.document_ingestion_runs
        where id = new.ingestion_run_id;
    end if;
    if run_status is distinct from 'completed' then
      raise exception 'AI requirement approval requires a completed ingestion run';
    end if;
  end if;

  if auth.uid() is null then return coalesce(new, old); end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft_ai','needs_review') then
      raise exception 'requirements cannot be created directly in a reviewed status';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status not in ('draft_ai','needs_review') then
      raise exception 'reviewed requirements cannot be deleted; supersede them instead';
    end if;
    return old;
  end if;

  review_context :=
    coalesce(current_setting('pmis.requirement_review', true), '') = old.id::text;

  if new.status is distinct from old.status then
    if not public.can_review_requirement(old.project_id) then
      raise exception 'requirement lifecycle transitions require a requirement reviewer';
    end if;
    if not ((old.status in ('draft_ai','needs_review')
              and new.status in ('draft_ai','needs_review','approved','rejected'))
         or (old.status = 'approved' and new.status = 'superseded')) then
      raise exception 'invalid requirement lifecycle transition from % to %',
        old.status, new.status;
    end if;
    if not review_context then
      raise exception 'requirement lifecycle transitions require the controlled review action';
    end if;
  end if;

  metadata_changed :=
       new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_at is distinct from old.reviewed_at;
  if metadata_changed and not review_context
     and old.status in ('draft_ai','needs_review') then
    raise exception 'review metadata is stamped by the controlled review action';
  end if;

  if new.origin is distinct from old.origin
     or new.legacy_contract_obligation_id is distinct from old.legacy_contract_obligation_id then
    raise exception 'requirement origin provenance is immutable for application users';
  end if;

  content_changed :=
       new.title                  is distinct from old.title
    or new.description            is distinct from old.description
    or new.requirement_type       is distinct from old.requirement_type
    or new.responsible_party_type is distinct from old.responsible_party_type
    or new.responsible_project_party_id is distinct from old.responsible_project_party_id
    or new.lifecycle_phase        is distinct from old.lifecycle_phase
    or new.trigger_type           is distinct from old.trigger_type
    or new.trigger_config         is distinct from old.trigger_config
    or new.frequency_type         is distinct from old.frequency_type
    or new.frequency_config       is distinct from old.frequency_config
    or new.acceptance_criteria    is distinct from old.acceptance_criteria
    or new.evidence_requirement   is distinct from old.evidence_requirement
    or new.confidence             is distinct from old.confidence
    or (metadata_changed and not review_context);
  if content_changed and old.status not in ('draft_ai','needs_review') then
    raise exception 'reviewed requirement content is immutable; supersede and create a new requirement';
  end if;
  return new;
end; $$;
drop trigger if exists requirements_snapshot_guard on public.requirements;
create trigger requirements_snapshot_guard before insert or update or delete on public.requirements
  for each row execute function public.requirements_snapshot_guard();

-- The one controlled review action. Narrow decisions, server-derived project,
-- server-stamped actor/time; the caller supplies nothing but the requirement
-- and the decision. Returns the updated row so the UI refreshes from the
-- server instead of optimistically displaying approval.
create or replace function public.review_requirement(
  p_requirement_id uuid,
  p_decision text
) returns public.requirements
language plpgsql security definer set search_path = public as $$
declare
  req public.requirements;
  run_status text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into req from public.requirements where id = p_requirement_id;
  if not found then
    raise exception 'requirement not found';
  end if;
  if not public.can_review_requirement(req.project_id) then
    raise exception 'requirement review requires a requirement reviewer';
  end if;
  if p_decision not in ('approve','reject','supersede') then
    raise exception 'unknown review decision: %', p_decision;
  end if;
  if (p_decision in ('approve','reject') and req.status not in ('draft_ai','needs_review'))
     or (p_decision = 'supersede' and req.status <> 'approved') then
    raise exception 'invalid requirement lifecycle transition from % via %',
      req.status, p_decision;
  end if;
  if p_decision = 'approve' and req.origin = 'ai' then
    if req.ingestion_run_id is not null then
      select status into run_status from public.document_ingestion_runs
        where id = req.ingestion_run_id;
    end if;
    if run_status is distinct from 'completed' then
      raise exception 'AI requirement approval requires a completed ingestion run';
    end if;
  end if;
  perform set_config('pmis.requirement_review', req.id::text, true);
  update public.requirements
  set status = case p_decision
        when 'approve' then 'approved'
        when 'reject' then 'rejected'
        else 'superseded'
      end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = req.id
  returning * into req;
  perform set_config('pmis.requirement_review', '', true);
  return req;
end; $$;
revoke all on function public.review_requirement(uuid, text) from public, anon;
grant execute on function public.review_requirement(uuid, text) to authenticated;

-- -- P0-07 §4: approved requirement -> artifact link boundary ------------------
-- The explicit relationship between an approved Requirement and downstream
-- workflow artifacts. P0-07 creates and protects the boundary only: nothing
-- here generates inspection points, checklists, tests, or submittals, and raw
-- AI output can never activate a field workflow. 'report' has no durable
-- artifact table yet and is intentionally outside the initial vocabulary.
create table if not exists public.requirement_artifact_links (
  id              uuid primary key default gen_random_uuid(),
  requirement_id  uuid not null references public.requirements(id) on delete cascade,
  artifact_type   text not null check (artifact_type in
    ('inspection_point','checklist','test','submittal','evidence','deadline')),
  artifact_id     uuid not null,
  generation_type text not null default 'manual'
    check (generation_type in ('manual','ai_draft','migration')),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (requirement_id, artifact_type, artifact_id)
);
create index if not exists requirement_artifact_links_requirement_idx
  on public.requirement_artifact_links(requirement_id);
create index if not exists requirement_artifact_links_artifact_idx
  on public.requirement_artifact_links(artifact_type, artifact_id);

create or replace function public.validate_requirement_artifact_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  req record;
  artifact_project uuid;
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  select project_id, status into req
  from public.requirements where id = new.requirement_id;
  if req.status is distinct from 'approved' then
    raise exception 'artifact links require an approved requirement';
  end if;
  artifact_project := case new.artifact_type
    when 'inspection_point' then
      (select project_id from public.inspection_points where id = new.artifact_id)
    when 'checklist' then
      (select project_id from public.checklist_templates where id = new.artifact_id)
    when 'test' then
      (select project_id from public.test_samples where id = new.artifact_id)
    when 'submittal' then
      (select project_id from public.submittals where id = new.artifact_id)
    when 'evidence' then
      (select project_id from public.photos where id = new.artifact_id)
    when 'deadline' then
      (select project_id from public.contract_obligations where id = new.artifact_id)
  end;
  if artifact_project is null then
    raise exception 'artifact does not exist for type %', new.artifact_type;
  end if;
  if artifact_project <> req.project_id then
    raise exception 'requirement and artifact must belong to the same project';
  end if;
  return new;
end; $$;
drop trigger if exists requirement_artifact_links_validate on public.requirement_artifact_links;
create trigger requirement_artifact_links_validate
  before insert or update on public.requirement_artifact_links for each row
  execute function public.validate_requirement_artifact_link();
revoke all on function public.validate_requirement_artifact_link()
  from public, anon, authenticated;

-- Project members read links; creating/removing a Requirement -> artifact
-- relationship is a Requirement-reviewer decision (P0-07 authorization rule).
-- No UPDATE policy: a link is a point-in-time decision - delete and recreate.
alter table public.requirement_artifact_links enable row level security;
drop policy if exists "requirement_artifact_links_select" on public.requirement_artifact_links;
create policy "requirement_artifact_links_select" on public.requirement_artifact_links
  for select to authenticated using (requirement_id in (
    select id from public.requirements where project_id in (select public.my_project_ids())
  ));
drop policy if exists "requirement_artifact_links_insert" on public.requirement_artifact_links;
create policy "requirement_artifact_links_insert" on public.requirement_artifact_links
  for insert to authenticated with check (requirement_id in (
    select id from public.requirements where public.can_review_requirement(project_id)
  ));
drop policy if exists "requirement_artifact_links_delete" on public.requirement_artifact_links;
create policy "requirement_artifact_links_delete" on public.requirement_artifact_links
  for delete to authenticated using (requirement_id in (
    select id from public.requirements where public.can_review_requirement(project_id)
  ));

create or replace function public.audit_requirement_artifact_link_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select project_id into pid from public.requirements where id = new.requirement_id;
  if pid is null then return new; end if;
  perform public.record_audit_event(pid, 'requirement.artifact_link_created',
    'requirement_artifact_link', new.id, 'artifact_link_created', null, to_jsonb(new),
    jsonb_build_object(
      'requirement_id', new.requirement_id,
      'artifact_type', new.artifact_type,
      'artifact_id', new.artifact_id,
      'generation_type', new.generation_type
    ), null);
  return new;
end; $$;
drop trigger if exists requirement_artifact_links_audit_event on public.requirement_artifact_links;
create trigger requirement_artifact_links_audit_event
  after insert on public.requirement_artifact_links
  for each row execute function public.audit_requirement_artifact_link_event();
revoke all on function public.audit_requirement_artifact_link_event()
  from public, anon, authenticated;
-- -- End P0-07 requirement review ----------------------------------------------
