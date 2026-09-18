// 今日工作的單一聚合(W8-2B)。四段:現在輪到我 / 等待對方 / 今天已完成 / 待補設定。
// Dashboard 與提醒中心都吃這一份 —— W8-2A §2.5 盤到的兩套前端規則
// (ballInCourt 的協作項、Alerts 內嵌的期限)在這裡合流,不再各寫一套。
//
// 紅線(W8-2A §4、§7):
//   1. 只由既有業務狀態推導;不建 task 資料表、不建 workflow engine。
//   2. AI 草稿(agent_actions)與未核定 Requirement 永遠不進來——本函式
//      根本不收這兩種輸入,是結構上的保證,不是靠呼叫端自律。
//   3. 只有「登入角色在目的頁真的能完成」的事才進 mine:期限「已提送」鈕
//      在 /deadlines 由歸屬控制,三方責任的期限各進該方;責任不明的不歸任何方,
//      改列「待補設定」(setup)讓三方都看到並導到能補的地方。
//   4. 「今天已完成」只採可靠的操作時間戳(closed_at / inspected_at),
//      不把可回填的業務日期(請款日/日誌日期/審定日)當成「今天按下完成」。
//
// 球權判定與 Agent／早報同一份實作(supabase/functions/_shared/ballInCourtRules.ts,P5a);
// 共用案例 tests/fixtures/ball-in-court.cases.json 由 ballInCourt.cases.test.js 對本檔斷言。
import { collaborationItems, detailLink } from './ballInCourt.js'
import {
  BALL_SIDES, OBLIGATION_SIDE, obligationEntries, obligationInWindow, periodTitle, daysBetweenIso, completionDateOf, FIELD_DOC_PARTIES,
} from '../../supabase/functions/_shared/ballInCourtRules.ts'
import { parseLocalDate, taipeiISODate, localISODate } from './dates.js'
import { computeObligationDue } from './contractDue.js'
import { sampleAlerts } from './qc.js'
import { acceptanceAlerts, deriveAcceptance, ACCEPTANCE_STAGE_ORGS } from './acceptance.js'
import { itpAlerts } from './itp.js'

// 專案角色只有三方(D-002)。design 不是角色,設計釋疑由監造轉呈。
const ORG_SIDES = BALL_SIDES

// 契約義務 responsible → 專案角色。精確白名單(共用規則 OBLIGATION_SIDE):null、空字串、
// 「其他」與未知文字一律「未指定」,不歸給任何角色——伺服器 collectOpenBallItems 與
// DB obligation_party() 自 P5a 起同一條規則,不再有「無法辨識就歸廠商」的預設。
export const RESPONSIBLE_SIDE = OBLIGATION_SIDE

// 「等待對方」只列與登入角色有直接對手關係的類型(W8-2A §3.2、§5-7)——
// 首頁不是全案未結項的傾印場,列完所有別人的事只會讓頁面再變長。
// 現場文書:責任方等對方收件、提送對象等責任方簽送——但只對該類文書的當事方成立
// (FIELD_DOC_PARTIES;廠商不會等一份與他無關的監造日誌)。
export const WAITING_SCOPE = Object.freeze({
  contractor: {
    送審: ['supervisor'], 估驗: ['supervisor', 'owner'], 疑義: ['supervisor'],
    缺失: ['supervisor'], 工安缺失: ['supervisor'], 變更: ['supervisor', 'owner'], 現場文書: ['supervisor', 'owner'],
  },
  supervisor: {
    缺失: ['contractor'], 工安缺失: ['contractor'], 送審: ['contractor'],
    疑義: ['contractor'], 變更: ['owner'], 現場文書: ['contractor', 'owner'],
  },
  owner: {
    估驗: ['contractor'], 缺失: ['contractor'], 工安缺失: ['contractor'], 送審: ['supervisor'], 現場文書: ['contractor', 'supervisor'],
  },
})
const waitsOn = (org, scope, it) => (scope[it.tag] || []).includes(it.who)
  && (it.tag !== '現場文書' || (FIELD_DOC_PARTIES[it.doc_type] || []).includes(org))

// 期限型項目只列「已逾期」與 N 日內到期,沿用提醒中心既有門檻。
export const SOON_DAYS = 7

// taipeiISODate 已抽到 dates.js 當全站業務日期的單一真相;這裡 re-export
// 維持既有 import 路徑(useTodayTasks / Dashboard / 測試)不動。
export { taipeiISODate }

// 兩個 'YYYY-MM-DD' 的日差(正=dueIso 在 todayIso 之後)。純字串運算,
// 不受執行環境時區影響——測試才能用固定 today 斷言逾期天數。實作在共用規則。
export const daysBetween = daysBetweenIso

