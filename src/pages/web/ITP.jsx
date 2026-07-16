// ITP 檢驗停留點:回答「這個工項什麼時候必須通知監造」。
// H=停留點(監造未查驗不得續作)、W=見證點、R=文審點。
// 監造建點(依品質計畫/規範),廠商從點上一鍵申請查驗;狀態由連結查驗自動推導;
// 「施作中卻未叫驗」的 H 點紅色警示並進提醒中心——這就是停留點的存在理由。
import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Flag, AlertTriangle, CheckCircle2, Clock3, XCircle, Circle } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Badge, Button, Input, Select, Empty, PageHeader, ErrorBanner } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import { POINT_TYPES, itpStatus, itpActivity, itpAlerts } from '../../lib/itp.js'

const TYPE_BADGE = { H: 'red', W: 'blue', R: 'slate' }
const STATUS_META = {
  pending: { color: 'slate', icon: Circle },
  requested: { color: 'blue', icon: Clock3 },
  passed: { color: 'green', icon: CheckCircle2 },
  failed: { color: 'red', icon: XCircle },
}

export default function ITP() {
  const {
    workItems, inspections, siteLogs, inspectionPoints, can,
    createInspectionPoint, deleteInspectionPoint, requestInspectionForPoint,
    isSupabaseConfigured, currentProject, workItemsSource,
  } = useStore()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 寫入失敗如實回報(B-07)

  const alerts = useMemo(() => itpAlerts(inspectionPoints, inspections, siteLogs), [inspectionPoints, inspections, siteLogs])
  const leaves = useMemo(() => {
    if (!workItems) return []
    const childMap = new Map()
    for (const it of workItems.items) { const k = it.parent_key || '__root__'; if (!childMap.has(k)) childMap.set(k, []); childMap.get(k).push(it) }
    return workItems.items.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
  }, [workItems])

  if (!workItems) return <Empty>載入中…</Empty>
  // 停留點掛在標單工項上(slice 寫入走 dbMode):標單未匯入前擋牆,避免寫進記憶體假成功
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return <Card title="檢驗停留點"><Empty>此專案的標單尚未匯入資料庫。請先到「標單工項」匯入標單，停留點才能掛在工項上。</Empty></Card>
  }

  const counts = { H: 0, W: 0, R: 0 }
  for (const p of inspectionPoints) counts[p.point_type] = (counts[p.point_type] || 0) + 1

  const submit = async () => {
    setErrMsg(''); setBusy(true)
    const { error } = await createInspectionPoint(form)
    setBusy(false)
    if (error) { setErrMsg(`停留點未建立:${error.message}`); return }
    setForm(null)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="檢驗停留點" tagline="ITP"
        subtitle="H＝停留點（監造未查驗不得續作）、W＝見證點、R＝文審點。施作中未叫驗的 H 點會亮紅並進提醒中心。"
        meta={[{ k: 'H 停留', v: counts.H }, { k: 'W 見證', v: counts.W }, { k: 'R 文審', v: counts.R }]}
      />

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      {alerts.length > 0 && (
        <Card bodyClass="p-0">
          <ul className="divide-y divide-[var(--border-2)]">
            {alerts.map((a) => (
              <li key={a.point.id} className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
                <AlertTriangle size={15} className={a.level === 'overdue' ? 'text-[var(--red-text)]' : 'text-[var(--amber-text)]'} aria-hidden />
                <span className={`font-medium ${a.level === 'overdue' ? 'text-[var(--red-text)]' : 'text-[var(--text)]'}`}>{a.title}</span>
                <span className="text-[var(--text-3)] text-xs">{a.meta}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title={`停留點清單（${inspectionPoints.length}）`}
        bodyClass={inspectionPoints.length ? 'p-0' : 'p-6'}
        action={can.approve && (
          <Button variant="secondary" onClick={() => setForm(form ? null : { point_type: 'H', title: '', acceptance_criteria: '', frequency: '', source_clause: '', work_item_key: '', work_item_label: '' })}>
            {form ? '取消' : '＋ 建立停留點'}
          </Button>
        )}
      >
        {form && (
          <div className="p-4 border-b border-[var(--border-2)] grid gap-2 md:grid-cols-2">
            <Select value={form.point_type} onChange={(e) => setForm((f) => ({ ...f, point_type: e.target.value }))}>
              {Object.entries(POINT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label} — {v.desc}</option>)}
            </Select>
            <Input placeholder="停留點名稱（如：柱牆鋼筋查驗（每層））" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            <PointItemPicker leaves={leaves} value={form.work_item_key} label={form.work_item_label}
              onPick={(k, l) => setForm((f) => ({ ...f, work_item_key: k || '', work_item_label: l }))} />
            <Input placeholder="允收標準（如：間距/搭接長度符合圖說）" value={form.acceptance_criteria} onChange={(e) => setForm((f) => ({ ...f, acceptance_criteria: e.target.value }))} />
            <Input placeholder="頻率（每層／每批／每次澆置前…）" value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))} />
            <Input placeholder="出處（品質計畫 §4.2／規範 03310…）" value={form.source_clause} onChange={(e) => setForm((f) => ({ ...f, source_clause: e.target.value }))} />
            <div className="md:col-span-2 flex justify-end">
              <Button onClick={submit} disabled={busy || !form.title.trim()}>建立</Button>
            </div>
          </div>
        )}

        {inspectionPoints.length === 0 ? (
          <Empty>
            尚未建立停留點。監造依「品質計畫／施工規範」把 W／H／R 點掛上工項，
            廠商施作到點就從這裡申請查驗。
          </Empty>
        ) : (
          <ul className="divide-y divide-[var(--border-2)]">
            {inspectionPoints.map((p) => {
              const st = itpStatus(p, inspections)
              const active = itpActivity(p, siteLogs)
              const sm = STATUS_META[st.key]
              const Icon = sm.icon
              const hot = st.key === 'pending' && active && p.point_type === 'H'
              return (
                <li key={p.id} className={`px-4 py-3 flex flex-wrap items-start gap-x-3 gap-y-1.5 ${hot ? 'bg-[var(--red-tint)]/40' : ''}`}>
                  <Badge color={TYPE_BADGE[p.point_type]} className="mt-0.5 shrink-0">{p.point_type}</Badge>
                  <div className="flex-1 min-w-[220px]">
                    <div className="text-sm font-medium text-[var(--text)]">
                      {p.title}
                      {hot && <span className="ml-2 text-[11px] font-semibold text-[var(--red-text)]">施作中未叫驗</span>}
                    </div>
                    <div className="text-[11px] text-[var(--text-3)] mt-0.5 space-x-2">
                      {p.work_item_no && <span className="num">{p.work_item_no} {p.work_item_desc}</span>}
                      {p.acceptance_criteria && <span>標準：{p.acceptance_criteria}</span>}
                      {p.frequency && <span>頻率：{p.frequency}</span>}
                      {p.source_clause && <span>出處：{p.source_clause}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge color={sm.color}><Icon size={12} aria-hidden /> {st.label}</Badge>
                    {st.key === 'pending' && can.submit && p.point_type !== 'R' && (
                      <Button size="sm" variant={hot ? 'primary' : 'outline'} onClick={async () => { setErrMsg(''); setBusy(true); const { error } = await requestInspectionForPoint(p); setBusy(false); if (error) setErrMsg(`查驗申請未送出:${error.message}`) }} disabled={busy}>
                        申請查驗
                      </Button>
                    )}
                    {(st.key === 'requested' || st.key === 'failed') && (
                      <Link to="/quality" className="text-xs text-[var(--blue-text)] hover:underline">查驗紀錄 →</Link>
                    )}
                    {can.approve && (
                      <button onClick={async () => { if (await appConfirm({ title: `刪除停留點「${p.title}」？`, danger: true, confirmLabel: '刪除' })) { setErrMsg(''); const { error } = await deleteInspectionPoint(p.id); if (error) setErrMsg(`刪除失敗:${error.message}`) } }}
                        className="text-[var(--text-3)] hover:text-rose-500">✕</button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <p className="text-xs text-[var(--text-3)] leading-relaxed">
        <Flag size={12} className="inline -mt-0.5 mr-1" aria-hidden />
        停留點來源通常是「品質計畫」的檢驗停留點清單與施工規範的檢驗規定；
        之後可用 AI 從上傳的規範自動抽出建議停留點（同契約解析模式），由監造審核後生效。
      </p>
    </div>
  )
}

// 工項搜尋選擇器(與品質頁同 pattern 的輕量版)
function PointItemPicker({ leaves, value, label, onPick }) {
  const [q, setQ] = useState('')
  const results = q.trim() ? leaves.filter((it) => it.description.includes(q.trim()) || (it.item_no || '').includes(q.trim())).slice(0, 12) : []
  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface-2)]">
        <span className="truncate flex-1">{label}</span>
        <button onClick={() => onPick(null, '')} className="text-[var(--text-3)] hover:text-rose-500 text-xs">✕</button>
      </div>
    )
  }
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋並選擇工項（可不填）…" />
      {results.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg max-h-56 overflow-auto">
          {results.map((it) => (
            <button key={it.item_key} onClick={() => { onPick(it.item_key, `${it.item_no} ${it.description}`); setQ('') }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] truncate">
              <span className="text-[var(--text-3)] text-xs mr-2">{it.item_no}</span>{it.description}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
