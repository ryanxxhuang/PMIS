-- ── 確定性數字比對引擎(轉錄分流用;純函式,IMMUTABLE)─────────────────────
-- 契約條文的數字寫法:阿拉伯(14)、全形(１４)、中文(十四/二十/三十一)。
-- 比對一律「錨定防誤配」:140 不得讓 14 過關、「二十四」不得讓「十四」過關、
-- 「四十」不得讓「四」過關。引擎看不懂的寫法(兩週、翌日、廿五)一律不算命中
-- ——寧可進人工,不可放行抄錯的期限。

-- 中文數字 1-99(超出範圍回 null=不比中文寫法,阿拉伯仍會比)
create or replace function public.zh_numeral(n int) returns text
language sql immutable as $$
  select case
    when n is null or n < 1 or n > 99 then null
    when n < 10 then (array['一','二','三','四','五','六','七','八','九'])[n]
    when n = 10 then '十'
    when n < 20 then '十' || (array['一','二','三','四','五','六','七','八','九'])[n - 10]
    when n % 10 = 0 then (array['一','二','三','四','五','六','七','八','九'])[n / 10] || '十'
    else (array['一','二','三','四','五','六','七','八','九'])[n / 10] || '十'
      || (array['一','二','三','四','五','六','七','八','九'])[n % 10]
  end
$$;

-- 數字 n 是否以「獨立數詞」出現在文字中(可加 p_suffix 錨定單位字,如 '月'/'日')
create or replace function public.number_in_text(n int, t text, p_suffix text default '')
returns boolean language sql immutable as $$
  select case when t is null or n is null then false else
    -- 阿拉伯(含全形正規化):兩側不得再有數字
    translate(t, '０１２３４５６７８９', '0123456789')
      ~ ('(^|[^0-9])' || n::text || p_suffix || case when p_suffix = '' then '([^0-9]|$)' else '' end)
    or (
      public.zh_numeral(n) is not null
      and t ~ ('(^|[^一二三四五六七八九十])' || public.zh_numeral(n) || p_suffix
        || case when p_suffix = '' then '($|[^一二三四五六七八九十])' else '' end)
    )
    -- 位值式中文(民國「一一五年」):限 3 位數以上,避免「第一四條」誤配 14
    or (
      n >= 100
      and t ~ ('(^|[^一二三四五六七八九十〇零])'
        || translate(n::text, '0123456789', '〇一二三四五六七八九') || p_suffix
        || case when p_suffix = '' then '($|[^一二三四五六七八九十〇零])' else '' end)
    )
  end
$$;

-- 指定日期是否出現在引文:年(西元或民國=西元-1911)+「M月」+「D日」都要錨定命中
create or replace function public.date_in_text(d date, t text)
returns boolean language sql immutable as $$
  select case when d is null or t is null then false else
    (public.number_in_text(extract(year from d)::int, t)
      or public.number_in_text(extract(year from d)::int - 1911, t))
    and public.number_in_text(extract(month from d)::int, t, '月')
    and public.number_in_text(extract(day from d)::int, t, '日')
  end
$$;

-- ── 轉錄分流(D-017:契約不用核定,人工只確認「AI 抄得對不對」)────────────
-- 契約本身已是生效文件;「核定生效」語意退場,改為「確認轉錄無誤」。
-- 分流全走確定性引擎,不是 AI 自評:
--   1) 引文經 sourceVerify 逐字核對存在於文件(source_verified)→ 基本門檻
--   2) 期限型再做數字交叉核對(天數/每月幾號/指定日期 必須出現在引文)
-- 兩關全過=自動確認(approved、reviewed_by null=系統);任一疑慮=待確認,
-- 疑慮原因落 triage_doubts 供人工聚焦。保守偏誤:引擎看不懂一律進人工。
-- 紅線相容:狀態轉移由 DB 確定性函式執行,AI 模型從頭到尾沒有決定權;
-- 提醒信/罰款試算仍只吃確認過的義務。

alter table public.requirements add column if not exists triage_doubts text[];
comment on column public.requirements.triage_doubts is
  '確定性轉錄分流的疑慮原因(空陣列=核對無誤自動確認;null=未分流或人工列)。';

create or replace function public.transcription_doubts(p_requirement uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  req record;
  quotes text;
  doubts text[] := '{}';
  n int;
begin
  select * into req from public.requirements where id = p_requirement;
  if req.id is null then return array['找不到項目']; end if;

  select string_agg(source_text, ' ') into quotes
    from public.requirement_sources
   where requirement_id = p_requirement
     and source_verified
     and source_text is not null;
  if quotes is null then return array['來源未核對']; end if;

  -- 期限數字交叉核對:只驗抽取器有填的欄位;引文找不到對應數字=疑慮
  if (req.trigger_config ->> 'offset_days') ~ '^[0-9]+$' then
    n := (req.trigger_config ->> 'offset_days')::int;
    if not public.number_in_text(n, quotes) then
      doubts := doubts || '期限天數與引文對不上'::text;
    end if;
  end if;
  if req.frequency_type = 'monthly' and (req.frequency_config ->> 'day') ~ '^[0-9]+$' then
    n := (req.frequency_config ->> 'day')::int;
    if not public.number_in_text(n, quotes, '日') then
      doubts := doubts || '每月日期與引文對不上'::text;
    end if;
  end if;
  if req.trigger_type = 'fixed' and (req.trigger_config ->> 'fixed_date') ~ '^\d{4}-\d{2}-\d{2}$' then
    if not public.date_in_text((req.trigger_config ->> 'fixed_date')::date, quotes) then
      doubts := doubts || '指定日期與引文對不上'::text;
    end if;
  end if;
  return doubts;
end; $$;

-- 對一個完成的抽取 run 套用分流。只動該 run 的 AI 待審列;
-- 人工/遷移列與已審決列一律不碰。冪等:重跑只會重算同樣結果。
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
    if coalesce(array_length(doubts, 1), 0) = 0 then
      update public.requirements
         set status = 'approved', reviewed_by = null, reviewed_at = now(),
             triage_doubts = '{}'
       where id = req.id;
      if req.requirement_type = 'deadline' then
        perform public.materialize_deadline_obligation(req.id);
      end if;
      n_auto := n_auto + 1;
    else
      update public.requirements
         set status = 'needs_review', triage_doubts = doubts
       where id = req.id;
      n_flag := n_flag + 1;
    end if;
  end loop;
  return query select n_auto, n_flag;
end; $$;

-- 權限:分流只由伺服器端(edge service role/migration)執行;
-- 數字引擎與疑慮查詢開放 authenticated(前端顯示疑慮用不到,但除錯有用)。
revoke all on function public.transcription_doubts(uuid) from public, anon;
revoke all on function public.apply_transcription_triage(uuid) from public, anon, authenticated;
grant execute on function public.transcription_doubts(uuid) to authenticated;
grant execute on function public.apply_transcription_triage(uuid) to service_role;
revoke all on function public.zh_numeral(int) from public, anon;
revoke all on function public.number_in_text(int, text, text) from public, anon;
revoke all on function public.date_in_text(date, text) from public, anon;

-- ── 一次性回填:對既有全部已完成的 run 套用分流 ────────────────────────────
-- (歷史待審 AI 建議依同一套確定性規則自動確認/標記疑慮;人工列不動)
do $$
declare r record;
begin
  for r in select id from public.document_ingestion_runs where status = 'completed'
  loop
    perform public.apply_transcription_triage(r.id);
  end loop;
end $$;
