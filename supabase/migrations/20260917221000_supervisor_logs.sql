-- P3a｜監造日誌後端:事實表、RLS、guard、示範範本、簽署分支(D-026;設計 docs/architecture/field-documents-lifecycle.md §2.2、§3.4、§5)。
--
-- 為什麼:監造日誌是「每日監造紀錄」,現有月份彙整的監造報表不能代替(D-026 第 2 點)。P2a 的
-- field_documents 已能建監造日誌草稿(doc_type='supervisor_log'),但事實表不存在(綁定即拒)、
-- 簽署回 PD007。本支補齊:
--   * supervisor_logs 事實表(每案每日唯一):監造寫、專案成員可讀(Q4 使用者 2026-09-17 同意暫行)、
--     非成員與跨案不可;與 photos／daily_logs 同為專案範圍,不掛契約包,契約分級(D-018)只管
--     documents／requirements 家族,本表不外洩契約內容。
--   * 已簽署列只有簽署 RPC 交易內可重寫、DELETE 一律擋——與 P2d daily_logs_guard 同一條規則。
--     P2d 把它寫在 daily_logs 專用函式裡,再抄一份給 supervisor_logs 就是兩份實作;本支把規則抽成
--     fn_field_document_fact_guard(doc_type, …)(以 doc_type 查 field_documents 綁定與簽署列、GUC 放行),
--     daily_logs_guard／daily_log_items_guard 改呼叫它(行為不變,由 field_document_sign.sql 回歸釘住),
--     fn_daily_log_signed／fn_daily_log_sign_bypass 退場。
--   * 示範範本(Q11 使用者 2026-09-17 決定:實案範本沒有,先用示範範本):fn_field_document_template
--     ('supervisor_log') 單一定義——is_demo=true、demo_label='示範範本'、免責聲明、各節欄位(含 required／
--     human_only);介面與列印由這支取標記,必填鍵與「只能人填」欄由它推導,不另抄一份。欄位對應常見
--     公共工程監造日誌(天氣、到場人員、監造事項、查驗情形、廠商施工情形、通知、追蹤),不宣稱為法定格式。
--   * 到場(attendance)只能人填:AI 版本不得帶入值或把來源標成 filled／confirmed／na
--     (field_document_versions_guard 擋,所有寫入者含 service);人工版本標 filled 也算「待確認」
--     (needs_confirmation),存版與簽署共用 fn_field_document_unmet_fields(doc_type, …) 判定;簽署時
--     attendance 必須 confirmed(或 na＋reason 且陣列為空)。任何照片都不能作為到場證明。
--   * 簽署分支:sign_field_document 共用前段(身分、責任方、版本、雜湊、冪等、aal2、意願、必填、附件角色)
--     後依 doc_type 分派到內部函式——daily_log 分支行為與 P2d 相同(只搬進 field_document_sign_daily_log_internal),
--     supervisor_log 分支驗內容形狀與引用(查驗、缺失、疑義、送審、施工日誌文件必須是本案的;到場人員若給
--     user_id 必須是本案監造方成員;工項必須是本案的)後 upsert supervisor_logs、綁 target_id。
--     附件角色隔離沿用 fn_field_document_attachment_issues:監造日誌的證據(role=evidence)必須是監造上傳
--     的照片,廠商照片只能 role=reference(「廠商提供之施工照片」註記)。self_check／inspection_form 仍回 PD007。
--
-- 錯誤代碼沿用 P2d(PD001–PD010);PD004 的 detail 新增 status='needs_confirmation'(人填欄只被 AI／前端
-- 標 filled,尚未由人確認)。
-- 資料保留:不動任何既有列;daily_logs 的 guard 行為不變。
-- 相容:save／sign／submit／receive／return 的簽章不變;fn_field_document_unmet_fields 改為三參數
--   (doc_type, required, field_sources),舊二參數版本移除(只有 save／sign 呼叫它)。
-- 回復:supabase/rollbacks/20260917221000_supervisor_logs.down.sql(drop 新表與新函式、還原 P2a 版本 guard,
--   再重跑 20260917205000 還原 P2d 的 save／sign／guard／helper;已簽署落下的 supervisor_logs 列隨表移除,回復前先匯出)。

-- ── 0. 示範範本(單一定義) ─────────────────────────────────────────────────────
-- 純映射、無資料,authenticated 可執行(介面／列印取 is_demo／demo_label／disclaimer 與各節欄位);anon 不給。
-- 欄位 kind 只是呈現提示;required／human_only 是規則來源(見 §1 的推導函式)。
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
    else null
  end;
$fn$;
revoke all on function public.fn_field_document_template(text) from public, anon;
grant execute on function public.fn_field_document_template(text) to authenticated;
comment on function public.fn_field_document_template(text) is
  'P3a:文書範本(supervisor_log=示範範本,is_demo=true、demo_label=示範範本);必填鍵與人填欄由此推導;其他類型回 null。';

