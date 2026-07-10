-- P0-01 - Establish the Document + Requirement Foundation
--
-- Idempotent migration for an existing PMIS database. Fresh installations
-- receive the same definitions from supabase/schema.sql.
-- -- P0-01: document + requirement foundation -------------------------------
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  document_number text,
  title           text not null,
  document_type   text not null
    check (document_type in ('contract','specification','quality_plan','itp','form_package','submittal_document','drawing','report','other')),
  discipline      text,
  status          text not null default 'active',
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists documents_project_idx on public.documents(project_id);
create index if not exists documents_project_type_idx on public.documents(project_id, document_type);

create or replace function public.touch_document_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end; $$;
drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at
  before update on public.documents for each row
  execute function public.touch_document_updated_at();

alter table public.documents enable row level security;
drop policy if exists "documents_select" on public.documents;
create policy "documents_select" on public.documents for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "documents_insert" on public.documents;
create policy "documents_insert" on public.documents for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "documents_update" on public.documents;
create policy "documents_update" on public.documents for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
-- No application DELETE policy: archive the document and retain version history.

create table if not exists public.document_versions (
  id                    uuid primary key default gen_random_uuid(),
  document_id           uuid not null references public.documents(id) on delete cascade,
  version_label         text not null,
  revision_number       int check (revision_number is null or revision_number >= 0),
  storage_path          text,
  original_filename     text,
  mime_type             text,
  file_size             bigint check (file_size is null or file_size >= 0),
  checksum              text,
  uploaded_by           uuid references auth.users(id) on delete set null,
  uploaded_at           timestamptz not null default now(),
  supersedes_version_id uuid references public.document_versions(id),
  unique (document_id, version_label)
);
create index if not exists document_versions_document_idx on public.document_versions(document_id);
create index if not exists document_versions_supersedes_idx on public.document_versions(supersedes_version_id);

create or replace function public.validate_superseded_document_version()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.supersedes_version_id is null then return new; end if;
  if new.supersedes_version_id = new.id or not exists (
    select 1 from public.document_versions previous
    where previous.id = new.supersedes_version_id
      and previous.document_id = new.document_id
  ) then
    raise exception 'superseded version must belong to the same document';
  end if;
  return new;
end; $$;
drop trigger if exists document_versions_same_document on public.document_versions;
create trigger document_versions_same_document
  before insert or update on public.document_versions for each row
  execute function public.validate_superseded_document_version();

-- Application users may correct labels/revision metadata, but changing the
-- immutable file identity always requires a new document_versions row.
create or replace function public.guard_document_version_file_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and (
       new.document_id       is distinct from old.document_id
    or new.storage_path      is distinct from old.storage_path
    or new.original_filename is distinct from old.original_filename
    or new.mime_type         is distinct from old.mime_type
    or new.file_size         is distinct from old.file_size
    or new.checksum          is distinct from old.checksum
    or new.uploaded_by       is distinct from old.uploaded_by
    or new.uploaded_at       is distinct from old.uploaded_at
  ) then
    raise exception 'document version file identity is immutable; create a new version';
  end if;
  return new;
end; $$;
drop trigger if exists document_versions_file_identity_guard on public.document_versions;
create trigger document_versions_file_identity_guard
  before update on public.document_versions for each row
  execute function public.guard_document_version_file_identity();

alter table public.document_versions enable row level security;
drop policy if exists "document_versions_select" on public.document_versions;
create policy "document_versions_select" on public.document_versions for select to authenticated
  using (document_id in (
    select id from public.documents where project_id in (select public.my_project_ids())
  ));
drop policy if exists "document_versions_insert" on public.document_versions;
create policy "document_versions_insert" on public.document_versions for insert to authenticated
  with check (document_id in (
    select id from public.documents where public.can_write(project_id)
  ));
drop policy if exists "document_versions_update" on public.document_versions;
create policy "document_versions_update" on public.document_versions for update to authenticated
  using (document_id in (
    select id from public.documents where public.can_write(project_id)
  )) with check (document_id in (
    select id from public.documents where public.can_write(project_id)
  ));
-- No application DELETE policy: immutable version history is retained.

create table if not exists public.document_pages (
  id                  uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  page_number         int not null check (page_number > 0),
  extracted_text      text not null default '',
  extraction_method   text not null default 'unknown',
  created_at          timestamptz not null default now(),
  unique (document_version_id, page_number)
);
create index if not exists document_pages_version_idx on public.document_pages(document_version_id);
alter table public.document_pages enable row level security;
drop policy if exists "document_pages_select" on public.document_pages;
create policy "document_pages_select" on public.document_pages for select to authenticated
  using (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where d.project_id in (select public.my_project_ids())
  ));
