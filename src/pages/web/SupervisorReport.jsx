import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Empty, PageHeader, Button, Badge, Surface, Input, Textarea } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { plannedPctNow } from '../../lib/progressPlan.js'
import { taipeiToday, localISODate, taipeiISODate, taipeiDateTime } from '../../lib/dates.js'
import { reportCutoff, isPartialMonth, latestValuationAt, valuationLabel, monthEnd } from '../../lib/progressAsOf.js'
import { buildSupervisorReport } from '../../lib/supervisorReport.js'
import { signedVersionIndex, signedVersionText, signedVersionLink, confirmationDocRef, INSPECTION_VERDICT_TONE, DOC_STATUS_LABEL } from '../../lib/fieldDocs.js'
import { fmtAmount } from '../../lib/format.js'
import { friendlyError } from '../../lib/errorMessage.js'
import useSignedVersions from '../../lib/useSignedVersions.js'
import { navLabel } from '../../lib/navConfig.js'

// 每次呼叫取「今天」(B-11):模組層常數會讓長開分頁凍結在開頁那天
const curMonth = () => taipeiToday().slice(0, 7)
// 頁名單一來源(navConfig 的「監造月報」;與每日的「監造日誌」是兩份不同文件,D-026 §2)
const TITLE = navLabel('/supervisor-report')
const qty = (n) => fmtAmount(n, { empty: '0' })
const BASIS_LABEL = { inspection: '查驗表單', supervisor_certificate: '監造確認單', pro_rata_rule: '比例規則' }

// 章節標題=Workspace 卡頭風(15px/500)。拿掉藍色短標:章節本來就靠「一、二、三」
// 編號分節,再加一條主色裝飾條會讓每一節都像重點,反而讀不出輕重。
function Section({ n, title, children }) {
  return (
    <div>
      <h3 className="text-callout font-medium text-[var(--text)] mb-2">{n}、{title}</h3>
      <div className="pl-3">{children}</div>
    </div>
  )
}
// 鍵值列與施工月報的 Info 同一份長相(dt/dd):兩張報表的概況欄不該有兩種標籤色與字重
const Kv = ({ k, v }) => (<div className="flex flex-wrap gap-x-2 text-sm"><dt className="text-[var(--text-3)]">{k}：</dt><dd className="font-medium min-w-0 text-[var(--text)]">{v || '—'}</dd></div>)
// 版本標示:可直達列印(該版本即文件目前的簽署版本、文件仍在活文件清單)就給連結,否則只印標示
function VersionRef({ refObj, openDocIds }) {
  if (!refObj) return null
  const link = signedVersionLink(refObj, openDocIds)
  const text = signedVersionText(refObj)
  return link
    ? <Link to={link} className="text-xs text-[var(--blue-text)] hover:underline">{text}</Link>
    : <span className="text-xs text-[var(--text-3)]">{text}{refObj.doc_status === 'superseded' ? '（文件已由新文件取代）' : ''}</span>
}
// 來源還在讀／讀不到:該段不出數字(讀取失敗≠沒有已簽署文件)
const Pending = ({ label, error }) => (error
  ? <p role="alert" className="text-sm text-[var(--red-text)]">{label}讀取失敗，本段暫不彙整：{friendlyError(error, `${label}讀取失敗`)}（請重新整理）。</p>
  : <p className="text-sm text-[var(--text-3)]" aria-busy="true">正在讀取{label}…</p>)

