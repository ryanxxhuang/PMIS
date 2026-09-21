// 監造查驗紀錄表 A4 紙本(版面參考臺北市政府「施工抽查紀錄表」公開格式參考範例)。
// 2026-09-20 C2 包:這張紙同時是**監造的編輯畫面**——給了 edit context 就在原表的格子裡長出輸入框
// (哪一格誰可編由 lib/officialForms 的 mapping 決定,這份的可編角色是監造不是廠商),沒給就是純文字
// (列印頁／唯讀視角;唯讀的 e2e 契約:頁上不得出現 input)。畫面與列印／PDF 因此共用同一份欄位 mapping。
//
// 版面參考與工程技術標準分開(驗收指令 C):
//   * 版面、欄名、符號說明與表尾註記取自臺北市公開格式參考範例;範例檔裡的示例數值(保護層 4cm／4.5cm／3.8cm)、
//     「良好範例」「不良範例」的判定文字、示例工程名與假公司名**一律不入產品**;
//   * 抽查項目與抽查標準只取本案核定的查驗表範本(content.template_id → checklist_templates,用途=監造查驗),
//     沒有範本就依判定欄簽署,不引用任何示例標準。
//
// 格內編輯**不放寬任何伺服器驗證**:判定與本次確認數量仍然只有監造能填、簽署時由
// field_document_sign_inspection_form_internal 驗(單位一致、階段在必要階段內、申報量上限、判定與數量一致、
// 同查驗已有有效確認須先撤銷);畫面上的 inspectionFormIssues 只是同一條規則的即時預覽,伺服器為準。
// 抽查結果(○／╳／／)是系統算的,不是人填的:簽署落下的 inspections.results(DB fn_checklist_judge)優先,
// 草稿以 lib/qc.judgeChecklist 預覽並標明。
import { Link } from 'react-router-dom'
import { MSym } from '../icons.jsx'
import {
  selfCheckValues, sourceLabel, fieldAnchorId, setFieldValue, setInspectionFormTemplate,
  INSPECTION_VERDICTS, inspectionFormIssues,
} from '../../lib/fieldDocs.js'
import { judgeChecklist, judgeItem } from '../../lib/qc.js'
import { taipeiDateTime as fmtTs } from '../../lib/dates.js'
import {
  templateCaption, formTemplateOf, rocDateText, templateOf, canEditForm,
  INSPECTION_TIMINGS, SELF_CHECK_RECHECK_RESULTS,
} from '../../lib/officialForms.js'
import { DocumentPrintStamp } from './DocumentPrint.jsx'
import { PaperFormProvider, PaperInput, FieldMark, MeasuredCell, usePaperForm } from './PaperCell.jsx'

const Th = ({ children, right, w }) => <th className={`border paper-rule px-1.5 py-1 font-medium text-footnote ${right ? 'text-right' : 'text-left'} ${w || ''}`}>{children}</th>
const Td = ({ children, right, center, colSpan, className = '' }) => <td colSpan={colSpan} className={`border paper-rule px-1.5 py-1 text-footnote align-top ${right ? 'text-right tabular-nums' : center ? 'text-center' : ''} ${className}`}>{children}</td>
const HeadCell = ({ label, children, className = '', id }) => (
  <div id={id} className={`px-2 py-1 paper-rule ${className}`}><span className="paper-mute">{label}</span>{children}</div>
)
const qty = (v, unit) => (v == null || v === '' || Number.isNaN(Number(v)) ? '—' : `${Number(v)} ${unit || ''}`.trim())

