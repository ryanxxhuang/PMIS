// Ball-in-court:每個協作項目「現在等誰處理」。學自 Procore——全平台一致的
// 責任語言,任何人打開都知道球在誰手上、該催誰。
//
// 判定規則只有一份,住在 supabase/functions/_shared/ballInCourtRules.ts(P5a):首頁今日工作、
// Agent 工具與每日早報都 import 同一支;這裡只負責前端獨有的部分——每個事項該導去哪一頁。
// 共用案例:tests/fixtures/ball-in-court.cases.json(Vitest 前端路徑／Edge 路徑與 Deno 同讀)。
// who 為 contractor / supervisor / owner / unassigned(責任推不出三方 → 待補設定)/ done。
import { coreOpenItems } from '../../supabase/functions/_shared/ballInCourtRules.ts'

export {
  rfiBall, submittalBall, valuationBall, changeOrderBall, defectBall, inspectionBall, observationBall,
  BALL_SIDES, UNASSIGNED, coreOpenItems,
} from '../../supabase/functions/_shared/ballInCourtRules.ts'

// 估驗該去哪一頁完成:送審與核定在估驗頁,請款日與收款日都在請款收款頁。
// 原本以「球在機關」判斷,結果廠商的「待廠商請款」被導到估驗頁——那頁沒有請款日欄位,
// 使用者點進去找不到可做的事(W8-2A §1.4-1)。事項的 meta 就是 valuationBall 的 label。
const VALUATION_PAGE_LABELS = new Set(['待廠商送審', '待監造核定'])
const valuationRoute = (label) => (VALUATION_PAGE_LABELS.has(label) ? '/valuation' : '/payments')

// 有「清單＋詳情」殼的頁(useListDetailPane)吃單條 query 就直接選中那一筆(規範 §9.7):
// 收件匣點進去要落在該筆的詳情,不是落在頁首再找一次。query 名以各頁
// useListDetailPane({ param }) 為準、值是該頁 rows[].id(這幾頁的 rows 就是 store 的
// rfis / submittals / changeOrders / obligations,id 同一個欄位),這裡不另立對照表。
// id 缺值(demo 舊形狀、尚未寫回 DB 的列)退回頁面連結——?rfi=null 是殼找不到列的死連結。
export function detailLink(page, param, id) {
  return id == null || id === '' ? page : `${page}?${param}=${encodeURIComponent(id)}`
}

// tag → 目的頁與單條 query 名。缺失追蹤已套殼(DefectTracker,規範 §9.8):?defect=<id> 在
// /safety(工安)與 /quality(品質,頁面依這個 query 自動切到「缺失」分段)都直達該筆。
// 現場文書:/site?doc=<id>(D-026 §1 登記的直達參數;P2c 接文件頁後即定位該份)。
const ROUTE_BY_TAG = {
  疑義: ['/rfi', 'rfi'], 送審: ['/submittals', 'submittal'], 查驗: ['/quality', 'inspection'],
  缺失: ['/quality', 'defect'], 工安缺失: ['/safety', 'defect'], 觀察: ['/quality', 'observation'],
  變更: ['/change-orders', 'co'], 現場文書: ['/site', 'doc'],
}
function routeOf(item) {
  if (item.tag === '估驗') return detailLink(valuationRoute(item.meta), 'period', item.id)
  const [page, param] = ROUTE_BY_TAG[item.tag] || ['/dashboard', 'id']
  return detailLink(page, param, item.id)
}

// 全案未結協作項(不分角色):{ id, who, tag, title, meta(=ball.label), to, due }。
// myOpenItems 與今日工作聚合(todayTasks.js)共用這一份組裝——「哪些協作項算未結、
// 標題怎麼組」由共用規則決定,「要導去哪一頁」只在這裡決定,不會首頁一套、Agent 一套。
export function collaborationItems(data = {}) {
  return coreOpenItems(data).map((it) => ({
    id: it.id, who: it.who, tag: it.tag, title: it.title, meta: it.meta, due: it.due, to: routeOf(it),
    ...(it.doc_type ? { doc_type: it.doc_type } : {}),
    ...(it.setup ? { setup: it.setup } : {}),
  }))
}

// 「球在你手上」逐案清單:回傳指定角色(org_type)目前該處理的協作項。
// 形狀沿用 { who, tag, title, meta, to }(assistantFacts 的「待我處理」吃這個),
// 另附 id/due 供新的待辦聚合排序用。
export function myOpenItems(org, data = {}) {
  return collaborationItems(data).filter((x) => x.who === org)
}
