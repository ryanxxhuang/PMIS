// W8-3A:初始化四步清單的完成條件(D-014)。這支測試的存在理由是釘住一條產品紅線——
// 第 3 步只問「AI 整理完了沒」,永遠不看 Requirement 的待審／核定數。
// 那 106 筆是 AI 的產出,不是人要清空的初始化門檻,也不得擋住開啟正式模式。
import { describe, it, expect } from 'vitest'
import { buildSetupSteps } from './Dashboard.jsx'

const ALL_ORGS = new Set(['contractor', 'supervisor', 'owner'])
const snapOf = (over = {}) => ({
  orgs: ALL_ORGS, membersError: null,
  docs: 3, docsError: null,
  ingestionCompleted: 0, ingestionError: null,
  ...over,
})
const stepOf = (snap, opts) => buildSetupSteps(snap, opts)

describe('第 3 步:AI 整理契約重點', () => {
  it('有 completed run + 106 筆待審 + 0 筆核定 → 仍算完成', () => {
    // reqPending / reqApproved 刻意一起傳進來:即使呼叫端塞了這些欄位也不得被採用
    const [, , step3] = stepOf(snapOf({ ingestionCompleted: 1, reqPending: 106, reqApproved: 0 }), { imported: true })
    expect(step3.done).toBe(true)
    expect(step3.to).toBe('/requirements')
    expect(step3.detail).toContain('AI 已完成整理')
    expect(step3.detail).toContain('不影響開啟正式模式')
    // 不得再顯示待審數量製造清空壓力
    expect(step3.detail).not.toMatch(/待審|106|核定 \d/)
  })

  it('沒有 completed run,即使已有 approved Requirement → 仍未完成並回專案文件', () => {
    const [, , step3] = stepOf(snapOf({ ingestionCompleted: 0, reqPending: 0, reqApproved: 12 }), { imported: true })
    expect(step3.done).toBe(false)
    expect(step3.to).toBe('/contract')
    expect(step3.detail).toContain('尚未有完成的整理')
  })

  it('completed run 但擷取 0 筆 Requirement → 仍算完成(AI 讀完沒找到,不是假失敗)', () => {
    const [, , step3] = stepOf(snapOf({ ingestionCompleted: 1, reqPending: 0, reqApproved: 0 }), { imported: true })
    expect(step3.done).toBe(true)
  })

  it('ingestion 查詢失敗 → 如實說載入失敗,不偽裝成「尚未開始」', () => {
    const [, , step3] = stepOf(snapOf({ ingestionError: { message: 'network' } }), { imported: true })
    expect(step3.done).toBe(false)
    expect(step3.detail).toBe('狀態載入失敗，前往專案文件查看')
    expect(step3.to).toBe('/contract')
  })

  it('責任方是系統,不是某個人', () => {
    expect(stepOf(snapOf(), { imported: true })[2].owner).toBe('系統自動')
  })
})

describe('第 1 步:文件與標單', () => {
  it('文件 ≥1 且標單已匯入才完成', () => {
    expect(stepOf(snapOf({ docs: 1 }), { imported: true })[0].done).toBe(true)
    expect(stepOf(snapOf({ docs: 0 }), { imported: true })[0].done).toBe(false)
    expect(stepOf(snapOf({ docs: 3 }), { imported: false })[0].done).toBe(false)
  })
  it('文件查詢失敗 → 說載入失敗,不當成 0 件', () => {
    const step1 = stepOf(snapOf({ docsError: { message: 'network' } }), { imported: true })[0]
    expect(step1.done).toBe(false)
    expect(step1.detail).toBe('狀態載入失敗，前往專案文件查看')
  })
})

describe('第 2 步:三方成員', () => {
  it('三方到齊才完成;缺哪方要講出來', () => {
    expect(stepOf(snapOf(), { imported: true })[1].done).toBe(true)
    const partial = stepOf(snapOf({ orgs: new Set(['contractor']) }), { imported: true })[1]
    expect(partial.done).toBe(false)
    expect(partial.detail).toContain('監造')
    expect(partial.detail).toContain('機關')
  })
  it('成員載入失敗不得偽裝成「尚缺三方」', () => {
    const step2 = stepOf(snapOf({ orgs: new Set(), membersError: '成員載入失敗' }), { imported: true })[1]
    expect(step2.done).toBe(false)
    expect(step2.detail).toContain('成員載入失敗')
  })
})

describe('第 4 步:開啟正式模式不被前面步驟鎖住', () => {
  it('固定未完成、目的地是成員頁,且文案不得宣稱三方到齊才能開', () => {
    for (const snap of [null, snapOf({ docs: 0, orgs: new Set(), ingestionCompleted: 0 })]) {
      const step4 = stepOf(snap, { imported: false })[3]
      expect(step4.done).toBe(false)
      expect(step4.to).toBe('/members')
      expect(step4.detail).toContain('也可以開啟')
      expect(step4.detail).not.toMatch(/三方到齊後.{0,4}才/)
    }
  })
})

describe('清單結構與下一步', () => {
  it('永遠四步,每步都有責任方與唯一目的地', () => {
    const steps = stepOf(snapOf(), { imported: true })
    expect(steps).toHaveLength(4)
    for (const s of steps) {
      expect(s.owner).toBeTruthy()
      expect(s.to).toMatch(/^\/(contract|members|requirements)$/)
      expect(typeof s.done).toBe('boolean')
    }
  })
  it('載入中不謊報完成', () => {
    expect(stepOf(null, { imported: true }).every((s) => s.done === false)).toBe(true)
    expect(stepOf(null, { imported: true }).every((s) => s.detail === '載入中…' || s.to === '/members')).toBe(true)
  })
  it('下一步取前 3 步第一個未完成;前三步都完成時指向第 4 步', () => {
    const pick = (snap, opts) => {
      const steps = stepOf(snap, opts)
      return steps.slice(0, 3).find((s) => !s.done) || steps[3]
    }
    expect(pick(snapOf({ docs: 0 }), { imported: false }).label).toBe('上傳專案文件與標單')
    expect(pick(snapOf({ orgs: new Set(['contractor']) }), { imported: true }).label).toBe('確認三方成員')
    expect(pick(snapOf(), { imported: true }).label).toBe('AI 整理契約重點')
    expect(pick(snapOf({ ingestionCompleted: 2 }), { imported: true }).label).toBe('開啟正式模式')
  })
})
