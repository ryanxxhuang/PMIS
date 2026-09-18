-- P5c｜基準日版本 project_anchor_versions、期次／契約期限依「適用版本」計算、循環停止條件
-- (D-026 §4 契約時程與提醒對齊;實作指令 §5「開工、停復工、展延與核准變更影響的期限保留依據與版本」、
-- §8「基準日／核准工期變更不破壞歷史」;設計 docs/architecture/slimming-entrypoints-and-retirement.md §4.3)。
--
-- 為什麼:projects 的四個基準日(決標／接獲開工通知／開工／竣工)是所有契約期限的起算點,但改它會靜默
-- 覆寫——沒有誰、何時、依據哪份函文改的紀錄;P5b 的期次只補缺的期、不重算既有期,基準日更正後舊期的
-- 到期日對不上新基準日,又沒有任何地方說「哪些事項因此改期」;單次義務的到期日永遠從「現行」基準日
-- 即時算,已完成的義務會因日後改基準日而改變準時判定(破壞歷史);循環期次沒有停止條件,竣工之後仍
-- 一直產生。
--
-- 做法:
--   1. project_anchor_versions:每次基準日變更留一版(版號、變更後四日期快照、改了哪幾欄、變更類別
--      〔initial／edit／suspension 停工／resumption 復工／extension 展延／change_order 核准變更工期〕、
--      生效日、理由、依據函文／變更案號、建立者與時間、受影響事項 effects)。append-only:authenticated
--      只有 SELECT(可見性沿用專案成員),UPDATE／DELETE 一律被 guard 拒(只放行專案刪除 cascade)。
--   2. projects 四個基準日的 INSERT／UPDATE trigger 自動留版(直接 REST 改也留版,不可能靜默覆寫);
--      RPC update_project_anchors(security invoker,授權＝projects 既有 update policy)可附變更類別／
--      理由／依據,經交易內 GUC 讓 trigger 帶進版本;停工／復工等不改四日期的版本由 RPC 直接記錄。
--   3. 重算只動「未完成」的期:留版時對受影響的循環義務逐期比對——沒動過的待辦期(無完成時間、無證據、
--      無待核對註記)改期／移除／新增並蓋新版號;已提送／已完成／已掛證據／待核對的期一律原樣保留
--      (到期日與 basis 不變),差異寫進該版 effects(rescheduled／removed／added／kept),前端逐版列出。
--   4. 單次義務:進入已提送／已完成時由 trigger 依當時基準日留 due_date_snapshot 與 anchor_version_no,
--      退回待辦清空;前端／Edge 的 contractDue 對已完成單次義務優先讀快照——基準日事後更正不改歷史。
--   5. 循環停止條件(P5b 未定義):以現行資料可判定者為準——
--        保固類(category='保固'):保固期滿日系統沒有欄位可判定 → 不自動產生期次,列「停止條件待補」;
--        其餘:實際竣工日(acceptance_events 的 confirm,沒有就 report 的 event_date)優先,否則契約竣工日
--        projects.end_date;期次只產生到「期間起日 ≤ 界限日」為止;登錄竣工後界限日之後沒動過的待辦期移除。
--        竣工日缺、或竣工日已過而未登錄竣工／展延 → 停止自動產生並列「停止條件待補／待確認」(待補設定
--        新種類 stop),不無限產生。前端／Edge 同口徑 recurrenceStopGap(共用案例釘住)。
--   6. 回填(不偽造歷史依據):每個已填任一基準日的專案建 version 1(change_kind='initial',reason 註明回填、
--      created_by／effective_from 為 null);既有期次只在 basis 的起算日等於 v1 快照時才蓋 anchor_version_no=1;
--      已完成的單次義務(正式庫 0 筆)不補快照(前端照舊以現行基準日計算,畫面標「完成時未留版」);
--      套用停止條件:已登錄竣工的專案,竣工後沒動過的待辦期移除(正式庫盤點:2 案 8 期 → 預計移除 5 期)。
--
-- 資料:不改 projects 任何列;contract_obligations 加兩欄(皆 null);obligation_periods 只蓋版號與移除
-- 竣工後未動過的待辦期。回復:supabase/rollbacks/20260919021500_project_anchor_versions.down.sql。
-- pgTAP:supabase/tests/project_anchor_versions.sql;允許清單 anon_and_function_privileges.sql 加 update_project_anchors。

