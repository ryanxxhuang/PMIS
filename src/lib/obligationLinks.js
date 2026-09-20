// 契約義務「去哪裡處理」的唯一對照(P5d):今日工作(todayTasks)、履約時程(/requirements)與
// 提醒中心都吃這一份。以前只有 todayTasks 內部一份,履約時程要列同一批「待補設定」時
// 若再抄一份,兩頁遲早對同一種缺口指向不同頁。
// 六種缺口的處理入口:
//   responsible／rule／timing → 擷取審核該筆(已確認內容不可改,廢止取代後補登;義務 id 就是 requirement id,?highlight= 直達)
//   review            → 期限追蹤的那一期(人核對本期是否已履行後標記,標記即解除)
//   stop              → 期限追蹤的該筆(基準日卡就在下方補竣工日／展延;已竣工的到驗收頁登錄);
//                       保固類(P5e)→ 履約時程的該筆:缺正式驗收合格日到驗收頁、缺契約保固期間在同頁的履約期程卡登錄,
//                       兩個入口都在那一筆的期次說明裡(保固期間只在履約期程卡登錄)
//   anchor            → 期限追蹤(基準日卡)
// 期別深連結:/deadlines?obligation=<id>&period=<期別>(rows 的 id 就是 ob.id;循環義務再帶 &period= 定位那一期)。
import { detailLink } from './ballInCourt.js'
import { isWarrantyObligation } from '../../supabase/functions/_shared/ballInCourtRules.ts'

export function periodLink(ob, period) {
  const base = detailLink('/deadlines', 'obligation', ob.id)
  return period && ob.id != null && ob.id !== '' ? `${base}&period=${encodeURIComponent(period.period_key)}` : base
}

export function setupLink(kind, ob, period) {
  if (kind === 'responsible' || kind === 'rule' || kind === 'timing') return detailLink('/requirements/review', 'highlight', ob.id)
  if (kind === 'review') return periodLink(ob, period)
  if (kind === 'stop') return detailLink(isWarrantyObligation(ob) ? '/requirements' : '/deadlines', 'obligation', ob.id)
  return '/deadlines'
}
