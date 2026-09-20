-- 回復 20260920230000:把七支函式換回上一版定義——
--   inspection_confirmations_guard → 20260920001500 的版本(INSERT 與撤銷不驗內部旗標);
--   issue_supervisor_certificate、revoke_inspection_confirmation、valuations_guard、work_item_pricing_basis_guard(trigger 回
--   before insert or update)、set_work_item_pricing_basis → 20260919140000 的版本;
--   field_document_sign_inspection_form_internal → 20260920170000 的版本。
-- 沒有任何資料需要還原(該 migration 只換函式定義,不動任何一列)。
-- 回復之後,服務憑證(Edge service role)與 DBA 直連又可以憑空寫入 active 確認量、替監造撤銷確認、直接建立或改寫
-- 非草稿的估驗期別狀態(見該 migration 檔頭);pgTAP edge_credential_writes.sql 會轉紅,屬預期。

create or replace function public.inspection_confirmations_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  w       record;
  prev    record;
  stages  text[];
  v_stage text;
  ver     record;
  doc     record;
  insp    record;
begin
  if tg_op = 'DELETE' then
    -- 只放行 cascade(專案或工項已不存在);其他一律拒絕(留痕)
    if not exists (select 1 from public.projects where id = old.project_id)
       or not exists (select 1 from public.work_items where id = old.work_item_id) then
      return old;
    end if;
    perform public.fn_cq_raise_internal('VQ010', '監造確認紀錄不可刪除;請以撤銷留痕');
  end if;

  if tg_op = 'UPDATE' then
    -- RI set null(查驗／文件版本／被取代列被刪):只有這些參照欄位變 null、其餘不變 → 放行
    if (to_jsonb(new) - '{inspection_id,document_id,document_version_no,supersedes_id}'::text[])
         = (to_jsonb(old) - '{inspection_id,document_id,document_version_no,supersedes_id}'::text[])
       and (new.inspection_id is null or new.inspection_id = old.inspection_id)
       and (new.document_id is null or new.document_id = old.document_id)
       and (new.document_version_no is null or new.document_version_no = old.document_version_no)
       and (new.supersedes_id is null or new.supersedes_id = old.supersedes_id) then
      return new;
    end if;
    if old.status = 'active' and new.status = 'revoked' then
      if new.revoked_at is null then new.revoked_at := now(); end if;
      if new.reason is null or btrim(new.reason) = '' then
        perform public.fn_cq_raise_internal('VQ005', '撤銷確認必須填寫原因');
      end if;
      if new.revoked_by is null then new.revoked_by := auth.uid(); end if;
    elsif new.status is distinct from old.status then
      perform public.fn_cq_raise_internal('VQ010', '已撤銷的確認不可回復;請另簽新的累計確認');
    elsif new.reason is distinct from old.reason or new.revoked_at is distinct from old.revoked_at
          or new.revoked_by is distinct from old.revoked_by then
      perform public.fn_cq_raise_internal('VQ010', '監造確認紀錄不可改寫(只能撤銷);改量請另簽新的累計確認');
    end if;
    -- 其餘欄位一律不可變
    if new.project_id <> old.project_id or new.work_item_id <> old.work_item_id
       or new.batch_key <> old.batch_key or new.stage_key is distinct from old.stage_key
       or new.unit <> old.unit or new.qty_cum <> old.qty_cum or new.qty_delta <> old.qty_delta
       or new.basis <> old.basis or new.inspection_id is distinct from old.inspection_id
       or new.document_id is distinct from old.document_id
       or new.document_version_no is distinct from old.document_version_no
       or new.content_hash is distinct from old.content_hash
       or new.confirmed_by <> old.confirmed_by or new.confirmed_at <> old.confirmed_at
       or new.supersedes_id is distinct from old.supersedes_id
       or new.client_request_id is distinct from old.client_request_id
       or new.created_at <> old.created_at then
      perform public.fn_cq_raise_internal('VQ010', '監造確認紀錄的內容不可改寫');
    end if;
    return new;
  end if;

  -- INSERT
  if new.status <> 'active' then
    perform public.fn_cq_raise_internal('VQ005', '新確認紀錄必須是 active');
  end if;
  select id, project_id, unit, coalesce(is_leaf, false) as is_leaf, coalesce(is_billable, true) as is_billable,
         coalesce(is_rollup, false) as is_rollup
    into w from public.work_items where id = new.work_item_id;
  if not found then perform public.fn_cq_raise_internal('VQ008', '找不到工項'); end if;
  if w.project_id <> new.project_id then
    perform public.fn_cq_raise_internal('VQ008', '工項不屬於本專案(跨專案)');
  end if;
  if not (w.is_leaf and w.is_billable and not w.is_rollup) then
    perform public.fn_cq_raise_internal('VQ005', '只有末端且可計價的工項可簽確認量');
  end if;
  if w.unit is null or btrim(w.unit) = '' then
    perform public.fn_cq_raise_internal('VQ005', '工項沒有計量單位,不可簽確認量');
  end if;
  perform public.fn_cq_check_unit(new.unit, w.unit);
  new.batch_key := public.fn_cq_batch_key(new.batch_key);
  new.stage_key := nullif(public.fn_cq_normalize_text(new.stage_key), '');
  new.qty_cum   := public.fn_cq_qty(new.qty_cum, '確認量');
  stages := public.fn_cq_required_stages_internal(new.work_item_id);
  if cardinality(stages) = 0 then
    if new.stage_key is not null then
      perform public.fn_cq_raise_internal('VQ005', format('此工項沒有必要查驗階段,確認紀錄不可帶階段「%s」', new.stage_key));
    end if;
  elsif new.stage_key is null or not (new.stage_key = any(stages)) then
    perform public.fn_cq_raise_internal('VQ005',
      format('階段「%s」不在此工項的必要查驗階段 %s 之中', coalesce(new.stage_key, '(未填)'), array_to_string(stages, '、')));
  end if;
  if not public.fn_cq_can_confirm_internal(new.project_id, new.confirmed_by) then
    perform public.fn_cq_raise_internal('VQ001', '確認人必須是本案監造成員');
  end if;
  if new.basis = 'inspection' then
    if new.inspection_id is null then
      perform public.fn_cq_raise_internal('VQ005', '查驗依據的確認紀錄必須連結查驗');
    end if;
  end if;
  if new.inspection_id is not null then
    select project_id, work_item_id, status into insp from public.inspections where id = new.inspection_id;
    if not found or insp.project_id <> new.project_id then
      perform public.fn_cq_raise_internal('VQ008', '查驗不屬於本專案');
    end if;
    if insp.work_item_id is not null and insp.work_item_id <> new.work_item_id then
      perform public.fn_cq_raise_internal('VQ005', '查驗的工項與確認紀錄不同');
    end if;
    if insp.status = '待查驗' then
      perform public.fn_cq_raise_internal('VQ005', '查驗尚未判定,不可寫入確認量');
    end if;
  end if;
  if new.document_id is not null then
    select project_id, doc_type into doc from public.field_documents where id = new.document_id;
    if not found or doc.project_id <> new.project_id then
      perform public.fn_cq_raise_internal('VQ008', '文件不屬於本專案');
    end if;
    if doc.doc_type <> 'inspection_form' then
      perform public.fn_cq_raise_internal('VQ005', '確認紀錄只能追溯到監造查驗表單');
    end if;
    select content_hash into ver from public.field_document_versions
      where document_id = new.document_id and version_no = new.document_version_no;
    if not found or ver.content_hash is distinct from new.content_hash then
      perform public.fn_cq_raise_internal('VQ005', '確認紀錄的內容雜湊與文件版本不符');
    end if;
    if not exists (select 1 from public.field_document_signatures s
                   where s.document_id = new.document_id and s.version_no = new.document_version_no
                     and s.content_hash = new.content_hash and s.signer_id = new.confirmed_by) then
      perform public.fn_cq_raise_internal('VQ005', '文件版本尚未由確認人簽署');
    end if;
  end if;
  -- 累計語意:與同 (工項, 批次, 階段) 最新一筆 active 的差=本次增減;減量必填原因
  select id, qty_cum into prev from public.inspection_confirmations
    where project_id = new.project_id and work_item_id = new.work_item_id
      and batch_key = new.batch_key and stage_key is not distinct from new.stage_key and status = 'active'
    order by confirmed_at desc, created_at desc, id desc limit 1;
  if found then
    new.qty_delta := new.qty_cum - prev.qty_cum;
    new.supersedes_id := prev.id;
  else
    new.qty_delta := new.qty_cum;
    new.supersedes_id := null;
  end if;
  if new.qty_delta < 0 and (new.reason is null or btrim(new.reason) = '') then
    perform public.fn_cq_raise_internal('VQ005', format('累計確認量由 %s 減為 %s,減量必須填寫原因', public.fn_cq_txt(prev.qty_cum), public.fn_cq_txt(new.qty_cum)));
  end if;
  new.revoked_at := null; new.revoked_by := null;
  return new;
