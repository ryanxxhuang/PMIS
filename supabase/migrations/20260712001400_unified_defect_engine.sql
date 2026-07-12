-- ── 統一缺失引擎(QA 報告 §9-4):品質缺失與工安缺失共用一套狀態機/改善流程/稽核 ──
-- 背景:defects(開立/改善中/待複查/已結案)與 safety_records 的工安缺失
--   (待改善/改善中/已完成)是兩套改善狀態機。整併後:
--   * defects = 唯一缺失引擎,以 domain('quality'|'safety')分類,四段狀態機
--     開立 → 改善中 → 待複查 → 已結案;結案/撤銷結案=監造(admin_override 放行)。
--   * safety_records 回歸「原始紀錄」(自主檢查/教育訓練/危害告知/監造三類),
--     工安缺失類型除役——新增一律拒絕並導向缺失引擎。
--   * 已結案保護 + 更正稽核(defect_audits)比照工安引擎:已結案不可刪、
--     更正必附原因、UPDATE/DELETE 全程留稽核(管理者也不例外)。
-- 資料遷移:工安缺失整批搬入 defects(保留原 id;source_safety_record_id 供追溯,
--   歷史更正稽核仍在 safety_record_audits 可查)。狀態映射:
--   待改善→開立、改善中→改善中、已完成→已結案(closed_at 留空:原表無結案時間,不造假)。
-- 可回退:supabase/rollbacks/20260712001400_unified_defect_engine.down.sql
--   (domain='safety' 列反向搬回 safety_records,狀態反映射,guard 還原 formal_mode 版)。

-- ── 1) defects 引擎欄位 ──────────────────────────────────────────────────────
alter table public.defects
  add column if not exists domain                   text not null default 'quality',
  add column if not exists record_date              date,
  add column if not exists correction_reason        text,
  add column if not exists source_safety_record_id  uuid;
alter table public.defects drop constraint if exists defects_domain_check;
alter table public.defects add constraint defects_domain_check
  check (domain in ('quality', 'safety'));

-- ── 2) 資料遷移:safety_records 工安缺失 → defects(domain='safety') ─────────
-- 遷移期間關 safety 觸發器:guard 對 service role 本就放行,但 audit trigger
-- 會把整批搬移記成使用者刪除——那不是刪除,是搬家;追溯靠 source_safety_record_id。
alter table public.safety_records disable trigger safety_records_guard;
alter table public.safety_records disable trigger safety_records_audit;

insert into public.defects
  (id, project_id, title, description, severity, location, status,
   due_date, record_date, correction_reason, created_by, created_at,
   closed_at, domain, source_safety_record_id)
select
  s.id, s.project_id, s.title, s.note, coalesce(s.severity, '一般'), s.location,
  case s.status when '待改善' then '開立'
                when '改善中' then '改善中'
                when '已完成' then '已結案'
                else '開立' end,
  s.due_date, s.record_date, s.correction_reason, s.created_by, s.created_at,
  null, 'safety', s.id
from public.safety_records s
where s.record_type = '工安缺失'
on conflict (id) do nothing;

delete from public.safety_records where record_type = '工安缺失';

alter table public.safety_records enable trigger safety_records_guard;
alter table public.safety_records enable trigger safety_records_audit;

