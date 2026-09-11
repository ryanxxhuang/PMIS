// 估驗決策列的差異彙總(W8-4B B2;原本住在 pages/web/Valuation.jsx,重構波次 8 搬來
// ——純函式的測試不該為了 import 它而拉進整頁的 store/supabase import 圖)。
//
// 純計數,不動任何金額——金額仍由 boqCalc 確定性引擎算(紅線 2)。
// 超計與明細列的 overBilled 是同一條式子(OVER_TOL 同源),兩處判定不可分裂;
// 只計 cum>0 的項——沒計價的工項本來就不存在「超計/無佐證」問題,也省掉整樹掃描。
// 回傳 keys 讓決策列能把該些列的佐證欄一鍵展開(沿用 evOpen,不另做篩選機制)。
import { OVER_TOL } from './evidence.js'

export function summarizeValuationDiff(leaves, cumMap, evidenceOf) {
  const overKeys = []
  const noEvidenceKeys = []
  for (const it of leaves || []) {
    const cum = Number(cumMap?.[it.item_key] ?? 0)
    if (!(cum > 0)) continue
    const ev = evidenceOf(it)
    const evCount = ev.counts.logs + ev.counts.inspections + ev.counts.checklists + ev.counts.samples
    if (evCount === 0) noEvidenceKeys.push(it.item_key)
    // 注意:無任何日誌(loggedTotal=0)而有計價者也算超計——與明細列警示一致,
    // 這正是送審前最該被看到的一種差異
    if (cum > ev.loggedTotal * OVER_TOL) overKeys.push(it.item_key)
  }
  return { over: overKeys.length, noEvidence: noEvidenceKeys.length, overKeys, noEvidenceKeys }
}
