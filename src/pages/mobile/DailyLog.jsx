import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'

// 施工日誌 / 監造日報 — 對應 PRD §13.6 / §13.7
// 重點：自動帶入當日照片 / 查驗 / 缺失，AI 產生可編輯摘要，監造日報可引用施工廠商日誌
export default function DailyLog() {
  const navigate = useNavigate()
  const { dailyLogs } = useStore()
  const [tab, setTab] = useState('contractor') // contractor | supervisor

  const contractorLog = dailyLogs.find((l) => l.log_type === 'contractor')
  const supervisorLog = dailyLogs.find((l) => l.log_type === 'supervisor')

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 bg-slate-100 rounded-xl p-1">
        {[
          { k: 'contractor', label: '施工日誌' },
          { k: 'supervisor', label: '監造日報' },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`py-2 rounded-lg text-sm font-medium ${tab === t.k ? 'bg-white text-[#f26722] shadow-sm' : 'text-slate-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'contractor'
        ? <ContractorForm existing={contractorLog} navigate={navigate} />
        : <SupervisorForm existing={supervisorLog} contractorLog={contractorLog} navigate={navigate} />}
    </div>
  )
}

// 從 store 算出當日自動帶入資料
function useToday() {
  const { photos, inspectionRequest, supervisorResult, defect, requirements } = useStore()
  return useMemo(() => {
    const inspections = []
    if (inspectionRequest) {
      const r = supervisorResult ? (supervisorResult.pass ? '合格' : '不合格') : '已申請待查驗'
      inspections.push(`混凝土澆置前查驗（${r}）`)
    }
    const defects = defect ? [`${defect.title}（${defect.status}）`] : []
    const workItems = [...new Set(requirements.filter((r) => r.status === 'Approved').map((r) => r.work_item).filter((w) => w && w !== '全工項'))]
    return {
      photos: photos.map((p) => p.caption),
      inspections,
      defects,
      workItems: workItems.length ? workItems : ['混凝土工程'],
    }
  }, [photos, inspectionRequest, supervisorResult, defect, requirements])
}

function ContractorForm({ existing, navigate }) {
  const { submitDailyLog } = useStore()
  const today = useToday()
  const [manpower, setManpower] = useState('')
  const [equipment, setEquipment] = useState('')
  const [materials, setMaterials] = useState('')
  const [summary, setSummary] = useState('')
  const [tomorrow, setTomorrow] = useState('')

  if (existing) {
    return <Submitted log={existing} navigate={navigate} report="施工日報" />
  }

  const genSummary = () => {
    const parts = [
      `本日於 A 區進行 ${today.workItems.join('、')} 施工。`,
      manpower ? `出工 ${manpower} 人。` : '',
      equipment ? `投入機具 ${equipment}。` : '',
      materials ? `材料進場：${materials}。` : '',
      today.inspections.length ? `完成混凝土澆置前自主檢查並送監造查驗（${today.inspections.join('、')}）。` : '',
      today.defects.length ? `監造查驗發現缺失「${today.defects.join('、')}」，已列管改善。` : '',
      '現場安全衛生正常。',
    ]
    setSummary(parts.filter(Boolean).join(''))
  }

  const canSubmit = manpower && summary
  const submit = () => {
    submitDailyLog('contractor', {
      work_items: today.workItems,
      work_areas: ['A 區 1F'],
      manpower: manpower ? [{ trade: '綜合工班', count: Number(manpower) }] : [],
      equipment: equipment ? [{ name: equipment }] : [],
      materials: materials ? [{ name: materials }] : [],
      work_summary: summary,
      today_inspections: today.inspections,
      today_defects: today.defects,
      today_photos: today.photos,
      tomorrow_plan: tomorrow,
      submitted_by: '林志明',
    })
  }

  return (
    <div className="space-y-3">
      <AutoFilled today={today} />

      <Section title="人力 / 機具 / 材料">
        <NumberField label="工班人數" required value={manpower} onChange={setManpower} suffix="人" />
        <TextField label="主要機具" value={equipment} onChange={setEquipment} placeholder="如：泵浦車 1、振動棒 2" />
        <TextField label="材料進場" value={materials} onChange={setMaterials} placeholder="如：預拌混凝土 80m³" />
      </Section>

      <Section title="今日施工摘要" action={<AiButton onClick={genSummary} />}>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={5}
          placeholder="可按右上「AI 產生」自動帶入，再手動編輯"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
        <p className="text-[11px] text-slate-400 mt-1">AI 依當日工項、查驗、缺失、人機料產生草稿，送出前可編輯（§22.3 Human-reviewed AI）</p>
      </Section>

      <Section title="明日預定">
        <textarea
          value={tomorrow}
          onChange={(e) => setTomorrow(e.target.value)}
          rows={2}
          placeholder="如：A 區 2F 鋼筋綁紮"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </Section>

      {!canSubmit && <p className="text-xs text-amber-600 text-center">⚠️ 工班人數與施工摘要為必填</p>}
      <button onClick={submit} disabled={!canSubmit} className="w-full bg-[#f26722] text-white rounded-xl py-3 font-medium disabled:opacity-40">
        送出施工日誌 → 產生施工日報
      </button>
    </div>
  )
}

function SupervisorForm({ existing, contractorLog, navigate }) {
  const { submitDailyLog } = useStore()
  const today = useToday()
  const [cite, setCite] = useState(true)
  const [sampling, setSampling] = useState('')
  const [opinion, setOpinion] = useState('')

  if (existing) {
    return <Submitted log={existing} navigate={navigate} report="監造日報" />
  }

  const genSummary = () => {
    const parts = [
      cite && contractorLog ? `施工廠商今日摘要：${contractorLog.work_summary}` : '',
      today.inspections.length ? `本日執行監造查驗：${today.inspections.join('、')}。` : '本日無查驗申請。',
      sampling ? `抽查事項：${sampling}。` : '',
      today.defects.length ? `開立 / 複查缺失：${today.defects.join('、')}。` : '',
    ]
    setOpinion(parts.filter(Boolean).join('\n'))
  }

  const canSubmit = opinion
  const submit = () => {
    submitDailyLog('supervisor', {
      ref_contractor_log_id: cite ? contractorLog?.daily_log_id : undefined,
      today_inspections: today.inspections,
      today_defects: today.defects,
      today_photos: today.photos,
      sampling_notes: sampling,
      supervisor_opinion: opinion,
      work_summary: opinion,
      submitted_by: '王建國',
    })
  }

  return (
    <div className="space-y-3">
      {/* 引用施工廠商日誌 — PRD §13.7 重點 */}
      <div className="bg-white rounded-xl p-3 border border-slate-200">
        <div className="text-xs font-medium text-slate-400 mb-2">施工廠商今日日誌</div>
        {contractorLog ? (
          <>
            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 rounded-lg p-2 border border-slate-100">{contractorLog.work_summary}</p>
            <label className="flex items-center gap-2 mt-2 text-sm text-slate-600">
              <input type="checkbox" checked={cite} onChange={(e) => setCite(e.target.checked)} />
              引用施工廠商日誌摘要至本日報
            </label>
          </>
        ) : (
          <p className="text-xs text-slate-400">施工廠商今日尚未送出日誌，可獨立填寫監造日報。</p>
        )}
      </div>

      <AutoFilled today={today} supervisor />

      <Section title="抽查事項">
        <textarea
          value={sampling}
          onChange={(e) => setSampling(e.target.value)}
          rows={2}
          placeholder="如：抽查 A 區 1F 鋼筋保護層、混凝土坍度"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </Section>

      <Section title="監造意見 / 日報摘要" action={<AiButton onClick={genSummary} />}>
        <textarea
          value={opinion}
          onChange={(e) => setOpinion(e.target.value)}
          rows={6}
          placeholder="可按右上「AI 產生」彙整（含引用施工廠商摘要），再手動編輯"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </Section>

      {!canSubmit && <p className="text-xs text-amber-600 text-center">⚠️ 監造意見為必填</p>}
      <button onClick={submit} disabled={!canSubmit} className="w-full bg-[#f26722] text-white rounded-xl py-3 font-medium disabled:opacity-40">
        送出監造日報 → 產生監造日報
      </button>
    </div>
  )
}

// 自動帶入資料卡（天氣 / 工項 / 照片 / 查驗 / 缺失）
function AutoFilled({ today, supervisor }) {
  return (
    <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-1.5">
      <div className="text-xs font-medium text-violet-700">🤖 系統自動帶入（2026-06-17）</div>
      <Row icon="☀️" label="天氣" value="晴 28°C" />
      <Row icon="🏗️" label="今日工項" value={today.workItems.join('、')} />
      <Row icon="📷" label="今日照片" value={today.photos.length ? `${today.photos.length} 張` : '無'} />
      <Row icon="🔍" label={supervisor ? '今日查驗' : '今日查驗事項'} value={today.inspections.length ? today.inspections.join('、') : '無'} />
      <Row icon="⚠️" label="今日缺失" value={today.defects.length ? today.defects.join('、') : '無'} />
    </div>
  )
}

function Submitted({ log, navigate, report }) {
  const { generateReports } = useStore()
  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center text-center py-4">
        <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-2xl mb-3">✓</div>
        <div className="text-base font-bold text-slate-800">{report}已送出</div>
        <p className="text-xs text-slate-500 mt-1">{log.submitted_by} · {log.submitted_at}</p>
      </div>

      <div className="bg-white rounded-xl p-3 border border-slate-200 space-y-2 text-sm">
        <div className="text-xs font-medium text-slate-400">摘要</div>
        <p className="text-slate-600 text-xs leading-relaxed whitespace-pre-line">{log.work_summary || log.supervisor_opinion}</p>
        {log.ref_contractor_log_id && <div className="text-[11px] text-violet-600">↳ 已引用施工廠商當日日誌</div>}
      </div>

      <div className="bg-white rounded-xl p-3 border border-slate-200 space-y-1.5 text-xs">
        <Row icon="📷" label="照片" value={log.today_photos?.length ? `${log.today_photos.length} 張` : '無'} />
        <Row icon="🔍" label="查驗" value={log.today_inspections?.length ? log.today_inspections.join('、') : '無'} />
        <Row icon="⚠️" label="缺失" value={log.today_defects?.length ? log.today_defects.join('、') : '無'} />
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700">
        ✓ 一筆日誌已可用於產出 {report}、查驗紀錄、照片紀錄表（One Record, Many Outputs）。送出後不可覆蓋，僅能建立修正版。
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => { generateReports(); navigate('/reports') }} className="bg-[#f26722] text-white rounded-xl py-2.5 text-sm font-medium">產出報表</button>
        <button onClick={() => navigate('/m/home')} className="bg-white border border-slate-300 text-slate-600 rounded-xl py-2.5 text-sm">回首頁</button>
      </div>
    </div>
  )
}

function Section({ title, action, children }) {
  return (
    <div className="bg-white rounded-xl p-3 border border-slate-200 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-slate-400">{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

function AiButton({ onClick }) {
  return (
    <button onClick={onClick} className="text-[11px] text-violet-600 bg-violet-50 border border-violet-200 rounded-full px-2.5 py-1 font-medium">
      🤖 AI 產生
    </button>
  )
}

function Row({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span>{icon}</span>
      <span className="text-slate-400 w-16 shrink-0">{label}</span>
      <span className="text-slate-700 flex-1">{value}</span>
    </div>
  )
}

function NumberField({ label, value, onChange, suffix, required }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}{required && <span className="text-rose-500"> *</span>}</span>
      <div className="flex items-center gap-2 mt-1">
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className="w-24 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        {suffix && <span className="text-sm text-slate-400">{suffix}</span>}
      </div>
    </label>
  )
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1" />
    </label>
  )
}
