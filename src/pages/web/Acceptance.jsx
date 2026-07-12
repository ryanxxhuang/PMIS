// 驗收結算:報竣 → 竣工確認 → 初驗 → (缺失改善 → 複驗) → 正式驗收 → 結算證明 → 保固。
// 法定期限(採購法細則 §92/93/94、採購法 §73)自前一階段實際日自動起算,逾期紅字+進提醒中心。
// 機關主導、廠商報竣、監造陪驗——三方都能登錄(伺服器 RLS 同步放行本表)。
import { useState, useMemo } from 'react'
import { BadgeCheck, CalendarClock, CheckCircle2, Circle, AlertTriangle } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Badge, Button, Input, Select, PageHeader } from '../../components/ui.jsx'
import { deriveAcceptance, needsFixFlow, acceptanceAlerts } from '../../lib/acceptance.js'
import { DEMO_PORTFOLIO } from '../../data/demoSeed.js'

const RESULT_STAGES = new Set(['initial', 'reinspect', 'final']) // 這幾關要記合格/不合格

// 伺服器 acceptance_events_guard 矩陣的鏡像(僅 UX;真正強制在 DB trigger,
// 見 migration 20260712000100_acceptance_events_rbac.sql)
const STAGE_ORGS = {
  report: ['contractor'], confirm: ['supervisor', 'owner'], initial: ['owner'],
  fix: ['contractor'], reinspect: ['supervisor', 'owner'], final: ['owner'],
  certificate: ['owner'], warranty: ['owner'],
}

