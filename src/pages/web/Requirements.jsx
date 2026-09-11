// 契約重點 · 履約時程——依 design_handoff_contract_highlights_timeline 改版。
// 單一目的:AI 讀完契約與規範後,把每一條義務排到時程上(開工第一天 → 完工 →
// 保固期滿),讓三方各自看到該看的執行情形。四塊版面:
//   1. 履約執行卡(每個可見責任方一張:準時率+五狀態統計,稽核數字)
//   2. 履約期程條(五段:開工前/開工後30日/施工/完工驗收/保固,點擊篩選)
//   3. 時間軸清單(左,主角):搜尋+狀態快篩+責任方/類型下拉,依期程分組
//   4. 義務詳情(右,sticky):出處引述、執行紀錄、關聯、動作列
// 本頁不做審核。 前一版的整套「AI 建議 → 人工審查 → 核定/駁回」、待核定/已生效/
// 已駁回三狀態、六個追溯下拉、就地手動新增表單全數移除(審核流程在其他頁面);
// 這裡只有:標記完成、掛佐證、回報 AI 擷取有誤。
// 權限規則只有一條表(VISIBLE,見 obligationTimeline.js):可見範圍看角色、
// 動作只看歸屬(item.who === viewerParty)。三個角色共用同一版面同一元件,
// 差異只有可見義務集合、執行卡張數(1/2/3)、責任方篩選是否出現。
// 寫入走 updateObligationStatus(DB 成功才更新 UI,B-07——刻意不樂觀更新);
// 「擷取有誤」落到觀察事項(observations)由監造/機關複查,不憑空造新資料域。
// 「清單＋詳情」殼(選取/深連結/鍵盤/抽屜/Modal/搜尋/快篩)與擷取審核頁共用:
// 行為在 lib/useListDetailPane.js、外殼在 components/listDetail.jsx。
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ContractFlow from '../../components/ContractFlow.jsx'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import {
  Card, Surface, Empty, PageHeader, Badge, Button, Select, Textarea, Dot,
  PrerequisiteEmptyState, ErrorBanner, SkeletonList, Skeleton,
} from '../../components/ui.jsx'
import {
  ListDetailLayout, LIST_DETAIL_GRID, ModalShell, SearchField, StatusChip, MetaGrid, SourceQuote,
} from '../../components/listDetail.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appSnackbar } from '../../components/snackbar.jsx'
import { openDocumentVersionFile } from '../../lib/documentFileAccess.js'
import { isValidStorageKey } from '../../lib/packageUpload.js'
import { RUN_POLL_MS } from '../../lib/packageRuns.js'
import { localISODate } from '../../lib/dates.js'
import { fmtDateTime } from '../../lib/format.js'
import {
  requirementVerification, inPackage, runsInPackage, ingestionSummary,
} from '../../lib/requirementReview.js'
import { extractionCoverageWarnings } from '../../lib/extractRequirements.js'
import { useContractEnrichment } from '../../lib/useContractEnrichment.js'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import {
  PARTY_META, VISIBLE, ORG_TO_PARTY, PARTY_BLURB, OB_STATUS, STATUS_KEYS, PHASES,
  buildTimelineItem, matchesFilters, partyStat, phaseStat, phaseWindows,
  pickDefaultId, canActOn, anchorGaps,
} from '../../lib/obligationTimeline.js'
import AnchorDates from '../../components/AnchorDates.jsx'

// 期程段軌道/摘要語意色 → 全站 token(五色語意:紅=逾期、綠=完成、藍=當前、灰=其他)
const TRACK_BG = {
  empty: 'var(--surface-2)', danger: 'var(--danger)', ok: 'var(--green-bar)',
  accent: 'var(--primary)', muted: 'var(--border-2)',
}
const TONE_CLS = {
  danger: 'text-[var(--red-text)]', warn: 'text-[var(--amber-text)]', muted: 'text-[var(--text-2)]',
}
// 倒數字色:已逾期紅、即將到期黃、其他次要灰
const COUNTDOWN_CLS = {
  overdue: 'text-[var(--red-text)]', due: 'text-[var(--amber-text)]',
}
const REPORT_TYPES = ['條文誤判', '日期算錯', '責任方錯誤', '重複', '其他']
const DEFAULT_FILTERS = { q: '', status: 'all', type: '', who: '', phase: 'all' }
const fmtDay = (v) => (v ? String(v).slice(0, 10) : '—')
const fmtTime = (v) => fmtDateTime(v, { empty: '' })

// 責任方 pill(README 2.4):自己的=藍框藍底、別人的=線框——顏色留給狀態,
// 責任方靠文字+icon 分辨(a11y:不可只靠顏色)。capsule 是責任方標籤的例外(規範 §4)。
function WhoPill({ who, self }) {
  return (
    <span className={`inline-flex items-center gap-[5px] h-[18px] px-[7px] rounded-full border text-micro font-medium whitespace-nowrap ${self
      ? 'border-[var(--primary)] bg-[var(--blue-tint)] text-[var(--blue-text)]'
      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)]'}`}>
      <MSym name={PARTY_META[who]?.icon || 'engineering'} size={13} />{who}
    </span>
  )
}

