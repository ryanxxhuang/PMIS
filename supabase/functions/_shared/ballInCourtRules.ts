// 「球在誰手上」的唯一規則實作(P5a,D-026 §4 契約時程與提醒對齊)。
// ---------------------------------------------------------------------------
// 首頁今日工作(src/lib/ballInCourt.js → todayTasks.js)、Agent 工具 list_my_open_items 與
// 每日早報 send-reminders(_shared/ballInCourt.ts collectOpenBallItems)都 import 這一份。
// 以前兩側各抄一份判定(前端七支、Edge 四支),涵蓋類型與「責任不明歸誰」都漂移過;
// 現在規則只有這裡一份,兩側只負責「拿資料」與「加路由／加逾期天數」。
//
// 為什麼放在 supabase/functions/_shared:Edge 部署只打包 supabase/functions 底下的檔案,
// 前端(Vite)則可以 import repo 內任何路徑——放這裡兩邊都拿得到;放 src/ 則 Edge 打包不到。
// 本檔必須維持零 import、零 Deno／Node／瀏覽器 API:純函式才能同時在 Deno 與 Vite 執行。
//
// 責任不明(responsible 推不出三方、觀察 assigned_to 不是三方)一律 who='unassigned':
// 不歸任何一方、列入「待補設定」讓三方都看得到並有處理入口;絕不預設丟給廠商。
// DB 同一條規則:obligation_party() 對三方以外回 null(migration 20260917213502),
// contract_obligations 的 update policy 因而對三方都不放行(admin override 例外)。
//
// 共用測試案例:tests/fixtures/ball-in-court.cases.json —— Vitest(前端路徑與 Edge 路徑)
// 與 Deno(ballInCourtRules.deno.test.ts)對同一組案例斷言相同的事項、責任與期限。

export type BallSide = 'contractor' | 'supervisor' | 'owner'
export type BallWho = BallSide | 'unassigned' | 'done'
export interface Ball { who: BallWho; label: string }

export const BALL_SIDES: readonly BallSide[] = ['contractor', 'supervisor', 'owner']
export const UNASSIGNED = 'unassigned' as const

// 任意值 → 三方之一;不是三方回 null(不臆測)。
export function sideOf(value: unknown): BallSide | null {
  return typeof value === 'string' && (BALL_SIDES as readonly string[]).includes(value) ? (value as BallSide) : null
}

// ── 單據判定(狀態 → 下一個動作者) ────────────────────────────────────────────
type Rec = Record<string, unknown>
const s = (r: Rec, k: string) => (r?.[k] == null ? '' : String(r[k]))

export function rfiBall(r: Rec): Ball {
  if (s(r, 'status') === '待回覆') return { who: 'supervisor', label: '待監造/設計回覆' }
  if (s(r, 'status') === '已回覆') return { who: 'contractor', label: '待廠商確認結案' }
  return { who: 'done', label: '已結案' }
}

export function submittalBall(r: Rec): Ball {
  const st = s(r, 'status')
  if (st === '已提送' || st === '審核中') return { who: 'supervisor', label: '待監造審定' }
  if (st === '退回補正') return { who: 'contractor', label: '待廠商補正' }
  return { who: 'done', label: st } // 核准 / 核備 / 駁回
}

export function valuationBall(r: Rec): Ball {
  const st = s(r, 'status')
  if (st === '草稿') return { who: 'contractor', label: '待廠商送審' }
  if (st === '監造審核') return { who: 'supervisor', label: '待監造核定' }
  if (!r?.invoice_date) return { who: 'contractor', label: '待廠商請款' }
  if (!r?.paid_date) return { who: 'owner', label: '待機關撥款' } // 已請款 → 球在機關撥款
  return { who: 'done', label: '已撥款' }
}

export function changeOrderBall(r: Rec): Ball {
  const st = s(r, 'status')
  if (st === '提出') return { who: 'supervisor', label: '待監造審查' }
  if (st === '審核中') return { who: 'owner', label: '待機關核定' }
  return { who: 'done', label: st } // 核准 / 駁回
}

