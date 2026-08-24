-- 看上傳的檔案:文件原始檔「讀取」留痕 RPC。
--
-- 文件生命週期的其他動作(上傳/ingestion/分類/改分類/刪除)都由 row-change
-- trigger 在同交易寫 audit_events;唯獨預覽/下載不改任何列,結構上掛不了
-- trigger——若不補,原始檔讀取會是全生命週期唯一零留痕的動作。
-- 依工程會「各類資訊(服務)採購之共通性資通安全基本要求參考一覽表」
-- (SaaS 套裝型.普級)「事件日誌保存與可歸責性」:日誌應含帳號、時間、
-- IP 位址與「資料存取」。簽名 URL 的實際 GET 是匿名 bearer 無從歸責,
-- 故由前端在簽名/下載前呼叫本 RPC 落一筆(帳號/身分/IP 由
-- record_audit_event 與 current_request_ip 在伺服器端解析,不收前端傳參)。
--
-- 權限與 storage 讀取政策同一套(can_read_contract_package):不多開也不少擋;
-- 無權限者在這裡就被擋下,不會留下「無權限者的存取紀錄」的假象。
create or replace function public.log_document_access(
  p_document_version uuid,
  p_action text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
  v_package uuid;
  v_document uuid;
begin
  if p_action not in ('preview', 'download') then
    raise exception '不支援的文件存取動作';
  end if;

  select d.project_id, d.contract_package_id, d.id
    into v_project, v_package, v_document
    from public.document_versions dv
    join public.documents d on d.id = dv.document_id
   where dv.id = p_document_version;

  if v_document is null then
    raise exception '找不到文件版本';
  end if;

  -- 契約包外的文件(目前不存在此路徑)一律 fail-closed
  if v_package is null or not public.can_read_contract_package(v_package) then
    raise exception '無權限存取此契約包的文件';
  end if;

  perform public.record_audit_event(v_project, 'document.file_accessed',
    'document_version', p_document_version, p_action,
    null, null,
    jsonb_build_object('document_id', v_document, 'contract_package_id', v_package),
    null);
end; $$;

revoke all on function public.log_document_access(uuid, text) from public, anon;
grant execute on function public.log_document_access(uuid, text) to authenticated;
