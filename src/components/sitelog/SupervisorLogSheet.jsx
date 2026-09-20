// 公共工程監造報表 A4 紙本(版面參考工程會 108.04.30 修正附表五公開格式)——表頭到監造單位簽章。
// 2026-09-20 C2 包:這張紙同時是**監造的編輯畫面**。C 包已經把施工日誌與自主檢查表收成「一份 mapping、一張紙」,
// 本包對監造兩份做同一件事:給了 edit context 就在原表的格子裡長出輸入框(哪一格誰可編由 lib/officialForms 的
// mapping 決定,這份的可編角色是監造),沒給就是純文字(列印頁、唯讀視角;唯讀的 e2e 契約:除日期外不得出現 input)。
//
// 這是**日報**不是監造月報:原表註 2 明寫「本表原則應按日填寫…若屬委外監造之工程,則一律按日填寫」。
// 頁面、列印與檔名都不得出現「月報」字樣。
//
// 資料來源分三種,紙上要分得出來:
//   1) 專案資料(工程名稱、開工基準日、契約竣工日)——自動帶入,不在此頁改;
//   2) 確定性計算(契約工期、預定／實際進度、契約變更次數)——lib/useFormHeaderFacts,算不出來印「待補」,
//      不猜不填 0,AI 不得產生。原表的「契約金額」兩格本系統沒有同口徑資料(標單合計是發包末端工項合計,
//      不含稅與總價項目),所以由監造依契約自行填,未填就印「待補」,絕不拿標單合計冒充契約金額;
//   3) 人填／AI 帶入待確認的欄位——值直接在格子裡,旁邊一枚輕量狀態章(FieldMark),點「原文」回看原文與原照片。
// 到場人員是原表沒有的格(原表註 3:各機關得依契約約定自行增訂),紙上標明「本系統欄位」,而且只能監造親自填寫
// 並按「確認到場人員」才算數(鏡像 DB needs_confirmation;任何照片都不是到場證明)。
import { MSym } from '../icons.jsx'
import {
  DOC_STATUS_LABEL, refTitle, sourceLabel, templateFields, fieldAnchorId,
  setFieldValue, fillHumanField, attendanceIssues, NOTICE_TO_OPTIONS, FOLLOWUP_STATUS_OPTIONS,
} from '../../lib/fieldDocs.js'
import { taipeiDateTime as fmtTs, taipeiISODate } from '../../lib/dates.js'
import { templateCaption, formTemplateOf, rocDateText, templateOf, canEditForm, SAFETY_PRECHECK_OPTIONS } from '../../lib/officialForms.js'
import { DocumentPrintStamp } from './DocumentPrint.jsx'
import { PaperFormProvider, PaperInput, FieldMark, DerivedValue, usePaperForm } from './PaperCell.jsx'

