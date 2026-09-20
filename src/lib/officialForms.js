// 公定／參考格式表單的「欄位 mapping 單一定義」(2026-09-20 廠商驗收 C 包;C2 包補齊監造兩份)。
// 四份:施工日誌(工程會附表四)、自主檢查表(臺北市)、監造查驗紀錄表(臺北市施工抽查紀錄表)、
// 監造報表(工程會附表五;按日填報的日報,不是監造月報)。
// 驗收退回的原因:廠商編輯畫面(精簡表)與紙本(SiteLogOfficialSheet)是兩份不同的欄位定義,
// 人要先填精簡表、再切「公定格式檢視」才看得到真表。這裡把「原表欄名 → 儲存欄位 → 來源／計算 →
// 可編角色 → 必填／不適用條件 → 紙本位置」收成一份資料,畫面(可編輯紙本)與列印／PDF 吃同一份:
//   * 紙本元件依 editableBy 決定某一格在誰的視角長出 input(唯讀視角永遠只有文字);
//   * mapping 完整性由 officialForms.test.js 對 docs/architecture/official-form-mapping.md 釘住,
//     程式加欄位而文件沒寫(或反過來)會紅。
//
// 誠實原則(驗收指令 C「範本來源誠實」):範本標的是「參考工程會／臺北市公開格式」,不是機關核定版;
// provenance 帶來源頁、原檔與版本,accredited 一律 false,畫面與紙本都要印得出來。
// 臺北市 ODT 內的示例數值、假公司名與「不良範例」的錯誤判定一律不入產品(本檔不引用任何示例值)。
//
// 簽署語意:表單範本鍵與版本在存檔時寫進文件內容(stampFormTemplate),簽署版本因此自己記得
// 「當時是哪一版表單」;之後改範本不會改動舊版本的內容或判定(版本內容與雜湊本來就不可變)。
import { parseLocalDate } from './dates.js'
import { plannedPctNow } from './progressPlan.js'

// ── 範本來源(provenance)─────────────────────────────────────────────────────
export const FORM_TEMPLATES = Object.freeze({
  daily_log: Object.freeze({
    key: 'pcc-daily-log-1080430',
    version: 1,
    title: '公共工程施工日誌',
    label: '參考工程會格式',
    issuer: '行政院公共工程委員會',
    revision: '108.04.30 修正・附表四',
    source_url: 'https://www.pcc.gov.tw/content/index?eid=5886&lang=1&type=C',
    source_file: 'docs/reviews/assets/2026-09-20-contractor-acceptance/pcc-daily-log-1080430.pdf',
    accredited: false,
    disclaimer: '本表版面參考行政院公共工程委員會 108.04.30「公共工程施工日誌」(附表四)公開格式編製,未經主辦機關核定;技術標準以本案核定規範／圖說為準。',
  }),
  self_check: Object.freeze({
    key: 'taipei-self-check-ref',
    version: 1,
    title: '施工自主檢查表',
    label: '參考臺北市格式',
    issuer: '臺北市政府',
    revision: '工程品質相關格式參考範例',
    source_url: 'https://gpis.taipei/RWD/frontfunction/Quality/wfrmDownload.aspx',
    source_file: 'docs/reviews/assets/2026-09-20-contractor-acceptance/taipei-rebar-self-check-example.odt',
    accredited: false,
    disclaimer: '本表版面參考臺北市政府「施工自主檢查表」公開格式參考範例編製,未經主辦機關核定;檢查項目與檢查標準一律取本案核定的檢查表範本,不引用範例檔內的示例數值或判定。',
  }),
  inspection_form: Object.freeze({
    key: 'taipei-inspection-ref',
    version: 1,
    title: '施工抽查紀錄表',
    label: '參考臺北市格式',
    issuer: '臺北市政府',
    revision: '工程品質相關格式參考範例',
    source_url: 'https://gpis.taipei/RWD/frontfunction/Quality/wfrmDownload.aspx',
    source_file: 'docs/reviews/assets/2026-09-20-contractor-acceptance/taipei-rebar-inspection-example.odt',
    accredited: false,
    disclaimer: '本表版面參考臺北市政府「施工抽查紀錄表」公開格式參考範例編製,未經主辦機關核定;抽查項目與抽查標準一律取本案核定的查驗表範本,不引用範例檔內的示例數值、良好與不良填寫示例或其示例判定。',
  }),
  supervisor_log: Object.freeze({
    key: 'pcc-supervisor-log-1080430',
    version: 1,
    title: '公共工程監造報表',
    label: '參考工程會格式',
    issuer: '行政院公共工程委員會',
    revision: '108.04.30 修正・附表五',
    source_url: 'https://www.pcc.gov.tw/content/index?eid=5886&lang=1&type=C',
    source_file: 'docs/reviews/assets/2026-09-20-contractor-acceptance/pcc-supervisor-log-1080430.pdf',
    accredited: false,
    disclaimer: '本表版面參考行政院公共工程委員會 108.04.30「公共工程監造報表」(附表五)公開格式編製,未經主辦機關核定。原表是**按日**填報的監造報表(註 2),不是監造月報;原表註 3 載明各機關得依契約約定自行增訂,本系統增列的欄位在紙上標明為本系統欄位。',
  }),
})