export function defectBall(r: Rec): Ball {
  const st = s(r, 'status')
  if (st === '已結案') return { who: 'done', label: '已結案' }
  if (st === '待複查') return { who: 'supervisor', label: '待監造複查' }
  // 開立/改善中分開標示:按「開始改善」後仍顯示「待廠商改善」會讓畫面與實際狀態對不上
  if (st === '改善中') return { who: 'contractor', label: '廠商改善中' }
  return { who: 'contractor', label: '待廠商改善' } // 開立
}

export function inspectionBall(r: Rec): Ball {
  const st = s(r, 'status')
  if (st === '待查驗') return { who: 'supervisor', label: '待監造查驗' }
  return { who: 'done', label: st } // 合格 / 不合格
}

// 觀察事項 assigned_to 是自由文字:缺值=廠商(資料慣例);三方值歸該方;
// 其他文字(現場人名等)推不出平台上的一方 → 待補設定,不硬塞給任何角色。
export function observationBall(r: Rec): Ball {
  const st = s(r, 'status')
  if (st !== '待處理') return { who: 'done', label: st } // 已處理 / 轉缺失
  const raw = s(r, 'assigned_to').trim()
  if (!raw) return { who: 'contractor', label: '待處理' }
  const side = sideOf(raw)
  return side ? { who: side, label: '待處理' } : { who: 'unassigned', label: `待處理（指派「${raw}」不是三方）` }
}

// ── 契約義務 ───────────────────────────────────────────────────────────────────
// responsible → 三方。精確白名單(先去頭尾空白):null、空字串、「其他」與任何未知文字
// 一律 'unassigned'。與 DB obligation_party() 同一條規則。
export const OBLIGATION_SIDE: Readonly<Record<string, BallSide>> = Object.freeze({ 廠商: 'contractor', 監造: 'supervisor', 機關: 'owner' })
export function obligationSide(responsible: unknown): BallSide | 'unassigned' {
  const key = responsible == null ? '' : String(responsible).trim()
  return OBLIGATION_SIDE[key] ?? 'unassigned'
}

// 「未結」的唯一定義:已提送／已完成／不適用以外都算未結(第五種值出現時兩側同樣列入,
// 不再是前端列、伺服器不列)。
export const OBLIGATION_CLOSED_STATUSES: readonly string[] = ['已提送', '已完成', '不適用']
export function isObligationOpen(status: unknown): boolean {
  return !OBLIGATION_CLOSED_STATUSES.includes(status == null ? '' : String(status))
}

// 觸發點 → 基準日欄位;推不出到期日且對應基準日沒填,就是「基準日待補」(不是無期限)。
export const ANCHOR_BY_TRIGGER: Readonly<Record<string, string>> = Object.freeze({
  award: 'award_date', notice: 'notice_date', commencement: 'commencement_date', completion: 'end_date',
})
export const ANCHOR_LABELS: Readonly<Record<string, string>> = Object.freeze({
  award_date: '決標日', notice_date: '接獲開工通知日', commencement_date: '開工日', end_date: '竣工日',
})
export interface AnchorGap { key: string; label: string }
export function obligationAnchorGap(ob: Rec, anchors: Rec | null | undefined): AnchorGap | null {
  const key = ANCHOR_BY_TRIGGER[s(ob, 'trigger_event')]
  if (!key || anchors?.[key]) return null
  return { key, label: ANCHOR_LABELS[key] }
}

export interface SetupGap { kind: 'responsible' | 'anchor'; label: string; anchor?: string }
export interface ObligationBall extends Ball { setup: SetupGap | null }