drop policy if exists "document_pages_insert" on public.document_pages;
create policy "document_pages_insert" on public.document_pages for insert to authenticated
  with check (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where public.can_write(d.project_id)
  ));
drop policy if exists "document_pages_update" on public.document_pages;
create policy "document_pages_update" on public.document_pages for update to authenticated
  using (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where public.can_write(d.project_id)
  )) with check (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where public.can_write(d.project_id)
  ));
drop policy if exists "document_pages_delete" on public.document_pages;
create policy "document_pages_delete" on public.document_pages for delete to authenticated
  using (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where public.can_write(d.project_id)
  ));

-- Requirement domain ---------------------------------------------------------
-- Requirements are the shared contractual root. contract_obligations remains
-- as a deadline-specific compatibility extension so the current contract UI,
-- alerts, reminders, and due-date calculations keep their existing shape.
create table if not exists public.requirements (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  title                  text not null,
  description            text,
  requirement_type       text not null default 'other'
    check (requirement_type in ('deadline','submittal','inspection','test','checklist','evidence','photo','report','other')),
  responsible_party_type text
    check (responsible_party_type is null or responsible_party_type in ('agency','supervisor','contractor','other')),
  -- P0-02 adds project_parties and the deferred FK for this placeholder.
  responsible_project_party_id uuid,
  lifecycle_phase        text,
  trigger_type           text,
  trigger_config         jsonb not null default '{}'::jsonb
    check (jsonb_typeof(trigger_config) = 'object'),
  frequency_type         text,
  frequency_config       jsonb not null default '{}'::jsonb
    check (jsonb_typeof(frequency_config) = 'object'),
  acceptance_criteria    text,
  evidence_requirement   text,
  status                 text not null default 'needs_review'
    check (status in ('draft_ai','needs_review','approved','rejected','superseded')),
  origin                 text not null default 'manual'
    check (origin in ('ai','manual','migration')),
  -- Explicit provenance without a circular FK to contract_obligations, which
  -- already points back through requirement_id. Same UUID identity is retained.
  legacy_contract_obligation_id uuid,
  confidence             numeric check (confidence between 0 and 1),
  reviewed_by            uuid references auth.users(id) on delete set null,
  reviewed_at            timestamptz,
  is_authoritative       boolean generated always as
    (status = 'approved') stored,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists requirements_project_idx on public.requirements(project_id);
create index if not exists requirements_project_type_idx on public.requirements(project_id, requirement_type);
create unique index if not exists requirements_legacy_obligation_uidx
  on public.requirements(legacy_contract_obligation_id)
  where legacy_contract_obligation_id is not null;
create index if not exists requirements_authoritative_idx on public.requirements(project_id)
  where is_authoritative;

-- Project-scoped roots cannot be reassigned. This keeps existing Requirement
-- source/work-item bridges valid even when a user can write to both projects.
create or replace function public.guard_project_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'project identity is immutable';
  end if;
  return new;
end; $$;
drop trigger if exists requirements_project_identity_guard on public.requirements;
create trigger requirements_project_identity_guard
  before update on public.requirements for each row
  execute function public.guard_project_identity();
drop trigger if exists documents_project_identity_guard on public.documents;
create trigger documents_project_identity_guard
  before update on public.documents for each row
  execute function public.guard_project_identity();
drop trigger if exists work_items_project_identity_guard on public.work_items;
create trigger work_items_project_identity_guard
  before update on public.work_items for each row
  execute function public.guard_project_identity();

create or replace function public.touch_requirement_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end; $$;
drop trigger if exists requirements_touch_updated_at on public.requirements;
create trigger requirements_touch_updated_at
  before update on public.requirements for each row
  execute function public.touch_requirement_updated_at();

alter table public.requirements enable row level security;
drop policy if exists "requirements_select" on public.requirements;
create policy "requirements_select" on public.requirements for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "requirements_insert" on public.requirements;
create policy "requirements_insert" on public.requirements for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "requirements_update" on public.requirements;
create policy "requirements_update" on public.requirements for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "requirements_delete" on public.requirements;
create policy "requirements_delete" on public.requirements for delete to authenticated
  using (public.can_write(project_id));

-- Consumers that need approved contractual truth should use this view rather
-- than treating unreviewed model output as authoritative.
create or replace view public.authoritative_requirements
with (security_invoker = true) as
  select * from public.requirements where is_authoritative;

create table if not exists public.requirement_sources (
  id                  uuid primary key default gen_random_uuid(),
  requirement_id      uuid not null references public.requirements(id) on delete cascade,
  document_version_id uuid references public.document_versions(id),
  source_kind         text not null default 'manual'
    check (source_kind in ('document','legacy','manual')),
  source_verified     boolean not null default false,
  page_number         int check (page_number is null or page_number > 0),
  page_label          text,
  section             text,
  clause              text,
  source_text         text,
  source_start_offset int check (source_start_offset is null or source_start_offset >= 0),
  source_end_offset   int,
  created_at          timestamptz not null default now(),
  check (
    source_end_offset is null
    or (source_end_offset >= 0 and source_end_offset >= coalesce(source_start_offset, 0))
  ),
  check (source_kind <> 'document' or document_version_id is not null),
  check (not source_verified or document_version_id is not null)
);
create index if not exists requirement_sources_requirement_idx on public.requirement_sources(requirement_id);
create index if not exists requirement_sources_document_version_idx on public.requirement_sources(document_version_id);

create or replace function public.validate_requirement_source_project()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.document_version_id is not null and not exists (
    select 1
    from public.requirements r
    join public.document_versions v on v.id = new.document_version_id
    join public.documents d on d.id = v.document_id
    where r.id = new.requirement_id and r.project_id = d.project_id
  ) then
    raise exception 'requirement and document version must belong to the same project';
  end if;
  return new;
end; $$;
drop trigger if exists requirement_sources_same_project on public.requirement_sources;
create trigger requirement_sources_same_project
  before insert or update on public.requirement_sources for each row
  execute function public.validate_requirement_source_project();

alter table public.requirement_sources enable row level security;
drop policy if exists "requirement_sources_select" on public.requirement_sources;
create policy "requirement_sources_select" on public.requirement_sources for select to authenticated
  using (requirement_id in (
    select id from public.requirements where project_id in (select public.my_project_ids())
  ));
drop policy if exists "requirement_sources_insert" on public.requirement_sources;
create policy "requirement_sources_insert" on public.requirement_sources for insert to authenticated
  with check (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  ));
