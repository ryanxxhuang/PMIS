// 監造查驗表單 A4 紙本(P3c;列印頁用):對齊常見公共工程監造查驗紀錄表(二級品管),印「已簽署版本」的內容(簽署列指向的版本,
// 不是畫面上可能較新的更正草稿);判定、本次確認數量與查驗項目結果優先取簽署落下的 inspections 列(DB fn_checklist_judge 算的
// results),沒有(草稿)才以前端預覽並整張標「草稿・未簽署」。頁首標示範範本(fn_field_document_template('inspection_form') 的
// demo_label 與免責聲明);文件短碼、版本號、內容雜湊前 12 碼、簽署者與伺服器時間走三張紙本共用的 DocumentPrintStamp。
// 純顯示、無 input;用色只走 .paper。
import { selfCheckValues, sourceLabel, INSPECTION_VERDICTS } from '../../lib/fieldDocs.js'
import { judgeChecklist } from '../../lib/qc.js'
import { DocumentPrintStamp } from './DocumentPrint.jsx'

const roc = (iso) => {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('-').map(Number)
  return `${y - 1911} 年 ${m} 月 ${d} 日`
}
const Th = ({ children, right, w }) => <th className={`border paper-rule px-1.5 py-1 font-medium text-footnote ${right ? 'text-right' : 'text-left'} ${w || ''}`}>{children}</th>
const Td = ({ children, right, center }) => <td className={`border paper-rule px-1.5 py-1 text-footnote ${right ? 'text-right tabular-nums' : center ? 'text-center' : ''}`}>{children}</td>
const qty = (v, unit) => (v == null || v === '' ? '—' : `${Number(v)} ${unit || ''}`.trim())

