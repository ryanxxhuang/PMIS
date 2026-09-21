// 施工自主檢查表 A4 紙本(版面參考臺北市政府「施工自主檢查表」公開格式參考範例)。
// 2026-09-20 C 包:這張紙同時是**廠商的編輯畫面**——給了 edit context 就在原表的格子裡長出輸入框
// (哪一格誰可編由 lib/officialForms 的 mapping 決定),沒給就是純文字(列印頁／唯讀視角;
// 唯讀的 e2e 契約:頁上除日期外不得出現 input)。畫面與列印／PDF 因此共用同一份欄位 mapping 與資料來源。
//
// 版面參考與工程技術標準分開(驗收指令 C):
//   * 版面、欄名、符號說明取自臺北市公開格式參考範例;範例檔裡的示例數值(保護層 4cm／4.5cm)、
//     良好與不良填寫示例、假公司名與示例判定**一律不入產品**;
//   * 檢查項目與檢查標準只取本案核定的檢查表範本(content.template_id → checklist_templates),
//     沒有範本就待補、不可簽署。
// 判定(檢查結果 ○／╳／／)是系統算的,不是人填的:簽署落下的 checklist_records 列(DB fn_checklist_judge)優先,
// 草稿以 lib/qc.judgeChecklist 預覽並標明「草稿為畫面預覽」。實測值只有人能填;紙本實測欄已寫好的數值
// 由系統照原文抄錄並標待確認(來源 record:<photo_id>,點「原文」回看)。
import { selfCheckValues, sourceLabel, fieldAnchorId, templateFields, setFieldValue } from '../../lib/fieldDocs.js'
import { judgeChecklist, judgeItem, checklistCoverage, coverageText } from '../../lib/qc.js'
import { taipeiDateTime as fmtTs } from '../../lib/dates.js'
import { templateCaption, formTemplateOf, rocDateText, templateOf, canEditForm, SELF_CHECK_TIMINGS, SELF_CHECK_RECHECK_RESULTS } from '../../lib/officialForms.js'
import { DocumentPrintStamp } from './DocumentPrint.jsx'
import { PaperFormProvider, PaperInput, FieldMark, MeasuredCell, usePaperForm } from './PaperCell.jsx'

const Th = ({ children, right, w }) => <th className={`border paper-rule px-1.5 py-1 font-medium text-footnote ${right ? 'text-right' : 'text-left'} ${w || ''}`}>{children}</th>
const Td = ({ children, right, center, className = '' }) => <td className={`border paper-rule px-1.5 py-1 text-footnote align-top ${right ? 'text-right tabular-nums' : center ? 'text-center' : ''} ${className}`}>{children}</td>
const HeadCell = ({ label, children, className = '' }) => (
  <div className={`px-2 py-1 paper-rule ${className}`}><span className="paper-mute">{label}</span>{children}</div>
)

