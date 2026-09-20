import { useMemo, useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate, Navigate, Link } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import PrintToolbar from '../../components/PrintToolbar.jsx'
import { Button, ErrorBanner } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, workItemRefIndex } from '../../lib/boqCalc.js'
import { photoEvidenceLine } from '../../lib/evidence.js'
import { fmtAmount as fmt } from '../../lib/format.js'
import { taipeiDateTime } from '../../lib/dates.js'
import { friendlyError } from '../../lib/errorMessage.js'
import { signedVersionIndex, signedVersionText, signedVersionLink } from '../../lib/fieldDocs.js'
import { periodWindow, inWindow, formVersionRefs, packageItemEvidence, pinnedDailyLogRefs, packageDailyLogs, versionKey, evidencePhotoIds } from '../../lib/valuationPackage.js'
import { unsignedDays } from '../../lib/reportSources.js'

const fmtQ = (n) => (n == null || isNaN(n) ? '' : Number(n).toLocaleString('en-US'))
const BASIS_LABEL = { inspection: '查驗表單', supervisor_certificate: '監造確認單', pro_rata_rule: '比例規則' }
const EMPTY_EV = { loading: true, error: null, demo: false, state: null, confirmations: [], pinAt: null, pinUnknown: false,
  formIdx: new Map(), selfCheckIdx: new Map(), dailyIdx: new Map(), versions: new Map(), signers: new Map(), photos: [], members: [] }

