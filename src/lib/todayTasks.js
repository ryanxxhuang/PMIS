// 今日待辦的單一聚合(W8-2B)。三段:現在輪到我 / 等待對方 / 今天已完成。
// Dashboard 與提醒中心都吃這一份 —— W8-2A §2.5 盤到的兩套前端規則
// (ballInCourt 的協作項、Alerts 內嵌的期限)在這裡合流,不再各寫一套。
//
// 紅線(W8-2A §4、§7):
//   1. 只由既有業務狀態推導;不建 task 資料表、不建 workflow engine。
//   2. AI 草稿(agent_actions)與未核定 Requirement 永遠不進來——本函式
//      根本不收這兩種輸入,是結構上的保證,不是靠呼叫端自律。
//   3. 只有「登入角色在目的頁真的能完成」的事才進 mine:期限「已提送」鈕
//      在 /contract 由 can.edit 控制,所以只有廠商責任的義務算待辦;
//      監造／機關責任的義務留在專案文件頁,不包裝成做不到的假待辦。
//   4. 「今天已完成」只採可靠的操作時間戳(closed_at / inspected_at),
//      不把可回填的業務日期(請款日/日誌日期/審定日)當成「今天按下完成」。
import { collaborationItems } from './ballInCourt.js'
import { parseLocalDate, taipeiISODate, localISODate } from './dates.js'
import { computeObligationDue } from './contractDue.js'
import { sampleAlerts } from './qc.js'
import { acceptanceAlerts, deriveAcceptance, ACCEPTANCE_STAGE_ORGS } from './acceptance.js'
import { itpAlerts } from './itp.js'

// 專案角色只有三方(D-002)。design 不是角色,設計釋疑由監造轉呈。
export const ORG_SIDES = Object.freeze(['contractor', 'supervisor', 'owner'])

// 契約義務 responsible → 專案角色。精確白名單:null、空字串、其他與未知文字
// 一律視為「未指定」,不歸給任何角色。伺服器 collectOpenBallItems 目前是
// 「無法辨識就歸廠商」,那個預設不可複製到前端(會把不明義務塞進廠商待辦)。
export const RESPONSIBLE_SIDE = Object.freeze({ 廠商: 'contractor', 監造: 'supervisor', 機關: 'owner' })

// 期限「已提送」在契約重點頁完成(W11 遷入;狀態鈕吃 can_write 鏡像):
// 廠商與監造都能對自己責任的期限動作;機關唯讀(can_write 擋機關),
// 機關責任的期限不進 mine——做不到的事不製造假待辦。
export const OBLIGATION_ACTIONABLE_SIDES = Object.freeze(['contractor', 'supervisor'])

// 「等待對方」只列與登入角色有直接對手關係的類型(W8-2A §3.2、§5-7)——
// 首頁不是全案未結項的傾印場,列完所有別人的事只會讓頁面再變長。
export const WAITING_SCOPE = Object.freeze({
  contractor: {
    送審: ['supervisor'], 估驗: ['supervisor', 'owner'], 疑義: ['supervisor'],
    缺失: ['supervisor'], 工安缺失: ['supervisor'], 變更: ['supervisor', 'owner'],
  },
  supervisor: {
    缺失: ['contractor'], 工安缺失: ['contractor'], 送審: ['contractor'],
    疑義: ['contractor'], 變更: ['owner'],
  },
  owner: {
    估驗: ['contractor'], 缺失: ['contractor'], 工安缺失: ['contractor'], 送審: ['supervisor'],
  },
})

// 期限型項目只列「已逾期」與 N 日內到期,沿用提醒中心既有門檻。
const SOON_DAYS = 7

// taipeiISODate 已抽到 dates.js 當全站業務日期的單一真相;這裡 re-export
// 維持既有 import 路徑(useTodayTasks / Dashboard / 測試)不動。
export { taipeiISODate }

const isoToUTC = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null
}

// 兩個 'YYYY-MM-DD' 的日差(正=dueIso 在 todayIso 之後)。純字串運算,
// 不受執行環境時區影響——測試才能用固定 today 斷言逾期天數。
export function daysBetween(dueIso, todayIso) {
  const a = isoToUTC(dueIso), b = isoToUTC(todayIso)
  return a == null || b == null ? null : Math.round((a - b) / 86400000)
}

