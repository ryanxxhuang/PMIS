// P0-07 requirement review presentation and queue helpers (pure functions).
// The Requirements pages load their scoped data with pagination; everything that
// decides what the reviewer sees - default queue scope, ordering, filters,
// source/citation labels - lives here so it is deterministic and testable.

export const REVIEW_DECISIONS = Object.freeze(['approve', 'reject', 'supersede'])

// 兩個契約頁共用同一份事實判斷。模型 confidence 不參與；自動確認也不代表
// 完全正確。缺少核對欄位時保留未知，不可用 undefined?.length 當核對通過。
export function requirementVerification(requirement) {
  const r = requirement
  if (!r) return { label: '尚無可用核對紀錄', attention: false, note: '內容如有出入，以契約原文為準。' }
  if (['rejected', 'superseded'].includes(r.status)) {
    return { label: REQUIREMENT_STATUS_LABELS[r.status], attention: false, note: '' }
  }
  if (r.reviewed_by && r.status === 'approved') {
    return { label: '已由人工確認', attention: false, note: '內容如有出入，以契約原文為準。' }
  }
  if (r.status !== 'approved' || !r.reviewed_at) {
    return { label: '尚待確認', attention: true, note: '此項尚無完成確認的紀錄。' }
  }
  if (r.origin !== 'ai') {
    return { label: '確認來源待查', attention: true, note: '未取得人工確認者紀錄，以契約原文為準。' }
  }
  if (!Array.isArray(r.triage_doubts)) {
    return { label: 'AI 整理・核對結果未取得', attention: true, note: '尚無可用的核對結果，以契約原文為準。' }
  }
  if (r.triage_doubts.length) {
    return { label: 'AI 整理・自動確認', attention: true,
      note: `需留意：${r.triage_doubts.join('、')}。內容如有出入，以契約原文為準。` }
  }
  return { label: '系統核對無誤・自動確認', attention: false,
    note: '已通過引文與適用期限數字核對；不代表已驗證全部語意或沒有漏項。內容如有出入，以契約原文為準。' }
}

// D-017 語意:契約本身已是生效文件,人工「確認」的是 AI 轉錄無誤,不是使契約生效。
// D-019 起 AI-origin 全自動確認；引文與數字核對結果另作透明度註記。
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

// ── 契約包歸屬(分級可見性的單一判斷)──────────────────────────────────────
// 「這條 run／這列 requirement 屬於哪個契約包」全站只有這一個判斷:履約時程與
// 擷取審核的 ?package= 篩選都走這裡;下一波專案文件頁(Contract.jsx)的
// document_processing_runs 自帶 contract_package_id,同一支函式直接適用。
// 優先序:列上自己的 contract_package_id(分級可見性歸包欄位,RLS 也以它為準)
// → 沒有才回推「列 → 擷取 run → 文件版本 → 文件的契約包」——舊列與 AI 抽取當時
// 未帶歸包的資料靠這條路才篩得到。run 本身沒有歸包欄位,一律走文件版本。
// 推不出回 null,不回 undefined:對 === 比對與 Map key 都要是明確值。
// 改版前兩頁寫的是「列自己的包 === X ‖ run 推出的包 === X」;列上有歸包卻與 run
// 推出的不同,只可能是資料不一致,這裡採信列上的欄位(單一資料來源,§3 第 1 條)。
export function packageOf(runOrRow, { versionsById, runsById } = {}) {
  if (!runOrRow) return null
  if (runOrRow.contract_package_id) return runOrRow.contract_package_id
  // requirement 列帶 ingestion_run_id;run 列自己就帶 document_version_id
  const run = runOrRow.ingestion_run_id != null ? runsById?.get(runOrRow.ingestion_run_id) : runOrRow
  const version = run?.document_version_id != null ? versionsById?.get(run.document_version_id) : null
  return version?.documents?.contract_package_id ?? null
}

// 篩選述詞:未指定契約=全部可見。
export function inPackage(runOrRow, packageId, ctx) {
  return !packageId || packageOf(runOrRow, ctx) === packageId
}

// 涵蓋率警示要的 run 形狀:限定契約範圍內,並補上文件標題(extractionCoverageWarnings
// 用 document_title 點名是哪份文件缺頁)。兩個契約頁餵同一份輸入,警示文案才一致。
export function runsInPackage(runs, packageId, { versionsById } = {}) {
  return (runs || []).filter((run) => inPackage(run, packageId, { versionsById })).map((run) => ({
    ...run, document_title: versionsById?.get(run.document_version_id)?.documents?.title,
  }))
}

// 頁底／標題列的整理摘要:只認 completed run(D-014 同一判定);來源文件數以標題
// 去重(同一份文件多版本算一份),最近整理取完成時間最大者;沒有就 null。
export function ingestionSummary(runs, versionsById) {
  const completed = (runs || []).filter((r) => r.status === 'completed')
  const docCount = new Set(completed
    .map((r) => versionsById?.get(r.document_version_id)?.documents?.title).filter(Boolean)).size
  const latest = completed.map((r) => r.completed_at).filter(Boolean).sort().pop() || null
  return { docCount, latest }
}