export default function InspectionFormSheet({
  project, doc = null, version = null, content: contentProp = null, sources: sourcesProp = null, signature = null,
  frame = null, inspection = null, checklistTemplates = [], checklistTemplate = null, byId = new Map(), workItem = null,
  requiredStages = [], batchCum = null, selfCheckDoc = null,
  edit = null, stamp = undefined, titleAs: Title = 'h1', className = '',
}) {
  const content = contentProp || version?.content || null
  const sources = sourcesProp || version?.field_sources || {}
  if (!content) return null
  const canEdit = !!edit?.editable && canEditForm('inspection_form', edit.org || 'supervisor')
  const items = Array.isArray(checklistTemplate?.items) ? checklistTemplate.items : []
  const values = selfCheckValues(content)
  const signed = !!signature
  // 簽署落下的查驗列(判定、確認量、DB 算的項目結果)優先;草稿以內容與前端預覽,並明寫
  const fromRecord = signed && inspection && inspection.document_id === doc?.id
  const verdict = fromRecord ? inspection.status : content.verdict
  const confirmed = fromRecord ? inspection.confirmed_qty : content.confirmed_qty
  const preview = checklistTemplate ? judgeChecklist(checklistTemplate, values) : null
  const judged = fromRecord && inspection.results ? { results: inspection.results } : (preview || { results: {} })
  // 工項:呼叫端解析過的優先(示範種子以項次對回末端工項),否則以內容的 work_item_id 查標單
  const wi = workItem || (content.work_item_id ? byId.get(content.work_item_id) : null) || null
  const unit = content.unit || wi?.unit || ''
  const declared = content.declared_qty == null ? null : Number(content.declared_qty)
  const confirmedNum = confirmed == null ? null : Number(confirmed)
  const afterCum = batchCum != null && confirmedNum != null && Number.isFinite(confirmedNum) ? batchCum + confirmedNum : null
  const consistency = canEdit ? inspectionFormIssues(content, { workItem: wi, requiredStages, judged: preview }) : []
  const tpl = templateOf('inspection_form')
  const stamped = formTemplateOf(content, 'inspection_form')
  const subproject = String(content.subproject_name || '').trim()
  let lastGroup = null

  const body = (
    <div className={`paper max-w-[210mm] mx-auto p-[12mm] print:p-[10mm] print:max-w-none text-body ${className}`}>
      <Title className="text-center text-lg font-bold tracking-widest">{subproject ? `${subproject} ` : ''}施 工 抽 查 紀 錄 表</Title>
      <p className="text-center text-footnote paper-mute mt-0.5">（監造單位二級品管）</p>
      <p className="text-center text-caption paper-mute mt-0.5">
        {templateCaption('inspection_form')}
        {!stamped?.current && stamped?.key ? `・本文件建立時使用 ${stamped.key} v${stamped.version}` : ''}
        {frame?.is_demo ? `・框架【${frame.demo_label || '示範範本'}】${frame.key} v${frame.version ?? 1}` : ''}
      </p>
      {stamp !== undefined ? stamp : (doc && <DocumentPrintStamp doc={doc} version={version} signature={signature} draftNote="非正式紀錄；判定與確認數量尚未生效" className="mt-3" />)}

      {/* 編號(原表在表格左上外側) */}
      <div className="mt-2 flex items-baseline gap-1 text-footnote">
        <span className="paper-mute">編號：</span>
        <span className="inline-block min-w-[8rem] border-b paper-rule"><PaperInput fieldKey="doc_no" label="編號" /></span>
        <FieldMark fieldKey="doc_no" title="編號" />
      </div>

      {/* 表頭(原表:工程名稱／承攬廠商／分項工程名稱／抽查位置／檢查日期／抽查時機／符號說明) */}
      <div className="mt-1 border paper-rule-strong text-footnote">
        <div className="grid grid-cols-2">
          <HeadCell label="工程名稱：" className="border-b border-r">{project?.project_name || <span className="paper-warn">待補</span>}</HeadCell>
          <HeadCell label="承攬廠商：" className="border-b">{project?.contractor_name || <span className="paper-warn">待補（至專案設定補）</span>}</HeadCell>
        </div>
        <div className="grid grid-cols-2">
          <HeadCell label="分項工程名稱：" className="border-b border-r" id={fieldAnchorId('subproject_name')}>
            <PaperInput fieldKey="subproject_name" label="分項工程名稱" placeholder="如 鋼筋工程" />
            <FieldMark fieldKey="subproject_name" title="分項工程名稱" className="ml-1" />
          </HeadCell>
          <HeadCell label="檢查日期：" className="border-b">{rocDateText(content.inspection_date || doc?.doc_date)}</HeadCell>
        </div>
        <div className="grid grid-cols-2">
          <HeadCell label="抽查位置：" className="border-b border-r" id={fieldAnchorId('location')}>
            <PaperInput fieldKey="location" label="抽查位置" placeholder="如 3F 版牆" />
            <FieldMark fieldKey="location" title="抽查位置" />
            {canEdit && <span className="print:hidden block paper-mute text-micro">本次確認數量以此位置為批次累計，確認前不能簽署。</span>}
          </HeadCell>
          <HeadCell label="抽查時機：" className="border-b" id={fieldAnchorId('check_timing')}>
            <PaperInput fieldKey="check_timing" label="抽查時機"
              options={[{ value: '', label: '（未選）' }, ...INSPECTION_TIMINGS.map((t) => ({ value: t, label: t }))]}
              readOnlyText={INSPECTION_TIMINGS.map((t) => `${content.check_timing === t ? '■' : '□'} ${t}`).join('  ')} />
            <FieldMark fieldKey="check_timing" title="抽查時機" className="ml-1" />
          </HeadCell>
        </div>
        <HeadCell label="抽查結果符號說明：">○ 檢查合格&#x3000;╳ 有缺失需改正&#x3000;／ 無此檢查項目</HeadCell>
      </div>

      {/* 抽查項目(原表五欄;項次由範本帶出) */}
      <table className="w-full border-collapse mt-2">
        <thead>
          <tr>
            <Th w="w-10">項次</Th>
            <Th>抽查項目</Th>
            <Th>設計圖說、規範之抽查標準（定性定量）</Th>
            <Th w="w-32">實際抽查情形（載明抽查數值及單位）</Th>
            <Th w="w-14">抽查結果</Th>
            <Th w="w-24">備註</Th>
          </tr>
        </thead>
        <tbody>
          {!checklistTemplate && (
            <tr><Td /><Td colSpan={5}><span className="paper-warn">未使用本案查驗表範本：抽查項目與抽查標準由範本帶出；未選範本時依下方判定欄簽署。</span></Td></tr>
          )}
          {checklistTemplate && items.length === 0 && (
            <tr><Td /><Td colSpan={5}><span className="paper-warn">範本「{checklistTemplate.title}」沒有任何抽查項目，無法判定；請換一張範本或不使用範本。</span></Td></tr>
          )}
          {items.map((it) => {
            const key = `results.${it.no}`
            const src = sources?.[key]
            const isNa = src?.status === 'na'
            const r = judged.results?.[it.no] || {}
            // 簽署後以查驗列(DB 算、含分列讀數)為準;草稿以內容為準
            const res = fromRecord && inspection.results ? r : content.results?.[it.no]
            const pass = fromRecord && inspection.results ? r.pass : judgeItem(it, values[it.no])
            const groupRow = it.group !== lastGroup
            lastGroup = it.group
            const title = `${it.no} ${it.item}`
            return [
              groupRow && it.group && (
                <tr key={`g-${it.group}`}><td colSpan={6} className="border paper-rule paper-fill px-1.5 py-0.5 text-footnote font-bold">{it.group}</td></tr>
              ),
              <tr key={it.no} id={fieldAnchorId(key)}>
                <Td center>{it.no}</Td>
                <Td>{it.item}</Td>
                <Td>{it.standard}{it.source ? <span className="paper-mute">（{it.source}）</span> : ''}</Td>
                <Td right>
                  {isNa ? <span className="paper-mute">不適用</span> : <ResultCell it={it} result={res} title={title} canEdit={canEdit} />}
                  <FieldMark fieldKey={key} title={title} allowNa naLabel="不適用" className="justify-end" />
                </Td>
                <Td center>{isNa ? '／' : pass === true ? '○' : pass === false ? '╳' : '／'}</Td>
                <Td><PaperInput fieldKey={`${key}.note`} label={`${title} 備註`} /></Td>
              </tr>,
            ]
          })}
        </tbody>
      </table>

      <VerdictSection
        canEdit={canEdit} verdict={verdict} unit={unit} declared={declared} confirmed={confirmedNum}
        batchCum={batchCum} afterCum={afterCum} content={content} consistency={consistency} />

      {/* 表尾:缺失複查(原表) */}
      <div className="border paper-rule-strong border-t-0 text-footnote px-2 py-1.5 space-y-1">
        <div className="flex items-baseline gap-1 flex-wrap" id={fieldAnchorId('recheck_result')}>
          <span className="paper-mute">缺失複查結果：</span>
          <PaperInput fieldKey="recheck_result" label="缺失複查結果" className="!w-auto"
            options={[{ value: '', label: '（未複查）' }, ...SELF_CHECK_RECHECK_RESULTS.map((t) => ({ value: t, label: t }))]}
            readOnlyText={SELF_CHECK_RECHECK_RESULTS.map((t) => `${content.recheck_result === t ? '■' : '□'} ${t}`).join('  ')} />
          <FieldMark fieldKey="recheck_result" title="缺失複查結果" />
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="inline-flex items-baseline gap-1"><span className="paper-mute">複查日期：</span>
            <span className="inline-block min-w-[8rem] border-b paper-rule"><PaperInput fieldKey="recheck_date" label="複查日期" type="date" /></span></span>
          <span className="inline-flex items-baseline gap-1"><span className="paper-mute">複查人員職稱：</span>
            <span className="inline-block min-w-[8rem] border-b paper-rule"><PaperInput fieldKey="recheck_role" label="複查人員職稱" /></span></span>
          <span className="paper-mute">簽名：<span className="inline-block min-w-[8rem] border-b paper-rule">&nbsp;</span>（紙本手簽）</span>
        </div>
        <div className="flex items-baseline gap-1" id={fieldAnchorId('note')}>
          <span className="paper-mute shrink-0">備註：</span>
          <span className="inline-block flex-1 border-b paper-rule"><PaperInput fieldKey="note" label="備註" /></span>
          <FieldMark fieldKey="note" title="備註" />
        </div>
      </div>

      <SystemFieldsSection
        content={content} sources={sources} canEdit={canEdit} unit={unit} wi={wi} inspection={inspection}
        requiredStages={requiredStages} checklistTemplates={checklistTemplates} checklistTemplate={checklistTemplate}
        selfCheckDoc={selfCheckDoc} edit={edit} declared={declared} />

      {/* 簽章:原表為監造單位派駐現場人員簽名＋監造主管簽名 */}
      <div className="grid grid-cols-2 gap-10 mt-6 text-center text-body">
        <div><div className="border-t paper-rule-strong pt-1 mt-8">監造單位派駐現場人員（簽署）{signed ? `：${signature.signer_name_snapshot || '—'}（${fmtTs(signature.signed_at)}）` : '：（未簽署）'}</div></div>
        <div><div className="border-t paper-rule-strong pt-1 mt-8">監造主管（簽章）</div></div>
      </div>

      <p className="text-caption paper-mute mt-4 leading-relaxed">
        {tpl?.disclaimer}
        <br />備註：1. 抽查結果合格者註明「○」，不合格者註明「╳」，如無需檢查之項目則打「／」。
        2. 抽查標準及實際抽查情形應依設計圖說、規範及實際檢查情形，具體敘述量化之數值及單位。
        3. 嚴重缺失、缺失複查未能及時完成改善者，應填具「不合格品管制表」進行追蹤改善，本表單可先行存檔。
        4. 本表由監造單位派駐現場人員實地抽查後覈實記載簽認。
        <br />抽查結果由系統依範本量化標準計算{fromRecord ? '（簽署時由伺服器計算並落為查驗紀錄）' : '（草稿為畫面預覽）'}；
        判定與本次確認數量由監造親自填寫，簽署後寫入監造確認紀錄成為廠商可估驗的依據。
        來源標「{sourceLabel('inspection:x')}」的欄位由系統自查驗申請帶入，標「{sourceLabel('record:x')}」的實測值由系統照紙本實測欄原文抄錄並標待確認，簽署前都須逐項確認。
        原表的「監造主管簽名」欄本輪未實作第二簽署人，維持紙本手簽。
        附件照片 {Array.isArray(version?.attachments) ? version.attachments.length : 0} 張。
      </p>
    </div>
  )

  return (
    <PaperFormProvider value={{
      docType: 'inspection_form', org: edit?.org || 'supervisor', state: { content, sources: sources || {} },
      onChange: edit?.onChange, editable: !!edit?.editable, showMarks: !!edit,
      issues: edit?.issues || new Map(), photosById: edit?.photosById || new Map(),
    }}>{body}</PaperFormProvider>
  )
}