const money = (n) => (n == null || n === '' || isNaN(n) ? null : `NT$ ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
const Sec = ({ n, title, children, id }) => (
  <div id={id} className="border paper-rule-strong border-t-0">
    <div className="px-2 py-1 text-body font-bold paper-fill border-b paper-rule">{n}、{title}</div>
    <div className="px-2 py-1.5 text-body">{children}</div>
  </div>
)
const HeadCell = ({ label, children, className = '', id }) => (
  <div id={id} className={`px-2 py-1 paper-rule ${className}`}><span className="paper-mute">{label}</span>{children}</div>
)
// 陣列列內的一格:陣列列沒有獨立的 field_sources 鍵(來源掛在整節),所以直接受控
function Cell({ v, editable, label, type = 'text', options = null, className = '', onChange }) {
  if (!editable) {
    const text = options ? (options.find((o) => o.value === v)?.label ?? v ?? '') : (v == null || v === '' ? '' : String(v))
    return <span>{text}</span>
  }
  if (options) {
    return (
      <select aria-label={label} className={`paper-input ${className}`} value={v ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }
  return <input aria-label={label} className={`paper-input ${className}`} type={type} value={v ?? ''} onChange={(e) => onChange(e.target.value || (type === 'time' ? null : ''))} />
}

export default function SupervisorLogSheet({
  project, doc = null, version = null, content: contentProp = null, sources: sourcesProp = null, signature = null,
  template = null, facts = null, lookups = {}, byId = new Map(), leaves = [], members = [], currentUser = null,
  contractorTools = null, edit = null, stamp = undefined, titleAs: Title = 'h1', className = '',
}) {
  const content = contentProp || version?.content || null
  const sources = sourcesProp || version?.field_sources || {}
  if (!content) return null
  const canEdit = !!edit?.editable && canEditForm('supervisor_log', edit.org || 'supervisor')
  const logDate = content.log_date || doc?.doc_date || null
  const receipt = content.daily_log_receipt && typeof content.daily_log_receipt === 'object' ? content.daily_log_receipt : null
  const signed = !!signature
  const tpl = templateOf('supervisor_log')
  const stamped = formTemplateOf(content, 'supervisor_log')
  // 框架範本若有本紙沒排到的欄位,誠實列在表尾,不默默吃掉
  const PAPER_KEYS = ['log_date', 'weather_am', 'weather_pm', 'attendance', 'supervision_items', 'inspection_ids', 'contractor_summary', 'daily_log_receipt', 'notices', 'followups', 'note']
  const extraFields = templateFields(template).filter((f) => !PAPER_KEYS.includes(f.key))

  const body = (
    <div className={`paper max-w-[210mm] mx-auto p-[12mm] print:p-[10mm] print:max-w-none text-body ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="w-12" />
        <Title className="text-center text-lg font-bold tracking-widest flex-1">公 共 工 程 監 造 報 表</Title>
        <span className="text-footnote paper-mute">附表五</span>
      </div>
      <p className="text-center text-footnote paper-mute mt-0.5">（監造單位按日填報；非監造月報）</p>
      <p className="text-center text-caption paper-mute mt-0.5">
        {templateCaption('supervisor_log')}
        {!stamped?.current && stamped?.key ? `・本文件建立時使用 ${stamped.key} v${stamped.version}` : ''}
        {template?.is_demo ? `・框架【${template.demo_label || '示範範本'}】${template.key} v${template.version ?? 1}` : ''}
      </p>
      {stamp !== undefined ? stamp : (doc && <DocumentPrintStamp doc={doc} version={version} signature={signature} className="mt-3" />)}

      {/* 表頭第一行:表報編號／本日天氣／填報日期 */}
      <div className="mt-2 flex items-end gap-4 flex-wrap text-footnote">
        <span className="inline-flex items-baseline gap-1">
          <span className="paper-mute">表報編號：</span>
          <span className="inline-block min-w-[6rem] border-b paper-rule"><PaperInput fieldKey="doc_no" label="表報編號" /></span>
          <FieldMark fieldKey="doc_no" title="表報編號" />
        </span>
        <span className="inline-flex items-baseline gap-1">
          <span className="paper-mute">本日天氣：上午</span>
          <span className="inline-block w-20 border-b paper-rule"><PaperInput fieldKey="weather_am" label="本日天氣上午" /></span>
          <FieldMark fieldKey="weather_am" title="天氣（上午）" />
          <span className="paper-mute ml-2">下午</span>
          <span className="inline-block w-20 border-b paper-rule"><PaperInput fieldKey="weather_pm" label="本日天氣下午" /></span>
          <FieldMark fieldKey="weather_pm" title="天氣（下午）" />
        </span>
        <span className="paper-mute">填報日期：<span className="paper-ink">{rocDateText(logDate, { weekday: true })}</span></span>
      </div>

      {/* 表頭表格:工程名稱／工期與日期／變更與金額／進度 */}
      <div className="mt-1 border paper-rule-strong text-body">
        <HeadCell label="工程名稱：" className="border-b">{project?.project_name || <span className="paper-warn">待補</span>}</HeadCell>
        <div className="grid grid-cols-4 text-footnote">
          <HeadCell label="契約工期：" className="border-b border-r"><DerivedValue fact={facts?.approved_duration_days} suffix=" 天" /></HeadCell>
          <HeadCell label="開工日期：" className="border-b border-r">
            {facts?.commencement_date?.pending ? <span className="paper-warn">待補</span> : <span title={facts?.commencement_date?.source || undefined}>{rocDateText(facts?.commencement_date?.value)}</span>}
          </HeadCell>
          <HeadCell label="預定完工日期：" className="border-b border-r">
            {facts?.planned_completion_date?.pending ? <span className="paper-warn">待補</span> : rocDateText(facts?.planned_completion_date?.value)}
          </HeadCell>
          <HeadCell label="實際完工日期：" className="border-b" id={fieldAnchorId('actual_completion_date')}>
            <span className="inline-block min-w-[7rem] border-b paper-rule"><PaperInput fieldKey="actual_completion_date" label="實際完工日期" type="date" /></span>
            <FieldMark fieldKey="actual_completion_date" title="實際完工日期" className="ml-1" />
          </HeadCell>
        </div>
        <div className="grid grid-cols-4 text-footnote">
          <HeadCell label="契約變更次數：" className="border-b border-r"><DerivedValue fact={facts?.approved_change_count} suffix=" 次" /></HeadCell>
          <HeadCell label="工期展延天數：" className="border-b border-r" id={fieldAnchorId('extended_days')}>
            <span className="inline-block w-14 border-b paper-rule"><PaperInput fieldKey="extended_days" label="工期展延天數" type="number" align="right" /></span> 天
            <FieldMark fieldKey="extended_days" title="工期展延天數" className="ml-1" />
          </HeadCell>
          <HeadCell label="契約金額（原契約）：" className="border-b border-r" id={fieldAnchorId('contract_amount_original')}>
            <span className="inline-block min-w-[7rem] border-b paper-rule">
              <PaperInput fieldKey="contract_amount_original" label="原契約金額" type="number" align="right"
                readOnlyText={money(content.contract_amount_original) || ''} />
            </span>
            {content.contract_amount_original == null && <span className="paper-warn ml-1">待補</span>}
            <FieldMark fieldKey="contract_amount_original" title="原契約金額" className="ml-1" />
          </HeadCell>
          <HeadCell label="契約金額（變更後契約）：" className="border-b" id={fieldAnchorId('contract_amount_revised')}>
            <span className="inline-block min-w-[7rem] border-b paper-rule">
              <PaperInput fieldKey="contract_amount_revised" label="變更後契約金額" type="number" align="right"
                readOnlyText={money(content.contract_amount_revised) || ''} />
            </span>
            {content.contract_amount_revised == null && <span className="paper-warn ml-1">待補</span>}
            <FieldMark fieldKey="contract_amount_revised" title="變更後契約金額" className="ml-1" />
          </HeadCell>
        </div>
        <div className="grid grid-cols-2 text-footnote">
          <HeadCell label="預定進度(%)：" className="border-r"><DerivedValue fact={facts?.planned_progress_pct} suffix=" %" /></HeadCell>
          <HeadCell label="實際進度(%)："><DerivedValue fact={facts?.actual_progress_pct} suffix=" %" /></HeadCell>
        </div>
      </div>
      {canEdit && (
        <p className="print:hidden mt-1 text-micro paper-mute">
          契約金額由你依契約填寫：本系統的標單合計是「發包末端工項合計」口徑（不含稅與總價項目），不等於契約金額，所以不自動帶入。
          {facts?.approved_change_count?.pending ? '' : `契約變更次數取本案已核准的變更設計件數（${facts?.approved_change_count?.source || ''}）。`}
        </p>
      )}

      <ProgressSection content={content} receipt={receipt} canEdit={canEdit} contractorTools={contractorTools} />
      <SupervisionSection content={content} sources={sources} canEdit={canEdit} byId={byId} leaves={leaves} lookups={lookups} logDate={logDate} />

      <Sec n="三" title="查核材料規格及品質（含約定之檢驗停留點、材料設備管制及檢（試）驗等抽驗情形）" id={fieldAnchorId('material_quality')}>
        <div className="flex items-baseline gap-1">
          <span className="inline-block flex-1 min-w-[12rem] border-b paper-rule">
            <PaperInput fieldKey="material_quality" label="查核材料規格及品質" rows={canEdit ? 2 : 0}
              placeholder="本日材料規格查核、檢（試）驗與抽驗情形；本日確無請按「本日無」並填原因"
              readOnlyText={content.material_quality || ''} />
          </span>
          <FieldMark fieldKey="material_quality" title="查核材料規格及品質" allowNa naLabel="本日無" />
        </div>
      </Sec>

      <Sec n="四" title="督導工地職業安全衛生事項">
        <div id={fieldAnchorId('safety_precheck')}>
          <span className="paper-mute">（一）施工廠商施工前檢查事項辦理情形：</span>
          <PaperInput fieldKey="safety_precheck" label="施工廠商施工前檢查事項辦理情形" className="!w-auto"
            options={[{ value: '', label: '（未填）' }, ...SAFETY_PRECHECK_OPTIONS.map((s) => ({ value: s, label: s }))]}
            readOnlyText={SAFETY_PRECHECK_OPTIONS.map((s) => `${content.safety_precheck === s ? '■' : '□'} ${s}`).join('　')} />
          <FieldMark fieldKey="safety_precheck" title="施工廠商施工前檢查事項辦理情形" className="ml-1" />
        </div>
        <div className="mt-1 flex items-baseline gap-1" id={fieldAnchorId('safety_other')}>
          <span className="paper-mute shrink-0">（二）其他工地安全衛生督導事項：</span>
          <span className="inline-block flex-1 min-w-[10rem] border-b paper-rule"><PaperInput fieldKey="safety_other" label="其他工地安全衛生督導事項" /></span>
          <FieldMark fieldKey="safety_other" title="其他工地安全衛生督導事項" />
        </div>
      </Sec>

      <OtherMattersSection content={content} sources={sources} canEdit={canEdit} lookups={lookups} />

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

      {/* 簽章:原表為「監造單位簽章」 */}
      <div className="border paper-rule-strong border-t-0 px-2 py-3 text-body">
        <span className="paper-mute">監造單位簽章：</span>
        {signed
          ? <span className="ml-2">{signature.signer_name_snapshot || '—'}（{fmtTs(signature.signed_at)}）</span>
          : <span className="ml-2 paper-mute">（未簽署）</span>}
        <span className="inline-block ml-3 min-w-[10rem] border-b paper-rule-strong">&nbsp;</span>
      </div>

      <AttendanceSection content={content} sources={sources} canEdit={canEdit} members={members} currentUser={currentUser} />

      <p className="text-caption paper-mute mt-4 leading-relaxed">
        {tpl?.disclaimer}
        <br />註：1. 監造報告表原則應包含上述欄位；惟若上述欄位之內容業詳載於廠商填報之施工日誌，並按時陳報監造單位核備者，則監造報表之該等欄位可載明參詳施工日誌。
        2. 本表原則應按日填寫，機關另有規定者，從其規定；若屬委外監造之工程，則一律按日填寫。
        3. 本監造報告表格式僅供參考，各機關亦得依契約約定事項，自行增訂之。
        4. 契約工期如有修正，應填修正後之契約工期，含展延工期及不計工期天數；如有依契約變更設計，預定進度及實際進度應填變更設計後計算之進度。
        5. 公共工程屬建築物者，仍應依本表辦理；該工程之監造人（建築師），應另依內政部最新訂頒之「建築物（監督、查核）報告表」填報。
        <br />契約工期、預定／實際進度與契約變更次數由系統依本案既有紀錄計算，算不出來一律標「待補」，不由 AI 產生數字；
        契約金額兩格由監造依契約填寫（本系統標單合計非契約金額口徑）。到場人員為本系統依註 3 增訂的欄位，只能由監造親自填寫並確認。
        附件照片 {Array.isArray(version?.attachments) ? version.attachments.length : 0} 張。
      </p>
    </div>
  )

  return (
    <PaperFormProvider value={{
      docType: 'supervisor_log', org: edit?.org || 'supervisor', state: { content, sources: sources || {} },
      onChange: edit?.onChange, editable: !!edit?.editable, showMarks: !!edit,
      issues: edit?.issues || new Map(), photosById: edit?.photosById || new Map(),
    }}>{body}</PaperFormProvider>
  )
}

