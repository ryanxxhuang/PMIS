-- P2d｜施工日誌存版／簽署／提送 RPC 與事實表 guard(D-026;設計 docs/architecture/field-documents-lifecycle.md §5–§7)。
--
-- 為什麼:P2a 把「RPC 以外的路徑都繞不過」的不變量釘在 trigger(版本不可變、雜湊只由 DB 算、簽署列
-- 只能由登入者寫、版本／雜湊／角色／成員／aal 一致性、提送對象矩陣、diff 由 DB 算)。但 authenticated
-- 對版本／簽署／提送表沒有任何寫入 grant、對 field_documents 沒有 UPDATE grant,所以「人」要存版本、簽署、
-- 提送、收件、退回,必須經 security definer 的窄門。本支只建這些窄門與它們專責的政策:
--   * aal2 政策:簽署方式本輪只有 platform_account_mfa,JWT aal 必須是 aal2,admin_override 也不放行。
--   * required_fields 完整性:必填鍵由伺服器推導(施工日誌固定欄＋內容裡每個工項的當日數量)並與
--     service／Edge 存的 required_fields 聯集;field_sources 缺鍵、pending、na 無 reason 一律視為待補,
--     待補不得簽署(客戶端把必填清空也裝不出可簽)。
--   * 附件角色隔離:施工日誌的施作證據(role=evidence,預設)必須是廠商上傳的照片;監造照片只能以
--     role=reference(「監造提供」註記)附上;上傳方未知的舊照片不能當證據。
--   * 事實表落庫:簽署版本的內容為準 upsert daily_logs(project_id, log_date)＋重寫 daily_log_items;
--     工項必須屬於本案、數量必須是非負數字;已簽署日誌的事實列由 daily_logs_guard／daily_log_items_guard
--     保護,只有簽署 RPC(交易內 GUC pmis.field_document_sign)可以重寫,舊路徑(saveSiteLog upsert、直接
--     REST、service)一律拒絕;未簽署的既有日誌仍可直接寫(P2c 改接前的相容範圍)。
--   * agent_actions:簽署時把指向本文件的 pending 草稿標 accepted(無人工版本)／edited(有人工版本),
--     resolved_by=簽署者,經 record_audit_event 留痕——這是 agent-tool-boundary「本人限定」的明示延伸。
--   * client_request_id 冪等:提送／收件／退回帶同一 client_request_id 重試回同一張回執,不重複建列;
--     同 id 換內容(版本／動作／對象／人)則拒絕。簽署以 (document, version, signer) 自然鍵冪等。
--
-- 錯誤代碼(SQLSTATE,前端以 error.code 辨識;message 為使用者可讀繁中,detail 為機器可讀 JSON):
--   PD001 畫面是舊版(版本號不是目前版本／基準版本不符)    PD006 無權(未登入／非成員／非責任方／非提送對象)
--   PD002 內容雜湊與伺服器版本不符                          PD007 此文件類型尚未支援(本支只實作 daily_log)
--   PD003 需要兩步驟驗證(JWT aal 非 aal2)→ 前端引導 MFA    PD008 目前狀態不允許此動作
--   PD004 必填欄位待補(detail=[{key,status}])               PD009 client_request_id 已用於不同請求(冪等衝突)
--   PD005 附件證據不符角色隔離(detail=[{key,status}])       PD010 輸入不合法(內容形狀、工項、數量、對象、原因)
--   P2a 的 trigger 仍是所有路徑的最後防線(P0001);RPC 先以上述代碼拒絕,trigger 是備援不是重複實作。
--
-- 只支援 daily_log:其他 doc_type 的簽署明確回 PD007(尚未支援),不會默默通過;save／submit／receive／return
--   與類型無關,四類共用。supervisor_log(P3a)、self_check(P3b)、inspection_form(P3c)各自加簽署分支。
-- 索引調整:field_documents_target_uidx 改為只算活文件(排除 discarded／superseded)——對方收件後只能
--   superseded 另立新文件,新文件簽署時要綁同一列事實列,舊索引會讓它永遠綁不上。
-- 資料保留:不動任何既有列;既有 12 筆 daily_logs 沒有簽署文件指向,guard 不影響其直接寫入。
-- 相容:舊前端 saveSiteLog 對未簽署日期照常;對已簽署日期會收到 P0001 明確訊息(不是靜默改寫)。
-- 回復:supabase/rollbacks/20260917205000_field_document_rpcs.down.sql(drop 兩支 guard、八支函式、還原索引;
--   已簽署文件所落的 daily_logs 列保留,只是失去保護)。

-- ── 0. 純函式:必填鍵推導與待補判定(save 與 sign 共用同一份實作) ─────────────────
-- 必填鍵=stored(service／Edge／範本推導)∪ 類型固定欄 ∪ 內容裡每個工項的當日數量。
-- 施工日誌固定欄:天氣上下午、施工概況、出工、機具、材料(可用 na＋reason 表示「本日無」,不得留空)。
-- 工項數量鍵 items.<work_item_id>.qty_today 永遠只從「本版內容」推導:save 會把有效必填鍵寫回
-- field_documents.required_fields,若下次再把 stored 的工項鍵聯集回來,已從內容移除的工項會永遠卡住
-- (簽署一律 PD004),所以 stored 裡的工項鍵一律忽略、由內容重算。
-- 其他類型在 P3 各自補固定欄;這裡只回 stored,簽署分支尚未支援所以不會誤放行。
create or replace function public.fn_field_document_required_fields(p_doc_type text, p_content jsonb, p_stored jsonb)
returns jsonb language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
  from (
    select distinct k from (
      select stored.k
        from jsonb_array_elements_text(
               case when jsonb_typeof(p_stored) = 'array' then p_stored else '[]'::jsonb end) as stored(k)
       where not (p_doc_type = 'daily_log' and stored.k like 'items.%.qty_today')
      union all
      select unnest(case when p_doc_type = 'daily_log'
        then array['weather_am','weather_pm','work_summary','labor','equipment','materials']
        else '{}'::text[] end)
      union all
      select 'items.' || key || '.qty_today'
        from jsonb_object_keys(case when p_doc_type = 'daily_log' and jsonb_typeof(p_content -> 'items') = 'object'
                                    then p_content -> 'items' else '{}'::jsonb end) as key
    ) s
    where k is not null and btrim(k) <> ''
  ) d;
