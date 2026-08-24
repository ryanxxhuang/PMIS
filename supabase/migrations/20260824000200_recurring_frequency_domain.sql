-- 契約重點頻率值域擴充:抽取引擎的 frequency_type 從只有 monthly 擴到
-- daily / weekly / monthly / quarterly / yearly(真實契約的循環義務:每日
-- 施工日誌、每週工安會議、每季/每年保養檢測)。requirements 的
-- frequency_type/frequency_config 本無 CHECK(值域由抽取驗證與審查把關),
-- 這裡只補「核定後物化」這一段:contract_obligations 加循環欄位、
-- materialize_deadline_obligation(D-012 單向轉接器)把新頻率的 config
-- 映射過去,提醒/期限追蹤的到期日計算才有料可算。

-- 匿名 preflight:既有值域外頻率的核定期限數(預期 0——引擎與手動表單
-- 至今只產 monthly);不記任何專案/標題/條款內容。
do $$
declare
  approved_deadline_count bigint;
  non_monthly_frequency_count bigint;
begin
  select count(*) into approved_deadline_count
  from public.requirements
  where status = 'approved' and requirement_type = 'deadline';
  select count(*) into non_monthly_frequency_count
  from public.requirements
  where frequency_type is not null and frequency_type <> 'monthly';
  raise notice 'frequency-domain preflight approved_deadlines=%, non_monthly_frequency_requirements=%',
    approved_deadline_count, non_monthly_frequency_count;
end; $$;

-- 循環欄位:recurring_day(幾日)沿用;weekly 記星期幾、quarterly/yearly 記月。
-- 值域由 materialize_deadline_obligation 把關,CHECK 只是防禦性收口
-- (義務表 system-managed:authenticated 無 insert,update 只開 status/evidence)。
alter table public.contract_obligations
  add column if not exists recurring_weekday int
    check (recurring_weekday is null or recurring_weekday between 1 and 7),
  add column if not exists recurring_month int
    check (recurring_month is null or recurring_month between 1 and 12);
comment on column public.contract_obligations.recurring_weekday is
  '每週星期幾(recurring=weekly;ISO 慣例 1=週一…7=週日)';
comment on column public.contract_obligations.recurring_month is
  'quarterly=季內第幾個月(1..3);yearly=幾月(1..12)';

-- D-012 轉接器擴充:核定 deadline Requirement 的 frequency_type/frequency_config
-- 映射到義務列的循環欄位。config 值域外的欄位映成 null(義務保留、推不出
-- 下次到期日,對齊前端「無期限」語意,不臆測日期)。
create or replace function public.materialize_deadline_obligation(
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
    and status = 'approved'
    and requirement_type = 'deadline';

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
revoke all on function public.materialize_deadline_obligation(uuid)
  from public, anon, authenticated;
comment on function public.materialize_deadline_obligation(uuid) is
  'D-012 internal deterministic adapter: approved deadline Requirement -> one obligation runtime row';

-- 補物化:值域外頻率的既有核定期限(照 preflight 預期為 0 筆,防禦性收口)。
-- 只重跑受影響列;runtime 欄位(status/evidence/penalty/note)照轉接器不變式保留。
do $$
declare requirement_id_to_materialize uuid;
begin
  for requirement_id_to_materialize in
    select id from public.requirements
    where status = 'approved' and requirement_type = 'deadline'
      and frequency_type in ('daily','weekly','quarterly','yearly')
    order by id
  loop
    perform public.materialize_deadline_obligation(requirement_id_to_materialize);
  end loop;
end; $$;