const dueText = (days, dueIso) => (days < 0
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

// 每筆待辦:{ key, tag, title, meta, ball, due, overdueDays, to }。
// meta 是給人看的唯一狀態句(球權標籤＋到期／罰則),UI 不再自己算日期。
function task({ key, tag, title, meta, ball, to, due = null, todayIso = null }) {
  const days = due && todayIso ? daysBetween(due, todayIso) : null
  return {
    key, tag, title: title || '（未命名）', meta, ball, to,
    due: due || null,
    overdueDays: days != null && days < 0 ? -days : null,
  }
}

export function buildTodayTasks(input = {}) {
  const {
    org, today = new Date(), anchors = {},
    rfis = [], submittals = [], valuations = [], defects = [], inspections = [],
    observations = [], changeOrders = [], obligations = [], testSamples = [],
    acceptanceEvents = [], inspectionPoints = [], siteLogs = [],
  } = input
  const todayIso = taipeiISODate(today)
  // 期限引擎(sampleAlerts / acceptanceAlerts / computeObligationDue)都用 Date 相減再
  // Math.round 算日差,傳含時間的「現在」會把整整 8 個日曆日壓成 7 —— 台北晚上開頁時,
  // 還有 8 天的試驗會被列進「7 日內」,而畫面上的天數(由日期字串算)卻寫 8 天。
  // 統一先正規化成「台北日曆日的本地午夜」,三個引擎與畫面才會是同一天。
  const todayLocal = parseLocalDate(todayIso) || new Date(today)
  const mine = []
  const waiting = []

  // ── ① 協作項(疑義／送審／估驗／查驗／缺失／觀察／變更)────────────────
  const waitingScope = WAITING_SCOPE[org] || {}
  collaborationItems({ rfis, submittals, valuations, defects, inspections, observations, changeOrders })
    .forEach((it, i) => {
      // observations.assigned_to 是自由文字欄:落不進三方就是「未指定」,
      // 不硬塞給任何角色(硬塞＝製造別人做不到的待辦)。
      if (!ORG_SIDES.includes(it.who)) return
      const days = it.due ? daysBetween(it.due, todayIso) : null
      const t = task({
        key: `${it.tag}:${it.id ?? `${it.title}#${i}`}`,
        tag: it.tag, title: it.title, ball: it.who, to: it.to, due: it.due, todayIso,
        meta: days != null && days <= SOON_DAYS ? `${it.meta}・${dueText(days, it.due)}` : it.meta,
      })
      if (it.who === org) mine.push(t)
      else if ((waitingScope[it.tag] || []).includes(it.who)) waiting.push(t)
    })

  // ── ② 契約期限(自己責任、且自己在 /requirements 真的能完成的才算待辦)──
  if (OBLIGATION_ACTIONABLE_SIDES.includes(org)) {
    for (const ob of obligations) {
      if (ob.status === '已提送' || ob.status === '已完成') continue
      if (RESPONSIBLE_SIDE[String(ob.responsible ?? '').trim()] !== org) continue
      const dueIso = localISODate(computeObligationDue(ob, anchors, todayLocal))
      if (!dueIso) continue
      const days = daysBetween(dueIso, todayIso)
      if (days == null || days > SOON_DAYS) continue
      mine.push(task({
        key: `契約:${ob.id ?? ob.title}`, tag: '契約重點', title: ob.title, ball: org,
        to: '/requirements', due: dueIso, todayIso,
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
        ball: 'contractor', to: '/quality', due: a.due, todayIso,
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
        ball: org, to: '/acceptance', due: dueByStage.get(a.stage) || null, todayIso,
      }))
    }
  }

  // ── ⑤ ITP 停留點(施作中未叫驗,球在廠商)────────────────────────────
  if (org === 'contractor') {
    for (const a of itpAlerts(inspectionPoints, inspections, siteLogs)) {
      mine.push(task({
        key: `停留點:${a.point.id ?? a.point.title}`, tag: '停留點', title: a.title, meta: a.meta,
        ball: 'contractor', to: '/itp',
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
        ball: 'contractor', to: '/site-log', meta: `今天（${todayIso}）還沒有日誌紀錄`,
      }))
    }
  }

  return {
    mine: mine.sort(byDue),
    waiting: waiting.sort(byDue),
    doneToday: buildDoneToday({ org, todayIso, defects, inspections }),
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
        meta: '監造已結案', ball: 'supervisor', to: safety ? '/safety' : '/quality',
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
        meta: `監造判定${i.status}`, ball: 'supervisor', to: '/quality',
      }),
    })
  }
  return rows
    .filter((r) => r.task.ball === org) // 陣營過濾:別人做完的事不佔我的畫面
    .sort((a, b) => b.ts - a.ts)
    .map((r) => r.task)
}
