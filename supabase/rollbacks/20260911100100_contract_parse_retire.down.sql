-- Roll back 20260911100100 (contract.parse platform kill switch) by re-enabling
-- the feature row. Run through SQL Editor / psql as database owner.
-- Data policy: the ai_features row and all ai_usage_events history were never
-- deleted, so nothing needs restoring beyond the flag.
-- Caveat: re-enabling lets any project member call parse-contract again and
-- produce obligations outside the requirements authority (D-012); also flip
-- defaultEnabled back to true in src/lib/aiFeatures.js and
-- supabase/functions/_shared/aiFeatures.ts or aiFeatures.test.js goes red.
begin;

update public.ai_features
   set enabled = true, updated_at = now()
 where key = 'contract.parse';

commit;
