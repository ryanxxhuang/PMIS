-- ── P3f 捨棄現場文書草稿:discard_field_document ─────────────────────────────────────────────
-- 問題:AI 或人擬錯的現場文書草稿(施工日誌／監造日誌／自主檢查表／監造查驗表單)沒有任何捨棄路徑——authenticated
--   對 field_documents 沒有 UPDATE grant(P2a 刻意收窄,狀態一律經 RPC),而 P2a 設計的終態 discarded 一直沒有對外 RPC;
--   擬錯的草稿只能一直掛在清單與「今日工作」裡,指向它的 AI 草稿也一直停在收件匣「待覆核」。
-- 本支(設計 docs/architecture/field-documents-lifecycle.md §2.2、§4、§5;續接清單 P3f):
--   1. 捨棄紀錄欄 discard_reason／discarded_by／discarded_at／discard_request_id(field_documents 加欄,全部 nullable;
--      既有列不動)。規則由新 BEFORE trigger field_documents_discard_guard 釘死(所有寫入者,含 service):
--        * 只在「轉為 discarded」的那一次寫入:原因去頭尾空白後必填(與提送列「退回必填原因」同一層級的不變量),
--          捨棄者＝auth.uid()(service 為 null)、時間＝伺服器 now(),客戶端值一律覆蓋;
--        * 其餘任何寫入(含建立)四欄不可變——捨棄紀錄與版本列一樣,寫下就不能改。
--      「只有未簽署文件可捨棄」「捨棄為終態」「責任方才能捨棄」仍由 P2a field_documents_guard 執行,本支不重寫它。
--   2. discard_field_document(p_document_id, p_reason, p_client_request_id):
--        * 責任方成員(can_write 且 my_org_type()=owner_org,admin_override 例外;與存版／提送同一條)→ 否則 PD006;
--        * 冪等:文件已捨棄且同一人同一原因(或同一 client_request_id 同一請求)→ 回原結果 idempotent=true;
--          同 client_request_id 換原因／換人 → PD009;已由他人或以其他原因捨棄 → PD008;
--        * 原因必填(空白 → PD010);
--        * 只有「從未簽署、從未提送」的文件可捨棄:狀態須為 draft／pending_input／in_review(未簽署的三個狀態,
--          與 P2a guard 同一集合),且沒有任何簽署列與提送列——簽後更正回到草稿的文件曾經簽署,拒絕(PD008,
--          已簽署的文件作廢走新版本／superseded,不走捨棄);
--        * 版本列一律保留(field_document_versions 不可變,捨棄不刪任何列);照片不動(照片是證據);
--        * 同交易把指向本文件、仍待覆核的 AI 草稿(agent_actions pending,draft_field_document／suggest_field_update)
--          標 rejected(resolve_agent_action_internal,resolved_via=discard_field_document)——文件已捨棄,草稿不再有
--          可接受的對象,不能一直留在收件匣;
--        * 稽核:狀態轉移由既有 AFTER trigger field_documents_audit 寫 field_document.discarded,本支把原因與
--          client_request_id 帶進 metadata(after_data 本來就含捨棄紀錄欄)。
--   3. 捨棄後同一目標可重新起稿:P2a／P2d／P3c 的三個部分唯一索引(日誌類每案每日、起稿批次＋目標、
--      每個查驗一份表單)與事實列綁定索引都只算活文件(status not in discarded／superseded),本支不改索引;
--      pgTAP 逐一釘住「捨棄後可再建、新文件可簽署並接手同一列事實列」。
--   不變:P3e 共用補值、P2b 起稿(Edge findActiveDoc)、P5a 球權、/site 清單原本就把 discarded 視為終態,只補測試。
-- 權限(H3):authenticated 只多 discard_field_document 一支;trigger 函式不開放。
-- 錯誤代碼沿用 P2d:PD006 無權、PD008 狀態不允許、PD009 client_request_id 衝突、PD010 輸入不合法。
-- 資料保留／相容:只加欄與函式;既有 discarded 列(若有,P3f 前只可能由 service 寫入)四欄維持 null=未記錄原因,不回填。
--   舊前端不讀新欄,不受影響。
-- 回復:supabase/rollbacks/20260920021000_field_document_discard.down.sql(drop RPC 與 discard guard、還原
--   resolve_agent_action_internal／field_documents_audit 的 P2a／P2d 定義;捨棄紀錄欄保留(含已捨棄文件的原因),
--   若要一併移除先匯出)。

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 捨棄紀錄欄
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.field_documents
  add column if not exists discard_reason     text,
  add column if not exists discarded_by       uuid references auth.users(id),
  add column if not exists discarded_at       timestamptz,
  add column if not exists discard_request_id text;
