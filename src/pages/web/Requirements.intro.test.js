// W8-3A 複審修正:首頁初始化第 3 步說「AI 整理完成」,點進 /requirements 卻叫人
// 重新上傳文件——0 筆結果被當成「還沒開始」,使用者被繞回原點。
// 這支測試釘住:整理完成與否只看 completed ingestion run,兩種 0 筆狀態必須分開。
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HighlightRows, requirementsIntro } from './Requirements.jsx'

const completed = [{ id: 'R1', status: 'completed' }]
const inFlight = [{ id: 'R1', status: 'processing' }, { id: 'R2', status: 'failed' }]

describe('AI 已完成整理但 0 筆結果', () => {
  it('視為完成,說明「不需處理」且不影響正式模式', () => {
    const intro = requirementsIntro(completed, 0)
    expect(intro.ingestionDone).toBe(true)
    expect(intro.mode).toBe('done-empty')
    expect(intro.emptyText).toContain('AI 已完成整理')
    expect(intro.emptyText).toContain('沒有找到契約重點建議')
    expect(intro.emptyText).toContain('不需處理')
    expect(intro.emptyText).toContain('不影響開啟正式模式')
  })
  it('不得再叫使用者去上傳文件(那會繞回原點)', () => {
    expect(requirementsIntro(completed, 0).emptyText).not.toMatch(/上傳|重新上傳/)
  })
})

describe('AI 尚未跑完且 0 筆', () => {
  it('才顯示前往專案文件／查看處理狀態', () => {
    for (const runs of [[], inFlight]) {
      const intro = requirementsIntro(runs, 0)
      expect(intro.ingestionDone).toBe(false)
      expect(intro.mode).toBe('not-started')
      expect(intro.emptyText).toContain('尚未有完成的 AI 整理')
      expect(intro.emptyText).toMatch(/上傳/)
      expect(intro.emptyText).toMatch(/處理狀態/)
      // 尚未完成時絕不能宣稱整理完成
      expect(intro.emptyText).not.toContain('AI 已完成整理')
    }
  })
})

describe('有 Requirement 時的頁首說明', () => {
  it('有 completed run 才說得出「AI 已完成整理」', () => {
    const intro = requirementsIntro(completed, 106)
    expect(intro.mode).toBe('list')
    expect(intro.note).toContain('AI 已完成整理')
    expect(intro.note).toContain('不影響開啟正式模式')
  })
  it('有 Requirement 但沒有 completed run → 不得宣稱 AI 整理完成', () => {
    for (const runs of [[], inFlight]) {
      const intro = requirementsIntro(runs, 12) // 人工建立或舊 run 留下的需求
      expect(intro.ingestionDone).toBe(false)
      expect(intro.mode).toBe('list')
      expect(intro.note).not.toContain('AI 已完成整理')
      expect(intro.note).not.toContain('整理契約重點')
      // 審查規則本身照講,不影響正式模式的說法要留著
      expect(intro.note).toContain('不影響開啟正式模式')
    }
  })
})

describe('判定依據與 Dashboard 第 3 步一致', () => {
  it('只認 status === completed;pending/processing/failed 都不算', () => {
    expect(requirementsIntro([{ status: 'pending' }], 0).ingestionDone).toBe(false)
    expect(requirementsIntro([{ status: 'processing' }], 0).ingestionDone).toBe(false)
    expect(requirementsIntro([{ status: 'failed' }], 0).ingestionDone).toBe(false)
    expect(requirementsIntro([{ status: 'failed' }, { status: 'completed' }], 0).ingestionDone).toBe(true)
  })
  it('runs 未載入(undefined/null)不當成完成', () => {
    expect(requirementsIntro(undefined, 0).ingestionDone).toBe(false)
    expect(requirementsIntro(null, 0).mode).toBe('not-started')
  })
})

describe('W8-3B 契約重點動作', () => {
  const deadline = {
    id: 'D1', status: 'needs_review', requirement_type: 'deadline', origin: 'ai',
    title: '開工後 14 日內提送計畫', responsible_party_type: 'contractor',
    trigger_type: 'commencement', trigger_config: { offset_days: 14, offset_dir: 'after' },
  }
  const renderRows = (requirement, canReview) => renderToStaticMarkup(
    createElement(HighlightRows, {
      groups: [{ key: requirement.id, requirement, requirements: [requirement] }],
      kind: 'suggestion', canReview,
      verificationByReq: new Map([[requirement.id, 'verified']]),
      onSelect: () => {}, onQuickApprove: () => {},
    }),
  )

  it('廠商只能查看，不會出現契約核定捷徑', () => {
    const html = renderRows(deadline, false)
    expect(html).toContain('契約核定由監造／機關辦理')
    expect(html).not.toContain('核定並加入契約義務')
  })

  it('已核對且規則完整的期限，只對契約審查者顯示真實捷徑', () => {
    expect(renderRows(deadline, true)).toContain('核定並加入契約義務')
  })

  it('送審類只能查看內容，不假裝已能建立流程', () => {
    const html = renderRows({ ...deadline, id: 'S1', requirement_type: 'submittal', title: '施工計畫送審' }, true)
    expect(html).toContain('查看內容與來源')
    expect(html).not.toMatch(/建立.*送審|核定並加入/)
  })
})
