import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import { pageAllInSafe } from '../../lib/pagedQuery.js'
import {
  REQUIREMENT_STATUS_LABELS, REQUIREMENT_TYPE_LABELS, RESPONSIBLE_LABELS,
  latestCompletedRunIds, buildRequirementHighlights, sourceVerificationSummary,
  sourcePageLabel, formatRequirementRule,
} from '../../lib/requirementReview.js'
import { friendlyError } from '../../lib/errorMessage.js'

// 契約重點對照報告(GTM 第②格)——「拿一份真契約跑一次抽取」後可寄給事務所/
// 監造、對方能在會議上逐條翻對的輸出物:抽到哪些重點、逐字引文與出處頁碼、
// 以及「漏了什麼」。與 /contract/print(已核定期限的到期日對照)互補:
// 這一頁的重點是抽取結果的完整性揭露——涵蓋範圍、截斷、無文字頁、被駁回筆數
// 全部明講,絕不讓對方以為 AI 讀完了整本契約(召回率誠實揭露,對齊四條紅線)。
// 不套 WebLayout,整頁即文件;工具列與紙面樣式對齊其他五支列印頁
// (釘死亮色不吃主題 token,理由見 SiteLogPrint)。
const TOOLBAR_BTN = 'inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium max-md:min-h-11'
const TOOLBAR_PRIMARY = `${TOOLBAR_BTN} bg-[#0b57d0] text-white hover:bg-[#0842a0]`
const TOOLBAR_SECONDARY = `${TOOLBAR_BTN} bg-white text-[#0b57d0] border border-[#dadce0] hover:bg-[#e8f0fe]`

const TH = 'border border-slate-400 px-2 py-1 text-left font-medium bg-slate-100'
const TD = 'border border-slate-400 px-2 py-1 align-top'

// 與 /requirements 畫面同一組有界查詢上限;撈滿上限時報告要在聲明區揭露
// 「僅列最近 N 筆」——這份報告的完整性聲明不能只講頁數缺口,漏筆數也要講
export const REQUIREMENT_QUERY_LIMIT = 300
// runs 也是有界查詢:文件多×重試多的專案撈滿後,較舊文件會從涵蓋範圍表消失,
// 而其已核定重點仍列在第二節——對照不起來的原因必須在聲明區講明
export const RUN_QUERY_LIMIT = 100

const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('zh-TW', { hour12: false }) : '')

// 每個文件版本一列涵蓋率:以「最新 completed run」的 metadata 為準(這也是
// 審查清單的現行範圍 latestCompletedRunIds 所本);沒有 completed run 就誠實
// 顯示最新 run 的狀態。欄位名對齊 extract-requirements 落庫的 coverage metadata。
// W10 起 completed run 一定同時落 total_page_count 與 coverage_incomplete;
// 兩者皆缺=舊版分析——當年有 160K 字元輸入預算會截斷,但 metadata 沒留涵蓋
// 紀錄,絕不能拿 runs.input_page_count(整份文件頁數)充當「全部讀完」。
// 這份報告的賣點就是誠實:寧可標「無法確認」,不可虛報涵蓋率。
export function buildCoverageRows(runs) {
  const byVersion = new Map()
  for (const run of runs || []) {
    if (!run?.document_version_id) continue
    if (!byVersion.has(run.document_version_id)) byVersion.set(run.document_version_id, [])
    byVersion.get(run.document_version_id).push(run)
  }
  return [...byVersion.entries()].map(([versionId, list]) => {
    const sorted = [...list].sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))
    const completed = sorted.find((r) => r.status === 'completed') || null
    const latest = sorted[0]
    const m = completed?.metadata || {}
    const legacy = !!completed
      && m.total_page_count == null && typeof m.coverage_incomplete !== 'boolean'
    return {
      versionId,
      completed: !!completed,
      latestStatus: latest?.status || '',
      // 完成後又啟動了新解析:報告仍以 completed 為準,但要註記「有新解析進行中」
      activeNewer: !!completed && latest !== completed
        && ['pending', 'processing'].includes(latest?.status),
      paginated: m.pagination !== 'unpaginated',
      legacy,
      // truncated_input 是舊版唯一會留的截斷旗標;新版已併入 coverage_incomplete
      truncatedInput: m.truncated_input === true,
      totalPages: m.total_page_count ?? null,
      lastIncludedPage: m.last_included_page ?? null,
      coverageIncomplete: m.coverage_incomplete === true,
      omittedPageCount: m.omitted_page_count ?? 0,
      clippedBatches: Array.isArray(m.clipped_batches) ? m.clipped_batches : [],
      emptyPageNumbers: Array.isArray(m.empty_page_numbers) ? m.empty_page_numbers : [],
      rejectedCount: m.rejected_item_count ?? 0,
      completedAt: completed?.completed_at || null,
    }
  })
}