$fn$;
revoke all on function public.fn_field_document_required_fields(text, jsonb, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_required_fields(text, jsonb, jsonb) is
  'P2d:必填鍵=stored ∪ 類型固定欄 ∪ 內容各工項 items.<id>.qty_today;daily_log 固定欄 weather_am/pm、work_summary、labor、equipment、materials。';

-- 待補判定:必填鍵在 field_sources 缺鍵=missing、pending、na 無 reason、未知狀態 → 一律待補;
-- filled(已帶入待核對)／confirmed(人已確認或人填)／na＋reason → 可簽。
create or replace function public.fn_field_document_unmet_fields(p_required jsonb, p_field_sources jsonb)
returns jsonb language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('key', k, 'status', st) order by k), '[]'::jsonb)
  from (
    select r.k,
      case
        when src is null or jsonb_typeof(src) <> 'object' then 'missing'
        when src ->> 'status' in ('filled', 'confirmed') then null
        when src ->> 'status' = 'na'
             and nullif(btrim(coalesce(src ->> 'reason', '')), '') is not null then null
        when src ->> 'status' = 'na' then 'na_without_reason'
        when src ->> 'status' = 'pending' then 'pending'
        else 'unknown_status'
      end as st
    from jsonb_array_elements_text(case when jsonb_typeof(p_required) = 'array' then p_required else '[]'::jsonb end) r(k)
    cross join lateral (select (case when jsonb_typeof(p_field_sources) = 'object' then p_field_sources else '{}'::jsonb end) -> r.k as src) s
  ) t
  where st is not null;