// ── 一、工程進行情況 ─────────────────────────────────────────────────────────
// 原表註 1:內容已詳載於廠商施工日誌並按時陳報核備者,得載明參詳施工日誌——所以收件情形印在同一節。
function ProgressSection({ content, receipt, canEdit, contractorTools }) {
  return (
    <Sec n="一" title="工程進行情況（含約定之重要施工項目及數量）" id={fieldAnchorId('contractor_summary')}>
      <div className="flex items-baseline gap-1">
        <span className="inline-block flex-1 min-w-[12rem] border-b paper-rule">
          <PaperInput fieldKey="contractor_summary" label="施工情形摘要" rows={canEdit ? 3 : 0}
            placeholder="廠商施工情形（引用同日已簽署施工日誌會自動標來源）" readOnlyText={content.contractor_summary || ''} />
        </span>
        <FieldMark fieldKey="contractor_summary" title="廠商施工情形" allowNa naLabel="廠商未施工" />
      </div>
      <div className="mt-1 text-footnote" id={fieldAnchorId('daily_log_receipt')}>
        <span className="paper-mute">施工日誌收件情形（註 1 的參詳依據）：</span>
        {receipt && receipt.status !== 'none'
          ? `${DOC_STATUS_LABEL[receipt.status] || receipt.status}・版本 ${receipt.version_no ?? '—'}・簽署 ${fmtTs(receipt.signed_at)}・提送 ${fmtTs(receipt.submitted_at)}・收件 ${fmtTs(receipt.received_at)}${receipt.returned_at ? `・退回 ${fmtTs(receipt.returned_at)}` : ''}`
          : receipt?.status === 'none' ? '當日無廠商施工日誌文件' : <span className="paper-warn">（未帶入）</span>}
        <FieldMark fieldKey="daily_log_receipt" title="施工日誌收件情形" className="ml-1" />
      </div>
      {contractorTools}
    </Sec>
  )
}

