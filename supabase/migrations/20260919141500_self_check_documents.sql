-- P3b｜自主檢查表文件:示範框架範本、由本案檢查表範本推導必填／人填／須確認欄、判定引擎下沉 DB、
-- 簽署分支寫 checklist_records(修訂鏈 Rev.N)、不合格自動開缺失下沉 DB(D-026;設計 docs/architecture/field-documents-lifecycle.md §2.2、§3.1 7c、§5)。
--
-- 為什麼:自主檢查表沿用既有事實表 checklist_records／checklist_templates(含修訂鏈與量化判定),P2a 的 field_documents
--   已能建 doc_type='self_check' 的草稿,但簽署回 PD007、必填鍵沒有推導來源。本支補齊,並順手解掉兩個「同一規則兩份實作」:
--   * 判定引擎:前端 lib/qc.js judgeChecklist 是唯一判定實作,客戶端可以送出與實測值不符的 overall。現在 DB 有
--     fn_checklist_judge(與 judgeChecklist 同一條規則,pgTAP 以同一組案例釘住),checklist_records_guard 在使用者路徑 INSERT 時
--     一律以範本重算 results.pass／overall——前端判定改為「存檔前預覽」,伺服器為準;服務路徑(還原／遷移)不重算,免得範本
--     日後修改讓歷史證據被改判。
--   * 不合格自動開缺失:原本只在前端 quality.js syncDefect(直接寫入路徑),簽署 RPC 走 DB 就會漏掉。現在 AFTER INSERT trigger
--     checklist_records_defect_sync 對所有使用者路徑統一處理(同鏈最多一筆未結案缺失,由既有部分唯一索引兜底、並發撞索引視為已關聯),
--     前端只回報結果、不再自己開缺失。
-- 規則來源(單一定義):
--   * fn_field_document_template('self_check')=示範框架範本(is_demo、demo_label、免責聲明;表頭欄 check_date／template_id／
--     work_item_id／location、檢查項目 results、備註);檢查項目本身取自本案 checklist_templates.items(Q11:自檢沿用既有範本)。
--   * 必填鍵=框架 required(check_date、template_id)∪ 範本每個項目 results.<no>;人填欄(AI 版本不得帶入)=實測值(kind=num);
--     須人逐項確認(filled 不算齊備)=全部項目(num 與 bool;AI 建議的勾選須附依據並由人確認)。這三組都由範本
--     item_rules 推導,函式改為 (doc_type, content) 兩參數;fn_field_document_unmet_fields 改為四參數(多 content)。
--   * 簽署:內容形狀與引用(範本／工項須本案;項次須在範本內;num 值須數字、bool 須布林;不適用須空值)→ 以 fn_checklist_judge 判定
--     → 寫 checklist_records(首簽 Rev.0;已綁事實列再簽=修訂 Rev.N,supersedes_id 指向前版、revision_reason 取簽署版本的
--     change_note,空白即拒)→ 綁 target_id。已綁定簽署文件的紀錄不可刪除(既有 guard 加一條)。
-- 錯誤代碼沿用 P2d(PD001–PD010)。
-- 資料保留:不動任何既有列;既有 checklist_records 直接寫入路徑照舊(RLS can_write),只多了伺服器重算判定與自動開缺失。
-- 相容:save／sign 簽章不變;fn_field_document_human_only_keys(text) → (text, jsonb)、fn_field_document_unmet_fields
--   (text, jsonb, jsonb) → (text, jsonb, jsonb, jsonb),舊簽章移除(只有 guard／save／sign 呼叫)。
-- 回復:supabase/rollbacks/20260919141500_self_check_documents.down.sql(drop 新函式與 trigger、還原 R1 的 sign、P3a 的
--   save／版本 guard／二參數人填欄／三參數待補與單範本函式、P1-07 的 checklist_records_guard;簽署落下的 checklist_records 列保留)。

