import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_TYPE_LABELS,
  GENERATION_TYPE_LABELS,
  WORK_ITEM_LINK_STATE_LABELS,
  formatRequirementRule,
  inDefaultReviewScope,
  latestCompletedRunIds,
  requirementFrequencyKey,
  sourcePageLabel,
  sourceVerificationSummary,
  requirementVerification,
  packageOf,
  inPackage,
  runsInPackage,
  ingestionSummary,
} from './requirementReview.js'

describe('核對例外分流（不依模型信心分數）', () => {
  const auto = { origin: 'ai', status: 'approved', reviewed_at: '2026-09-08T01:00:00Z', reviewed_by: null, triage_doubts: [] }
  it('有疑慮的自動確認仍需留意，不能宣稱核對無誤', () => {
    const verdict = requirementVerification({ ...auto, confidence: 1, triage_doubts: ['期限數字不符'] })
    expect(verdict.attention).toBe(true)
    expect(verdict.label).not.toContain('核對無誤')
    expect(verdict.note).toContain('期限數字不符')
  })
  it.each([null, undefined, ''])('缺少有效的疑慮陣列 %j 應列未知', (triage_doubts) => {
    expect(requirementVerification({ ...auto, triage_doubts }).attention).toBe(true)
    expect(requirementVerification({ ...auto, triage_doubts }).label).not.toContain('核對無誤')
  })
  it('通過既有核對不宣稱沒有漏項', () => {
    const verdict = requirementVerification({ ...auto, confidence: 0.2 })
    expect(verdict.attention).toBe(false)
    expect(verdict.label).toContain('系統核對無誤')
    expect(verdict.note).toContain('不代表已驗證全部語意或沒有漏項')
  })
  it('人工已確認不因原有 AI 疑慮重複要求查看', () => {
    const verdict = requirementVerification({ ...auto, reviewed_by: 'reviewer', triage_doubts: ['原有疑慮'] })
    expect(verdict).toMatchObject({ attention: false, label: '已由人工確認' })
  })
  it.each(['rejected', 'superseded'])('已退出的 %s 不進需留意', (status) => {
    expect(requirementVerification({ ...auto, status, triage_doubts: ['疑慮'] }).attention).toBe(false)
  })
  it('人工補登尚待確認保留人工責任', () => {
    expect(requirementVerification({ status: 'needs_review', origin: 'manual' }).attention).toBe(true)
  })
})

const runs = [
  { id: 'run-old', document_version_id: 'v1', status: 'completed', started_at: '2026-07-01T10:00:00Z' },
  { id: 'run-new', document_version_id: 'v1', status: 'completed', started_at: '2026-07-09T10:00:00Z' },
  { id: 'run-failed', document_version_id: 'v1', status: 'failed', started_at: '2026-07-10T10:00:00Z' },
  { id: 'run-processing', document_version_id: 'v2', status: 'processing', started_at: '2026-07-10T11:00:00Z' },
  { id: 'run-pending', document_version_id: 'v2', status: 'pending', started_at: '2026-07-10T12:00:00Z' },
  { id: 'run-v2', document_version_id: 'v2', status: 'completed', started_at: '2026-07-08T10:00:00Z' },
]

describe('latestCompletedRunIds', () => {
  it('prefers the latest completed run per document version', () => {
    const ids = latestCompletedRunIds(runs)
    expect(ids.has('run-new')).toBe(true)
    expect(ids.has('run-old')).toBe(false)
    expect(ids.has('run-v2')).toBe(true)
  })

  it('never treats failed/processing/pending runs as current', () => {
    const ids = latestCompletedRunIds(runs)
    expect(ids.has('run-failed')).toBe(false)
    expect(ids.has('run-processing')).toBe(false)
    expect(ids.has('run-pending')).toBe(false)
  })
})

describe('inDefaultReviewScope', () => {
  const currentRunIds = latestCompletedRunIds(runs)

  it('always includes manual and migration requirements', () => {
    expect(inDefaultReviewScope({ origin: 'manual', ingestion_run_id: null }, currentRunIds)).toBe(true)
    expect(inDefaultReviewScope({ origin: 'migration', ingestion_run_id: null }, currentRunIds)).toBe(true)
  })

  it('includes AI suggestions only from the latest completed run', () => {
    expect(inDefaultReviewScope({ origin: 'ai', ingestion_run_id: 'run-new' }, currentRunIds)).toBe(true)
    expect(inDefaultReviewScope({ origin: 'ai', ingestion_run_id: 'run-old' }, currentRunIds)).toBe(false)
  })

  it('excludes failed/processing run suggestions and unlinked AI rows from the default queue', () => {
    expect(inDefaultReviewScope({ origin: 'ai', ingestion_run_id: 'run-failed' }, currentRunIds)).toBe(false)
    expect(inDefaultReviewScope({ origin: 'ai', ingestion_run_id: 'run-processing' }, currentRunIds)).toBe(false)
    expect(inDefaultReviewScope({ origin: 'ai', ingestion_run_id: null }, currentRunIds)).toBe(false)
  })
})

