// 監造日誌 A4 紙本(P3a;列印頁用):印「已簽署版本」的內容(印的是簽署列指向的版本,不是畫面上可能較新的草稿),
// 頁首標示範範本(fn_field_document_template 的 demo_label 與免責聲明,不宣稱為機關公定格式);文件短碼、版本號、
// 內容雜湊前 12 碼、簽署者與伺服器時間走三張紙本共用的 DocumentPrintStamp;未簽署的草稿也能印,但整張明寫「草稿・未簽署」。
// 純顯示、無 input;用色只走 index.css 的 .paper／paper-*(紙面固定白底黑字)。
import { DOC_STATUS_LABEL, refTitle, sourceLabel, templateFields } from '../../lib/fieldDocs.js'
import { taipeiDateTime as fmtTs } from '../../lib/dates.js'
import { DocumentPrintStamp } from './DocumentPrint.jsx'

const roc = (iso) => {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('-').map(Number)
  return `${y - 1911} 年 ${m} 月 ${d} 日`
}
const Sec = ({ title, children }) => (
  <div className="border paper-rule-strong border-t-0">
    <div className="px-2 py-1 text-body font-bold paper-fill border-b paper-rule">{title}</div>
    <div className="px-2 py-1.5 text-body">{children}</div>
  </div>
)
const Val = ({ v }) => (v == null || v === '' ? <span className="paper-mute">（未填）</span> : <span className="whitespace-pre-wrap">{String(v)}</span>)
const SourceNote = ({ source }) => {
  if (!source) return null
  if (source.status === 'na') return <span className="paper-mute text-footnote">不適用：{source.reason || ''}</span>
  if (source.status === 'pending') return <span className="paper-mute text-footnote">待補</span>
  const from = sourceLabel(source.source)
  return from ? <span className="paper-mute text-footnote">來源：{from}{source.status === 'confirmed' ? '（已確認）' : ''}</span> : null
}

