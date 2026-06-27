import { useState } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Button, Badge, Stat, StatusBadge, Empty, Field } from '../../components/ui.jsx'
import { rfiPriorities } from '../../data/seed.js'

// RFI 工程疑義 / 技術澄清 — Procore 工作流（ball-in-court）
// 人對人正式往來、可標工期 / 費用影響；與「AI 規範問答」是不同東西（那是 AI 輔助查規範）
export default function RFI() {
  const { rfis } = useStore()
  const [openId, setOpenId] = useState(null)
  const [creating, setCreating] = useState(false)

  const pendingCM = rfis.filter((r) => r.ball_in_court === '監造').length
  const pendingGC = rfis.filter((r) => r.ball_in_court === '施工廠商').length
  const impactful = rfis.filter((r) => r.cost_impact || r.schedule_impact).length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">RFI 工程疑義</h1>
          <p className="text-slate-500 text-sm mt-1 max-w-2xl">
            施工廠商對圖說 / 規範的正式技術澄清，採 Procore <b>ball-in-court</b> 往來、編號歸檔，
            並可標註<b>工期 / 費用影響</b>。（與「AI 規範問答」不同 — 那是 AI 輔助查規範，這裡是人對人正式往來）
          </p>
        </div>
        <Button className="shrink-0 whitespace-nowrap" onClick={() => { setCreating((v) => !v); setOpenId(null) }}>＋ 提出 RFI</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="疑義總數" value={rfis.length} sub="本案" color="text-slate-800" />
        <Stat label="待監造回覆" value={pendingCM} sub="球在監造" color="text-amber-600" />
        <Stat label="待施工確認" value={pendingGC} sub="球在施工廠商" color={pendingGC ? 'text-rose-600' : 'text-slate-800'} />
        <Stat label="有工期/費用影響" value={impactful} sub="需特別追蹤" color={impactful ? 'text-rose-600' : 'text-slate-800'} />
      </div>

      {creating && <CreateForm onDone={() => setCreating(false)} />}

      <Card title={`疑義清單（${rfis.length}）`}>
        {rfis.length === 0 ? (
          <Empty>尚無 RFI。點右上「提出 RFI」由施工廠商發起。</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-3 font-medium">編號</th>
                  <th className="py-2 px-3 font-medium">主題</th>
                  <th className="py-2 px-3 font-medium">優先</th>
                  <th className="py-2 px-3 font-medium">影響</th>
                  <th className="py-2 px-3 font-medium">球在誰手上</th>
                  <th className="py-2 px-3 font-medium">狀態</th>
                  <th className="py-2 pl-3 font-medium">期限</th>
                </tr>
              </thead>
              <tbody>
                {rfis.map((r) => (
                  <tr
                    key={r.rfi_id}
                    onClick={() => { setOpenId(openId === r.rfi_id ? null : r.rfi_id); setCreating(false) }}
                    className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${openId === r.rfi_id ? 'bg-slate-50' : ''}`}
                  >
                    <td className="py-3 pr-3 font-mono text-xs text-slate-500">{r.rfi_no}</td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-800">{r.subject}</div>
                      <div className="text-xs text-slate-400">{r.work_item} · 提問 {r.asked_by}</div>
                    </td>
                    <td className="py-3 px-3"><PriorityBadge p={r.priority} /></td>
                    <td className="py-3 px-3"><ImpactTags rfi={r} compact /></td>
                    <td className="py-3 px-3"><BallInCourt who={r.ball_in_court} /></td>
                    <td className="py-3 px-3"><StatusBadge status={r.status} /></td>
                    <td className="py-3 pl-3 text-slate-500 whitespace-nowrap">{r.due_date || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {openId && <Detail key={openId} rfi={rfis.find((r) => r.rfi_id === openId)} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function BallInCourt({ who }) {
  if (who === '監造') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">🟠 球在 監造</span>
  if (who === '施工廠商') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">🔴 球在 施工廠商</span>
  return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">✓ 已結束</span>
}

function PriorityBadge({ p }) {
  const color = p === '高' ? 'red' : p === '中' ? 'amber' : 'slate'
  return <Badge color={color}>{p}</Badge>
}

function ImpactTags({ rfi, compact }) {
  if (!rfi.cost_impact && !rfi.schedule_impact) return <span className="text-xs text-slate-300">—</span>
  return (
    <div className={`flex ${compact ? 'gap-1' : 'gap-2'} flex-wrap`}>
      {rfi.schedule_impact && <Badge color="red">⏱ 工期</Badge>}
      {rfi.cost_impact && <Badge color="amber">💰 費用</Badge>}
    </div>
  )
}

function CreateForm({ onDone }) {
  const { createRFI } = useStore()
  const [subject, setSubject] = useState('')
  const [question, setQuestion] = useState('')
  const [workItem, setWorkItem] = useState('混凝土工程')
  const [spec, setSpec] = useState('')
  const [priority, setPriority] = useState('中')
  const [cost, setCost] = useState(false)
  const [sched, setSched] = useState(false)

  const submit = () => {
    createRFI({
      subject, question, work_item: workItem, linked_spec_section: spec, priority,
      cost_impact: cost, schedule_impact: sched, due_date: '2026-06-22', attachments: ['疑義附圖.pdf'],
    })
    onDone()
  }

  return (
    <Card title="提出 RFI（施工廠商發起）">
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="主題"><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="如：地下室外牆防水層收頭" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></Field>
        <Field label="優先級">
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {rfiPriorities.map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="工項">
          <select value={workItem} onChange={(e) => setWorkItem(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {['混凝土工程', '鋼筋工程', '模板工程', '土方工程'].map((w) => <option key={w}>{w}</option>)}
          </select>
        </Field>
        <Field label="圖說 / 規範依據"><input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="如：結構圖 S-12" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></Field>
        <div className="md:col-span-2">
          <Field label="疑義內容"><textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} placeholder="描述圖說 / 規範不明確或衝突之處…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></Field>
        </div>
        <div className="md:col-span-2 flex gap-5 text-sm text-slate-600">
          <label className="flex items-center gap-2"><input type="checkbox" checked={sched} onChange={(e) => setSched(e.target.checked)} /> ⏱ 影響工期</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={cost} onChange={(e) => setCost(e.target.checked)} /> 💰 影響費用</label>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onDone}>取消</Button>
        <Button onClick={submit} disabled={!subject || !question}>提出 RFI → 球轉給監造</Button>
      </div>
    </Card>
  )
}

function Detail({ rfi: r, onClose }) {
  const { answerRFI, closeRFI } = useStore()
  const [answer, setAnswer] = useState('')

  const awaitingCM = r.ball_in_court === '監造'
  const awaitingGC = r.ball_in_court === '施工廠商'

  return (
    <Card
      title={`${r.rfi_no} — ${r.subject}`}
      action={<Button variant="ghost" onClick={onClose}>✕ 關閉</Button>}
    >
      <div className="grid md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
        <Meta label="工項" value={r.work_item} />
        <Meta label="圖說 / 規範依據" value={r.linked_spec_section || '—'} />
        <Meta label="優先級" value={r.priority} />
        <Meta label="提問人" value={`${r.asked_by} · ${r.asked_at}`} />
        <Meta label="受理單位" value={r.assigned_to} />
        <Meta label="回覆期限" value={r.due_date || '—'} />
      </div>

      {(r.cost_impact || r.schedule_impact) && (
        <div className="mt-4 bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700 space-y-1">
          <div className="font-medium flex items-center gap-2"><ImpactTags rfi={r} /> 影響說明</div>
          {r.schedule_impact && <div>⏱ 工期：{r.schedule_note || '—'}</div>}
          {r.cost_impact && <div>💰 費用：{r.cost_note || '—'}</div>}
        </div>
      )}

      <div className="mt-4">
        <div className="text-xs font-medium text-slate-400 mb-1">疑義內容</div>
        <p className="text-sm text-slate-700 bg-slate-50 border border-slate-100 rounded-lg p-3">{r.question}</p>
      </div>

      {r.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.attachments.map((a) => <Badge key={a} color="slate">📎 {a}</Badge>)}
        </div>
      )}

      {/* 監造回覆 */}
      {r.answer ? (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-400 mb-1">監造回覆</div>
          <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-sm text-slate-700">
            {r.answer}
            <div className="text-xs text-slate-400 mt-1.5">{r.answered_by} · {r.answered_at}</div>
          </div>
        </div>
      ) : null}

      {/* 依 ball-in-court 顯示操作 */}
      {awaitingCM && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="text-sm font-medium text-slate-700 mb-2">🟠 球在監造 — 回覆疑義</div>
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} placeholder="輸入正式回覆 / 技術澄清…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3" />
          <Button variant="success" onClick={() => answerRFI(r.rfi_id, answer)} disabled={!answer}>✓ 送出回覆 → 球轉回施工</Button>
        </div>
      )}

      {awaitingGC && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="text-sm font-medium text-slate-700 mb-2">🔴 球在施工廠商 — 確認回覆</div>
          <Button onClick={() => closeRFI(r.rfi_id)}>✓ 確認回覆無誤 → 結案</Button>
        </div>
      )}

      {!awaitingCM && !awaitingGC && (
        <div className="mt-5 border-t border-slate-100 pt-4 bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-sm text-emerald-700">
          ✓ 本 RFI 已結案，澄清結果已歸檔，可作為施工依據並納入報表。
        </div>
      )}
    </Card>
  )
}

function Meta({ label, value }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-700">{value}</div>
    </div>
  )
}
