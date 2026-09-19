// 估驗期別的缺件與檢核——單一口徑(D-026 P1b 移入、P4c 合併)。
//
// 三種來源、一份規則、一份輸出:
//   1. 缺件(block):DB 檢查點的違反清單(P4b `get_valuation_state.violations`,代碼見設計 §16.2)。
//      這是後端強制的「不能送審／核定／請款」,前端只翻成人話與處理入口,不自己判。
//   2. 勾稽(risk／warn):lib/integrityAudit.js 的六項跨文件對帳(估驗超前日誌、無日誌申報、查驗不合格
//      仍計價、澆置無試體、試體不合格、接近完成未查驗)。日誌申報量只作差異比對——它是「申報,未確認,
//      不計價」,不是計價依據;超前／無日誌兩種差異的判定與明細列的就地提示同一支 classifyLogDiff。
//   3. 逐工項標示(itemFlags):`get_valuation_state.items[].violations` 翻成列上的短標(缺監造確認來源、
//      歷史遷移需補證、計價依據待設定…),與 1 同一張對照表。
// P4c 之前決策列的「超計／無佐證」另有一份 valuationDiff.js(無日誌也算超計),與這裡的發現口徑不同,
// 已刪除;決策列改讀本檔 summary 的 overKeys／noLogKeys。
//
// 輸入形狀:adjustedItems(含已核准變更;「接近完成未查驗」以 b/q≥0.8 判定,q 用原契約量會拿舊分母)、
// childrenMap(buildBillableTree 的,只含可計價非合計列——刻意不換成 boqCalc.billableLeaves,兩把尺的差別
// 見該函式檔頭)、siteLogs、billedItems(檢核哪一期就傳哪一期的 items)、inspections、testSamples、
// state(get_valuation_state 回傳;demo／載入前為 null → 沒有缺件,不假裝通過)、idToKey(work_item uuid → item_key)。
import { buildIntegrityFindings, isConcretePourItem } from './integrityAudit.js'

// DB 檢查點違反代碼 → 人話與處理入口。action:
//   period_end 填計價截止日｜sync 同步確認量｜basis 設定計價依據(監造)｜certificate 監造確認單補證(監造)
//   review 監造退回後重算｜set 改回契約量內｜adjust 撤銷／調整流程(P4d)｜none 只能看
export const VIOLATION_TEXT = {
  period_end_missing: { label: '缺計價截止日', title: '計價截止日未填', hint: '送審／核定前必填:本期計價截至哪一天。', action: 'period_end' },
  recheck_required: { label: '需重算', title: '監造撤銷／減量確認後,本期需重算', hint: '送審中的數量不會自動改;由監造退回後按「同步確認量」以現況重算。', action: 'review' },
  pending_adjustment: { label: '待處理扣回', title: '本案有待處理的估驗調整(扣回)', hint: '已核定期的確認被撤銷後產生扣回;需先併入最早的草稿期(同步確認量),或由機關作廢。', action: 'sync' },
  over_contract: { label: '超契約量', title: '累計量超過契約量', hint: '契約量＝標單量＋核准變更;請先辦理變更或降回契約量內。', action: 'set' },
  not_billable: { label: '非計價工項', title: '非末端／非計價列有數量', hint: '只有發包末端工項可計價;此列數量不會被計入。', action: 'none' },
  basis_missing: { label: '計價依據待設定', title: '總價／間接費工項尚未設定計價依據', hint: '暫時隔離不計價(使用者 2026-09-17 決定);由監造設定計價依據後才進估驗。', action: 'basis' },
  basis_excluded: { label: '不由本系統計價', title: '此工項不由本系統計價', hint: '監造已把此工項設為不計價;數量不會計入。', action: 'none' },
  negative_delta: { label: '減量無扣回', title: '本期增量為負但沒有扣回來源', hint: '減量不能直接改數字;走撤銷確認→扣回的調整流程。', action: 'adjust' },
  source_mismatch: { label: '缺監造確認來源', title: '申報量未經監造確認', hint: '本期增量沒有對應的監造確認量,屬申報、未確認、不計價;按「同步確認量」以確認量為準(沒有確認即歸零)。', action: 'sync' },
  legacy_source: { label: '歷史遷移需補證', title: '數量來自歷史遷移,不是監造確認', hint: '舊資料遷移只記入已計價量;由監造簽發監造確認單補證後才可請款。', action: 'certificate' },
  cutoff: { label: '超過截止日有效量', title: '批次分配超過截止日前的有效確認量', hint: '確認日晚於本期計價截止日的量不能計入本期;調整截止日或重新同步。', action: 'period_end' },
  batch_over_allocated: { label: '批次超分配', title: '批次有效確認量少於已分配', hint: '缺必要查驗階段,或確認已撤銷／減量;需監造補查驗或重新同步。', action: 'sync' },
}

