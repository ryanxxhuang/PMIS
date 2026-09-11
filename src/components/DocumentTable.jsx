// 專案文件頁的「專案文件」卡(已入庫清單):文件/分類/版本/AI 處理/上傳五欄,
// 含 W14 事後治理(確認分類的 inline select、改分類、重試分析、刪除)、開檔/下載
// 入口與頁底技術資訊。排序、分頁、「哪一列開著改分類」與技術資訊開關都是這張表
// 自己的狀態,跟著表走;動 DB 的動作(確認分類/重試/刪除)留在 Contract.jsx。
// 手機(<md)表格改直向列:thead 進 sr-only、每列 grid 兩欄(09-08 修正,不可弄丟)。
// 只有一個使用點,抽出來是為了把 Contract.jsx 讀得完;顏色走 token、字級走階梯。
import { useState, useMemo } from 'react'
import { MSym } from './icons.jsx'
import {
  Card, Empty, Badge, Select, SortableTh, TablePager, ErrorBanner, SkeletonList, THEAD_CLS,
} from './ui.jsx'
import { appConfirm } from './confirm.jsx'
import { useTableSort, usePagination } from '../lib/useTable.js'
import { friendlyError } from '../lib/errorMessage.js'
import {
  DOCUMENT_TYPE_LABELS, CLASSIFIABLE_DOCUMENT_TYPES, EXTRACTABLE_DOCUMENT_TYPES, presentationGroup,
} from '../lib/documentClassifier.js'
import { isTerminalRun, stageDetail, runFileLanded, isValidStorageKey } from '../lib/packageUpload.js'

// 表頭字型層吃 ui.jsx 的 THEAD_CLS(全站單一真相)
const DOC_TH = `text-left ${THEAD_CLS} py-2.5 px-3 whitespace-nowrap`
const DOC_THR = `text-right ${THEAD_CLS} py-2.5 px-3 whitespace-nowrap`
const DOC_TD = 'py-2.5 px-3 text-body align-top max-md:px-0 max-md:py-1.5 max-md:min-w-0'
const LINK_BTN = 'text-[var(--blue-text)] hover:underline inline-flex items-center gap-0.5 max-md:min-h-11 px-1'

// AI 處理欄的固定四狀態(mockup):已完成/處理中/待處理/無需處理。
// 色票只寫狀態,數字與原因寫在下方細節行。
export function aiProcessingState(run) {
  if (!isTerminalRun(run)) {
    return { kind: 'processing', label: '處理中', color: 'blue', detail: stageDetail(run) }
  }
  if (run.status === 'unsupported') {
    return { kind: 'na', label: '無需處理', color: 'slate', detail: run.metadata?.limitation || '尚未支援內容分析' }
  }
  if (run.classification_status === 'needs_review') {
    return { kind: 'attention', label: '待處理', color: 'red', detail: `AI 建議分類:${DOCUMENT_TYPE_LABELS[run.suggested_document_type] || '無法判斷'},請人工確認` }
  }
  if (run.metadata?.requirement_extraction_warning) {
    return { kind: 'attention', label: '部分整理', color: 'amber', detail: run.metadata.requirement_extraction_warning }
  }
  if (run.status === 'failed' || run.status === 'partial') {
    return { kind: 'attention', label: '待處理', color: 'red', detail: friendlyError(run.error_message, '處理未完成') }
  }
  return { kind: 'done', label: '已完成', color: 'green', detail: run.metadata?.requirement_extraction_message || '已分類歸檔' }
}

function ClassifySelect({ defaultValue, onChange }) {
  return (
    <Select defaultValue={defaultValue} className="w-36" onChange={onChange}>
      {CLASSIFIABLE_DOCUMENT_TYPES.map((t) => (
        <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
      ))}
    </Select>
  )
}

