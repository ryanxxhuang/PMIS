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
// DB 同一條規則:obligation_party() 對三方以外回 null(migration 20260917220737),
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
  // P4d:已核定期若仍有歷史遷移來源(legacy_uncovered=尚未補證的工項數),登錄請款日會被 DB 第三檢查點
  // (invoice)擋下——球在監造補開監造確認單,不是廠商;補證完成(count 歸零)才輪到廠商請款。
  if (!r?.invoice_date) {
    if (Number(r?.legacy_uncovered) > 0) return { who: 'supervisor', label: '待監造補證' }
    return { who: 'contractor', label: '待廠商請款' }
  }
  if (!r?.paid_date) return { who: 'owner', label: '待機關撥款' } // 已請款 → 球在機關撥款
  return { who: 'done', label: '已撥款' }
}

// P4d:已核定／已請款期的確認被撤銷／減量後產生的估驗調整(扣回)。pending 時下一期核定會被擋
// (pending_adjustment):由機關作廢(接受該量已計價)或在草稿期同步時併入扣回;球在機關決定。
export function valuationAdjustmentBall(r: Rec): Ball {
  const st = s(r, 'status')
  if (st === 'pending') return { who: 'owner', label: '待機關處理扣回' }
  return { who: 'done', label: st === 'void' ? '已作廢' : '已扣回' }
}

