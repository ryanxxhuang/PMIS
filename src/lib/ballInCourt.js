// Ball-in-court:每個協作項目「現在等誰處理」。學自 Procore——全平台一致的
// 責任語言,任何人打開都知道球在誰手上、該催誰。
// who:'contractor'(廠商) | 'supervisor'(監造) | 'owner'(機關) | 'design'(設計) | 'done'(已完成)

export function rfiBall(r) {
  if (r.status === '待回覆') return { who: 'supervisor', label: '待監造/設計回覆' }
  if (r.status === '已回覆') return { who: 'contractor', label: '待廠商確認結案' }
  return { who: 'done', label: '已結案' }
}

export function submittalBall(s) {
  if (s.status === '已提送' || s.status === '審核中') return { who: 'supervisor', label: '待監造審定' }
  if (s.status === '退回補正') return { who: 'contractor', label: '待廠商補正' }
  return { who: 'done', label: s.status } // 核准 / 核備 / 駁回
}

export function valuationBall(v) {
  if (v.status === '草稿') return { who: 'contractor', label: '待廠商送審' }
  if (v.status === '監造審核') return { who: 'supervisor', label: '待監造核定' }
  if (!v.invoice_date) return { who: 'contractor', label: '待廠商請款' }
  if (!v.paid_date) return { who: 'owner', label: '待機關撥款' } // 已請款 → 球在機關撥款
  return { who: 'done', label: '已撥款' }
}

export function changeOrderBall(co) {
  if (co.status === '提出') return { who: 'supervisor', label: '待監造審查' }
  if (co.status === '審核中') return { who: 'owner', label: '待機關核定' }
  return { who: 'done', label: co.status } // 核准 / 駁回
}

export function defectBall(d) {
  if (d.status === '已結案') return { who: 'done', label: '已結案' }
  if (d.status === '待複查') return { who: 'supervisor', label: '待監造複查' }
  // 開立/改善中分開標示:按「開始改善」後仍顯示「待廠商改善」會讓
  // 畫面標籤與實際狀態對不上(第二輪 P2-01)
  if (d.status === '改善中') return { who: 'contractor', label: '廠商改善中' }
  return { who: 'contractor', label: '待廠商改善' } // 開立
}

export function inspectionBall(i) {
  if (i.status === '待查驗') return { who: 'supervisor', label: '待監造查驗' }
  return { who: 'done', label: i.status } // 合格 / 不合格
}

export function observationBall(o) {
  if (o.status === '待處理') return { who: o.assigned_to || 'contractor', label: '待處理' }
  return { who: 'done', label: o.status } // 已處理 / 轉缺失
}

// Dashboard 彙整:跨模組數「球在廠商 / 監造 / 機關」的未結案件數
export function tallyBalls({ rfis = [], submittals = [], valuations = [], defects = [], inspections = [], observations = [], changeOrders = [] }) {
  const t = { contractor: 0, supervisor: 0, owner: 0, design: 0 }
  const add = (b) => { if (b.who !== 'done' && t[b.who] != null) t[b.who] += 1 }
  rfis.forEach((r) => add(rfiBall(r)))
  submittals.forEach((s) => add(submittalBall(s)))
  valuations.forEach((v) => add(valuationBall(v)))
  defects.forEach((d) => add(defectBall(d)))
  inspections.forEach((i) => add(inspectionBall(i)))
  observations.forEach((o) => add(observationBall(o)))
  changeOrders.forEach((c) => add(changeOrderBall(c)))
  return t
}

// 「球在你手上」逐案清單:回傳指定角色(org_type)目前該處理的協作項,
// 供各角色的首頁行動中心用。每項 { who, tag, title, meta(=ball.label), to }。
export function myOpenItems(org, data = {}) {
  const { rfis = [], submittals = [], valuations = [], defects = [], inspections = [], observations = [], changeOrders = [] } = data
  const out = []
  const push = (ball, tag, title, to) => { if (ball.who === org) out.push({ who: ball.who, tag, title: title || '（未命名）', meta: ball.label, to }) }
  rfis.forEach((r) => push(rfiBall(r), '疑義', `${r.rfi_no ? r.rfi_no + ' ' : ''}${r.title || ''}`.trim(), '/rfi'))
  submittals.forEach((s) => push(submittalBall(s), '送審', `${s.submittal_no ? s.submittal_no + ' ' : ''}${s.title || ''}`.trim(), '/submittals'))
  valuations.forEach((v) => {
    const b = valuationBall(v)
    push(b, '估驗', `第 ${v.period_no} 期估驗`, b.who === 'owner' ? '/payments' : '/valuation')
  })
  inspections.forEach((i) => push(inspectionBall(i), '查驗', i.title, '/quality'))
  defects.forEach((d) => push(defectBall(d), d.domain === 'safety' ? '工安缺失' : '缺失', d.title, d.domain === 'safety' ? '/safety' : '/quality'))
  observations.forEach((o) => push(observationBall(o), '觀察', o.title, '/quality'))
  changeOrders.forEach((c) => push(changeOrderBall(c), '變更', `${c.co_no ? c.co_no + ' ' : ''}${c.title || ''}`.trim(), '/change-orders'))
  return out
}
