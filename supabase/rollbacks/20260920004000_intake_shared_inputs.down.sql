-- Roll back 20260920004000 (P3e: batch shared inputs — set_intake_shared_input／list_intake_shared_inputs and the
-- shared-key catalog helpers).
--
-- Data policy: nothing is deleted. Human versions written through set_intake_shared_input stay (field_document_versions
-- is immutable; they are ordinary human versions whose field_sources say source 'shared:<key>'). photo_intakes.
-- shared_inputs keeps its values (the column belongs to P2a 20260917201000); without the RPC nothing writes it anymore.
-- Edge draft-field-documents never reads shared inputs, so no Edge redeploy is needed. Revert the frontend (the batch
-- page's shared-input panel calls these two RPCs) together with this rollback.
-- Also remove supabase/tests/intake_shared_inputs.sql and revert the P3e edits in
-- supabase/tests/anon_and_function_privileges.sql (allow-list), otherwise pgTAP goes red. Run through SQL Editor / psql as owner.
begin;

drop function if exists public.list_intake_shared_inputs(uuid);
drop function if exists public.set_intake_shared_input(uuid, text, jsonb);
drop function if exists public.fn_intake_documents(public.photo_intakes);
drop function if exists public.fn_field_document_apply_shared_inputs(text, date, jsonb, jsonb, jsonb);
drop function if exists public.fn_field_document_shared_effect(jsonb, jsonb, text, jsonb);
drop function if exists public.fn_field_document_shared_keys(text, date, jsonb);
drop function if exists public.fn_intake_shared_value(text, jsonb);
drop function if exists public.fn_intake_shared_field_label(text);
drop function if exists public.fn_intake_shared_key_parts(text);

commit;
