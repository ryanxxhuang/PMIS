-- ── P3e 共用補值:人補一次,同一批照片產生的草稿各自新增一個人工版本 ─────────────────────────────
-- 問題:一批照片會同時起施工日誌與自主檢查表(監造批次起監造日誌與查驗表單),同一個現場事實(例如某工項當日的
--   施作位置)在每份文件各待補一次,人要逐份打開、逐份填同一個值;P2a 留下的 photo_intakes.shared_inputs 欄與
--   設計 §2.4 的 set_intake_shared_input 一直沒有實作。
-- 本支(設計 docs/architecture/field-documents-lifecycle.md §2.4、§3.4;實作指令 §3.1 第 4 點):
--   1. 共用鍵目錄(單一對照,DB 一份):鍵帶業務日期(一批可跨日,位置／數量不能跨日沿用)——
--        location:<日期>:<工項>  → 施工日誌 items.<工項>.location、自主檢查表 location(對應工項＝該工項)
--        qty:<日期>:<工項>       → 施工日誌 items.<工項>.qty_today
--        weather_am|weather_pm:<日期> → 施工日誌／監造日誌 weather_am／weather_pm
--      監造查驗表單不在目錄內:它的位置是確認數量的批次鍵,同工項不同批次的兩份查驗若共用一個位置會把兩批確認量
--      併成一批(影響計價),只能逐份確認;出工／機具／材料是清單欄且只有施工日誌一份在用,在日誌頁編。
--   2. fn_field_document_apply_shared_inputs:把補值套到一份內容上(單一實作,只在 RPC 內呼叫):
--      欄位現為 pending／filled(系統帶入待核對)／缺鍵,或先前就是同一個共用補值 → 寫入值,來源一律
--      {status:'confirmed', source:'shared:<鍵>', confirmed_by, confirmed_at}(人填,只能 confirmed);
--      欄位已由人在文件頁親自確認或標不適用(來源不是這個共用鍵)→ 不覆蓋(human_value);值與來源已相同 → 不動。
--      Edge 起稿不讀共用補值:確認是人的動作,只存在人工版本(建立者=按下補值的人);補值之後才起稿的新文件在清單上
--      標「尚未套用」,由人以同一支 RPC 重送同值套上(已套用的文件冪等不動)——AI 版本永遠不帶人的確認。
--   3. set_intake_shared_input(p_intake_id, p_key, p_value):批次上傳方成員(can_write 且 my_org_type()=uploader_org,
--      admin_override 例外;與 photo_intakes 更新 policy 同一條)才可補;對象＝這批的文件(intake_id＝本批,或本批
--      候選 document_id 指向的文件——同日施工日誌是全案一份,第二批上傳會接手前一批建的那份),且同專案、
--      owner_org＝上傳方、未捨棄／未被取代:
--        * draft／pending_input 且從未簽署 → 經 save_field_document_version 建人工版本(版本號、必填重算、
--          待補清單、狀態、雜湊全部走既有規則,附件原樣帶過——角色隔離不因補值改變);
--        * 已送內部核對／已簽署／已提送／已收件／被退回,或曾簽署現為簽後更正 → 不動(locked):已簽署文件不因
--          來源後改而變動,簽後更正只在文件頁由人填更正原因;
--        * 他方(不同 owner_org)文件不在對象內:廠商補值永遠碰不到監造文件,反之亦然。
--      冪等:同鍵同值重送,欄位已是這個值的文件不新增版本、shared_inputs 不改時間。
--   4. list_intake_shared_inputs(p_intake_id):批次結果頁用的清單——每個共用鍵的標籤、工項、目前補值,以及
--      每份文件的效果(update／applied／human_value／locked),前端只呈現,不自己判定。
--   5. P4e 交接:監造查驗表單簽署分支(field_document_sign_inspection_form_internal)6 處數量訊息與 inspections_defect_sync
--      的「申報／確認／差額」改經 fn_cq_txt(去掉 numeric(18,4) 的 .0000;只改訊息文字,判定與寫入不變)。
-- 不變:簽署前段與四類分支的判定邏輯(簽署時附件來源檢查 PD005 已由 P2d／P3a–c 覆蓋)、存版 RPC、版本 guard。
-- 權限(H3):authenticated 只多 set_intake_shared_input、list_intake_shared_inputs 兩支;其餘 helper(含套用函式)不開放。
-- 回復:supabase/rollbacks/20260920004000_intake_shared_inputs.down.sql(drop 本支新增函式;已寫入的人工版本與
--   shared_inputs 值保留——版本不可變,shared_inputs 是 P2a 欄位;第 5 點的兩支函式回復＝重跑 20260919222000 的第 4、11 節)。
-- 錯誤代碼沿用 P2d:PD006 無權、PD008 狀態不允許、PD010 輸入不合法。

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 共用鍵目錄
-- ═══════════════════════════════════════════════════════════════════════════
-- 1.1 解析鍵(不合法回空集合;uuid 必須小寫正規形,與清單回傳的鍵同形)
create or replace function public.fn_intake_shared_key_parts(p_key text)
returns table (field text, key_date date, work_item_id uuid)
language plpgsql immutable security invoker set search_path = pg_catalog, public as $$
declare
  m text[];
  v_field text;
  v_date  date;
  v_wi    uuid;
