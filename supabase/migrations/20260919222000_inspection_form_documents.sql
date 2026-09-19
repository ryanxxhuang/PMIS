-- ── P3c 監造查驗表單:簽署即判定,並在同交易寫入監造確認量(inspection_confirmations)──────────────────
-- 問題:P2a 起 field_documents 已能建 doc_type='inspection_form' 的草稿,但 sign_field_document 回 PD007、
--   inspections 沒有申報量／單位／批次／確認量欄,P4b 的可估驗量(list_billable_backlog)也就永遠是 0——
--   廠商查驗通過後仍無法請款。判定與不合格開缺失只在前端 Quality.jsx(直接改 status＋前端 insert defects),
--   與 P3b 已下沉 DB 的自檢表規則是兩份實作。
-- 本支(設計 docs/architecture/field-documents-lifecycle.md §2.2／§4／§5、confirmed-quantity-valuation.md §16.6):
--   1. checklist_templates 加 kind／stage_key／applies_to／version(既有列全部 self_check);
--   2. inspections 加 batch_key／stage_key／unit／declared_qty／confirmed_qty／template_id／results／
--      document_id／document_version_no;status 加 '部分合格' 並以 check 釘住四值;
--   3. inspections_guard 改 BEFORE INSERT OR UPDATE:正規化(batch_key 由 location、unit 由工項、stage_key、
--      申報量四位小數);簽署專屬欄(確認量／結果／文件)與「部分合格」只由簽署路徑寫入;已判定的查驗申報資料
--      不可改;有有效確認量不可撤銷判定回待查驗;判定僅監造(既有規則,含部分合格);
--   4. 不合格／部分合格自動開缺失下沉 AFTER UPDATE trigger inspections_defect_sync(單一實作;前端 insert 退場);
--   5. 稽核 inspection.decided／reopened 以「非待查驗」為判定(含部分合格);
--   6. fn_field_document_template('inspection_form') 示範範本(Q11;supervisor_log／self_check 逐字沿用);
--   7. 規則推導通用化:fn_field_document_item_keys(doc_type, content, rule) 供自檢表與查驗表單共用
--      (self_check 舊函式改為 wrapper,簽章不變);required／human_only／confirm_required 兩類同一條規則;
--      查驗表單的 stage_key 在工項有 ITP 必要階段時才必填(由 DB 查 H 點;Edge／前端用同一條純規則帶旗標);
--   8. 索引:每個查驗最多一份活的監造查驗表單(target_key=查驗 id);inspection_confirmations 的
--      (查驗, 工項, 階段) 唯一鍵改為只算 active——撤銷後重新簽署才寫得進新的確認(P4b 設計未涵蓋更正流程);
--   9. create_inspection_form_draft(p_inspection_id):監造由查驗申請直接建立(或取回)表單草稿;
--  10. field_document_sign_inspection_form_internal:驗內容(查驗／工項／單位／位置／階段／申報量／判定／確認量／
--      查驗項目)→ 更新 inspections(判定＝status)→ 依判定寫入 inspection_confirmations(累計語意:批次前次累計＋本次;
--      同查驗已有有效確認:同量冪等、不同量 PD008 先撤銷);缺失由 4. 的 trigger 開;sign_field_document 加 case。
-- 不變:簽署前段(R1)、日誌類與自檢表分支、P4b guard／RPC(確認紀錄的 guard 已在 P4b,這裡只是呼叫端)。
-- 回復:supabase/rollbacks/20260919222000_inspection_form_documents.down.sql(欄位資料會遺失,見該檔)。
-- 錯誤代碼沿用 P2d(PD001–PD010);確認紀錄 guard 的 VQ0xx 原樣往上拋。

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. checklist_templates 加欄
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.checklist_templates
  add column if not exists kind       text not null default 'self_check'
    check (kind in ('self_check', 'inspection_form', 'supervisor_certificate')),
  add column if not exists stage_key  text,
  add column if not exists applies_to jsonb check (applies_to is null or jsonb_typeof(applies_to) = 'object'),
  add column if not exists version    int not null default 1 check (version >= 1);
comment on column public.checklist_templates.kind is
  'P3c:範本用途。self_check=廠商自主檢查表(既有列全部);inspection_form=監造查驗表單的查驗項目;supervisor_certificate=保留。';