-- 匿名 preflight:只記數量。
do $$
declare
  n_projects bigint; n_with_anchor bigint; n_periods bigint; n_periods_touched bigint;
  n_done_single bigint; n_completion_projects bigint;
begin
  select count(*), count(*) filter (where award_date is not null or notice_date is not null or commencement_date is not null or end_date is not null)
    into n_projects, n_with_anchor from public.projects;
  select count(*), count(*) filter (where completed_at is not null or evidence_submittal_id is not null or evidence_document_id is not null or review_note is not null or status <> '待辦')
    into n_periods, n_periods_touched from public.obligation_periods;
  select count(*) into n_done_single from public.contract_obligations where recurring is null and status in ('已提送','已完成');
  select count(distinct project_id) into n_completion_projects from public.acceptance_events where stage_key in ('report','confirm');
  raise notice 'anchor-versions preflight projects=%, with_anchor=%, periods=%, periods_touched=%, done_single=%, completion_projects=%',
    n_projects, n_with_anchor, n_periods, n_periods_touched, n_done_single, n_completion_projects;
end; $$;

-- ── 1. 表 ──────────────────────────────────────────────────────────────────────
create table if not exists public.project_anchor_versions (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.projects(id) on delete cascade,
  version_no              integer not null check (version_no >= 1),
  change_kind             text not null default 'edit'
                          check (change_kind in ('initial','edit','suspension','resumption','extension','change_order')),
  anchors                 jsonb not null default '{}'::jsonb,
  changed_keys            text[] not null default '{}'::text[],
  effective_from          date,
  reason                  text,
  source_ref              text,
  source_change_order_id  uuid references public.change_orders(id) on delete set null,
  effects                 jsonb not null default '[]'::jsonb,
  created_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  unique (project_id, version_no)
);
comment on table public.project_anchor_versions is
  'P5c 基準日與工期依據的版本(append-only):projects 四個基準日每次變更一版,由 trigger 產生;停工／復工／展延／核准變更工期由 RPC update_project_anchors 帶類別與依據。UPDATE／DELETE 被 guard 拒。';
comment on column public.project_anchor_versions.anchors is '變更後的四個基準日快照 {award_date, notice_date, commencement_date, end_date}(null 保留)';
comment on column public.project_anchor_versions.changed_keys is '本版相對前一版改了哪幾個基準日欄位;version 1 回填時=已填的欄位';
comment on column public.project_anchor_versions.change_kind is 'initial 初值／edit 直接修改／suspension 停工／resumption 復工／extension 展延／change_order 核准變更工期';
comment on column public.project_anchor_versions.effective_from is '生效日(停工日／復工日／核准日);null=回填時未知';
comment on column public.project_anchor_versions.source_ref is '依據:函文字號／變更案號等自由文字;source_change_order_id 可另指本案核准變更';
comment on column public.project_anchor_versions.effects is '本版重算差異:[{kind: rescheduled|removed|added|kept, obligation_id, title, period_key, old_due, new_due, status}]';
create index if not exists project_anchor_versions_project_idx on public.project_anchor_versions (project_id, version_no desc);

alter table public.project_anchor_versions enable row level security;
drop policy if exists "project_anchor_versions_select" on public.project_anchor_versions;
create policy "project_anchor_versions_select" on public.project_anchor_versions
  for select to authenticated
  using (project_id in (select public.my_project_ids()));
-- 基線 default privileges 會給 authenticated DML:收窄為只讀。寫入只走 trigger／RPC(security definer)。
revoke all on public.project_anchor_versions from public, anon, authenticated;
grant select on public.project_anchor_versions to authenticated;

