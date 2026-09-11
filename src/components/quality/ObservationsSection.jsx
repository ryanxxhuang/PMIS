// 由 pages/web/Quality.jsx 原地搬出(重構波次 7):零邏輯改動,只換檔案位置與 import。
import { useState } from 'react'
import { MSym } from '../icons.jsx'
import { Card, Button, Field, Badge, Empty, ErrorBanner, IconButton, Input, Textarea } from '../ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../confirm.jsx'
import MarkupEditor, { MarkupThumb } from '../MarkupEditor.jsx'

// ── 觀察事項:輕量現場提醒（比缺失輕）→ 標記已處理 或 升級為缺失 ──
const OBS_STATUS_COLOR = { 待處理: 'amber', 已處理: 'green', 轉缺失: 'slate' }
export default function ObservationsSection({ observations, canWrite, onCreate, onUpdate, onEscalate, onDelete, resolveMarkup }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [markupOpen, setMarkupOpen] = useState(false)

  // 寫入失敗如實回報(B-07):失敗時表單不關、清單不動
  const run = async (label, fn) => {
    setErr(''); setBusy(true)
    const { error } = (await fn()) || {}
    setBusy(false)
    if (error) { setErr(friendlyError(error, `${label}未完成`)); return false }
    return true
  }
  const submit = async () => { if (await run('新增觀察', () => onCreate(form))) setForm(null) }
  const open = observations.filter((o) => o.status === '待處理').length

  return (
    <Card title={`觀察事項（待處理 ${open}）`} action={
      canWrite && <Button variant="secondary" onClick={() => setForm(form ? null : { title: '', description: '', location: '', assigned_to: 'contractor' })}>{form ? '取消' : <><MSym name="add" size={16} />新增觀察</>}</Button>
    }>
      {form && (
        <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="觀察主旨"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 4F 東側樓梯開口未設護欄" /></Field>
            <Field label="位置"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="如 4F 東側" /></Field>
          </div>
          <Field label="說明"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="現場觀察到、提醒改善的事項（尚未到開立缺失的程度）" /></Field>
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={submit} disabled={busy || !form.title}>新增觀察</Button>
            <Button variant="secondary" onClick={() => setMarkupOpen(true)}><MSym name="draw" size={16} />圖面/照片標註{form.markup_data ? '（已附）' : ''}</Button>
            {form.markup_data && <MarkupThumb src={form.markup_data} />}
          </div>
          {markupOpen && <MarkupEditor title="把觀察位置匡起來" initialImage={form.markup_data}
            onSave={(d) => { setForm((f) => ({ ...f, markup_data: d })); setMarkupOpen(false) }} onClose={() => setMarkupOpen(false)} />}
        </div>
      )}

      {/* 區塊層錯誤統一走 ErrorBanner,不再自寫紅字段落 */}
      <ErrorBanner msg={err} onClose={() => setErr('')} className="mb-2" />
      {observations.length === 0 ? <Empty>尚無觀察事項。現場看到「不對但還沒到缺失」的狀況先記為觀察，處理掉或必要時一鍵升級為缺失。</Empty> : (
        <div className="space-y-2">
          {observations.map((o) => (
            <div key={o.id} className="flex items-start justify-between gap-3 border-b border-[var(--border-2)] pb-2">
              <div className="min-w-0">
                <div className="text-sm text-[var(--text)]">{o.title} <Badge color={OBS_STATUS_COLOR[o.status] || 'slate'}>{o.status}</Badge></div>
                {/* description 是這筆觀察唯一的內容說明,無詳情頁 → 補 title 才看得到全文 */}
                <div className="text-xs text-[var(--text-3)] truncate" title={[o.location, o.description].filter(Boolean).join(' · ')}>{o.location}{o.description ? ` · ${o.description}` : ''}</div>
                {o.markup_path && <div className="mt-1"><MarkupThumb src={o.markup_path} resolve={resolveMarkup} /></div>}
              </div>
              {canWrite && o.status !== '轉缺失' && (
                <div className="flex items-center gap-2 shrink-0">
                  {o.status === '待處理' && <>
                    <Button variant="secondary" disabled={busy} onClick={() => run('標記已處理', () => onUpdate(o.id, { status: '已處理' }))}>標記已處理</Button>
                    <Button variant="outline" disabled={busy} onClick={async () => { if (await appConfirm({ title: '升級為正式缺失？', body: '將自動開立缺失單追蹤改善。', confirmLabel: '升級' })) run('升級為缺失', () => onEscalate(o)) }}>升級為缺失</Button>
                  </>}
                  <IconButton name="close" label={`刪除觀察 ${o.title}`} disabled={busy} onClick={async () => { if (await appConfirm({ title: '刪除此觀察？', danger: true, confirmLabel: '刪除' })) run('刪除觀察', () => onDelete(o.id)) }} className="-m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-caption text-[var(--text-3)] mt-2">觀察事項是比缺失輕的提醒（現場口頭提醒的數位化）：可標記已處理，或在必要時一鍵升級為正式缺失單（進入改善→複查→結案流程）。</p>
    </Card>
  )
}