comment on column public.checklist_templates.stage_key is 'P3c:多階段查驗用的階段鍵(對應 inspection_points.stage_key);null=不限階段。';
comment on column public.checklist_templates.applies_to is 'P3c:候選推斷用 {work_item_ids:[], keywords:[]};null=依標題／工項描述確定性比對。';
create index if not exists checklist_templates_project_kind_idx on public.checklist_templates(project_id, kind);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. inspections 加欄(只由簽署路徑寫入的欄位見 guard)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.inspections
  add column if not exists batch_key           text,
  add column if not exists stage_key           text,
  add column if not exists unit                text,
  add column if not exists declared_qty        numeric(18,4) check (declared_qty is null or declared_qty >= 0),
  add column if not exists confirmed_qty       numeric(18,4) check (confirmed_qty is null or confirmed_qty >= 0),
  add column if not exists template_id         uuid references public.checklist_templates(id) on delete set null,
  add column if not exists results             jsonb check (results is null or jsonb_typeof(results) = 'object'),
  add column if not exists document_id         uuid references public.field_documents(id) on delete set null,
  add column if not exists document_version_no int;
alter table public.inspections drop constraint if exists inspections_document_version_fkey;
alter table public.inspections add constraint inspections_document_version_fkey
  foreign key (document_id, document_version_no) references public.field_document_versions(document_id, version_no) on delete set null;
alter table public.inspections drop constraint if exists inspections_document_pair_check;
alter table public.inspections add constraint inspections_document_pair_check
  check ((document_id is null) = (document_version_no is null));
alter table public.inspections drop constraint if exists inspections_status_check;
alter table public.inspections add constraint inspections_status_check
  check (status in ('待查驗', '合格', '部分合格', '不合格'));
create index if not exists inspections_document_idx on public.inspections(document_id) where document_id is not null;
create index if not exists inspections_template_idx on public.inspections(template_id) where template_id is not null;
comment on column public.inspections.batch_key is 'P3c:施作位置的正規化批次鍵(guard 由 location 算);確認量以 (工項, 批次, 階段) 累計。';
comment on column public.inspections.declared_qty is 'P3c:廠商查驗申請的本次申報量(申請時填;已判定後不可改)。';
comment on column public.inspections.confirmed_qty is 'P3c:監造查驗表單簽署時填的本次確認量(只由簽署路徑寫入;更正走撤銷確認再重簽)。';
comment on column public.inspections.document_id is 'P3c:判定所依的監造查驗表單文件與版本(只由簽署路徑寫入)。';
comment on column public.inspections.results is 'P3c:查驗項目結果(形狀同 checklist_records.results,由 fn_checklist_judge 算 pass;只由簽署路徑寫入)。';

-- 簽署路徑判定:交易內 GUC pmis.field_document_sign 指向「本查驗」的監造查驗表單(target_key=查驗 id,或已綁 target_id)
create or replace function public.fn_inspection_sign_bypass(p_inspection uuid)
returns boolean language plpgsql stable security invoker set search_path = public as $$
declare
  v_doc uuid;
begin
  begin
    v_doc := nullif(current_setting('pmis.field_document_sign', true), '')::uuid;
  exception when others then
    return false;
  end;
  if v_doc is null then return false; end if;
  return exists (select 1 from public.field_documents d
                  where d.id = v_doc and d.doc_type = 'inspection_form'
                    and (d.target_key = p_inspection::text or d.target_id = p_inspection));
