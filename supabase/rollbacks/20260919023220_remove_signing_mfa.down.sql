-- Roll back 20260919023220 (R1: signing no longer requires MFA / JWT aal2; method 'platform_account_mfa' removed).
--
-- Data policy: nothing is dropped. Signature rows relabelled by the migration (platform_account_mfa -> platform_account)
-- are NOT relabelled back: their `aal` column still records the assurance level at signing time, and any row signed
-- after R1 is genuinely a plain-account signature. Rows signed after R1 carry aal='aal1'; re-imposing the aal2 policy
-- only affects future signatures.
--
-- Restores, verbatim: the three-value method check (20260917201000), field_document_signatures_guard with the
-- "platform_account_mfa requires aal2" branch (20260917201000), and the P3a sign_field_document with the aal2 policy
-- and method='platform_account_mfa' (20260917221000). Also revert supabase/tests/{field_documents,field_document_sign,
-- supervisor_logs}.sql to their pre-R1 expectations, restore supabase/config.toml [auth.mfa.totp] and the frontend
-- MFA flow (commit before R1), otherwise pgTAP / e2e go red and the UI cannot reach aal2.
-- Run through SQL Editor / psql as owner.
begin;

alter table public.field_document_signatures drop constraint if exists field_document_signatures_method_check;
alter table public.field_document_signatures
  add constraint field_document_signatures_method_check check (method in ('platform_account','platform_account_mfa','paper_scan'));
comment on column public.field_document_signatures.method is null;
comment on column public.field_document_signatures.aal is null;
comment on table public.field_document_signatures is
  'P2a:簽署紀錄(append-only)。只能在有登入者的情境寫入;簽署者、時間、aal、IP、UA 由伺服器取;雜湊須等於所簽版本。';

-- P2a field_document_signatures_guard, verbatim (20260917201000 §6.5)
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

  if new.method = 'platform_account_mfa' and new.aal is distinct from 'aal2' then
    raise exception '簽署方式登記為平台帳號＋兩步驟驗證,但目前登入未完成兩步驟驗證(aal=%)',
      coalesce(new.aal, '無');
  end if;
  if new.method = 'paper_scan'
     and (new.evidence is null or (new.evidence ->> 'storage_path') is null or (new.evidence ->> 'sha256') is null) then
    raise exception '紙本簽回必須附掃描檔路徑與雜湊(evidence.storage_path／sha256)';
  end if;
  return new;
end; $$;

-- P3a sign_field_document, verbatim (20260917221000 §7: aal2 policy, method='platform_account_mfa')
create or replace function public.sign_field_document(p_document_id uuid, p_version_no int, p_content_hash text, p_intent text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid       uuid := auth.uid();
  v_doc     public.field_documents%rowtype;
  v_ver     public.field_document_versions%rowtype;
  v_sig     public.field_document_signatures%rowtype;
  v_aal     text;
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

  -- 1. 簽署列(trigger:版本／雜湊／角色／成員／aal 一致性、簽署者資料由伺服器取)
  insert into public.field_document_signatures
    (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  values (p_document_id, p_version_no, v_ver.content_hash, uid, public.my_org_type(), btrim(p_intent), 'platform_account_mfa')
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
  'P2d／P3a:簽署(平台帳號＋MFA,aal2)。daily_log 落 daily_logs／daily_log_items;supervisor_log 落 supervisor_logs(到場須人確認、引用須本案);綁 target_id、處理 agent_actions;self_check／inspection_form 回 PD007。';

commit;
