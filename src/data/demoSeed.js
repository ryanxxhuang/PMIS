// Demo storyline 產生器 — 只在「未設定 Supabase」時用。
// 以範例標單（workItems.json）為脊椎，動態生出一個「開工第 6 個月、
// 實際略落後預定」的完整專案：估驗 5 期、請款收款、施工日誌、查驗缺失、
// 契約義務、成本、工安、變更設計、逐工項排程。
// 所有日期相對「今天」計算 → demo 永遠是活的（有逾期、有即將到期、有進行中）。
//
// 對 B2B 銷售而言 demo 模式就是銷售簡報：每一頁都要看得到「用起來的樣子」。

import { users as demoUsers } from './seed.js'
import { TEMPLATE_03310 } from './checklist03310.js'
import { demoFieldDocumentTemplate } from './demoFieldDocTemplates.js'
import { requiredKeysFor, unmetFields, docConfirmRequiredKeys } from '../lib/fieldDocs.js'
import { judgeChecklist } from '../lib/qc.js'
import { isConcretePourItem } from '../lib/integrityAudit.js'
import { valuationItemAmount } from '../lib/boqCalc.js'
import { localISODate as iso, localISOMonth } from '../lib/dates.js'

// 「今天」刻意仍跟瀏覽器走（不是 taipeiToday）：demo 是銷售簡報素材，相對日期要貼著
// 看簡報的人螢幕上的今天；種子資料沒有法定期限語意，不屬於「業務日期」那條規則。
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d }
const monthsFromNow = (n, day) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + n, day) }
// 機關「撥付」循環義務(OB-12)的每月幾號:由今天推 3 天、落在 1–28 之間。demo 的今日工作要每天都看得到
// 機關這一條「7 日內到期」(與 OB-5／OB-6／OB-11 用 daysFromNow 同一個道理);固定寫 20 的話只有每月 13–20 日
// 落在 7 日窗內,其他日子機關的「現在輪到我」少一條,demo e2e 逢月底／月初就假紅(2026-09-21 實測)。
const OWNER_PAY_DAY = ((new Date().getDate() + 3 - 1) % 28) + 1

// 與 store.generateSchedule 相同的 smoothstep S 形累計
const smoothstep = (t) => t * t * (3 - 2 * t)

