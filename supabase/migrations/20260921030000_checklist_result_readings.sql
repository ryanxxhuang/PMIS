-- 2026-09-21 廠商驗收 G 包｜檢查項目的「分列讀數」:兩向尺寸(13×11 mm)與不同編號(編號 1／編號 4)可原樣保存、判定、簽署。
--
-- 為什麼:2026-09-20 驗收報告(docs/reviews/2026-09-20-contractor-acceptance-report.md)與實作指令 B.2／B.3 要求
--   「讀到 11×11 mm 必須保留兩向尺寸」「看得清的紙上實測紀錄直接填入對應草稿欄位並標待確認」。B／B2 包把辨識做到
--   三張真實鋼線網紙表的 8 個手寫實測值讀出 7–8 個,但每一筆都是「兩向＋有編號」,而檢查項目的結果只有單一數字
--   results.<no>.value——起稿端只好把它們一律留空待人重打,DB 簽署分支也只認單一數字。結果是:讀對了,表上仍是空的。
--
-- 改什麼(只換函式定義,不動任何一列):
--   1. 新 fn_checklist_num(jsonb):把一個 JSON 值轉成可判定的數字(與既有判定引擎同一條轉換規則,抽成一支給兩處用)。
--   2. fn_checklist_judge:結果物件可帶 readings[](每筆 {entry_no, value, value2, raw_text},數值已是範本單位);
--      非空時取代單一值——每一筆的兩向都要在範本 min／max 內才合格;輸出的 results.<no> 帶回 readings,
--      checklist_records／inspections 的事實列因此保存完整讀數(不截半、不只留一個數)。勾選項不吃 readings。
--   3. 新 fn_checklist_result_check(key, item, val, na):自檢表與查驗表單簽署分支共用的值型別檢核——
--      readings 與 value 擇一;readings 每筆 value 必為數字、value2 為數字或空、entry_no／raw_text 為文字或空、最多 50 筆;
--      勾選項不得有 readings;不適用時兩者皆須為空;已確認不得兩者皆空。錯誤碼與訊息沿用 PD010。
--   4. field_document_sign_self_check_internal(本體逐字沿用 20260919141500)與
--      field_document_sign_inspection_form_internal(本體逐字沿用 20260920230000,含 E 包的確認量鎖與 F2 的內部旗標):
--      只把逐項值型別那段換成呼叫 3。
--   5. field_document_versions_guard(本體逐字沿用 20260919141500):人填欄(human_only)的 results.<no> 若帶非空 readings,
--      與帶單一值一樣拒絕 AI 版本。目前兩類框架範本的實測值都不是 human_only(20260920120000),此段是防回歸。
--
-- 守住的紅線(pgTAP checklist_result_readings.sql 釘住):只標 filled 的項目仍 needs_confirmation 簽不下去;判定仍由伺服器依範本
--   量化標準計算(AI 不參與);value 與 readings 不可並存;非數字讀數、勾選項帶讀數、不適用仍有讀數都拒絕;AI 版本不得在人填欄
--   帶讀數;查驗表單「項目不合格不得判合格」同樣適用分列讀數。
-- 資料保留:不動任何既有列;既有結果沒有 readings,判定結果與先前完全相同(同一組舊案例 pgTAP 仍綠)。
-- 相容:所有函式簽章不變;新增兩支內部 helper 不開給 anon／authenticated。
-- 回復:supabase/rollbacks/20260921030000_checklist_result_readings.down.sql(換回舊定義、drop 兩支 helper)。
--   回復後帶 readings 的草稿無法簽署(簽署分支只認單一數字),已簽署的事實列與版本內容不受影響。

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. fn_checklist_num:一個 JSON 值 → 可判定的數字(數字;布林比照 JS Number 轉 1／0;可轉數字的字串;其餘 null)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_checklist_num(p jsonb)
returns numeric language plpgsql immutable security invoker set search_path = pg_catalog, public as $$
declare
  v_txt text;
