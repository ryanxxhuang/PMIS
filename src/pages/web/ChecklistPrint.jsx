import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import PrintToolbar from '../../components/PrintToolbar.jsx'

// 民國年月日
const roc = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${y - 1911} 年 ${m} 月 ${d} 日`
}

// 自主檢查表(可列印/存 PDF)— 對齊公共工程自主檢查表通行格式。
// 工具列(chrome,吃主題 token)與紙面(.paper,固定白底黑字)分開處理,理由見 PrintToolbar 與 index.css。
export default function ChecklistPrint() {
  const { project, checklistTemplates, checklistRecords, currentUser } = useStore()
  const [sp] = useSearchParams()
  const navigate = useNavigate()

  const rec = checklistRecords.find((r) => r.id === sp.get('id')) || checklistRecords[0]
  const tpl = rec && checklistTemplates.find((t) => t.id === rec.template_id)
  // 修訂版次:此版若已被更新版取代,列印時必須標示(舊證據可查考但不可誤用)
  const supersededBy = rec && checklistRecords.find((r) => r.supersedes_id === rec.id)

  if (!currentUser) return <Navigate to="/login" replace />
  if (!rec || !tpl) {
    return (
      <div className="p-10 text-center text-[var(--text-2)]">
        無檢查紀錄。<button onClick={() => navigate('/quality')} className="text-[var(--blue-text)] underline">返回品質查驗</button>
      </div>
    )
  }

  const Th = ({ children, right, w }) => <th className={`border paper-rule px-1.5 py-1 font-medium text-footnote ${right ? 'text-right' : 'text-left'} ${w || ''}`}>{children}</th>
  const Td = ({ children, right, center }) => <td className={`border paper-rule px-1.5 py-1 text-footnote ${right ? 'text-right tabular-nums' : center ? 'text-center' : ''}`}>{children}</td>

  let lastGroup = null
  return (
    <div className="min-h-screen paper-desk py-6 print:py-0">
      <PrintToolbar backTo="/quality" backLabel="返回品質查驗" />

      <div className="max-w-[210mm] mx-auto paper shadow print:shadow-none p-[12mm] print:p-0">
        <h1 className="text-center text-lg font-bold tracking-widest">自 主 檢 查 表</h1>
        <p className="text-center text-footnote paper-mute mt-0.5 mb-2">（承攬廠商一級品管）{(rec.rev || 0) > 0 && <span className="ml-2 font-semibold paper-ink">修訂版次 Rev.{rec.rev}</span>}</p>

        {supersededBy && (
          <div className="border paper-danger-rule paper-danger text-footnote font-semibold px-2 py-1 mb-2">
            本表已由修訂版 Rev.{supersededBy.rev || '？'}（{roc(supersededBy.check_date)}）取代，僅供歷史查考。
          </div>
        )}

        <div className="border paper-rule-strong text-body">
          <div className="grid grid-cols-2">
            <div className="px-2 py-1 border-b border-r paper-rule"><span className="paper-mute">工程名稱：</span>{project.project_name}</div>
            <div className="px-2 py-1 border-b paper-rule"><span className="paper-mute">檢查表：</span>{tpl.title}</div>
          </div>
          <div className="grid grid-cols-3">
            <div className="px-2 py-1 border-r paper-rule"><span className="paper-mute">檢查日期：</span>{roc(rec.check_date)}</div>
            <div className="px-2 py-1 border-r paper-rule"><span className="paper-mute">檢查位置：</span>{rec.location || '—'}</div>
            <div className="px-2 py-1"><span className="paper-mute">依據：</span>{tpl.source}</div>
          </div>
          {(rec.rev || 0) > 0 && (
            <div className="px-2 py-1 border-t paper-rule"><span className="paper-mute">更正原因（Rev.{rec.rev}）：</span>{rec.revision_reason || '—'}</div>
          )}
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
                  <tr key={`g-${it.group}`}><td colSpan={5} className="border paper-rule paper-fill px-1.5 py-0.5 text-footnote font-bold">{it.group}</td></tr>
                ),
                <tr key={it.no}>
                  <Td center>{it.no}</Td>
                  <Td>{it.item}</Td>
                  <Td>{it.standard}{it.source ? <span className="paper-mute">（{it.source}）</span> : ''}</Td>
                  <Td right>{r.value === true ? '✓' : r.value === false ? '✗' : r.value ?? ''}{typeof r.value === 'number' && it.unit ? ` ${it.unit}` : ''}</Td>
                  <Td center>{r.pass === true ? '○' : r.pass === false ? '✕' : '／'}</Td>
                </tr>,
              ]
            })}
          </tbody>
        </table>

        <div className="border paper-rule-strong border-t-0 text-body px-2 py-1.5">
          檢查結果：
          <span className="mx-2">{rec.overall === '合格' ? '■' : '□'} 全部合格</span>
          <span className="mx-2">{rec.overall === '不合格' ? '■' : '□'} 有缺失（系統已自動開立缺失單追蹤改善）</span>
          {rec.note && <div className="mt-1"><span className="paper-mute">備註：</span>{rec.note}</div>}
        </div>

        <div className="grid grid-cols-2 gap-10 mt-8 text-center text-body">
          <div><div className="border-t paper-rule-strong pt-1 mt-8">檢查人員（簽章）</div></div>
          <div><div className="border-t paper-rule-strong pt-1 mt-8">工地主任（簽章）</div></div>
        </div>
        <p className="text-caption paper-mute mt-4">
          ○＝合格　✕＝不合格　／＝本次未檢查。判定由系統依範本量化標準自動產生。
        </p>
      </div>
    </div>
  )
}
