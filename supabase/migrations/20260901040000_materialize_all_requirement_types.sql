-- D-020:履約時程接入全部契約重點類型。
--
-- D-012 的單向轉接器至今只物化 requirement_type='deadline':其餘八型
-- (submittal/inspection/test/checklist/evidence/photo/report/other)被核定後
-- 卡在 requirements 表,永遠不會出現在「契約重點 · 履約時程」——與頁首
-- 「把你要遵守的每一條排到時程上」的產品承諾不符。抽取層本來就對九型
-- 一視同仁地收 lifecycle_phase/trigger/frequency,前端 timeline 也已按
-- requirement_type 顯示類型標籤與篩選;缺的只有這一段物化。
--
-- 本 migration:
--   1. materialize_requirement_obligation(uuid):同一套確定性映射,
--      唯一差異是拿掉 requirement_type='deadline' 過濾——任何已核定
--      Requirement 都物化一列義務。無時點的型別映出來就是無到期日的
--      義務(前端語意「未觸發」,期程段仍按 lifecycle_phase 歸位)。
--   2. apply_transcription_triage / review_requirement 改呼叫新函式,
--      核定與取代(supersede→不適用)不再分型別。
--   3. 舊名 materialize_deadline_obligation 移除(名實不符;呼叫端已全數
--      改接,rollback 檔可原樣重建)。
--   4. 回填:既有已核定、無義務列的 Requirement 逐筆物化。

-- 匿名 preflight:卡住的核定項總數與分佈(只記數量,不記任何專案/標題/條款)。
do $$
declare
  stuck_total bigint;
  stuck_projects bigint;
  stuck_with_timing bigint;
begin
  select count(*), count(distinct req.project_id),
         count(*) filter (where req.trigger_type is not null or req.frequency_type is not null)
    into stuck_total, stuck_projects, stuck_with_timing
  from public.requirements req
  left join public.contract_obligations o on o.requirement_id = req.id
  where req.status = 'approved' and o.id is null;
  raise notice 'materialize-all preflight approved_without_obligation=%, projects=%, with_timing=%',
    stuck_total, stuck_projects, stuck_with_timing;
end; $$;

