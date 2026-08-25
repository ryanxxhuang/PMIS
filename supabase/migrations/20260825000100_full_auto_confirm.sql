-- D-019(修訂 D-017):AI 整理全自動確認——不留待確認佇列。
--
-- 使用者拍板(2026-08-25):AI 從已核定的契約裡爬出來整理,全部自動歸檔;
-- 頁面明示「內容如有出入,以契約原文為準」。確定性核對(引文逐字+期限數字)
-- 從「確認的門檻」改為「透明度標註」:
--   - 核對全過 → triage_doubts = '{}'(紀錄行顯示「系統核對無誤・自動確認」)
--   - 有疑慮   → 照樣確認,但 triage_doubts 保留原因,前端標示
--     「未逐字核對,以契約原文為準」(紀錄行顯示「AI 整理・自動確認」)
-- 人工補登(origin manual/migration)不在此列:人寫的仍由監造/機關確認。
-- 回傳值語意:auto_confirmed=本次確認總數;flagged=其中帶疑慮註記的條數。
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
    if req.requirement_type = 'deadline' then
      perform public.materialize_deadline_obligation(req.id);
    end if;
    n_auto := n_auto + 1;
    if coalesce(array_length(doubts, 1), 0) > 0 then n_flag := n_flag + 1; end if;
  end loop;
  return query select n_auto, n_flag;
end; $$;

-- 一次性回填:把仍在待確認的 AI 建議(先前分流標疑慮的)全部確認並物化
do $$
declare r record;
begin
  for r in select id from public.document_ingestion_runs where status = 'completed'
  loop
    perform public.apply_transcription_triage(r.id);
  end loop;
end $$;