begin
  if p_key is null then
    return;
  end if;
  m := regexp_match(p_key, '^(location|qty):([0-9]{4}-[0-9]{2}-[0-9]{2}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
  if m is null then
    m := regexp_match(p_key, '^(weather_am|weather_pm):([0-9]{4}-[0-9]{2}-[0-9]{2})$');
  end if;
  if m is null then
    return;
  end if;
  begin
    v_field := m[1];
    v_date  := to_date(m[2], 'YYYY-MM-DD');
    v_wi    := case when array_length(m, 1) >= 3 and m[3] is not null then m[3]::uuid end;
  exception when others then
    return;
  end;
  if to_char(v_date, 'YYYY-MM-DD') <> m[2] then
    return;  -- 2026-02-30 之類 to_date 會進位的日期
  end if;
  field := v_field; key_date := v_date; work_item_id := v_wi;
  return next;
end; $$;
revoke all on function public.fn_intake_shared_key_parts(text) from public, anon, authenticated;

-- 1.2 欄位中文(清單與版本更正說明共用)
create or replace function public.fn_intake_shared_field_label(p_field text)
returns text language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select case p_field
    when 'location'   then '施作位置'
    when 'qty'        then '當日完成數量'
    when 'weather_am' then '天氣(上午)'
    when 'weather_pm' then '天氣(下午)'
  end;
$fn$;
revoke all on function public.fn_intake_shared_field_label(text) from public, anon, authenticated;

-- 1.3 值正規化(不合法回 null):位置／天氣=去頭尾空白的非空文字;數量=非負數字(JSON number)
create or replace function public.fn_intake_shared_value(p_field text, p_value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = pg_catalog, public as $$
declare
  v_txt text;
  v_num numeric;
  v_max int;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if p_field in ('location', 'weather_am', 'weather_pm') then
    if jsonb_typeof(p_value) <> 'string' then
      return null;
    end if;
    v_txt := btrim(p_value #>> '{}');
    v_max := case when p_field = 'location' then 200 else 100 end;
    if v_txt = '' or char_length(v_txt) > v_max then
      return null;
    end if;
    return to_jsonb(v_txt);
  elsif p_field = 'qty' then
    if jsonb_typeof(p_value) <> 'number' then
      return null;
    end if;
    v_num := (p_value #>> '{}')::numeric;
    if v_num < 0 or v_num >= 1e12 then
      return null;
    end if;
    return to_jsonb(v_num);
  end if;
  return null;
end; $$;
revoke all on function public.fn_intake_shared_value(text, jsonb) from public, anon, authenticated;

-- 1.4 一份文件(依類型、業務日期、內容)用到哪些共用鍵,以及各鍵對應的欄位路徑(field_sources 的鍵)——單一對照
create or replace function public.fn_field_document_shared_keys(p_doc_type text, p_doc_date date, p_content jsonb)
returns table (key text, field text, path text, work_item_id uuid)
language sql stable security invoker set search_path = pg_catalog, public as $fn$
  with c as (
    select case when jsonb_typeof(p_content) = 'object' then p_content else '{}'::jsonb end as j,
           to_char(p_doc_date, 'YYYY-MM-DD') as ds
  ),
  daily_items as (
    select w.k
      from c, jsonb_each(case when p_doc_type = 'daily_log' and jsonb_typeof(c.j -> 'items') = 'object'
                              then c.j -> 'items' else '{}'::jsonb end) as w(k, v)
     where w.k ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and jsonb_typeof(w.v) = 'object'
  )
  -- 天氣:施工日誌、監造日誌
  select f || ':' || c.ds, f, f, null::uuid
    from c, unnest(array['weather_am', 'weather_pm']) as f
   where p_doc_type in ('daily_log', 'supervisor_log') and p_doc_date is not null
  union all
  -- 施工日誌的工項列:位置、當日完成數量
  select f || ':' || c.ds || ':' || d.k, f, 'items.' || d.k || '.' || case f when 'location' then 'location' else 'qty_today' end, d.k::uuid
    from c, daily_items d, unnest(array['location', 'qty']) as f
   where p_doc_date is not null
  union all
  -- 自主檢查表:檢查位置(以對應工項為鍵)
  select 'location:' || c.ds || ':' || (c.j ->> 'work_item_id'), 'location', 'location', (c.j ->> 'work_item_id')::uuid
    from c
   where p_doc_type = 'self_check' and p_doc_date is not null
     and coalesce(c.j ->> 'work_item_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$fn$;
revoke all on function public.fn_field_document_shared_keys(text, date, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_shared_keys(text, date, jsonb) is
  'P3e:文件用到的共用補值鍵與欄位路徑(location／qty／weather_am／weather_pm,鍵帶業務日期;監造查驗表單不共用位置)。';

-- 1.5 單一欄位的效果:human_value=人已在文件頁親自確認／標不適用(來源不是這個共用鍵,不覆蓋);
--     applied=值與來源已是這個共用補值;update=會寫入(pending／filled／缺鍵,或先前的同鍵補值要更正)
create or replace function public.fn_field_document_shared_effect(p_src jsonb, p_cur jsonb, p_key text, p_value jsonb)
returns text language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select case
    when jsonb_typeof(p_src) = 'object' and p_src ->> 'status' in ('confirmed', 'na')
         and coalesce(p_src ->> 'source', '') <> 'shared:' || p_key then 'human_value'
    when p_value is not null and jsonb_typeof(p_src) = 'object'
         and p_src ->> 'status' = 'confirmed' and p_src ->> 'source' = 'shared:' || p_key
         and p_cur is not distinct from p_value then 'applied'
    else 'update'
  end;
$fn$;
revoke all on function public.fn_field_document_shared_effect(jsonb, jsonb, text, jsonb) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 套用補值(單一實作;不寫任何表,由 set_intake_shared_input 交給存版 RPC)
-- ═══════════════════════════════════════════════════════════════════════════
-- p_shared = {<鍵>: {value, set_by, set_at}}(photo_intakes.shared_inputs 的形狀);回
-- {content, field_sources, applied:[{key,path}], skipped:[{key,path,effect}]}
create or replace function public.fn_field_document_apply_shared_inputs(
  p_doc_type text, p_doc_date date, p_content jsonb, p_field_sources jsonb, p_shared jsonb)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare
  v_content jsonb := case when jsonb_typeof(p_content) = 'object' then p_content else '{}'::jsonb end;
  v_sources jsonb := case when jsonb_typeof(p_field_sources) = 'object' then p_field_sources else '{}'::jsonb end;
  v_applied jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_entry   jsonb;
  v_path    text[];
  v_effect  text;
  r         record;
begin
  if jsonb_typeof(p_shared) is distinct from 'object' then
    return jsonb_build_object('content', v_content, 'field_sources', v_sources, 'applied', v_applied, 'skipped', v_skipped);
  end if;
  for r in select * from public.fn_field_document_shared_keys(p_doc_type, p_doc_date, v_content) loop
    v_entry := p_shared -> r.key;
    continue when jsonb_typeof(v_entry) is distinct from 'object'
               or public.fn_intake_shared_value(r.field, v_entry -> 'value') is null;
    v_path := string_to_array(r.path, '.');
    v_effect := public.fn_field_document_shared_effect(v_sources -> r.path, v_content #> v_path, r.key,
                                                        public.fn_intake_shared_value(r.field, v_entry -> 'value'));
    if v_effect <> 'update' then
      v_skipped := v_skipped || jsonb_build_object('key', r.key, 'path', r.path, 'effect', v_effect);
      continue;
    end if;
    v_content := jsonb_set(v_content, v_path, public.fn_intake_shared_value(r.field, v_entry -> 'value'), true);
    v_sources := jsonb_set(v_sources, array[r.path], jsonb_strip_nulls(jsonb_build_object(
      'status', 'confirmed', 'source', 'shared:' || r.key,
      'confirmed_by', v_entry -> 'set_by', 'confirmed_at', v_entry -> 'set_at')), true);
    v_applied := v_applied || jsonb_build_object('key', r.key, 'path', r.path);
  end loop;
  return jsonb_build_object('content', v_content, 'field_sources', v_sources, 'applied', v_applied, 'skipped', v_skipped);
end; $$;
revoke all on function public.fn_field_document_apply_shared_inputs(text, date, jsonb, jsonb, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_apply_shared_inputs(text, date, jsonb, jsonb, jsonb) is
  'P3e:把批次共用補值套到一份文件內容(人填=confirmed/shared:<鍵>;人已親自確認的欄不覆蓋);只由 set_intake_shared_input 呼叫。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. 批次的文件集合:本批建立的 ∪ 本批候選指向的(同日施工日誌全案一份,可能由前一批建立);同案、同一方、活文件
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_intake_documents(p_intake public.photo_intakes)
returns setof public.field_documents language sql stable security invoker set search_path = public as $fn$
  select d.*
    from public.field_documents d
   where d.project_id = p_intake.project_id
     and d.owner_org = p_intake.uploader_org
     and d.status not in ('discarded', 'superseded')
     and (d.intake_id = p_intake.id
          or d.id in (select (c ->> 'document_id')::uuid
                        from jsonb_array_elements(case when jsonb_typeof(p_intake.candidates) = 'array'
                                                       then p_intake.candidates else '[]'::jsonb end) c
                       where coalesce(c ->> 'document_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
   order by d.doc_date, d.doc_type, d.created_at, d.id;
$fn$;
revoke all on function public.fn_intake_documents(public.photo_intakes) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. set_intake_shared_input:人補一次 → 本批每份仍在草稿／待補的同方文件各建一個人工版本
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.set_intake_shared_input(p_intake_id uuid, p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid       uuid := auth.uid();
  v_intake  public.photo_intakes%rowtype;
  v_field   text;
  v_date    date;
  v_wi      uuid;
  v_value   jsonb;
  v_entry   jsonb;
  v_label   text;
  v_doc_id  uuid;
  v_doc     public.field_documents%rowtype;
  v_ver     public.field_document_versions%rowtype;
  v_path    text;
  v_effect  text;
  v_patched jsonb;
  v_saved   jsonb;
  v_docs    jsonb := '[]'::jsonb;
  v_found   boolean := false;
  v_updated int := 0;
  v_party   text;
begin
  if uid is null then
    raise exception using errcode = 'PD006', message = '請先登入後再補值';
  end if;
  select * into v_intake from public.photo_intakes i where i.id = p_intake_id for update;
  if not found or not public.is_project_member(v_intake.project_id) then
    raise exception using errcode = 'PD006', message = '找不到上傳批次或無權存取';
  end if;
  v_party := case v_intake.uploader_org when 'contractor' then '施工廠商' when 'supervisor' then '監造' else '機關' end;
  if not (public.can_write(v_intake.project_id)
          and (v_intake.uploader_org = public.my_org_type() or public.admin_override(v_intake.project_id))) then
    raise exception using errcode = 'PD006',
      message = format('這批照片由%s上傳,共用補值只能由%s成員填寫', v_party, v_party);
  end if;
  if v_intake.status = 'discarded' then
    raise exception using errcode = 'PD008', message = '已捨棄的上傳批次不可再補值';
  end if;

  select k.field, k.key_date, k.work_item_id into v_field, v_date, v_wi from public.fn_intake_shared_key_parts(p_key) k;
  if v_field is null then
    raise exception using errcode = 'PD010', message = '共用補值的欄位鍵不合法';
  end if;
  if v_wi is not null and not exists (select 1 from public.work_items w where w.id = v_wi and w.project_id = v_intake.project_id) then
    raise exception using errcode = 'PD010', message = '工項不存在或不屬於本專案';
  end if;
  v_value := public.fn_intake_shared_value(v_field, p_value);
  if v_value is null then
    raise exception using errcode = 'PD010',
      message = case v_field when 'qty' then '數量必須是 0 以上的數字'
                             when 'location' then '施作位置請填 1–200 字的文字'
                             else '天氣請填 1–100 字的文字' end;
  end if;
  v_label := public.fn_intake_shared_field_label(v_field)
          || coalesce((select '・' || concat_ws(' ', nullif(w.item_no, ''), w.description) from public.work_items w where w.id = v_wi), '')
          || '・' || to_char(v_date, 'YYYY-MM-DD');
  -- 這次寫入的人工確認:確認者=本人、時間=伺服器
  v_entry := jsonb_build_object('value', v_value, 'set_by', uid, 'set_at', now());

  for v_doc_id in select d.id from public.fn_intake_documents(v_intake) d loop
    select * into v_doc from public.field_documents d where d.id = v_doc_id for update;
    continue when not found or v_doc.status in ('discarded', 'superseded') or v_doc.owner_org <> v_intake.uploader_org;
    select * into v_ver from public.field_document_versions v
      where v.document_id = v_doc.id and v.version_no = v_doc.current_version_no;
    continue when not found;
    select k.path into v_path from public.fn_field_document_shared_keys(v_doc.doc_type, v_doc.doc_date, v_ver.content) k
      where k.key = p_key;
    continue when v_path is null;
    v_found := true;

    if v_doc.status not in ('draft', 'pending_input')
       or exists (select 1 from public.field_document_signatures s where s.document_id = v_doc.id) then
      v_effect := 'locked';
    else
      v_effect := public.fn_field_document_shared_effect(v_ver.field_sources -> v_path,
                    v_ver.content #> string_to_array(v_path, '.'), p_key, v_value);
    end if;

    if v_effect = 'update' then
      v_patched := public.fn_field_document_apply_shared_inputs(v_doc.doc_type, v_doc.doc_date, v_ver.content,
                     v_ver.field_sources, jsonb_build_object(p_key, v_entry));
      -- 走既有存版規則:責任方、樂觀併發、必填／待補重算、狀態、DB 雜湊;附件原樣
      v_saved := public.save_field_document_version(v_doc.id, v_doc.current_version_no, v_patched -> 'content',
                   v_patched -> 'field_sources', v_ver.attachments, '共用補值:' || v_label);
      v_updated := v_updated + 1;
      v_docs := v_docs || jsonb_build_object(
        'document_id', v_doc.id, 'doc_type', v_doc.doc_type, 'doc_date', v_doc.doc_date, 'path', v_path,
        'result', 'updated', 'version_no', v_saved -> 'version_no', 'content_hash', v_saved -> 'content_hash',
        'status', v_saved -> 'status');
    else
      v_docs := v_docs || jsonb_build_object(
        'document_id', v_doc.id, 'doc_type', v_doc.doc_type, 'doc_date', v_doc.doc_date, 'path', v_path,
        'result', case v_effect when 'applied' then 'unchanged' else v_effect end,
        'version_no', v_doc.current_version_no, 'content_hash', v_ver.content_hash, 'status', v_doc.status,
        'current_value', v_ver.content #> string_to_array(v_path, '.'));
    end if;
    v_path := null;
  end loop;

  if not v_found then
    raise exception using errcode = 'PD010', message = '這批照片的文件沒有用到這個欄位(文件可能已改版或移除),請重新整理';
  end if;

  -- 批次的共用補值:值不同才更新(同值重送=冪等,時間與確認者不變)
  if (v_intake.shared_inputs -> p_key -> 'value') is distinct from v_value then
    update public.photo_intakes
       set shared_inputs = shared_inputs || jsonb_build_object(p_key, v_entry)
     where id = v_intake.id;
  end if;

  return jsonb_build_object(
    'intake_id', v_intake.id, 'key', p_key, 'label', v_label, 'value', v_value,
    'updated', v_updated, 'documents', v_docs);
end; $$;
revoke all on function public.set_intake_shared_input(uuid, text, jsonb) from public, anon;
grant execute on function public.set_intake_shared_input(uuid, text, jsonb) to authenticated;
comment on function public.set_intake_shared_input(uuid, text, jsonb) is
  'P3e:批次上傳方補一次共用事實(位置／數量／天氣),本批仍在草稿／待補且從未簽署的同方文件各建一個人工版本(走 save_field_document_version);已簽署／已提送／他方文件不動;同值重送冪等。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. list_intake_shared_inputs:批次結果頁的共用欄位清單與每份文件的效果(前端只呈現)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.list_intake_shared_inputs(p_intake_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  v_intake public.photo_intakes%rowtype;
  v_fields jsonb;
begin
  if uid is null then
    raise exception using errcode = 'PD006', message = '請先登入';
  end if;
  select * into v_intake from public.photo_intakes i where i.id = p_intake_id;
  if not found or not public.is_project_member(v_intake.project_id) then
    raise exception using errcode = 'PD006', message = '找不到上傳批次或無權存取';
  end if;

  with docs as (
    select d.id, d.doc_type, d.doc_date, d.status, d.current_version_no, v.content, v.field_sources,
           exists (select 1 from public.field_document_signatures s where s.document_id = d.id) as has_sig
      from public.fn_intake_documents(v_intake) d
      join public.field_document_versions v on v.document_id = d.id and v.version_no = d.current_version_no
  ),
  per_doc as (
    select sk.key, sk.field, sk.work_item_id, docs.doc_date,
           jsonb_build_object(
             'document_id', docs.id, 'doc_type', docs.doc_type, 'doc_date', docs.doc_date, 'status', docs.status,
             'version_no', docs.current_version_no, 'path', sk.path,
             'current_value', docs.content #> string_to_array(sk.path, '.'),
             'current_source', docs.field_sources -> sk.path,
             'effect', case when docs.status not in ('draft', 'pending_input') or docs.has_sig then 'locked'
                            else public.fn_field_document_shared_effect(docs.field_sources -> sk.path,
                                   docs.content #> string_to_array(sk.path, '.'), sk.key,
                                   public.fn_intake_shared_value(sk.field, v_intake.shared_inputs -> sk.key -> 'value')) end
           ) as doc,
           docs.doc_type, docs.id as doc_id
      from docs cross join lateral public.fn_field_document_shared_keys(docs.doc_type, docs.doc_date, docs.content) sk
  ),
  grouped as (
    select p.key, p.field, p.work_item_id, p.doc_date,
           jsonb_agg(p.doc order by p.doc_type, p.doc_id) as documents
      from per_doc p
     group by p.key, p.field, p.work_item_id, p.doc_date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', g.key, 'field', g.field, 'label', public.fn_intake_shared_field_label(g.field),
           'date', g.doc_date, 'value_kind', case g.field when 'qty' then 'number' else 'text' end,
           'work_item', case when w.id is null then null else jsonb_build_object(
             'id', w.id, 'item_no', w.item_no, 'description', w.description, 'unit', w.unit) end,
           'value', v_intake.shared_inputs -> g.key -> 'value',
           'set_by', v_intake.shared_inputs -> g.key -> 'set_by',
           'set_at', v_intake.shared_inputs -> g.key -> 'set_at',
           'documents', g.documents)
         order by g.doc_date, (g.work_item_id is not null), w.sort_order nulls last, w.item_no, g.work_item_id,
                  case g.field when 'weather_am' then 1 when 'weather_pm' then 2 when 'location' then 3 else 4 end), '[]'::jsonb)
    into v_fields
    from grouped g
    left join public.work_items w on w.id = g.work_item_id and w.project_id = v_intake.project_id;

  return jsonb_build_object(
    'intake_id', v_intake.id, 'uploader_org', v_intake.uploader_org,
    'can_edit', public.can_write(v_intake.project_id)
                and (v_intake.uploader_org = public.my_org_type() or public.admin_override(v_intake.project_id))
                and v_intake.status <> 'discarded',
    'fields', v_fields);
end; $$;
revoke all on function public.list_intake_shared_inputs(uuid) from public, anon;
grant execute on function public.list_intake_shared_inputs(uuid) to authenticated;
comment on function public.list_intake_shared_inputs(uuid) is
  'P3e:批次的共用補值欄位(標籤、工項、目前補值)與每份文件的效果 update／applied／human_value／locked(專案成員可讀;can_edit=可補值)。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. P4e 交接(同一條簽署路徑,避免兩支 migration 互相覆蓋):監造查驗表單簽署分支的 6 處數量訊息與查驗缺失說明的
--    「申報／確認／差額」改經 fn_cq_txt(numeric(18,4) 的尾零 .0000 不再出現在訊息;值不變、只影響文字)。
--    兩支函式以 20260919222000 的定義為底逐字沿用,只改 format 的數量參數;簽章、權限、trigger 不變。
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.inspections_defect_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_qty text;
begin
  if auth.uid() is null or new.status not in ('不合格', '部分合格') or new.status is not distinct from old.status then
    return new;
  end if;
  if exists (select 1 from public.defects d where d.inspection_id = new.id and d.status <> '已結案') then
    return new;
  end if;
  v_qty := case when new.declared_qty is not null
                then format('申報 %s %s、確認 %s %s、差額 %s %s', public.fn_cq_txt(new.declared_qty), coalesce(new.unit, ''),
                            public.fn_cq_txt(coalesce(new.confirmed_qty, 0)), coalesce(new.unit, ''),
                            public.fn_cq_txt(new.declared_qty - coalesce(new.confirmed_qty, 0)), coalesce(new.unit, ''))
           end;
  insert into public.defects (project_id, inspection_id, work_item_id, domain, title, description, severity, location, status, created_by)
  values (new.project_id, new.id, new.work_item_id, 'quality',
          format('查驗%s：%s', new.status, new.title),
          nullif(concat_ws(E'\n', nullif(btrim(coalesce(new.result_note, '')), ''), v_qty), ''),
          '一般', new.location, '開立', auth.uid());
  return new;
end; $$;
revoke all on function public.inspections_defect_sync() from public, anon, authenticated;
drop trigger if exists inspections_defect_sync on public.inspections;
create trigger inspections_defect_sync after update of status on public.inspections
  for each row execute function public.inspections_defect_sync();
comment on function public.inspections_defect_sync() is
  'P3c(P3e 起說明數量經 fn_cq_txt):查驗判不合格／部分合格 → 同交易自動開缺失(同查驗最多一筆未結案;使用者路徑)。原前端 Quality 的 insert 退場。';

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
