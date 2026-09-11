// 由 pages/web/Quality.jsx 原地搬出(重構波次 7):零邏輯改動,只換檔案位置與 import。
// 自主檢查表分段:選範本 → 填實測值 → 依量化標準自動判定 → 不合格自動開缺失。
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MSym } from '../icons.jsx'
import { Card, Button, Field, Badge, Empty, Input, Select, THEAD_CLS } from '../ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../confirm.jsx'
import { judgeChecklist, judgeItem, diffChecklistResults } from '../../lib/qc.js'
import { taipeiToday } from '../../lib/dates.js'
import { WorkItemPicker } from '../DefectTracker.jsx'

// 判定章:○ 合格 / ✕ 不合格 / — 未檢
function PassMark({ pass }) {
  if (pass === true) return <span className="text-[var(--green-text)] font-semibold">○</span>
  if (pass === false) return <span className="text-[var(--red-text)] font-semibold">✕</span>
  return <span className="text-[var(--text-3)]">—</span>
}


// 修訂差異的值顯示:✓/✗(bool)、數值、—(未檢)
const fmtVal = (v) => (v === true ? '✓' : v === false ? '✗' : v ?? '—')

// ── 自主檢查表:選範本 → 填實測值 → 依量化標準自動判定 → 不合格自動開缺失。
// 存檔後為證據不可就地修改:更正一律建立修訂版次 Rev.N(必附原因),重新判定
// 並連動缺失(同鏈不重複開);僅未判定的紀錄可刪除。
export default function ChecklistSection({ templates, records, onCreate, onDelete, canEdit, leaves = [], inspections = [], onRequestInspection = null }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [revising, setRevising] = useState(null) // 修訂模式:被修訂的紀錄(現行版)
  const [reason, setReason] = useState('')
  const [tplId, setTplId] = useState(templates[0]?.id)
  const [date, setDate] = useState(taipeiToday())
  const [location, setLocation] = useState('')
  const [wiKey, setWiKey] = useState('') // 對應工項(選填,佐證鏈:估驗佐證欄靠它對回檢查表)
  const [wiLabel, setWiLabel] = useState('')
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)
  // 訊息 tone 由呼叫端決定(success/warn/error),不再用字串比對「不合格/拒絕」推斷顏色——
  // 判定不合格是合法結果走 amber,寫入失敗才是 red(五語意色票,不用 --accent)
  const [msg, setMsgRaw] = useState(null) // { text, tone } | null
  const setMsg = (text, tone = 'success') => setMsgRaw(text ? { text, tone } : null)
  const [historyOf, setHistoryOf] = useState(null) // 展開歷次版本的鏈根 id

  // 紀錄 → 末端工項:demo 存 work_item_key、真 DB 存 work_item_id(uuid),一張表查兩種鍵
  const leafByRef = useMemo(() => {
    const m = new Map()
    for (const l of leaves) { m.set(l.item_key, l); if (l.id) m.set(l.id, l) }
    return m
  }, [leaves])
  const wiOf = (r) => leafByRef.get(r.work_item_key) || leafByRef.get(r.work_item_id)

  const template = revising
    ? templates.find((t) => t.id === revising.template_id)
    : (templates.find((t) => t.id === tplId) || templates[0])
  const live = useMemo(() => (template ? judgeChecklist(template, values) : null), [template, values])

  // 修訂鏈:依 root_id 分組,rev 最大者為現行版,其餘為歷次版本
  const chains = useMemo(() => {
    const byRoot = new Map()
    for (const r of records) {
      const root = r.root_id || r.id
      if (!byRoot.has(root)) byRoot.set(root, [])
      byRoot.get(root).push(r)
    }
    return [...byRoot.values()]
      .map((revs) => {
        revs.sort((a, b) => (b.rev || 0) - (a.rev || 0))
        return { current: revs[0], history: revs.slice(1) }
      })
      .sort((a, b) => (b.current.check_date || '').localeCompare(a.current.check_date || ''))
  }, [records])

  // 反向標記:這條修訂鏈的任一版被哪張查驗檢附(查驗刻意留在舊版=證據不可變,
  // 所以要整鏈查,不能只看現行版 id)。有檢附就不再給「提出查驗申請」,避免重複送。
  const attachedInspByRecordId = useMemo(() => {
    const m = new Map()
    for (const i of inspections) if (i.checklist_record_id) m.set(i.checklist_record_id, i)
    return m
  }, [inspections])
  const attachedInspOfChain = (current, history) =>
    [current, ...history].map((rev) => attachedInspByRecordId.get(rev.id)).find(Boolean) || null

  const setVal = (no, v) => setValues((p) => ({ ...p, [no]: v }))
  const closeForm = () => { setOpen(false); setRevising(null); setValues({}); setReason(''); setWiKey(''); setWiLabel('') }
  const startRevise = (r) => {
    setMsg(''); setRevising(r); setOpen(true); setReason('')
    setDate(r.check_date || taipeiToday()); setLocation(r.location || '')
    const wi = wiOf(r) // 修訂帶入原紀錄的工項關聯,可改可清
    setWiKey(wi?.item_key || ''); setWiLabel(wi ? `${wi.item_no} ${wi.description}` : '')
    setValues(Object.fromEntries(
      Object.entries(r.results || {}).filter(([, v]) => v?.value != null).map(([no, v]) => [no, v.value])))
  }
  const save = async () => {
    setSaving(true); setMsg('')
    const res = await onCreate({
      template, check_date: date, location, values,
      work_item_key: wiKey || undefined,
      revises: revising || undefined, revision_reason: revising ? reason.trim() : undefined,
    })
    setSaving(false)
    if (res.error) { setMsg(friendlyError(res.error, '存檔未完成'), 'error'); return }
    const revTag = res.rev ? `Rev.${res.rev}：` : ''
    if (res.defectAction === 'created') setMsg(`已存檔 ${revTag}判定不合格，系統已自動開立缺失。`, 'warn')
    else if (res.defectAction === 'linked') setMsg(`已存檔 ${revTag}判定不合格；此檢查表已有未結案缺失，未重複開立。`, 'warn')
    else if (res.defectError) setMsg(`已存檔 ${revTag}判定不合格，但缺失開立失敗：${friendlyError(res.defectError, '請稍後重試')}`, 'error')
    else if (res.overall === '合格' && res.openDefectRemains) setMsg(`已存檔 ${revTag}更正後判定合格。原自動開立的缺失仍在追蹤中，請至缺失區確認後續處理。`)
    else setMsg(`已存檔 ${revTag}判定${res.overall || '未完成'} ✓`, res.overall === '不合格' ? 'warn' : 'success')
    closeForm()
  }
  const del = async (r) => {
    if (!(await appConfirm({ title: '刪除此檢查紀錄？', body: '僅未判定的紀錄可刪除；已判定的證據請以「修訂」更正。', danger: true, confirmLabel: '刪除' }))) return
    const res = await onDelete(r.id)
    if (res?.error) setMsg(friendlyError(res.error, '檢查紀錄刪除未完成'), 'error')
  }

  let lastGroup = null
  return (
    <Card title={`自主檢查表（${chains.length}）`} action={
      canEdit && <Button variant="secondary" onClick={() => { if (open) closeForm(); else setOpen(true); setMsg('') }}>{open ? '取消' : <><MSym name="add" size={16} />新增檢查</>}</Button>
    }>
      {msg && <p className={`text-sm mb-3 ${msg.tone === 'error' ? 'text-[var(--red-text)]' : msg.tone === 'warn' ? 'text-[var(--amber-text)]' : 'text-[var(--green-text)]'}`}>{msg.text}</p>}

      {open && template && (
        <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
          {revising && (
            <p className="text-sm font-medium text-[var(--text)]">
              修訂 Rev.{(revising.rev || 0) + 1} — 原版{revising.rev ? ` Rev.${revising.rev}` : ''}（{revising.check_date} 判定{revising.overall || '未判定'}）不會被覆寫，將以新版次留存差異。
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="檢查表範本">
              {revising ? (
                <span className="text-sm px-2.5 py-1.5 inline-block">{template.title}</span>
              ) : (
                <Select value={tplId} onChange={(e) => { setTplId(e.target.value); setValues({}) }}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </Select>
              )}
            </Field>
            <Field label="檢查日期"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="檢查位置"><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="如 4F 版牆" className="!w-36" /></Field>
            <div className="w-72"><Field label="對應工項（選填）">
              <WorkItemPicker leaves={leaves} value={wiKey} label={wiLabel}
                onPick={(k, l) => { setWiKey(k || ''); setWiLabel(l) }} />
            </Field></div>
            {revising && (
              <Field label="更正原因（必填）">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如 坍度登載錯誤，依取樣紀錄更正"
                  className="!w-72" />
              </Field>
            )}
          </div>
          <p className="text-caption text-[var(--text-3)]">依據：{template.source}。填實測值即時判定；未填的項目視為未檢，不列入判定。</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                {/* th 字型層走 THEAD_CLS 單一真相(掛在 tr 由 th 繼承),對齊/內距各表自決 */}
                <tr className={`${THEAD_CLS} border-b border-[var(--border)]`}>
                  <th className="text-left py-1.5 w-14">項次</th>
                  <th className="text-left">檢查項目</th>
                  <th className="text-left px-2">檢查標準</th>
                  <th className="text-right px-2 w-36">實測值</th>
                  <th className="text-center w-12">判定</th>
                </tr>
              </thead>
              <tbody>
                {template.items.map((it) => {
                  const groupRow = it.group !== lastGroup
                  lastGroup = it.group
                  return [
                    groupRow && (
                      <tr key={`g-${it.group}`}><td colSpan={5} className="pt-2 pb-1 text-caption font-semibold tracking-[0.08em] text-[var(--text-3)]">{it.group}</td></tr>
                    ),
                    <tr key={it.no} className="border-b border-[var(--border-2)]">
                      <td className="py-1.5 text-xs text-[var(--text-3)] num">{it.no}</td>
                      <td className="py-1.5 pr-2">{it.item}</td>
                      <td className="py-1.5 px-2 text-xs text-[var(--text-2)]">{it.standard}</td>
                      <td className="py-1.5 px-2 text-right">
                        {it.kind === 'bool' ? (
                          // 20px:原生 checkbox 預設 13px,和同列 text-sm 一樣高所以不撐列
                          <input type="checkbox" className="w-5 h-5" checked={values[it.no] === true}
                            onChange={(e) => setVal(it.no, e.target.checked)} />
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {/* 表格內輸入只提到 ~38px(max-md:py-2),不加 min-h——加了整張檢查表列高會翻倍。
                                斷點跟手機層對齊(BottomNav 是 md:hidden):寫 max-sm 會讓 640–767 拿到手機版面卻是桌機內距 */}
                            <input type="number" step="any" inputMode="decimal" value={values[it.no] ?? ''}
                              onChange={(e) => setVal(it.no, e.target.value === '' ? '' : Number(e.target.value))}
                              className="w-24 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-sm tabular-nums bg-[var(--surface)] max-md:py-2" />
                            <span className="text-micro text-[var(--text-3)] w-10">{it.unit || ''}</span>
                          </span>
                        )}
                      </td>
                      <td className="text-center"><PassMark pass={judgeItem(it, values[it.no])} /></td>
                    </tr>,
                  ]
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            {/* busy prop:送出中禁用+旋轉圖示由 Button 統一,不再用文字切換載入態 */}
            <Button onClick={save} busy={saving} disabled={revising && !reason.trim()}>{revising ? `存檔為 Rev.${(revising.rev || 0) + 1} 並重新判定` : '存檔並判定'}</Button>
            {revising && !reason.trim() && <span className="text-xs text-[var(--text-3)]">請先填寫更正原因</span>}
            {live?.overall && (
              <Badge color={live.overall === '合格' ? 'green' : 'red'}>目前判定：{live.overall}{live.failed.length ? `（${live.failed.length} 項不合格）` : ''}</Badge>
            )}
          </div>
        </div>
      )}

      {chains.length === 0 ? <Empty>尚無自主檢查紀錄。選範本填實測值，系統依量化標準自動判定。</Empty> : (
        <div className="space-y-1.5">
          {chains.map(({ current: r, history }) => {
            const tpl = templates.find((t) => t.id === r.template_id)
            const rootId = r.root_id || r.id
            const prev = history.find((h) => h.id === r.supersedes_id)
            const diffs = (r.rev || 0) > 0 && tpl && prev ? diffChecklistResults(tpl, prev.results, r.results) : []
            const attachedInsp = attachedInspOfChain(r, history)
            return (
              <div key={rootId} className="border-b border-[var(--border-2)] pb-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="num text-[var(--text-3)] text-xs mr-2">{r.check_date}</span>
                    <span className="text-[var(--text)]">{tpl?.title || '（範本已刪除）'}</span>
                    {(r.rev || 0) > 0 && <Badge color="blue">Rev.{r.rev}</Badge>}
                    {r.location && <span className="text-xs text-[var(--text-3)] ml-2">{r.location}</span>}
                    {wiOf(r) && <span className="text-xs text-[var(--text-3)] ml-2" title={wiOf(r).description}>工項 {wiOf(r).item_no}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge color={r.overall === '合格' ? 'green' : r.overall === '不合格' ? 'red' : 'slate'}>{r.overall || '未判定'}</Badge>
                    {attachedInsp && (
                      <span title={`已檢附於查驗:${attachedInsp.title}`}><Badge color="slate">已附查驗</Badge></span>
                    )}
                    {/* 一級交二級:自檢合格才有資格提查驗;已檢附過就不再給(避免重複送)。
                        列動作=第三級文字鈕:一律 --blue-text(--blue 只作底色/邊框)+手機 44px */}
                    {onRequestInspection && r.overall === '合格' && !attachedInsp && (
                      <button onClick={() => onRequestInspection(r, tpl?.title || '', wiOf(r))}
                        title="以此檢查紀錄為附件,預填查驗申請(送出前可改)"
                        className="text-[var(--blue-text)] hover:underline text-xs whitespace-nowrap inline-flex items-center max-md:min-h-11">提出查驗申請</button>
                    )}
                    <button onClick={() => navigate(`/quality/checklist-print?id=${r.id}`)} title="列印自主檢查表"
                      className="text-[var(--blue-text)] hover:underline text-xs inline-flex items-center gap-1 max-md:min-h-11"><MSym name="print" size={13} />列印</button>
                    {canEdit && tpl && (
                      <button onClick={() => startRevise(r)} title="以修訂版次更正（不覆寫舊證據）"
                        className="text-[var(--blue-text)] hover:underline text-xs inline-flex items-center max-md:min-h-11">修訂</button>
                    )}
                    {history.length > 0 && (
                      <button onClick={() => setHistoryOf(historyOf === rootId ? null : rootId)}
                        className="text-[var(--blue-text)] hover:underline text-xs inline-flex items-center max-md:min-h-11">歷次 {history.length}</button>
                    )}
                    {canEdit && !r.overall && (
                      <button onClick={() => del(r)} aria-label="刪除未判定的檢查紀錄" className="text-[var(--text-3)] hover:text-[var(--red-text)] p-2 -m-2"><MSym name="close" size={16} /></button>
                    )}
                  </div>
                </div>
                {(r.rev || 0) > 0 && r.revision_reason && (
                  <div className="text-caption text-[var(--text-3)] mt-0.5">
                    更正原因：{r.revision_reason}
                    {diffs.length > 0 && <span className="ml-2">異動：{diffs.map((d) => `${d.no} ${fmtVal(d.from)}→${fmtVal(d.to)}`).join('、')}</span>}
                  </div>
                )}
                {historyOf === rootId && history.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 text-xs text-[var(--text-3)] mt-1 pl-4">
                    <span>Rev.{h.rev || 0}</span>
                    <span className="num">{h.check_date}</span>
                    <Badge color="slate">{h.overall || '未判定'}</Badge>
                    <span>已由新版取代</span>
                    {/* 更正原因是稽核性說明,這一列沒有下鑽入口 → 至少要能 hover 看全文 */}
                    {(h.rev || 0) > 0 && h.revision_reason && <span className="truncate" title={h.revision_reason}>（{h.revision_reason}）</span>}
                    <button onClick={() => navigate(`/quality/checklist-print?id=${h.id}`)}
                      className="text-[var(--blue-text)] hover:underline shrink-0">列印</button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
      <p className="text-caption text-[var(--text-3)] mt-2">檢查表存檔後即為品質證據，不可就地修改：更正一律以「修訂」建立 Rev.N 留存差異與原因，並重新自動判定；改判不合格會自動開立缺失（同一張表已有未結案缺失時不重複開）。僅未判定的紀錄可刪除。</p>
    </Card>
  )
}
