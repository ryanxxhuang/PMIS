-- Roll back 20260920021500 (P5e: 保固類循環義務的停止條件＝正式驗收合格日＋契約保固期間).
-- Run through SQL Editor / psql as database owner in one transaction.
-- Restores the P5c (20260919021500) versions of the stop-gap / materialize / bound / recompute / record /
-- projects trigger / update_project_anchors / acceptance trigger functions and the P5b (20260917233000)
-- obligation_periods_sync verbatim (保固類 → 不產生期次、列「停止條件待補」), then drops everything P5e added:
-- the requirements status trigger, the warranty guard, get_project_warranty and helper functions, the three
-- projects warranty columns (+ check constraint, index) and project_anchor_versions.warranty.
-- Data policy: the recorded contract warranty term (projects.warranty_*) and each version's warranty snapshot
-- are dropped with the columns — export them first (select id, warranty_term_value, warranty_term_unit,
-- warranty_source_requirement_id from projects; select project_id, version_no, warranty from
-- project_anchor_versions where warranty is not null). Version rows whose changed_keys contain 'warranty_term'
-- stay (append-only); their effects remain as history. After the functions are restored, untouched pending
-- periods of 保固-category recurring obligations are removed by the restored P5c bound (保固 → null);
-- touched periods (submitted / done / with evidence / review note) are kept as history.
-- Also remove supabase/tests/warranty_stop_condition.sql, revert the 保固 assertions in
-- supabase/tests/project_anchor_versions.sql and take get_project_warranty out of the allow list in
-- supabase/tests/anon_and_function_privileges.sql, otherwise pgTAP goes red. The frontend/Edge of P5e call
-- get_project_warranty: roll the app back first (or together), otherwise project loading fails.
begin;

drop trigger if exists requirements_warranty_source_sync on public.requirements;
drop function if exists public.requirements_warranty_source_sync();
drop trigger if exists projects_warranty_term_guard on public.projects;
drop function if exists public.projects_warranty_term_guard();
drop function if exists public.get_project_warranty(uuid);

-- P5c 四參數停止條件(保固類 → 無法判定)
drop function if exists public.fn_obligation_recurrence_stop_gap(text, date, date, date, jsonb);

-- 停止條件缺口(與 _shared/ballInCourtRules.ts recurrenceStopGap 同口徑;共用案例與 pgTAP 各釘一側):
-- 完整回 null;無法判定或已越界回中文說明(前端／Agent／早報列「待補設定(stop)」)。
create or replace function public.fn_obligation_recurrence_stop_gap(p_category text, p_end_date date, p_completion date, p_today date)
returns text language sql immutable as $$
  select case
    when p_category = '保固' then '保固期滿日無法判定，未登錄保固年限'
    when p_completion is not null then null
    when p_end_date is null then '缺竣工日，無法判定循環何時結束'
    when p_end_date < p_today then '竣工日 ' || to_char(p_end_date, 'YYYY-MM-DD') || ' 已過，尚未登錄竣工或展延'
    else null end;
$$;
revoke all on function public.fn_obligation_recurrence_stop_gap(text, date, date, date) from public, anon, authenticated;

