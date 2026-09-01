// 契約重點 · 履約時程(/requirements 改版)的純函式層。
// 本頁唯一的權限規則是「三方可見範圍」+「動作只看歸屬」,全部收在這裡可測:
//   可見義務 = items.filter(r => VISIBLE[viewerParty].includes(r.who))
//   可操作   = item.who === viewerParty(與角色無關,只看歸屬)
// ⚠️ VISIBLE 是前端的展示過濾(shim):目標契約是後端依登入身分回傳已過濾
// 集合並附 canAct 旗標(RLS/view),前端不做權限判斷——屆時整張表刪除、
// 這裡只剩推導函式。在那之前 contract_obligations 的 RLS 仍是全案成員可讀,
// 這份過濾只是版面歸屬,不是安全邊界,不可反過來依賴它保密。
import { computeObligationDue, formatObligationRule } from './contractDue.js'
import { parseLocalDate, localISODate, taipeiISODate } from './dates.js'
import { REQUIREMENT_TYPE_LABELS, sourcePageLabel } from './requirementReview.js'

export const PARTIES = ['廠商', '監造', '機關']
export const ORG_TO_PARTY = { contractor: '廠商', supervisor: '監造', owner: '機關' }

// 責任方標示(README 2.2):icon + 卡片左緣標示色。色值走全站 token——
// 廠商=主色藍、監造=注意橘(--accent 即 #a05a00)、機關=綠(--success 即 #146c2e)。
export const PARTY_META = {
  廠商: { icon: 'engineering', mark: 'var(--primary)' },
  監造: { icon: 'checklist', mark: 'var(--accent)' },
  機關: { icon: 'account_balance', mark: 'var(--success)' },
}

// 誰看得到誰的執行情形(README 1)。廠商只看自己;監造看自己+廠商;機關看全部。
export const VISIBLE = { 廠商: ['廠商'], 監造: ['監造', '廠商'], 機關: ['廠商', '監造', '機關'] }

// 頁首副標(README 2.1,依角色換文案;標點照設計稿)
export const PARTY_BLURB = {
  廠商: 'AI 已讀完契約與規範,把你要遵守的每一條排到時程上——從開工第一天到保固期滿,什麼時候該做什麼、依據哪一條,都在這裡。',
  監造: 'AI 已讀完契約與規範,逐條排到時程上。這裡可以看到你自己與廠商的履約執行情形。',
  機關: 'AI 已讀完契約與規範,逐條排到時程上。這裡可以一次看到廠商與監造的履約執行情形。',
}

// 五色語意(README:紅=逾期、黃=7日內、藍=排程中、綠=已完成、灰=未觸發)。
// badge 對應 ui.jsx 的 Badge color;dot 是圓點/時間軸節點色(走 token,深色自動跟上)。
export const OB_STATUS = {
  overdue: { label: '已逾期', badge: 'red', dot: 'var(--danger)' },
  due: { label: '即將到期', badge: 'amber', dot: 'var(--accent)' },
  scheduled: { label: '排程中', badge: 'blue', dot: 'var(--primary)' },
  done: { label: '已完成', badge: 'green', dot: 'var(--success)' },
  na: { label: '無需處理', badge: 'slate', dot: 'var(--chart-today)' },
}
export const STATUS_KEYS = ['overdue', 'due', 'scheduled', 'done', 'na']

// 頻率標籤(README 2.4):單次義務不顯示。值域對齊 contract_obligations.recurring。
const KIND_LABELS = {
  daily: '每日循環', weekly: '每週循環', monthly: '每月循環', quarterly: '每季循環', yearly: '每年循環',
}

export const PHASES = [
  { key: 'pre', name: '開工前' },
  { key: 'start', name: '開工後 30 日內' },
  { key: 'build', name: '施工期間' },
  { key: 'finish', name: '完工與驗收' },
  { key: 'warranty', name: '保固期' },
]