const isoToUTC = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null
}

// 到期句的單一真相:今日工作與品質頁工作佇列共用同一支——TaskRow 的 OVERDUE_RE 與
// e2e 都綁死「逾期 N 天（到期 YYYY-MM-DD）」這個句型,兩處各抄一份一漂移就斷。
export const dueText = (days, dueIso) => (days < 0
  ? `逾期 ${-days} 天（到期 ${dueIso}）`
  : days === 0 ? `今天到期（${dueIso}）` : `還有 ${days} 天（到期 ${dueIso}）`)

// due 由近到遠;沒有到期日的殿後(stable sort → 同組維持插入順序)
const byDue = (a, b) => {
  const x = isoToUTC(a.due), y = isoToUTC(b.due)
  if (x == null && y == null) return 0
  if (x == null) return 1
  if (y == null) return -1
  return x - y
}

// 每筆待辦:{ key, id, tag, title, meta, ball, due, overdueDays, to, period }。
// meta 是給人看的唯一狀態句(球權標籤＋到期／罰則),UI 不再自己算日期。
// id=原單據 id(可能為 null,demo 舊形狀);key 才是列的唯一鍵;period=循環義務的期別鍵(P5b),
// 同一條義務的每一期各是一筆。
function task({ key, id = null, tag, title, meta, ball, to, due = null, todayIso = null, period = null }) {
  const days = due && todayIso ? daysBetween(due, todayIso) : null
  return {
    key, id: id ?? null, tag, title: title || '（未命名）', meta, ball, to,
    due: due || null,
    overdueDays: days != null && days < 0 ? -days : null,
    period: period ?? null,
  }
}

// 待補設定的處理入口:責任方／循環規則缺口在擷取審核該筆(已確認內容不可改,廢止取代後補登;
// 義務 id 就是 requirement id,?highlight= 直達);基準日缺口在期限追蹤的基準日卡;
// 回填待核對在期限追蹤的那一期;循環停止條件缺口(P5c)在期限追蹤的該筆(基準日卡就在下方,補竣工日／展延;
// 已竣工的到驗收頁登錄)。
function setupLink(kind, ob, period) {
  if (kind === 'responsible' || kind === 'rule') return detailLink('/requirements/review', 'highlight', ob.id)
  if (kind === 'review') return periodLink(ob, period)
  if (kind === 'stop') return detailLink('/deadlines', 'obligation', ob.id)
  return '/deadlines'
}
// 「標為已提送」在期限追蹤頁(契約重點改版後遷出),待辦要導到能完成的地方;帶 ?obligation=<id>
// 直達該筆(規範 §9.7)——/deadlines 的 rows 是 dueItems,id 就是 ob.id;循環義務再帶 &period= 定位那一期。
function periodLink(ob, period) {
  const base = detailLink('/deadlines', 'obligation', ob.id)
  return period && ob.id != null && ob.id !== '' ? `${base}&period=${encodeURIComponent(period.period_key)}` : base
}

