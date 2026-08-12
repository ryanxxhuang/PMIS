-- W5-3 C-002: document the boundary between the two similarly named member
-- models in schema metadata. COMMENT statements only; no behavior or RLS change.

comment on table public.project_members is
  'AUTHORIZATION: project access and legacy admin/member flag. Use with profiles.org_type for business permissions; never infer contract-party identity from this table.';

comment on table public.project_memberships is
  'IDENTITY SNAPSHOT: represented project party, contract-package attribution and audit actor identity. Never use project_role, party type or is_project_admin as business authorization.';

comment on function public.is_project_member(uuid) is
  'AUTHORIZATION: project access predicate backed by project_members.';
comment on function public.my_project_ids() is
  'AUTHORIZATION: projects accessible through project_members.';
comment on function public.is_project_admin(uuid) is
  'AUTHORIZATION: project administration through project_members or project creator.';
comment on function public.can_write(uuid) is
  'AUTHORIZATION: business write permission from project_members plus profiles.org_type.';
comment on function public.can_review_requirement(uuid) is
  'AUTHORIZATION: Requirement review permission from project_members plus profiles.org_type.';

comment on function public.my_project_membership(uuid) is
  'IDENTITY SNAPSHOT: represented party and descriptive project role for one project; never use as business authorization.';
comment on function public.my_project_party_type(uuid) is
  'IDENTITY SNAPSHOT: represented contract-party type; never use as business authorization or Agent persona.';
comment on function public.my_project_role(uuid) is
  'IDENTITY SNAPSHOT: descriptive legacy project role; never use as business authorization, navigation, Agent persona or reminder routing.';
comment on function public.my_project_ids_v2() is
  'IDENTITY SNAPSHOT: compatibility helper for identity-table policies only; not business authorization.';
comment on function public.is_project_member_v2(uuid) is
  'IDENTITY SNAPSHOT: compatibility predicate for identity-table policies only; not business authorization.';
comment on function public.is_project_admin_v2(uuid) is
  'IDENTITY SNAPSHOT: technical administration of identity records only; not general project or business authorization.';