-- ── 0. 範本(單一定義):監造日誌示範範本逐字沿用 P3a,新增自主檢查表示範框架範本 ─────────────────
create or replace function public.fn_field_document_template(p_doc_type text)
returns jsonb language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select case p_doc_type
    when 'supervisor_log' then $tpl$
{
  "key": "supervisor_log_demo",
  "version": 1,
  "doc_type": "supervisor_log",
  "title": "監造日誌",
  "is_demo": true,
  "demo_label": "示範範本",
  "disclaimer": "本表為示範範本:欄位依常見公共工程監造日誌整理,非任何機關公定或法定格式;實案範本提供後另建範本,已簽署文件仍以簽署當時的範本呈現。",
  "sections": [
    { "key": "basic", "title": "一、基本資料", "fields": [
      { "key": "log_date",   "label": "日期",       "kind": "date", "required": true,  "human_only": false },
      { "key": "weather_am", "label": "天氣(上午)", "kind": "text", "required": true,  "human_only": false },
      { "key": "weather_pm", "label": "天氣(下午)", "kind": "text", "required": true,  "human_only": false } ] },
    { "key": "attendance", "title": "二、監造到場人員", "fields": [
      { "key": "attendance", "label": "到場人員與時段", "kind": "list", "required": true, "human_only": true,
        "item_shape": { "user_id": "uuid(本案監造方成員,選填)", "name": "text", "from": "HH:MM(選填)", "to": "HH:MM(選填)" },
        "note": "只能由監造親自填寫並確認;系統不從任何照片(含監造自己的照片)推定到場。本日未到場請標不適用並填原因。" } ] },
    { "key": "supervision", "title": "三、監造事項(抽查、督導)", "fields": [
      { "key": "supervision_items", "label": "監造事項", "kind": "list", "required": true, "human_only": false,
        "item_shape": { "time": "HH:MM(選填)", "item": "text", "location": "text(選填)", "work_item_id": "uuid(選填)", "note": "text(選填)", "source": "text(來源:ai:photo／inspection:<id>／人填)", "photo_ids": "uuid[](選填)" } } ] },
    { "key": "inspections", "title": "四、查驗情形", "fields": [
      { "key": "inspection_ids", "label": "當日查驗", "kind": "ref_list", "ref_type": "inspection", "required": false, "human_only": false } ] },
    { "key": "contractor", "title": "五、廠商施工情形", "fields": [
      { "key": "contractor_summary", "label": "施工情形摘要", "kind": "text", "required": true, "human_only": false,
        "note": "引用同日已簽署／已提送的施工日誌時標來源;廠商未施工請標不適用並填原因。" },
      { "key": "daily_log_receipt", "label": "施工日誌收件情形", "kind": "object", "required": false, "human_only": false } ] },
    { "key": "notices", "title": "六、通知／督導事項", "fields": [
      { "key": "notices", "label": "通知事項", "kind": "list", "required": false, "human_only": false,
        "item_shape": { "to": "contractor|owner", "content": "text", "ref_type": "defect|inspection|rfi|submittal|daily_log|field_document(選填)", "ref_id": "uuid(選填)" } } ] },
    { "key": "followups", "title": "七、追蹤事項", "fields": [
      { "key": "followups", "label": "追蹤事項", "kind": "list", "required": false, "human_only": false,
        "item_shape": { "ref_type": "同通知(選填)", "ref_id": "uuid(選填)", "content": "text", "status": "open|closed" } } ] },
    { "key": "note", "title": "八、備註", "fields": [
      { "key": "note", "label": "備註", "kind": "text", "required": false, "human_only": false } ] }
  ]
}
$tpl$::jsonb
    when 'self_check' then $tpl$
{
  "key": "self_check_demo",
  "version": 1,
  "doc_type": "self_check",
  "title": "自主檢查表",
  "is_demo": true,
  "demo_label": "示範範本",
  "disclaimer": "本表為示範範本:表頭與判定欄依常見公共工程自主檢查表(承攬廠商一級品管)整理,非任何機關公定或法定格式;檢查項目、量化標準與依據取自本案檢查表範本。實案範本提供後另建範本,已簽署文件仍以簽署當時的範本呈現。",
  "sections": [
    { "key": "basic", "title": "一、基本資料", "fields": [
      { "key": "check_date",   "label": "檢查日期",   "kind": "date", "required": true,  "human_only": false },
      { "key": "template_id",  "label": "檢查表範本", "kind": "ref",  "ref_type": "checklist_template", "required": true, "human_only": false,
        "note": "本案的檢查表範本(品質查驗建立);系統依工項描述自動挑選,請確認是否適用。" },
      { "key": "work_item_id", "label": "對應工項",   "kind": "ref",  "ref_type": "work_item", "required": false, "human_only": false },
      { "key": "location",     "label": "檢查位置",   "kind": "text", "required": false, "human_only": false } ] },
    { "key": "items", "title": "二、檢查項目", "fields": [
      { "key": "results", "label": "檢查項目", "kind": "checklist_items", "required": false, "human_only": false,
        "item_key": "results.<no>",
        "item_rules": { "num": { "human_only": true, "confirm_required": true }, "bool": { "human_only": false, "confirm_required": true } },
        "note": "每個項目由範本推導為必填:實測值(num)只能由人親自量測填寫,系統不從任何照片推定;勾選項(bool)若由系統建議須附依據並由人逐項確認;本次未檢請標不適用並填原因。合格與否由系統依範本量化標準計算。" } ] },
    { "key": "note", "title": "三、備註", "fields": [
      { "key": "note", "label": "備註", "kind": "text", "required": false, "human_only": false } ] }
  ]
}
$tpl$::jsonb
    else null
  end;
