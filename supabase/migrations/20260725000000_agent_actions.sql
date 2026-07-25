-- ── 批 1(agent runtime):agent_actions — AI 草稿收件匣 ─────────────────────
-- 為什麼要有這張表:AI agent 一律「只產生草稿」,絕不直接寫任何業務資料表。
-- agent 產出的草稿(日誌草稿/查驗草稿/問答……)先落在 agent_actions,由「本人」
-- 明確 accept / edit / reject;之後的批次才把 accepted 草稿轉成真正的業務寫入
-- (仍走既有 RLS + guard trigger,本檔不碰)。這張表因此是系統管理表,不是業務表。
--
-- 存取模型(照 audit_events / document_ingestion_runs 的 append-only 慣例):
--   * SELECT:草稿本人(actor_user = auth.uid())——草稿是尚未送出的私人工作
--     狀態,同案他人不可見(要給別人看的東西走送審/查驗等正式流程)。這與
--     resolve_agent_action() 的本人限定一致:看得到的必定能處理,不會出現
--     「看得到卻無權處理」的死路。policy 同時保留 my_project_ids() 條件作
--     縱深防禦:即使 actor_user 被誤植也不會跨案外洩。
--   * INSERT:只有 service role(agent-run edge function 落草稿);
--     authenticated 無任何表級寫入權限。
--   * 狀態轉移:只走 resolve_agent_action() RPC(security definer)——
--     本人限定、pending 為唯一可轉移態、寫 audit_events 留痕。
--   * 'expired' 保留給之後批次的 service 端排程(過期草稿自動失效),無使用者路徑。
-- 純加法 migration:不動任何既有表 / policy / trigger / 函式。

create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  actor_user   uuid not null references auth.users(id) on delete cascade,
  agent_role   text not null check (agent_role in ('field','qc','supervisor','owner')),
  kind         text not null,                 -- draft_daily_log | draft_inspection | answer | ...
  target_table text,
  target_id    uuid,
  summary      text not null,
  rationale    text,
  evidence     jsonb not null default '{}'::jsonb,
  status       text not null default 'pending'
               check (status in ('pending','accepted','edited','rejected','expired')),
  resolved_by  uuid references auth.users(id),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists agent_actions_project_idx on public.agent_actions(project_id, created_at desc);
create index if not exists agent_actions_actor_idx   on public.agent_actions(actor_user, status);

alter table public.agent_actions enable row level security;
drop policy if exists "agent_actions_select" on public.agent_actions;
create policy "agent_actions_select" on public.agent_actions for select to authenticated
  using (actor_user = auth.uid() and project_id in (select public.my_project_ids()));

-- 刻意不建 INSERT / UPDATE / DELETE policy,並收回表級寫入權限。
-- 必須自己 revoke 的原因:20260712001200_authenticated_baseline_grants.sql 除了
-- 對既有表廣域 grant,還有 `alter default privileges … grant … to authenticated`,
-- 因此「新表」在建表當下就自動帶著 insert/update/delete 授權——本 migration
-- 序號較晚,在此明確收回才會勝出(db reset 重放時順序亦同)。
-- 寫入唯一路徑:service role(agent-run edge function);狀態轉移唯一路徑:下方 RPC。
revoke insert, update, delete on public.agent_actions from public, anon, authenticated;
grant select on public.agent_actions to authenticated;

-- ── 狀態轉移 RPC:resolve_agent_action ──────────────────────────────────────
-- security definer:authenticated 對表沒有 UPDATE 權限,這支 RPC 是唯一的人為
-- 狀態轉移路徑——把「誰能改、能改成什麼」收斂在一個可稽核的窄門裡。
create or replace function public.resolve_agent_action(p_id uuid, p_status text)
returns public.agent_actions
language plpgsql security definer set search_path = public as $$
declare
  v_before public.agent_actions;
  v_after  public.agent_actions;
begin
  -- 只接受三個人為終態;'pending' 不是「處理」,'expired' 走 service 排程不走此門
  if p_status is null or p_status not in ('accepted','edited','rejected') then
    raise exception '不合法的處理狀態,僅接受 accepted/edited/rejected';
  end if;

  -- 本人限定:草稿是提給 actor_user 的,別人(即使同案成員)不能替他決定。
  -- 「不存在」與「非本人」刻意回同一訊息,不洩漏他案/他人草稿是否存在。
  select * into v_before
  from public.agent_actions
  where id = p_id and actor_user = auth.uid()
  for update;
  if not found then
    raise exception '無權處理此 AI 草稿';
  end if;

  -- 終態不可逆:已處理過的草稿是歷史,不得改寫
  if v_before.status <> 'pending' then
    raise exception '此 AI 草稿已處理過';
  end if;

  update public.agent_actions
     set status      = p_status,
         resolved_by = auth.uid(),
         resolved_at = now()
   where id = p_id
   returning * into v_after;

  -- 審計留痕:誰在何時把哪份 AI 草稿處理成什麼(record_audit_event 見 20260712000500)
  perform public.record_audit_event(
    v_after.project_id,
    'agent_action_resolved',
    'agent_action',
    v_after.id,
    p_status,
    to_jsonb(v_before),
    to_jsonb(v_after),
    jsonb_build_object('kind', v_after.kind, 'agent_role', v_after.agent_role),
    null
  );

  return v_after;
end; $$;
revoke all on function public.resolve_agent_action(uuid, text) from public, anon;
grant execute on function public.resolve_agent_action(uuid, text) to authenticated;
