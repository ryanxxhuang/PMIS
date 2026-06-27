import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'

const photoTypes = ['施工進度', '自主檢查', '監造查驗', '缺失', '改善完成', '材料進場', '安衛', '其他']

export default function PhotoUpload() {
  const { photos } = useStore()
  const navigate = useNavigate()

  return (
    <div className="space-y-3">
      <button className="w-full bg-[#f26722] text-white rounded-xl py-10 flex flex-col items-center gap-2">
        <span className="text-4xl">📷</span>
        <span className="font-medium">拍照</span>
        <span className="text-xs opacity-80">自動記錄時間、上傳者、工項、工區</span>
      </button>

      <div className="bg-white rounded-xl p-3 border border-slate-200 space-y-2 text-sm">
        <div className="text-xs text-slate-400">標註（拍照後自動帶入，可修改）</div>
        <Row label="工區" value="A 區 1F" />
        <Row label="工項" value="混凝土工程" />
        <div>
          <div className="text-xs text-slate-500 mb-1">照片類型</div>
          <div className="flex flex-wrap gap-1.5">
            {photoTypes.map((t, i) => (
              <span key={t} className={`text-xs px-2 py-1 rounded-full border ${i === 0 ? 'bg-[#fdf0e9] text-[#c2410c] border-[#f7c4a6]' : 'border-slate-200 text-slate-500'}`}>{t}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="text-xs font-medium text-slate-400 px-1">本案照片（{photos.length}）</div>
      {photos.length === 0 ? (
        <div className="text-center text-slate-400 text-xs py-6 bg-white rounded-xl border border-slate-100">尚無照片</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {photos.map((p) => (
            <div key={p.photo_id} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <div className="h-24 bg-gradient-to-br from-slate-300 to-slate-400 flex items-center justify-center text-3xl">📷</div>
              <div className="p-2">
                <div className="text-xs text-slate-700 truncate">{p.caption}</div>
                <div className="text-[10px] text-slate-400">{p.photo_type} · {p.taken_by}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => navigate('/m/home')} className="w-full text-slate-500 text-sm py-2">← 回首頁</button>
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