create or replace function public.fn_materialize_obligation_periods_for(
  p_obligation uuid, p_today date default null, p_lookahead_days integer default 31
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  ob record;
  anchor_key text;
  anchor date;
  bound date;
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
  anchor_key := public.fn_obligation_recurrence_anchor_key(ob.trigger_event);
  anchor := case anchor_key
    when 'award_date' then ob.award_date
    when 'notice_date' then ob.notice_date
    when 'commencement_date' then ob.commencement_date
    when 'end_date' then ob.end_date
    when 'fixed_date' then ob.fixed_date
    else null end;
  if anchor is null then
    return 0; -- 基準日待補:不臆測起算日
  end if;
  -- 停止條件(P5c):界限日判不出 → 不自動產生(前端列「停止條件待補」);判得出 → 只產生期間起日 ≤ 界限日的期
  bound := public.fn_obligation_recurrence_bound(ob.category, ob.end_date, public.fn_project_completion_date(ob.project_id));
  if bound is null then
    return 0;
  end if;
  select max(v.version_no) into cur_version from public.project_anchor_versions v where v.project_id = ob.project_id;
  insert into public.obligation_periods (project_id, obligation_id, period_key, period_start, period_end, due_date, basis, anchor_version_no)
  select ob.project_id, ob.id, s.period_key, s.period_start, s.period_end, s.due_date,
         jsonb_build_object(
           'version', 2, 'recurring', ob.recurring, 'recurring_day', ob.recurring_day,
           'recurring_weekday', ob.recurring_weekday, 'recurring_month', ob.recurring_month,
           'anchor_key', anchor_key, 'anchor_date', anchor, 'bound_date', bound,
           'materialized_on', today, 'lookahead_days', p_lookahead_days),
         cur_version
  from public.fn_obligation_period_schedule(ob.recurring, ob.recurring_day, ob.recurring_weekday, ob.recurring_month, anchor, today, p_lookahead_days) s
  where s.period_start <= bound
  on conflict (obligation_id, period_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end; $$;
revoke all on function public.fn_materialize_obligation_periods_for(uuid, date, integer) from public, anon, authenticated;

create or replace function public.fn_apply_obligation_recurrence_bound(p_project uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  completion date := public.fn_project_completion_date(p_project);
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
    bound := public.fn_obligation_recurrence_bound(ob.category, ob.end_date, completion);
    delete from public.obligation_periods x
    where x.obligation_id = ob.id and (bound is null or x.period_start > bound)
      and x.status = '待辦' and x.completed_at is null and x.evidence_submittal_id is null and x.evidence_document_id is null and x.review_note is null;
    get diagnostics n = row_count;
    removed := removed + n;
  end loop;
  return removed;
end; $$;
revoke all on function public.fn_apply_obligation_recurrence_bound(uuid) from public, anon, authenticated;

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
  if cardinality(changed) = 0 then return effects; end if;

  for ob in
    select o.id, o.title, o.status, o.category, o.recurring, o.recurring_day, o.recurring_weekday, o.recurring_month,
           o.trigger_event, o.offset_days, o.offset_dir, o.fixed_date, o.due_date_snapshot
    from public.contract_obligations o
    where o.project_id = p_project and o.status <> '不適用'
    order by o.sort_order, o.id
  loop
    if ob.recurring in ('daily','weekly','monthly','quarterly','yearly') then
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
      -- 移除:沒動過的待辦期,新排程裡沒有(基準日後移、竣工日提前、規則不完整)
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
      -- 新增:新排程多出的期(基準日提前、竣工日展延)
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
            'anchor_key', anchor_key, 'anchor_date', anchor, 'bound_date', bound, 'materialized_on', today, 'lookahead_days', 31),
          p_version);
        effects := effects || jsonb_build_object('kind', 'added', 'obligation_id', ob.id, 'title', ob.title,
          'period_key', r.period_key, 'old_due', null, 'new_due', r.new_due, 'status', '待辦');
      end loop;
      -- 保留:動過的期,這一版的變更會影響它(舊排程有、新排程沒有,或到期日不同)→ 原樣不動,只記 kept;
      -- 與這一版無關的舊差異不重複列(否則每版都列同一筆)
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
  v public.project_anchor_versions;
begin
  perform pg_advisory_xact_lock(hashtextextended('anchors:' || p_project::text, 0));
  select coalesce(max(version_no), 0) + 1 into next_no from public.project_anchor_versions where project_id = p_project;
  foreach k in array array['award_date','notice_date','commencement_date','end_date'] loop
    if (p_old ->> k) is distinct from (p_new ->> k) then changed := changed || k; end if;
  end loop;
  fx := public.fn_recompute_obligations_for_anchor_version(p_project, next_no, p_old, p_new, p_today);
  insert into public.project_anchor_versions
    (project_id, version_no, change_kind, anchors, changed_keys, effective_from, reason, source_ref, source_change_order_id, effects, created_by)
  values
    (p_project, next_no, coalesce(p_change_kind, 'edit'), p_new, changed, p_effective_from, nullif(btrim(p_reason), ''), nullif(btrim(p_source_ref), ''),
     p_source_change_order_id, fx, auth.uid())
  returning * into v;
  return v;
end; $$;
revoke all on function public.fn_record_project_anchor_version(uuid, jsonb, jsonb, text, text, text, uuid, date, date) from public, anon, authenticated;

create or replace function public.projects_anchor_versions_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb;
  raw text;
  old_json jsonb;
  new_json jsonb := public.fn_anchors_json(new.award_date, new.notice_date, new.commencement_date, new.end_date);
begin
  raw := current_setting('pmis.anchor_change', true);
  meta := case when raw is null or raw = '' then '{}'::jsonb else raw::jsonb end;
  if tg_op = 'INSERT' then
    if new.award_date is null and new.notice_date is null and new.commencement_date is null and new.end_date is null then
      return null;
    end if;
    old_json := public.fn_anchors_json(null, null, null, null);
    perform public.fn_record_project_anchor_version(new.id, old_json, new_json, coalesce(meta ->> 'change_kind', 'initial'),
      meta ->> 'reason', meta ->> 'source_ref', (meta ->> 'source_change_order_id')::uuid,
      coalesce((meta ->> 'effective_from')::date, public.fn_taipei_today()));
    return null;
  end if;
  old_json := public.fn_anchors_json(old.award_date, old.notice_date, old.commencement_date, old.end_date);
  if old_json = new_json then return null; end if;
  perform public.fn_record_project_anchor_version(new.id, old_json, new_json, coalesce(meta ->> 'change_kind', 'edit'),
    meta ->> 'reason', meta ->> 'source_ref', (meta ->> 'source_change_order_id')::uuid,
    coalesce((meta ->> 'effective_from')::date, public.fn_taipei_today()));
  -- 版本紀錄的重算只涵蓋受影響的義務;其餘(例如基準日從缺到有)由既有冪等物化補齊
  perform public.fn_materialize_obligation_periods(new.id);
  return null;
end $$;
revoke all on function public.projects_anchor_versions_sync() from public, anon, authenticated;
drop trigger if exists projects_obligation_periods_sync on public.projects;
drop function if exists public.projects_obligation_periods_sync();
drop trigger if exists projects_anchor_versions_sync on public.projects;
create trigger projects_anchor_versions_sync
  after insert or update of award_date, notice_date, commencement_date, end_date on public.projects
  for each row execute function public.projects_anchor_versions_sync();

create or replace function public.update_project_anchors(
  p_project uuid, p_anchors jsonb default '{}'::jsonb, p_change_kind text default 'edit',
  p_reason text default null, p_source_ref text default null, p_source_change_order_id uuid default null,
  p_effective_from date default null
) returns public.project_anchor_versions
language plpgsql security definer set search_path = public as $$
declare
  allowed text[] := array['award_date','notice_date','commencement_date','end_date'];
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
    if not (k = any(allowed)) then raise exception '未知的基準日欄位: %', k; end if;
    if jsonb_typeof(p_anchors -> k) not in ('null', 'string') then raise exception '基準日 % 必須是日期字串或 null', k; end if;
    if jsonb_typeof(p_anchors -> k) = 'string' then perform (p_anchors ->> k)::date; end if;
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
      end_date = case when p_anchors ? 'end_date' then (p_anchors ->> 'end_date')::date else end_date end
  where id = p_project
  returning id into updated_id;
  perform set_config('pmis.anchor_change', '', true);
  if updated_id is null then
    raise exception 'project not found';
  end if;

  select * into v from public.project_anchor_versions where project_id = p_project order by version_no desc limit 1;
  if (v.id is null or v.version_no = before_no) and p_change_kind <> 'edit' then
    -- 四日期未變的停工／復工／展延／核准變更:仍記一版(effects 為空),依據不遺失
    select award_date, notice_date, commencement_date, end_date into cur from public.projects where id = p_project;
    v := public.fn_record_project_anchor_version(p_project,
      public.fn_anchors_json(cur.award_date, cur.notice_date, cur.commencement_date, cur.end_date),
      public.fn_anchors_json(cur.award_date, cur.notice_date, cur.commencement_date, cur.end_date),
      p_change_kind, p_reason, p_source_ref, p_source_change_order_id, coalesce(p_effective_from, public.fn_taipei_today()));
  elsif v.version_no = before_no then
    return null; -- 直接修改且值沒變:沒有新版本
  end if;
  return v;
end; $$;
revoke all on function public.update_project_anchors(uuid, jsonb, text, text, text, uuid, date) from public, anon;
grant execute on function public.update_project_anchors(uuid, jsonb, text, text, text, uuid, date) to authenticated;
comment on function public.update_project_anchors(uuid, jsonb, text, text, text, uuid, date) is
  'P5c: change project anchor dates with basis (change_kind/reason/source_ref/effective_from); authorization = is_project_admin() (same predicate as the projects update policy). Returns the new version (null when a plain edit changed nothing).';

create or replace function public.acceptance_events_obligation_periods_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid uuid := case tg_op when 'DELETE' then old.project_id else new.project_id end;
  stage_new text := case tg_op when 'DELETE' then null else new.stage_key end;
  stage_old text := case tg_op when 'INSERT' then null else old.stage_key end;
begin
  if coalesce(stage_new, '') in ('report','confirm') or coalesce(stage_old, '') in ('report','confirm') then
    if exists (select 1 from public.projects p where p.id = pid) then
      perform public.fn_apply_obligation_recurrence_bound(pid);
      perform public.fn_materialize_obligation_periods(pid);
    end if;
  end if;
  return null;
end $$;
revoke all on function public.acceptance_events_obligation_periods_sync() from public, anon, authenticated;

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
    rule_changed := row(old.recurring, old.recurring_day, old.recurring_weekday, old.recurring_month, old.trigger_event, old.fixed_date)
      is distinct from row(new.recurring, new.recurring_day, new.recurring_weekday, new.recurring_month, new.trigger_event, new.fixed_date);
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

comment on function public.fn_obligation_recurrence_bound(text, date, date) is null;

-- (上方 P5c 原文已把留版 trigger 恢復為只看四個基準日)

drop function if exists public.fn_warranty_bound_of(uuid, date, jsonb);
drop function if exists public.fn_project_warranty(uuid);
drop function if exists public.fn_warranty_gap_text(date, integer, boolean);
drop function if exists public.fn_anchor_state_json(date, date, date, date, integer, text, uuid);
drop function if exists public.fn_warranty_snapshot(integer, text, uuid);
drop function if exists public.fn_project_acceptance_pass(uuid);
drop function if exists public.fn_warranty_expiry(date, integer, text);

alter table public.project_anchor_versions drop column if exists warranty;
drop index if exists public.projects_warranty_source_idx;
alter table public.projects drop constraint if exists projects_warranty_term_check;
alter table public.projects
  drop column if exists warranty_term_value,
  drop column if exists warranty_term_unit,
  drop column if exists warranty_source_requirement_id;

-- 保固類循環義務回到 P5c 語意(不產生):移除沒動過的待辦期
do $$
declare pid uuid; n integer := 0;
begin
  for pid in select distinct project_id from public.contract_obligations
             where category = '保固' and recurring in ('daily','weekly','monthly','quarterly','yearly') and status <> '不適用' loop
    n := n + public.fn_apply_obligation_recurrence_bound(pid);
  end loop;
  raise notice 'warranty-stop rollback removed untouched warranty periods=%', n;
end $$;

commit;