-- ── 3) 統一 defects_guard(取代 formal_mode 版;加掛 INSERT/DELETE) ─────────
-- 規則(伺服器強制;前端 can 只是 UX):
--   * 狀態字彙固定四段;domain/專案/建立者/建立時間不可變更。
--   * 已結案:不可 DELETE;UPDATE 必附新的 correction_reason(管理者也不例外)。
--   * 跨越「已結案」的狀態轉移=監造;非正式模式的專案管理者放行(admin_override)。
--   * INSERT 的 created_by 一律強制為登錄者本人(不可冒名)。
create or replace function public.defects_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  -- service role/SQL Editor/遷移放行
  if uid is null then return coalesce(new, old); end if;
  -- 專案刪除 cascade:父專案列已先刪 → 放行,勿擋整案刪除
  if tg_op in ('UPDATE','DELETE')
     and not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);
  end if;

  -- 統一狀態機字彙(僅檢查新設定的狀態,不追溯舊列)
  if (tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.status is distinct from old.status))
     and new.status not in ('開立','改善中','待複查','已結案') then
    raise exception '未知的缺失狀態「%」(統一狀態機:開立→改善中→待複查→已結案)', new.status;
  end if;

  -- 缺失身分欄位不可變更
  if tg_op = 'UPDATE' and (
       new.domain     is distinct from old.domain
    or new.project_id is distinct from old.project_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception '缺失的分類/專案/建立者不可變更;請另立新缺失';
  end if;

  -- 已結案保護:不可刪除;更正必附新原因(管理者也不例外)
  if tg_op = 'DELETE' and old.status = '已結案' then
    raise exception '已結案的缺失不可刪除;如需更正請附原因更正';
  end if;
  if tg_op = 'UPDATE' and old.status = '已結案'
     and (new.correction_reason is null or btrim(new.correction_reason) = ''
          or new.correction_reason is not distinct from old.correction_reason) then
    raise exception '更正已結案的缺失必須填寫更正原因';
  end if;

  -- 結案/撤銷結案=監造(施工只能改善、提送複查);非正式模式的管理者放行
  if tg_op = 'UPDATE'
     and new.status is distinct from old.status
     and (new.status = '已結案' or old.status = '已結案')
     and not public.admin_override(new.project_id)
     and public.my_org_type() <> 'supervisor' then
    raise exception '缺失結案僅監造可執行';
  end if;

  -- 登錄者即建立者,不可冒名
  if tg_op = 'INSERT' then new.created_by := uid; end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists defects_guard on public.defects;
create trigger defects_guard before insert or update or delete on public.defects
  for each row execute function public.defects_guard();

-- ── 4) 缺失更正/刪除稽核(比照 safety_record_audits) ─────────────────────────
-- 登入者唯讀(select 限專案成員),寫入僅由 trigger(security definer)。
create table if not exists public.defect_audits (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  defect_id  uuid not null,   -- 不掛 FK:缺失刪除後稽核仍須留存
  action     text not null check (action in ('correct','delete')),
  domain     text not null,
  reason     text,            -- 更正已結案缺失時的必填原因
  old_row    jsonb not null,
  new_row    jsonb,           -- delete 時為 null
  acted_by   uuid references auth.users(id),
  acted_at   timestamptz not null default now()
);
create index if not exists defect_audits_project_idx on public.defect_audits(project_id);
alter table public.defect_audits enable row level security;
drop policy if exists "defect_audits_select" on public.defect_audits;
create policy "defect_audits_select" on public.defect_audits
  for select to authenticated
  using (project_id in (select public.my_project_ids()));
-- 刻意不開 insert/update/delete policy → RLS 預設拒絕,稽核不可竄改。
-- 20260712001200 的 default privileges 會把新表全權授給 authenticated,append-only 表必須回收。
grant select on public.defect_audits to authenticated;
revoke insert, update, delete on public.defect_audits from public, anon, authenticated;

create or replace function public.defects_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 專案刪除的 cascade 不記:父專案列已刪,寫稽核會踩 FK;稽核列本身也隨專案 cascade 刪
  if not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);
  end if;
  insert into public.defect_audits
    (project_id, defect_id, action, domain, reason, old_row, new_row, acted_by)
  values (
    old.project_id, old.id,
    case tg_op when 'UPDATE' then 'correct' else 'delete' end,
    old.domain,
    case tg_op when 'UPDATE' then new.correction_reason else old.correction_reason end,
    to_jsonb(old),
    case tg_op when 'UPDATE' then to_jsonb(new) else null end,
    auth.uid()
  );
  return coalesce(new, old);
end; $$;
drop trigger if exists defects_audit on public.defects;
create trigger defects_audit after update or delete on public.defects
  for each row execute function public.defects_audit();

-- ── 5) safety_records:工安缺失類型除役(新增導向缺失引擎) ───────────────────
-- 其餘規則與 formal_mode 版逐字一致;僅在 INSERT 前段加除役攔截。
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

  -- 工安缺失已併入統一缺失引擎(defects, domain='safety')
  if tg_op = 'INSERT' and new.record_type = '工安缺失' then
    raise exception '工安缺失已併入統一缺失引擎;請改於「缺失追蹤」開立(domain=safety)';
  end if;

  if tg_op = 'INSERT' and new.record_type not in
    ('自主檢查','教育訓練','危害告知','監造觀察','監造查驗','監造複查') then
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