export default function SupervisorReport() {
  const { project, workItems, valuations, progressPlan, siteLogs, inspections, defects, submittals,
    demoMode, workItemsSource, adjustedItems, revisedTotal, fieldDocuments, listSupervisorLogs, fetchConfirmations } = useStore()
  const [month, setMonth] = useState(curMonth)
  const [opinion, setOpinion] = useState(null) // null=用草稿；字串=已編輯
  const imported = workItemsSource === 'db' || demoMode
  const TODAY = new Date()

  // 財務單一真相層(B-02):監造月報進度與估驗/進度頁一致(含已核准變更)
  const { roots, childrenMap } = useMemo(
    () => (workItems ? buildBillableTree(adjustedItems) : { roots: [], childrenMap: new Map() }),
    [workItems, adjustedItems],
  )
  const billableTotal = workItems ? revisedTotal : 0
  // 進度隨報告月份回看(C2):截止日=所選月份月底,本月尚未結束取今天——與施工月報同一天、同一期(D-024)
  const cutoff = reportCutoff(month, TODAY), partial = isPartialMonth(month, TODAY), cutoffISO = localISODate(cutoff)
  const latestVal = latestValuationAt(valuations, cutoff)
  const actualPct = useMemo(() => {
    if (!latestVal || !billableTotal) return 0
    return (totalCumAmount(roots, buildCumMap(roots, childrenMap, latestVal)) / billableTotal) * 100
  }, [roots, childrenMap, latestVal, billableTotal])
  const plannedNow = plannedPctNow(progressPlan, cutoff)
  const periodLabel = valuationLabel(latestVal)

  // P6a:只彙整已簽署版本——施工日誌、監造日誌、監造查驗表單的簽署列(事實列＝指向它的文件最晚一次簽署的版本)
  const openDocs = fieldDocuments?.documents
  const signedSrc = useSignedVersions(['daily_log', 'supervisor_log', 'inspection_form'], openDocs)
  const idx = useMemo(() => ({
    daily: signedVersionIndex(signedSrc.rows.daily_log),
    supervisor: signedVersionIndex(signedSrc.rows.supervisor_log),
    form: signedVersionIndex(signedSrc.rows.inspection_form),
  }), [signedSrc.rows])
  const openDocIds = useMemo(() => new Set((openDocs || []).map((d) => d.id)), [openDocs])
  // 本月監造日誌事實列(不常駐 store,開頁讀該月;簽署後文件清單重載即重取)與監造確認紀錄(RLS 成員可讀)
  const [supLogs, setSupLogs] = useState({ month: null, rows: [], error: null })
  useEffect(() => {
    let alive = true
    listSupervisorLogs({ from: `${month}-01`, to: localISODate(monthEnd(month)) }).then(({ rows, error }) => {
      if (alive) setSupLogs({ month, rows, error })
    })
    return () => { alive = false }
  }, [month, openDocs, listSupervisorLogs])
  const [confs, setConfs] = useState({ loaded: false, rows: [], error: null })
  useEffect(() => {
    let alive = true
    fetchConfirmations().then(({ rows, error }) => { if (alive) setConfs({ loaded: true, rows, error: error || null }) })
    return () => { alive = false }
  }, [fetchConfirmations, valuations])
  const ready = !signedSrc.loading && !signedSrc.error && supLogs.month === month && !supLogs.error && confs.loaded && !confs.error
  const loadError = signedSrc.error || supLogs.error || confs.error
  const byId = useMemo(() => new Map((adjustedItems || []).filter((it) => it.id).map((it) => [it.id, it])), [adjustedItems])

  const r = useMemo(() => buildSupervisorReport({
    project, siteLogs, dailyLogIndex: idx.daily, supervisorLogs: supLogs.rows, supervisorLogIndex: idx.supervisor,
    inspections, inspectionFormIndex: idx.form, confirmations: confs.rows, defects, submittals, openDocs,
    progress: { actualPct, plannedPct: plannedNow, asOf: cutoffISO, period: periodLabel },
  }, month), [project, siteLogs, idx, supLogs.rows, inspections, confs.rows, defects, submittals, openDocs, actualPct, plannedNow, cutoffISO, periodLabel, month])

  if (!imported) {
    return (
      <div className="space-y-5">
        <PageHeader title={TITLE} tagline="AI 草擬" subtitle="彙整本月已簽署監造日誌、查驗表單判定與監造確認量，產出監造月報草稿" />
        <Card><Empty>此專案尚未匯入標單，無法彙整{TITLE}。請先到「專案文件」一次上傳標單 XML。</Empty></Card>
      </div>
    )
  }

  const behind = plannedNow != null ? plannedNow - actualPct : null
  const opinionText = opinion ?? r.opinion
  const confirmRows = [...r.confirmations.confirmed, ...r.confirmations.revoked.filter((c) => !r.confirmations.confirmed.includes(c))]

  return (
    <div className="space-y-5">
      <PageHeader title={TITLE} tagline="AI 草擬"
        subtitle="彙整本月已簽署監造日誌、查驗表單判定、監造確認量、缺失與進度 → 監造月報草稿，覆核後列印"
        action={
          <div className="flex items-center gap-2 flex-wrap print:hidden">
            {/* 欄位吃共用 Input(FIELD_BASE):與施工月報的月份選擇器同一顆,含 focus ring 與手機 44px */}
            <Input type="month" value={month} aria-label="報表月份" onChange={(e) => { setMonth(e.target.value); setOpinion(null) }} className="!w-auto" />
            <Button onClick={() => window.print()}><MSym name="print" size={15} />列印 / 存 PDF</Button>
          </div>
        } />

      {/* 報表本體(列印範圍)——與施工月報同一組卡殼,改吃共用 Surface;
          print: 三件是列印版面的合約,原樣保留 */}
      <Surface className="p-6 md:p-8 print:border-0 print:shadow-none print:p-0 space-y-6 text-[var(--text)]">
        <div className="text-center border-b border-[var(--border)] pb-4">
          {/* 列印文件的大標用 h2(與施工月報同):正式文件需要標題語意,不能只是粗體 div */}
          <h2 className="text-lg font-bold">{TITLE}</h2>
          <div className="text-sm text-[var(--text-2)] mt-0.5">{project.project_name}</div>
          <div className="text-xs text-[var(--text-3)] mt-1 num">報告月份：{r.monthLabel}&#x3000;·&#x3000;監造單位：{project.supervisor_name || '—'}</div>
        </div>

        <Section n="一" title="工程概況">
          <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-1">
            <Kv k="機關" v={project.owner_name} />
            <Kv k="承包廠商" v={project.contractor_name} />
            {/* 同月報:實際開工日在 commencement_date,建案表單的 start_date 只是預定值 */}
            <Kv k="開工日" v={project.commencement_date || (project.start_date ? `${project.start_date}（預計）` : '—')} />
            <Kv k="預定竣工" v={project.end_date || '—'} />
          </dl>
        </Section>

        <Section n="二" title="施工進度督導">
          {/* W07:截止日、所取期別、含未核定與預定取法寫在報表上;本月與施工月報同一天同一期 */}
          <p className="text-xs text-[var(--text-3)] mb-1">統計截止日 {cutoffISO}{partial ? '（本月尚未結束，以今天為準）' : ''}；累計實際取 {periodLabel}，含尚未核定的期別；累計預定為預定進度表（各月底累計）按日內插至截止日。</p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span>累計實際 <b className="num text-[var(--blue-text)]">{actualPct.toFixed(1)}%</b></span>
            {plannedNow != null && <span>累計預定 <b className="num">{plannedNow.toFixed(1)}%</b></span>}
            {behind != null && <Badge color={behind > 5 ? 'red' : behind < -2 ? 'blue' : 'green'}>{behind > 5 ? `落後 ${behind.toFixed(1)}%` : behind < -2 ? `超前 ${(-behind).toFixed(1)}%` : '進度正常'}</Badge>}
            {/* 雨天恆顯示(含 0):兩報表要能對值(P1-07);天數只算已簽署施工日誌,與施工月報同一條 */}
            {ready && <span className="text-[var(--text-3)]">本月已簽署施工日誌 {r.logs.workDays} 日（雨天 {r.logs.rainDays} 日）{r.logs.unsigned.length ? `；另 ${r.logs.unsigned.length} 日未簽署、不列入` : ''}</span>}
          </div>
        </Section>

        <Section n="三" title="監造日誌（已簽署版本）">
          {!ready ? <Pending label="已簽署監造日誌" error={signedSrc.error || supLogs.error} /> : (
            <>
              <div className="text-sm mb-2">本月已簽署監造日誌 <b className="num">{r.supervisorLogs.signed.length}</b> 份，監造到場 <b className="num">{r.supervisorLogs.attendedDays}</b> 日。</div>
              {r.supervisorLogs.signed.length > 0 && (
                <ul role="list" aria-label="已簽署監造日誌" className="text-sm text-[var(--text-2)] space-y-1">
                  {r.supervisorLogs.signed.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="num text-[var(--text-3)] text-xs w-24 shrink-0">{l.log_date}</span>
                      <span className="min-w-0">{(l.attendance || []).length ? `到場 ${l.attendance.map((a) => a?.name || '—').join('、')}` : '本日未到場'}</span>
                      <span className="text-xs text-[var(--text-3)]">監造事項 {(l.supervision_items || []).length} 項・當日查驗 {(l.inspection_ids || []).length} 件{(l.notices || []).length ? `・通知 ${l.notices.length} 件` : ''}</span>
                      <VersionRef refObj={l.ref} openDocIds={openDocIds} />
                    </li>
                  ))}
                </ul>
              )}
              {r.supervisorLogs.unsigned.length > 0 && (
                <div role="note" aria-label="未簽署監造日誌" className="mt-1 text-xs text-[var(--amber-text)]">未簽署、不列入：{r.supervisorLogs.unsigned.map((u) => `${u.date}（${u.legacy ? '未經文件簽署' : DOC_STATUS_LABEL[u.doc.status] || u.doc.status}）`).join('、')}</div>
              )}
            </>
          )}
        </Section>

        <Section n="四" title="查驗辦理情形（依已簽署監造查驗表單）">
          {!ready ? <Pending label="已簽署查驗表單" error={signedSrc.error} /> : (
            <>
              <div className="text-sm mb-2">本月經簽署查驗表單判定 <b className="num">{r.inspections.total}</b> 件：合格 {r.inspections.pass}、部分合格 {r.inspections.partial}、不合格 {r.inspections.fail}；目前待查驗 {r.inspections.pending} 件。</div>
              {r.inspections.list.length > 0 && (
                <ul role="list" aria-label="已簽署查驗表單判定" className="text-sm text-[var(--text-2)] space-y-1">
                  {r.inspections.list.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="num text-[var(--text-3)] text-xs w-24 shrink-0">{taipeiISODate(i.inspected_at) || i.requested_date || ''}</span>
                      <span className="min-w-0">{i.title}</span>
                      <Badge color={INSPECTION_VERDICT_TONE[i.status] || 'slate'}>{i.status}</Badge>
                      {i.confirmed_qty != null && <span className="text-xs text-[var(--text-3)] num">申報 {qty(i.declared_qty)}／確認 {qty(i.confirmed_qty)} {i.unit || ''}</span>}
                      <VersionRef refObj={i.ref} openDocIds={openDocIds} />
                    </li>
                  ))}
                </ul>
              )}
              {r.inspections.unsigned.length > 0 && (
                <div role="note" aria-label="未經簽署查驗表單之判定" className="mt-1 text-xs text-[var(--amber-text)]">判定未經簽署查驗表單、不列入：{r.inspections.unsigned.map((i) => `${i.title}（${i.status}）`).join('、')}</div>
              )}
            </>
          )}
        </Section>

        <Section n="五" title="監造確認量">
          {!ready ? <Pending label="監造確認紀錄" error={confs.error} /> : confirmRows.length === 0 ? (
            <div className="text-sm text-[var(--text-3)]">本月沒有新的監造確認紀錄。</div>
          ) : (
            <ul role="list" aria-label="本月監造確認紀錄" className="text-sm text-[var(--text-2)] space-y-1">
              {confirmRows.map((c) => {
                const wi = byId.get(c.work_item_id)
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="num text-[var(--text-3)] text-xs w-24 shrink-0">{taipeiISODate(c.confirmed_at)}</span>
                    <span className="min-w-0">{wi ? `${wi.item_no || ''} ${wi.description || ''}`.trim() : '工項'}・批次 {c.location_label || c.batch_key}{c.stage_key ? `・階段 ${c.stage_key}` : ''}</span>
                    <span className="num">+{qty(c.qty_delta)} {c.unit}（累計 {qty(c.qty_cum)}）</span>
                    <span className="text-xs text-[var(--text-3)]">依據 {BASIS_LABEL[c.basis] || c.basis}</span>
                    <VersionRef refObj={confirmationDocRef(c, idx.form)} openDocIds={openDocIds} />
                    {c.status === 'revoked' && <Badge color="red">已撤銷 {taipeiDateTime(c.revoked_at)}{c.reason ? `：${c.reason}` : ''}</Badge>}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section n="六" title="品質缺失督導">
          <div className="text-sm mb-2">目前未結案缺失 <b className="num">{r.defects.openCount}</b> 件{r.defects.overdue ? `（逾期 ${r.defects.overdue} 件）` : ''}；本月複查結案 {r.defects.closedThisMonth} 件。</div>
          {r.defects.open.length > 0 && (
            <ul className="text-sm text-[var(--text-2)] space-y-0.5">
              {r.defects.open.slice(0, 6).map((d, k) => (
                <li key={k} className="flex items-center gap-2"><span className="truncate">{d.title}</span><Badge color={d.status === '開立' ? 'red' : d.status === '待複查' ? 'blue' : 'amber'}>{d.status}</Badge>{d.due_date && <span className="text-xs text-[var(--text-3)] num">期限 {d.due_date}</span>}</li>
              ))}
            </ul>
          )}
        </Section>

        <Section n="七" title="送審文件審核">
          <div className="text-sm">本月審定 <b className="num">{r.submittals.decidedCount}</b> 件；尚有 {r.submittals.pending} 件審核中。</div>
        </Section>

        <Section n="八" title="監造意見與建議">
          {/* print: 兩件(去框、去左右內距)是列印版面的合約,以 className 帶入共用 Textarea。
              來源未讀完不給草稿:半份資料擬出的「0 份監造日誌」會被當成事實交出去 */}
          <Textarea value={ready ? opinionText : ''} onChange={(e) => setOpinion(e.target.value)} rows={5} disabled={!ready}
            aria-label="監造意見與建議" className="leading-relaxed print:border-0 print:px-0" />
          <div className="text-caption text-[var(--text-3)] mt-1 print:hidden flex items-center gap-1">
            <MSym name="auto_awesome" size={12} />{loadError ? '來源讀取失敗，草稿暫不產生（請重新整理）。' : '依本月已簽署文件的數據草擬，請監造覆核修改後再列印用印。'}
          </div>
        </Section>

        <div className="grid sm:grid-cols-3 gap-6 pt-6 text-center text-xs text-[var(--text-2)]">
          {['監造人員', '監造主管', '機關代表'].map((role) => (
            /* 簽章底線用邊框 token(--border);--text-3 是文字色,不當邊框用 */
            <div key={role}><div className="border-t border-[var(--border)] pt-1 mt-8">{role}</div></div>
          ))}
        </div>
      </Surface>
    </div>
  )
}