export function describeViolation(v = {}) {
  const t = VIOLATION_TEXT[v.code] || { label: v.code || '未知缺件', title: v.code || '未知缺件', hint: '', action: 'none' }
  return {
    code: v.code, label: t.label, title: t.title, hint: t.hint, action: t.action,
    message: v.message || '', work_item_id: v.work_item_id ?? null, batch_key: v.batch_key ?? null,
    missing_stages: Array.isArray(v.missing_stages) ? v.missing_stages : [],
  }
}

const nameOf = (it) => `${it.item_no || ''} ${it.description || ''}`.trim()
const few = (arr, n = 3) => arr.slice(0, n).join('、') + (arr.length > n ? ` 等 ${arr.length} 項` : '')

// 缺件分組:同代碼一項發現,列出涉及工項(人話)＋處理入口;期別層級代碼沒有工項。
function buildBlockFindings(violations, keyOf, itemOf) {
  const groups = new Map()
  for (const raw of violations || []) {
    const d = describeViolation(raw)
    if (!groups.has(d.code)) groups.set(d.code, { ...d, keys: [], names: [], messages: [] })
    const g = groups.get(d.code)
    const key = d.work_item_id ? keyOf(d.work_item_id) : null
    if (key != null && !g.keys.includes(key)) {
      g.keys.push(key)
      const it = itemOf(key)
      g.names.push(it ? nameOf(it) : key)
    }
    if (d.message && !g.messages.includes(d.message)) g.messages.push(d.message)
  }
  return [...groups.values()].map((g) => ({
    status: 'block', code: g.code, action: g.action, keys: g.keys,
    title: g.keys.length ? `${g.title}:${g.keys.length} 項工項` : g.title,
    detail: (g.keys.length ? `${few(g.names)}。` : '') + g.hint + (g.messages.length ? `(${g.messages[0]})` : ''),
  }))
}

export function buildValuationChecks({
  adjustedItems = [], childrenMap, siteLogs = [], billedItems = {}, inspections = [], testSamples = [],
  state = null, idToKey = null,
} = {}) {
  const kids = childrenMap || new Map()
  const byKey = new Map(adjustedItems.map((it) => [it.item_key, it]))
  const uuidToKey = idToKey || new Map(adjustedItems.filter((it) => it.id).map((it) => [it.id, it.item_key]))
  const keyOf = (uuid) => uuidToKey.get(uuid) ?? null
  const leaves = adjustedItems.filter((it) => it.is_billable && !it.is_rollup && !(kids.get(it.item_key)?.length))

  // 日誌:逐工項累加當日數量(item_key 為鍵)——申報量,只作差異比對
  const loggedQty = new Map()
  for (const lg of siteLogs) {
    for (const [k, q] of Object.entries(lg.items || {})) loggedQty.set(k, (loggedQty.get(k) || 0) + (Number(q) || 0))
  }
  // 估驗:指定期別的各工項累計數量
  const billedQty = new Map(Object.entries(billedItems || {}).map(([k, v]) => [k, Number(v) || 0]))
  // 查驗:inspections 已依 created_at desc → 每工項第一個=最近一次;work_item_id(uuid)→item_key
  const inspStatusByItem = new Map()
  for (const ins of inspections) {
    const key = keyOf(ins.work_item_id)
    if (key && !inspStatusByItem.has(key)) inspStatusByItem.set(key, ins.status)
  }
  // 混凝土澆置日:澆置工項(isConcretePourItem)當日數量 >0 的日誌日期
  const concreteKeys = new Set(leaves.filter((it) => isConcretePourItem(it.description)).map((it) => it.item_key))
  const pourSet = new Set()
  for (const lg of siteLogs) {
    if (lg.log_date && Object.entries(lg.items || {}).some(([k, q]) => concreteKeys.has(k) && (Number(q) || 0) > 0)) pourSet.add(lg.log_date)
  }

  const integrity = buildIntegrityFindings({
    leaves, loggedQty, billedQty, inspStatusByItem,
    pourDates: [...pourSet].map((date) => ({ date })), testSamples,
  })
  const blocks = buildBlockFindings(state?.violations, keyOf, (k) => byKey.get(k))

  // 逐工項標示(來自 state.items[].violations);有任何缺件的工項本期增量屬「未確認,不計價」
  const itemFlags = new Map()
  for (const it of state?.items || []) {
    const key = keyOf(it.work_item_id)
    if (key == null) continue
    const flags = (it.violations || []).map((v) => describeViolation({ ...v, work_item_id: it.work_item_id }))
    if (flags.length) itemFlags.set(key, flags)
  }
  const pick = (title) => integrity.findings.find((f) => f.title.startsWith(title))?.keys || []
  return {
    findings: [...blocks, ...integrity.findings],
    itemFlags,
    summary: {
      block: blocks.length,
      risk: integrity.summary.risk, warn: integrity.summary.warn, checked: integrity.summary.checked,
      overKeys: pick('估驗超前施工日誌'), noLogKeys: pick('估驗無施工日誌佐證'),
      unbackedKeys: [...itemFlags.keys()],
    },
  }
}
