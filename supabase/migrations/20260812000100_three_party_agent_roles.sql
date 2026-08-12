-- 三方角色收斂：系統授權與 Agent 身分只保留 contractor / supervisor / owner。
-- 現場(field)與品管(qc)是廠商內部分工，不再是系統角色。
--
-- 相容策略：正式環境可能在 migration 與 Edge Function 部署交錯期間仍收到舊版
-- field/qc 寫入；BEFORE trigger 會先正規化為 contractor，再交給三方 check constraint。

create or replace function public.normalize_agent_action_role()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.agent_role in ('field', 'qc') then
    new.agent_role := 'contractor';
  end if;
  return new;
end; $$;

drop trigger if exists agent_actions_normalize_role on public.agent_actions;
create trigger agent_actions_normalize_role
  before insert or update of agent_role on public.agent_actions
  for each row execute function public.normalize_agent_action_role();

update public.agent_actions
set agent_role = 'contractor'
where agent_role in ('field', 'qc');

alter table public.agent_actions
  drop constraint if exists agent_actions_agent_role_check;
alter table public.agent_actions
  add constraint agent_actions_agent_role_check
  check (agent_role in ('contractor', 'supervisor', 'owner'));

comment on column public.project_memberships.project_role is
  'Legacy/descriptive project job title. Not an authorization or Agent-role source; permissions use profiles.org_type.';