export default function SupervisorLogSheet({ project, doc, version, signature = null, template = null, lookups = {}, byId = new Map(), className = '' }) {
  if (!doc || !version) return null
  const c = version.content || {}
  const s = version.field_sources || {}
  const labels = Object.fromEntries(templateFields(template).map((f) => [f.key, f.label]))
  const L = (k, fallback) => labels[k] || fallback
  const rows = (v) => (Array.isArray(v) ? v : [])
  const wiLabel = (id) => { const w = byId.get(id); return w ? `${w.item_no || ''} ${w.description || ''}`.trim() : null }
  const receipt = c.daily_log_receipt && typeof c.daily_log_receipt === 'object' ? c.daily_log_receipt : null
  const signed = !!signature
  return (
    <div className={`paper max-w-[210mm] mx-auto p-[12mm] print:p-[10mm] print:max-w-none text-body ${className}`}>
      <div className="text-center">
        <div className="text-title2 font-bold tracking-wide">{project?.project_name || '（專案）'}</div>
        <div className="text-title3 font-bold mt-1">監造日誌</div>
        <div className="mt-1 text-footnote paper-mute">
          {template?.is_demo ? `【${template.demo_label || '示範範本'}】` : ''}範本 {c.template?.key || doc.template_key || template?.key || '—'} v{c.template?.version ?? template?.version ?? '—'}
        </div>
        {template?.disclaimer && <p className="mt-1 text-caption paper-mute">{template.disclaimer}</p>}
      </div>
      <DocumentPrintStamp doc={doc} version={version} signature={signature} className="mt-3" />

      <div className="mt-3 border paper-rule-strong">
        <div className="px-2 py-1.5 flex flex-wrap gap-x-6 gap-y-1">
          <span>{L('log_date', '日期')}：{roc(c.log_date || doc.doc_date)}（{c.log_date || doc.doc_date}）</span>
          <span>{L('weather_am', '天氣(上午)')}：<Val v={c.weather_am} /> <SourceNote source={s.weather_am} /></span>
          <span>{L('weather_pm', '天氣(下午)')}：<Val v={c.weather_pm} /> <SourceNote source={s.weather_pm} /></span>
        </div>
      </div>
      <Sec title={`二、監造到場人員`}>
        <div className="mb-0.5"><SourceNote source={s.attendance} /></div>
        {rows(c.attendance).length === 0 ? <span className="paper-mute">{s.attendance?.status === 'na' ? '' : '（未填）'}</span> : (
          <table className="w-full text-footnote">
            <thead><tr className="paper-fill"><th className="border paper-rule px-1.5 py-0.5 text-left font-medium">姓名</th><th className="border paper-rule px-1.5 py-0.5 text-left font-medium">到場</th><th className="border paper-rule px-1.5 py-0.5 text-left font-medium">離場</th></tr></thead>
            <tbody>{rows(c.attendance).map((r, i) => <tr key={i}><td className="border paper-rule px-1.5 py-0.5">{r.name || '—'}{r.user_id ? '（本案成員）' : ''}</td><td className="border paper-rule px-1.5 py-0.5 tabular-nums">{r.from || '—'}</td><td className="border paper-rule px-1.5 py-0.5 tabular-nums">{r.to || '—'}</td></tr>)}</tbody>
          </table>
        )}
      </Sec>
      <Sec title="三、監造事項（抽查、督導）">
        <div className="mb-0.5"><SourceNote source={s.supervision_items} /></div>
        {rows(c.supervision_items).length === 0 ? <span className="paper-mute">{s.supervision_items?.status === 'na' ? '' : '（未填）'}</span> : (
          <ol className="space-y-0.5 list-decimal pl-5">
            {rows(c.supervision_items).map((r, i) => (
              <li key={i}>
                <span className="tabular-nums paper-mute mr-1">{r.time || ''}</span>{r.item}
                {r.location ? `（${r.location}）` : ''}{r.work_item_id && wiLabel(r.work_item_id) ? `　工項：${wiLabel(r.work_item_id)}` : ''}
                {r.note ? <div className="text-footnote paper-mute whitespace-pre-wrap">{r.note}</div> : null}
                <div className="text-caption paper-mute">來源：{sourceLabel(r.source) || '人工填寫'}{Array.isArray(r.photo_ids) && r.photo_ids.length ? `・照片 ${r.photo_ids.length} 張` : ''}</div>
              </li>
            ))}
          </ol>
        )}
      </Sec>
      <Sec title="四、查驗情形">
        <div className="mb-0.5"><SourceNote source={s.inspection_ids} /></div>
        {rows(c.inspection_ids).length === 0 ? <span className="paper-mute">系統無當日查驗申請或判定紀錄</span> : (
          <ul className="list-disc pl-5">{rows(c.inspection_ids).map((id) => { const i = (lookups.inspections || []).find((x) => x.id === id); return <li key={id}>{i ? `${i.title || id}${i.status ? `（${i.status}）` : ''}${i.location ? ` ${i.location}` : ''}${i.result_note ? `：${i.result_note}` : ''}` : `查驗 ${String(id).slice(0, 8)}`}</li> })}</ul>
        )}
      </Sec>
      <Sec title="五、廠商施工情形">
        <div><Val v={c.contractor_summary} /> <SourceNote source={s.contractor_summary} /></div>
        <div className="mt-1 text-footnote paper-mute">
          {L('daily_log_receipt', '施工日誌收件情形')}：{receipt && receipt.status !== 'none'
            ? `${DOC_STATUS_LABEL[receipt.status] || receipt.status}・版本 ${receipt.version_no ?? '—'}・簽署 ${fmtTs(receipt.signed_at)}・提送 ${fmtTs(receipt.submitted_at)}・收件 ${fmtTs(receipt.received_at)}${receipt.returned_at ? `・退回 ${fmtTs(receipt.returned_at)}` : ''}`
            : receipt?.status === 'none' ? '當日無廠商施工日誌文件' : '（未帶入）'}
        </div>
      </Sec>
      <Sec title="六、通知／督導事項">
        <div className="mb-0.5"><SourceNote source={s.notices} /></div>
        {rows(c.notices).length === 0 ? <span className="paper-mute">{s.notices?.status === 'na' ? '' : '（未填）'}</span> : (
          <ol className="list-decimal pl-5">{rows(c.notices).map((n, i) => <li key={i}>致{n.to === 'owner' ? '機關' : '施工廠商'}：{n.content}{refTitle(n, lookups) ? `（${refTitle(n, lookups)}）` : ''}</li>)}</ol>
        )}
      </Sec>
      <Sec title="七、追蹤事項">
        <div className="mb-0.5"><SourceNote source={s.followups} /></div>
        {rows(c.followups).length === 0 ? <span className="paper-mute">{s.followups?.status === 'na' ? '' : '（未填）'}</span> : (
          <ol className="list-decimal pl-5">{rows(c.followups).map((f, i) => <li key={i}>{f.content}（{f.status === 'closed' ? '已結案' : '追蹤中'}）{refTitle(f, lookups) ? `（${refTitle(f, lookups)}）` : ''}</li>)}</ol>
        )}
      </Sec>
      <Sec title="八、備註"><Val v={c.note} /></Sec>
      <div className="mt-4 flex justify-between text-footnote">
        <span>監造簽署：{signed ? `${signature.signer_name_snapshot || '—'}（${fmtTs(signature.signed_at)}）` : '（未簽署）'}</span>
        <span className="paper-mute">附件照片 {rows(version.attachments).length} 張</span>
      </div>
    </div>
  )
}