// 實際抽查情形:數值項給數字框＋單位,勾選項給合格／不合格;系統永遠不代為量測
function ResultCell({ it, result, title, canEdit }) {
  const ctx = usePaperForm()
  const value = result?.value ?? null
  if (it.kind === 'bool') {
    const set = (v) => ctx?.onChange?.(setFieldValue(ctx.state, `results.${it.no}`, v))
    if (!canEdit) return <span>{value === true ? '合格' : value === false ? '不合格' : ''}</span>
    return (
      <span className="inline-flex items-center gap-2 justify-end">
        <label className="inline-flex items-center gap-1"><input type="checkbox" className="w-4 h-4" aria-label={`${title} 合格`} checked={value === true} onChange={(e) => set(e.target.checked ? true : null)} />合格</label>
        <label className="inline-flex items-center gap-1"><input type="checkbox" className="w-4 h-4" aria-label={`${title} 不合格`} checked={value === false} onChange={(e) => set(e.target.checked ? false : null)} />不合格</label>
      </span>
    )
  }
  return <MeasuredCell it={it} result={result} title={title} canEdit={canEdit} label="實際抽查情形" />
}

// 判定與本次確認數量(原表沒有這兩格:本系統為了把監造確認量接到計價而加,紙上明寫)。
// 只有監造能填;伺服器簽署時以同一條規則再驗一次為準,格內編輯不放寬任何規則。
function VerdictSection({ canEdit, verdict, unit, declared, confirmed, batchCum, afterCum, content, consistency }) {
  const ctx = usePaperForm()
  const set = (key, v) => ctx?.onChange?.(setFieldValue(ctx.state, key, v))
  return (
    <div className="border paper-rule-strong border-t-0 text-footnote px-2 py-1.5 space-y-1.5">
      <div className="paper-mute">（本系統欄位，非原表欄位）監造判定與本次確認數量</div>
      <div id={fieldAnchorId('verdict')}>
        <span className="paper-mute">判定：</span>
        {canEdit ? (
          <span role="radiogroup" aria-label="判定" className="inline-flex items-center gap-3 flex-wrap ml-1">
            {INSPECTION_VERDICTS.map((v) => (
              <label key={v} className="inline-flex items-center gap-1 max-md:min-h-11">
                <input type="radio" name="verdict" value={v} checked={content.verdict === v} onChange={() => set('verdict', v)} aria-label={v} />
                {v}
              </label>
            ))}
          </span>
        ) : (
          <>
            {INSPECTION_VERDICTS.map((v) => <span key={v} className="mx-2">{verdict === v ? '■' : '□'} {v}</span>)}
            {!verdict && <span className="mx-2 paper-mute">（尚未判定）</span>}
          </>
        )}
        <FieldMark fieldKey="verdict" title="判定" className="ml-2" />
      </div>
      <div role="group" aria-label="確認數量" id={fieldAnchorId('confirmed_qty')} className="border paper-rule px-2 py-1">
        <dl className="grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-1">
          <div><dt className="paper-mute">申報數量</dt><dd className="tabular-nums">{qty(declared, unit)}</dd></div>
          <div><dt className="paper-mute">單位</dt><dd>{unit || '—'}</dd></div>
          <div><dt className="paper-mute">此批次已確認累計</dt><dd className="tabular-nums">{batchCum == null ? '—' : qty(batchCum, unit)}</dd></div>
          <div>
            <dt className="paper-mute">本次確認</dt>
            <dd>
              <PaperInput fieldKey="confirmed_qty" label="本次確認數量" type="number" align="right" min={0} max={declared ?? null}
                className="!w-24" readOnlyText={qty(confirmed, unit)} />
            </dd>
          </div>
          <div><dt className="paper-mute">簽署後累計</dt><dd className="tabular-nums">{afterCum == null ? '—' : qty(afterCum, unit)}</dd></div>
        </dl>
        <FieldMark fieldKey="confirmed_qty" title="本次確認數量" />
        {canEdit && (
          <p className="print:hidden mt-1 text-micro paper-warn">
            <MSym name="info" size={11} className="inline -mt-0.5" /> 簽署後本次確認數量會寫入監造確認紀錄，成為廠商可估驗的依據（不得超過申報數量；不合格填 0）。
          </p>
        )}
      </div>
      <div className="flex items-baseline gap-1" id={fieldAnchorId('result_note')}>
        <span className="paper-mute shrink-0">判定說明：</span>
        <span className="inline-block flex-1 border-b paper-rule">
          <PaperInput fieldKey="result_note" label="判定說明" placeholder="不合格／部分合格必填：不合格原因與待改善事項（作為缺失說明）" />
        </span>
        <FieldMark fieldKey="result_note" title="判定說明" />
      </div>
      {consistency.length > 0 && (
        <ul role="alert" aria-label="判定與確認數量檢查" className="print:hidden text-micro paper-warn space-y-0.5">
          {consistency.map((i) => <li key={`${i.key}-${i.message}`}>{i.message}</li>)}
        </ul>
      )}
    </div>
  )
}

