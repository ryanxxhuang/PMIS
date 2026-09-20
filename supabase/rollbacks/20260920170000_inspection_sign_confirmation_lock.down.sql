-- 回復 20260920170000：把 field_document_sign_inspection_form_internal 換回 20260920004000 的定義，
-- 也就是移除寫 inspection_confirmations 前的 lock_timeout 設定與逐工項 advisory 鎖。
-- 沒有任何資料需要還原（該 migration 只換函式定義，不動任何一列）。
-- 回復之後「兩份查驗表單同時對同一 (工項, 批次, 階段) 簽署」的累計鏈分岔會再度可能發生。

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
comment on function public.field_document_sign_inspection_form_internal(public.field_documents, public.field_document_versions, uuid) is
  'P3c(P3e 起訊息數量經 fn_cq_txt):監造查驗表單簽署分支——驗查驗／工項／單位／位置／階段／申報量／判定／確認量／查驗項目後,更新 inspections(簽署即判定)並依判定寫入 inspection_confirmations(累計;同查驗同量冪等、不同量須先撤銷);缺失由 inspections_defect_sync 開;只由 sign_field_document 呼叫。';