describe('source presentation', () => {
  it('summarizes verification across sources', () => {
    expect(sourceVerificationSummary([])).toBe('none')
    expect(sourceVerificationSummary([{ source_verified: false }])).toBe('unverified')
    expect(sourceVerificationSummary([{ source_verified: false }, { source_verified: true }]))
      .toBe('verified')
  })

  it('shows a grounded PDF page and never a fabricated one', () => {
    expect(sourcePageLabel({ page_number: 12 })).toBe('第 12 頁')
  })

  it('says so when there is no reliable page (DOCX / ungrounded claim)', () => {
    expect(sourcePageLabel({ page_number: null })).toBe('無可靠頁碼')
    expect(sourcePageLabel(null)).toBe('無可靠頁碼')
  })

  it('uses neutral verified/unverified labels', () => {
  })
})

describe('formatRequirementRule', () => {
  it('formats offset triggers and monthly frequency readably', () => {
    expect(formatRequirementRule({
      trigger_type: 'commencement',
      trigger_config: { offset_days: 14, offset_dir: 'before' },
    })).toBe('開工前 14 日內')
    expect(formatRequirementRule({
      frequency_type: 'monthly', frequency_config: { day: 5 },
    })).toBe('每月 5 日')
    expect(formatRequirementRule({
      trigger_type: 'fixed', trigger_config: { fixed_date: '2026-08-01' },
    })).toBe('指定 2026-08-01')
  })

  it('formats the expanded frequency domain(daily/weekly/quarterly/yearly)', () => {
    expect(formatRequirementRule({ frequency_type: 'daily', frequency_config: {} })).toBe('每日')
    expect(formatRequirementRule({ frequency_type: 'weekly', frequency_config: { weekday: 3 } })).toBe('每週三')
    expect(formatRequirementRule({ frequency_type: 'weekly', frequency_config: {} })).toBe('每週')
    expect(formatRequirementRule({ frequency_type: 'monthly', frequency_config: {} })).toBe('每月')
    expect(formatRequirementRule({ frequency_type: 'quarterly', frequency_config: { month: 2, day: 10 } })).toBe('每季第 2 個月 10 日')
    expect(formatRequirementRule({ frequency_type: 'quarterly', frequency_config: { day: 10 } })).toBe('每季')
    expect(formatRequirementRule({ frequency_type: 'yearly', frequency_config: { month: 3, day: 31 } })).toBe('每年 3 月 31 日')
    expect(formatRequirementRule({ frequency_type: 'yearly', frequency_config: {} })).toBe('每年')
    // 未知頻率值原樣顯示,不落到 trigger 分支
    expect(formatRequirementRule({ frequency_type: 'biweekly', trigger_type: 'commencement' })).toBe('biweekly')
  })

  it('returns empty text instead of raw JSON when nothing applies', () => {
    expect(formatRequirementRule({ trigger_type: null, frequency_type: null })).toBe('')
    expect(formatRequirementRule(null)).toBe('')
  })
})

describe('link label mappings', () => {
  it('labels BOQ link review states', () => {
    expect(WORK_ITEM_LINK_STATE_LABELS.suggested).toBe('AI 建議')
    expect(WORK_ITEM_LINK_STATE_LABELS.approved).toBe('已核可')
    expect(WORK_ITEM_LINK_STATE_LABELS.rejected).toBe('已駁回')
  })

  it('labels every supported artifact type and generation type', () => {
    expect(Object.keys(ARTIFACT_TYPE_LABELS).sort()).toEqual(
      ['checklist', 'deadline', 'evidence', 'inspection_point', 'submittal', 'test'],
    )
    expect(GENERATION_TYPE_LABELS.ai_draft).toBe('AI 草稿')
  })
})

describe('requirementFrequencyKey(檢索頁頻率維度)', () => {
  it('循環義務照 frequency_type 分桶,值域擴充自動跟上,未知值原樣顯示', () => {
    expect(requirementFrequencyKey({ frequency_type: 'monthly' })).toBe('每月')
    expect(requirementFrequencyKey({ frequency_type: 'daily' })).toBe('每日')
    expect(requirementFrequencyKey({ frequency_type: 'weekly' })).toBe('每週')
    expect(requirementFrequencyKey({ frequency_type: 'yearly' })).toBe('每年')
    expect(requirementFrequencyKey({ frequency_type: 'biweekly' })).toBe('biweekly')
  })
  it('非循環:有觸發時點=一次性,否則無明確時點', () => {
    expect(requirementFrequencyKey({ trigger_type: 'commencement' })).toBe('一次性')
    expect(requirementFrequencyKey({ trigger_type: 'fixed' })).toBe('一次性')
    expect(requirementFrequencyKey({})).toBe('無明確時點')
    expect(requirementFrequencyKey(null)).toBe('無明確時點')
  })
})