export default function DocumentTable({
  runs, versionsById, docsById, loading, error, blocked, onRetryLoad,
  canWriteContract, busyRunIds, onClassify, onRetry, onDelete, onOpen, onDownload,
}) {
  // W14 事後治理:哪一列正開著「改分類」的下拉(一次只開一列)
  const [reclassifyId, setReclassifyId] = useState(null)
  const [showTech, setShowTech] = useState(false)
  const rows = useMemo(() => runs.map((run) => {
    const version = versionsById.get(run.document_version_id)
    const doc = version ? docsById.get(version.document_id) : null
    return {
      run, doc, version,
      title: doc?.title || '文件',
      group: presentationGroup(doc?.document_type || run.suggested_document_type || 'other',
        run.metadata?.classification_reason),
      uploaded: run.started_at || '',
    }
  }), [runs, versionsById, docsById])
  const { sort, toggleSort, sorted, sortKey } = useTableSort(rows)
  // resetKey 只給排序:這張表在 AI 分析期間每 5 秒重載一次 runs,
  // 若讓重載本身重設頁碼,使用者翻到第 2 頁就會一直被彈回第 1 頁
  const { pageRows, pager } = usePagination(sorted, 25, sortKey)

  // 改成可抽取類型會重跑一次 AI 抽取(新的一批待核建議),先講清楚再動手;
  // 已核定項目不受影響。走 appConfirm(全站同一套對話框;原生 confirm 在自動化
  // 測試與嵌入式瀏覽器會被封鎖成「按了沒反應」)。
  const reclassify = async (run, nextType) => {
    setReclassifyId(null)
    if (EXTRACTABLE_DOCUMENT_TYPES.includes(nextType) && !(await appConfirm({
      title: `改為「${DOCUMENT_TYPE_LABELS[nextType]}」會重新執行 AI 抽取`,
      body: '會產生一批新的建議(已確認項目不受影響)。繼續?',
      confirmLabel: '繼續',
    }))) return
    onClassify(run, nextType)
  }

  return (
    <Card title="專案文件" action={
      <span className="text-caption text-[var(--text-3)] num">{rows.length} 件</span>
    }>
      <ErrorBanner msg={error} onRetry={onRetryLoad} />
      {loading ? <SkeletonList rows={3} label="正在載入契約文件…" /> : (blocked || error) ? null : rows.length === 0 ? (
        <Empty>這份契約尚無文件。上傳後會在這裡列出各檔的處理狀態。</Empty>
      ) : (<>
        <div className="overflow-x-auto">
          <table aria-label="專案文件處理狀態" className="w-full text-sm min-w-[640px] max-md:min-w-0 max-md:block">
            <thead className="max-md:sr-only">
              <tr className="border-b border-[var(--border)]">
                <SortableTh className={DOC_TH} label="文件" field="title" sort={sort} onSort={toggleSort} />
                <th className={DOC_TH}>分類</th>
                <th className={DOC_TH}>版本</th>
                <th className={DOC_TH}>AI 處理</th>
                <SortableTh className={DOC_THR} align="right" label="上傳" field="uploaded" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody className="max-md:block">
              {pageRows.map(({ run, doc, version, title, group, uploaded }) => {
                const state = aiProcessingState(run)
                const needsClassify = state.kind === 'attention' && run.classification_status === 'needs_review'
                // 只有 AI 分析失敗才可原地重試;上傳失敗/掃描檔要重新上傳同檔
                const retryable = state.kind === 'attention' && !needsClassify
                  && run.metadata?.requirement_extraction === 'failed'
                const reuploadHint = state.kind === 'attention' && !needsClassify && !retryable && !run.metadata?.requirement_extraction_warning
                  && !(state.detail || '').includes('重新上傳')
                // 看上傳的檔案:上傳前就失敗的 run 原始檔從未落地,不給開檔入口
                const hasFile = runFileLanded(run) && isValidStorageKey(version?.storage_path)
                const busy = busyRunIds.has(run.id)
                return (
                  <tr key={run.id} className="border-b border-[var(--border-2)] last:border-0 hover:bg-[var(--surface-2)] max-md:grid max-md:grid-cols-2 max-md:py-3">
                    <td className={`${DOC_TD} max-w-[300px] max-md:max-w-none max-md:col-span-2`}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <MSym name="description" size={12} className="text-[var(--text-3)] shrink-0" />
                        {hasFile ? (
                          <button onClick={() => onOpen(version)}
                            className="min-w-0 inline-flex items-center max-md:min-h-11 text-left text-[var(--text)] hover:text-[var(--blue-text)] hover:underline cursor-pointer"
                            title={version?.original_filename || title}>
                            <span className="truncate">{title}</span>
                          </button>
                        ) : (
                          <span className="truncate text-[var(--text)]" title={title}>{title}</span>
                        )}
                      </div>
                    </td>
                    <td className={`${DOC_TD} text-[var(--text-2)]`}><span className="md:hidden text-[var(--text-3)]">分類：</span>{group}</td>
                    <td className={`${DOC_TD} whitespace-nowrap num text-[var(--text-2)] max-md:text-right`}><span className="md:hidden text-[var(--text-3)]">版本：</span>{version?.version_label || '—'}</td>
                    <td className={`${DOC_TD} max-md:col-span-2`}>
                      <Badge color={state.color}>{state.label}</Badge>
                      <div className="text-caption text-[var(--text-3)] mt-1 max-w-[300px]">
                        <span className="line-clamp-2 max-md:line-clamp-none whitespace-pre-line" title={state.detail}>{state.detail}</span>
                        {/* 待處理的兩種人工動作:確認分類/重試分析 */}
                        {needsClassify && canWriteContract && (
                          <span className="flex flex-wrap items-center gap-1.5 mt-1">
                            <ClassifySelect defaultValue={run.suggested_document_type || 'other'}
                              onChange={(e) => onClassify(run, e.target.value)} />
                            <button onClick={() => onClassify(run, run.suggested_document_type || 'other')}
                              className="text-[var(--blue-text)] hover:underline whitespace-nowrap inline-flex items-center max-md:min-h-11 px-1">確認此分類</button>
                          </span>
                        )}
                        {retryable && canWriteContract && (
                          <button onClick={() => onRetry(run)} disabled={busy}
                            className={`${LINK_BTN} mt-0.5 disabled:opacity-50 disabled:no-underline`}>
                            <MSym name="refresh" size={11} /> 重試分析
                          </button>
                        )}
                        {reuploadHint && (
                          <span className="block mt-0.5">請重新上傳同一份檔案(內容相同會自動接續處理)</span>
                        )}
                        {/* W14 事後治理:終態文件可改分類/刪除(權限=文件管理)。
                            改分類只給「曾分類過」的列——上傳失敗的列連頁都沒有,
                            分類不是它的問題;刪除則全終態可用,含分類待確認列
                            (待確認的垃圾檔正是最想刪的)。
                            下載給所有可讀成員(含機關唯讀):讀權限由 storage
                            policy 把關,前端只是入口。 */}
                        {(canWriteContract || hasFile) && state.kind !== 'processing' && (
                          canWriteContract && reclassifyId === run.id ? (
                            <span className="flex items-center gap-1.5 mt-1">
                              <ClassifySelect defaultValue={doc?.document_type || run.suggested_document_type || 'other'}
                                onChange={(e) => reclassify(run, e.target.value)} />
                              <button onClick={() => setReclassifyId(null)}
                                className="text-[var(--text-3)] hover:underline px-1 max-md:min-h-11">取消</button>
                            </span>
                          ) : (
                            <span className="flex items-center gap-2 mt-0.5">
                              {hasFile && (
                                <button onClick={() => onDownload(version)} className={LINK_BTN}>
                                  <MSym name="download" size={11} /> 下載
                                </button>
                              )}
                              {canWriteContract && !needsClassify && run.suggested_document_type != null && (
                                <button onClick={() => setReclassifyId(run.id)} disabled={busy}
                                  className={`${LINK_BTN} disabled:opacity-50`}>
                                  <MSym name="edit" size={11} /> 改分類
                                </button>
                              )}
                              {canWriteContract && (
                                <button onClick={() => onDelete(run, doc)} disabled={busy}
                                  className="text-[var(--red-text)] hover:underline inline-flex items-center gap-0.5 max-md:min-h-11 px-1 disabled:opacity-50">
                                  <MSym name="delete" size={11} /> 刪除
                                </button>
                              )}
                            </span>
                          )
                        )}
                      </div>
                    </td>
                    <td className={`${DOC_TD} text-right num whitespace-nowrap text-[var(--text-2)] max-md:col-span-2 max-md:text-left`}>
                      <span className="md:hidden text-[var(--text-3)]">上傳：</span>
                      {uploaded ? String(uploaded).slice(0, 10) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <TablePager {...pager} className="!px-0" />
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--border-2)]">
          <p className="text-caption text-[var(--text-3)]">點檔名可開啟原始檔(PDF 直接預覽,其他格式自動下載)。上傳後自動分類歸檔:標單匯入「標單工項」、契約/規範抽取「契約重點」並記錄擷取來源頁碼。</p>
          <button onClick={() => setShowTech((s) => !s)} aria-expanded={showTech}
            className="text-caption text-[var(--blue-text)] hover:underline inline-flex items-center gap-1 shrink-0 max-md:min-h-11 px-1">
            <MSym name="chevron_right" size={12} className={`transition-transform duration-[var(--dur-fast)] ${showTech ? 'rotate-90' : ''}`} /> 技術資訊
          </button>
        </div>
        {showTech && (
          <div className="mt-2 text-caption text-[var(--text-3)] space-y-0.5">
            {rows.map(({ run, doc, version }) => (
              <div key={run.id}>
                {version ? doc?.title : run.document_version_id}
                ·status {run.status}·stage {run.stage}·parser {run.parser_type || '-'}
                ·信心 {run.classification_confidence != null ? Math.round(run.classification_confidence * 100) + '%' : '-'}
                {run.error_message ? `·${friendlyError(run.error_message, '處理未完成')}` : ''}
              </div>
            ))}
          </div>
        )}
      </>)}
    </Card>
  )
}
