// 專案文件頁的上傳回饋面板(mockup 狀態 B/C/D):標頭(整理中/完成/需留意/待處理)
// + 總進度條 + 逐檔列 + 結束摘要。帳目(哪些列、幾個完成/待確認/失敗、進度 %)
// 由 lib/packageUpload.js 的 summarizeUploadBatch 算好傳進來,這裡只畫;
// 「重試」與「關閉」的行為留在 Contract.jsx(重試要進 run 狀態機、關閉要清本批)。
// 只有一個使用點,抽出來是為了把 Contract.jsx 的上傳主路徑讀得完,不是為了複用。
// 顏色走 token、字級走 @theme 階梯(規範 docs/UIUX-Apple-設計規範.md)。
import { Link } from 'react-router-dom'
import { MSym } from './icons.jsx'
import { IconButton, buttonClass } from './ui.jsx'
import { friendlyError } from '../lib/errorMessage.js'
import { DOCUMENT_TYPE_LABELS } from '../lib/documentClassifier.js'
import { isTerminalRun, runPct, stageDetail } from '../lib/packageUpload.js'

// 成功列的 meta fallback(unsupported 也算落地:檔案已保存只是不分析)
function landedDetail(run) {
  return run.status === 'unsupported'
    ? (run.metadata?.limitation || '已保存;此格式尚未支援內容分析')
    : '已分類歸檔'
}

// 標頭四態的文案與色票。busy 標頭統一報「正在整理」(使用者裁示);XML 匯入的
// 細節由面板內 boqBusy 那一列顯示,不佔標頭。
// W13 起上傳與 AI 分析的接力由「這個瀏覽器分頁」驅動:可以切到系統其他功能頁
// 做事(處理會繼續,回來看進度),但關閉/重新整理分頁會中斷(已完成的部分保留,
// 重試會接續)。
function panelHead(state, batch, elapsed) {
  const done = batch.ok.length + batch.needs.length
  return {
    busy: {
      icon: 'cloud_upload', fill: false, cls: 'text-[var(--blue-text)]',
      title: batch.total ? `正在整理 ${batch.total} 個檔案` : '正在準備上傳…',
      sub: batch.total
        ? `已完成 ${done} / ${batch.total}${elapsed ? ` · 已進行 ${elapsed}` : ''} · 可切到其他頁做事;請勿關閉或重新整理此分頁`
        : '此步驟請勿離開頁面',
      right: batch.total ? `${batch.overallPct}%` : '', bar: 'bg-[var(--blue)]',
    },
    ok: {
      icon: 'check_circle', fill: true, cls: 'text-[var(--green-text)]',
      title: `${batch.ok.length} 個檔案處理完成`,
      sub: '檔案已歸檔；各檔是否完成內容分析，請看下方狀態。',
      right: '完成', bar: 'bg-[var(--green-text)]',
    },
    warn: {
      icon: 'error', fill: true, cls: 'text-[var(--amber-text)]',
      title: `${done} 個檔案處理完成,${batch.needs.length} 個需留意`,
      sub: '部分文件需要確認分類或補齊內容；請查看下方各檔的原因與處理方式。',
      right: `${batch.needs.length} 待確認`, bar: 'bg-[var(--amber-text)]',
    },
    err: {
      icon: 'error', fill: true, cls: 'text-[var(--red-text)]',
      title: `${batch.rows.length - batch.failed.length} 個檔案處理完成,${batch.failed.length} 個待處理`,
      sub: '待處理的檔案不影響已完成的部分。',
      right: `${batch.rows.length - batch.failed.length}/${batch.rows.length}`, bar: 'bg-[var(--red-text)]',
    },
  }[state]
}