// 期別的「尚未補證的歷史遷移工項數」:valuation_item_sources(kind='legacy')逐期別計 distinct 工項。
// 首頁載入(store/db.js)與早報／Agent 收集器(ballInCourt.ts)都用這一支,不各自數。
export function legacyUncoveredByValuation(sources: Rec[] = []): Record<string, number> {
  const seen = new Map<string, Set<string>>()
  for (const src of sources) {
    if (src?.kind != null && s(src, 'kind') !== 'legacy') continue
    const vid = s(src, 'valuation_id'); if (!vid) continue
    if (!seen.has(vid)) seen.set(vid, new Set())
    seen.get(vid)!.add(s(src, 'work_item_id'))
  }
  return Object.fromEntries([...seen].map(([vid, set]) => [vid, set.size]))
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
  return { who: 'done', label: st } // 合格 / 部分合格 / 不合格(P3c 起判定經監造查驗表單簽署,部分合格帶確認量)
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
// 不再是前端列、伺服器不列)。單次義務看義務 status;循環義務的每一期看期次 status。
export const OBLIGATION_CLOSED_STATUSES: readonly string[] = ['已提送', '已完成', '不適用']
export function isObligationOpen(status: unknown): boolean {
  return !OBLIGATION_CLOSED_STATUSES.includes(status == null ? '' : String(status))
}

// 單次義務完成當下留的到期日快照(P5c):已提送／已完成且 DB trigger 有留 due_date_snapshot 才算——
// 前端 contractDue.js 與 Edge contractDue.ts 都以此決定「讀快照還是照現行基準日算」。
export function singleDueSnapshot(ob: Rec): string | null {
  if (isRecurring(ob) || isObligationOpen(ob?.status) || s(ob, 'status') === '不適用') return null
  const snap = s(ob, 'due_date_snapshot').slice(0, 10)
  return snap || null
}

// ── 循環義務(P5b):逐期追蹤,期次(obligation_periods)由 DB 依規則＋基準日確定性物化 ──────
// 前端與 Edge 都以 PostgREST embed 讀進 ob.periods;這裡只定義「哪些期未結、目前該處理哪一期、
// 規則缺什麼、從哪個基準日起算」,與 DB 的 fn_obligation_recurrence_gap／
// fn_obligation_recurrence_anchor_key 同口徑(pgTAP 與共用案例各釘一側)。
export const RECURRING_KINDS: readonly string[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
export function isRecurring(ob: Rec): boolean {
  return RECURRING_KINDS.includes(s(ob, 'recurring'))
}
// 循環義務整條只在「不適用」(廢止取代)時關閉;義務層的已提送／已完成是 P5b 前的舊語意,
// 自 migration 20260917233000 起 DB guard 不再允許寫入,期次才是完成的單位。
export function isObligationStreamOpen(ob: Rec): boolean {
  return isRecurring(ob) ? s(ob, 'status') !== '不適用' : isObligationOpen(ob?.status)
}
// 循環規則缺什麼(缺就產生不了期次,DB 也不物化):完整回 null。
export function recurrenceRuleGap(ob: Rec): string | null {
  const kind = s(ob, 'recurring')
  if (!RECURRING_KINDS.includes(kind)) return null
  if (kind === 'weekly' && ob?.recurring_weekday == null) return '每週缺星期幾'
  if (kind === 'monthly' && ob?.recurring_day == null) return '每月缺幾日'
  if (kind === 'quarterly' && (ob?.recurring_day == null || ob?.recurring_month == null)) return '每季缺月份或日期'
  if (kind === 'yearly' && (ob?.recurring_day == null || ob?.recurring_month == null)) return '每年缺月份或日期'
  if (s(ob, 'trigger_event') === 'fixed' && !ob?.fixed_date) return '指定日期缺起算日'
  return null
}
// 循環起算的基準日欄位:觸發點映得到就用它;fixed 用義務自己的日期(缺值算規則缺口,不是專案基準日);
// 其餘(null／monthly／other)一律開工日——施工期間的循環義務從開工起算。
// 保固類(P5e)不從專案基準日起算:期次窗口＝保固期間(正式驗收合格日起、保固期滿日止),缺什麼由
// recurrenceStopGap 說(停止條件待補),所以這裡回 null(不會被當成「基準日待補」)。
export function recurrenceAnchorKey(ob: Rec): string | null {
  if (isWarrantyObligation(ob)) return null
  const trigger = s(ob, 'trigger_event')
  if (trigger === 'fixed') return null
  return ANCHOR_BY_TRIGGER[trigger] || 'commencement_date'
}
export function isWarrantyObligation(ob: Rec): boolean {
  return s(ob, 'category') === '保固'
}
export interface ObligationPeriod extends Rec {
  id?: unknown
  period_key?: unknown
  due_date?: unknown
  status?: unknown
  review_note?: unknown
  anchor_version_no?: unknown // P5c:產生／改期這一期時引用的基準日版本(project_anchor_versions.version_no)
  basis?: unknown             // P5c:DB 寫的計算依據快照 {anchor_key, anchor_date, bound_date, …}
}

// ── 循環停止條件(P5c;與 DB fn_project_completion_date／fn_obligation_recurrence_stop_gap 同口徑)──
// 實際竣工日:驗收流程的「竣工確認會勘」(confirm)優先,沒有就「竣工申報」(report);同階段多筆取最後登錄
// (created_at 最大;缺 created_at 就取陣列最後一筆)。沒登錄 → null。呼叫端把它放進 anchors.completion_date。
export interface AcceptanceEventLike { stage_key?: unknown; event_date?: unknown; created_at?: unknown }
export function completionDateOf(events: readonly AcceptanceEventLike[] | null | undefined): string | null {
  const latest = (stage: string): string | null => {
    const rows = (events || []).filter((e) => s(e as Rec, 'stage_key') === stage && s(e as Rec, 'event_date'))
    if (!rows.length) return null
    const pick = rows.reduce((best, e) => (s(e as Rec, 'created_at') >= s(best as Rec, 'created_at') ? e : best), rows[0])
    return s(pick as Rec, 'event_date').slice(0, 10)
  }
  return latest('confirm') ?? latest('report')
}
// ── 保固類循環義務的停止條件(P5e;與 DB fn_project_warranty／fn_warranty_gap_text 同口徑)──────────
// 使用者 2026-09-20 決定:保固期滿日＝正式驗收合格日＋契約載明的保固期間,兩者都有依據才計算。
// 保固期滿日的日期規則只在 DB(fn_warranty_expiry,民法 §120–121、月底無相當日取月末);前端與 Edge 讀
// RPC get_project_warranty 的結果放進 anchors.warranty,這裡只判「缺什麼」與說法,不重算日期。
//   acceptance_date 正式驗收合格日(final 最後一筆且合格;null=缺)
//   term_value／term_unit 契約保固期間;source_ok=引用的契約重點目前仍是本案已確認(approved)
//   expiry 保固期滿日(兩項齊全才有)
export interface ProjectWarranty extends Rec {
  acceptance_date?: unknown; acceptance_event_id?: unknown; term_value?: unknown; term_unit?: unknown
  source_requirement_id?: unknown; source_status?: unknown; source_ok?: unknown; expiry?: unknown
}
export type WarrantyNeed = 'acceptance' | 'term'
export const WARRANTY_TERM_UNIT_LABELS: Readonly<Record<string, string>> = Object.freeze({ year: '年', month: '個月', day: '日' })
export const WARRANTY_NEED_LABELS: Readonly<Record<WarrantyNeed, string>> = Object.freeze({ acceptance: '正式驗收合格日', term: '契約保固期間' })
// 保固期間的顯示(例:2 年、6 個月、180 日);不成對或單位未知回 null
export function warrantyTermLabel(value: unknown, unit: unknown): string | null {
  const n = Number(value)
  const u = WARRANTY_TERM_UNIT_LABELS[unit == null ? '' : String(unit)]
  return Number.isInteger(n) && n > 0 && u ? `${n} ${u}` : null
}
// 缺哪幾項(順序固定:合格日、保固期間);保固期間有值但引用條文已不是已確認 → 也算缺保固期間
export function warrantyNeeds(w: ProjectWarranty | null | undefined): WarrantyNeed[] {
  const needs: WarrantyNeed[] = []
  if (!s((w || {}) as Rec, 'acceptance_date')) needs.push('acceptance')
  if (w?.term_value == null || w?.source_ok !== true) needs.push('term')
  return needs
}
export function warrantyGap(w: ProjectWarranty | null | undefined): string | null {
  const parts: string[] = []
  if (!s((w || {}) as Rec, 'acceptance_date')) parts.push('缺正式驗收合格日')
  if (w?.term_value == null) parts.push('缺契約保固期間')
  else if (w?.source_ok !== true) parts.push('保固期間引用的契約條文已不是已確認狀態')
  return parts.length ? `${parts.join('、')}，無法判定保固期滿日` : null
}

// 循環期次的停止條件缺口:完整回 null;判不出或已越界回中文說明(前端／Agent／早報列「待補設定(stop)」)。
//   保固類(P5e):正式驗收合格日＋契約保固期間齊全才有保固期滿日;缺哪項就說哪項(anchors.warranty);
//   其餘:已登錄竣工 → 期次只到竣工為止(無缺口);缺竣工日 → 判不出;竣工日已過而未登錄竣工／展延 → 停在竣工日。
// DB 端同一條規則決定「產生到哪一期」(fn_obligation_recurrence_bound／fn_project_warranty),這裡只負責把缺口說出來。
export function recurrenceStopGap(ob: Rec, anchors: Rec | null | undefined, todayIso: unknown): string | null {
  if (!isRecurring(ob)) return null
  if (isWarrantyObligation(ob)) return warrantyGap(anchors?.warranty as ProjectWarranty | null | undefined)
  if (anchors?.completion_date) return null
  const end = s((anchors || {}) as Rec, 'end_date').slice(0, 10)
  if (!end) return '缺竣工日，無法判定循環何時結束'
  const today = todayIso == null ? '' : String(todayIso).slice(0, 10)
  if (today && end < today) return `竣工日 ${end} 已過，尚未登錄竣工或展延`
  return null
}
// 期次的依據(履約時程／期限追蹤／Agent 同一句):第幾版基準日、起算欄位與日期;
// 產生時沒有版本(P5c 前的期、對不上快照的回填)就說「產生時未留版」;義務指定日期起算的說「義務指定日期」。
export const ANCHOR_CHANGE_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  initial: '初值', edit: '直接修改', suspension: '停工', resumption: '復工', extension: '展延', change_order: '核准變更工期',
})
// 保固類的期(P5e)起算是正式驗收合格日、界限是保固期滿日,依據句把兩者都說出來。
export function periodBasisLabel(period: ObligationPeriod | null | undefined): string {
  if (!period) return ''
  const basis = (period.basis && typeof period.basis === 'object' ? period.basis : {}) as Rec
  const key = s(basis, 'anchor_key')
  const date = s(basis, 'anchor_date').slice(0, 10)
  const warranty = s(basis, 'bound_kind') === 'warranty_expiry'
  const from = key === 'fixed_date' ? `義務指定日期 ${date}`
    : warranty ? `正式驗收合格日 ${date} 起、保固期滿 ${s(basis, 'bound_date').slice(0, 10)} 止`
      : key ? `${ANCHOR_LABELS[key] || key} ${date}` : '起算日未記錄'
  const v = period.anchor_version_no == null ? null : Number(period.anchor_version_no)
  return v ? `第 ${v} 版基準日（${from}）` : `產生時未留版（${from}）`
}
const periodDueIso = (p: ObligationPeriod): string => s(p, 'due_date').slice(0, 10)
const byPeriodDue = (a: ObligationPeriod, b: ObligationPeriod) => (periodDueIso(a) < periodDueIso(b) ? -1 : periodDueIso(a) > periodDueIso(b) ? 1 : 0)
// 未結期次,依到期日升冪:最舊的逾期排最前,不因下期出現而消失。
export function openObligationPeriods(periods: readonly ObligationPeriod[] | null | undefined): ObligationPeriod[] {
  return (periods || []).filter((p) => isObligationOpen(p?.status)).sort(byPeriodDue)
}
// 目前該處理的一期=最早未結的一期;只要一個到期日的呼叫端(列印、AI 快照、風險稽核、履約時程列)用它。
export function currentObligationPeriod(periods: readonly ObligationPeriod[] | null | undefined): ObligationPeriod | null {
  return openObligationPeriods(periods)[0] ?? null
}
// 期次的標題:義務標題＋期別,首頁／Agent／早報同一句。
export function periodTitle(title: unknown, period: ObligationPeriod | null | undefined): string {
  const t = title == null ? '' : String(title)
  return period ? `${t}（${s(period, 'period_key')} 期）` : t
}

