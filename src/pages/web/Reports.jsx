import { useState } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Button, StatusBadge, Empty } from '../../components/ui.jsx'

export default function Reports() {
  const { reports, generateReports, defect, selfInspection, supervisorResult } = useStore()
  const [preview, setPreview] = useState(null)

  const canGenerate = !!supervisorResult

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">報表中心</h1>
        <p className="text-slate-500 text-sm mt-1">系統從現場資料（日誌、查驗、缺失、照片）自動產出正式工程報表，AI 摘要可編輯後匯出。</p>
      </div>

      <Card
        title="產生報表"
        action={
          reports.length === 0 ? (
            <Button onClick={generateReports} disabled={!canGenerate}>⚙️ 一鍵產生本案報表</Button>
          ) : (
            <span className="text-sm text-emerald-600">✓ 已產出 {reports.length} 份</span>
          )
        }
      >
        {!canGenerate && reports.length === 0 && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-sm text-amber-700">
            請先完成手機端的自主檢查與監造查驗流程，系統才有資料可產出報表。
          </div>
        )}

        {reports.length === 0 ? (
          <Empty>尚未產出報表</Empty>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {reports.map((r) => (
              <div key={r.report_id} className="border border-slate-200 rounded-lg p-4 hover:border-[#f7a072] transition">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-slate-800">📄 {r.report_type}</div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="text-xs text-slate-400 mt-1">{r.date_range} · 產出者：{r.generated_by} · {r.generated_at}</div>
                <div className="flex gap-2 mt-3">
                  <Button variant="secondary" className="text-xs py-1.5" onClick={() => setPreview(r)}>預覽</Button>
                  <Button variant="ghost" className="text-xs py-1.5">匯出 PDF</Button>
                  <Button variant="ghost" className="text-xs py-1.5">Word</Button>
                  <Button variant="ghost" className="text-xs py-1.5">Excel</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {preview && (
        <Card title={`報表預覽 — ${preview.report_type}`} action={<Button variant="ghost" onClick={() => setPreview(null)}>✕ 關閉</Button>}>
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-700 space-y-3">
            <div className="text-center border-b border-slate-200 pb-3">
              <div className="text-lg font-bold">A 區新建工程 — {preview.report_type}</div>
              <div className="text-xs text-slate-400 mt-1">工程編號 TPE-A-2026 · {preview.date_range}</div>
            </div>
            <div className="bg-violet-50 border border-violet-200 rounded p-3">
              <div className="text-xs font-medium text-violet-700 mb-1">🤖 AI 摘要（可編輯）</div>
              <p className="text-slate-600 leading-relaxed">
                本期完成混凝土澆置前自主檢查 1 件，監造現場查驗 1 件，查驗結果不合格並開立缺失「鋼筋保護層不足」1 件；
                施工廠商已完成改善並上傳照片，經監造複查{defect?.status === 'Closed' ? '合格結案' : '中'}。
              </p>
            </div>
            <ReportRow label="自主檢查" value={selfInspection ? '混凝土澆置前自主檢查表（已送出）' : '—'} />
            <ReportRow label="監造查驗結果" value={supervisorResult ? (supervisorResult.pass ? '合格' : '不合格') : '—'} />
            <ReportRow label="缺失" value={defect ? `${defect.title}（${defect.status}）` : '無'} />
            <ReportRow label="附件照片" value="2 張（自主檢查、改善完成）" />
            <div className="text-xs text-slate-400 border-t border-slate-200 pt-2">產出時間：{preview.generated_at} · 產出者：{preview.generated_by}</div>
          </div>
        </Card>
      )}
    </div>
  )
}

function ReportRow({ label, value }) {
  return (
    <div className="flex border-b border-slate-100 pb-1.5">
      <span className="w-28 text-slate-400 shrink-0">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  )
}
