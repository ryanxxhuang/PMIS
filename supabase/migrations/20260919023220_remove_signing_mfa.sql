-- R1｜全面移除兩步驟驗證(MFA／TOTP):簽署不再以 JWT aal2 為條件(使用者 2026-09-19 指示「把簽署需要兩步驟驗證
-- 這個功能拔掉;把整個兩步驟驗證這個功能都拔掉」,推翻 2026-09-17 Q1「平台帳號＋MFA」;D-026 第 7 點與續接清單
-- §6 Q1 同步改記,設計 docs/architecture/field-documents-lifecycle.md §3.3／§5)。
--
-- 為什麼:產品不再提供任何兩步驟驗證——登入沒有驗證碼步驟、/account 啟用頁移除、簽署 RPC 不再要求 aal2。
--   正式庫 auth.mfa_factors 為 0 列(沒有任何帳號啟用過),field_document_signatures 沒有 platform_account_mfa 列,
--   所以沒有人會被卡住、也沒有既有簽署紀錄需要改語意;下面的資料遷移規則仍寫成完整可執行(不是空轉)。
-- 簽署身分保證(不變的部分才是真正的證據):auth.uid() 已登入的平台帳號;伺服器記錄 signer_id／signer_org／
--   signer_name_snapshot／signed_at(伺服器時間)／intent(簽署意願原文)／所簽 version_no 與 content_hash
--   (必須等於該版本雜湊)／request_ip／user_agent;簽署者必須是責任方成員(admin_override 例外);版本不可變、
--   簽署列 append-only。aal 欄位保留並仍由 JWT 如實記錄(一般登入為 aal1)——它與 IP／UA 同性質,是伺服器取得
--   的證據欄位,不再是政策條件;不刪欄是因為刪了就無法誠實呈現「當時的登入等級」。
-- 改動:
--   1. field_document_signatures.method 合法值改為 ('platform_account','paper_scan')。既有 platform_account_mfa
--      列改標 platform_account(其 aal 欄仍是當時的 aal2,證據不失真)。簽署列的 append-only guard 會擋 UPDATE,
--      遷移在同一交易內只為這一句暫停該 trigger,做完立即恢復。
--   2. field_document_signatures_guard:移除「method=platform_account_mfa 時 aal 必須 aal2」分支,其餘逐字沿用。
--   3. sign_field_document(取代 20260917221000 的 P3a 定義):移除 aal2 檢查(PD003 不再由任何路徑拋出;代碼保留
--      不重用),簽署列 method 改寫 platform_account;其餘前段(身分、責任方、版本、雜湊、冪等、意願、必填、附件、
--      日期、事實列綁定)與分派(daily_log／supervisor_log;self_check／inspection_form 回 PD007)逐字沿用。
-- 不動:current_jwt_aal()(aal 證據欄仍用它)、稽核 metadata 仍含 aal／method、RLS／grants、其他 RPC 與 guard。
-- 回復:supabase/rollbacks/20260919023220_remove_signing_mfa.down.sql(還原三值 check、guard 的 mfa 分支與 P3a 版
--   sign_field_document 的 aal2 政策;已改標 platform_account 的列不回標——它們的 aal 欄仍記錄事實)。

-- ── 1. method 合法值與既有列 ─────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  select count(*) into v_n from public.field_document_signatures where method = 'platform_account_mfa';
  if v_n > 0 then
    alter table public.field_document_signatures disable trigger field_document_signatures_guard;
    update public.field_document_signatures set method = 'platform_account' where method = 'platform_account_mfa';
    alter table public.field_document_signatures enable trigger field_document_signatures_guard;
    raise notice 'R1: % signature(s) relabelled platform_account_mfa -> platform_account (aal column kept as evidence)', v_n;
  end if;
end $$;

do $$
declare v_name text;
begin
  -- P2a 以行內 check 建立(自動命名);依定義內容找 method 的 check(不賭名字),先全部拿掉再建二值版——
  -- 也讓本支可重跑(rollback 後再套、或本機歷史修復後再 up)而不撞「constraint already exists」。
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.field_document_signatures'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%method = ANY%'
  loop
    execute format('alter table public.field_document_signatures drop constraint %I', v_name);
  end loop;
