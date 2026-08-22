// 契約重點對照報告(GTM 第②格)的召回率誠實揭露:報告必須講清楚
// 「AI 讀到哪裡、哪些頁沒讀、抽了但沒列入幾筆」,絕不能把部分涵蓋說成讀完整本。
// 測純函式(buildCoverageRows/coverageRangeText/coverageGapNotes)與
// ReportBody 靜態渲染——慣例同 Requirements.intro.test.js 之於 HighlightRows。
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildCoverageRows, coverageRangeText, coverageGapNotes, ReportBody,
} from './RequirementsReport.jsx'

const completeRun = {
  id: 'R1', document_version_id: 'V1', status: 'completed',
  started_at: '2026-08-20T01:00:00Z', completed_at: '2026-08-20T01:05:00Z',
  input_page_count: 69,
  metadata: {
    pagination: 'paginated', total_page_count: 69, last_included_page: 69,
    coverage_incomplete: false, empty_page_numbers: [], clipped_batches: [],
    rejected_item_count: 0,
  },
}
const partialRun = {
  id: 'R2', document_version_id: 'V2', status: 'completed',
  started_at: '2026-08-20T02:00:00Z', completed_at: '2026-08-20T02:09:00Z',
  metadata: {
    pagination: 'paginated', total_page_count: 120, last_included_page: 52,
    coverage_incomplete: true, omitted_page_count: 68,
    empty_page_numbers: [3, 4], clipped_batches: ['b5(第 40~44 頁)'],
    rejected_item_count: 2,
  },
}

describe('buildCoverageRows:每個文件版本一列,以最新 completed run 為準', () => {
  it('同版本多個 run:取最新 completed 的 metadata;更新的進行中 run 只作註記', () => {
    const older = { ...completeRun, id: 'R0', started_at: '2026-08-19T01:00:00Z' }
    const newerActive = {
      id: 'R9', document_version_id: 'V1', status: 'processing',
      started_at: '2026-08-21T01:00:00Z', metadata: {},
    }
    const [row] = buildCoverageRows([older, completeRun, newerActive])
    expect(row.completed).toBe(true)
    expect(row.totalPages).toBe(69)
    expect(row.activeNewer).toBe(true)
    expect(coverageRangeText(row)).toBe('全部 69 頁')
  })
  it('沒有 completed run:誠實顯示進行中/失敗,不得宣稱任何涵蓋範圍', () => {
    const failed = {
      id: 'RF', document_version_id: 'V3', status: 'failed',
      started_at: '2026-08-20T03:00:00Z', error_message: 'PGRST301: relation not found',
    }
    const [row] = buildCoverageRows([failed])
    expect(row.completed).toBe(false)
    expect(coverageRangeText(row)).toBe('分析失敗,未產生結果')
    expect(coverageRangeText(row)).not.toMatch(/全部|僅分析/)
    // 報告會外寄:原始 error_message(DB/模型內部錯誤)不得進任何欄位
    expect(JSON.stringify(row)).not.toContain('PGRST301')
  })
  it('舊 run(W10 前)缺 coverage 欄位:即使有 input_page_count 也不得說「全部 N 頁」', () => {
    // 舊版有 160K 字元輸入預算截斷,但 metadata 沒留涵蓋紀錄——
    // 拿 input_page_count(整份文件頁數)充當讀完範圍就是撒謊
    const legacy = {
      id: 'RL', document_version_id: 'V4', status: 'completed',
      started_at: '2026-07-13T00:00:00Z', input_page_count: 300, metadata: {},
    }
    const [row] = buildCoverageRows([legacy])
    expect(row.legacy).toBe(true)
    expect(row.totalPages).toBe(null)
    expect(coverageRangeText(row)).toContain('無法確認')
    expect(coverageRangeText(row)).not.toMatch(/全部/)
    // 缺口聲明也要揭露「舊版分析無法確認」
    expect(coverageGapNotes(row, '契約(v1)').join('\n')).toContain('無法確認是否讀完整份文件')
  })
  it('舊 run 有 truncated_input 旗標:明示截斷與截斷位置,不得沉默', () => {
    const legacyTruncated = {
      id: 'RT', document_version_id: 'V5', status: 'completed',
      started_at: '2026-07-13T00:00:00Z', input_page_count: 300,
      metadata: { pagination: 'paginated', truncated_input: true, last_included_page: 52 },
    }
    const [row] = buildCoverageRows([legacyTruncated])
    expect(coverageRangeText(row)).toContain('僅分析第 1~52 頁')
    expect(coverageRangeText(row)).toContain('截斷')
    expect(coverageRangeText(row)).not.toMatch(/全部/)
    expect(coverageGapNotes(row, '契約(v1)').join('\n')).toContain('截斷')
  })
})