export const templateOf = (docType) => FORM_TEMPLATES[docType] || null

// 範本標示(畫面與紙本同一句):標明是參考格式,不得看起來像機關核定版
export function templateCaption(docType) {
  const t = templateOf(docType)
  if (!t) return ''
  return `${t.label}・${t.issuer}${t.revision ? `${t.revision}` : ''}(範本 ${t.key} v${t.version}${t.accredited ? '' : '・未經機關核定'})`
}

// 存檔時把「當時用的表單範本」寫進內容:簽署版本自己記得版面語意,日後改版不影響舊文件
export function stampFormTemplate(content, docType) {
  const t = templateOf(docType)
  if (!t || !content || typeof content !== 'object') return content
  const cur = content.form_template
  if (cur && cur.key === t.key && cur.version === t.version) return content
  return { ...content, form_template: { key: t.key, version: t.version } }
}
// 顯示時以「內容記的範本」為準(舊版本印舊範本標示),沒記的(舊文件／Edge 起稿未存檔)回退目前範本
export function formTemplateOf(content, docType) {
  const t = templateOf(docType)
  const stamped = content?.form_template
  if (!stamped?.key) return t ? { key: t.key, version: t.version, current: true } : null
  return { key: stamped.key, version: stamped.version ?? 1, current: !!t && stamped.key === t.key && stamped.version === t.version }
}

// ── mapping 列 ──────────────────────────────────────────────────────────────
// label：原表欄名(逐字);key：儲存欄位(null=本系統不存,只在紙上留白給人手寫);
// origin：來源／計算;editableBy：可在畫面上直接編輯的角色(空陣列=唯讀或系統算);
// requirement：必填／不適用條件;position：紙本位置(頁/節)
const row = (label, key, origin, editableBy, requirement, position) => Object.freeze({ label, key, origin, editableBy, requirement, position })

