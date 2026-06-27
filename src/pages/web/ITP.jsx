import { Link } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Button, Badge, Stat, Empty, SourceTag } from '../../components/ui.jsx'

// 檢驗停留點 / ITP（查驗點計畫）— 對應 SCOPE.md M2
// Requirement 與 自主檢查 / 監造查驗 之間的中間層：回答「這個工項何時必須通知監造」
export default function ITP() {
  const { itp, requirements, generateITP } = useStore()

  const approved = requirements.filter((r) => r.status === 'Approved')
  const canGenerate = approved.some((r) => ['Inspection', 'Test Report'].includes(r.requirement_type))

  const holds = itp.filter((p) => p.point_type === 'H')
  // 依工項分組
  const groups = itp.reduce((acc, p) => {
    (acc[p.work_item] ||= []).push(p)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">檢驗停留點 / ITP（查驗點計畫）</h1>
        <p className="text-slate-500 text-sm mt-1">
          AI 從已核准的契約要求展開查驗停留點，定義每個工項「由誰檢查、合格標準、查驗頻率，以及何時必須通知監造到場」。
          這是契約要求與現場自主檢查 / 監造查驗之間的連結層。
        </p>
      </div>

      <Card
        title="產生查驗點計畫"
        action={
          itp.length === 0 ? (
            <Button onClick={generateITP} disabled={!canGenerate}>🤖 AI 從契約要求展開查驗點</Button>
          ) : (
            <Button variant="secondary" onClick={generateITP}>↻ 依最新核准要求重新展開</Button>
          )
        }
      >
        {!canGenerate && itp.length === 0 ? (
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-sm text-amber-700">
            尚無已核准的查驗 / 試驗類契約要求。請先至 <Link to="/ai-review" className="underline">AI 解析審核</Link> 核准要求。
          </div>
        ) : itp.length === 0 ? (
          <Empty>尚未展開查驗點，點右上按鈕由 AI 從契約要求產生。</Empty>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="查驗點總數" value={itp.length} sub="來自契約要求" color="text-[#f26722]" />
            <Stat label="H 停留點" value={holds.length} sub="監造未到場不得續作" color="text-rose-600" />
            <Stat label="第一級自主檢查" value={itp.filter((p) => p.inspection_class.startsWith('第一級')).length} sub="施工廠商" color="text-slate-800" />
            <Stat label="第二級監造" value={itp.filter((p) => p.inspection_class.startsWith('第二級')).length} sub="監造查驗 / 見證" color="text-emerald-600" />
          </div>
        )}
      </Card>

      {itp.length > 0 && (
        <>
          <Legend />
          {holds.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-sm text-rose-700">
              🛑 共 <b>{holds.length}</b> 個 <b>H 停留點（限制點）</b>：{holds.map((p) => p.title).join('、')}。
              此類查驗點<strong>監造未到場查驗前，施工廠商不得續作</strong>，系統將於現場端提醒通知監造。
            </div>
          )}

          {Object.entries(groups).map(([workItem, points]) => (
            <Card key={workItem} title={`${workItem}（${points.length} 點）`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                      <th className="py-2 pr-3 font-medium">查驗項目</th>
                      <th className="py-2 px-3 font-medium">品管等級</th>
                      <th className="py-2 px-3 font-medium">停留點</th>
                      <th className="py-2 px-3 font-medium">合格標準</th>
                      <th className="py-2 px-3 font-medium">頻率</th>
                      <th className="py-2 px-3 font-medium">對應表單</th>
                      <th className="py-2 pl-3 font-medium">契約來源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p) => (
                      <tr key={p.itp_id} className="border-b border-slate-50 align-top">
                        <td className="py-3 pr-3">
                          <div className="font-medium text-slate-800">{p.title}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{p.required_role} → {p.reviewer_role}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-600 whitespace-nowrap">{p.inspection_class}</td>
                        <td className="py-3 px-3"><PointBadge type={p.point_type} /></td>
                        <td className="py-3 px-3 text-slate-600 max-w-xs">{p.acceptance_criteria}</td>
                        <td className="py-3 px-3 text-slate-600 whitespace-nowrap">{p.frequency}</td>
                        <td className="py-3 px-3 text-slate-600">{p.form_name}</td>
                        <td className="py-3 pl-3 w-52">
                          <SourceTag doc={p.source_document} page={p.source_page} section={p.source_section} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}

const POINT = {
  H: { color: 'red', label: 'H 停留點' },
  W: { color: 'amber', label: 'W 見證點' },
  R: { color: 'blue', label: 'R 文審點' },
}

function PointBadge({ type }) {
  const p = POINT[type] || POINT.R
  return <Badge color={p.color}>{p.label}</Badge>
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 px-1">
      <span className="font-medium text-slate-600">停留點類型：</span>
      <span className="flex items-center gap-1.5"><Badge color="red">H 停留點</Badge> 限制點，監造未到場不得續作</span>
      <span className="flex items-center gap-1.5"><Badge color="amber">W 見證點</Badge> 監造可到場見證，不強制</span>
      <span className="flex items-center gap-1.5"><Badge color="blue">R 文審點</Badge> 以文件 / 自主檢查表審查</span>
    </div>
  )
}
