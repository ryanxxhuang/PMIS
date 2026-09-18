-- P5b｜循環契約義務逐期追蹤 obligation_periods（D-026 §4 契約時程與提醒對齊;設計
-- docs/architecture/slimming-entrypoints-and-retirement.md §4.2、docs/architecture/ball-in-court.md）。
--
-- 為什麼:contract_obligations 對循環義務(recurring=daily/weekly/monthly/quarterly/yearly)
-- 只有一個 status——標記一次「已提送」整條義務就從首頁／Agent／早報消失,下個月不會再提醒;
-- 到期日又是前端／Edge 各自「從今天推算下一期」,舊期逾期一過月就不見。使用者定案(實作指令 §5):
-- 循環事項逐期追蹤,完成本期不清除下期、舊逾期保留;日期由確定性規則計算。
--
-- 做法(每義務每期一列):
--   1. 純函式:期別鍵／期間起訖／到期日／下一期(月末夾住:每月 31 日在 4 月=4/30、2 月=28/29;
--      跨年;每季第 n 個月;每年 m 月 d 日;每週 ISO 星期幾;每日),與 TS 共用規則
--      (_shared/ballInCourtRules.ts recurrenceRuleGap／recurrenceAnchorKey)同口徑;
--      fn_obligation_period_schedule 由「基準日→今天＋31 日前瞻」確定性列出期次,且永遠含下一期。
--   2. 表 obligation_periods:期別鍵、期間、到期日、狀態(待辦／已提送／已完成／不適用)、完成時間與人、
--      證據(送審文件／現場文書)、回填待核對註記、計算依據 basis、anchor_version_no(P5c 預留)。
--   3. materialize:冪等(unique(obligation_id, period_key)＋on conflict do nothing),只補缺的期、
--      絕不改既有列。觸發時機(不新增雲端資源):
--        a. contract_obligations 插入／規則變更／狀態變更 → trigger 立即物化該義務(義務不適用時
--           把仍待辦的期次一併標不適用;規則變更只重建「未動過」的待辦期);
--        b. projects 四個基準日變更 → trigger 物化該案;
--        c. pg_cron 每日 16:05 UTC(台北 00:05)materialize_all_obligation_periods() 推進前瞻窗口
--           (正式庫 pg_cron 已啟用,現有 pmis-daily-reminders 亦走它;本機 CLI 影像亦內建);
--        d. RPC materialize_obligation_periods(project) 供成員／service 手動補齊(冪等)。
--      Agent 工具層只讀(工具白名單只允許兩支唯讀 RPC),讀 a–c 維護的結果。
--   4. 基準日:循環從 trigger_event 對應的基準日起算(award/notice/commencement/completion→專案四日期,
--      fixed→義務 fixed_date,其餘→開工日);基準日缺→不產生期次,前端／Edge 以「基準日待補」列待補設定。
--      循環規則不完整(每月缺幾日等)→不產生期次,列「循環規則待補」(正式 7 筆 monthly 有 5 筆缺日)。
--   5. 期次狀態只經 transition_obligation_period RPC:同義務的歸屬規則(obligation_party=my_party
--      或非正式模式 admin override)、證據須同案、完成時間戳由伺服器蓋、退回待辦解除證據(W-01)。
--      契約義務本身自此不可再標「已提送／已完成」(guard),舊前端／直接 REST 都會被擋。
--   6. 回填:正式 7 筆 monthly 待辦義務全部產生期次(不回填完成);既有若標為已提送／已完成:有
--      completed_at 就對應到含該台北日的期別,推不出(無 completed_at 或落在期次之外)則義務原狀
--      不動、已到期的待辦期次標 review_note「待核對」,由前端／Agent 列待補設定讓人核對。
--
-- 資料:不改 contract_obligations 任何列。回復:supabase/rollbacks/20260917233000_obligation_periods.down.sql。
-- pgTAP:supabase/tests/obligation_periods.sql。

-- 匿名 preflight:只記數量。
do $$
declare
  recurring_total bigint;
  recurring_done bigint;
  recurring_incomplete bigint;
