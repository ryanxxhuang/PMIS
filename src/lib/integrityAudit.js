// 文件勾稽鏈稽核:逐工項跨文件對帳(估驗 ↔ 施工日誌 ↔ 查驗 ↔ 試體),標出「對不起來」之處。
// ── 全確定性 ──：錢與稽核的發現不能靠 AI 幻覺或漏抓,一律以精確數字/邏輯比對得出;
// AI 只負責把這些確定性發現寫成稽核意見與建議(見 edge fn audit-summary),不參與判定。
//
// join key = item_key(估驗/日誌皆以此為鍵);查驗以 work_item_id→item_key 對應;
// 試體無工項欄位,以「取樣日(=澆置日)」與施工日誌的混凝土澆置日對帳。
//
// 2026-07-26 收斂:混凝土工項的判定從「description 含『混凝土』」改為 isConcretePourItem()
// (含『混凝土』且不含模板/打鑿等排除詞)。此前「場鑄結構混凝土用模板」等非澆置工項會被
// 當成澆置工項,只做模板的日子被算進澆置日,產生假的「澆置無試體」發現——這是刻意修正,
// 部分既有發現會因此消失,不是回歸。

const fmtQ = (n) => (n == null || isNaN(n) ? '0' : Number(n).toLocaleString('en-US'))

// 是否為混凝土澆置工項(試體/澆置日的對應依據)。
// 「含混凝土」太寬:場鑄結構「混凝土」用模板、混凝土「打鑿」等都會誤中,
// 模板不會有試體、只做模板的日子也不是澆置日——誤判會產生假的「澆置無試體」
// 稽核發現,對機關端的公信力傷害大於漏抓。
// 排除詞依據(src/data/workItems.json 實際出現的品項 + 常見非澆置作業):
// - 模板:場鑄結構混凝土用模板(普通/清水/金屬浪板底模)、混凝土模板及附屬品支撐施工架
// - 打鑿/鑽孔/切割/拆除/表面處理/養護:混凝土的後續處理作業,非澆置
//   (資料中有「混凝土表面處理,地坪整體粉光處理」;「混凝土模板…組立及拆除」)
// - 預鑄:外牆預鑄清水混凝土造形(窗花)——廠製構件現場安裝,無現場澆置
// - 附屬品:混凝土附屬品,保麗龍——材料,非澆置
// - 地磚:透水性混凝土地磚——預製品鋪設,無取樣試體
// - 圍籬:施工圍籬…(含地坪混凝土鋪設)——假設工程使用費,附帶鋪設非結構澆置
// 兩邊同步:supabase/functions/_shared/integrityAudit.ts 有逐行等價的移植版。
const CONCRETE_EXCLUDES = ['模板', '打鑿', '鑽孔', '切割', '拆除', '表面處理', '養護', '預鑄', '附屬品', '地磚', '圍籬']
export function isConcretePourItem(description) {
  const d = description || ''
  return d.includes('混凝土') && !CONCRETE_EXCLUDES.some((w) => d.includes(w))
}
// 估驗超過日誌 5% 以上才算超計(容忍量測/進位誤差)。
// export:估驗頁佐證欄的差異警示(lib/evidence.js)共用同一容忍值,兩邊判定不可分裂。
export const OVER_TOL = 1.05

const nameOf = (it) => `${it.item_no || ''} ${it.description || ''}`.trim()
const few = (arr, f, n = 3) => arr.slice(0, n).map(f).join('、') + (arr.length > n ? ` 等 ${arr.length} 項` : '')