export const DAILY_LOG_MAPPING = Object.freeze([
  // 表頭
  row('表報編號', 'doc_no', '人填(機關文件編號規則)', ['contractor'], '非必填;未填則紙上留白', 'p.1 表頭'),
  row('本日天氣:上午', 'weather_am', '氣象署帶入或人填', ['contractor'], '必填', 'p.1 表頭'),
  row('本日天氣:下午', 'weather_pm', '氣象署帶入或人填', ['contractor'], '必填', 'p.1 表頭'),
  row('填表日期(年月日星期)', 'log_date', '文件日期(民國年換算、星期由日期推算)', [], '必填;一天一份文件,由日期選擇器決定', 'p.1 表頭'),
  row('工程名稱', null, '專案資料 projects.name', [], '專案已建立即有;缺值顯示待補', 'p.1 表頭'),
  row('承攬廠商名稱', null, '專案資料 projects.contractor_name', [], '缺值顯示待補(至專案設定補)', 'p.1 表頭'),
  row('核定工期(天)', null, '確定性計算:契約竣工日−開工基準日+1(基準日登錄)', [], '兩個基準日皆有才算;缺任一顯示待補', 'p.1 表頭'),
  row('累計工期(天)', null, '確定性計算:本日−開工基準日+1', [], '無開工基準日顯示待補', 'p.1 表頭'),
  row('剩餘工期(天)', null, '確定性計算:核定工期−累計工期', [], '核定工期或累計工期缺一即待補', 'p.1 表頭'),
  row('工期展延天數', 'extras.extended_days', '人填(依機關核准展延公文)', ['contractor'], '非必填;無展延填 0 或留白', 'p.1 表頭'),
  row('開工日期', null, '專案基準日 commencement_date(缺則契約起始日)', [], '缺值顯示待補', 'p.1 表頭'),
  row('完工日期', 'extras.actual_completion_date', '人填(實際完工日;預定竣工日另在契約期程)', ['contractor'], '非必填;未完工留白', 'p.1 表頭'),
  row('預定進度(%)', null, '確定性計算:預定進度表內插至本日(lib/progressPlan)', [], '未設定預定進度表顯示待補', 'p.1 表頭'),
  row('實際進度(%)', null, '確定性計算:截至本日最近一期估驗累計金額÷契約總額', [], '尚無估驗顯示待補', 'p.1 表頭'),
  // 一、施工項目
  row('一、施工項目', 'items.<work_item_id>.description', '標單工項(加入時快照項次／名稱／單位)', ['contractor'], '由人加入或照片辨識配對後列入', 'p.1 §一'),
  row('一、單位', 'items.<work_item_id>.unit', '標單工項單位(快照)', [], '隨工項帶入', 'p.1 §一'),
  row('一、契約數量', null, '標單工項契約數量(依核准變更後)', [], '隨工項帶入', 'p.1 §一'),
  row('一、本日完成數量', 'items.<work_item_id>.qty_today', '人填;現場紀錄照片寫明且單位相符才帶入待確認', ['contractor'], '列入的工項一律必填(可標不適用並填原因)', 'p.1 §一'),
  row('一、累計完成數量', null, '確定性計算:本日以前已落庫日誌+本日(不含標不適用者)', [], '系統彙計,不可人改', 'p.1 §一'),
  row('一、備註', 'items.<work_item_id>.note', '人填', ['contractor'], '非必填', 'p.1 §一'),
  row('一、營造業專業工程特定施工項目 A', 'extras.specialty_a', '人填(名稱／單位／契約數量／本日／累計／備註)', ['contractor'], '非必填;本案無此類項目可留白', 'p.1 §一'),
  row('一、營造業專業工程特定施工項目 B', 'extras.specialty_b', '人填(同上)', ['contractor'], '非必填', 'p.1 §一'),
  row('一、施工概況摘要', 'work_summary', '人填;照片說明可帶入待確認', ['contractor'], '必填', 'p.1 §一'),
  // 二、材料(整節的來源／狀態掛在陣列欄位本身:本日確無進料要標不適用並填原因,不得留空也不得填「無」)
  row('二、工地材料管理概況(整節)', 'materials', '人填逐列;本日確無進料標不適用並填原因', ['contractor'], '必填;不適用須填原因', 'p.1 §二'),
  row('二、材料名稱', 'materials[].name', '人填(常用材料可一鍵帶入)', ['contractor'], '整節必填;本日無進料須標不適用並填原因', 'p.1 §二'),
  row('二、材料單位', 'materials[].unit', '人填', ['contractor'], '隨材料列', 'p.1 §二'),
  row('二、材料契約數量', 'materials[].contract_qty', '人填(契約／訂購數量;本系統標單不含材料口徑)', ['contractor'], '非必填;無依據留白', 'p.1 §二'),
  row('二、本日使用數量', 'materials[].qty', '人填', ['contractor'], '隨材料列', 'p.1 §二'),
  row('二、累計使用數量', null, '確定性計算:同名同單位材料自日誌彙計', [], '系統彙計', 'p.1 §二'),
  row('二、材料備註', 'materials[].note', '人填', ['contractor'], '非必填', 'p.1 §二'),
  // 三、人員及機具(整節來源同上)
  row('三、出工人數(整節)', 'labor', '人填逐列;本日確無出工標不適用並填原因', ['contractor'], '必填;不適用須填原因', 'p.1 §三'),
  row('三、機具使用(整節)', 'equipment', '人填逐列;本日確無機具標不適用並填原因', ['contractor'], '必填;不適用須填原因', 'p.1 §三'),
  row('三、工別', 'labor[].type', '人填(常用工別可一鍵帶入)', ['contractor'], '整節必填;本日無出工須標不適用並填原因', 'p.1 §三'),
  row('三、本日人數', 'labor[].count', '人填', ['contractor'], '隨工別列', 'p.1 §三'),
  row('三、累計人數', null, '確定性計算:同工別自日誌彙計', [], '系統彙計', 'p.1 §三'),
  row('三、機具名稱', 'equipment[].name', '人填', ['contractor'], '整節必填;本日無機具須標不適用並填原因', 'p.1 §三'),
  row('三、機具本日使用數量', 'equipment[].count', '人填', ['contractor'], '隨機具列', 'p.1 §三'),
  row('三、機具累計使用數量', null, '確定性計算:同機具自日誌彙計', [], '系統彙計', 'p.1 §三'),
  // 四、技術士
  row('四、應設置技術士之專業工程:有／無', 'extras.technicians', '人填(填寫種類及人數即為「有」)', ['contractor'], '非必填;留白視為「無」', 'p.1 §四'),
  row('技術士簽章表:專業工程項目', 'extras.technician_project', '人填', ['contractor'], '勾「有」才需填', 'p.3 附表'),
  row('技術士簽章表:應置技術士人數', 'extras.technician_required_count', '人填', ['contractor'], '勾「有」才需填', 'p.3 附表'),
  row('技術士簽章表:種類／人數／姓名／證書字號／備註', 'extras.technician_rows', '人填(逐列)', ['contractor'], '勾「有」才需填;簽名欄為紙本手簽,系統不代簽', 'p.3 附表'),
  // 五、安衛
  row('五、(一)1. 實施勤前教育(含工地預防災變及危害告知)', 'extras.edu', '人勾選', ['contractor'], '非必填;未勾為「無」', 'p.1 §五'),
  row('五、(一)2. 新進勞工提報勞保及安全衛生教育訓練', 'extras.insured', '人選(有／無／無新進勞工)', ['contractor'], '非必填;預設「無新進勞工」', 'p.1 §五'),
  row('五、(一)3. 檢查勞工個人防護具', 'extras.ppe', '人勾選', ['contractor'], '非必填', 'p.1 §五'),
  row('五、(二)其他事項', 'extras.safety_other', '人填', ['contractor'], '非必填', 'p.1 §五'),
  row('附表:工地職業安全衛生施工前檢查紀錄表', null, '本輪未實作(原表 p.4 獨立表)', [], '列為待補:需要時以紙本另附', 'p.4 附表'),
  // 六~八
  row('六、施工取樣試驗紀錄', 'extras.sampling', '人填(試驗紀錄另存於品質模組)', ['contractor'], '非必填', 'p.1 §六'),
  row('七、通知協力廠商辦理事項', 'extras.notice', '人填', ['contractor'], '非必填', 'p.1 §七'),
  row('八、重要事項記錄', 'extras.important', '人填', ['contractor'], '非必填', 'p.1 §八'),
  // 簽章
  row('簽章:【工地主任】', null, '平台帳號簽署(簽署人姓名／伺服器時間／版本雜湊)', [], '簽署後才印出簽署資訊;未簽署整張標草稿', 'p.1 簽章'),
])

