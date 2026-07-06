// Ball-in-court:每個協作項目「現在等誰處理」。學自 Procore——全平台一致的
// 責任語言,任何人打開都知道球在誰手上、該催誰。
// who:'contractor'(廠商) | 'supervisor'(監造) | 'design'(設計) | 'done'(已完成)

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
  if (!v.paid_date) return { who: 'contractor', label: '待收款' }
  return { who: 'done', label: '已收款' }
}

export function defectBall(d) {
  if (d.status === '已結案') return { who: 'done', label: '已結案' }
  if (d.status === '待複查') return { who: 'supervisor', label: '待監造複查' }
  return { who: 'contractor', label: '待廠商改善' } // 開立 / 改善中
}

export function inspectionBall(i) {
  if (i.status === '待查驗') return { who: 'supervisor', label: '待監造查驗' }
  return { who: 'done', label: i.status } // 合格 / 不合格
}

export function observationBall(o) {
  if (o.status === '待處理') return { who: o.assigned_to || 'contractor', label: '待處理' }
  return { who: 'done', label: o.status } // 已處理 / 轉缺失
}

// Dashboard 彙整:跨模組數「球在廠商 / 監造」的未結案件數
export function tallyBalls({ rfis = [], submittals = [], valuations = [], defects = [], inspections = [], observations = [] }) {
  const t = { contractor: 0, supervisor: 0, design: 0 }
  const add = (b) => { if (b.who !== 'done' && t[b.who] != null) t[b.who] += 1 }
  rfis.forEach((r) => add(rfiBall(r)))
  submittals.forEach((s) => add(submittalBall(s)))
  valuations.forEach((v) => add(valuationBall(v)))
  defects.forEach((d) => add(defectBall(d)))
  inspections.forEach((i) => add(inspectionBall(i)))
  observations.forEach((o) => add(observationBall(o)))
  return t
}
