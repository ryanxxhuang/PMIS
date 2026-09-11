// 專案文件頁的清單／詳情殼兩半:左欄「專案文件」卡(搜尋＋狀態/類型快篩＋列)與
// 右欄文件詳情(版本、頁數、分類結果與 AI 第二意見、抽取狀態、就地動作)。
// 改版前是五欄表格(DocumentTable):動作塞在「AI 處理」格的細節行裡,一列可以長出
// 下拉＋三顆連結鈕把整列撐高,手機還要把 thead 藏進 sr-only 再逐格補標籤。現在列只
// 負責選取,動作全部移進詳情欄,詳情永遠在同一個位置(規範 §0 疊合版、§8 IA 殼)。
// 選取/篩選狀態與動 DB 的動作(確認分類/重試/刪除/開檔)都留在 Contract.jsx,這裡
// 只畫;只有一個使用點,抽出來是為了把 Contract.jsx 讀得完。
// 顏色走 token、字級走 @theme 階梯(規範 docs/UIUX-Apple-設計規範.md)。
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from './icons.jsx'
import { Card, Empty, Badge, Dot, Select, Button, ErrorBanner, SkeletonList, buttonClass } from './ui.jsx'
import { SearchField, StatusChip, MetaGrid } from './listDetail.jsx'
import { friendlyError } from '../lib/errorMessage.js'
import {
  DOCUMENT_TYPE_LABELS, CLASSIFIABLE_DOCUMENT_TYPES, EXTRACTABLE_DOCUMENT_TYPES, presentationGroup,
} from '../lib/documentClassifier.js'
import { isTerminalRun, stageDetail, runFileLanded, isValidStorageKey, runPct } from '../lib/packageUpload.js'

// AI 處理的固定四狀態:已完成/處理中/待處理/無需處理。色票只寫狀態,數字與原因
// 寫在 detail。「部分整理」(抽取有警告)歸在 attention 但用 amber——它不是失敗,
// 是「已產出、但有一段沒讀完」,跟待確認分類/處理失敗的紅不同一個急迫度。
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

// 快篩的四段狀態(順序=急迫度:先看待處理)。chip 名用 kind 的統稱,「部分整理」
// 併入待處理——快篩是「我現在要不要動手」的分段,不是逐一重複狀態色票。
export const DOC_STATES = Object.freeze([
  { kind: 'attention', label: '待處理', color: 'red' },
  { kind: 'processing', label: '處理中', color: 'blue' },
  { kind: 'done', label: '已完成', color: 'green' },
  { kind: 'na', label: '無需處理', color: 'slate' },
])

const CLASSIFICATION_LABELS = { auto_accepted: '自動判定', confirmed: '人工確認', needs_review: '待人工確認' }

// run + version + document 併成清單列;id 用 run.id(每個文件版本一條 run,
// 刪除/重試都以 run 為鍵)。上傳新→舊:文件管理員關心的永遠是剛丟進來那幾份。
export function buildDocumentRows(runs, versionsById, docsById) {
  return runs.map((run) => {
    const version = versionsById.get(run.document_version_id)
    const doc = version ? docsById.get(version.document_id) : null
    return {
      id: run.id, run, doc, version,
      title: doc?.title || '文件',
      group: presentationGroup(doc?.document_type || run.suggested_document_type || 'other',
        run.metadata?.classification_reason),
      uploaded: run.started_at || '',
      state: aiProcessingState(run),
    }
  }).sort((a, b) => b.uploaded.localeCompare(a.uploaded) || a.id.localeCompare(b.id))
}

function ClassifySelect({ defaultValue, onChange, label }) {
  return (
    <Select defaultValue={defaultValue} className="w-40" onChange={onChange} aria-label={label}>
      {CLASSIFIABLE_DOCUMENT_TYPES.map((t) => (
        <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
      ))}
    </Select>
  )
}