export function buildTodayTasks(input = {}) {
  const {
    org, today = new Date(), anchors: anchorsIn = {},
    rfis = [], submittals = [], valuations = [], defects = [], inspections = [],
    observations = [], changeOrders = [], obligations = [], testSamples = [],
    acceptanceEvents = [], inspectionPoints = [], siteLogs = [],
    fieldDocuments = [], fieldDocumentSubmissions = [],
  } = input
  const todayIso = taipeiISODate(today)
  // 實際竣工日(P5c 循環停止條件)由驗收事件推得(竣工確認優先、否則報竣),與 Edge 收集器同一支共用規則;
  // 呼叫端已算好就沿用(共用案例直接給)
  const anchors = { ...anchorsIn, completion_date: anchorsIn.completion_date ?? completionDateOf(acceptanceEvents) }
  // 期限引擎(sampleAlerts / acceptanceAlerts / computeObligationDue)都用 Date 相減再
  // Math.round 算日差,傳含時間的「現在」會把整整 8 個日曆日壓成 7 —— 台北晚上開頁時,
  // 還有 8 天的試驗會被列進「7 日內」,而畫面上的天數(由日期字串算)卻寫 8 天。
  // 統一先正規化成「台北日曆日的本地午夜」,三個引擎與畫面才會是同一天。
  const todayLocal = parseLocalDate(todayIso) || new Date(today)
  const mine = []
  const waiting = []
  // 待補設定:責任推不出三方(義務 responsible／觀察 assigned_to)或基準日沒填。
  // 不歸任何一方、三方都看得到(不依 org 過濾),每筆導到能補的地方。
  const setup = []

  // ── ① 協作項(疑義／送審／估驗／查驗／缺失／觀察／變更／現場文書)────────
  const waitingScope = WAITING_SCOPE[org] || {}
  collaborationItems({ rfis, submittals, valuations, defects, inspections, observations, changeOrders, fieldDocuments, fieldDocumentSubmissions })
    .forEach((it, i) => {
      const days = it.due ? daysBetween(it.due, todayIso) : null
      // key 沿用 tag:id(DOM id 與返回定位都吃它);現場文書一份可能同時等兩方收件,才加 who
      const t = task({
        key: `${it.tag}:${it.id ?? `${it.title}#${i}`}${it.tag === '現場文書' ? `:${it.who}` : ''}`, id: it.id,
        tag: it.tag, title: it.title, ball: it.who, to: it.to, due: it.due, todayIso,
        meta: days != null && days <= SOON_DAYS ? `${it.meta}・${dueText(days, it.due)}` : it.meta,
      })
      // 責任推不出平台上的一方(觀察 assigned_to 是自由文字;共用規則已標 setup):不硬塞給任何角色,列待補設定
      if (it.setup) { setup.push(t); return }
      if (!ORG_SIDES.includes(it.who)) return
      if (it.who === org) mine.push(t)
      else if (waitsOn(org, waitingScope, it)) waiting.push(t)
    })

  // ── ② 契約期限(自己責任、且自己在 /deadlines 真的能完成的才算待辦)──
  // 單次義務一筆(到期日由 contractDue 依基準日算);循環義務每個未結期次一筆(共用規則
  // obligationEntries:舊逾期各自保留、完成本期不動下期,期次由 DB 依規則物化)。
  // 責任不明／基準日沒填／循環規則不完整／回填待核對 → 待補設定(三方都看得到,各有處理入口)。
  const computeDueIso = (ob) => localISODate(computeObligationDue(ob, anchors))
  for (const ob of obligations) {
    for (const { ball, dueIso, period } of obligationEntries(ob, { anchors, computeDueIso, todayIso })) {
      if (ball.who === 'done') continue
      const suffix = period ? `:${period.period_key}` : ''
      const title = periodTitle(ob.title, period)
      if (ball.setup) {
        setup.push(task({
          key: `契約:${ob.id ?? ob.title}${suffix}:setup`, id: ob.id, tag: '契約重點', title, ball: ball.who, due: dueIso, todayIso, period: period?.period_key,
          to: setupLink(ball.setup.kind, ob, period),
          meta: ball.setup.label,
        }))
        continue
      }
      if (ball.who !== org) continue
      if (!dueIso || !obligationInWindow(dueIso, todayIso, SOON_DAYS)) continue
      const days = daysBetween(dueIso, todayIso)
      mine.push(task({
        key: `契約:${ob.id ?? ob.title}${suffix}`, id: ob.id, tag: '契約重點', title, ball: org, period: period?.period_key,
        to: periodLink(ob, period), due: dueIso, todayIso,
        meta: `${dueText(days, dueIso)}${ob.penalty ? `・罰則：${ob.penalty}` : ''}`,
      }))
    }
  }

  // ── ③ 試體齡期(廠商填試驗值)────────────────────────────────────────
  if (org === 'contractor') {
    for (const a of sampleAlerts(testSamples, todayLocal)) {
      const days = daysBetween(a.due, todayIso)
      mine.push(task({
        key: `試驗:${a.sample.id ?? a.sample.sample_no}:${a.label}`, tag: '試驗',
        title: `${a.sample.sample_no || ''} ${a.sample.test_item || ''} ${a.label}`.trim(),
        ball: 'contractor', to: detailLink('/quality', 'sample', a.sample.id), due: a.due, todayIso,
        meta: days == null ? a.label : dueText(days, a.due),
      }))
    }
  }

  // ── ④ 驗收法定期限(依 acceptance.js 的階段角色白名單;竣工確認／複驗雙方都辦得到)──
  if (ORG_SIDES.includes(org)) {
    const dueByStage = new Map(deriveAcceptance(acceptanceEvents, todayLocal).map((s) => [s.key, s.due]))
    for (const a of acceptanceAlerts(acceptanceEvents, todayLocal)) {
      if (!(ACCEPTANCE_STAGE_ORGS[a.stage] || []).includes(org)) continue
      mine.push(task({
        key: `驗收:${a.stage}`, tag: '驗收', title: a.title, meta: a.meta,
        // 直達當前階段(UIUX 階段 5C):頁面用 ?stage= 定位並說明實際狀態,不自動開別的階段編輯
        ball: org, to: detailLink('/acceptance', 'stage', a.stage), due: dueByStage.get(a.stage) || null, todayIso,
      }))
    }
  }

  // ── ⑤ ITP 停留點(施作中未叫驗,球在廠商)────────────────────────────
  if (org === 'contractor') {
    for (const a of itpAlerts(inspectionPoints, inspections, siteLogs)) {
      mine.push(task({
        key: `停留點:${a.point.id ?? a.point.title}`, tag: '停留點', title: a.title, meta: a.meta,
        ball: 'contractor', to: detailLink('/itp', 'point', a.point.id),
      }))
    }
  }

  // ── ⑥ 今日施工日誌未填(僅廠商)──────────────────────────────────────
  // W8-2A §5-4 原本排除這條(無工地日曆,單看「今天沒日誌」會誤報);
  // 2026-08-19 真人驗收翻案:使用者開口第一句就是「今天的施工日誌我還沒填」,
  // 空狀態卻說「都跟上了」。改為只在「施工已開始的證據」存在時提醒,兩者擇一:
  //   a. 開工錨點涵蓋今天(commencement_date ≤ 今天 ≤ end_date;end 缺值=未設限);
  //   b. 本案已有至少一筆日誌(填過日誌=工地在運作)。
  // 兩者皆無(全新專案)不推,維持原本不誤報的底線;停工日仍可能誤報,
  // 但那需要工地日曆與停工登錄,不在本包(見 W8-2A §5-4 的 2026-08-19 補記)。
  if (org === 'contractor') {
    // log_date 是人填的業務日期字串('YYYY-MM-DD'),直接按字面比對台北日曆日,
    // 不過 Date 轉換——轉換反而會把純日期字串攪進時區問題。
    const hasTodayLog = siteLogs.some((l) => String(l?.log_date || '').slice(0, 10) === todayIso)
    const sinceStart = daysBetween(anchors.commencement_date, todayIso) // 負=已開工
    const untilEnd = daysBetween(anchors.end_date, todayIso)            // null=未設限
    const inWindow = sinceStart != null && sinceStart <= 0 && (untilEnd == null || untilEnd >= 0)
    if (!hasTodayLog && (inWindow || siteLogs.length > 0)) {
      mine.push(task({
        // 日誌沒有法定到期日,不掛 due 假造期限;無 due 者排在期限型待辦之後
        key: `日誌:${todayIso}`, tag: '日誌', title: '今天的施工日誌尚未填寫',
        ball: 'contractor', to: `/site-log?d=${todayIso}`, meta: `今天（${todayIso}）還沒有日誌紀錄`,
      }))
    }
  }

  return {
    mine: mine.sort(byDue),
    waiting: waiting.sort(byDue),
    doneToday: buildDoneToday({ org, todayIso, defects, inspections }),
    setup,
  }
}

