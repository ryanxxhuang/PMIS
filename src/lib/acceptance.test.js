import { describe, it, expect } from 'vitest'
import { deriveAcceptance, needsFixFlow, acceptanceAlerts, acceptanceStageSummary, ACCEPTANCE_STAGES } from './acceptance.js'

const T = (s) => new Date(`${s}T12:00:00`) // 正午避免時區邊界

describe('deriveAcceptance', () => {
  it('無事件時全部 pending、無期限', () => {
    const stages = deriveAcceptance([], T('2026-07-09'))
    expect(stages).toHaveLength(ACCEPTANCE_STAGES.length)
    expect(stages.every((s) => s.state === 'pending')).toBe(true)
  })

  it('報竣後:竣工確認 7 日期限起算', () => {
    const stages = deriveAcceptance([{ stage_key: 'report', event_date: '2026-07-01' }], T('2026-07-05'))
    const confirm = stages.find((s) => s.key === 'confirm')
    expect(confirm.due).toBe('2026-07-08')
    expect(confirm.state).toBe('due')
    expect(confirm.daysLeft).toBe(3)
    expect(confirm.overdue).toBe(false)
  })

  it('竣工確認逾期:超過 7 日未辦 → overdue', () => {
    const stages = deriveAcceptance([{ stage_key: 'report', event_date: '2026-07-01' }], T('2026-07-12'))
    const confirm = stages.find((s) => s.key === 'confirm')
    expect(confirm.overdue).toBe(true)
    expect(confirm.daysLeft).toBe(-4)
  })

  it('初驗 30 日自竣工確認起算;正驗 20 日自初驗起算', () => {
    const events = [
      { stage_key: 'report', event_date: '2026-06-01' },
      { stage_key: 'confirm', event_date: '2026-06-05' },
      { stage_key: 'initial', event_date: '2026-06-20', result: '合格' },
    ]
    const stages = deriveAcceptance(events, T('2026-07-01'))
    expect(stages.find((s) => s.key === 'initial').due).toBe('2026-07-05')
    expect(stages.find((s) => s.key === 'initial').state).toBe('done')
    const final = stages.find((s) => s.key === 'final')
    expect(final.due).toBe('2026-07-10')
    expect(final.daysLeft).toBe(9)
  })

  it('已完成的階段不再算 daysLeft', () => {
    const stages = deriveAcceptance([
      { stage_key: 'report', event_date: '2026-07-01' },
      { stage_key: 'confirm', event_date: '2026-07-03' },
    ], T('2026-07-20'))
    const confirm = stages.find((s) => s.key === 'confirm')
    expect(confirm.state).toBe('done')
    expect(confirm.daysLeft).toBe(null)
    expect(confirm.overdue).toBe(false)
  })
})

describe('needsFixFlow / acceptanceAlerts', () => {
  it('初驗不合格才走缺失改善/複驗', () => {
    expect(needsFixFlow([{ stage_key: 'initial', event_date: '2026-07-01', result: '不合格' }])).toBe(true)
    expect(needsFixFlow([{ stage_key: 'initial', event_date: '2026-07-01', result: '合格' }])).toBe(false)
    expect(needsFixFlow([])).toBe(false)
  })

  it('alerts:7 日內 soon、逾期 overdue;optional 階段預設不出現', () => {
    const events = [{ stage_key: 'report', event_date: '2026-07-01' }]
    const soon = acceptanceAlerts(events, T('2026-07-05'))
    expect(soon).toHaveLength(1)
    expect(soon[0].level).toBe('soon')
    expect(soon[0].stage).toBe('confirm')
    const overdue = acceptanceAlerts(events, T('2026-07-20'))
    expect(overdue[0].level).toBe('overdue')
    expect(overdue.find((a) => a.stage === 'fix')).toBeUndefined()
  })

  it('初驗合格後正驗期限進 alerts', () => {
    const events = [
      { stage_key: 'report', event_date: '2026-06-01' },
      { stage_key: 'confirm', event_date: '2026-06-03' },
      { stage_key: 'initial', event_date: '2026-06-10', result: '合格' },
    ]
    const alerts = acceptanceAlerts(events, T('2026-06-28'))
    const final = alerts.find((a) => a.stage === 'final')
    expect(final).toBeTruthy()
    expect(final.level).toBe('soon') // 6/30 到期,還有 2 天
  })
})

describe('acceptanceStageSummary', () => {
  it('無事件 → null(尚未進入驗收程序)', () => {
    expect(acceptanceStageSummary([])).toBe(null)
  })

  it('進行中:顯示下一個未完成階段', () => {
    const s = acceptanceStageSummary([{ stage_key: 'report', event_date: '2026-07-01' }])
    expect(s.label).toContain('竣工確認')
    expect(s.done).toBe(1)
  })

  it('合格流程全走完 → 結案(保固中)', () => {
    const events = ['report', 'confirm', 'initial', 'final', 'certificate', 'warranty']
      .map((k) => ({ stage_key: k, event_date: '2026-07-01', result: k === 'initial' ? '合格' : null }))
    const s = acceptanceStageSummary(events)
    expect(s.finished).toBe(true)
    expect(s.label).toContain('保固')
  })
})