export default function Requirements() {
  const {
    currentProject, project, isPersistedProject, currentUser, obligations,
    updateObligationStatus, submittals, createObservation, can, updateProjectAnchors, reloadObligations,
  } = useStore()
  // 登入身分決定檢視方(README:產品端不渲染身分切換器,demo 換角色重登即可)
  const viewerParty = ORG_TO_PARTY[currentUser?.org_type] || '廠商'
  // 「擷取有誤」落觀察事項,其 insert 政策仍是 can_write(機關唯讀)——鏡像它,
  // 不渲染會被 RLS 擋下的假按鈕(規則的單一來源在 store.jsx 的 can.write)。
  // 義務的標記完成/掛佐證自 migration 20260825120000 起改為「只看歸屬」
  // (機關也能標自己的),不再吃 can_write。
  const canReport = can.write

  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [evidencePick, setEvidencePick] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const [reportDraft, setReportDraft] = useState({ type: REPORT_TYPES[0], note: '' })
  const [reportBusy, setReportBusy] = useState(false)
  const [reportMsg, setReportMsg] = useState('')
  const [anchorOpen, setAnchorOpen] = useState(false)  // 履約期程卡的基準日編輯列
  const [anchorErr, setAnchorErr] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const searchRef = useRef(null)
  const packageId = searchParams.get('package') || ''

  const pid = currentProject?.project_id

  // ── 出處/紀錄 enrich(真專案):義務掛的 requirement + 引述出處 + 文件版本 +
  // ingestion runs(頁底「AI 最近整理」與空狀態分流)。demo 不打 DB,直接可用。
  const requirementIds = useMemo(() => obligations.map((o) => o.requirement_id), [obligations])
  const {
    reqById, sourcesByReq, versionsById, runs, runsById, packages,
    loaded: enrichLoaded, error: enrichError, reload: reloadEnrich,
  } = useContractEnrichment({ pid, enabled: isPersistedProject, requirementIds })
  const coverageWarnings = useMemo(
    () => extractionCoverageWarnings(runsInPackage(runs, packageId, { versionsById })),
    [runs, versionsById, packageId],
  )

  // 從文件頁進來先重讀自動物化結果；分析仍在進行時刷新已完成的部分。
  useEffect(() => { if (isPersistedProject) reloadObligations?.() }, [isPersistedProject, pid, reloadObligations])
  const analyzing = runs.some((r) => ['pending', 'processing'].includes(r.status))
  useEffect(() => {
    if (!analyzing) return
    const timer = setInterval(() => { reloadEnrich(); reloadObligations?.() }, RUN_POLL_MS)
    return () => clearInterval(timer)
  }, [analyzing, reloadEnrich, reloadObligations])

  // ── 檢視模型:義務列 + enrich → 狀態/期程/倒數/出處(純函式,見 obligationTimeline)
  // 基準日吃 store 的 project(demo 落回種子專案;與今日待辦同一份錨點,數字才對得上)
  const anchors = useMemo(() => ({
    award_date: project?.award_date, notice_date: project?.notice_date,
    commencement_date: project?.commencement_date, end_date: project?.end_date,
  }), [project])
  const items = useMemo(() => obligations.map((ob) => buildTimelineItem(ob, {
    requirement: ob.requirement_id ? reqById.get(ob.requirement_id) : null,
    sources: ob.requirement_id ? sourcesByReq.get(ob.requirement_id) : null,
    versionsById,
    anchors,
  })), [obligations, reqById, sourcesByReq, versionsById, anchors])

  // 可見義務=角色可見集合(前端 shim;目標是後端依身分回傳已過濾集合,見 lib 註記)
  // × 契約範圍(packageOf:列自己的歸包,沒有才由 run → 文件版本回推)。依賴就是它
  // 真正讀的三張 Map——改版前這裡靠 runsById 恰好與 enrich 同一次 setState 換
  // identity 才沒壞,現在寫對。
  const pool = useMemo(
    () => items.filter((it) => VISIBLE[viewerParty].includes(it.who)
      && inPackage(it.ob.requirement_id ? reqById.get(it.ob.requirement_id) : null, packageId, { versionsById, runsById })),
    [items, viewerParty, packageId, reqById, versionsById, runsById],
  )
  const filtered = useMemo(() => pool.filter((it) => matchesFilters(it, filters)), [pool, filters])
  const byDue = (a, b) => ((a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity))
    || ((a.ob.sort_order ?? 0) - (b.ob.sort_order ?? 0))
  const grouped = useMemo(
    () => PHASES.map((ph) => ({ ...ph, items: [...filtered.filter((it) => it.phase === ph.key)].sort(byDue) }))
      .filter((g) => g.items.length),
    [filtered],
  )
  const ordered = useMemo(() => grouped.flatMap((g) => g.items), [grouped])

  // 保固期滿:里程碑沒有這個欄位,取保固段義務的最遠到期日,推不出就不顯示
  const warrantyEnd = useMemo(() => {
    const ds = pool.filter((it) => it.phase === 'warranty' && it.due).map((it) => it.due)
    return ds.length ? new Date(Math.max(...ds.map((d) => d.getTime()))) : null
  }, [pool])
  const phaseWin = useMemo(() => phaseWindows(anchors, warrantyEnd), [anchors, warrantyEnd])

  const counts = useMemo(() => {
    const c = { overdue: 0, due: 0, scheduled: 0, done: 0, na: 0 }
    for (const it of pool) c[it.status]++
    return c
  }, [pool])
  const partyCards = useMemo(
    () => VISIBLE[viewerParty].map((name) => ({ name, stat: partyStat(pool.filter((it) => it.who === name)) })),
    [pool, viewerParty],
  )
  const typeOptions = useMemo(() => [...new Set(pool.map((it) => it.type).filter(Boolean))], [pool])
  const multiParty = VISIBLE[viewerParty].length > 1
  const anyFilter = filters.status !== 'all' || filters.phase !== 'all' || filters.type || filters.who || filters.q.trim()

  const milestoneMeta = useMemo(() => {
    const m = phaseWin.milestones
    return [
      m.start ? `開工 ${localISODate(m.start)}` : null,
      m.completion ? `完工 ${localISODate(m.completion)}` : null,
      m.warrantyEnd ? `保固期滿 ${localISODate(m.warrantyEnd)}` : null,
      `可見 ${pool.length} 條`,
    ].filter(Boolean).join(' · ')
  }, [phaseWin, pool.length])

  // 基準日缺口與就地設定:開工類義務推不出到期日的主因就是開工日沒設,而設定
  // 入口原本只在隱藏的期限追蹤頁——把設定放在後果看得到的地方(履約期程卡)。
  // 寫入 DB-first(同 B-04):updateProjectAnchors 成功才更新 store 的 project,
  // anchors/items 隨之重算,使用者當場看到「未觸發」翻成有日期。demo 不出現
  // (種子案基準日齊全,且 updateProjectAnchors 需真專案)。
  const gaps = useMemo(() => anchorGaps(pool, anchors), [pool, anchors])
  const setAnchor = async (key, val) => {
    setAnchorErr('')
    const { error } = await updateProjectAnchors({ [key]: val || null })
    if (error) setAnchorErr(friendlyError(error, '基準日未儲存'))
  }

  // ── 選取/深連結(?obligation=)/切案重置/初次自動選取:共用殼 hook。
  // 預設選第一條已逾期 → 第一條即將到期 → 清單第一條(README 3)。
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'obligation', idPrefix: 'ob-',
    scope: `${pid}/${viewerParty}/${packageId}`,
    ready: pool.length > 0, rows: pool,
    pickDefault: () => pickDefaultId(ordered.length ? ordered : pool),
    onSelect: () => { setMsg(''); setEvidenceOpen(false) },
    onReset: () => { setMsg(''); setEvidenceOpen(false); setFilters(DEFAULT_FILTERS) },
  })
  // 篩選後選中項被篩掉:保留右欄內容不清空(README 3),清單中無高亮列
  const selected = pool.find((it) => it.id === selectedId) || null

  // 「開啟原文」:出處的文件版本+頁碼 → 簽名 URL 開原始檔(PDF 跳頁)
  const openable = useMemo(() => {
    if (!selected?.ob.requirement_id) return null
    for (const s of sourcesByReq.get(selected.ob.requirement_id) || []) {
      const version = s.document_version_id ? versionsById.get(s.document_version_id) : null
      if (version && isValidStorageKey(version.storage_path)) return { source: s, version }
    }
    return null
  }, [selected, sourcesByReq, versionsById])
  const openOriginal = useCallback(() => {
    if (!openable) return
    openDocumentVersionFile(openable.version, { page: openable.source.page_number, onError: setMsg })
  }, [openable])

  // 鍵盤:↑/↓ 移動選取、Enter 開啟原文、/ 聚焦搜尋(共用殼 hook;回報 Modal 開著就停用)
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'ob-', onEnter: openOriginal, modalUp: reportOpen, searchRef })

  // ── 動作:標記完成/取消完成/掛佐證(DB 成功才更新 UI,失敗顯示 inline 錯誤)
  const markDone = async () => {
    setBusy('done')
    const { error } = await updateObligationStatus(selected.id, '已完成')
    setBusy('')
    if (error) { setMsg(friendlyError(error, '未能標記完成')); return }
    setMsg(''); appSnackbar('已標記完成')
  }
  const undoDone = async () => {
    setBusy('undo')
    const { error } = await updateObligationStatus(selected.id, '待辦')
    setBusy('')
    if (error) { setMsg(friendlyError(error, '未能取消完成')); return }
    setMsg('')
  }
  const attachEvidence = async () => {
    if (!evidencePick) return
    setBusy('evidence')
    // 掛佐證不自動標記完成(README 3):status 原樣回寫,只掛 evidence_submittal_id
    const { error } = await updateObligationStatus(selected.id, selected.ob.status, { evidence_submittal_id: evidencePick })
    setBusy('')
    if (error) { setMsg(friendlyError(error, '佐證未掛上')); return }
    setMsg(''); setEvidenceOpen(false); setEvidencePick(''); appSnackbar('已掛上佐證文件')
  }
  // 「擷取有誤」任何可寫角色都能回報:落成觀察事項(監造/機關複查),
  // 不動義務本身——README 的 report-issue 端點落地前的最小誠實路徑
  const submitReport = async () => {
    setReportBusy(true)
    const { error } = await createObservation({
      title: `AI 擷取有誤:${selected.title}`,
      description: [`錯誤類型:${reportDraft.type}`,
        reportDraft.note.trim() ? `說明:${reportDraft.note.trim()}` : null,
        selected.clause ? `出處:${selected.clause}${selected.page ? ` · ${selected.page}` : ''}` : null,
      ].filter(Boolean).join('\n'),
      assigned_to: 'supervisor',
    })
    setReportBusy(false)
    if (error) { setReportMsg(friendlyError(error, '回報未送出')); return }
    setReportOpen(false); setReportMsg(''); setReportDraft({ type: REPORT_TYPES[0], note: '' })
    appSnackbar('已回報擷取有誤,將由專案團隊複查')
  }

  // ── 頁底 meta 與空狀態分流(有 completed run 才講「AI 最近整理」)──────────
  const { docCount, latest: latestRun } = ingestionSummary(runs, versionsById)
  const footerMeta = [
    `顯示 ${filtered.length} / ${pool.length} 條`,
    docCount ? `來源 ${docCount} 份文件` : null,
    latestRun ? `AI 最近整理 ${latestRun.slice(0, 10)}` : null,
  ].filter(Boolean).join(' · ')

  // ── 詳情內容(桌機 aside 與 <lg 抽屜共用同一份 JSX)────────────────────
  const detailBody = selected && (() => {
    const st = OB_STATUS[selected.status]
    const isMine = selected.who === viewerParty
    // 歸屬即可操作(伺服器同一條 RLS 規則);can.override 鏡像 admin_override()
    const actable = canActOn(selected, viewerParty) || can.override
    const meta = [
      ['責任方', selected.who],
      ['階段', PHASES.find((p) => p.key === selected.phase)?.name || '—'],
      ['到期日', selected.dateLabel === '—' ? '依條件觸發' : `${selected.dateLabel}（${selected.countdown}）`],
      ['頻率', selected.kind || '單次'],
      ['允收標準', selected.criteria || '—'],
      ['應留存', selected.evidenceReq || '—'],
      ...(selected.penalty ? [['罰則', selected.penalty]] : []),
    ]
    const req = selected.ob.requirement_id ? reqById.get(selected.ob.requirement_id) : null
    const verification = requirementVerification(req)
    const evidenceSub = selected.ob.evidence_submittal_id
      ? submittals.find((s) => s.id === selected.ob.evidence_submittal_id) : null
    // 執行紀錄:由現有事實組裝(AI 擷取/確認、佐證、完成標記)。義務完成沒有
    // 時間戳欄位——「時間未記錄」如實顯示,不臆造時間(後端補 completed_at 後改讀欄位)
    const logEntries = []
    if (req?.created_at) {
      logEntries.push({
        when: fmtDay(req.created_at),
        what: req.origin === 'manual' ? '人工補登此義務' : 'AI 自契約擷取此義務',
        s: 'scheduled',
      })
    }
    if (req?.reviewed_at) {
      logEntries.push({
        when: fmtDay(req.reviewed_at),
        what: verification.label,
        s: 'done',
      })
    }
    if (evidenceSub) {
      logEntries.push({ when: fmtDay(evidenceSub.submitted_date || evidenceSub.created_at), what: `掛佐證:${evidenceSub.title}`, s: 'scheduled' })
    }
    if (selected.status === 'done') {
      // completed_at 由 DB trigger 蓋(demo 由 slice 鏡像);缺值=migration 前的舊資料
      const at = selected.ob.completed_at
      logEntries.push({
        when: at ? fmtTime(at) : '—',
        what: `${selected.ob.status === '已提送' ? '已標為提送' : '已標記完成'}${at ? '' : '（時間未記錄）'}`,
        s: 'done',
      })
    }
    const activeStatus = ['overdue', 'due', 'scheduled'].includes(selected.status)
    return (<>
      {/* 1. 標題列:狀態色票 + 責任方 pill + 開啟原文 */}
      <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
        <Badge color={st.badge}>{st.label}</Badge>
        <WhoPill who={selected.who} self={isMine} />
        {openable && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={openOriginal} title="在原文件中開啟">
            開啟原文
          </Button>
        )}
      </div>

      <ErrorBanner msg={msg} onClose={() => setMsg('')} className="mx-4 mt-3" />

      <div className={`mx-4 mt-3 rounded-md px-3 py-2 text-xs leading-relaxed ${verification.attention
        ? 'text-[var(--amber-text)] bg-[var(--amber-tint)]' : 'text-[var(--text-2)] bg-[var(--surface-2)]'}`}>
        <p className="font-medium">{verification.label}</p>
        <p>{verification.note}</p>
        {verification.attention && req?.id && (
          <Link to={`/requirements/review?highlight=${req.id}${packageId ? `&package=${encodeURIComponent(packageId)}` : ''}`} className="inline-flex min-h-11 items-center text-[var(--blue-text)] hover:underline">
            查看這項與原文
          </Link>
        )}
      </div>

      {/* 2. 本文:標題/說明/key-value */}
      <div className="p-4">
        <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{selected.title}</div>
        {selected.desc && <p className="mt-2 text-footnote leading-[1.8] text-[var(--text-2)]">{selected.desc}</p>}
        <MetaGrid rows={meta} className="mt-3.5" />
      </div>

      {/* 3. 執行紀錄:讓監造/機關看得到「實際發生了什麼」,不只狀態標籤 */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <MSym name="history" size={15} className="text-[var(--text-3)]" />
          <span className="text-footnote font-medium text-[var(--text)]">執行紀錄</span>
        </div>
        {logEntries.length === 0 ? (
          <p className="text-xs text-[var(--text-3)]">尚無執行紀錄。</p>
        ) : logEntries.map((e, i) => (
          <div key={i} className="grid grid-cols-[14px_minmax(0,1fr)] gap-2.5 items-start">
            <span className="relative flex justify-center self-stretch min-h-[26px]">
              <span className="w-[2px] bg-[var(--border-2)]" aria-hidden />
              <Dot color={OB_STATUS[e.s].badge} className="absolute top-[5px]" />
            </span>
            <span className="pb-[9px] flex flex-col gap-px">
              <span className="num text-caption text-[var(--text-3)] leading-normal">{e.when}</span>
              <span className="text-xs leading-relaxed text-[var(--text)]">{e.what}</span>
            </span>
          </div>
        ))}
      </div>

      {/* 4. AI 擷取依據:出處引述(blockquote/cite 語意)+ 來源核對色票 + 到期日推算 */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <MSym name="description" size={15} className="text-[var(--text-3)]" />
          <span className="text-footnote font-medium text-[var(--text)]">AI 擷取依據</span>
          {selected.verified != null && (
            <Badge color={selected.verified ? 'green' : 'amber'}>{selected.verified ? '來源已核對' : '來源待核對'}</Badge>
          )}
        </div>
        {selected.quote ? (
          <SourceQuote quote={selected.quote}
            cite={[selected.doc, selected.clause ? `契約條款 ${selected.clause}` : null, selected.page].filter(Boolean).join(' · ')} />
        ) : (selected.clause || selected.page) ? (
          <p className="num text-caption text-[var(--text-3)] leading-relaxed">
            出處 {[selected.clause, selected.page].filter(Boolean).join(' · ')}(原文請至專案文件查閱)
          </p>
        ) : (
          <p className="text-xs text-[var(--text-3)]">無引註。</p>
        )}
        {selected.calc && (
          <div className="mt-2 flex items-start gap-[7px] text-caption text-[var(--text-3)] leading-relaxed">
            <MSym name="function" size={15} className="flex-none mt-px" />
            <span className="num">到期日推算:{selected.calc}{selected.dateLabel !== '—' ? ` · 本期 ${selected.dateLabel}` : ''}</span>
          </div>
        )}
      </div>

      {/* 5. 關聯 */}
      <div className="px-4 pb-4">
        <div className="text-footnote font-medium text-[var(--text)] mb-2">關聯</div>
        <div className="flex flex-col gap-1.5">
          {evidenceSub && (
            <Link to="/submittals" className="flex items-center gap-2 px-2.5 py-2 max-md:min-h-11 border border-[var(--border-2)] rounded-lg text-xs text-[var(--text-2)] min-w-0 hover:bg-[var(--bg)]">
              <MSym name="upload_file" size={15} className="text-[var(--text-3)] shrink-0" />
              <span className="flex-1 min-w-0 truncate">佐證 · {evidenceSub.title}</span>
              <MSym name="chevron_right" size={16} className="text-[var(--text-3)] shrink-0" />
            </Link>
          )}
          <Link to="/deadlines" className="flex items-center gap-2 px-2.5 py-2 max-md:min-h-11 border border-[var(--border-2)] rounded-lg text-xs text-[var(--text-2)] min-w-0 hover:bg-[var(--bg)]">
            <MSym name="schedule" size={15} className="text-[var(--text-3)] shrink-0" />
            <span className="flex-1 min-w-0 truncate">期限追蹤 · 罰款試算與逐項提送</span>
            <MSym name="chevron_right" size={16} className="text-[var(--text-3)] shrink-0" />
          </Link>
          {selected.penalty && (
            <div className="flex items-center gap-2 px-2.5 py-2 border border-[var(--border-2)] rounded-lg text-xs text-[var(--text-2)] min-w-0">
              <MSym name="balance" size={15} className="text-[var(--text-3)] shrink-0" />
              <span className="flex-1 min-w-0 truncate">罰則 · {selected.penalty}</span>
            </div>
          )}
        </div>
      </div>

      {/* 6. 動作列:只看歸屬(isMine)與狀態;無權限不渲染假按鈕 */}
      <div className="px-4 py-3 border-t border-[var(--border)] flex items-center gap-2 flex-wrap">
        {actable && activeStatus && (<>
          <Button size="md" busy={busy === 'done'} onClick={markDone}>
            <MSym name="task_alt" size={17} fill /> 標記完成
          </Button>
          <Button variant="outline" size="md" disabled={!!busy}
            onClick={() => { setEvidenceOpen((o) => !o); setEvidencePick('') }}>
            <MSym name="upload_file" size={17} /> 掛佐證
          </Button>
        </>)}
        {actable && selected.status === 'done' && (
          <Button variant="outline" size="md" busy={busy === 'undo'} onClick={undoDone}>
            <MSym name="undo" size={17} /> 取消完成
          </Button>
        )}
        {actable && selected.status === 'na' && (
          <span className="flex-1 min-w-[180px] text-caption text-[var(--text-3)] leading-relaxed">
            {selected.penalty ? '罰則條款,非待辦事項;條件成立時自動轉為待處理。' : '相關基準日尚未設定,推不出到期日,暫非待辦事項。'}
          </span>
        )}
        {!isMine && !actable && (
          <span className="flex-1 min-w-[180px] text-caption text-[var(--text-3)] leading-relaxed">
            由{selected.who}負責執行,本頁為唯讀檢視。
          </span>
        )}
        {canReport && (
          <Button variant="ghost" size="md" className="ml-auto" onClick={() => { setReportOpen(true); setReportMsg('') }}>
            擷取有誤
          </Button>
        )}
      </div>
      {evidenceOpen && actable && (
        <div className="px-4 pb-4 flex items-center gap-2 flex-wrap">
          {submittals.length ? (<>
            <Select value={evidencePick} onChange={(e) => setEvidencePick(e.target.value)}
              aria-label="選擇佐證送審文件" className="flex-1 min-w-[200px] !text-xs">
              <option value="">選擇送審文件作為佐證…</option>
              {submittals.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </Select>
            <Button size="sm" disabled={!evidencePick || busy === 'evidence'} onClick={attachEvidence}>掛上佐證</Button>
            <span className="w-full text-caption text-[var(--text-3)]">掛佐證不會自動標記完成。</span>
          </>) : (
            <span className="text-xs text-[var(--text-3)]">尚無送審文件可掛;至「送審文件」建立後再回來掛佐證。</span>
          )}
        </div>
      )}
    </>)
  })()

  // ── 回報擷取有誤 Modal ───────────────────────────────────────────────────
  const reportModal = selected && (
    <ModalShell open={reportOpen} onClose={() => setReportOpen(false)} title="回報 AI 擷取有誤">
      <p className="text-xs text-[var(--text-3)] mb-3 leading-relaxed">
        「{selected.title}」——送出後由監造/機關複查;契約效力一律以原文為準。
      </p>
      <div className="space-y-2">
        <Select value={reportDraft.type} aria-label="錯誤類型"
          onChange={(e) => setReportDraft((d) => ({ ...d, type: e.target.value }))}>
          {REPORT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Textarea rows={3} value={reportDraft.note} placeholder="說明哪裡擷取錯了(可留白)"
          onChange={(e) => setReportDraft((d) => ({ ...d, note: e.target.value }))} />
        <ErrorBanner msg={reportMsg} />
        <div className="flex gap-2 pt-1">
          <Button size="sm" busy={reportBusy} onClick={submitReport}>送出回報</Button>
          <Button variant="ghost" size="sm" onClick={() => setReportOpen(false)}>取消</Button>
        </div>
      </div>
    </ModalShell>
  )

  // ── 版面區塊 ─────────────────────────────────────────────────────────────
  // 頁首入口:AI 建議的核定/駁回與手動補登在獨立的擷取審核頁(本頁不做審核)。
  // Link 包 Button:內層退出 tab 序避免 Tab 停兩次(同 PrerequisiteEmptyState 作法);
  // Link 的圓角跟 md 按鈕走 rounded-lg,焦點框才不會比按鈕圓。
  const header = (
    <div className="space-y-3">
    <PageHeader title="契約重點" tagline="履約時程" subtitle={PARTY_BLURB[viewerParty]}
      action={(
        <Link to={packageId ? `/requirements/review?package=${encodeURIComponent(packageId)}` : '/requirements/review'} className="inline-flex rounded-lg">
          <Button variant="secondary" size="md" tabIndex={-1}>
            <MSym name="rate_review" size={16} /> 擷取審核
          </Button>
        </Link>
      )} />
    <ContractFlow active="highlights" role={currentUser?.org_type} packageId={packageId} />
    {isPersistedProject && (packages.length > 0 || packageId) && (
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2 min-w-0">契約範圍
          <Select aria-label="契約範圍" value={packageId} className="max-w-[240px]"
            onChange={(e) => setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('obligation');
              if (e.target.value) n.set('package', e.target.value); else n.delete('package'); return n })}>
            <option value="">全部可見契約</option>
            {packageId && !packages.some((p) => p.id === packageId) && <option value={packageId}>指定契約（未取得）</option>}
            {packages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </Select>
        </label>
        <span className="text-[var(--text-3)]">目前範圍共 {pool.length} 項履約事項</span>
      </div>
    )}
    {analyzing && <p role="status" className="text-xs text-[var(--blue-text)]">AI 仍在整理，已完成的結果會自動更新。請保留啟動上傳的瀏覽器分頁。</p>}
    {coverageWarnings.length > 0 && (
      <div role="status" className="rounded-md px-4 py-3 text-xs leading-relaxed text-[var(--amber-text)] bg-[var(--amber-tint)]">
        <p className="font-medium">目前整理紀錄中有 {coverageWarnings.length} 份文件需要檢查完整性</p>
        <ul className="list-disc pl-4 mt-1 space-y-1">
          {coverageWarnings.map((warning, i) => <li key={i}>{warning}</li>)}
        </ul>
        <Link to="/contract" className="inline-flex min-h-11 items-center text-[var(--blue-text)] hover:underline">查看專案文件</Link>
      </div>
    )}
    </div>
  )

  // 履約執行卡:每個可見責任方一張(README 2.2)。統計母體=該方全部可見義務
  const execCards = (
    <div className="flex items-stretch gap-3 flex-wrap">
      {partyCards.map(({ name, stat }) => {
        const rateCls = stat.rate == null ? 'text-[var(--text-2)]'
          : stat.rate === 100 ? 'text-[var(--green-text)]'
            : stat.rate >= 80 ? 'text-[var(--text)]' : 'text-[var(--red-text)]'
        const seg = (v, c) => (v ? (
          <span key={c} style={{ width: `${(v / stat.total) * 100}%`, background: c }} />
        ) : null)
        const rows = [
          ['逾期', stat.n.overdue, 'overdue'], ['即將到期', stat.n.due, 'due'],
          ['排程中', stat.n.scheduled, 'scheduled'], ['已完成', stat.n.done, 'done'],
          ...(stat.n.na ? [[OB_STATUS.na.label, stat.n.na, 'na']] : []),
        ]
        return (
          <Surface key={name} className="stat-card flex-1 min-w-[260px] max-xl:min-w-[calc(50%-6px)] max-md:min-w-full px-4 py-3.5 border-l-[3px]"
            style={{ borderLeftColor: PARTY_META[name].mark }}>
            <div className="flex items-center gap-2 mb-[11px]">
              <MSym name={PARTY_META[name].icon} size={18} className="text-[var(--text-2)]" />
              <span className="text-body font-medium text-[var(--text)]">{name}</span>
              {name === viewerParty && (
                <span className="inline-flex items-center h-[18px] px-[7px] rounded-full bg-[var(--blue-tint)] text-[var(--blue-text)] text-micro font-medium">自己</span>
              )}
              <span className="num ml-auto text-caption text-[var(--text-2)]">{stat.total} 條義務</span>
            </div>
            <div className="flex items-baseline gap-[9px] mb-[11px]">
              <span className={`num stat-value font-normal leading-none ${rateCls}`}>{stat.rate == null ? '—' : `${stat.rate}%`}</span>
              <span className="text-caption text-[var(--text-2)] leading-snug">
                {stat.rate == null ? '尚無到期項目' : `到期 ${stat.settled} 項準時完成 ${stat.onTime} 項`}
              </span>
            </div>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-[var(--border-2)] mb-2.5" aria-hidden>
              {seg(stat.n.done, 'var(--success)')}
              {seg(stat.n.overdue, 'var(--danger)')}
              {seg(stat.n.due, 'var(--accent)')}
            </div>
            <div className="flex items-center gap-3.5 flex-wrap">
              {rows.map(([label, v, k]) => (
                <span key={k} className="inline-flex items-center gap-1.5 text-caption text-[var(--text-2)]">
                  <Dot color={OB_STATUS[k].badge} />{label}
                  <span className="num font-medium text-[var(--text)]">{v}</span>
                </span>
              ))}
            </div>
          </Surface>
        )
      })}
    </div>
  )

  // 履約期程條(README 2.3):五段等寬、點擊切換篩選(再點取消);統計母體=可見集合
  const phaseBar = (
    <Card bodyClass="px-[18px] pt-[15px] pb-[17px]">
      <div className="flex items-baseline justify-between gap-4 mb-[13px] flex-wrap">
        <span className="text-body font-medium text-[var(--text)]">履約期程</span>
        <span className="inline-flex items-baseline gap-3">
          <span className="num text-caption text-[var(--text-2)]">{milestoneMeta}</span>
          {isPersistedProject && (
            <button type="button" onClick={() => setAnchorOpen((v) => !v)} aria-expanded={anchorOpen}
              className="inline-flex items-center gap-1 text-caption text-[var(--blue-text)] hover:underline pressable">
              <MSym name="edit_calendar" size={14} />設定基準日
            </button>
          )}
        </span>
      </div>
      {/* 缺口提示:幾條義務在等哪個基準日——數字來自 anchorGaps,設完就消失 */}
      {isPersistedProject && !anchorOpen && gaps.total > 0 && (
        <button type="button" onClick={() => setAnchorOpen(true)}
          className="w-full mb-3 flex items-center gap-2.5 rounded-[10px] bg-[var(--amber-tint)] px-3.5 py-2.5 text-left pressable">
          <MSym name="event_busy" size={16} className="text-[var(--amber-text)] shrink-0" />
          <span className="min-w-0 flex-1 text-footnote leading-snug text-[var(--amber-text)]">
            {gaps.gaps.map((g) => `${g.count} 條義務等待${g.label}`).join('、')}——設定後自動排入時程並開始倒數
          </span>
          <span className="text-footnote font-medium text-[var(--amber-text)] shrink-0">設定</span>
        </button>
      )}
      {isPersistedProject && anchorOpen && (
        <div className="mb-3 rounded-[10px] border border-[var(--border-card)] bg-[var(--bg)] px-3.5 pt-3 pb-3.5">
          <div className="flex flex-wrap gap-4">
            <AnchorDates anchors={anchors} onSet={setAnchor} disabled={!can.edit} />
          </div>
          <ErrorBanner msg={anchorErr} className="mt-2" />
          <p className="text-xs text-[var(--text-3)] mt-2">
            到期日、倒數與逾期都依基準日即時計算;「開工日」請填實際開工日(非預定日),填了系統就會照它發提醒。
          </p>
        </div>
      )}
      <div className="flex items-stretch gap-0.5 max-xl:overflow-x-auto max-xl:pb-1">
        {PHASES.map((ph) => {
          const s = phaseStat(pool, ph.key, phaseWin.nowPhase)
          const active = filters.phase === ph.key
          return (
            <button key={ph.key} type="button" aria-pressed={active}
              onClick={() => setFilters((f) => ({ ...f, phase: f.phase === ph.key ? 'all' : ph.key }))}
              className={`flex-1 min-w-0 max-xl:min-w-[160px] flex flex-col gap-[7px] px-[11px] pt-[9px] pb-2.5 border rounded-[10px] text-left pressable ${active
                ? 'border-[var(--primary)] bg-[var(--blue-tint)]'
                : 'border-[var(--border-card)] bg-[var(--surface)] hover:bg-[var(--bg)]'}`}>
              <span className="flex items-center gap-[7px] min-h-[17px]">
                <span className="text-footnote font-medium text-[var(--text)] whitespace-nowrap">{ph.name}</span>
                {ph.key === phaseWin.nowPhase && (
                  <span className="num inline-flex items-center h-[17px] px-1.5 rounded-full bg-[var(--primary)] text-[var(--primary-fg)] text-micro font-medium">今天</span>
                )}
              </span>
              <span className="num text-micro text-[var(--text-2)] leading-snug">{phaseWin.ranges[ph.key]}</span>
              <span className="h-1.5 rounded-full" style={{ background: TRACK_BG[s.track] }} aria-hidden />
              <span className={`num text-micro leading-snug ${TONE_CLS[s.tone]}`}>{s.note}</span>
            </button>
          )
        })}
      </div>
    </Card>
  )

  // 檢索區:搜尋 + 五狀態快篩 + 責任方(可見多方才有)/類型下拉,三種條件 AND
  const filterBar = (
    <div className="px-[18px] py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋條文、關鍵字、條款編號或頁碼…" aria-label="搜尋契約義務" />
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_KEYS.map((k) => (
          <StatusChip key={k} active={filters.status === k} count={counts[k]}
            onClick={() => setFilters((f) => ({ ...f, status: f.status === k ? 'all' : k }))}>
            <Dot color={OB_STATUS[k].badge} />{OB_STATUS[k].label}
          </StatusChip>
        ))}
        <span className="w-px h-5 bg-[var(--border-2)] mx-0.5 max-md:hidden" aria-hidden="true" />
        {multiParty && (
          <Select value={filters.who} aria-label="責任方"
            onChange={(e) => setFilters((f) => ({ ...f, who: e.target.value }))}
            className="!w-auto max-md:!w-full !h-[30px] !py-0 !text-xs !rounded-lg">
            <option value="">全部責任方</option>
            {VISIBLE[viewerParty].map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        )}
        <Select value={filters.type} aria-label="類型"
          onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
          className="!w-auto max-md:!w-full !h-[30px] !py-0 !text-xs !rounded-lg">
          <option value="">全部類型</option>
          {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>清除篩選</Button>
        )}
      </div>
    </div>
  )

  // 時間軸清單:依期程分組;每列=日期/軸線/內容/狀態(<768 直排、軸線隱藏)
  const listRows = (
    <div role="list" aria-label="履約義務時間軸">
      {ordered.length === 0 ? (
        <div className="px-[18px] py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的義務。<br />試試條款編號(例 5.3)、頁碼,或關鍵字(例 保固、罰則、送審)。
        </div>
      ) : grouped.map((g) => {
        const s = phaseStat(pool, g.key, phaseWin.nowPhase)
        return (
          <div key={g.key}>
            <div className="flex items-center gap-3 px-[18px] pt-[13px] pb-[11px] bg-[var(--bg)] border-b border-[var(--border-2)]">
              <span className="text-footnote font-medium text-[var(--text)] whitespace-nowrap">{g.name}</span>
              <span className="num text-caption text-[var(--text-2)] whitespace-nowrap">{phaseWin.ranges[g.key]}</span>
              <span className="flex-1 h-px bg-[var(--border-2)]" aria-hidden />
              <span className={`num text-caption whitespace-nowrap ${TONE_CLS[s.tone]}`}>{s.note}</span>
            </div>
            {g.items.map((it) => {
              const active = it.id === selectedId
              return (
                <button key={it.id} type="button" role="listitem" id={`ob-${it.id}`}
                  aria-current={active || undefined}
                  onClick={() => select(it.id, { openPane: true })}
                  className={`w-full text-left grid grid-cols-[104px_26px_minmax(0,1fr)_96px] max-md:grid-cols-1 gap-3 max-md:gap-1 items-stretch border-b border-[var(--border-2)] cursor-pointer max-md:px-[18px] max-md:py-3 ${active
                    ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--bg)]'}`}>
                  <span className="py-3 pl-[18px] max-md:p-0 max-md:order-2 flex flex-col max-md:flex-row gap-[3px] max-md:gap-2 max-md:items-center">
                    <span className="num text-xs font-medium text-[var(--text)]">{it.dateLabel}</span>
                    <span className={`num text-micro leading-normal ${COUNTDOWN_CLS[it.status] || 'text-[var(--text-2)]'}`}>{it.countdown}</span>
                  </span>
                  <span className="relative flex justify-center max-md:hidden" aria-hidden>
                    <i className="w-[2px] bg-[var(--border-2)]" />
                    <b className="absolute top-3.5 w-[11px] h-[11px] rounded-full bg-[var(--surface)] border-[2.5px] border-solid box-border"
                      style={{ borderColor: OB_STATUS[it.status].dot }} />
                  </span>
                  <span className="py-3 max-md:p-0 max-md:order-1 min-w-0 flex flex-col gap-1">
                    <span className="flex items-center gap-[7px] flex-wrap">
                      <WhoPill who={it.who} self={it.who === viewerParty} />
                      {it.kind && (
                        <span className="inline-flex items-center h-[18px] px-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] text-micro font-medium whitespace-nowrap">{it.kind}</span>
                      )}
                    </span>
                    <span className="text-body font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{it.title}</span>
                    <span className="num text-caption leading-relaxed text-[var(--text-2)]">
                      {[it.clause ? `契約條款 ${it.clause}` : null, it.page || null, it.type].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="py-3 pr-[18px] max-md:p-0 max-md:order-3 flex justify-end max-md:justify-start items-start">
                    <Badge color={OB_STATUS[it.status].badge}>{OB_STATUS[it.status].label}</Badge>
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )

  // ── 版面分支(每個分支都含 PageHeader:早退不得吃掉工作面分頁列)──────────
  const skeleton = (
    <div className="space-y-6">
      {header}
      <div className="flex gap-3">
        <Surface className="flex-1 p-4"><SkeletonList rows={2} label="正在載入履約時程…" /></Surface>
        <Surface className="flex-1 p-4 max-md:hidden"><SkeletonList rows={2} label="" /></Surface>
      </div>
      <Card><Skeleton className="h-16" /></Card>
      <div className={LIST_DETAIL_GRID}>
        <Card><SkeletonList rows={8} label="" /></Card>
        <Card className="hidden lg:block"><SkeletonList rows={4} label="" /></Card>
      </div>
    </div>
  )
  if (isPersistedProject && !enrichLoaded && !obligations.length) return skeleton

  // 真專案 0 筆義務:分「還沒擷取」「AI 跑完但沒有義務」「最近一次失敗」——
  // 跑完的 0 筆是有效結果,不能把人繞回上傳原點
  if (isPersistedProject && enrichLoaded && !obligations.length) {
    const ingestionDone = runs.some((r) => r.status === 'completed')
    const anyRunning = runs.some((r) => ['pending', 'processing'].includes(r.status))
    const latestFailed = runs.find((r) => r.status === 'failed')
    return (
      <div className="space-y-6">
        {header}
        <ErrorBanner msg={enrichError} onRetry={reloadEnrich} />
        <Card title="履約時程">
          {anyRunning ? (
            <Empty>AI 正在整理契約，完成的內容會自動出現在這裡。</Empty>
          ) : ingestionDone ? (
            <Empty>目前沒有可見的履約義務。AI 整理內容會自動歸檔；可到專案文件查看完整性與處理狀態，無需逐條確認。</Empty>
          ) : latestFailed && !anyRunning ? (
            <Empty icon="error">
              最近一次 AI 整理失敗{latestFailed.error_message ? `:${friendlyError(latestFailed.error_message, '請重試')}` : ''}。
              到「<Link to="/contract" className="text-[var(--blue-text)] hover:underline">專案文件</Link>」的文件清單可重試分析。
            </Empty>
          ) : (
            <PrerequisiteEmptyState
              need="這個專案還沒有擷取結果。"
              unlocks="AI 把契約義務逐條排上時程,三方各自追蹤執行情形"
              to="/contract" cta="前往專案文件上傳契約" />
          )}
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}

      <ErrorBanner msg={enrichError} onRetry={reloadEnrich} />

      {execCards}
      {phaseBar}

      <ListDetailLayout
        detail={detailBody}
        detailLabel="義務詳情"
        detailEmpty={<Empty>點左側清單查看義務詳情。</Empty>}
        drawerOpen={detailOpen && !!selected}
        onDrawerClose={closeDetail}>
        {/* ── 左欄:時間軸清單(右欄與抽屜由殼統一,見 components/listDetail.jsx) ── */}
        <Card bodyClass="p-0">
          {filterBar}
          {listRows}
          <div className="px-[18px] py-3 flex items-center justify-between gap-4 flex-wrap">
            <span className="num text-caption text-[var(--text-3)]">{footerMeta}</span>
            {isPersistedProject && (
              <Link to="/contract" className="text-caption text-[var(--blue-text)] hover:underline max-md:min-h-11 inline-flex items-center">查看文件與整理狀態</Link>
            )}
          </div>
        </Card>
      </ListDetailLayout>

      {reportModal}
    </div>
  )
}