// 估驗請款佐證包(可列印 / 另存 PDF)——本期估驗明細 + AI 本期施工說明 + 本期確認來源與簽署文件版本 + 佐證照片 + 施工日誌附件。
// P6a:本期證據一律取 P4b 的確認量來源(get_valuation_state 的 sources → inspection_confirmations)與它們指向的簽署文件版本
// (查驗表單版本、其附件照片與檢附的自主檢查;施工日誌取本期範圍內送審時點以前已簽署的版本),不再以「同工項所有照片／日誌」
// 當本期證據。已送審的期別來源由 DB 凍結、日誌以送審時點釘住,所以已提送的包保留當時使用的版本。挑選與組裝在
// lib/valuationPackage.js(純函式),數量、金額、缺件全是 DB 的值。不套 WebLayout,整頁即文件。
// 工具列(chrome,吃主題 token)與紙面(.paper,固定白底黑字)分開處理,理由見 PrintToolbar 與 index.css:
// 紙面警語走 paper-warn(在 .paper 內釘回亮色的 --amber-text,深色模式不會變成淺字壓白紙),
// 對比度數字統一寫在 index.css 的 .paper 區塊,本檔不再出現色碼或 Tailwind 調色盤 class。
export default function ValuationPackage() {
  const { project, workItems, valuations, currentUser, siteLogs, inspections, checklistRecords, dbMode, fieldDocuments,
    adjustedItems: adjItems, revisedTotal,
    fetchValuationState, fetchConfirmations, fetchValuationSubmittedAt, listSignedVersions, getFieldDocumentVersions, listPhotosByIds, listMembers,
    draftValuationSummary, aiEnabled } = useStore()
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const paperRef = useRef(null)

  const periodId = sp.get('p')
  const selected = valuations.find((v) => v.id === periodId) || valuations[valuations.length - 1]
  const prev = selected ? valuations.find((v) => v.period_no === selected.period_no - 1) : null

  // 變更設計調整由 store 統一提供(財務單一真相層,B-02)
  const { childrenMap, roots } = useMemo(
    () => (workItems ? buildBillableTree(adjItems) : { childrenMap: new Map(), roots: [] }),
    [workItems, adjItems],
  )
  const cumThis = useMemo(() => buildCumMap(roots, childrenMap, selected), [roots, childrenMap, selected])
  const cumPrev = useMemo(() => buildCumMap(roots, childrenMap, prev), [roots, childrenMap, prev])
  // buildCumMap 回的是「金額」;本期「數量」必須取估驗 items 的累計數量相減,不可拿金額當數量(P0-01)。
  const periodQty = (key) => (Number(selected?.items?.[key]) || 0) - (Number(prev?.items?.[key]) || 0)
  const periodAmtOf = (key) => (cumThis.get(key) || 0) - (cumPrev.get(key) || 0) // 本期金額 = buildCumMap 金額差

  // 本期有完成的末端工項(本期量 > 0)
  // 刻意不換成 boqCalc.billableLeaves:那支的父子對照建在「全部 items」上,
  // 這裡吃的是 buildBillableTree 的 childrenMap(只含可計價非合計列)。
  // 子項全是合計列的分項在兩把尺下結果不同,要併必須先定案哪一個是規則。
  const leaves = useMemo(() => {
    if (!workItems) return []
    return adjItems
      .filter((it) => it.is_billable && !it.is_rollup && !(childrenMap.get(it.item_key)?.length)
        && ((cumThis.get(it.item_key) || 0) - (cumPrev.get(it.item_key) || 0)) > 0)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  }, [workItems, adjItems, childrenMap, cumThis, cumPrev])

  const totalCum = roots.reduce((s, r) => s + (cumThis.get(r.item_key) || 0), 0)
  const totalPrev = roots.reduce((s, r) => s + (cumPrev.get(r.item_key) || 0), 0)
  const periodAmt = totalCum - totalPrev
  const billableTotal = revisedTotal
  const completion = billableTotal ? (totalCum / billableTotal) * 100 : 0
  const retPct = selected?.retention_pct ?? 5

  // 工項參照:真專案是 work_items uuid,示範模式的範例標單沒有 id、示範確認量以 item_key 參照(lib/boqCalc 單一來源)
  const wiRefs = useMemo(() => workItemRefIndex(workItems?.items || []), [workItems])
  const keyOf = useCallback((ref) => wiRefs.resolve(ref)?.item_key ?? null, [wiRefs])
  const span = useMemo(() => periodWindow(selected, prev), [selected, prev])
  const openDocs = fieldDocuments?.documents
  const openDocIds = useMemo(() => new Set((openDocs || []).map((d) => d.id)), [openDocs])

  // ── 本期證據(DB 唯讀):期別狀態＋確認紀錄＋送審時點＋三類簽署列 → 查驗表單版本與釘住的日誌版本 → 附件照片 ──
  // 任何一步失敗就整包標「證據讀取失敗」,不拿半份資料印成佐證包。示範模式讀的是種子的示範資料(O2),整包標示範。
  const [ev, setEv] = useState({ ...EMPTY_EV, key: null })
  const evKey = selected ? `${selected.id}|${selected.status}|${span.from}|${span.to}|${span.gap}` : null
  useEffect(() => {
    if (!evKey) return
    let alive = true
    const done = (patch) => { if (alive) setEv({ ...EMPTY_EV, key: evKey, loading: false, demo: !dbMode, ...patch }) }
    ;(async () => {
      // 示範模式一樣跑這一輪:store 的每一支在 demoMode 都回種子的示範資料(示範已簽署版本、示範監造確認量),
      // 佐證包因此演得出內容;demo 旗標只用來在頁面與紙本標示「示範資料」,判定與組裝規則完全同一套。
      const draftPeriod = selected.status === '草稿'
      const [st, cf, sub, dl, sc, fm, mem] = await Promise.all([
        fetchValuationState(selected.id), fetchConfirmations(),
        draftPeriod ? Promise.resolve({ at: null, error: null }) : fetchValuationSubmittedAt(selected.id),
        listSignedVersions('daily_log'), listSignedVersions('self_check'), listSignedVersions('inspection_form'), listMembers(),
      ])
      const err = st.error || cf.error || sub.error || dl.error || sc.error || fm.error
      if (err) { done({ error: err }); return }
      // 草稿期=目前已簽署版本;已送審=送審時點(含)以前的簽署。已送審卻查不到送審事件(稽核上線前的歷史期)如實揭露
      const pinAt = draftPeriod ? null : sub.at
      const dailyIdx = signedVersionIndex(dl.rows, { pinAt })
      const refs = [...formVersionRefs(st.state, cf.rows), ...pinnedDailyLogRefs(dailyIdx, span)]
      const { versions, error: vErr } = await getFieldDocumentVersions(refs)
      if (vErr) { done({ error: vErr }); return }
      const photoIds = [...new Set(formVersionRefs(st.state, cf.rows).flatMap((r) => evidencePhotoIds(versions.get(versionKey(r.document_id, r.version_no)))))]
      const photos = photoIds.length ? await listPhotosByIds(photoIds) : []
      done({
        state: st.state, confirmations: cf.rows, pinAt, pinUnknown: !draftPeriod && !sub.at,
        formIdx: signedVersionIndex(fm.rows), selfCheckIdx: signedVersionIndex(sc.rows), dailyIdx, versions,
        signers: new Map(fm.rows.map((r) => [versionKey(r.document_id, r.version_no), r.signer_name_snapshot])),
        photos, members: mem?.rows || [],
      })
    })()
    return () => { alive = false }
  }, [evKey, dbMode]) // eslint-disable-line react-hooks/exhaustive-deps
  const evReady = ev.key === evKey && !ev.loading
  const loaded = evReady && !ev.error

  const evidence = useMemo(() => packageItemEvidence({
    leaves, state: ev.state, keyOf, confirmations: ev.confirmations, formVersions: ev.versions,
    formIndex: ev.formIdx, inspections, checklistRecords, selfCheckIndex: ev.selfCheckIdx,
  }), [leaves, ev, keyOf, inspections, checklistRecords])
  const evByKey = useMemo(() => new Map(evidence.map((e) => [e.item.item_key, e])), [evidence])
  const photoById = useMemo(() => new Map((ev.photos || []).map((p) => [p.id, p])), [ev.photos])
  const photoCount = ev.photos?.length || 0
  // 施工日誌附件:本期範圍內、釘住時點以前已簽署的版本;範圍內未簽署(或送審時尚未簽署)的日期與施工月報同一條規則列出
  const logAttachment = useMemo(() => {
    if (!loaded) return { rows: [], unsigned: [], missing: 0 }
    const refs = pinnedDailyLogRefs(ev.dailyIdx, span)
    const out = packageDailyLogs({ refs, versions: ev.versions, leaves })
    const unsigned = unsignedDays({
      unsignedRows: (siteLogs || []).filter((l) => !ev.dailyIdx.has(l.id)), signedDates: new Set(refs.map((r) => r.doc_date)),
      openDocs, docType: 'daily_log', inRange: (d) => inWindow(d, span),
    })
    return { ...out, unsigned }
  }, [ev, loaded, span, leaves, siteLogs, openDocs])
  const memberName = useMemo(() => {
    const m = new Map((ev.members || []).map((r) => [r.user_id, r.full_name || r.company || r.user_id]))
    return (uid) => (uid ? (m.get(uid) || `成員 ${String(uid).slice(0, 8)}`) : '—')
  }, [ev.members])

  // AI 本期施工說明:依本期工項、本包照片(簽署查驗表單附件)與本包施工日誌(已簽署版本)草擬
  const [summary, setSummary] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiErr, setAiErr] = useState('')
  const genSummary = async () => {
    if (!selected) return
    setAiBusy(true)
    setAiErr('')
    const payload = {
      period_no: selected.period_no, period_amount: periodAmt, completion_pct: Number(completion.toFixed(1)),
      items: leaves.slice(0, 30).map((it) => ({
        name: it.description, unit: it.unit,
        period_qty: periodQty(it.item_key),           // 數量(非金額)
        period_amount: periodAmtOf(it.item_key),       // 金額另附,供 AI 引用不必自乘
      })),
      photo_captions: (ev.photos || []).map((p) => p.caption).filter(Boolean).slice(0, 12),
      photo_count: photoCount, // 草稿不得宣稱沒有的照片(W04)
      log_summaries: logAttachment.rows.map((r) => r.summary).filter(Boolean).slice(0, 12),
    }
    const { error, result } = await draftValuationSummary(payload)
    setAiBusy(false)
    // 失敗要說出來:原本靜默丟掉錯誤,使用者只看到說明欄一直空白、按鈕按了沒反應。
    // 與施工月報同一套呈現(ErrorBanner＋friendlyError),重試入口就是工具列那顆「重新產生施工說明」。
    if (error) { setAiErr(friendlyError(error, 'AI 施工說明產生失敗')); return }
    if (!result?.summary) { setAiErr('AI 沒有回傳施工說明內容，請重新產生或直接編輯下方說明欄。'); return }
    setSummary(result.summary)
  }

  // 證據載入後自動產生一次 AI 說明(尚未產生時)。
  // 批 B UX:功能關閉時不自動產生(避免載入頁面就吃 403),說明欄保留人工填寫。
  useEffect(() => {
    if (loaded && selected && !summary && !aiBusy && aiEnabled('valuation.summary')) genSummary()
  }, [loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const [attachLogs, setAttachLogs] = useState(true) // 列印前開關,預設夾附

  if (!currentUser) return <Navigate to="/login" replace />
  if (!workItems || !selected) {
    return (
      <div className="p-10 text-center text-[var(--text-2)]">
        無估驗資料。<button onClick={() => navigate('/valuation')} className="text-[var(--blue-text)] underline inline-flex items-center max-md:min-h-11 px-1">返回估驗計價</button>
      </div>
    )
  }

  const Info = ({ label, children }) => (
    <div className="flex"><span className="paper-mute w-20 shrink-0">{label}</span><span className="font-medium">{children}</span></div>
  )
  // 版本標示:可直達列印(該版本即文件目前的簽署版本、文件仍在活文件清單)才給連結;列印時只剩文字
  const VersionRef = ({ refObj }) => {
    if (!refObj) return null
    const link = signedVersionLink(refObj, openDocIds)
    const text = signedVersionText(refObj)
    return link ? <Link to={link} className="underline decoration-dotted">{text}</Link> : <span>{text}</span>
  }
  const basisCell = (e) => {
    if (e.status === 'unchecked') return <span className="paper-mute">未經後端核對</span>
    if (e.status === 'blocked') return <span className="paper-warn">{[...new Set(e.issues.map((i) => i.label))].join('、')}</span>
    const confirmed = e.sources.filter((s) => s.kind === 'confirmation').reduce((sum, s) => sum + s.qty, 0)
    if (e.status === 'confirmed') return <span>監造確認 {fmtQ(confirmed)}</span>
    return <span className="paper-warn">無確認來源</span>
  }
  const pinNote = selected.status === '草稿'
    ? '本期仍為草稿：施工日誌列目前已簽署的版本，送審後即以送審時點為準。'
    : ev.pinUnknown
      ? '本期已送審，但查無送審稽核紀錄（稽核上線前的歷史期）：施工日誌列目前已簽署的版本，無法確認為送審當時版本。'
      : `本期已送審：施工日誌取送審時點（${taipeiDateTime(ev.pinAt)}）以前已簽署的版本，之後的更正不改變本包。`
  const spanText = span.gap === 'period_end' ? '本期未設計價截止日，無法界定本期施工日誌'
    : span.gap === 'prev_period_end' ? `前期（第 ${prev?.period_no} 期）未設計價截止日，本期施工日誌起日無法界定`
      : `${span.from ? `${span.from}${span.fromInclusive ? '（含）' : '（不含）'}` : '開工'} 至 ${span.to}（含）`

  return (
    <div ref={paperRef} className="min-h-screen paper-desk">
      <PrintToolbar sticky backTo="/valuation" backLabel="返回估驗計價"
        pdf={{ paperRef, title: '估驗請款佐證包', fileName: `估驗請款佐證包_第${selected.period_no}期` }}>
        {/* 批 B UX:估驗施工說明草稿功能關閉時藏按鈕、留簡短說明(說明欄仍可人工填)。
            AI 鈕是工具列 chrome,跟其他鈕一樣吃 ui.jsx 的 secondary 皮;busy 走 primitive 的旋轉+禁用。 */}
        {aiEnabled('valuation.summary') ? (
          <Button variant="secondary" onClick={genSummary} busy={aiBusy} disabled={!loaded}>
            {!aiBusy && <MSym name="auto_awesome" size={15} />}{aiBusy ? 'AI 產生中…' : '重新產生施工說明'}
          </Button>
        ) : (
          <span className="text-xs text-[var(--text-2)]">AI 施工說明未啟用，請直接編輯下方說明欄</span>
        )}
      </PrintToolbar>

      {/* 文件本體 A4 */}
      <div className="max-w-[820px] mx-auto paper my-6 print:my-0 p-10 print:p-0 shadow-sm print:shadow-none text-body">
        <div className="text-center mb-5">
          <h1 className="text-title2 font-bold tracking-wide">估 驗 請 款 佐 證 包</h1>
          <div className="paper-mute mt-1">第 {selected.period_no} 期</div>
          {/* 本文件的定性必須跟著紙本走:原本這句藏在頁尾 11px 且 print:hidden,
              列印出去就完全不見,機關很可能拿佐證包當計價依據。提到頁首常駐、列印同印。 */}
          <div className="mt-2 inline-block text-footnote paper-warn border paper-warn-rule rounded px-3 py-1.5">
            本包為佐證彙整，正式估驗金額以「估驗計價單」為準。
          </div>
          {/* 示範模式:本包的已簽署版本與監造確認量都是示範資料(紙本同印,不得被誤認為真實簽署) */}
          {ev.demo && (
            <div className="mt-2 block text-footnote paper-warn border paper-warn-rule rounded px-3 py-1.5">
              示範資料：本包的已簽署文件版本、簽署者、內容雜湊與監造確認量皆為示範值，非真實簽署紀錄。
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-5 border-y paper-rule py-3">
          <Info label="工程名稱">{project.project_name}</Info>
          <Info label="契約編號">{project.project_code || '—'}</Info>
          <Info label="機　　關">{project.owner_name || '—'}</Info>
          <Info label="承包廠商">{project.contractor_name || '—'}</Info>
          <Info label="估驗日期">{selected.valuation_date}</Info>
          <Info label="計價截止">{selected.period_end || '未設'}（{selected.status}）</Info>
          <Info label="本期估驗">NT$ {fmt(periodAmt)}（累計完成 {completion.toFixed(1)}%）</Info>
        </div>

        {/* AI 本期施工說明(可編輯,列印含內容)*/}
        <div className="mb-5">
          <div className="paper-mute font-medium mb-1 flex items-center gap-1.5">
            <MSym name="auto_awesome" size={13} className="text-[var(--blue)] print:hidden" />本期施工說明
            <span className="text-xs paper-mute font-normal print:hidden">（AI 依本期工項、確認查驗之照片與已簽署施工日誌草擬，可直接修改）</span>
          </div>
          <ErrorBanner msg={aiErr} onClose={() => setAiErr('')} className="print:hidden mb-2" />
          {aiErr && aiEnabled('valuation.summary') && (
            <p className="text-xs text-[var(--text-2)] mb-2 print:hidden">
              可按上方「重新產生施工說明」重試，或直接在下方說明欄自行撰寫。
            </p>
          )}
          <textarea
            value={aiBusy && !summary ? 'AI 產生中…' : summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            aria-label="本期施工說明"
            className="w-full text-body leading-relaxed border paper-rule-2 print:border-0 rounded p-2 print:p-0 resize-none focus:outline-none focus:border-[var(--blue)]"
          />
        </div>

        {/* 本期估驗明細(手機:表格自身橫捲,不讓整頁水平漂移——P1-08)*/}
        <div className="text-xs paper-mute mb-1">本期估驗明細（僅列本期有完成之工項；「依據」取自監造確認量與後端檢查）</div>
        <div className="overflow-x-auto -mx-1 mb-6 print:overflow-visible print:mx-0">
        <table className="w-full border-collapse text-footnote min-w-[560px] print:min-w-0">
          <thead>
            <tr className="paper-fill">
              {['項次', '工項名稱', '單位', '本期完成數量', '單價', '本期金額', '依據'].map((h) => (
                <th key={h} className="border paper-rule px-1.5 py-1 font-medium paper-mute whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leaves.map((it) => {
              const qty = periodQty(it.item_key)          // 本期完成數量(原始數量差)
              const amt = periodAmtOf(it.item_key)         // 本期金額(金額差,已 = 數量 × 單價,不可再乘)
              const e = evByKey.get(it.item_key)
              return (
                <tr key={it.item_key}>
                  <td className="border paper-rule-2 px-1.5 py-1 paper-mute whitespace-nowrap">{it.item_no}</td>
                  <td className="border paper-rule-2 px-1.5 py-1">{it.description}</td>
                  <td className="border paper-rule-2 px-1.5 py-1 text-center paper-mute whitespace-nowrap">{it.unit}</td>
                  <td className="border paper-rule-2 px-1.5 py-1 text-right tabular-nums whitespace-nowrap">{fmtQ(qty)}</td>
                  <td className="border paper-rule-2 px-1.5 py-1 text-right tabular-nums whitespace-nowrap">{fmt(it.unit_price)}</td>
                  <td className="border paper-rule-2 px-1.5 py-1 text-right tabular-nums whitespace-nowrap">{fmt(amt)}</td>
                  <td className="border paper-rule-2 px-1.5 py-1 text-center whitespace-nowrap">{!evReady ? <span className="paper-mute">…</span> : ev.error ? <span className="paper-warn">讀取失敗</span> : e ? basisCell(e) : '—'}</td>
                </tr>
              )
            })}
            {/* 本期沒有新增完成量時,原本 tbody 只剩一列合計 0,看起來像「資料掉了」。
                明講是「本期無新增」而非無資料,並指向累計數字該去哪裡看(C-11)。 */}
            {leaves.length === 0 && (
              <tr>
                <td className="border paper-rule-2 px-1.5 py-3 text-center paper-mute" colSpan={7}>
                  第 {selected.period_no} 期尚無本期新增完成數量；累計完成請見估驗計價單。
                </td>
              </tr>
            )}
            <tr className="paper-fill font-semibold">
              <td className="border paper-rule px-1.5 py-1 text-right" colSpan={5}>本期估驗合計</td>
              <td className="border paper-rule px-1.5 py-1 text-right tabular-nums">{fmt(periodAmt)}</td>
              <td className="border paper-rule px-1.5 py-1 text-center paper-mute">{photoCount} 張照片</td>
            </tr>
          </tbody>
        </table>
        </div>

        {/* 本期確認來源:每一筆數量追到 批次／階段 → 監造確認紀錄 → 查驗表單版本(雜湊)→ 檢附自主檢查;缺件照 DB 明示 */}
        <div className="paper-mute font-medium mb-2 flex items-center gap-1.5">
          <MSym name="verified" size={14} className="text-[var(--blue)] print:hidden" />本期確認來源與簽署文件版本
        </div>
        {!evReady ? (
          <div className="paper-mute text-footnote py-2 mb-6" aria-busy="true">正在讀取本期確認來源與簽署版本…</div>
        ) : ev.error ? (
          <div role="alert" className="paper-warn text-footnote py-2 mb-6">本期證據讀取失敗，不產生佐證內容：{friendlyError(ev.error, '證據讀取失敗')}（請重新整理）。</div>
        ) : (
          <ul role="list" aria-label="本期確認來源" className="space-y-3 mb-6">
            {evidence.map((e) => (
              <li key={e.item.item_key} className="break-inside-avoid text-footnote">
                <div className="font-medium"><span className="paper-mute mr-1.5">{e.item.item_no}</span>{e.item.description}</div>
                {e.sources.length === 0 && e.issues.length === 0 && <div className="paper-warn pl-3">本期沒有任何確認來源分配。</div>}
                <ul className="pl-3 space-y-0.5">
                  {e.sources.map((s) => {
                    const c = s.confirmation
                    if (s.kind === 'legacy') return <li key={s.id} className="paper-warn">歷史遷移 {fmtQ(s.qty)} {e.item.unit}：非監造確認，無查驗或文件版本，需監造確認單補證。</li>
                    if (s.kind === 'clawback') return <li key={s.id}>扣回 {fmtQ(s.qty)} {e.item.unit}（確認撤銷／減量後的調整）</li>
                    if (s.kind === 'adjustment') return <li key={s.id}>平台管理員調整 {fmtQ(s.qty)} {e.item.unit}</li>
                    return (
                      <li key={s.id}>
                        <span className="font-medium">監造確認 {fmtQ(s.qty)} {e.item.unit}</span>
                        <span className="paper-mute">・批次 {c?.location_label || s.batch_key}{c?.stage_key ? `・階段 ${c.stage_key}` : ''}{c ? `・累計 ${fmtQ(c.qty_cum)}` : ''}</span>
                        {c && <span className="paper-mute">・依據 {BASIS_LABEL[c.basis] || c.basis}</span>}
                        {s.inspection && <span className="paper-mute">・{s.inspection.title}（{s.inspection.status}）</span>}
                        {s.form && <span className="paper-mute">・<VersionRef refObj={s.form.ref} /></span>}
                        {c && <span className="paper-mute">・{s.form ? `簽署 ${ev.signers.get(versionKey(s.form.ref.document_id, s.form.ref.version_no)) || memberName(c.confirmed_by)}` : `確認 ${memberName(c.confirmed_by)}`} {taipeiDateTime(c.confirmed_at)}</span>}
                        {c?.basis === 'supervisor_certificate' && c.reason && <span className="paper-mute">・{c.reason}</span>}
                        {c?.status === 'revoked' && <span className="paper-warn">・已撤銷（{taipeiDateTime(c.revoked_at)}{c.reason ? `：${c.reason}` : ''}）</span>}
                        {s.form && !s.form.loaded && <span className="paper-warn">・讀不到此查驗表單版本</span>}
                        {s.selfCheck && (
                          <div className="paper-mute pl-3">
                            檢附自主檢查：{s.selfCheck.record ? `${s.selfCheck.record.check_date || ''} Rev.${s.selfCheck.record.rev ?? 0}（${s.selfCheck.record.overall || '—'}）` : `紀錄 ${String(s.selfCheck.record_id).slice(0, 8)}`}
                            {s.selfCheck.ref ? <>・<VersionRef refObj={s.selfCheck.ref} /></> : '・（非經簽署自主檢查表文件落下的紀錄，或已有更正版次）'}
                          </div>
                        )}
                      </li>
                    )
                  })}
                  {e.issues.map((i, k) => (
                    <li key={`i${k}`} className="paper-warn">缺件：{i.label}—{i.title}{i.missing_stages.length ? `（缺階段 ${i.missing_stages.join('、')}）` : ''}</li>
                  ))}
                </ul>
              </li>
            ))}
            {evidence.length === 0 && <li className="paper-mute text-footnote">本期沒有新增完成數量的工項。</li>}
          </ul>
        )}

        {/* 佐證照片:只取本期確認所依據之已簽署查驗表單的附件(版本雜湊涵蓋附件),不再撈同工項的全部照片 */}
        <div className="paper-mute font-medium mb-2 flex items-center gap-1.5">
          <MSym name="photo_library" size={14} className="text-[var(--blue)] print:hidden" />現場佐證照片（本期確認所依據之簽署查驗表單附件）
        </div>
        {!loaded ? (
          <div className="paper-mute text-footnote py-4">{ev.error ? '證據讀取失敗，未列照片。' : '照片載入中…'}</div>
        ) : photoCount === 0 ? (
          <div className="paper-mute text-footnote py-4 border border-dashed paper-rule-2 rounded px-3 print:border-0">
            {ev.demo
              ? '示範資料的查驗表單沒有附照片（示範模式不支援照片上傳）；正式專案由監造在查驗表單附上照片並隨版本簽署後列入本包。'
              : '本期確認所依據的查驗表單沒有附證據照片；照片需由監造在查驗表單附上並隨版本簽署，才會列入本包。'}
          </div>
        ) : (
          <div className="space-y-4">
            {evidence.filter((e) => e.photoIds.some((id) => photoById.has(id))).map((e) => (
              <div key={e.item.item_key} className="break-inside-avoid">
                <div className="text-footnote font-medium mb-1">
                  <span className="paper-mute mr-1.5">{e.item.item_no}</span>{e.item.description}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {e.photoIds.map((id) => photoById.get(id)).filter(Boolean).map((p) => {
                    // 施作區域(AI 從查驗黑板抄下的 photos.location)併進說明行:同一工項不同
                    // 樓層/區域的照片,光看說明分不出來,機關逐張核對時會卡在這裡。
                    const line = photoEvidenceLine(p)
                    return (
                      <figure key={p.id} className="border paper-rule-2 rounded overflow-hidden break-inside-avoid">
                        {/* 佐證照片本身就是送審內容,無 caption 時仍要說得出「這是哪個工項的照片」 */}
                        {p.url && <img src={p.url} alt={line || `${e.item.item_no} ${e.item.description} 佐證照片`} className="w-full h-28 object-cover" />}
                        <figcaption className="text-micro paper-mute px-1.5 py-1 leading-tight">
                          {line || '—'}{p.taken_at ? ` · ${String(p.taken_at).slice(0, 10)}` : ''}
                        </figcaption>
                      </figure>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 簽核 */}
        <div className="grid grid-cols-3 gap-4 mt-10 text-center paper-mute break-inside-avoid">
          {['承包廠商', '監造單位', '主管機關'].map((r) => (
            <div key={r}>
              <div className="h-16 border-b paper-rule" />
              <div className="mt-1.5 text-footnote">{r}（簽章）</div>
            </div>
          ))}
        </div>
        {/* 附件:施工日誌(已簽署版本;旗艦承諾:紙本輸出自動夾附平時的施工日誌)*/}
        <label className="print:hidden flex items-center gap-2 mt-8 text-footnote paper-mute select-none cursor-pointer max-md:min-h-11">
          {/* 原生 checkbox 預設約 13px,是全頁最小的觸控目標 */}
          <input type="checkbox" className="w-5 h-5" checked={attachLogs} onChange={(e) => setAttachLogs(e.target.checked)} />
          夾附施工日誌（列印時附上本期範圍內、含本期工項數量的已簽署施工日誌）
        </label>
        {attachLogs && loaded && (
          <div className="mt-4 print:break-before-page">
            <div className="paper-mute font-medium mb-1 flex items-center gap-1.5">
              <MSym name="description" size={14} className="text-[var(--blue)] print:hidden" />附件：施工日誌（已簽署版本）
            </div>
            <div className="text-xs paper-mute mb-1">
              本期範圍 {spanText}。{span.gap ? '' : pinNote}
              {logAttachment.unsigned.length > 0 && <span className="paper-warn">本期範圍內另有 {logAttachment.unsigned.length} 日的施工日誌{selected.status === '草稿' ? '尚未簽署' : '送審時尚未簽署'}，不列入（{logAttachment.unsigned.map((u) => u.date).join('、')}）。</span>}
              {logAttachment.missing > 0 && <span className="paper-warn">有 {logAttachment.missing} 份已簽署版本讀取不到內容，未列入。</span>}
            </div>
            {logAttachment.rows.length === 0 ? (
              <div className="text-xs paper-mute">本期範圍內沒有含本期工項數量的已簽署施工日誌。</div>
            ) : (
            <div className="overflow-x-auto -mx-1 print:overflow-visible print:mx-0">
            <table className="w-full border-collapse text-caption min-w-[560px] print:min-w-0">
              <thead>
                <tr className="paper-fill">
                  {['日期', '天氣', '本期相關工項與當日數量', '工作摘要', '簽署版本'].map((h) => (
                    <th key={h} className="border paper-rule px-1.5 py-1 font-medium paper-mute whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logAttachment.rows.map((r) => (
                  <tr key={r.date} className="break-inside-avoid align-top">
                    <td className="border paper-rule-2 px-1.5 py-1 tabular-nums whitespace-nowrap paper-mute">{r.date}</td>
                    <td className="border paper-rule-2 px-1.5 py-1 whitespace-nowrap paper-mute">{r.weather}</td>
                    <td className="border paper-rule-2 px-1.5 py-1">
                      {r.items.map((it) => (
                        <div key={it.item_key} className="leading-snug">
                          <span className="paper-mute mr-1">{it.item_no}</span>{it.description}
                          <span className="tabular-nums paper-mute ml-1">{fmtQ(it.qty)} {it.unit}</span>
                        </div>
                      ))}
                    </td>
                    <td className="border paper-rule-2 px-1.5 py-1 paper-mute">{r.summary || '—'}</td>
                    <td className="border paper-rule-2 px-1.5 py-1 paper-mute">
                      <VersionRef refObj={r.ref} />
                      {r.ref.newer && <div className="paper-warn">之後另有 v{r.ref.newer.version_no}（{taipeiDateTime(r.ref.newer.signed_at)}），不影響本包</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            )}
          </div>
        )}

        {/* 釐清句已提到頁首常駐,這裡只留保留款比例 */}
        <div className="text-caption paper-mute mt-3 print:hidden">
          保留款 {retPct}%。
        </div>
      </div>
    </div>
  )
}
