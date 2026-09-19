-- P5e｜保固類循環義務的停止條件:保固期滿日＝正式驗收合格日＋契約載明的保固期間
-- (D-026 §4 契約時程與提醒對齊;使用者 2026-09-20 決定;設計 docs/architecture/slimming-entrypoints-and-retirement.md §4.3)。
--
-- 為什麼:P5c 把循環停止條件定為「實際竣工日優先、否則契約竣工日」,但保固類(category='保固')在保固期間才有
-- 義務、竣工日界定不了它——系統又沒有保固期滿日欄位,只能一律不產生期次、列「停止條件待補」。使用者 2026-09-20
-- 決定:保固期滿日＝正式驗收合格日＋契約載明的保固期間;兩者都有依據才計算並記錄來源,缺任一項列「待補設定」。
-- 正式庫唯讀盤點(2026-09-20,只取計數):保固類義務 0 筆(循環 0、單次 0)、保固類期次 0 列;approved 契約重點中
-- lifecycle_phase='保固' 0 筆、requirements／trigger_config 沒有任何可辨識的保固期間欄位;正式驗收合格(final＋合格)
-- 2 案。→ 保固期間沒有結構化來源,本 migration 新增最少必要的欄位,且只能引用已確認的契約重點(D-012 唯一權威)。
--
-- 做法:
--   1. projects 加「契約保固期間」三欄:期間數值、單位(年／月／日)、引用的契約重點(requirements.id)。由有權者
--      (is_project_admin,與基準日同一個 RPC update_project_anchors)在履約時程的履約期程卡登錄;guard 強制
--      「有期間就必須引用本案已確認(approved)且登錄者看得到的契約重點」——數值由人讀條文填寫,不由 AI 推測。
--      直接 REST 改同樣經 guard 與留版 trigger(不可能繞過依據或靜默覆寫)。
--   2. 版本沿用 P5c:project_anchor_versions 加 warranty 快照欄(變更後的期間／單位／引用條文),保固期間變更
--      記 changed_keys 'warranty_term',並同交易「只重算沒動過的待辦期」(已提送／已完成／掛證據／待核對的保留
--      原到期日與依據並記 kept),差異寫進 effects。
--   3. 正式驗收合格日:acceptance_events 的 final(正式驗收)最後登錄一筆且結果「合格」的 event_date;最後一筆
--      不合格或沒登錄 → 無。驗收事件登錄／更正／清除(trigger)與引用條文被取代(requirements status trigger)
--      都套用界限並補齊(沒動過的待辦期才移除／補回;不留版本,與 P5c 竣工登錄同一規則)。
--   4. 保固期滿日的日期規則只有一處 fn_warranty_expiry(民法 §120 II 始日不算入、§121 以月或年定期間之末日;
--      月底無相當日取該月末日;純 date 運算,不受 session 時區影響)。前端／Edge 不重算,讀 RPC
--      get_project_warranty 的結果(同一份事實,三方一致;不受契約分級 RLS 影響)。
--   5. 保固類循環義務的期次窗口＝保固期間:起算＝正式驗收合格日(期次到期日 ≥ 合格日),界限＝保固期滿日
--      (期間起日 ≤ 期滿日,與 P5c 竣工界限同語意),不看觸發點——否則觸發點為開工／未指定的保固義務會在施工期間
--      產生一整串假逾期期次。缺合格日或缺(有效的)保固期間 → 不產生、列「停止條件待補」並說明缺哪一項。
--   6. 義務類別在保固／非保固之間變動視同規則變更(只重建沒動過的待辦期),補 P5b／P5c 未涵蓋的邊界。
--
-- 資料:projects 三欄皆 null(正式庫沒有保固期間可回填,不臆測);project_anchor_versions 既有列的 warranty 為 null
-- (欄位新增不觸發 append-only guard);obligation_periods 對保固類義務套用新窗口(正式庫 0 列,實際不變)。
-- 回復:supabase/rollbacks/20260920021500_warranty_stop_condition.down.sql。
-- pgTAP:supabase/tests/warranty_stop_condition.sql;允許清單 anon_and_function_privileges.sql 加 get_project_warranty;
-- project_anchor_versions.sql 的保固類斷言改為新語意(使用者決定取代「保固類不產生」)。

-- 匿名 preflight:只記數量。
do $$
declare
  n_warranty bigint; n_warranty_recurring bigint; n_warranty_periods bigint; n_final_pass bigint; n_req_warranty bigint;
begin
  select count(*), count(*) filter (where recurring in ('daily','weekly','monthly','quarterly','yearly'))
    into n_warranty, n_warranty_recurring from public.contract_obligations where category = '保固';
  select count(*) into n_warranty_periods
    from public.obligation_periods x join public.contract_obligations o on o.id = x.obligation_id where o.category = '保固';
  select count(distinct project_id) into n_final_pass from public.acceptance_events
    where stage_key = 'final' and result = '合格' and event_date is not null;
  select count(*) into n_req_warranty from public.requirements where status = 'approved' and lifecycle_phase = '保固';
  raise notice 'warranty-stop preflight warranty_obligations=%, warranty_recurring=%, warranty_periods=%, final_pass_projects=%, approved_warranty_requirements=%',
    n_warranty, n_warranty_recurring, n_warranty_periods, n_final_pass, n_req_warranty;
end; $$;

-- ── 1. 欄位 ─────────────────────────────────────────────────────────────────────
alter table public.projects
  add column if not exists warranty_term_value integer,
  add column if not exists warranty_term_unit text,
  add column if not exists warranty_source_requirement_id uuid references public.requirements(id) on delete set null;
alter table public.projects drop constraint if exists projects_warranty_term_check;
alter table public.projects add constraint projects_warranty_term_check check (
  (warranty_term_value is null) = (warranty_term_unit is null)
  and (warranty_term_unit is null or warranty_term_unit in ('year', 'month', 'day'))
  and (warranty_term_value is null or warranty_term_value between 1 and 36500));
comment on column public.projects.warranty_term_value is
  'P5e 契約載明的保固期間數值(與 warranty_term_unit 成對);只經 update_project_anchors 或受 guard 約束的直接更新寫入,每次變更留一版';