begin
  select count(*),
         count(*) filter (where status in ('已提送','已完成')),
         count(*) filter (where (recurring = 'monthly' and recurring_day is null)
                            or (recurring = 'weekly' and recurring_weekday is null)
                            or (recurring in ('quarterly','yearly') and (recurring_day is null or recurring_month is null)))
    into recurring_total, recurring_done, recurring_incomplete
  from public.contract_obligations
  where recurring in ('daily','weekly','monthly','quarterly','yearly') and status <> '不適用';
  raise notice 'obligation-periods preflight recurring=%, recurring_marked_done=%, recurring_rule_incomplete=%',
    recurring_total, recurring_done, recurring_incomplete;
end; $$;

-- ── 1. 純函式(確定性;IMMUTABLE)────────────────────────────────────────────────

-- 循環規則缺什麼:完整回 null;缺項回中文說明(與 _shared/ballInCourtRules.ts recurrenceRuleGap 同口徑)。
create or replace function public.fn_obligation_recurrence_gap(
  p_recurring text, p_day integer, p_weekday integer, p_month integer, p_trigger_event text, p_fixed_date date
) returns text language sql immutable as $$
  select case
    when p_recurring is null or p_recurring not in ('daily','weekly','monthly','quarterly','yearly') then null
    when p_recurring = 'weekly' and p_weekday is null then '每週缺星期幾'
    when p_recurring = 'monthly' and p_day is null then '每月缺幾日'
    when p_recurring = 'quarterly' and (p_day is null or p_month is null) then '每季缺月份或日期'
    when p_recurring = 'yearly' and (p_day is null or p_month is null) then '每年缺月份或日期'
    when p_trigger_event = 'fixed' and p_fixed_date is null then '指定日期缺起算日'
    else null end;
$$;
revoke all on function public.fn_obligation_recurrence_gap(text, integer, integer, integer, text, date) from public, anon, authenticated;

-- 循環起算的基準日欄位(與 recurrenceAnchorKey 同口徑):觸發點映得到就用它,fixed 用義務自己的
-- fixed_date,其餘(null／monthly／other)一律開工日——施工期間的循環義務從開工起算。
create or replace function public.fn_obligation_recurrence_anchor_key(p_trigger_event text)
returns text language sql immutable as $$
  select case p_trigger_event
    when 'award' then 'award_date'
    when 'notice' then 'notice_date'
    when 'commencement' then 'commencement_date'
    when 'completion' then 'end_date'
    when 'fixed' then 'fixed_date'
    else 'commencement_date' end;
$$;
revoke all on function public.fn_obligation_recurrence_anchor_key(text) from public, anon, authenticated;

-- 含日期 d 的期間起點(週=ISO 週一;月／季／年=首日)。
create or replace function public.fn_period_start(p_recurring text, p_date date)
returns date language sql immutable as $$
  select case p_recurring
    when 'daily' then p_date
    when 'weekly' then date_trunc('week', p_date)::date
    when 'monthly' then date_trunc('month', p_date)::date
    when 'quarterly' then date_trunc('quarter', p_date)::date
    when 'yearly' then date_trunc('year', p_date)::date
    else null end;
$$;
revoke all on function public.fn_period_start(text, date) from public, anon, authenticated;

create or replace function public.fn_period_end(p_recurring text, p_start date)
returns date language sql immutable as $$
  select case p_recurring
    when 'daily' then p_start
    when 'weekly' then p_start + 6
    when 'monthly' then (p_start + interval '1 month' - interval '1 day')::date
    when 'quarterly' then (p_start + interval '3 months' - interval '1 day')::date
    when 'yearly' then (p_start + interval '1 year' - interval '1 day')::date
    else null end;
$$;
revoke all on function public.fn_period_end(text, date) from public, anon, authenticated;

create or replace function public.fn_next_period_start(p_recurring text, p_start date)
returns date language sql immutable as $$
  select case p_recurring
    when 'daily' then p_start + 1
    when 'weekly' then p_start + 7
    when 'monthly' then (p_start + interval '1 month')::date
    when 'quarterly' then (p_start + interval '3 months')::date
    when 'yearly' then (p_start + interval '1 year')::date
    else null end;