end $$;
alter table public.field_document_signatures
  add constraint field_document_signatures_method_check check (method in ('platform_account', 'paper_scan'));
comment on column public.field_document_signatures.method is
  'R1:platform_account=已登入的平台帳號簽署(唯一啟用的方式);paper_scan=紙本簽回(保留,尚未啟用,須附 evidence)。platform_account_mfa 已於 20260919023220 移除。';
comment on column public.field_document_signatures.aal is
  'JWT aal,伺服器取(一般登入為 aal1)。只作證據欄位,與 request_ip／user_agent 同性質;R1 起不是任何政策條件。';
comment on table public.field_document_signatures is
  'P2a／R1:簽署紀錄(append-only)。只能在有登入者的情境寫入;簽署者、姓名快照、時間、aal、IP、UA 由伺服器取;雜湊須等於所簽版本;簽署方式為已登入的平台帳號,不要求兩步驟驗證。';

create or replace function public.field_document_signatures_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  v_doc  public.field_documents%rowtype;
  v_hash text;
  v_org  text;
begin
  if tg_op in ('UPDATE','DELETE') then
    if not exists (select 1 from public.field_documents d where d.id = old.document_id) then
      return coalesce(new, old);
    end if;
    raise exception '簽署紀錄只可新增,不可修改或刪除';
  end if;

  if uid is null then
    raise exception '簽署必須由登入使用者執行(伺服器不得代簽)';
  end if;
  select * into v_doc from public.field_documents d where d.id = new.document_id for update;
  if not found then
    raise exception '文件不存在';
  end if;
  if not public.is_project_member(v_doc.project_id) then
    raise exception '非專案成員不可簽署';
  end if;
  if v_doc.status not in ('draft','pending_input','in_review','signed') then
    raise exception '文件狀態為 %,不可簽署', v_doc.status;
  end if;
  if new.version_no <> v_doc.current_version_no then
    raise exception '簽署的版本(%)不是目前版本(%):畫面可能是舊版,請重新載入後再簽',
      new.version_no, v_doc.current_version_no;
  end if;
  select v.content_hash into v_hash from public.field_document_versions v
    where v.document_id = new.document_id and v.version_no = new.version_no;
  if v_hash is null then
    raise exception '尚無版本,不可簽署';
  end if;
  if new.content_hash is null or new.content_hash <> v_hash then
    raise exception '簽署雜湊與版本內容不符(內容已變更或畫面為舊版)';
  end if;
  v_org := public.my_org_type();
  if v_org <> v_doc.owner_org and not public.admin_override(v_doc.project_id) then
    raise exception '此文件屬%方,只能由該方成員簽署',
      case v_doc.owner_org when 'contractor' then '施工廠商' else '監造' end;
  end if;

  new.signer_id  := uid;
  new.signer_org := v_org;
  select p.full_name into new.signer_name_snapshot from public.profiles p where p.id = uid;
  new.signed_at  := now();
  new.created_at := now();
  new.aal        := public.current_jwt_aal();
  new.request_ip := public.current_request_ip();
  new.user_agent := public.current_request_user_agent();

  if new.method = 'paper_scan'
     and (new.evidence is null or (new.evidence ->> 'storage_path') is null or (new.evidence ->> 'sha256') is null) then
    raise exception '紙本簽回必須附掃描檔路徑與雜湊(evidence.storage_path／sha256)';
  end if;
  return new;
end; $$;

