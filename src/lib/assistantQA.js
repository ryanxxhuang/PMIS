// AI 助理 — 陽春版專案問答（確定性關鍵字比對，無需後端；demo/real 都能答）。
// 學問只在「本案自己的資料＋契約」，答案一律附出處連結。刻意唯讀、不做動作。
// 回傳 { answer, sources:[{label,to}] } 或 null（不會答 → UI 導引）。
import { computeObligationDue } from './contractDue.js'
import { pendingSamplesFromLogs } from './qc.js'
import { isRainyLog } from './weatherMetrics.js'

const money = (n) => `NT$ ${Math.round(n || 0).toLocaleString('en-US')}`
const has = (q, ...ks) => ks.some((k) => q.includes(k))

const INTENTS = [
  // 進度
  (q, d) => has(q, '進度', '落後', '超前', 's曲線', 'ｓ曲線', '趕工') && d.progress ? {
    answer: d.progress.plannedPct == null
      ? `目前累計實際進度 ${d.progress.actualPct.toFixed(1)}%（尚未設定預定進度）。`
      : (() => { const b = d.progress.plannedPct - d.progress.actualPct
          return `累計實際進度 ${d.progress.actualPct.toFixed(1)}%、預定 ${d.progress.plannedPct.toFixed(1)}%，` +
            (b > 2 ? `落後 ${b.toFixed(1)}%。建議檢視要徑工項、研擬趕工或工期展延。` : b < -2 ? `超前 ${(-b).toFixed(1)}%，進度受控。` : '大致符合預定進度。') })(),
    sources: [{ label: '進度 S 曲線', to: '/progress' }],
  } : null,

  // 缺失
  (q, d) => has(q, '缺失', '瑕疵') ? (() => {
    const open = (d.defects || []).filter((x) => x.status !== '已結案')
    return {
      answer: open.length === 0
        ? `目前沒有未結案缺失，共 ${(d.defects || []).length} 件皆已結案。`
        : `未結案缺失 ${open.length} 件（總計 ${(d.defects || []).length} 件）：${open.slice(0, 5).map((x) => `${x.title}（${x.status}）`).join('、')}。`,
      sources: [{ label: '品質查驗', to: '/quality' }],
    }
  })() : null,

  // 查驗
  (q, d) => has(q, '查驗', '檢驗') && !has(q, '該查') ? (() => {
    const pend = (d.inspections || []).filter((x) => x.status === '待查驗')
    return { answer: `查驗紀錄共 ${(d.inspections || []).length} 筆，待查驗 ${pend.length} 筆${pend.length ? `：${pend.slice(0, 4).map((x) => x.title).join('、')}` : ''}。`,
      sources: [{ label: '品質查驗', to: '/quality' }] }
  })() : null,

  // 該查未查 / 取樣試體
  (q, d) => has(q, '該查', '取樣', '試體', '抗壓', '混凝土', '強度') ? (() => {
    const pending = pendingSamplesFromLogs(d.siteLogs || [], d.testSamples || [])
    return { answer: pending.length
      ? `偵測到 ${pending.length} 筆混凝土澆置尚未建立取樣試體（${pending.slice(0, 3).map((p) => p.sampled_date).join('、')}${pending.length > 3 ? '…' : ''}），建議補建並排 7／28 天齡期試驗。`
      : `施工日誌中的混凝土澆置都已建立對應試體，沒有漏取樣。`,
      sources: [{ label: '品質查驗', to: '/quality' }] }
  })() : null,

  // 估驗 / 請款 / 收款 / 現金流
  (q, d) => has(q, '估驗', '計價', '請款', '收款', '現金', '應領', '撥款') ? (() => {
    const f = d.finance || {}
    const unpaid = (d.valuations || []).filter((v) => v.status === '已核定' && v.invoice_date && !v.paid_date)
    const parts = []
    if (f.actualCum != null) parts.push(`累計估驗 ${money(f.actualCum)}${f.billableTotal ? `（占發包 ${((f.actualCum / f.billableTotal) * 100).toFixed(1)}%）` : ''}`)
    parts.push(`估驗共 ${(d.valuations || []).length} 期`)
    if (unpaid.length) parts.push(`其中第 ${unpaid.map((v) => v.period_no).join('、')} 期已請款未收款`)
    return { answer: parts.join('，') + '。', sources: [{ label: '估驗計價', to: '/valuation' }, { label: '請款收款', to: '/payments' }] }
  })() : null,

  // 變更設計
  (q, d) => has(q, '變更', '追加', '減帳') ? (() => {
    const cos = d.changeOrders || []
    const approved = cos.filter((c) => c.status === '核准')
    const pending = cos.filter((c) => c.status === '審核中' || c.status === '提出')
    const net = (list) => list.reduce((s, c) => s + (c.items || []).reduce((a, it) => a + (Number(it.amount_delta) || 0), 0), 0)
    return { answer: cos.length === 0 ? '目前沒有變更設計。'
      : `變更設計共 ${cos.length} 件：已核准 ${approved.length} 件（淨額 ${money(net(approved))}）、待核定 ${pending.length} 件（淨額 ${money(net(pending))}）。`,
      sources: [{ label: '變更設計', to: '/change-orders' }] }
  })() : null,

  // 待辦 / 球在誰手上
  (q, d) => has(q, '待辦', '該我', '待我', '球', '待處理', '處理的', '要做什麼') ? {
    answer: (d.myItems || []).length
      ? `目前有 ${d.myItems.length} 件事在你手上：${d.myItems.slice(0, 5).map((x) => `${x.tag}·${x.meta}`).join('、')}。`
      : '目前沒有待你處理的協作項，都跟上了。',
    sources: [{ label: '專案 Dashboard', to: '/dashboard' }, { label: '提醒中心', to: '/alerts' }],
  } : null,

  // 天氣 / 雨天
  (q, d) => has(q, '天氣', '雨天', '下雨', '氣候') ? (() => {
    const logs = d.siteLogs || []
    const rain = logs.filter(isRainyLog) // 與兩份報表同源
    return { answer: `近期 ${logs.length} 筆施工日誌中有 ${rain.length} 天出現降雨${rain.length ? `（${rain.slice(0, 5).map((l) => l.log_date).join('、')}）` : ''}。雨天天數可作為工期展延佐證。`,
      sources: [{ label: '施工日誌', to: '/site-log' }] }
  })() : null,

  // 工期 / 開工 / 竣工
  (q, d) => has(q, '工期', '開工', '竣工', '完工', '幾天') && d.project ? {
    answer: `本案 ${d.project.project_name}：開工 ${d.project.start_date || '—'}、預定竣工 ${d.project.end_date || '—'}。` +
      (d.anchors?.commencement_date ? `開工基準日 ${d.anchors.commencement_date}。` : ''),
    sources: [{ label: '契約管制', to: '/contract' }],
  } : null,

  // 契約 / 罰則 / 保固 / 保險（先做關鍵字搜義務，再退回最近到期）
  (q, d) => has(q, '契約', '罰則', '保固', '保證', '保險', '義務', '到期', '期限', '違約') ? (() => {
    const obs = d.obligations || []
    const kw = ['保固', '保證', '保險', '罰則', '違約', '展延', '估驗', '竣工', '開工'].find((k) => q.includes(k))
    const hit = kw ? obs.filter((o) => `${o.title}${o.penalty || ''}${o.category || ''}`.includes(kw)) : []
    if (hit.length) return { answer: hit.slice(0, 3).map((o) => `${o.title}${o.source_clause ? `（${o.source_clause}）` : ''}${o.penalty ? `，罰則：${o.penalty}` : ''}`).join('；') + '。',
      sources: [{ label: '契約管制', to: '/contract' }] }
    // 沒關鍵字命中 → 列最近到期義務
    const dated = obs.map((o) => ({ o, due: computeObligationDue(o, d.anchors || {}) })).filter((x) => x.due && x.o.status !== '已完成')
      .sort((a, b) => a.due - b.due)
    return { answer: dated.length
      ? `最近的契約義務：${dated.slice(0, 3).map((x) => `${x.o.title}（到期 ${x.due.toISOString().slice(0, 10)}）`).join('、')}。`
      : `契約義務清單共 ${obs.length} 項，可到契約管制查看時程與罰則。`,
      sources: [{ label: '契約管制', to: '/contract' }] }
  })() : null,
]

export function answerQuestion(question, data = {}) {
  const q = (question || '').trim().toLowerCase()
  if (!q) return null
  for (const intent of INTENTS) {
    const r = intent(q, data)
    if (r) return r
  }
  return null
}

// 建議問句（點了直接問）。第一句刻意用「彙整」——展示 copilot 的跨模組摘要能力。
export const SUGGESTED_QUESTIONS = [
  '幫我彙整目前狀況、待辦與下一步',
  '現在有什麼待我處理的？',
  '有什麼快逾期或要注意的？',
  '目前進度落後多少？',
  '有哪些未結案缺失？',
  '第幾期估驗還沒收款？',
  '有沒有澆置沒取樣的？',
  '契約有什麼罰則要注意？',
]
