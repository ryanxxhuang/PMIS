import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Button, Badge, StatusBadge, Empty } from '../../components/ui.jsx'

export default function DailyLogs() {
  const { dailyLogs } = useStore()
  const [open, setOpen] = useState(null)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">施工日誌 / 監造日報</h1>
        <p className="text-slate-500 text-sm mt-1">
          現場用手機填寫一次，系統自動帶入當日照片、查驗、缺失並產生 AI 摘要。送出後不可覆蓋，僅能建立修正版。
        </p>
      </div>

      <Card
        title={`日誌清單（${dailyLogs.length}）`}
        action={<Link to="/m/daily-log" className="text-xs text-violet-600">📱 前往手機端填寫 →</Link>}
      >
        {dailyLogs.length === 0 ? (
          <Empty>尚無日誌。請至手機端「日誌」填寫施工日誌或監造日報。</Empty>
        ) : (
          <div className="space-y-2">
            {dailyLogs.map((l) => (
              <button
                key={l.daily_log_id}
                onClick={() => setOpen(l)}
                className="w-full flex items-center justify-between border border-slate-200 rounded-lg px-4 py-3 hover:border-[#f7a072] transition text-left"
              >
                <div>
                  <div className="font-medium text-slate-800 text-sm">
                    {l.log_type === 'supervisor' ? '🟦 監造日報' : '🟩 施工日誌'} · {l.log_date}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {l.submitted_by} · {l.submitted_at} · 天氣 {l.weather}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {l.ref_contractor_log_id && <Badge color="purple">引用施工日誌</Badge>}
                  <StatusBadge status={l.status} />
                  <span className="text-slate-300">›</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {open && <Detail log={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Detail({ log, onClose }) {
  const isSup = log.log_type === 'supervisor'
  return (
    <Card
      title={`${isSup ? '監造日報' : '施工日誌'} — ${log.log_date}`}
      action={<Button variant="ghost" onClick={onClose}>✕ 關閉</Button>}
    >
      <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-700 space-y-4">
        <div className="text-center border-b border-slate-200 pb-3">
          <div className="text-lg font-bold">A 區新建工程 — {isSup ? '監造日報' : '施工日報'}</div>
          <div className="text-xs text-slate-400 mt-1">
            工程編號 TPE-A-2026 · {log.log_date} · 天氣 {log.weather} · 填寫人 {log.submitted_by}
          </div>
        </div>

        <div className="bg-violet-50 border border-violet-200 rounded p-3">
          <div className="text-xs font-medium text-violet-700 mb-1">🤖 AI 摘要（可編輯）</div>
          <p className="text-slate-600 leading-relaxed whitespace-pre-line">{log.work_summary || log.supervisor_opinion || '—'}</p>
          {log.ref_contractor_log_id && <div className="text-[11px] text-violet-600 mt-1">↳ 本日報已引用施工廠商當日日誌</div>}
        </div>

        {!isSup && (
          <>
            <Row label="工項" value={log.work_items?.join('、') || '—'} />
            <Row label="工區" value={log.work_areas?.join('、') || '—'} />
            <Row label="人力" value={log.manpower?.map((m) => `${m.trade} ${m.count} 人`).join('、') || '—'} />
            <Row label="機具" value={log.equipment?.map((e) => e.name).join('、') || '—'} />
            <Row label="材料進場" value={log.materials?.map((m) => m.name).join('、') || '—'} />
          </>
        )}
        {isSup && <Row label="抽查事項" value={log.sampling_notes || '—'} />}

        <Row label="今日查驗" value={log.today_inspections?.length ? log.today_inspections.join('、') : '無'} />
        <Row label="今日缺失" value={log.today_defects?.length ? log.today_defects.join('、') : '無'} />
        <Row label="今日照片" value={log.today_photos?.length ? `${log.today_photos.length} 張（${log.today_photos.join('、')}）` : '無'} />
        {!isSup && <Row label="明日預定" value={log.tomorrow_plan || '—'} />}

        <div className="text-xs text-slate-400 border-t border-slate-200 pt-2">
          送出時間：{log.submitted_at} · 版本 {log.version} · 送出後不可覆蓋
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" className="text-xs py-1.5">匯出 PDF</Button>
          <Button variant="ghost" className="text-xs py-1.5">Word</Button>
        </div>
      </div>
    </Card>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex border-b border-slate-100 pb-1.5">
      <span className="w-24 text-slate-400 shrink-0">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  )
}
