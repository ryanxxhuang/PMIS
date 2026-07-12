-- ── 正式模式(formal mode):關閉專案管理者的跨角色簽核例外 ────────────────────
-- 背景(docs/正式版三角色全功能驗收報告-2026-07-12.md P0-2):
--   admin(建立者)例外是刻意設計——單人/小團隊試用不被 org_type 卡死;但正式
--   履約時,建立專案的廠商不得替監造/機關做正式判定。
-- 設計:
--   * projects.formal_mode(預設 false=試用行為不變)。開啟=單向,登入使用者
--     不可關閉(履約證據完整性);service role/SQL Editor 保留支援通道。
--   * admin_override(p) = is_project_admin(p) 且非正式模式。
--   * 「跨角色簽核/資料存取例外」全部改用 admin_override:十個 guard trigger
--     + can_write(機關唯讀例外)+ can_access_contractor_private(成本機密)。
--   * 「專案管理」保留 is_project_admin:delete_project、成員管理、身分快照。
--   * 履約需求審核(p0_07)本來就無 admin 例外,不動。

alter table public.projects add column if not exists formal_mode boolean not null default false;

-- 單向開關:false→true 可;true→false 僅 service role(登入使用者一律擋)
create or replace function public.projects_formal_mode_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and old.formal_mode and not new.formal_mode then
    raise exception '正式模式開啟後不可關閉(履約證據完整性);如確有需要請聯繫系統管理者';
  end if;
  return new;
end; $$;
drop trigger if exists projects_formal_mode_guard on public.projects;
create trigger projects_formal_mode_guard before update on public.projects
  for each row execute function public.projects_formal_mode_guard();

