import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Done } from './SelfInspection.jsx'

export default function InspectionRequest() {
  const { selfInspection, inspectionRequest, submitInspectionRequest } = useStore()
  const navigate = useNavigate()

  if (!selfInspection) {
    return (
      <div className="text-center text-slate-400 text-sm py-10">
        請先完成自主檢查表，<br />才能提出查驗申請。
        <button onClick={() => navigate('/m/self-inspection')} className="block mx-auto mt-4 text-[#f26722] text-sm">前往自主檢查 →</button>
      </div>
    )
  }

  if (inspectionRequest) {
    return (
      <Done
        title="查驗申請已送出"
        desc="監造已收到通知，將排程現場查驗。可切換到監造端執行查驗。"
        next="切換到監造查驗"
        onNext={() => navigate('/m/supervisor-inspection')}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl p-4 border border-slate-200 space-y-3 text-sm">
        <div className="font-medium text-slate-800">混凝土澆置前查驗</div>
        <Row label="工項" value="混凝土工程" />
        <Row label="工區" value="A 區 1F" />
        <Row label="預定查驗時間" value="2026-06-18 09:00" />
        <Row label="聯絡人" value="陳怡君 / 0912-xxx-xxx" />
      </div>

      <div className="bg-white rounded-xl p-4 border border-slate-200 space-y-2 text-sm">
        <div className="text-xs font-medium text-slate-400">自動帶入資料</div>
        <Attach icon="📋" label="混凝土澆置前自主檢查表" tag="已送出" />
        <Attach icon="📷" label="現場照片 ×1" tag="已附" />
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600">
        查驗申請必須綁定至少一份自主檢查表 — 系統已自動帶入。
      </div>

      <button onClick={submitInspectionRequest} className="w-full bg-[#f26722] text-white rounded-xl py-3 font-medium">
        送出查驗申請
      </button>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  )
}

function Attach({ icon, label, tag }) {
  return (
    <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2">
      <span>{icon}</span>
      <span className="flex-1 text-slate-700">{label}</span>
      <span className="text-xs text-emerald-600">{tag}</span>
    </div>
  )
}