// 觸發點 → 基準日欄位;推不出到期日且對應基準日沒填,就是「基準日待補」(不是無期限)。
// 循環義務改看 recurrenceAnchorKey(無觸發點也要開工日才起算)。
export const ANCHOR_BY_TRIGGER: Readonly<Record<string, string>> = Object.freeze({
  award: 'award_date', notice: 'notice_date', commencement: 'commencement_date', completion: 'end_date',
})
export const ANCHOR_LABELS: Readonly<Record<string, string>> = Object.freeze({
  award_date: '決標日', notice_date: '接獲開工通知日', commencement_date: '開工日', end_date: '竣工日',
})
export interface AnchorGap { key: string; label: string }
export function obligationAnchorGap(ob: Rec, anchors: Rec | null | undefined): AnchorGap | null {
  const key = isRecurring(ob) ? recurrenceAnchorKey(ob) : ANCHOR_BY_TRIGGER[s(ob, 'trigger_event')]
  if (!key || anchors?.[key]) return null
  return { key, label: ANCHOR_LABELS[key] }
}

// ── 單次義務的時點缺口(F1;與 DB fn_obligation_timing_gap 同口徑,pgTAP supabase/tests/obligation_timing_gap.sql)──
// 「推不出到期日」以前只有一個結果:無到期日。但推不出的原因分兩類,只有一類是系統無法追蹤:
//   缺口(時點待補):指定日期沒填;觸發點是「每月」卻沒有循環規則(缺頻率);有 N 日期限卻沒有起算事件;
//     期限型契約重點(requirement_type=deadline)既無觸發點也無頻率——期限型沒有時點就物化不出到期日,
//     人工補登表單本來就擋(lib/manualRequirement.js),AI 抽取與舊資料沒有這道關,這裡把它列成待補設定。
//   不是缺口(無明確時點):非期限型的契約重點沒有時點是正常的(檢查表／佐證等依條件觸發);觸發點「其他」
//     是抽取時明確標的「事件發生才起算」——事件系統不追蹤,到期日等事件發生後補登指定日期,不是設定沒填。
// 處理入口與責任方／循環規則同一個:擷取審核(已確認內容不可改,廢止取代後補登時點)。
// 契約重點類型由呼叫端隨義務列 embed(requirement:requirements(requirement_type));沒有(demo／舊資料)視為未知,
// 只判前三種與資料本身有關的缺口。
export function obligationRequirementType(ob: Rec): string | null {
  const req = ob?.requirement
  const t = req && typeof req === 'object' ? s(req as Rec, 'requirement_type') : ''
  return t || null
}
export function timingGap(ob: Rec): string | null {
  if (isRecurring(ob)) return null
  const trigger = s(ob, 'trigger_event')
  if (ANCHOR_BY_TRIGGER[trigger]) return null
  if (trigger === 'fixed') return ob?.fixed_date ? null : '指定日期未填'
  if (trigger === 'monthly') return '觸發點為每月，循環規則未設定'
  if (trigger === 'other') return null
  const offset = Number(ob?.offset_days)
  if (Number.isFinite(offset) && offset > 0) return `有 ${offset} 日期限，起算事件未設定`
  if (obligationRequirementType(ob) === 'deadline') return '期限型契約重點未設定觸發點或頻率'
  return null
}