// 涵蓋率一列 → 「實際讀入範圍」文字。分批+續跑完成=讀完整份;
// coverage_incomplete(截斷/批失敗/切批上限)必須講「僅分析到第幾頁」;
// 舊版分析一律不宣稱讀完——有 truncated_input 就明講截斷,否則標「無法確認」。
export function coverageRangeText(row) {
  const unit = row.paginated ? '頁' : '段'
  if (!row.completed) {
    if (['pending', 'processing'].includes(row.latestStatus)) return '分析進行中,尚未完成'
    if (row.latestStatus === 'failed') return '分析失敗,未產生結果'
    return '尚未分析'
  }
  if (row.legacy) {
    if (row.truncatedInput) {
      return row.lastIncludedPage != null
        ? `僅分析第 1~${row.lastIncludedPage} ${unit},其後因輸入長度上限截斷(舊版分析)`
        : '因輸入長度上限截斷,未涵蓋整份文件(舊版分析)'
    }
    return '無法確認涵蓋範圍(舊版分析未留存紀錄)'
  }
  if (row.coverageIncomplete) {
    return row.lastIncludedPage != null
      ? `僅分析第 1~${row.lastIncludedPage} ${unit}(共 ${row.totalPages} ${unit})`
      : `未涵蓋整份文件(共 ${row.totalPages} ${unit})`
  }
  // 防禦:現行版不會發生(total_page_count 必落);寧可標無法確認也不虛報
  if (row.totalPages == null) return '無法確認涵蓋範圍(分析紀錄不完整)'
  return `全部 ${row.totalPages} ${unit}`
}

// 誠實聲明區的逐文件缺口句(空陣列=這份文件沒有要揭露的缺口)。
// 「被駁回筆數」也算缺口:那些是 AI 有抽但格式驗證沒過的項,文件裡可能真有其義務。
export function coverageGapNotes(row, docLabel) {
  const unit = row.paginated ? '頁' : '段'
  const notes = []
  if (row.completed && row.coverageIncomplete && row.lastIncludedPage != null && row.totalPages != null
    && row.lastIncludedPage < row.totalPages) {
    notes.push(`${docLabel}:第 ${row.lastIncludedPage + 1}~${row.totalPages} ${unit}未分析,該範圍的契約重點需人工閱讀補登。`)
  } else if (row.completed && row.coverageIncomplete) {
    notes.push(`${docLabel}:未涵蓋整份文件,未涵蓋範圍的契約重點需人工閱讀補登。`)
  }
  // 舊版分析:涵蓋紀錄不齊也是缺口,必須揭露而不是沉默
  if (row.completed && row.legacy) {
    notes.push(row.truncatedInput
      ? `${docLabel}:分析因輸入長度上限截斷${row.lastIncludedPage != null ? `(僅至第 ${row.lastIncludedPage} ${unit})` : ''},其後範圍的契約重點需人工閱讀補登。`
      : `${docLabel}:此份為舊版分析,未留存涵蓋範圍紀錄,無法確認是否讀完整份文件;建議重新執行 AI 分析。`)
  }
  if (row.clippedBatches.length) {
    notes.push(`${docLabel}:${row.clippedBatches.join('、')}內容過密,AI 未能完整抽取,該範圍可能有遺漏。`)
  }
  if (row.emptyPageNumbers.length) {
    notes.push(`${docLabel}:第 ${row.emptyPageNumbers.join('、')} ${unit}無可抽取文字(可能為掃描/影像頁),AI 未讀取。`)
  }
  if (row.rejectedCount > 0) {
    notes.push(`${docLabel}:AI 輸出中有 ${row.rejectedCount} 筆因格式驗證未通過而未列入,不代表文件沒有對應義務。`)
  }
  if (!row.completed) {
    notes.push(`${docLabel}:尚無完成的分析結果,本報告未包含這份文件的內容。`)
  }
  return notes
}