-- append-only guard:UPDATE／DELETE 一律拒(含 service_role),只放行專案刪除 cascade(專案列已不存在)。
create or replace function public.project_anchor_versions_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.projects p where p.id = old.project_id) then
    return coalesce(new, old); -- 專案刪除 cascade
  end if;
  raise exception '基準日版本不可修改或刪除(append-only);要更正請新增一版' using errcode = 'P0001';
end $$;
revoke all on function public.project_anchor_versions_guard() from public, anon, authenticated;
drop trigger if exists project_anchor_versions_guard on public.project_anchor_versions;
create trigger project_anchor_versions_guard
  before update or delete on public.project_anchor_versions
  for each row execute function public.project_anchor_versions_guard();

-- ── 2. 純函式 ───────────────────────────────────────────────────────────────────
-- 四個基準日 → jsonb 快照(null 保留,鍵永遠齊)。
create or replace function public.fn_anchors_json(p_award date, p_notice date, p_commencement date, p_end date)
returns jsonb language sql immutable as $$
  select jsonb_build_object('award_date', p_award, 'notice_date', p_notice, 'commencement_date', p_commencement, 'end_date', p_end);
$$;
revoke all on function public.fn_anchors_json(date, date, date, date) from public, anon, authenticated;

-- 單次義務的到期日(與前端 contractDue.js／Edge contractDue.ts 同口徑):fixed 直接用指定日期;
-- 觸發點對應的基準日 ± 偏移天數;基準日缺或觸發點無對應 → null(不臆測)。
create or replace function public.fn_obligation_single_due(
  p_trigger_event text, p_offset_days integer, p_offset_dir text, p_fixed_date date,
  p_award date, p_notice date, p_commencement date, p_end date
) returns date language sql immutable as $$
  select case
    when p_trigger_event = 'fixed' then p_fixed_date
    else (case p_trigger_event
            when 'award' then p_award
            when 'notice' then p_notice
            when 'commencement' then p_commencement
            when 'completion' then p_end
            else null end)
         + (coalesce(p_offset_days, 0) * (case when p_offset_dir = 'before' then -1 else 1 end))
    end;
$$;
revoke all on function public.fn_obligation_single_due(text, integer, text, date, date, date, date, date) from public, anon, authenticated;

-- 單次義務觸發點 → 基準日欄位(fixed／other／null 無對應)。
create or replace function public.fn_obligation_single_anchor_key(p_trigger_event text)
returns text language sql immutable as $$
  select case p_trigger_event
    when 'award' then 'award_date'
    when 'notice' then 'notice_date'
    when 'commencement' then 'commencement_date'
    when 'completion' then 'end_date'
    else null end;
$$;
revoke all on function public.fn_obligation_single_anchor_key(text) from public, anon, authenticated;

-- 實際竣工日:驗收流程的「竣工確認會勘」(confirm)優先,沒有就「竣工申報」(report);同階段多筆取最後登錄。
-- 沒登錄 → null。(acceptance_events 只有 RLS 沒有欄位級限制;本函式只供 security definer 的物化／重算呼叫。)
create or replace function public.fn_project_completion_date(p_project uuid)
returns date language sql stable set search_path = public as $$
  select coalesce(
    (select a.event_date from public.acceptance_events a where a.project_id = p_project and a.stage_key = 'confirm' and a.event_date is not null order by a.created_at desc, a.id desc limit 1),
    (select a.event_date from public.acceptance_events a where a.project_id = p_project and a.stage_key = 'report' and a.event_date is not null order by a.created_at desc, a.id desc limit 1));
$$;
revoke all on function public.fn_project_completion_date(uuid) from public, anon, authenticated;