end; $$;
revoke all on function public.inspection_confirmations_guard() from public, anon, authenticated;

create or replace function public.issue_supervisor_certificate(
  p_project_id uuid, p_work_item_id uuid, p_batch_key text, p_location_label text, p_stage_key text,
  p_unit text, p_qty_cum numeric, p_reason text, p_client_request_id text default null,
  p_covers_valuation_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  existing public.inspection_confirmations;
  c        public.inspection_confirmations;
  v_aal    text;
  v_prev   text;
  cov      public.valuations;
  legacy_q numeric;
  target   uuid;
  v_key    text;
begin
  if auth.uid() is null then perform public.fn_cq_raise_internal('VQ001', '請先登入'); end if;
  if p_project_id not in (select public.my_project_ids()) then
    perform public.fn_cq_raise_internal('VQ008', '找不到專案或無權存取');
  end if;
  if not (public.my_org_type() = 'supervisor' or public.admin_override(p_project_id)) then
    perform public.fn_cq_raise_internal('VQ001', '只有監造可簽發監造確認單');
  end if;
  -- R1(20260919023220)全面移除兩步驟驗證:簽發身分=已登入的本案監造成員;aal 只作證據欄位記入稽核
  v_aal := public.current_jwt_aal();
  if p_reason is null or btrim(p_reason) = '' then
    perform public.fn_cq_raise_internal('VQ005', '確認單必須填寫依據／說明');
  end if;
  perform set_config('lock_timeout', '5s', true);
  perform public.fn_cq_lock_internal(p_project_id, p_work_item_id);
  v_key := public.fn_cq_batch_key(p_batch_key);
  -- 冪等:同 client_request_id 重播回同一筆;內容不同 VQ009
  if p_client_request_id is not null then
    select * into existing from public.inspection_confirmations
      where project_id = p_project_id and client_request_id = p_client_request_id;
    if found then
      if existing.work_item_id = p_work_item_id and existing.batch_key = v_key
         and existing.stage_key is not distinct from nullif(public.fn_cq_normalize_text(p_stage_key), '')
         and existing.qty_cum = public.fn_cq_qty(p_qty_cum, '確認量') then
        return jsonb_build_object('applied', false, 'confirmation_id', existing.id, 'qty_delta', existing.qty_delta,
          'message', '同一請求已處理(冪等)');
      end if;
      perform public.fn_cq_raise_internal('VQ009', 'client_request_id 已用於不同內容的請求');
    end if;
  end if;
  if p_covers_valuation_id is not null then
    perform set_config('pmis.cq_defer_allocate', '1', true);
  end if;
  insert into public.inspection_confirmations (project_id, work_item_id, batch_key, location_label, stage_key, unit, qty_cum,
    basis, client_request_id, confirmed_by, confirmed_at, reason)
    values (p_project_id, p_work_item_id, v_key, p_location_label, p_stage_key, p_unit, p_qty_cum,
      'supervisor_certificate', p_client_request_id, auth.uid(), clock_timestamp(), btrim(p_reason))
    returning * into c;
  perform public.record_audit_event(p_project_id, 'confirmation.issued', 'inspection_confirmation', c.id, 'issued',
    null, to_jsonb(c), jsonb_build_object('basis', 'supervisor_certificate', 'aal', v_aal, 'covers_valuation_id', p_covers_valuation_id), null);
  -- 補證:已核定／已請款期別的 legacy 來源改掛到本確認單的批次(數量不變;留痕)
  if p_covers_valuation_id is not null then
    select * into cov from public.valuations where id = p_covers_valuation_id for update;
    if not found or cov.project_id <> p_project_id then
      perform public.fn_cq_raise_internal('VQ008', '被補證的估驗期別不屬於本專案');
    end if;
    if cov.status not in ('已核定', '已請款') then
      perform public.fn_cq_raise_internal('VQ010', '只有已核定／已請款的期別需要補證;草稿請直接重算');
    end if;
    select coalesce(sum(qty), 0) into legacy_q from public.valuation_item_sources
      where valuation_id = cov.id and work_item_id = p_work_item_id and kind = 'legacy';
    if legacy_q = 0 then
      perform public.fn_cq_raise_internal('VQ005', '該期別此工項沒有歷史遷移來源需要補證');
    end if;
    if c.stage_key is not null then
      perform public.fn_cq_raise_internal('VQ005', '補證確認單不可帶階段(多階段工項請逐階段簽後再補證)');
    end if;
    v_prev := public.fn_cq_set_internal(true);
    delete from public.valuation_item_sources where valuation_id = cov.id and work_item_id = p_work_item_id and kind = 'legacy';
    insert into public.valuation_item_sources (project_id, valuation_id, work_item_id, batch_key, qty, kind, confirmation_id)
      values (p_project_id, cov.id, p_work_item_id, c.batch_key, legacy_q, 'confirmation', c.id);
    update public.valuation_items set backing = 'confirmed'
      where valuation_id = cov.id and work_item_id = p_work_item_id
        and not exists (select 1 from public.valuation_item_sources s
                        where s.valuation_id = cov.id and s.work_item_id = p_work_item_id and s.kind = 'legacy');
    perform public.fn_cq_restore_internal(v_prev);
    perform public.record_audit_event(p_project_id, 'valuation.legacy_covered', 'valuation', cov.id, 'legacy_covered',
      null, null, jsonb_build_object('work_item_id', p_work_item_id, 'qty', legacy_q, 'confirmation_id', c.id,
        'batch_key', c.batch_key, 'reason', btrim(p_reason)), null);
    perform set_config('pmis.cq_defer_allocate', '', true);
    -- 補證後剩餘的可用量再同步到適用草稿期
    target := public.fn_cq_target_draft_internal(p_project_id, c.confirmed_at);
    if target is not null then
      v_prev := public.fn_cq_set_internal(true);
      perform public.fn_cq_allocate_to_cap_internal(target, p_work_item_id);
      perform public.fn_cq_restore_internal(v_prev);
    end if;
  end if;
  return jsonb_build_object('applied', true, 'confirmation_id', c.id, 'qty_cum', c.qty_cum, 'qty_delta', c.qty_delta,
    'batch_key', c.batch_key, 'stage_key', c.stage_key, 'supersedes_id', c.supersedes_id);
exception when lock_not_available then
  perform public.fn_cq_raise_internal('VQ007', '工項正被其他操作使用,請稍後再試');
end; $$;
revoke all on function public.issue_supervisor_certificate(uuid, uuid, text, text, text, text, numeric, text, text, uuid) from public, anon;
grant execute on function public.issue_supervisor_certificate(uuid, uuid, text, text, text, text, numeric, text, text, uuid) to authenticated;

create or replace function public.revoke_inspection_confirmation(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c       public.inspection_confirmations;
  effects jsonb;
begin
  if auth.uid() is null then perform public.fn_cq_raise_internal('VQ001', '請先登入'); end if;
  perform set_config('lock_timeout', '5s', true);
  select * into c from public.inspection_confirmations where id = p_id for update;
  if not found or c.project_id not in (select public.my_project_ids()) then
    perform public.fn_cq_raise_internal('VQ008', '找不到確認紀錄或無權存取');
  end if;
  if not (public.my_org_type() = 'supervisor' or public.admin_override(c.project_id)) then
    perform public.fn_cq_raise_internal('VQ001', '只有監造可撤銷確認');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    perform public.fn_cq_raise_internal('VQ005', '撤銷確認必須填寫原因');
  end if;
  if c.status = 'revoked' then
    return jsonb_build_object('applied', false, 'status', 'revoked', 'message', '此確認已撤銷');
  end if;
  update public.inspection_confirmations
    set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), reason = btrim(p_reason)
    where id = p_id;
  perform public.record_audit_event(c.project_id, 'confirmation.revoked', 'inspection_confirmation', c.id, 'revoked',
    to_jsonb(c), null, jsonb_build_object('reason', btrim(p_reason)), null);
  -- 收斂結果(trigger 已執行)彙整給前端
  select coalesce(jsonb_agg(jsonb_build_object('event_type', e.event_type, 'entity_id', e.entity_id, 'metadata', e.metadata)), '[]'::jsonb)
    into effects
  from public.audit_events e
  where e.project_id = c.project_id and e.metadata ->> 'confirmation_id' = c.id::text
    and e.event_type in ('valuation.allocation_reduced', 'valuation.recheck_flagged', 'valuation_adjustment.created');
  return jsonb_build_object('applied', true, 'status', 'revoked', 'effects', effects);
exception when lock_not_available then
  perform public.fn_cq_raise_internal('VQ007', '確認紀錄正被其他操作使用,請稍後再試');
end; $$;
revoke all on function public.revoke_inspection_confirmation(uuid, text) from public, anon;
grant execute on function public.revoke_inspection_confirmation(uuid, text) to authenticated;

create or replace function public.field_document_sign_inspection_form_internal(
  p_doc public.field_documents, p_ver public.field_document_versions, p_uid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c          jsonb := p_ver.content;
  v_frame    jsonb := public.fn_field_document_template('inspection_form');
  v_insp     public.inspections%rowtype;
  v_wi       record;
  v_tpl_id   uuid;
  v_tpl_title text;
  v_tpl_items jsonb;
  v_tpl_kind text;
  v_key      text;
  v_val      jsonb;
  v_item     jsonb;
  v_src      jsonb;
  v_judge    jsonb;
  v_stages   text[];
  v_stage    text;
  v_batch    text;
  v_declared numeric;
  v_confirm  numeric;
  v_verdict  text;
  v_note     text;
  v_self     uuid;
  v_prev     record;
  v_prev_cum numeric;
  v_signed   timestamptz;
  v_conf_id  uuid;
begin
  if auth.uid() is null or auth.uid() <> p_uid then
    raise exception '簽署分支只能由簽署 RPC 於登入者交易內呼叫';
  end if;
  if (c ? 'location'      and jsonb_typeof(c -> 'location')      not in ('string', 'null'))
  or (c ? 'stage_key'     and jsonb_typeof(c -> 'stage_key')     not in ('string', 'null'))
  or (c ? 'unit'          and jsonb_typeof(c -> 'unit')          not in ('string', 'null'))
  or (c ? 'result_note'   and jsonb_typeof(c -> 'result_note')   not in ('string', 'null'))
  or (c ? 'note'          and jsonb_typeof(c -> 'note')          not in ('string', 'null'))
  or (c ? 'verdict'       and jsonb_typeof(c -> 'verdict')       not in ('string', 'null'))
  or (c ? 'declared_qty'  and jsonb_typeof(c -> 'declared_qty')  not in ('number', 'null'))
  or (c ? 'confirmed_qty' and jsonb_typeof(c -> 'confirmed_qty') not in ('number', 'null'))
  or (c ? 'results'       and jsonb_typeof(c -> 'results')       not in ('object', 'null'))
  or (c ? 'template'      and jsonb_typeof(c -> 'template')      not in ('object', 'null')) then
    raise exception using errcode = 'PD010',
      message = '內容形狀不符:位置／階段／單位／說明／備註／判定須為文字,申報與確認數量須為數字,查驗結果與範本須為物件';
  end if;
  if c -> 'template' is not null and jsonb_typeof(c -> 'template') = 'object'
     and (c -> 'template' ->> 'key') is distinct from (v_frame ->> 'key') then
    raise exception using errcode = 'PD010',
      message = format('範本 %s 不是目前的監造查驗表單範本(%s)', coalesce(c -> 'template' ->> 'key', '(無)'), v_frame ->> 'key');
  end if;

  -- 查驗日期=文件業務日期
  if nullif(c ->> 'inspection_date', '') is null then
    raise exception using errcode = 'PD010', message = '內容缺少查驗日期 inspection_date';
  end if;
  begin
    if (c ->> 'inspection_date')::date <> p_doc.doc_date then
      raise exception using errcode = 'PD010',
        message = format('內容的查驗日期(%s)與文件業務日期(%s)不符', c ->> 'inspection_date', p_doc.doc_date);
    end if;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = 'PD010', message = '內容的 inspection_date 不是合法日期';
  end;

  -- 查驗申請:本案、與文件綁定一致(target_key／target_id)、未由另一份表單判定
  if nullif(c ->> 'inspection_id', '') is null then
    raise exception using errcode = 'PD010', message = '內容缺少查驗申請 inspection_id';
  end if;
  begin
    select * into v_insp from public.inspections i where i.id = (c ->> 'inspection_id')::uuid for update;
  exception when invalid_text_representation then
    raise exception using errcode = 'PD010', message = '查驗申請 inspection_id 不是合法 UUID';
  end;
  if v_insp.id is null or v_insp.project_id <> p_doc.project_id then
    raise exception using errcode = 'PD010', message = '查驗申請不存在或不屬於本專案';
  end if;
  if (p_doc.target_key is not null and p_doc.target_key <> v_insp.id::text)
     or (p_doc.target_id is not null and p_doc.target_id <> v_insp.id) then
    raise exception using errcode = 'PD010', message = '內容的查驗申請與本表單綁定的查驗不同;一份表單只對應一份查驗申請';
  end if;
  if v_insp.document_id is not null and v_insp.document_id <> p_doc.id then
    raise exception using errcode = 'PD008',
      message = format('此查驗已由另一份監造查驗表單(%s)判定;請在該表單建立更正版本', v_insp.document_id);
  end if;

  -- 工項:本案末端可計價、有單位;與查驗申請一致;內容單位須等於工項單位
  if nullif(c ->> 'work_item_id', '') is null then
    raise exception using errcode = 'PD010', message = '內容缺少工項 work_item_id(確認數量須掛工項)';
  end if;
  begin
    select w.id, w.project_id, w.unit, coalesce(w.is_leaf, false) as is_leaf, coalesce(w.is_billable, true) as is_billable,
           coalesce(w.is_rollup, false) as is_rollup
      into v_wi from public.work_items w where w.id = (c ->> 'work_item_id')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'PD010', message = '工項 work_item_id 不是合法 UUID';
  end;
  if v_wi.id is null or v_wi.project_id <> p_doc.project_id then
    raise exception using errcode = 'PD010', message = '工項不存在或不屬於本專案';
  end if;
  if not (v_wi.is_leaf and v_wi.is_billable and not v_wi.is_rollup) then
    raise exception using errcode = 'PD010', message = '只有末端且可計價的工項可簽確認數量';
  end if;
  if nullif(btrim(coalesce(v_wi.unit, '')), '') is null then
    raise exception using errcode = 'PD010', message = '工項沒有計量單位,不可簽確認數量';
  end if;
  if v_insp.work_item_id is not null and v_insp.work_item_id <> v_wi.id then
    raise exception using errcode = 'PD010', message = '表單工項與查驗申請的工項不同;請以查驗申請的工項為準';
  end if;
  if public.fn_cq_normalize_text(c ->> 'unit') <> public.fn_cq_normalize_text(v_wi.unit) then
    raise exception using errcode = 'PD010',
      message = format('單位不一致:表單單位「%s」≠ 標單工項單位「%s」', coalesce(c ->> 'unit', ''), v_wi.unit);
  end if;

  -- 位置=批次鍵;階段須在工項的 ITP 必要階段內(單階段工項不可帶)
  if nullif(btrim(coalesce(c ->> 'location', '')), '') is null then
    raise exception using errcode = 'PD010', message = '內容缺少施作位置／批次 location(確認數量以此累計)';
  end if;
  v_batch  := public.fn_cq_batch_key(c ->> 'location');
  -- E 包:確認量的 read-then-insert 必須在逐工項交易鎖內(與 issue_supervisor_certificate 同一把鎖、
  -- 同樣 5s lock_timeout)。工項與位置此時都已驗過,取鎖之後再讀 inspection_confirmations 才可序列化。
  perform set_config('lock_timeout', '5s', true);
  perform public.fn_cq_lock_internal(p_doc.project_id, v_wi.id);
  v_stage  := nullif(public.fn_cq_normalize_text(c ->> 'stage_key'), '');
  v_stages := public.fn_cq_required_stages_internal(v_wi.id);
  if cardinality(v_stages) = 0 then
    if v_stage is not null then
      raise exception using errcode = 'PD010',
        message = format('此工項沒有必要查驗階段(檢驗停留點無 H 點),表單不可帶階段「%s」', c ->> 'stage_key');
    end if;
  elsif v_stage is null or not (v_stage = any(v_stages)) then
    raise exception using errcode = 'PD010',
      message = format('查驗階段「%s」不在此工項的必要查驗階段 %s 之中', coalesce(c ->> 'stage_key', '(未填)'), array_to_string(v_stages, '、'));
  end if;

  -- 申報量:非負;查驗申請已載明時必須相同
  if c -> 'declared_qty' is null or c -> 'declared_qty' = 'null'::jsonb then
    raise exception using errcode = 'PD010', message = '內容缺少申報數量 declared_qty';
  end if;
  begin
    v_declared := public.fn_cq_qty((c ->> 'declared_qty')::numeric, '申報數量');
  exception when others then
    raise exception using errcode = 'PD010', message = format('申報數量不合法:%s', sqlerrm);
  end;
  if v_insp.declared_qty is not null and v_insp.declared_qty <> v_declared then
    raise exception using errcode = 'PD010',
      message = format('表單申報數量 %s 與查驗申請的申報數量 %s 不符;申報量以查驗申請為準', public.fn_cq_txt(v_declared), public.fn_cq_txt(v_insp.declared_qty));
  end if;

  -- 判定與確認量:人填;合格=確認等於申報、部分合格=0<確認<申報、不合格=0
  v_verdict := nullif(btrim(coalesce(c ->> 'verdict', '')), '');
  if v_verdict is null or v_verdict not in ('合格', '部分合格', '不合格') then
    raise exception using errcode = 'PD010', message = '判定 verdict 必須是 合格／部分合格／不合格 之一(由監造親自判定)';
  end if;
  if c -> 'confirmed_qty' is null or c -> 'confirmed_qty' = 'null'::jsonb then
    raise exception using errcode = 'PD010', message = '內容缺少本次確認數量 confirmed_qty(不合格請填 0)';
  end if;
  begin
    v_confirm := public.fn_cq_qty((c ->> 'confirmed_qty')::numeric, '本次確認數量');
  exception when others then
    raise exception using errcode = 'PD010', message = format('本次確認數量不合法:%s', sqlerrm);
  end;
  if v_confirm > v_declared then
    raise exception using errcode = 'PD010',
      message = format('本次確認數量 %s 超過申報數量 %s', public.fn_cq_txt(v_confirm), public.fn_cq_txt(v_declared));
  end if;
  if v_verdict = '合格' and v_confirm <> v_declared then
    raise exception using errcode = 'PD010',
      message = format('判定合格時本次確認數量須等於申報數量 %s(目前 %s);未全數通過請判部分合格', public.fn_cq_txt(v_declared), public.fn_cq_txt(v_confirm));
  elsif v_verdict = '部分合格' and not (v_confirm > 0 and v_confirm < v_declared) then
    raise exception using errcode = 'PD010',
      message = format('判定部分合格時本次確認數量須大於 0 且小於申報數量 %s(目前 %s)', public.fn_cq_txt(v_declared), public.fn_cq_txt(v_confirm));
  elsif v_verdict = '不合格' and v_confirm <> 0 then
    raise exception using errcode = 'PD010', message = format('判定不合格時本次確認數量須為 0(目前 %s)', public.fn_cq_txt(v_confirm));
  end if;
  v_note := nullif(btrim(coalesce(c ->> 'result_note', '')), '');
  if v_verdict <> '合格' and v_note is null then
    raise exception using errcode = 'PD010', message = format('判定%s必須填寫判定說明 result_note(作為缺失說明)', v_verdict);
  end if;

  -- 檢附的自主檢查(選填):本案
  if nullif(c ->> 'self_check_record_id', '') is not null then
    begin
      v_self := (c ->> 'self_check_record_id')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'PD010', message = '檢附之自主檢查 self_check_record_id 不是合法 UUID';
    end;
    if not exists (select 1 from public.checklist_records r where r.id = v_self and r.project_id = p_doc.project_id) then
      raise exception using errcode = 'PD010', message = '檢附之自主檢查紀錄不存在或不屬於本專案';
    end if;
  end if;

  -- 查驗項目(選填範本):本案、用途=監造查驗;每個鍵必須是範本項次;值型別;na 值空、非 na 值不空;任一不合格不得判合格
  if nullif(c ->> 'template_id', '') is not null then
    begin
      select t.id, t.title, t.items, t.kind into v_tpl_id, v_tpl_title, v_tpl_items, v_tpl_kind from public.checklist_templates t
        where t.id = (c ->> 'template_id')::uuid and t.project_id = p_doc.project_id;
    exception when invalid_text_representation then
      raise exception using errcode = 'PD010', message = '查驗表範本 template_id 不是合法 UUID';
    end;
    if v_tpl_id is null then
      raise exception using errcode = 'PD010', message = '查驗表範本不存在或不屬於本專案';
    end if;
    if v_tpl_kind <> 'inspection_form' then
      raise exception using errcode = 'PD010', message = format('範本「%s」不是監造查驗用途(kind=%s)', v_tpl_title, v_tpl_kind);
    end if;
    for v_key, v_val in select key, value from jsonb_each(coalesce(nullif(c -> 'results', 'null'::jsonb), '{}'::jsonb)) loop
      select it into v_item from jsonb_array_elements(coalesce(v_tpl_items, '[]'::jsonb)) it where it ->> 'no' = v_key;
      if v_item is null then
        raise exception using errcode = 'PD010', message = format('項次「%s」不在範本「%s」內', v_key, v_tpl_title);
      end if;
      if jsonb_typeof(v_val) <> 'object' then
        raise exception using errcode = 'PD010', message = format('項次「%s」的結果須為物件({value})', v_key);
      end if;
      v_src := p_ver.field_sources -> ('results.' || v_key);
      if v_src ->> 'status' = 'na' then
        if v_val -> 'value' is not null and v_val -> 'value' <> 'null'::jsonb then
          raise exception using errcode = 'PD010', message = format('項次「%s」標為不適用,但仍有值', v_key);
        end if;
        continue;
      end if;
      if v_val -> 'value' is null or v_val -> 'value' = 'null'::jsonb then
        raise exception using errcode = 'PD010', message = format('項次「%s」已確認但沒有值;未檢請標不適用並填原因', v_key);
      end if;
      if v_item ->> 'kind' = 'bool' then
        if jsonb_typeof(v_val -> 'value') <> 'boolean' then
          raise exception using errcode = 'PD010', message = format('項次「%s」是勾選項,值須為 true／false', v_key);
        end if;
      elsif jsonb_typeof(v_val -> 'value') <> 'number' then
        raise exception using errcode = 'PD010', message = format('項次「%s」是實測值,須為數字', v_key);
      end if;
    end loop;
    v_judge := public.fn_checklist_judge(coalesce(v_tpl_items, '[]'::jsonb), coalesce(nullif(c -> 'results', 'null'::jsonb), '{}'::jsonb));
    if v_judge ->> 'overall' = '不合格' and v_verdict = '合格' then
      raise exception using errcode = 'PD010',
        message = format('查驗項目 %s 不合格,不得判定合格', array_to_string(array(select jsonb_array_elements_text(v_judge -> 'failed')), '、'));
    end if;
  elsif c -> 'results' is not null and jsonb_typeof(c -> 'results') = 'object' and c -> 'results' <> '{}'::jsonb then
    raise exception using errcode = 'PD010', message = '有查驗項目結果但未指定查驗表範本 template_id';
  end if;

  -- 同查驗已有有效確認:同工項同階段同量=冪等(不重複累加);不同=先撤銷(P4b revoke_inspection_confirmation)再重簽
  select id, qty_delta, stage_key, work_item_id into v_prev from public.inspection_confirmations
    where inspection_id = v_insp.id and status = 'active' order by confirmed_at desc limit 1;
  if v_prev.id is not null then
    if v_verdict = '不合格' or v_prev.work_item_id <> v_wi.id or v_prev.stage_key is distinct from v_stage or v_prev.qty_delta <> v_confirm then
      raise exception using errcode = 'PD008',
        message = format('此查驗已有有效的監造確認量 %s(紀錄 %s);更正判定或數量請先撤銷該確認紀錄再重新簽署', public.fn_cq_txt(v_prev.qty_delta), v_prev.id);
    end if;
  end if;

  select s.signed_at into v_signed from public.field_document_signatures s
    where s.document_id = p_doc.id and s.version_no = p_ver.version_no and s.signer_id = p_uid;
  if v_signed is null then
    raise exception '簽署列尚未建立,無法寫入判定';
  end if;

  -- 判定落 inspections(guard 以交易內 GUC 放行簽署專屬欄)
  update public.inspections
     set status = v_verdict, result_note = v_note, inspected_by = p_uid, inspected_at = v_signed,
         work_item_id = v_wi.id, location = btrim(c ->> 'location'), stage_key = v_stage,
         declared_qty = v_declared, confirmed_qty = v_confirm,
         template_id = v_tpl_id, results = v_judge -> 'results',
         document_id = p_doc.id, document_version_no = p_ver.version_no,
         checklist_record_id = coalesce(v_self, checklist_record_id)
   where id = v_insp.id;

  -- 確認量(累計語意:此工項此批次此階段的前次有效累計 ＋ 本次確認;P4b guard 驗其餘不變量,AFTER trigger 收斂並同步草稿期)
  if v_confirm > 0 and v_prev.id is null then
    select p.qty_cum into v_prev_cum from public.inspection_confirmations p
      where p.project_id = p_doc.project_id and p.work_item_id = v_wi.id and p.batch_key = v_batch
        and p.stage_key is not distinct from v_stage and p.status = 'active'
      order by p.confirmed_at desc, p.created_at desc, p.id desc limit 1;
    insert into public.inspection_confirmations
      (project_id, work_item_id, batch_key, location_label, stage_key, unit, qty_cum, basis, inspection_id,
       document_id, document_version_no, content_hash, confirmed_by, confirmed_at)
    values (p_doc.project_id, v_wi.id, v_batch, btrim(c ->> 'location'), v_stage, v_wi.unit,
            coalesce(v_prev_cum, 0) + v_confirm, 'inspection', v_insp.id,
            p_doc.id, p_ver.version_no, p_ver.content_hash, p_uid, v_signed)
    returning id into v_conf_id;
  end if;
  return v_insp.id;
end; $$;
revoke all on function public.field_document_sign_inspection_form_internal(public.field_documents, public.field_document_versions, uuid) from public, anon, authenticated;

create or replace function public.valuations_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  org     text;
  is_user boolean := auth.uid() is not null;
  is_adm  boolean;
begin
  if tg_op = 'INSERT' then
    if is_user and new.status <> '草稿' then
      perform public.fn_cq_raise_internal('VQ002', format('估驗期別只能以草稿建立(狀態 %s 須經送審／核定流程)', new.status));
    end if;
    if is_user and (new.recheck_required or new.recheck_note is not null) then
      perform public.fn_cq_raise_internal('VQ010', 'recheck 欄位由系統維護,不可自行設定');
    end if;
    return new;
  end if;

  is_adm := is_user and public.admin_override(new.project_id);
  org := case when is_user then public.my_org_type() else null end;

  -- ── 角色與狀態機(登入者;admin_override 只放行角色,不放行數量) ──
  if is_user and new.status is distinct from old.status then
    -- 跨越已核定／已請款一律監造(既有規則;P0001 沿用)
    if (new.status in ('已核定', '已請款') or old.status in ('已核定', '已請款'))
       and not (org = 'supervisor' or is_adm) then
      raise exception '估驗核定/退回核定僅監造可執行';
    end if;
    if old.status = '草稿' and new.status = '監造審核' then
      if not (org = 'contractor' or is_adm) then
        raise exception '送監造審核僅施工廠商可執行';
      end if;
    elsif old.status = '監造審核' and new.status = '草稿' then
      if not (org = 'supervisor' or is_adm) then
        raise exception '退回估驗僅監造可執行';
      end if;
    elsif (old.status = '監造審核' and new.status = '已核定')
       or (old.status = '已核定' and new.status = '草稿')
       or (old.status = '已核定' and new.status = '已請款')
       or (old.status = '已請款' and new.status = '已核定') then
      null; -- 角色已在上面檢查
    else
      perform public.fn_cq_raise_internal('VQ002', format('估驗狀態 %s → %s 不是允許的轉移', old.status, new.status));
    end if;
  end if;
  if is_user and org = 'owner' and not is_adm and (
       new.period_no      is distinct from old.period_no
    or new.period_start   is distinct from old.period_start
    or new.period_end     is distinct from old.period_end
    or new.valuation_date is distinct from old.valuation_date
    or new.retention_pct  is distinct from old.retention_pct
    or new.status         is distinct from old.status
    or new.note           is distinct from old.note
  ) then
    raise exception '機關僅可登錄請款/撥款欄位(invoice_date / paid_date / paid_amount)';
  end if;
  -- 期別欄位只在草稿可改(登入者);recheck 欄位只由內部重算維護
  if is_user and old.status <> '草稿' and (
       new.period_no is distinct from old.period_no
    or new.period_start is distinct from old.period_start
    or new.period_end is distinct from old.period_end) then
    perform public.fn_cq_raise_internal('VQ010', format('估驗已%s,期別與截止日不可再改', old.status));
  end if;
  if is_user and not public.fn_cq_internal()
     and (new.recheck_required is distinct from old.recheck_required or new.recheck_note is distinct from old.recheck_note) then
    perform public.fn_cq_raise_internal('VQ010', 'recheck 欄位由系統維護,不可自行改寫');
  end if;
  return new;
end; $$;
drop trigger if exists valuations_guard on public.valuations;
create trigger valuations_guard before insert or update on public.valuations
  for each row execute function public.valuations_guard();

create or replace function public.work_item_pricing_basis_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.work_items w where w.id = new.work_item_id and w.project_id = new.project_id) then
    perform public.fn_cq_raise_internal('VQ008', '工項不屬於本專案(跨專案)');
  end if;
  return new;
end; $$;
drop trigger if exists work_item_pricing_basis_guard on public.work_item_pricing_basis;
create trigger work_item_pricing_basis_guard before insert or update on public.work_item_pricing_basis
  for each row execute function public.work_item_pricing_basis_guard();
revoke all on function public.work_item_pricing_basis_guard() from public, anon, authenticated;

create or replace function public.set_work_item_pricing_basis(p_work_item_id uuid, p_basis text, p_rule jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w record;
begin
  if auth.uid() is null then perform public.fn_cq_raise_internal('VQ001', '請先登入'); end if;
  select id, project_id into w from public.work_items where id = p_work_item_id;
  if not found or w.project_id not in (select public.my_project_ids()) then
    perform public.fn_cq_raise_internal('VQ008', '找不到工項或無權存取');
  end if;
  if not (public.my_org_type() = 'supervisor' or public.admin_override(w.project_id)) then
    perform public.fn_cq_raise_internal('VQ001', '只有監造可設定計價依據');
  end if;
  if p_basis is null or p_basis not in ('inspection', 'supervisor_certificate', 'pro_rata', 'excluded') then
    perform public.fn_cq_raise_internal('VQ005', format('計價依據不明:%s', coalesce(p_basis, '(空)')));
  end if;
  insert into public.work_item_pricing_basis (work_item_id, project_id, basis, rule, set_by, set_at)
    values (p_work_item_id, w.project_id, p_basis, p_rule, auth.uid(), now())
    on conflict (work_item_id) do update set basis = excluded.basis, rule = excluded.rule, set_by = excluded.set_by, set_at = excluded.set_at;
  perform public.record_audit_event(w.project_id, 'work_item.pricing_basis_set', 'work_item', p_work_item_id, 'pricing_basis_set',
    null, null, jsonb_build_object('basis', p_basis, 'rule', p_rule), null);
  return jsonb_build_object('work_item_id', p_work_item_id, 'basis', p_basis);
end; $$;
revoke all on function public.set_work_item_pricing_basis(uuid, text, jsonb) from public, anon;
grant execute on function public.set_work_item_pricing_basis(uuid, text, jsonb) to authenticated;