$fn$;
revoke all on function public.fn_field_document_template(text) from public, anon;
grant execute on function public.fn_field_document_template(text) to authenticated;
comment on function public.fn_field_document_template(text) is
  'P3a／P3b:文書範本(supervisor_log=示範範本;self_check=示範框架範本,檢查項目取自本案 checklist_templates);必填鍵／人填欄／須確認欄由此推導;其他類型回 null。';

-- ── 1. 由範本推導的規則 ─────────────────────────────────────────────────────────
-- 1.1 本案檢查表範本的項目(自檢表:內容 template_id 指向的 checklist_templates.items;範本不存在或鍵不合法回空陣列)
create or replace function public.fn_field_document_checklist_items(p_content jsonb)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_tpl uuid;
  v_items jsonb;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' or nullif(p_content ->> 'template_id', '') is null then
    return '[]'::jsonb;
  end if;
  begin
    v_tpl := (p_content ->> 'template_id')::uuid;
  exception when others then
    return '[]'::jsonb;
  end;
  select t.items into v_items from public.checklist_templates t where t.id = v_tpl;
  return case when jsonb_typeof(v_items) = 'array' then v_items else '[]'::jsonb end;
end; $$;
revoke all on function public.fn_field_document_checklist_items(jsonb) from public, anon, authenticated;

-- 1.2 自檢表項目鍵 results.<no>:p_rule=null 取全部項目;'human_only'／'confirm_required' 取範本 item_rules 該規則為真的 kind
create or replace function public.fn_field_document_self_check_item_keys(p_content jsonb, p_rule text default null)
returns text[] language sql stable security invoker set search_path = pg_catalog, public as $fn$
  with rules as (
    select f -> 'item_rules' as r
    from jsonb_array_elements(coalesce(public.fn_field_document_template('self_check') -> 'sections', '[]'::jsonb)) s
    cross join jsonb_array_elements(coalesce(s -> 'fields', '[]'::jsonb)) f
    where f ->> 'key' = 'results'
  )
  select coalesce(array_agg('results.' || (it ->> 'no') order by it ->> 'no'), '{}'::text[])
  from jsonb_array_elements(public.fn_field_document_checklist_items(p_content)) it, rules
  where nullif(btrim(coalesce(it ->> 'no', '')), '') is not null
    and (p_rule is null
         or coalesce((rules.r -> coalesce(it ->> 'kind', 'bool') ->> p_rule)::boolean, false)
         or (p_rule = 'confirm_required' and coalesce((rules.r -> coalesce(it ->> 'kind', 'bool') ->> 'human_only')::boolean, false)));
$fn$;
revoke all on function public.fn_field_document_self_check_item_keys(jsonb, text) from public, anon, authenticated;

-- 1.3 人填欄(AI 版本不得帶入):範本 human_only 欄 ∪ 自檢表實測值項目。取代 P3a 的單參數版本(需要內容才知道範本項目)。
drop function if exists public.fn_field_document_human_only_keys(text);
create or replace function public.fn_field_document_human_only_keys(p_doc_type text, p_content jsonb)
returns text[] language sql stable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(array_agg(k order by k), '{}'::text[]) from (
    select f ->> 'key' as k
    from jsonb_array_elements(coalesce(public.fn_field_document_template(p_doc_type) -> 'sections', '[]'::jsonb)) s
    cross join jsonb_array_elements(coalesce(s -> 'fields', '[]'::jsonb)) f
    where coalesce((f ->> 'human_only')::boolean, false)
    union
    select unnest(case when p_doc_type = 'self_check'
      then public.fn_field_document_self_check_item_keys(p_content, 'human_only') else '{}'::text[] end)
  ) x;