export default function SelfCheckSheet({
  project, doc = null, version = null, content: contentProp = null, sources: sourcesProp = null, signature = null,
  frame = null, checklistTemplates = [], checklistTemplate = null, record = null, byId = new Map(), leaves = [],
  edit = null, stamp = undefined, titleAs: Title = 'h1', className = '',
}) {
  const content = contentProp || version?.content || null
  const sources = sourcesProp || version?.field_sources || {}
  if (!content) return null
  const canEdit = !!edit?.editable && canEditForm('self_check', edit.org || 'contractor')
  const items = Array.isArray(checklistTemplate?.items) ? checklistTemplate.items : []
  const values = selfCheckValues(content)
  // 判定:簽署落下的事實列(DB 算)優先;草稿以前端預覽,並在表尾明寫
  const judged = record?.results ? { results: record.results, overall: record.overall ?? null } : (checklistTemplate ? judgeChecklist(checklistTemplate, values) : { results: {}, overall: null })
  const cov = checklistTemplate ? checklistCoverage(checklistTemplate, judged.results) : null
  const wi = content.work_item_id ? byId.get(content.work_item_id) : null
  const tpl = templateOf('self_check')
  const stamped = formTemplateOf(content, 'self_check')
  const signed = !!signature
  // 框架範本(伺服器 fn_field_document_template)若有本紙沒排到的欄位,誠實列在表尾,不默默吃掉
  const PAPER_KEYS = ['check_date', 'template_id', 'work_item_id', 'location', 'results', 'note']
  const extraFields = templateFields(frame).filter((f) => !PAPER_KEYS.includes(f.key))
  let lastGroup = null

  const body = (
    <div className={`paper max-w-[210mm] mx-auto p-[12mm] print:p-[10mm] print:max-w-none text-body ${className}`}>
      <Title className="text-center text-lg font-bold tracking-widest">施 工 自 主 檢 查 表</Title>
      <p className="text-center text-footnote paper-mute mt-0.5">
        （承攬廠商一級品管）{record && (record.rev || 0) > 0 && <span className="ml-2 font-semibold paper-ink">修訂版次 Rev.{record.rev}</span>}
      </p>
      <p className="text-center text-caption paper-mute mt-0.5">
        {templateCaption('self_check')}
        {!stamped?.current && stamped?.key ? `・本文件建立時使用 ${stamped.key} v${stamped.version}` : ''}
        {frame?.is_demo ? `・框架【${frame.demo_label || '示範範本'}】${frame.key} v${frame.version ?? 1}` : ''}
      </p>
      {stamp !== undefined ? stamp : (doc && <DocumentPrintStamp doc={doc} version={version} signature={signature} draftNote="非正式紀錄；判定為畫面預覽" className="mt-3" />)}

      {/* 表頭(原表:編號／工程名稱／分項工程／承攬廠商／協力廠商／檢查位置／檢查日期／檢查時機) */}
      <div className="mt-2 flex items-baseline gap-1 text-footnote">
        <span className="paper-mute">編號：</span>
        <span className="inline-block min-w-[8rem] border-b paper-rule"><PaperInput fieldKey="doc_no" label="編號" /></span>
        <FieldMark fieldKey="doc_no" title="編號" />
      </div>
      <div className="mt-1 border paper-rule-strong text-footnote">
        <div className="grid grid-cols-2">
          <HeadCell label="工程名稱：" className="border-b border-r">{project?.project_name || <span className="paper-warn">待補</span>}</HeadCell>
          <HeadCell label="分項工程名稱：" className="border-b">
            <PaperInput fieldKey="subproject_name" label="分項工程名稱" placeholder="如 鋼筋工程" />
            <FieldMark fieldKey="subproject_name" title="分項工程名稱" className="ml-1" />
          </HeadCell>
        </div>
        <div className="grid grid-cols-2">
          <HeadCell label="承攬廠商：" className="border-b border-r">{project?.contractor_name || <span className="paper-warn">待補（至專案設定補）</span>}</HeadCell>
          <HeadCell label="協力廠商：" className="border-b">
            <PaperInput fieldKey="subcontractor_name" label="協力廠商" placeholder="自辦可留白" />
            <FieldMark fieldKey="subcontractor_name" title="協力廠商" className="ml-1" />
          </HeadCell>
        </div>
        <div className="grid grid-cols-2">
          <HeadCell label="檢查位置：" className="border-b border-r" id={fieldAnchorId('location')}>
            <PaperInput fieldKey="location" label="檢查位置" placeholder="如 3F 版牆" />
            <FieldMark fieldKey="location" title="檢查位置" allowNa />
          </HeadCell>
          <HeadCell label="檢查日期：" className="border-b">{rocDateText(content.check_date || doc?.doc_date)}</HeadCell>
        </div>
        <div className="grid grid-cols-2">
          <HeadCell label="檢查時機：" className="border-r" id={fieldAnchorId('check_timing')}>
            <PaperInput fieldKey="check_timing" label="檢查時機" options={[{ value: '', label: '（未選）' }, ...SELF_CHECK_TIMINGS.map((t) => ({ value: t, label: t }))]}
              readOnlyText={SELF_CHECK_TIMINGS.map((t) => `${content.check_timing === t ? '■' : '□'} ${t}`).join('  ')} />
            <FieldMark fieldKey="check_timing" title="檢查時機" />
          </HeadCell>
          <HeadCell label="檢查結果符號說明：">○ 檢查合格&#x3000;╳ 有缺失需改正&#x3000;／ 無此檢查項目</HeadCell>
        </div>
        <div className="grid grid-cols-2 border-t paper-rule">
          <HeadCell label="檢查表（依據）：" className="border-r" id={fieldAnchorId('template_id')}>
            <TemplateCell content={content} checklistTemplates={checklistTemplates} checklistTemplate={checklistTemplate} edit={edit} canEdit={canEdit} />
            <FieldMark fieldKey="template_id" title="檢查表範本" className="ml-1" />
          </HeadCell>
          <HeadCell label="對應工項：" id={fieldAnchorId('work_item_id')}>
            <PaperInput fieldKey="work_item_id" label="對應工項"
              options={[{ value: '', label: '（不指定工項）' }, ...leaves.map((w) => ({ value: w.id, label: `${w.item_no || ''} ${w.description || ''}`.trim() }))]}
              readOnlyText={wi ? `${wi.item_no || ''} ${wi.description || ''}`.trim() : '—'} />
            <FieldMark fieldKey="work_item_id" title="對應工項" className="ml-1" />
          </HeadCell>
        </div>
      </div>

      {/* 檢查項目(原表五欄) */}
      <table className="w-full border-collapse mt-2">
        <thead>
          <tr>
            <Th w="w-10">項次</Th>
            <Th>檢查項目</Th>
            <Th>設計圖說、規範之檢查標準（定性定量）</Th>
            <Th w="w-32">實際檢查情形（載明檢查數值及單位）</Th>
            <Th w="w-14">檢查結果</Th>
            <Th w="w-24">備註</Th>
          </tr>
        </thead>
        <tbody>
          {!checklistTemplate && (
            <tr><Td /><Td colSpan={5}><span className="paper-warn">尚未選擇本案檢查表範本：檢查項目與檢查標準由範本帶出，選定前無法簽署。</span></Td></tr>
          )}
          {checklistTemplate && items.length === 0 && (
            <tr><Td /><Td colSpan={5}><span className="paper-warn">範本「{checklistTemplate.title}」沒有任何檢查項目，無法簽署；請換一張範本。</span></Td></tr>
          )}
          {items.map((it) => {
            const key = `results.${it.no}`
            const src = sources?.[key]
            const isNa = src?.status === 'na'
            const v = values[it.no]
            const r = judged.results?.[it.no] || {}
            const pass = record?.results ? r.pass : judgeItem(it, v)
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
                  {isNa ? <span className="paper-mute">不適用</span> : (
                    <ResultCell it={it} result={content.results?.[it.no]} title={title} canEdit={canEdit} />
                  )}
                  <FieldMark fieldKey={key} title={title} allowNa naLabel="不適用" className="justify-end" />
                </Td>
                <Td center>{isNa ? '／' : pass === true ? '○' : pass === false ? '╳' : '／'}</Td>
                <Td><PaperInput fieldKey={`${key}.note`} label={`${title} 備註`} /></Td>
              </tr>,
            ]
          })}
        </tbody>
      </table>

      {/* 表尾:整表結果、缺失複查、備註 */}
      <div className="border paper-rule-strong border-t-0 text-footnote px-2 py-1.5">
        檢查結果：
        <span className="mx-2">{judged.overall === '合格' ? '■' : '□'} 全部合格</span>
        <span className="mx-2">{judged.overall === '不合格' ? '■' : '□'} 有缺失（系統於簽署時自動開立缺失單追蹤改善）</span>
        {!judged.overall && <span className="mx-2 paper-mute">（尚無已檢項目／全部不適用）</span>}
        {cov && <span className="ml-2 paper-mute">{coverageText(cov)}{cov.unchecked ? '；判定僅依已檢項' : ''}</span>}
      </div>
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

      {extraFields.length > 0 && (
        <div className="border paper-rule-strong border-t-0 text-footnote px-2 py-1.5">
          <span className="paper-mute">框架範本另有欄位（本紙未排入版面，仍列出以免漏填）：</span>
          {extraFields.map((f) => (
            <span key={f.key} className="inline-flex items-baseline gap-1 ml-2">
              {f.label}：<span className="inline-block min-w-[6rem] border-b paper-rule"><PaperInput fieldKey={f.key} label={f.label} /></span>
              <FieldMark fieldKey={f.key} title={f.label} />
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-10 mt-6 text-center text-body">
        <div><div className="border-t paper-rule-strong pt-1 mt-8">檢查人員（簽署）{signed ? `：${signature.signer_name_snapshot || '—'}（${fmtTs(signature.signed_at)}）` : '：（未簽署）'}</div></div>
        <div><div className="border-t paper-rule-strong pt-1 mt-8">工地主任（簽章）</div></div>
      </div>
      <p className="text-caption paper-mute mt-4 leading-relaxed">
        {tpl?.disclaimer}
        <br />○＝檢查合格&#x3000;╳＝有缺失需改正&#x3000;／＝無此檢查項目或本次不適用。檢查結果由系統依範本量化標準計算
        {record ? '（簽署時由伺服器計算並落為自主檢查紀錄）' : '（草稿為畫面預覽）'}；檢查標準與實際檢查情形應具體載明量化數值及單位。
        <br />來源標「{sourceLabel('record:x')}」的實測值由系統照紙本實測欄原文抄錄並標待確認，其餘由廠商親自量測填寫，簽署前每一項都須逐項確認。
        附件照片 {Array.isArray(version?.attachments) ? version.attachments.length : 0} 張。
      </p>
    </div>
  )

  return (
    <PaperFormProvider value={{
      docType: 'self_check', org: edit?.org || 'contractor', state: { content, sources: sources || {} },
      onChange: edit?.onChange, editable: !!edit?.editable, showMarks: !!edit,
      issues: edit?.issues || new Map(), photosById: edit?.photosById || new Map(),
    }}>{body}</PaperFormProvider>
  )
}

// 實際檢查情形:數值項給數字框＋單位(兩向尺寸／多編號分列,見 PaperCell.MeasuredCell),勾選項給合格／不合格
// (原表以符號呈現);系統永遠不代為量測
function ResultCell({ it, result, title, canEdit }) {
  const ctx = usePaperForm()
  const value = result?.value ?? null
  if (it.kind === 'bool') {
    // 值與來源一起走(lib/fieldDocs 的純函式);這裡只是把它接到原表的勾選格
    const set = (v) => ctx?.onChange?.(setFieldValue(ctx.state, `results.${it.no}`, v))
    if (!canEdit) return <span>{value === true ? '合格' : value === false ? '不合格' : ''}</span>
    return (
      <span className="inline-flex items-center gap-2 justify-end">
        <label className="inline-flex items-center gap-1"><input type="checkbox" className="w-4 h-4" aria-label={`${title} 合格`} checked={value === true} onChange={(e) => set(e.target.checked ? true : null)} />合格</label>
        <label className="inline-flex items-center gap-1"><input type="checkbox" className="w-4 h-4" aria-label={`${title} 不合格`} checked={value === false} onChange={(e) => set(e.target.checked ? false : null)} />不合格</label>
      </span>
    )
  }
  return <MeasuredCell it={it} result={result} title={title} canEdit={canEdit} label="實際檢查情形" />
}
// 檢查表範本(依據):項目與標準的唯一來源;換範本會清掉已填結果,所以由頁面確認後才換
function TemplateCell({ content, checklistTemplates, checklistTemplate, edit, canEdit }) {
  const title = checklistTemplate?.title || content.template_title || '—'
  const source = checklistTemplate?.source || content.template_source || null
  if (!canEdit || !edit?.onTemplateChange) {
    return <span>{title}{source ? <span className="paper-mute">（依據：{source}）</span> : ''}</span>
  }
  return (
    <span className="inline-flex items-baseline gap-1 flex-wrap">
      <select aria-label="檢查表範本" className="paper-input !w-auto" value={content.template_id || ''} onChange={(e) => edit.onTemplateChange(e.target.value)}>
        {!content.template_id && <option value="">請選擇本案檢查表範本…</option>}
        {(checklistTemplates || []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>
      {source && <span className="paper-mute">（依據：{source}）</span>}
    </span>
  )
}
