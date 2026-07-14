-- Migration: 修正 contract-documents storage policy 衝突(Codex UX/AI 報告 P0-08)。
--
-- 前端 storagePathFor 產生的物件路徑為
--   projects/{projectId}/contract-packages/{packageId}/{documentId}/{versionId}/{filename}
-- (首段是「字面字串 projects」,見 src/lib/packageUpload.js + packageUpload.test.js)。
--
-- 正確的 package 級 policy 已存在(20260712000800 前段):
--   contract_documents_select / contract_documents_insert,用 foldername[4]=packageId
--   搭配 can_read_contract_package / can_upload_contract_package —— 與上述路徑相符。
--
-- 但同檔「[批5補齊]」段又補了一組 contract_documents_objects_select/insert,
-- 誤以為路徑首段=project_id,用 foldername[1]::uuid。實際首段是字面 'projects',
-- 於是 'projects'::uuid 直接拋 "invalid input syntax for type uuid: projects",
-- 讓「新專案上傳契約」整條流程(→抽履約需求→後續 AI grounding)第一步就被擋死。
--
-- 修法:移除這組錯誤的 [1] 級 policy,只留正確的 [4]=packageId 版本(select/insert 皆已具備)。
drop policy if exists "contract_documents_objects_select" on storage.objects;
drop policy if exists "contract_documents_objects_insert" on storage.objects;
