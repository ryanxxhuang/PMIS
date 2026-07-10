-- P0-06 - Traceable AI document ingestion.
-- Every AI requirement-extraction attempt is recorded as a system-managed
-- ingestion run pinned to one immutable document version. AI suggestions link
-- back to the run that produced them; application users can read provenance
-- but never write or forge it. Authority still derives exclusively from
-- requirements.status = 'approved' (P0-01/P0-03 guards unchanged).

-- -- P0-06 §1: traceable document ingestion runs -----------------------------
-- One row per AI extraction attempt over an immutable document version. The
-- run answers: which version, which model/prompt, when, did it succeed, how
-- many suggestions, how many verified citations. Runs are system-managed:
-- project members read status; only the extract-requirements Edge Function
-- (service role, after verifying the caller's document permission) writes.
-- A run is provenance metadata, never contractual authority.
create table if not exists public.document_ingestion_runs (
  id                          uuid primary key default gen_random_uuid(),
  project_id                  uuid not null references public.projects(id) on delete cascade,
  document_version_id         uuid not null references public.document_versions(id) on delete cascade,
  run_type                    text not null default 'requirement_extraction'
    check (run_type in ('requirement_extraction')),
  status                      text not null default 'pending'
    check (status in ('pending','processing','completed','failed')),
  model_provider              text,
  model_name                  text,
  prompt_version              text,
  started_by                  uuid references auth.users(id) on delete set null,
  started_at                  timestamptz not null default now(),
  completed_at                timestamptz,
  input_page_count            integer
    check (input_page_count is null or input_page_count >= 0),
  extracted_requirement_count integer
    check (extracted_requirement_count is null or extracted_requirement_count >= 0),
  verified_source_count       integer
    check (verified_source_count is null or verified_source_count >= 0),
  unverified_source_count     integer
    check (unverified_source_count is null or unverified_source_count >= 0),
  error_message               text,
  metadata                    jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object')
);
create index if not exists document_ingestion_runs_project_idx
  on public.document_ingestion_runs(project_id, started_at desc);
create index if not exists document_ingestion_runs_version_idx
  on public.document_ingestion_runs(document_version_id, started_at desc);

-- Data integrity for every writer (service role included): a run is pinned to
-- one document version of its own project, forever.
create or replace function public.validate_ingestion_run_document_version()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.document_version_id is distinct from old.document_version_id then
    raise exception 'ingestion run document version is immutable';
  end if;
  if not exists (
    select 1
    from public.document_versions v
    join public.documents d on d.id = v.document_id
    where v.id = new.document_version_id and d.project_id = new.project_id
  ) then
    raise exception 'ingestion run and document version must belong to the same project';
  end if;
  return new;
end; $$;
drop trigger if exists document_ingestion_runs_same_project on public.document_ingestion_runs;
create trigger document_ingestion_runs_same_project
  before insert or update on public.document_ingestion_runs for each row
  execute function public.validate_ingestion_run_document_version();

drop trigger if exists document_ingestion_runs_project_identity_guard on public.document_ingestion_runs;
create trigger document_ingestion_runs_project_identity_guard
  before update on public.document_ingestion_runs for each row
  execute function public.guard_project_identity();

-- Members read run status; nobody writes from the browser. There are
-- deliberately no INSERT / UPDATE / DELETE policies, and the table privileges
-- are revoked as well - the Edge Function's service-role client is the only
-- application path that manages run lifecycle.
alter table public.document_ingestion_runs enable row level security;
drop policy if exists "document_ingestion_runs_select" on public.document_ingestion_runs;
create policy "document_ingestion_runs_select" on public.document_ingestion_runs
  for select to authenticated using (project_id in (select public.my_project_ids()));
revoke insert, update, delete on public.document_ingestion_runs from public, anon, authenticated;
grant select on public.document_ingestion_runs to authenticated;

-- Defense in depth mirroring audit_events: even a privileged path carrying an
-- authenticated JWT cannot manufacture or rewrite run provenance.
create or replace function public.guard_ingestion_run_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    raise exception 'document ingestion runs are system-managed';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists document_ingestion_runs_system_managed on public.document_ingestion_runs;
create trigger document_ingestion_runs_system_managed
  before insert or update or delete on public.document_ingestion_runs
  for each row execute function public.guard_ingestion_run_write();
revoke all on function public.guard_ingestion_run_write() from public, anon, authenticated;

-- -- P0-06 §2: requirement -> extraction-run provenance -----------------------
alter table public.requirements
  add column if not exists ingestion_run_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirements_ingestion_run_fk'
      and conrelid = 'public.requirements'::regclass
  ) then
    alter table public.requirements
      add constraint requirements_ingestion_run_fk
      foreign key (ingestion_run_id)
      references public.document_ingestion_runs(id) on delete set null;
  end if;
