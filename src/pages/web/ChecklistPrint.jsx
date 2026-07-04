import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { useStore } from '../../store.jsx'

// 民國年月日
const roc = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${y - 1911} 年 ${m} 月 ${d} 日`
}

// 自主檢查表(可列印/存 PDF)— 對齊公共工程自主檢查表通行格式
export default function ChecklistPrint() {
  const { project, checklistTemplates, checklistRecords, currentUser } = useStore()
  const [sp] = useSearchParams()
  const navigate = useNavigate()

  const rec = checklistRecords.find((r) => r.id === sp.get('id')) || checklistRecords[0]
  const tpl = rec && checklistTemplates.find((t) => t.id === rec.template_id)

  if (!currentUser) return <Navigate to="/login" replace />
  if (!rec || !tpl) {
    return (
      <div className="p-10 text-center text-slate-400">
        無檢查紀錄。<button onClick={() => navigate('/quality')} className="text-[var(--blue-text)] underline">返回品質查驗</button>
      </div>
    )
  }

  const Th = ({ children, right, w }) => <th className={`border border-slate-300 px-1.5 py-1 font-medium text-[12px] ${right ? 'text-right' : 'text-left'} ${w || ''}`}>{children}</th>
  const Td = ({ children, right, center }) => <td className={`border border-slate-300 px-1.5 py-1 text-[12px] ${right ? 'text-right tabular-nums' : center ? 'text-center' : ''}`}>{children}</td>

  let lastGroup = null
  return (
    <div className="min-h-screen bg-slate-200 print:bg-white py-6 print:py-0">
      <div className="max-w-[210mm] mx-auto mb-3 flex justify-between print:hidden px-1">
        <button onClick={() => navigate('/quality')} className="text-sm text-slate-600 hover:underline">← 返回品質查驗</button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-sm font-medium bg-[var(--primary)] text-white rounded-lg px-4 py-1.5">
          <Printer size={15} aria-hidden />列印 / 存 PDF
        </button>
      </div>

      <div className="max-w-[210mm] mx-auto bg-white text-slate-900 shadow print:shadow-none p-[12mm] print:p-0">
        <h1 className="text-center text-lg font-bold tracking-widest">自 主 檢 查 表</h1>
        <p className="text-center text-[12px] text-slate-500 mt-0.5 mb-2">（承攬廠商一級品管）</p>

        <div className="border border-slate-400 text-[13px]">
          <div className="grid grid-cols-2">
            <div className="px-2 py-1 border-b border-r border-slate-300"><span className="text-slate-500">工程名稱：</span>{project.project_name}</div>
            <div className="px-2 py-1 border-b border-slate-300"><span className="text-slate-500">檢查表：</span>{tpl.title}</div>
          </div>
          <div className="grid grid-cols-3">
            <div className="px-2 py-1 border-r border-slate-300"><span className="text-slate-500">檢查日期：</span>{roc(rec.check_date)}</div>
            <div className="px-2 py-1 border-r border-slate-300"><span className="text-slate-500">檢查位置：</span>{rec.location || '—'}</div>
            <div className="px-2 py-1"><span className="text-slate-500">依據：</span>{tpl.source}</div>
          </div>
        </div>

        <table className="w-full border-collapse mt-2">
          <thead>
            <tr>
              <Th w="w-12">項次</Th><Th>檢查項目</Th><Th>檢查標準</Th><Th right w="w-24">實測值</Th><Th w="w-14">判定</Th>
            </tr>
          </thead>
          <tbody>
            {tpl.items.map((it) => {
              const r = rec.results?.[it.no] || {}
              const groupRow = it.group !== lastGroup
              lastGroup = it.group
              return [
                groupRow && (
                  <tr key={`g-${it.group}`}><td colSpan={5} className="border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[12px] font-bold">{it.group}</td></tr>
                ),
                <tr key={it.no}>
                  <Td center>{it.no}</Td>
                  <Td>{it.item}</Td>
                  <Td>{it.standard}{it.source ? <span className="text-slate-400">（{it.source}）</span> : ''}</Td>
                  <Td right>{r.value === true ? '✓' : r.value === false ? '✗' : r.value ?? ''}{typeof r.value === 'number' && it.unit ? ` ${it.unit}` : ''}</Td>
                  <Td center>{r.pass === true ? '○' : r.pass === false ? '✕' : '／'}</Td>
                </tr>,
              ]
            })}
          </tbody>
        </table>

        <div className="border border-slate-400 border-t-0 text-[13px] px-2 py-1.5">
          檢查結果：
          <span className="mx-2">{rec.overall === '合格' ? '■' : '□'} 全部合格</span>
          <span className="mx-2">{rec.overall === '不合格' ? '■' : '□'} 有缺失（系統已自動開立缺失單追蹤改善）</span>
          {rec.note && <div className="mt-1"><span className="text-slate-500">備註：</span>{rec.note}</div>}
        </div>

        <div className="grid grid-cols-2 gap-10 mt-8 text-center text-[13px]">
          <div><div className="border-t border-slate-500 pt-1 mt-8">檢查人員（簽章）</div></div>
          <div><div className="border-t border-slate-500 pt-1 mt-8">工地主任（簽章）</div></div>
        </div>
        <p className="text-[11px] text-slate-400 mt-4">
          ○＝合格　✕＝不合格　／＝本次未檢查。判定由系統依範本量化標準自動產生。
        </p>
      </div>
    </div>
  )
}
