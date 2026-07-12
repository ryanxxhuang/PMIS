-- P0 恢復批5(P0-07.5):自 ba8a5ec 取回(supabase/migrations/20260711000100),重新編號部署。
-- 修改(相對原版):①document_versions_select 改父表查詢(修 2026-07-11 事故根因:
--   自我引用 policy × INSERT RETURNING);②contract-documents bucket+物件 policies
--   隨 migration 建立(原版遺漏的 SETUP 步驟,正是當年 pipeline 必死的第二因)。

-- 依賴前移:can_manage_documents 原定義於已取消的批3(party role 制)。
-- 依全域 org_type 模型定案:文件管理=can_write(成員且非純機關;管理者放行)。
create or replace function public.can_manage_documents(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_write(p)
$$;
revoke all on function public.can_manage_documents(uuid) from public, anon;
grant execute on function public.can_manage_documents(uuid) to authenticated;

-- 依賴前移:最後技術管理者保護(原屬已取消的批3;模型無關的完整性規則——
-- 刪掉最後一位管理者會讓專案變成孤兒)。原版自帶 cascade 放行+FOR UPDATE 序列化,原樣取回。
create or replace function public.guard_last_project_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if not old.is_project_admin then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.is_project_admin then return new; end if;
  perform 1 from public.projects where id = old.project_id for update;
  if not found then
    return coalesce(new, old); -- project row already deleted: cascade in progress
  end if;
  if not exists (
    select 1 from public.project_memberships m
    where m.project_id = old.project_id and m.id <> old.id and m.is_project_admin
  ) then
    raise exception 'a project must keep at least one technical project admin';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists project_memberships_last_admin_guard on public.project_memberships;
create trigger project_memberships_last_admin_guard
  before update or delete on public.project_memberships for each row
  execute function public.guard_last_project_admin();
-- P0-07.5 - Contract package ingestion and review inbox.
-- A project holds contract PACKAGES (construction, supervision, other), each a
-- party relationship that owns many documents. Visibility is party-scoped:
-- agency reads all, supervisor reads construction + own supervision package,
-- contractor reads only its own construction package. Original binaries live
-- in a private Storage bucket; per-file processing state is persisted so
-- progress survives a browser refresh. Nothing here touches contractual
-- authority: Requirements, review, and audit boundaries stay as in P0-03..07.

-- -- P0-07.5 §1: contract package domain --------------------------------------
create table if not exists public.contract_packages (
  id                            uuid primary key default gen_random_uuid(),
  project_id                    uuid not null references public.projects(id) on delete cascade,
  owner_project_party_id        uuid references public.project_parties(id) on delete set null,
  counterparty_project_party_id uuid not null references public.project_parties(id) on delete cascade,
  package_type                  text not null default 'other'
    check (package_type in ('construction','supervision','other')),
  title                         text not null,
  status                        text not null default 'draft'
    check (status in ('draft','processing','ready','needs_attention','archived')),
  created_by                    uuid references auth.users(id) on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create index if not exists contract_packages_project_idx
  on public.contract_packages(project_id);
-- One package per (project, type, counterparty): lazy get-or-create from the
-- upload flow stays deterministic and re-uploads never fork a second package.
create unique index if not exists contract_packages_identity_uidx
  on public.contract_packages(project_id, package_type, counterparty_project_party_id);

create or replace function public.validate_contract_package_parties()
returns trigger language plpgsql set search_path = public as $$
declare counterparty record; owner_party record;
begin
  if tg_op = 'UPDATE' and (
       new.package_type is distinct from old.package_type
    or new.counterparty_project_party_id is distinct from old.counterparty_project_party_id
  ) then
    raise exception 'contract package identity is immutable';
  end if;
  select project_id, party_type into counterparty
  from public.project_parties where id = new.counterparty_project_party_id;
  if counterparty.project_id is distinct from new.project_id then
    raise exception 'contract package and counterparty must belong to the same project';
  end if;
  if new.package_type = 'construction' and counterparty.party_type <> 'contractor' then
    raise exception 'construction package counterparty must be a contractor party';
  end if;
  if new.package_type = 'supervision' and counterparty.party_type <> 'supervisor' then
    raise exception 'supervision package counterparty must be a supervisor party';
  end if;
  if new.owner_project_party_id is not null then
    select project_id, party_type into owner_party
    from public.project_parties where id = new.owner_project_party_id;
    if owner_party.project_id is distinct from new.project_id
       or owner_party.party_type <> 'agency' then
      raise exception 'contract package owner must be an agency party of the same project';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists contract_packages_validate on public.contract_packages;
create trigger contract_packages_validate
  before insert or update on public.contract_packages for each row
  execute function public.validate_contract_package_parties();

drop trigger if exists contract_packages_project_identity_guard on public.contract_packages;
create trigger contract_packages_project_identity_guard
  before update on public.contract_packages for each row
  execute function public.guard_project_identity();

drop trigger if exists contract_packages_touch_updated_at on public.contract_packages;
create trigger contract_packages_touch_updated_at
  before update on public.contract_packages for each row
  execute function public.touch_document_updated_at();

-- -- P0-07.5 §2: party-scoped package visibility -------------------------------
-- Visibility baseline (never technical-admin based, never org_type based):
--   agency party     -> every package in the project
--   supervisor party -> construction packages + packages where it is the
--                       counterparty (its own supervision contract)
--   any other party  -> only packages where it is the counterparty
create or replace function public.can_access_contract_package(
  p_project uuid, p_type text, p_counterparty uuid
) returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.my_project_membership(p_project) m
    where m.party_type = 'agency'
       or (m.party_type = 'supervisor'
           and (p_type = 'construction' or p_counterparty = m.project_party_id))
       or p_counterparty = m.project_party_id
  )
$$;

create or replace function public.can_read_contract_package(p_package uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.contract_packages cp
    where cp.id = p_package
      and public.can_access_contract_package(
        cp.project_id, cp.package_type, cp.counterparty_project_party_id)
  )
$$;

-- Writing into a package = document custody + package visibility. A
-- contractor can therefore never create or fill the supervision package.
create or replace function public.can_upload_contract_package(p_package uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.contract_packages cp
    where cp.id = p_package
      and public.can_manage_documents(cp.project_id)
      and public.can_access_contract_package(
        cp.project_id, cp.package_type, cp.counterparty_project_party_id)
  )
$$;

revoke all on function public.can_access_contract_package(uuid, text, uuid) from public, anon;
revoke all on function public.can_read_contract_package(uuid) from public, anon;
revoke all on function public.can_upload_contract_package(uuid) from public, anon;
grant execute on function public.can_access_contract_package(uuid, text, uuid) to authenticated;
grant execute on function public.can_read_contract_package(uuid) to authenticated;
grant execute on function public.can_upload_contract_package(uuid) to authenticated;

alter table public.contract_packages enable row level security;
drop policy if exists "contract_packages_select" on public.contract_packages;
create policy "contract_packages_select" on public.contract_packages
  for select to authenticated
  using (public.can_access_contract_package(
    project_id, package_type, counterparty_project_party_id));
drop policy if exists "contract_packages_insert" on public.contract_packages;
create policy "contract_packages_insert" on public.contract_packages
  for insert to authenticated
  with check (public.can_manage_documents(project_id)
    and public.can_access_contract_package(
      project_id, package_type, counterparty_project_party_id));
drop policy if exists "contract_packages_update" on public.contract_packages;
create policy "contract_packages_update" on public.contract_packages
  for update to authenticated
  using (public.can_upload_contract_package(id))
  with check (public.can_upload_contract_package(id));
-- No DELETE policy: packages are archived via status, never removed by users.

-- -- P0-07.5 §3: package -> document relationship ------------------------------
alter table public.documents
  add column if not exists contract_package_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_contract_package_fk'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_contract_package_fk
      foreign key (contract_package_id)
      references public.contract_packages(id) on delete set null;
  end if;
end; $$;
create index if not exists documents_contract_package_idx
  on public.documents(contract_package_id) where contract_package_id is not null;

create or replace function public.validate_document_contract_package()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.contract_package_id is not null and not exists (
    select 1 from public.contract_packages cp
    where cp.id = new.contract_package_id and cp.project_id = new.project_id
  ) then
    raise exception 'document and contract package must belong to the same project';
  end if;
  -- Filing a document INTO a package needs package upload authority, not just
  -- generic document custody - a contractor can never populate the
  -- supervision package.
  if new.contract_package_id is not null
     and auth.uid() is not null
     and (tg_op = 'INSERT' or new.contract_package_id is distinct from old.contract_package_id)
     and not public.can_upload_contract_package(new.contract_package_id) then
    raise exception 'no authority to file documents into this contract package';
  end if;
  return new;
end; $$;
drop trigger if exists documents_contract_package_same_project on public.documents;
create trigger documents_contract_package_same_project
  before insert or update on public.documents for each row
  execute function public.validate_document_contract_package();

-- -- P0-07.5 §4: package-aware read boundary -----------------------------------
-- Documents filed in a package inherit its visibility; unfiled documents keep
-- their P0-01 project-member visibility. One SECURITY DEFINER resolver keeps
-- the version/page/run/requirement policies cheap and consistent.
create or replace function public.can_read_project_document(
  p_project uuid, p_package uuid
) returns boolean language sql security definer stable set search_path = public as $$
  select p_project in (select public.my_project_ids())
     and (p_package is null or public.can_read_contract_package(p_package))
$$;

create or replace function public.can_read_document_version(p_version uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.document_versions v
    join public.documents d on d.id = v.document_id
    where v.id = p_version
      and public.can_read_project_document(d.project_id, d.contract_package_id)
  )
$$;

-- Package-aware write boundary. Existing unfiled documents retain the P0-06
-- document-custody rule; filed documents additionally require upload authority
-- for that exact visible package. Guessed supervision-package UUIDs therefore
-- cannot be used to mutate documents, versions, or extracted pages.
create or replace function public.can_write_project_document(
  p_project uuid, p_package uuid
) returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_documents(p_project)
     and (p_package is null or public.can_upload_contract_package(p_package))
$$;

create or replace function public.can_write_document(p_document uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.documents d where d.id = p_document
      and public.can_write_project_document(d.project_id, d.contract_package_id)
  )
$$;

create or replace function public.can_write_document_version(p_version uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.document_versions v where v.id = p_version
      and public.can_write_document(v.document_id)
  )
$$;

-- AI provenance chain: requirements from a run over a package-restricted
-- document are only visible where the package is; manual/migration
-- requirements (no run) keep project visibility.
create or replace function public.can_read_requirement_provenance(p_run uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p_run is null or exists (
    select 1 from public.document_ingestion_runs r
    where r.id = p_run
      and public.can_read_document_version(r.document_version_id)
  )
$$;

revoke all on function public.can_read_project_document(uuid, uuid) from public, anon;
revoke all on function public.can_read_document_version(uuid) from public, anon;
revoke all on function public.can_read_requirement_provenance(uuid) from public, anon;
revoke all on function public.can_write_project_document(uuid, uuid) from public, anon;
revoke all on function public.can_write_document(uuid) from public, anon;
revoke all on function public.can_write_document_version(uuid) from public, anon;
grant execute on function public.can_read_project_document(uuid, uuid) to authenticated;
grant execute on function public.can_read_document_version(uuid) to authenticated;
grant execute on function public.can_read_requirement_provenance(uuid) to authenticated;
grant execute on function public.can_write_project_document(uuid, uuid) to authenticated;
grant execute on function public.can_write_document(uuid) to authenticated;
grant execute on function public.can_write_document_version(uuid) to authenticated;

drop policy if exists "documents_select" on public.documents;
create policy "documents_select" on public.documents for select to authenticated
  using (public.can_read_project_document(project_id, contract_package_id));

drop policy if exists "documents_insert" on public.documents;
create policy "documents_insert" on public.documents for insert to authenticated
  with check (public.can_write_project_document(project_id, contract_package_id));
drop policy if exists "documents_update" on public.documents;
create policy "documents_update" on public.documents for update to authenticated
  using (public.can_write_project_document(project_id, contract_package_id))
  with check (public.can_write_project_document(project_id, contract_package_id));

drop policy if exists "document_versions_select" on public.document_versions;
-- [批5根因修復] 原版 using (can_read_document_version(id)) 自我回查本表,
-- INSERT..RETURNING(supabase-js .insert().select())的語句快照看不到新列 → 100% 假違規。
-- 改為父表(documents)查詢:同語義,對 RETURNING 安全。2026-07-11 事故根因。
create policy "document_versions_select" on public.document_versions
  for select to authenticated using (exists (
    select 1 from public.documents d
    where d.id = document_id
      and public.can_read_project_document(d.project_id, d.contract_package_id)
  ));

drop policy if exists "document_versions_insert" on public.document_versions;
create policy "document_versions_insert" on public.document_versions
  for insert to authenticated with check (public.can_write_document(document_id));
drop policy if exists "document_versions_update" on public.document_versions;
create policy "document_versions_update" on public.document_versions
  for update to authenticated
  using (public.can_write_document(document_id))
  with check (public.can_write_document(document_id));

drop policy if exists "document_pages_select" on public.document_pages;
create policy "document_pages_select" on public.document_pages
  for select to authenticated
  using (public.can_read_document_version(document_version_id));

drop policy if exists "document_pages_insert" on public.document_pages;
create policy "document_pages_insert" on public.document_pages
  for insert to authenticated
  with check (public.can_write_document_version(document_version_id));
drop policy if exists "document_pages_update" on public.document_pages;
create policy "document_pages_update" on public.document_pages
  for update to authenticated
  using (public.can_write_document_version(document_version_id))
  with check (public.can_write_document_version(document_version_id));
drop policy if exists "document_pages_delete" on public.document_pages;
create policy "document_pages_delete" on public.document_pages
  for delete to authenticated
  using (public.can_write_document_version(document_version_id));

drop policy if exists "document_ingestion_runs_select" on public.document_ingestion_runs;
create policy "document_ingestion_runs_select" on public.document_ingestion_runs
  for select to authenticated
  using (project_id in (select public.my_project_ids())
    and public.can_read_document_version(document_version_id));

drop policy if exists "requirements_select" on public.requirements;
create policy "requirements_select" on public.requirements for select to authenticated
  using (project_id in (select public.my_project_ids())
    and public.can_read_requirement_provenance(ingestion_run_id));

drop policy if exists "requirement_sources_select" on public.requirement_sources;
create policy "requirement_sources_select" on public.requirement_sources
  for select to authenticated
  using (
    requirement_id in (
      select r.id from public.requirements r
      where r.project_id in (select public.my_project_ids())
        and public.can_read_requirement_provenance(r.ingestion_run_id)
    )
    and (document_version_id is null
      or public.can_read_document_version(document_version_id))
  );

drop policy if exists "requirement_work_items_select" on public.requirement_work_items;
create policy "requirement_work_items_select" on public.requirement_work_items
  for select to authenticated
  using (requirement_id in (
    select r.id from public.requirements r
    where r.project_id in (select public.my_project_ids())
      and public.can_read_requirement_provenance(r.ingestion_run_id)
  ));

drop policy if exists "requirement_artifact_links_select" on public.requirement_artifact_links;
create policy "requirement_artifact_links_select" on public.requirement_artifact_links
  for select to authenticated
  using (requirement_id in (
    select r.id from public.requirements r
    where r.project_id in (select public.my_project_ids())
      and public.can_read_requirement_provenance(r.ingestion_run_id)
  ));

-- Shared audit stream must not leak restricted package details. Events whose
-- entity still resolves to a package-restricted row follow package
-- visibility; events for deleted entities stay project-readable (their
-- payloads never include more than the actor could already see at the time).
create or replace function public.can_read_audit_entity(
  p_entity_type text, p_entity uuid
) returns boolean language plpgsql security definer stable set search_path = public as $$
declare package_id uuid; run_id uuid;
begin
  if p_entity is null then return true; end if;
  if p_entity_type = 'contract_package' then
    if not exists (select 1 from public.contract_packages where id = p_entity) then
      return true;
    end if;
    return public.can_read_contract_package(p_entity);
  elsif p_entity_type = 'document' then
    select contract_package_id into package_id from public.documents where id = p_entity;
    if not found then return true; end if;
    return package_id is null or public.can_read_contract_package(package_id);
  elsif p_entity_type = 'document_version' then
    if not exists (select 1 from public.document_versions where id = p_entity) then
      return true;
    end if;
    return public.can_read_document_version(p_entity);
  elsif p_entity_type = 'document_ingestion_run' then
    select id into run_id from public.document_ingestion_runs where id = p_entity;
    if not found then return true; end if;
    return public.can_read_requirement_provenance(p_entity);
  elsif p_entity_type = 'document_processing_run' then
    select contract_package_id into package_id
    from public.document_processing_runs where id = p_entity;
    if not found then return true; end if;
    return public.can_read_contract_package(package_id);
  elsif p_entity_type in ('requirement','requirement_work_item') then
    select ingestion_run_id into run_id from public.requirements where id = p_entity;
    if not found then return true; end if;
    return public.can_read_requirement_provenance(run_id);
  end if;
  return true;
end; $$;
revoke all on function public.can_read_audit_entity(text, uuid) from public, anon;
grant execute on function public.can_read_audit_entity(text, uuid) to authenticated;

drop policy if exists "audit_events_select" on public.audit_events;
create policy "audit_events_select" on public.audit_events for select to authenticated
  using (project_id in (select public.my_project_ids())
    and public.can_read_audit_entity(entity_type, entity_id));

-- -- P0-07.5 §5: per-file processing state -------------------------------------
-- One row per document version per package: honest stage-based progress that
-- survives a browser refresh. This is UX state written by the uploading
-- document manager - it is NOT contractual authority and never bypasses the
-- P0-06 system-managed ingestion runs or the P0-07 review boundary.
create table if not exists public.document_processing_runs (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references public.projects(id) on delete cascade,
  contract_package_id       uuid not null references public.contract_packages(id) on delete cascade,
  document_version_id       uuid not null references public.document_versions(id) on delete cascade,
  status                    text not null default 'pending'
    check (status in ('pending','processing','completed','partial','failed','unsupported')),
  stage                     text not null default 'received'
    check (stage in ('received','uploaded','extracting_text','classifying',
                     'extracting_requirements','completed','failed','unsupported')),
  parser_type               text,
  classification_status     text
    check (classification_status is null
      or classification_status in ('auto_accepted','needs_review','confirmed')),
  suggested_document_type   text
    check (suggested_document_type is null or suggested_document_type in
      ('contract','specification','quality_plan','itp','form_package',
       'submittal_document','drawing','report','other')),
  classification_confidence numeric
    check (classification_confidence is null
      or (classification_confidence >= 0 and classification_confidence <= 1)),
  started_by                uuid references auth.users(id) on delete set null,
  started_at                timestamptz not null default now(),
  completed_at              timestamptz,
  error_message             text,
  metadata                  jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  check (parser_type is null or parser_type in ('pdf','docx','txt','none')),
  check (
    (status in ('pending','processing') and completed_at is null)
    or (status in ('completed','partial','failed','unsupported') and completed_at is not null)
  ),
  check (status <> 'completed' or stage = 'completed'),
  check (stage <> 'completed' or status = 'completed'),
  check (
    status <> 'unsupported'
    or (stage = 'unsupported' and parser_type = 'none'
      and coalesce(metadata->>'requirement_extraction', 'skipped') <> 'completed')
  ),
  check (stage <> 'unsupported' or status = 'unsupported'),
  -- retry updates the same row: no duplicate processing state per file content
  unique (document_version_id)
);
create index if not exists document_processing_runs_package_idx
  on public.document_processing_runs(contract_package_id, started_at desc);
create index if not exists document_processing_runs_project_idx
  on public.document_processing_runs(project_id, started_at desc);

create or replace function public.validate_document_processing_run()
returns trigger language plpgsql set search_path = public as $$
declare doc record;
begin
  if not exists (
    select 1 from public.contract_packages cp
    where cp.id = new.contract_package_id and cp.project_id = new.project_id
  ) then
    raise exception 'processing run and contract package must belong to the same project';
  end if;
  select d.project_id, d.contract_package_id into doc
  from public.document_versions v
  join public.documents d on d.id = v.document_id
  where v.id = new.document_version_id;
  if doc.project_id is distinct from new.project_id then
    raise exception 'processing run and document version must belong to the same project';
  end if;
  if doc.contract_package_id is distinct from new.contract_package_id then
    raise exception 'processing run must match the document''s contract package';
  end if;
  return new;
end; $$;
drop trigger if exists document_processing_runs_same_project on public.document_processing_runs;
create trigger document_processing_runs_same_project
  before insert or update on public.document_processing_runs for each row
  execute function public.validate_document_processing_run();

drop trigger if exists document_processing_runs_project_identity_guard on public.document_processing_runs;
create trigger document_processing_runs_project_identity_guard
  before update on public.document_processing_runs for each row
  execute function public.guard_project_identity();

alter table public.document_processing_runs enable row level security;
drop policy if exists "document_processing_runs_select" on public.document_processing_runs;
create policy "document_processing_runs_select" on public.document_processing_runs
  for select to authenticated
  using (public.can_read_contract_package(contract_package_id));
drop policy if exists "document_processing_runs_insert" on public.document_processing_runs;
create policy "document_processing_runs_insert" on public.document_processing_runs
  for insert to authenticated
  with check (public.can_upload_contract_package(contract_package_id));
drop policy if exists "document_processing_runs_update" on public.document_processing_runs;
create policy "document_processing_runs_update" on public.document_processing_runs
  for update to authenticated
  using (public.can_upload_contract_package(contract_package_id))
  with check (public.can_upload_contract_package(contract_package_id));
-- No DELETE policy: processing history is retained.

-- -- P0-07.5 §6: private contract binary storage --------------------------------
-- Path: projects/{project}/contract-packages/{package}/{document}/{version}/{filename}
-- Folder segment 4 is the package id, so object access follows package
-- visibility exactly. The bucket is private; no public URLs exist.
insert into storage.buckets (id, name, public)
values ('contract-documents', 'contract-documents', false)
on conflict (id) do nothing;

drop policy if exists "contract_documents_select" on storage.objects;
create policy "contract_documents_select" on storage.objects for select to authenticated
  using (bucket_id = 'contract-documents'
    and public.can_read_contract_package(((storage.foldername(name))[4])::uuid));
drop policy if exists "contract_documents_insert" on storage.objects;
create policy "contract_documents_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'contract-documents'
    and public.can_upload_contract_package(((storage.foldername(name))[4])::uuid));
-- No UPDATE/DELETE policies: uploaded contract binaries are immutable evidence.

-- -- P0-07.5 §7: focused audit events -------------------------------------------
create or replace function public.audit_contract_package_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_name text; event_action text;
begin
  if tg_op = 'INSERT' then
    event_name := 'contract_package.created'; event_action := 'created';
  elsif new.status is distinct from old.status then
    if new.status = 'processing' then
      event_name := 'contract_package.processing_started'; event_action := 'processing_started';
    elsif new.status = 'ready' then
      event_name := 'contract_package.ready'; event_action := 'ready';
    end if;
  end if;
  if event_name is not null then
    perform public.record_audit_event(new.project_id, event_name,
      'contract_package', new.id, event_action,
      case when tg_op = 'INSERT' then null else to_jsonb(old) end, to_jsonb(new),
      jsonb_build_object('package_type', new.package_type), null);
  end if;
  return new;
end; $$;
drop trigger if exists contract_packages_audit_event on public.contract_packages;
create trigger contract_packages_audit_event
  after insert or update on public.contract_packages
  for each row execute function public.audit_contract_package_event();
revoke all on function public.audit_contract_package_event()
  from public, anon, authenticated;

-- Classification decisions are audited once per file, never per stage tick.
-- Metadata carries ids and types only - no filenames.
create or replace function public.audit_document_classified_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.suggested_document_type is not null
     and old.suggested_document_type is null then
    perform public.record_audit_event(new.project_id, 'document.classified',
      'document_processing_run', new.id, 'classified', null, null,
      jsonb_build_object(
        'document_version_id', new.document_version_id,
        'suggested_document_type', new.suggested_document_type,
        'classification_status', new.classification_status,
        'classification_confidence', new.classification_confidence
      ), null);
  end if;
  return new;
end; $$;
drop trigger if exists document_processing_runs_audit_event on public.document_processing_runs;
create trigger document_processing_runs_audit_event
  after update on public.document_processing_runs
  for each row execute function public.audit_document_classified_event();
revoke all on function public.audit_document_classified_event()
  from public, anon, authenticated;

create or replace function public.audit_document_type_corrected_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.document_type is distinct from old.document_type then
    perform public.record_audit_event(new.project_id, 'document.classification_corrected',
      'document', new.id, 'classification_corrected', null, null,
      jsonb_build_object(
        'previous_document_type', old.document_type,
        'document_type', new.document_type
      ), null);
  end if;
  return new;
end; $$;
drop trigger if exists documents_type_corrected_audit_event on public.documents;
create trigger documents_type_corrected_audit_event
  after update on public.documents
  for each row execute function public.audit_document_type_corrected_event();
revoke all on function public.audit_document_type_corrected_event()
  from public, anon, authenticated;
-- -- End P0-07.5 contract packages ----------------------------------------------

-- [批5補齊] 原始檔 bucket 隨 migration 建立(2026-07-11 事故的 ops 缺口:bucket 從未建立)。
-- 路徑首段=project_id,沿用 photos 的成員制物件policy。
insert into storage.buckets (id, name, public) values ('contract-documents', 'contract-documents', false)
on conflict (id) do nothing;
drop policy if exists "contract_documents_objects_select" on storage.objects;
create policy "contract_documents_objects_select" on storage.objects for select to authenticated
  using (bucket_id = 'contract-documents' and public.is_project_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "contract_documents_objects_insert" on storage.objects;
create policy "contract_documents_objects_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'contract-documents' and public.can_write(((storage.foldername(name))[1])::uuid));
-- 不開 update/delete:正式文件版本不可變,原始檔一經上傳即凍結。
