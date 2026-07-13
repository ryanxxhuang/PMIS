// 施工日誌「零輸入」輔助——複製昨日、從歷史自學常用項目。全純函式,好測。
// 設計原則(memory AI 差異化):少輸入,把每天重複的班組/機具/材料變一鍵帶入。

// 找「date 之前最近一筆」日誌(複製昨日用;不一定真的是昨天,取最近的前一筆)
export function previousLog(siteLogs = [], date) {
  return siteLogs
    .filter((l) => l.log_date && l.log_date < date)
    .sort((a, b) => b.log_date.localeCompare(a.log_date))[0] || null
}

// 複製昨日:只帶「每天重複」的欄位(人力/機具/材料/技術士安衛等 extras + 天氣),
// 不帶當日工作摘要與各工項數量(那是每天真正要填的差異)。
export function copyableFromLog(lg) {
  if (!lg) return null
  return {
    labor: (lg.labor || []).map((r) => ({ ...r })),
    equipment: (lg.equipment || []).map((r) => ({ ...r })),
    materials: (lg.materials || []).map((r) => ({ ...r })),
    extras: { ...(lg.extras || {}) },
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