// 待補設定的六種缺口:責任方推不出三方／基準日沒填(P5a),循環規則不完整／回填待核對(P5b:舊義務
// 曾標完成但對不上期別),循環停止條件判不出或已越界(P5c),單次義務時點沒設(F1 timing)。
// 三方都看得到、不算任何人的件數,每種各有處理入口。
// need:保固類停止條件缺口(P5e)缺哪幾項——處理入口不同(合格日在驗收頁、保固期間在履約時程的履約期程卡)。
export interface SetupGap { kind: 'responsible' | 'anchor' | 'rule' | 'review' | 'stop' | 'timing'; label: string; anchor?: string; need?: WarrantyNeed[] }
// 停止條件缺口(保固類另帶缺哪幾項)
function stopGap(ob: Rec, anchors: Rec | null | undefined, stop: string): SetupGap {
  const label = `停止條件待補（${stop}）`
  return isWarrantyObligation(ob)
    ? { kind: 'stop', label, need: warrantyNeeds(anchors?.warranty as ProjectWarranty | null | undefined) }
    : { kind: 'stop', label }
}
export interface ObligationBall extends Ball { setup: SetupGap | null }

// 義務(或它的一期)的球:到期日由呼叫端傳入(單次:contractDue 依基準日;循環:期次的 due_date),
// 這裡只判「未結／責任方／循環規則缺口／待核對／基準日缺口／停止條件缺口」。
//   * 整條已結(單次:已提送／已完成／不適用;循環:不適用)→ done
//   * 責任不明 → who='unassigned',setup.responsible(處理入口在擷取審核)
//   * 循環規則不完整 → who=該方,setup.rule(處理入口在擷取審核,廢止取代後補登)
//   * 帶期次:期次帶 review_note → setup.review(處理入口在期限追蹤的那一期);期次已結 → done;否則 '待辦'
//   * 責任明確、推不出到期日且基準日沒填 → who=該方,setup.anchor(處理入口在期限追蹤的基準日)
//   * 單次、推不出到期日且時點沒設(指定日期未填／觸發點每月缺頻率／有期限缺起算事件／期限型無時點)
//     → who=該方,setup.timing(處理入口在擷取審核,廢止取代後補登時點)
//   * 循環、沒有期次且停止條件判不出／已越界 → who=該方,setup.stop(處理入口在期限追蹤的基準日或驗收頁)
//   * 其餘 → who=該方,label '待辦'(單次:非期限型的無明確時點、觸發點「其他」依條件觸發);到期窗口由呼叫端決定
export function obligationBall(ob: Rec, opts: { dueIso?: string | null; anchors?: Rec | null; period?: ObligationPeriod | null; todayIso?: unknown } = {}): ObligationBall {
  if (!isObligationStreamOpen(ob)) return { who: 'done', label: s(ob, 'status') || '已完成', setup: null }
  const side = obligationSide(ob?.responsible)
  if (side === 'unassigned') {
    const label = '責任方待補設定'
    return { who: 'unassigned', label, setup: { kind: 'responsible', label } }
  }
  const ruleGap = recurrenceRuleGap(ob)
  if (ruleGap) {
    const label = `循環規則待補（${ruleGap}）`
    return { who: side, label, setup: { kind: 'rule', label } }
  }
  if (opts.period) {
    if (opts.period.review_note) {
      const label = '回填待核對（原義務曾標完成，本期是否已履行待確認）'
      return { who: side, label, setup: { kind: 'review', label } }
    }
    if (!isObligationOpen(opts.period.status)) return { who: 'done', label: s(opts.period, 'status') || '已完成', setup: null }
    return { who: side, label: '待辦', setup: null }
  }
  if (!opts.dueIso) {
    const gap = obligationAnchorGap(ob, opts.anchors)
    if (gap) {
      const label = `基準日待補（${gap.label}）`
      return { who: side, label, setup: { kind: 'anchor', label, anchor: gap.key } }
    }
    const timing = timingGap(ob)
    if (timing) {
      const label = `時點待補（${timing}）`
      return { who: side, label, setup: { kind: 'timing', label } }
    }
    const stop = recurrenceStopGap(ob, opts.anchors, opts.todayIso)
    if (stop) {
      const setup = stopGap(ob, opts.anchors, stop)
      return { who: side, label: setup.label, setup }
    }
  }
  return { who: side, label: '待辦', setup: null }
}

