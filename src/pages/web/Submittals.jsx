import { useState } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Button, Badge, Stat, StatusBadge, Empty, Field } from '../../components/ui.jsx'
import { submittalTypes } from '../../data/seed.js'

// 送審 Submittals — Procore 工作流：ball-in-court（球在誰手上）
// 保留三級品管主線，補上正式的 GC↔監造 送審往返
export default function Submittals() {
  const { submittals } = useStore()
  const [openId, setOpenId] = useState(null)
  const [creating, setCreating] = useState(false)

  const pendingCM = submittals.filter((s) => s.ball_in_court === '監造').length
  const pendingGC = submittals.filter((s) => s.ball_in_court === '施工廠商').length
  const approved = submittals.filter((s) => s.status === '核准' || s.status === '核准(具註記)').length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">送審 Submittals</h1>
          <p className="text-slate-500 text-sm mt-1 max-w-2xl">
            材料 / 施工計畫 / 配比 / 樣品送審的正式往來。採 Procore <b>ball-in-court</b> 機制，
            隨時看得到「球在誰手上」與每一次審查往返。
          </p>
        </div>
        <Button className="shrink-0 whitespace-nowrap" onClick={() => { setCreating((v) => !v); setOpenId(null) }}>＋ 新增送審</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="送審總數" value={submittals.length} sub="本案" color="text-slate-800" />
        <Stat label="待監造審查" value={pendingCM} sub="球在監造" color="text-amber-600" />
        <Stat label="待施工修正" value={pendingGC} sub="球在施工廠商" color={pendingGC ? 'text-rose-600' : 'text-slate-800'} />
        <Stat label="已核准" value={approved} sub="可施工 / 進場" color="text-emerald-600" />
      </div>

      {creating && <CreateForm onDone={() => setCreating(false)} />}

      <Card title={`送審清單（${submittals.length}）`}>
        {submittals.length === 0 ? (
          <Empty>尚無送審。點右上「新增送審」由施工廠商提出。</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-3 font-medium">送審編號</th>
                  <th className="py-2 px-3 font-medium">名稱</th>
                  <th className="py-2 px-3 font-medium">類型</th>
                  <th className="py-2 px-3 font-medium">版次</th>
                  <th className="py-2 px-3 font-medium">球在誰手上</th>
                  <th className="py-2 px-3 font-medium">狀態</th>
                  <th className="py-2 pl-3 font-medium">審查期限</th>
                </tr>
              </thead>
              <tbody>
                {submittals.map((s) => (
                  <tr
                    key={s.submittal_id}
                    onClick={() => { setOpenId(openId === s.submittal_id ? null : s.submittal_id); setCreating(false) }}
                    className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${openId === s.submittal_id ? 'bg-slate-50' : ''}`}
                  >
                    <td className="py-3 pr-3 font-mono text-xs text-slate-500">{s.submittal_no}</td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-800">{s.title}</div>
                      <div className="text-xs text-slate-400">{s.work_item}</div>
                    </td>
                    <td className="py-3 px-3 text-slate-600 whitespace-nowrap">{s.type}</td>
                    <td className="py-3 px-3 text-slate-600">Rev. {s.revision}</td>
                    <td className="py-3 px-3"><BallInCourt who={s.ball_in_court} /></td>
                    <td className="py-3 px-3"><StatusBadge status={s.status} /></td>
                    <td className="py-3 pl-3 text-slate-500 whitespace-nowrap">{s.due_date || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {openId && <Detail key={openId} submittal={submittals.find((s) => s.submittal_id === openId)} onClose={() => setOpenId(null)} />}
    </div>
  )
}

// 「球在誰手上」chip
function BallInCourt({ who }) {
  if (who === '監造') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">🟠 球在 監造</span>
  if (who === '施工廠商') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">🔴 球在 施工廠商</span>
  return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">✓ 已結束</span>
}

function CreateForm({ onDone }) {
  const { createSubmittal } = useStore()
  const [title, setTitle] = useState('')
  const [type, setType] = useState(submittalTypes[0])
  const [workItem, setWorkItem] = useState('混凝土工程')
  const [spec, setSpec] = useState('')
  const [note, setNote] = useState('')

  const submit = () => {
    createSubmittal({ title, type, work_item: workItem, spec_section: spec, note, due_date: '2026-06-22', attachments: ['送審文件.pdf'] })
    onDone()
  }

  return (
    <Card title="新增送審（施工廠商提出）">
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="送審名稱"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：止水帶材料送審" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></Field>
        <Field label="送審類型">
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {submittalTypes.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="工項">
          <select value={workItem} onChange={(e) => setWorkItem(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {['混凝土工程', '鋼筋工程', '模板工程', '土方工程'].map((w) => <option key={w}>{w}</option>)}
          </select>
        </Field>
        <Field label="規範依據"><input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="如：施工規範 3.2.1" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></Field>
        <div className="md:col-span-2">
          <Field label="送審說明"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="檢附文件說明…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></Field>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onDone}>取消</Button>
        <Button onClick={submit} disabled={!title}>提出送審 → 球轉給監造</Button>
      </div>
    </Card>
  )
}

function Detail({ submittal: s, onClose }) {
  const { reviewSubmittal, resubmitSubmittal } = useStore()
  const [note, setNote] = useState('')

  const awaitingCM = s.ball_in_court === '監造'
  const awaitingGC = s.ball_in_court === '施工廠商'

  return (
    <Card
      title={`${s.submittal_no} — ${s.title}`}
      action={<Button variant="ghost" onClick={onClose}>✕ 關閉</Button>}
    >
      <div className="grid md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
        <Meta label="送審類型" value={s.type} />
        <Meta label="工項" value={s.work_item} />
        <Meta label="版次" value={`Rev. ${s.revision}`} />
        <Meta label="規範依據" value={s.spec_section || '—'} />
        <Meta label="提送人" value={`${s.submitted_by} · ${s.submitted_at}`} />
        <Meta label="審查單位" value={s.reviewer} />
      </div>

      <div className="mt-4">
        <div className="text-xs font-medium text-slate-400 mb-1.5">附件</div>
        <div className="flex flex-wrap gap-2">
          {s.attachments.map((a) => <Badge key={a} color="slate">📎 {a}</Badge>)}
        </div>
      </div>

      {/* 審查歷程 timeline */}
      <div className="mt-5">
        <div className="text-xs font-medium text-slate-400 mb-2">審查往返歷程</div>
        <div className="space-y-3">
          {s.review_comments.map((c, i) => (
            <div key={i} className="flex gap-3">
              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                c.decision === '核准' || c.decision === '核准(具註記)' ? 'bg-emerald-500'
                  : c.decision === '退回修正' || c.decision === '駁回' ? 'bg-rose-500'
                  : 'bg-[#f26722]'
              }`} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-700 text-sm">{c.decision}</span>
                  <span className="text-xs text-slate-400">{c.by} · {c.role} · {c.at}</span>
                </div>
                {c.note && <div className="text-sm text-slate-600 mt-0.5">{c.note}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 依 ball-in-court 顯示對應操作 */}
      {awaitingCM && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="text-sm font-medium text-slate-700 mb-2">🟠 球在監造 — 審查決議</div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="審查意見（退回 / 註記時建議填寫）" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3" />
          <div className="flex flex-wrap gap-2">
            <Button variant="success" onClick={() => reviewSubmittal(s.submittal_id, '核准', note)}>✓ 核准</Button>
            <Button variant="success" onClick={() => reviewSubmittal(s.submittal_id, '核准(具註記)', note)}>✓ 核准（具註記）</Button>
            <Button variant="secondary" onClick={() => reviewSubmittal(s.submittal_id, '退回修正', note)}>↩ 退回修正</Button>
            <Button variant="danger" onClick={() => reviewSubmittal(s.submittal_id, '駁回', note)}>✕ 駁回</Button>
          </div>
        </div>
      )}

      {awaitingGC && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="text-sm font-medium text-slate-700 mb-2">🔴 球在施工廠商 — 依退回意見修正後重新送審</div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="修正說明…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3" />
          <Button onClick={() => resubmitSubmittal(s.submittal_id, note)}>↻ 重新送審（版次 +1）→ 球轉給監造</Button>
        </div>
      )}

      {!awaitingCM && !awaitingGC && (
        <div className="mt-5 border-t border-slate-100 pt-4 bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-sm text-emerald-700">
          ✓ 本送審已 <b>{s.status}</b>，往返結束。可作為該工項施工 / 材料進場依據，並納入報表。
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