comment on column public.field_documents.discard_reason is
  'P3f:捨棄原因(轉為 discarded 時必填,去頭尾空白;寫下後不可變)。';
comment on column public.field_documents.discarded_by is
  'P3f:捨棄者(auth.uid(),伺服器蓋;service 捨棄為 null)。';
comment on column public.field_documents.discarded_at is
  'P3f:捨棄時間(伺服器 now())。';
comment on column public.field_documents.discard_request_id is
  'P3f:捨棄請求的 client_request_id(冪等:同 id 同請求回原結果,同 id 不同請求 PD009)。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 捨棄紀錄 guard(所有寫入者)
-- ═══════════════════════════════════════════════════════════════════════════
-- 觸發順序:同表 BEFORE row trigger 依名稱排序,field_documents_discard_guard 先於 field_documents_guard;
-- 本 trigger 只管四個捨棄紀錄欄,狀態轉移是否合法(未簽署、終態、責任方)由後者判定,任一拒絕整句失敗。
create or replace function public.field_documents_discard_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_reason text;
begin
  if tg_op = 'INSERT' then
    if new.discard_reason is not null or new.discarded_by is not null or new.discarded_at is not null
       or new.discard_request_id is not null then
      raise exception '捨棄紀錄只能在捨棄文件時由伺服器寫入';
    end if;
    return new;
  end if;

  if new.status = 'discarded' and old.status is distinct from 'discarded' then
    v_reason := nullif(btrim(coalesce(new.discard_reason, '')), '');
    if v_reason is null then
      raise exception '捨棄文件必須填寫原因';
    end if;
    new.discard_reason     := v_reason;
    new.discarded_by       := auth.uid();
    new.discarded_at       := now();
    new.discard_request_id := nullif(btrim(coalesce(new.discard_request_id, '')), '');
  elsif (new.discard_reason, new.discarded_by, new.discarded_at, new.discard_request_id)
        is distinct from (old.discard_reason, old.discarded_by, old.discarded_at, old.discard_request_id) then
    raise exception '捨棄紀錄(原因／捨棄者／時間／請求編號)寫下後不可變更';
  end if;
  return new;
end; $$;
revoke all on function public.field_documents_discard_guard() from public, anon, authenticated;
drop trigger if exists field_documents_discard_guard on public.field_documents;
create trigger field_documents_discard_guard before insert or update on public.field_documents
  for each row execute function public.field_documents_discard_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. 稽核事件:discarded 帶原因(取代 P2a 定義;其餘逐字沿用)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.field_documents_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_event text;
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'field_document.created', 'field_document', new.id,
      'created', null, to_jsonb(new), jsonb_build_object('doc_type', new.doc_type), null);
    return new;
  end if;
  if new.status is distinct from old.status then
    -- signed／submitted／received／returned 由簽署／提送紀錄的 trigger 留痕,這裡不重複
    v_event := case
      when new.status = 'discarded' then 'field_document.discarded'
      when new.status = 'superseded' then 'field_document.superseded'
      when new.status in ('draft','pending_input') and old.status in ('signed','submitted','returned')
        then 'field_document.amended'
      when new.status in ('signed','submitted','received','returned') then null
      else 'field_document.status_changed'
    end;
    if v_event is not null then
      perform public.record_audit_event(new.project_id, v_event, 'field_document', new.id,
        new.status, to_jsonb(old), to_jsonb(new),
        jsonb_build_object('doc_type', new.doc_type, 'version_no', new.current_version_no)
          || case when new.status = 'discarded'
                  then jsonb_build_object('reason', new.discard_reason, 'client_request_id', new.discard_request_id)
                  else '{}'::jsonb end,
        null);
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.field_documents_audit() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. agent_actions 內部處理:加 rejected(取代 P2d 定義)
-- ═══════════════════════════════════════════════════════════════════════════
-- 指向本文件的 pending 草稿:簽署者處理成 accepted(無人工版本)／edited(有人工版本);捨棄者處理成 rejected。
-- 與 resolve_agent_action 的差別:不限本人(簽署／捨棄者可能不是草稿收件人),但同樣只動 pending、留同一種稽核事件。
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
  if p_status not in ('accepted', 'edited', 'rejected') then
    raise exception '不合法的處理狀態,僅接受 accepted/edited/rejected';
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
                         'resolved_via', case p_status when 'rejected' then 'discard_field_document' else 'sign_field_document' end,
                         'document_id', p_document_id),
      null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