comment on column public.projects.warranty_term_unit is 'P5e 保固期間單位:year 年／month 個月／day 日';
comment on column public.projects.warranty_source_requirement_id is
  'P5e 保固期間引用的契約重點(requirements.id;登錄時須為本案 approved);被取代或刪除時保固期滿日不再計算、列停止條件待補';
create index if not exists projects_warranty_source_idx on public.projects (warranty_source_requirement_id)
  where warranty_source_requirement_id is not null;

alter table public.project_anchor_versions add column if not exists warranty jsonb;
comment on column public.project_anchor_versions.warranty is
  'P5e 本版之後的契約保固期間快照 {term_value, term_unit, source_requirement_id};null=未登錄(P5e 前的版本一律 null)';

-- ── 2. 純函式與事實 ───────────────────────────────────────────────────────────────
-- 保固期滿日的唯一日期規則。民法 §120 II 以月或年定期間,始日不算入(次日起算);§121 II 以最後之月與起算日相當日
-- 之前一日為末日,最後之月無相當日者以該月末日為末日;以日定者為第 N 日。純 date／make_date 運算,不經 timestamptz,
-- 不受 session 時區影響。例:合格 2025-04-30＋1 個月 → 2025-05-31;2023-02-28＋1 年 → 2024-02-29;
-- 2025-01-30＋1 個月 → 2025-02-28;2025-03-15＋2 年 → 2027-03-15;2025-03-15＋180 日 → 2025-09-11。
create or replace function public.fn_warranty_expiry(p_pass date, p_value integer, p_unit text)
returns date language plpgsql immutable as $$
declare
  s date;
  n integer;
  m date;
  last_day integer;
begin
  if p_pass is null or p_value is null or p_value < 1 or p_unit is null then
    return null;
  end if;
  if p_unit = 'day' then
    return p_pass + p_value;
  end if;
  if p_unit not in ('month', 'year') then
    return null;
  end if;
  s := p_pass + 1;                                                     -- 始日不算入
  n := case p_unit when 'year' then p_value * 12 else p_value end;
  m := (make_date(extract(year from s)::integer, extract(month from s)::integer, 1) + make_interval(months => n))::date;
  last_day := extract(day from (m + interval '1 month' - interval '1 day'))::integer;
  if extract(day from s)::integer <= last_day then
    return m + (extract(day from s)::integer - 2);                     -- 相當日之前一日
  end if;
  return m + (last_day - 1);                                           -- 無相當日:該月末日
end $$;
revoke all on function public.fn_warranty_expiry(date, integer, text) from public, anon, authenticated;

-- 正式驗收合格:驗收流程「正式驗收」(final)最後登錄的一筆(created_at 最大,同 P5c 竣工日取法);結果為「合格」
-- 才回其日期與事件,最後一筆不合格或沒登錄 → 兩欄皆 null。
create or replace function public.fn_project_acceptance_pass(p_project uuid, out pass_date date, out event_id uuid)
language sql stable set search_path = public as $$
  select case when a.result = '合格' then a.event_date end, case when a.result = '合格' then a.id end
  from public.acceptance_events a
  where a.project_id = p_project and a.stage_key = 'final' and a.event_date is not null
  order by a.created_at desc, a.id desc
  limit 1;
$$;
revoke all on function public.fn_project_acceptance_pass(uuid) from public, anon, authenticated;

-- 保固期間快照(版本列與重算用):三欄皆 null → null。
create or replace function public.fn_warranty_snapshot(p_value integer, p_unit text, p_requirement uuid)
returns jsonb language sql immutable as $$
  select case when p_value is null and p_unit is null and p_requirement is null then null
    else jsonb_build_object('term_value', p_value, 'term_unit', p_unit, 'source_requirement_id', p_requirement) end;
$$;
revoke all on function public.fn_warranty_snapshot(integer, text, uuid) from public, anon, authenticated;

-- 基準日＋保固期間的完整狀態(留版 trigger 比對用;四日期仍是 fn_anchors_json 的形狀,warranty 另一個鍵)。
create or replace function public.fn_anchor_state_json(
  p_award date, p_notice date, p_commencement date, p_end date, p_w_value integer, p_w_unit text, p_w_requirement uuid
) returns jsonb language sql immutable as $$
  select public.fn_anchors_json(p_award, p_notice, p_commencement, p_end)
         || jsonb_build_object('warranty', public.fn_warranty_snapshot(p_w_value, p_w_unit, p_w_requirement));
$$;
revoke all on function public.fn_anchor_state_json(date, date, date, date, integer, text, uuid) from public, anon, authenticated;

-- 缺口說明(與 _shared/ballInCourtRules.ts warrantyGap 同口徑;共用案例與 pgTAP 各釘一側)。
create or replace function public.fn_warranty_gap_text(p_pass date, p_term_value integer, p_source_ok boolean)
returns text language sql immutable as $$
  select case when cardinality(parts) = 0 then null else array_to_string(parts, '、') || '，無法判定保固期滿日' end
  from (select array_remove(array[
    case when p_pass is null then '缺正式驗收合格日' end,
    case when p_term_value is null then '缺契約保固期間'
         when not coalesce(p_source_ok, false) then '保固期間引用的契約條文已不是已確認狀態' end
  ], null) as parts) x;
$$;
revoke all on function public.fn_warranty_gap_text(date, integer, boolean) from public, anon, authenticated;

