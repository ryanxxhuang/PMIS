// 契約重點 · 履約時程(/requirements 改版)的純函式層。
// 本頁唯一的權限規則是「三方可見範圍」+「動作只看歸屬」,全部收在這裡可測:
//   可見義務 = items.filter(r => VISIBLE[viewerParty].includes(r.who))
//   可操作   = item.who === viewerParty(與角色無關,只看歸屬)
// ⚠️ VISIBLE 是前端的展示過濾(shim):目標契約是後端依登入身分回傳已過濾
// 集合並附 canAct 旗標(RLS/view),前端不做權限判斷——屆時整張表刪除、
// 這裡只剩推導函式。D-018 起 contract_obligations 的 RLS 已依來源契約分級；
// 這份責任方過濾只是版面歸屬，不是安全邊界，不可反過來依賴它保密。
import { computeObligationDue, formatObligationRule } from './contractDue.js'
import { parseLocalDate, localISODate, taipeiISODate } from './dates.js'
import { REQUIREMENT_TYPE_LABELS, sourcePageLabel } from './requirementReview.js'
import { setupLink } from './obligationLinks.js'
import {
  obligationSide, ANCHOR_BY_TRIGGER, ANCHOR_LABELS as SHARED_ANCHOR_LABELS, ANCHOR_CHANGE_KIND_LABELS,
  isRecurring, isObligationOpen, currentObligationPeriod, recurrenceRuleGap, recurrenceAnchorKey,
  recurrenceStopGap, periodBasisLabel, singleDueSnapshot, obligationEntries, daysBetweenIso,
} from '../../supabase/functions/_shared/ballInCourtRules.ts'

export const PARTIES = ['廠商', '監造', '機關']
export const ORG_TO_PARTY = { contractor: '廠商', supervisor: '監造', owner: '機關' }
// 責任方推不出三方(null／空字串／「其他」／自由文字)的義務:不歸任何一方,以「待補設定」
// 標示,三方都看得到、三方都不能標記(DB obligation_party() 回 null,policy 同步不放行);
// 處理入口是契約重點該筆(廢止取代後補登責任方)。與今日工作／Agent／早報同一條規則。
export const UNASSIGNED_PARTY = '待補設定'

// 責任方標示(README 2.2):icon + 卡片左緣標示色。色值走全站 token——
// 廠商=主色藍、監造=注意橘(--accent 即 #a05a00)、機關=綠(--success 即 #146c2e)。
export const PARTY_META = {
  廠商: { icon: 'engineering', mark: 'var(--primary)' },
  監造: { icon: 'checklist', mark: 'var(--accent)' },
  機關: { icon: 'account_balance', mark: 'var(--success)' },
  [UNASSIGNED_PARTY]: { icon: 'help', mark: 'var(--text-3)' },
}

// 誰看得到誰的執行情形(README 1)。廠商只看自己;監造看自己+廠商;機關看全部。
export const VISIBLE = { 廠商: ['廠商'], 監造: ['監造', '廠商'], 機關: ['廠商', '監造', '機關'] }
// 可見=三方可見範圍,加上「待補設定」對三方都可見(不然沒人知道有義務等著補責任方)
export const isVisibleTo = (item, viewerParty) => item.who === UNASSIGNED_PARTY || (VISIBLE[viewerParty] || []).includes(item.who)

// 頁首副標(README 2.1,依角色換文案;標點照設計稿)
export const PARTY_BLURB = {
  廠商: '依契約整理的履約事項，從開工到保固追蹤期限與佐證。內容如有出入，以契約原文為準。',
  監造: '查看自己與廠商的履約事項、期限與佐證。內容如有出入，以契約原文為準。',
  機關: '查看三方的履約事項、期限與佐證。內容如有出入，以契約原文為準。',
}