revoke all on function public.resolve_agent_action_internal(uuid, uuid, text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. discard_field_document
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.discard_field_document(
  p_document_id uuid, p_reason text, p_client_request_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  v_doc    public.field_documents%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_req    text := nullif(btrim(coalesce(p_client_request_id, '')), '');
  v_same   boolean;
  v_idem   boolean := false;
  v_n      int := 0;
begin
  if uid is null then
    raise exception using errcode = 'PD006', message = '請先登入後再捨棄文件';
  end if;
  select * into v_doc from public.field_documents d where d.id = p_document_id for update;
  if not found or not public.is_project_member(v_doc.project_id) then
    raise exception using errcode = 'PD006', message = '找不到文件或無權存取';
  end if;
  if not (public.can_write(v_doc.project_id)
          and (public.my_org_type() = v_doc.owner_org or public.admin_override(v_doc.project_id))) then
    raise exception using errcode = 'PD006',
      message = format('此文件屬%s方,只有該方成員可捨棄',
                       case v_doc.owner_org when 'contractor' then '施工廠商' else '監造' end);
  end if;

  if v_doc.status = 'discarded' then
    -- 冪等:同一件事(同一人、同一原因)重送 → 回原結果,不重複捨棄、不重複稽核;
    -- 同 client_request_id 卻換了人或原因 → PD009;已由他人或以其他原因捨棄 → PD008
    v_same := coalesce(v_doc.discarded_by = uid and v_doc.discard_reason = v_reason, false);
    if v_req is not null and v_doc.discard_request_id = v_req and not v_same then
      raise exception using errcode = 'PD009',
        message = format('client_request_id %s 已用於另一個不同的請求', v_req);
    end if;
    if not v_same then
      raise exception using errcode = 'PD008',
        message = format('文件已於 %s 捨棄,不可再變更',
                         coalesce(to_char(v_doc.discarded_at at time zone 'Asia/Taipei', 'YYYY-MM-DD HH24:MI'), '先前'));
    end if;
    v_idem := true;
  else
    if v_reason is null then
      raise exception using errcode = 'PD010', message = '捨棄必須填寫原因';
    end if;
    if v_doc.status not in ('draft', 'pending_input', 'in_review') then
      raise exception using errcode = 'PD008',
        message = format('文件狀態為「%s」,只有未簽署、未提送的草稿可以捨棄;已簽署的文件要更正請建立新版本',
                         case v_doc.status when 'signed' then '已簽署' when 'submitted' then '已提送'
                                           when 'received' then '對方已收件' when 'returned' then '已退回'
                                           when 'superseded' then '已取代' else v_doc.status end);
    end if;
    if exists (select 1 from public.field_document_signatures s where s.document_id = v_doc.id)
       or exists (select 1 from public.field_document_submissions s where s.document_id = v_doc.id) then
      raise exception using errcode = 'PD008',
        message = '此文件曾經簽署或提送(目前是簽後更正的草稿),不可捨棄;請完成更正後重新簽署';
    end if;
    update public.field_documents
       set status = 'discarded', discard_reason = v_reason, discard_request_id = v_req
     where id = v_doc.id
     returning * into v_doc;
    v_n := public.resolve_agent_action_internal(v_doc.id, v_doc.project_id, 'rejected');
  end if;

  return jsonb_build_object(
    'document_id', v_doc.id, 'doc_type', v_doc.doc_type, 'doc_date', v_doc.doc_date, 'status', v_doc.status,
    'version_no', v_doc.current_version_no, 'discard_reason', v_doc.discard_reason,
    'discarded_by', v_doc.discarded_by, 'discarded_at', v_doc.discarded_at,
    'client_request_id', v_doc.discard_request_id, 'agent_actions_resolved', v_n, 'idempotent', v_idem);
end; $$;
revoke all on function public.discard_field_document(uuid, text, text) from public, anon;
grant execute on function public.discard_field_document(uuid, text, text) to authenticated;
comment on function public.discard_field_document(uuid, text, text) is
  'P3f:捨棄從未簽署／提送的現場文書草稿(責任方成員、原因必填、client_request_id 冪等);版本保留,指向它的待覆核 AI 草稿標 rejected;捨棄後同一目標可重新起稿。';