// ── 二、監督依照設計圖說及核定施工圖說施工 ────────────────────────────────────
// 原表把「檢驗停留點及施工抽查」放在這一節:監造事項逐列＋當日查驗紀錄都印在這裡。
function SupervisionSection({ content, sources, canEdit, byId, leaves, lookups, logDate }) {
  const ctx = usePaperForm()
  const rows = Array.isArray(content.supervision_items) ? content.supervision_items : []
  const src = sources?.supervision_items
  const na = src?.status === 'na'
  const setRows = (next) => ctx?.onChange?.(setFieldValue(ctx.state, 'supervision_items', next))
  const patch = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const wiLabel = (id) => { const w = byId.get(id); return w ? `${w.item_no || ''} ${w.description || ''}`.trim() : null }

  const ids = Array.isArray(content.inspection_ids) ? content.inspection_ids : []
  const all = lookups.inspections || []
  const byIdI = new Map(all.map((i) => [i.id, i]))
  const candidates = all.filter((i) => (i.requested_date && String(i.requested_date).slice(0, 10) === logDate) || (i.inspected_at && taipeiISODate(i.inspected_at) === logDate))
  const listed = [...new Set([...ids, ...(canEdit ? candidates.map((i) => i.id) : [])])]
  const toggle = (id, on) => ctx?.onChange?.(setFieldValue(ctx.state, 'inspection_ids', on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)))

  return (
    <Sec n="二" title="監督依照設計圖說及核定施工圖說施工（含約定之檢驗停留點及施工抽查等情形）">
      <div id={fieldAnchorId('supervision_items')}>
        {na && <p className="paper-mute">本日無監造事項：{src.reason || ''}</p>}
        {!na && rows.length === 0 && (
          <p className="paper-mute">{canEdit ? '尚無監造事項。上傳監造照片會由系統整理成監造事項（逐項標來源），也可直接新增。' : '（未填）'}</p>
        )}
        <ol className="space-y-1 list-decimal pl-5">
          {rows.map((r, i) => (
            <li key={i}>
              {canEdit && !na ? (
                <div className="flex items-start gap-1.5 flex-wrap">
                  <input type="time" aria-label={`監造事項 ${i + 1} 時間`} value={r.time || ''} onChange={(e) => patch(i, 'time', e.target.value || null)} className="paper-input !w-24" />
                  <input type="text" aria-label={`監造事項 ${i + 1} 內容`} placeholder="事項（如 抽查鋼筋綁紮）" value={r.item || ''} onChange={(e) => patch(i, 'item', e.target.value)} className="paper-input flex-1 min-w-[10rem]" />
                  <input type="text" aria-label={`監造事項 ${i + 1} 位置`} placeholder="位置" value={r.location || ''} onChange={(e) => patch(i, 'location', e.target.value || null)} className="paper-input !w-24" />
                  <select aria-label={`監造事項 ${i + 1} 工項`} value={r.work_item_id || ''} onChange={(e) => patch(i, 'work_item_id', e.target.value || null)} className="paper-input !w-auto max-w-full">
                    <option value="">（不指定工項）</option>
                    {leaves.map((w) => <option key={w.id} value={w.id}>{w.item_no} {w.description}</option>)}
                  </select>
                  <input type="text" aria-label={`監造事項 ${i + 1} 說明`} placeholder="說明／結果" value={r.note || ''} onChange={(e) => patch(i, 'note', e.target.value || null)} className="paper-input w-full" />
                  <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    className="print:hidden text-micro font-medium text-[var(--red-text)] hover:underline" aria-label={`移除監造事項 ${i + 1}`}>移除</button>
                </div>
              ) : (
                <>
                  <span className="tabular-nums paper-mute mr-1">{r.time || ''}</span>{r.item || '（未填）'}
                  {r.location ? `（${r.location}）` : ''}{r.work_item_id && wiLabel(r.work_item_id) ? `　工項：${wiLabel(r.work_item_id)}` : ''}
                  {r.note ? <span className="block text-footnote paper-mute whitespace-pre-wrap">{r.note}</span> : null}
                </>
              )}
              <span className="block text-caption paper-mute">來源：{sourceLabel(r.source) || '人工填寫'}{Array.isArray(r.photo_ids) && r.photo_ids.length ? `・照片 ${r.photo_ids.length} 張` : ''}</span>
            </li>
          ))}
        </ol>
        <div className="mt-1 flex items-center gap-2 flex-wrap text-micro">
          {canEdit && !na && (
            <button type="button" onClick={() => setRows([...rows, { time: null, item: '', location: null, work_item_id: null, note: null, source: 'human', photo_ids: [] }])}
              className="print:hidden inline-flex items-center gap-0.5 font-medium text-[var(--blue-text)] hover:underline"><MSym name="add" size={11} />加一項監造事項</button>
          )}
          <FieldMark fieldKey="supervision_items" title="監造事項" allowNa naLabel="本日無" />
        </div>
      </div>

      <div className="mt-2 pt-1.5 border-t paper-rule" id={fieldAnchorId('inspection_ids')}>
        <span className="paper-mute">當日查驗（檢驗停留點及施工抽查紀錄）：</span>
        {listed.length === 0 ? <span className="paper-mute">系統無當日查驗申請或判定紀錄。</span> : (
          <ul className="list-disc pl-5">
            {listed.map((id) => {
              const i = byIdI.get(id)
              const on = ids.includes(id)
              const text = i ? `${i.title || id}${i.status ? `（${i.status}）` : ''}${i.location ? ` ${i.location}` : ''}${i.result_note ? `：${i.result_note}` : ''}` : `查驗 ${String(id).slice(0, 8)}（不在目前清單）`
              return (
                <li key={id}>
                  {canEdit
                    ? <label className="inline-flex items-start gap-1.5 max-md:min-h-11"><input type="checkbox" className="w-4 h-4 mt-0.5" checked={on} aria-label={`列入當日查驗：${i?.title || id}`} onChange={(e) => toggle(id, e.target.checked)} />{text}</label>
                    : <span>{text}</span>}
                </li>
              )
            })}
          </ul>
        )}
        <FieldMark fieldKey="inspection_ids" title="當日查驗" />
      </div>
    </Sec>
  )
}

