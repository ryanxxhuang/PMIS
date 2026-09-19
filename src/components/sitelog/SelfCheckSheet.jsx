// 自主檢查表 A4 紙本(P3b;列印頁用):對齊公共工程自主檢查表通行格式(與 ChecklistPrint 同一版面語言),印「已簽署版本」
// 的內容(簽署列指向的版本,不是畫面上可能較新的草稿);逐項判定與整表結果優先取簽署落下的 checklist_records 列
// (DB fn_checklist_judge 算的),沒有(草稿)才以前端 judgeChecklist 預覽並整張標「草稿・未簽署」。
// 頁首標示範框架範本(fn_field_document_template('self_check') 的 demo_label 與免責聲明)、文件短碼、版本號、
// 內容雜湊前 12 碼、簽署者與伺服器時間(三張紙本共用 DocumentPrintStamp);修訂版次(Rev.N)與更正原因來自 checklist_records。
// 純顯示、無 input;用色只走 .paper。
import { selfCheckValues, sourceLabel } from '../../lib/fieldDocs.js'
import { judgeChecklist } from '../../lib/qc.js'
import { taipeiDateTime as fmtTs } from '../../lib/dates.js'
import { DocumentPrintStamp } from './DocumentPrint.jsx'

const roc = (iso) => {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('-').map(Number)
  return `${y - 1911} 年 ${m} 月 ${d} 日`
}
const Th = ({ children, right, w }) => <th className={`border paper-rule px-1.5 py-1 font-medium text-footnote ${right ? 'text-right' : 'text-left'} ${w || ''}`}>{children}</th>
const Td = ({ children, right, center }) => <td className={`border paper-rule px-1.5 py-1 text-footnote ${right ? 'text-right tabular-nums' : center ? 'text-center' : ''}`}>{children}</td>