-- 跨角色例外的總開關:管理者且非正式模式
create or replace function public.admin_override(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_project_admin(p)
     and not coalesce((select formal_mode from public.projects where id = p), false)
$$;
revoke all on function public.admin_override(uuid) from public, anon;
grant execute on function public.admin_override(uuid) to authenticated;

-- ── 資料存取例外改用 admin_override ─────────────────────────────────────────
-- 日常填報寫入權:正式模式下,機關身分的管理者回歸唯讀
create or replace function public.can_write(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p in (select public.my_project_ids())
     and (public.admin_override(p) or public.my_org_type() <> 'owner');
$$;

-- 廠商內部資料(成本/毛利=商業機密):正式模式下,非廠商身分的管理者不可再看
create or replace function public.can_access_contractor_private(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p in (select public.my_project_ids())
     and (public.admin_override(p) or public.my_org_type() = 'contractor');
$$;

-- ── 十個 guard 的簽核例外改用 admin_override(函式同名 replace,trigger 不重掛)──

-- 估驗:跨越「已核定」的狀態轉移=監造;機關只能碰請款/撥款三欄
create or replace function public.valuations_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare org text;
begin
  if auth.uid() is null or public.admin_override(new.project_id) then return new; end if;
  org := public.my_org_type();
  if new.status is distinct from old.status
     and (new.status = '已核定' or old.status = '已核定')
     and org <> 'supervisor' then
    raise exception '估驗核定/退回核定僅監造可執行';
  end if;
  if org = 'owner' and (
       new.period_no      is distinct from old.period_no
    or new.period_start   is distinct from old.period_start
    or new.period_end     is distinct from old.period_end
    or new.valuation_date is distinct from old.valuation_date
    or new.retention_pct  is distinct from old.retention_pct
    or new.status         is distinct from old.status
    or new.note           is distinct from old.note
  ) then
    raise exception '機關僅可登錄請款/撥款欄位(invoice_date / paid_date / paid_amount)';
  end if;
  return new;
end; $$;

-- 估驗明細:已核定的估驗凍結(監造才可再動——退回重審用)
create or replace function public.valuation_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select project_id, status into v from public.valuations
    where id = coalesce(new.valuation_id, old.valuation_id);
  if v.status = '已核定'
     and not public.admin_override(v.project_id)
     and public.my_org_type() <> 'supervisor' then
    raise exception '已核定估驗的明細不可再修改(需監造退回後重編)';
  end if;
  return coalesce(new, old);
end; $$;

-- 查驗:合格/不合格判定(含撤銷判定)=監造
create or replace function public.inspections_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.admin_override(new.project_id) then return new; end if;
  if new.status is distinct from old.status
     and (new.status in ('合格','不合格') or old.status in ('合格','不合格'))
     and public.my_org_type() <> 'supervisor' then
    raise exception '查驗判定(合格/不合格)僅監造可執行';
  end if;
  return new;
end; $$;

-- 缺失:結案/撤銷結案=監造(施工只能改善、提送複查)
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

-- 送審:審定結果(核准/核備/退回補正/駁回)=監造
create or replace function public.submittals_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.admin_override(new.project_id) then return new; end if;
  if new.status is distinct from old.status
     and (new.status in ('核准','核備','退回補正','駁回')
       or old.status in ('核准','核備','退回補正','駁回'))
     and public.my_org_type() <> 'supervisor' then
    raise exception '送審審定僅監造可執行';
  end if;
  return new;
end; $$;

-- RFI:正式回覆=監造(廠商提問、確認結案)
create or replace function public.rfis_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare org text;
begin
  if auth.uid() is null or public.admin_override(new.project_id) then return new; end if;
  org := public.my_org_type();
  if (new.answer is distinct from old.answer
      or (new.status is distinct from old.status and new.status = '已回覆'))
     and org <> 'supervisor' then
    raise exception '回覆工程疑義僅監造可執行';
  end if;
  return new;
end; $$;

-- 變更設計:核准/駁回(含撤銷)=機關或監造(契約級核定);機關僅能改狀態欄
create or replace function public.change_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare org text;
begin
  if auth.uid() is null or public.admin_override(new.project_id) then return new; end if;
  org := public.my_org_type();
  if new.status is distinct from old.status
     and (new.status in ('核准','駁回') or old.status in ('核准','駁回'))
     and org not in ('supervisor','owner') then
    raise exception '變更設計核准/駁回僅機關或監造可執行';
  end if;
  if org = 'owner' and (
       new.co_no      is distinct from old.co_no
    or new.title      is distinct from old.title
    or new.co_date    is distinct from old.co_date
    or new.reason     is distinct from old.reason
    or new.sort_order is distinct from old.sort_order
  ) then
    raise exception '機關僅可核定變更設計狀態,不可修改內容';
  end if;
  return new;
end; $$;

-- 變更明細:已核准的變更凍結
create or replace function public.change_order_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare co record;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select project_id, status into co from public.change_orders
    where id = coalesce(new.change_order_id, old.change_order_id);
  if co.status = '核准' and not public.admin_override(co.project_id) then
    raise exception '已核准變更設計的明細不可再修改';
  end if;
  return coalesce(new, old);
end; $$;

-- 工安紀錄:類型×角色矩陣的管理者放行改 admin_override
--(他方紀錄保護/已完成保護本來就「管理者也不例外」,維持原樣)
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

  -- (4) 類型×角色矩陣;非正式模式的專案管理者放行(單人試用不被 org_type 卡死)
  if not public.admin_override(r.project_id)
     and not public.safety_record_type_allowed(r.record_type, public.my_org_type()) then
    raise exception '工安紀錄類型「%」僅限%登錄/異動', r.record_type,
      case when r.record_type like '監造%' then '監造' else '施工廠商' end;
  end if;

  -- (5) 登錄者即建立者,不可冒名
  if tg_op = 'INSERT' then new.created_by := uid; end if;
  return coalesce(new, old);
end; $$;

-- 驗收事件:階段×角色矩陣的「授權主驗」放行改 admin_override
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

  -- (3) 階段×角色矩陣;非正式模式的專案管理者=授權主驗,放行全部階段
  if not public.admin_override(r.project_id)
     and not public.acceptance_stage_allowed(r.stage_key, public.my_org_type()) then
    raise exception '驗收階段「%」僅限%登錄/異動',
      r.stage_key, public.acceptance_stage_owner_desc(r.stage_key);
  end if;

  -- (4) 登錄者即建立者,不可冒名
  if tg_op = 'INSERT' then new.created_by := uid; end if;
  return coalesce(new, old);
end; $$;
