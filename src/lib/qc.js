// 品管自動判定引擎:量化標準 → 實測值 → 合格/不合格。
// 檢查表項目 kind:'num'(數值,依 min/max 判) | 'bool'(勾選=合格)。
// 混凝土抗壓依規範 03310:預拌混凝土任一試體 ≥0.85fc′ 且平均 ≥fc′。

import { parseLocalDate } from './dates.js'

// 單項判定:回 true(合格)/false(不合格)/null(未檢,不列入)
export function judgeItem(item, value) {
  if (item.kind === 'bool') return value === true ? true : value === false ? false : null
  if (value == null || value === '') return null
  const n = Number(value)
  if (isNaN(n)) return null
  if (item.min != null && n < item.min) return false
  if (item.max != null && n > item.max) return false
  return true
}

// 整表判定:values = {no: value}。
// 回 { results: {no: {value, pass}}, overall: '合格'|'不合格'|null, failed: [item…] }
// overall=null 表示尚無任何已檢項目。
export function judgeChecklist(template, values) {
  const results = {}
  const failed = []
  let checked = 0, ok = true
  for (const it of template.items || []) {
    const v = values?.[it.no]
    const pass = judgeItem(it, v)
    results[it.no] = { value: v ?? null, pass }
    if (pass === null) continue
    checked += 1
    if (!pass) { ok = false; failed.push(it) }
  }
  return { results, overall: checked === 0 ? null : ok ? '合格' : '不合格', failed }
}

// 混凝土 28 天抗壓判定(kgf/cm²):任一 ≥0.85fc′ 且平均 ≥fc′(03310 3.3.2(3)B)
export function judgeConcrete(fc, values) {
  const vs = (values || []).map(Number).filter((n) => !isNaN(n) && n > 0)
  if (!fc || vs.length === 0) return { status: null, avg: null, min: null }
  const avg = vs.reduce((s, n) => s + n, 0) / vs.length
  const min = Math.min(...vs)
  return { status: min >= 0.85 * fc && avg >= fc ? '合格' : '不合格', avg, min }
}

const addDays = (iso, days) => {
  const d = parseLocalDate(iso)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 由取樣日推 7/28 天試驗到期日
export function sampleDues(sampledDate) {
  return { d7_due: addDays(sampledDate, 7), d28_due: addDays(sampledDate, 28) }
}

// 掃描施工日誌:材料含「混凝土」的日期 → 應建的取樣組(排除已存在日期)
export function pendingSamplesFromLogs(siteLogs, existingSamples) {
  const covered = new Set((existingSamples || []).map((s) => s.sampled_date))
  const out = []
  for (const l of siteLogs || []) {
    if (covered.has(l.log_date)) continue
    const mat = (l.materials || []).find((m) => (m.name || '').includes('混凝土'))
    if (!mat) continue
    const fcMatch = (mat.name || '').match(/(\d{3,4})\s*kgf/)
    out.push({
      sampled_date: l.log_date,
      location: l.work_summary || '',
      fc: fcMatch ? Number(fcMatch[1]) : null,
      material: mat.name,
      ...sampleDues(l.log_date),
    })
  }
  return out.sort((a, b) => a.sampled_date.localeCompare(b.sampled_date))
}

// 試體到期狀態(給提醒中心):d7/d28 未填值且到期日進入 soonDays 內/逾期
export function sampleAlerts(samples, today, soonDays = 7) {
  const t = typeof today === 'string' ? parseLocalDate(today) : today
  const out = []
  for (const s of samples || []) {
    if (s.status === '合格' || s.status === '不合格') continue
    const checks = [
      { key: 'd7', due: s.d7_due, filled: s.d7_value != null, label: '7天試驗' },
      { key: 'd28', due: s.d28_due, filled: (s.d28_values || []).length > 0, label: '28天抗壓試驗' },
    ]
    for (const c of checks) {
      if (c.filled || !c.due) continue
      const days = Math.round((parseLocalDate(c.due) - t) / 86400000)
      if (days < 0) out.push({ sample: s, label: c.label, due: c.due, days, level: 'overdue' })
      else if (days <= soonDays) out.push({ sample: s, label: c.label, due: c.due, days, level: 'soon' })
    }
  }
  return out.sort((a, b) => a.days - b.days)
}