export default function UploadPanel({
  batch, busy, boqBusy, elapsed, docsById, versionsById,
  canWriteContract, busyRunIds, onRetry, onDismiss, aiCount, packageId, boqImported,
}) {
  const state = busy ? 'busy' : (batch.failed.length ? 'err' : batch.needs.length ? 'warn' : 'ok')
  const head = panelHead(state, batch, elapsed)
  const titleOf = (run) => {
    const version = versionsById.get(run.document_version_id)
    return version ? docsById.get(version.document_id)?.title : undefined
  }
  const pct = busy ? batch.overallPct : 100
  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3.5 py-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <MSym name={head.icon} size={20} fill={head.fill} className={`shrink-0 ${head.cls}`} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--text)]">{head.title}</div>
            <div className="text-xs text-[var(--text-3)] mt-0.5" aria-live="polite">{head.sub}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-footnote font-medium num ${head.cls}`}>{head.right}</span>
          {/* 關閉鈕永遠可按:中斷遺留的 processing run 會讓 busy 掛到
              20 分鐘 stale 門檻,不能鎖住整個拖放區(審查 W11 發現) */}
          <IconButton name="close" label="關閉上傳結果" onClick={onDismiss} />
        </div>
      </div>
      {/* 總進度條(各檔真實階段的平均;結束時一律 100%) */}
      <div className="h-1 bg-[var(--border-2)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-1 transition-[width] duration-300 ${head.bar}`} style={{ width: `${pct}%` }} />
      </div>
      {/* 逐檔列 */}
      {boqBusy && (
        <div className="flex items-center gap-3 px-3.5 py-2.5 border-t border-[var(--border-2)] text-xs text-[var(--text-2)]">
          <MSym name="progress_activity" size={19} className="msym-spin text-[var(--blue-text)] shrink-0" />
          正在解析標單 XML…(此步驟請勿離開頁面)
        </div>
      )}
      {batch.rows.map((r) => {
        const name = titleOf(r) || r.metadata?.filename_kind || '文件'
        const running = !isTerminalRun(r)
        const failed = r.status === 'failed' || r.status === 'partial'
        const needsReview = !running && !failed && r.classification_status === 'needs_review'
        const incomplete = !running && !failed && r.metadata?.requirement_extraction_warning
        // 只有 AI 分析失敗才可原地重試;上傳失敗/掃描檔要重新上傳同檔
        const retryable = failed && r.metadata?.requirement_extraction === 'failed'
        const failMeta = failed
          ? `${friendlyError(r.error_message, '處理未完成')}${!retryable && !(r.error_message || '').includes('重新上傳') ? ';請重新上傳同一份檔案(內容相同會自動接續)' : ''}`
          : null
        return (
          <div key={r.id} className="grid grid-cols-[22px_1fr_128px] items-center gap-3 px-3.5 py-2.5 border-t border-[var(--border-2)]">
            <MSym
              name={running ? 'draft' : failed || needsReview || incomplete ? 'error' : 'check_circle'}
              size={19} fill={!running}
              className={running ? 'text-[var(--blue-text)]' : failed ? 'text-[var(--red-text)]' : needsReview || incomplete ? 'text-[var(--amber-text)]' : 'text-[var(--green-text)]'} />
            <div className="min-w-0">
              <div className="text-footnote text-[var(--text)] truncate" title={name}>{name}</div>
              <div className={`text-caption mt-0.5 ${failed ? 'text-[var(--red-text)]' : needsReview ? 'text-[var(--amber-text)]' : 'text-[var(--text-3)]'}`}>
                {running ? stageDetail(r)
                  : failed ? failMeta
                    : needsReview ? `AI 建議分類:${DOCUMENT_TYPE_LABELS[r.suggested_document_type] || '無法判斷'};請到下方清單確認,確認後自動接續分析`
                      : (r.metadata?.requirement_extraction_message || landedDetail(r))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              {running ? (<>
                <div className="w-[66px] h-1 rounded-full bg-[var(--border-2)] overflow-hidden">
                  <div className="h-1 rounded-full bg-[var(--blue)] transition-[width] duration-300" style={{ width: `${runPct(r)}%` }} />
                </div>
                <span className="text-caption text-[var(--text-3)] num min-w-[34px] text-right">{runPct(r)}%</span>
              </>) : failed ? (
                retryable && canWriteContract ? (
                  <button onClick={() => onRetry(r)} disabled={busyRunIds.has(r.id)}
                    className={buttonClass('outline', 'sm')}>重試</button>
                ) : <span className="text-caption font-medium text-[var(--red-text)]">待處理</span>
              ) : needsReview || incomplete ? (
                <span className="text-caption font-medium text-[var(--amber-text)]">{incomplete ? '部分整理' : '待確認'}</span>
              ) : (
                <span className="text-caption font-medium text-[var(--green-text)]">已完成</span>
              )}
            </div>
          </div>
        )
      })}
      {/* 狀態 C/D:結束摘要 */}
      {!busy && state === 'ok' && (
        <div className="m-3.5 rounded-xl bg-[var(--green-tint)] px-3.5 py-3 flex items-start gap-2.5">
          <MSym name="check_circle" size={19} fill className="text-[var(--green-text)] shrink-0 mt-0.5" />
          <div className="text-footnote text-[var(--green-text)] leading-relaxed">
            {batch.ok.length} 個檔案處理完成,已自動分類歸檔。
            {aiCount != null && aiCount > 0 && ` 本契約目前有 ${aiCount} 項已歸檔契約重點。`}
            <br />
            <Link to={`/requirements?package=${encodeURIComponent(packageId || '')}`} className="font-medium hover:underline inline-flex items-center gap-0.5">前往契約重點 <MSym name="arrow_forward" size={12} /></Link>
            {boqImported && (<>
              {' '}·{' '}
              <Link to="/boq" className="font-medium hover:underline inline-flex items-center gap-0.5">查看標單工項 <MSym name="arrow_forward" size={12} /></Link>
            </>)}
          </div>
        </div>
      )}
      {!busy && state === 'err' && (
        <div className="m-3.5 rounded-xl bg-[var(--red-tint)] px-3.5 py-3">
          <div className="flex items-start gap-2.5">
            <MSym name="error" size={19} fill className="text-[var(--red-text)] shrink-0 mt-0.5" />
            <div className="text-footnote text-[var(--red-text)] leading-relaxed">
              {batch.failed.length} 個檔案待處理:{batch.failed[0] && (titleOf(batch.failed[0]) || '文件')}
              {batch.failed[0]?.error_message ? `——${friendlyError(batch.failed[0].error_message, '處理未完成')}` : ''}
              {/* 與標頭同一套帳:處理完成=非失敗(含分類待確認),兩處數字不得打架 */}
              。其餘 {batch.rows.length - batch.failed.length} 個檔案處理完成,不需重傳。
            </div>
          </div>
          {batch.failed.length > batch.extractionFailed.length && (
            <div className="text-caption text-[var(--red-text)] mt-1.5 pl-[29.5px]">
              上傳失敗或無法讀取的檔案:內容相同重新上傳會自動接續;超過大小上限的請壓縮或拆分後再上傳。
            </div>
          )}
          <div className="flex gap-2 mt-2.5 pl-[29.5px]">
            {canWriteContract && batch.extractionFailed.length > 0 && (
              <button className={buttonClass('primary', 'sm')}
                disabled={batch.extractionFailed.every((r) => busyRunIds.has(r.id))}
                onClick={() => batch.extractionFailed.forEach((r) => onRetry(r))}>重試 AI 分析失敗的檔案</button>
            )}
            <button className={buttonClass('outline', 'sm')} onClick={onDismiss}>略過並繼續</button>
          </div>
        </div>
      )}
    </div>
  )
}
