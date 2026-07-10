import { describe, it, expect } from 'vitest'
import { itpStatus, itpActivity, itpAlerts } from './itp.js'

const logs = [{ items: { K1: 5, K2: 0 } }, { items: { K3: 2 } }]

describe('itpStatus', () => {
  it('未連結查驗 → pending', () => {
    expect(itpStatus({ inspection_id: null }, []).key).toBe('pending')
  })
  it('連結的查驗被刪除 → 視同 pending', () => {
    expect(itpStatus({ inspection_id: 'X' }, []).key).toBe('pending')
  })
  it('待查驗 → requested;合格 → passed;不合格 → failed', () => {
    const insp = (status) => [{ id: 'I1', status }]
    expect(itpStatus({ inspection_id: 'I1' }, insp('待查驗')).key).toBe('requested')
    expect(itpStatus({ inspection_id: 'I1' }, insp('合格')).key).toBe('passed')
    expect(itpStatus({ inspection_id: 'I1' }, insp('不合格')).key).toBe('failed')
  })
})

describe('itpActivity', () => {
  it('日誌有該工項數量 → true;數量 0 或無工項 → false', () => {
    expect(itpActivity({ work_item_key: 'K1' }, logs)).toBe(true)
    expect(itpActivity({ work_item_key: 'K2' }, logs)).toBe(false)
    expect(itpActivity({ work_item_key: null }, logs)).toBe(false)
  })
})

describe('itpAlerts', () => {
  const mk = (type, key, inspId = null) => ({ point_type: type, title: `${type}點`, work_item_key: key, inspection_id: inspId })

  it('H 點施作中未叫驗 → overdue;W 點 → soon;R 點不告警', () => {
    const alerts = itpAlerts([mk('H', 'K1'), mk('W', 'K3'), mk('R', 'K1')], [], logs)
    expect(alerts).toHaveLength(2)
    expect(alerts[0].level).toBe('overdue')
    expect(alerts[0].title).toContain('不申請查驗' === '' ? '' : 'H')
    expect(alerts[1].level).toBe('soon')
  })

  it('已申請/已通過的點不再告警;未施作的點不告警', () => {
    const insp = [{ id: 'I1', status: '待查驗' }]
    expect(itpAlerts([mk('H', 'K1', 'I1')], insp, logs)).toHaveLength(0)
    expect(itpAlerts([mk('H', 'K9')], [], logs)).toHaveLength(0)
  })
})
