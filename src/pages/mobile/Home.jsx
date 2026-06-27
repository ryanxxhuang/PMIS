import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'

export default function MobileHome() {
  const navigate = useNavigate()
  const { forms, selfInspection, inspectionRequest, defect, requirements, dailyLogs } = useStore()

  const approvedReq = requirements.filter((r) => r.status === 'Approved')
  const formReady = forms.some((f) => f.status === '已發布' || f.status === '草稿')
  const hasLog = dailyLogs.length > 0

  const tasks = [
    {
      label: '今日施工日誌', sub: hasLog ? '已送出（可填監造日報）' : '自動帶入天氣 / 照片 / 查驗 / 缺失',
      icon: '📓', done: hasLog, disabled: false, to: '/m/daily-log',
    },
    {
      label: '今日自主檢查', sub: formReady ? '混凝土澆置前自主檢查表' : '等待表單發布',
      icon: '✅', done: !!selfInspection, disabled: !formReady, to: '/m/self-inspection',
    },
    {
      label: '待送查驗', sub: inspectionRequest ? `已送出（${inspectionRequest.status}）` : '完成自主檢查後可送出',
      icon: '🔍', done: !!inspectionRequest, disabled: !selfInspection, to: '/m/inspection-request',
    },
    {
      label: '待改善缺失', sub: defect ? `${defect.title}（${defect.status}）` : '無',
      icon: '⚠️', done: defect?.status === 'Closed' || defect?.status === 'Submitted for Review', disabled: !defect, to: '/m/defect-response',
    },
  ]

  return (
    <div className="space-y-4">
      <div className="bg-[#f26722] text-white rounded-xl p-4">
        <div className="text-xs opacity-80">A 區新建工程</div>
        <div className="text-lg font-bold">今日待辦</div>
        <div className="text-xs opacity-80 mt-1">2026-06-17 · 晴 ☀️</div>
      </div>

      <button
        onClick={() => navigate('/m/photo')}
        className="w-full bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 shadow-sm"
      >
        <span className="text-2xl">📷</span>
        <div className="text-left">
          <div className="font-medium text-slate-800 text-sm">快速拍照</div>
          <div className="text-xs text-slate-400">拍照自動帶入工項、時間、上傳者</div>
        </div>
      </button>

      <div className="text-xs font-medium text-slate-400 px-1">契約要求待辦</div>
      {approvedReq.length === 0 ? (
        <div className="text-center text-slate-400 text-xs py-4 bg-white rounded-xl border border-slate-100">
          尚無已核准的契約要求<br />（請先於 Web 端完成 AI 解析與審核）
        </div>
      ) : (
        tasks.map((t) => (
          <button
            key={t.label}
            disabled={t.disabled}
            onClick={() => navigate(t.to)}
            className={`w-full bg-white rounded-xl p-3.5 flex items-center gap-3 shadow-sm border ${
              t.disabled ? 'border-slate-100 opacity-50' : 'border-slate-200'
            }`}
          >
            <span className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${t.done ? 'bg-emerald-100' : 'bg-[#fdf0e9]'}`}>
              {t.done ? '✓' : t.icon}
            </span>
            <div className="text-left flex-1">
              <div className="font-medium text-slate-800 text-sm">{t.label}</div>
              <div className="text-xs text-slate-400">{t.sub}</div>
            </div>
            <span className="text-slate-300">›</span>
          </button>
        ))
      )}
    </div>
  )
}