-- 循環期次的界限日(期間起日 ≤ 界限日才產生):保固類系統無法判定 → null;其餘實際竣工日優先、否則契約竣工日。
create or replace function public.fn_obligation_recurrence_bound(p_category text, p_end_date date, p_completion date)
returns date language sql immutable as $$
  select case when p_category = '保固' then null else coalesce(p_completion, p_end_date) end;
$$;
revoke all on function public.fn_obligation_recurrence_bound(text, date, date) from public, anon, authenticated;

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

-- ── 3. materialize:加界限日與版號(取代 P5b 同名函式;冪等、只補缺的期不變)────────────
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

-- 套用界限日:界限日之後「沒動過」的待辦期移除(已提送／已完成／掛證據／待核對的一律保留);界限日判不出
-- (保固類、缺竣工日且未登錄竣工)時沒動過的待辦期同樣移除——證明不了它們該存在,前端改列「停止條件待補」,
-- 界限日判得出後由冪等物化補回。觸發:登錄／更正／清除竣工(acceptance_events trigger)、本次回填。回傳移除數。
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

-- ── 4. 留版重算:只動未完成的期,差異寫進 effects ─────────────────────────────────────
-- p_old／p_new 為 fn_anchors_json 形狀;p_version 為即將記錄的版號(新增／改期的期蓋這個版號)。
-- 循環義務:受影響=起算基準日欄位或竣工日(界限)有變;沒動過的待辦期依新基準日逐期比對——
--   同期別到期日不同 → 改期(rescheduled);新排程沒有的 → 移除(removed);新排程多出的 → 新增(added);
--   動過的期(已提送／已完成／掛證據／待核對)一律不動,若新排程對不上就記 kept(讓人看到「這期保留原依據」)。
-- 單次義務:觸發點對應的基準日有變 → 未完成的記 rescheduled(舊到期→新到期);已完成的記 kept(快照不變)。
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

-- 記一版:先重算(蓋新版號)、再寫版本列(effects 一併寫入,版本列自此不可改)。同案序列化避免版號撞號。
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

-- projects 基準日 INSERT／UPDATE → 自動留版(取代 P5b 的 projects_obligation_periods_sync:補齊期次改由重算涵蓋)。
-- RPC 以交易內 GUC pmis.anchor_change 帶類別／理由／依據;直接 REST 改 → change_kind='edit'、無依據(仍留版)。
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

-- ── 5. 對外 RPC:附依據的基準日變更 ─────────────────────────────────────────────────
-- security definer(內部留版函式不對 authenticated 開放 EXECUTE),授權與 projects 的 update policy 同一個
-- 函式 is_project_admin()(D-022 單一授權來源),第一行把關、非管理者與非成員同一句拒絕(不洩漏存在)。
-- 停工／復工／展延／核准變更工期即使四日期未變也留一版(工期依據的紀錄)。
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

-- ── 6. 單次義務:完成時留到期日快照與版號(基準日事後更正不改歷史)────────────────────
alter table public.contract_obligations
  add column if not exists due_date_snapshot date,
  add column if not exists anchor_version_no integer;
comment on column public.contract_obligations.due_date_snapshot is
  'P5c 單次義務進入已提送／已完成時,由 trigger 依當時基準日計算的到期日快照;退回待辦清空;client 值一律作廢。循環義務永遠 null(期次各自有依據)。';
comment on column public.contract_obligations.anchor_version_no is
  'P5c 留快照時引用的專案基準日版本(project_anchor_versions.version_no);null=無版本或未留快照';

create or replace function public.stamp_obligation_due_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  done_old boolean := false;
  done_new boolean := new.status in ('已提送','已完成');
  p record;