// 義務的球:到期日由呼叫端用 contractDue(前端 .js／Edge .ts,已有共用案例)算好傳入,
// 這裡只判「未結／責任方／基準日缺口」。
//   * 未結且責任不明 → who='unassigned',setup.responsible(三方都看得到、處理入口在契約重點)
//   * 未結、責任明確、推不出到期日且基準日沒填 → who=該方,setup.anchor(處理入口在期限追蹤的基準日)
//   * 其餘未結 → who=該方,label '待辦';到期窗口(逾期／N 日內)由呼叫端決定
export function obligationBall(ob: Rec, opts: { dueIso?: string | null; anchors?: Rec | null } = {}): ObligationBall {
  if (!isObligationOpen(ob?.status)) return { who: 'done', label: s(ob, 'status') || '已完成', setup: null }
  const side = obligationSide(ob?.responsible)
  if (side === 'unassigned') {
    const label = '責任方待補設定'
    return { who: 'unassigned', label, setup: { kind: 'responsible', label } }
  }
  if (!opts.dueIso) {
    const gap = obligationAnchorGap(ob, opts.anchors)
    if (gap) {
      const label = `基準日待補（${gap.label}）`
      return { who: side, label, setup: { kind: 'anchor', label, anchor: gap.key } }
    }
  }
  return { who: side, label: '待辦', setup: null }
}

// 'YYYY-MM-DD' 兩日之差(正=dueIso 在 todayIso 之後)。純字串運算,不受執行環境時區影響。
export function daysBetweenIso(dueIso: unknown, todayIso: unknown): number | null {
  const toUtc = (iso: unknown) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null
  }
  const a = toUtc(dueIso), b = toUtc(todayIso)
  return a == null || b == null ? null : Math.round((a - b) / 86400000)
}

// 期限型義務進清單的窗口:已逾期,或 soonDays>0 且 soonDays 日內到期。
// 首頁與早報 soonDays=7、Agent 工具 0(只列逾期)——同一條規則,只差參數。
export function obligationInWindow(dueIso: unknown, todayIso: unknown, soonDays: number): boolean {
  const days = daysBetweenIso(dueIso, todayIso)
  if (days == null) return false
  return days < 0 || (soonDays > 0 && days <= soonDays)
}

// ── 現場文書(P2a field_documents;責任方=owner_org,提送對象=提送列的 to_org) ─────
export const FIELD_DOC_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  daily_log: '施工日誌', supervisor_log: '監造日誌', self_check: '自主檢查表', inspection_form: '監造查驗表單',
})
// 未終態的狀態(received 仍可能有第二個提送對象未收件,所以也要載)
export const FIELD_DOC_OPEN_STATUSES: readonly string[] = ['draft', 'pending_input', 'in_review', 'signed', 'submitted', 'received', 'returned']
// 每類文書的當事方=責任方＋可提送對象(鏡像 DB fn_field_document_owner_org／fn_field_document_to_org_allowed):
// 施工日誌／自檢 廠商→監造;監造日誌 監造→機關;監造查驗表單 監造→廠商＋機關。
// 「等待對方」只對當事方成立——廠商不會等一份與他無關的監造日誌。
export const FIELD_DOC_PARTIES: Readonly<Record<string, readonly BallSide[]>> = Object.freeze({
  daily_log: ['contractor', 'supervisor'], self_check: ['contractor', 'supervisor'],
  supervisor_log: ['supervisor', 'owner'], inspection_form: ['supervisor', 'contractor', 'owner'],
})

export interface FieldDocSubmission { document_id?: unknown; version_no?: unknown; action?: unknown; actor_org?: unknown; to_org?: unknown }

// 一份文件可能同時等兩方收件(監造查驗表單 → 廠商＋機關),所以回陣列:每個待收件方一顆球。
//   draft 待簽署／pending_input 待補欄位／in_review 待同方核對／signed 待提送／returned 被退回待補正 → 責任方
//   submitted／received → 目前版本已提送、且該方尚未收件或退回的 to_org 各一顆「待收件」;都收了就 done
//   discarded／superseded → done
export function fieldDocumentBalls(doc: Rec, submissions: readonly FieldDocSubmission[] = []): Ball[] {
  const st = s(doc, 'status')
  const owner = sideOf(doc?.owner_org)
  const mine = (label: string): Ball[] => [owner ? { who: owner, label } : { who: 'unassigned', label: `${label}（責任方待補設定）` }]
  if (st === 'draft') return mine('待簽署')
  if (st === 'pending_input') return mine('待補欄位')
  if (st === 'in_review') return mine('待同方核對')
  if (st === 'signed') return mine('待提送')
  if (st === 'returned') return mine('被退回待補正')
  if (st === 'submitted' || st === 'received') {
    const ver = Number(doc?.current_version_no)
    const rows = submissions.filter((x) => x.document_id === doc?.id && Number(x.version_no) === ver)
    const responded = new Set(rows.filter((x) => x.action === 'receive' || x.action === 'return').map((x) => String(x.actor_org)))
    const waiting: Ball[] = []
    for (const x of rows) {
      if (x.action !== 'submit') continue
      const to = sideOf(x.to_org)
      if (!to || responded.has(to) || waiting.some((b) => b.who === to)) continue
      waiting.push({ who: to, label: '待收件' })
    }
    return waiting.length ? waiting : [{ who: 'done', label: '已收件' }]
  }
  return [{ who: 'done', label: st }]
}