end; $$;
revoke all on function public.fn_inspection_sign_bypass(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. inspections_guard(取代 20260712001300 定義;改 BEFORE INSERT OR UPDATE)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.inspections_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  v_sign boolean := false;
  v_wi   record;
begin
  -- 正規化(所有路徑):單位由工項、批次鍵由位置、階段鍵正規化、申報量四位小數
  if new.work_item_id is not null then
    select w.unit, w.project_id into v_wi from public.work_items w where w.id = new.work_item_id;
    if not found or v_wi.project_id <> new.project_id then
      raise exception '查驗的工項不存在或不屬於本專案';
    end if;
    new.unit := nullif(btrim(coalesce(v_wi.unit, '')), '');
  else
    new.unit := null;
  end if;
  new.batch_key := case when nullif(btrim(coalesce(new.location, '')), '') is null then null
                        else public.fn_cq_batch_key(new.location) end;
  new.stage_key := nullif(public.fn_cq_normalize_text(new.stage_key), '');
  if new.declared_qty is not null then new.declared_qty := public.fn_cq_qty(new.declared_qty, '申報數量'); end if;

  if tg_op = 'INSERT' then
    if uid is not null then
      if new.status <> '待查驗' then
        raise exception '查驗申請建立時只能是待查驗;判定請由監造執行';
      end if;
      if new.confirmed_qty is not null or new.document_id is not null or new.results is not null or new.template_id is not null then
        raise exception '確認量／查驗項目結果／查驗文件只由監造查驗表單簽署寫入';
      end if;
      new.inspected_by := null; new.inspected_at := null;
    end if;
    return new;
  end if;

  -- UPDATE:專案刪除 cascade、service／遷移路徑、簽署路徑(內容已由簽署分支驗過)放行
  if not exists (select 1 from public.projects p where p.id = old.project_id) then return new; end if;
  if uid is null then return new; end if;
  v_sign := public.fn_inspection_sign_bypass(old.id);
  if v_sign then return new; end if;

  -- 簽署專屬欄:只放行 FK set null(文件／版本／範本被刪),其餘不可由使用者路徑改
  if new.confirmed_qty is distinct from old.confirmed_qty or new.results is distinct from old.results
     or not (new.document_id is null or new.document_id = old.document_id)
     or not (new.document_version_no is null or new.document_version_no = old.document_version_no)
     or not (new.template_id is null or new.template_id = old.template_id) then
    raise exception '確認量／查驗項目結果／查驗文件只由監造查驗表單簽署寫入';
  end if;
  if new.status = '部分合格' and old.status is distinct from '部分合格' then
    raise exception '部分合格只能經監造查驗表單簽署判定(須填本次確認數量)';
  end if;
  -- 有有效確認量的查驗不可撤銷判定(確認量以判定為依據);先撤銷確認
  if old.status <> '待查驗' and new.status = '待查驗'
     and exists (select 1 from public.inspection_confirmations c where c.inspection_id = old.id and c.status = 'active') then
    raise exception '此查驗已有有效的監造確認量,不可撤銷判定;請先撤銷該確認紀錄';
  end if;
  -- 已判定的查驗:申報資料不可改(工項被刪的 FK set null 放行)
  if old.status <> '待查驗' and new.status <> '待查驗'
     and (new.declared_qty is distinct from old.declared_qty
          or (new.work_item_id is distinct from old.work_item_id
              and not (new.work_item_id is null and not exists (select 1 from public.work_items w where w.id = old.work_item_id)))
          or new.batch_key is distinct from old.batch_key or new.stage_key is distinct from old.stage_key) then
    raise exception '已判定的查驗不可變更工項／位置／階段／申報數量;請先撤銷判定';
  end if;

  if public.admin_override(new.project_id) then return new; end if;
  if new.status is distinct from old.status
     and (new.status <> '待查驗' or old.status <> '待查驗')
     and public.my_org_type() <> 'supervisor' then
    raise exception '查驗判定(合格/部分合格/不合格)僅監造可執行';
  end if;
  return new;
end; $$;
revoke all on function public.inspections_guard() from public, anon, authenticated;
drop trigger if exists inspections_guard on public.inspections;
create trigger inspections_guard before insert or update on public.inspections
  for each row execute function public.inspections_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. 不合格／部分合格 → 同交易自動開缺失(使用者路徑;同一查驗最多一筆未結案)。前端 insert 退場。
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
                then format('申報 %s %s、確認 %s %s、差額 %s %s', new.declared_qty, coalesce(new.unit, ''),
                            coalesce(new.confirmed_qty, 0), coalesce(new.unit, ''),
                            new.declared_qty - coalesce(new.confirmed_qty, 0), coalesce(new.unit, ''))
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
  'P3c:查驗判不合格／部分合格 → 同交易自動開缺失(同查驗最多一筆未結案;使用者路徑)。原前端 Quality 的 insert 退場。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 稽核(取代 20260712000500 定義):判定=非待查驗(含部分合格);確認量／文件變動也算判定內容
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.audit_inspection_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'inspection.created',
      'inspection', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'inspection.deleted',
      'inspection', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if old.status <> '待查驗' and new.status = '待查驗' then
    perform public.record_audit_event(new.project_id, 'inspection.reopened',
      'inspection', new.id, 'reopened', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  elsif new.status <> '待查驗' and (
       new.status is distinct from old.status
    or new.result_note is distinct from old.result_note
    or new.inspected_by is distinct from old.inspected_by
    or new.inspected_at is distinct from old.inspected_at
    or new.confirmed_qty is distinct from old.confirmed_qty
    or new.document_id is distinct from old.document_id
    or new.document_version_no is distinct from old.document_version_no
  ) then
    perform public.record_audit_event(new.project_id, 'inspection.decided',
      'inspection', new.id, 'decided', to_jsonb(old), to_jsonb(new),
      jsonb_strip_nulls(jsonb_build_object('confirmed_qty', new.confirmed_qty, 'document_id', new.document_id,
                                           'document_version_no', new.document_version_no)), null);
  end if;
  return new;
end; $$;
revoke all on function public.audit_inspection_event() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. 範本(取代 P3b 定義;supervisor_log／self_check 逐字沿用)+ inspection_form 示範範本
-- ═══════════════════════════════════════════════════════════════════════════
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
    when 'inspection_form' then $tpl$
{
  "key": "inspection_form_demo",
  "version": 1,
  "doc_type": "inspection_form",
  "title": "監造查驗表單",
  "is_demo": true,
  "demo_label": "示範範本",
  "disclaimer": "本表為示範範本:欄位依常見公共工程監造查驗紀錄(二級品管)整理,非任何機關公定或法定格式;查驗項目取自本案查驗表範本(用途=監造查驗)。實案範本提供後另建範本,已簽署文件仍以簽署當時的範本呈現。",
  "sections": [
    { "key": "basic", "title": "一、查驗基本資料", "fields": [
      { "key": "inspection_date", "label": "查驗日期", "kind": "date", "required": true, "human_only": false },
      { "key": "inspection_id",   "label": "查驗申請", "kind": "ref",  "ref_type": "inspection", "required": true, "human_only": false,
        "note": "廠商提出的查驗申請;一份查驗申請一份表單。" },
      { "key": "work_item_id",    "label": "工項",     "kind": "ref",  "ref_type": "work_item", "required": true, "human_only": false,
        "note": "確認數量掛在此工項(須為標單末端可計價工項);與查驗申請一致。" },
      { "key": "location",        "label": "施作位置／批次", "kind": "text", "required": true, "human_only": false, "confirm_required": true,
        "note": "確認數量以此為批次累計;同一位置分次查驗會累計,請核對後確認。" },
      { "key": "stage_key",       "label": "查驗階段", "kind": "text", "required": false, "human_only": false, "confirm_required": true,
        "note": "工項在檢驗停留點設有必要階段(H 點)時必填且須為其中之一;單階段工項留空。全部必要階段皆確認的量才可估驗。" },
      { "key": "unit",            "label": "單位",     "kind": "text", "required": true, "human_only": false,
        "note": "取自標單工項,須一致;不一致不得簽署。" } ] },
    { "key": "request", "title": "二、查驗申請資料", "fields": [
      { "key": "declared_qty",         "label": "申報數量",     "kind": "number", "required": true, "human_only": false, "confirm_required": true,
        "note": "廠商查驗申請載明的本次申報量;由申請帶入,請核對後確認。本次確認數量不得超過申報數量。" },
      { "key": "self_check_record_id", "label": "檢附之自主檢查", "kind": "ref", "ref_type": "checklist_record", "required": false, "human_only": false,
        "note": "查驗申請檢附的廠商自主檢查紀錄(含已簽署自主檢查表版本)。" } ] },
    { "key": "items", "title": "三、查驗項目", "fields": [
      { "key": "template_id", "label": "查驗表範本", "kind": "ref", "ref_type": "checklist_template", "required": false, "human_only": false,
        "note": "本案用途為監造查驗的查驗表範本(選填);沒有範本仍可判定。" },
      { "key": "results", "label": "查驗項目", "kind": "checklist_items", "required": false, "human_only": false,
        "item_key": "results.<no>",
        "item_rules": { "num": { "human_only": true, "confirm_required": true }, "bool": { "human_only": false, "confirm_required": true } },
        "note": "有範本時每個項目必填:實測值(num)只能由監造親自量測填寫,照片與告示板讀數只作提示;勾選項(bool)由監造逐項確認;本次未檢請標不適用並填原因。任一項不合格時不得判定合格。" } ] },
    { "key": "verdict", "title": "四、判定與確認數量", "fields": [
      { "key": "verdict", "label": "判定", "kind": "select", "options": ["合格", "部分合格", "不合格"], "required": true, "human_only": true,
        "note": "只能由監造親自判定;系統與 AI 不建議、不預填。簽署即判定:合格=本次確認數量等於申報數量;部分合格=大於 0 且小於申報數量;不合格=0。" },
      { "key": "confirmed_qty", "label": "本次確認數量", "kind": "number", "required": true, "human_only": true,
        "note": "只能由監造親自填寫;簽署後成為廠商可估驗的依據(累計到此工項此批次此階段)。更正只能撤銷確認紀錄後重新簽署。" },
      { "key": "result_note", "label": "判定說明", "kind": "text", "required": false, "human_only": false,
        "note": "不合格／部分合格必填,作為自動開立缺失的說明。" } ] },
    { "key": "note", "title": "五、備註", "fields": [
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
  'P3a／P3b／P3c:文書範本(supervisor_log=示範範本;self_check=示範框架範本;inspection_form=示範範本,查驗項目取自本案 kind=inspection_form 的 checklist_templates);必填鍵／人填欄／須確認欄由此推導;其他類型回 null。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. 規則推導通用化(自檢表與查驗表單同一條規則)
-- ═══════════════════════════════════════════════════════════════════════════
-- 7.1 項目鍵 results.<no>(依 doc_type 取該範本的 item_rules;p_rule=null 全部、'human_only'／'confirm_required' 取規則為真的 kind)
create or replace function public.fn_field_document_item_keys(p_doc_type text, p_content jsonb, p_rule text default null)
returns text[] language sql stable security invoker set search_path = pg_catalog, public as $fn$
  with rules as (
    select f -> 'item_rules' as r
    from jsonb_array_elements(coalesce(public.fn_field_document_template(p_doc_type) -> 'sections', '[]'::jsonb)) s
    cross join jsonb_array_elements(coalesce(s -> 'fields', '[]'::jsonb)) f
    where f ->> 'key' = 'results'
  )
  select coalesce(array_agg('results.' || (it ->> 'no') order by it ->> 'no'), '{}'::text[])
  from jsonb_array_elements(public.fn_field_document_checklist_items(p_content)) it, rules
  where p_doc_type in ('self_check', 'inspection_form')
    and nullif(btrim(coalesce(it ->> 'no', '')), '') is not null
    and (p_rule is null
         or coalesce((rules.r -> coalesce(it ->> 'kind', 'bool') ->> p_rule)::boolean, false)
         or (p_rule = 'confirm_required' and coalesce((rules.r -> coalesce(it ->> 'kind', 'bool') ->> 'human_only')::boolean, false)));
$fn$;
revoke all on function public.fn_field_document_item_keys(text, jsonb, text) from public, anon, authenticated;
comment on function public.fn_field_document_item_keys(text, jsonb, text) is
  'P3c:自檢表／查驗表單的項目鍵 results.<no>(項目取內容 template_id 的本案範本;規則依該類型範本 item_rules)。';

-- P3b 簽章沿用:改為 wrapper(同一條規則)
create or replace function public.fn_field_document_self_check_item_keys(p_content jsonb, p_rule text default null)
returns text[] language sql stable security invoker set search_path = pg_catalog, public as $fn$
  select public.fn_field_document_item_keys('self_check', p_content, p_rule);
$fn$;
revoke all on function public.fn_field_document_self_check_item_keys(jsonb, text) from public, anon, authenticated;

-- 7.2 查驗表單的階段鍵:工項有 ITP 必要階段(H 點,required_for_billing)時才必填
create or replace function public.fn_field_document_stage_required(p_doc_type text, p_content jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_wi uuid;
begin
  if p_doc_type <> 'inspection_form' or p_content is null or jsonb_typeof(p_content) <> 'object'
     or nullif(p_content ->> 'work_item_id', '') is null then
    return false;
  end if;
  begin
    v_wi := (p_content ->> 'work_item_id')::uuid;
  exception when others then
    return false;
  end;
  return cardinality(public.fn_cq_required_stages_internal(v_wi)) > 0;
end; $$;
revoke all on function public.fn_field_document_stage_required(text, jsonb) from public, anon, authenticated;

-- 7.3 人填欄(取代 P3b 定義):範本 human_only 欄 ∪ 兩類文書的實測值項目
create or replace function public.fn_field_document_human_only_keys(p_doc_type text, p_content jsonb)
returns text[] language sql stable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(array_agg(k order by k), '{}'::text[]) from (
    select f ->> 'key' as k
    from jsonb_array_elements(coalesce(public.fn_field_document_template(p_doc_type) -> 'sections', '[]'::jsonb)) s
    cross join jsonb_array_elements(coalesce(s -> 'fields', '[]'::jsonb)) f
    where coalesce((f ->> 'human_only')::boolean, false)
    union
    select unnest(public.fn_field_document_item_keys(p_doc_type, p_content, 'human_only'))
  ) x;
$fn$;
revoke all on function public.fn_field_document_human_only_keys(text, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_human_only_keys(text, jsonb) is
  'P3a／P3b／P3c:只能人填的欄位鍵:範本 human_only 欄(監造日誌到場;查驗表單判定與確認數量)∪ 自檢表／查驗表單實測值項目;AI 版本不得帶入。';

-- 7.4 須確認欄(取代 P3b 定義)
create or replace function public.fn_field_document_confirm_required_keys(p_doc_type text, p_content jsonb)
returns text[] language sql stable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(array_agg(k order by k), '{}'::text[]) from (
    select f ->> 'key' as k
    from jsonb_array_elements(coalesce(public.fn_field_document_template(p_doc_type) -> 'sections', '[]'::jsonb)) s
    cross join jsonb_array_elements(coalesce(s -> 'fields', '[]'::jsonb)) f
    where coalesce((f ->> 'human_only')::boolean, false) or coalesce((f ->> 'confirm_required')::boolean, false)
    union
    select unnest(public.fn_field_document_item_keys(p_doc_type, p_content, 'confirm_required'))
  ) x;
$fn$;
revoke all on function public.fn_field_document_confirm_required_keys(text, jsonb) from public, anon, authenticated;

-- 7.5 必填鍵(取代 P3b 定義):stored ∪ 類型固定欄／範本 required ∪ 施工日誌各工項數量 ∪ 兩類文書的範本每項 ∪ 查驗表單有必要階段時的 stage_key
create or replace function public.fn_field_document_required_fields(p_doc_type text, p_content jsonb, p_stored jsonb)
returns jsonb language sql stable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
  from (
    select distinct k from (
      select stored.k
        from jsonb_array_elements_text(
               case when jsonb_typeof(p_stored) = 'array' then p_stored else '[]'::jsonb end) as stored(k)
       where not (p_doc_type = 'daily_log' and stored.k like 'items.%.qty_today')
         and not (p_doc_type in ('self_check', 'inspection_form') and stored.k like 'results.%')
         and not (p_doc_type = 'inspection_form' and stored.k = 'stage_key')
      union all
      select unnest(case when p_doc_type = 'daily_log'
        then array['weather_am','weather_pm','work_summary','labor','equipment','materials']
        else public.fn_field_document_template_required_keys(p_doc_type) end)
      union all
      select 'items.' || key || '.qty_today'
        from jsonb_object_keys(case when p_doc_type = 'daily_log' and jsonb_typeof(p_content -> 'items') = 'object'
                                    then p_content -> 'items' else '{}'::jsonb end) as key
      union all
      select unnest(public.fn_field_document_item_keys(p_doc_type, p_content, null))
      union all
      select 'stage_key' where public.fn_field_document_stage_required(p_doc_type, p_content)
    ) s
    where k is not null and btrim(k) <> ''
  ) d;
$fn$;
revoke all on function public.fn_field_document_required_fields(text, jsonb, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_required_fields(text, jsonb, jsonb) is
  'P2d／P3a／P3b／P3c:必填鍵=stored ∪ 類型固定欄(daily_log 六欄;其他類型取範本 required)∪ 施工日誌 items.<id>.qty_today ∪ 自檢表／查驗表單範本每項 results.<no> ∪ 查驗表單工項有 ITP 必要階段時的 stage_key(項目鍵／階段鍵永遠由內容重算)。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. 索引
-- ═══════════════════════════════════════════════════════════════════════════
-- 每個查驗最多一份活的監造查驗表單(target_key=查驗 id;簽署後 target_id 亦=查驗 id,由既有 target_uidx 兜底)
create unique index if not exists field_documents_inspection_uidx
  on public.field_documents(project_id, target_key)
  where doc_type = 'inspection_form' and target_key is not null and status not in ('discarded', 'superseded');
-- (查驗, 工項, 階段) 唯一鍵只算 active:撤銷後重新簽署才寫得進新的確認(已撤銷列保留 inspection_id 供追溯)
drop index if exists public.inspection_confirmations_inspection_stage_uidx;
create unique index if not exists inspection_confirmations_inspection_stage_uidx
  on public.inspection_confirmations(inspection_id, work_item_id, coalesce(stage_key, ''))
  where inspection_id is not null and status = 'active';

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. create_inspection_form_draft:監造由查驗申請建立(或取回既有活的)監造查驗表單草稿
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.create_inspection_form_draft(p_inspection_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  v_insp public.inspections%rowtype;
  v_doc  public.field_documents%rowtype;
begin
  if uid is null then
    raise exception using errcode = 'PD006', message = '請先登入';
  end if;
  select * into v_insp from public.inspections i where i.id = p_inspection_id;
  if not found or not public.is_project_member(v_insp.project_id) then
    raise exception using errcode = 'PD006', message = '找不到查驗申請或無權存取';
  end if;
  if not (public.can_write(v_insp.project_id)
          and (public.my_org_type() = 'supervisor' or public.admin_override(v_insp.project_id))) then
    raise exception using errcode = 'PD006', message = '監造查驗表單只有監造成員可建立';
  end if;
  select * into v_doc from public.field_documents d
    where d.project_id = v_insp.project_id and d.doc_type = 'inspection_form'
      and (d.target_key = v_insp.id::text or d.target_id = v_insp.id)
      and d.status not in ('discarded', 'superseded')
    order by d.created_at limit 1;
  if found then
    return to_jsonb(v_doc) || jsonb_build_object('created', false);
  end if;
  begin
    insert into public.field_documents (project_id, doc_type, doc_date, target_key)
      values (v_insp.project_id, 'inspection_form', (now() at time zone 'Asia/Taipei')::date, v_insp.id::text)
      returning * into v_doc;
  exception when unique_violation then
    select * into v_doc from public.field_documents d
      where d.project_id = v_insp.project_id and d.doc_type = 'inspection_form' and d.target_key = v_insp.id::text
        and d.status not in ('discarded', 'superseded')
      order by d.created_at limit 1;
    return to_jsonb(v_doc) || jsonb_build_object('created', false);
  end;
  return to_jsonb(v_doc) || jsonb_build_object('created', true);
end; $$;
revoke all on function public.create_inspection_form_draft(uuid) from public, anon;
grant execute on function public.create_inspection_form_draft(uuid) to authenticated;
comment on function public.create_inspection_form_draft(uuid) is
  'P3c:監造由查驗申請建立監造查驗表單草稿(target_key=查驗 id;已有活文件即回該份,created=false)。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. save_field_document_version(取代 P3b 定義):範本本案檢查含查驗表單;其餘逐字沿用
-- ═══════════════════════════════════════════════════════════════════════════
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

  -- 自檢表／查驗表單:內容指定的檢查表範本必須是本案的(必填鍵由它推導,不能拿別案範本);同步到文件的範本欄
  if v_doc.doc_type in ('self_check', 'inspection_form') and nullif(p_content ->> 'template_id', '') is not null then
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
         template_id        = case when v_doc.doc_type in ('self_check', 'inspection_form') and v_tpl is not null then v_tpl else template_id end
   where id = p_document_id
   returning * into v_doc;

  return jsonb_build_object(
    'document_id', v_doc.id, 'version_no', v_ver.version_no, 'content_hash', v_ver.content_hash,
    'status', v_doc.status, 'required_fields', v_doc.required_fields, 'recheck', v_doc.recheck,
    'amended_from_version', v_amended);
end; $$;
revoke all on function public.save_field_document_version(uuid, int, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.save_field_document_version(uuid, int, jsonb, jsonb, jsonb, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. 簽署分支:監造查驗表單 → inspections 判定 ＋ inspection_confirmations 確認量(同交易)
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
      message = format('表單申報數量 %s 與查驗申請的申報數量 %s 不符;申報量以查驗申請為準', v_declared, v_insp.declared_qty);
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
      message = format('本次確認數量 %s 超過申報數量 %s', v_confirm, v_declared);
  end if;
  if v_verdict = '合格' and v_confirm <> v_declared then
    raise exception using errcode = 'PD010',
      message = format('判定合格時本次確認數量須等於申報數量 %s(目前 %s);未全數通過請判部分合格', v_declared, v_confirm);
  elsif v_verdict = '部分合格' and not (v_confirm > 0 and v_confirm < v_declared) then
    raise exception using errcode = 'PD010',
      message = format('判定部分合格時本次確認數量須大於 0 且小於申報數量 %s(目前 %s)', v_declared, v_confirm);
  elsif v_verdict = '不合格' and v_confirm <> 0 then
    raise exception using errcode = 'PD010', message = format('判定不合格時本次確認數量須為 0(目前 %s)', v_confirm);
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
        message = format('此查驗已有有效的監造確認量 %s(紀錄 %s);更正判定或數量請先撤銷該確認紀錄再重新簽署', v_prev.qty_delta, v_prev.id);
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
  'P3c:監造查驗表單簽署分支——驗查驗／工項／單位／位置／階段／申報量／判定／確認量／查驗項目後,更新 inspections(簽署即判定)並依判定寫入 inspection_confirmations(累計;同查驗同量冪等、不同量須先撤銷);缺失由 inspections_defect_sync 開;只由 sign_field_document 呼叫。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. sign_field_document(取代 P3b 定義):加 inspection_form 分支;其餘逐字沿用
-- ═══════════════════════════════════════════════════════════════════════════
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
  if v_doc.doc_type not in ('daily_log', 'supervisor_log', 'self_check', 'inspection_form') then
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

  -- 2. 事實列(簽署版本內容為準;GUC 只在本交易內放行同類同案同日的事實表 guard／查驗的簽署專屬欄;自檢表每次簽署新增一列)
  perform set_config('pmis.field_document_sign', p_document_id::text, true);
  v_log_id := case v_doc.doc_type
    when 'daily_log'       then public.field_document_sign_daily_log_internal(v_doc, v_ver, uid)
    when 'supervisor_log'  then public.field_document_sign_supervisor_log_internal(v_doc, v_ver, uid)
    when 'self_check'      then public.field_document_sign_self_check_internal(v_doc, v_ver, uid)
    when 'inspection_form' then public.field_document_sign_inspection_form_internal(v_doc, v_ver, uid)
  end;
  perform set_config('pmis.field_document_sign', '', true);

  -- 3. 文件狀態與事實列綁定(自檢表再簽=綁到新的修訂版次列;查驗表單=綁查驗)
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
  'P2d／P3a／R1／P3b／P3c:簽署(已登入的平台帳號;不要求兩步驟驗證)。daily_log 落 daily_logs／daily_log_items;supervisor_log 落 supervisor_logs;self_check 落 checklist_records(首簽 Rev.0、再簽修訂 Rev.N,判定由 DB 計算);inspection_form 更新 inspections(簽署即判定)並寫入 inspection_confirmations(確認量);綁 target_id、處理 agent_actions。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. 權限總表(H3:新函式預設不可執行;上面已逐支明示。authenticated 允許清單只多 create_inspection_form_draft)
-- ═══════════════════════════════════════════════════════════════════════════
revoke all on function public.inspections_guard() from public, anon, authenticated;
revoke all on function public.inspections_defect_sync() from public, anon, authenticated;
revoke all on function public.audit_inspection_event() from public, anon, authenticated;
revoke all on function public.fn_inspection_sign_bypass(uuid) from public, anon, authenticated;
revoke all on function public.fn_field_document_item_keys(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.fn_field_document_stage_required(text, jsonb) from public, anon, authenticated;
revoke all on function public.field_document_sign_inspection_form_internal(public.field_documents, public.field_document_versions, uuid) from public, anon, authenticated;
