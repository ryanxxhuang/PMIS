-- Roll back 20260919003000 (H2/H3: anon table/sequence privileges, PUBLIC/anon function
-- EXECUTE, explicit authenticated allowlist, and the default-privilege changes).
-- Run through SQL Editor / psql as database owner (postgres) in one transaction.
-- Data policy: the forward migration touched ACLs only; no rows, columns, indexes,
-- policies or triggers change in either direction.
-- Restores the shape read from production on 2026-09-17/19 (read-only snapshots):
--   * anon had SELECT/INSERT/UPDATE/DELETE on every postgres-owned public relation except the
--     tables whose own migrations had already narrowed it (listed below); anon had
--     SELECT/USAGE/UPDATE on ai_usage_events_id_seq and nothing on demo_requests_id_seq.
--   * 66 functions carried the built-in PUBLIC EXECUTE, 72 were executable by anon and 126 by
--     authenticated (the per-function list below reproduces exactly that ACL); service_role
--     already had EXECUTE on every function, so the forward file's service_role grant was a
--     no-op in production and nothing is revoked from it here.
--   * pg_default_acl for postgres/public gave anon arwd on tables, rwU on sequences, and
--     anon/authenticated/service_role X on functions; there was no global entry (so the
--     built-in PUBLIC EXECUTE applied) and no entry for the extensions schema.
-- Nothing in the product depends on any of the re-opened privileges (see the forward file's
-- inventory), so this file exists for exact reversibility only.
begin;

-- ── tables / views: anon DML ────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as rel, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
      and pg_get_userbyid(c.relowner) = 'postgres'
      and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  loop
    -- no anon privileges at all before H2
    if r.relname in ('demo_requests', 'field_document_signatures', 'field_document_submissions',
                     'field_document_versions', 'field_documents', 'obligation_periods', 'photo_intakes',
                     'platform_admin_bootstrap', 'supervisor_logs') then
      continue;
    -- SELECT only (append-only / platform tables whose migrations revoked writes)
    elsif r.relname in ('agent_actions', 'ai_features', 'ai_model_pricing', 'ai_usage_events',
                        'audit_events', 'cost_items', 'defect_audits', 'document_ingestion_runs',
                        'project_ai_overrides', 'project_deletion_records') then
      execute format('grant select on %s to anon', r.rel);
    elsif r.relname = 'photos' then
      execute format('grant select, delete on %s to anon', r.rel);
    elsif r.relname = 'profiles' then
      execute format('grant insert, update, delete on %s to anon', r.rel);
    else
      execute format('grant select, insert, update, delete on %s to anon', r.rel);
    end if;
  end loop;
end $$;

-- ── sequences ───────────────────────────────────────────────────────────────────────
grant select, usage, update on sequence public.ai_usage_events_id_seq to anon;

-- ── default privileges ──────────────────────────────────────────────────────────────
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon;
alter default privileges for role postgres in schema public
  grant select, usage, update on sequences to anon;
alter default privileges for role postgres in schema public
  grant execute on routines to anon, authenticated, service_role;
-- back to the built-in default (PUBLIC EXECUTE): the global row disappears when it equals it
alter default privileges for role postgres
  grant execute on routines to public;
-- drop the compensating extensions-schema row
alter default privileges for role postgres in schema extensions
  revoke execute on routines from public;

