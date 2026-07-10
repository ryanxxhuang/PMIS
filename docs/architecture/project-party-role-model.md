# Project Party and Role Model

## 1. Why profiles are not project identity

`profiles.org_type` is a user-level attribute. It can describe a default or
legacy affiliation, but it cannot describe who a person represents on every
project. The same person may represent a contractor on Project A and a
supervisor on Project B. P0-02 therefore keeps `profiles.org_type` for
compatibility and moves new identity reads to project-scoped memberships.

## 2. Organization, project party, and project membership

The model separates three concepts:

- `organizations` is an optional reusable real-world organization record.
- `project_parties` is the organization or named team acting in one project.
  A party always belongs to exactly one project. Its optional
  `organization_id` may connect it to an organization without making the
  organization itself project-scoped.
- `project_memberships` connects one user to one party in one project and
  records that user's project role and technical administration flag.

One user has at most one membership per project. The database also verifies
that a membership and its party belong to the same project.

## 3. Party type is not project role

`project_parties.party_type` identifies the side of the project relationship:
`agency`, `contractor`, `supervisor`, `designer`, `consultant`, or `other`.

`project_memberships.project_role` identifies what a person does on that
project: `agency_pm`, `agency_engineer`, `contractor_pm`, `site_manager`,
`quality_engineer`, `safety_engineer`, `supervisor_manager`,
`supervisor_engineer`, `document_controller`, or `viewer`.

These values are intentionally independent. A technical permission must not
silently rewrite either the represented party or the person's project role.

## 4. Project administration is a separate capability

`is_project_admin` controls technical project-identity administration, such as
maintaining parties and memberships. It is not a party type and is not a
business role. For example, a contractor quality engineer may be a technical
project admin while remaining a contractor and a quality engineer.

P0-02 preserves the legacy creator/admin flag by copying it to
`is_project_admin`. Creator status is never used to infer which party a person
represents.

## 5. Legacy migration

The migration seeds deterministic named parties from the existing project
fields:

- `owner_name` becomes the `legacy:agency` party.
- `contractor_name` becomes the `legacy:contractor` party.
- `supervisor_name` becomes the `legacy:supervisor` party.

Existing `project_members` rows are mirrored into `project_memberships`.
Legacy profile values map to the matching named party and to a conservative
initial role: owner to `agency_engineer`, contractor to `contractor_pm`, and
supervisor to `supervisor_engineer`. The deterministic `migration_key` and
unique constraints make re-running the migration safe. Inserts use conflict
handling that preserves any membership corrected after migration.

P0-02 does not delete or rewrite `project_members`, the project name fields, or
`profiles.org_type`. Member add/remove compatibility RPCs keep both membership
models synchronized while P0-02 is active.

## 6. Unresolved identity handling

When a legacy member has no reliable matching named party, the migration does
not fabricate an organization or contractual identity. It places the member
in one deterministic `other` party named `未分類（待確認）` and assigns the
conservative `viewer` role. A copied legacy admin flag remains separate from
that unresolved party and role. Administrators can resolve this explicitly in
a later identity-management workflow.

## 7. Requirement responsibility

P0-01 introduced `requirements.responsible_project_party_id` as a deferred
relationship. P0-02 adds its foreign key to `project_parties` and sets it to
null when a party is deleted. A trigger rejects a responsible party from a
different project. Responsibility therefore points to the accountable project
party, not directly to an individual user or a global profile classification.

## 8. RLS boundary during P0-02

The new tables use the new membership boundary:

- project members can read parties and memberships for their projects;
- project admins can create, update, and delete parties and memberships;
- organization records are readable by their creator or through a party on a
  project the user belongs to, while organization writes remain creator-owned.

The helper functions bind project identity lookups to `auth.uid()` and run as
`SECURITY DEFINER` to avoid recursive membership RLS. Cross-project party,
membership, and requirement links are rejected by database constraints or
triggers. Project identity on parties and memberships is immutable after
creation.

## 9. What changes in P0-03

P0-03 will be the explicit authorization cutover. It can replace business-table
RLS helpers and the UI `can` map with rules based on `party_type`,
`project_role`, and `is_project_admin`, after each workflow's authority matrix
is reviewed. The P0-02 store exposes `currentProjectMembership` to support that
work, but it does not use the new fields to grant or remove workflow authority.

## 10. Non-goals

P0-02 does not:

- deploy a Supabase migration;
- remove legacy identity columns, tables, helpers, or policies;
- redesign the member-management UI;
- infer organizations with fuzzy name matching;
- treat technical administration as a contractual role;
- change workflow approval, submission, or visibility rules;
- begin P0-03 or any later architecture phase.