export default function SelfCheckSheet({ project, doc, version, signature = null, frame = null, checklistTemplate = null, record = null, byId = new Map(), className = '' }) {
  if (!doc || !version) return null
  const c = version.content || {}
  const s = version.field_sources || {}
  const items = Array.isArray(checklistTemplate?.items) ? checklistTemplate.items : []
  const signed = !!signature
  // 判定:簽署落下的事實列(DB 算)優先;草稿以前端預覽,並明寫
  const judged = record?.results ? { results: record.results, overall: record.overall ?? null } : (checklistTemplate ? judgeChecklist(checklistTemplate, selfCheckValues(c)) : { results: {}, overall: null })
  const wi = c.work_item_id ? byId.get(c.work_item_id) : null
  const naOf = (no) => (s[`results.${no}`]?.status === 'na' ? s[`results.${no}`].reason || '不適用' : null)
  let lastGroup = null
  return (
    <div className={`paper max-w-[210mm] mx-auto p-[12mm] print:p-[10mm] print:max-w-none text-body ${className}`}>
      <h1 className="text-center text-lg font-bold tracking-widest">自 主 檢 查 表</h1>
      <p className="text-center text-footnote paper-mute mt-0.5">（承攬廠商一級品管）{record && (record.rev || 0) > 0 && <span className="ml-2 font-semibold paper-ink">修訂版次 Rev.{record.rev}</span>}</p>
      <div className="mt-1 text-center text-footnote paper-mute">
        {frame?.is_demo ? `【${frame.demo_label || '示範範本'}】` : ''}框架 {c.template?.key || frame?.key || '—'} v{c.template?.version ?? frame?.version ?? '—'}
      </div>
      {frame?.disclaimer && <p className="mt-1 text-caption paper-mute text-center">{frame.disclaimer}</p>}
      <DocumentPrintStamp doc={doc} version={version} signature={signature} draftNote="非正式紀錄；判定為畫面預覽" className="mt-3" />

      <div className="mt-2 border paper-rule-strong text-body">
        <div className="grid grid-cols-2">
          <div className="px-2 py-1 border-b border-r paper-rule"><span className="paper-mute">工程名稱：</span>{project?.project_name || '（專案）'}</div>
          <div className="px-2 py-1 border-b paper-rule"><span className="paper-mute">檢查表：</span>{checklistTemplate?.title || c.template_title || '—'}</div>
        </div>
        <div className="grid grid-cols-3">
          <div className="px-2 py-1 border-r paper-rule"><span className="paper-mute">檢查日期：</span>{roc(c.check_date || doc.doc_date)}</div>
          <div className="px-2 py-1 border-r paper-rule"><span className="paper-mute">檢查位置：</span>{c.location || '—'}{s.location?.status === 'na' ? `（不適用：${s.location.reason || ''}）` : ''}</div>
          <div className="px-2 py-1"><span className="paper-mute">依據：</span>{checklistTemplate?.source || c.template_source || '—'}</div>
        </div>
        <div className="px-2 py-1 border-t paper-rule"><span className="paper-mute">對應工項：</span>{wi ? `${wi.item_no || ''} ${wi.description || ''}`.trim() : '—'}</div>
        {record && (record.rev || 0) > 0 && (
          <div className="px-2 py-1 border-t paper-rule"><span className="paper-mute">更正原因（Rev.{record.rev}）：</span>{record.revision_reason || '—'}</div>
        )}
      </div>

      <table className="w-full border-collapse mt-2">
        <thead>
          <tr>
            <Th w="w-12">項次</Th><Th>檢查項目</Th><Th>檢查標準</Th><Th right w="w-24">實測值</Th><Th w="w-14">判定</Th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && <tr><Td>—</Td><Td>（範本沒有檢查項目）</Td><Td /><Td right /><Td center /></tr>}
          {items.map((it) => {
            const r = judged.results?.[it.no] || {}
            const na = naOf(it.no)
            const groupRow = it.group !== lastGroup
            lastGroup = it.group
            return [
              groupRow && it.group && (
                <tr key={`g-${it.group}`}><td colSpan={5} className="border paper-rule paper-fill px-1.5 py-0.5 text-footnote font-bold">{it.group}</td></tr>
              ),
              <tr key={it.no}>
                <Td center>{it.no}</Td>
                <Td>{it.item}</Td>
                <Td>{it.standard}{it.source ? <span className="paper-mute">（{it.source}）</span> : ''}</Td>
                <Td right>{na ? <span className="paper-mute">不適用</span> : <>{r.value === true ? '✓' : r.value === false ? '✗' : r.value ?? ''}{typeof r.value === 'number' && it.unit ? ` ${it.unit}` : ''}</>}</Td>
                <Td center>{na ? '／' : r.pass === true ? '○' : r.pass === false ? '✕' : '／'}</Td>
              </tr>,
            ]
          })}
        </tbody>
      </table>

      <div className="border paper-rule-strong border-t-0 text-body px-2 py-1.5">
        檢查結果：
        <span className="mx-2">{judged.overall === '合格' ? '■' : '□'} 全部合格</span>
        <span className="mx-2">{judged.overall === '不合格' ? '■' : '□'} 有缺失（系統已自動開立缺失單追蹤改善）</span>
        {!judged.overall && <span className="mx-2 paper-mute">（尚無已檢項目／全部不適用）</span>}
        {c.note && <div className="mt-1"><span className="paper-mute">備註：</span>{c.note}</div>}
      </div>

      <div className="grid grid-cols-2 gap-10 mt-6 text-center text-body">
        <div><div className="border-t paper-rule-strong pt-1 mt-8">檢查人員（簽署）{signed ? `：${signature.signer_name_snapshot || '—'}（${fmtTs(signature.signed_at)}）` : '：（未簽署）'}</div></div>
        <div><div className="border-t paper-rule-strong pt-1 mt-8">工地主任（簽章）</div></div>
      </div>
      <p className="text-caption paper-mute mt-4">
        ○＝合格&#x3000;✕＝不合格&#x3000;／＝本次未檢查或不適用。判定由系統依範本量化標準自動產生{record ? '（簽署時伺服器計算）' : '（草稿為畫面預覽）'}。
        來源標「{sourceLabel('ai:photo')}」的欄位由系統依照片帶入；實測值一律由廠商親自量測填寫。附件照片 {Array.isArray(version.attachments) ? version.attachments.length : 0} 張。
      </p>
    </div>
  )
}
