// 公共工程施工日誌 A4 文件本體(參考工程會 108.04.30 修正附表四公開格式)——表頭到簽章、含技術士簽章表附表。
// 2026-09-20 C 包:這張紙同時是**廠商的編輯畫面**。驗收退回的原因是「廠商編輯畫面與紙本不同」——
// 以前廠商填的是另一份精簡表(DailyLogFields),要切「公定格式檢視」才看得到真表,兩份欄位定義各走各的。
// 現在只有這一份:給了 edit context 就在原表的格子裡長出輸入框(哪一格誰可編由 lib/officialForms 的 mapping 決定),
// 沒給就是純文字(列印頁、唯讀視角;唯讀 /site-log 的 e2e 契約:除日期外不得出現 input)。
// 畫面與 PDF 因此共用同一份欄位 mapping、同一份資料來源與同一個版面,不會再分岔。
//
// 資料來源分三種,紙上要分得出來:
//   1) 專案資料(工程名稱、承攬廠商、開工基準日)——自動帶入,不在此頁改;
//   2) 確定性計算(核定／累計／剩餘工期、預定／實際進度、各節累計量)——lib/useFormHeaderFacts 與本檔 cum,
//      算不出來印「待補」,不猜不填 0,AI 不得產生;
//   3) 人填／AI 帶入待確認的欄位——值直接在格子裡,旁邊一枚輕量狀態章(FieldMark),點「原文」回看
//      紙上原文與原照片(B 包的 field_sources[].evidence,不另建一套)。
// 累計＝「此日之前」已落庫的日誌列＋這張紙本本身(印文件版本時不會把同日另一份算進來)。
// 用色一律走 index.css 的 .paper / paper-*(紙面固定白底黑字,不吃主題);本檔不出現色碼或調色盤 class。
import { useMemo, useState } from 'react'
import { MSym } from './icons.jsx'
import { contentToLogShape, fieldAnchorId, addItemRow, removeItemRow, setFieldValue } from '../lib/fieldDocs.js'
import { templateCaption, formTemplateOf, rocDateText, templateOf, canEditForm } from '../lib/officialForms.js'
import { PaperFormProvider, PaperInput, PaperCheck, FieldMark, DerivedValue } from './sitelog/PaperCell.jsx'

const qf = (n) => (n == null || n === '' || isNaN(n) ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }))

const Th = ({ children, right, w }) => <th className={`border paper-rule px-1.5 py-0.5 font-medium text-footnote ${right ? 'text-right' : 'text-left'} ${w || ''}`}>{children}</th>
const Td = ({ children, right, center, className = '' }) => <td className={`border paper-rule px-1.5 py-0.5 text-footnote align-top ${right ? 'text-right tabular-nums' : center ? 'text-center' : ''} ${className}`}>{children}</td>
const Sec = ({ n, title, children }) => (
  <div className="border paper-rule-strong border-t-0">
    <div className="px-2 py-1 text-body font-bold paper-fill border-b paper-rule">{n}、{title}</div>
    <div className="px-2 py-1.5 text-body">{children}</div>
  </div>
)
const HeadCell = ({ label, children, className = '' }) => (
  <div className={`px-2 py-1 paper-rule ${className}`}><span className="paper-mute">{label}</span>{children}</div>
)

