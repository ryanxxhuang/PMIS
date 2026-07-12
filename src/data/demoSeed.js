// Demo storyline 產生器 — 只在「未設定 Supabase」時用。
// 以範例標單（workItems.json）為脊椎，動態生出一個「開工第 6 個月、
// 實際略落後預定」的完整專案：估驗 5 期、請款收款、施工日誌、查驗缺失、
// 契約義務、成本、工安、變更設計、逐工項排程。
// 所有日期相對「今天」計算 → demo 永遠是活的（有逾期、有即將到期、有進行中）。
//
// 對 B2B 銷售而言 demo 模式就是銷售簡報：每一頁都要看得到「用起來的樣子」。

import { TEMPLATE_03310 } from './checklist03310.js'

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d }
const monthsFromNow = (n, day) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + n, day) }

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
    label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    plannedPct: +(smoothstep((i + 1) / N) * 100).toFixed(1),
  }))
  const progressPlan = { start: project.start_date, end: project.end_date, months }

  // ── 估驗 5 期（開工次月起每月一期）：實際 ≈ 20%，落後預定 ~26% ──
  // 落後 ~6% → Dashboard/S曲線亮「落後」警示（demo 要秀的就是異常管理）
  const fractions = [0.07, 0.14, 0.22, 0.29, 0.36]
  const round1 = (x) => Math.round(x * 10) / 10
  const valuations = fractions.map((f, i) => {
    const items = {}
    for (const it of active) items[it.item_key] = round1((it.quantity || 0) * f)
    const valDate = monthsFromNow(i - 4, 25) // 第5期=本月25（尚未到也無妨，狀態=審核中）
    const dF = f - (i ? fractions[i - 1] : 0)
    const periodAmt = Math.round(cover * dF)
    const net = Math.round(periodAmt * 0.95) // 扣 5% 保留款
    const v = {
      id: `VAL-DEMO-${i + 1}`, period_no: i + 1,
      valuation_date: iso(valDate), retention_pct: 5,
      status: i < 4 ? '已核定' : '監造審核',
      items,
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
  const siteLogs = logDays.map((off, i) => {
    const items = {}
    for (const it of active.slice(0, 3)) items[it.item_key] = round1((it.quantity || 0) * 0.004)
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
  const defects = [
    { id: 'DEF-DEMO-1', title: '查驗不合格：外牆窯燒磚打樣', description: '磚縫寬度不均，需重新打樣送審', severity: '一般', location: '1F 打樣區', due_date: iso(daysFromNow(4)), status: '改善中', improvement_note: '已重新調整工法，預計本週完成打樣', ...deco(1) },
    { id: 'DEF-DEMO-2', title: '3F 西側牆面蜂窩', description: '澆置振動不確實造成蜂窩，需鑿除修補', severity: '嚴重', location: '3F 西側', due_date: iso(daysFromNow(-2)), status: '開立', improvement_note: null, ...deco(5) },
    { id: 'DEF-DEMO-3', title: '2F 樓梯間模板拆除不完全', description: '殘留模板角材', severity: '一般', location: '2F 樓梯間', due_date: iso(daysFromNow(-10)), status: '已結案', improvement_note: '已清除完畢，監造複查通過', ...deco(3) },
  ]

  // ── 契約義務（典型公共工程時程義務 + 罰則）──
  const obligations = [
    { id: 'OB-1', title: '提送施工計畫書', category: '開工前', trigger_event: 'commencement', offset_days: 15, offset_dir: 'after', responsible: '廠商', penalty: '逾期每日按契約價金總額 0.5‰ 計罰', source_clause: '第 9 條', source_page: 'p.12', status: '已完成', sort_order: 0 },
    { id: 'OB-2', title: '提送品質計畫書', category: '開工前', trigger_event: 'commencement', offset_days: 15, offset_dir: 'after', responsible: '廠商', penalty: '逾期每日按契約價金總額 0.5‰ 計罰', source_clause: '第 9 條', source_page: 'p.12', status: '已完成', sort_order: 1 },
    { id: 'OB-3', title: '投保營造綜合保險', category: '開工前', trigger_event: 'commencement', offset_days: 0, offset_dir: 'after', responsible: '廠商', penalty: '未投保者機關得代辦並自價金扣抵', source_clause: '第 13 條', source_page: 'p.18', status: '已完成', sort_order: 2 },
    { id: 'OB-4', title: '提送施工月報', category: '施工中', recurring: 'monthly', recurring_day: 5, responsible: '廠商', penalty: null, source_clause: '第 10 條', source_page: 'p.14', status: '待辦', sort_order: 3 },
    { id: 'OB-5', title: '職業安全衛生教育訓練（每季）', category: '施工中', trigger_event: 'fixed', fixed_date: iso(daysFromNow(12)), responsible: '廠商', penalty: null, source_clause: '第 14 條', source_page: 'p.20', status: '待辦', sort_order: 4 },
    { id: 'OB-6', title: '第 5 期估驗計價送審', category: '施工中', trigger_event: 'fixed', fixed_date: iso(daysFromNow(-3)), responsible: '廠商', penalty: null, source_clause: '第 5 條', source_page: 'p.8', status: '待辦', sort_order: 5 },
    { id: 'OB-7', title: '中間查核點：地上結構體完成 50%', category: '施工中', trigger_event: 'commencement', offset_days: 270, offset_dir: 'after', responsible: '廠商', penalty: '逾查核點未達進度按日計罰 1‰', source_clause: '第 7 條', source_page: 'p.10', status: '待辦', sort_order: 6 },
    { id: 'OB-8', title: '提送竣工圖說', category: '完工', trigger_event: 'completion', offset_days: 30, offset_dir: 'after', responsible: '廠商', penalty: '逾期每日按契約價金總額 0.5‰ 計罰', source_clause: '第 21 條', source_page: 'p.30', status: '待辦', sort_order: 7 },
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

  // ── 工安紀錄 ──
  const safetyRecords = [
    { id: 'SAF-1', record_type: '工安缺失', title: '4F 臨邊開口未設護欄', location: '4F 電梯井', record_date: iso(daysFromNow(-2)), severity: '嚴重', status: '待改善', due_date: iso(daysFromNow(1)), note: '已先行圍設警示帶' },
    { id: 'SAF-2', record_type: '工安缺失', title: '施工架斜籬破損', location: '南側外牆', record_date: iso(daysFromNow(-6)), severity: '一般', status: '改善中', due_date: iso(daysFromNow(3)), note: null },
    { id: 'SAF-3', record_type: '自主檢查', title: '施工架週檢', location: '全區', record_date: iso(daysFromNow(0)), severity: '一般', status: '已完成', due_date: null, note: '扣件抽驗合格' },
    { id: 'SAF-4', record_type: '自主檢查', title: '塔吊月檢', location: '塔吊 T1', record_date: iso(daysFromNow(-15)), severity: '一般', status: '已完成', due_date: null, note: null },
    { id: 'SAF-5', record_type: '教育訓練', title: '新進人員職安教育訓練', location: '工務所', record_date: iso(daysFromNow(-9)), severity: '一般', status: '已完成', due_date: null, note: '12 人參訓' },
    { id: 'SAF-6', record_type: '危害告知', title: '混凝土澆置作業危害告知', location: '4F', record_date: iso(daysFromNow(-1)), severity: '一般', status: '已完成', due_date: null, note: null },
    // 監造三類(事件型,生即完成):展示三方權責——監造只能「新增」,不可改寫廠商紀錄
    { id: 'SAF-7', record_type: '監造觀察', title: '3F 模板支撐間距不足,已口頭通知改善', location: '3F', record_date: iso(daysFromNow(-3)), severity: '一般', status: '已完成', due_date: null, note: '併入 SAF-1 缺失追蹤' },
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
  const checklistRecords = [{
    id: 'CLR-DEMO-1', template_id: 'CLT-DEMO-1', check_date: iso(daysFromNow(-12)),
    location: '3F 版牆', note: null, overall: '合格',
    results: Object.fromEntries(TEMPLATE_03310.items.map((it) => [it.no, { value: clValues[it.no] ?? null, pass: clValues[it.no] != null ? true : null }])),
  }]
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

  return { progressPlan, valuations, siteLogs, inspections, defects, obligations, costItems, safetyRecords, changeOrders, itemSchedules, checklistTemplates, checklistRecords, testSamples, submittals, rfis, observations, acceptanceEvents, inspectionPoints }
}

// ── 跨案總覽的示範姊妹案(靜態摘要;A 區為主 storyline,由 store 即時計算) ──
// 機關承辦同時管多案是常態:一案施工中(落後)、一案驗收倒數、一案保固中,
// 三種狀態一頁看完就是跨案總覽的賣點。
export const DEMO_PORTFOLIO = [
  {
    key: 'B', name: 'B 區道路改善工程', code: 'TPE-B-2025', status: '驗收中',
    billable: 128500000, cum: 126950000, progressPct: 98.8, plannedPct: 100,
    openDefects: 1, pendingInspections: 0, pendingCOs: 0,
    acceptance: { label: '初驗（期限倒數 5 天）', done: 2, total: 6, overdue: false },
    to: '/acceptance', // demo 的驗收頁就是 B 區 storyline
  },
  {
    key: 'C', name: 'C 區公園景觀工程', code: 'TPE-C-2024', status: '保固中',
    billable: 45200000, cum: 45200000, progressPct: 100, plannedPct: 100,
    openDefects: 0, pendingInspections: 0, pendingCOs: 0,
    acceptance: { label: '結案（保固中）', done: 6, total: 6, finished: true },
    to: null,
  },
]