-- 1. 通用轉接器:映射邏輯與 20260824000200 的版本逐欄相同,只放寬型別。
--    值域外的 trigger/frequency config 一律映成 null(義務保留、推不出
--    到期日,對齊前端「無期限/未觸發」語意,不臆測日期)。
create or replace function public.materialize_requirement_obligation(
  p_requirement_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  req public.requirements;
  obligation_id uuid;
  next_sort_order integer;
  mapped_offset_days integer;
  mapped_recurring text;
  mapped_recurring_day integer;
  mapped_recurring_weekday integer;
  mapped_recurring_month integer;
begin
  select * into req
  from public.requirements
  where id = p_requirement_id
    and status = 'approved';

  if not found then
    return null;
  end if;

  mapped_offset_days := case
    when coalesce(req.trigger_config ->> 'offset_days', '') ~ '^-?[0-9]+$'
      then (req.trigger_config ->> 'offset_days')::integer
    else null
  end;
  mapped_recurring := case
    when req.frequency_type in ('daily','weekly','monthly','quarterly','yearly')
      then req.frequency_type
    else null
  end;
  mapped_recurring_day := case
    when mapped_recurring in ('monthly','quarterly','yearly')
      and coalesce(req.frequency_config ->> 'day', '') ~ '^[0-9]+$'
      and (req.frequency_config ->> 'day')::integer between 1 and 31
      then (req.frequency_config ->> 'day')::integer
    else null
  end;
  mapped_recurring_weekday := case
    when mapped_recurring = 'weekly'
      and coalesce(req.frequency_config ->> 'weekday', '') ~ '^[0-9]+$'
      and (req.frequency_config ->> 'weekday')::integer between 1 and 7
      then (req.frequency_config ->> 'weekday')::integer
    else null
  end;
  mapped_recurring_month := case
    when mapped_recurring = 'quarterly'
      and coalesce(req.frequency_config ->> 'month', '') ~ '^[0-9]+$'
      and (req.frequency_config ->> 'month')::integer between 1 and 3
      then (req.frequency_config ->> 'month')::integer
    when mapped_recurring = 'yearly'
      and coalesce(req.frequency_config ->> 'month', '') ~ '^[0-9]+$'
      and (req.frequency_config ->> 'month')::integer between 1 and 12
      then (req.frequency_config ->> 'month')::integer
    else null
  end;
  select coalesce(max(sort_order), -1) + 1 into next_sort_order
  from public.contract_obligations where project_id = req.project_id;

  insert into public.contract_obligations (
    id, project_id, title, category, trigger_event,
    offset_days, offset_dir, fixed_date,
    recurring, recurring_day, recurring_weekday, recurring_month,
    responsible, note, sort_order, requirement_id
  ) values (
    req.id,
    req.project_id,
    req.title,
    req.lifecycle_phase,
    req.trigger_type,
    mapped_offset_days,
    case when req.trigger_config ->> 'offset_dir' in ('before','after')
      then req.trigger_config ->> 'offset_dir' else 'after' end,
    case when req.trigger_type = 'fixed'
      and coalesce(req.trigger_config ->> 'fixed_date', '') <> ''
      then (req.trigger_config ->> 'fixed_date')::date else null end,
    mapped_recurring,
    mapped_recurring_day,
    mapped_recurring_weekday,
    mapped_recurring_month,
    case req.responsible_party_type
      when 'agency' then '機關'
      when 'supervisor' then '監造'
      when 'contractor' then '廠商'
      when 'other' then '其他'
      else null
    end,
    req.description,
    next_sort_order,
    req.id
  )
  on conflict (requirement_id) do update set
    title = excluded.title,
    category = excluded.category,
    trigger_event = excluded.trigger_event,
    offset_days = excluded.offset_days,
    offset_dir = excluded.offset_dir,
    fixed_date = excluded.fixed_date,
    recurring = excluded.recurring,
    recurring_day = excluded.recurring_day,
    recurring_weekday = excluded.recurring_weekday,
    recurring_month = excluded.recurring_month,
    responsible = excluded.responsible
  returning id into obligation_id;

  return obligation_id;
end; $$;
revoke all on function public.materialize_requirement_obligation(uuid)
  from public, anon, authenticated;
comment on function public.materialize_requirement_obligation(uuid) is
  'D-012/D-020 internal deterministic adapter: any approved Requirement -> one obligation runtime row';

-- 2a. 全自動確認改接通用轉接器:九型一律物化(D-019 的回傳語意不變)。
create or replace function public.apply_transcription_triage(p_run uuid)
returns table (auto_confirmed int, flagged int)
language plpgsql security definer set search_path = public as $$
declare
  req record;
  doubts text[];
  n_auto int := 0;
  n_flag int := 0;
begin
  if not exists (
    select 1 from public.document_ingestion_runs r
    where r.id = p_run and r.status = 'completed'
  ) then
    raise exception '轉錄分流只能套用在已完成的抽取 run';
  end if;

  for req in
    select * from public.requirements
    where ingestion_run_id = p_run
      and origin = 'ai'
      and status in ('draft_ai', 'needs_review')
  loop
    doubts := public.transcription_doubts(req.id);
    update public.requirements
       set status = 'approved', reviewed_by = null, reviewed_at = now(),
           triage_doubts = doubts
     where id = req.id;
    perform public.materialize_requirement_obligation(req.id);
    n_auto := n_auto + 1;
    if coalesce(array_length(doubts, 1), 0) > 0 then n_flag := n_flag + 1; end if;
  end loop;
  return query select n_auto, n_flag;
end; $$;

-- 2b. 人工審核(補登/事後更正)同樣不分型別:核定即物化、取代即退場。
create or replace function public.review_requirement(
  p_requirement_id uuid,
  p_decision text
) returns public.requirements
language plpgsql security definer set search_path = public as $$
declare
  req public.requirements;
  run_status text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into req from public.requirements where id = p_requirement_id;
  if not found then
    raise exception 'requirement not found';
  end if;
  if not public.can_review_requirement(req.project_id) then
    raise exception 'requirement review requires a requirement reviewer';
  end if;
  if p_decision not in ('approve','reject','supersede') then
    raise exception 'unknown review decision: %', p_decision;
  end if;
  if (p_decision in ('approve','reject') and req.status not in ('draft_ai','needs_review'))
     or (p_decision = 'supersede' and req.status <> 'approved') then
    raise exception 'invalid requirement lifecycle transition from % via %',
      req.status, p_decision;
  end if;
  if p_decision = 'approve' and req.origin = 'ai' then
    if req.ingestion_run_id is not null then
      select status into run_status from public.document_ingestion_runs
        where id = req.ingestion_run_id;
    end if;
    if run_status is distinct from 'completed' then
      raise exception 'AI requirement approval requires a completed ingestion run';
    end if;
  end if;
  perform set_config('pmis.requirement_review', req.id::text, true);
  update public.requirements
  set status = case p_decision
        when 'approve' then 'approved'
        when 'reject' then 'rejected'
        else 'superseded'
      end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = req.id
  returning * into req;

  if p_decision = 'approve' then
    perform public.materialize_requirement_obligation(req.id);
  elsif p_decision = 'supersede' then
    -- 相容列與其佐證/歷史保留,只把仍開著的提醒退場(語意同 D-012)。
    update public.contract_obligations
    set status = '不適用'
    where requirement_id = req.id and status = '待辦';
  end if;

  perform set_config('pmis.requirement_review', '', true);
  return req;
end; $$;
revoke all on function public.review_requirement(uuid, text) from public, anon;
grant execute on function public.review_requirement(uuid, text) to authenticated;

-- 3. 舊名退場:呼叫端已全數改接;rollback 檔原樣重建 deadline-only 版本。
drop function if exists public.materialize_deadline_obligation(uuid);

-- 4. 回填:既有已核定、無義務列的 Requirement 逐筆物化(冪等:id=req.id,
--    on conflict 更新)。順序穩定(project, created_at, id)讓 sort_order 可重現。
do $$
declare r record;
begin
  for r in
    select req.id from public.requirements req
    left join public.contract_obligations o on o.requirement_id = req.id
    where req.status = 'approved' and o.id is null
    order by req.project_id, req.created_at, req.id
  loop
    perform public.materialize_requirement_obligation(r.id);
  end loop;
end; $$;
