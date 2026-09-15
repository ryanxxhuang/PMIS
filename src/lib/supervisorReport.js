// AI 監造報表草稿 — 全確定性（無需後端）。把某月的施工日誌、查驗、缺失、送審彙整成
// 監造視角的報表，並生出一段「監造意見」草稿供監造覆核修改。唯讀：只產草稿，不送出。
import { rainDayCount } from './weatherMetrics.js'
import { taipeiISODate } from './dates.js'

const ym = (s) => (s || '').slice(0, 7)

// today 可注入:逾期判斷與月份回退才能用固定日期測試,不吃真時鐘。
export function buildSupervisorReport(data = {}, monthLabel, today = new Date()) {
  const { project = {}, siteLogs = [], inspections = [], defects = [], submittals = [], progress = null } = data
  // 業務上的「本月/今天」都取台北日曆日:UTC 在台灣 00:00–08:00 還是前一天
  // (月初凌晨開報表會落回上個月;逾期缺失首日早上不會被列為逾期)。
  const isoToday = taipeiISODate(today)
  const M = monthLabel || ym(isoToday)
  const inM = (d) => ym(d) === M

  // 施工日誌（本月）
  const logs = siteLogs.filter((l) => inM(l.log_date)).sort((a, b) => a.log_date.localeCompare(b.log_date))
  const workDays = logs.length
  const rainDays = rainDayCount(logs) // 與施工月報/AI 助理同源
  const summaries = logs.map((l) => ({ date: l.log_date, text: l.work_summary })).filter((x) => x.text)

  // 查驗辦理（本月申請或本月判定者）。inspected_at / closed_at 是 timestamptz(UTC),
  // 直接 slice 取到的是 UTC 日,月初 00:00–08:00 的判定/結案會被歸到上個月。
  const insp = inspections.filter((i) => inM(i.requested_date) || inM(taipeiISODate(i.inspected_at)))
  const inspPass = insp.filter((i) => i.status === '合格').length
  const inspFail = insp.filter((i) => i.status === '不合格').length
  const inspPending = inspections.filter((i) => i.status === '待查驗').length

  // 缺失督導（現況 + 本月結案）
  const defOpen = defects.filter((d) => d.status !== '已結案')
  const defClosedM = defects.filter((d) => d.status === '已結案' && inM(taipeiISODate(d.closed_at)))
  const defOverdue = defOpen.filter((d) => d.due_date && d.due_date < isoToday)
  const defNoDue = defOpen.filter((d) => !d.due_date)

  // 送審審核（本月審定者 + 現況待審）
  const subDecidedM = submittals.filter((s) => inM((s.decided_date || '').slice(0, 10)))
  const subPending = submittals.filter((s) => s.status === '已提送' || s.status === '審核中')

  // 監造意見草稿:只寫資料能支持的數量與現況;「已到場、已促請、品質符合」等判斷由監造填(W04)。
  // 沒有對應紀錄的地方放「請補充…」,不預填肯定句——有免責提示也擋不住漏改後交付。
  const behind = progress && progress.plannedPct != null ? progress.plannedPct - progress.actualPct : null
  const opinion = [
    `本月施工日誌計 ${workDays} 日（含雨天 ${rainDays} 日）；監造到場查核日數與情形請依監造日誌補充。`,
    behind != null
      ? (behind > 5
        ? `累計實際進度 ${progress.actualPct.toFixed(1)}%，較預定 ${progress.plannedPct.toFixed(1)}% 落後 ${behind.toFixed(1)}%；是否已通知廠商提報趕工計畫及其回覆，請補充。`
        : `累計實際進度 ${progress.actualPct.toFixed(1)}%，與預定 ${progress.plannedPct.toFixed(1)}% 差距 ${Math.abs(behind).toFixed(1)}%。`)
      : '',
    insp.length
      ? `本月辦理查驗 ${insp.length} 件（合格 ${inspPass} 件${inspFail ? `、不合格 ${inspFail} 件，系統已開立缺失` : ''}${inspPending ? `；另有 ${inspPending} 件待查驗` : ''}）。`
      : '本月無新辦理查驗。',
    defOpen.length
      // 最小證據原則(R3 P1-06):未設期限的缺失不得宣稱「期限內」——那是錯誤安全感
      ? `目前未結案缺失 ${defOpen.length} 件${defOverdue.length
          ? `（其中 ${defOverdue.length} 件已逾改善期限，督促情形請補充）`
          : defNoDue.length
            ? `（其中 ${defNoDue.length} 件未設改善期限，請補訂期限後追蹤）`
            : '，尚在改善期限內'}${defClosedM.length ? `；本月複查結案 ${defClosedM.length} 件` : ''}。`
      : '目前無未結案缺失。',
    subDecidedM.length || subPending.length
      ? `送審文件本月審定 ${subDecidedM.length} 件，尚有 ${subPending.length} 件審核中。`
      : '',
    '整體品質評述請由監造依本月查核結果填寫。',
  ].filter(Boolean).join('')

  return {
    monthLabel: M, project, progress,
    logs: { workDays, rainDays, summaries },
    inspections: { list: insp, total: insp.length, pass: inspPass, fail: inspFail, pending: inspPending },
    defects: { open: defOpen, openCount: defOpen.length, overdue: defOverdue.length, closedThisMonth: defClosedM.length },
    submittals: { decided: subDecidedM, decidedCount: subDecidedM.length, pending: subPending.length },
    opinion,
  }
}
