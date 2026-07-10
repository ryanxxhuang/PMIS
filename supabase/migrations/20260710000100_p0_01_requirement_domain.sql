-- P0-01 - Establish the Requirement Domain Model
--
-- Idempotent migration for an existing PMIS database. Fresh installations
-- receive the same definitions from supabase/schema.sql.
-- -- P0-01: first-class requirement domain -----------------------------------
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
  responsible_party_type text,
  lifecycle_phase        text,
  trigger_type           text,
  trigger_config         jsonb not null default '{}'::jsonb
    check (jsonb_typeof(trigger_config) = 'object'),
  frequency_type         text,
  frequency_config       jsonb not null default '{}'::jsonb
    check (jsonb_typeof(frequency_config) = 'object'),
  acceptance_criteria    text,
  evidence_requirement   text,
  status                 text not null default '待辦',
  confidence             numeric check (confidence between 0 and 1),
  ai_generated           boolean not null default false,
  reviewed_by            uuid references auth.users(id) on delete set null,
  reviewed_at            timestamptz,
  is_authoritative       boolean generated always as
    (not ai_generated or reviewed_at is not null) stored,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists requirements_project_idx on public.requirements(project_id);
create index if not exists requirements_project_type_idx on public.requirements(project_id, requirement_type);
create index if not exists requirements_authoritative_idx on public.requirements(project_id)
  where is_authoritative;

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
  -- P0-05 will add the FK when document_versions becomes a first-class table.
  document_version_id uuid,
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
  )
);
create index if not exists requirement_sources_requirement_idx on public.requirement_sources(requirement_id);
create index if not exists requirement_sources_document_version_idx on public.requirement_sources(document_version_id);
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
begin
  new.requirement_id = new.id;

  insert into public.requirements (
    id, project_id, title, description, requirement_type,
    responsible_party_type, lifecycle_phase, trigger_type, trigger_config,
    frequency_type, frequency_config, status, ai_generated, created_at
  ) values (
    new.id,
    new.project_id,
    new.title,
    new.note,
    'deadline',
    new.responsible,
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
    new.status,
    true,
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
    status = excluded.status;

  if new.source_clause is not null or new.source_page is not null then
    insert into public.requirement_sources (
      id, requirement_id, page_number, page_label, clause
    ) values (
      new.id,
      new.id,
      nullif(substring(new.source_page from '([0-9]+)'), '')::int,
      new.source_page,
      new.source_clause
    )
    on conflict (id) do update set
      requirement_id = excluded.requirement_id,
      page_number = excluded.page_number,
      page_label = excluded.page_label,
      clause = excluded.clause;
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

-- Deleting through the legacy extension also removes its unreviewed deadline
-- root. Human-reviewed requirements survive legacy parser replacement so AI
-- reprocessing cannot silently destroy reviewed contractual data. During a
-- root-originated cascade the parent is already invisible, so no second delete
-- is attempted.
create or replace function public.delete_legacy_requirement_root()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.requirement_id is not null and exists (
    select 1 from public.requirements
    where id = old.requirement_id and reviewed_at is null
  ) then
    delete from public.requirements where id = old.requirement_id;
  end if;
  return old;
end; $$;
drop trigger if exists contract_obligations_delete_requirement on public.contract_obligations;
create trigger contract_obligations_delete_requirement
  after delete on public.contract_obligations for each row
  execute function public.delete_legacy_requirement_root();
