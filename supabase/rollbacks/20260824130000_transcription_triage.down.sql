-- Roll back 20260824130000 (D-017 確定性轉錄分流引擎).
-- Run through SQL Editor / psql as database owner in one transaction.
-- Ordering: run the downs for 20260901040000 (D-020) and 20260825000100
-- (D-019) first; this file removes the triage RPC, the numeric-match engine
-- and the triage_doubts column entirely.
-- ⚠️ extract-requirements (Edge) calls apply_transcription_triage after every
-- completed run. Redeploy the pre-D-017 function version (or a build that
-- tolerates a missing RPC) in the same change window, otherwise extraction
-- completes but the post-run call errors.
-- Data policy: requirements the backfill auto-confirmed stay approved with
-- reviewed_by null — that is exactly the "system confirmed" marker the
-- frontend reads, and their obligations carry runtime history. Nothing is
-- un-confirmed here.
begin;

revoke all on function public.apply_transcription_triage(uuid) from service_role;
drop function if exists public.apply_transcription_triage(uuid);
drop function if exists public.transcription_doubts(uuid);
drop function if exists public.date_in_text(date, text);
drop function if exists public.number_in_text(int, text, text);
drop function if exists public.zh_numeral(int);

alter table public.requirements drop column if exists triage_doubts;

commit;
