-- W14:文件刪除——單一守門路徑(RPC),不開 documents 的 RLS DELETE。
-- ---------------------------------------------------------------------------
-- 設計:
-- * 刪除只走 delete_document RPC(security definer):文件管理權限+契約包
--   存取檢查;documents 不加 DELETE policy,前端繞不過守門。
-- * 佐證鏈護欄:requirement_sources → document_versions 本來就是 RESTRICT。
--   RPC 先清掉「未審的 AI 建議」(draft_ai/needs_review、origin='ai',連同
--   cascade 的 sources/links),之後若仍有引用(已核定/退回/人工建立)則
--   FK 擋下 → 轉成看得懂的錯誤。核定過的契約重點永遠拉得回它的出處文件。
-- * 留痕:BEFORE DELETE trigger 寫 audit_events(document.deleted,before 快照);
--   專案還在,事件列不會消失(與 project_deletion_records 的顧慮不同)。
-- * Storage:RPC 回傳該文件所有版本的 storage 路徑,前端用新開的 DELETE policy
--   移除原始檔(路徑第 4 段=契約包 id,沿用 can_upload_contract_package 判權;
--   storage 物件刪除必須走 Storage API,SQL 刪 storage.objects 列會留孤兒檔案)。

-- ── 放行文件刪除的 cascade(W14 審查修正)──────────────────────────────────
-- guard_ingestion_run_write 原本只放行「父專案已刪」的 cascade;文件刪除的
-- cascade(documents → versions → runs)會被它以 'system-managed' 擋下,
-- 導致任何抽取過的文件都刪不掉。沿用已驗證的 parent-row-gone 模式:
-- run 的 BEFORE DELETE 觸發時,所屬 version 列已先被 cascade 刪掉 → 放行;
-- 使用者直接刪 run(version 仍在)照舊被擋。
create or replace function public.guard_ingestion_run_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- [批4加固] 專案刪除 cascade 放行(父專案列已先刪)
  -- [W14] 文件刪除 cascade 放行(所屬文件版本列已先刪);直接寫入仍受管制
  if tg_op in ('UPDATE','DELETE') and (
    not exists (select 1 from public.projects pr where pr.id = old.project_id)
    or not exists (select 1 from public.document_versions dv where dv.id = old.document_version_id)
  ) then
    return coalesce(new, old);
  end if;
  if auth.uid() is not null then
    raise exception 'document ingestion runs are system-managed';
  end if;
  return coalesce(new, old);
end; $$;

-- ── 刪除留痕 ────────────────────────────────────────────────────────────────
create or replace function public.audit_document_delete_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit_event(old.project_id, 'document.deleted',
    'document', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
  return old;
end; $$;
revoke all on function public.audit_document_delete_event() from public, anon, authenticated;

drop trigger if exists documents_audit_delete_event on public.documents;
create trigger documents_audit_delete_event
  before delete on public.documents
  for each row execute function public.audit_document_delete_event();

-- ── 守門刪除 RPC ────────────────────────────────────────────────────────────
create or replace function public.delete_document(p_document uuid)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_doc record;
  v_paths text[];
begin
  select * into v_doc from public.documents where id = p_document for update;
  if not found then
    raise exception '找不到文件或無權限';
  end if;
  -- 掛在契約包下的文件要同時過包存取檢查(monopoly:can_upload=可管理+可存取)
  if v_doc.contract_package_id is not null then
    if not public.can_upload_contract_package(v_doc.contract_package_id) then
      raise exception '無文件管理權限,不可刪除文件';
    end if;
  elsif not public.can_manage_documents(v_doc.project_id) then
    raise exception '無文件管理權限,不可刪除文件';
  end if;

  select coalesce(array_agg(storage_path), '{}') into v_paths
  from public.document_versions
  where document_id = p_document and storage_path is not null;

  -- 未審的 AI 建議跟著文件走(cascade 清 sources/links);已審的留下讓 FK 擋
  delete from public.requirements r
  using public.requirement_sources s, public.document_versions v
  where s.requirement_id = r.id
    and s.document_version_id = v.id
    and v.document_id = p_document
    and r.origin = 'ai'
    and r.status in ('draft_ai', 'needs_review');

  begin
    delete from public.documents where id = p_document;
  exception when foreign_key_violation then
    raise exception '已有審查過的契約重點引用此文件;為保留佐證鏈,不可刪除(可改分類或上傳新版取代)';
  end;

  return v_paths;
end; $$;
revoke all on function public.delete_document(uuid) from public, anon;
grant execute on function public.delete_document(uuid) to authenticated;

-- ── Storage 原始檔刪除(僅 contract-documents;判權沿用上傳)─────────────────
-- 只准清「孤兒檔」:仍被任何 document_versions.storage_path 引用的活檔一律不可
-- 由 Storage API 直接刪——否則佐證鏈護欄(RPC 擋刪)可被旁路掏空原始檔。
-- 合法流程是 RPC 先刪 DB 列(引用消失)→ 前端再清 storage,不受影響。
-- helper 走 security definer:policy 在呼叫者的 RLS 下看不見別案版本列,
-- 直接寫 exists 子查詢會誤判成孤兒。
create or replace function public.storage_path_in_use(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.document_versions v where v.storage_path = p_name)
$$;
revoke all on function public.storage_path_in_use(text) from public, anon;
grant execute on function public.storage_path_in_use(text) to authenticated;

drop policy if exists contract_documents_delete on storage.objects;
create policy contract_documents_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'contract-documents'
    and public.can_upload_contract_package(((storage.foldername(name))[4])::uuid)
    and not public.storage_path_in_use(name)
  );