export const SELF_CHECK_MAPPING = Object.freeze([
  row('編號', 'doc_no', '人填(監造計畫文件編碼)', ['contractor'], '非必填', '表頭'),
  row('工程名稱', null, '專案資料 projects.name', [], '缺值顯示待補', '表頭'),
  row('分項工程名稱', 'subproject_name', '人填;選用的檢查表範本標題可帶入待確認', ['contractor'], '非必填', '表頭'),
  row('承攬廠商', null, '專案資料 projects.contractor_name', [], '缺值顯示待補', '表頭'),
  row('協力廠商', 'subcontractor_name', '人填', ['contractor'], '非必填;自辦可留白', '表頭'),
  row('檢查位置', 'location', '人填(照片紙表位置可帶入待確認)', ['contractor'], '必填(可標不適用並填原因)', '表頭'),
  row('檢查日期', 'check_date', '文件日期(民國年換算)', [], '必填;新建時由日期選擇器決定', '表頭'),
  row('檢查時機', 'check_timing', '人選:查驗停留點／施工前檢查／施工中檢查／施工完成檢查', ['contractor'], '必填', '表頭'),
  row('檢查表範本(依據)', 'template_id', '人選本案檢查表範本;依工項自動挑選時標待確認', ['contractor'], '必填;範本沒有項目不可簽署', '表頭'),
  row('對應工項', 'work_item_id', '人選標單工項', ['contractor'], '非必填;不指定工項仍可自檢', '表頭'),
  row('檢查項目', null, '本案檢查表範本項目(項目與順序不在文件內改)', [], '範本帶出;範本沒有項目不可簽署', '項目表'),
  row('設計圖說、規範之檢查標準(定性定量)', null, '本案檢查表範本的量化標準與依據', [], '範本帶出;範例檔的示例標準不入產品', '項目表'),
  row('實際檢查情形(載明檢查數值及單位)', 'results.<no>', '人親自量測填寫;紙本實測欄已寫好的數值由系統照原文抄錄並標待確認', ['contractor'], '逐項必填(值住在 results[no].value);不適用須填原因', '項目表'),
  row('檢查結果(○／╳／／)', null, '確定性判定:簽署時伺服器依範本量化標準重算(畫面為預覽)', [], '系統判定,不可人改', '項目表'),
  row('備註', 'results.<no>.note', '人填', ['contractor'], '非必填', '項目表'),
  row('缺失複查結果', 'recheck_result', '人選:已完成改善／未完成改善', ['contractor'], '有缺失才填', '表尾'),
  row('複查日期', 'recheck_date', '人填', ['contractor'], '有缺失才填', '表尾'),
  row('複查人員職稱', 'recheck_role', '人填', ['contractor'], '有缺失才填', '表尾'),
  row('備註(整表)', 'note', '人填', ['contractor'], '非必填', '表尾'),
  row('檢查人員簽名', null, '平台帳號簽署(簽署人姓名／伺服器時間／版本雜湊)', [], '簽署後才印出;未簽署整張標草稿', '表尾'),
])

