// AI 監造報表草稿 — 全確定性（無需後端）。把某月的施工日誌、查驗、缺失、送審彙整成
// 監造視角的報表，並生出一段「監造意見」草稿供監造覆核修改。唯讀：只產草稿，不送出。
import { rainDayCount } from './weatherMetrics.js'

const money = (n) => `NT$ ${Math.round(n || 0).toLocaleString('en-US')}`
const ym = (s) => (s || '').slice(0, 7)

export function buildSupervisorReport(data = {}, monthLabel) {
  const { project = {}, siteLogs = [], inspections = [], defects = [], submittals = [], progress = null } = data
  const M = monthLabel || ym(new Date().toISOString())
  const inM = (d) => ym(d) === M

  // 施工日誌（本月）
  const logs = siteLogs.filter((l) => inM(l.log_date)).sort((a, b) => a.log_date.localeCompare(b.log_date))
  const workDays = logs.length
  const rainDays = rainDayCount(logs) // 與施工月報/AI 助理同源
  const summaries = logs.map((l) => ({ date: l.log_date, text: l.work_summary })).filter((x) => x.text)

  // 查驗辦理（本月申請或本月判定者）
  const insp = inspections.filter((i) => inM(i.requested_date) || inM((i.inspected_at || '').slice(0, 10)))
  const inspPass = insp.filter((i) => i.status === '合格').length
  const inspFail = insp.filter((i) => i.status === '不合格').length
  const inspPending = inspections.filter((i) => i.status === '待查驗').length

  // 缺失督導（現況 + 本月結案）
  const defOpen = defects.filter((d) => d.status !== '已結案')
  const defClosedM = defects.filter((d) => d.status === '已結案' && inM((d.closed_at || '').slice(0, 10)))
  const defOverdue = defOpen.filter((d) => d.due_date && d.due_date < new Date().toISOString().slice(0, 10))

  // 送審審核（本月審定者 + 現況待審）
  const subDecidedM = submittals.filter((s) => inM((s.decided_date || '').slice(0, 10)))
  const subPending = submittals.filter((s) => s.status === '已提送' || s.status === '審核中')

  // 監造意見草稿（依數據套語）
  const behind = progress && progress.plannedPct != null ? progress.plannedPct - progress.actualPct : null
  const opinion = [
    `本月工地施工計 ${workDays} 日（含雨天 ${rainDays} 日），監造人員按日到場查核施工品質與安全衛生。`,
    behind != null
      ? (behind > 5
        ? `累計實際進度 ${progress.actualPct.toFixed(1)}%，較預定 ${progress.plannedPct.toFixed(1)}% 落後 ${behind.toFixed(1)}%，已促請廠商檢討要徑工項並提報趕工計畫。`
        : `累計實際進度 ${progress.actualPct.toFixed(1)}%，與預定 ${progress.plannedPct.toFixed(1)}% 尚屬相當，進度受控。`)
      : '',
    insp.length
      ? `本月辦理查驗 ${insp.length} 件（合格 ${inspPass} 件${inspFail ? `、不合格 ${inspFail} 件，均已開立缺失並追蹤改善` : '，均符合設計圖說與規範'}）。`
      : '本月無新辦理查驗。',
    defOpen.length
      ? `目前未結案缺失 ${defOpen.length} 件${defOverdue.length ? `（其中 ${defOverdue.length} 件已逾改善期限，將發函督促限期改善）` : '，均在改善期限內追蹤'}${defClosedM.length ? `；本月複查結案 ${defClosedM.length} 件` : ''}。`
      : '目前無未結案缺失，品質督導情形良好。',
    subDecidedM.length || subPending.length
      ? `送審文件本月審定 ${subDecidedM.length} 件，尚有 ${subPending.length} 件審核中。`
      : '',
    '整體施工品質尚符合契約與規範要求，將持續落實三級品管抽查與工安巡檢。',
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

export { money as _money }