-- ── 1. 由範本推導的規則 ─────────────────────────────────────────────────────────
create or replace function public.fn_field_document_template_required_keys(p_doc_type text)
returns text[] language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(array_agg(f ->> 'key' order by f ->> 'key'), '{}'::text[])
  from jsonb_array_elements(coalesce(public.fn_field_document_template(p_doc_type) -> 'sections', '[]'::jsonb)) s
  cross join jsonb_array_elements(coalesce(s -> 'fields', '[]'::jsonb)) f
  where coalesce((f ->> 'required')::boolean, false);
$fn$;
revoke all on function public.fn_field_document_template_required_keys(text) from public, anon, authenticated;

create or replace function public.fn_field_document_human_only_keys(p_doc_type text)
returns text[] language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(array_agg(f ->> 'key' order by f ->> 'key'), '{}'::text[])
  from jsonb_array_elements(coalesce(public.fn_field_document_template(p_doc_type) -> 'sections', '[]'::jsonb)) s
  cross join jsonb_array_elements(coalesce(s -> 'fields', '[]'::jsonb)) f
  where coalesce((f ->> 'human_only')::boolean, false);
$fn$;
revoke all on function public.fn_field_document_human_only_keys(text) from public, anon, authenticated;
comment on function public.fn_field_document_human_only_keys(text) is
  'P3a:只能人填的欄位鍵(範本 human_only):AI 版本不得帶入;人工版本標 filled 視為待確認;簽署須 confirmed 或 na＋reason。';

-- 類型中文標籤(錯誤訊息用)
create or replace function public.fn_field_document_type_label(p_doc_type text)
returns text language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select case p_doc_type
    when 'daily_log'       then '施工日誌'
    when 'supervisor_log'  then '監造日誌'
    when 'self_check'      then '自主檢查表'
    when 'inspection_form' then '監造查驗表單'
    else coalesce(p_doc_type, '文件')
  end;
$fn$;
revoke all on function public.fn_field_document_type_label(text) from public, anon, authenticated;

-- 必填鍵(取代 P2d 定義):stored ∪ 類型固定欄 ∪ 施工日誌內容各工項數量。
-- 施工日誌固定欄維持 P2d 的六欄(公定格式,無範本);其他類型由範本 required 推導(supervisor_log 有、
-- self_check／inspection_form 目前 null → 只回 stored,P3b／P3c 各自補)。
create or replace function public.fn_field_document_required_fields(p_doc_type text, p_content jsonb, p_stored jsonb)
returns jsonb language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
  from (
    select distinct k from (
      select stored.k
        from jsonb_array_elements_text(
               case when jsonb_typeof(p_stored) = 'array' then p_stored else '[]'::jsonb end) as stored(k)
       where not (p_doc_type = 'daily_log' and stored.k like 'items.%.qty_today')
      union all
      select unnest(case when p_doc_type = 'daily_log'
        then array['weather_am','weather_pm','work_summary','labor','equipment','materials']
        else public.fn_field_document_template_required_keys(p_doc_type) end)
      union all
      select 'items.' || key || '.qty_today'
        from jsonb_object_keys(case when p_doc_type = 'daily_log' and jsonb_typeof(p_content -> 'items') = 'object'
                                    then p_content -> 'items' else '{}'::jsonb end) as key
    ) s
    where k is not null and btrim(k) <> ''
  ) d;