// ── 核心事項(不分角色的全案未結協作項) ─────────────────────────────────────────
// 形狀是兩側的交集:id／who／tag／title／status／meta／due。前端再加路由 to,Edge 再加 overdue_days。
export interface CoreItem {
  id: string | null
  who: BallSide | 'unassigned'
  tag: string
  title: string
  status: string
  meta: string
  due: string | null
  doc_type?: string // 只有現場文書帶:呼叫端判「等待對方」時查 FIELD_DOC_PARTIES
  setup?: SetupGap  // 責任推不出三方(who='unassigned')時帶:兩側都據此列入「待補設定」
}
export interface CoreInput {
  rfis?: Rec[]; submittals?: Rec[]; valuations?: Rec[]; defects?: Rec[]
  inspections?: Rec[]; observations?: Rec[]; changeOrders?: Rec[]
  fieldDocuments?: Rec[]; fieldDocumentSubmissions?: FieldDocSubmission[]
}

const idOf = (r: Rec): string | null => (r?.id == null || r.id === '' ? null : String(r.id))
const dueOf = (r: Rec): string | null => (r?.due_date ? String(r.due_date).slice(0, 10) : null)
const numbered = (no: unknown, title: unknown) => `${no ? String(no) + ' ' : ''}${title == null ? '' : String(title)}`.trim()
export const UNTITLED = '（未命名）'

export function coreOpenItems(data: CoreInput = {}): CoreItem[] {
  const {
    rfis = [], submittals = [], valuations = [], defects = [], inspections = [], observations = [], changeOrders = [],
    fieldDocuments = [], fieldDocumentSubmissions = [],
  } = data
  const out: CoreItem[] = []
  const push = (ball: Ball, r: Rec, tag: string, title: string, due: string | null = null, extra: Partial<CoreItem> = {}) => {
    if (ball.who === 'done') return
    const setup: Partial<CoreItem> = ball.who === 'unassigned' ? { setup: { kind: 'responsible', label: ball.label } } : {}
    out.push({ id: idOf(r), who: ball.who, tag, title: title || UNTITLED, status: s(r, 'status'), meta: ball.label, due, ...extra, ...setup })
  }
  for (const r of rfis) push(rfiBall(r), r, '疑義', numbered(r.rfi_no, r.title), dueOf(r))
  for (const r of submittals) push(submittalBall(r), r, '送審', numbered(r.submittal_no, r.title), dueOf(r))
  for (const r of valuations) push(valuationBall(r), r, '估驗', `第 ${s(r, 'period_no')} 期估驗`)
  for (const r of inspections) push(inspectionBall(r), r, '查驗', s(r, 'title'))
  for (const r of defects) push(defectBall(r), r, r.domain === 'safety' ? '工安缺失' : '缺失', s(r, 'title'), dueOf(r))
  for (const r of observations) push(observationBall(r), r, '觀察', s(r, 'title'))
  for (const r of changeOrders) push(changeOrderBall(r), r, '變更', numbered(r.co_no, r.title))
  for (const r of fieldDocuments) {
    const title = `${FIELD_DOC_TYPE_LABELS[s(r, 'doc_type')] || '現場文書'} ${s(r, 'doc_date').slice(0, 10)}`.trim()
    for (const ball of fieldDocumentBalls(r, fieldDocumentSubmissions)) push(ball, r, '現場文書', title, null, { doc_type: s(r, 'doc_type') })
  }
  return out
}