export default function SiteLogOfficialSheet({
  project, content = null, sources = null, docDate = null, siteLogs, itemList, facts = null, stamp = null, edit = null,
  titleAs: Title = 'h1', className = '',
}) {
  const byKey = useMemo(() => new Map((itemList || []).map((it) => [it.item_key, it])), [itemList])
  const byIdLocal = useMemo(() => new Map((itemList || []).filter((it) => it.id).map((it) => [it.id, it])), [itemList])
  const byId = edit?.byId || byIdLocal
  const logDate = content?.log_date || docDate || null
  // 累計用的日誌形狀:與事實列同一條規則(標不適用的數量不算當日數量)
  const log = useMemo(() => (content ? contentToLogShape(content, { logDate, sources }) : null), [content, logDate, sources])

  const cum = useMemo(() => {
    const items = new Map(), labor = new Map(), equip = new Map(), mat = new Map()
    if (!log) return { items, labor, equip, mat }
    const upTo = [...(siteLogs || []).filter((l) => l.log_date < log.log_date), log]
    const acc = (m, k, v) => m.set(k, (m.get(k) || 0) + (Number(v) || 0))
    for (const l of upTo) {
      for (const [k, q] of Object.entries(l.items || {})) acc(items, k, q)
      for (const r of l.labor || []) acc(labor, r.type, r.count)
      for (const r of l.equipment || []) acc(equip, r.name, r.count)
      for (const r of l.materials || []) acc(mat, `${r.name}||${r.unit || ''}`, r.qty)
    }
    return { items, labor, equip, mat }
  }, [siteLogs, log])

  if (!content) return null
  // 結構動作(加／移除列、搜尋工項)也要照角色關掉:這張表在監造視角是唯讀的
  const canEdit = !!edit?.editable && canEditForm('daily_log', edit.org || 'contractor')
  const sheetEdit = edit ? { ...edit, editable: canEdit } : null
  const tpl = templateOf('daily_log')
  const stamped = formTemplateOf(content, 'daily_log')
  const ex = content.extras || {}
  const body = (
    <div className={`max-w-[210mm] mx-auto paper shadow print:shadow-none p-[12mm] print:p-0 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-footnote paper-mute">附表四</span>
        <Title className="text-center text-lg font-bold tracking-widest flex-1">公共工程施工日誌</Title>
        <span className="w-12" />
      </div>
      <p className="text-center text-footnote paper-mute mt-0.5">（承攬廠商每日填報）</p>
      <p className="text-center text-caption paper-mute mt-0.5">
        {templateCaption('daily_log')}
        {!stamped?.current && stamped?.key ? `・本文件建立時使用 ${stamped.key} v${stamped.version}` : ''}
      </p>
      {stamp && <div className="mb-2 mt-2">{stamp}</div>}

      {/* 表頭:表報編號／本日天氣／填表日期 */}
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
        <span className="paper-mute">填表日期：<span className="paper-ink">{rocDateText(logDate, { weekday: true })}</span></span>
      </div>

      {/* 表頭:工程／廠商／工期／進度 */}
      <div className="mt-1 border paper-rule-strong text-body">
        <div className="grid grid-cols-2">
          <HeadCell label="工程名稱：" className="border-b border-r">{project?.project_name || <span className="paper-warn">待補</span>}</HeadCell>
          <HeadCell label="承攬廠商名稱：" className="border-b">{project?.contractor_name || <span className="paper-warn">待補（至專案設定補）</span>}</HeadCell>
        </div>
        <div className="grid grid-cols-4 text-footnote">
          <HeadCell label="核定工期：" className="border-b border-r"><DerivedValue fact={facts?.approved_duration_days} suffix=" 天" /></HeadCell>
          <HeadCell label="累計工期：" className="border-b border-r"><DerivedValue fact={facts?.elapsed_duration_days} suffix=" 天" /></HeadCell>
          <HeadCell label="剩餘工期：" className="border-b border-r"><DerivedValue fact={facts?.remaining_duration_days} suffix=" 天" /></HeadCell>
          <HeadCell label="工期展延天數：" className="border-b">
            <span className="inline-block w-16 border-b paper-rule"><PaperInput fieldKey="extras.extended_days" label="工期展延天數" type="number" align="right" /></span> 天
            <FieldMark fieldKey="extras.extended_days" title="工期展延天數" className="ml-1" />
          </HeadCell>
        </div>
        <div className="grid grid-cols-2 text-footnote">
          <HeadCell label="開工日期：" className="border-b border-r">
            {facts?.commencement_date?.pending ? <span className="paper-warn">待補</span> : <span title={facts?.commencement_date?.source || undefined}>{rocDateText(facts?.commencement_date?.value)}</span>}
          </HeadCell>
          <HeadCell label="完工日期：" className="border-b">
            <span className="inline-block min-w-[8rem] border-b paper-rule"><PaperInput fieldKey="extras.actual_completion_date" label="完工日期" type="date" /></span>
            <FieldMark fieldKey="extras.actual_completion_date" title="完工日期" className="ml-1" />
          </HeadCell>
        </div>
        <div className="grid grid-cols-2 text-footnote">
          <HeadCell label="預定進度(%)：" className="border-r"><DerivedValue fact={facts?.planned_progress_pct} suffix=" %" /></HeadCell>
          <HeadCell label="實際進度(%)："><DerivedValue fact={facts?.actual_progress_pct} suffix=" %" /></HeadCell>
        </div>
      </div>

      <ItemsSection content={content} cum={cum} byId={byId} byKey={byKey} edit={sheetEdit} ex={ex} />
      <MaterialsSection content={content} cum={cum} edit={sheetEdit} />
      <CrewSection content={content} cum={cum} edit={sheetEdit} />

      {/* 四、技術士 */}
      <Sec n="四" title="本日施工項目是否有須依「營造業專業工程特定施工項目應置之技術士種類、比率或人數標準表」規定應設置技術士之專業工程">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span>{ex.technicians ? '■' : '□'} 有（此項如勾選「有」，則應填寫後附「公共工程施工日誌之技術士簽章表」）</span>
          <span>{ex.technicians ? '□' : '■'} 無</span>
        </div>
        <div className="mt-1 flex items-baseline gap-1 flex-wrap">
          <span className="paper-mute">種類及人數：</span>
          <span className="inline-block flex-1 min-w-[12rem] border-b paper-rule"><PaperInput fieldKey="extras.technicians" label="應置技術士種類及人數" placeholder="如：混凝土工程技術士 2 名（無則留空＝無）" /></span>
          <FieldMark fieldKey="extras.technicians" title="應置技術士" />
        </div>
      </Sec>

      {/* 五、安衛 */}
      <Sec n="五" title="工地職業安全衛生事項之督導、公共環境與安全之維護及其他工地行政事務">
        <div className="paper-mute">（一）施工前檢查事項：</div>
        <div className="pl-3">
          <div>1. 實施勤前教育（含工地預防災變及危害告知）：
            <span className="ml-2"><PaperCheck fieldKey="extras.edu" label="有" /></span>
            {!canEdit && <span className="mr-3">{ex.edu === false ? '■' : '□'} 無</span>}
          </div>
          <div>2. 確認新進勞工是否提報勞工保險（或其他商業保險）資料及安全衛生教育訓練紀錄：
            <span className="ml-2">
              <PaperInput fieldKey="extras.insured" label="新進勞工提報勞保"
                options={[{ value: '', label: '（未填）' }, { value: '有', label: '有' }, { value: '無', label: '無' }, { value: '無新進勞工', label: '無新進勞工' }]}
                readOnlyText={['有', '無', '無新進勞工'].map((s) => `${ex.insured === s || (!ex.insured && s === '無新進勞工') ? '■' : '□'} ${s}`).join('　')} />
            </span>
          </div>
          <div>3. 檢查勞工個人防護具：
            <span className="ml-2"><PaperCheck fieldKey="extras.ppe" label="有" /></span>
            {!canEdit && <span className="mr-3">{ex.ppe === false ? '■' : '□'} 無</span>}
          </div>
        </div>
        <div className="mt-1 flex items-baseline gap-1 flex-wrap">
          <span className="paper-mute">（二）其他事項：</span>
          <span className="inline-block flex-1 min-w-[12rem] border-b paper-rule"><PaperInput fieldKey="extras.safety_other" label="其他工地安全衛生督導事項" /></span>
          <FieldMark fieldKey="extras.safety_other" title="其他安衛事項" />
        </div>
      </Sec>

      <TextSec n="六" title="施工取樣試驗紀錄" fieldKey="extras.sampling" label="施工取樣試驗紀錄" value={ex.sampling} placeholder="如：混凝土圓柱試體 2 組、坍度 18±2.5cm" />
      <TextSec n="七" title="通知協力廠商辦理事項" fieldKey="extras.notice" label="通知協力廠商辦理事項" value={ex.notice} />
      <TextSec n="八" title="重要事項記錄" fieldKey="extras.important" label="重要事項記錄" value={ex.important}
        placeholder="含主辦機關及監造單位指示、工地緊急異常狀況通報處理、專任工程人員督察按圖施工等" />

      {/* 簽章:原表只有【工地主任】(註 3);平台簽署資訊由 stamp 印出 */}
      <div className="border paper-rule-strong border-t-0 px-2 py-3 text-body">
        <span className="paper-mute">簽章：【工地主任】（註 3）</span>
        <span className="inline-block ml-3 min-w-[12rem] border-b paper-rule-strong">&nbsp;</span>
      </div>
      <p className="text-caption paper-mute mt-3 leading-relaxed">
        {tpl?.disclaimer}
        <br />註 3：本工程依營造業法第 30 條規定須置工地主任者，由工地主任簽章；依上開規定免置工地主任者，則由營造業法第 32 條第 2 項所定之人員簽章。廠商非屬營造業者，由工地負責人簽章。
        <br />累計數量、工期與進度由系統依本案既有紀錄計算（累計＝本日以前已落庫的施工日誌＋本張）；算不出來的欄位一律標「待補」，不由 AI 產生數字。
      </p>

      <TechnicianAppendix ex={ex} edit={sheetEdit} />
      <p className="text-caption paper-mute mt-3">
        原表另附「工地職業安全衛生施工前檢查紀錄表」（附表四第 4 頁）：本系統本輪未實作該張附表，需要時請以紙本另附，並於第五節（二）其他事項註明。
      </p>
    </div>
  )

  // 值一律從同一個 context 讀(列印頁也包,才不會有第二條取值路徑);沒給 edit 就是純紙:
  // 不可編、不顯示來源章(showMarks=false),輸出與以前的列印頁一致。
  return (
    <PaperFormProvider value={{
      docType: 'daily_log', org: edit?.org || 'contractor', state: { content, sources: sources || {} },
      onChange: edit?.onChange, editable: !!edit?.editable, showMarks: !!edit,
      issues: edit?.issues || new Map(), photosById: edit?.photosById || new Map(),
    }}>{body}</PaperFormProvider>
  )
}

function TextSec({ n, title, fieldKey, label, value, placeholder = '' }) {
  return (
    <Sec n={n} title={title}>
      <div className="flex items-baseline gap-1">
        <span className="inline-block flex-1 min-w-[12rem] border-b paper-rule">
          <PaperInput fieldKey={fieldKey} label={label} placeholder={placeholder} readOnlyText={value || '無。'} />
        </span>
        <FieldMark fieldKey={fieldKey} title={label} />
      </div>
    </Sec>
  )
}

// ── 一、施工項目 ────────────────────────────────────────────────────────────
function ItemsSection({ content, cum, byId, byKey, edit, ex }) {
  const [search, setSearch] = useState('')
  const editable = !!edit?.editable
  const leaves = edit?.leaves || []
  const ids = Object.keys(content.items || {})
  const ordered = [...ids].sort((a, b) => (byId.get(a)?.sort_order ?? 0) - (byId.get(b)?.sort_order ?? 0))
  const q = search.trim()
  const results = q ? leaves.filter((it) => it.description.includes(q) || (it.item_no || '').includes(q)).slice(0, 20) : []
  const setQty = (id, val) => {
    if (val == null) { edit.onChange(setFieldValue(edit.state, `items.${id}.qty_today`, null)); return }
    const it = byId.get(id); const mq = it?.quantity || 0
    const n = Math.max(0, mq > 0 ? Math.min(mq, Number(val)) : Number(val))
    edit.onChange(setFieldValue(edit.state, `items.${id}.qty_today`, n))
  }
  return (
    <Sec n="一" title="依施工計畫書執行按圖施工概況（含約定之重要施工項目及完成數量等）">
      <table className="w-full border-collapse my-0.5">
        <thead><tr><Th>施工項目</Th><Th w="w-12">單位</Th><Th right w="w-20">契約數量</Th><Th right w="w-24">本日完成數量</Th><Th right w="w-24">累計完成數量</Th><Th w="w-28">備註</Th></tr></thead>
        <tbody>
          {ordered.length === 0 && <tr><Td>{editable ? '（尚未加入工項；用下方搜尋把今天有施作的工項加進來）' : '本日無工項數量紀錄。'}</Td><Td /><Td right /><Td right /><Td right /><Td /></tr>}
          {ordered.map((id) => {
            const r = content.items[id] || {}
            const it = byId.get(id) || byKey.get(r.item_key) || {}
            const name = `${r.item_no || it.item_no || ''} ${r.description || it.description || id}`.trim()
            const qtyKey = `items.${id}.qty_today`
            return (
              <tr key={id} id={fieldAnchorId(qtyKey)}>
                <Td>{name}</Td>
                <Td>{r.unit || it.unit || ''}</Td>
                <Td right>{qf(it.quantity)}</Td>
                <Td right>
                  <PaperInput fieldKey={qtyKey} label={`${name} 本日完成數量`} type="number" align="right" min={0}
                    value={r.qty_today} onValue={(v) => setQty(id, v)} readOnlyText={r.qty_today == null ? '' : qf(r.qty_today)} />
                  <FieldMark fieldKey={qtyKey} title={`${name} 本日完成數量`} allowNa className="justify-end" />
                </Td>
                <Td right>{qf(cum.items.get(r.item_key || id))}</Td>
                <Td>
                  <PaperInput fieldKey={`items.${id}.note`} label={`${name} 備註`} value={r.note} />
                  {editable && (
                    <button type="button" onClick={() => edit.onChange(removeItemRow(edit.state, id))}
                      className="print:hidden text-micro font-medium text-[var(--red-text)] hover:underline">移除此列</button>
                  )}
                </Td>
              </tr>
            )
          })}
          {/* 營造業專業工程特定施工項目(原表以粗框獨立兩列 A./B.) */}
          <tr><td colSpan={6} className="border paper-rule-strong px-1.5 py-0.5 text-footnote font-medium">營造業專業工程特定施工項目</td></tr>
          {['a', 'b'].map((slot) => {
            const key = `extras.specialty_${slot}`
            const row = ex[`specialty_${slot}`] || {}
            const setPart = (part, v) => edit?.onChange?.(setFieldValue(edit.state, key, { ...row, [part]: v }))
            const cell = (part, label, align = 'left') => (
              <PaperInput fieldKey={key} label={`${slot.toUpperCase()} ${label}`} align={align} type={align === 'right' ? 'number' : 'text'}
                value={row[part] ?? null} onValue={(v) => setPart(part, v)} readOnlyText={row[part] == null ? '' : String(row[part])} />
            )
            return (
              <tr key={slot}>
                <Td><span className="paper-mute mr-1">{slot.toUpperCase()}.</span>{cell('description', '特定施工項目')}</Td>
                <Td>{cell('unit', '單位')}</Td>
                <Td right>{cell('contract_qty', '契約數量', 'right')}</Td>
                <Td right>{cell('qty_today', '本日完成數量', 'right')}</Td>
                <Td right>{cell('qty_cum', '累計完成數量', 'right')}</Td>
                <Td>{cell('note', '備註')}</Td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {editable && (
        <div className="print:hidden relative mt-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋工項加入今日回報…" aria-label="搜尋工項加入今日回報"
            className="w-full border paper-rule rounded px-2 py-1 text-footnote" />
          {results.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border paper-rule rounded [box-shadow:var(--shadow-overlay)] max-h-64 overflow-auto">
              {results.map((it) => (
                <button key={it.item_key} type="button" onClick={() => { edit.onChange(addItemRow(edit.state, it)); setSearch('') }}
                  className="w-full text-left px-2 py-1.5 text-footnote hover:paper-fill flex items-center justify-between gap-2">
                  <span className="truncate"><span className="paper-mute mr-2">{it.item_no}</span>{it.description}</span>
                  <span className="paper-mute shrink-0">{it.unit}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-1 flex items-baseline gap-1">
        <span className="paper-mute shrink-0">施工概況摘要：</span>
        <span className="inline-block flex-1 border-b paper-rule"><PaperInput fieldKey="work_summary" label="施工概況摘要" placeholder="今日施工概況" /></span>
        <FieldMark fieldKey="work_summary" title="施工概況摘要" />
      </div>
    </Sec>
  )
}

// ── 二、材料 ────────────────────────────────────────────────────────────────
function MaterialsSection({ content, cum, edit }) {
  const rows = content.materials || []
  const editable = !!edit?.editable
  const naSrc = edit?.state?.sources?.materials
  const na = naSrc?.status === 'na'
  const setRows = (next) => edit.onChange(setFieldValue(edit.state, 'materials', next))
  const patch = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <Sec n="二" title="工地材料管理概況（含約定之重要材料使用狀況及數量等）">
      <div id={fieldAnchorId('materials')}>
        <table className="w-full border-collapse my-0.5">
          <thead><tr><Th>材料名稱</Th><Th w="w-12">單位</Th><Th right w="w-20">契約數量</Th><Th right w="w-24">本日使用數量</Th><Th right w="w-24">累計使用數量</Th><Th w="w-28">備註</Th></tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><Td>{na ? `本日無材料使用：${naSrc.reason || ''}` : editable ? '（尚未填寫；本日確無進料請按「本日無」並填原因）' : '本日無材料使用紀錄。'}</Td><Td /><Td right /><Td right /><Td right /><Td /></tr>
            )}
            {rows.map((m, i) => (
              <tr key={i}>
                <Td><Cell v={m.name} editable={editable} label={`材料 ${i + 1} 名稱`} onChange={(v) => patch(i, 'name', v)} /></Td>
                <Td><Cell v={m.unit} editable={editable} label={`材料 ${i + 1} 單位`} onChange={(v) => patch(i, 'unit', v)} /></Td>
                <Td right><Cell v={m.contract_qty} editable={editable} label={`材料 ${i + 1} 契約數量`} num onChange={(v) => patch(i, 'contract_qty', v)} /></Td>
                <Td right><Cell v={m.qty} editable={editable} label={`材料 ${i + 1} 本日使用數量`} num onChange={(v) => patch(i, 'qty', v)} /></Td>
                <Td right>{qf(cum.mat.get(`${m.name}||${m.unit || ''}`))}</Td>
                <Td>
                  <Cell v={m.note} editable={editable} label={`材料 ${i + 1} 備註`} onChange={(v) => patch(i, 'note', v)} />
                  {editable && <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="print:hidden text-micro font-medium text-[var(--red-text)] hover:underline">移除</button>}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        <RowActions editable={editable} onAdd={() => setRows([...rows, { name: '', unit: '', qty: null }])} addLabel="新增材料列"
          fieldKey="materials" title="材料使用" naLabel="本日無" />
      </div>
    </Sec>
  )
}

// ── 三、人員及機具 ──────────────────────────────────────────────────────────
function CrewSection({ content, cum, edit }) {
  const editable = !!edit?.editable
  const labor = content.labor || []
  const equip = content.equipment || []
  const setKey = (key, next) => edit.onChange(setFieldValue(edit.state, key, next))
  const laborSrc = edit?.state?.sources?.labor
  const equipSrc = edit?.state?.sources?.equipment
  return (
    <Sec n="三" title="工地人員及機具管理（含約定之出工人數及機具使用情形及數量等）">
      <div className="grid grid-cols-2 gap-3">
        <div id={fieldAnchorId('labor')}>
          <table className="w-full border-collapse">
            <thead><tr><Th>工別</Th><Th right w="w-16">本日人數</Th><Th right w="w-16">累計人數</Th></tr></thead>
            <tbody>
              {labor.length === 0 && <tr><Td>{laborSrc?.status === 'na' ? `本日無出工：${laborSrc.reason || ''}` : editable ? '（待填）' : '—'}</Td><Td right /><Td right /></tr>}
              {labor.map((r, i) => (
                <tr key={i}>
                  <Td>
                    <Cell v={r.type} editable={editable} label={`工別 ${i + 1}`} onChange={(v) => setKey('labor', labor.map((x, j) => (j === i ? { ...x, type: v } : x)))} />
                    {editable && <button type="button" onClick={() => setKey('labor', labor.filter((_, j) => j !== i))} className="print:hidden text-micro font-medium text-[var(--red-text)] hover:underline ml-1">移除</button>}
                  </Td>
                  <Td right><Cell v={r.count} editable={editable} num label={`工別 ${i + 1} 本日人數`} onChange={(v) => setKey('labor', labor.map((x, j) => (j === i ? { ...x, count: v } : x)))} /></Td>
                  <Td right>{qf(cum.labor.get(r.type))}</Td>
                </tr>
              ))}
              {labor.length > 0 && (
                <tr><Td><b>合計</b></Td><Td right><b>{qf(labor.reduce((s, r) => s + (Number(r.count) || 0), 0))}</b></Td><Td right><b>{qf([...cum.labor.values()].reduce((s, v) => s + v, 0))}</b></Td></tr>
              )}
            </tbody>
          </table>
          <RowActions editable={editable} onAdd={() => setKey('labor', [...labor, { type: '', count: null }])} addLabel="新增工別列"
            fieldKey="labor" title="出工人數" naLabel="本日無" freq={edit?.freq?.labor} freqLabel={(r) => r.type} onFreq={(r) => setKey('labor', [...labor, r])} />
        </div>
        <div id={fieldAnchorId('equipment')}>
          <table className="w-full border-collapse">
            <thead><tr><Th>機具名稱</Th><Th right w="w-16">本日使用數量</Th><Th right w="w-16">累計使用數量</Th></tr></thead>
            <tbody>
              {equip.length === 0 && <tr><Td>{equipSrc?.status === 'na' ? `本日無機具：${equipSrc.reason || ''}` : editable ? '（待填）' : '—'}</Td><Td right /><Td right /></tr>}
              {equip.map((r, i) => (
                <tr key={i}>
                  <Td>
                    <Cell v={r.name} editable={editable} label={`機具 ${i + 1} 名稱`} onChange={(v) => setKey('equipment', equip.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
                    {editable && <button type="button" onClick={() => setKey('equipment', equip.filter((_, j) => j !== i))} className="print:hidden text-micro font-medium text-[var(--red-text)] hover:underline ml-1">移除</button>}
                  </Td>
                  <Td right><Cell v={r.count} editable={editable} num label={`機具 ${i + 1} 本日使用數量`} onChange={(v) => setKey('equipment', equip.map((x, j) => (j === i ? { ...x, count: v } : x)))} /></Td>
                  <Td right>{qf(cum.equip.get(r.name))}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <RowActions editable={editable} onAdd={() => setKey('equipment', [...equip, { name: '', count: null }])} addLabel="新增機具列"
            fieldKey="equipment" title="機具使用" naLabel="本日無" freq={edit?.freq?.equipment} freqLabel={(r) => r.name} onFreq={(r) => setKey('equipment', [...equip, r])} />
        </div>
      </div>
    </Sec>
  )
}

// 陣列型欄位(出工／機具／材料)的列動作＋整節狀態章:紙上不印,只在編輯視角出現
function RowActions({ editable, onAdd, addLabel, fieldKey, title, naLabel, freq = null, freqLabel = null, onFreq = null }) {
  return (
    <div className="mt-1 flex items-center gap-2 flex-wrap text-micro">
      {editable && <button type="button" onClick={onAdd} className="print:hidden inline-flex items-center gap-0.5 font-medium text-[var(--blue-text)] hover:underline"><MSym name="add" size={11} />{addLabel}</button>}
      {editable && freq?.length > 0 && freq.slice(0, 4).map((r, i) => (
        <button key={i} type="button" onClick={() => onFreq(r)} className="print:hidden paper-mute hover:underline">＋{freqLabel(r)}</button>
      ))}
      <FieldMark fieldKey={fieldKey} title={title} allowNa naLabel={naLabel} />
    </div>
  )
}

// 陣列列內的一格:陣列列沒有獨立的 field_sources 鍵(來源掛在整節),所以直接受控
function Cell({ v, editable, label, num = false, onChange }) {
  if (!editable) return <span>{v == null || v === '' ? '' : String(v)}</span>
  return (
    <input aria-label={label} className={`paper-input ${num ? 'text-right tabular-nums' : ''}`} type={num ? 'number' : 'text'} step="any"
      value={v ?? ''} onChange={(e) => onChange(num ? (e.target.value === '' ? null : Number(e.target.value)) : (e.target.value || ''))} />
  )
}

// ── 附表:技術士簽章表(原表 p.3)───────────────────────────────────────────────
// 勾「有」才需要;簽名欄是紙本手簽欄,系統不代簽也不自動填。
function TechnicianAppendix({ ex, edit }) {
  const editable = !!edit?.editable
  const rows = Array.isArray(ex.technician_rows) ? ex.technician_rows : []
  if (!ex.technicians && !rows.length && !editable) return null
  const setRows = (next) => edit.onChange(setFieldValue(edit.state, 'extras.technician_rows', next))
  const patch = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <section aria-label="公共工程施工日誌之技術士簽章表" className="mt-6 print:break-before-page">
      <h2 className="text-center text-body font-bold tracking-widest">公共工程施工日誌之技術士簽章表</h2>
      <div className="mt-2 border paper-rule-strong text-footnote">
        <div className="grid grid-cols-2">
          <HeadCell label="專業工程項目：" className="border-r"><PaperInput fieldKey="extras.technician_project" label="專業工程項目" /></HeadCell>
          <HeadCell label="應置技術士人數："><PaperInput fieldKey="extras.technician_required_count" label="應置技術士人數" type="number" align="right" /></HeadCell>
        </div>
      </div>
      <table className="w-full border-collapse mt-1">
        <thead><tr><Th w="w-24">技術士種類</Th><Th right w="w-12">人數</Th><Th w="w-24">技術士姓名</Th><Th w="w-28">技術士證書字號</Th><Th w="w-28">技術士簽名或蓋章</Th><Th w="w-20">備註</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><Td>{editable ? '（勾「有」時逐列填寫）' : ''}</Td><Td right /><Td /><Td /><Td /><Td /></tr>}
          {rows.map((r, i) => (
            <tr key={i}>
              <Td><Cell v={r.kind} editable={editable} label={`技術士 ${i + 1} 種類`} onChange={(v) => patch(i, 'kind', v)} /></Td>
              <Td right><Cell v={r.count} editable={editable} num label={`技術士 ${i + 1} 人數`} onChange={(v) => patch(i, 'count', v)} /></Td>
              <Td><Cell v={r.name} editable={editable} label={`技術士 ${i + 1} 姓名`} onChange={(v) => patch(i, 'name', v)} /></Td>
              <Td><Cell v={r.license_no} editable={editable} label={`技術士 ${i + 1} 證書字號`} onChange={(v) => patch(i, 'license_no', v)} /></Td>
              <Td><span className="paper-mute">（紙本手簽）</span></Td>
              <Td>
                <Cell v={r.note} editable={editable} label={`技術士 ${i + 1} 備註`} onChange={(v) => patch(i, 'note', v)} />
                {editable && <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="print:hidden text-micro font-medium text-[var(--red-text)] hover:underline">移除</button>}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <button type="button" onClick={() => setRows([...rows, { kind: '', count: null, name: '', license_no: '' }])}
          className="print:hidden mt-1 inline-flex items-center gap-0.5 text-micro font-medium text-[var(--blue-text)] hover:underline"><MSym name="add" size={11} />新增技術士列</button>
      )}
    </section>
  )
}