drop policy if exists "requirement_sources_update" on public.requirement_sources;
create policy "requirement_sources_update" on public.requirement_sources for update to authenticated
  using (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  )) with check (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  ));
drop policy if exists "requirement_sources_delete" on public.requirement_sources;
create policy "requirement_sources_delete" on public.requirement_sources for delete to authenticated
  using (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  ));

create table if not exists public.requirement_work_items (
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  work_item_id   uuid not null references public.work_items(id) on delete cascade,
  match_type     text not null check (match_type in ('ai','code','description','manual')),
  confidence     numeric check (confidence between 0 and 1),
  reviewed       boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (requirement_id, work_item_id)
);
create index if not exists requirement_work_items_work_item_idx on public.requirement_work_items(work_item_id);

create or replace function public.validate_requirement_work_item_project()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1
    from public.requirements r
    join public.work_items w on w.id = new.work_item_id
    where r.id = new.requirement_id and r.project_id = w.project_id
  ) then
    raise exception 'requirement and work item must belong to the same project';
  end if;
  return new;
end; $$;
drop trigger if exists requirement_work_items_same_project on public.requirement_work_items;
create trigger requirement_work_items_same_project
  before insert or update on public.requirement_work_items for each row
  execute function public.validate_requirement_work_item_project();

alter table public.requirement_work_items enable row level security;
drop policy if exists "requirement_work_items_select" on public.requirement_work_items;
create policy "requirement_work_items_select" on public.requirement_work_items for select to authenticated
  using (requirement_id in (
    select id from public.requirements where project_id in (select public.my_project_ids())
  ));
drop policy if exists "requirement_work_items_insert" on public.requirement_work_items;
create policy "requirement_work_items_insert" on public.requirement_work_items for insert to authenticated
  with check (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  ));
drop policy if exists "requirement_work_items_update" on public.requirement_work_items;
create policy "requirement_work_items_update" on public.requirement_work_items for update to authenticated
  using (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  )) with check (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  ));
drop policy if exists "requirement_work_items_delete" on public.requirement_work_items;
create policy "requirement_work_items_delete" on public.requirement_work_items for delete to authenticated
  using (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  ));

-- Compatibility link: a legacy deadline and its root requirement deliberately
-- share the same UUID. This makes the conversion deterministic and idempotent.
alter table public.contract_obligations
  add column if not exists requirement_id uuid;