// ── 五、其他約定監造事項 ─────────────────────────────────────────────────────
function OtherMattersSection({ content, sources, canEdit, lookups }) {
  const ctx = usePaperForm()
  const set = (key, v) => ctx?.onChange?.(setFieldValue(ctx.state, key, v))
  const rowsOf = (k) => (Array.isArray(content[k]) ? content[k] : [])
  const listBlock = (key, label, addLabel, fields, blank) => {
    const rows = rowsOf(key)
    const src = sources?.[key]
    const na = src?.status === 'na'
    const patch = (i, f, v) => set(key, rows.map((r, j) => (j === i ? { ...r, [f]: v } : r)))
    return (
      <div id={fieldAnchorId(key)} className="mt-1 first:mt-0">
        <span className="paper-mute">{label}：</span>
        {na && <span className="paper-mute">本日無：{src.reason || ''}</span>}
        {!na && rows.length === 0 && <span className="paper-mute">{canEdit ? '（未填）' : '無。'}</span>}
        <ol className="list-decimal pl-5">
          {rows.map((r, i) => (
            <li key={i}>
              {canEdit && !na ? (
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  {fields.map((f) => (
                    <Cell key={f.key} v={r[f.key]} editable label={`${label} ${i + 1} ${f.label}`} options={f.options || null}
                      className={f.w || ''} onChange={(v) => patch(i, f.key, v)} />
                  ))}
                  <button type="button" onClick={() => set(key, rows.filter((_, j) => j !== i))}
                    className="print:hidden text-micro font-medium text-[var(--red-text)] hover:underline" aria-label={`移除${label} ${i + 1}`}>移除</button>
                </span>
              ) : (
                <span>{fields.map((f) => (f.options ? (f.options.find((o) => o.value === r[f.key])?.label ?? r[f.key]) : r[f.key])).filter((v) => v != null && v !== '').join('：')}</span>
              )}
              {refTitle(r, lookups) ? <span className="paper-mute ml-1">（{refTitle(r, lookups)}）</span> : null}
            </li>
          ))}
        </ol>
        <span className="inline-flex items-center gap-2 flex-wrap text-micro">
          {canEdit && !na && (
            <button type="button" onClick={() => set(key, [...rows, blank])}
              className="print:hidden inline-flex items-center gap-0.5 font-medium text-[var(--blue-text)] hover:underline"><MSym name="add" size={11} />{addLabel}</button>
          )}
          <FieldMark fieldKey={key} title={label} allowNa naLabel="本日無" />
        </span>
      </div>
    )
  }
  return (
    <Sec n="五" title="其他約定監造事項（含重要事項紀錄、主辦機關指示及通知廠商辦理事項等）">
      {listBlock('notices', '通知廠商辦理事項', '加一則通知', [
        { key: 'to', label: '通知對象', options: NOTICE_TO_OPTIONS, w: '!w-24' },
        { key: 'content', label: '內容', w: 'flex-1 min-w-[10rem]' },
      ], { to: 'contractor', content: '' })}
      {listBlock('followups', '追蹤事項', '加一項追蹤', [
        { key: 'content', label: '內容', w: 'flex-1 min-w-[10rem]' },
        { key: 'status', label: '狀態', options: FOLLOWUP_STATUS_OPTIONS, w: '!w-24' },
      ], { content: '', status: 'open' })}
      <div className="mt-1 flex items-baseline gap-1" id={fieldAnchorId('note')}>
        <span className="paper-mute shrink-0">重要事項紀錄：</span>
        <span className="inline-block flex-1 min-w-[10rem] border-b paper-rule"><PaperInput fieldKey="note" label="重要事項紀錄" /></span>
        <FieldMark fieldKey="note" title="重要事項紀錄" />
      </div>
    </Sec>
  )
}

