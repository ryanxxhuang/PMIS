import { useState, useMemo } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Stat, Empty, Button, Badge, PageHeader } from '../../components/ui.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'

const TYPES = ['自主檢查', '工安缺失', '教育訓練', '危害告知']
const TYPE_COLOR = { 自主檢查: 'blue', 工安缺失: 'red', 教育訓練: 'green', 危害告知: 'amber' }
const STATUS_COLOR = { 待改善: 'red', 改善中: 'amber', 已完成: 'green' }
const NEEDS_FLOW = (t) => t === '自主檢查' || t === '工安缺失'
const NEXT = { 待改善: '改善中', 改善中: '已完成' }
const NEXT_LABEL = { 待改善: '開始改善', 改善中: '標為完成' }
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const thisMonth = () => todayStr().slice(0, 7)

export default function Safety() {
  const { project, dbMode, demoMode, safetyRecords, createSafetyRecord, updateSafetyRecord, deleteSafetyRecord } = useStore()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  const counts = useMemo(() => {
    const openDef = safetyRecords.filter((r) => r.record_type === '工安缺失' && r.status !== '已完成').length
    const checksThisMonth = safetyRecords.filter((r) => r.record_type === '自主檢查' && (r.record_date || '').startsWith(thisMonth())).length
    const trainings = safetyRecords.filter((r) => r.record_type === '教育訓練').length
    return { openDef, checksThisMonth, trainings }
  }, [safetyRecords])

  const groups = useMemo(() => TYPES.map((t) => ({
    t, list: safetyRecords.filter((r) => r.record_type === t),
  })).filter((g) => g.list.length), [safetyRecords])

  const openForm = (type) => setForm({
    record_type: type, title: '', location: '', record_date: todayStr(),
    severity: '一般', due_date: '', note: '',
  })

  const onSubmit = async () => {
    if (!form.title.trim()) return
    setBusy(true)
    const { error } = await createSafetyRecord(form)
    setBusy(false)
    if (!error) setForm(null)
  }

  if (!dbMode && !demoMode) {
    return <Card title="工安管理"><Empty>此功能需真實專案（已匯入標單）。請先建立專案並匯入標單。</Empty></Card>
  }

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <PageHeader title="工安管理" tagline="自主檢查・缺失・教育訓練" subtitle="記錄工地安全自主檢查、工安缺失改善、教育訓練與危害告知" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="未改善工安缺失" value={counts.openDef} sub="件" color={counts.openDef > 0 ? 'text-rose-600' : 'text-emerald-600'} />
        <Stat label="本月自主檢查" value={counts.checksThisMonth} sub="次" color="text-[var(--blue-text)]" />
        <Stat label="教育訓練累計" value={counts.trainings} sub="場" color="text-[var(--green-text)]" />
      </div>

      <Card title="新增工安紀錄" action={
        <div className="flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <button key={t} onClick={() => openForm(t)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium border transition ${form?.record_type === t ? 'bg-[var(--primary)] text-white border-transparent' : 'border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'}`}>
              ＋ {t}
            </button>
          ))}
        </div>
      }>
        {!form ? (
          <p className="text-xs text-[var(--text-3)]">點右上選一種類型新增：自主檢查、工安缺失、教育訓練、危害告知。</p>
        ) : (
          <div className="bg-[var(--surface-2)] rounded-lg p-4 space-y-3">
            <div className="text-sm font-medium text-[var(--text)]"><Badge color={TYPE_COLOR[form.record_type]}>{form.record_type}</Badge></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-[var(--text-2)] mb-1">{form.record_type === '教育訓練' ? '課程 / 主題' : form.record_type === '危害告知' ? '危害項目' : '項目 / 標題'}</span>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder={form.record_type === '工安缺失' ? '如：施工架未掛安全網' : form.record_type === '自主檢查' ? '如：用電設備自主檢查' : ''}
                  className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-[var(--text-2)] mb-1">位置 / 場所</span>
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-[var(--text-2)] mb-1">日期</span>
                <input type="date" value={form.record_date} onChange={(e) => setForm({ ...form, record_date: e.target.value })}
                  className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
              </label>
              {form.record_type === '工安缺失' && (
                <>
                  <label className="block">
                    <span className="block text-xs font-medium text-[var(--text-2)] mb-1">嚴重度</span>
                    <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}
                      className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)]">
                      <option>輕微</option><option>一般</option><option>嚴重</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-xs font-medium text-[var(--text-2)] mb-1">改善期限</span>
                    <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                      className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
                  </label>
                </>
              )}
            </div>
            <label className="block">
              <span className="block text-xs font-medium text-[var(--text-2)] mb-1">備註 {form.record_type === '教育訓練' ? '（講師 / 參與人數）' : ''}</span>
              <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
            </label>
            <div className="flex gap-2">
              <Button onClick={onSubmit} disabled={busy || !form.title.trim()}>{busy ? '新增中…' : '新增'}</Button>
              <Button variant="secondary" onClick={() => setForm(null)}>取消</Button>
            </div>
          </div>
        )}
      </Card>

      {groups.length === 0 ? (
        <Card title="工安紀錄"><Empty>尚無工安紀錄。用上方新增自主檢查、工安缺失、教育訓練或危害告知。</Empty></Card>
      ) : groups.map((g) => (
        <Card key={g.t} title={`${g.t}（${g.list.length}）`} action={
          <button onClick={() => exportCsv(`工安_${g.t}_${stamp()}`, g.list, [
            { key: 'record_date', label: '日期' }, { key: 'title', label: '項目' }, { key: 'location', label: '位置' },
            { key: 'severity', label: '嚴重度' }, { key: 'status', label: '狀態' }, { key: 'due_date', label: '改善期限' }, { key: 'note', label: '備註' },
          ])} className="text-sm font-medium text-[var(--blue)] hover:underline">⬇ CSV</button>
        }>
          <div className="space-y-2">
            {g.list.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 border-b border-[var(--border-2)] pb-2 text-sm">
                <div className="min-w-0">
                  <div className="text-[var(--text)]">
                    {r.title}
                    {NEEDS_FLOW(r.record_type) && <> <Badge color={STATUS_COLOR[r.status] || 'slate'}>{r.status}</Badge></>}
                    {r.record_type === '工安缺失' && r.severity === '嚴重' && <> <Badge color="red">嚴重</Badge></>}
                  </div>
                  <div className="text-xs text-[var(--text-3)] truncate">
                    {[r.record_date, r.location, r.due_date ? `期限 ${r.due_date}` : '', r.note].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0 items-center">
                  {NEEDS_FLOW(r.record_type) && r.status !== '已完成' && (
                    <Button variant={r.status === '改善中' ? 'success' : 'secondary'} onClick={() => updateSafetyRecord(r.id, { status: NEXT[r.status] })} disabled={busy}>
                      {NEXT_LABEL[r.status]}
                    </Button>
                  )}
                  <button onClick={() => { if (window.confirm('刪除此工安紀錄？')) deleteSafetyRecord(r.id) }} className="text-[var(--text-3)] hover:text-rose-500">✕</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <p className="text-xs text-[var(--text-3)]">公共工程必備：自主檢查、工安缺失改善追蹤、教育訓練與危害告知紀錄都集中在此，可逐類匯出 CSV 交件。</p>
    </div>
  )
}