// 「今天已完成」:只採可靠的操作時間戳。缺失 closed_at 與查驗 inspected_at 是
// 系統在按下當下寫的;請款日、日誌日期、審定日都是人可回填的業務日期,不算數。
// 估驗核定、變更核准、疑義結案、觀察處理沒有任何完成時間欄位——本包不加 migration,
// 所以誠實地不顯示,不用 created_at 或現在的狀態硬湊。
// 語意是「登入角色所屬陣營今天完成的狀態轉移」,不是個人績效(DB 沒有 closed_by)。
function buildDoneToday({ org, todayIso, defects, inspections }) {
  const rows = []
  for (const d of defects) {
    if (d.status !== '已結案') continue
    if (taipeiISODate(d.closed_at) !== todayIso) continue
    const safety = d.domain === 'safety'
    rows.push({
      ts: new Date(d.closed_at).getTime(),
      task: task({
        key: `已完成缺失:${d.id ?? d.title}`, tag: safety ? '工安缺失' : '缺失', title: d.title,
        // 與 collaborationItems 同一條規則:缺失追蹤已套殼,?defect=<id> 直達該筆(規範 §9.7)
        meta: '監造已結案', ball: 'supervisor', to: detailLink(safety ? '/safety' : '/quality', 'defect', d.id),
      }),
    })
  }
  for (const i of inspections) {
    if (i.status !== '合格' && i.status !== '不合格') continue
    if (taipeiISODate(i.inspected_at) !== todayIso) continue
    rows.push({
      ts: new Date(i.inspected_at).getTime(),
      task: task({
        key: `已完成查驗:${i.id ?? i.title}`, tag: '查驗', title: i.title,
        meta: `監造判定${i.status}`, ball: 'supervisor', to: detailLink('/quality', 'inspection', i.id),
      }),
    })
  }
  return rows
    .filter((r) => r.task.ball === org) // 陣營過濾:別人做完的事不佔我的畫面
    .sort((a, b) => b.ts - a.ts)
    .map((r) => r.task)
}
