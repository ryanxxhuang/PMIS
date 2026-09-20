-- 2026-09-20 廠商驗收 B｜紙本查驗表的已記錄實測值可由系統抄錄進草稿(仍須人逐項確認才可簽署)。
--
-- 為什麼:廠商驗收報告(docs/reviews/2026-09-20-contractor-acceptance-report.md)指出「自動填表」
--   有實作上的硬限制——自檢表與監造查驗表單的實測值(kind=num)被列為 human_only,AI 版本一律不得
--   帶入,即使紙本查驗紀錄表右欄「實測值」已經白紙黑字寫著「線徑 11 * 11 MM」,系統也只能丟一句
--   提示要人再鍵一次。抄錄紙上已經寫好的數字不是「AI 代為量測」,把它擋掉反而讓人改用手打,
--   錯字風險更高、也失去逐欄原文佐證。
--
-- 改什麼(只有一處):self_check 與 inspection_form 框架範本的 item_rules.num.human_only:true → false。
--   confirm_required 維持 true,所以:
--     * fn_field_document_human_only_keys 不再包含 results.<no>(num)→ AI 版本可帶入值與 filled 來源;
--     * fn_field_document_confirm_required_keys 仍包含每一項 → fn_field_document_unmet_fields 對只標
--       filled 的項目回 needs_confirmation,**簽署 RPC 照舊擋下**:人沒有逐項按確認就不能簽。
--   判定(verdict)、本次確認數量(confirmed_qty)、監造日誌到場(attendance)維持 human_only 不變——
--   照片永遠不能證明合格、確認量與到場。
--
-- 守住的紅線(pgTAP 釘住):AI 版本仍不得帶入 verdict／confirmed_qty／attendance;只標 filled 的檢查項目
--   仍無法簽署(needs_confirmation);合格判定仍由 fn_checklist_judge 依範本量化標準重算。
--
-- 資料保留:不動任何既有列。既有已簽署文件的內容與判定不受影響(簽署當時的範本語意已存在版本內)。
--   既有草稿重跑起稿時才會出現抄錄值,且一律標 filled(待確認),不會自動變成 confirmed。
-- 相容:函式簽章全部不變,只換 fn_field_document_template 回傳的 JSON。
-- 回復:supabase/rollbacks/20260920120000_measured_from_record.down.sql(把 num.human_only 改回 true)。

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
        "item_rules": { "num": { "human_only": false, "confirm_required": true }, "bool": { "human_only": false, "confirm_required": true } },
        "note": "每個項目由範本推導為必填:實測值(num)若紙本查驗表／告示板的實測欄已經寫好,系統會照原文抄錄進來並標待確認(附原文與來源照片);系統只抄錄既有紀錄,不代為量測、不從畫面推定讀數,設計值／規範要求、空欄與單位對不上的紀錄一律不帶入,其餘留空由人親自量測填寫。勾選項(bool)若由系統建議須附依據。**每個項目(含已抄錄的)簽署前都必須由人逐項確認**;本次未檢請標不適用並填原因。合格與否由系統依範本量化標準計算。" } ] },
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
        "item_rules": { "num": { "human_only": false, "confirm_required": true }, "bool": { "human_only": false, "confirm_required": true } },
        "note": "有範本時每個項目必填:實測值(num)若紙本查驗表／告示板的實測欄已經寫好,系統會照原文抄錄進來並標待確認(附原文與來源照片);系統只抄錄既有紀錄,不代為量測、不猜讀數,設計值、空欄與單位對不上的紀錄一律不帶入,其餘留空由監造親自量測填寫。勾選項(bool)由監造逐項確認。**每個項目(含已抄錄的)簽署前都必須由監造逐項確認**;本次未檢請標不適用並填原因。任一項不合格時不得判定合格。判定與本次確認數量仍只能由監造親自填寫。" } ] },
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
  'P3a／P3b／P3c／2026-09-20 B:文書範本(supervisor_log=示範範本;self_check=示範框架範本;inspection_form=示範範本,查驗項目取自本案 kind=inspection_form 的 checklist_templates);必填鍵／人填欄／須確認欄由此推導;實測值(num)不再是 human_only(紙本實測欄可由系統抄錄),但仍 confirm_required——簽署前人要逐項確認;其他類型回 null。';