$fn$;
revoke all on function public.fn_field_document_unmet_fields(jsonb, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_unmet_fields(jsonb, jsonb) is
  'P2d:必填鍵的待補清單 [{key,status}];status=missing/pending/na_without_reason/unknown_status。';

-- 附件角色隔離(設計 §3.4):role=evidence(預設)的照片上傳方必須等於文件責任方;role=reference 只作註記
-- (施工日誌的「監造提供」、監造文件的「廠商提供之施工照片」),任何上傳方皆可;上傳方未知不能當證據。
-- 讀 photos,所以不是 IMMUTABLE;只在 security definer RPC 內呼叫,不開給 authenticated。
create or replace function public.fn_field_document_attachment_issues(p_doc_type text, p_project_id uuid, p_attachments jsonb)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_att    jsonb;
  v_role   text;
  v_pid    uuid;
  v_photo  record;
  v_owner  text := public.fn_field_document_owner_org(p_doc_type);
  v_issues jsonb := '[]'::jsonb;
begin
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    return v_issues;
  end if;
  for v_att in select value from jsonb_array_elements(p_attachments) loop
    if jsonb_typeof(v_att) <> 'object' or (v_att ->> 'photo_id') is null then
      v_issues := v_issues || jsonb_build_object('key', 'attachments', 'status', 'invalid');
      continue;
    end if;
    begin
      v_pid := (v_att ->> 'photo_id')::uuid;
    exception when others then
      v_issues := v_issues || jsonb_build_object('key', 'attachments', 'status', 'invalid');
      continue;
    end;
    v_role := coalesce(nullif(btrim(v_att ->> 'role'), ''), 'evidence');
    if v_role not in ('evidence', 'reference') then
      v_issues := v_issues || jsonb_build_object('key', 'attachments.' || v_pid::text, 'status', 'invalid_role');
      continue;
    end if;
    select p.project_id, p.uploader_org into v_photo from public.photos p where p.id = v_pid;
    if not found or v_photo.project_id <> p_project_id then
      v_issues := v_issues || jsonb_build_object('key', 'attachments.' || v_pid::text, 'status', 'not_found');
      continue;
    end if;
    if v_role = 'evidence' then
      if v_photo.uploader_org is null then
        v_issues := v_issues || jsonb_build_object('key', 'attachments.' || v_pid::text, 'status', 'uploader_unknown');
      elsif v_photo.uploader_org <> v_owner then
        v_issues := v_issues || jsonb_build_object('key', 'attachments.' || v_pid::text,
          'status', 'uploader_org:' || v_photo.uploader_org);
      end if;
    end if;
  end loop;
  return v_issues;
end; $$;
revoke all on function public.fn_field_document_attachment_issues(text, uuid, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_attachment_issues(text, uuid, jsonb) is
  'P2d:附件角色隔離問題清單 [{key,status}];evidence 須由文件責任方上傳,reference 只作註記。';

-- ── 1. 事實列綁定索引:只算活文件 ───────────────────────────────────────────────
drop index if exists public.field_documents_target_uidx;
create unique index if not exists field_documents_target_uidx
  on public.field_documents(doc_type, target_id)
  where target_id is not null and status not in ('discarded', 'superseded');

-- ── 2. 事實表 guard:已簽署施工日誌的事實列只有簽署 RPC 可重寫 ──────────────────
-- 「已簽署」=有 daily_log 文件綁定此列且該文件有任何簽署列(簽後更正回草稿仍受保護:事實列裡是舊簽署版本)。
-- 放行條件:專案刪除 cascade;或交易內 GUC pmis.field_document_sign 指向「同案同日」的 daily_log 文件
-- (用專案＋日期而非 target_id 比對:對方收件後 superseded 的舊文件仍綁著此列,接手的新文件在首次簽署時
-- 尚未綁定)。DELETE 無論如何不放行(RPC 從不刪事實列)。
create or replace function public.fn_daily_log_signed(p_log_id uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from public.field_documents d
    join public.field_document_signatures s on s.document_id = d.id
    where d.doc_type = 'daily_log' and d.target_id = p_log_id
  );
$$;
revoke all on function public.fn_daily_log_signed(uuid) from public, anon, authenticated;

create or replace function public.fn_daily_log_sign_bypass(p_project_id uuid, p_log_date date)
returns boolean language plpgsql stable security invoker set search_path = public as $$
declare v_doc uuid;
begin
  begin
    v_doc := nullif(current_setting('pmis.field_document_sign', true), '')::uuid;
  exception when others then
    return false;
  end;
  if v_doc is null then
    return false;
  end if;
  return exists (
    select 1 from public.field_documents d
    where d.id = v_doc and d.doc_type = 'daily_log'
      and d.project_id = p_project_id and d.doc_date = p_log_date
  );
end; $$;
revoke all on function public.fn_daily_log_sign_bypass(uuid, date) from public, anon, authenticated;

create or replace function public.daily_logs_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);  -- 專案刪除 cascade
  end if;
  if not public.fn_daily_log_signed(old.id) then
    return coalesce(new, old);  -- 未簽署的日誌:既有直接寫入路徑照常(P2c 改接前的相容範圍)
  end if;
  if tg_op = 'UPDATE' and public.fn_daily_log_sign_bypass(old.project_id, old.log_date) then
    if new.id <> old.id or new.project_id <> old.project_id or new.log_date <> old.log_date then
      raise exception '已簽署施工日誌的專案／日期不可變更';
    end if;
    return new;
  end if;
  raise exception '% 的施工日誌已有簽署文件,不可直接%;更正請在該文件建立新版本並重新簽署',
    old.log_date, case tg_op when 'DELETE' then '刪除' else '修改' end;
end; $$;
revoke all on function public.daily_logs_guard() from public, anon, authenticated;
drop trigger if exists daily_logs_guard on public.daily_logs;
create trigger daily_logs_guard before update or delete on public.daily_logs
  for each row execute function public.daily_logs_guard();

create or replace function public.daily_log_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_log_id uuid;
  v_log    record;
begin
  -- UPDATE 改掛到別的日誌:新舊兩邊都要檢查
  for v_log_id in select distinct x from unnest(array[
      case when tg_op in ('UPDATE','DELETE') then old.daily_log_id end,
      case when tg_op in ('INSERT','UPDATE') then new.daily_log_id end]) as t(x)
    where x is not null loop
    select l.project_id, l.log_date into v_log from public.daily_logs l where l.id = v_log_id;
    if not found then
      continue;  -- 父列已消失=日誌／專案刪除 cascade
    end if;
    if not exists (select 1 from public.projects pr where pr.id = v_log.project_id) then
      continue;
    end if;
    if public.fn_daily_log_signed(v_log_id)
       and not public.fn_daily_log_sign_bypass(v_log.project_id, v_log.log_date) then
      raise exception '% 的施工日誌已有簽署文件,其工項數量不可直接%;更正請在該文件建立新版本並重新簽署',
        v_log.log_date, case tg_op when 'INSERT' then '新增' when 'DELETE' then '刪除' else '修改' end;
    end if;
  end loop;
  return coalesce(new, old);
end; $$;
revoke all on function public.daily_log_items_guard() from public, anon, authenticated;
drop trigger if exists daily_log_items_guard on public.daily_log_items;
create trigger daily_log_items_guard before insert or update or delete on public.daily_log_items
  for each row execute function public.daily_log_items_guard();

-- ── 3. agent_actions 內部處理(只由簽署 RPC 呼叫;authenticated 不可執行) ─────────
-- 指向本文件的 pending 草稿由簽署者處理:accepted(文件沒有人工版本)／edited(有人工版本)。
-- 與 resolve_agent_action 的差別:不限本人(簽署者可能不是草稿收件人),但同樣只動 pending、留同一種稽核事件。
create or replace function public.resolve_agent_action_internal(p_document_id uuid, p_project_id uuid, p_status text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_before public.agent_actions;
  v_after  public.agent_actions;
  v_n      int := 0;
begin
  if auth.uid() is null then
    raise exception '草稿處理必須由登入使用者執行';
  end if;
  if p_status not in ('accepted', 'edited') then
    raise exception '不合法的處理狀態,僅接受 accepted/edited';
  end if;
  for v_before in
    select * from public.agent_actions a
    where a.project_id = p_project_id and a.target_table = 'field_documents'
      and a.target_id = p_document_id and a.status = 'pending'
    order by a.created_at
    for update
  loop
    update public.agent_actions
       set status = p_status, resolved_by = auth.uid(), resolved_at = now()
     where id = v_before.id
     returning * into v_after;
    perform public.record_audit_event(
      v_after.project_id, 'agent_action_resolved', 'agent_action', v_after.id, p_status,
      to_jsonb(v_before), to_jsonb(v_after),
      jsonb_build_object('kind', v_after.kind, 'agent_role', v_after.agent_role,
                         'resolved_via', 'sign_field_document', 'document_id', p_document_id),
      null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
revoke all on function public.resolve_agent_action_internal(uuid, uuid, text) from public, anon, authenticated;

-- ── 4. save_field_document_version:人工版本(四類共用) ─────────────────────────
-- 前端存檔=伺服器保存(設計 §3.3);base 版本號=畫面載入時的 current_version_no(樂觀併發)。
-- 簽後更正:signed／submitted／returned 建立版本 n+1(amended_from_version=n),狀態回草稿,舊簽署列與舊提送列不動。
-- 必填鍵與待補清單在此重算並寫回文件(required_fields／recheck),狀態依待補自動在 draft／pending_input 間切換。
create or replace function public.save_field_document_version(
  p_document_id uuid, p_base_version_no int, p_content jsonb,
  p_field_sources jsonb default '{}'::jsonb, p_attachments jsonb default null, p_change_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid        uuid := auth.uid();
  v_doc      public.field_documents%rowtype;
  v_ver      public.field_document_versions%rowtype;
  v_required jsonb;
  v_recheck  jsonb;
  v_amended  int;
begin
  if uid is null then
    raise exception using errcode = 'PD006', message = '請先登入後再保存文件';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception using errcode = 'PD010', message = '文件內容必須是 JSON 物件';
  end if;
  if p_field_sources is not null and jsonb_typeof(p_field_sources) <> 'object' then
    raise exception using errcode = 'PD010', message = '欄位來源(field_sources)必須是 JSON 物件';
  end if;
  if p_attachments is not null and jsonb_typeof(p_attachments) <> 'array' then
    raise exception using errcode = 'PD010', message = '附件清單必須是 JSON 陣列';
  end if;

  select * into v_doc from public.field_documents d where d.id = p_document_id for update;
  if not found or not public.is_project_member(v_doc.project_id) then
    raise exception using errcode = 'PD006', message = '找不到文件或無權存取';
  end if;
  if not (public.can_write(v_doc.project_id)
          and (public.my_org_type() = v_doc.owner_org or public.admin_override(v_doc.project_id))) then
    raise exception using errcode = 'PD006',
      message = format('此文件屬%s方,只有該方成員可編輯',
                       case v_doc.owner_org when 'contractor' then '施工廠商' else '監造' end);
  end if;
  if v_doc.status in ('received', 'discarded', 'superseded') then
    raise exception using errcode = 'PD008',
      message = format('文件狀態為 %s,不可再新增版本', v_doc.status);
  end if;
  if p_base_version_no is distinct from v_doc.current_version_no then
    raise exception using errcode = 'PD001',
      message = format('畫面載入的是版本 %s,目前版本已是 %s,請重新載入後再編輯',
                       coalesce(p_base_version_no::text, '無'), v_doc.current_version_no);
  end if;

  v_amended := case when v_doc.status in ('signed', 'submitted', 'returned') then v_doc.current_version_no end;
  insert into public.field_document_versions
    (document_id, author_kind, content, field_sources, attachments, change_note, amended_from_version)
  values (p_document_id, 'human', p_content, coalesce(p_field_sources, '{}'::jsonb), p_attachments,
          nullif(btrim(coalesce(p_change_note, '')), ''), v_amended)
  returning * into v_ver;

  v_required := public.fn_field_document_required_fields(v_doc.doc_type, v_ver.content, v_doc.required_fields);
  v_recheck  := public.fn_field_document_unmet_fields(v_required, v_ver.field_sources)
             || public.fn_field_document_attachment_issues(v_doc.doc_type, v_doc.project_id, v_ver.attachments);
  update public.field_documents
     set current_version_no = v_ver.version_no,
         required_fields    = v_required,
         recheck            = v_recheck,
         status             = case when jsonb_array_length(v_recheck) > 0 then 'pending_input' else 'draft' end
   where id = p_document_id
   returning * into v_doc;

  return jsonb_build_object(
    'document_id', v_doc.id, 'version_no', v_ver.version_no, 'content_hash', v_ver.content_hash,
    'status', v_doc.status, 'required_fields', v_doc.required_fields, 'recheck', v_doc.recheck,
    'amended_from_version', v_amended);
end; $$;
revoke all on function public.save_field_document_version(uuid, int, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.save_field_document_version(uuid, int, jsonb, jsonb, jsonb, text) to authenticated;
comment on function public.save_field_document_version(uuid, int, jsonb, jsonb, jsonb, text) is
  'P2d:人工版本(四類共用)。base=畫面的 current_version_no;回 {document_id,version_no,content_hash,status,required_fields,recheck,amended_from_version}。';

-- ── 5. sign_field_document:簽署(本支只實作 daily_log 分支) ─────────────────────
-- 順序:簽署列(trigger 驗版本／雜湊／角色／成員／aal 並取簽署者資料)→ 事實列(GUC 放行 guard)→
-- 文件 status='signed'＋target_id(guard:簽署列已存在、事實列存在且同案)→ agent_actions。
-- 事實列要先於綁定:field_documents_guard 綁 target_id 時會檢查事實列存在。
create or replace function public.sign_field_document(p_document_id uuid, p_version_no int, p_content_hash text, p_intent text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid       uuid := auth.uid();
  v_doc     public.field_documents%rowtype;
  v_ver     public.field_document_versions%rowtype;
  v_sig     public.field_document_signatures%rowtype;
  v_aal     text;
  v_issues  jsonb;
  v_items   jsonb;
  v_key     text;
  v_val     jsonb;
  v_wi      uuid;
  v_src     jsonb;
  v_log_id  uuid;
  v_other   uuid;
  v_date    date;
  v_n       int;
begin
  if uid is null then
    raise exception using errcode = 'PD006', message = '請先登入後再簽署';
  end if;
  select * into v_doc from public.field_documents d where d.id = p_document_id for update;
  if not found or not public.is_project_member(v_doc.project_id) then
    raise exception using errcode = 'PD006', message = '找不到文件或無權存取';
  end if;
  if not (public.can_write(v_doc.project_id)
          and (public.my_org_type() = v_doc.owner_org or public.admin_override(v_doc.project_id))) then
    raise exception using errcode = 'PD006',
      message = format('此文件屬%s方,只有該方成員可簽署',
                       case v_doc.owner_org when 'contractor' then '施工廠商' else '監造' end);
  end if;
  if v_doc.doc_type <> 'daily_log' then
    raise exception using errcode = 'PD007',
      message = format('文件類型 %s 的簽署尚未支援', v_doc.doc_type);
  end if;
  if p_version_no is distinct from v_doc.current_version_no then
    raise exception using errcode = 'PD001',
      message = format('簽署的版本(%s)不是目前版本(%s):畫面可能是舊版,請重新載入後再簽',
                       coalesce(p_version_no::text, '無'), v_doc.current_version_no);
  end if;
  select * into v_ver from public.field_document_versions v
    where v.document_id = p_document_id and v.version_no = p_version_no;
  if not found then
    raise exception using errcode = 'PD008', message = '尚無版本,不可簽署';
  end if;
  if p_content_hash is null or p_content_hash <> v_ver.content_hash then
    raise exception using errcode = 'PD002', message = '簽署雜湊與版本內容不符(內容已變更或畫面為舊版)';
  end if;

  -- 冪等重試:同人同版本已簽 → 回同一筆簽署,不重複
  if v_doc.status = 'signed' then
    select * into v_sig from public.field_document_signatures s
      where s.document_id = p_document_id and s.version_no = p_version_no and s.signer_id = uid;
    if found then
      return jsonb_build_object(
        'document_id', v_doc.id, 'version_no', v_sig.version_no, 'content_hash', v_sig.content_hash,
        'signature_id', v_sig.id, 'signed_at', v_sig.signed_at, 'signer_id', v_sig.signer_id,
        'status', v_doc.status, 'target_table', v_doc.target_table, 'target_id', v_doc.target_id,
        'agent_actions_resolved', 0, 'idempotent', true);
    end if;
  end if;
  if v_doc.status not in ('draft', 'pending_input', 'in_review') then
    raise exception using errcode = 'PD008',
      message = format('文件狀態為 %s,不可簽署', v_doc.status);
  end if;

  -- aal2 政策(使用者 2026-09-17 決定:平台帳號＋MFA);admin_override 也不放行
  v_aal := public.current_jwt_aal();
  if v_aal is distinct from 'aal2' then
    raise exception using errcode = 'PD003',
      message = format('簽署需要完成兩步驟驗證(目前登入等級 %s)', coalesce(v_aal, '無')),
      hint = '請先在「帳號」啟用 TOTP 並完成驗證,再回來簽署';
  end if;
  if nullif(btrim(coalesce(p_intent, '')), '') is null then
    raise exception using errcode = 'PD010', message = '簽署意願聲明不可空白';
  end if;

  -- 必填完整性與附件角色隔離
  v_issues := public.fn_field_document_unmet_fields(
    public.fn_field_document_required_fields(v_doc.doc_type, v_ver.content, v_doc.required_fields),
    v_ver.field_sources);
  if jsonb_array_length(v_issues) > 0 then
    raise exception using errcode = 'PD004',
      message = format('尚有 %s 個必填欄位待補,不可簽署', jsonb_array_length(v_issues)),
      detail = v_issues::text;
  end if;
  v_issues := public.fn_field_document_attachment_issues(v_doc.doc_type, v_doc.project_id, v_ver.attachments);
  if jsonb_array_length(v_issues) > 0 then
    raise exception using errcode = 'PD005',
      message = '附件不符角色隔離:施工日誌的施作證據必須是施工廠商上傳的照片(監造照片請以 reference 註記)',
      detail = v_issues::text;
  end if;

  -- 內容形狀(事實表落庫前驗證;不信任客戶端形狀)
  if v_ver.content ? 'log_date' and nullif(v_ver.content ->> 'log_date', '') is not null then
    begin
      v_date := (v_ver.content ->> 'log_date')::date;
    exception when others then
      raise exception using errcode = 'PD010', message = '內容的 log_date 不是合法日期';
    end;
    if v_date <> v_doc.doc_date then
      raise exception using errcode = 'PD010',
        message = format('內容的日期(%s)與文件業務日期(%s)不符', v_date, v_doc.doc_date);
    end if;
  end if;
  if (v_ver.content ? 'labor'     and jsonb_typeof(v_ver.content -> 'labor')     not in ('array', 'null'))
  or (v_ver.content ? 'equipment' and jsonb_typeof(v_ver.content -> 'equipment') not in ('array', 'null'))
  or (v_ver.content ? 'materials' and jsonb_typeof(v_ver.content -> 'materials') not in ('array', 'null'))
  or (v_ver.content ? 'extras'    and jsonb_typeof(v_ver.content -> 'extras')    not in ('object', 'null'))
  or (v_ver.content ? 'weather_am'   and jsonb_typeof(v_ver.content -> 'weather_am')   not in ('string', 'null'))
  or (v_ver.content ? 'weather_pm'   and jsonb_typeof(v_ver.content -> 'weather_pm')   not in ('string', 'null'))
  or (v_ver.content ? 'work_summary' and jsonb_typeof(v_ver.content -> 'work_summary') not in ('string', 'null'))
  or (v_ver.content ? 'items'        and jsonb_typeof(v_ver.content -> 'items')        not in ('object', 'null')) then
    raise exception using errcode = 'PD010',
      message = '內容形狀不符:labor/equipment/materials 須為陣列、extras 須為物件、天氣與施工概況須為文字、items 須為物件';
  end if;
  v_items := case when jsonb_typeof(v_ver.content -> 'items') = 'object' then v_ver.content -> 'items' else '{}'::jsonb end;
  for v_key, v_val in select key, value from jsonb_each(v_items) loop
    begin
      v_wi := v_key::uuid;
    exception when others then
      raise exception using errcode = 'PD010', message = format('工項鍵 %s 不是合法 UUID', v_key);
    end;
    if not exists (select 1 from public.work_items w where w.id = v_wi and w.project_id = v_doc.project_id) then
      raise exception using errcode = 'PD010', message = format('工項 %s 不屬於本專案', v_key);
    end if;
    v_src := v_ver.field_sources -> ('items.' || v_key || '.qty_today');
    if v_src ->> 'status' = 'na' then
      continue;  -- 本日不適用(reason 已由待補判定要求)
    end if;
    if jsonb_typeof(v_val) <> 'object' or jsonb_typeof(v_val -> 'qty_today') <> 'number' then
      raise exception using errcode = 'PD010', message = format('工項 %s 的當日數量缺值或不是數字', v_key);
    end if;
    if (v_val ->> 'qty_today')::numeric < 0 then
      raise exception using errcode = 'PD010', message = format('工項 %s 的當日數量不可為負', v_key);
    end if;
  end loop;

  -- 事實列:同日已有事實列且被另一份活文件綁定 → 拒絕(對方收件後只能 superseded 再立新件)
  v_log_id := v_doc.target_id;
  if v_log_id is null then
    select l.id into v_log_id from public.daily_logs l
      where l.project_id = v_doc.project_id and l.log_date = v_doc.doc_date;
  end if;
  if v_log_id is not null then
    select d.id into v_other from public.field_documents d
      where d.doc_type = 'daily_log' and d.target_id = v_log_id and d.id <> p_document_id
        and d.status not in ('discarded', 'superseded')
      limit 1;
    if v_other is not null then
      raise exception using errcode = 'PD008',
        message = format('%s 的施工日誌已綁定另一份文件(%s),請先處理該文件', v_doc.doc_date, v_other);
    end if;
  end if;

  -- 1. 簽署列(trigger:版本／雜湊／角色／成員／aal 一致性、簽署者資料由伺服器取)
  insert into public.field_document_signatures
    (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  values (p_document_id, p_version_no, v_ver.content_hash, uid, public.my_org_type(), btrim(p_intent), 'platform_account_mfa')
  returning * into v_sig;

  -- 2. 事實列(簽署版本內容為準;GUC 只在本交易內放行 daily_logs_guard／daily_log_items_guard)
  perform set_config('pmis.field_document_sign', p_document_id::text, true);
  insert into public.daily_logs
    (project_id, log_date, weather_am, weather_pm, labor, equipment, materials, extras, work_summary, status, created_by)
  values (v_doc.project_id, v_doc.doc_date,
          v_ver.content ->> 'weather_am', v_ver.content ->> 'weather_pm',
          nullif(v_ver.content -> 'labor', 'null'::jsonb), nullif(v_ver.content -> 'equipment', 'null'::jsonb),
          nullif(v_ver.content -> 'materials', 'null'::jsonb), nullif(v_ver.content -> 'extras', 'null'::jsonb),
          v_ver.content ->> 'work_summary', '已簽署', uid)
  on conflict (project_id, log_date) do update
    set weather_am = excluded.weather_am, weather_pm = excluded.weather_pm,
        labor = excluded.labor, equipment = excluded.equipment, materials = excluded.materials,
        extras = excluded.extras, work_summary = excluded.work_summary, status = '已簽署'
  returning id into v_log_id;
  delete from public.daily_log_items where daily_log_id = v_log_id;
  insert into public.daily_log_items (daily_log_id, work_item_id, qty_today, note)
  select v_log_id, e.key::uuid, (e.value ->> 'qty_today')::numeric, nullif(e.value ->> 'note', '')
    from jsonb_each(v_items) e
   where (v_ver.field_sources -> ('items.' || e.key || '.qty_today') ->> 'status') is distinct from 'na';
  perform set_config('pmis.field_document_sign', '', true);

  -- 3. 文件狀態與事實列綁定
  update public.field_documents
     set status = 'signed', target_id = v_log_id, recheck = '[]'::jsonb
   where id = p_document_id
   returning * into v_doc;

  -- 4. AI 草稿:有人工版本=edited、否則 accepted;resolved_by=簽署者
  v_n := public.resolve_agent_action_internal(p_document_id, v_doc.project_id,
    case when exists (select 1 from public.field_document_versions v
                       where v.document_id = p_document_id and v.author_kind = 'human')
         then 'edited' else 'accepted' end);

  return jsonb_build_object(
    'document_id', v_doc.id, 'version_no', v_sig.version_no, 'content_hash', v_sig.content_hash,
    'signature_id', v_sig.id, 'signed_at', v_sig.signed_at, 'signer_id', v_sig.signer_id,
    'status', v_doc.status, 'target_table', v_doc.target_table, 'target_id', v_doc.target_id,
    'agent_actions_resolved', v_n, 'idempotent', false);
end; $$;
revoke all on function public.sign_field_document(uuid, int, text, text) from public, anon;
grant execute on function public.sign_field_document(uuid, int, text, text) to authenticated;
comment on function public.sign_field_document(uuid, int, text, text) is
  'P2d:簽署(平台帳號＋MFA,aal2)。只實作 daily_log:落 daily_logs／daily_log_items、綁 target_id、處理 agent_actions;其他類型回 PD007。';

-- ── 6. 提送／收件／退回(四類共用;對象矩陣與 diff 由 P2a trigger 決定) ──────────────
create or replace function public.fn_field_document_receipt(s public.field_document_submissions, p_status text)
returns jsonb language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select jsonb_build_object(
    'submission_id', s.id, 'document_id', s.document_id, 'version_no', s.version_no,
    'content_hash', s.content_hash, 'action', s.action, 'actor_id', s.actor_id, 'actor_org', s.actor_org,
    'to_org', s.to_org, 'reason', s.reason, 'diff', s.diff, 'client_request_id', s.client_request_id,
    'created_at', s.created_at, 'status', p_status);
$fn$;
revoke all on function public.fn_field_document_receipt(public.field_document_submissions, text) from public, anon, authenticated;

create or replace function public.submit_field_document(
  p_document_id uuid, p_version_no int, p_to_org text, p_client_request_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  v_doc public.field_documents%rowtype;
  v_sub public.field_document_submissions%rowtype;
  v_hash text;
begin
  if uid is null then
    raise exception using errcode = 'PD006', message = '請先登入後再提送';
  end if;
  select * into v_doc from public.field_documents d where d.id = p_document_id for update;
  if not found or not public.is_project_member(v_doc.project_id) then
    raise exception using errcode = 'PD006', message = '找不到文件或無權存取';
  end if;
  if not (public.can_write(v_doc.project_id)
          and (public.my_org_type() = v_doc.owner_org or public.admin_override(v_doc.project_id))) then
    raise exception using errcode = 'PD006', message = '只有責任方成員可提送此文件';
  end if;
  -- client_request_id 冪等:同 id 同請求回同一張回執;同 id 不同請求拒絕
  if p_client_request_id is not null then
    select * into v_sub from public.field_document_submissions s
      where s.document_id = p_document_id and s.client_request_id = p_client_request_id;
    if found then
      if v_sub.action = 'submit' and v_sub.version_no = p_version_no
         and v_sub.actor_id = uid and v_sub.to_org = p_to_org then
        return public.fn_field_document_receipt(v_sub, v_doc.status) || '{"idempotent": true}'::jsonb;
      end if;
      raise exception using errcode = 'PD009',
        message = format('client_request_id %s 已用於另一個不同的請求', p_client_request_id);
    end if;
  end if;
  if p_version_no is distinct from v_doc.current_version_no then
    raise exception using errcode = 'PD001',
      message = format('提送的版本(%s)不是目前版本(%s):畫面可能是舊版',
                       coalesce(p_version_no::text, '無'), v_doc.current_version_no);
  end if;
  if v_doc.status not in ('signed', 'submitted') then
    raise exception using errcode = 'PD008',
      message = format('只有已簽署的文件可提送(目前:%s)', v_doc.status);
  end if;
  if p_to_org is null or not public.fn_field_document_to_org_allowed(v_doc.doc_type, p_to_org) then
    raise exception using errcode = 'PD010',
      message = format('文件類型 %s 不可提送給 %s', v_doc.doc_type, coalesce(p_to_org, '(未指定)'));
  end if;
  -- 自然鍵冪等:同版本已提送給同一對象 → 回原回執
  select * into v_sub from public.field_document_submissions s
    where s.document_id = p_document_id and s.version_no = p_version_no
      and s.action = 'submit' and s.to_org = p_to_org
    order by s.created_at desc limit 1;
  if found then
    return public.fn_field_document_receipt(v_sub, v_doc.status) || '{"idempotent": true}'::jsonb;
  end if;
  select v.content_hash into v_hash from public.field_document_versions v
    where v.document_id = p_document_id and v.version_no = p_version_no;
  insert into public.field_document_submissions
    (document_id, version_no, content_hash, actor_id, actor_org, action, to_org, client_request_id)
  values (p_document_id, p_version_no, v_hash, uid, public.my_org_type(), 'submit', p_to_org, p_client_request_id)
  returning * into v_sub;
  update public.field_documents set status = 'submitted' where id = p_document_id returning * into v_doc;
  return public.fn_field_document_receipt(v_sub, v_doc.status) || '{"idempotent": false}'::jsonb;
end; $$;
revoke all on function public.submit_field_document(uuid, int, text, text) from public, anon;
grant execute on function public.submit_field_document(uuid, int, text, text) to authenticated;
comment on function public.submit_field_document(uuid, int, text, text) is
  'P2d:提送已簽署版本給 to_org(對象矩陣依 doc_type);client_request_id 冪等;回送件回執(created_at=伺服器時間)。';

-- 收件／退回共用一份實作:to_org 成員(該版本 submit 列的對象)才可執行;退回必填原因
create or replace function public.field_document_respond_internal(
  p_document_id uuid, p_version_no int, p_action text, p_reason text, p_client_request_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  v_doc  public.field_documents%rowtype;
  v_sub  public.field_document_submissions%rowtype;
  v_org  text;
  v_to   text;
  v_hash text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if uid is null then
    raise exception using errcode = 'PD006', message = '請先登入後再收件／退回';
  end if;
  if p_action not in ('receive', 'return') then
    raise exception using errcode = 'PD010', message = '動作只能是 receive 或 return';
  end if;
  select * into v_doc from public.field_documents d where d.id = p_document_id for update;
  if not found or not public.is_project_member(v_doc.project_id) then
    raise exception using errcode = 'PD006', message = '找不到文件或無權存取';
  end if;
  v_org := public.my_org_type();
  if p_client_request_id is not null then
    select * into v_sub from public.field_document_submissions s
      where s.document_id = p_document_id and s.client_request_id = p_client_request_id;
    if found then
      if v_sub.action = p_action and v_sub.version_no = p_version_no and v_sub.actor_id = uid
         and v_sub.reason is not distinct from v_reason then
        return public.fn_field_document_receipt(v_sub, v_doc.status) || '{"idempotent": true}'::jsonb;
      end if;
      raise exception using errcode = 'PD009',
        message = format('client_request_id %s 已用於另一個不同的請求', p_client_request_id);
    end if;
  end if;
  if p_version_no is distinct from v_doc.current_version_no then
    raise exception using errcode = 'PD001',
      message = format('處理的版本(%s)不是目前版本(%s):畫面可能是舊版',
                       coalesce(p_version_no::text, '無'), v_doc.current_version_no);
  end if;
  select s.to_org into v_to from public.field_document_submissions s
    where s.document_id = p_document_id and s.version_no = p_version_no and s.action = 'submit'
      and (s.to_org = v_org or public.admin_override(v_doc.project_id))
    order by s.created_at desc limit 1;
  if v_to is null then
    raise exception using errcode = 'PD006',
      message = format('此版本尚未提送給%s方,不可收件／退回',
                       case v_org when 'contractor' then '施工廠商' when 'supervisor' then '監造' else '機關' end);
  end if;
  if p_action = 'receive' then
    if v_doc.status not in ('submitted', 'received') then
      raise exception using errcode = 'PD008',
        message = format('文件狀態為 %s,不可收件', v_doc.status);
    end if;
    -- 自然鍵冪等:同版本本方已收件 → 回原回執
    select * into v_sub from public.field_document_submissions s
      where s.document_id = p_document_id and s.version_no = p_version_no
        and s.action = 'receive' and s.actor_org = v_org
      order by s.created_at desc limit 1;
    if found then
      return public.fn_field_document_receipt(v_sub, v_doc.status) || '{"idempotent": true}'::jsonb;
    end if;
  else
    if v_doc.status not in ('submitted', 'received') then
      raise exception using errcode = 'PD008',
        message = format('文件狀態為 %s,不可退回', v_doc.status);
    end if;
    if v_reason is null then
      raise exception using errcode = 'PD010', message = '退回必須填寫原因';
    end if;
  end if;
  select v.content_hash into v_hash from public.field_document_versions v
    where v.document_id = p_document_id and v.version_no = p_version_no;
  insert into public.field_document_submissions
    (document_id, version_no, content_hash, actor_id, actor_org, action, to_org, reason, client_request_id)
  values (p_document_id, p_version_no, v_hash, uid, v_org, p_action, v_to, v_reason, p_client_request_id)
  returning * into v_sub;
  update public.field_documents
     set status = case p_action when 'receive' then 'received' else 'returned' end
   where id = p_document_id
   returning * into v_doc;
  return public.fn_field_document_receipt(v_sub, v_doc.status) || '{"idempotent": false}'::jsonb;
end; $$;
revoke all on function public.field_document_respond_internal(uuid, int, text, text, text) from public, anon, authenticated;

create or replace function public.receive_field_document(
  p_document_id uuid, p_version_no int, p_client_request_id text default null)
returns jsonb language sql security definer set search_path = public as $$
  select public.field_document_respond_internal(p_document_id, p_version_no, 'receive', null, p_client_request_id);
$$;
revoke all on function public.receive_field_document(uuid, int, text) from public, anon;
grant execute on function public.receive_field_document(uuid, int, text) to authenticated;
comment on function public.receive_field_document(uuid, int, text) is
  'P2d:提送對象收件(status=received);client_request_id 冪等;回收件回執。';

create or replace function public.return_field_document(
  p_document_id uuid, p_version_no int, p_reason text, p_client_request_id text default null)
returns jsonb language sql security definer set search_path = public as $$
  select public.field_document_respond_internal(p_document_id, p_version_no, 'return', p_reason, p_client_request_id);
$$;
revoke all on function public.return_field_document(uuid, int, text, text) from public, anon;
grant execute on function public.return_field_document(uuid, int, text, text) to authenticated;
comment on function public.return_field_document(uuid, int, text, text) is
  'P2d:提送對象退回(必填原因;status=returned;再送需新版本重簽);client_request_id 冪等;回退回回執。';
