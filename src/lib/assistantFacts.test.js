import { describe, it, expect } from 'vitest'
import { buildAssistantFacts, SOURCE_ROUTES } from './assistantFacts.js'

const TODAY = new Date('2026-07-13T00:00:00')

describe('buildAssistantFacts(copilot 事實快照)', () => {
  it('每個模組恆在(有無資料都列 has 旗標)——這是修 R4 P2-03 跨模組彙整的關鍵', () => {
    const f = buildAssistantFacts({}, TODAY)
    for (const k of ['進度', '金流', '品質', '工安', '送審', '工程疑義', '變更設計', '驗收', '契約義務']) {
      expect(f[k]).toBeDefined()
      expect(f[k].has).toBe(false) // 空專案:每區都在、都標無資料
    }
    expect(f.可引用路由).toBe(SOURCE_ROUTES)
  })

  it('彙整多模組資料:金流逐期/未收款、品質缺失分domain、契約逾期、待我處理', () => {
    const f = buildAssistantFacts({
      org: 'supervisor',
      progress: { actualPct: 20.04, plannedPct: 26.6 },
      finance: { billableTotal: 721364067, actualCum: 10339 },
      valuations: [
        { period_no: 1, status: '已核定', invoice_date: '2026-07-10', paid_date: null, paid_amount: null },
        { period_no: 2, status: '草稿' },
      ],
      defects: [
        { title: '蜂窩', status: '開立', domain: 'quality', due_date: '2026-07-01' },
        { title: '未掛安全網', status: '改善中', domain: 'safety' },
        { title: '已修', status: '已結案', domain: 'quality' },
      ],
      obligations: [{ title: '投保', status: '待辦', trigger_event: 'fixed', fixed_date: '2026-07-01', penalty: '扣款' }],
      submittals: [{ submittal_no: 'SUB-001', title: '施工計畫', status: '審核中' }],
      myItems: [{ tag: '送審', title: 'SUB-001 施工計畫', meta: '待監造審定', to: '/submittals' }],
    }, TODAY)

    expect(f.進度.落後百分比).toBe(6.6)
    expect(f.金流.已請款未收款期).toEqual([1])
    expect(f.品質.未結缺失).toBe(1)      // quality domain, 未結案
    expect(f.品質.逾期缺失).toBe(1)
    expect(f.工安.未結工安缺失).toBe(1)  // safety domain
    expect(f.契約義務.逾期).toBe(1)
    expect(f.送審.待審).toBe(1)
    expect(f.待我處理).toHaveLength(1)
    expect(f.待我處理[0]).toMatchObject({ 類型: '送審', 狀態: '待監造審定', 連結: '/submittals' })
  })

  it('未設期限的未結缺失單獨計數(供 AI 誠實說「未評估」而非「期限內」)', () => {
    const f = buildAssistantFacts({
      defects: [{ title: '無期限', status: '開立', domain: 'quality' }],
    }, TODAY)
    expect(f.品質.未設期限缺失).toBe(1)
    expect(f.品質.逾期缺失).toBe(0)
  })
})