// 監造查驗紀錄表(臺北市「施工抽查紀錄表」格式參考範例)。可編角色是**監造**不是廠商:
// 「實際抽查情形」「判定」「本次確認數量」是監造親自填的,確認數量簽署後進計價——格內編輯只是呈現與輸入,
// 伺服器 field_document_sign_inspection_form_internal 的驗證(單位一致、階段在必要階段內、申報量上限、
// 判定與數量一致、同查驗已有有效確認須先撤銷)一律照舊,不因為換版面而放寬。
// 原表沒有、由本系統加上的格(查驗申請、工項、單位、階段、申報量、判定、確認量)一律標「本系統欄位」。
export const INSPECTION_FORM_MAPPING = Object.freeze([
  row('編號', 'doc_no', '人填(監造計畫「文件紀錄管理系統」所訂編碼)', ['supervisor'], '非必填;未填則紙上留白', '表頭'),
  row('工程名稱', null, '專案資料 projects.name', [], '缺值顯示待補', '表頭'),
  row('承攬廠商', null, '專案資料 projects.contractor_name', [], '缺值顯示待補(至專案設定補)', '表頭'),
  row('分項工程名稱(同時是表頭標題)', 'subproject_name', '人填;選用的查驗表範本標題可帶入待確認', ['supervisor'], '非必填;留白則標題印「施工抽查紀錄表」', '表頭'),
  row('抽查位置', 'location', '查驗申請帶入待核對(確認數量以此位置為批次累計)', ['supervisor'], '必填;須人確認後才可簽署', '表頭'),
  row('檢查日期', 'inspection_date', '文件日期(民國年換算)', [], '必填;須等於文件業務日期(伺服器驗)', '表頭'),
  row('抽查時機', 'check_timing', '人選:檢驗停留點／隨機抽查', ['supervisor'], '非必填;未選則兩格皆空白,不預設', '表頭'),
  row('抽查結果符號說明', null, '原表固定說明(○合格／╳有缺失需改正／／無此檢查項目)', [], '固定印出', '表頭'),
  row('抽查項目', null, '本案查驗表範本項目(用途=監造查驗;項目與順序不在文件內改)', [], '範本帶出;不選範本則依判定欄簽署', '項目表'),
  row('設計圖說、規範之抽查標準(定性定量)', null, '本案查驗表範本的量化標準與依據', [], '範本帶出;範例檔的示例標準與良好／不良示例不入產品', '項目表'),
  row('實際抽查情形(載明抽查數值及單位)', 'results.<no>', '監造親自量測填寫;紙本實測欄已寫好的數值由系統照原文抄錄並標待確認', ['supervisor'], '有範本時逐項必填(值住在 results[no].value);本次未查須標不適用並填原因', '項目表'),
  row('抽查結果(○／╳／／)', null, '確定性判定:簽署時伺服器依範本量化標準重算(畫面為預覽)', [], '系統判定,不可人改', '項目表'),
  row('備註(逐項)', 'results.<no>.note', '人填', ['supervisor'], '非必填', '項目表'),
  row('缺失複查結果', 'recheck_result', '人選:已完成改善／未完成改善', ['supervisor'], '有缺失才填', '表尾'),
  row('複查日期', 'recheck_date', '人填', ['supervisor'], '有缺失才填', '表尾'),
  row('複查人員職稱', 'recheck_role', '人填', ['supervisor'], '有缺失才填', '表尾'),
  row('備註(整表)', 'note', '人填', ['supervisor'], '非必填', '表尾'),
  row('監造單位派駐現場人員簽名', null, '平台帳號簽署(簽署人姓名／伺服器時間／版本雜湊)', [], '簽署後才印出;未簽署整張標草稿', '表尾簽章'),
  row('監造主管簽名', null, '本輪未實作(第二簽署人)', [], '列為待補:維持紙本手簽欄', '表尾簽章'),
  // 原表沒有、本系統加上的格(紙上標「本系統欄位」)
  row('(本系統欄位)查驗申請', 'inspection_id', '由查驗申請建立表單時帶入(名稱另存 inspection_title 供紙上顯示)', [], '必填;一份查驗申請一份表單,與文件綁定一致(伺服器驗)', '附記(本系統欄位)'),
  row('(本系統欄位)工項', 'work_item_id', '查驗申請帶入(須為標單末端可計價工項)', [], '必填;確認數量掛此工項', '附記(本系統欄位)'),
  row('(本系統欄位)單位', 'unit', '標單工項單位(快照)', [], '必填;與工項單位不一致不得簽署', '附記(本系統欄位)'),
  row('(本系統欄位)查驗階段', 'stage_key', '人選本工項檢驗停留點的必要階段(H 點)', ['supervisor'], '工項有必要階段時必填且須為其中之一;單階段工項須留空', '附記(本系統欄位)'),
  row('(本系統欄位)申報數量', 'declared_qty', '查驗申請帶入待核對', ['supervisor'], '必填;須人確認;與查驗申請不符不得簽署', '附記(本系統欄位)'),
  row('(本系統欄位)檢附之自主檢查', 'self_check_record_id', '查驗申請檢附的廠商自主檢查紀錄', [], '非必填;未檢附即留白', '附記(本系統欄位)'),
  row('(本系統欄位)查驗表範本(抽查項目依據)', 'template_id', '人選本案用途=監造查驗的查驗表範本', ['supervisor'], '非必填;不選則依判定欄簽署', '附記(本系統欄位)'),
  row('(本系統欄位)判定', 'verdict', '監造親自判定(合格／部分合格／不合格);AI 與系統不建議也不預填', ['supervisor'], '必填;與本次確認數量一致(伺服器驗)', '附記(本系統欄位)'),
  row('(本系統欄位)本次確認數量', 'confirmed_qty', '監造親自填寫;簽署後寫入監造確認紀錄成為可估驗依據', ['supervisor'], '必填(不合格填 0);不得超過申報數量', '附記(本系統欄位)'),
  row('(本系統欄位)判定說明', 'result_note', '人填', ['supervisor'], '判定非合格時必填(作為自動開立缺失的說明)', '附記(本系統欄位)'),
])

