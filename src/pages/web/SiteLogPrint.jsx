import { useMemo } from 'react'
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { parseLocalDate } from '../../lib/dates.js'

const qf = (n) => (n == null || n === '' || isNaN(n) ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }))
// 民國年月日
const roc = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${y - 1911} 年 ${m} 月 ${d} 日`
}

// 公共工程施工日誌（工程會 101.10.17 修正公定格式）— 不套 WebLayout，整頁即文件
export default function SiteLogPrint() {
  const { project, workItems, siteLogs, currentUser } = useStore()
  const [sp] = useSearchParams()
  const navigate = useNavigate()

  const d = sp.get('d')
  const log = siteLogs.find((l) => l.log_date === d) || siteLogs[0]

  const byKey = useMemo(() => new Map((workItems?.items || []).map((it) => [it.item_key, it])), [workItems])

  // 累計（含本日）：工項數量、出工、機具、材料
  const cum = useMemo(() => {
    if (!log) return { items: new Map(), labor: new Map(), equip: new Map(), mat: new Map() }
    const upTo = siteLogs.filter((l) => l.log_date <= log.log_date)
    const items = new Map(), labor = new Map(), equip = new Map(), mat = new Map()
    const acc = (m, k, v) => m.set(k, (m.get(k) || 0) + (Number(v) || 0))
    for (const l of upTo) {
      for (const [k, q] of Object.entries(l.items || {})) acc(items, k, q)
      for (const r of l.labor || []) acc(labor, r.type, r.count)
      for (const r of l.equipment || []) acc(equip, r.name, r.count)
      for (const r of l.materials || []) acc(mat, `${r.name}||${r.unit || ''}`, r.qty)
    }
    return { items, labor, equip, mat }
  }, [siteLogs, log])

  if (!currentUser) return <Navigate to="/login" replace />
  if (!log) {
    return (
      <div className="p-10 text-center text-slate-400">
        無施工日誌。<button onClick={() => navigate('/site-log')} className="text-[var(--blue-text)] underline">返回施工日誌</button>
      </div>
    )
  }

  const ex = log.extras || {}
  const calDay = project.start_date && log.log_date
    ? Math.round((parseLocalDate(log.log_date) - parseLocalDate(project.start_date)) / 86400000) + 1
    : null
  const rows = Object.entries(log.items || {})
    .map(([k, q]) => ({ it: byKey.get(k) || { description: k }, q, c: cum.items.get(k) || 0 }))
    .sort((a, b) => (a.it.sort_order || 0) - (b.it.sort_order || 0))

  const Sec = ({ n, title, children }) => (
    <div className="border border-slate-400 border-t-0">
      <div className="px-2 py-1 text-[13px] font-bold bg-slate-100 border-b border-slate-300">{n}、{title}</div>
      <div className="px-2 py-1.5 text-[13px]">{children}</div>
    </div>
  )
  const Th = ({ children, right }) => <th className={`border border-slate-300 px-1.5 py-0.5 font-medium text-[12px] ${right ? 'text-right' : 'text-left'}`}>{children}</th>
  const Td = ({ children, right }) => <td className={`border border-slate-300 px-1.5 py-0.5 text-[12px] ${right ? 'text-right tabular-nums' : ''}`}>{children}</td>
  const Check = ({ on, label }) => <span className="mr-3">{on ? '■' : '□'} {label}</span>

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white py-6 print:py-0">
      {/* 工具列（列印時隱藏）*/}
      <div className="max-w-[210mm] mx-auto mb-3 flex justify-between print:hidden px-1">
        <button onClick={() => navigate('/site-log')} className="text-sm text-slate-600 hover:underline">← 返回施工日誌</button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-sm font-medium bg-[var(--primary)] text-white rounded-lg px-4 py-1.5">
          <Printer size={15} aria-hidden />列印 / 存 PDF
        </button>
      </div>

      {/* A4 文件 */}
      <div className="max-w-[210mm] mx-auto bg-white text-slate-900 shadow print:shadow-none p-[12mm] print:p-0">
        <h1 className="text-center text-lg font-bold tracking-widest">公共工程施工日誌</h1>
        <p className="text-center text-[12px] text-slate-500 mt-0.5 mb-2">（承攬廠商每日填報）</p>

        {/* 表頭 */}
        <div className="border border-slate-400 text-[13px]">
          <div className="grid grid-cols-2">
            <div className="px-2 py-1 border-b border-r border-slate-300"><span className="text-slate-500">工程名稱：</span>{project.project_name}</div>
            <div className="px-2 py-1 border-b border-slate-300"><span className="text-slate-500">承攬廠商：</span>{project.contractor_name || '—'}</div>
          </div>
          <div className="grid grid-cols-3">
            <div className="px-2 py-1 border-r border-slate-300"><span className="text-slate-500">日期：</span>{roc(log.log_date)}{calDay ? `（開工後第 ${calDay} 日曆天）` : ''}</div>
            <div className="px-2 py-1 border-r border-slate-300"><span className="text-slate-500">天氣（上午）：</span>{log.weather_am || log.weather || '—'}</div>
            <div className="px-2 py-1"><span className="text-slate-500">天氣（下午）：</span>{log.weather_pm || log.weather_am || log.weather || '—'}</div>
          </div>
        </div>

        {/* 一、施工項目 */}
        <Sec n="一" title="依施工計畫書執行按圖施工概況（重要施工項目及完成數量）">
          {rows.length === 0 ? '本日無工項數量紀錄。' : (
            <table className="w-full border-collapse my-0.5">
              <thead><tr><Th>項次</Th><Th>施工項目</Th><Th>單位</Th><Th right>契約數量</Th><Th right>本日完成</Th><Th right>累計完成</Th></tr></thead>
              <tbody>
                {rows.map(({ it, q, c }, i) => (
                  <tr key={i}>
                    <Td>{it.item_no || ''}</Td><Td>{it.description}</Td><Td>{it.unit || ''}</Td>
                    <Td right>{qf(it.quantity)}</Td><Td right>{qf(q)}</Td><Td right>{qf(c)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {log.work_summary && <div className="mt-1"><span className="text-slate-500">工作摘要：</span>{log.work_summary}</div>}
        </Sec>

        {/* 二、材料 */}
        <Sec n="二" title="工地材料管理概況（重要材料使用狀況）">
          {(log.materials || []).length === 0 ? '本日無材料使用紀錄。' : (
            <table className="w-full border-collapse my-0.5">
              <thead><tr><Th>材料名稱</Th><Th>單位</Th><Th right>本日使用數量</Th><Th right>累計使用數量</Th></tr></thead>
              <tbody>
                {log.materials.map((m, i) => (
                  <tr key={i}><Td>{m.name}</Td><Td>{m.unit || ''}</Td><Td right>{qf(m.qty)}</Td><Td right>{qf(cum.mat.get(`${m.name}||${m.unit || ''}`))}</Td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Sec>

        {/* 三、出工及機具 */}
        <Sec n="三" title="工地人員及機具管理（出工人數及機具使用情形）">
          <div className="grid grid-cols-2 gap-3">
            <table className="w-full border-collapse">
              <thead><tr><Th>工別</Th><Th right>本日人數</Th><Th right>累計人數</Th></tr></thead>
              <tbody>
                {(log.labor || []).length === 0 ? <tr><Td>—</Td><Td right /><Td right /></tr>
                  : log.labor.map((r, i) => <tr key={i}><Td>{r.type}</Td><Td right>{qf(r.count)}</Td><Td right>{qf(cum.labor.get(r.type))}</Td></tr>)}
                {(log.labor || []).length > 0 && (
                  <tr><Td><b>合計</b></Td><Td right><b>{qf(log.labor.reduce((s, r) => s + (Number(r.count) || 0), 0))}</b></Td>
                    <Td right><b>{qf([...cum.labor.values()].reduce((s, v) => s + v, 0))}</b></Td></tr>
                )}
              </tbody>
            </table>
            <table className="w-full border-collapse">
              <thead><tr><Th>機具名稱</Th><Th right>本日數量</Th><Th right>累計數量</Th></tr></thead>
              <tbody>
                {(log.equipment || []).length === 0 ? <tr><Td>—</Td><Td right /><Td right /></tr>
                  : log.equipment.map((r, i) => <tr key={i}><Td>{r.name}</Td><Td right>{qf(r.count)}</Td><Td right>{qf(cum.equip.get(r.name))}</Td></tr>)}
              </tbody>
            </table>
          </div>
        </Sec>

        {/* 四、技術士 */}
        <Sec n="四" title="本日施工項目是否有須設置技術士之專業工程">
          <Check on={!!ex.technicians} label="有" /><Check on={!ex.technicians} label="無" />
          {ex.technicians && <span className="ml-2">種類及人數：{ex.technicians}</span>}
        </Sec>

        {/* 五、安衛 */}
        <Sec n="五" title="工地職業安全衛生事項之辦理情形">
          <div>1. 實施勤前教育（含工地環境及作業危害告知）：<Check on={ex.edu === true} label="有" /><Check on={ex.edu === false} label="無" /></div>
          <div>2. 新進勞工是否提報勞工保險及安全衛生教育訓練：
            <Check on={ex.insured === '有'} label="有" /><Check on={ex.insured === '無'} label="無" /><Check on={!ex.insured || ex.insured === '無新進勞工'} label="無新進勞工" />
          </div>
          <div>3. 檢查勞工個人防護具：<Check on={ex.ppe === true} label="有" /><Check on={ex.ppe === false} label="無" /></div>
          {ex.safety_other && <div>4. 其他：{ex.safety_other}</div>}
        </Sec>

        <Sec n="六" title="施工取樣試驗紀錄">{ex.sampling || '無。'}</Sec>
        <Sec n="七" title="通知協力廠商辦理事項">{ex.notice || '無。'}</Sec>
        <Sec n="八" title="重要事項紀錄">{ex.important || '無。'}</Sec>

        {/* 簽章 */}
        <div className="grid grid-cols-2 gap-10 mt-8 text-center text-[13px]">
          <div><div className="border-t border-slate-500 pt-1 mt-8">工地主任（簽章）</div></div>
          <div><div className="border-t border-slate-500 pt-1 mt-8">專任工程人員（簽章）</div></div>
        </div>
        <p className="text-[11px] text-slate-400 mt-4">
          依行政院公共工程委員會 101.10.17 修正「公共工程施工日誌」格式編製；累計數量由系統自施工日誌自動彙計。
        </p>
      </div>
    </div>
  )
}