-- ── 3. sign_field_document(取代 P3a 定義):共用前段＋依類型分派;不再有 aal2 檢查 ─────────
-- 順序:簽署列(trigger 驗版本／雜湊／角色／成員並取簽署者資料)→ 事實列(GUC 放行同類同案同日的 guard)→
-- 文件 status='signed'＋target_id(guard:簽署列已存在、事實列存在且同案)→ agent_actions。
create or replace function public.sign_field_document(p_document_id uuid, p_version_no int, p_content_hash text, p_intent text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid       uuid := auth.uid();
  v_doc     public.field_documents%rowtype;
  v_ver     public.field_document_versions%rowtype;
  v_sig     public.field_document_signatures%rowtype;
  v_issues  jsonb;
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
  if v_doc.doc_type not in ('daily_log', 'supervisor_log') then
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

  -- 簽署意願聲明(R1 起沒有登入等級檢查:一般登入的平台帳號即可簽署)
  if nullif(btrim(coalesce(p_intent, '')), '') is null then
    raise exception using errcode = 'PD010', message = '簽署意願聲明不可空白';
  end if;

  -- 必填完整性(含人填欄須 confirmed)與附件角色隔離(證據須由責任方上傳;他方照片只能 reference)
  v_issues := public.fn_field_document_unmet_fields(v_doc.doc_type,
    public.fn_field_document_required_fields(v_doc.doc_type, v_ver.content, v_doc.required_fields),
    v_ver.field_sources);
  if jsonb_array_length(v_issues) > 0 then
    raise exception using errcode = 'PD004',
      message = format('尚有 %s 個必填欄位待補或待確認,不可簽署', jsonb_array_length(v_issues)),
      detail = v_issues::text;
  end if;
  v_issues := public.fn_field_document_attachment_issues(v_doc.doc_type, v_doc.project_id, v_ver.attachments);
  if jsonb_array_length(v_issues) > 0 then
    raise exception using errcode = 'PD005',
      message = format('附件不符角色隔離:%s的證據必須是%s上傳的照片(他方照片請以 reference 註記)',
                       public.fn_field_document_type_label(v_doc.doc_type),
                       case v_doc.owner_org when 'contractor' then '施工廠商' else '監造' end),
      detail = v_issues::text;
  end if;

  -- 日誌類:內容若帶 log_date 必須等於文件業務日期
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

  -- 事實列:同日已有事實列且被另一份活文件綁定 → 拒絕(對方收件後只能 superseded 再立新件)
  v_log_id := v_doc.target_id;
  if v_log_id is null then
    execute format('select l.id from public.%I l where l.project_id = $1 and l.log_date = $2', v_doc.target_table)
      into v_log_id using v_doc.project_id, v_doc.doc_date;
  end if;
  if v_log_id is not null then
    select d.id into v_other from public.field_documents d
      where d.doc_type = v_doc.doc_type and d.target_id = v_log_id and d.id <> p_document_id
        and d.status not in ('discarded', 'superseded')
      limit 1;
    if v_other is not null then
      raise exception using errcode = 'PD008',
        message = format('%s 的%s已綁定另一份文件(%s),請先處理該文件',
                         v_doc.doc_date, public.fn_field_document_type_label(v_doc.doc_type), v_other);
    end if;
  end if;

  -- 1. 簽署列(trigger:版本／雜湊／角色／成員一致性;簽署者資料、時間、aal、IP、UA 由伺服器取)
  insert into public.field_document_signatures
    (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  values (p_document_id, p_version_no, v_ver.content_hash, uid, public.my_org_type(), btrim(p_intent), 'platform_account')
  returning * into v_sig;

  -- 2. 事實列(簽署版本內容為準;GUC 只在本交易內放行同類同案同日的事實表 guard)
  perform set_config('pmis.field_document_sign', p_document_id::text, true);
  v_log_id := case v_doc.doc_type
    when 'daily_log'      then public.field_document_sign_daily_log_internal(v_doc, v_ver, uid)
    when 'supervisor_log' then public.field_document_sign_supervisor_log_internal(v_doc, v_ver, uid)
  end;
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
  'P2d／P3a／R1:簽署(已登入的平台帳號;不要求兩步驟驗證)。daily_log 落 daily_logs／daily_log_items;supervisor_log 落 supervisor_logs(到場須人確認、引用須本案);綁 target_id、處理 agent_actions;self_check／inspection_form 回 PD007。';
