// 施工日誌「零輸入」輔助——複製昨日、從歷史自學常用項目。全純函式,好測。
// 設計原則(memory AI 差異化):少輸入,把每天重複的班組/機具/材料變一鍵帶入。

// 找「date 之前最近一筆」日誌(複製昨日用;不一定真的是昨天,取最近的前一筆)
export function previousLog(siteLogs = [], date) {
  return siteLogs
    .filter((l) => l.log_date && l.log_date < date)
    .sort((a, b) => b.log_date.localeCompare(a.log_date))[0] || null
}

// 複製昨日:帶「每天重複」的欄位(人力/機具/材料/技術士安衛等 extras + 天氣),
// 不帶當日工作摘要與各工項「數量」(那是每天真正要填的差異)。
// C-4:工項改帶「列骨架」——key 保留、數量留空,施作中的工項列表每天大多重複,
// 全不帶會讓使用者覺得「完全沒帶入」;數量空值在存檔時本就被丟棄,不會產生假數量。
export function copyableFromLog(lg) {
  if (!lg) return null
  return {
    labor: (lg.labor || []).map((r) => ({ ...r })),
    equipment: (lg.equipment || []).map((r) => ({ ...r })),
    materials: (lg.materials || []).map((r) => ({ ...r })),
    extras: { ...(lg.extras || {}) },
    items: Object.fromEntries(Object.keys(lg.items || {}).map((k) => [k, ''])),
    weather: lg.weather_am || lg.weather || '',
    weather_pm: lg.weather_pm || '',
    from: lg.log_date,
  }
}

// 從歷史日誌自學常用項目(依出現次數排序,取前 limit)→ 一鍵加入用。
// labor 以「工別」、equipment 以「名稱」、materials 以「名稱+單位」去重。
export function frequentItems(siteLogs = [], limit = 8) {
  const tally = (rows, keyOf) => {
    const m = new Map()
    for (const r of rows) { const k = keyOf(r); if (k) m.set(k, (m.get(k) || 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => k)
  }
  const allLabor = siteLogs.flatMap((l) => l.labor || [])
  const allEquip = siteLogs.flatMap((l) => l.equipment || [])
  const allMat = siteLogs.flatMap((l) => l.materials || [])
  return {
    labor: tally(allLabor, (r) => (r.type || '').trim()).map((type) => ({ type, count: '' })),
    equipment: tally(allEquip, (r) => (r.name || '').trim()).map((name) => ({ name, count: '' })),
    materials: tally(allMat, (r) => {
      const name = (r.name || '').trim(); return name ? `${name}␟${r.unit || ''}` : ''
    }).map((k) => { const [name, unit] = k.split('␟'); return { name, unit: unit || '', qty: '' } }),
  }
}

// 加一列但去重(已有同名/同工別則不重複加)
export function addUniqueRow(rows, row, keyOf) {
  if (rows.some((r) => keyOf(r) === keyOf(row))) return rows
  return [...rows, row]
}

// 唯讀摘要(W8-4B B1)的公定格式各節:壓成「有資料才顯示」的 [節名, 內容] 行。
// 沒有日誌回空陣列。五、安衛的 insured 預設「無新進勞工」不算有值(否則每天都多一行雜訊)。
export function readOnlyOfficialRows(log) {
  const rows = []
  if (!log) return rows
  const push = (label, text) => { if (text) rows.push([label, text]) }
  push('出工人數', (log.labor || []).filter((r) => r.type).map((r) => `${r.type}×${r.count ?? '—'}`).join('、'))
  push('機具使用', (log.equipment || []).filter((r) => r.name).map((r) => `${r.name}×${r.count ?? '—'}`).join('、'))
  push('材料使用', (log.materials || []).filter((r) => r.name).map((r) => `${r.name}×${r.qty ?? '—'}${r.unit ? ` ${r.unit}` : ''}`).join('、'))
  const ex = log.extras || {}
  push('四、應置技術士', ex.technicians)
  push('五、職業安全衛生', [
    ex.edu && '勤前教育（含危害告知）',
    ex.ppe && '檢查個人防護具',
    ex.insured && ex.insured !== '無新進勞工' && `新進勞工提報勞保:${ex.insured}`,
  ].filter(Boolean).join('、'))
  push('六、施工取樣試驗紀錄', ex.sampling)
  push('七、通知協力廠商辦理事項', ex.notice)
  push('八、重要事項紀錄', ex.important)
  return rows
}

// CSV 匯出:每筆日誌的每個工項攤成一列(日期/天氣/摘要重複帶),工項資訊由 byKey 查表補上;
// 查不到的 key(標單已重匯)以 key 本身當名稱,不丟列。欄位順序與 SITE_LOG_CSV_COLUMNS 對齊。
export const SITE_LOG_CSV_COLUMNS = Object.freeze([
  { key: 'log_date', label: '日期' }, { key: 'weather', label: '天氣' }, { key: 'work_summary', label: '工作摘要' },
  { key: 'item_no', label: '項次' }, { key: 'description', label: '工項' }, { key: 'unit', label: '單位' }, { key: 'qty', label: '當日數量' },
])
export function flattenSiteLogsForCsv(siteLogs = [], byKey = new Map()) {
  return siteLogs.flatMap((l) => Object.entries(l.items || {}).map(([key, qty]) => ({
    log_date: l.log_date, weather: l.weather || '', work_summary: l.work_summary || '',
    item_no: byKey.get(key)?.item_no || '', description: byKey.get(key)?.description || key,
    unit: byKey.get(key)?.unit || '', qty,
  })))
}
