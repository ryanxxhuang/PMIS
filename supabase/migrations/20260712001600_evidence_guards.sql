-- ── R3 驗收修復:履約證據刪除防護 + 試體判定下沉 DB ──────────────────────────
-- (docs/PMIS-正式版三角色深度驗收測試-第三輪-2026-07-12.md P0-01 / P0-02 / P2-04)
--
-- P0-01:stale 分頁可刪除「已受理(審核中)」的送審,DB 真刪——RLS can_write 只管
--   「誰能刪」,沒有「什麼狀態下還能刪」。原則:一經他方審查即為履約證據,
--   不得實體刪除。同類缺口一併補:RFI(已回覆)、查驗(已判定)、估驗(非草稿)、
--   試體(已判定)。
-- 放行:service role(遷移/支援)、整案刪除 cascade(父專案已刪)、
--   admin_override(試用模式單人沙盒;正式模式自動失效)。
--
-- P0-02:混凝土 28 天判定原在前端(樂觀判定+另發缺失+再寫狀態,三步非交易,
--   會被 reload 蓋掉/半套落庫)。下沉為 BEFORE trigger:d28_values+fc′ 一寫入,
--   同一交易推導 status 並自動開缺失(以 defects.test_sample_id 防重複)。

-- ═══ 1) 刪除防護 ═════════════════════════════════════════════════════════════

-- 共用前置:回 true=直接放行(service role / cascade / 試用模式管理者)
create or replace function public.evidence_delete_bypass(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is null
      or not exists (select 1 from public.projects pr where pr.id = p_project)
      or public.admin_override(p_project)
$$;
revoke all on function public.evidence_delete_bypass(uuid) from public, anon;
grant execute on function public.evidence_delete_bypass(uuid) to authenticated;

create or replace function public.submittals_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.evidence_delete_bypass(old.project_id) then return old; end if;
  if old.status = '已提送' and coalesce(old.revision, 0) = 0 then return old; end if;
  raise exception '送審已有審查紀錄(狀態:%、版次:%),不可刪除;如需終止請由監造退回補正或駁回',
    old.status, coalesce(old.revision, 0);
end; $$;
drop trigger if exists submittals_delete_guard on public.submittals;
create trigger submittals_delete_guard before delete on public.submittals
  for each row execute function public.submittals_delete_guard();

create or replace function public.rfis_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.evidence_delete_bypass(old.project_id) then return old; end if;
  if old.status = '待回覆' then return old; end if;
  raise exception '工程疑義已有回覆紀錄(狀態:%),不可刪除', old.status;
end; $$;
drop trigger if exists rfis_delete_guard on public.rfis;
create trigger rfis_delete_guard before delete on public.rfis
  for each row execute function public.rfis_delete_guard();

create or replace function public.inspections_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.evidence_delete_bypass(old.project_id) then return old; end if;
  if old.status = '待查驗' then return old; end if;
  raise exception '查驗已判定(%),為品質證據不可刪除', old.status;
end; $$;
drop trigger if exists inspections_delete_guard on public.inspections;
create trigger inspections_delete_guard before delete on public.inspections
  for each row execute function public.inspections_delete_guard();

create or replace function public.valuations_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.evidence_delete_bypass(old.project_id) then return old; end if;
  if old.status = '草稿' then return old; end if;
  raise exception '估驗已送審/核定(狀態:%),不可刪除;請先由監造退回', old.status;
end; $$;
drop trigger if exists valuations_delete_guard on public.valuations;
create trigger valuations_delete_guard before delete on public.valuations
  for each row execute function public.valuations_delete_guard();

create or replace function public.test_samples_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.evidence_delete_bypass(old.project_id) then return old; end if;
  if old.status = '待試驗' then return old; end if;
  raise exception '試體已判定(%),為品質證據不可刪除', old.status;
end; $$;
drop trigger if exists test_samples_delete_guard on public.test_samples;
create trigger test_samples_delete_guard before delete on public.test_samples
  for each row execute function public.test_samples_delete_guard();

-- ═══ 2) 試體判定下沉 DB(P0-02) ══════════════════════════════════════════════

-- 缺失 ↔ 試體關聯(自動開缺失防重複的錨點)
alter table public.defects
  add column if not exists test_sample_id uuid references public.test_samples(id) on delete set null;

-- status 成為導出欄位:由 d28_values × fc′ 推導;值不足=待試驗。無人為 bypass。
-- 拆兩段:BEFORE 推導狀態(改寫 NEW);AFTER 開缺失(此時列已存在,FK 才掛得上)。
-- 兩段同屬一個交易——「畫面判不合格、F5 回待試驗、缺失沒開」從結構上不可能再發生。
create or replace function public.judge_test_sample()
returns trigger language plpgsql security definer set search_path = public as $$
declare avg_v numeric; min_v numeric; n int;
begin
  if new.d28_values is null or jsonb_typeof(new.d28_values) <> 'array' or new.fc is null then
    new.status := '待試驗';
    return new;
  end if;
  select avg(t.v::numeric), min(t.v::numeric), count(*)
    into avg_v, min_v, n
    from jsonb_array_elements_text(new.d28_values) as t(v);
  if coalesce(n, 0) = 0 then new.status := '待試驗'; return new; end if;
  -- 03310:任一試體 ≥ 0.85 fc′ 且平均 ≥ fc′
  if avg_v >= new.fc and min_v >= new.fc * 0.85 then new.status := '合格';
  else new.status := '不合格';
  end if;
  return new;
end; $$;
drop trigger if exists judge_test_sample on public.test_samples;
create trigger judge_test_sample before insert or update on public.test_samples
  for each row execute function public.judge_test_sample();

create or replace function public.test_sample_defect()
returns trigger language plpgsql security definer set search_path = public as $$
declare avg_v numeric; min_v numeric;
begin
  if new.status = '不合格'
     and not exists (select 1 from public.defects d where d.test_sample_id = new.id) then
    select avg(t.v::numeric), min(t.v::numeric) into avg_v, min_v
      from jsonb_array_elements_text(new.d28_values) as t(v);
    insert into public.defects
      (project_id, domain, test_sample_id, title, description, severity, location, status, created_by)
    values
      (new.project_id, 'quality', new.id,
       '試體抗壓不合格:' || coalesce(new.sample_no, ''),
       format('28天抗壓 平均 %s / 最低 %s kgf/cm²,未達 fc′ %s(標準:任一 ≥0.85fc′ 且平均 ≥fc′)',
              round(avg_v), round(min_v), new.fc),
       '嚴重', new.location, '開立', auth.uid());
  end if;
  return new;
end; $$;
drop trigger if exists test_sample_defect on public.test_samples;
create trigger test_sample_defect after insert or update on public.test_samples
  for each row execute function public.test_sample_defect();

-- ═══ 3) defect_audits 補 actor_org(P2-04:單表匯出可自足) ══════════════════════

alter table public.defect_audits add column if not exists actor_org text;

create or replace function public.defects_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 專案刪除的 cascade 不記:父專案列已刪,寫稽核會踩 FK;稽核列本身也隨專案 cascade 刪
  if not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);
  end if;
  insert into public.defect_audits
    (project_id, defect_id, action, domain, reason, old_row, new_row, acted_by, actor_org)
  values (
    old.project_id, old.id,
    case tg_op when 'UPDATE' then 'correct' else 'delete' end,
    old.domain,
    case tg_op when 'UPDATE' then new.correction_reason else old.correction_reason end,
    to_jsonb(old),
    case tg_op when 'UPDATE' then to_jsonb(new) else null end,
    auth.uid(),
    public.my_org_type()
  );
  return coalesce(new, old);
end; $$;