// ── 左欄:專案文件卡(搜尋 + 狀態快篩 + 類型快篩 + 列)。
// 兩組快篩各自單選、再點取消,與搜尋三者 AND;件數走全體(不受搜尋影響)。
// 類型 chip 只列本包出現過的分群:分群是呈現標籤不是工作流,「還沒有圖說」不是
// 這一頁要回答的問題(缺哪類文件由初始化清單管)。狀態四段則固定顯示,0 也留——
// 「沒有待處理」正是文件管理員要的答案。
export function DocumentList({
  rows, ordered, selectedId, onSelect, filters, setFilters, searchRef, stateCounts, groupCounts,
  loading, error, blocked, onRetryLoad,
}) {
  const anyFilter = filters.q.trim() !== '' || filters.state !== '' || filters.group !== ''
  return (
    <Card title={`專案文件（${rows.length}）`} bodyClass="p-0">
      <ErrorBanner msg={error} onRetry={onRetryLoad} className="m-5" />
      {loading ? <div className="p-5"><SkeletonList rows={3} label="正在載入契約文件…" /></div>
        : (blocked || error) ? null
          : rows.length === 0 ? (
            <Empty>這份契約尚無文件。由施工廠商或監造在上方上傳契約與附件後,AI 會自動分類歸檔並抽出契約重點。</Empty>
          ) : (<>
            <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
              <SearchField ref={searchRef} value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                placeholder="搜尋檔名、分類或處理原因…" aria-label="搜尋專案文件" />
              <div className="flex items-center gap-2 flex-wrap">
                {DOC_STATES.map((s) => (
                  <StatusChip key={s.kind} active={filters.state === s.kind} count={stateCounts[s.kind] || 0}
                    onClick={() => setFilters((f) => ({ ...f, state: f.state === s.kind ? '' : s.kind }))}>
                    <Dot color={s.color} />{s.label}
                  </StatusChip>
                ))}
                {anyFilter && (
                  <Button variant="ghost" size="sm" onClick={() => setFilters({ q: '', state: '', group: '' })}>清除篩選</Button>
                )}
              </div>
              {Object.keys(groupCounts).length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  {Object.entries(groupCounts).map(([g, n]) => (
                    <StatusChip key={g} active={filters.group === g} count={n}
                      onClick={() => setFilters((f) => ({ ...f, group: f.group === g ? '' : g }))}>
                      {g}
                    </StatusChip>
                  ))}
                </div>
              )}
            </div>
            {/* 列只負責選取(動作全在詳情欄):兩行=狀態＋檔名 / 分群＋版本＋上傳日。
                role=listitem + aria-current 與 /safety、/rfi 同一套選取語意。用 button
                掛 role=listitem 而不是 <li> 包 <button>:檔名同時是詳情欄「開啟原始檔」
                鈕的名字,列若也是 button,getByRole('button', { name: 檔名 })(e2e-real
                file-viewing)會命中兩顆。 */}
            <div role="list" aria-label="專案文件" className="divide-y divide-[var(--border-2)]">
              {ordered.length === 0 ? (
                <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
                  沒有符合條件的文件。<br />換一個狀態或類型,或試試檔名關鍵字。
                </div>
              ) : ordered.map((r) => {
                const active = r.id === selectedId
                return (
                  <button key={r.id} type="button" role="listitem" id={`doc-${r.id}`}
                    aria-current={active || undefined}
                    onClick={() => onSelect(r.id)}
                    className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer ${active
                      ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
                    <span className="flex items-center gap-2 flex-wrap">
                      <Badge color={r.state.color}>{r.state.label}</Badge>
                      <span className="text-body text-[var(--text)] min-w-0 break-all [text-wrap:pretty]">{r.title}</span>
                    </span>
                    <span className="block mt-0.5 num text-caption text-[var(--text-3)] truncate">
                      {[r.group, r.version?.version_label, r.uploaded ? String(r.uploaded).slice(0, 10) : ''].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="px-5 py-3 border-t border-[var(--border-2)] text-caption text-[var(--text-3)] leading-relaxed">
              上傳後自動分類歸檔:標單匯入「標單工項」、契約/規範抽取「契約重點」並記錄擷取來源頁碼。點一份文件查看版本、分類與處理狀態。
            </p>
          </>)}
    </Card>
  )
}

// ── 右欄:文件詳情。狀態列 / 檔名(可開檔) / key-value / 處理狀態 / AI 第二意見 /
// 技術資訊 / 動作列。動作條件與改版前表格細節行逐條相同,一條都沒放寬:
//   needsClassify = 待確認分類 ∧ canWrite           → 確認此分類(可先改選)
//   retryable     = 失敗 ∧ AI 抽取失敗 ∧ canWrite    → 重試分析(上傳失敗/掃描檔要重傳)
//   hasFile       = 原始檔真的落地                    → 檔名開檔、下載(讀權限由 storage policy 把關)
//   reclassifiable= canWrite ∧ 終態 ∧ ¬needsClassify ∧ 曾分類過 → 改分類
//   deletable     = canWrite ∧ 終態                   → 刪除(RPC delete_document 在伺服器端守門)
export function DocumentDetail({
  row, packageName, packageId, canWriteContract, busy,
  reclassifying, onReclassifyOpen, onReclassifyCancel, onReclassify,
  onClassify, onRetry, onDelete, onOpen, onDownload,
}) {
  const [showTech, setShowTech] = useState(false)
  const { run, doc, version, title, group, state } = row
  const terminal = state.kind !== 'processing'
  const needsClassify = state.kind === 'attention' && run.classification_status === 'needs_review'
  const retryable = state.kind === 'attention' && !needsClassify && run.metadata?.requirement_extraction === 'failed'
  const reuploadHint = state.kind === 'attention' && !needsClassify && !retryable
    && !run.metadata?.requirement_extraction_warning && !(state.detail || '').includes('重新上傳')
  const hasFile = runFileLanded(run) && isValidStorageKey(version?.storage_path)
  const reclassifiable = canWriteContract && terminal && !needsClassify && run.suggested_document_type != null
  const deletable = canWriteContract && terminal
  const docType = doc?.document_type || null
  const extractable = docType && EXTRACTABLE_DOCUMENT_TYPES.includes(docType)
  const confidence = run.classification_confidence != null ? `${Math.round(run.classification_confidence * 100)}%` : null

  return (
    // region 以檔名命名:報讀器走地標時直接聽到「契約書.pdf 詳情」,e2e 也用同一個名字
    <section aria-label={`${title} 詳情`}>
      {/* 狀態列:處理狀態＋分群;顏色＋文字並存 */}
      <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
        <Badge color={state.color}>{state.label}</Badge>
        <span className="text-footnote text-[var(--text-2)]">{group}</span>
      </div>

      <div className="p-4">
        {/* 檔名就是開檔入口(PDF/圖片/純文字新分頁預覽,其他格式改走下載):
            上傳前就失敗的 run 原始檔從未落地,不給開檔鈕 */}
        {hasFile ? (
          <button type="button" onClick={() => onOpen(version)} title={version?.original_filename || title}
            className="text-left text-callout font-medium leading-normal text-[var(--text)] hover:text-[var(--blue-text)] hover:underline break-all max-md:min-h-11 inline-flex items-start gap-1.5">
            <span>{title}</span>
            <MSym name="description" size={14} className="shrink-0 mt-1 text-[var(--text-3)]" />
          </button>
        ) : (
          <div className="text-callout font-medium leading-normal text-[var(--text)] break-all">{title}</div>
        )}
        {/* 空值一律顯示 —:六格固定,眼睛掃同一位置就知道有沒有填 */}
        <MetaGrid className="mt-3.5" rows={[
          ['版本', version?.version_label || '—'],
          ['頁數', run.metadata?.page_count ? `${run.metadata.page_count} 頁` : '—'],
          ['分類', docType ? `${DOCUMENT_TYPE_LABELS[docType] || docType}${CLASSIFICATION_LABELS[run.classification_status] ? `（${CLASSIFICATION_LABELS[run.classification_status]}）` : ''}` : '—'],
          ['契約包', packageName || '—'],
          ['上傳', run.started_at ? String(run.started_at).slice(0, 10) : '—'],
          ['處理', state.label],
        ]} />
      </div>

      {/* 處理狀態:原因全文(不 line-clamp,這正是要看的內容);處理中顯示真實階段進度 */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <MSym name={state.kind === 'processing' ? 'progress_activity' : 'info'} size={15}
            className={`text-[var(--text-3)] ${state.kind === 'processing' ? 'msym-spin' : ''}`} />
          <span className="text-footnote font-medium text-[var(--text)]">處理狀態</span>
        </div>
        <p className="text-footnote leading-relaxed text-[var(--text-2)] whitespace-pre-line break-words">{state.detail}</p>
        {state.kind === 'processing' && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-[var(--border-2)] overflow-hidden" role="progressbar"
              aria-valuenow={runPct(run)} aria-valuemin={0} aria-valuemax={100} aria-label="處理進度">
              <div className="h-1 rounded-full bg-[var(--blue)] transition-[width] duration-300" style={{ width: `${runPct(run)}%` }} />
            </div>
            <span className="num text-caption text-[var(--text-3)]">{runPct(run)}%</span>
          </div>
        )}
        {reuploadHint && (
          <p className="mt-1.5 text-caption text-[var(--text-3)]">請重新上傳同一份檔案(內容相同會自動接續處理)。</p>
        )}
      </div>

      {/* AI 第二意見:分類是確定性規則判的(documentClassifier),這裡揭露它的建議、信心
          與理由,以 --ai 身分呈現;待確認時「確認此分類」就貼在建議旁邊(判準第 4 條:
          控制項離它影響的東西夠近)。 */}
      {run.suggested_document_type != null && (
        <div className="px-4 pb-4">
          <div className="rounded-xl bg-[var(--ai-tint)] px-3.5 py-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <MSym name="auto_awesome" size={15} className="text-[var(--ai-text)]" />
              <span className="text-caption font-medium text-[var(--ai-text)]">AI 第二意見</span>
              {confidence && <span className="num text-caption text-[var(--ai-text)] opacity-80">信心 {confidence}</span>}
            </div>
            <p className="text-footnote leading-relaxed text-[var(--text)]">
              建議分類:{DOCUMENT_TYPE_LABELS[run.suggested_document_type] || '無法判斷'}
              {run.metadata?.classification_reason ? `——${run.metadata.classification_reason}` : ''}
            </p>
            {needsClassify && canWriteContract && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <ClassifySelect label="確認文件分類" defaultValue={run.suggested_document_type || 'other'}
                  onChange={(e) => onClassify(run, e.target.value)} />
                <Button size="sm" onClick={() => onClassify(run, run.suggested_document_type || 'other')} disabled={busy}>確認此分類</Button>
              </div>
            )}
            {needsClassify && !canWriteContract && (
              <p className="mt-1.5 text-caption text-[var(--text-3)]">待具文件管理權限的成員(施工廠商/監造)確認分類後,才會接續分析。</p>
            )}
          </div>
        </div>
      )}

      {/* 技術資訊:status/stage/parser 是給回報問題用的,不佔主畫面 */}
      <div className="px-4 pb-4">
        <button type="button" onClick={() => setShowTech((s) => !s)} aria-expanded={showTech}
          className="text-caption text-[var(--blue-text)] hover:underline inline-flex items-center gap-1 max-md:min-h-11">
          <MSym name="chevron_right" size={12} className={`transition-transform duration-[var(--dur-fast)] ${showTech ? 'rotate-90' : ''}`} /> 技術資訊
        </button>
        {showTech && (
          <p className="mt-1 num text-caption text-[var(--text-3)] leading-relaxed break-all">
            status {run.status}·stage {run.stage}·parser {run.parser_type || '-'}·信心 {confidence || '-'}
            {run.error_message ? `·${friendlyError(run.error_message, '處理未完成')}` : ''}
          </p>
        )}
      </div>

      {/* 動作列:改分類開著就換成下拉＋取消(改成可抽取類型會重跑一次 AI 抽取,
          Contract.jsx 先 appConfirm 再動手);同一時間最多一顆實心鈕(確認此分類在上面) */}
      {(retryable || hasFile || reclassifiable || deletable || extractable) && (
        <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
          {reclassifying ? (<>
            <ClassifySelect label="改為分類" defaultValue={docType || run.suggested_document_type || 'other'}
              onChange={(e) => onReclassify(run, e.target.value)} />
            <Button size="sm" variant="secondary" onClick={onReclassifyCancel}>取消</Button>
          </>) : (<>
            {retryable && canWriteContract && (
              <Button size="sm" variant="secondary" onClick={() => onRetry(run)} disabled={busy}>
                <MSym name="refresh" size={14} /> 重試分析
              </Button>
            )}
            {hasFile && (
              <Button size="sm" variant="outline" onClick={() => onDownload(version)}>
                <MSym name="download" size={14} /> 下載
              </Button>
            )}
            {reclassifiable && (
              <Button size="sm" variant="outline" onClick={onReclassifyOpen} disabled={busy}>
                <MSym name="edit" size={14} /> 改分類
              </Button>
            )}
            {extractable && terminal && (
              <Link to={`/requirements?package=${encodeURIComponent(packageId || '')}`} className={buttonClass('ghost', 'sm')}>
                前往契約重點 <MSym name="arrow_forward" size={14} />
              </Link>
            )}
            {deletable && (
              <button type="button" onClick={() => onDelete(run, doc)} disabled={busy}
                className="ml-auto inline-flex items-center gap-1 px-2 h-7 max-md:min-h-11 rounded-lg text-footnote font-medium text-[var(--red-text)] hover:bg-[var(--red-tint)] disabled:opacity-50 pressable">
                <MSym name="delete" size={14} /> 刪除
              </button>
            )}
          </>)}
        </div>
      )}
    </section>
  )
}
