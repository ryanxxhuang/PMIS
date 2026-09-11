// Ball-in-court:每個協作項目「現在等誰處理」。學自 Procore——全平台一致的
// 責任語言,任何人打開都知道球在誰手上、該催誰。
// who 通常為 contractor / supervisor / owner / done;觀察事項 assigned_to 可為自由文字,聚合時再過濾。

export function rfiBall(r) {
  if (r.status === '待回覆') return { who: 'supervisor', label: '待監造/設計回覆' }
  if (r.status === '已回覆') return { who: 'contractor', label: '待廠商確認結案' }
  return { who: 'done', label: '已結案' }
}

export function submittalBall(s) {
  if (s.status === '已提送' || s.status === '審核中') return { who: 'supervisor', label: '待監造審定' }
  if (s.status === '退回補正') return { who: 'contractor', label: '待廠商補正' }
  return { who: 'done', label: s.status } // 核准 / 核備 / 駁回
}

export function valuationBall(v) {
  if (v.status === '草稿') return { who: 'contractor', label: '待廠商送審' }
  if (v.status === '監造審核') return { who: 'supervisor', label: '待監造核定' }
  if (!v.invoice_date) return { who: 'contractor', label: '待廠商請款' }
  if (!v.paid_date) return { who: 'owner', label: '待機關撥款' } // 已請款 → 球在機關撥款
  return { who: 'done', label: '已撥款' }
}

export function changeOrderBall(co) {
  if (co.status === '提出') return { who: 'supervisor', label: '待監造審查' }
  if (co.status === '審核中') return { who: 'owner', label: '待機關核定' }
  return { who: 'done', label: co.status } // 核准 / 駁回
}

export function defectBall(d) {
  if (d.status === '已結案') return { who: 'done', label: '已結案' }
  if (d.status === '待複查') return { who: 'supervisor', label: '待監造複查' }
  // 開立/改善中分開標示:按「開始改善」後仍顯示「待廠商改善」會讓
  // 畫面標籤與實際狀態對不上(第二輪 P2-01)
  if (d.status === '改善中') return { who: 'contractor', label: '廠商改善中' }
  return { who: 'contractor', label: '待廠商改善' } // 開立
}

export function inspectionBall(i) {
  if (i.status === '待查驗') return { who: 'supervisor', label: '待監造查驗' }
  return { who: 'done', label: i.status } // 合格 / 不合格
}

function observationBall(o) {
  if (o.status === '待處理') return { who: o.assigned_to || 'contractor', label: '待處理' }
  return { who: 'done', label: o.status } // 已處理 / 轉缺失
}


// 估驗該去哪一頁完成:送審與核定在估驗頁,請款日與收款日都在請款收款頁。
// 原本以「球在機關」判斷,結果廠商的「待廠商請款」被導到估驗頁——那頁沒有請款日欄位,
// 使用者點進去找不到可做的事(W8-2A §1.4-1)。
const VALUATION_PAGE_LABELS = new Set(['待廠商送審', '待監造核定'])
function valuationRoute(v) {
  return VALUATION_PAGE_LABELS.has(valuationBall(v).label) ? '/valuation' : '/payments'
}

// 有「清單＋詳情」殼的頁(useListDetailPane)吃單條 query 就直接選中那一筆(規範 §9.7):
// 收件匣點進去要落在該筆的詳情,不是落在頁首再找一次。query 名以各頁
// useListDetailPane({ param }) 為準、值是該頁 rows[].id(這幾頁的 rows 就是 store 的
// rfis / submittals / changeOrders / obligations,id 同一個欄位),這裡不另立對照表。
// id 缺值(demo 舊形狀、尚未寫回 DB 的列)退回頁面連結——?rfi=null 是殼找不到列的死連結。
export function detailLink(page, param, id) {
  return id == null || id === '' ? page : `${page}?${param}=${encodeURIComponent(id)}`
}

// 全案未結協作項(不分角色):{ id, who, tag, title, meta(=ball.label), to, due }。
// myOpenItems 與今日待辦聚合(todayTasks.js)共用這一份組裝——「哪些協作項算未結、
// 標題怎麼組、要導去哪一頁」只有一個答案,不會首頁一套、Agent 一套。
export function collaborationItems(data = {}) {
  const { rfis = [], submittals = [], valuations = [], defects = [], inspections = [], observations = [], changeOrders = [] } = data
  const out = []
  const push = (ball, { id, tag, title, to, due = null }) => {
    if (ball.who === 'done') return
    out.push({ id: id ?? null, who: ball.who, tag, title: title || '（未命名）', meta: ball.label, to, due: due || null })
  }
  rfis.forEach((r) => push(rfiBall(r), {
    id: r.id, tag: '疑義', title: `${r.rfi_no ? r.rfi_no + ' ' : ''}${r.title || ''}`.trim(), to: detailLink('/rfi', 'rfi', r.id), due: r.due_date,
  }))
  submittals.forEach((s) => push(submittalBall(s), {
    id: s.id, tag: '送審', title: `${s.submittal_no ? s.submittal_no + ' ' : ''}${s.title || ''}`.trim(), to: detailLink('/submittals', 'submittal', s.id), due: s.due_date,
  }))
  valuations.forEach((v) => push(valuationBall(v), {
    id: v.id, tag: '估驗', title: `第 ${v.period_no} 期估驗`, to: valuationRoute(v),
  }))
  // 查驗/缺失/觀察的頁(/quality)還沒有殼;/safety 的殼是工安紀錄(?record=),缺失追蹤
  // 要等它套殼(規範 §9.8)才有單條 query——在那之前維持頁面連結,不帶對不上的 id。
  inspections.forEach((i) => push(inspectionBall(i), { id: i.id, tag: '查驗', title: i.title, to: '/quality' }))
  defects.forEach((d) => push(defectBall(d), {
    id: d.id, tag: d.domain === 'safety' ? '工安缺失' : '缺失', title: d.title,
    to: d.domain === 'safety' ? '/safety' : '/quality', due: d.due_date,
  }))
  observations.forEach((o) => push(observationBall(o), { id: o.id, tag: '觀察', title: o.title, to: '/quality' }))
  changeOrders.forEach((c) => push(changeOrderBall(c), {
    id: c.id, tag: '變更', title: `${c.co_no ? c.co_no + ' ' : ''}${c.title || ''}`.trim(), to: detailLink('/change-orders', 'co', c.id),
  }))
  return out
}

// 「球在你手上」逐案清單:回傳指定角色(org_type)目前該處理的協作項。
// 形狀沿用 { who, tag, title, meta, to }(assistantFacts 的「待我處理」吃這個),
// 另附 id/due 供新的待辦聚合排序用。
export function myOpenItems(org, data = {}) {
  return collaborationItems(data).filter((x) => x.who === org)
}