// 監造報表(工程會附表五「公共工程監造報表」)。原表註 2 明寫**按日**填寫——它是日報,不是監造月報。
// 表頭的契約金額兩格本系統沒有同口徑的資料(標單合計是「發包末端工項合計」,不含稅與總價項目),
// 所以由監造依契約自行填,未填就印「待補」;契約變更次數則有對應資料(已核准的變更設計),由系統確定性計算。
export const SUPERVISOR_LOG_MAPPING = Object.freeze([
  row('表報編號', 'doc_no', '人填(機關文件編號規則)', ['supervisor'], '非必填;未填則紙上留白', '表頭'),
  row('本日天氣:上午', 'weather_am', '氣象署帶入或人填', ['supervisor'], '必填', '表頭'),
  row('本日天氣:下午', 'weather_pm', '氣象署帶入或人填', ['supervisor'], '必填', '表頭'),
  row('填報日期(年月日星期)', 'log_date', '文件日期(民國年換算、星期由日期推算)', [], '必填;一天一份文件,由日期選擇器決定', '表頭'),
  row('工程名稱', null, '專案資料 projects.name', [], '缺值顯示待補', '表頭'),
  row('契約工期(天)', null, '確定性計算:契約竣工日−開工基準日+1(基準日登錄)', [], '兩個基準日皆有才算;缺任一顯示待補', '表頭'),
  row('開工日期', null, '專案基準日 commencement_date(缺則契約起始日)', [], '缺值顯示待補', '表頭'),
  row('預定完工日期', null, '專案契約竣工日 projects.end_date', [], '缺值顯示待補', '表頭'),
  row('實際完工日期', 'actual_completion_date', '人填(實際完工日)', ['supervisor'], '非必填;未完工留白', '表頭'),
  row('契約變更次數(次)', null, '確定性計算:截至本日已核准的變更設計件數(無變更日期者仍計入並於來源註明)', [], '本案尚未載入變更設計時顯示待補', '表頭'),
  row('工期展延天數(天)', 'extended_days', '人填(依機關核准展延公文)', ['supervisor'], '非必填;無展延填 0 或留白', '表頭'),
  row('契約金額:原契約', 'contract_amount_original', '人填(依契約;本系統標單合計是發包末端工項口徑,不等於契約金額,故不自動帶入)', ['supervisor'], '非必填;未填印待補', '表頭'),
  row('契約金額:變更後契約', 'contract_amount_revised', '人填(依最新核准變更;畫面另列系統已核准追加減淨額供核對,不自動帶入)', ['supervisor'], '非必填;未填印待補', '表頭'),
  row('預定進度(%)', null, '確定性計算:預定進度表內插至本日(lib/progressPlan)', [], '未設定預定進度表顯示待補', '表頭'),
  row('實際進度(%)', null, '確定性計算:截至本日最近一期估驗累計金額÷契約總額', [], '尚無估驗顯示待補', '表頭'),
  row('一、工程進行情況(含約定之重要施工項目及數量)', 'contractor_summary', '人填;同日已簽署／提送的施工日誌可引用並標來源(原表註 1 得載明參詳施工日誌)', ['supervisor'], '必填;廠商本日未施工須標不適用並填原因', '§一'),
  row('一、施工日誌收件情形(註 1 的參詳依據)', 'daily_log_receipt', '系統帶入(同日施工日誌文件的簽署／提送／收件狀態)', [], '系統帶入;當日無施工日誌文件即照實註明', '§一'),
  row('二、監督依照設計圖說及核定施工圖說施工(含約定之檢驗停留點及施工抽查等情形)', 'supervision_items', '人填逐列;監造照片辨識可帶入待確認(逐列標來源)', ['supervisor'], '必填;本日無監造事項須標不適用並填原因', '§二'),
  row('二、當日查驗(檢驗停留點及施工抽查紀錄)', 'inspection_ids', '系統列出當日查驗申請／判定紀錄,由人勾選列入', ['supervisor'], '非必填;系統無當日查驗即照實印出', '§二'),
  row('三、查核材料規格及品質(含約定之檢驗停留點、材料設備管制及檢(試)驗等抽驗情形)', 'material_quality', '人填', ['supervisor'], '非必填;本日無材料查核可標不適用並填原因', '§三'),
  row('四、(一)施工廠商施工前檢查事項辦理情形:完成／未完成', 'safety_precheck', '人選', ['supervisor'], '非必填;未選則兩格皆空白,不預設完成', '§四'),
  row('四、(二)其他工地安全衛生督導事項', 'safety_other', '人填', ['supervisor'], '非必填', '§四'),
  row('五、其他約定監造事項:通知廠商辦理事項', 'notices', '人填逐列(致施工廠商／機關;可連結缺失、查驗、疑義、送審)', ['supervisor'], '非必填', '§五'),
  row('五、其他約定監造事項:追蹤事項', 'followups', '人填逐列(追蹤中／已結案)', ['supervisor'], '非必填', '§五'),
  row('五、其他約定監造事項:重要事項紀錄', 'note', '人填', ['supervisor'], '非必填', '§五'),
  row('監造單位簽章', null, '平台帳號簽署(簽署人姓名／伺服器時間／版本雜湊)', [], '簽署後才印出簽署資訊;未簽署整張標草稿', '表尾簽章'),
  // 原表沒有、本系統加上的格(原表註 3:機關得依契約約定自行增訂;紙上標「本系統欄位」)
  row('(本系統欄位)監造到場人員與時段', 'attendance', '監造親自填寫並確認;系統不從任何照片推定到場', ['supervisor'], '必填;本日未到場須標不適用並填原因', '附記(本系統欄位)'),
])

