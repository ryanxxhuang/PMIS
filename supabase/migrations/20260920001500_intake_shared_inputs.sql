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
-- 不變:簽署前段與四類分支(簽署時附件來源檢查 PD005 已由 P2d／P3a–c 覆蓋)、存版 RPC、版本 guard。
-- 權限(H3):authenticated 只多 set_intake_shared_input、list_intake_shared_inputs 兩支;其餘 helper(含套用函式)不開放。
-- 回復:supabase/rollbacks/20260920001500_intake_shared_inputs.down.sql(只 drop 本支函式;已寫入的人工版本與
--   shared_inputs 值保留——版本不可變,shared_inputs 是 P2a 欄位)。
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