export default function Acceptance() {
  const { acceptanceEvents, recordAcceptanceEvent, clearAcceptanceEvent, demoMode, project, currentUser, can } = useStore()
  const [errMsg, setErrMsg] = useState('')
  const org = currentUser?.org_type || 'contractor'
  // 專案管理者=授權主驗(正式模式=關);demo 刻意不套 admin 例外,保留三方角色劇本
  const canStage = (key) => (!demoMode && can.override) || (STAGE_ORGS[key] || []).includes(org)

  const stages = useMemo(() => deriveAcceptance(acceptanceEvents), [acceptanceEvents])
  const fixFlow = needsFixFlow(acceptanceEvents)
  const alerts = useMemo(() => acceptanceAlerts(acceptanceEvents), [acceptanceEvents])
  const visible = stages.filter((s) => !s.optional || fixFlow || s.event)

  const reportDate = stages.find((s) => s.key === 'report')?.event?.event_date
  const finalStage = stages.find((s) => s.key === 'final')
  const warrantyDate = stages.find((s) => s.key === 'warranty')?.event?.event_date

  // demo 的驗收 storyline 屬於 B 區(見 DEMO_PORTFOLIO);真實專案顯示本案
  const displayName = demoMode ? DEMO_PORTFOLIO[0].name : project.project_name

  return (
    <div className="space-y-5">
      <PageHeader
        title="驗收結算" tagline="Acceptance"
        subtitle={`${displayName} — 報竣到保固的法定時程,期限自動起算、逾期即提醒。`}
        meta={[
          { k: '報竣日', v: reportDate || '—' },
          { k: '驗收合格', v: (finalStage?.event?.result === '合格' && finalStage.event.event_date) || '—' },
          { k: '保固起算', v: warrantyDate || '—' },
        ]}
      />

      {errMsg && (
        <div className="flex items-start justify-between gap-2 text-sm bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2">
          <span>{errMsg}</span>
          <button onClick={() => setErrMsg('')} className="shrink-0 text-rose-400 hover:text-rose-700" aria-label="關閉錯誤訊息">✕</button>
        </div>
      )}

      {demoMode && (
        <div className="text-xs rounded-lg border border-[var(--border-2)] bg-[var(--blue-tint)]/50 text-[var(--text-2)] px-3 py-2">
          示範資料：<b>{DEMO_PORTFOLIO[0].name}</b>（驗收中）。真實專案將顯示該案自己的驗收時程。
        </div>
      )}

      {alerts.length > 0 && (
        <Card bodyClass="p-0">
          <ul className="divide-y divide-[var(--border-2)]">
            {alerts.map((a) => (
              <li key={a.stage} className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
                <AlertTriangle size={15} className={a.level === 'overdue' ? 'text-[var(--red-text)]' : 'text-[var(--amber-text)]'} aria-hidden />
                <span className={`font-medium ${a.level === 'overdue' ? 'text-[var(--red-text)]' : 'text-[var(--text)]'}`}>{a.title}</span>
                <span className="text-[var(--text-3)] text-xs">{a.meta}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="驗收流程" bodyClass="p-0">
        <ol>
          {visible.map((s, i) => (
            <StageRow key={s.key} stage={s} last={i === visible.length - 1}
              allowed={canStage(s.key)}
              onSave={async (patch) => {
                setErrMsg('')
                const { error } = await recordAcceptanceEvent(s.key, patch)
                if (error) setErrMsg(`「${s.label}」登錄失敗：${error.message}`)
                return { error }
              }}
              onClear={async () => {
                setErrMsg('')
                const { error } = await clearAcceptanceEvent(s.key)
                if (error) setErrMsg(`「${s.label}」撤銷失敗：${error.message}`)
                return { error }
              }} />
          ))}
        </ol>
      </Card>

      <p className="text-xs text-[var(--text-3)] leading-relaxed">
        期限依據：竣工確認＝報竣後 7 日（採購法施行細則 §92）、初驗＝竣工確認後 30 日（§93）、
        正式驗收＝初驗合格後 20 日（§94）、結算驗收證明書＝驗收後 15 日（採購法 §73、細則 §101）。
        初驗記「不合格」會自動展開「缺失改善 → 複驗」兩關。實際期限以契約及主管機關函釋為準。
      </p>
    </div>
  )
}

function StageRow({ stage, last, allowed, onSave, onClear }) {
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(stage.event?.event_date || '')
  const [result, setResult] = useState(stage.event?.result || '')
  const [note, setNote] = useState(stage.event?.note || '')
  const done = stage.state === 'done'

  const save = async () => {
    if (!date) return
    const res = await onSave({ event_date: date, result: RESULT_STAGES.has(stage.key) ? (result || '合格') : null, note })
    if (!res?.error) setEditing(false) // 失敗保持編輯狀態,錯誤訊息顯示在頁面 banner
  }

  const dueBadge = !done && stage.due && (
    <span className={`inline-flex items-center gap-1 text-[11px] num ${stage.overdue ? 'text-[var(--red-text)] font-semibold' : 'text-[var(--text-3)]'}`}>
      <CalendarClock size={12} aria-hidden />
      期限 {stage.due}{stage.daysLeft != null && (stage.overdue ? `（逾期 ${-stage.daysLeft} 天）` : `（還有 ${stage.daysLeft} 天）`)}
    </span>
  )

  return (
    <li className={`flex gap-3 px-5 py-4 ${!last ? 'border-b border-[var(--border-2)]' : ''}`}>
      {/* 時間軸節點 */}
      <div className="flex flex-col items-center pt-0.5">
        {done
          ? <CheckCircle2 size={20} className="text-[var(--green-text)] shrink-0" aria-hidden />
          : stage.overdue
            ? <AlertTriangle size={20} className="text-[var(--red-text)] shrink-0" aria-hidden />
            : <Circle size={20} className={stage.state === 'due' ? 'text-[var(--blue)]' : 'text-[var(--border)]'} aria-hidden />}
        {!last && <span className="flex-1 w-px bg-[var(--border-2)] mt-1.5" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={`text-sm font-semibold ${done ? 'text-[var(--text)]' : stage.state === 'due' ? 'text-[var(--text)]' : 'text-[var(--text-3)]'}`}>
            {stage.label}
          </span>
          <span className="text-[11px] text-[var(--text-3)]">主辦：{stage.by}</span>
          {stage.event?.result && <Badge color={stage.event.result === '合格' ? 'green' : 'red'}>{stage.event.result}</Badge>}
          {dueBadge}
        </div>
        <div className="text-[11px] text-[var(--text-3)] mt-0.5">{stage.basis}</div>

        {done && !editing ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="num text-[var(--text)]">{stage.event.event_date}</span>
            {stage.event.note && <span className="text-[var(--text-2)] text-xs">{stage.event.note}</span>}
            {allowed && <button onClick={() => setEditing(true)} className="text-xs text-[var(--blue-text)] hover:underline">修改</button>}
          </div>
        ) : !allowed ? (
          (stage.state === 'due' || stage.state === 'pending') && (
            <div className="mt-1.5 text-[11px] text-[var(--text-3)]">由{stage.by === '—' ? '機關' : stage.by}登錄</div>
          )
        ) : (editing || stage.state === 'due' || (!done && stage.state === 'pending')) && (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="block text-[11px] text-[var(--text-3)] mb-0.5">實際辦理日</span>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="!w-40 !py-1.5" />
            </label>
            {RESULT_STAGES.has(stage.key) && (
              <label className="block">
                <span className="block text-[11px] text-[var(--text-3)] mb-0.5">結果</span>
                <Select value={result} onChange={(e) => setResult(e.target.value)} className="!w-28 !py-1.5">
                  <option value="">—</option>
                  <option value="合格">合格</option>
                  <option value="不合格">不合格</option>
                </Select>
              </label>
            )}
            <label className="block flex-1 min-w-[180px]">
              <span className="block text-[11px] text-[var(--text-3)] mb-0.5">備註</span>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="會勘/驗收紀要…" className="!py-1.5" />
            </label>
            <Button size="sm" onClick={save} disabled={!date}>登錄</Button>
            {editing && (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>取消</Button>
                <Button size="sm" variant="ghost" className="!text-[var(--red-text)]" onClick={async () => { const res = await onClear(); if (!res?.error) { setEditing(false); setDate(''); setResult(''); setNote('') } }}>撤銷此階段</Button>
              </>
            )}
          </div>
        )}
      </div>
      {done && <BadgeCheck size={16} className="text-[var(--green-text)] shrink-0 mt-1 hidden sm:block" aria-hidden />}
    </li>
  )
}