-- 本案保固期滿日與依據(單一事實來源;RPC、物化、重算、停止條件都讀它):
--   {acceptance_date, acceptance_event_id, term_value, term_unit, source_requirement_id, source_status, source_ok,
--    expiry, needs[acceptance|term], gap}
-- 兩項齊全(合格日＋引用本案 approved 條文的保固期間)才算 expiry;缺任一項 expiry=null 並列 needs／gap。
create or replace function public.fn_project_warranty(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  w_value integer;
  w_unit text;
  w_req uuid;
  pass_date date;
  pass_event uuid;
  req_status text;
  source_ok boolean;
  needs text[] := '{}'::text[];
begin
  select p.warranty_term_value, p.warranty_term_unit, p.warranty_source_requirement_id
    into w_value, w_unit, w_req
  from public.projects p where p.id = p_project;
  if not found then
    return null;
  end if;
  select a.pass_date, a.event_id into pass_date, pass_event from public.fn_project_acceptance_pass(p_project) a;
  select r.status into req_status from public.requirements r where r.id = w_req and r.project_id = p_project;
  source_ok := coalesce(w_value is not null and req_status = 'approved', false);
  if pass_date is null then needs := needs || 'acceptance'::text; end if;
  if not source_ok then needs := needs || 'term'::text; end if;
  return jsonb_build_object(
    'acceptance_date', pass_date, 'acceptance_event_id', pass_event,
    'term_value', w_value, 'term_unit', w_unit, 'source_requirement_id', w_req,
    'source_status', req_status, 'source_ok', source_ok,
    'expiry', case when cardinality(needs) = 0 then public.fn_warranty_expiry(pass_date, w_value, w_unit) end,
    'needs', to_jsonb(needs),
    'gap', public.fn_warranty_gap_text(pass_date, w_value, source_ok));
end $$;
revoke all on function public.fn_project_warranty(uuid) from public, anon, authenticated;

-- 某個保固期間快照在「目前的引用條文狀態」下的期滿日(重算比對新舊界限用)。
create or replace function public.fn_warranty_bound_of(p_project uuid, p_pass date, p_snapshot jsonb)
returns date language sql stable security definer set search_path = public as $$
  select case when p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then null
    when exists (select 1 from public.requirements r
                 where r.id = nullif(p_snapshot ->> 'source_requirement_id', '')::uuid
                   and r.project_id = p_project and r.status = 'approved')
      then public.fn_warranty_expiry(p_pass, (p_snapshot ->> 'term_value')::integer, p_snapshot ->> 'term_unit')
    else null end;
$$;
revoke all on function public.fn_warranty_bound_of(uuid, date, jsonb) from public, anon, authenticated;

-- 對外唯讀 RPC:成員(任一方)或 service(早報／Agent 收集器)。security definer 讓三方看到同一份事實
-- (引用條文的狀態不受契約分級 RLS 影響;條文內容仍由前端依 RLS 讀取)。
create or replace function public.get_project_warranty(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null or auth.role() = 'authenticated' then
    if auth.uid() is null or p_project not in (select public.my_project_ids()) then
      raise exception 'project not found or not a member';
    end if;
  end if;
  return public.fn_project_warranty(p_project);
end $$;
revoke all on function public.get_project_warranty(uuid) from public, anon;
grant execute on function public.get_project_warranty(uuid) to authenticated, service_role;
comment on function public.get_project_warranty(uuid) is
  'P5e read-only: project warranty expiry = formal acceptance pass date + contract warranty term (both with basis) and what is missing (members or service).';

comment on function public.fn_obligation_recurrence_bound(text, date, date) is
  'P5c 竣工界限(實際竣工日優先、否則契約竣工日);保固類不由竣工日界定——P5e 起由 fn_project_warranty 的保固期滿日界定(呼叫端分流)';

-- 停止條件缺口(與 _shared/ballInCourtRules.ts recurrenceStopGap 同口徑):保固類讀本案保固事實(fn_project_warranty),
-- 其餘沿用 P5c。取代 P5c 的四參數版本(第五參數預設 null=未登錄任何保固事實)。
drop function if exists public.fn_obligation_recurrence_stop_gap(text, date, date, date);
create or replace function public.fn_obligation_recurrence_stop_gap(
  p_category text, p_end_date date, p_completion date, p_today date, p_warranty jsonb default null
) returns text language sql immutable as $$
  select case
    when p_category = '保固' then public.fn_warranty_gap_text(
      nullif(p_warranty ->> 'acceptance_date', '')::date,
      nullif(p_warranty ->> 'term_value', '')::integer,
      coalesce((p_warranty ->> 'source_ok')::boolean, false))
    when p_completion is not null then null
    when p_end_date is null then '缺竣工日，無法判定循環何時結束'
    when p_end_date < p_today then '竣工日 ' || to_char(p_end_date, 'YYYY-MM-DD') || ' 已過，尚未登錄竣工或展延'
    else null end;
$$;
revoke all on function public.fn_obligation_recurrence_stop_gap(text, date, date, date, jsonb) from public, anon, authenticated;

-- ── 3. guard:保固期間必須引用本案已確認的契約重點 ──────────────────────────────────────
-- 只在三欄有變時檢查(引用條文日後被取代不擋無關的專案更新);引用條文被刪除的 FK set null 放行(期間保留、
-- 停止條件列「引用條文已失效」)。登入者(auth.uid() 非 null)只能引用自己看得到的條文(契約分級 D-018)。
create or replace function public.projects_warranty_term_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  term_changed boolean;
  req_changed boolean;
  req_project uuid;
  req_status text;
begin
  term_changed := tg_op = 'INSERT'
    or new.warranty_term_value is distinct from old.warranty_term_value
    or new.warranty_term_unit is distinct from old.warranty_term_unit;
  req_changed := tg_op = 'INSERT' or new.warranty_source_requirement_id is distinct from old.warranty_source_requirement_id;
  if not term_changed and not req_changed then
    return new;
  end if;
  if new.warranty_term_value is null then
    if new.warranty_source_requirement_id is not null then
      raise exception '未登錄保固期間時不可單獨引用契約條文' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.warranty_source_requirement_id is null then
    if term_changed then
      raise exception '保固期間須引用已確認的契約條文(契約載明的保固期間)' using errcode = 'P0001';
    end if;
    return new; -- 引用條文被刪除(FK set null):期間保留,保固期滿日不再計算
  end if;
  select r.project_id, r.status into req_project, req_status
  from public.requirements r where r.id = new.warranty_source_requirement_id;
  if req_project is distinct from new.id
     or (auth.uid() is not null and not public.can_read_requirement_row(new.warranty_source_requirement_id)) then
    raise exception '引用的契約條文不存在、不屬於本案或你無權查閱' using errcode = 'P0001';
  end if;
  if req_status is distinct from 'approved' then
    raise exception '只能引用已確認的契約條文(目前狀態:%)', req_status using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.projects_warranty_term_guard() from public, anon, authenticated;
drop trigger if exists projects_warranty_term_guard on public.projects;
create trigger projects_warranty_term_guard
  before insert or update of warranty_term_value, warranty_term_unit, warranty_source_requirement_id on public.projects
  for each row execute function public.projects_warranty_term_guard();

-- ── 4. materialize:保固類的窗口＝保固期間(取代 P5c 同名函式;非保固類不變)───────────────────
create or replace function public.fn_materialize_obligation_periods_for(
  p_obligation uuid, p_today date default null, p_lookahead_days integer default 31
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  ob record;
  anchor_key text;
  anchor date;
  bound date;
  w jsonb;
  basis_extra jsonb := '{}'::jsonb;
  cur_version integer;
  today date := coalesce(p_today, public.fn_taipei_today());
  inserted integer := 0;
begin
  select o.id, o.project_id, o.status, o.category, o.recurring, o.recurring_day, o.recurring_weekday, o.recurring_month,
         o.trigger_event, o.fixed_date,
         p.award_date, p.notice_date, p.commencement_date, p.end_date
    into ob
  from public.contract_obligations o
  join public.projects p on p.id = o.project_id
  where o.id = p_obligation;
  if not found or ob.status = '不適用'
     or ob.recurring is null or ob.recurring not in ('daily','weekly','monthly','quarterly','yearly')
     or public.fn_obligation_recurrence_gap(ob.recurring, ob.recurring_day, ob.recurring_weekday, ob.recurring_month, ob.trigger_event, ob.fixed_date) is not null then
    return 0;
  end if;
  if ob.category = '保固' then
    -- P5e:保固期間＝正式驗收合格日起、保固期滿日止;兩項缺一不產生(前端列「停止條件待補」)
    w := public.fn_project_warranty(ob.project_id);
    anchor_key := 'acceptance_pass_date';
    anchor := nullif(w ->> 'acceptance_date', '')::date;
    bound := nullif(w ->> 'expiry', '')::date;
    basis_extra := jsonb_build_object('version', 3, 'bound_kind', 'warranty_expiry', 'warranty', jsonb_build_object(
      'acceptance_event_id', w -> 'acceptance_event_id', 'term_value', w -> 'term_value', 'term_unit', w -> 'term_unit',
      'source_requirement_id', w -> 'source_requirement_id'));
  else
    anchor_key := public.fn_obligation_recurrence_anchor_key(ob.trigger_event);
    anchor := case anchor_key
      when 'award_date' then ob.award_date
      when 'notice_date' then ob.notice_date
      when 'commencement_date' then ob.commencement_date
      when 'end_date' then ob.end_date
      when 'fixed_date' then ob.fixed_date
      else null end;
    bound := public.fn_obligation_recurrence_bound(ob.category, ob.end_date, public.fn_project_completion_date(ob.project_id));
  end if;
  if anchor is null or bound is null then
    return 0; -- 起算日待補或停止條件判不出:不臆測
  end if;
  select max(v.version_no) into cur_version from public.project_anchor_versions v where v.project_id = ob.project_id;
  insert into public.obligation_periods (project_id, obligation_id, period_key, period_start, period_end, due_date, basis, anchor_version_no)
  select ob.project_id, ob.id, s.period_key, s.period_start, s.period_end, s.due_date,
         jsonb_build_object(
           'version', 2, 'recurring', ob.recurring, 'recurring_day', ob.recurring_day,
           'recurring_weekday', ob.recurring_weekday, 'recurring_month', ob.recurring_month,
           'anchor_key', anchor_key, 'anchor_date', anchor, 'bound_date', bound,
           'materialized_on', today, 'lookahead_days', p_lookahead_days) || basis_extra,
         cur_version
  from public.fn_obligation_period_schedule(ob.recurring, ob.recurring_day, ob.recurring_weekday, ob.recurring_month, anchor, today, p_lookahead_days) s
  where s.period_start <= bound
  on conflict (obligation_id, period_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end; $$;
revoke all on function public.fn_materialize_obligation_periods_for(uuid, date, integer) from public, anon, authenticated;

-- 套用界限(取代 P5c):沒動過的待辦期若落在窗口外即移除——非保固類:期間起日 > 竣工界限或界限判不出;
-- 保固類:合格日或期滿日判不出、到期日早於合格日(合格日更正延後)、期間起日 > 期滿日。動過的期一律保留。
create or replace function public.fn_apply_obligation_recurrence_bound(p_project uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  completion date := public.fn_project_completion_date(p_project);
  w jsonb := public.fn_project_warranty(p_project);
  w_pass date := nullif(w ->> 'acceptance_date', '')::date;
  w_expiry date := nullif(w ->> 'expiry', '')::date;
  ob record;
  bound date;
  removed integer := 0;
  n integer;
begin
  for ob in
    select o.id, o.category, p.end_date
    from public.contract_obligations o join public.projects p on p.id = o.project_id
    where o.project_id = p_project and o.recurring in ('daily','weekly','monthly','quarterly','yearly') and o.status <> '不適用'
  loop
    if ob.category = '保固' then
      delete from public.obligation_periods x
      where x.obligation_id = ob.id
        and (w_pass is null or w_expiry is null or x.due_date < w_pass or x.period_start > w_expiry)
        and x.status = '待辦' and x.completed_at is null and x.evidence_submittal_id is null and x.evidence_document_id is null and x.review_note is null;
    else
      bound := public.fn_obligation_recurrence_bound(ob.category, ob.end_date, completion);
      delete from public.obligation_periods x
      where x.obligation_id = ob.id and (bound is null or x.period_start > bound)
        and x.status = '待辦' and x.completed_at is null and x.evidence_submittal_id is null and x.evidence_document_id is null and x.review_note is null;
    end if;
    get diagnostics n = row_count;
    removed := removed + n;
  end loop;
  return removed;
end; $$;
revoke all on function public.fn_apply_obligation_recurrence_bound(uuid) from public, anon, authenticated;

-- ── 5. 留版重算(取代 P5c):保固期間變更 → 保固類只重算沒動過的待辦期,差異寫進 effects ─────────────
-- p_old／p_new 為 fn_anchor_state_json 形狀(四日期＋warranty);呼叫端只給四日期(舊形狀)時 warranty 視為未變。
create or replace function public.fn_recompute_obligations_for_anchor_version(
  p_project uuid, p_version integer, p_old jsonb, p_new jsonb, p_today date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  changed text[] := '{}'::text[];
  k text;
  effects jsonb := '[]'::jsonb;
  today date := coalesce(p_today, public.fn_taipei_today());
  completion date := public.fn_project_completion_date(p_project);
  pass_date date := (public.fn_project_acceptance_pass(p_project)).pass_date;
  w_old jsonb := nullif(p_old -> 'warranty', 'null'::jsonb);
  w_new jsonb := nullif(p_new -> 'warranty', 'null'::jsonb);
  warranty_changed boolean := (p_new ? 'warranty') and (w_old is distinct from w_new);
  ob record;
  r record;
  anchor_key text;
  anchor date;
  bound date;
  old_anchor date;
  old_bound date;
  v_old_due date;
  v_new_due date;
begin
  foreach k in array array['award_date','notice_date','commencement_date','end_date'] loop
    if (p_old ->> k) is distinct from (p_new ->> k) then changed := changed || k; end if;
  end loop;
  if warranty_changed then changed := changed || 'warranty_term'::text; end if;
  if cardinality(changed) = 0 then return effects; end if;

  for ob in
    select o.id, o.title, o.status, o.category, o.recurring, o.recurring_day, o.recurring_weekday, o.recurring_month,
           o.trigger_event, o.offset_days, o.offset_dir, o.fixed_date, o.due_date_snapshot
    from public.contract_obligations o
    where o.project_id = p_project and o.status <> '不適用'
    order by o.sort_order, o.id
  loop
    if ob.recurring in ('daily','weekly','monthly','quarterly','yearly') then
      if ob.category = '保固' then
        -- 保固類:起算＝正式驗收合格日(不隨基準日變),界限＝保固期滿日(隨保固期間變)
        if not warranty_changed then continue; end if;
        anchor_key := 'acceptance_pass_date';
        anchor := pass_date;
        old_anchor := pass_date;
        bound := public.fn_warranty_bound_of(p_project, pass_date, w_new);
        old_bound := public.fn_warranty_bound_of(p_project, pass_date, w_old);
      else
        anchor_key := public.fn_obligation_recurrence_anchor_key(ob.trigger_event);
        if not (anchor_key = any(changed) or 'end_date' = any(changed)) then continue; end if;
        anchor := case anchor_key
          when 'award_date' then (p_new ->> 'award_date')::date
          when 'notice_date' then (p_new ->> 'notice_date')::date
          when 'commencement_date' then (p_new ->> 'commencement_date')::date
          when 'end_date' then (p_new ->> 'end_date')::date
          when 'fixed_date' then ob.fixed_date
          else null end;
        old_anchor := case anchor_key
          when 'award_date' then (p_old ->> 'award_date')::date
          when 'notice_date' then (p_old ->> 'notice_date')::date
          when 'commencement_date' then (p_old ->> 'commencement_date')::date
          when 'end_date' then (p_old ->> 'end_date')::date
          when 'fixed_date' then ob.fixed_date
          else null end;
        bound := public.fn_obligation_recurrence_bound(ob.category, (p_new ->> 'end_date')::date, completion);
        old_bound := public.fn_obligation_recurrence_bound(ob.category, (p_old ->> 'end_date')::date, completion);
      end if;
      if public.fn_obligation_recurrence_gap(ob.recurring, ob.recurring_day, ob.recurring_weekday, ob.recurring_month, ob.trigger_event, ob.fixed_date) is not null then
        anchor := null; old_anchor := null; -- 規則不完整:排程為空(既有沒動過的待辦期會被移除,與 P5b 規則變更同語意)
      end if;
      -- 改期:沒動過的待辦期,同期別但日期不同
      for r in
        select x.id, x.period_key, x.due_date as old_due, s.period_start, s.period_end, s.due_date as new_due
        from public.obligation_periods x
        join public.fn_obligation_period_schedule(ob.recurring, ob.recurring_day, ob.recurring_weekday, ob.recurring_month, anchor, today, 31) s
          on s.period_key = x.period_key
        where x.obligation_id = ob.id and s.period_start <= bound
          and x.status = '待辦' and x.completed_at is null and x.evidence_submittal_id is null and x.evidence_document_id is null and x.review_note is null
          and (x.due_date, x.period_start, x.period_end) is distinct from (s.due_date, s.period_start, s.period_end)
      loop
        update public.obligation_periods
        set period_start = r.period_start, period_end = r.period_end, due_date = r.new_due,
            basis = basis || jsonb_build_object('anchor_date', anchor, 'bound_date', bound, 'rescheduled_on', today),
            anchor_version_no = p_version, updated_at = now()
        where id = r.id;
        effects := effects || jsonb_build_object('kind', 'rescheduled', 'obligation_id', ob.id, 'title', ob.title,
          'period_key', r.period_key, 'old_due', r.old_due, 'new_due', r.new_due, 'status', '待辦');
      end loop;
      -- 移除:沒動過的待辦期,新排程裡沒有(基準日後移、竣工日提前、保固期間縮短或失去依據、規則不完整)
      for r in
        select x.id, x.period_key, x.due_date as old_due
        from public.obligation_periods x
        where x.obligation_id = ob.id
          and x.status = '待辦' and x.completed_at is null and x.evidence_submittal_id is null and x.evidence_document_id is null and x.review_note is null
          and not exists (
            select 1 from public.fn_obligation_period_schedule(ob.recurring, ob.recurring_day, ob.recurring_weekday, ob.recurring_month, anchor, today, 31) s
            where s.period_key = x.period_key and s.period_start <= bound)
      loop
        delete from public.obligation_periods where id = r.id;
        effects := effects || jsonb_build_object('kind', 'removed', 'obligation_id', ob.id, 'title', ob.title,
          'period_key', r.period_key, 'old_due', r.old_due, 'new_due', null, 'status', '待辦');
      end loop;
      -- 新增:新排程多出的期(基準日提前、竣工日展延、保固期間登錄或延長)
      for r in
        select s.period_key, s.period_start, s.period_end, s.due_date as new_due
        from public.fn_obligation_period_schedule(ob.recurring, ob.recurring_day, ob.recurring_weekday, ob.recurring_month, anchor, today, 31) s
        where s.period_start <= bound
          and not exists (select 1 from public.obligation_periods x where x.obligation_id = ob.id and x.period_key = s.period_key)
      loop
        insert into public.obligation_periods (project_id, obligation_id, period_key, period_start, period_end, due_date, basis, anchor_version_no)
        values (p_project, ob.id, r.period_key, r.period_start, r.period_end, r.new_due,
          jsonb_build_object('version', 2, 'recurring', ob.recurring, 'recurring_day', ob.recurring_day,
            'recurring_weekday', ob.recurring_weekday, 'recurring_month', ob.recurring_month,
            'anchor_key', anchor_key, 'anchor_date', anchor, 'bound_date', bound, 'materialized_on', today, 'lookahead_days', 31)
          || case when ob.category = '保固' then jsonb_build_object('version', 3, 'bound_kind', 'warranty_expiry', 'warranty',
               (select jsonb_build_object('acceptance_event_id', w -> 'acceptance_event_id', 'term_value', w -> 'term_value',
                  'term_unit', w -> 'term_unit', 'source_requirement_id', w -> 'source_requirement_id')
                from (select public.fn_project_warranty(p_project) as w) q))
             else '{}'::jsonb end,
          p_version);
        effects := effects || jsonb_build_object('kind', 'added', 'obligation_id', ob.id, 'title', ob.title,
          'period_key', r.period_key, 'old_due', null, 'new_due', r.new_due, 'status', '待辦');
      end loop;
      -- 保留:動過的期,這一版的變更會影響它(舊排程有、新排程沒有,或到期日不同)→ 原樣不動,只記 kept
      for r in
        select x.period_key, x.due_date as old_due, x.status
        from public.obligation_periods x
        left join public.fn_obligation_period_schedule(ob.recurring, ob.recurring_day, ob.recurring_weekday, ob.recurring_month, anchor, today, 31) s
          on s.period_key = x.period_key and s.period_start <= bound
        left join public.fn_obligation_period_schedule(ob.recurring, ob.recurring_day, ob.recurring_weekday, ob.recurring_month, old_anchor, today, 31) so
          on so.period_key = x.period_key and so.period_start <= old_bound
        where x.obligation_id = ob.id
          and not (x.status = '待辦' and x.completed_at is null and x.evidence_submittal_id is null and x.evidence_document_id is null and x.review_note is null)
          and ((s.period_key is null) is distinct from (so.period_key is null) or s.due_date is distinct from so.due_date)
      loop
        effects := effects || jsonb_build_object('kind', 'kept', 'obligation_id', ob.id, 'title', ob.title,
          'period_key', r.period_key, 'old_due', r.old_due, 'new_due', null, 'status', r.status);
      end loop;
    else
      anchor_key := public.fn_obligation_single_anchor_key(ob.trigger_event);
      if anchor_key is null or not (anchor_key = any(changed)) then continue; end if;
      if ob.status in ('已提送','已完成') then
        effects := effects || jsonb_build_object('kind', 'kept', 'obligation_id', ob.id, 'title', ob.title,
          'period_key', null, 'old_due', ob.due_date_snapshot, 'new_due', null, 'status', ob.status);
        continue;
      end if;
      v_old_due := public.fn_obligation_single_due(ob.trigger_event, ob.offset_days, ob.offset_dir, ob.fixed_date,
        (p_old ->> 'award_date')::date, (p_old ->> 'notice_date')::date, (p_old ->> 'commencement_date')::date, (p_old ->> 'end_date')::date);
      v_new_due := public.fn_obligation_single_due(ob.trigger_event, ob.offset_days, ob.offset_dir, ob.fixed_date,
        (p_new ->> 'award_date')::date, (p_new ->> 'notice_date')::date, (p_new ->> 'commencement_date')::date, (p_new ->> 'end_date')::date);
      if v_old_due is distinct from v_new_due then
        effects := effects || jsonb_build_object('kind', 'rescheduled', 'obligation_id', ob.id, 'title', ob.title,
          'period_key', null, 'old_due', v_old_due, 'new_due', v_new_due, 'status', ob.status);
      end if;
    end if;
  end loop;
  return effects;
end; $$;
revoke all on function public.fn_recompute_obligations_for_anchor_version(uuid, integer, jsonb, jsonb, date) from public, anon, authenticated;

-- 記一版(取代 P5c):四日期存 anchors、保固期間存 warranty;changed_keys 另記 'warranty_term'。
create or replace function public.fn_record_project_anchor_version(
  p_project uuid, p_old jsonb, p_new jsonb, p_change_kind text,
  p_reason text, p_source_ref text, p_source_change_order_id uuid, p_effective_from date, p_today date default null
) returns public.project_anchor_versions
language plpgsql security definer set search_path = public as $$
declare
  next_no integer;
  changed text[] := '{}'::text[];
  k text;
  fx jsonb;
  w_new jsonb := nullif(p_new -> 'warranty', 'null'::jsonb);
  v public.project_anchor_versions;
begin
  perform pg_advisory_xact_lock(hashtextextended('anchors:' || p_project::text, 0));
  select coalesce(max(version_no), 0) + 1 into next_no from public.project_anchor_versions where project_id = p_project;
  foreach k in array array['award_date','notice_date','commencement_date','end_date'] loop
    if (p_old ->> k) is distinct from (p_new ->> k) then changed := changed || k; end if;
  end loop;
  if (p_new ? 'warranty') and nullif(p_old -> 'warranty', 'null'::jsonb) is distinct from w_new then
    changed := changed || 'warranty_term'::text;
  end if;
  fx := public.fn_recompute_obligations_for_anchor_version(p_project, next_no, p_old, p_new, p_today);
  insert into public.project_anchor_versions
    (project_id, version_no, change_kind, anchors, changed_keys, effective_from, reason, source_ref, source_change_order_id, effects, created_by, warranty)
  values
    (p_project, next_no, coalesce(p_change_kind, 'edit'), p_new - 'warranty', changed, p_effective_from, nullif(btrim(p_reason), ''), nullif(btrim(p_source_ref), ''),
     p_source_change_order_id, fx, auth.uid(), w_new)
  returning * into v;
  return v;
end; $$;
revoke all on function public.fn_record_project_anchor_version(uuid, jsonb, jsonb, text, text, text, uuid, date, date) from public, anon, authenticated;

-- projects 基準日或保固期間 INSERT／UPDATE → 自動留版(取代 P5c;保固期間三欄加入觸發欄位與比對)。
create or replace function public.projects_anchor_versions_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb;
  raw text;
  old_json jsonb;
  new_json jsonb := public.fn_anchor_state_json(new.award_date, new.notice_date, new.commencement_date, new.end_date,
    new.warranty_term_value, new.warranty_term_unit, new.warranty_source_requirement_id);
begin
  raw := current_setting('pmis.anchor_change', true);
  meta := case when raw is null or raw = '' then '{}'::jsonb else raw::jsonb end;
  if tg_op = 'INSERT' then
    if new.award_date is null and new.notice_date is null and new.commencement_date is null and new.end_date is null
       and new.warranty_term_value is null and new.warranty_source_requirement_id is null then
      return null;
    end if;
    old_json := public.fn_anchor_state_json(null, null, null, null, null, null, null);
    perform public.fn_record_project_anchor_version(new.id, old_json, new_json, coalesce(meta ->> 'change_kind', 'initial'),
      meta ->> 'reason', meta ->> 'source_ref', (meta ->> 'source_change_order_id')::uuid,
      coalesce((meta ->> 'effective_from')::date, public.fn_taipei_today()));
    return null;
  end if;
  old_json := public.fn_anchor_state_json(old.award_date, old.notice_date, old.commencement_date, old.end_date,
    old.warranty_term_value, old.warranty_term_unit, old.warranty_source_requirement_id);
  if old_json = new_json then return null; end if;
  perform public.fn_record_project_anchor_version(new.id, old_json, new_json, coalesce(meta ->> 'change_kind', 'edit'),
    meta ->> 'reason', meta ->> 'source_ref', (meta ->> 'source_change_order_id')::uuid,
    coalesce((meta ->> 'effective_from')::date, public.fn_taipei_today()));
  -- 版本紀錄的重算只涵蓋受影響的義務;其餘(例如基準日從缺到有)由既有冪等物化補齊
  perform public.fn_materialize_obligation_periods(new.id);
  return null;
end $$;
revoke all on function public.projects_anchor_versions_sync() from public, anon, authenticated;
drop trigger if exists projects_anchor_versions_sync on public.projects;
create trigger projects_anchor_versions_sync
  after insert or update of award_date, notice_date, commencement_date, end_date,
    warranty_term_value, warranty_term_unit, warranty_source_requirement_id on public.projects
  for each row execute function public.projects_anchor_versions_sync();

-- ── 6. 對外 RPC(取代 P5c):p_anchors 另收保固期間三鍵;授權、GUC 帶依據、回傳版本列的語意不變 ──────────
create or replace function public.update_project_anchors(
  p_project uuid, p_anchors jsonb default '{}'::jsonb, p_change_kind text default 'edit',
  p_reason text default null, p_source_ref text default null, p_source_change_order_id uuid default null,
  p_effective_from date default null
) returns public.project_anchor_versions
language plpgsql security definer set search_path = public as $$
declare
  date_keys text[] := array['award_date','notice_date','commencement_date','end_date'];
  warranty_keys text[] := array['warranty_term_value','warranty_term_unit','warranty_source_requirement_id'];
  k text;
  before_no integer;
  updated_id uuid;
  v public.project_anchor_versions;
  cur record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_project_admin(p_project) then
    raise exception '未生效:僅專案管理者可修改基準日';
  end if;
  if p_anchors is null or jsonb_typeof(p_anchors) <> 'object' then
    raise exception 'p_anchors 必須是物件';
  end if;
  for k in select jsonb_object_keys(p_anchors) loop
    if k = any(date_keys) then
      if jsonb_typeof(p_anchors -> k) not in ('null', 'string') then raise exception '基準日 % 必須是日期字串或 null', k; end if;
      if jsonb_typeof(p_anchors -> k) = 'string' then perform (p_anchors ->> k)::date; end if;
    elsif k = 'warranty_term_value' then
      if jsonb_typeof(p_anchors -> k) not in ('null', 'number') or (jsonb_typeof(p_anchors -> k) = 'number' and (p_anchors ->> k) !~ '^[0-9]+$') then
        raise exception '保固期間數值必須是正整數或 null';
      end if;
    elsif k = 'warranty_term_unit' then
      if jsonb_typeof(p_anchors -> k) <> 'null' and (p_anchors ->> k) not in ('year', 'month', 'day') then
        raise exception '保固期間單位必須是 year／month／day';
      end if;
    elsif k = 'warranty_source_requirement_id' then
      if jsonb_typeof(p_anchors -> k) not in ('null', 'string') then raise exception '引用條文必須是 id 字串或 null'; end if;
      if jsonb_typeof(p_anchors -> k) = 'string' then perform (p_anchors ->> k)::uuid; end if;
    else
      raise exception '未知的基準日欄位: %', k;
    end if;
  end loop;
  if p_change_kind is null or p_change_kind not in ('edit','suspension','resumption','extension','change_order') then
    raise exception 'unknown anchor change kind: %', p_change_kind;
  end if;
  if p_source_change_order_id is not null and not exists (
    select 1 from public.change_orders c where c.id = p_source_change_order_id and c.project_id = p_project) then
    raise exception '依據的變更設計不屬於本案';
  end if;

  select coalesce(max(version_no), 0) into before_no from public.project_anchor_versions where project_id = p_project;
  perform set_config('pmis.anchor_change', jsonb_build_object(
    'change_kind', p_change_kind, 'reason', p_reason, 'source_ref', p_source_ref,
    'source_change_order_id', p_source_change_order_id, 'effective_from', p_effective_from)::text, true);
  update public.projects
  set award_date = case when p_anchors ? 'award_date' then (p_anchors ->> 'award_date')::date else award_date end,
      notice_date = case when p_anchors ? 'notice_date' then (p_anchors ->> 'notice_date')::date else notice_date end,
      commencement_date = case when p_anchors ? 'commencement_date' then (p_anchors ->> 'commencement_date')::date else commencement_date end,
      end_date = case when p_anchors ? 'end_date' then (p_anchors ->> 'end_date')::date else end_date end,
      warranty_term_value = case when p_anchors ? 'warranty_term_value' then (p_anchors ->> 'warranty_term_value')::integer else warranty_term_value end,
      warranty_term_unit = case when p_anchors ? 'warranty_term_unit' then p_anchors ->> 'warranty_term_unit' else warranty_term_unit end,
      warranty_source_requirement_id = case when p_anchors ? 'warranty_source_requirement_id' then (p_anchors ->> 'warranty_source_requirement_id')::uuid else warranty_source_requirement_id end
  where id = p_project
  returning id into updated_id;
  perform set_config('pmis.anchor_change', '', true);
  if updated_id is null then
    raise exception 'project not found';
  end if;

  select * into v from public.project_anchor_versions where project_id = p_project order by version_no desc limit 1;
  if (v.id is null or v.version_no = before_no) and p_change_kind <> 'edit' then
    -- 四日期與保固期間未變的停工／復工／展延／核准變更:仍記一版(effects 為空),依據不遺失
    select award_date, notice_date, commencement_date, end_date, warranty_term_value, warranty_term_unit, warranty_source_requirement_id
      into cur from public.projects where id = p_project;
    v := public.fn_record_project_anchor_version(p_project,
      public.fn_anchor_state_json(cur.award_date, cur.notice_date, cur.commencement_date, cur.end_date, cur.warranty_term_value, cur.warranty_term_unit, cur.warranty_source_requirement_id),
      public.fn_anchor_state_json(cur.award_date, cur.notice_date, cur.commencement_date, cur.end_date, cur.warranty_term_value, cur.warranty_term_unit, cur.warranty_source_requirement_id),
      p_change_kind, p_reason, p_source_ref, p_source_change_order_id, coalesce(p_effective_from, public.fn_taipei_today()));
  elsif v.version_no = before_no then
    return null; -- 直接修改且值沒變:沒有新版本
  end if;
  return v;
end; $$;
revoke all on function public.update_project_anchors(uuid, jsonb, text, text, text, uuid, date) from public, anon;
grant execute on function public.update_project_anchors(uuid, jsonb, text, text, text, uuid, date) to authenticated;
comment on function public.update_project_anchors(uuid, jsonb, text, text, text, uuid, date) is
  'P5c/P5e: change project anchor dates and the contract warranty term (must cite an approved requirement of the project) with basis; authorization = is_project_admin(). Returns the new version (null when a plain edit changed nothing).';

-- ── 7. 驗收事件／引用條文狀態 → 套用界限並補齊(不留版本,與 P5c 竣工登錄同一規則)───────────────
create or replace function public.acceptance_events_obligation_periods_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid uuid := case tg_op when 'DELETE' then old.project_id else new.project_id end;
  stage_new text := case tg_op when 'DELETE' then null else new.stage_key end;
  stage_old text := case tg_op when 'INSERT' then null else old.stage_key end;
begin
  -- report／confirm 界定竣工(P5c);final(正式驗收)的合格日界定保固期間(P5e)
  if coalesce(stage_new, '') in ('report','confirm','final') or coalesce(stage_old, '') in ('report','confirm','final') then
    if exists (select 1 from public.projects p where p.id = pid) then
      perform public.fn_apply_obligation_recurrence_bound(pid);
      perform public.fn_materialize_obligation_periods(pid);
    end if;
  end if;
  return null;
end $$;
revoke all on function public.acceptance_events_obligation_periods_sync() from public, anon, authenticated;

create or replace function public.requirements_warranty_source_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
begin
  if new.status is distinct from old.status and (old.status = 'approved' or new.status = 'approved') then
    for pid in select p.id from public.projects p where p.warranty_source_requirement_id = new.id loop
      perform public.fn_apply_obligation_recurrence_bound(pid);
      perform public.fn_materialize_obligation_periods(pid);
    end loop;
  end if;
  return null;
end $$;
revoke all on function public.requirements_warranty_source_sync() from public, anon, authenticated;
drop trigger if exists requirements_warranty_source_sync on public.requirements;
create trigger requirements_warranty_source_sync
  after update of status on public.requirements
  for each row execute function public.requirements_warranty_source_sync();

-- 義務插入／規則變更／廢止 → 期次同步(取代 P5b):類別在保固／非保固之間變動也算規則變更(窗口不同),
-- 只重建沒動過的待辦期。其餘語意不變。
create or replace function public.obligation_periods_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rule_changed boolean := false;
begin
  if new.status = '不適用' then
    if tg_op = 'UPDATE' and old.status is distinct from '不適用' then
      update public.obligation_periods set status = '不適用', updated_at = now()
      where obligation_id = new.id and status = '待辦';
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' then
    rule_changed := row(old.recurring, old.recurring_day, old.recurring_weekday, old.recurring_month, old.trigger_event, old.fixed_date,
                        coalesce(old.category, '') = '保固')
      is distinct from row(new.recurring, new.recurring_day, new.recurring_weekday, new.recurring_month, new.trigger_event, new.fixed_date,
                        coalesce(new.category, '') = '保固');
    if rule_changed then
      delete from public.obligation_periods
      where obligation_id = new.id and status = '待辦'
        and completed_at is null and evidence_submittal_id is null and evidence_document_id is null and review_note is null;
    end if;
  end if;
  if new.recurring in ('daily','weekly','monthly','quarterly','yearly')
     and (tg_op = 'INSERT' or rule_changed or old.status = '不適用') then
    perform public.fn_materialize_obligation_periods_for(new.id);
  end if;
  return null;
end $$;
revoke all on function public.obligation_periods_sync() from public, anon, authenticated;

-- ── 8. 套用新窗口(正式庫保固類義務 0 筆:預期 0 移除、0 新增)────────────────────────────
do $$
declare
  pid uuid;
  n_removed integer := 0;
  n_added integer := 0;
begin
  for pid in
    select distinct o.project_id from public.contract_obligations o
    where o.category = '保固' and o.recurring in ('daily','weekly','monthly','quarterly','yearly') and o.status <> '不適用'
    order by 1
  loop
    n_removed := n_removed + public.fn_apply_obligation_recurrence_bound(pid);
    n_added := n_added + public.fn_materialize_obligation_periods(pid);
  end loop;
  raise notice 'warranty-stop backfill periods_removed=%, periods_added=%', n_removed, n_added;
end; $$;