describe('coverageRangeText/coverageGapNotes:部分涵蓋必須明講到第幾頁', () => {
  const [row] = buildCoverageRows([partialRun])
  it('coverage_incomplete → 「僅分析第 1~N 頁(共 M 頁)」', () => {
    expect(coverageRangeText(row)).toBe('僅分析第 1~52 頁(共 120 頁)')
  })
  it('缺口聲明齊全:未涵蓋頁範圍、切批遺漏、無文字頁、被駁回筆數', () => {
    const notes = coverageGapNotes(row, '契約(v1)')
    expect(notes.join('\n')).toContain('第 53~120 頁未分析')
    expect(notes.join('\n')).toContain('b5(第 40~44 頁)')
    expect(notes.join('\n')).toContain('第 3、4 頁無可抽取文字')
    expect(notes.join('\n')).toContain('2 筆因格式驗證未通過')
  })
  it('讀完整份且無缺口:不產生任何缺口聲明', () => {
    const [full] = buildCoverageRows([completeRun])
    expect(coverageGapNotes(full, '契約(v1)')).toEqual([])
  })
})

describe('ReportBody:對照報告的誠實語意', () => {
  const requirement = {
    id: 'REQ1', status: 'needs_review', origin: 'ai', requirement_type: 'deadline',
    title: '開工後 14 日內提送施工計畫', description: '', responsible_party_type: 'contractor',
    trigger_type: 'commencement', trigger_config: { offset_days: 14, offset_dir: 'after' },
    created_at: '2026-08-20T02:10:00Z',
  }
  const source = {
    id: 'S1', requirement_id: 'REQ1', document_version_id: 'V2',
    source_verified: true, page_number: 12, section: '第五章', clause: '§5.2',
    source_text: '承包商應於開工後十四日內提送施工計畫送監造單位審查',
  }
  const html = renderToStaticMarkup(createElement(ReportBody, {
    project: { project_name: '中央大學校舍新建工程' },
    generatedAt: new Date('2026-08-21T10:00:00Z'),
    coverageRows: buildCoverageRows([partialRun]),
    versionsById: new Map([['V2', { id: 'V2', version_label: 'v1', documents: { title: '工程契約' } }]]),
    highlights: { approved: [], suggestions: [{ key: 'K1', requirement, requirements: [requirement] }] },
    sourcesByReq: new Map([['REQ1', [source]]]),
    pendingStatusCounts: '待人工確認 1 項',
  }))
  it('涵蓋範圍與誠實聲明都要出現在報告上', () => {
    expect(html).toContain('僅分析第 1~52 頁(共 120 頁)')
    expect(html).toContain('未列出不代表契約沒有該義務')
    expect(html).toContain('第 53~120 頁未分析')
  })
  it('待審建議要有逐字引文、出處頁碼,且身分講明「不具契約效力」', () => {
    expect(html).toContain('承包商應於開工後十四日內提送施工計畫')
    expect(html).toContain('第 12 頁')
    expect(html).toContain('引文已核對')
    expect(html).toContain('不具契約效力')
  })
  it('頁尾帶專案名與產出時間', () => {
    expect(html).toContain('中央大學校舍新建工程')
    expect(html).toContain('本報告由 PMIS 系統產出')
  })
  it('失敗 run 的原始錯誤訊息不進報告,只講「分析失敗,未產生結果」', () => {
    const failedHtml = renderToStaticMarkup(createElement(ReportBody, {
      project: { project_name: 'X 案' },
      generatedAt: new Date('2026-08-21T10:00:00Z'),
      coverageRows: buildCoverageRows([{
        id: 'RF', document_version_id: 'V9', status: 'failed',
        started_at: '2026-08-20T03:00:00Z', error_message: 'AnthropicError: overloaded_error 529',
      }]),
      versionsById: new Map(),
      highlights: { approved: [], suggestions: [] },
      sourcesByReq: new Map(),
      pendingStatusCounts: '',
    }))
    expect(failedHtml).toContain('分析失敗,未產生結果')
    expect(failedHtml).not.toContain('AnthropicError')
  })
  it('契約重點撈滿查詢上限:聲明區揭露「僅列最近 300 筆」', () => {
    const cappedHtml = renderToStaticMarkup(createElement(ReportBody, {
      project: { project_name: 'X 案' },
      generatedAt: new Date('2026-08-21T10:00:00Z'),
      coverageRows: [],
      versionsById: new Map(),
      highlights: { approved: [], suggestions: [] },
      sourcesByReq: new Map(),
      pendingStatusCounts: '',
      requirementsCapped: true,
    }))
    expect(cappedHtml).toContain('僅列最近 300 筆')
    // 未達上限(預設)不出現這條聲明
    expect(html).not.toContain('僅列最近 300 筆')
  })
  it('分析紀錄撈滿查詢上限:聲明區揭露涵蓋範圍表不完整', () => {
    const cappedHtml = renderToStaticMarkup(createElement(ReportBody, {
      project: { project_name: 'X 案' },
      generatedAt: new Date('2026-08-21T10:00:00Z'),
      coverageRows: [],
      versionsById: new Map(),
      highlights: { approved: [], suggestions: [] },
      sourcesByReq: new Map(),
      pendingStatusCounts: '',
      runsCapped: true,
    }))
    expect(cappedHtml).toContain('僅涵蓋最近 100 次分析')
    expect(html).not.toContain('僅涵蓋最近 100 次分析')
  })
})