-- ── functions: exact pre-H3 ACL for PUBLIC / anon / authenticated ──────────────────
revoke execute on all routines in schema public from public, anon, authenticated;
grant execute on function public.acceptance_events_audit() to public, anon, authenticated;
grant execute on function public.acceptance_events_guard() to public, anon, authenticated;
grant execute on function public.acceptance_stage_allowed(p_stage text, p_org text) to public, anon, authenticated;
grant execute on function public.acceptance_stage_owner_desc(p_stage text) to public, anon, authenticated;
grant execute on function public.add_creator_as_member() to public, anon, authenticated;
grant execute on function public.add_member_by_email(p_project uuid, p_email text, p_role text, p_expected_org text) to authenticated;
grant execute on function public.admin_ai_usage_by_feature(p_from timestamp with time zone, p_to timestamp with time zone) to authenticated;
grant execute on function public.admin_ai_usage_by_project(p_from timestamp with time zone, p_to timestamp with time zone) to authenticated;
grant execute on function public.admin_ai_usage_by_user(p_from timestamp with time zone, p_to timestamp with time zone) to authenticated;
grant execute on function public.admin_ai_usage_daily(p_from timestamp with time zone, p_to timestamp with time zone) to authenticated;
grant execute on function public.admin_ai_usage_overview(p_from timestamp with time zone, p_to timestamp with time zone) to authenticated;
grant execute on function public.admin_list_projects_for_ai() to authenticated;
grant execute on function public.admin_override(p uuid) to authenticated;
grant execute on function public.admin_set_feature_enabled(p_key text, p_enabled boolean) to authenticated;
grant execute on function public.admin_set_feature_min_plan(p_key text, p_min_plan text) to authenticated;
grant execute on function public.admin_set_project_override(p_project uuid, p_key text, p_enabled boolean) to authenticated;
grant execute on function public.admin_set_project_plan(p_project uuid, p_plan text) to authenticated;
grant execute on function public.ai_feature_allowed(p_project uuid, p_feature text) to authenticated;
grant execute on function public.can_access_contract_package(p_project uuid, p_type text, p_counterparty uuid) to authenticated;
grant execute on function public.can_access_contractor_private(p uuid) to public, anon, authenticated;
grant execute on function public.can_manage_documents(p uuid) to authenticated;
grant execute on function public.can_read_audit_entity(p_entity_type text, p_entity uuid) to authenticated;
grant execute on function public.can_read_contract_package(p_package uuid) to authenticated;
grant execute on function public.can_read_document_version(p_version uuid) to authenticated;
grant execute on function public.can_read_field_document(p_document uuid) to authenticated;
grant execute on function public.can_read_project_document(p_project uuid, p_package uuid) to authenticated;
grant execute on function public.can_read_requirement_provenance(p_run uuid) to authenticated;
grant execute on function public.can_read_requirement_row(p_requirement uuid) to authenticated;
grant execute on function public.can_read_requirement_scope(p_run uuid, p_package uuid) to authenticated;
grant execute on function public.can_review_requirement(p uuid) to authenticated;
grant execute on function public.can_upload_contract_package(p_package uuid) to authenticated;
grant execute on function public.can_write(p uuid) to public, anon, authenticated;
grant execute on function public.can_write_document(p_document uuid) to authenticated;
grant execute on function public.can_write_document_version(p_version uuid) to authenticated;
grant execute on function public.can_write_project_document(p_project uuid, p_package uuid) to authenticated;
grant execute on function public.change_order_items_guard() to public, anon, authenticated;
grant execute on function public.change_orders_guard() to public, anon, authenticated;
grant execute on function public.checklist_records_guard() to public, anon, authenticated;
grant execute on function public.create_project(p_name text, p_code text, p_owner text, p_contractor text, p_supervisor text, p_location text, p_start date, p_end date) to public, anon, authenticated;
grant execute on function public.date_in_text(d date, t text) to authenticated;
grant execute on function public.defects_audit() to public, anon, authenticated;
grant execute on function public.defects_guard() to public, anon, authenticated;
grant execute on function public.delete_document(p_document uuid) to authenticated;
grant execute on function public.delete_legacy_requirement_root() to public, anon, authenticated;
grant execute on function public.delete_project(p_id uuid) to public, anon, authenticated;
grant execute on function public.ensure_project_identity(p uuid) to authenticated;
grant execute on function public.evidence_delete_bypass(p_project uuid) to authenticated;
grant execute on function public.fn_field_document_owner_org(p_doc_type text) to authenticated;
grant execute on function public.fn_field_document_target_table(p_doc_type text) to authenticated;
grant execute on function public.fn_field_document_template(p_doc_type text) to authenticated;
grant execute on function public.guard_document_version_file_identity() to public, anon, authenticated;
grant execute on function public.guard_last_project_admin() to public, anon, authenticated;
grant execute on function public.guard_project_identity() to public, anon, authenticated;
grant execute on function public.guard_requirement_ingestion_provenance() to public, anon, authenticated;
grant execute on function public.guard_requirement_package() to public, anon, authenticated;
grant execute on function public.handle_new_user() to public, anon, authenticated;
grant execute on function public.import_work_items(p_project_id uuid, p_items jsonb) to authenticated;
grant execute on function public.inspections_delete_guard() to public, anon, authenticated;
grant execute on function public.inspections_guard() to public, anon, authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_project_admin(p uuid) to public, anon, authenticated;
grant execute on function public.is_project_admin_v2(p_project uuid) to anon, authenticated;
grant execute on function public.is_project_member(p uuid) to public, anon, authenticated;
grant execute on function public.is_project_member_v2(p_project uuid) to anon, authenticated;
grant execute on function public.judge_test_sample() to public, anon, authenticated;
grant execute on function public.list_project_members(p_project uuid) to public, anon, authenticated;
grant execute on function public.log_document_access(p_document_version uuid, p_action text) to authenticated;
grant execute on function public.materialize_obligation_periods(p_project uuid) to authenticated;
grant execute on function public.my_org_type() to public, anon, authenticated;
grant execute on function public.my_party() to public, anon, authenticated;
grant execute on function public.my_project_ids() to public, anon, authenticated;
grant execute on function public.my_project_ids_v2() to anon, authenticated;
grant execute on function public.my_project_membership(p_project uuid) to anon, authenticated;
grant execute on function public.my_project_party_type(p_project uuid) to anon, authenticated;
grant execute on function public.my_project_role(p_project uuid) to anon, authenticated;
grant execute on function public.normalize_agent_action_role() to public, anon, authenticated;
grant execute on function public.number_in_text(n integer, t text, p_suffix text) to authenticated;
grant execute on function public.obligation_party(r text) to public, anon, authenticated;
grant execute on function public.photo_storage_path_in_use(p_name text) to authenticated;
grant execute on function public.portfolio_summary() to public, anon, authenticated;
grant execute on function public.profiles_guard_platform_admin() to public, anon, authenticated;
grant execute on function public.projects_formal_mode_guard() to public, anon, authenticated;
grant execute on function public.receive_field_document(p_document_id uuid, p_version_no integer, p_client_request_id text) to authenticated;
grant execute on function public.remove_member(p_project uuid, p_user uuid) to public, anon, authenticated;
grant execute on function public.requirement_sources_snapshot_guard() to public, anon, authenticated;
grant execute on function public.requirements_snapshot_guard() to public, anon, authenticated;
grant execute on function public.reset_project_boq(p_project_id uuid) to authenticated;
grant execute on function public.resolve_agent_action(p_id uuid, p_status text) to authenticated;
grant execute on function public.return_field_document(p_document_id uuid, p_version_no integer, p_reason text, p_client_request_id text) to authenticated;
grant execute on function public.review_requirement(p_requirement_id uuid, p_decision text) to authenticated;
grant execute on function public.rfis_delete_guard() to public, anon, authenticated;
grant execute on function public.rfis_guard() to public, anon, authenticated;
grant execute on function public.safety_record_type_allowed(p_type text, p_org text) to public, anon, authenticated;
grant execute on function public.safety_records_audit() to public, anon, authenticated;
grant execute on function public.safety_records_guard() to public, anon, authenticated;
grant execute on function public.save_field_document_version(p_document_id uuid, p_base_version_no integer, p_content jsonb, p_field_sources jsonb, p_attachments jsonb, p_change_note text) to authenticated;
grant execute on function public.shares_project_with(target uuid) to authenticated;
grant execute on function public.sign_field_document(p_document_id uuid, p_version_no integer, p_content_hash text, p_intent text) to authenticated;
grant execute on function public.stamp_obligation_completion() to public, anon, authenticated;
grant execute on function public.storage_path_in_use(p_name text) to authenticated;
grant execute on function public.submit_field_document(p_document_id uuid, p_version_no integer, p_to_org text, p_client_request_id text) to authenticated;
grant execute on function public.submittals_delete_guard() to public, anon, authenticated;
grant execute on function public.submittals_guard() to public, anon, authenticated;
grant execute on function public.sync_requirement_work_item_review_state() to public, anon, authenticated;
grant execute on function public.test_sample_defect() to public, anon, authenticated;
grant execute on function public.test_samples_delete_guard() to public, anon, authenticated;
grant execute on function public.touch_document_updated_at() to public, anon, authenticated;
grant execute on function public.touch_project_identity_updated_at() to public, anon, authenticated;
grant execute on function public.touch_requirement_updated_at() to public, anon, authenticated;
grant execute on function public.transcription_doubts(p_requirement uuid) to authenticated;
grant execute on function public.transition_obligation_period(p_period uuid, p_status text, p_evidence_submittal_id uuid, p_evidence_document_id uuid) to authenticated;
grant execute on function public.upsert_contract_obligation_requirement() to public, anon, authenticated;
grant execute on function public.validate_contract_package_parties() to public, anon, authenticated;
grant execute on function public.validate_document_contract_package() to public, anon, authenticated;
grant execute on function public.validate_document_processing_run() to public, anon, authenticated;
grant execute on function public.validate_ingestion_run_document_version() to public, anon, authenticated;
grant execute on function public.validate_membership_project_party() to public, anon, authenticated;
grant execute on function public.validate_requirement_project_party() to public, anon, authenticated;
grant execute on function public.validate_requirement_source_project() to public, anon, authenticated;
grant execute on function public.validate_requirement_work_item_project() to public, anon, authenticated;
grant execute on function public.validate_superseded_document_version() to public, anon, authenticated;
grant execute on function public.valuation_items_guard() to public, anon, authenticated;
grant execute on function public.valuations_delete_guard() to public, anon, authenticated;
grant execute on function public.valuations_guard() to public, anon, authenticated;
grant execute on function public.valuations_payment_gate() to public, anon, authenticated;
grant execute on function public.zh_numeral(n integer) to authenticated;

commit;