create or replace function public.upsert_contract_obligation_requirement()
returns trigger language plpgsql security definer set search_path = public as $$
declare requirement_status text;
begin
  new.requirement_id = new.id;

  insert into public.requirements (
    id, project_id, title, description, requirement_type,
    responsible_party_type, lifecycle_phase, trigger_type, trigger_config,
    frequency_type, frequency_config, status, origin,
    legacy_contract_obligation_id, created_at
  ) values (
    new.id,
    new.project_id,
    new.title,
    new.note,
    'deadline',
    case
      when nullif(trim(new.responsible), '') is null then null
      when new.responsible in ('機關','agency') then 'agency'
      when new.responsible in ('監造','supervisor') then 'supervisor'
      when new.responsible in ('廠商','contractor') then 'contractor'
      else 'other'
    end,
    new.category,
    new.trigger_event,
    jsonb_strip_nulls(jsonb_build_object(
      'offset_days', new.offset_days,
      'offset_dir', new.offset_dir,
      'fixed_date', new.fixed_date
    )),
    new.recurring,
    case when new.recurring_day is null then '{}'::jsonb
      else jsonb_build_object('day', new.recurring_day) end,
    'needs_review',
    'migration',
    new.id,
    coalesce(new.created_at, now())
  )
  on conflict (id) do update set
    project_id = excluded.project_id,
    title = excluded.title,
    description = excluded.description,
    requirement_type = 'deadline',
    responsible_party_type = excluded.responsible_party_type,
    lifecycle_phase = excluded.lifecycle_phase,
    trigger_type = excluded.trigger_type,
    trigger_config = excluded.trigger_config,
    frequency_type = excluded.frequency_type,
    frequency_config = excluded.frequency_config,
    origin = 'migration',
    legacy_contract_obligation_id = excluded.legacy_contract_obligation_id
  where requirements.status in ('draft_ai','needs_review');

  select status into requirement_status
  from public.requirements where id = new.id;

  if requirement_status in ('draft_ai','needs_review') then
    if new.source_clause is not null or new.source_page is not null then
      insert into public.requirement_sources (
        id, requirement_id, document_version_id, source_kind, source_verified,
        page_number, page_label, clause
      ) values (
        new.id,
        new.id,
        null,
        'legacy',
        false,
        nullif(substring(new.source_page from '([0-9]+)'), '')::int,
        new.source_page,
        new.source_clause
      )
      on conflict (id) do update set
        requirement_id = excluded.requirement_id,
        document_version_id = null,
        source_kind = 'legacy',
        source_verified = false,
        page_number = excluded.page_number,
        page_label = excluded.page_label,
        clause = excluded.clause
      where requirement_sources.source_kind = 'legacy';
    else
      delete from public.requirement_sources
      where id = new.id and requirement_id = new.id and source_kind = 'legacy';
    end if;
  end if;

  return new;
end; $$;
drop trigger if exists contract_obligations_sync_requirement on public.contract_obligations;
create trigger contract_obligations_sync_requirement
  before insert or update on public.contract_obligations for each row
  execute function public.upsert_contract_obligation_requirement();

-- Existing rows are converted once. Re-running this schema does not duplicate
-- requirements because both the root and initial source use deterministic IDs.
update public.contract_obligations o
set requirement_id = o.id
where o.requirement_id is distinct from o.id
   or not exists (select 1 from public.requirements r where r.id = o.id);

create unique index if not exists contract_obligations_requirement_uidx
  on public.contract_obligations(requirement_id);
alter table public.contract_obligations alter column requirement_id set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contract_obligations_requirement_fk'
      and conrelid = 'public.contract_obligations'::regclass
  ) then
    alter table public.contract_obligations
      add constraint contract_obligations_requirement_fk
      foreign key (requirement_id) references public.requirements(id) on delete cascade;
  end if;
end; $$;

-- Legacy parser replacement removes only draft/needs-review mirrors. Explicit
-- lifecycle outcomes (approved, rejected, superseded) survive reprocessing.
-- During a root-originated cascade the parent is already invisible, so no
-- second delete is attempted.
create or replace function public.delete_legacy_requirement_root()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.requirement_id is not null and exists (
    select 1 from public.requirements
    where id = old.requirement_id
      and status in ('draft_ai','needs_review')
  ) then
    delete from public.requirements where id = old.requirement_id;
  end if;
  return old;
end; $$;
drop trigger if exists contract_obligations_delete_requirement on public.contract_obligations;
create trigger contract_obligations_delete_requirement
  after delete on public.contract_obligations for each row
  execute function public.delete_legacy_requirement_root();