$fn$;
revoke all on function public.fn_field_document_human_only_keys(text, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_human_only_keys(text, jsonb) is
  'P3a／P3b:只能人填的欄位鍵:範本 human_only 欄 ∪ 自檢表實測值項目(results.<no>,kind=num);AI 版本不得帶入。';

-- 1.4 須人確認的欄位鍵(filled 不算齊備,回 needs_confirmation):人填欄 ∪ 範本 confirm_required 欄 ∪ 自檢表全部項目
create or replace function public.fn_field_document_confirm_required_keys(p_doc_type text, p_content jsonb)
returns text[] language sql stable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(array_agg(k order by k), '{}'::text[]) from (
    select f ->> 'key' as k
    from jsonb_array_elements(coalesce(public.fn_field_document_template(p_doc_type) -> 'sections', '[]'::jsonb)) s
    cross join jsonb_array_elements(coalesce(s -> 'fields', '[]'::jsonb)) f
    where coalesce((f ->> 'human_only')::boolean, false) or coalesce((f ->> 'confirm_required')::boolean, false)
    union
    select unnest(case when p_doc_type = 'self_check'
      then public.fn_field_document_self_check_item_keys(p_content, 'confirm_required') else '{}'::text[] end)
  ) x;
$fn$;
revoke all on function public.fn_field_document_confirm_required_keys(text, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_confirm_required_keys(text, jsonb) is
  'P3b:filled 仍不算齊備、須人逐項確認的欄位鍵(人填欄 ∪ 範本 confirm_required ∪ 自檢表每個項目);簽署須 confirmed 或 na＋reason。';

-- 1.5 必填鍵(取代 P3a 定義):stored ∪ 類型固定欄／範本 required ∪ 施工日誌各工項數量 ∪ 自檢表每個範本項目。
-- 改為 stable(自檢表要讀本案範本);施工日誌與監造日誌的結果不變(field_document_sign／supervisor_logs pgTAP 回歸)。
create or replace function public.fn_field_document_required_fields(p_doc_type text, p_content jsonb, p_stored jsonb)
returns jsonb language sql stable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
  from (
    select distinct k from (
      select stored.k
        from jsonb_array_elements_text(
               case when jsonb_typeof(p_stored) = 'array' then p_stored else '[]'::jsonb end) as stored(k)
       where not (p_doc_type = 'daily_log' and stored.k like 'items.%.qty_today')
         and not (p_doc_type = 'self_check' and stored.k like 'results.%')
      union all
      select unnest(case when p_doc_type = 'daily_log'
        then array['weather_am','weather_pm','work_summary','labor','equipment','materials']
        else public.fn_field_document_template_required_keys(p_doc_type) end)
      union all
      select 'items.' || key || '.qty_today'
        from jsonb_object_keys(case when p_doc_type = 'daily_log' and jsonb_typeof(p_content -> 'items') = 'object'
                                    then p_content -> 'items' else '{}'::jsonb end) as key
      union all
      select unnest(case when p_doc_type = 'self_check'
        then public.fn_field_document_self_check_item_keys(p_content, null) else '{}'::text[] end)
    ) s
    where k is not null and btrim(k) <> ''
  ) d;
$fn$;
revoke all on function public.fn_field_document_required_fields(text, jsonb, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_required_fields(text, jsonb, jsonb) is
  'P2d／P3a／P3b:必填鍵=stored ∪ 類型固定欄(daily_log 六欄;其他類型取範本 required)∪ 施工日誌 items.<id>.qty_today ∪ 自檢表範本每項 results.<no>(項目鍵永遠由內容重算)。';

-- 1.6 待補判定(取代 P3a 三參數版本):加 content 才能套自檢表的逐項確認規則;施工日誌／監造日誌行為不變。
drop function if exists public.fn_field_document_unmet_fields(text, jsonb, jsonb);
create or replace function public.fn_field_document_unmet_fields(p_doc_type text, p_required jsonb, p_field_sources jsonb, p_content jsonb)
returns jsonb language sql stable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('key', k, 'status', st) order by k), '[]'::jsonb)
  from (
    select r.k,
      case
        when src is null or jsonb_typeof(src) <> 'object' then 'missing'
        when src ->> 'status' = 'confirmed' then null
        when src ->> 'status' = 'filled' then
          case when r.k = any (public.fn_field_document_confirm_required_keys(p_doc_type, p_content)) then 'needs_confirmation' end
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
revoke all on function public.fn_field_document_unmet_fields(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_unmet_fields(text, jsonb, jsonb, jsonb) is
  'P2d／P3a／P3b:必填鍵的待補清單 [{key,status}];status=missing/pending/na_without_reason/needs_confirmation(須確認欄只被標 filled)/unknown_status。';

-- ── 2. 判定引擎(單一實作;與 src/lib/qc.js judgeChecklist 同一條規則,pgTAP 以同一組案例釘住) ────────
-- p_results 形如 {no:{value,...}}(值也可直接放在 no 之下);只對範本項目產生結果(多餘的鍵丟掉,與前端相同)。
-- num:值為數字或可轉數字的字串(布林比照 JS Number 轉 1／0),依 min／max 判;空白／null／非數字=未檢。
-- bool:true 合格、false 不合格、其餘未檢。overall:無已檢項 null;任一不合格 不合格;否則 合格。
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
comment on function public.fn_checklist_judge(jsonb, jsonb) is
  'P3b:自主檢查表判定引擎(與前端 judgeChecklist 同一條規則):{results:{no:{value,pass}}, overall, failed[]};前端判定只是預覽,伺服器為準。';

-- ── 3. checklist_records_guard(取代 P1-07 定義):使用者路徑 INSERT 以範本重算判定;已綁簽署文件的紀錄不可刪 ────
create or replace function public.checklist_records_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  base  public.checklist_records%rowtype;
  v_items jsonb;
  v_judge jsonb;
begin
  -- 版次/鏈完整性:所有來源一體適用(service role 也不能寫出斷鏈資料)
  if tg_op = 'INSERT' then
    if new.supersedes_id is not null then
      select * into base from public.checklist_records where id = new.supersedes_id;
      if not found then
        raise exception '被修訂的檢查紀錄不存在';
      end if;
      if base.project_id <> new.project_id then
        raise exception '修訂版必須與原檢查紀錄同一專案';
      end if;
      if base.template_id is distinct from new.template_id then
        raise exception '修訂版必須沿用原檢查表範本;換範本請另立新檢查';
      end if;
      if new.revision_reason is null or btrim(new.revision_reason) = '' then
        raise exception '建立修訂版次必須填寫更正原因';
      end if;
      new.rev     := base.rev + 1;
      new.root_id := coalesce(base.root_id, base.id);
    elsif uid is null then
      -- service role(遷移/還原):只補漏,不覆寫既有值
      new.rev     := coalesce(new.rev, 0);
      new.root_id := coalesce(new.root_id, new.id);
    else
      new.rev := 0; new.root_id := new.id;
    end if;
  end if;

  -- service role/SQL Editor 放行(資料修復仍可 UPDATE/DELETE;判定不重算——範本日後修改不得改判歷史證據)
  if uid is null then return coalesce(new, old); end if;
  -- 專案刪除 cascade:父專案列已先刪 → 放行,勿擋整案刪除
  if tg_op in ('UPDATE','DELETE')
     and not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    new.created_by := uid;  -- 登錄者即建立者,不可冒名
    -- P3b:判定由伺服器依範本量化標準重算(客戶端送來的 pass／overall 作廢);範本已刪或不存在則照客戶端值保存
    if new.template_id is not null then
      select t.items into v_items from public.checklist_templates t where t.id = new.template_id;
      if jsonb_typeof(v_items) = 'array' then
        v_judge := public.fn_checklist_judge(v_items, new.results);
        new.results := v_judge -> 'results';
        new.overall := v_judge ->> 'overall';
      end if;
    end if;
    return new;
  end if;

  -- 舊證據不可覆寫:任何就地修改一律拒絕,更正走修訂版次
  if tg_op = 'UPDATE' then
    raise exception '檢查紀錄為品質證據,不可就地修改;請以「修訂」建立 Rev.N 更正';
  end if;

  -- DELETE:已判定=證據不可刪;被修訂引用=鏈上證據不可刪;已綁簽署文件=簽署版本的事實列不可刪(P3b)
  if old.overall in ('合格','不合格') then
    raise exception '已判定的檢查紀錄不可刪除;如需更正請建立修訂版次';
  end if;
  if exists (select 1 from public.checklist_records c where c.supersedes_id = old.id) then
    raise exception '此檢查紀錄已被修訂版次引用,不可刪除';
  end if;
  if public.fn_field_document_target_signed('self_check', old.id) then
    raise exception '此檢查紀錄是已簽署自主檢查表文件的事實列,不可刪除;更正請在該文件建立新版本並重新簽署';
  end if;
  return old;
end; $$;
revoke all on function public.checklist_records_guard() from public, anon, authenticated;
-- trigger 已於 20260712001700 掛上(before insert or update or delete),函式 create or replace 即生效

-- ── 4. 不合格自動開缺失(單一實作;AFTER INSERT,使用者路徑):同鏈最多一筆未結案缺失 ─────────────
-- 與前端 quality.js 原本的 syncDefect 同一條規則:不合格且鏈根沒有未結案缺失才開;標題／說明／嚴重度／位置／工項同前端。
-- 並發:兩筆同時判不合格 → 部分唯一索引 defects_open_per_checklist_uidx 只讓一筆進去,另一筆視為已關聯(不讓紀錄 insert 失敗)。
-- service 路徑(還原／遷移)不開:歷史缺失已在備份內。
create or replace function public.checklist_records_defect_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tpl    record;
  v_judge  jsonb;
  v_desc   text;
begin
  if auth.uid() is null or new.overall is distinct from '不合格' then
    return new;
  end if;
  if exists (select 1 from public.defects d where d.source_checklist_record_id = new.root_id and d.status <> '已結案') then
    return new;
  end if;
  select t.title, t.items into v_tpl from public.checklist_templates t where t.id = new.template_id;
  v_judge := case when jsonb_typeof(v_tpl.items) = 'array' then public.fn_checklist_judge(v_tpl.items, new.results) else null end;
  select string_agg(format('%s %s（標準 %s）', it ->> 'no', it ->> 'item', coalesce(it ->> 'standard', '—')), '、' order by ord)
    into v_desc
    from jsonb_array_elements(coalesce(v_tpl.items, '[]'::jsonb)) with ordinality as x(it, ord)
   where (v_judge -> 'failed') ? (it ->> 'no');
  begin
    insert into public.defects (project_id, work_item_id, domain, title, description, severity, location, status, created_by, source_checklist_record_id)
    values (new.project_id, new.work_item_id, 'quality',
            format('自主檢查不合格：%s', coalesce(v_tpl.title, '自主檢查表')),
            format('不合格項目：%s%s', coalesce(v_desc, '—'), case when coalesce(new.rev, 0) > 0 then format('（Rev.%s 更正後判定）', new.rev) else '' end),
            '一般', new.location, '開立', auth.uid(), new.root_id);
  exception when unique_violation then
    null;  -- 並發下另一筆已開:同鏈只留一筆未結案缺失
  end;
  return new;
end; $$;
revoke all on function public.checklist_records_defect_sync() from public, anon, authenticated;
drop trigger if exists checklist_records_defect_sync on public.checklist_records;
create trigger checklist_records_defect_sync after insert on public.checklist_records
  for each row execute function public.checklist_records_defect_sync();
comment on function public.checklist_records_defect_sync() is
  'P3b:自主檢查判不合格 → 同交易自動開缺失(掛鏈根;同鏈最多一筆未結案;使用者路徑)。原前端 syncDefect 退場。';

-- ── 5. 版本 guard(取代 P3a 定義):人填欄改由 (doc_type, content) 推導;其餘逐字沿用 ───────────────
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

-- ── 6. save_field_document_version(取代 P3a 定義):自檢表範本須本案並同步到文件;待補改四參數 ──────────
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
  v_tpl      uuid;
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

  -- 自檢表:內容指定的檢查表範本必須是本案的(必填鍵由它推導,不能拿別案範本);同步到文件的範本欄
  if v_doc.doc_type = 'self_check' and nullif(p_content ->> 'template_id', '') is not null then
    begin
      v_tpl := (p_content ->> 'template_id')::uuid;
    exception when others then
      raise exception using errcode = 'PD010', message = '檢查表範本 template_id 不是合法 UUID';
    end;
    if not exists (select 1 from public.checklist_templates t where t.id = v_tpl and t.project_id = v_doc.project_id) then
      raise exception using errcode = 'PD010', message = '檢查表範本不存在或不屬於本專案';
    end if;
  end if;

  v_amended := case when v_doc.status in ('signed', 'submitted', 'returned') then v_doc.current_version_no end;
  insert into public.field_document_versions
    (document_id, author_kind, content, field_sources, attachments, change_note, amended_from_version)
  values (p_document_id, 'human', p_content, coalesce(p_field_sources, '{}'::jsonb), p_attachments,
          nullif(btrim(coalesce(p_change_note, '')), ''), v_amended)
  returning * into v_ver;

  v_required := public.fn_field_document_required_fields(v_doc.doc_type, v_ver.content, v_doc.required_fields);
  v_recheck  := public.fn_field_document_unmet_fields(v_doc.doc_type, v_required, v_ver.field_sources, v_ver.content)
             || public.fn_field_document_attachment_issues(v_doc.doc_type, v_doc.project_id, v_ver.attachments);
  update public.field_documents
     set current_version_no = v_ver.version_no,
         required_fields    = v_required,
         recheck            = v_recheck,
         status             = case when jsonb_array_length(v_recheck) > 0 then 'pending_input' else 'draft' end,
         template_id        = case when v_doc.doc_type = 'self_check' and v_tpl is not null then v_tpl else template_id end
   where id = p_document_id
   returning * into v_doc;

  return jsonb_build_object(
    'document_id', v_doc.id, 'version_no', v_ver.version_no, 'content_hash', v_ver.content_hash,
    'status', v_doc.status, 'required_fields', v_doc.required_fields, 'recheck', v_doc.recheck,
    'amended_from_version', v_amended);
end; $$;
revoke all on function public.save_field_document_version(uuid, int, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.save_field_document_version(uuid, int, jsonb, jsonb, jsonb, text) to authenticated;

-- ── 7. 簽署分支:自主檢查表 → checklist_records(首簽 Rev.0;再簽=修訂 Rev.N) ────────────────────────
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
comment on function public.field_document_sign_self_check_internal(public.field_documents, public.field_document_versions, uuid) is
  'P3b:自主檢查表簽署分支——驗範本／工項／項次／值型別,以 fn_checklist_judge 判定後寫 checklist_records(首簽 Rev.0、再簽修訂 Rev.N);只由 sign_field_document 呼叫。';

-- ── 8. sign_field_document(取代 R1 定義):加 self_check 分支;日誌類的同日事實列檢查只對日誌類 ──────
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
  if v_doc.doc_type not in ('daily_log', 'supervisor_log', 'self_check') then
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

  -- 必填完整性(含人填欄／須確認欄須 confirmed)與附件角色隔離(證據須由責任方上傳;他方照片只能 reference)
  v_issues := public.fn_field_document_unmet_fields(v_doc.doc_type,
    public.fn_field_document_required_fields(v_doc.doc_type, v_ver.content, v_doc.required_fields),
    v_ver.field_sources, v_ver.content);
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

  if v_doc.doc_type in ('daily_log', 'supervisor_log') then
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
  end if;

  -- 1. 簽署列(trigger:版本／雜湊／角色／成員一致性;簽署者資料、時間、aal、IP、UA 由伺服器取)
  insert into public.field_document_signatures
    (document_id, version_no, content_hash, signer_id, signer_org, intent, method)
  values (p_document_id, p_version_no, v_ver.content_hash, uid, public.my_org_type(), btrim(p_intent), 'platform_account')
  returning * into v_sig;

  -- 2. 事實列(簽署版本內容為準;GUC 只在本交易內放行同類同案同日的事實表 guard;自檢表每次簽署新增一列,不需放行)
  perform set_config('pmis.field_document_sign', p_document_id::text, true);
  v_log_id := case v_doc.doc_type
    when 'daily_log'      then public.field_document_sign_daily_log_internal(v_doc, v_ver, uid)
    when 'supervisor_log' then public.field_document_sign_supervisor_log_internal(v_doc, v_ver, uid)
    when 'self_check'     then public.field_document_sign_self_check_internal(v_doc, v_ver, uid)
  end;
  perform set_config('pmis.field_document_sign', '', true);

  -- 3. 文件狀態與事實列綁定(自檢表再簽=綁到新的修訂版次列)
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
  'P2d／P3a／R1／P3b:簽署(已登入的平台帳號;不要求兩步驟驗證)。daily_log 落 daily_logs／daily_log_items;supervisor_log 落 supervisor_logs;self_check 落 checklist_records(首簽 Rev.0、再簽修訂 Rev.N,判定由 DB 計算);綁 target_id、處理 agent_actions;inspection_form 回 PD007。';
