-- 回復 20260921030000:判定引擎、兩個簽署分支與版本 guard 換回前一版定義(逐字取自 20260919141500／20260920230000),
-- drop 兩支 helper(fn_checklist_num、fn_checklist_result_check)。沒有任何資料需要還原(該 migration 不動任何一列)。
-- 回復後:帶 readings 的草稿無法簽署(簽署分支只認單一數字),判定引擎不再看 readings;已簽署的事實列與版本內容不受影響。

create or replace function public.fn_checklist_judge(p_items jsonb, p_results jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = pg_catalog, public as $$
declare
  it        jsonb;
  v_no      text;
  v_raw     jsonb;
  v_val     jsonb;
  v_pass    boolean;
  v_n       numeric;
  v_txt     text;
  v_results jsonb := '{}'::jsonb;
  v_failed  jsonb := '[]'::jsonb;
  v_checked int := 0;
  v_ok      boolean := true;
begin
  for it in select value from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) loop
    v_no := it ->> 'no';
    if v_no is null then continue; end if;
    v_raw := case when jsonb_typeof(p_results) = 'object' then p_results -> v_no else null end;
    v_val := case when v_raw is not null and jsonb_typeof(v_raw) = 'object' then v_raw -> 'value' else v_raw end;
    v_pass := null;
    if it ->> 'kind' = 'bool' then
      v_pass := case when v_val = 'true'::jsonb then true when v_val = 'false'::jsonb then false else null end;
    else
      v_n := null;
      if v_val is not null then
        case jsonb_typeof(v_val)
          when 'number' then v_n := (v_val #>> '{}')::numeric;
          when 'boolean' then v_n := case when v_val = 'true'::jsonb then 1 else 0 end;
          when 'string' then
            v_txt := btrim(v_val #>> '{}');
            if v_txt <> '' and v_txt ~ '^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$' then v_n := v_txt::numeric; end if;
          else v_n := null;
        end case;
      end if;
      if v_n is not null then
        v_pass := true;
        if (it ->> 'min') is not null and v_n < (it ->> 'min')::numeric then v_pass := false; end if;
        if (it ->> 'max') is not null and v_n > (it ->> 'max')::numeric then v_pass := false; end if;
      end if;
    end if;
    v_results := v_results || jsonb_build_object(v_no, jsonb_build_object('value', coalesce(v_val, 'null'::jsonb), 'pass', to_jsonb(v_pass)));
    if v_pass is not null then
      v_checked := v_checked + 1;
      if not v_pass then v_ok := false; v_failed := v_failed || to_jsonb(v_no); end if;
    end if;
  end loop;
  return jsonb_build_object(
    'results', v_results,
    'overall', case when v_checked = 0 then null when v_ok then '合格' else '不合格' end,
    'failed', v_failed);
end; $$;
revoke all on function public.fn_checklist_judge(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.field_document_sign_self_check_internal(
  p_doc public.field_documents, p_ver public.field_document_versions, p_uid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c        jsonb := p_ver.content;
  v_tpl    record;
  v_wi     uuid;
  v_key    text;
  v_val    jsonb;
  v_item   jsonb;
  v_src    jsonb;
  v_judge  jsonb;
  v_prev   public.checklist_records%rowtype;
  v_rec_id uuid;
  v_date   date;
  v_frame  jsonb := public.fn_field_document_template('self_check');
begin
  if auth.uid() is null or auth.uid() <> p_uid then
    raise exception '簽署分支只能由簽署 RPC 於登入者交易內呼叫';
  end if;
  if (c ? 'location'     and jsonb_typeof(c -> 'location')     not in ('string', 'null'))
  or (c ? 'note'         and jsonb_typeof(c -> 'note')         not in ('string', 'null'))
  or (c ? 'work_item_id' and jsonb_typeof(c -> 'work_item_id') not in ('string', 'null'))
  or (c ? 'results'      and jsonb_typeof(c -> 'results')      not in ('object', 'null'))
  or (c ? 'template'     and jsonb_typeof(c -> 'template')     not in ('object', 'null')) then
    raise exception using errcode = 'PD010',
      message = '內容形狀不符:位置／備註須為文字,工項須為 UUID 文字,檢查結果須為物件(以項次為鍵),範本須為物件';
  end if;
  if c -> 'template' is not null and jsonb_typeof(c -> 'template') = 'object'
     and (c -> 'template' ->> 'key') is distinct from (v_frame ->> 'key') then
    raise exception using errcode = 'PD010',
      message = format('範本 %s 不是目前的自主檢查表框架範本(%s)', coalesce(c -> 'template' ->> 'key', '(無)'), v_frame ->> 'key');
  end if;

  -- 檢查日期=文件業務日期
  if nullif(c ->> 'check_date', '') is null then
    raise exception using errcode = 'PD010', message = '內容缺少檢查日期 check_date';
  end if;
  begin
    v_date := (c ->> 'check_date')::date;
  exception when others then
    raise exception using errcode = 'PD010', message = '內容的 check_date 不是合法日期';
  end;
  if v_date <> p_doc.doc_date then
    raise exception using errcode = 'PD010',
      message = format('內容的檢查日期(%s)與文件業務日期(%s)不符', v_date, p_doc.doc_date);
  end if;

  -- 檢查表範本:本案的;項目至少一項
  if nullif(c ->> 'template_id', '') is null then
    raise exception using errcode = 'PD010', message = '內容缺少檢查表範本 template_id';
  end if;
  begin
    select t.id, t.title, t.items into v_tpl from public.checklist_templates t
      where t.id = (c ->> 'template_id')::uuid and t.project_id = p_doc.project_id;
  exception when others then
    raise exception using errcode = 'PD010', message = '檢查表範本 template_id 不是合法 UUID';
  end;
  if v_tpl.id is null then
    raise exception using errcode = 'PD010', message = '檢查表範本不存在或不屬於本專案';
  end if;
  if jsonb_typeof(v_tpl.items) <> 'array' or jsonb_array_length(v_tpl.items) = 0 then
    raise exception using errcode = 'PD010', message = format('範本「%s」沒有任何檢查項目,無法簽署', v_tpl.title);
  end if;

  -- 工項:若給必須是本案的
  if nullif(c ->> 'work_item_id', '') is not null then
    begin
      v_wi := (c ->> 'work_item_id')::uuid;
    exception when others then
      raise exception using errcode = 'PD010', message = '對應工項 work_item_id 不是合法 UUID';
    end;
    if not exists (select 1 from public.work_items w where w.id = v_wi and w.project_id = p_doc.project_id) then
      raise exception using errcode = 'PD010', message = format('工項 %s 不屬於本專案', v_wi);
    end if;
  end if;

  -- 檢查結果:每個鍵必須是範本項次;實測值須為數字、勾選項須為布林;標不適用者值須為空、已確認者值不得為空
  for v_key, v_val in select key, value from jsonb_each(coalesce(nullif(c -> 'results', 'null'::jsonb), '{}'::jsonb)) loop
    select it into v_item from jsonb_array_elements(v_tpl.items) it where it ->> 'no' = v_key;
    if v_item is null then
      raise exception using errcode = 'PD010', message = format('項次「%s」不在範本「%s」內', v_key, v_tpl.title);
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

  v_judge := public.fn_checklist_judge(v_tpl.items, coalesce(nullif(c -> 'results', 'null'::jsonb), '{}'::jsonb));

  -- 已綁事實列(簽後更正再簽)=修訂版次:沿用同範本、更正原因取簽署版本的變更說明
  if p_doc.target_id is not null then
    select * into v_prev from public.checklist_records r where r.id = p_doc.target_id;
    if not found then
      raise exception using errcode = 'PD008', message = '前次簽署的檢查紀錄已不存在,無法建立修訂版次';
    end if;
    if v_prev.template_id is distinct from v_tpl.id then
      raise exception using errcode = 'PD010', message = '修訂版必須沿用前次簽署的檢查表範本;換範本請另立新自主檢查表';
    end if;
    if nullif(btrim(coalesce(p_ver.change_note, '')), '') is null then
      raise exception using errcode = 'PD010', message = '簽後更正必須在存檔時填寫更正原因(版本的變更說明),才能建立修訂版次';
    end if;
  end if;

  insert into public.checklist_records
    (project_id, template_id, check_date, location, work_item_id, results, overall, note, created_by, supersedes_id, revision_reason)
  values (p_doc.project_id, v_tpl.id, p_doc.doc_date, nullif(btrim(coalesce(c ->> 'location', '')), ''), v_wi,
          v_judge -> 'results', v_judge ->> 'overall', nullif(btrim(coalesce(c ->> 'note', '')), ''), p_uid,
          p_doc.target_id, case when p_doc.target_id is not null then btrim(p_ver.change_note) end)
  returning id into v_rec_id;
  return v_rec_id;
end; $$;
revoke all on function public.field_document_sign_self_check_internal(public.field_documents, public.field_document_versions, uuid) from public, anon, authenticated;

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
  v_flag     text;
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
    -- F2:guard 只認內部旗標;簽署者=已驗過簽署列的監造本人(v_signed),旗標只包住這一句 insert
    v_flag := public.fn_cq_set_internal(true);
    insert into public.inspection_confirmations
      (project_id, work_item_id, batch_key, location_label, stage_key, unit, qty_cum, basis, inspection_id,
       document_id, document_version_no, content_hash, confirmed_by, confirmed_at)
    values (p_doc.project_id, v_wi.id, v_batch, btrim(c ->> 'location'), v_stage, v_wi.unit,
            coalesce(v_prev_cum, 0) + v_confirm, 'inspection', v_insp.id,
            p_doc.id, p_ver.version_no, p_ver.content_hash, p_uid, v_signed)
    returning id into v_conf_id;
    perform public.fn_cq_restore_internal(v_flag);
  end if;
  return v_insp.id;
end; $$;
revoke all on function public.field_document_sign_inspection_form_internal(public.field_documents, public.field_document_versions, uuid) from public, anon, authenticated;

create or replace function public.field_document_versions_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid     uuid := auth.uid();
  v_doc   public.field_documents%rowtype;
  v_next  int;
  v_att   jsonb;
  v_pid   uuid;
  v_photo record;
  v_key   text;
  v_val   jsonb;
begin
  if tg_op in ('UPDATE','DELETE') then
    if not exists (select 1 from public.field_documents d where d.id = old.document_id) then
      return coalesce(new, old);  -- 文件／專案刪除 cascade
    end if;
    raise exception '文件版本不可變(UPDATE／DELETE 一律拒絕);更正請建立新版本';
  end if;

  select * into v_doc from public.field_documents d where d.id = new.document_id for update;
  if not found then
    raise exception '文件不存在';
  end if;
  if v_doc.status in ('received','discarded','superseded') then
    raise exception '文件狀態為 %,不可再新增版本', v_doc.status;
  end if;

  select coalesce(max(v.version_no), 0) + 1 into v_next
    from public.field_document_versions v where v.document_id = new.document_id;
  if new.version_no is null then
    new.version_no := v_next;
  elsif new.version_no <> v_next then
    raise exception '版本號必須為下一版(%)', v_next;
  end if;

  if new.author_kind = 'human' then
    if uid is null then
      raise exception '人工版本必須由登入使用者建立(伺服器不得代寫人工版本)';
    end if;
    new.created_by := uid;
  else
    if uid is not null then
      raise exception 'AI 版本只能由伺服器處理程序建立';
    end if;
    new.created_by := null;
    if exists (select 1 from public.field_document_versions v
                where v.document_id = new.document_id and v.author_kind = 'human') then
      raise exception '文件已有人工版本,AI 不得再寫入版本(改以 suggest_field_update 建議)';
    end if;
    -- 人填欄(範本 human_only,如監造日誌到場;自檢表實測值):AI 版本不得帶入值,來源只能留 pending 或不給
    for v_key in select unnest(public.fn_field_document_human_only_keys(v_doc.doc_type, new.content)) loop
      v_val := case when v_key like 'results.%' then new.content -> 'results' -> substr(v_key, 9) -> 'value' else new.content -> v_key end;
      if v_val is not null and v_val not in ('null'::jsonb, '[]'::jsonb, '{}'::jsonb, '""'::jsonb) then
        raise exception '欄位 % 只能由人填寫,AI 版本不得帶入內容', v_key;
      end if;
      if new.field_sources ? v_key
         and coalesce(new.field_sources -> v_key ->> 'status', 'pending') <> 'pending' then
        raise exception '欄位 % 只能由人填寫確認,AI 版本不得標為 %', v_key, new.field_sources -> v_key ->> 'status';
      end if;
    end loop;
  end if;

  if new.amended_from_version is not null then
    if new.amended_from_version >= new.version_no
       or not exists (select 1 from public.field_document_versions v
                       where v.document_id = new.document_id and v.version_no = new.amended_from_version) then
      raise exception '更正來源版本不存在或不早於本版';
    end if;
  end if;

  if new.attachments is not null then
    for v_att in select value from jsonb_array_elements(new.attachments) loop
      if jsonb_typeof(v_att) <> 'object' or (v_att ->> 'photo_id') is null then
        raise exception '附件格式錯誤:每筆需為物件並含 photo_id';
      end if;
      begin
        v_pid := (v_att ->> 'photo_id')::uuid;
      exception when others then
        raise exception '附件 photo_id 不是合法 UUID';
      end;
      select p.project_id, p.storage_path, p.content_sha256 into v_photo
        from public.photos p where p.id = v_pid;
      if not found or v_photo.project_id <> v_doc.project_id then
        raise exception '附件照片不存在或不屬於同一專案';
      end if;
      if (v_att ->> 'storage_path') is not null and v_att ->> 'storage_path' <> v_photo.storage_path then
        raise exception '附件檔案路徑與照片紀錄不符';
      end if;
      if (v_att ->> 'sha256') is not null and v_photo.content_sha256 is not null
         and v_att ->> 'sha256' <> v_photo.content_sha256 then
        raise exception '附件雜湊與照片紀錄不符';
      end if;
    end loop;
  end if;

  new.content_hash := public.fn_field_document_content_hash(new.content, new.attachments);
  new.created_at   := now();
  return new;
end; $$;
revoke all on function public.field_document_versions_guard() from public, anon, authenticated;

drop function if exists public.fn_checklist_result_check(text, jsonb, jsonb, boolean);
drop function if exists public.fn_checklist_num(jsonb);

-- 還原註解
comment on function public.fn_checklist_judge(jsonb, jsonb) is
  'P3b:自主檢查表判定引擎(與前端 judgeChecklist 同一條規則):{results:{no:{value,pass}}, overall, failed[]};前端判定只是預覽,伺服器為準。';
