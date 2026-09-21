// 品管自動判定引擎:量化標準 → 實測值 → 合格/不合格。
// 檢查表項目 kind:'num'(數值,依 min/max 判) | 'bool'(勾選=合格)。
// 混凝土抗壓依規範 03310:預拌混凝土任一試體 ≥0.85fc′ 且平均 ≥fc′。

import { parseLocalDate, localISODate } from './dates.js'

// ── 分列讀數(2026-09-21 G 包)────────────────────────────────────────────────
// 實測項目的結果 results[no] = { value, readings? }:紙上寫「編號 1 13×11 mm、編號 4 11×11 mm」這種
// 兩向尺寸／多編號時,readings 逐筆保存 {entry_no, value, value2, raw_text}(數值已是範本單位),value 為 null;
// 一般單一讀數仍只用 value。兩種寫法擇一(DB fn_checklist_result_check 於簽署時強制)。
export const hasReadings = (r) => !!r && typeof r === 'object' && Array.isArray(r.readings) && r.readings.length > 0
// 結果物件 → 判定輸入:有讀數給 {value, readings},否則給單一值(與 DB fn_checklist_judge 同一條規則)
export const judgeInput = (r) => (hasReadings(r) ? { value: r.value ?? null, readings: r.readings } : r && typeof r === 'object' ? r.value ?? null : r ?? null)
const isReadingsInput = (v) => !!v && typeof v === 'object' && Array.isArray(v.readings)
// 數字轉換:與 DB fn_checklist_num 同一條(空白／null／物件=沒有數字)
const toNum = (v) => {
  if (v == null || v === '' || typeof v === 'object') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}
// 讀數的人讀文字(列印、清單、差異;與 Edge fieldDocDraft.formatReadings 同一格式)
export function formatReadings(readings, unit) {
  const u = unit ? ` ${unit}` : ''
  return (Array.isArray(readings) ? readings : [])
    .filter((x) => x && typeof x === 'object')
    .map((x) => `${x.entry_no ? `編號 ${x.entry_no} ` : ''}${x.value2 == null ? x.value ?? '' : `${x.value ?? ''}×${x.value2}`}${u}`)
    .join('、')
}
// 一項結果的人讀文字:讀數 → 分列;勾選 → 合格／不合格;數字 → 值＋單位
export function formatResult(item, r) {
  if (hasReadings(r)) return formatReadings(r.readings, item?.unit)
  const v = r && typeof r === 'object' ? r.value : r
  if (v === true) return '合格'
  if (v === false) return '不合格'
  if (v == null || v === '') return ''
  return `${v}${typeof v === 'number' && item?.unit ? ` ${item.unit}` : ''}`
}

// 單項判定:回 true(合格)/false(不合格)/null(未檢,不列入)。
// value 可為單一值,或 judgeInput 給的 {value, readings}:有讀數時每一筆的兩向都要在 min／max 內才合格。
export function judgeItem(item, value) {
  const rd = isReadingsInput(value) ? value : null
  if (item.kind === 'bool') {
    const v = rd ? rd.value : value
    return v === true ? true : v === false ? false : null
  }
  const nums = []
  if (rd && rd.readings.length) {
    for (const x of rd.readings) {
      if (!x || typeof x !== 'object') continue
      for (const n of [toNum(x.value), toNum(x.value2)]) if (n != null) nums.push(n)
    }
  } else {
    const n = toNum(rd ? rd.value : value)
    if (n != null) nums.push(n)
  }
  if (!nums.length) return null
  return nums.every((n) => !(item.min != null && n < item.min) && !(item.max != null && n > item.max))
}