// ── 附記:監造到場人員(原表沒有這一格;原表註 3 各機關得自行增訂)────────────────
// 只能監造親自填寫並按「確認到場人員」才算數:系統不從任何照片推定到場。
function AttendanceSection({ content, sources, canEdit, members, currentUser }) {
  const ctx = usePaperForm()
  const rows = Array.isArray(content.attendance) ? content.attendance : []
  const src = sources?.attendance
  const na = src?.status === 'na'
  const problems = attendanceIssues(rows)
  const setRows = (next) => ctx?.onChange?.(fillHumanField(ctx.state, 'attendance', next))
  const patch = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const addSelf = () => {
    if (!currentUser?.user_id || rows.some((r) => r.user_id === currentUser.user_id)) return
    setRows([...rows, { user_id: currentUser.user_id, name: currentUser.name || '', from: null, to: null }])
  }
  const addMember = (userId) => {
    const m = (members || []).find((x) => x.user_id === userId)
    if (!m || rows.some((r) => r.user_id === m.user_id)) return
    setRows([...rows, { user_id: m.user_id, name: m.full_name || '', from: null, to: null }])
  }
  const label = (i, r) => r.name || `第 ${i + 1} 位`
  return (
    <div className="border paper-rule-strong border-t-0 text-footnote px-2 py-1.5" id={fieldAnchorId('attendance')}>
      <div className="paper-mute">（本系統欄位，非附表五原表欄位；依原表註 3 各機關得自行增訂）監造到場人員與時段</div>
      {na && <p className="paper-mute">本日未到場：{src.reason || ''}</p>}
      {!na && rows.length === 0 && <p className="paper-mute">{canEdit ? '（未填到場人員；本日未到場請按「本日未到場」並填原因）' : '（未填到場人員）'}</p>}
      {!na && rows.length > 0 && (
        <table className="w-full border-collapse mt-1">
          <thead><tr>
            <th className="border paper-rule px-1.5 py-0.5 text-left font-medium">姓名</th>
            <th className="border paper-rule px-1.5 py-0.5 text-left font-medium w-28">到場</th>
            <th className="border paper-rule px-1.5 py-0.5 text-left font-medium w-28">離場</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="border paper-rule px-1.5 py-0.5">
                  <Cell v={r.name} editable={canEdit} label={`${label(i, r)} 姓名`} onChange={(v) => patch(i, 'name', v)} />
                  {r.user_id ? <span className="paper-mute ml-1">（本案成員）</span> : null}
                  {canEdit && <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="print:hidden ml-1 text-micro font-medium text-[var(--red-text)] hover:underline" aria-label={`移除到場人員 ${label(i, r)}`}>移除</button>}
                </td>
                <td className="border paper-rule px-1.5 py-0.5 tabular-nums"><Cell v={r.from} editable={canEdit} type="time" label={`${label(i, r)} 到場時間`} onChange={(v) => patch(i, 'from', v)} /></td>
                <td className="border paper-rule px-1.5 py-0.5 tabular-nums"><Cell v={r.to} editable={canEdit} type="time" label={`${label(i, r)} 離場時間`} onChange={(v) => patch(i, 'to', v)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-1 flex items-center gap-2 flex-wrap text-micro">
        {canEdit && !na && currentUser?.user_id && (
          <button type="button" onClick={addSelf} disabled={rows.some((r) => r.user_id === currentUser.user_id)}
            className="print:hidden inline-flex items-center gap-0.5 font-medium text-[var(--blue-text)] hover:underline disabled:opacity-40"><MSym name="add" size={11} />帶入本人</button>
        )}
        {canEdit && !na && (
          <button type="button" onClick={() => setRows([...rows, { name: '', from: null, to: null }])}
            className="print:hidden inline-flex items-center gap-0.5 font-medium text-[var(--blue-text)] hover:underline"><MSym name="add" size={11} />加一位到場人員</button>
        )}
        {canEdit && !na && (members || []).length > 0 && (
          <select aria-label="加入本案監造成員" value="" onChange={(e) => { addMember(e.target.value); e.target.value = '' }} className="print:hidden paper-input !w-auto">
            <option value="">加入本案監造成員…</option>
            {(members || []).filter((m) => !rows.some((r) => r.user_id === m.user_id)).map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
          </select>
        )}
        <FieldMark fieldKey="attendance" title="到場人員與時段" allowNa naLabel="本日未到場" confirmLabel="確認到場人員" humanOnly />
      </div>
      {canEdit && problems.length > 0 && (
        <ul className="print:hidden mt-1 text-micro paper-warn">{problems.map((p, i) => <li key={i}>第 {p.index + 1} 位：{p.reason}</li>)}</ul>
      )}
      {canEdit && src?.status === 'filled' && (
        <p className="print:hidden mt-1 text-micro paper-warn">到場人員已填但尚未由你親自確認；請核對後按「確認到場人員」，確認前不能簽署。任何照片都不是到場證明。</p>
      )}
    </div>
  )
}