const today0 = (base) => {
  const d = base ? new Date(base) : new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
const addDays = (d, n) => {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export const obligationParty = (ob) => (PARTIES.includes(ob?.responsible) ? ob.responsible : '廠商')

// 狀態推導:已提送/已完成=done;推不出到期日(基準日未定/條件未觸發)=na;
// 逾期<0、7 日內=due,其餘排程中——7 日門檻與 contractDue 的 soon 同一套帳。
export function deriveStatus(ob, anchors, today) {
  const done = ob.status === '已提送' || ob.status === '已完成'
  const due = computeObligationDue(ob, anchors || {}, today)
  if (done) return { key: 'done', due, diff: null }
  if (!due) return { key: 'na', due: null, diff: null }
  const diff = Math.round((due - today0(today)) / 86400000)
  return { key: diff < 0 ? 'overdue' : diff <= 7 ? 'due' : 'scheduled', due, diff }
}

// 倒數文案(README 2.4)
export function countdownLabel(statusKey, diff) {
  if (statusKey === 'done') return '已完成'
  if (statusKey === 'na') return '未觸發'
  if (diff == null) return ''
  if (diff < 0) return `逾期 ${-diff} 日`
  if (diff === 0) return '今天到期'
  if (diff < 60) return `還有 ${diff} 日`
  if (diff < 730) return `還有 ${Math.round(diff / 30)} 個月`
  return `還有 ${(diff / 365).toFixed(1)} 年`
}

// 期程分段:category 是主要依據;「施工中」再依到期日切出「開工後 30 日內」。
export function phaseOf(ob, due, anchors) {
  const cat = String(ob.category || '').trim()
  if (cat === '開工前') return 'pre'
  if (cat === '完工') return 'finish'
  if (cat === '保固') return 'warranty'
  const start = parseLocalDate(anchors?.commencement_date)
  if (start && due && due >= start && due <= addDays(start, 30)) return 'start'
  return 'build'
}

// 期程段的日期範圍與「今天」落點。里程碑缺哪段就顯示 —,不臆測日期。
export function phaseWindows(anchors, warrantyEnd, today) {
  const start = parseLocalDate(anchors?.commencement_date)
  const award = parseLocalDate(anchors?.award_date)
  const end = parseLocalDate(anchors?.end_date)
  const d30 = start ? addDays(start, 30) : null
  const iso = localISODate
  const ranges = {
    pre: start ? `${award ? `${iso(award)} – ` : '– '}${iso(addDays(start, -1))}` : '—',
    start: start ? `${iso(start)} – ${iso(d30)}` : '—',
    build: start ? `${iso(addDays(d30, 1))}${end ? ` – ${iso(end)}` : ' 起'}` : '—',
    finish: end ? `${iso(end)} 起` : '—',
    warranty: warrantyEnd ? `– ${iso(warrantyEnd)}` : end ? `${iso(end)} 後` : '—',
  }
  const t = today0(today)
  let nowPhase = null
  if (start) {
    if (t < start) nowPhase = 'pre'
    else if (t <= d30) nowPhase = 'start'
    else if (!end || t <= end) nowPhase = 'build'
    else if (warrantyEnd && t > warrantyEnd) nowPhase = null
    else if (t <= addDays(end, 90)) nowPhase = 'finish'
    else nowPhase = 'warranty'
  }
  return { ranges, nowPhase, milestones: { start, completion: end, warrantyEnd: warrantyEnd || null } }
}

// 履約執行卡的統計(README 2.2)。統計數字之和必須等於該方義務總數——
// 這張卡是稽核數字。準時率=應完成項準時率(handoff 待確認問題 3 的定案):
//   分母 settled = 已完成 + 已逾期(未到期與無需處理不計)
//   分子 onTime  = 準時完成(完成時間 ≤ 到期日;見 buildTimelineItem 的 onTime)
// 遲交補完成的項目永遠留在分母、不進分子——補完成不再灌高比率。
export function partyStat(items) {
  const n = { overdue: 0, due: 0, scheduled: 0, done: 0, na: 0 }
  let onTime = 0
  for (const it of items) {
    n[it.status]++
    if (it.status === 'done' && it.onTime !== false) onTime++
  }
  const settled = n.done + n.overdue
  const rate = settled ? Math.round((onTime / settled) * 100) : null
  return { total: items.length, n, settled, onTime, rate }
}

// 期程段摘要(README 2.3):文案優先序 逾期 → 即將到期 → 全部完成 → 排程中。
// tone/track 回語意鍵,顏色由版面層對應 token。
export function phaseStat(poolItems, phaseKey, nowPhase) {
  const all = poolItems.filter((it) => it.phase === phaseKey)
  const bad = all.filter((it) => it.status === 'overdue').length
  const soon = all.filter((it) => it.status === 'due').length
  const done = all.filter((it) => it.status === 'done').length
  const note = !all.length ? '無義務'
    : bad ? `${all.length} 項 · ${bad} 項逾期`
      : soon ? `${all.length} 項 · ${soon} 項即將到期`
        : done === all.length ? `${all.length} 項 · 全部完成`
          : `${all.length} 項 · 排程中`
  const tone = bad ? 'danger' : soon ? 'warn' : 'muted'
  const track = !all.length ? 'empty' : bad ? 'danger' : done === all.length ? 'ok'
    : phaseKey === nowPhase ? 'accent' : 'muted'
  return { total: all.length, note, tone, track }
}

// 預設選中(README 3):第一條已逾期 → 第一條即將到期 → 清單第一條
export function pickDefaultId(items) {
  const first = items.find((it) => it.status === 'overdue')
    || items.find((it) => it.status === 'due') || items[0]
  return first?.id ?? null
}

// 基準日缺口:可見義務裡有幾條是「觸發點對應的基準日沒設」才推不出到期日。
// 只算 status='na' 且觸發點映得到錨點欄位的項目——fixed(日期在自己身上)、
// 循環配置完整(從今天推)、無觸發點(本來就無時點)都不是被基準日卡住,不算。
// 供履約時程頁的「設定基準日」提示與初始化清單引用:數字必須對得上使用者
// 設完基準日後「多出幾條有日期」的實際變化,不可虛報。
export const ANCHOR_LABELS = {
  award_date: '決標日', notice_date: '接獲開工通知日',
  commencement_date: '開工日', end_date: '竣工日',
}
const TRIGGER_ANCHOR = {
  award: 'award_date', notice: 'notice_date',
  commencement: 'commencement_date', completion: 'end_date',
}
export function anchorGaps(items, anchors) {
  const counts = {}
  for (const it of items) {
    if (it.status !== 'na') continue
    const key = TRIGGER_ANCHOR[it.ob?.trigger_event]
    if (!key || anchors?.[key]) continue
    counts[key] = (counts[key] || 0) + 1
  }
  // 依 ANCHOR_LABELS 的固定順序輸出,提示文案不因資料順序跳動
  const gaps = Object.keys(ANCHOR_LABELS)
    .filter((key) => counts[key])
    .map((key) => ({ key, label: ANCHOR_LABELS[key], count: counts[key] }))
  return { total: gaps.reduce((sum, g) => sum + g.count, 0), gaps }
}

// 動作權限與角色無關,只看歸屬(README 1)。伺服器同一條規則:
// contract_obligations 的 update 政策=自己方(或 admin override)才能改
// (migration 20260825120000);呼叫端要放行 override 時自行 OR 上 can.override。
// 目標契約是後端逐筆回 canAct,屆時這裡改讀旗標。
export const canActOn = (item, viewerParty) => item.who === viewerParty

// 把 contract_obligations 列 + (選配)關聯 requirement/出處,組成本頁的檢視模型。
// requirement 缺席(demo/人工補登)時全部欄位退回義務列自身,不臆測內容。
export function buildTimelineItem(ob, { requirement, sources, versionsById, anchors, today } = {}) {
  const { key: status, due, diff } = deriveStatus(ob, anchors, today)
  const phase = phaseOf(ob, due, anchors)
  const src = (sources || [])[0] || null
  const version = src?.document_version_id ? versionsById?.get(src.document_version_id) : null
  const who = obligationParty(ob)
  const clause = src?.clause || ob.source_clause || ''
  const page = src ? (src.page_label || sourcePageLabel(src)) : (ob.source_page || '')
  const type = requirement
    ? (REQUIREMENT_TYPE_LABELS[requirement.requirement_type] || requirement.requirement_type)
    : (ob.penalty && !ob.trigger_event && !ob.recurring ? '罰則' : '期限')
  // 準時判定(應完成項準時率):完成時間(台北日)≤ 到期日才算準時。
  // completed_at 缺值(migration 前完成的舊資料)不視為遲交——不臆造歷史;
  // 循環義務完成後 computeObligationDue 回的是下一期到期日(必在今天之後),
  // 等同從寬認定準時——循環項的逐期準時率要等後端有逐期實例才算得準。
  const onTime = status !== 'done' ? null
    : (!ob.completed_at || !due) ? true
      : taipeiISODate(ob.completed_at) <= localISODate(due)
  const item = {
    id: ob.id,
    ob,
    who,
    status,
    due,
    diff,
    phase,
    onTime,
    completedAt: ob.completed_at || null,
    dateLabel: due ? localISODate(due) : '—',
    countdown: countdownLabel(status, diff),
    title: ob.title,
    desc: requirement?.description || ob.note || '',
    type,
    kind: KIND_LABELS[ob.recurring] || '',
    clause,
    page,
    doc: version ? `${version.documents?.title || '契約文件'}（${version.version_label || ''}）` : '',
    quote: src?.source_text || '',
    verified: src ? !!src.source_verified : null,
    calc: formatObligationRule(ob),
    criteria: requirement?.acceptance_criteria || '',
    evidenceReq: requirement?.evidence_requirement || '',
    penalty: ob.penalty || '',
  }
  // 搜尋範圍(README 2.4):標題、說明、條款、頁碼、原文、類型、責任方、頻率、推算方式
  item.searchText = [
    item.title, item.desc, item.clause, item.page, item.quote,
    item.type, item.who, item.kind, item.calc, item.penalty,
  ].filter(Boolean).join(' ').toLowerCase()
  return item
}

// 三種條件 AND、即時生效(README 2.4);status/phase 'all'、who/type 空字串=不過濾
export function matchesFilters(item, filters) {
  if (filters.status !== 'all' && item.status !== filters.status) return false
  if (filters.phase !== 'all' && item.phase !== filters.phase) return false
  if (filters.who && item.who !== filters.who) return false
  if (filters.type && item.type !== filters.type) return false
  const q = filters.q.trim().toLowerCase()
  if (!q) return true
  return item.searchText.includes(q)
}
