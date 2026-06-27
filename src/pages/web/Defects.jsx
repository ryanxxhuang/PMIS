import { useStore } from '../../store.jsx'
import { Card, Badge, StatusBadge, Empty, SourceTag } from '../../components/ui.jsx'

export default function Defects() {
  const { defect } = useStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">缺失追蹤</h1>
        <p className="text-slate-500 text-sm mt-1">缺失從開立、改善、複查到結案的完整紀錄，歷程不可刪除。</p>
      </div>

      {!defect ? (
        <Card><Empty>目前無缺失。缺失會在監造查驗不合格時自動建立。</Empty></Card>
      ) : (
        <Card>
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-800">{defect.title}</h3>
                <Badge color="red">{defect.defect_type}</Badge>
                <StatusBadge status={defect.status} />
              </div>
              <div className="text-sm text-slate-500 mt-1">{defect.defect_id} · {defect.work_item} · {defect.location}</div>
            </div>
            <div className="text-right text-sm">
              <div className="text-slate-400">改善期限</div>
              <div className="font-medium text-rose-600">{defect.due_date}</div>
            </div>
          </div>

          <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3">{defect.description}</p>
          <div className="mt-3"><SourceTag doc="工程契約_施工規範.pdf" page="p.42" section={defect.source_section} /></div>

          {/* 時間軸 */}
          <div className="mt-5 space-y-4">
            <Timeline icon="📋" color="bg-rose-500" title="缺失開立" who={defect.created_by} time={defect.created_at} active>
              <div className="flex gap-2 mt-2">
                {defect.defect_photos.map((p) => <PhotoChip key={p} label={p} />)}
              </div>
            </Timeline>

            {defect.improvement_note ? (
              <Timeline icon="🔧" color="bg-[#f26722]" title="施工廠商改善" who="林志明" time="改善完成" active>
                <p className="text-sm text-slate-600 mt-1">{defect.improvement_note}</p>
                <div className="flex gap-2 mt-2">
                  {defect.improvement_photos.map((p) => <PhotoChip key={p} label={p} />)}
                </div>
              </Timeline>
            ) : (
              <Timeline icon="🔧" color="bg-slate-300" title="施工廠商改善" who="待處理" time="—" />
            )}

            {defect.status === 'Closed' ? (
              <Timeline icon="✅" color="bg-emerald-500" title="監造複查結案" who="王建國" time={defect.closed_at} active>
                <p className="text-sm text-emerald-600 mt-1">複查合格，缺失結案。</p>
              </Timeline>
            ) : (
              <Timeline icon="✅" color="bg-slate-300" title="監造複查結案" who="待複查" time="—" />
            )}
          </div>

          <div className="mt-5 text-xs text-slate-400">
            缺失改善由施工廠商於手機端「缺失改善」頁回覆；監造於「監造查驗」端複查結案。
          </div>
        </Card>
      )}
    </div>
  )
}

function Timeline({ icon, color, title, who, time, active, children }) {
  return (
    <div className="flex gap-3">
      <div className={`w-8 h-8 rounded-full ${color} text-white flex items-center justify-center shrink-0 ${active ? '' : 'opacity-40'}`}>{icon}</div>
      <div className={`flex-1 ${active ? '' : 'opacity-50'}`}>
        <div className="flex items-center justify-between">
          <span className="font-medium text-slate-700 text-sm">{title}</span>
          <span className="text-xs text-slate-400">{who} · {time}</span>
        </div>
        {children}
      </div>
    </div>
  )
}

function PhotoChip({ label }) {
  return (
    <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg px-2 py-1 text-xs text-slate-600">
      <span>📷</span> {label}
    </div>
  )
}
