// ITP 檢驗停留點:W=見證(Witness)、H=停留(Hold,監造未查驗不得續作)、R=文審(Review)。
// 停留點回答「這個工項什麼時候必須通知監造」——狀態不落 DB,由連結的查驗結果推導;
// 「該叫監造了」的判斷 = 該工項已有施工日誌數量,但停留點還沒申請查驗。

export const POINT_TYPES = {
  H: { label: 'H 停留點', desc: '監造未到場查驗不得續作' },
  W: { label: 'W 見證點', desc: '應通知監造到場見證' },
  R: { label: 'R 文審點', desc: '文件送審查核' },
}

// 由連結查驗推導停留點狀態
export function itpStatus(point, inspections = []) {
  const insp = point.inspection_id ? inspections.find((i) => i.id === point.inspection_id) : null
  if (!insp) return { key: 'pending', label: '未申請查驗' }
  if (insp.status === '合格') return { key: 'passed', label: '通過' }
  if (insp.status === '不合格') return { key: 'failed', label: '不通過' }
  return { key: 'requested', label: '已申請，待監造查驗' }
}

// 該停留點掛的工項是否已在施作(任一日誌有數量)
export function itpActivity(point, siteLogs = []) {
  if (!point.work_item_key) return false
  return siteLogs.some((l) => Number(l.items?.[point.work_item_key]) > 0)
}

// 提醒:施作中但未叫驗的 H(不得續作,最高級)與 W(應通知見證)
export function itpAlerts(points = [], inspections = [], siteLogs = []) {
  const out = []
  for (const p of points) {
    if (itpStatus(p, inspections).key !== 'pending') continue
    if (!itpActivity(p, siteLogs)) continue
    if (p.point_type === 'H') {
      out.push({ level: 'overdue', point: p, title: `H 停留點未申請查驗：${p.title}`, meta: '該工項已在施作——停留點未經監造查驗不得續作' })
    } else if (p.point_type === 'W') {
      out.push({ level: 'soon', point: p, title: `W 見證點應通知監造：${p.title}`, meta: '該工項施作中，應通知監造到場見證' })
    }
  }
  return out
}
