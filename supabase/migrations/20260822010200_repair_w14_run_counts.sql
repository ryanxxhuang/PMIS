-- W14 一次性資料修正:2026-08-22 上午那條跨三次部署的抽取 run,顯示計數器
-- 在部署交界被斷點重置(批 2-4 完成時 cum 沒接上),最終回報「找到 28 項」
-- 但實際落庫 103 條建議。建議資料本身正確且互不重複(標籤覆蓋不重疊),
-- 只有 run 上的統計欄位與訊息少算——按實際列數重算,冪等(重算=同值)。
with r as (
  select ir.id,
    count(q.id) as total,
    count(*) filter (where q.status = 'draft_ai') as verified,
    count(*) filter (where q.status = 'needs_review') as needs_review
  from public.document_ingestion_runs ir
  join public.requirements q on q.ingestion_run_id = ir.id
  where ir.status = 'completed'
    and ir.extracted_requirement_count is distinct from (
      select count(*) from public.requirements q2 where q2.ingestion_run_id = ir.id)
  group by ir.id
)
update public.document_ingestion_runs ir
set extracted_requirement_count = r.total,
    verified_source_count = r.verified,
    unverified_source_count = r.needs_review
from r where ir.id = r.id;

-- 文件清單上那句「找到 N 項契約重點建議」同步重寫(只動數字開頭的既有訊息)
update public.document_processing_runs pr
set metadata = jsonb_set(pr.metadata, '{requirement_extraction_message}',
  to_jsonb('找到 ' || ir.extracted_requirement_count || ' 項契約重點建議'))
from public.document_ingestion_runs ir
where ir.document_version_id = pr.document_version_id
  and ir.status = 'completed'
  and pr.metadata->>'requirement_extraction' = 'completed'
  and pr.metadata->>'requirement_extraction_message' like '找到 %項契約重點建議'
  and pr.metadata->>'requirement_extraction_message'
      is distinct from ('找到 ' || ir.extracted_requirement_count || ' 項契約重點建議');