// 原表沒有、本系統為了把查驗接到標單與計價而加的格:一律標「本系統欄位」,並說明為什麼在這裡。
function SystemFieldsSection({
  content, sources, canEdit, unit, wi, inspection, requiredStages, checklistTemplates, checklistTemplate, selfCheckDoc, edit, declared,
}) {
  const ctx = usePaperForm()
  const set = (key, v) => ctx?.onChange?.(setFieldValue(ctx.state, key, v))
  const changeTemplate = (id) => {
    const t = id ? (checklistTemplates || []).find((x) => x.id === id) || null : null
    if (edit?.onTemplateChange) { edit.onTemplateChange(id); return }
    ctx?.onChange?.(setInspectionFormTemplate(ctx.state, t))
  }
  return (
    <div className="border paper-rule-strong border-t-0 text-footnote px-2 py-1.5 space-y-1">
      <div className="paper-mute">（本系統欄位，非原表欄位）查驗申請與標單對應</div>
      <div className="grid md:grid-cols-2 gap-x-4 gap-y-1">
        <div id={fieldAnchorId('inspection_id')}>
          <span className="paper-mute">查驗申請：</span>
          {inspection
            ? <Link to={`/quality?seg=inspections&inspection=${encodeURIComponent(inspection.id)}`} className="text-[var(--blue-text)] hover:underline print:text-inherit print:no-underline">{inspection.title}</Link>
            : (content.inspection_title || content.inspection_id || '—')}
          {inspection?.requested_date ? <span className="paper-mute ml-2">申請 {inspection.requested_date}</span> : null}
          {sources?.inspection_id && <FieldMark fieldKey="inspection_id" title="查驗申請" className="ml-1" />}
        </div>
        <div id={fieldAnchorId('work_item_id')}>
          <span className="paper-mute">工項：</span>
          {wi ? `${wi.item_no || ''} ${wi.description || ''}`.trim() : (content.work_item_id || '—')}
          {sources?.work_item_id && <FieldMark fieldKey="work_item_id" title="工項" className="ml-1" />}
          {canEdit && !wi && content.work_item_id && <span className="print:hidden block paper-warn">找不到此工項（可能不在標單末端可計價工項內），無法簽確認數量。</span>}
        </div>
        <div id={fieldAnchorId('unit')}>
          <span className="paper-mute">單位：</span>{unit || '—'}
          {sources?.unit && <FieldMark fieldKey="unit" title="單位" className="ml-1" />}
          {canEdit && wi?.unit && content.unit && content.unit !== wi.unit && (
            <span className="print:hidden block paper-warn">表單單位「{content.unit}」≠ 標單工項單位「{wi.unit}」，簽署會被拒絕。
              <button type="button" className="ml-1 underline" onClick={() => set('unit', wi.unit)}>改用工項單位</button>
            </span>
          )}
        </div>
        <div id={fieldAnchorId('stage_key')}>
          <span className="paper-mute">查驗階段：</span>
          {requiredStages.length ? (
            <PaperInput fieldKey="stage_key" label="查驗階段" className="!w-auto"
              options={[{ value: '', label: '請選擇本次查驗的階段…' }, ...requiredStages.map((s) => ({ value: s, label: s }))]}
              readOnlyText={content.stage_key || '—'} />
          ) : <span className="paper-mute">單階段（此工項的檢驗停留點沒有 H 點）</span>}
          {requiredStages.length > 0 && <FieldMark fieldKey="stage_key" title="查驗階段" className="ml-1" />}
          {requiredStages.length > 0 && <span className="print:hidden block paper-mute">必要階段：{requiredStages.join('、')}；全部必要階段皆確認的量才可估驗。</span>}
          {canEdit && !requiredStages.length && content.stage_key && (
            <span className="print:hidden block paper-warn">內容帶了階段「{content.stage_key}」，但此工項沒有必要階段；簽署會被拒絕。
              <button type="button" className="ml-1 underline" onClick={() => set('stage_key', null)}>清除</button>
            </span>
          )}
        </div>
        <div id={fieldAnchorId('declared_qty')}>
          <span className="paper-mute">申報數量{unit ? `（${unit}）` : ''}：</span>
          <PaperInput fieldKey="declared_qty" label="申報數量" type="number" align="right" min={0} className="!w-24"
            readOnlyText={qty(content.declared_qty, unit)} />
          <FieldMark fieldKey="declared_qty" title="申報數量" className="ml-1" />
          {canEdit && inspection?.declared_qty != null && declared != null && Number(inspection.declared_qty) !== declared && (
            <span className="print:hidden block paper-warn">查驗申請載明 {qty(inspection.declared_qty, unit)}；申報量以查驗申請為準，不一致會被拒簽。</span>
          )}
        </div>
        <div id={fieldAnchorId('self_check_record_id')}>
          <span className="paper-mute">檢附之自主檢查：</span>
          {content.self_check_record_id
            ? <Link to={selfCheckDoc ? `/self-check/print?doc=${encodeURIComponent(selfCheckDoc.id)}` : `/quality/checklist-print?id=${encodeURIComponent(content.self_check_record_id)}`} className="text-[var(--blue-text)] hover:underline print:text-inherit print:no-underline">檢視自主檢查{selfCheckDoc ? `（已簽署文件 v${selfCheckDoc.current_version_no}）` : ''}</Link>
            : <span className="paper-mute">未檢附</span>}
          {sources?.self_check_record_id && <FieldMark fieldKey="self_check_record_id" title="檢附之自主檢查" className="ml-1" />}
        </div>
        <div id={fieldAnchorId('template_id')} className="md:col-span-2">
          <span className="paper-mute">查驗表範本（抽查項目與標準的依據）：</span>
          {canEdit ? (
            <select aria-label="查驗表範本" className="paper-input !w-auto" value={content.template_id || ''} onChange={(e) => changeTemplate(e.target.value)}>
              <option value="">不使用查驗表範本（依判定欄簽署）</option>
              {(checklistTemplates || []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          ) : <span>{checklistTemplate?.title || content.template_title || '未使用範本'}</span>}
          <FieldMark fieldKey="template_id" title="查驗表範本" className="ml-1" />
          {canEdit && (checklistTemplates || []).length === 0 && <span className="print:hidden block paper-mute">本案尚無監造查驗用途的範本（品質查驗建立範本時可指定用途）。</span>}
        </div>
      </div>
    </div>
  )
}