export default function InspectionFormSheet({ project, doc, version, signature = null, frame = null, inspection = null, checklistTemplate = null, byId = new Map(), className = '' }) {
  if (!doc || !version) return null
  const c = version.content || {}
  const s = version.field_sources || {}
  const items = Array.isArray(checklistTemplate?.items) ? checklistTemplate.items : []
  const signed = !!signature
  // 簽署落下的查驗列(判定、確認量、DB 算的項目結果)優先;草稿以內容與前端預覽,並明寫
  const fromRecord = signed && inspection && inspection.document_id === doc.id
  const verdict = fromRecord ? inspection.status : c.verdict
  const confirmed = fromRecord ? inspection.confirmed_qty : c.confirmed_qty
  const judged = fromRecord && inspection.results ? { results: inspection.results } : (checklistTemplate ? judgeChecklist(checklistTemplate, selfCheckValues(c)) : { results: {} })
  const wi = c.work_item_id ? byId.get(c.work_item_id) : null
  const unit = c.unit || wi?.unit || ''
  const naOf = (no) => (s[`results.${no}`]?.status === 'na' ? s[`results.${no}`].reason || '不適用' : null)
  let lastGroup = null
  return (
    <div className={`paper max-w-[210mm] mx-auto p-[12mm] print:p-[10mm] print:max-w-none text-body ${className}`}>
      <h1 className="text-center text-lg font-bold tracking-widest">監 造 查 驗 紀 錄 表</h1>
      <p className="text-center text-footnote paper-mute mt-0.5">（監造單位二級品管）</p>
      <div className="mt-1 text-center text-footnote paper-mute">
        {frame?.is_demo ? `【${frame.demo_label || '示範範本'}】` : ''}範本 {c.template?.key || frame?.key || '—'} v{c.template?.version ?? frame?.version ?? '—'}
      </div>
      {frame?.disclaimer && <p className="mt-1 text-caption paper-mute text-center">{frame.disclaimer}</p>}
      <DocumentPrintStamp doc={doc} version={version} signature={signature} draftNote="非正式紀錄；判定與確認數量尚未生效" className="mt-3" />

      <div className="mt-2 border paper-rule-strong text-body">
        <div className="grid grid-cols-2">
          <div className="px-2 py-1 border-b border-r paper-rule"><span className="paper-mute">工程名稱：</span>{project?.project_name || '（專案）'}</div>
          <div className="px-2 py-1 border-b paper-rule"><span className="paper-mute">查驗項目：</span>{inspection?.title || c.inspection_title || '—'}</div>
        </div>
        <div className="grid grid-cols-3">
          <div className="px-2 py-1 border-b border-r paper-rule"><span className="paper-mute">查驗日期：</span>{roc(c.inspection_date || doc.doc_date)}</div>
          <div className="px-2 py-1 border-b border-r paper-rule"><span className="paper-mute">申請日：</span>{inspection?.requested_date || '—'}</div>
          <div className="px-2 py-1 border-b paper-rule"><span className="paper-mute">類型：</span>{inspection?.inspection_type || '—'}</div>
        </div>
        <div className="px-2 py-1 border-b paper-rule"><span className="paper-mute">工項：</span>{wi ? `${wi.item_no || ''} ${wi.description || ''}`.trim() : c.work_item_id || '—'}</div>
        <div className="grid grid-cols-3">
          <div className="px-2 py-1 border-b border-r paper-rule"><span className="paper-mute">施作位置／批次：</span>{c.location || '—'}</div>
          <div className="px-2 py-1 border-b border-r paper-rule"><span className="paper-mute">查驗階段：</span>{c.stage_key || '（單階段）'}</div>
          <div className="px-2 py-1 border-b paper-rule"><span className="paper-mute">單位：</span>{unit || '—'}</div>
        </div>
        <div className="grid grid-cols-2">
          <div className="px-2 py-1 border-r paper-rule"><span className="paper-mute">申報數量：</span><span className="tabular-nums">{qty(c.declared_qty, unit)}</span></div>
          <div className="px-2 py-1"><span className="paper-mute">檢附自主檢查：</span>{c.self_check_record_id ? `紀錄 ${String(c.self_check_record_id).slice(0, 8)}` : '未檢附'}</div>
        </div>
      </div>

      {checklistTemplate && (
        <table className="w-full border-collapse mt-2">
          <thead>
            <tr>
              <Th w="w-12">項次</Th><Th>查驗項目（{checklistTemplate.title}）</Th><Th>查驗標準</Th><Th right w="w-24">實測值</Th><Th w="w-14">判定</Th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><Td>—</Td><Td>（範本沒有查驗項目）</Td><Td /><Td right /><Td center /></tr>}
            {items.map((it) => {
              const r = judged.results?.[it.no] || {}
              const value = r.value === undefined ? c.results?.[it.no]?.value : r.value
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
                  <Td right>{na ? <span className="paper-mute">不適用</span> : <>{value === true ? '✓' : value === false ? '✗' : value ?? ''}{typeof value === 'number' && it.unit ? ` ${it.unit}` : ''}</>}</Td>
                  <Td center>{na ? '／' : r.pass === true ? '○' : r.pass === false ? '✕' : '／'}</Td>
                </tr>,
              ]
            })}
          </tbody>
        </table>
      )}

      <div className={`border paper-rule-strong ${checklistTemplate ? 'border-t-0' : 'mt-2'} text-body px-2 py-1.5`}>
        <div>
          判定：
          {INSPECTION_VERDICTS.map((v) => <span key={v} className="mx-2">{verdict === v ? '■' : '□'} {v}</span>)}
          {!verdict && <span className="mx-2 paper-mute">（尚未判定）</span>}
        </div>
        <div className="mt-1 tabular-nums"><span className="paper-mute">本次確認數量：</span>{qty(confirmed, unit)}{c.declared_qty != null && confirmed != null ? <span className="paper-mute">（申報 {qty(c.declared_qty, unit)}；差額 {qty(Number(c.declared_qty) - Number(confirmed), unit)}）</span> : null}</div>
        {c.result_note && <div className="mt-1"><span className="paper-mute">判定說明：</span><span className="whitespace-pre-wrap">{c.result_note}</span></div>}
        {c.note && <div className="mt-1"><span className="paper-mute">備註：</span><span className="whitespace-pre-wrap">{c.note}</span></div>}
      </div>

      <div className="grid grid-cols-3 gap-6 mt-6 text-center text-body">
        <div><div className="border-t paper-rule-strong pt-1 mt-8">監造（簽署）{signed ? `：${signature.signer_name_snapshot || '—'}` : '：（未簽署）'}</div></div>
        <div><div className="border-t paper-rule-strong pt-1 mt-8">施工廠商（收件）</div></div>
        <div><div className="border-t paper-rule-strong pt-1 mt-8">機關（備查）</div></div>
      </div>
      <p className="text-caption paper-mute mt-4">
        ○＝合格&#x3000;✕＝不合格&#x3000;／＝本次未查或不適用。查驗項目判定由系統依範本量化標準產生{fromRecord ? '（簽署時伺服器計算）' : '（草稿為畫面預覽）'}；
        整體判定與本次確認數量由監造親自填寫，簽署後寫入監造確認紀錄成為估驗依據。來源標「{sourceLabel('inspection:x')}」的欄位由系統自查驗申請帶入。
        附件照片 {Array.isArray(version.attachments) ? version.attachments.length : 0} 張。
      </p>
    </div>
  )
}