export const FORM_MAPPINGS = Object.freeze({
  daily_log: DAILY_LOG_MAPPING,
  self_check: SELF_CHECK_MAPPING,
  inspection_form: INSPECTION_FORM_MAPPING,
  supervisor_log: SUPERVISOR_LOG_MAPPING,
})

export const mappingFor = (docType) => FORM_MAPPINGS[docType] || []
export const mappedKeys = (docType) => mappingFor(docType).filter((r) => r.key).map((r) => r.key)
// 某一格在這個角色的視角能不能直接編:mapping 是唯一定義(紙本元件據此長 input),
// 伺服器 RLS／RPC 仍是安全邊界,這裡只是 UX。
export function isEditableBy(docType, key, org) {
  const r = mappingFor(docType).find((x) => x.key === key)
  return !!r && r.editableBy.includes(org)
}
// 原表有、本系統沒有對應儲存欄位的列(畫面與文件都要誠實列「待補／不適用」)
export const unmappedRows = (docType) => mappingFor(docType).filter((r) => !r.key)

// 這個角色在這張表上有沒有任何可編的格:沒有就連「加一列／移除一列」這種結構動作也不該出現
// (fail-closed;伺服器 RLS／RPC 才是邊界,這裡只是不要長出按不動的東西)
export const canEditForm = (docType, org) => mappingFor(docType).some((r) => r.editableBy.includes(org))

// ── 施工日誌表頭的確定性事實 ────────────────────────────────────────────────
// 全部由既有規則算:工期取基準日、進度取預定進度表與估驗累計。AI 不得產生這些數字;
// 算不出來就回 { value: null, pending: true } 讓紙上顯示「待補」,不猜、不填 0。
const fact = (value, source) => (value == null || (typeof value === 'number' && !Number.isFinite(value))
  ? { value: null, source: null, pending: true }
  : { value, source, pending: false })