// 五色語意(README:紅=逾期、黃=7日內、藍=排程中、綠=已完成、灰=未觸發)。
// badge 對應 ui.jsx 的 Badge color;dot 是圓點/時間軸節點色(走 token,深色自動跟上)。
export const OB_STATUS = {
  overdue: { label: '已逾期', badge: 'red', dot: 'var(--danger)' },
  due: { label: '即將到期', badge: 'amber', dot: 'var(--accent)' },
  scheduled: { label: '排程中', badge: 'blue', dot: 'var(--primary)' },
  done: { label: '已完成', badge: 'green', dot: 'var(--success)' },
  na: { label: '無到期日', badge: 'slate', dot: 'var(--chart-today)' },
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

// 歸屬走共用規則 obligationSide(精確白名單、去頭尾空白),再映回中文責任方
export const obligationParty = (ob) => ORG_TO_PARTY[obligationSide(ob?.responsible)] || UNASSIGNED_PARTY

// 狀態推導:已提送/已完成=done;推不出到期日(基準日未定/條件未觸發)=na;
// 逾期<0、7 日內=due,其餘排程中——7 日門檻與 contractDue 的 soon 同一套帳。
// 循環義務(P5b):整條不會 done(期次才是完成的單位;義務層舊的已提送／已完成不算),到期日是
// 最早未結一期的到期日(舊逾期優先);沒有未結期次 → na(基準日／循環規則待補,或全部期已完成)。
export function deriveStatus(ob, anchors, today) {
  const done = !isRecurring(ob) && (ob.status === '已提送' || ob.status === '已完成')
  const due = computeObligationDue(ob, anchors || {})
  if (done) return { key: 'done', due, diff: null }
  if (!due) return { key: 'na', due: null, diff: null }
  const diff = Math.round((due - today0(today)) / 86400000)
  return { key: diff < 0 ? 'overdue' : diff <= 7 ? 'due' : 'scheduled', due, diff }
}

// 循環義務的期次列(履約時程詳情唯讀呈現;P5d 再做完整 UI):依到期日降冪(最新在前),
// 每期帶狀態語意鍵(與 OB_STATUS 同色票)與準時判定;待核對註記原樣帶出。
export function periodRows(ob, today) {
  if (!isRecurring(ob)) return []
  const t = today0(today)
  return [...(ob.periods || [])]
    .sort((a, b) => String(b.due_date).localeCompare(String(a.due_date)))
    .map((p) => {
      const due = parseLocalDate(p.due_date)
      const open = isObligationOpen(p.status)
      const diff = due ? Math.round((due - t) / 86400000) : null
      const status = p.status === '不適用' ? 'na' : !open ? 'done' : diff < 0 ? 'overdue' : diff <= 7 ? 'due' : 'scheduled'
      const onTime = status !== 'done' ? null : (!p.completed_at || !due) ? true : taipeiISODate(p.completed_at) <= localISODate(due)
      return {
        id: p.id, key: p.period_key, due, dateLabel: due ? localISODate(due) : '—', status, diff, onTime,
        rawStatus: p.status, completedAt: p.completed_at || null, reviewNote: p.review_note || '',
        countdown: p.status === '不適用' ? '不適用' : countdownLabel(status, diff),
        evidenceSubmittalId: p.evidence_submittal_id || null, evidenceDocumentId: p.evidence_document_id || null,
        // P5c:這一期是依哪一版基準日產生／改期的(共用規則同一句;Agent 也讀同一份)
        anchorVersionNo: p.anchor_version_no ?? null, basisLabel: periodBasisLabel(p),
      }
    })
}

// 逐期統計(P5d):循環義務的準時率以「期」為單位——分母=已完成＋已逾期的期,分子=準時完成的期
// (partyStat 對單次義務的同一條定義);未到期與不適用不計。回填待核對的期仍是待辦,不進分母。
export function periodStat(periods) {
  const n = { done: 0, overdue: 0, open: 0, na: 0 }
  let onTime = 0
  for (const p of periods || []) {
    if (p.status === 'done') { n.done++; if (p.onTime !== false) onTime++ } else if (p.status === 'overdue') n.overdue++
    else if (p.status === 'na') n.na++
    else n.open++
  }
  const settled = n.done + n.overdue
  return { total: (periods || []).length, n, settled, onTime, rate: settled ? Math.round((onTime / settled) * 100) : null }
}

// 待補設定的五種缺口(P5a responsible／anchor、P5b rule／review、P5c stop):與今日工作、Agent、早報
// 同一份判定(共用規則 obligationEntries),履約時程只是把它列成可篩選的事項並附處理入口——
// 若這裡自己再判一次,四處對同一條義務講的缺口就會不同。同一種缺口一條義務只列一次
// (回填待核對可能多期,取最早的一期當入口)。
export const SETUP_KINDS = Object.freeze([
  { key: 'responsible', label: '責任方待補' },
  { key: 'anchor', label: '基準日待補' },
  { key: 'rule', label: '循環規則待補' },
  { key: 'stop', label: '停止條件待補' },
  { key: 'review', label: '回填待核對' },
])
export const SETUP_KIND_LABELS = Object.freeze(Object.fromEntries(SETUP_KINDS.map((k) => [k.key, k.label])))
export function setupGapsOf(ob, anchors, today) {
  const a = anchors || {}
  const todayIso = taipeiISODate(today0(today))
  const computeDueIso = (o) => localISODate(computeObligationDue(o, a))
  const seen = new Map()
  for (const { ball, period } of obligationEntries(ob, { anchors: a, computeDueIso, todayIso })) {
    const gap = ball.setup
    if (!gap || seen.has(gap.kind)) continue
    seen.set(gap.kind, {
      kind: gap.kind, label: gap.label, kindLabel: SETUP_KIND_LABELS[gap.kind] || gap.kind,
      anchor: gap.anchor || null, periodKey: period?.period_key ?? null, to: setupLink(gap.kind, ob, period),
    })
  }
  return [...seen.values()]
}

// 「近期」(P5d 預設視圖):逾期、7 日內到期、30 日內排程、待補設定、進行中的關鍵工項／停留點,
// 以及最近 7 日完成的(剛標完成的事項不能立刻從畫面消失,否則使用者看不到自己做了什麼)。
// 全期視圖才列開工前的舊完成項與一年後的保固義務。
export const RECENT_DAYS = 30
export const RECENT_DONE_DAYS = 7
export function isRecent(item, today) {
  if (item.setup?.length || item.inProgress) return true
  if (item.status === 'overdue' || item.status === 'due') return true
  if (item.status === 'scheduled' && item.diff != null && item.diff <= RECENT_DAYS) return true
  // 最近 7 日有完成(單次義務的完成、循環義務最近一期的完成):不論目前狀態都列——剛做完的事要看得到
  const days = daysBetweenIso(taipeiISODate(item.completedAt), taipeiISODate(today0(today)))
  return days != null && -days <= RECENT_DONE_DAYS
}

// 近期視圖的順序:先急後緩——逾期(最久的在前)→ 7 日內 → 待補設定／無到期 → 排程中(近的在前)→ 已完成。
const URGENCY_RANK = { overdue: 0, due: 1, na: 2, scheduled: 3, done: 4 }
export function byUrgency(a, b) {
  const ra = URGENCY_RANK[a.status] ?? 9, rb = URGENCY_RANK[b.status] ?? 9
  if (ra !== rb) return ra - rb
  const da = a.diff ?? Infinity, db = b.diff ?? Infinity
  if (da !== db) return da - db
  return (a.ob?.sort_order ?? 0) - (b.ob?.sort_order ?? 0)
}

// 循環義務為什麼沒有期次(或不再產生):基準日／循環規則待補、停止條件判不出(與今日工作、Agent 同一份規則),
// 都不是就是尚未物化。stop 缺口在「有期次」時也會回(DB 已停止產生新期,舊期仍在),呼叫端據此提示。
export function recurrenceGap(ob, anchors, today) {
  if (!isRecurring(ob)) return null
  const rule = recurrenceRuleGap(ob)
  if (rule) return { kind: 'rule', label: `循環規則待補（${rule}）` }
  const key = recurrenceAnchorKey(ob)
  if (key && !anchors?.[key]) return { kind: 'anchor', label: `基準日待補（${SHARED_ANCHOR_LABELS[key]}）`, anchor: key }
  const stop = recurrenceStopGap(ob, anchors, taipeiISODate(today0(today)))
  if (stop) return { kind: 'stop', label: `停止條件待補（${stop}）` }
  return null
}

// 單次義務的到期日依據(P5c):已完成且 DB 留了快照 → 「完成時留版」(第幾版、日期固定);已完成但沒快照
// (P5c 前的舊資料)→ 明說「完成時未留版,依現行基準日」;未完成 → 依現行基準日(第幾版)。
export function singleDueBasis(ob, currentVersionNo) {
  if (isRecurring(ob)) return null
  const snap = singleDueSnapshot(ob)
  if (snap) return { kind: 'snapshot', versionNo: ob.anchor_version_no ?? null, label: `完成時留版${ob.anchor_version_no ? `（第 ${ob.anchor_version_no} 版基準日）` : ''}：到期 ${snap} 固定不隨基準日更正` }
  const done = !isObligationOpen(ob.status)
  if (done) return { kind: 'legacy', versionNo: null, label: '完成時未留版：到期日依現行基準日計算' }
  if (ob.trigger_event === 'fixed') return { kind: 'fixed', versionNo: null, label: '依義務指定日期，不受基準日影響' }
  if (!ANCHOR_BY_TRIGGER[ob.trigger_event]) return null
  return { kind: 'live', versionNo: currentVersionNo ?? null, label: `依現行${SHARED_ANCHOR_LABELS[ANCHOR_BY_TRIGGER[ob.trigger_event]]}${currentVersionNo ? `（第 ${currentVersionNo} 版）` : ''}計算` }
}

// 基準日版本的呈現列(期限追蹤／履約時程共用):相對前一版改了哪些欄位(舊→新)、類別、依據、生效日與受影響事項。
export function anchorVersionRows(versions) {
  const sorted = [...(versions || [])].sort((a, b) => (a.version_no ?? 0) - (b.version_no ?? 0))
  return sorted.map((v, i) => {
    const prev = i > 0 ? sorted[i - 1].anchors || {} : {}
    const changes = (v.changed_keys || []).map((key) => ({
      key, label: SHARED_ANCHOR_LABELS[key] || key, from: prev[key] || null, to: (v.anchors || {})[key] || null,
    }))
    const effects = Array.isArray(v.effects) ? v.effects : []
    return {
      id: v.id, versionNo: v.version_no, kind: v.change_kind, kindLabel: ANCHOR_CHANGE_KIND_LABELS[v.change_kind] || v.change_kind,
      changes, effectiveFrom: v.effective_from || null, reason: v.reason || '', sourceRef: v.source_ref || '',
      sourceChangeOrderId: v.source_change_order_id || null, createdAt: v.created_at || null, createdBy: v.created_by || null,
      effects, affected: effects.filter((e) => e.kind !== 'kept').length, kept: effects.filter((e) => e.kind === 'kept').length,
      demo: !!v.demo, // 示範模式的本地鏡像版本:期次不重算,畫面要說清楚
    }
  }).reverse() // 最新在前
}

// 倒數文案(README 2.4)
export function countdownLabel(statusKey, diff) {
  if (statusKey === 'done') return '已完成'
  if (statusKey === 'na') return '無到期日'
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
// 循環義務(P5b／P5d)以「期」計:每一期已完成／已逾期各算一個應完成項(periodStat 同一條定義),
// 義務層本身不算——否則一條每月義務完成了十一期、逾期一期,準時率會被算成 0%。
// 五狀態計數 n 仍以「條」為單位(卡上的「N 條義務」對得上清單列數)。
export function partyStat(items) {
  const n = { overdue: 0, due: 0, scheduled: 0, done: 0, na: 0 }
  let settled = 0, onTime = 0, periodsSettled = 0
  for (const it of items) {
    n[it.status]++
    if (it.recurring) {
      const ps = periodStat(it.periods)
      settled += ps.settled; onTime += ps.onTime; periodsSettled += ps.settled
      continue
    }
    if (it.status === 'done') { settled++; if (it.onTime !== false) onTime++ } else if (it.status === 'overdue') settled++
  }
  const rate = settled ? Math.round((onTime / settled) * 100) : null
  return { total: items.length, n, settled, onTime, rate, periodsSettled }
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
// 觸發點→基準日欄位與標籤以共用規則為準(今日工作／Agent／早報的「基準日待補」同一份)
export const ANCHOR_LABELS = SHARED_ANCHOR_LABELS
const TRIGGER_ANCHOR = ANCHOR_BY_TRIGGER
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
  // completed_at 缺值(migration 前完成的舊資料)不視為遲交——不臆造歷史。
  // 循環義務整條不會 done(逐期準時在 periods 每一期各自判定,P5b),義務層不判。
  const onTime = status !== 'done' ? null
    : (!ob.completed_at || !due) ? true
      : taipeiISODate(ob.completed_at) <= localISODate(due)
  const currentPeriod = isRecurring(ob) ? currentObligationPeriod(ob.periods) : null
  const periods = periodRows(ob, today)
  // 循環義務的完成時間=最近一期完成的時間(近期視圖用它判「最近 7 日完成」;義務層沒有單一完成狀態)
  const latestPeriodDone = periods.filter((p) => p.completedAt).map((p) => p.completedAt).sort().at(-1) || null
  const item = {
    id: ob.id,
    ob,
    entryKind: 'obligation',
    who,
    status,
    due,
    diff,
    phase,
    onTime,
    completedAt: ob.completed_at || latestPeriodDone,
    dateLabel: due ? localISODate(due) : '—',
    countdown: countdownLabel(status, diff),
    title: ob.title,
    desc: requirement?.description || ob.note || '',
    type,
    kind: KIND_LABELS[ob.recurring] || '',
    // 循環義務(P5b):目前該處理的期別、全部期次、逐期準時率、沒有期次／不再產生的原因(含 P5c 停止條件)
    recurring: isRecurring(ob),
    currentPeriod: currentPeriod ? String(currentPeriod.period_key) : null,
    currentPeriodId: currentPeriod?.id ?? null,
    periods,
    periodStat: isRecurring(ob) ? periodStat(periods) : null,
    recurrenceGap: recurrenceGap(ob, anchors, today),
    // P5d:待補設定缺口(與今日工作／Agent／早報同一份判定)與各自的處理入口
    setup: setupGapsOf(ob, anchors, today),
    inProgress: false,
    // P5c:本期的依據(第幾版基準日)／單次義務的到期日依據(完成時留版或現行基準日)
    dueBasis: isRecurring(ob) ? (currentPeriod ? periodBasisLabel(currentPeriod) : '') : (singleDueBasis(ob, anchors?.version_no)?.label || ''),
    clause,
    page,
    doc: version ? `${version.documents?.title || '契約文件'}（${version.version_label || ''}）` : '',
    quote: src?.source_text || '',
    verified: src ? !!src.source_verified : null,
    // 詳情欄的原文高亮要知道 quote 出自哪一筆出處(document_version_id + page_number)
    // 才取得到那一頁全文;和 quote/verified 同一筆,不讓頁面自己再挑一次。
    source: src,
    calc: formatObligationRule(ob),
    criteria: requirement?.acceptance_criteria || '',
    evidenceReq: requirement?.evidence_requirement || '',
    penalty: ob.penalty || '',
  }
  // 搜尋範圍(README 2.4):標題、說明、條款、頁碼、原文、類型、責任方、頻率、推算方式、待補設定
  item.searchText = [
    item.title, item.desc, item.clause, item.page, item.quote,
    item.type, item.who, item.kind, item.calc, item.penalty,
    ...item.setup.map((g) => g.label),
  ].filter(Boolean).join(' ').toLowerCase()
  return item
}

// 條件 AND、即時生效(README 2.4);status/phase 'all'、who/type/setup 空字串=不過濾。
// setup:'any'=任一待補設定,其餘=該種缺口(SETUP_KINDS);range:'recent'=近期(isRecent),'all'=全期。
export function matchesFilters(item, filters, today) {
  if (filters.range === 'recent' && !isRecent(item, today)) return false
  if (filters.status !== 'all' && item.status !== filters.status) return false
  if (filters.phase !== 'all' && item.phase !== filters.phase) return false
  if (filters.who && item.who !== filters.who) return false
  if (filters.type && item.type !== filters.type) return false
  if (filters.setup) {
    const gaps = item.setup || []
    if (filters.setup === 'any' ? !gaps.length : !gaps.some((g) => g.kind === filters.setup)) return false
  }
  const q = filters.q.trim().toLowerCase()
  if (!q) return true
  return item.searchText.includes(q)
}
