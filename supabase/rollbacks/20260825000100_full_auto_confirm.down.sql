-- Roll back 20260825000100 (D-019 AI 整理全自動確認) to the D-017 triage
-- semantics of 20260824130000: only requirements that pass both deterministic
-- checks are auto-confirmed; any doubt goes back to needs_review.
-- Run through SQL Editor / psql as database owner in one transaction.
-- Ordering: if D-020 (20260901040000) is applied, run its down file FIRST —
-- it restores the deadline-only apply_transcription_triage that this file
-- then narrows back to D-017. This file assumes
-- public.materialize_deadline_obligation(uuid) exists.
-- Data policy: rows D-019 confirmed WITH doubts (status='approved',
-- reviewed_by is null, triage_doubts <> '{}') are left as they are. They may
-- already have materialised obligations that users operated on, and the
-- D-019 UI disclosed the doubt on each row; un-confirming them would silently
-- delete履約時程 history. Re-triage is a product decision, not a rollback step —
-- see the commented block at the end if it is explicitly wanted.
begin;

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

commit;

-- Optional, NOT run by default: push D-019 doubt-carrying auto-confirms back
-- to needs_review. Only safe when their obligations have no runtime traces.
-- update public.requirements
--    set status = 'needs_review', reviewed_at = null
--  where origin = 'ai' and status = 'approved' and reviewed_by is null
--    and coalesce(array_length(triage_doubts, 1), 0) > 0
--    and not exists (
--      select 1 from public.contract_obligations o
--       where o.requirement_id = requirements.id
--         and (o.status <> '待辦' or o.evidence_document_id is not null));