end; $$;
create index if not exists requirements_ingestion_run_idx
  on public.requirements(ingestion_run_id) where ingestion_run_id is not null;

-- Provenance is written only by the ingestion service. Application users can
-- neither claim AI-run provenance for a manual Requirement nor detach an AI
-- suggestion from the run that produced it. The same-project rule holds for
-- every writer. Requirement authority is never derived from this field.
create or replace function public.guard_requirement_ingestion_provenance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' and new.ingestion_run_id is not null then
      raise exception 'only the ingestion service can attach a requirement to an ingestion run';
    end if;
    if tg_op = 'UPDATE' and new.ingestion_run_id is distinct from old.ingestion_run_id then
      raise exception 'requirement ingestion provenance is immutable for application users';
    end if;
  end if;
  if new.ingestion_run_id is not null and not exists (
    select 1 from public.document_ingestion_runs r
    where r.id = new.ingestion_run_id and r.project_id = new.project_id
  ) then
    raise exception 'requirement and ingestion run must belong to the same project';
  end if;
  return new;
end; $$;
drop trigger if exists requirements_ingestion_provenance_guard on public.requirements;
create trigger requirements_ingestion_provenance_guard
  before insert or update on public.requirements for each row
  execute function public.guard_requirement_ingestion_provenance();

-- select * views freeze their column list at creation; refresh so approved
-- consumers also see the appended provenance column.
create or replace view public.authoritative_requirements
with (security_invoker = true) as
  select * from public.requirements where is_authoritative;

-- -- P0-06 §3: ingestion lifecycle audit events -------------------------------
-- Reuses the P0-05 transactional trigger architecture. No frontend inserts;
-- document.created / document.version_created / requirement.created already
-- flow from their own P0-05 triggers and are not duplicated here.
create or replace function public.audit_document_ingestion_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_name text; event_action text;
begin
  if tg_op = 'INSERT' then
    if new.status in ('completed','failed') then
      event_name := 'document.ingestion_' || new.status;
      event_action := 'ingestion_' || new.status;
    end if;
  elsif new.status is distinct from old.status and new.status in ('completed','failed') then
    event_name := 'document.ingestion_' || new.status;
    event_action := 'ingestion_' || new.status;
  end if;
  if event_name is not null then
    perform public.record_audit_event(new.project_id, event_name,
      'document_ingestion_run', new.id, event_action,
      case when tg_op = 'INSERT' then null else to_jsonb(old) end, to_jsonb(new),
      jsonb_build_object('document_version_id', new.document_version_id), null);
  end if;
  return new;
end; $$;
drop trigger if exists document_ingestion_runs_audit_event on public.document_ingestion_runs;
create trigger document_ingestion_runs_audit_event
  after insert or update on public.document_ingestion_runs
  for each row execute function public.audit_document_ingestion_event();
revoke all on function public.audit_document_ingestion_event() from public, anon, authenticated;
-- -- End P0-06 document ingestion ---------------------------------------------