// 一條義務要列幾顆球:單次一顆(到期日由呼叫端的 contractDue 算);循環義務每個未結期次一顆
// (舊逾期各自保留、待核對的期次也列),一期都沒有時一顆沒有到期日的球(基準日／規則／停止條件缺口由
// obligationBall 判);有期次但停止條件判不出／已越界(P5c:DB 已停止產生新期)再多一顆 setup.stop,
// 讓人知道之後不會再有期次、要補竣工日或登錄竣工。
// 首頁 todayTasks、Edge collectOpenBallItems 與 Deno 共用案例都走這一支,不各自迭代期次。
export interface ObligationEntry { ball: ObligationBall; dueIso: string | null; period: ObligationPeriod | null }
export function obligationEntries(
  ob: Rec,
  opts: { anchors?: Rec | null; computeDueIso: (ob: Rec) => string | null; todayIso?: unknown },
): ObligationEntry[] {
  if (!isObligationStreamOpen(ob)) return []
  if (!isRecurring(ob)) {
    const dueIso = opts.computeDueIso(ob)
    return [{ ball: obligationBall(ob, { dueIso, anchors: opts.anchors }), dueIso, period: null }]
  }
  const listed = ((ob?.periods as ObligationPeriod[] | undefined) || [])
    .filter((p) => isObligationOpen(p?.status) || p?.review_note)
    .sort(byPeriodDue)
  if (!listed.length) return [{ ball: obligationBall(ob, { dueIso: null, anchors: opts.anchors, todayIso: opts.todayIso }), dueIso: null, period: null }]
  const entries: ObligationEntry[] = listed.map((period) => ({ ball: obligationBall(ob, { dueIso: periodDueIso(period), anchors: opts.anchors, period }), dueIso: periodDueIso(period), period }))
  const stop = recurrenceStopGap(ob, opts.anchors, opts.todayIso)
  if (stop && obligationSide(ob?.responsible) !== 'unassigned' && !recurrenceRuleGap(ob)) {
    const setup = stopGap(ob, opts.anchors, stop)
    entries.push({ ball: { who: obligationSide(ob?.responsible) as BallSide, label: setup.label, setup }, dueIso: null, period: null })
  }
  return entries
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
// 每類文書的提送對象(鏡像 DB fn_field_document_to_org_allowed,migration 20260917201000;前端 lib/fieldDocs 由此推導、
// Vitest 解析 migration 原文釘住):施工日誌／自檢 → 監造;監造日誌 → 機關;監造查驗表單 → 廠商(判定與缺失的相對人,第一順位)＋機關(備查)。
// 多對象各自提送、各自收件(submit 列 per to_org;fieldDocumentBalls 每個待收件方一顆球)。
export const FIELD_DOC_TO_ORGS: Readonly<Record<string, readonly BallSide[]>> = Object.freeze({
  daily_log: ['supervisor'], self_check: ['supervisor'], supervisor_log: ['owner'], inspection_form: ['contractor', 'owner'],
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
  origin_valuation_id?: string // 只有估驗調整帶:被更正的已核定期(前端據此導到估驗頁該期)
}
export interface CoreInput {
  rfis?: Rec[]; submittals?: Rec[]; valuations?: Rec[]; defects?: Rec[]
  inspections?: Rec[]; observations?: Rec[]; changeOrders?: Rec[]
  fieldDocuments?: Rec[]; fieldDocumentSubmissions?: FieldDocSubmission[]
  valuationAdjustments?: Rec[] // P4d:valuation_adjustments 列(至少 id/status/origin_valuation_id)
}

const idOf = (r: Rec): string | null => (r?.id == null || r.id === '' ? null : String(r.id))
const dueOf = (r: Rec): string | null => (r?.due_date ? String(r.due_date).slice(0, 10) : null)
const numbered = (no: unknown, title: unknown) => `${no ? String(no) + ' ' : ''}${title == null ? '' : String(title)}`.trim()
export const UNTITLED = '（未命名）'

export function coreOpenItems(data: CoreInput = {}): CoreItem[] {
  const {
    rfis = [], submittals = [], valuations = [], defects = [], inspections = [], observations = [], changeOrders = [],
    fieldDocuments = [], fieldDocumentSubmissions = [], valuationAdjustments = [],
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
  for (const a of valuationAdjustments) {
    const origin = valuations.find((v) => idOf(v) != null && idOf(v) === s(a, 'origin_valuation_id'))
    const title = origin ? `第 ${s(origin, 'period_no')} 期估驗扣回調整` : '估驗扣回調整'
    push(valuationAdjustmentBall(a), a, '估驗調整', title, null, s(a, 'origin_valuation_id') ? { origin_valuation_id: s(a, 'origin_valuation_id') } : {})
  }
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
