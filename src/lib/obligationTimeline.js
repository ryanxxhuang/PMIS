// 契約重點 · 履約時程(/requirements 改版)的純函式層。
// 本頁唯一的權限規則是「三方可見範圍」+「動作只看歸屬」,全部收在這裡可測:
//   可見義務 = items.filter(r => VISIBLE[viewerParty].includes(r.who))
//   可操作   = item.who === viewerParty(與角色無關,只看歸屬)
// ⚠️ VISIBLE 是前端的展示過濾(shim):目標契約是後端依登入身分回傳已過濾
// 集合並附 canAct 旗標(RLS/view),前端不做權限判斷——屆時整張表刪除、
// 這裡只剩推導函式。在那之前 contract_obligations 的 RLS 仍是全案成員可讀,
// 這份過濾只是版面歸屬,不是安全邊界,不可反過來依賴它保密。
import { computeObligationDue, formatObligationRule } from './contractDue.js'
import { parseLocalDate, localISODate } from './dates.js'
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
// 這張卡是稽核數字。準時率照現況規格 done ÷ (done + overdue),未到期不計;
// ⚠️ 已知偏差:逾期後補完成會進分子(見 handoff 待確認問題 3),後端補
// completed_at 後應改為「完成時間 ≤ 到期日」的應完成項準時率——只改這一支。
export function partyStat(items) {
  const n = { overdue: 0, due: 0, scheduled: 0, done: 0, na: 0 }
  for (const it of items) n[it.status]++
  const settled = n.done + n.overdue
  const rate = settled ? Math.round((n.done / settled) * 100) : null
  return { total: items.length, n, settled, rate }
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

// 動作權限與角色無關,只看歸屬(README 1)。dbWrite 鏡像 DB 的 can_write
// (contract_obligations update 政策:廠商/監造/管理者;機關唯讀)——目標契約
// 是後端逐筆回 canAct,屆時這裡改讀旗標。
export const canActOn = (item, viewerParty, dbWrite = true) => item.who === viewerParty && !!dbWrite

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
  const item = {
    id: ob.id,
    ob,
    who,
    status,
    due,
    diff,
    phase,
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