// 整表判定:values = {no: value 或 {value, readings}}(見 judgeInput)。
// 回 { results: {no: {value, pass[, readings]}}, overall: '合格'|'不合格'|null, failed: [item…] }
// overall=null 表示尚無任何已檢項目。
export function judgeChecklist(template, values) {
  const results = {}
  const failed = []
  let checked = 0, ok = true
  for (const it of template.items || []) {
    const v = values?.[it.no]
    const pass = judgeItem(it, v)
    const rd = isReadingsInput(v) ? v : null
    results[it.no] = { value: (rd ? rd.value : v) ?? null, pass }
    if (rd && rd.readings.length && it.kind !== 'bool') results[it.no].readings = rd.readings
    if (pass === null) continue
    checked += 1
    if (!pass) { ok = false; failed.push(it) }
  }
  return { results, overall: checked === 0 ? null : ok ? '合格' : '不合格', failed }
}

// 覆蓋程度(W03,只是呈現,不改 overall):已檢=results 裡 pass 不為 null 的項;total 依範本。
// 範本已刪除時 total 為 null,只報已檢數。overall 是「已檢項的判定」,unchecked>0 時畫面要一併說
export function checklistCoverage(template, results) {
  const checked = Object.values(results || {}).filter((r) => r && r.pass != null).length
  const total = template?.items?.length ?? null
  return { checked, total, unchecked: total == null ? null : Math.max(0, total - checked) }
}
export function coverageText(cov) {
  if (!cov) return ''
  return cov.total == null ? `已檢 ${cov.checked} 項` : `已檢 ${cov.checked}／${cov.total}${cov.unchecked ? `，${cov.unchecked} 項未檢` : ''}`
}

// 修訂差異:比對前後版 results({no:{value,pass}}),回傳值或判定有變的項目
// (給修訂版次 UI 顯示「這次更正動了哪幾項」)
export function diffChecklistResults(template, prevResults, nextResults) {
  const out = []
  for (const it of template?.items || []) {
    const a = prevResults?.[it.no] || {}
    const b = nextResults?.[it.no] || {}
    // 分列讀數以人讀文字比對與呈現(編號、兩向都算)
    const from = hasReadings(a) ? formatReadings(a.readings, it.unit) : a.value ?? null
    const to = hasReadings(b) ? formatReadings(b.readings, it.unit) : b.value ?? null
    const passFrom = a.pass ?? null, passTo = b.pass ?? null
    if (from !== to || passFrom !== passTo) out.push({ no: it.no, item: it.item, from, to, passFrom, passTo })
  }
  return out
}

// 混凝土 28 天抗壓判定(kgf/cm²):任一 ≥0.85fc′ 且平均 ≥fc′(03310 3.3.2(3)B)
export function judgeConcrete(fc, values) {
  const vs = (values || []).map(Number).filter((n) => !isNaN(n) && n > 0)
  if (!fc || vs.length === 0) return { status: null, avg: null, min: null }
  const avg = vs.reduce((s, n) => s + n, 0) / vs.length
  const min = Math.min(...vs)
  return { status: min >= 0.85 * fc && avg >= fc ? '合格' : '不合格', avg, min }
}

// 試體輸入更新的同步推導。不能把 judgement 暫存在 React state updater 內再立刻讀，
// 因為 updater 可能延後執行，demo 會漏開正式 DB trigger 一定會開的缺失。
export function deriveTestSampleUpdate(sample, patch) {
  const merged = { ...sample, ...patch }
  if (!('d28_values' in patch) && !('fc' in patch)) return { sample: merged, judgement: null }
  const judgement = judgeConcrete(merged.fc, merged.d28_values)
  return { sample: { ...merged, status: judgement.status || '待試驗' }, judgement }
}

// 同一組不合格試體只開一筆缺失。正式 DB 由 defects.test_sample_id 防重複；
// demo 用此純函式套同一規則，且已結案的原缺失也算已有追蹤紀錄。
export function shouldCreateTestSampleDefect(defects, testSampleId) {
  return !!testSampleId && !(defects || []).some((d) => d.test_sample_id === testSampleId)
}

const addDays = (iso, days) => {
  const d = parseLocalDate(iso)
  d.setDate(d.getDate() + days)
  return localISODate(d)
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