export function buildDemoData(workItems, project) {
  // ── 選出「有在施作」的工項：金額最大的末端工項，累計覆蓋 55% 發包額 ──
  // （排除營業稅/利潤/管理費等「式」計價總項，避免進度畫面失真）
  const leaves = workItems.items
    .filter((it) => it.is_billable && it.is_leaf && !it.is_rollup && (it.amount || 0) > 0)
    .filter((it) => !/營業稅|利潤|管理費|保險費/.test(it.description || ''))
    .sort((a, b) => (b.amount || 0) - (a.amount || 0))
  const billableTotal = workItems.meta.billable_total || 1
  const active = []
  let cover = 0
  for (const it of leaves) {
    active.push(it)
    cover += it.amount || 0
    if (cover >= billableTotal * 0.55) break
  }

  // ── 預定進度 S 曲線（開工月 → 竣工月）──
  const start = new Date(project.start_date), end = new Date(project.end_date)
  const buckets = []
  let cur = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cur <= last) { buckets.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1) }
  const N = buckets.length || 1
  const months = buckets.map((d, i) => ({
    label: localISOMonth(d),
    plannedPct: +(smoothstep((i + 1) / N) * 100).toFixed(1),
  }))
  const progressPlan = { start: project.start_date, end: project.end_date, months }

  // ── 估驗 5 期（開工次月起每月一期）：實際 ≈ 13%，今日預定 19–26%（月底累計按日內插,D-024）──
  // 全月都落後 >5% → Dashboard/S曲線亮「落後」警示（demo 要秀的就是異常管理）
  const fractions = [0.05, 0.09, 0.14, 0.19, 0.24]
  const round1 = (x) => Math.round(x * 10) / 10
  const valuations = fractions.map((f, i) => {
    const items = {}, amounts = {}
    for (const it of active) {
      items[it.item_key] = round1((it.quantity || 0) * f)
      // 金額用 fn_valuation_amount 的鏡像(逐工項到元):demo 沒有 DB,種子自己算;正式專案一律讀 DB
      amounts[it.item_key] = valuationItemAmount(items[it.item_key], it.unit_price)
    }
    // 第 5 期估驗日=3 天前(狀態=監造審核):估驗日期不能在未來,否則截至今天的進度會少算這一期(D-024)
    const valDate = i === 4 ? daysFromNow(-3) : monthsFromNow(i - 4, 25)
    const dF = f - (i ? fractions[i - 1] : 0)
    const periodAmt = Math.round(cover * dF)
    const net = Math.round(periodAmt * 0.95) // 扣 5% 保留款
    const v = {
      id: `VAL-DEMO-${i + 1}`, period_no: i + 1,
      valuation_date: iso(valDate), period_end: iso(valDate), retention_pct: 5,
      status: i < 4 ? '已核定' : '監造審核',
      items, amounts, own: {},
    }
    // 請款收款：前 3 期已收款、第 4 期已請款未收（→ 提醒中心有「未收款」）
    if (i < 3) {
      v.invoice_date = iso(new Date(valDate.getFullYear(), valDate.getMonth() + 1, 5))
      v.paid_date = iso(new Date(valDate.getFullYear(), valDate.getMonth() + 1, 28))
      v.paid_amount = net
    } else if (i === 3) {
      v.invoice_date = iso(daysFromNow(-18))
      v.paid_date = null
      v.paid_amount = null
    }
    return v
  })

  // ── 施工日誌：近兩週 8 筆（跳過部分日期，看起來像真的）──
  const weathers = ['晴', '晴', '多雲', '晴時多雲', '陰', '晴', '陰短暫雨', '晴']
  const summaries = [
    '3F 柱牆鋼筋綁紮、模板組立',
    '3F 版牆混凝土澆置 420kgf/cm²',
    '4F 放樣、柱筋續接器施工',
    '4F 柱牆鋼筋綁紮',
    '外牆窯燒磚打樣區施作、監造勘驗',
    '4F 模板組立、施工架昇層',
    '4F 版筋綁紮、水電配管配合',
    '4F 版牆混凝土澆置、養護',
  ]
  const logDays = [-13, -12, -10, -9, -7, -5, -2, -1]
  // 公定格式欄位(出工/機具/材料/四~八節)—— 澆置日(i=1,7)材料含混凝土
  const pour = (i) => i === 1 || i === 7
  // 澆置日的日誌工項要含真正的澆置工項(isConcretePourItem 判定,如結構用混凝土 420)——
  // 佐證欄的試體與稽核的澆置日都以此對應;模板等含「混凝土」字樣的工項不算澆置。
  const pourItem = active.find((it) => isConcretePourItem(it.description))
  const siteLogs = logDays.map((off, i) => {
    const items = {}
    for (const it of active.slice(0, 3)) items[it.item_key] = round1((it.quantity || 0) * 0.004)
    if (pour(i) && pourItem) items[pourItem.item_key] = round1((pourItem.quantity || 0) * 0.004)
    return {
      id: `LOG-DEMO-${i + 1}`, log_date: iso(daysFromNow(off)),
      weather: weathers[i], weather_am: weathers[i], weather_pm: i === 6 ? '短暫雨' : weathers[i],
      labor: [
        { type: '鋼筋工', count: 12 }, { type: '模板工', count: 10 },
        ...(pour(i) ? [{ type: '混凝土工', count: 8 }] : []), { type: '雜工', count: 4 },
      ],
      equipment: [{ name: '塔式起重機', count: 1 }, ...(pour(i) ? [{ name: '混凝土泵浦車', count: 2 }, { name: '振動棒', count: 6 }] : [])],
      materials: pour(i) ? [{ name: '預拌混凝土 420kgf/cm²', unit: 'M3', qty: 180 }, { name: '鋼筋 SD420W', unit: 'T', qty: 10 }] : [{ name: '鋼筋 SD420W', unit: 'T', qty: 10 }],
      extras: {
        technicians: pour(i) ? '混凝土工程技術士 2 名' : '',
        edu: true, insured: '無新進勞工', ppe: true, safety_other: '',
        sampling: pour(i) ? '混凝土圓柱試體 2 組(6 支)、坍度試驗 18±2.5cm' : '',
        notice: i === 4 ? '通知帷幕牆廠商確認打樣區磚縫寬度' : '',
        important: i === 4 ? '監造單位勘驗外牆打樣區' : '',
      },
      work_summary: summaries[i], status: '已送出', items,
    }
  }).reverse() // 新的在前，與 DB 排序一致

  // ── 品質：查驗 5 筆（合格/不合格/待查驗）+ 缺失 3 筆 ──
  const wi = (n) => active[n] || active[0]
  const deco = (n) => ({ work_item_no: wi(n).item_no || '', work_item_desc: wi(n).description || '' })
  const inspections = [
    { id: 'INSP-DEMO-1', title: '3F 柱牆鋼筋查驗', location: '3F', inspection_type: '施工查驗', requested_date: iso(daysFromNow(-11)), status: '合格', result_note: '符合設計圖說', ...deco(0) },
    { id: 'INSP-DEMO-2', title: '3F 混凝土澆置前查驗', location: '3F', inspection_type: '施工查驗', requested_date: iso(daysFromNow(-9)), status: '合格', result_note: null, ...deco(3) },
    { id: 'INSP-DEMO-3', title: '外牆窯燒磚打樣查驗', location: '1F 打樣區', inspection_type: '材料查驗', requested_date: iso(daysFromNow(-6)), status: '不合格', result_note: '磚縫寬度不均，重新打樣', ...deco(1) },
    { id: 'INSP-DEMO-4', title: '4F 柱牆鋼筋查驗', location: '4F', inspection_type: '施工查驗', requested_date: iso(daysFromNow(-1)), status: '待查驗', result_note: null, ...deco(0) },
    { id: 'INSP-DEMO-5', title: '4F 模板查驗', location: '4F', inspection_type: '施工查驗', requested_date: iso(daysFromNow(0)), status: '待查驗', result_note: null, ...deco(3) },
  ]
  // 統一缺失引擎:品質/工安同一狀態機(開立→改善中→待複查→已結案),以 domain 分類
  const defects = [
    // 待複查:改善鏈的後半段(監造複查結案/退回)在 demo 一定要有得按——
    // 這一段是三級品管的收尾,storyline 裡缺了它,示範時整個複查閉環看不到。
    { id: 'DEF-DEMO-1', domain: 'quality', title: '查驗不合格：外牆窯燒磚打樣', description: '磚縫寬度不均，需重新打樣送審', severity: '一般', location: '1F 打樣區', due_date: iso(daysFromNow(4)), status: '待複查', improvement_note: '已重新打樣並調整磚縫工法，請監造複查', ...deco(1) },
    { id: 'DEF-DEMO-2', domain: 'quality', title: '3F 西側牆面蜂窩', description: '澆置振動不確實造成蜂窩，需鑿除修補', severity: '嚴重', location: '3F 西側', due_date: iso(daysFromNow(-2)), status: '開立', improvement_note: null, ...deco(5) },
    { id: 'DEF-DEMO-3', domain: 'quality', title: '2F 樓梯間模板拆除不完全', description: '殘留模板角材', severity: '一般', location: '2F 樓梯間', due_date: iso(daysFromNow(-10)), status: '已結案', improvement_note: '已清除完畢，監造複查通過', ...deco(3) },
    // 自主檢查修訂版次連動:2F 版牆檢查表 Rev.1 更正後改判不合格自動開立(掛鏈根 CLR-DEMO-2)
    { id: 'DEF-DEMO-CL1', domain: 'quality', title: '自主檢查不合格：場鑄結構用混凝土 自主檢查表', description: '不合格項目：C2 坍度（標準 18 ± 2.5 cm(依配比設計)）（Rev.1 更正後判定）', severity: '一般', location: '2F 版牆', due_date: iso(daysFromNow(2)), status: '改善中', improvement_note: '已通知預拌廠調整配比並重新取樣', source_checklist_record_id: 'CLR-DEMO-2', work_item_no: '', work_item_desc: '' },
    // 工安缺失(domain=safety):同一引擎,展示廠商改善鏈 + 監造複查結案
    { id: 'DEF-DEMO-S1', domain: 'safety', title: '4F 臨邊開口未設護欄', description: '已先行圍設警示帶', severity: '嚴重', location: '4F 電梯井', record_date: iso(daysFromNow(-2)), due_date: iso(daysFromNow(1)), status: '開立', improvement_note: null, work_item_no: '', work_item_desc: '' },
    { id: 'DEF-DEMO-S2', domain: 'safety', title: '施工架斜籬破損', description: null, severity: '一般', location: '南側外牆', record_date: iso(daysFromNow(-6)), due_date: iso(daysFromNow(3)), status: '改善中', improvement_note: null, work_item_no: '', work_item_desc: '' },
  ]

  // ── 契約義務（典型公共工程時程義務 + 罰則）──
  // completed_at:以開工日推算、皆早於各自到期日(準時)——demo 的準時率維持
  // 75%/100%;新標記的完成時間由 ledger slice 鏡像 DB trigger 蓋。
  const afterCommencement = (n) => {
    const base = project?.commencement_date ? new Date(`${project.commencement_date}T08:00:00`) : daysFromNow(-160)
    const d = new Date(base); d.setDate(d.getDate() + n); return d.toISOString()
  }
  // 循環義務的期次(P5b obligation_periods 的 embed 形狀;真專案由 DB 依規則物化):兩期——
  // 上一期已完成(準時)＋下一期待辦(到期日=今天起最近的一次,與 P5b 前 demo 的「下次到期」同一天,
  // 劇本的逾期／即將到期分佈不變:OB-6 仍是第一條逾期)。demo 因此看得到「完成本期不清下期」,
  // 「舊逾期保留」由 pgTAP 與共用案例證明,不靠種子。日子 5／15／20 不會碰到月末夾住,不必抄夾住規則。
  // P5c:每期帶「依哪一版基準日產生」(basis 的起算欄位／日期與版號;真專案由 DB materialize 寫入):
  // 上一期在第 1 版(初值)產生、下一期在第 2 版(展延)之後產生——展示已完成的期保留原依據。
  const demoAnchorDate = project?.commencement_date || iso(daysFromNow(-160))
  const monthlyPeriods = (obId, day) => {
    const nextOffset = new Date().getDate() <= day ? 0 : 1
    return [nextOffset - 1, nextOffset].map((offset) => {
      const start = monthsFromNow(offset, 1)
      const end = monthsFromNow(offset + 1, 0)
      const due = monthsFromNow(offset, day)
      const done = offset < nextOffset
      return {
        id: `${obId}-${localISOMonth(start)}`, obligation_id: obId, period_key: localISOMonth(start),
        period_start: iso(start), period_end: iso(end), due_date: iso(due), status: done ? '已完成' : '待辦',
        completed_at: done ? new Date(due.getFullYear(), due.getMonth(), due.getDate() - 1, 15).toISOString() : null,
        evidence_submittal_id: null, evidence_document_id: null, review_note: null,
        anchor_version_no: done ? 1 : 2, basis: { anchor_key: 'commencement_date', anchor_date: demoAnchorDate, bound_date: project?.end_date || null },
      }
    })
  }
  // 基準日版本(P5c project_anchor_versions 的形狀;真專案由 DB trigger／RPC 產生、append-only):
  // 第 1 版=建案初值;第 2 版=機關核准展延竣工日 60 日(附函文),受影響的是竣工類單次義務(改期)——
  // 已完成的開工類義務保留原依據(kept)。竣工日=種子的 end_date,展延前的舊竣工日往前推 60 天。
  const demoEnd = project?.end_date || null
  const demoEndBefore = demoEnd ? iso(new Date(new Date(`${demoEnd}T08:00:00`).getTime() - 60 * 86400e3)) : null
  const anchorVersions = [
    { id: 'ANCHOR-DEMO-1', project_id: project?.project_id || 'demo', version_no: 1, change_kind: 'initial',
      anchors: { award_date: project?.award_date || null, notice_date: project?.notice_date || null, commencement_date: project?.commencement_date || null, end_date: demoEndBefore },
      changed_keys: ['award_date', 'notice_date', 'commencement_date', 'end_date'].filter((k) => (k === 'end_date' ? demoEndBefore : project?.[k])),
      effective_from: project?.award_date || null, reason: null, source_ref: null, source_change_order_id: null, effects: [],
      created_by: null, created_at: afterCommencement(-40) },
    { id: 'ANCHOR-DEMO-2', project_id: project?.project_id || 'demo', version_no: 2, change_kind: 'extension',
      anchors: { award_date: project?.award_date || null, notice_date: project?.notice_date || null, commencement_date: project?.commencement_date || null, end_date: demoEnd },
      changed_keys: demoEnd ? ['end_date'] : [], effective_from: iso(daysFromNow(-20)), reason: '機關核准展延工期 60 日曆天', source_ref: '府工字第 1130004567 號',
      source_change_order_id: null,
      effects: demoEnd ? [
        { kind: 'rescheduled', obligation_id: 'OB-8', title: '提送竣工圖說', period_key: null, old_due: iso(new Date(new Date(`${demoEndBefore}T08:00:00`).getTime() + 30 * 86400e3)), new_due: iso(new Date(new Date(`${demoEnd}T08:00:00`).getTime() + 30 * 86400e3)), status: '待辦' },
        { kind: 'rescheduled', obligation_id: 'OB-13', title: '竣工後 30 日內辦理初驗', period_key: null, old_due: iso(new Date(new Date(`${demoEndBefore}T08:00:00`).getTime() + 30 * 86400e3)), new_due: iso(new Date(new Date(`${demoEnd}T08:00:00`).getTime() + 30 * 86400e3)), status: '待辦' },
        { kind: 'rescheduled', obligation_id: 'OB-14', title: '一般工項保固期滿(1 年)', period_key: null, old_due: iso(new Date(new Date(`${demoEndBefore}T08:00:00`).getTime() + 365 * 86400e3)), new_due: iso(new Date(new Date(`${demoEnd}T08:00:00`).getTime() + 365 * 86400e3)), status: '待辦' },
      ] : [],
      created_by: null, created_at: new Date(Date.now() - 20 * 86400e3).toISOString() },
  ]
  // 保固事實(P5e get_project_warranty 的形狀;真專案由 DB 依正式驗收合格日＋契約保固期間計算):示範案施工中、
  // 尚未正式驗收——已登錄契約保固期間 1 年(引用第 18 條),保固期滿日待正式驗收合格後才有(不臆測日期)。
  const projectWarranty = {
    acceptance_date: null, acceptance_event_id: null, term_value: 1, term_unit: 'year',
    source_requirement_id: 'REQ-DEMO-WARRANTY', source_status: 'approved', source_ok: true,
    expiry: null, needs: ['acceptance'], gap: '缺正式驗收合格日，無法判定保固期滿日',
  }
  const obligations = [
    { id: 'OB-1', title: '提送施工計畫書', category: '開工前', trigger_event: 'commencement', offset_days: 15, offset_dir: 'after', responsible: '廠商', penalty: '逾期每日按契約價金總額 0.5‰ 計罰', source_clause: '第 9 條', source_page: 'p.12', status: '已完成', completed_at: afterCommencement(12), sort_order: 0 },
    // W-01 佐證鏈 demo:品質計畫義務掛上核准的 SUB-001,展示「義務→送審」可勾稽
    { id: 'OB-2', title: '提送品質計畫書', category: '開工前', trigger_event: 'commencement', offset_days: 15, offset_dir: 'after', responsible: '廠商', penalty: '逾期每日按契約價金總額 0.5‰ 計罰', source_clause: '第 9 條', source_page: 'p.12', status: '已完成', completed_at: afterCommencement(13), evidence_submittal_id: 'SUB-DEMO-1', sort_order: 1 },
    { id: 'OB-3', title: '投保營造綜合保險', category: '開工前', trigger_event: 'commencement', offset_days: 0, offset_dir: 'after', responsible: '廠商', penalty: '未投保者機關得代辦並自價金扣抵', source_clause: '第 13 條', source_page: 'p.18', status: '已完成', completed_at: afterCommencement(-2), sort_order: 2 },
    { id: 'OB-4', title: '提送施工月報', category: '施工中', recurring: 'monthly', recurring_day: 5, responsible: '廠商', penalty: null, source_clause: '第 10 條', source_page: 'p.14', status: '待辦', sort_order: 3, periods: monthlyPeriods('OB-4', 5) },
    { id: 'OB-5', title: '職業安全衛生教育訓練（每季）', category: '施工中', trigger_event: 'fixed', fixed_date: iso(daysFromNow(12)), responsible: '廠商', penalty: null, source_clause: '第 14 條', source_page: 'p.20', status: '待辦', sort_order: 4 },
    { id: 'OB-6', title: '第 5 期估驗計價送審', category: '施工中', trigger_event: 'fixed', fixed_date: iso(daysFromNow(-3)), responsible: '廠商', penalty: null, source_clause: '第 5 條', source_page: 'p.8', status: '待辦', sort_order: 5 },
    { id: 'OB-7', title: '中間查核點：地上結構體完成 50%', category: '施工中', trigger_event: 'commencement', offset_days: 270, offset_dir: 'after', responsible: '廠商', penalty: '逾查核點未達進度按日計罰 1‰', source_clause: '第 7 條', source_page: 'p.10', status: '待辦', sort_order: 6 },
    { id: 'OB-8', title: '提送竣工圖說', category: '完工', trigger_event: 'completion', offset_days: 30, offset_dir: 'after', responsible: '廠商', penalty: '逾期每日按契約價金總額 0.5‰ 計罰', source_clause: '第 21 條', source_page: 'p.30', status: '待辦', sort_order: 7 },
    // 監造/機關義務:契約重點 · 履約時程頁的三方檢視 storyline(監造看自己+廠商、
    // 機關看全部)。責任方值域對齊 contract_obligations.responsible(廠商|監造|機關)。
    { id: 'OB-9', title: '提送監造計畫書', category: '開工前', trigger_event: 'commencement', offset_days: 30, offset_dir: 'after', responsible: '監造', penalty: null, source_clause: '監造契約第 3 條', source_page: 'p.6', status: '已完成', completed_at: afterCommencement(25), sort_order: 8 },
    { id: 'OB-10', title: '提送監造月報', category: '施工中', recurring: 'monthly', recurring_day: 15, responsible: '監造', penalty: null, source_clause: '監造契約第 4 條', source_page: 'p.8', status: '待辦', sort_order: 9, periods: monthlyPeriods('OB-10', 15) },
    { id: 'OB-11', title: '送審文件審查(收件後 14 日內)', category: '施工中', trigger_event: 'fixed', fixed_date: iso(daysFromNow(5)), responsible: '監造', penalty: '逾期未回覆者延誤責任由監造負擔', source_clause: '第 8 條', source_page: 'p.11', status: '待辦', sort_order: 10 },
    { id: 'OB-12', title: '估驗計價審核完成後 30 日內撥付', category: '施工中', recurring: 'monthly', recurring_day: OWNER_PAY_DAY, responsible: '機關', penalty: null, source_clause: '第 5 條', source_page: 'p.9', status: '待辦', sort_order: 11, periods: monthlyPeriods('OB-12', OWNER_PAY_DAY) },
    { id: 'OB-13', title: '竣工後 30 日內辦理初驗', category: '完工', trigger_event: 'completion', offset_days: 30, offset_dir: 'after', responsible: '機關', penalty: null, source_clause: '第 15 條', source_page: 'p.22', status: '待辦', sort_order: 12 },
    { id: 'OB-14', title: '一般工項保固期滿(1 年)', category: '保固', trigger_event: 'completion', offset_days: 365, offset_dir: 'after', responsible: '廠商', penalty: null, source_clause: '第 18 條', source_page: 'p.26', status: '待辦', sort_order: 13 },
  ]

  // ── 成本管理（預算 vs 實際；有超支也有節餘）──
  const costItems = [
    { id: 'COST-1', category: '分包', title: '鋼筋工程（連工帶料）', vendor: '正大鋼鐵行', budget_amount: 52000000, actual_amount: 24800000, status: '進行中', note: null, sort_order: 0 },
    { id: 'COST-2', category: '分包', title: '模板工程', vendor: '協力模板工程行', budget_amount: 46000000, actual_amount: 21500000, status: '進行中', note: null, sort_order: 1 },
    { id: 'COST-3', category: '材料', title: '預拌混凝土', vendor: '國產建材', budget_amount: 40000000, actual_amount: 19200000, status: '進行中', note: '單價調整後略高於預算', sort_order: 2 },
    { id: 'COST-4', category: '分包', title: '外牆窯燒磚工程', vendor: '大誠土水', budget_amount: 45000000, actual_amount: 3800000, status: '進行中', note: '打樣中', sort_order: 3 },
    { id: 'COST-5', category: '機具', title: '塔式起重機租賃', vendor: '宏昇機械', budget_amount: 8400000, actual_amount: 4200000, status: '進行中', note: null, sort_order: 4 },
    { id: 'COST-6', category: '機具', title: '施工電梯租賃', vendor: '宏昇機械', budget_amount: 3600000, actual_amount: 1500000, status: '進行中', note: null, sort_order: 5 },
    { id: 'COST-7', category: '人工', title: '工地管理人事費', vendor: null, budget_amount: 21600000, actual_amount: 6700000, status: '進行中', note: '6 名常駐', sort_order: 6 },
    { id: 'COST-8', category: '其他', title: '臨時水電費', vendor: '台電/北水', budget_amount: 1800000, actual_amount: 940000, status: '進行中', note: null, sort_order: 7 },
  ]

  // ── 工安紀錄(原始紀錄六類;工安缺失已併入上方統一缺失引擎 DEF-DEMO-S1/S2) ──
  const safetyRecords = [
    { id: 'SAF-3', record_type: '自主檢查', title: '施工架週檢', location: '全區', record_date: iso(daysFromNow(0)), severity: '一般', status: '已完成', due_date: null, note: '扣件抽驗合格' },
    { id: 'SAF-4', record_type: '自主檢查', title: '塔吊月檢', location: '塔吊 T1', record_date: iso(daysFromNow(-15)), severity: '一般', status: '已完成', due_date: null, note: null },
    { id: 'SAF-5', record_type: '教育訓練', title: '新進人員職安教育訓練', location: '工務所', record_date: iso(daysFromNow(-9)), severity: '一般', status: '已完成', due_date: null, note: '12 人參訓' },
    { id: 'SAF-6', record_type: '危害告知', title: '混凝土澆置作業危害告知', location: '4F', record_date: iso(daysFromNow(-1)), severity: '一般', status: '已完成', due_date: null, note: null },
    // 監造三類(事件型,生即完成):展示三方權責——監造只能「新增」,不可改寫廠商紀錄
    { id: 'SAF-7', record_type: '監造觀察', title: '3F 模板支撐間距不足,已口頭通知改善', location: '3F', record_date: iso(daysFromNow(-3)), severity: '一般', status: '已完成', due_date: null, note: '併入工安缺失追蹤' },
    { id: 'SAF-8', record_type: '監造查驗', title: '施工架與安全網查驗', location: '南側外牆', record_date: iso(daysFromNow(-5)), severity: '一般', status: '已完成', due_date: null, note: '斜籬破損處待廠商改善後複查' },
    { id: 'SAF-9', record_type: '監造複查', title: '2F 臨邊護欄改善複查合格', location: '2F', record_date: iso(daysFromNow(-8)), severity: '一般', status: '已完成', due_date: null, note: null },
  ]

  // ── 變更設計（1 筆已核准、1 筆審核中）──
  const changeOrders = [
    {
      id: 'CO-DEMO-1', co_no: 'CO-001', title: '地下室排水溝斷面變更', co_date: iso(daysFromNow(-75)), status: '核准', reason: '現地湧水量大於設計值，加大排水斷面', sort_order: 0,
      items: [
        { id: 'COI-1', item_no: '追加-1', description: '排水溝加大斷面（60→90cm）', unit: 'M', qty_delta: 180, unit_price: 4200, amount_delta: 756000, note: null },
        { id: 'COI-2', item_no: '追加-2', description: '不鏽鋼格柵蓋板加寬', unit: 'M', qty_delta: 180, unit_price: 2800, amount_delta: 504000, note: null },
      ],
    },
    {
      id: 'CO-DEMO-2', co_no: 'CO-002', title: '1F 大廳地坪材質變更', co_date: iso(daysFromNow(-12)), status: '審核中', reason: '業主要求由拋光石英磚改為石材', sort_order: 1,
      items: [
        { id: 'COI-3', item_no: '追減-1', description: '拋光石英磚地坪（取消）', unit: 'M2', qty_delta: -420, unit_price: 2600, amount_delta: -1092000, note: null },
        { id: 'COI-4', item_no: '追加-3', description: '花崗石地坪（新增）', unit: 'M2', qty_delta: 420, unit_price: 6800, amount_delta: 2856000, note: null },
      ],
    },
  ]

  // ── 逐工項排程：前 10 個活躍工項（已完/進行中/未開始 + 一筆逾期）──
  const itemSchedules = {}
  active.slice(0, 10).forEach((it, i) => {
    // 錯開的區段：早的已完工、中間進行中、其一 planned_finish 已過 → 排程頁看得到「落後」
    const s = daysFromNow(-150 + i * 18)
    const f = daysFromNow(-150 + i * 18 + 80)
    itemSchedules[it.item_key] = { planned_start: iso(s), planned_finish: iso(f) }
  })

  // ── 品管:自主檢查表(內建 03310 範本 + 一筆合格紀錄)+ 取樣試體 ──
  // 試體 storyline:一組已合格(30 天前)、一組 7 天試驗逾期(9 天前,未填值)、
  // 一組已填 7 天值待 28 天;最近一次澆置(-1)不建 → 留給「從施工日誌帶入」展示。
  const checklistTemplates = [{ id: 'CLT-DEMO-1', ...TEMPLATE_03310 }]
  const clValues = { B1: true, B2: true, B3: true, C1: 27, C2: 18.5, C3: 30, C4: 10, C5: 7500, D1: true }
  const mkCl = (vals) => { const { results, overall } = judgeChecklist(TEMPLATE_03310, vals); return { results, overall } }
  // 修訂版次 storyline:2F 版牆那張 Rev.0 判合格 → 複核發現坍度登載錯誤 →
  // Rev.1 更正為 30cm 改判不合格,自動開缺失(DEF-DEMO-CL1 掛鏈根 CLR-DEMO-2)
  const checklistRecords = [
    { id: 'CLR-DEMO-1', template_id: 'CLT-DEMO-1', check_date: iso(daysFromNow(-12)),
      location: '3F 版牆', note: null, rev: 0, root_id: 'CLR-DEMO-1', supersedes_id: null,
      revision_reason: null, ...mkCl(clValues) },
    { id: 'CLR-DEMO-2R1', template_id: 'CLT-DEMO-1', check_date: iso(daysFromNow(-20)),
      location: '2F 版牆', note: null, rev: 1, root_id: 'CLR-DEMO-2', supersedes_id: 'CLR-DEMO-2',
      revision_reason: '複核取樣紀錄，坍度登載錯誤，更正為 30 cm', ...mkCl({ ...clValues, C2: 30 }) },
    { id: 'CLR-DEMO-2', template_id: 'CLT-DEMO-1', check_date: iso(daysFromNow(-20)),
      location: '2F 版牆', note: null, rev: 0, root_id: 'CLR-DEMO-2', supersedes_id: null,
      revision_reason: null, ...mkCl(clValues) },
  ]
  const mkSample = (off, extra) => {
    const d = iso(daysFromNow(off))
    return {
      sample_no: `TS-${d.replaceAll('-', '')}`, test_item: '混凝土抗壓', fc: 420,
      sampled_date: d, cylinders: 6,
      d7_due: iso(daysFromNow(off + 7)), d28_due: iso(daysFromNow(off + 28)),
      d7_value: null, d28_values: null, status: '待試驗', note: null, ...extra,
    }
  }
  const testSamples = [
    { id: 'TS-DEMO-1', ...mkSample(-30, { location: '2F 版牆', d7_value: 302, d28_values: [448, 431, 442], status: '合格' }) },
    { id: 'TS-DEMO-2', ...mkSample(-12, { location: '3F 版牆', d7_value: 296 }) },   // 待 28 天
    { id: 'TS-DEMO-3', ...mkSample(-9, { location: '3F 柱牆' }) },                    // 7 天試驗已逾期 → 提醒
  ]

  // ── 監造協作:送審(核准/待審/退回補正各一)+ 工程疑義(待回覆/已回覆) ──
  const submittals = [
    { id: 'SUB-DEMO-3', submittal_no: 'SUB-003', title: '外牆窯燒磚 材料送審(修正版)', category: '材料設備',
      revision: 1, status: '已提送', submitted_date: iso(daysFromNow(-2)), due_date: iso(daysFromNow(5)),
      decided_date: null, review_note: '第一次退回:未附出廠證明與試驗報告', attachment_note: '含出廠證明、CNS 試驗報告' },
    { id: 'SUB-DEMO-2', submittal_no: 'SUB-002', title: '4F 以上結構體施工計畫', category: '施工計畫',
      revision: 0, status: '審核中', submitted_date: iso(daysFromNow(-6)), due_date: iso(daysFromNow(1)),
      decided_date: null, review_note: null, attachment_note: null },
    { id: 'SUB-DEMO-1', submittal_no: 'SUB-001', title: '整體品質計畫', category: '品質計畫',
      revision: 0, status: '核准', submitted_date: iso(daysFromNow(-140)), due_date: null,
      decided_date: iso(daysFromNow(-130)), review_note: '同意備查,依核定版執行', attachment_note: null },
  ]
  const rfis = [
    { id: 'RFI-DEMO-2', rfi_no: 'RFI-002', title: '3F 樑柱接頭鋼筋與機電套管衝突', status: '待回覆',
      question: '3F G3 樑與 C5 柱接頭處,依機電圖 E-301 之預埋套管與主筋衝突,請釋疑是否可調整套管位置。',
      answer: null, asked_date: iso(daysFromNow(-3)), due_date: iso(daysFromNow(4)),
      answered_date: null, cost_impact: false, schedule_impact: true,
      markup_path: 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'640\' height=\'420\'><rect width=\'640\' height=\'420\' fill=\'%23f4f6f8\'/><g stroke=\'%237b8794\' stroke-width=\'2\' fill=\'none\'><rect x=\'60\' y=\'60\' width=\'520\' height=\'300\'/><line x1=\'60\' y1=\'210\' x2=\'580\' y2=\'210\'/><line x1=\'320\' y1=\'60\' x2=\'320\' y2=\'360\'/><circle cx=\'320\' cy=\'210\' r=\'36\'/></g><text x=\'66\' y=\'46\' font-size=\'20\' fill=\'%2351606e\'>S-301 3F 結構平面圖(示意)</text><rect x=\'268\' y=\'158\' width=\'150\' height=\'104\' fill=\'none\' stroke=\'%23e8630c\' stroke-width=\'6\'/><text x=\'268\' y=\'148\' font-size=\'24\' font-weight=\'700\' fill=\'%23e8630c\'>套管與主筋衝突</text></svg>' },
    { id: 'RFI-DEMO-1', rfi_no: 'RFI-001', title: '外牆窯燒磚勾縫劑顏色', status: '已回覆',
      question: '契約圖說未載明勾縫劑顏色,請確認採深灰或磚紅。',
      answer: '依建築師 2026/06/20 回覆採深灰色(色號 G-25),請據以施作。',
      asked_date: iso(daysFromNow(-15)), due_date: null, answered_date: iso(daysFromNow(-12)),
      cost_impact: false, schedule_impact: false },
  ]

  // ── 觀察事項(輕量提醒):一則待處理、一則已處理 ──
  const observations = [
    { id: 'OBS-DEMO-1', title: '4F 東側樓梯開口未設護欄', description: '現場巡查發現臨時開口缺防護，提醒盡速補設，避免升級為工安缺失。',
      location: '4F 東側樓梯', assigned_to: 'contractor', status: '待處理', markup_path: null },
    { id: 'OBS-DEMO-2', title: '鋼筋堆置未墊高', description: '料場鋼筋直接置於地面，提醒墊高避免銹蝕。',
      location: '料場', assigned_to: 'contractor', status: '已處理', markup_path: null },
  ]

  // ── ITP 檢驗停留點:H=停留(未查驗不得續作)/W=見證/R=文審 ──
  // 故事線:一點已通過(連合格查驗)、一點已申請(連待查驗)、一 H 點施作中未叫驗(紅色警示)、
  // 一 W 點施作中應通知見證、一 R 點文審待辦。
  const itpKey = (n) => wi(n).item_key || null
  const inspectionPoints = [
    { id: 'ITP-DEMO-1', point_type: 'H', title: '柱牆鋼筋查驗（每層）',
      acceptance_criteria: '鋼筋號數／間距／搭接長度符合設計圖說', frequency: '每層施作前',
      source_clause: '品質計畫 §4.2', work_item_key: itpKey(0), ...deco(0), inspection_id: 'INSP-DEMO-4' },
    { id: 'ITP-DEMO-2', point_type: 'H', title: '混凝土澆置前查驗（每次澆置）',
      acceptance_criteria: '模板／鋼筋／預埋件檢查合格，坍度 15±2.5cm', frequency: '每次澆置前',
      source_clause: '規範 03310', work_item_key: itpKey(3), ...deco(3), inspection_id: 'INSP-DEMO-2' },
    { id: 'ITP-DEMO-3', point_type: 'H', title: '模板組立查驗（每層）',
      acceptance_criteria: '支撐間距／垂直度／面板清潔符合施工計畫', frequency: '每層組立完成',
      source_clause: '品質計畫 §4.3', work_item_key: itpKey(2), ...deco(2), inspection_id: null },
    { id: 'ITP-DEMO-4', point_type: 'W', title: '防水層施作見證',
      acceptance_criteria: '底漆均勻、膜厚≧2mm、搭接寬度≧10cm', frequency: '每區施作首日',
      source_clause: '規範 07100', work_item_key: itpKey(1), ...deco(1), inspection_id: null },
    { id: 'ITP-DEMO-5', point_type: 'R', title: '鋼筋出廠證明／無輻射證明文審',
      acceptance_criteria: '每批附出廠證明、CNS 560 試驗報告', frequency: '每批進場前',
      source_clause: '規範 03210', work_item_key: null, work_item_no: '', work_item_desc: '', inspection_id: null },
  ]

  // ── 驗收/結算(示範:B 區道路改善工程的驗收時程,見 DEMO_PORTFOLIO) ──
  // 報竣 -28 天、竣工確認 -25 天 → 初驗法定期限 = 確認 +30 天 = 5 天後 → 提醒中心倒數
  const acceptanceEvents = [
    { id: 'ACC-DEMO-1', stage_key: 'report', event_date: iso(daysFromNow(-28)), result: null, note: '廠商於預定竣工日申報竣工' },
    { id: 'ACC-DEMO-2', stage_key: 'confirm', event_date: iso(daysFromNow(-25)), result: null, note: '會同監造、廠商核對竣工項目數量' },
  ]

  // ── AI 草稿收件匣(批2 /agent):四種角色 agent 的 pending 草稿(批4 起五筆,
  // 涵蓋日誌/查驗/審查/稽核/交接五種 kind)──
  // 真實模式由各角色 agent 的草稿工具產生;demo 先把「AI 擬好、人決定」
  // 的產品承諾演出來。日期相對今天 → 收件匣永遠像剛擬好的。
  const agaAt = (h) => new Date(Date.now() - h * 3600e3).toISOString()

  // Agent 對話起稿的示範(P6b-2):真實模式由 Edge 把草稿寫成文件的 AI 版本(與照片起稿同一支 builder),agent_actions 指向
  // 那份文件;demo 沒有 Edge,這裡直接種出同形狀的兩份文件(施工日誌、自主檢查表)與指向它們的草稿,收件匣「接受」就在
  // 記憶體文件上動作(日誌=人填數量存成人工版本;自檢表=帶去文件頁逐項確認)。示範模式仍無法簽署(P2c 邊界)。
  // 草稿日期用 3 天前:demo 既有日誌是 -13…-1 中的八天,3 天前正好漏寫(Agent 補擬);今天留給手動新建的故事線,
  // 不覆蓋既有紀錄。demo 工項沒有 uuid,items 鍵直接用 item_key。數量誠實原則:qty_today 一律 null(照片證明有做,不證明做多少)。
  const draftLogDate = iso(daysFromNow(-3))
  const ylog = siteLogs.find((l) => l.log_date === iso(daysFromNow(-4))) || null // 前一日沒有日誌 → 出工/機具/材料待補(不硬抓別天)
  const draftPhotoCounts = [8, 6, 4] // 三工項的照片張數,加總=summary 的 18 張
  const draftWis = active.slice(0, 3)
  const logItems = {}
  const logSources = {
    log_date: { status: 'filled', source: 'agent:request' },
    weather_am: { status: 'filled', source: 'cwa' }, weather_pm: { status: 'filled', source: 'cwa' },
    work_summary: { status: 'filled', source: 'ai:photo', reason: 'AI 依照片說明拼接,待核對' },
  }
  for (const k of ['labor', 'equipment', 'materials']) {
    logSources[k] = ylog?.[k]?.length ? { status: 'filled', source: `yesterday:${ylog.id}`, reason: '沿用昨日,待核對' } : { status: 'pending', source: null }
  }
  for (const it of draftWis) {
    logItems[it.item_key] = { item_key: it.item_key, item_no: it.item_no || null, description: it.description, unit: it.unit || null, qty_today: null, location: null, note: null }
    logSources[`items.${it.item_key}.qty_today`] = { status: 'pending', source: null, reason: '照片可證明有施作,不能證明做了多少;數量待現場確認' }
  }
  const logContent = {
    log_date: draftLogDate, weather_am: '晴', weather_pm: '午後短暫陣雨',
    labor: ylog?.labor || [], equipment: ylog?.equipment || [], materials: ylog?.materials || [], extras: {},
    work_summary: `依現場照片,本日施作:${draftWis.map((it, i) =>
      `${[it.item_no, it.description].filter(Boolean).join(' ')}(照片 ${draftPhotoCounts[i]} 張)`).join('、')}。各工項數量待現場確認後填寫。`,
    items: logItems, photo_ids: [], unmatched_photo_ids: [],
  }

  // 自主檢查表草稿(對話起稿):目視勾選項照片可合理判讀的給建議值並附依據(filled／ai:agent,仍要人逐項確認才能簽);
  // B1(是否已於 24 小時前通知監造)照片看不出來——沒把握就不猜,留白;實測值(num)一律留空由人量測。
  const inspDraftBasis = {
    B2: '澆置前照片說明載明模板內已清理無積水、預埋管件已綁紮固定',
    B3: '照片說明提到施工縫面已打毛清潔並灑水潤濕',
    D1: '照片說明含試體取樣紀錄,載明已取樣 2 組共 12 個',
  }
  const scFrame = demoFieldDocumentTemplate('self_check')
  const scResults = {}
  const scSources = {
    check_date: { status: 'filled', source: 'agent:request' },
    template_id: { status: 'filled', source: 'system:template_match', reason: '依今日澆置作業挑出 03310 範本' },
    work_item_id: { status: 'pending', source: null, reason: '起稿時未指定工項(非必填);有對應工項請補上,估驗佐證才對得回' },
    location: { status: 'filled', source: 'ai:photo' },
  }
  for (const it of TEMPLATE_03310.items) {
    const basis = it.kind === 'bool' ? inspDraftBasis[it.no] : null
    scResults[it.no] = { value: basis ? true : null }
    scSources[`results.${it.no}`] = basis
      ? { status: 'filled', source: 'ai:agent', reason: `AI 建議(依據:${basis}),請逐項確認` }
      : { status: 'pending', source: null, reason: it.kind === 'num' ? '實測值由人親自量測填寫;系統不從照片推定' : '請依現場檢查勾選;系統沒有逐項依據,不代為勾選' }
  }
  const scContent = {
    check_date: draftLogDate, template_id: 'CLT-DEMO-1', template_title: TEMPLATE_03310.title, template_source: TEMPLATE_03310.source ?? null,
    work_item_id: null, location: '3F 版牆', results: scResults, note: null,
    template: { key: scFrame?.key ?? null, version: scFrame?.version ?? null }, photo_ids: [], unmatched_photo_ids: [],
  }
  const demoDoc = (id, docType, target, template, content, sources, created) => {
    const checklistItems = docType === 'self_check' ? TEMPLATE_03310.items : null
    const frame = demoFieldDocumentTemplate(docType)
    const required = requiredKeysFor(content, [], { docType, template: frame, checklistItems })
    const recheck = unmetFields(required, sources, docConfirmRequiredKeys(docType, frame, checklistItems))
    return {
      doc: {
        id, project_id: project.project_id, doc_type: docType, owner_org: 'contractor', target_table: target, target_id: null,
        target_key: null, intake_id: null, doc_date: draftLogDate, status: recheck.length ? 'pending_input' : 'draft', current_version_no: 1,
        template_id: template, required_fields: required, recheck, created_by: null, created_at: created, updated_at: created,
      },
      versions: [{
        id: `${id}-V1`, document_id: id, version_no: 1, author_kind: 'ai', created_by: null, content, field_sources: sources,
        attachments: [], content_hash: `demo-${id}-v1`, change_note: 'Agent 對話起稿', amended_from_version: null, created_at: created,
      }],
    }
  }
  const fieldDocuments = [
    demoDoc('FD-DEMO-AGENT-LOG', 'daily_log', 'daily_logs', null, logContent, logSources, agaAt(2)),
    demoDoc('FD-DEMO-AGENT-SC', 'self_check', 'checklist_records', 'CLT-DEMO-1', scContent, scSources, agaAt(5)),
  ]

  // ── 已簽署的示範文書版本(O2)────────────────────────────────────────────────────
  // 示範模式沒有伺服器,不能真的簽署(fieldDocs slice 一律回「示範模式無法簽署」);但施工月報／監造月報與估驗
  // 佐證包依 P6a 只彙整「已簽署版本」,示範專案因此整份報表只剩「未簽署、不列入」、佐證包整欄「未經後端核對」,
  // Demo 站看不出產品做了什麼。這裡補一組**示範用的已簽署版本**:簽署者、簽署時間、版本號與內容雜湊都是示範值,
  // 每一列帶 is_demo:true —— 版本標示因此印「【示範資料】」,沿用「示範範本」同一套標示做法,不偽裝成真實簽署。
  // 判定規則(signedVersionIndex／splitBySignature／inspectionsOfMonth)一行未改;真實模式讀不到這份資料
  // (store 的 listSignedVersions／listSupervisorLogs／getFieldDocumentVersions 只在 demoMode 回它)。
  // 簽署者用 demo 帳號本人(seed.users)加註（示範資料）:報表上的名字與示範專案的人員一致,又一眼看得出是示範值
  const demoUserOf = (org) => demoUsers.find((u) => u.org_type === org) || null
  const DEMO_SIGNER = {
    contractor: `${demoUserOf('contractor')?.name || '施工廠商'}（示範資料）`,
    supervisor: `${demoUserOf('supervisor')?.name || '監造'}（示範資料）`,
  }
  const demoSupervisorId = demoUserOf('supervisor')?.user_id || null
  const DOC_OWNER_ORG = { daily_log: 'contractor', self_check: 'contractor', supervisor_log: 'supervisor', inspection_form: 'supervisor' }
  const DOC_TARGET_TABLE = { daily_log: 'daily_logs', self_check: 'checklist_records', supervisor_log: 'supervisor_logs', inspection_form: 'inspections' }
  const atHour = (date, h, m = 0) => new Date(new Date(`${date}T00:00:00`).setHours(h, m, 0, 0)).toISOString()
  // 示範文件 id 與內容雜湊由種子鍵算出穩定的 16 進位字串:真專案是 uuid ＋ sha256,版本標示印的是「短碼前 8 碼・
  // 雜湊前 12 碼」——示範資料若用 FD-DEMO-… 當 id,每份文件印出來的短碼與雜湊會一模一樣,看不出「版本可核對」這件事。
  // 形狀像真的,但每一份都冠【示範資料】(signedVersionText),不會被誤認為真簽署。
  const demoHex = (seed, len) => {
    const str = String(seed)
    let h = 0x811c9dc5, out = ''
    while (out.length < len) {
      for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0
      h = Math.imul(h ^ out.length, 2654435761) >>> 0
      out += h.toString(16).padStart(8, '0')
    }
    return out.slice(0, len)
  }
  const demoUuid = (seed) => {
    const h = demoHex(seed, 32)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
  const signedDocs = []
  // status 預設 received(對方已收件):示範文件走完「簽署 → 提送 → 對方收件」,/site 與今日工作不會憑空多出十幾件待辦;
  // 只留最新一份日誌類停在 submitted,讓「等待對方收件」這一步也演得到。兩者都仍在活文件清單裡。
  const signedDoc = ({ key, docType, docDate, targetId, content, sources = {}, attachments = [], templateId = null, signedAt, status = 'received' }) => {
    const org = DOC_OWNER_ORG[docType]
    const id = demoUuid(key)
    const hash = demoHex(`hash:${key}:v1`, 64)
    signedDocs.push({
      doc: {
        id, project_id: project.project_id, doc_type: docType, owner_org: org, target_table: DOC_TARGET_TABLE[docType],
        target_id: targetId, target_key: null, intake_id: null, doc_date: docDate, status, current_version_no: 1,
        template_id: templateId, required_fields: [], recheck: [], created_by: null, created_at: signedAt, updated_at: signedAt,
      },
      versions: [{
        id: `${id}-V1`, document_id: id, version_no: 1, author_kind: 'human', created_by: null, content, field_sources: sources,
        attachments, content_hash: hash, change_note: null, amended_from_version: null, created_at: signedAt,
      }],
      signatures: [{
        id: `${id}-SIG1`, document_id: id, version_no: 1, content_hash: hash,
        signer_name_snapshot: DEMO_SIGNER[org], signed_at: signedAt, is_demo: true,
      }],
    })
    return id
  }

  // 施工日誌:最新一天(昨天)刻意不簽 → 月報同時看得到「已簽署彙整」與「未簽署、不列入」兩種列。
  const wiByKey = new Map((workItems.items || []).map((it) => [it.item_key, it]))
  const logConfirmed = { status: 'confirmed', source: 'human' }
  siteLogs.slice(1).forEach((l, i) => {
    signedDoc({
      key: `FD-DEMO-SIGNED-LOG-${l.id}`, docType: 'daily_log', docDate: l.log_date, targetId: l.id, signedAt: atHour(l.log_date, 18, 30),
      status: i === 0 ? 'submitted' : 'received', // 最新一份已提送待監造收件
      content: {
        log_date: l.log_date, weather_am: l.weather_am, weather_pm: l.weather_pm,
        labor: l.labor, equipment: l.equipment, materials: l.materials, extras: l.extras, work_summary: l.work_summary,
        items: Object.fromEntries(Object.entries(l.items).map(([k, q]) => {
          const it = wiByKey.get(k) || {}
          return [k, { item_key: k, item_no: it.item_no || null, description: it.description || k, unit: it.unit || null, qty_today: q, location: null, note: null }]
        })),
        photo_ids: [], unmatched_photo_ids: [],
      },
      sources: {
        log_date: logConfirmed, weather_am: logConfirmed, weather_pm: logConfirmed, work_summary: logConfirmed,
        labor: logConfirmed, equipment: logConfirmed, materials: logConfirmed,
        ...Object.fromEntries(Object.keys(l.items).map((k) => [`items.${k}.qty_today`, logConfirmed])),
      },
    })
  })

  // 監造日誌事實列(P3a supervisor_logs;真專案由簽署交易落庫)。最新一天不簽,同樣留一列「未簽署、不列入」。
  const supervisorLogs = [-12, -9, -5, -2].map((off, i) => {
    const d = iso(daysFromNow(off))
    return {
      id: `SUPLOG-DEMO-${i + 1}`, log_date: d,
      weather_am: '晴', weather_pm: off === -2 ? '陰' : '晴時多雲',
      attendance: [{ user_id: demoSupervisorId, name: DEMO_SIGNER.supervisor, from: '08:00', to: '17:00' }],
      supervision_items: [
        { time: '09:30', item: '鋼筋續接器抽查（抽查 3 處，續接長度符合）', location: '4F', work_item_id: null, note: null, source: '人填', photo_ids: [] },
        { time: '14:00', item: '模板支撐系統督導', location: '4F', work_item_id: null, note: null, source: '人填', photo_ids: [] },
      ],
      inspection_ids: i === 0 ? ['INSP-DEMO-1'] : i === 2 ? ['INSP-DEMO-3'] : [],
      notices: i === 2 ? [{ to: 'contractor', content: '外牆打樣區磚縫寬度不均，請重新打樣', ref_type: 'inspection', ref_id: 'INSP-DEMO-3' }] : [],
      followups: i === 2 ? [{ ref_type: 'defect', ref_id: 'DEF-DEMO-1', content: '重新打樣後安排複查', status: 'open' }] : [],
      contractor_summary: '廠商依施工計畫施作，出工與機具與當日施工日誌相符。',
      note: null, template_key: 'supervisor_log_demo', template_version: 1,
    }
  })
  supervisorLogs.slice(0, 3).forEach((s, i) => {
    signedDoc({
      key: `FD-DEMO-SIGNED-SUPLOG-${s.id}`, docType: 'supervisor_log', docDate: s.log_date, targetId: s.id, signedAt: atHour(s.log_date, 17, 45),
      status: i === 2 ? 'submitted' : 'received', // 最新一份已提送待機關收件
      content: {
        log_date: s.log_date, weather_am: s.weather_am, weather_pm: s.weather_pm,
        attendance: s.attendance, supervision_items: s.supervision_items, inspection_ids: s.inspection_ids,
        notices: s.notices, followups: s.followups, contractor_summary: s.contractor_summary, daily_log_receipt: null, note: null,
        template: { key: 'supervisor_log_demo', version: 1 }, photo_ids: [], unmatched_photo_ids: [],
      },
    })
  })

  // 自主檢查表:3F 版牆那張已簽署(CLR-DEMO-1);2F 版牆的修訂鏈留著不簽,示範「未簽署不列入」。
  const scSignedSources = {
    ...Object.fromEntries(Object.keys(scSources).map((k) => [k, logConfirmed])),
    ...Object.fromEntries(TEMPLATE_03310.items.map((it) => [`results.${it.no}`, logConfirmed])),
  }
  const clRec1 = checklistRecords.find((r) => r.id === 'CLR-DEMO-1')
  signedDoc({
    key: 'FD-DEMO-SIGNED-SC-1', docType: 'self_check', docDate: clRec1.check_date, targetId: clRec1.id, templateId: 'CLT-DEMO-1',
    signedAt: atHour(clRec1.check_date, 16, 20),
    content: {
      check_date: clRec1.check_date, template_id: 'CLT-DEMO-1', template_title: TEMPLATE_03310.title, template_source: TEMPLATE_03310.source ?? null,
      work_item_id: null, location: clRec1.location, note: null,
      results: Object.fromEntries(Object.entries(clValues).map(([no, v]) => [no, { value: v }])),
      template: { key: scFrame?.key ?? null, version: scFrame?.version ?? 1 }, photo_ids: [], unmatched_photo_ids: [],
    },
    sources: scSignedSources,
  })

  // 監造查驗表單:合格與不合格各一份(INSP-DEMO-1 維持舊流程快速判定、沒有表單 → 月報列「未經簽署查驗表單、不列入」)。
  // 表單內容的確認數量=該工項第 5 期本期增量,與下面的示範監造確認量同一個數字。
  const lastVal = valuations[valuations.length - 1]
  const prevVal = valuations[valuations.length - 2] || null
  const periodDelta = (key) => round1((lastVal?.items?.[key] || 0) - (prevVal?.items?.[key] || 0))
  const formFor = (insp, { pass, qtyKey, selfCheckId = null }) => {
    const it = wiByKey.get(qtyKey) || {}
    const declared = periodDelta(qtyKey) || round1((it.quantity || 0) * 0.02)
    const confirmed = pass ? declared : 0
    return signedDoc({
      key: `FD-DEMO-SIGNED-IF-${insp.id}`, docType: 'inspection_form', docDate: insp.requested_date, targetId: insp.id,
      signedAt: atHour(insp.requested_date, 15, 10),
      content: {
        inspection_date: insp.requested_date, inspection_id: insp.id, work_item_id: qtyKey, location: insp.location,
        stage_key: null, unit: it.unit || null, declared_qty: declared, self_check_record_id: selfCheckId,
        template_id: null, results: {}, verdict: pass ? '合格' : '不合格', confirmed_qty: confirmed,
        result_note: insp.result_note, note: null,
        template: { key: 'inspection_form_demo', version: 1 }, photo_ids: [], unmatched_photo_ids: [],
      },
    })
  }
  const inspPass = inspections.find((i) => i.id === 'INSP-DEMO-2')
  const inspFail = inspections.find((i) => i.id === 'INSP-DEMO-3')
  const passKey = (active[3] || active[0]).item_key // 與該查驗申請的工項一致(deco(3))
  const formPass = formFor(inspPass, { pass: true, qtyKey: passKey, selfCheckId: 'CLR-DEMO-1' })
  const formFail = formFor(inspFail, { pass: false, qtyKey: (active[1] || active[0]).item_key })
  // 事實列回指已簽署表單:inspections.document_id 在真專案只由簽署路徑寫入,月報據此分「已簽署判定／未經表單的快速判定」
  inspPass.document_id = formPass
  inspFail.document_id = formFail

  // 示範監造確認量(P4b inspection_confirmations 的形狀;真專案由簽署查驗表單在同一交易落庫)與期別狀態
  // (get_valuation_state 的 items[].sources)。佐證包的「依據」欄靠它才顯示得出監造確認來源;示範資料一律
  // 指向上面那份已簽署的監造查驗表單,金額不參與——確認的是**數量**,估驗金額仍由估驗單自己算。
  // 有已簽署查驗表單的那個工項走「查驗表單」(佐證包因此列得出表單版本、雜湊與檢附的自主檢查);
  // 其餘走「監造確認單」(P4d issue_supervisor_certificate 的來源,本來就沒有查驗表單文件)——兩種依據各演一種。
  // 批次與確認日期刻意分散:同一天、同一個批次名連出 30 幾列,看起來像系統灌的,不像監造逐批確認的紀錄。
  const demoBatches = ['3F 版牆（示範）', '4F 柱牆（示範）', '4F 版牆（示範）', '屋頂層（示範）', '1F 打樣區（示範）', '地下室 B1（示範）']
  const demoConfirmDays = [-12, -11, -9, -7, -5, -4]
  const confirmedAt = atHour(inspPass.requested_date, 15, 12)
  const confirmations = active.map((it, i) => {
    const delta = periodDelta(it.item_key)
    if (!(delta > 0)) return null
    const viaForm = it.item_key === passKey
    const batch = demoBatches[i % demoBatches.length]
    return {
      id: `CONF-DEMO-${it.item_key}`, work_item_id: it.item_key, batch_key: `${it.item_key}|${batch}`,
      location_label: batch, stage_key: null, unit: it.unit || null,
      qty_cum: round1(lastVal?.items?.[it.item_key] || 0), qty_delta: delta,
      basis: viaForm ? 'inspection' : 'supervisor_certificate',
      inspection_id: viaForm ? inspPass.id : null,
      document_id: viaForm ? formPass : null, document_version_no: viaForm ? 1 : null,
      content_hash: viaForm ? demoHex(`hash:FD-DEMO-SIGNED-IF-${inspPass.id}:v1`, 64) : null,
      confirmed_by: demoSupervisorId, confirmed_at: viaForm ? confirmedAt : atHour(iso(daysFromNow(demoConfirmDays[i % demoConfirmDays.length])), 16, 40),
      status: 'active', revoked_at: null, reason: null, supersedes_id: null,
    }
  }).filter(Boolean)
  const valuationStates = {
    [lastVal.id]: {
      valuation_id: lastVal.id, violations: [],
      items: confirmations.map((c) => ({
        work_item_id: c.work_item_id, cap: c.qty_delta, prev_cum: round1((prevVal?.items?.[c.work_item_id]) || 0),
        delta: c.qty_delta, violations: [],
        sources: [{ id: `${c.id}-SRC`, kind: 'confirmation', qty: c.qty_delta, batch_key: c.batch_key, confirmation_id: c.id }],
      })),
    },
  }
  // 佐證包用「送審時點」釘住施工日誌版本;示範資料給第 5 期一個送審時間,佐證包才不會標「查無送審稽核紀錄」
  const valuationSubmittedAt = { [lastVal.id]: atHour(lastVal.valuation_date, 9, 30) }

  // 稽核提示的發現清單(批4):形狀對齊 lib/integrityAudit.js buildIntegrityFindings 的
  // findings(status/category/route/title/detail)——真實模式由 run_integrity_audit
  // 用同一個確定性引擎產出,demo 用同形狀靜態資料把卡片演出來。
  const auditFindings = [
    { status: 'risk', category: '估驗勾稽', route: '/valuation',
      title: '估驗超前施工日誌:1 項工項',
      detail: '下列工項累計估驗量高於施工日誌累計完成量逾 5%,可能超計,建議查核完成佐證後再計價:'
        + '結構體混凝土(估驗 385 > 日誌 370)。' },
    { status: 'warn', category: '該查未查', route: '/quality',
      title: '接近完成未申請查驗:2 項工項',
      detail: '下列工項累計完成已達 8 成以上,但尚無任何查驗申請紀錄,建議監造要求申請查驗:'
        + '外牆防水層、屋頂隔熱層。' },
  ]

  const agentActions = [
    { id: 'AGA-DEMO-1', project_id: project.project_id, actor_user: null,
      agent_role: 'contractor', kind: 'draft_daily_log', target_table: 'field_documents', target_id: 'FD-DEMO-AGENT-LOG',
      summary: `已依 18 張現場照片擬好 ${draftLogDate} 施工日誌草稿(3 個工項,數量待你填)`,
      rationale: '工項清單:依當日已配對工項的現場照片自動帶出(確定性比對,非 AI 判讀)。\n'
        + '數量:一律留空待你親自填寫——照片能證明有施作,不能證明做了多少,系統不猜數量。\n'
        + (ylog ? `出工/機具/材料:沿用前一日(${ylog.log_date})日誌,請核對後調整。\n` : '出工/機具/材料:前一日沒有日誌可沿用,留空待填。\n')
        + '天氣:依工地座標向中央氣象署帶入。',
      evidence: { origin: 'agent', log_date: draftLogDate, document_id: 'FD-DEMO-AGENT-LOG', doc_type: 'daily_log', version_no: 1,
        items: Object.fromEntries(Object.entries(logItems).map(([k, it]) => [k, { item_no: it.item_no, description: it.description, unit: it.unit, qty_today: null }])) },
      status: 'pending', resolved_by: null, resolved_at: null, created_at: agaAt(2) },
    { id: 'AGA-DEMO-2', project_id: project.project_id, actor_user: null,
      agent_role: 'contractor', kind: 'draft_inspection', target_table: 'field_documents', target_id: 'FD-DEMO-AGENT-SC',
      summary: `已依今日澆置照片擬好「${TEMPLATE_03310.title}」自主檢查表草稿(實測值待你量測、AI 建議勾選待確認)`,
      rationale: '範本:依今日照片對應的混凝土澆置作業,挑出 03310 自主檢查表範本。\n'
        + '目視項:照片可判讀的勾選項先給建議值並標「AI 建議」、逐項附依據,須你在自主檢查表頁逐項確認;是否已通知監造照片看不出來,留白不猜。\n'
        + '實測值:坍度、溫度等數值一律留空由你親自量測填寫——AI 不猜實測值,合格判定由系統在簽署時依量化標準算。',
      evidence: { origin: 'agent', check_date: draftLogDate, document_id: 'FD-DEMO-AGENT-SC', doc_type: 'self_check', version_no: 1,
        template_id: 'CLT-DEMO-1', template_title: TEMPLATE_03310.title, location: '3F 版牆', work_item_id: null,
        items: TEMPLATE_03310.items.map((it) => ({ no: it.no, item: it.item, kind: it.kind, ...(it.kind === 'bool' && inspDraftBasis[it.no] ? { suggested: true, basis: inspDraftBasis[it.no] } : {}) })) },
      status: 'pending', resolved_by: null, resolved_at: null, created_at: agaAt(5) },
    // 審查意見草稿(批6):payload 形狀對齊後端 draft_submittal_review 工具的產出
    // (submittal_id/no/title + checklist[{point,basis,status}] + opinion + suggested_decision + caution)。
    // submittal_id 指向上方 demo 送審 SUB-DEMO-3(SUB-003,已提送中的修正版)——
    // 「採用意見」只會把意見存進 review_note 並推進到「審核中」,審定仍由監造本人做。
    { id: 'AGA-DEMO-3', project_id: project.project_id, actor_user: null,
      agent_role: 'supervisor', kind: 'draft_submittal_review', target_table: 'submittals', target_id: 'SUB-DEMO-3',
      summary: '送審 SUB-003 已逐項比對契約需求,擬好審查意見(2 項需補件)',
      rationale: '依材料設備類審查要點逐項核對附件說明,出廠證明與 CNS 試驗報告需補正本',
      evidence: {
        來源: ['SUB-003 外牆窯燒磚材料送審', '材料設備類審查要點 5 項'],
        payload: {
          submittal_id: 'SUB-DEMO-3', submittal_no: 'SUB-003', submittal_title: '外牆窯燒磚 材料送審(修正版)',
          checklist: [
            { point: '出廠證明 / 品質保證書齊備', basis: '契約施工規範第 04210 章:磚材進場應檢附出廠證明正本', status: '需補件' },
            { point: 'CNS 或契約指定規範之試驗報告', basis: '規範第 04210 章:應檢附 CNS 抗壓強度及吸水率試驗報告(六個月內)', status: '需補件' },
            { point: '型錄規格與契約規範相符', basis: '附件型錄載明尺寸 230×110×60mm、吸水率 ≤10%,與規範相符', status: '已於送審敘明' },
            { point: '樣品經核可(如契約要求)', basis: '規範要求送樣留存,附件說明未載明留樣紀錄,請核對現場樣品', status: '需監造核對文件' },
            { point: '第一次退回事項已補正', basis: 'Rev.1 附件說明已載明補附出廠證明與 CNS 試驗報告', status: '需監造核對文件' },
            { point: '進場數量與需求/估驗相符', basis: '本件為材料規格送審,不涉進場數量核對', status: '不適用' },
          ],
          opinion: '本件「外牆窯燒磚 材料送審」(Rev.1)經逐項核對審查要點:\n'
            + '一、出廠證明僅為影本且未加蓋廠商大小章,請補正本。\n'
            + '二、CNS 試驗報告出具日期逾六個月,不符規範第 04210 章時效規定,請重新送驗後補附。\n'
            + '三、型錄規格(尺寸、吸水率)核與契約規範相符,尚無不符。\n'
            + '四、樣品留樣紀錄未見於附件,請於補正時一併檢附,俾憑核對。\n'
            + '綜上,本件尚有 2 項文件未齊備,建議退回補正,俟補件齊全後再行審查。',
          suggested_decision: '退回補正',
          caution: 'AI 依契約需求與附件說明擬具,未實際檢視文件正本;請核對送審文件本體後再行審定。',
        },
      },
      status: 'pending', resolved_by: null, resolved_at: null, created_at: agaAt(20) },
    { id: 'AGA-DEMO-4', project_id: project.project_id, actor_user: null,
      agent_role: 'owner', kind: 'audit_note', target_table: 'valuations', target_id: null,
      summary: '勾稽發現 2 項(risk 1 項):估驗報量與施工日誌差 15 m³,建議複查',
      rationale: '以文件勾稽鏈逐工項確定性比對估驗、日誌、查驗、試體,發現由程式精確比對得出,AI 不增刪不改數字',
      evidence: { 來源: ['第 3 期估驗明細', '施工日誌數量加總', '查驗紀錄'], findings: auditFindings },
      status: 'pending', resolved_by: null, resolved_at: null, created_at: agaAt(26) },
    // 批4 raise_to:另一角色的 agent 轉來的交接事項——接受=收下球,不產生業務資料
    { id: 'AGA-DEMO-5', project_id: project.project_id, actor_user: null,
      agent_role: 'supervisor', kind: 'handoff', target_table: 'defects', target_id: null,
      summary: '缺失「3F 柱鋼筋保護層不足」廠商回報已改善完成,請安排複查',
      rationale: '廠商已上傳改善後照片並填寫改善說明,球應轉到監造複查。由 王品管(施工品管)的 agent 轉來。',
      evidence: { 來源: ['缺失改善紀錄', '改善後照片 3 張'] },
      status: 'pending', resolved_by: null, resolved_at: null, created_at: agaAt(8) },
  ]

  return { progressPlan, valuations, siteLogs, inspections, defects, obligations, anchorVersions, projectWarranty, costItems, safetyRecords, changeOrders, itemSchedules, checklistTemplates, checklistRecords, testSamples, submittals, rfis, observations, acceptanceEvents, inspectionPoints, agentActions, fieldDocuments, signedDocs, supervisorLogs, confirmations, valuationStates, valuationSubmittedAt }
}

// ── 跨案總覽的示範姊妹案(靜態摘要;A 區為主 storyline,件數由 store 即時計算) ──
// 機關承辦同時管多案是常態:一案施工中、一案驗收倒數、一案保固中,選案清單一頁看完。
// 跨案總覽已縮為選案清單(D-026 P1b):只留案名/代碼/狀態/未結件數/最近估驗期,
// 進度金額與驗收階段的示範數字隨獨立儀表板一起退場。
export const DEMO_PORTFOLIO = [
  {
    key: 'B', name: 'B 區道路改善工程', code: 'TPE-B-2025', status: '驗收中',
    openDefects: 1, pendingInspections: 0, pendingCOs: 0,
    latestPeriod: 12, latestStatus: '已核定',
    to: '/acceptance', // demo 的驗收頁就是 B 區 storyline
  },
  {
    key: 'C', name: 'C 區公園景觀工程', code: 'TPE-C-2024', status: '保固中',
    openDefects: 0, pendingInspections: 0, pendingCOs: 0,
    latestPeriod: 8, latestStatus: '已核定',
    to: null,
  },
]
