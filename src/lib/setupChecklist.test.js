// W8-3A:初始化清單的完成條件(D-014;D-020 後補第 4 步「設定開工日」成五步)。
// 這支測試的存在理由是釘住一條產品紅線——第 3 步只問「AI 整理完了沒」,
// 永遠不看 Requirement 的待審／核定數。那 106 筆是 AI 的產出,不是人要清空的
// 初始化門檻,也不得擋住開啟正式模式。
import { describe, it, expect } from 'vitest'
import { buildSetupSteps } from './setupChecklist.js'

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

describe('第 4 步:設定開工日(D-020)', () => {
  it('有開工日即完成,detail 回顯日期;目的地是履約時程頁', () => {
    const step = stepOf(snapOf(), { imported: true, commencement: '2026-09-15' })[3]
    expect(step.done).toBe(true)
    expect(step.to).toBe('/requirements')
    expect(step.detail).toContain('2026-09-15')
  })
  it('未設且有義務在等 → 講出等待條數,不空泛催辦', () => {
    const step = stepOf(snapOf(), { imported: true, waitingOnCommencement: 23 })[3]
    expect(step.done).toBe(false)
    expect(step.detail).toContain('23 條')
    expect(step.detail).toContain('開工日')
  })
  it('未設也沒有義務在等 → 指引語,不捏造數字', () => {
    const step = stepOf(snapOf(), { imported: true })[3]
    expect(step.done).toBe(false)
    expect(step.detail).not.toMatch(/\d+ 條/)
    expect(step.detail).toContain('實際開工日')
  })
})

describe('第 5 步:開啟正式模式不被前面步驟鎖住', () => {
  it('固定未完成、目的地是成員頁,且文案不得宣稱三方到齊才能開', () => {
    for (const snap of [null, snapOf({ docs: 0, orgs: new Set(), ingestionCompleted: 0 })]) {
      const step5 = stepOf(snap, { imported: false })[4]
      expect(step5.done).toBe(false)
      expect(step5.to).toBe('/members')
      expect(step5.detail).toContain('也可以開啟')
      expect(step5.detail).not.toMatch(/三方到齊後.{0,4}才/)
    }
  })
})

describe('清單結構與下一步', () => {
  it('永遠五步,每步都有責任方與唯一目的地', () => {
    const steps = stepOf(snapOf(), { imported: true })
    expect(steps).toHaveLength(5)
    for (const s of steps) {
      expect(s.owner).toBeTruthy()
      expect(s.to).toMatch(/^\/(contract|members|requirements)$/)
      expect(typeof s.done).toBe('boolean')
    }
  })
  it('載入中不謊報完成', () => {
    expect(stepOf(null, { imported: true }).every((s) => s.done === false)).toBe(true)
    // 開工日步驟不吃 snap(素材來自 store),載入中照樣顯示指引而非「載入中…」
    expect(stepOf(null, { imported: true }).every(
      (s) => s.detail === '載入中…' || s.to === '/members' || s.label === '設定開工日',
    )).toBe(true)
  })
  it('下一步取前 4 步第一個未完成;都完成時指向第 5 步', () => {
    const pick = (snap, opts) => {
      const steps = stepOf(snap, opts)
      return steps.slice(0, 4).find((s) => !s.done) || steps[4]
    }
    expect(pick(snapOf({ docs: 0 }), { imported: false }).label).toBe('上傳專案文件與標單')
    expect(pick(snapOf({ orgs: new Set(['contractor']) }), { imported: true }).label).toBe('確認三方成員')
    expect(pick(snapOf(), { imported: true }).label).toBe('AI 整理契約重點')
    expect(pick(snapOf({ ingestionCompleted: 2 }), { imported: true }).label).toBe('設定開工日')
    expect(pick(snapOf({ ingestionCompleted: 2 }), { imported: true, commencement: '2026-09-15' }).label).toBe('開啟正式模式')
  })
})