// leaves: 可計價末端工項 [{item_key,item_no,description,unit,quantity}]
// loggedQty/billedQty: Map(item_key -> 累計數量);inspStatusByItem: Map(item_key -> 最近查驗狀態)
// pourDates: [{date}] 有混凝土澆置的施工日誌日期;testSamples: [{sampled_date,status,sample_no}]
export function buildIntegrityFindings({
  leaves = [], loggedQty, billedQty, inspStatusByItem, pourDates = [], testSamples = [],
} = {}) {
  const lg = loggedQty || new Map()
  const bd = billedQty || new Map()
  const insp = inspStatusByItem || new Map()
  const findings = []
  const billed = leaves.filter((it) => (bd.get(it.item_key) || 0) > 0)

  // 1. 估驗超前施工日誌(可能超計)
  const over = billed
    .map((it) => ({ it, b: bd.get(it.item_key) || 0, l: lg.get(it.item_key) || 0 }))
    .filter((o) => o.l > 0 && o.b > o.l * OVER_TOL)
  if (over.length) findings.push({
    status: 'risk', category: '估驗勾稽', route: '/valuation',
    title: `估驗超前施工日誌:${over.length} 項工項`,
    detail: `下列工項累計估驗量高於施工日誌累計完成量逾 5%,可能超計,建議查核完成佐證後再計價:`
      + few(over, (o) => `${nameOf(o.it)}(估驗 ${fmtQ(o.b)} > 日誌 ${fmtQ(o.l)})`) + '。',
  })

  // 2. 估驗無施工日誌數量佐證
  const noLog = billed.filter((it) => (lg.get(it.item_key) || 0) === 0)
  if (noLog.length) findings.push({
    status: 'warn', category: '估驗勾稽', route: '/valuation',
    title: `估驗無施工日誌佐證:${noLog.length} 項工項`,
    detail: `下列工項已列入估驗,但施工日誌無對應完成數量,建議補登日誌或確認計價依據:`
      + few(noLog, nameOf) + '。',
  })

  // 3. 查驗不合格仍計價
  const failBilled = billed.filter((it) => insp.get(it.item_key) === '不合格')
  if (failBilled.length) findings.push({
    status: 'risk', category: '品質勾稽', route: '/quality',
    title: `查驗不合格工項仍計價:${failBilled.length} 項`,
    detail: `下列工項最近一次查驗為不合格卻已列入估驗,應先完成改善複查合格再計價:`
      + few(failBilled, nameOf) + '。',
  })

  // 4. 混凝土澆置未見取樣試體(該取樣未取樣)
  const sampleDates = new Set(testSamples.map((s) => s.sampled_date))
  const missPour = pourDates.filter((p) => !sampleDates.has(p.date))
  if (missPour.length) findings.push({
    status: 'risk', category: '該查未查', route: '/quality',
    title: `混凝土澆置未見取樣試體:${missPour.length} 日`,
    detail: `施工日誌顯示下列日期有混凝土澆置,但查無對應取樣日之抗壓試體紀錄,恐未落實三級品管:`
      + missPour.slice(0, 4).map((p) => p.date).join('、') + (missPour.length > 4 ? ` 等 ${missPour.length} 日` : '') + '。',
  })

  // 5. 混凝土試體強度不合格
  const failedSamples = testSamples.filter((s) => s.status === '不合格')
  if (failedSamples.length) findings.push({
    status: 'risk', category: '品質勾稽', route: '/quality',
    title: `混凝土試體強度不合格:${failedSamples.length} 組`,
    detail: `下列試體抗壓強度未達設計要求,須評估對應構件之處置及對已計價工項之影響:`
      + failedSamples.slice(0, 3).map((s) => s.sample_no || s.sampled_date).join('、') + '。',
  })

  // 6. 接近完成卻未申請查驗(該查未查)
  const nearDone = leaves.filter((it) => {
    const q = it.quantity || 0, b = bd.get(it.item_key) || 0
    return q > 0 && b / q >= 0.8 && !insp.has(it.item_key)
  })
  if (nearDone.length) findings.push({
    status: 'warn', category: '該查未查', route: '/quality',
    title: `接近完成未申請查驗:${nearDone.length} 項工項`,
    detail: `下列工項累計完成已達 8 成以上,但尚無任何查驗申請紀錄,建議監造要求申請查驗:`
      + few(nearDone, nameOf) + '。',
  })

  const summary = {
    risk: findings.filter((f) => f.status === 'risk').length,
    warn: findings.filter((f) => f.status === 'warn').length,
    checked: billed.length,
  }
  return { findings, summary }
}
