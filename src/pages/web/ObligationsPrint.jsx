import { useMemo } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import PrintToolbar from '../../components/PrintToolbar.jsx'
import { computeObligationDue, formatObligationRule } from '../../lib/contractDue.js'
import { parseLocalDate, localISODate, taipeiToday } from '../../lib/dates.js'

// W10 契約期限對照表——「可寄給對方」的輸出物。事務所/監造對機關、對廠商溝通時
// 需要一張紙:哪些期限、怎麼算、到期日、誰負責、現在狀態、契約出處。
// 不套 WebLayout,整頁即文件;工具列(chrome,吃主題 token)與紙面(.paper,固定白底黑字)
// 分開處理,理由見 PrintToolbar 與 index.css。

const PHASES = ['開工前', '施工中', '完工', '保固', '其他']
const ANCHOR_LABELS = [
  ['award_date', '決標日'], ['notice_date', '開工通知日'],
  ['commencement_date', '開工日'], ['end_date', '竣工日'],
]
const iso = (d) => localISODate(d) || ''

const TH = 'border paper-rule-strong px-2 py-1 text-left font-medium paper-fill'
const TD = 'border paper-rule-strong px-2 py-1 align-top'

export default function ObligationsPrint() {
  const { currentProject, obligations, currentUser, submittals } = useStore()
  const navigate = useNavigate()

  const anchors = useMemo(() => ({
    award_date: currentProject?.award_date || '',
    notice_date: currentProject?.notice_date || '',
    commencement_date: currentProject?.commencement_date || '',
    end_date: currentProject?.end_date || '',
  }), [currentProject])

  const today = useMemo(() => parseLocalDate(taipeiToday()), [])
  const rows = useMemo(() => obligations.map((ob) => {
    const due = computeObligationDue(ob, anchors)
    const done = ob.status === '已提送' || ob.status === '已完成'
    const overdue = !done && due && due < today
    return { ob, due, done, overdue }
  }), [obligations, anchors, today])
  const groups = useMemo(() => PHASES.map((ph) => ({
    ph,
    list: rows.filter((r) => (PHASES.includes(r.ob.category) ? r.ob.category : '其他') === ph)
      .sort((x, y) => (x.due?.getTime() || Infinity) - (y.due?.getTime() || Infinity)),
  })).filter((g) => g.list.length), [rows])
  // 「漏了什麼」也要進報告:缺基準日而算不出到期日的期限,寄出去的表上必須看得到
  const nodateCount = rows.filter((r) => !r.done && !r.due).length
  const missingAnchors = ANCHOR_LABELS.filter(([k]) => !anchors[k]).map(([, label]) => label)
  const overdueCount = rows.filter((r) => r.overdue).length

  if (!currentUser) return <Navigate to="/login" replace />
  if (!obligations.length) {
    return (
      <div className="p-10 text-center text-[var(--text-2)]">
        尚無期限資料。<button onClick={() => navigate('/deadlines')} className="text-[var(--blue-text)] underline">返回期限追蹤</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen paper-desk py-6 print:py-0">
      <PrintToolbar backTo="/deadlines" backLabel="返回期限追蹤" />

      {/* A4 文件本體:紙面永遠白底黑字,不吃主題 token(.paper) */}
      <div className="max-w-[210mm] mx-auto paper shadow print:shadow-none px-[14mm] py-[12mm] text-footnote leading-relaxed">
        <h1 className="text-center text-lg font-bold">契約期限對照表</h1>
        <div className="text-center paper-mute mt-0.5">產出日期:{iso(today)}</div>

        <table className="w-full mt-3 border-collapse">
          <tbody>
            <tr>
              <td className={`${TD} w-24 paper-fill`}>工程名稱</td>
              <td className={TD} colSpan={3}>{currentProject?.project_name || '—'}</td>
            </tr>
            <tr>
              <td className={`${TD} paper-fill`}>機關</td>
              <td className={TD}>{currentProject?.owner_name || '—'}</td>
              <td className={`${TD} w-24 paper-fill`}>監造單位</td>
              <td className={TD}>{currentProject?.supervisor_name || '—'}</td>
            </tr>
            <tr>
              <td className={`${TD} paper-fill`}>施工廠商</td>
              <td className={TD}>{currentProject?.contractor_name || '—'}</td>
              <td className={`${TD} paper-fill`}>契約價金總額</td>
              <td className={TD}>{currentProject?.contract_total ? `NT$ ${Number(currentProject.contract_total).toLocaleString('en-US')}` : '—'}</td>
            </tr>
            <tr>
              <td className={`${TD} paper-fill`}>基準日</td>
              <td className={TD} colSpan={3}>
                {ANCHOR_LABELS.map(([k, label]) => `${label} ${anchors[k] || '未填'}`).join('・')}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-2 paper-mute">
          合計 {rows.length} 項期限;已完成/已提送 {rows.filter((r) => r.done).length} 項、
          已逾期 {overdueCount} 項、無法推算到期日 {nodateCount} 項。
          {missingAnchors.length > 0 && (
            <span className="paper-ink font-medium">
              (注意:{missingAnchors.join('、')}未填,相關期限的到期日無法推算)
            </span>
          )}
        </div>

        {groups.map((g) => (
          <div key={g.ph} className="mt-4 break-inside-avoid-page">
            <h2 className="font-bold text-body mb-1">{g.ph}({g.list.length} 項)</h2>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${TH} w-[30%]`}>期限事項</th>
                  <th className={`${TH} w-[15%]`}>期限規則</th>
                  <th className={`${TH} w-[12%]`}>到期日</th>
                  <th className={`${TH} w-[8%]`}>責任方</th>
                  <th className={`${TH} w-[10%]`}>狀態</th>
                  <th className={TH}>罰則/出處/佐證</th>
                </tr>
              </thead>
              <tbody>
                {g.list.map(({ ob, due, done, overdue }) => {
                  const ev = ob.evidence_submittal_id
                    ? submittals.find((s) => s.id === ob.evidence_submittal_id) : null
                  return (
                    <tr key={ob.id}>
                      <td className={TD}>{ob.title}</td>
                      <td className={TD}>{formatObligationRule(ob)}</td>
                      <td className={TD}>
                        {due ? iso(due) : '無法推算'}
                        {overdue && <span className="font-bold">(已逾期)</span>}
                      </td>
                      <td className={TD}>{ob.responsible || '—'}</td>
                      <td className={TD}>{done ? ob.status : (overdue ? `${ob.status}(逾期)` : ob.status)}</td>
                      <td className={TD}>
                        {ob.penalty && <div>罰則:{ob.penalty}</div>}
                        {(ob.source_clause || ob.source_page) && <div>出處:契約 {ob.source_clause || ''} {ob.source_page || ''}</div>}
                        {ev && <div>佐證:{ev.submittal_no} {ev.title}({ev.status})</div>}
                        {!ob.penalty && !ob.source_clause && !ob.source_page && !ev && '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}

        <p className="mt-4 text-caption paper-mute">
          本表由 GovAgent 系統依契約基準日自動推算產出,供履約管理對照使用;各項內容與期限以契約原文為準。
          「無法推算」表示對應基準日尚未填寫。
        </p>
      </div>
    </div>
  )
}