$$;
revoke all on function public.fn_next_period_start(text, date) from public, anon, authenticated;

-- 期別鍵:daily YYYY-MM-DD、weekly IYYY-Www(ISO 週)、monthly YYYY-MM、quarterly YYYY-Qn、yearly YYYY。
create or replace function public.fn_period_key(p_recurring text, p_start date)
returns text language sql immutable as $$
  select case p_recurring
    when 'daily' then to_char(p_start, 'YYYY-MM-DD')
    when 'weekly' then to_char(p_start, 'IYYY-"W"IW')
    when 'monthly' then to_char(p_start, 'YYYY-MM')
    when 'quarterly' then to_char(p_start, 'YYYY-"Q"Q')
    when 'yearly' then to_char(p_start, 'YYYY')
    else null end;
$$;
revoke all on function public.fn_period_key(text, date) from public, anon, authenticated;

-- 某月的第 d 日,超過當月天數夾到月末(每月 31 日在 4 月=4/30;2 月 29 日在平年=2/28)。
create or replace function public.fn_clamped_day_of_month(p_month_start date, p_day integer)
returns date language sql immutable as $$
  select p_month_start + least(p_day, extract(day from (p_month_start + interval '1 month' - interval '1 day'))::integer) - 1;
$$;
revoke all on function public.fn_clamped_day_of_month(date, integer) from public, anon, authenticated;

-- 期間內的到期日(規則須完整;呼叫端先以 fn_obligation_recurrence_gap 過濾)。
create or replace function public.fn_period_due(
  p_recurring text, p_day integer, p_weekday integer, p_month integer, p_start date
) returns date language sql immutable as $$
  select case p_recurring
    when 'daily' then p_start
    when 'weekly' then p_start + (p_weekday - 1)
    when 'monthly' then public.fn_clamped_day_of_month(p_start, p_day)
    when 'quarterly' then public.fn_clamped_day_of_month((p_start + make_interval(months => p_month - 1))::date, p_day)
    when 'yearly' then public.fn_clamped_day_of_month(make_date(extract(year from p_start)::integer, p_month, 1), p_day)
    else null end;
$$;
revoke all on function public.fn_period_due(text, integer, integer, integer, date) from public, anon, authenticated;

-- 確定性期次清單:從含基準日的期間起,列出到期日 ≥ 基準日且 ≤ 今天＋前瞻的每一期;
-- 若到前瞻窗口為止沒有任何一期在今天之後,再多列一期(永遠看得到「下一期」)。
-- 不讀表、不看時鐘:同一組輸入永遠同一組輸出(pgTAP 釘住月末／閏年／跨年／季／年／週／日)。
create or replace function public.fn_obligation_period_schedule(
  p_recurring text, p_day integer, p_weekday integer, p_month integer,
  p_anchor date, p_today date, p_lookahead_days integer default 31
) returns table (period_key text, period_start date, period_end date, due_date date)
language plpgsql immutable as $$
declare
  cur_start date;
  cur_due date;
  horizon date := p_today + greatest(p_lookahead_days, 0);
  future_emitted boolean := false;
  guard integer := 0;
begin
  if p_anchor is null or p_today is null
     or public.fn_obligation_recurrence_gap(p_recurring, p_day, p_weekday, p_month, null, null) is not null
     or p_recurring not in ('daily','weekly','monthly','quarterly','yearly') then
    return;
  end if;
  cur_start := public.fn_period_start(p_recurring, p_anchor);
  loop
    guard := guard + 1;
    exit when guard > 20000; -- 防禦性上限(每日循環 50 年);正常情況遠在此之前結束
    cur_due := public.fn_period_due(p_recurring, p_day, p_weekday, p_month, cur_start);
    if cur_due >= p_anchor then
      if cur_due <= horizon then
        period_key := public.fn_period_key(p_recurring, cur_start);
        period_start := cur_start;
        period_end := public.fn_period_end(p_recurring, cur_start);
        due_date := cur_due;
        return next;
        if cur_due > p_today then future_emitted := true; end if;
      else
        if not future_emitted then
          period_key := public.fn_period_key(p_recurring, cur_start);
          period_start := cur_start;
          period_end := public.fn_period_end(p_recurring, cur_start);
          due_date := cur_due;
          return next;
        end if;
        exit;
      end if;
    end if;
    cur_start := public.fn_next_period_start(p_recurring, cur_start);
  end loop;
  return;
