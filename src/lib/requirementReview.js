// P0-07 requirement review presentation and queue helpers (pure functions).
// The Requirements page queries bounded data from Supabase; everything that
// decides what the reviewer sees - default queue scope, ordering, filters,
// source/citation labels - lives here so it is deterministic and testable.

export const REVIEW_DECISIONS = Object.freeze(['approve', 'reject', 'supersede'])

// D-017 語意:契約本身已是生效文件,人工「確認」的是 AI 轉錄無誤,不是使契約生效。
// 引文與數字核對無誤的由確定性分流自動確認(reviewed_by null=系統)。
export const REQUIREMENT_STATUS_LABELS = Object.freeze({
  draft_ai: 'AI 整理',
  needs_review: '待確認',
  approved: '已確認',
  rejected: '不採用',
  superseded: '已取代',
})

export const REQUIREMENT_TYPE_LABELS = Object.freeze({
  deadline: '期限', submittal: '送審', inspection: '檢驗', test: '試驗',
  checklist: '檢查表', evidence: '佐證', photo: '照片', report: '報告', other: '其他',
})

export const RESPONSIBLE_LABELS = Object.freeze({
  agency: '機關', supervisor: '監造', contractor: '廠商', other: '其他',
})

export const ORIGIN_LABELS = Object.freeze({
  ai: 'AI 擷取', manual: '人工建立', migration: '契約轉入',
})

export const WORK_ITEM_LINK_STATE_LABELS = Object.freeze({
  suggested: 'AI 建議', approved: '已核可', rejected: '已駁回',
})

export const ARTIFACT_TYPE_LABELS = Object.freeze({
  inspection_point: '檢驗停留點', checklist: '檢查表範本', test: '取樣試驗',
  submittal: '送審文件', evidence: '佐證照片', deadline: '契約期限',
})

export const GENERATION_TYPE_LABELS = Object.freeze({
  manual: '人工', ai_draft: 'AI 草稿', migration: '轉入',
})

// The current review scope for AI suggestions: the latest COMPLETED run per
// document version. Failed / processing / pending runs never define scope,
// and older completed runs stay inspectable through the explicit run filter.
export function latestCompletedRunIds(runs) {
  const latestByVersion = new Map()
  for (const run of runs || []) {
    if (run.status !== 'completed') continue
    const current = latestByVersion.get(run.document_version_id)
    if (!current || new Date(run.started_at) > new Date(current.started_at)) {
      latestByVersion.set(run.document_version_id, run)
    }
  }
  return new Set([...latestByVersion.values()].map((run) => run.id))
}

// Default queue membership: manual / migration Requirements always belong;
// AI suggestions only when they come from the current (latest completed) run
// of their document version.
export function inDefaultReviewScope(requirement, currentRunIds) {
  if (requirement.origin !== 'ai') return true
  return requirement.ingestion_run_id != null
    && currentRunIds.has(requirement.ingestion_run_id)
}

// 頻率維度(檢索頁篩選):循環義務照 frequency_type 分桶,非循環分「一次性」
// (有觸發時點)與「無明確時點」。標籤表即抽取引擎的完整頻率值域
// (requirementExtraction.ts 的 FREQUENCY_TYPES);未知值原樣顯示。
export const FREQUENCY_LABELS = Object.freeze({
  daily: '每日', weekly: '每週', monthly: '每月', quarterly: '每季', yearly: '每年',
})
export function requirementFrequencyKey(requirement) {
  if (requirement?.frequency_type) {
    return FREQUENCY_LABELS[requirement.frequency_type] || requirement.frequency_type
  }
  return requirement?.trigger_type ? '一次性' : '無明確時點'
}

// Aggregate a requirement's sources into one verification state for filtering:
// any verified source -> 'verified'; sources but none verified -> 'unverified'.
export function sourceVerificationSummary(sources) {
  if (!sources?.length) return 'none'
  return sources.some((s) => s.source_verified) ? 'verified' : 'unverified'
}

// Citation page display: a persisted page number is grounded in stored
// document_pages (P0-06), so it may be shown as a contractual page. A null
// page (DOCX unpaginated or ungrounded claim) must say so - never a storage
// segment index.
export function sourcePageLabel(source) {
  return source?.page_number == null ? '無可靠頁碼' : `第 ${source.page_number} 頁`
}


const TRIGGER_LABELS = {
  award: '決標', notice: '接獲開工通知', commencement: '開工',
  completion: '完工', monthly: '每月', fixed: '指定日期', other: '其他',
}

const WEEKDAY_LABELS = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日']

// Readable trigger/frequency line instead of raw JSON config.
export function formatRequirementRule(requirement) {
  if (!requirement) return ''
  if (requirement.frequency_type) {
    const freq = requirement.frequency_config || {}
    if (requirement.frequency_type === 'daily') return '每日'
    if (requirement.frequency_type === 'weekly') {
      return freq.weekday ? `每${WEEKDAY_LABELS[freq.weekday] || '週'}` : '每週'
    }
    if (requirement.frequency_type === 'monthly') {
      return freq.day ? `每月 ${freq.day} 日` : '每月'
    }
    if (requirement.frequency_type === 'quarterly') {
      return freq.day && freq.month ? `每季第 ${freq.month} 個月 ${freq.day} 日` : '每季'
    }
    if (requirement.frequency_type === 'yearly') {
      return freq.day && freq.month ? `每年 ${freq.month} 月 ${freq.day} 日` : '每年'
    }
    return FREQUENCY_LABELS[requirement.frequency_type] || requirement.frequency_type
  }
  if (!requirement.trigger_type) return ''
  const config = requirement.trigger_config || {}
  if (requirement.trigger_type === 'fixed') {
    return config.fixed_date ? `指定 ${config.fixed_date}` : '指定日期'
  }
  const base = TRIGGER_LABELS[requirement.trigger_type] || requirement.trigger_type
  if (config.offset_days) {
    return `${base}${config.offset_dir === 'before' ? '前' : '後'} ${config.offset_days} 日內`
  }
  return base
}


