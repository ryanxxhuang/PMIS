// 由 pages/web/Quality.jsx 原地搬出(重構波次 7):零邏輯改動,只換檔案位置與 import。
import { useState } from 'react'
import { MSym } from '../icons.jsx'
import { Card, Button, Field, Badge, Empty, IconButton, Input, THEAD_CLS } from '../ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../confirm.jsx'
import { taipeiToday } from '../../lib/dates.js'

// ── 取樣試驗:澆置日誌 → 試體組 → 7/28 天齡期 → 抗壓值自動判定 ──
export default function SamplesSection({ samples, onGenerate, onCreate, onUpdate, onDelete, canEdit }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [manual, setManual] = useState({ sampled_date: taipeiToday(), fc: 420, location: '' })
  const [addOpen, setAddOpen] = useState(false)
  const today = taipeiToday()

  const gen = async () => {
    setBusy(true); setMsg('')
    const { error, count } = await onGenerate()
    setBusy(false)
    setMsg(error ? friendlyError(error, '帶入未完成') : count ? `已由施工日誌帶入 ${count} 組取樣。` : '施工日誌沒有尚未建檔的澆置紀錄。')
  }
  const addManual = async () => {
    if (!manual.sampled_date) return
    setBusy(true)
    await onCreate([manual])
    setBusy(false); setAddOpen(false)
  }
  const dueCell = (due, filled) => {
    if (!due) return null
    const overdue = !filled && due < today
    // 逾期=五語意的 red(全站 Dashboard/Alerts 同語意);--accent 不再當警示色
    return <span className={`num text-xs ${overdue ? 'text-[var(--red-text)] font-semibold' : 'text-[var(--text-3)]'}`}>{due}{overdue ? ' 逾期' : ''}</span>
  }

  return (
    <Card title={`取樣試驗（${samples.length}）`} action={
      canEdit && <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={gen} disabled={busy}><MSym name="bolt" size={14} />從施工日誌帶入</Button>
        <Button variant="secondary" onClick={() => setAddOpen((o) => !o)}>{addOpen ? '取消' : <><MSym name="add" size={16} />手動新增</>}</Button>
      </div>
    }>
      {msg && <p className="text-sm mb-3 text-[var(--text-2)]">{msg}</p>}
      {addOpen && (
        <div className="bg-[var(--surface-2)] rounded-lg p-3 mb-4 flex flex-wrap items-end gap-3">
          <Field label="取樣(澆置)日"><Input type="date" value={manual.sampled_date} onChange={(e) => setManual({ ...manual, sampled_date: e.target.value })} /></Field>
          <Field label="fc′ (kgf/cm²)"><Input type="number" inputMode="decimal" value={manual.fc} onChange={(e) => setManual({ ...manual, fc: Number(e.target.value) || null })} className="!w-28 text-right num" /></Field>
          <Field label="位置"><Input value={manual.location} onChange={(e) => setManual({ ...manual, location: e.target.value })} className="!w-36" /></Field>
          <Button onClick={addManual} disabled={busy}>建立試體組</Button>
        </div>
      )}

      {samples.length === 0 ? (
        <Empty>尚無試體。按「從施工日誌帶入」，凡日誌材料含混凝土的澆置日會自動建檔並排 7 / 28 天試驗到期日。</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              {/* th 字型層走 THEAD_CLS 單一真相(掛在 tr 由 th 繼承),對齊/內距各表自決 */}
              <tr className={`${THEAD_CLS} border-b border-[var(--border)]`}>
                <th className="text-left py-1.5">試體編號</th>
                <th className="text-left px-2">取樣日</th>
                <th className="text-right px-2">fc′</th>
                <th className="text-right px-2">7天(參考)</th>
                <th className="text-right px-2">28天各試體 kgf/cm²</th>
                <th className="text-center px-2">判定</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => (
                <tr key={s.id} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
                  <td className="py-1.5 num text-xs">{s.sample_no}<div className="text-micro text-[var(--text-3)]">{s.location}</div></td>
                  <td className="px-2 num text-xs text-[var(--text-2)]">{s.sampled_date}</td>
                  <td className="px-2 text-right num whitespace-nowrap">{s.fc || '—'}</td>
                  <td className="px-2 text-right">
                    {/* 表格內輸入:只加 max-md:py-2(~38px),不加 min-h 以免試體表列高翻倍;斷點與手機層(md)一致 */}
                    <input type="number" step="any" inputMode="decimal" defaultValue={s.d7_value ?? ''} placeholder="值"
                      aria-label={`${s.sample_no} 7天參考值`}
                      onBlur={async (e) => { const n = parseFloat(e.target.value); if (!isNaN(n) && n !== s.d7_value) { const { error } = await onUpdate(s.id, { d7_value: n }); if (error) setMsg(friendlyError(error, '試驗值未寫入')) } }}
                      className="w-16 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums max-md:py-2" />
                    <div>{dueCell(s.d7_due, s.d7_value != null)}</div>
                  </td>
                  <td className="px-2 text-right">
                    <input defaultValue={(s.d28_values || []).join(', ')} placeholder="如 445, 432, 428"
                      aria-label={`${s.sample_no} 28天各試體值`}
                      onBlur={async (e) => {
                        const arr = e.target.value.split(/[,、\s]+/).map(Number).filter((n) => !isNaN(n) && n > 0)
                        if (JSON.stringify(arr) !== JSON.stringify(s.d28_values || [])) {
                          const { error } = await onUpdate(s.id, { d28_values: arr.length ? arr : null })
                          if (error) setMsg(friendlyError(error, '試驗值未寫入'))
                        }
                      }}
                      className="w-36 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums max-md:py-2" />
                    <div>{dueCell(s.d28_due, (s.d28_values || []).length > 0)}</div>
                  </td>
                  <td className="px-2 text-center">
                    <Badge color={s.status === '合格' ? 'green' : s.status === '不合格' ? 'red' : 'slate'}>{s.status}</Badge>
                  </td>
                  {/* 已判定試體=品質證據,不提供刪除(DB 另有 guard) */}
                  <td className="text-right pl-2">{s.status === '待試驗' && (
                    <IconButton name="close" label={`刪除試體 ${s.sample_no}`} onClick={async () => { if (await appConfirm({ title: `刪除試體 ${s.sample_no}？`, danger: true, confirmLabel: '刪除' })) { const { error } = await onDelete(s.id); if (error) setMsg(friendlyError(error, '試體刪除未完成')) } }} className="-m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" />
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-caption text-[var(--text-3)] mt-2">28 天判定標準（03310）：任一試體 ≥ 0.85 fc′ 且平均 ≥ fc′；不合格自動開立缺失。到期未試驗會出現在提醒中心。</p>
    </Card>
  )
}