describe('契約包歸屬(packageOf:履約時程／擷取審核共用的單一判斷)', () => {
  const versionsById = new Map([
    ['v1', { id: 'v1', documents: { title: '施工契約', contract_package_id: 'pkg1' } }],
    ['v2', { id: 'v2', documents: { title: '監造契約', contract_package_id: 'pkg2' } }],
    ['v-orphan', { id: 'v-orphan', documents: { title: '無包文件' } }],
  ])
  const runsById = new Map([
    ['run1', { id: 'run1', document_version_id: 'v1' }],
    ['run2', { id: 'run2', document_version_id: 'v2' }],
    ['run-orphan', { id: 'run-orphan', document_version_id: 'v-orphan' }],
  ])
  const ctx = { versionsById, runsById }

  it('列上自己的 contract_package_id 優先,不再看 run', () => {
    expect(packageOf({ contract_package_id: 'pkg2', ingestion_run_id: 'run1' }, ctx)).toBe('pkg2')
    // document_processing_runs(專案文件頁)自帶歸包欄位,同一條路
    expect(packageOf({ contract_package_id: 'pkg1', document_version_id: 'v2' }, ctx)).toBe('pkg1')
  })
  it('沒有歸包欄位的 requirement 列:列 → run → 文件版本 → 文件的契約包', () => {
    expect(packageOf({ ingestion_run_id: 'run1' }, ctx)).toBe('pkg1')
    expect(packageOf({ ingestion_run_id: 'run2', contract_package_id: null }, ctx)).toBe('pkg2')
  })
  it('ingestion run 列直接走文件版本', () => {
    expect(packageOf({ id: 'run2', document_version_id: 'v2' }, ctx)).toBe('pkg2')
  })
  it.each([
    ['空值', null],
    ['人工補登無 run 無歸包', { origin: 'manual', ingestion_run_id: null }],
    ['run 不在 Map', { ingestion_run_id: 'run-missing' }],
    ['文件版本不在 Map', { id: 'r', document_version_id: 'v-missing' }],
    ['文件沒有契約包', { ingestion_run_id: 'run-orphan' }],
  ])('推不出歸包(%s)回 null,不回 undefined', (_label, row) => {
    expect(packageOf(row, ctx)).toBeNull()
  })
  it('ctx 缺 Map 也不炸(頁面初次 render 尚未載入)', () => {
    expect(packageOf({ ingestion_run_id: 'run1' })).toBeNull()
    expect(packageOf({ contract_package_id: 'pkg1' })).toBe('pkg1')
  })
  it('inPackage:未指定契約=全部可見;指定契約只留該包,推不出的不可見', () => {
    const row = { ingestion_run_id: 'run1' }
    expect(inPackage(row, '', ctx)).toBe(true)
    expect(inPackage(row, 'pkg1', ctx)).toBe(true)
    expect(inPackage(row, 'pkg2', ctx)).toBe(false)
    expect(inPackage({ ingestion_run_id: 'run-orphan' }, 'pkg1', ctx)).toBe(false)
    expect(inPackage(null, 'pkg1', ctx)).toBe(false)
  })
  it('runsInPackage:限定契約並補 document_title 給涵蓋率警示', () => {
    const runs = [
      { id: 'run1', document_version_id: 'v1', status: 'completed' },
      { id: 'run2', document_version_id: 'v2', status: 'completed' },
    ]
    expect(runsInPackage(runs, 'pkg2', { versionsById })).toEqual([
      { id: 'run2', document_version_id: 'v2', status: 'completed', document_title: '監造契約' },
    ])
    expect(runsInPackage(runs, '', { versionsById }).map((r) => r.document_title)).toEqual(['施工契約', '監造契約'])
    expect(runsInPackage(undefined, 'pkg1', { versionsById })).toEqual([])
  })
})

describe('整理摘要(ingestionSummary:頁底 meta 與清單標題列共用)', () => {
  const versionsById = new Map([
    ['v1', { documents: { title: '施工契約' } }],
    ['v1b', { documents: { title: '施工契約' } }],
    ['v2', { documents: { title: '規範' } }],
  ])
  it('只認 completed;同一文件多版本算一份;最近整理取最大完成時間', () => {
    const runs = [
      { document_version_id: 'v1', status: 'completed', completed_at: '2026-09-01T01:00:00Z' },
      { document_version_id: 'v1b', status: 'completed', completed_at: '2026-09-03T01:00:00Z' },
      { document_version_id: 'v2', status: 'processing', completed_at: null },
      { document_version_id: 'v2', status: 'failed', completed_at: '2026-09-09T01:00:00Z' },
    ]
    expect(ingestionSummary(runs, versionsById)).toEqual({ docCount: 1, latest: '2026-09-03T01:00:00Z' })
  })
  it('沒有 completed run → 0 份、latest null(頁面不得講「AI 最近整理」)', () => {
    expect(ingestionSummary([{ status: 'pending' }], versionsById)).toEqual({ docCount: 0, latest: null })
    expect(ingestionSummary(undefined, undefined)).toEqual({ docCount: 0, latest: null })
  })
})