end; $$;
revoke all on function public.fn_obligation_period_schedule(text, integer, integer, integer, date, date, integer) from public, anon, authenticated;
comment on function public.fn_obligation_period_schedule(text, integer, integer, integer, date, date, integer) is
  'P5b deterministic recurrence schedule: periods with due >= anchor and due <= today+lookahead, always including the next period after today. Month-end clamp, ISO weeks, quarter month offsets.';

-- 台北日曆日的今天(業務日期一律台北時區,與前端 taipeiISODate 同口徑)。
create or replace function public.fn_taipei_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Taipei')::date;
$$;
revoke all on function public.fn_taipei_today() from public, anon, authenticated;

-- ── 2. 表 ──────────────────────────────────────────────────────────────────────
create table if not exists public.obligation_periods (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  obligation_id          uuid not null references public.contract_obligations(id) on delete cascade,
  period_key             text not null,
  period_start           date not null,
  period_end             date not null,
  due_date               date not null,
  status                 text not null default '待辦' check (status in ('待辦','已提送','已完成','不適用')),
  completed_at           timestamptz,
  completed_by           uuid references auth.users(id) on delete set null,
  evidence_submittal_id  uuid references public.submittals(id) on delete set null,
  evidence_document_id   uuid references public.field_documents(id) on delete set null,
  review_note            text,
  basis                  jsonb not null default '{}'::jsonb,
  anchor_version_no      integer,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (obligation_id, period_key),
  check (period_start <= period_end),
  check (due_date between period_start and period_end)
);
comment on table public.obligation_periods is
  'P5b 循環契約義務的逐期實例:每義務每期一列,由 materialize 依循環規則＋基準日確定性產生(冪等、只補不改);狀態只經 transition_obligation_period。';
comment on column public.obligation_periods.period_key is '期別鍵:daily YYYY-MM-DD、weekly IYYY-Www、monthly YYYY-MM、quarterly YYYY-Qn、yearly YYYY';
comment on column public.obligation_periods.status is '待辦／已提送／已完成／不適用;不適用由義務廢止取代時級聯或責任方標記';
comment on column public.obligation_periods.review_note is '回填待核對:原義務曾標為完成但無法對應期別時由 migration 註記;前端／Agent 列待補設定';
comment on column public.obligation_periods.basis is '計算依據快照:{version, recurring, recurring_day, recurring_weekday, recurring_month, anchor_key, anchor_date, materialized_on, lookahead_days}';
comment on column public.obligation_periods.anchor_version_no is 'P5c 預留:產生本期時引用的基準日版本;P5b 一律 null';

create index if not exists obligation_periods_project_idx on public.obligation_periods (project_id);
create index if not exists obligation_periods_obligation_due_idx on public.obligation_periods (obligation_id, due_date);
create index if not exists obligation_periods_open_idx on public.obligation_periods (project_id, due_date) where status = '待辦';

alter table public.obligation_periods enable row level security;
-- 可見性沿用義務:policy 子查詢對 contract_obligations 同樣套 RLS(契約分級 D-018 一併繼承)。
drop policy if exists "obligation_periods_select" on public.obligation_periods;
create policy "obligation_periods_select" on public.obligation_periods
  for select to authenticated
  using (exists (select 1 from public.contract_obligations o where o.id = obligation_id));
-- 20260712001200 的 default privileges 會讓新表自動帶寫入授權:明確收回,只留 select;
-- 寫入只走 security definer(materialize／transition)。
revoke all on public.obligation_periods from public, anon, authenticated;
grant select on public.obligation_periods to authenticated;

