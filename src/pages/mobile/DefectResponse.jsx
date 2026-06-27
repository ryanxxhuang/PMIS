import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Done } from './SelfInspection.jsx'

export default function DefectResponse() {
  const { defect, submitDefectImprovement } = useStore()
  const navigate = useNavigate()
  const [note, setNote] = useState('已依規範重新調整鋼筋保護層墊塊，量測達 4cm 以上。')
  const [photo, setPhoto] = useState(false)

  if (!defect) {
    return <div className="text-center text-slate-400 text-sm py-10">目前沒有待改善的缺失。</div>
  }

  if (defect.status !== 'Open') {
    return (
      <Done
        title="改善已送出複查"
        desc="監造將進行複查。可切換到監造端執行複查結案。"
        next="切換到監造複查"
        onNext={() => navigate('/m/supervisor-inspection')}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
        <div className="font-medium text-rose-700 text-sm">⚠️ {defect.title}</div>
        <div className="text-xs text-rose-500 mt-1">{defect.description}</div>
        <div className="text-xs text-rose-400 mt-2">改善期限：{defect.due_date} · 責任單位：{defect.assigned_to}</div>
      </div>

      <div className="bg-white rounded-xl p-3 border border-slate-200">
        <div className="text-xs text-slate-500 mb-1">改善說明</div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      <div className="bg-white rounded-xl p-3 border border-slate-200">
        <div className="text-xs text-slate-500 mb-1">改善照片 <span className="text-rose-500">*</span></div>
        <button
          onClick={() => setPhoto(true)}
          className={`w-full border border-dashed rounded-lg py-4 text-sm ${photo ? 'border-emerald-400 text-emerald-600 bg-emerald-50' : 'border-slate-300 text-slate-400'}`}
        >
          {photo ? '✓ 已拍攝改善照片' : '📷 拍攝改善完成照片'}
        </button>
      </div>

      <button
        onClick={() => submitDefectImprovement(note)}
        disabled={!photo || !note}
        className="w-full bg-[#f26722] text-white rounded-xl py-3 font-medium disabled:opacity-40"
      >
        送出改善，提請複查
      </button>
    </div>
  )
}