begin
  -- client 送來的快照一律作廢:UPDATE 還原成舊值、INSERT 清空,再依狀態轉換決定
  if tg_op = 'UPDATE' then
    done_old := old.status in ('已提送','已完成');
    new.due_date_snapshot := old.due_date_snapshot;
    new.anchor_version_no := old.anchor_version_no;
  else
    new.due_date_snapshot := null;
    new.anchor_version_no := null;
  end if;
  if new.recurring in ('daily','weekly','monthly','quarterly','yearly') then
    return new; -- 循環義務逐期各自留依據
  end if;
  if done_new and not done_old then
    select award_date, notice_date, commencement_date, end_date into p from public.projects where id = new.project_id;
    new.due_date_snapshot := public.fn_obligation_single_due(new.trigger_event, new.offset_days, new.offset_dir, new.fixed_date,
      p.award_date, p.notice_date, p.commencement_date, p.end_date);
    select max(version_no) into new.anchor_version_no from public.project_anchor_versions where project_id = new.project_id;
  elsif done_old and not done_new then
    new.due_date_snapshot := null;
    new.anchor_version_no := null;
  end if;
  return new;
end $$;
revoke all on function public.stamp_obligation_due_snapshot() from public, anon, authenticated;
drop trigger if exists contract_obligations_due_snapshot on public.contract_obligations;
create trigger contract_obligations_due_snapshot
  before insert or update on public.contract_obligations
  for each row execute function public.stamp_obligation_due_snapshot();

-- ── 7. 竣工登錄 → 套用界限日並補齊 ─────────────────────────────────────────────────
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
drop trigger if exists acceptance_events_obligation_periods_sync on public.acceptance_events;
create trigger acceptance_events_obligation_periods_sync
  after insert or update or delete on public.acceptance_events
  for each row execute function public.acceptance_events_obligation_periods_sync();

-- ── 8. 回填(不偽造歷史依據)─────────────────────────────────────────────────────────
do $$
declare
  p record;
  n_versions integer := 0;
  n_stamped integer := 0;
  n_removed integer := 0;
  n_added integer := 0;
  keys text[];
begin
  for p in
    select id, award_date, notice_date, commencement_date, end_date from public.projects
    where (award_date is not null or notice_date is not null or commencement_date is not null or end_date is not null)
      and not exists (select 1 from public.project_anchor_versions v where v.project_id = projects.id)
    order by created_at, id
  loop
    keys := array_remove(array[
      case when p.award_date is not null then 'award_date' end,
      case when p.notice_date is not null then 'notice_date' end,
      case when p.commencement_date is not null then 'commencement_date' end,
      case when p.end_date is not null then 'end_date' end], null);
    insert into public.project_anchor_versions (project_id, version_no, change_kind, anchors, changed_keys, effective_from, reason, effects, created_by)
    values (p.id, 1, 'initial', public.fn_anchors_json(p.award_date, p.notice_date, p.commencement_date, p.end_date), keys, null,
            '既有現值回填（P5c）：此前的變更歷史未留存', '[]'::jsonb, null);
    n_versions := n_versions + 1;
  end loop;

  -- 既有期次:basis 的起算日等於 v1 快照 → 蓋 anchor_version_no=1(事實);對不上的留 null(不臆測)
  update public.obligation_periods x
  set anchor_version_no = 1, updated_at = now()
  from public.project_anchor_versions v
  where v.project_id = x.project_id and v.version_no = 1 and x.anchor_version_no is null
    and (x.basis ->> 'anchor_key') in ('award_date','notice_date','commencement_date','end_date')
    and (x.basis ->> 'anchor_date') is not null
    and (x.basis ->> 'anchor_date')::date = (v.anchors ->> (x.basis ->> 'anchor_key'))::date;
  get diagnostics n_stamped = row_count;

  -- 停止條件:已登錄竣工／竣工日已定的專案,界限日之後沒動過的待辦期移除;再以新規則補齊(不會越界)
  for p in select id from public.projects order by id loop
    n_removed := n_removed + public.fn_apply_obligation_recurrence_bound(p.id);
    n_added := n_added + public.fn_materialize_obligation_periods(p.id);
  end loop;
  raise notice 'anchor-versions backfill versions=%, periods_stamped=%, periods_removed_by_bound=%, periods_added=%',
    n_versions, n_stamped, n_removed, n_added;
end; $$;
