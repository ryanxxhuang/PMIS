// 驗收/結算流程:報竣 → 竣工確認 → 初驗 → (缺失改善 → 複驗) → 正式驗收 →
// 結算驗收證明書 → 保固起算。法定期限依政府採購法及其施行細則自動推算,
// 逾期即提醒——機關承辦的法定時限壓力就在這裡。
//
// 資料形狀:events = [{ stage_key, event_date, result, note }](一階段一筆,後蓋前)。
// deriveAcceptance(events, today) → 各階段 { ...def, event, due, overdue, daysLeft, state }。
import { parseLocalDate } from './dates.js'

// 標準流程定義。dueDays/dueFrom:自某階段實際日起算的法定/慣例期限。
// optional:缺失改善/複驗只有初驗不合格才會走。
export const ACCEPTANCE_STAGES = [
  { key: 'report',      label: '竣工申報（報竣）',   by: '廠商',      basis: '契約(預定竣工日前或當日書面通知)' },
  { key: 'confirm',     label: '竣工確認會勘',       by: '機關+監造', dueDays: 7,  dueFrom: 'report',  basis: '採購法細則 §92（7日內會同核對）' },
  { key: 'initial',     label: '初驗',               by: '機關(主驗)', dueDays: 30, dueFrom: 'confirm', basis: '採購法細則 §93（30日內辦理）' },
  { key: 'fix',         label: '缺失改善',           by: '廠商',      optional: true, basis: '依初驗結果限期改善' },
  { key: 'reinspect',   label: '複驗',               by: '機關',      optional: true, dueDays: 20, dueFrom: 'fix', basis: '採購法細則 §94 準用' },
  { key: 'final',       label: '正式驗收',           by: '機關(主驗)', dueDays: 20, dueFrom: 'initial', basis: '採購法細則 §94（初驗合格後20日內）' },
  { key: 'certificate', label: '結算驗收證明書',     by: '機關',      dueDays: 15, dueFrom: 'final',   basis: '採購法 §73 / 細則 §101（15日內填具）' },
  { key: 'warranty',    label: '保固起算',           by: '—',         basis: '契約(自驗收合格日起算)' },
]

const addDays = (dateStr, n) => {
  const d = parseLocalDate(dateStr)
  if (!d) return null
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const dayDiff = (dateStr, today) => {
  const d = parseLocalDate(dateStr)
  if (!d || !today) return null
  return Math.round((d - today) / 86400000)
}

// events → 每階段的狀態。state: done | due(前置已完成,期限倒數中) | pending(前置未到)
export function deriveAcceptance(events = [], today = new Date()) {
  const byStage = new Map()
  for (const e of events) byStage.set(e.stage_key, e) // 同階段以最後一筆為準(呼叫端先排序)
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  return ACCEPTANCE_STAGES.map((def) => {
    const event = byStage.get(def.key) || null
    const fromEvent = def.dueFrom ? byStage.get(def.dueFrom) : null
    const due = def.dueDays && fromEvent?.event_date ? addDays(fromEvent.event_date, def.dueDays) : null
    const daysLeft = !event && due ? dayDiff(due, today0) : null
    return {
      ...def,
      event,
      due,
      daysLeft,
      overdue: daysLeft != null && daysLeft < 0,
      state: event?.event_date ? 'done' : (due ? 'due' : 'pending'),
    }
  })
}

// 初驗是否記載不合格 → 缺失改善/複驗兩個 optional 階段才顯示
export function needsFixFlow(events = []) {
  const initial = events.filter((e) => e.stage_key === 'initial').pop()
  return !!initial && initial.result === '不合格'
}

// 提醒中心用:未完成且已起算期限的階段 → { level, title, meta }
export function acceptanceAlerts(events = [], today = new Date()) {
  const stages = deriveAcceptance(events, today)
  const fixFlow = needsFixFlow(events)
  const out = []
  for (const s of stages) {
    if (s.optional && !fixFlow) continue
    if (s.state !== 'due' || s.daysLeft == null) continue
    if (s.daysLeft < 0) {
      out.push({ level: 'overdue', stage: s.key, title: `${s.label}逾期`, meta: `逾期 ${-s.daysLeft} 天（法定期限 ${s.due}，${s.basis}）` })
    } else if (s.daysLeft <= 7) {
      out.push({ level: 'soon', stage: s.key, title: `${s.label}期限將至`, meta: `還有 ${s.daysLeft} 天（${s.due} 前，${s.basis}）` })
    }
  }
  return out
}

// 摘要:目前走到哪一階段(給跨案總覽的狀態 chip)
export function acceptanceStageSummary(events = []) {
  if (!events.length) return null
  const stages = deriveAcceptance(events)
  const fixFlow = needsFixFlow(events)
  const visible = stages.filter((s) => !s.optional || fixFlow)
  const doneCount = visible.filter((s) => s.state === 'done').length
  const next = visible.find((s) => s.state !== 'done')
  const last = visible[visible.length - 1]
  if (!next) return { label: '結案（保固中）', done: doneCount, total: visible.length, finished: true }
  return { label: `${next.label}${next.overdue ? '（逾期）' : ''}`, done: doneCount, total: visible.length, overdue: next.overdue, finished: last.state === 'done' }
}
