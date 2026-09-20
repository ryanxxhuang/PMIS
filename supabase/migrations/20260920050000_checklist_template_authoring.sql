-- P3g｜檢查表／監造查驗表單範本的建立與編輯(補 P3c 留下的 G5 缺口;D-026 §3 四類文書)
--
-- 為什麼:P3c 給 checklist_templates 加了 kind／stage_key／applies_to／version 四欄,但沒有任何建立介面——
-- kind='inspection_form' 的查驗表單範本只能用 API 建立,品質頁唯一的建立路徑(ensureChecklistTemplate)固定
-- 落 kind 預設值 self_check,applies_to 也沒有人寫、Edge 候選推斷因此只能用「標題相似度」猜。P3g 補上建立／
-- 編輯介面,這支 migration 只負責「使用者路徑寫得進來的東西一定是合法的」,不新增表、不新增角色。
--
-- 做法:
--   1. fn_checklist_applies_to(jsonb):適用條件的形狀與正規化單一定義(只接受 {work_item_ids:[uuid],
--      keywords:[text]};去空白、去重、排序;兩者皆空 → null)。純函式,不讀表。
--   2. fn_checklist_items_normalize(jsonb):檢查項目的形狀與正規化單一定義(陣列;每項 no 必填且不重複、
--      item 必填、kind ∈ num|bool、num 的 min/max 為數字且 min ≤ max;只保留 baseline 註明的九個鍵)。
--      沒有這支,一張壞掉的範本要到簽署當下才炸(fn_checklist_judge／簽署分支),使用者看不懂為什麼。
--   3. checklist_templates_guard():BEFORE INSERT OR UPDATE
--      * 正規化標題／依據／階段鍵／適用條件／檢查項目;階段鍵只有 inspection_form 可帶(自檢表沒有階段語意)。
--      * 適用工項必須是本案工項(跨案引用會讓候選推斷挑到別案的範本)。
--      * kind='inspection_form' 的範本是監造的文書(owner_org='supervisor'),寫入比照 create_inspection_form_draft:
--        can_write ∧ (監造成員 ∨ admin_override)。這不是新角色,是既有三角色裡「監造查驗表單屬監造」的同一條規則。
--      * version 由伺服器算(同案同用途同標題的上一版 +1),不由前端指定。
--      * 已被檢查紀錄／查驗引用的範本:標題／依據／檢查項目／用途不可再改——既有紀錄的呈現與列印是即時讀範本的,
--        改了等於竄改已簽署的證據;要更正請以同標題新增一列(自動成為下一版)。
--   4. checklist_templates_del_guard():BEFORE DELETE。checklist_records.template_id 是 on delete cascade,
--      刪一張用過的範本會連同已簽署的自主檢查紀錄一起消失(P6b-3 已收回 checklist_records 的 DELETE grant,
--      這條 cascade 是唯一還通的繞道)。被引用就擋下;專案刪除的 cascade 照舊放行。
--
-- 資料:不動任何既有列(guard 只在之後的 INSERT/UPDATE 觸發)。正式庫既有範本皆為 self_check、stage_key／
-- applies_to 為 null,不受新規則影響。
-- 回復:supabase/rollbacks/20260920050000_checklist_template_authoring.down.sql。
-- pgTAP:supabase/tests/checklist_template_authoring.sql。允許清單不變(三支新函式都不授權給 authenticated,
-- 使用者路徑走既有 RLS policy 直接寫表)。

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 適用條件(applies_to)的形狀與正規化
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_checklist_applies_to(p jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_ids uuid[] := '{}';
  v_kws text[] := '{}';
  k     text;
  el    jsonb;
  s     text;
begin
  if p is null or p = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p) <> 'object' then
    raise exception using errcode = 'CT010', message = '適用條件(applies_to)必須是 JSON 物件';
  end if;
  for k in select key from jsonb_each(p) loop
    if k not in ('work_item_ids', 'keywords') then
      raise exception using errcode = 'CT010',
        message = format('適用條件不支援「%s」;只接受 work_item_ids(適用工項)與 keywords(比對工項描述的關鍵字)', k);
    end if;
  end loop;

  if p ? 'work_item_ids' and p -> 'work_item_ids' <> 'null'::jsonb then
    if jsonb_typeof(p -> 'work_item_ids') <> 'array' then
      raise exception using errcode = 'CT010', message = '適用工項(work_item_ids)必須是陣列';
    end if;
    for el in select value from jsonb_array_elements(p -> 'work_item_ids') loop
      if jsonb_typeof(el) <> 'string' then
        raise exception using errcode = 'CT010', message = '適用工項必須是工項 id 字串';
      end if;
      begin
        v_ids := v_ids || (el #>> '{}')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = 'CT010', message = format('適用工項「%s」不是合法的工項 id', el #>> '{}');
      end;
    end loop;
  end if;

  if p ? 'keywords' and p -> 'keywords' <> 'null'::jsonb then
    if jsonb_typeof(p -> 'keywords') <> 'array' then
      raise exception using errcode = 'CT010', message = '關鍵字(keywords)必須是陣列';
    end if;
    for el in select value from jsonb_array_elements(p -> 'keywords') loop
      if jsonb_typeof(el) <> 'string' then
        raise exception using errcode = 'CT010', message = '關鍵字必須是文字';
      end if;
      s := nullif(btrim(el #>> '{}'), '');
      if s is not null then v_kws := v_kws || s; end if;
    end loop;
  end if;

  select coalesce(array_agg(distinct x order by x), '{}'::uuid[]) into v_ids from unnest(v_ids) x;
  select coalesce(array_agg(distinct x order by x), '{}'::text[]) into v_kws from unnest(v_kws) x;
  if cardinality(v_ids) = 0 and cardinality(v_kws) = 0 then return null; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'work_item_ids', case when cardinality(v_ids) = 0 then null else to_jsonb(v_ids) end,
    'keywords',      case when cardinality(v_kws) = 0 then null else to_jsonb(v_kws) end));
end; $$;
revoke all on function public.fn_checklist_applies_to(jsonb) from public, anon, authenticated;
comment on function public.fn_checklist_applies_to(jsonb) is
  'P3g:檢查表範本適用條件的形狀與正規化(只接受 work_item_ids／keywords;去空白去重排序;兩者皆空回 null)。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 檢查項目(items)的形狀與正規化
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_checklist_items_normalize(p jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  el     jsonb;
  v_out  jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_no   text;
  v_item text;
  v_kind text;
  v_min  numeric;
  v_max  numeric;
  v_row  jsonb;
  v_key  text;
begin
  if p is null or p = 'null'::jsonb then return '[]'::jsonb; end if;
  if jsonb_typeof(p) <> 'array' then
    raise exception using errcode = 'CT010', message = '檢查項目(items)必須是陣列';
  end if;
  for el in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(el) <> 'object' then
      raise exception using errcode = 'CT010', message = '每個檢查項目必須是物件';
    end if;
    v_no := nullif(btrim(coalesce(el ->> 'no', '')), '');
    if v_no is null then
      raise exception using errcode = 'CT010', message = '每個檢查項目都必須有項次(no)';
    end if;
    if v_no = any(v_seen) then
      raise exception using errcode = 'CT010', message = format('檢查項目的項次「%s」重複', v_no);
    end if;
    v_seen := v_seen || v_no;
    v_item := nullif(btrim(coalesce(el ->> 'item', '')), '');
    if v_item is null then
      raise exception using errcode = 'CT010', message = format('項次「%s」缺少檢查內容(item)', v_no);
    end if;
    v_kind := lower(nullif(btrim(coalesce(el ->> 'kind', '')), ''));
    if v_kind is null then v_kind := 'bool'; end if;
    if v_kind not in ('num', 'bool') then
      raise exception using errcode = 'CT010', message = format('項次「%s」的檢查方式必須是 num(實測值)或 bool(勾選)', v_no);
    end if;
    v_min := null; v_max := null;
    if v_kind = 'num' then
      foreach v_key in array array['min', 'max'] loop
        if el ? v_key and el -> v_key <> 'null'::jsonb and jsonb_typeof(el -> v_key) <> 'number' then
          raise exception using errcode = 'CT010', message = format('項次「%s」的%s必須是數字', v_no, case v_key when 'min' then '下限' else '上限' end);
        end if;
      end loop;
      if el ? 'min' and el -> 'min' <> 'null'::jsonb then v_min := (el ->> 'min')::numeric; end if;
      if el ? 'max' and el -> 'max' <> 'null'::jsonb then v_max := (el ->> 'max')::numeric; end if;
      if v_min is null and v_max is null then
        raise exception using errcode = 'CT010', message = format('項次「%s」是實測值,至少要有下限或上限才判定得了', v_no);
      end if;
      if v_min is not null and v_max is not null and v_min > v_max then
        raise exception using errcode = 'CT010', message = format('項次「%s」的下限 %s 大於上限 %s', v_no, v_min, v_max);
      end if;
    end if;
    v_row := jsonb_strip_nulls(jsonb_build_object(
      'no', v_no, 'item', v_item, 'kind', v_kind,
      'group',    nullif(btrim(coalesce(el ->> 'group', '')), ''),
      'unit',     nullif(btrim(coalesce(el ->> 'unit', '')), ''),
      'standard', nullif(btrim(coalesce(el ->> 'standard', '')), ''),
      'source',   nullif(btrim(coalesce(el ->> 'source', '')), '')));
    if v_min is not null then v_row := v_row || jsonb_build_object('min', v_min); end if;
    if v_max is not null then v_row := v_row || jsonb_build_object('max', v_max); end if;
    v_out := v_out || jsonb_build_array(v_row);
  end loop;
  return v_out;
end; $$;
revoke all on function public.fn_checklist_items_normalize(jsonb) from public, anon, authenticated;
comment on function public.fn_checklist_items_normalize(jsonb) is
  'P3g:檢查表範本項目的形狀與正規化(項次不重複、檢查內容必填、num 須有可判定的上下限;只保留 baseline 的九個鍵)。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. checklist_templates_guard:寫入正規化、權限、版本、已用過的範本不可改內容
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.checklist_templates_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  v_bad  int;
  v_used boolean;
begin
  new.title      := nullif(btrim(coalesce(new.title, '')), '');
  if new.title is null then
    raise exception using errcode = 'CT010', message = '範本必須有標題';
  end if;
  new.source     := nullif(btrim(coalesce(new.source, '')), '');
  new.stage_key  := nullif(public.fn_cq_normalize_text(new.stage_key), '');
  new.items      := public.fn_checklist_items_normalize(new.items);
  new.applies_to := public.fn_checklist_applies_to(new.applies_to);

  if new.kind <> 'inspection_form' and new.stage_key is not null then
    raise exception using errcode = 'CT010',
      message = '只有監造查驗表單範本(kind=inspection_form)可以指定查驗階段;自主檢查表沒有查驗階段語意';
  end if;

  if new.applies_to ? 'work_item_ids' then
    select count(*) into v_bad
      from jsonb_array_elements_text(new.applies_to -> 'work_item_ids') e
     where not exists (select 1 from public.work_items w where w.id = e::uuid and w.project_id = new.project_id);
    if v_bad > 0 then
      raise exception using errcode = 'CT010', message = '適用工項必須是本專案的工項';
    end if;
  end if;

  -- 監造查驗表單範本＝監造的文書(與 create_inspection_form_draft 同一條規則,不新增角色)
  if uid is not null and (new.kind = 'inspection_form' or (tg_op = 'UPDATE' and old.kind = 'inspection_form'))
     and not (public.my_org_type() = 'supervisor' or public.admin_override(new.project_id)) then
    raise exception using errcode = 'CT006', message = '監造查驗表單範本只有監造成員可建立或編輯';
  end if;

  if tg_op = 'INSERT' then
    select coalesce(max(t.version), 0) + 1 into new.version from public.checklist_templates t
      where t.project_id = new.project_id and t.kind = new.kind and t.title = new.title;
    return new;
  end if;

  -- UPDATE:專案刪除 cascade 與 service／遷移路徑照舊放行
  if not exists (select 1 from public.projects p where p.id = old.project_id) then return new; end if;
  if uid is null then return new; end if;
  if new.project_id is distinct from old.project_id then
    raise exception using errcode = 'CT010', message = '範本不可換到別的專案';
  end if;

  v_used := exists (select 1 from public.checklist_records r where r.template_id = old.id)
         or exists (select 1 from public.inspections i where i.template_id = old.id);
  if v_used then
    if new.title is distinct from old.title or new.source is distinct from old.source
       or new.items is distinct from old.items or new.kind is distinct from old.kind then
      raise exception using errcode = 'CT008',
        message = format('範本「%s」已被檢查紀錄或查驗引用,標題／依據／檢查項目／用途不可再更改(既有紀錄與列印是即時讀範本的);請以同標題新增一張範本,系統會自動成為下一版', old.title);
    end if;
    new.version := old.version;
  else
    select coalesce(max(t.version), 0) + 1 into new.version from public.checklist_templates t
      where t.project_id = new.project_id and t.kind = new.kind and t.title = new.title and t.id <> old.id;
  end if;
  return new;
end; $$;
revoke all on function public.checklist_templates_guard() from public, anon, authenticated;
drop trigger if exists checklist_templates_guard on public.checklist_templates;
create trigger checklist_templates_guard before insert or update on public.checklist_templates
  for each row execute function public.checklist_templates_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. 刪除:被引用的範本不可刪(checklist_records.template_id 是 cascade,刪範本＝刪掉已簽署的檢查紀錄)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.checklist_templates_del_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 未登入(service／遷移)、專案已刪除的 cascade、admin_override:與其他證據刪除守門同一條 bypass
  if public.evidence_delete_bypass(old.project_id) then return old; end if;
  if exists (select 1 from public.checklist_records r where r.template_id = old.id) then
    raise exception using errcode = 'CT008',
      message = format('範本「%s」已有自主檢查紀錄引用,刪除會連同那些紀錄一起消失;範本不再使用請改在介面上停用或直接不選它', old.title);
  end if;
  if exists (select 1 from public.inspections i where i.template_id = old.id) then
    raise exception using errcode = 'CT008',
      message = format('範本「%s」已被監造查驗表單引用,不可刪除', old.title);
  end if;
  return old;
end; $$;
revoke all on function public.checklist_templates_del_guard() from public, anon, authenticated;
drop trigger if exists checklist_templates_del_guard on public.checklist_templates;
create trigger checklist_templates_del_guard before delete on public.checklist_templates
  for each row execute function public.checklist_templates_del_guard();
