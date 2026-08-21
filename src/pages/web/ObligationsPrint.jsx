import { useMemo } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { computeObligationDue } from '../../lib/contractDue.js'

// W10 契約義務對照表——「可寄給對方」的輸出物。事務所/監造對機關、對廠商溝通時
// 需要一張紙:哪些義務、期限怎麼算、到期日、誰負責、現在狀態、契約出處。
// 不套 WebLayout,整頁即文件;工具列樣式與其他四支列印頁同一組 class
// (釘死亮色不吃主題 token,理由見 SiteLogPrint)。
const TOOLBAR_BTN = 'inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium max-md:min-h-11'
const TOOLBAR_PRIMARY = `${TOOLBAR_BTN} bg-[#0b57d0] text-white hover:bg-[#0842a0]`
const TOOLBAR_SECONDARY = `${TOOLBAR_BTN} bg-white text-[#0b57d0] border border-[#dadce0] hover:bg-[#e8f0fe]`

const PHASES = ['開工前', '施工中', '完工', '保固', '其他']
const ANCHOR_LABELS = [
  ['award_date', '決標日'], ['notice_date', '開工通知日'],
  ['commencement_date', '開工日'], ['end_date', '竣工日'],
]
const TRIGGER_LABEL = {
  award: '決標', notice: '接獲開工通知', commencement: '開工',
  completion: '完工', monthly: '每月', fixed: '指定日期', other: '其他',
}
const iso = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '')

function ruleText(ob) {
  if (ob.recurring === 'monthly') return `每月 ${ob.recurring_day || ''} 日${ob.offset_dir === 'before' ? '前' : ''}`.trim()
  if (ob.trigger_event === 'fixed') return `指定 ${ob.fixed_date || '日期'}`
  const t = TRIGGER_LABEL[ob.trigger_event] || ob.trigger_event || ''
  if (ob.offset_days) return `${t}${ob.offset_dir === 'before' ? '前' : '後'} ${ob.offset_days} 日內`
  return t
}

const TH = 'border border-slate-400 px-2 py-1 text-left font-medium bg-slate-100'
const TD = 'border border-slate-400 px-2 py-1 align-top'

export default function ObligationsPrint() {
  const { currentProject, obligations, currentUser, submittals } = useStore()
  const navigate = useNavigate()

  const anchors = useMemo(() => ({
    award_date: currentProject?.award_date || '',
    notice_date: currentProject?.notice_date || '',
    commencement_date: currentProject?.commencement_date || '',
    end_date: currentProject?.end_date || '',
  }), [currentProject])

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
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
  // 「漏了什麼」也要進報告:缺基準日而算不出到期日的義務,寄出去的表上必須看得到
  const nodateCount = rows.filter((r) => !r.done && !r.due).length
  const missingAnchors = ANCHOR_LABELS.filter(([k]) => !anchors[k]).map(([, label]) => label)
  const overdueCount = rows.filter((r) => r.overdue).length

  if (!currentUser) return <Navigate to="/login" replace />
  if (!obligations.length) {
    return (
      <div className="p-10 text-center text-slate-400">
        尚無契約義務。<button onClick={() => navigate('/contract')} className="text-[var(--blue-text)] underline">返回專案文件</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white py-6 print:py-0">
      {/* 工具列(列印時隱藏)*/}
      <div className="max-w-[210mm] mx-auto mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden px-1">
        <button onClick={() => navigate('/contract')} className={TOOLBAR_SECONDARY}>← 返回專案文件</button>
        <button onClick={() => window.print()} className={TOOLBAR_PRIMARY}>
          <MSym name="print" size={15} />列印 / 存 PDF
        </button>
      </div>

      {/* A4 文件本體:紙面永遠白底黑字,不吃主題 token */}
      <div className="max-w-[210mm] mx-auto bg-white text-slate-900 shadow print:shadow-none px-[14mm] py-[12mm] text-[12px] leading-relaxed">
        <h1 className="text-center text-lg font-bold">契約義務對照表</h1>
        <div className="text-center text-slate-500 mt-0.5">產出日期:{iso(today)}</div>

        <table className="w-full mt-3 border-collapse">
          <tbody>
            <tr>
              <td className={`${TD} w-24 bg-slate-100`}>工程名稱</td>
              <td className={TD} colSpan={3}>{currentProject?.project_name || '—'}</td>
            </tr>
            <tr>
              <td className={`${TD} bg-slate-100`}>機關</td>
              <td className={TD}>{currentProject?.owner_name || '—'}</td>
              <td className={`${TD} w-24 bg-slate-100`}>監造單位</td>
              <td className={TD}>{currentProject?.supervisor_name || '—'}</td>
            </tr>
            <tr>
              <td className={`${TD} bg-slate-100`}>施工廠商</td>
              <td className={TD}>{currentProject?.contractor_name || '—'}</td>
              <td className={`${TD} bg-slate-100`}>契約價金總額</td>
              <td className={TD}>{currentProject?.contract_total ? `NT$ ${Number(currentProject.contract_total).toLocaleString('en-US')}` : '—'}</td>
            </tr>
            <tr>
              <td className={`${TD} bg-slate-100`}>基準日</td>
              <td className={TD} colSpan={3}>
                {ANCHOR_LABELS.map(([k, label]) => `${label} ${anchors[k] || '未填'}`).join('・')}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-2 text-slate-600">
          合計 {rows.length} 項義務;已完成/已提送 {rows.filter((r) => r.done).length} 項、
          已逾期 {overdueCount} 項、無法推算到期日 {nodateCount} 項。
          {missingAnchors.length > 0 && (
            <span className="text-slate-900 font-medium">
              (注意:{missingAnchors.join('、')}未填,相關義務的到期日無法推算)
            </span>
          )}
        </div>

        {groups.map((g) => (
          <div key={g.ph} className="mt-4 break-inside-avoid-page">
            <h2 className="font-bold text-[13px] mb-1">{g.ph}({g.list.length} 項)</h2>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${TH} w-[30%]`}>義務事項</th>
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
                      <td className={TD}>{ruleText(ob)}</td>
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

        <p className="mt-4 text-[11px] text-slate-500">
          本表由 PMIS 系統依契約基準日自動推算產出,供履約管理對照使用;義務內容與期限以契約原文為準。
          「無法推算」表示對應基準日尚未填寫。
        </p>
      </div>
    </div>
  )
}
