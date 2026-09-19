// 監造月報(P6a 起改名;原「監造報表」)— 全確定性(無需後端)。把某月「已簽署」的監造日誌、經已簽署監造查驗表單的
// 判定與監造確認量,連同施工日誌(已簽署)、缺失、送審彙整成監造視角的月報,並生出一段「監造意見」草稿供監造覆核修改。
// 唯讀:只產草稿,不送出。月報不是監造日誌——每日監造紀錄是 /supervisor-log 的監造日誌文件(P3a),這裡只重用其已簽署版本。
// 已簽署與否一律由 lib/fieldDocs.signedVersionIndex 判定(事實列＝指向它的文件最晚一次簽署的版本);未簽署的明列不列入。
// 日誌天數／雨天／查驗判定的歸月規則與施工月報同一份(lib/reportSources.js),兩張月報同一個月份對得上值。
import { taipeiISODate } from './dates.js'
import { splitBySignature, unsignedDays, aggregateDailyLogs, inspectionsOfMonth, confirmationsOfMonth } from './reportSources.js'

const ym = (s) => (s || '').slice(0, 7)

// today 可注入:逾期判斷與月份回退才能用固定日期測試,不吃真時鐘。
// 輸入:siteLogs＋dailyLogIndex(daily_log 的 signedVersionIndex)、supervisorLogs(supervisor_logs 列)＋supervisorLogIndex、
// inspections＋inspectionFormIndex(inspection_form,target=查驗 id)、confirmations(inspection_confirmations 列)、defects、submittals、progress、
// openDocs(store 的活文件:同月尚未簽署、也還沒有事實列的草稿一併列「未簽署、不列入」,與施工月報同一支 unsignedDays)。
export function buildSupervisorReport(data = {}, monthLabel, today = new Date()) {
  const {
    project = {}, siteLogs = [], dailyLogIndex = new Map(), supervisorLogs = [], supervisorLogIndex = new Map(),
    inspections = [], inspectionFormIndex = new Map(), confirmations = [], defects = [], submittals = [], progress = null,
    openDocs = [],
  } = data
  // 業務上的「本月/今天」都取台北日曆日:UTC 在台灣 00:00–08:00 還是前一天
  // (月初凌晨開報表會落回上個月;逾期缺失首日早上不會被列為逾期)。
  const isoToday = taipeiISODate(today)
  const M = monthLabel || ym(isoToday)
  const inM = (d) => ym(d) === M

  // 施工日誌(本月已簽署;天數、雨天與施工月報同源)
  const daily = splitBySignature(siteLogs, dailyLogIndex, { month: M })
  const { workDays, rainDays } = aggregateDailyLogs(daily.signed, [])
  const unsignedOf = (split, docType) => unsignedDays({
    unsignedRows: split.unsigned, signedDates: new Set(split.signed.map((l) => l.log_date)), openDocs, docType, inRange: inM,
  })
  const dailyUnsigned = unsignedOf(daily, 'daily_log')
  const summaries = daily.signed.map((l) => ({ date: l.log_date, text: l.work_summary })).filter((x) => x.text)

  // 監造日誌(本月已簽署):到場＝到場人員非空(不適用時事實列為空陣列,簽署分支已強制)
  const sup = splitBySignature(supervisorLogs, supervisorLogIndex, { month: M })
  const supUnsigned = unsignedOf(sup, 'supervisor_log')
  const attendedDays = sup.signed.filter((l) => Array.isArray(l.attendance) && l.attendance.length > 0).length

  // 查驗:本月申請或本月判定;判定只列經已簽署監造查驗表單者,快速判定明列不列入
  const insp = inspectionsOfMonth(inspections, M, inspectionFormIndex)
  // 監造確認量:本月確認／本月撤銷
  const conf = confirmationsOfMonth(confirmations, M)

  // 缺失督導（現況 + 本月結案）
  const defOpen = defects.filter((d) => d.status !== '已結案')
  const defClosedM = defects.filter((d) => d.status === '已結案' && inM(taipeiISODate(d.closed_at)))
  const defOverdue = defOpen.filter((d) => d.due_date && d.due_date < isoToday)
  const defNoDue = defOpen.filter((d) => !d.due_date)

  // 送審審核（本月審定者 + 現況待審）
  const subDecidedM = submittals.filter((s) => inM((s.decided_date || '').slice(0, 10)))
  const subPending = submittals.filter((s) => s.status === '已提送' || s.status === '審核中')

  // 監造意見草稿:只寫資料能支持的數量與現況;「品質符合、已促請」等判斷由監造填(W04)。
  // 沒有對應紀錄的地方放「請補充…」,不預填肯定句——有免責提示也擋不住漏改後交付。
  const behind = progress && progress.plannedPct != null ? progress.plannedPct - progress.actualPct : null
  const asOf = progress?.asOf ? `截至 ${progress.asOf} ` : '' // 進度數字截至何日(D-024),沒帶就不加字
  const opinion = [
    `本月已簽署施工日誌計 ${workDays} 日（含雨天 ${rainDays} 日）；`,
    sup.signed.length
      ? `本月已簽署監造日誌 ${sup.signed.length} 份（監造到場 ${attendedDays} 日）${supUnsigned.length ? `，另 ${supUnsigned.length} 份未簽署、不列入` : ''}。`
      : '本月尚無已簽署監造日誌，監造到場查核日數與情形請依監造日誌補充。',
    behind != null
      ? (behind > 5
        ? `${asOf}累計實際進度 ${progress.actualPct.toFixed(1)}%，較預定 ${progress.plannedPct.toFixed(1)}% 落後 ${behind.toFixed(1)}%；是否已通知廠商提報趕工計畫及其回覆，請補充。`
        : `${asOf}累計實際進度 ${progress.actualPct.toFixed(1)}%，與預定 ${progress.plannedPct.toFixed(1)}% 差距 ${Math.abs(behind).toFixed(1)}%。`)
      : '',
    insp.signed.length
      ? `本月經簽署監造查驗表單判定 ${insp.signed.length} 件（合格 ${insp.pass} 件${insp.partial ? `、部分合格 ${insp.partial} 件` : ''}${insp.fail ? `、不合格 ${insp.fail} 件` : ''}${insp.partial || insp.fail ? '，系統已開立缺失' : ''}${insp.pendingNow ? `；另有 ${insp.pendingNow} 件待查驗` : ''}）。`
      : `本月無經簽署監造查驗表單的判定${insp.pendingNow ? `（另有 ${insp.pendingNow} 件待查驗）` : ''}。`,
    insp.unsigned.length ? `另 ${insp.unsigned.length} 件判定未經簽署查驗表單，不列入本月判定與確認量。` : '',
    conf.confirmed.length || conf.revoked.length
      ? `本月寫入監造確認紀錄 ${conf.confirmed.length} 筆${conf.revoked.length ? `、撤銷 ${conf.revoked.length} 筆` : ''}。`
      : '',
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
    logs: { workDays, rainDays, summaries, unsigned: dailyUnsigned },
    supervisorLogs: { signed: sup.signed, unsigned: supUnsigned, attendedDays },
    inspections: {
      list: insp.signed, total: insp.signed.length, pass: insp.pass, partial: insp.partial, fail: insp.fail,
      pending: insp.pendingNow, unsigned: insp.unsigned,
    },
    confirmations: conf,
    defects: { open: defOpen, openCount: defOpen.length, overdue: defOverdue.length, closedThisMonth: defClosedM.length },
    submittals: { decided: subDecidedM, decidedCount: subDecidedM.length, pending: subPending.length },
    opinion,
  }
}