$fn$;
revoke all on function public.fn_field_document_required_fields(text, jsonb, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_required_fields(text, jsonb, jsonb) is
  'P2d／P3a:必填鍵=stored ∪ 類型固定欄(daily_log 六欄;其他類型取範本 required)∪ 施工日誌內容各工項 items.<id>.qty_today。';

-- 待補判定(取代 P2d 二參數版本;存版與簽署共用):加上 doc_type 才能套「只能人填」規則——
-- 人填欄的 filled(AI／前端帶入)不算齊備,回 needs_confirmation;confirmed 或 na＋reason 才可簽。
drop function if exists public.fn_field_document_unmet_fields(jsonb, jsonb);
create or replace function public.fn_field_document_unmet_fields(p_doc_type text, p_required jsonb, p_field_sources jsonb)
returns jsonb language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('key', k, 'status', st) order by k), '[]'::jsonb)
  from (
    select r.k,
      case
        when src is null or jsonb_typeof(src) <> 'object' then 'missing'
        when src ->> 'status' = 'confirmed' then null
        when src ->> 'status' = 'filled' then
          case when r.k = any (public.fn_field_document_human_only_keys(p_doc_type)) then 'needs_confirmation' end
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
revoke all on function public.fn_field_document_unmet_fields(text, jsonb, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_unmet_fields(text, jsonb, jsonb) is
  'P2d／P3a:必填鍵的待補清單 [{key,status}];status=missing/pending/na_without_reason/needs_confirmation(人填欄只被標 filled)/unknown_status。';

-- 本案引用存在性(監造日誌的通知／追蹤／收件情形引用的單據必須是本案的;未知類型=不存在)
create or replace function public.fn_project_ref_exists(p_project_id uuid, p_ref_type text, p_ref_id uuid)
returns boolean language plpgsql stable security invoker set search_path = public as $$
declare
  v_table text;
  v_ok    boolean;
begin
  if p_project_id is null or p_ref_id is null then
    return false;
  end if;
  v_table := case p_ref_type
    when 'inspection'       then 'inspections'
    when 'defect'           then 'defects'
    when 'rfi'              then 'rfis'
    when 'submittal'        then 'submittals'
    when 'daily_log'        then 'daily_logs'
    when 'field_document'   then 'field_documents'
    when 'inspection_point' then 'inspection_points'
    when 'observation'      then 'observations'
    when 'test_sample'      then 'test_samples'
    when 'checklist_record' then 'checklist_records'
    else null
  end;
  if v_table is null then
    return false;
  end if;
  execute format('select exists (select 1 from public.%I t where t.id = $1 and t.project_id = $2)', v_table)
    into v_ok using p_ref_id, p_project_id;
  return v_ok;
end; $$;
revoke all on function public.fn_project_ref_exists(uuid, text, uuid) from public, anon, authenticated;

-- ── 2. supervisor_logs 事實表 ───────────────────────────────────────────────────
create table if not exists public.supervisor_logs (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  log_date           date not null,
  weather_am         text,
  weather_pm         text,
  attendance         jsonb not null default '[]'::jsonb check (jsonb_typeof(attendance) = 'array'),          -- [{user_id?, name, from?, to?}] 只能人填
  supervision_items  jsonb not null default '[]'::jsonb check (jsonb_typeof(supervision_items) = 'array'),   -- [{time?, item, location?, work_item_id?, note?, source?, photo_ids?}]
  inspection_ids     uuid[] not null default '{}',                                                            -- 當日查驗(inspections.id)
  notices            jsonb not null default '[]'::jsonb check (jsonb_typeof(notices) = 'array'),             -- [{to, content, ref_type?, ref_id?}]
  followups          jsonb not null default '[]'::jsonb check (jsonb_typeof(followups) = 'array'),           -- [{ref_type?, ref_id?, content, status}]
  contractor_summary text,
  daily_log_receipt  jsonb check (daily_log_receipt is null or jsonb_typeof(daily_log_receipt) = 'object'),  -- 同日施工日誌文件的收件情形快照
  note               text,
  template_key       text,                                                                                    -- 簽署當時的範本鍵(示範範本 supervisor_log_demo)
  template_version   int,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, log_date)
);
comment on table public.supervisor_logs is
  'P3a:監造日誌事實表(每案每日一份)。監造寫、專案成員可讀(Q4 暫行);有簽署文件指向本列時只有簽署 RPC 可重寫;attendance 只能人填。';
comment on column public.supervisor_logs.attendance is
  '監造到場人員與時段 [{user_id?, name, from?, to?}];只能人填並確認,AI 不得從任何照片推定。';
comment on column public.supervisor_logs.template_key is
  '簽署當時使用的範本鍵;supervisor_log_demo=示範範本(非機關公定格式),介面與列印須標「示範範本」。';

alter table public.supervisor_logs enable row level security;
drop policy if exists "supervisor_logs_select" on public.supervisor_logs;
create policy "supervisor_logs_select" on public.supervisor_logs for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "supervisor_logs_insert" on public.supervisor_logs;
create policy "supervisor_logs_insert" on public.supervisor_logs for insert to authenticated
  with check (public.can_write(project_id)
    and (public.my_org_type() = 'supervisor' or public.admin_override(project_id)));
drop policy if exists "supervisor_logs_update" on public.supervisor_logs;
create policy "supervisor_logs_update" on public.supervisor_logs for update to authenticated
  using (public.can_write(project_id)
    and (public.my_org_type() = 'supervisor' or public.admin_override(project_id)))
  with check (public.can_write(project_id)
    and (public.my_org_type() = 'supervisor' or public.admin_override(project_id)));
drop policy if exists "supervisor_logs_delete" on public.supervisor_logs;
create policy "supervisor_logs_delete" on public.supervisor_logs for delete to authenticated
  using (public.can_write(project_id)
    and (public.my_org_type() = 'supervisor' or public.admin_override(project_id)));

-- grants:基線 default privileges 會給 authenticated 全部 DML,這裡明確重述(TRUNCATE 等四種自 H1 起不再自動給)
revoke all on public.supervisor_logs from public, anon, authenticated;
grant select, insert, update, delete on public.supervisor_logs to authenticated;

-- ── 3. 事實表 guard(通用):已簽署列只有簽署 RPC 交易內可重寫、DELETE 一律擋 ──────────
-- 「已簽署」=有該類型文件綁定此列且該文件有任何簽署列(簽後更正回草稿期間仍受保護:事實列裡是舊簽署內容)。
create or replace function public.fn_field_document_target_signed(p_doc_type text, p_target_id uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from public.field_documents d
    join public.field_document_signatures s on s.document_id = d.id
    where d.doc_type = p_doc_type and d.target_id = p_target_id
  );
$$;
revoke all on function public.fn_field_document_target_signed(text, uuid) from public, anon, authenticated;

-- 放行:交易內 GUC pmis.field_document_sign 指向「同類型、同案、同日」的文件(用專案＋日期而非 target_id:
-- 對方收件後 superseded 的舊文件仍綁著此列,接手的新文件在首次簽署時尚未綁定)。
create or replace function public.fn_field_document_sign_bypass(p_doc_type text, p_project_id uuid, p_doc_date date)
returns boolean language plpgsql stable security invoker set search_path = public as $$
declare v_doc uuid;
begin
  begin
    v_doc := nullif(current_setting('pmis.field_document_sign', true), '')::uuid;
  exception when others then
    return false;
  end;
  if v_doc is null then
    return false;
  end if;
  return exists (
    select 1 from public.field_documents d
    where d.id = v_doc and d.doc_type = p_doc_type
      and d.project_id = p_project_id and d.doc_date = p_doc_date
  );
end; $$;
revoke all on function public.fn_field_document_sign_bypass(text, uuid, date) from public, anon, authenticated;

-- 日誌類事實列的保護規則(單一實作;daily_logs／supervisor_logs 的 trigger 都呼叫這支):
-- 專案刪除 cascade 放行;未簽署列照舊;已簽署列只放行 GUC 指向同案同日文件的 UPDATE 且不得改專案／日期。
create or replace function public.fn_field_document_fact_guard(
  p_doc_type text, p_op text, p_old_id uuid, p_old_project uuid, p_old_date date,
  p_new_id uuid, p_new_project uuid, p_new_date date)
returns void language plpgsql stable security invoker set search_path = public as $$
declare v_label text := public.fn_field_document_type_label(p_doc_type);
begin
  if not exists (select 1 from public.projects pr where pr.id = p_old_project) then
    return;  -- 專案刪除 cascade
  end if;
  if not public.fn_field_document_target_signed(p_doc_type, p_old_id) then
    return;  -- 未簽署:既有直接寫入路徑照常
  end if;
  if p_op = 'UPDATE' and public.fn_field_document_sign_bypass(p_doc_type, p_old_project, p_old_date) then
    if p_new_id <> p_old_id or p_new_project <> p_old_project or p_new_date <> p_old_date then
      raise exception '已簽署%的專案／日期不可變更', v_label;
    end if;
    return;
  end if;
  raise exception '% 的%已有簽署文件,不可直接%;更正請在該文件建立新版本並重新簽署',
    p_old_date, v_label, case p_op when 'DELETE' then '刪除' else '修改' end;
end; $$;
revoke all on function public.fn_field_document_fact_guard(text, text, uuid, uuid, date, uuid, uuid, date) from public, anon, authenticated;

-- daily_logs／daily_log_items:同名 trigger 與函式保留(P2d 建立),只把規則改為呼叫通用實作;行為不變。
create or replace function public.daily_logs_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_field_document_fact_guard('daily_log', tg_op, old.id, old.project_id, old.log_date,
    case when tg_op = 'UPDATE' then new.id end,
    case when tg_op = 'UPDATE' then new.project_id end,
    case when tg_op = 'UPDATE' then new.log_date end);
  return coalesce(new, old);
end; $$;
revoke all on function public.daily_logs_guard() from public, anon, authenticated;

create or replace function public.daily_log_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_log_id uuid;
  v_log    record;
begin
  -- UPDATE 改掛到別的日誌:新舊兩邊都要檢查
  for v_log_id in select distinct x from unnest(array[
      case when tg_op in ('UPDATE','DELETE') then old.daily_log_id end,
      case when tg_op in ('INSERT','UPDATE') then new.daily_log_id end]) as t(x)
    where x is not null loop
    select l.project_id, l.log_date into v_log from public.daily_logs l where l.id = v_log_id;
    if not found then
      continue;  -- 父列已消失=日誌／專案刪除 cascade
    end if;
    if not exists (select 1 from public.projects pr where pr.id = v_log.project_id) then
      continue;
    end if;
    if public.fn_field_document_target_signed('daily_log', v_log_id)
       and not public.fn_field_document_sign_bypass('daily_log', v_log.project_id, v_log.log_date) then
      raise exception '% 的施工日誌已有簽署文件,其工項數量不可直接%;更正請在該文件建立新版本並重新簽署',
        v_log.log_date, case tg_op when 'INSERT' then '新增' when 'DELETE' then '刪除' else '修改' end;
    end if;
  end loop;
  return coalesce(new, old);
end; $$;
revoke all on function public.daily_log_items_guard() from public, anon, authenticated;

-- P2d 的專用 helper 退場(規則已由通用實作承接)
drop function if exists public.fn_daily_log_sign_bypass(uuid, date);
drop function if exists public.fn_daily_log_signed(uuid);

-- supervisor_logs:使用者路徑建立者由伺服器決定;updated_at 由伺服器維護;已簽署列同上
create or replace function public.supervisor_logs_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();   -- 登錄者即建立者,不可冒名
      new.created_at := now();
    end if;
    new.updated_at := now();
    return new;
  end if;
  perform public.fn_field_document_fact_guard('supervisor_log', tg_op, old.id, old.project_id, old.log_date,
    case when tg_op = 'UPDATE' then new.id end,
    case when tg_op = 'UPDATE' then new.project_id end,
    case when tg_op = 'UPDATE' then new.log_date end);
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and (new.created_by is distinct from old.created_by or new.created_at <> old.created_at) then
      raise exception '監造日誌的建立者／建立時間不可變更';
    end if;
    new.updated_at := now();
    return new;
  end if;
  return old;
end; $$;
revoke all on function public.supervisor_logs_guard() from public, anon, authenticated;
drop trigger if exists supervisor_logs_guard on public.supervisor_logs;
create trigger supervisor_logs_guard before insert or update or delete on public.supervisor_logs
  for each row execute function public.supervisor_logs_guard();

-- ── 4. 版本 guard(取代 P2a 定義):加「人填欄 AI 不得帶入」;其餘逐字沿用 ─────────────────
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
    -- 人填欄(範本 human_only,如監造日誌到場):AI 版本不得帶入值,來源只能留 pending 或不給
    for v_key in select unnest(public.fn_field_document_human_only_keys(v_doc.doc_type)) loop
      v_val := new.content -> v_key;
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

-- ── 5. save_field_document_version(取代 P2d 定義):只把待補判定改為三參數版本 ──────────
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

  v_amended := case when v_doc.status in ('signed', 'submitted', 'returned') then v_doc.current_version_no end;
  insert into public.field_document_versions
    (document_id, author_kind, content, field_sources, attachments, change_note, amended_from_version)
  values (p_document_id, 'human', p_content, coalesce(p_field_sources, '{}'::jsonb), p_attachments,
          nullif(btrim(coalesce(p_change_note, '')), ''), v_amended)
  returning * into v_ver;

  v_required := public.fn_field_document_required_fields(v_doc.doc_type, v_ver.content, v_doc.required_fields);
  v_recheck  := public.fn_field_document_unmet_fields(v_doc.doc_type, v_required, v_ver.field_sources)
             || public.fn_field_document_attachment_issues(v_doc.doc_type, v_doc.project_id, v_ver.attachments);
  update public.field_documents
     set current_version_no = v_ver.version_no,
         required_fields    = v_required,
         recheck            = v_recheck,
         status             = case when jsonb_array_length(v_recheck) > 0 then 'pending_input' else 'draft' end
   where id = p_document_id
   returning * into v_doc;

  return jsonb_build_object(
    'document_id', v_doc.id, 'version_no', v_ver.version_no, 'content_hash', v_ver.content_hash,
    'status', v_doc.status, 'required_fields', v_doc.required_fields, 'recheck', v_doc.recheck,
    'amended_from_version', v_amended);
end; $$;
revoke all on function public.save_field_document_version(uuid, int, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.save_field_document_version(uuid, int, jsonb, jsonb, jsonb, text) to authenticated;

-- ── 6. 簽署的類型分支(內部函式;只由 sign_field_document 在交易內呼叫,GUC 由呼叫者設定) ──
-- 6.1 施工日誌:內容形狀、工項、數量 → upsert daily_logs＋重寫 daily_log_items(與 P2d 相同)
create or replace function public.field_document_sign_daily_log_internal(
  p_doc public.field_documents, p_ver public.field_document_versions, p_uid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_items  jsonb;
  v_key    text;
  v_val    jsonb;
  v_wi     uuid;
  v_src    jsonb;
  v_log_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_uid then
    raise exception '簽署分支只能由簽署 RPC 於登入者交易內呼叫';
  end if;
  if (p_ver.content ? 'labor'     and jsonb_typeof(p_ver.content -> 'labor')     not in ('array', 'null'))
  or (p_ver.content ? 'equipment' and jsonb_typeof(p_ver.content -> 'equipment') not in ('array', 'null'))
  or (p_ver.content ? 'materials' and jsonb_typeof(p_ver.content -> 'materials') not in ('array', 'null'))
  or (p_ver.content ? 'extras'    and jsonb_typeof(p_ver.content -> 'extras')    not in ('object', 'null'))
  or (p_ver.content ? 'weather_am'   and jsonb_typeof(p_ver.content -> 'weather_am')   not in ('string', 'null'))
  or (p_ver.content ? 'weather_pm'   and jsonb_typeof(p_ver.content -> 'weather_pm')   not in ('string', 'null'))
  or (p_ver.content ? 'work_summary' and jsonb_typeof(p_ver.content -> 'work_summary') not in ('string', 'null'))
  or (p_ver.content ? 'items'        and jsonb_typeof(p_ver.content -> 'items')        not in ('object', 'null')) then
    raise exception using errcode = 'PD010',
      message = '內容形狀不符:labor/equipment/materials 須為陣列、extras 須為物件、天氣與施工概況須為文字、items 須為物件';
  end if;
  v_items := case when jsonb_typeof(p_ver.content -> 'items') = 'object' then p_ver.content -> 'items' else '{}'::jsonb end;
  for v_key, v_val in select key, value from jsonb_each(v_items) loop
    begin
      v_wi := v_key::uuid;
    exception when others then
      raise exception using errcode = 'PD010', message = format('工項鍵 %s 不是合法 UUID', v_key);
    end;
    if not exists (select 1 from public.work_items w where w.id = v_wi and w.project_id = p_doc.project_id) then
      raise exception using errcode = 'PD010', message = format('工項 %s 不屬於本專案', v_key);
    end if;
    v_src := p_ver.field_sources -> ('items.' || v_key || '.qty_today');
    if v_src ->> 'status' = 'na' then
      continue;  -- 本日不適用(reason 已由待補判定要求)
    end if;
    if jsonb_typeof(v_val) <> 'object' or jsonb_typeof(v_val -> 'qty_today') <> 'number' then
      raise exception using errcode = 'PD010', message = format('工項 %s 的當日數量缺值或不是數字', v_key);
    end if;
    if (v_val ->> 'qty_today')::numeric < 0 then
      raise exception using errcode = 'PD010', message = format('工項 %s 的當日數量不可為負', v_key);
    end if;
  end loop;

  insert into public.daily_logs
    (project_id, log_date, weather_am, weather_pm, labor, equipment, materials, extras, work_summary, status, created_by)
  values (p_doc.project_id, p_doc.doc_date,
          p_ver.content ->> 'weather_am', p_ver.content ->> 'weather_pm',
          nullif(p_ver.content -> 'labor', 'null'::jsonb), nullif(p_ver.content -> 'equipment', 'null'::jsonb),
          nullif(p_ver.content -> 'materials', 'null'::jsonb), nullif(p_ver.content -> 'extras', 'null'::jsonb),
          p_ver.content ->> 'work_summary', '已簽署', p_uid)
  on conflict (project_id, log_date) do update
    set weather_am = excluded.weather_am, weather_pm = excluded.weather_pm,
        labor = excluded.labor, equipment = excluded.equipment, materials = excluded.materials,
        extras = excluded.extras, work_summary = excluded.work_summary, status = '已簽署'
  returning id into v_log_id;
  delete from public.daily_log_items where daily_log_id = v_log_id;
  insert into public.daily_log_items (daily_log_id, work_item_id, qty_today, note)
  select v_log_id, e.key::uuid, (e.value ->> 'qty_today')::numeric, nullif(e.value ->> 'note', '')
    from jsonb_each(v_items) e
   where (p_ver.field_sources -> ('items.' || e.key || '.qty_today') ->> 'status') is distinct from 'na';
  return v_log_id;
end; $$;
revoke all on function public.field_document_sign_daily_log_internal(public.field_documents, public.field_document_versions, uuid) from public, anon, authenticated;

-- 6.2 監造日誌:內容形狀與引用(到場人員／工項／查驗／缺失等必須是本案的)→ upsert supervisor_logs
create or replace function public.field_document_sign_supervisor_log_internal(
  p_doc public.field_documents, p_ver public.field_document_versions, p_uid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c        jsonb := p_ver.content;
  v_row    jsonb;
  v_uuid   uuid;
  v_ref    text;
  v_log_id uuid;
  v_ids    uuid[] := '{}';
  v_tpl    jsonb := public.fn_field_document_template('supervisor_log');
  v_att_na boolean := (p_ver.field_sources -> 'attendance' ->> 'status') = 'na';
begin
  if auth.uid() is null or auth.uid() <> p_uid then
    raise exception '簽署分支只能由簽署 RPC 於登入者交易內呼叫';
  end if;
  if (c ? 'weather_am'         and jsonb_typeof(c -> 'weather_am')         not in ('string', 'null'))
  or (c ? 'weather_pm'         and jsonb_typeof(c -> 'weather_pm')         not in ('string', 'null'))
  or (c ? 'contractor_summary' and jsonb_typeof(c -> 'contractor_summary') not in ('string', 'null'))
  or (c ? 'note'               and jsonb_typeof(c -> 'note')               not in ('string', 'null'))
  or (c ? 'attendance'         and jsonb_typeof(c -> 'attendance')         not in ('array', 'null'))
  or (c ? 'supervision_items'  and jsonb_typeof(c -> 'supervision_items')  not in ('array', 'null'))
  or (c ? 'inspection_ids'     and jsonb_typeof(c -> 'inspection_ids')     not in ('array', 'null'))
  or (c ? 'notices'            and jsonb_typeof(c -> 'notices')            not in ('array', 'null'))
  or (c ? 'followups'          and jsonb_typeof(c -> 'followups')          not in ('array', 'null'))
  or (c ? 'daily_log_receipt'  and jsonb_typeof(c -> 'daily_log_receipt')  not in ('object', 'null'))
  or (c ? 'template'           and jsonb_typeof(c -> 'template')           not in ('object', 'null')) then
    raise exception using errcode = 'PD010',
      message = '內容形狀不符:天氣／摘要／備註須為文字,到場／監造事項／查驗／通知／追蹤須為陣列,收件情形與範本須為物件';
  end if;
  if c -> 'template' is not null and jsonb_typeof(c -> 'template') = 'object'
     and (c -> 'template' ->> 'key') is distinct from (v_tpl ->> 'key') then
    raise exception using errcode = 'PD010',
      message = format('範本 %s 不是目前的監造日誌範本(%s)', coalesce(c -> 'template' ->> 'key', '(無)'), v_tpl ->> 'key');
  end if;

  -- 到場人員:只能人填(來源已由待補判定要求 confirmed 或 na);na 時必須為空,否則必須非空且每筆合法
  if v_att_na then
    if jsonb_array_length(coalesce(c -> 'attendance', '[]'::jsonb)) > 0 then
      raise exception using errcode = 'PD010', message = '到場人員標為不適用,但內容仍有到場人員';
    end if;
  else
    if jsonb_array_length(coalesce(c -> 'attendance', '[]'::jsonb)) = 0 then
      raise exception using errcode = 'PD010', message = '到場人員為空;本日未到場請標不適用並填原因';
    end if;
    for v_row in select value from jsonb_array_elements(c -> 'attendance') loop
      if jsonb_typeof(v_row) <> 'object' then
        raise exception using errcode = 'PD010', message = '到場人員每筆須為物件';
      end if;
      if (v_row ->> 'user_id') is not null then
        begin
          v_uuid := (v_row ->> 'user_id')::uuid;
        exception when others then
          raise exception using errcode = 'PD010', message = '到場人員的 user_id 不是合法 UUID';
        end;
        if not exists (select 1 from public.project_members m join public.profiles p on p.id = m.user_id
                        where m.project_id = p_doc.project_id and m.user_id = v_uuid and p.org_type = 'supervisor') then
          raise exception using errcode = 'PD010', message = format('到場人員 %s 不是本案監造方成員', v_uuid);
        end if;
      elsif nullif(btrim(coalesce(v_row ->> 'name', '')), '') is null then
        raise exception using errcode = 'PD010', message = '到場人員須有姓名或本案監造方成員 user_id';
      end if;
      if ((v_row ->> 'from') is not null and (v_row ->> 'from') !~ '^\d{2}:\d{2}$')
         or ((v_row ->> 'to') is not null and (v_row ->> 'to') !~ '^\d{2}:\d{2}$') then
        raise exception using errcode = 'PD010', message = '到場時段須為 HH:MM';
      end if;
    end loop;
  end if;

  -- 監造事項:每筆 item 文字;work_item_id／photo_ids 若給必須是本案的
  for v_row in select value from jsonb_array_elements(coalesce(c -> 'supervision_items', '[]'::jsonb)) loop
    if jsonb_typeof(v_row) <> 'object' or nullif(btrim(coalesce(v_row ->> 'item', '')), '') is null then
      raise exception using errcode = 'PD010', message = '監造事項每筆須為物件並含 item 文字';
    end if;
    if (v_row ->> 'work_item_id') is not null then
      begin
        v_uuid := (v_row ->> 'work_item_id')::uuid;
      exception when others then
        raise exception using errcode = 'PD010', message = '監造事項的 work_item_id 不是合法 UUID';
      end;
      if not exists (select 1 from public.work_items w where w.id = v_uuid and w.project_id = p_doc.project_id) then
        raise exception using errcode = 'PD010', message = format('監造事項的工項 %s 不屬於本專案', v_uuid);
      end if;
    end if;
    if v_row ? 'photo_ids' and jsonb_typeof(v_row -> 'photo_ids') = 'array' then
      for v_ref in select value from jsonb_array_elements_text(v_row -> 'photo_ids') loop
        begin
          v_uuid := v_ref::uuid;
        exception when others then
          raise exception using errcode = 'PD010', message = '監造事項的 photo_ids 含不合法 UUID';
        end;
        if not exists (select 1 from public.photos p where p.id = v_uuid and p.project_id = p_doc.project_id) then
          raise exception using errcode = 'PD010', message = format('監造事項引用的照片 %s 不屬於本專案', v_uuid);
        end if;
      end loop;
    end if;
  end loop;

  -- 當日查驗:每個 id 必須是本案查驗
  for v_ref in select value from jsonb_array_elements_text(coalesce(c -> 'inspection_ids', '[]'::jsonb)) loop
    begin
      v_uuid := v_ref::uuid;
    exception when others then
      raise exception using errcode = 'PD010', message = '查驗 id 不是合法 UUID';
    end;
    if not exists (select 1 from public.inspections i where i.id = v_uuid and i.project_id = p_doc.project_id) then
      raise exception using errcode = 'PD010', message = format('查驗 %s 不屬於本專案', v_uuid);
    end if;
    v_ids := v_ids || v_uuid;
  end loop;

  -- 通知:對象只能是廠商或機關;引用必須成對且存在於本案
  for v_row in select value from jsonb_array_elements(coalesce(c -> 'notices', '[]'::jsonb)) loop
    if jsonb_typeof(v_row) <> 'object' or nullif(btrim(coalesce(v_row ->> 'content', '')), '') is null
       or coalesce(v_row ->> 'to', '') not in ('contractor', 'owner') then
      raise exception using errcode = 'PD010', message = '通知事項每筆須含 content 文字且 to 為 contractor 或 owner';
    end if;
    if ((v_row ->> 'ref_type') is null) <> ((v_row ->> 'ref_id') is null) then
      raise exception using errcode = 'PD010', message = '通知事項的 ref_type 與 ref_id 必須同時給或同時不給';
    end if;
    if (v_row ->> 'ref_id') is not null then
      begin
        v_uuid := (v_row ->> 'ref_id')::uuid;
      exception when others then
        raise exception using errcode = 'PD010', message = '通知事項的 ref_id 不是合法 UUID';
      end;
      if not public.fn_project_ref_exists(p_doc.project_id, v_row ->> 'ref_type', v_uuid) then
        raise exception using errcode = 'PD010',
          message = format('通知事項引用的 %s %s 不存在或不屬於本專案', v_row ->> 'ref_type', v_uuid);
      end if;
    end if;
  end loop;

  -- 追蹤:content 文字、status open／closed;引用規則同通知
  for v_row in select value from jsonb_array_elements(coalesce(c -> 'followups', '[]'::jsonb)) loop
    if jsonb_typeof(v_row) <> 'object' or nullif(btrim(coalesce(v_row ->> 'content', '')), '') is null
       or coalesce(v_row ->> 'status', '') not in ('open', 'closed') then
      raise exception using errcode = 'PD010', message = '追蹤事項每筆須含 content 文字且 status 為 open 或 closed';
    end if;
    if ((v_row ->> 'ref_type') is null) <> ((v_row ->> 'ref_id') is null) then
      raise exception using errcode = 'PD010', message = '追蹤事項的 ref_type 與 ref_id 必須同時給或同時不給';
    end if;
    if (v_row ->> 'ref_id') is not null then
      begin
        v_uuid := (v_row ->> 'ref_id')::uuid;
      exception when others then
        raise exception using errcode = 'PD010', message = '追蹤事項的 ref_id 不是合法 UUID';
      end;
      if not public.fn_project_ref_exists(p_doc.project_id, v_row ->> 'ref_type', v_uuid) then
        raise exception using errcode = 'PD010',
          message = format('追蹤事項引用的 %s %s 不存在或不屬於本專案', v_row ->> 'ref_type', v_uuid);
      end if;
    end if;
  end loop;

  -- 施工日誌收件情形:若引用文件,必須是本案的施工日誌文件
  if jsonb_typeof(c -> 'daily_log_receipt') = 'object' and (c -> 'daily_log_receipt' ->> 'document_id') is not null then
    begin
      v_uuid := (c -> 'daily_log_receipt' ->> 'document_id')::uuid;
    exception when others then
      raise exception using errcode = 'PD010', message = '收件情形的 document_id 不是合法 UUID';
    end;
    if not exists (select 1 from public.field_documents d
                    where d.id = v_uuid and d.project_id = p_doc.project_id and d.doc_type = 'daily_log') then
      raise exception using errcode = 'PD010', message = format('收件情形引用的施工日誌文件 %s 不屬於本專案', v_uuid);
    end if;
  end if;

  insert into public.supervisor_logs
    (project_id, log_date, weather_am, weather_pm, attendance, supervision_items, inspection_ids,
     notices, followups, contractor_summary, daily_log_receipt, note, template_key, template_version, created_by)
  values (p_doc.project_id, p_doc.doc_date, c ->> 'weather_am', c ->> 'weather_pm',
          coalesce(nullif(c -> 'attendance', 'null'::jsonb), '[]'::jsonb),
          coalesce(nullif(c -> 'supervision_items', 'null'::jsonb), '[]'::jsonb),
          v_ids,
          coalesce(nullif(c -> 'notices', 'null'::jsonb), '[]'::jsonb),
          coalesce(nullif(c -> 'followups', 'null'::jsonb), '[]'::jsonb),
          c ->> 'contractor_summary', nullif(c -> 'daily_log_receipt', 'null'::jsonb), c ->> 'note',
          coalesce(c -> 'template' ->> 'key', v_tpl ->> 'key'),
          coalesce((c -> 'template' ->> 'version')::int, (v_tpl ->> 'version')::int),
          p_uid)
  on conflict (project_id, log_date) do update
    set weather_am = excluded.weather_am, weather_pm = excluded.weather_pm,
        attendance = excluded.attendance, supervision_items = excluded.supervision_items,
        inspection_ids = excluded.inspection_ids, notices = excluded.notices, followups = excluded.followups,
        contractor_summary = excluded.contractor_summary, daily_log_receipt = excluded.daily_log_receipt,
        note = excluded.note, template_key = excluded.template_key, template_version = excluded.template_version
  returning id into v_log_id;
  return v_log_id;
end; $$;
revoke all on function public.field_document_sign_supervisor_log_internal(public.field_documents, public.field_document_versions, uuid) from public, anon, authenticated;

-- ── 7. sign_field_document(取代 P2d 定義):共用前段＋依類型分派 ─────────────────────
-- 順序:簽署列(trigger 驗版本／雜湊／角色／成員／aal 並取簽署者資料)→ 事實列(GUC 放行同類同案同日的 guard)→
-- 文件 status='signed'＋target_id(guard:簽署列已存在、事實列存在且同案)→ agent_actions。
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
