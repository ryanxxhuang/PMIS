-- 契約分級可見性補完(機關看全部/監造看施工+自己/廠商只看自己)。
--
-- requirements 與其引註/工項連結自 20260712000800 起已依 AI 出處鏈分級
-- (can_read_requirement_provenance:run → version → document → 契約包)。
-- 本支補上兩個缺口:
--   1) contract_obligations 仍是全案可見(baseline my_project_ids)——監造契約
--      核定出的期限,廠商看得到。改依 requirement 的可見範圍分級。
--   2) 手動/遷移列(ingestion_run_id is null)在 provenance 檢查一律放行——
--      監造針對自己契約補登的重點,廠商看得到。新增 requirements.contract_package_id
--      供手動補登歸包;null 維持全案可見(既有 legacy migration 列不變)。

-- ── 1. 手動補登的歸包欄 ────────────────────────────────────────────────────
alter table public.requirements
  add column if not exists contract_package_id uuid
    references public.contract_packages(id) on delete set null;
comment on column public.requirements.contract_package_id is
  '手動補登的可見性歸包:AI 列由 ingestion_run_id 出處鏈推導,不填本欄;'
  '手動列填了就依 can_read_contract_package 分級,null=全案可見(legacy 相容)。';
create index if not exists requirements_contract_package_idx
  on public.requirements(contract_package_id) where contract_package_id is not null;

-- 歸包防呆:必須同專案;應用使用者只能歸入自己讀得到的包(不可指到別人的包
-- 去「藏」內容或探測包的存在)。service role(migration/edge)不受讀權限限制。
create or replace function public.guard_requirement_package()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.contract_package_id is null then return new; end if;
  if not exists (
    select 1 from public.contract_packages cp
    where cp.id = new.contract_package_id and cp.project_id = new.project_id
  ) then
    raise exception '契約重點歸包必須屬於同一專案';
  end if;
  if auth.uid() is not null
    and (tg_op = 'INSERT' or new.contract_package_id is distinct from old.contract_package_id)
    and not public.can_read_contract_package(new.contract_package_id) then
    raise exception '不可將契約重點歸入無權讀取的契約包';
  end if;
  return new;
end; $$;
drop trigger if exists requirements_package_guard on public.requirements;
create trigger requirements_package_guard
  before insert or update on public.requirements
  for each row execute function public.guard_requirement_package();

-- ── 2. 可見範圍判定(單一真相,requirement 與義務共用)─────────────────────
-- AI 列走出處鏈;手動列走歸包;兩者皆無=全案可見(legacy)。
create or replace function public.can_read_requirement_scope(p_run uuid, p_package uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select case
    when p_run is not null then public.can_read_requirement_provenance(p_run)
    when p_package is not null then public.can_read_contract_package(p_package)
    else true
  end
$$;

-- 以 requirement id 判讀權(義務 policy 用;security definer 避免巢狀 RLS)
create or replace function public.can_read_requirement_row(p_requirement uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.requirements r
    where r.id = p_requirement
      and r.project_id in (select public.my_project_ids())
      and public.can_read_requirement_scope(r.ingestion_run_id, r.contract_package_id)
  )
$$;

revoke all on function public.can_read_requirement_scope(uuid, uuid) from public, anon;
revoke all on function public.can_read_requirement_row(uuid) from public, anon;
grant execute on function public.can_read_requirement_scope(uuid, uuid) to authenticated;
grant execute on function public.can_read_requirement_row(uuid) to authenticated;

-- ── 3. requirements 及引註/連結的 SELECT policy 改吃 scope(含歸包)────────
drop policy if exists "requirements_select" on public.requirements;
create policy "requirements_select" on public.requirements for select to authenticated
  using (project_id in (select public.my_project_ids())
    and public.can_read_requirement_scope(ingestion_run_id, contract_package_id));

drop policy if exists "requirement_sources_select" on public.requirement_sources;
create policy "requirement_sources_select" on public.requirement_sources
  for select to authenticated
  using (
    public.can_read_requirement_row(requirement_id)
    and (document_version_id is null
      or public.can_read_document_version(document_version_id))
  );

drop policy if exists "requirement_work_items_select" on public.requirement_work_items;
create policy "requirement_work_items_select" on public.requirement_work_items
  for select to authenticated
  using (public.can_read_requirement_row(requirement_id));

drop policy if exists "requirement_artifact_links_select" on public.requirement_artifact_links;
create policy "requirement_artifact_links_select" on public.requirement_artifact_links
  for select to authenticated
  using (public.can_read_requirement_row(requirement_id));

-- ── 4. contract_obligations 分級(核心缺口)────────────────────────────────
-- SELECT:專案成員 + requirement 可見範圍(requirement_id 自 20260712000300 起
-- NOT NULL;null 分支純防衛)。UPDATE 同步收緊:can_write 之外還要看得到——
-- 否則廠商可對看不見的監造契約義務盲寫狀態(status 欄 grant 對成員開放)。
drop policy if exists "contract_obligations_select" on public.contract_obligations;
create policy "contract_obligations_select" on public.contract_obligations
  for select to authenticated
  using (project_id in (select public.my_project_ids())
    and (requirement_id is null or public.can_read_requirement_row(requirement_id)));

drop policy if exists "contract_obligations_update" on public.contract_obligations;
create policy "contract_obligations_update" on public.contract_obligations
  for update to authenticated
  using (public.can_write(project_id)
    and (requirement_id is null or public.can_read_requirement_row(requirement_id)))
  with check (public.can_write(project_id));