begin
  if p is null then return null; end if;
  case jsonb_typeof(p)
    when 'number' then return (p #>> '{}')::numeric;
    when 'boolean' then return case when p = 'true'::jsonb then 1 else 0 end;
    when 'string' then
      v_txt := btrim(p #>> '{}');
      if v_txt <> '' and v_txt ~ '^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$' then return v_txt::numeric; end if;
      return null;
    else return null;
  end case;
end; $$;
revoke all on function public.fn_checklist_num(jsonb) from public, anon, authenticated;
comment on function public.fn_checklist_num(jsonb) is
  'G 包:判定引擎的數字轉換(與前端 judgeItem 的 Number 轉換同一條規則);只在判定引擎內用。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. fn_checklist_judge:支援分列讀數(本體沿用 20260919141500,數字轉換改呼叫 1)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_checklist_judge(p_items jsonb, p_results jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = pg_catalog, public as $$
declare
  it         jsonb;
  v_no       text;
  v_raw      jsonb;
  v_val      jsonb;
  v_readings jsonb;
  r          jsonb;
  v_pass     boolean;
  v_n        numeric;
  v_nums     numeric[];
  v_row      jsonb;
  v_results  jsonb := '{}'::jsonb;
  v_failed   jsonb := '[]'::jsonb;
  v_checked  int := 0;
  v_ok       boolean := true;
begin
  for it in select value from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) loop
    v_no := it ->> 'no';
    if v_no is null then continue; end if;
    v_raw := case when jsonb_typeof(p_results) = 'object' then p_results -> v_no else null end;
    v_val := case when v_raw is not null and jsonb_typeof(v_raw) = 'object' then v_raw -> 'value' else v_raw end;
    -- G 包:分列讀數(兩向尺寸／多編號)非空時取代單一值;勾選項不吃讀數
    v_readings := case when it ->> 'kind' is distinct from 'bool' and v_raw is not null and jsonb_typeof(v_raw) = 'object'
                            and jsonb_typeof(v_raw -> 'readings') = 'array' and jsonb_array_length(v_raw -> 'readings') > 0
                       then v_raw -> 'readings' else null end;
    v_pass := null;
    if it ->> 'kind' = 'bool' then
      v_pass := case when v_val = 'true'::jsonb then true when v_val = 'false'::jsonb then false else null end;
    else
      v_nums := '{}'::numeric[];
      if v_readings is not null then
        -- 每一筆讀數的兩向都要落在範本量化標準內才合格;非數字的讀數不列入(簽署時 fn_checklist_result_check 另擋)
        for r in select value from jsonb_array_elements(v_readings) loop
          if jsonb_typeof(r) <> 'object' then continue; end if;
          v_n := public.fn_checklist_num(r -> 'value');
          if v_n is not null then v_nums := v_nums || v_n; end if;
          v_n := public.fn_checklist_num(r -> 'value2');
          if v_n is not null then v_nums := v_nums || v_n; end if;
        end loop;
      else
        v_n := public.fn_checklist_num(v_val);
        if v_n is not null then v_nums := array[v_n]; end if;
      end if;
      if cardinality(v_nums) > 0 then
        v_pass := true;
        foreach v_n in array v_nums loop
          if (it ->> 'min') is not null and v_n < (it ->> 'min')::numeric then v_pass := false; end if;
          if (it ->> 'max') is not null and v_n > (it ->> 'max')::numeric then v_pass := false; end if;
        end loop;
      end if;
    end if;
    v_row := jsonb_build_object('value', coalesce(v_val, 'null'::jsonb), 'pass', to_jsonb(v_pass));
    if v_readings is not null then v_row := v_row || jsonb_build_object('readings', v_readings); end if;
    v_results := v_results || jsonb_build_object(v_no, v_row);
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
comment on function public.fn_checklist_judge(jsonb, jsonb) is
  'P3b／G:自主檢查表／查驗項目判定引擎(與前端 judgeChecklist 同一條規則):{results:{no:{value,pass[,readings]}}, overall, failed[]};分列讀數每筆兩向都須在範本量化標準內;前端判定只是預覽,伺服器為準。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. fn_checklist_result_check:簽署分支共用的單項值型別檢核(PD010)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_checklist_result_check(p_key text, p_item jsonb, p_val jsonb, p_na boolean)
returns void language plpgsql immutable security invoker set search_path = pg_catalog, public as $$
declare
  v_value    jsonb;
  v_readings jsonb;
  r          jsonb;
  i          int := 0;
begin
  if p_val is null or jsonb_typeof(p_val) <> 'object' then
    raise exception using errcode = 'PD010', message = format('項次「%s」的結果須為物件({value})', p_key);
  end if;
  v_value := nullif(p_val -> 'value', 'null'::jsonb);
  v_readings := nullif(p_val -> 'readings', 'null'::jsonb);
  if v_readings is not null and jsonb_typeof(v_readings) <> 'array' then
    raise exception using errcode = 'PD010', message = format('項次「%s」的分列讀數 readings 須為陣列', p_key);
  end if;
  if v_readings is not null and jsonb_array_length(v_readings) = 0 then v_readings := null; end if;

  if p_na then
    if v_value is not null or v_readings is not null then
      raise exception using errcode = 'PD010', message = format('項次「%s」標為不適用,但仍有值', p_key);
    end if;
    return;
  end if;
  if v_value is null and v_readings is null then
    raise exception using errcode = 'PD010', message = format('項次「%s」已確認但沒有值;未檢請標不適用並填原因', p_key);
  end if;

  if p_item ->> 'kind' = 'bool' then
    if v_readings is not null then
      raise exception using errcode = 'PD010', message = format('項次「%s」是勾選項,不可有分列讀數', p_key);
    end if;
    if jsonb_typeof(v_value) <> 'boolean' then
      raise exception using errcode = 'PD010', message = format('項次「%s」是勾選項,值須為 true／false', p_key);
    end if;
    return;
  end if;

  if v_readings is null then
    if jsonb_typeof(v_value) <> 'number' then
      raise exception using errcode = 'PD010', message = format('項次「%s」是實測值,須為數字', p_key);
    end if;
    return;
  end if;
  if v_value is not null then
    raise exception using errcode = 'PD010',
      message = format('項次「%s」以分列讀數記錄時,單一值 value 須為空(兩種寫法擇一)', p_key);
  end if;
  if jsonb_array_length(v_readings) > 50 then
    raise exception using errcode = 'PD010', message = format('項次「%s」的分列讀數最多 50 筆', p_key);
  end if;
  for r in select value from jsonb_array_elements(v_readings) loop
    i := i + 1;
    if jsonb_typeof(r) <> 'object' then
      raise exception using errcode = 'PD010', message = format('項次「%s」第 %s 筆讀數須為物件', p_key, i);
    end if;
    if jsonb_typeof(r -> 'value') is distinct from 'number' then
      raise exception using errcode = 'PD010', message = format('項次「%s」第 %s 筆讀數須為數字', p_key, i);
    end if;
    if r ? 'value2' and jsonb_typeof(r -> 'value2') not in ('number', 'null') then
      raise exception using errcode = 'PD010', message = format('項次「%s」第 %s 筆的第二向讀數須為數字或留空', p_key, i);
    end if;
    if r ? 'entry_no' and jsonb_typeof(r -> 'entry_no') not in ('string', 'null') then
      raise exception using errcode = 'PD010', message = format('項次「%s」第 %s 筆的編號須為文字', p_key, i);
    end if;
    if r ? 'raw_text' and jsonb_typeof(r -> 'raw_text') not in ('string', 'null') then
      raise exception using errcode = 'PD010', message = format('項次「%s」第 %s 筆的紙上原文須為文字', p_key, i);
    end if;
  end loop;
end; $$;
revoke all on function public.fn_checklist_result_check(text, jsonb, jsonb, boolean) from public, anon, authenticated;
comment on function public.fn_checklist_result_check(text, jsonb, jsonb, boolean) is
  'G 包:自檢表／查驗表單簽署分支共用的單項值型別檢核(value 與 readings 擇一、讀數形狀、不適用為空);錯誤一律 PD010。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4a. 自主檢查表簽署分支(本體逐字沿用 20260919141500,只換逐項值型別那段)
-- ═══════════════════════════════════════════════════════════════════════════
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
    -- G 包:值型別、不適用、分列讀數(兩向尺寸／多編號)統一由 fn_checklist_result_check 驗(與查驗表單同一支)
    v_src := p_ver.field_sources -> ('results.' || v_key);
    perform public.fn_checklist_result_check(v_key, v_item, v_val, coalesce(v_src ->> 'status', '') = 'na');
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 4b. 監造查驗表單簽署分支(本體逐字沿用 20260920230000,只換逐項值型別那段)
-- ═══════════════════════════════════════════════════════════════════════════
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
      -- G 包:值型別、不適用、分列讀數(兩向尺寸／多編號)統一由 fn_checklist_result_check 驗(與自檢表同一支)
      v_src := p_ver.field_sources -> ('results.' || v_key);
      perform public.fn_checklist_result_check(v_key, v_item, v_val, coalesce(v_src ->> 'status', '') = 'na');
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 版本 guard(本體逐字沿用 20260919141500,人填欄多驗 readings)
-- ═══════════════════════════════════════════════════════════════════════════
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
      -- G 包:檢查項目的分列讀數(兩向尺寸／多編號)與單一值同一條規則
      if v_key like 'results.%'
         and jsonb_typeof(new.content -> 'results' -> substr(v_key, 9) -> 'readings') = 'array'
         and jsonb_array_length(new.content -> 'results' -> substr(v_key, 9) -> 'readings') > 0 then
        raise exception '欄位 % 只能由人填寫,AI 版本不得帶入內容(分列讀數)', v_key;
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