-- ── 3. materialize(冪等、只補缺的期)──────────────────────────────────────────
create or replace function public.fn_materialize_obligation_periods_for(
  p_obligation uuid, p_today date default null, p_lookahead_days integer default 31
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  ob record;
  anchor_key text;
  anchor date;
  today date := coalesce(p_today, public.fn_taipei_today());
  inserted integer := 0;
begin
  select o.id, o.project_id, o.status, o.recurring, o.recurring_day, o.recurring_weekday, o.recurring_month,
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
  insert into public.obligation_periods (project_id, obligation_id, period_key, period_start, period_end, due_date, basis)
  select ob.project_id, ob.id, s.period_key, s.period_start, s.period_end, s.due_date,
         jsonb_build_object(
           'version', 1, 'recurring', ob.recurring, 'recurring_day', ob.recurring_day,
           'recurring_weekday', ob.recurring_weekday, 'recurring_month', ob.recurring_month,
           'anchor_key', anchor_key, 'anchor_date', anchor, 'materialized_on', today, 'lookahead_days', p_lookahead_days)
  from public.fn_obligation_period_schedule(ob.recurring, ob.recurring_day, ob.recurring_weekday, ob.recurring_month, anchor, today, p_lookahead_days) s
  on conflict (obligation_id, period_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end; $$;
revoke all on function public.fn_materialize_obligation_periods_for(uuid, date, integer) from public, anon, authenticated;

create or replace function public.fn_materialize_obligation_periods(
  p_project uuid, p_today date default null, p_lookahead_days integer default 31
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  ob_id uuid;
  total integer := 0;
begin
  for ob_id in
    select id from public.contract_obligations
    where project_id = p_project and recurring is not null and status <> '不適用'
    order by sort_order, id
  loop
    total := total + public.fn_materialize_obligation_periods_for(ob_id, p_today, p_lookahead_days);
  end loop;
  return total;
end; $$;
revoke all on function public.fn_materialize_obligation_periods(uuid, date, integer) from public, anon, authenticated;

-- 對外 RPC:成員(任一方;純確定性補齊,不是業務決定)或 service。不接受 today 參數——
-- 使用者不能把前瞻窗口推到未來製造假期次。
create or replace function public.materialize_obligation_periods(p_project uuid)
returns integer
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null or auth.role() = 'authenticated' then
    if auth.uid() is null or p_project not in (select public.my_project_ids()) then
      raise exception 'project not found or not a member';
    end if;
  end if;
  return public.fn_materialize_obligation_periods(p_project);
end; $$;
revoke all on function public.materialize_obligation_periods(uuid) from public, anon;
grant execute on function public.materialize_obligation_periods(uuid) to authenticated, service_role;
comment on function public.materialize_obligation_periods(uuid) is
  'P5b idempotent: materialize missing obligation periods for a project up to today+31 days (members or service).';

-- 全案每日推進(pg_cron):只補缺的期,跑幾次結果都一樣。
create or replace function public.materialize_all_obligation_periods(p_today date default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  total integer := 0;
begin
  for pid in select id from public.projects order by id loop
    total := total + public.fn_materialize_obligation_periods(pid, p_today);
  end loop;
  return total;
end; $$;
revoke all on function public.materialize_all_obligation_periods(date) from public, anon, authenticated;

-- ── 4. 義務側 guard 與同步 trigger ───────────────────────────────────────────────
-- 循環義務不再有單一完成狀態:改標期次。舊前端／直接 REST 改 status 會明確失敗,不會靜默吃掉。
create or replace function public.obligation_recurring_status_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.recurring in ('daily','weekly','monthly','quarterly','yearly')
     and new.status in ('已提送','已完成')
     and new.status is distinct from old.status then
    raise exception '循環義務請逐期標記(obligation_periods／transition_obligation_period),義務本身不再有單一完成狀態';
  end if;
  return new;
end $$;
revoke all on function public.obligation_recurring_status_guard() from public, anon, authenticated;
drop trigger if exists contract_obligations_recurring_guard on public.contract_obligations;
create trigger contract_obligations_recurring_guard
  before update on public.contract_obligations
  for each row execute function public.obligation_recurring_status_guard();

-- 義務插入／規則變更／廢止 → 期次同步:廢止(不適用)把仍待辦的期次一併標不適用(已完成的保留);
-- 規則變更只重建「沒動過」的待辦期(有完成時間、證據或待核對註記的一律保留);其餘只補缺的期。
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
drop trigger if exists contract_obligations_periods_sync on public.contract_obligations;
create trigger contract_obligations_periods_sync
  after insert or update on public.contract_obligations
  for each row execute function public.obligation_periods_sync();

-- 基準日變更 → 立即補齊該案期次(P5b 只補缺的期;既有期不重算,重算與差異紀錄是 P5c 基準日版本的事)。
create or replace function public.projects_obligation_periods_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if row(old.award_date, old.notice_date, old.commencement_date, old.end_date)
     is distinct from row(new.award_date, new.notice_date, new.commencement_date, new.end_date) then
    perform public.fn_materialize_obligation_periods(new.id);
  end if;
  return null;
end $$;
revoke all on function public.projects_obligation_periods_sync() from public, anon, authenticated;
drop trigger if exists projects_obligation_periods_sync on public.projects;
create trigger projects_obligation_periods_sync
  after update of award_date, notice_date, commencement_date, end_date on public.projects
  for each row execute function public.projects_obligation_periods_sync();

-- ── 5. 期次狀態轉移 RPC(唯一寫入路徑)──────────────────────────────────────────
-- 誰可標:與義務同一條規則——自己方(obligation_party(responsible)=my_party())或非正式模式 admin override;
-- 責任不明(obligation_party 回 null)三方都不能標。證據須同案。完成時間戳由伺服器蓋、已提送→已完成
-- 不重蓋;退回待辦清空時間戳並解除證據(W-01:證據是「那次提送」的證據)。
create or replace function public.transition_obligation_period(
  p_period uuid, p_status text,
  p_evidence_submittal_id uuid default null, p_evidence_document_id uuid default null
) returns public.obligation_periods
language plpgsql security definer set search_path = public as $$
declare
  per record;
  done_old boolean;
  done_new boolean;
  next_completed_at timestamptz;
  next_completed_by uuid;
  next_submittal uuid;
  next_document uuid;
  result public.obligation_periods;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select x.*, o.responsible, o.status as obligation_status
    into per
  from public.obligation_periods x
  join public.contract_obligations o on o.id = x.obligation_id
  where x.id = p_period;
  if not found or per.project_id not in (select public.my_project_ids()) then
    raise exception 'obligation period not found';
  end if;
  -- obligation_party() 對責任不明回 null:null = my_party() 是 null,coalesce 成 false 才會擋
  -- (與義務 update policy 的「條件為 null 即不放行」同義)。
  if not coalesce(public.admin_override(per.project_id) or public.obligation_party(per.responsible) = public.my_party(), false) then
    raise exception '只有責任方可標記此期次';
  end if;
  if p_status is null or p_status not in ('待辦','已提送','已完成','不適用') then
    raise exception 'unknown obligation period status: %', p_status;
  end if;
  if per.obligation_status = '不適用' then
    raise exception '義務已不適用,期次不可再變更';
  end if;
  if p_evidence_submittal_id is not null and not exists (
    select 1 from public.submittals s where s.id = p_evidence_submittal_id and s.project_id = per.project_id) then
    raise exception '佐證送審文件不屬於本案';
  end if;
  if p_evidence_document_id is not null and not exists (
    select 1 from public.field_documents d where d.id = p_evidence_document_id and d.project_id = per.project_id) then
    raise exception '佐證現場文書不屬於本案';
  end if;

  done_old := per.status in ('已提送','已完成');
  done_new := p_status in ('已提送','已完成');
  next_completed_at := per.completed_at;
  next_completed_by := per.completed_by;
  if done_new and not done_old then
    next_completed_at := now();
    next_completed_by := auth.uid();
  elsif done_old and not done_new then
    next_completed_at := null;
    next_completed_by := null;
  end if;
  next_submittal := coalesce(p_evidence_submittal_id, per.evidence_submittal_id);
  next_document := coalesce(p_evidence_document_id, per.evidence_document_id);
  if p_status = '待辦' then
    next_submittal := null;
    next_document := null;
  end if;

  update public.obligation_periods
  set status = p_status,
      completed_at = next_completed_at,
      completed_by = next_completed_by,
      evidence_submittal_id = next_submittal,
      evidence_document_id = next_document,
      review_note = case when p_status = '待辦' then review_note else null end, -- 人已核對並標記 → 待核對註記解除
      updated_at = now()
  where id = p_period
  returning * into result;
  return result;
end; $$;
revoke all on function public.transition_obligation_period(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.transition_obligation_period(uuid, text, uuid, uuid) to authenticated;
comment on function public.transition_obligation_period(uuid, text, uuid, uuid) is
  'P5b: the only write path for obligation_periods.status. Ownership rule = contract_obligations update policy; server stamps completed_at/by; back to 待辦 clears evidence.';

-- ── 6. 回填:既有義務層完成狀態 → 期次 ────────────────────────────────────────────
-- 有 completed_at → 對應到含該台北日曆日的期別(狀態、時間、人、送審佐證一併帶過去);
-- 推不出(無 completed_at 或該日不在任何期次內)→ 義務原狀不動,已到期的待辦期次標 review_note。
create or replace function public.fn_backfill_obligation_period_completion(p_obligation uuid, p_today date default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  ob record;
  done_day date;
  today date := coalesce(p_today, public.fn_taipei_today());
  mapped integer := 0;
begin
  select id, status, recurring, completed_at, completed_by, evidence_submittal_id into ob
  from public.contract_obligations where id = p_obligation;
  if not found or ob.status not in ('已提送','已完成')
     or ob.recurring is null or ob.recurring not in ('daily','weekly','monthly','quarterly','yearly') then
    return 'none';
  end if;
  if ob.completed_at is not null then
    done_day := (ob.completed_at at time zone 'Asia/Taipei')::date;
    update public.obligation_periods
    set status = ob.status, completed_at = ob.completed_at, completed_by = ob.completed_by,
        evidence_submittal_id = coalesce(evidence_submittal_id, ob.evidence_submittal_id),
        basis = basis || jsonb_build_object('backfill', 'completed_at'), updated_at = now()
    where obligation_id = ob.id and status = '待辦' and done_day between period_start and period_end;
    get diagnostics mapped = row_count;
    if mapped > 0 then
      return 'mapped';
    end if;
  end if;
  update public.obligation_periods
  set review_note = '原義務曾標為「' || ob.status || '」但無法對應期別,請核對本期是否已履行', updated_at = now()
  where obligation_id = ob.id and status = '待辦' and due_date <= today and review_note is null;
  return 'review';
end; $$;
revoke all on function public.fn_backfill_obligation_period_completion(uuid, date) from public, anon, authenticated;

do $$
declare
  ob_id uuid;
  n_materialized integer := 0;
  n_periods integer := 0;
  n_mapped integer := 0;
  n_review integer := 0;
  outcome text;
begin
  for ob_id in
    select id from public.contract_obligations
    where recurring in ('daily','weekly','monthly','quarterly','yearly') and status <> '不適用'
    order by project_id, sort_order, id
  loop
    n_periods := n_periods + public.fn_materialize_obligation_periods_for(ob_id);
    n_materialized := n_materialized + 1;
    outcome := public.fn_backfill_obligation_period_completion(ob_id);
    if outcome = 'mapped' then n_mapped := n_mapped + 1;
    elsif outcome = 'review' then n_review := n_review + 1; end if;
  end loop;
  raise notice 'obligation-periods backfill obligations=%, periods_inserted=%, completion_mapped=%, completion_review=%',
    n_materialized, n_periods, n_mapped, n_review;
end; $$;

-- ── 7. 每日推進(pg_cron;正式庫已啟用該擴充,現有 pmis-daily-reminders 亦走它;不新增雲端資源)──
-- 16:05 UTC = 台北 00:05:新的一天先補期次,08:00 的早報讀到的就是最新一期。
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('pmis-obligation-periods');
exception when others then null;
end $$;
select cron.schedule('pmis-obligation-periods', '5 16 * * *', $$select public.materialize_all_obligation_periods()$$);