// 已核定/待審清單共用的一節表格(純呈現,便於測試)。逐字引文與出處頁碼是
// 這份報告的靈魂:對方要能拿著契約翻到那一頁核對「出處對不對」。
export function RequirementSection({ heading, note, groups, sourcesByReq, versionsById }) {
  return (
    <div className="mt-4 break-inside-avoid-page">
      <h2 className="font-bold text-[13px]">{heading}({groups.length} 項)</h2>
      {note && <p className="text-[11px] text-slate-500 mt-0.5 mb-1">{note}</p>}
      {groups.length === 0 ? (
        <p className="text-slate-500 mt-1">(無)</p>
      ) : (
        <table className="w-full mt-1 border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[26%]`}>契約重點</th>
              <th className={`${TH} w-[8%]`}>類型</th>
              <th className={`${TH} w-[8%]`}>責任方</th>
              <th className={`${TH} w-[14%]`}>時點/規則</th>
              <th className={TH}>逐字引文與出處</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const r = group.requirement
              const sources = group.requirements.flatMap((row) => sourcesByReq.get(row.id) || [])
              return (
                <tr key={group.key}>
                  <td className={TD}>
                    <div className="font-medium">{r.title}</div>
                    {r.description && <div className="text-slate-600 mt-0.5">{r.description}</div>}
                    {r.origin === 'manual' && <div className="text-slate-500 mt-0.5">(人工補登)</div>}
                  </td>
                  <td className={TD}>{REQUIREMENT_TYPE_LABELS[r.requirement_type] || r.requirement_type}</td>
                  <td className={TD}>{RESPONSIBLE_LABELS[r.responsible_party_type] || '未定'}</td>
                  <td className={TD}>{formatRequirementRule(r) || '—'}</td>
                  <td className={TD}>
                    {sources.length === 0 && '無引文(人工建立或未附出處)'}
                    {sources.map((s) => {
                      const version = s.document_version_id ? versionsById.get(s.document_version_id) : null
                      return (
                        <div key={s.id} className="mb-1 last:mb-0">
                          <span>
                            {version ? `${version.documents?.title || '文件'}(${version.version_label})` : '文件'}
                            ・{sourcePageLabel(s)}
                            {s.section ? `・${s.section}` : ''}{s.clause ? `・${s.clause}` : ''}
                            ・{s.source_verified ? '引文已核對' : '引文待人工確認'}
                          </span>
                          {s.source_text && <div className="text-slate-600">「{s.source_text}」</div>}
                        </div>
                      )
                    })}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// 報告本體(純呈現):資料全由 props 進來,好用 renderToStaticMarkup 測
// 誠實聲明與清單語意(慣例同 Requirements.intro.test.js 之於 HighlightRows)。
export function ReportBody({ project, generatedAt, coverageRows, versionsById, highlights, sourcesByReq, pendingStatusCounts, requirementsCapped = false, runsCapped = false }) {
  const docLabel = (versionId) => {
    const v = versionsById.get(versionId)
    return v ? `${v.documents?.title || '文件'}(${v.version_label})` : '文件'
  }
  const gapNotes = coverageRows.flatMap((row) => coverageGapNotes(row, docLabel(row.versionId)))
  return (
    <div className="max-w-[210mm] mx-auto bg-white text-slate-900 shadow print:shadow-none px-[14mm] py-[12mm] text-[12px] leading-relaxed">
      <h1 className="text-center text-lg font-bold">契約重點對照報告</h1>
      <div className="text-center text-slate-500 mt-0.5">
        {project?.project_name || '—'}・產出時間 {fmtDateTime(generatedAt)}
      </div>
      <p className="mt-2 text-slate-600">
        本報告列出 AI 從專案文件抽取的契約重點(逐字引文與出處頁碼),以及實際分析涵蓋範圍。
        供對照契約原文核對「抽到哪些、出處對不對、漏了什麼」;各項內容以契約原文為準。
      </p>

      {/* 一、文件與涵蓋範圍:對方第一個要知道的是「AI 到底讀了多少」 */}
      <div className="mt-4 break-inside-avoid-page">
        <h2 className="font-bold text-[13px]">一、分析文件與涵蓋範圍({coverageRows.length} 份)</h2>
        {coverageRows.length === 0 ? (
          <p className="text-slate-500 mt-1">(尚無 AI 分析紀錄)</p>
        ) : (
          <table className="w-full mt-1 border-collapse">
            <thead>
              <tr>
                <th className={`${TH} w-[34%]`}>文件(版本)</th>
                <th className={`${TH} w-[10%]`}>總頁數</th>
                <th className={`${TH} w-[26%]`}>實際讀入範圍</th>
                <th className={TH}>分析狀態</th>
              </tr>
            </thead>
            <tbody>
              {coverageRows.map((row) => (
                <tr key={row.versionId}>
                  <td className={TD}>{docLabel(row.versionId)}</td>
                  <td className={TD}>{row.totalPages ?? '—'}</td>
                  <td className={TD}>{coverageRangeText(row)}</td>
                  <td className={TD}>
                    {/* 失敗原因不進報告:error_message 可能含 DB/模型內部錯誤,
                        這份文件要寄給契約相對方(附表十構面五:不外洩詳細錯誤) */}
                    {row.completed
                      ? `完成(${fmtDateTime(row.completedAt)})${row.activeNewer ? ';另有新解析進行中' : ''}`
                      : (row.latestStatus === 'failed' ? '失敗' : '進行中')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 二、已核定:經監造/機關人工核定生效的契約重點 */}
      <RequirementSection
        heading="二、已核定的契約重點"
        note="經人工審查核定生效;期限型已排入期限追蹤(到期日對照另見「契約期限對照表」)。"
        groups={highlights.approved}
        sourcesByReq={sourcesByReq}
        versionsById={versionsById}
      />

      {/* 三、待審:AI 建議尚未經人工確認——身分必須講清楚,不可與已核定混讀 */}
      <RequirementSection
        heading="三、待審查的 AI 整理結果"
        note={`尚未經人工核定,不具契約效力,僅供對照參考${
          pendingStatusCounts ? `(${pendingStatusCounts})` : ''}。`}
        groups={highlights.suggestions}
        sourcesByReq={sourcesByReq}
        versionsById={versionsById}
      />

      {/* 四、誠實聲明:召回率揭露——沒讀到哪裡、抽了但沒列入哪些,一條不漏 */}
      <div className="mt-4 break-inside-avoid-page">
        <h2 className="font-bold text-[13px]">四、涵蓋範圍與限制聲明</h2>
        <ul className="mt-1 list-disc pl-5 space-y-0.5">
          <li>AI 抽取並非窮盡:本報告所列為 AI 自文件文字辨識出的候選契約重點,可能有遺漏;未列出不代表契約沒有該義務。</li>
          {requirementsCapped && (
            <li>本專案契約重點筆數已達本報告的查詢上限,僅列最近 {REQUIREMENT_QUERY_LIMIT} 筆;較早建立的契約重點未列入本報告。</li>
          )}
          {runsCapped && (
            <li>本專案分析紀錄已達本報告的查詢上限,「一、分析文件與涵蓋範圍」僅涵蓋最近 {RUN_QUERY_LIMIT} 次分析;更早分析的文件未列入該表,其已核定契約重點仍列於第二節。</li>
          )}
          {gapNotes.map((note) => <li key={note}>{note}</li>)}
          <li>「引文已核對」表示引文經系統與存檔頁面文字逐字比對一致;「引文待人工確認」表示比對不一致,使用前請對照契約原文。</li>
          <li>本報告不構成契約解釋;契約義務的內容與效力,以契約原文及雙方核定為準。</li>
        </ul>
      </div>

      <p className="mt-4 text-[11px] text-slate-500">
        本報告由 PMIS 系統產出・{project?.project_name || '—'}・產出時間 {fmtDateTime(generatedAt)}
      </p>
    </div>
  )
}

export default function RequirementsReport() {
  const { currentProject, currentUser, isPersistedProject } = useStore()
  const navigate = useNavigate()
  const [state, setState] = useState({ loaded: false, error: '', runs: [], rows: [], sourcesByReq: new Map(), versionsById: new Map() })
  // 產出時間定格在載入完成當下:報告是一份「當時狀態」的文件,不隨 re-render 跳動
  const generatedAt = useMemo(() => new Date(), [])

  const pid = currentProject?.project_id
  const load = useCallback(async () => {
    if (!isPersistedProject || !pid) return
    try {
      // 與 /requirements 同一組有界查詢(runs 100/需求 300):報告與畫面看到的
      // 必須是同一份資料,不另立查詢邏輯
      // error_message 刻意不撈:報告會外寄,原始錯誤(Postgres/模型內部訊息)不進畫面
      const [runResult, requirementResult] = await Promise.all([
        supabase.from('document_ingestion_runs')
          .select('id, document_version_id, status, started_at, completed_at, input_page_count, metadata')
          .eq('project_id', pid).eq('run_type', 'requirement_extraction')
          .order('started_at', { ascending: false }).limit(RUN_QUERY_LIMIT),
        supabase.from('requirements').select('*')
          .eq('project_id', pid).order('created_at', { ascending: false }).limit(REQUIREMENT_QUERY_LIMIT),
      ])
      if (runResult.error) throw runResult.error
      if (requirementResult.error) throw requirementResult.error
      const runRows = runResult.data || []
      const reqRows = requirementResult.data || []
      const ids = reqRows.map((r) => r.id)
      const sourceResult = ids.length
        ? await pageAllInSafe(ids, (chunk, from, to) => supabase.from('requirement_sources')
          .select('*').in('requirement_id', chunk).order('id').range(from, to))
        : { data: [], error: null }
      if (sourceResult.error) throw sourceResult.error
      const byReq = new Map()
      for (const s of sourceResult.data || []) {
        if (!byReq.has(s.requirement_id)) byReq.set(s.requirement_id, [])
        byReq.get(s.requirement_id).push(s)
      }
      const versionIds = [...new Set([
        ...(sourceResult.data || []).map((s) => s.document_version_id),
        ...runRows.map((r) => r.document_version_id),
      ].filter(Boolean))]
      let versions = []
      if (versionIds.length) {
        const versionResult = await pageAllInSafe(versionIds, (chunk, from, to) => supabase.from('document_versions')
          .select('id, version_label, documents(title, document_type)').in('id', chunk).order('id').range(from, to))
        if (versionResult.error) throw versionResult.error
        versions = versionResult.data || []
      }
      setState({
        loaded: true, error: '', runs: runRows, rows: reqRows,
        sourcesByReq: byReq, versionsById: new Map(versions.map((v) => [v.id, v])),
      })
    } catch (error) {
      // 合規:不把 Postgres/edge 原始錯誤印上畫面(附表十構面五);
      // 業務規則訊息(P0001)由 friendlyError 原樣放行
      setState((s) => ({ ...s, loaded: true, error: friendlyError(error, '載入未完成,請稍後再試。') }))
    }
  }, [isPersistedProject, pid])
  useEffect(() => { load() }, [load])

  const coverageRows = useMemo(() => buildCoverageRows(state.runs), [state.runs])
  const verificationByReq = useMemo(() => {
    const map = new Map()
    for (const r of state.rows) map.set(r.id, sourceVerificationSummary(state.sourcesByReq.get(r.id)))
    return map
  }, [state.rows, state.sourcesByReq])
  // 與 /requirements 畫面同一套範圍規則:已核定不受 run 限制;待審只取每個
  // 文件版本最新成功 run 的 AI 建議+人工補登(rejected/superseded 不進報告)
  const highlights = useMemo(() => buildRequirementHighlights(
    state.rows, latestCompletedRunIds(state.runs), verificationByReq,
  ), [state.rows, state.runs, verificationByReq])
  const pendingStatusCounts = useMemo(() => {
    const counts = new Map()
    for (const g of highlights.suggestions) {
      const label = REQUIREMENT_STATUS_LABELS[g.requirement.status] || g.requirement.status
      counts.set(label, (counts.get(label) || 0) + 1)
    }
    return [...counts.entries()].map(([label, n]) => `${label} ${n} 項`).join('、')
  }, [highlights])

  if (!currentUser) return <Navigate to="/login" replace />
  if (!isPersistedProject) {
    return (
      <div className="p-10 text-center text-slate-400">
        對照報告需真實專案的 AI 分析紀錄。
        <button onClick={() => navigate('/requirements')} className="text-[var(--blue-text)] underline">返回契約重點</button>
      </div>
    )
  }
  if (!state.loaded) return <div className="p-10 text-center text-slate-400">正在整理對照報告…</div>
  if (state.error) {
    return (
      <div className="p-10 text-center text-slate-400">
        對照報告載入失敗:{state.error}。
        <button onClick={() => navigate('/requirements')} className="text-[var(--blue-text)] underline">返回契約重點</button>
      </div>
    )
  }
  if (!state.runs.length && !state.rows.length) {
    return (
      <div className="p-10 text-center text-slate-400">
        尚無 AI 分析紀錄與契約重點。到「專案文件」上傳契約後,再回來輸出對照報告。
        <button onClick={() => navigate('/requirements')} className="text-[var(--blue-text)] underline">返回契約重點</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white py-6 print:py-0">
      {/* 工具列(列印時隱藏)*/}
      <div className="max-w-[210mm] mx-auto mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden px-1">
        <button onClick={() => navigate('/requirements')} className={TOOLBAR_SECONDARY}>← 返回契約重點</button>
        <button onClick={() => window.print()} className={TOOLBAR_PRIMARY}>
          <MSym name="print" size={15} />列印 / 存 PDF
        </button>
      </div>
      <ReportBody
        project={currentProject}
        generatedAt={generatedAt}
        coverageRows={coverageRows}
        versionsById={state.versionsById}
        highlights={highlights}
        sourcesByReq={state.sourcesByReq}
        pendingStatusCounts={pendingStatusCounts}
        requirementsCapped={state.rows.length >= REQUIREMENT_QUERY_LIMIT}
        runsCapped={state.runs.length >= RUN_QUERY_LIMIT}
      />
    </div>
  )
}