const daysInclusive = (fromIso, toIso) => {
  const a = fromIso ? parseLocalDate(fromIso) : null
  const b = toIso ? parseLocalDate(toIso) : null
  if (!a || !b || isNaN(a) || isNaN(b)) return null
  return Math.round((b - a) / 86400000) + 1
}

export function dailyLogHeaderFacts({ project = null, progressPlan = null, logDate = null, actualPct = null } = {}) {
  const commencement = project?.commencement_date || project?.start_date || null
  const commencementSource = project?.commencement_date ? '專案基準日' : project?.start_date ? '契約起始日(無開工基準日)' : null
  const approved = daysInclusive(commencement, project?.end_date)
  const elapsed = daysInclusive(commencement, logDate)
  const planned = progressPlan && logDate ? plannedPctNow(progressPlan, parseLocalDate(logDate)) : null
  return {
    commencement_date: fact(commencement, commencementSource),
    approved_duration_days: fact(approved, '契約竣工日−開工基準日+1'),
    elapsed_duration_days: fact(elapsed, '本日−開工基準日+1'),
    remaining_duration_days: fact(approved != null && elapsed != null ? approved - elapsed : null, '核定工期−累計工期'),
    planned_progress_pct: fact(planned == null ? null : Math.round(planned * 10) / 10, '預定進度表內插'),
    actual_progress_pct: fact(actualPct == null ? null : Math.round(actualPct * 10) / 10, '估驗累計金額÷契約總額'),
  }
}

// ── 監造報表(附表五)表頭的確定性事實 ────────────────────────────────────────
// 與施工日誌同一支算式(工期、進度),再加原表多出來的兩格:預定完工日期與契約變更次數。
// 契約變更次數取「已核准」的變更設計件數(與估驗、S 曲線同一條 approvedNetAmount 規則的同一份資料);
// 沒有變更日期的已核准件仍計入並在來源註明,不猜日期也不漏計。契約金額兩格不在這裡:
// 本系統的標單合計是「發包末端工項合計」口徑,不等於契約金額(不含稅與總價項目),由監造依契約自行填。
export function approvedChangeCountFact(changeOrders, asOfIso = null) {
  if (!Array.isArray(changeOrders)) return fact(null, null)
  let n = 0
  let undated = 0
  for (const co of changeOrders) {
    if (co?.status !== '核准') continue
    if (!co.co_date) { n += 1; undated += 1; continue }
    if (!asOfIso || String(co.co_date).slice(0, 10) <= asOfIso) n += 1
  }
  return fact(n, `已核准變更設計件數(截至本日)${undated ? `;其中 ${undated} 件未載變更日期,一併計入` : ''}`)
}

export function supervisorReportHeaderFacts({ project = null, progressPlan = null, logDate = null, actualPct = null, changeOrders = null } = {}) {
  return {
    ...dailyLogHeaderFacts({ project, progressPlan, logDate, actualPct }),
    planned_completion_date: fact(project?.end_date || null, '專案契約竣工日'),
    approved_change_count: approvedChangeCountFact(changeOrders, logDate),
  }
}

// 民國年月日與星期(紙本表頭用;日期字串為 YYYY-MM-DD 的業務日期,不吃時區)
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']
export function rocDateParts(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const [y, m, d] = iso.split('-').map(Number)
  const dt = parseLocalDate(iso)
  return { year: y - 1911, month: m, day: d, weekday: isNaN(dt) ? '' : WEEKDAY[dt.getDay()] }
}
export function rocDateText(iso, { weekday = false } = {}) {
  const p = rocDateParts(iso)
  if (!p) return ''
  return `${p.year} 年 ${p.month} 月 ${p.day} 日${weekday ? `(星期${p.weekday})` : ''}`
}

export const SELF_CHECK_TIMINGS = Object.freeze(['查驗停留點', '施工前檢查', '施工中檢查', '施工完成檢查'])
export const SELF_CHECK_RECHECK_RESULTS = Object.freeze(['已完成改善(檢附改善前中後照片)', '未完成改善,填具缺失改善追蹤表追蹤'])
// 抽查紀錄表的抽查時機(原表兩格:檢驗停留點／隨機抽查),與自主檢查表的四種檢查時機不同,不可混用
export const INSPECTION_TIMINGS = Object.freeze(['檢驗停留點', '隨機抽查'])
// 附表五 §四(一):施工廠商施工前檢查事項辦理情形(原表兩格;未選一律留白,不預設完成)
export const SAFETY_PRECHECK_OPTIONS = Object.freeze(['完成', '未完成'])
