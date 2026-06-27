import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'

export default function SupervisorInspection() {
  const { inspectionRequest, supervisorResult, defect, submitSupervisorInspection, closeDefect } = useStore()
  const navigate = useNavigate()
  const [result, setResult] = useState(null) // 'pass' | 'fail'
  const [photo, setPhoto] = useState(false)

  if (!inspectionRequest) {
    return <div className="text-center text-slate-400 text-sm py-10">目前沒有待查驗的申請。<br />請先由施工廠商送出查驗申請。</div>
  }

  // 查驗已送出後 → 顯示缺失複查階段
  if (supervisorResult) {
    return <ReviewDefect defect={defect} onClose={closeDefect} navigate={navigate} />
  }

  const submit = () => {
    submitSupervisorInspection({ pass: result === 'pass' })
  }

  return (
    <div className="space-y-3">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
        🔍 收到查驗申請：{inspectionRequest.title}（{inspectionRequest.location}）
      </div>

      {/* 施工廠商提交資料 */}
      <div className="bg-white rounded-xl p-3 border border-slate-200 space-y-2 text-sm">
        <div className="text-xs font-medium text-slate-400">施工廠商自主檢查資料</div>
        <Ref icon="📋" label="混凝土澆置前自主檢查表" />
        <Ref icon="📷" label="現場照片 ×1" />
        <div className="text-xs text-slate-400 pt-1">所有檢查項目：施工廠商自評合格</div>
      </div>

      {/* 監造查驗表 */}
      <div className="bg-white rounded-xl p-3 border border-slate-200">
        <div className="text-xs font-medium text-slate-400 mb-2">監造查驗結果</div>
        <div className="flex gap-2">
          <button
            onClick={() => setResult('pass')}
            className={`flex-1 py-3 rounded-lg text-sm border ${result === 'pass' ? 'bg-emerald-500 text-white border-emerald-500' : 'border-slate-300 text-slate-500'}`}
          >
            ✓ 合格
          </button>
          <button
            onClick={() => setResult('fail')}
            className={`flex-1 py-3 rounded-lg text-sm border ${result === 'fail' ? 'bg-rose-500 text-white border-rose-500' : 'border-slate-300 text-slate-500'}`}
          >
            ✕ 不合格
          </button>
        </div>
        {result === 'fail' && (
          <div className="mt-2 bg-rose-50 border border-rose-200 rounded-lg p-2 text-xs text-rose-600">
            不合格將自動建立缺失：<b>鋼筋保護層不足</b>（AI 建議分類與規範依據）
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl p-3 border border-slate-200">
        <div className="text-xs text-slate-500 mb-1">監造查驗照片</div>
        <button
          onClick={() => setPhoto(true)}
          className={`w-full border border-dashed rounded-lg py-3 text-sm ${photo ? 'border-emerald-400 text-emerald-600 bg-emerald-50' : 'border-slate-300 text-slate-400'}`}
        >
          {photo ? '✓ 已拍攝查驗照片' : '📷 拍照'}
        </button>
      </div>

      <p className="text-center text-xs text-slate-400">demo 提示：選「不合格」可走完整缺失流程</p>
      <button
        onClick={submit}
        disabled={!result}
        className="w-full bg-[#f26722] text-white rounded-xl py-3 font-medium disabled:opacity-40"
      >
        送出查驗結果
      </button>
    </div>
  )
}

function ReviewDefect({ defect, onClose, navigate }) {
  if (!defect) {
    // 查驗合格、無缺失
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl mb-4">✓</div>
        <div className="text-lg font-bold text-slate-800">查驗合格，結案</div>
        <p className="text-sm text-slate-500 mt-2">查驗紀錄已產生，可至報表中心匯出。</p>
      </div>
    )
  }

  const waiting = defect.status === 'Open' // 還沒改善
  const closed = defect.status === 'Closed'

  return (
    <div className="space-y-3">
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
        <div className="font-medium text-rose-700 text-sm">⚠️ 缺失：{defect.title}</div>
        <div className="text-xs text-rose-500 mt-1">{defect.description}</div>
      </div>

      {waiting ? (
        <div className="text-center text-slate-400 text-sm py-6 bg-white rounded-xl border border-slate-100">
          等待施工廠商改善中…<br />
          <button onClick={() => navigate('/m/defect-response')} className="text-[#f26722] mt-3">切換到施工端改善 →</button>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl p-3 border border-slate-200 space-y-2 text-sm">
            <div className="text-xs font-medium text-slate-400">施工廠商改善回覆</div>
            <p className="text-slate-600 text-xs">{defect.improvement_note}</p>
            <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 text-xs">
              <span>📷</span> 改善照片：保護層墊塊已加設
            </div>
          </div>

          {closed ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700 text-center">
              ✓ 複查合格，缺失已結案。系統可產出查驗紀錄與缺失改善表。
              <button onClick={() => navigate('/m/home')} className="block mx-auto mt-2 text-emerald-700 underline text-xs">回首頁</button>
            </div>
          ) : (
            <>
              <div className="text-xs font-medium text-slate-400 px-1">監造複查</div>
              <div className="flex gap-2">
                <button onClick={() => onClose(false)} className="flex-1 py-3 rounded-xl text-sm border border-slate-300 text-slate-500">退回改善</button>
                <button onClick={() => onClose(true)} className="flex-1 py-3 rounded-xl text-sm bg-emerald-600 text-white">複查合格結案</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Ref({ icon, label }) {
  return (
    <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 text-slate-700">
      <span>{icon}</span> {label}
    </div>
  )
}
