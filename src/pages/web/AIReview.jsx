import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Button, Badge, StatusBadge, Empty, SourceTag } from '../../components/ui.jsx'

export default function AIReview() {
  const { requirements, setRequirementStatus, createFormFromRequirement } = useStore()
  const navigate = useNavigate()

  const handleCreateForm = (r) => {
    createFormFromRequirement(r)
    navigate('/form-builder')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">AI 解析審核</h1>
        <p className="text-slate-500 text-sm mt-1">
          AI 解析結果<b>必須經人工審核</b>才能進入正式 PMIS workflow。每項要求都附原始文件來源、頁碼、章節與信心分數。
        </p>
      </div>

      {requirements.length === 0 ? (
        <Card><Empty>尚無解析結果，請先到「契約上傳」啟動 AI 解析</Empty></Card>
      ) : (
        <div className="space-y-4">
          {requirements.map((r) => (
            <Card key={r.requirement_id}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className="font-semibold text-slate-800">{r.title}</h3>
                    <Badge color="blue">{r.requirement_type}</Badge>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm text-slate-600 mt-2">
                    <Meta label="工項" value={r.work_item} />
                    <Meta label="負責角色" value={r.required_role} />
                    <Meta label="審查角色" value={r.reviewer_role} />
                    <Meta label="頻率" value={r.frequency} />
                    <Meta label="需填表單" value={r.required_form} />
                    <Meta label="需照片" value={r.required_photo ? '是' : '否'} />
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <SourceTag doc={r.source_document} page={r.source_page} section={r.source_section} />
                    <div className="text-xs">
                      <span className="text-slate-400">信心分數</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div className={`h-full ${r.confidence_score > 0.9 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${r.confidence_score * 100}%` }} />
                        </div>
                        <span className="font-medium text-slate-600">{Math.round(r.confidence_score * 100)}%</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 w-40 shrink-0">
                  {r.status === 'Approved' ? (
                    <>
                      <div className="text-center text-emerald-600 text-sm font-medium">✓ 已核准</div>
                      {r.requirement_type === 'Inspection' && (
                        <Button variant="success" onClick={() => handleCreateForm(r)}>📝 建立表單</Button>
                      )}
                    </>
                  ) : r.status === 'Rejected' ? (
                    <div className="text-center text-rose-500 text-sm">已拒絕</div>
                  ) : (
                    <>
                      <Button variant="success" onClick={() => setRequirementStatus(r.requirement_id, 'Approved')}>✓ Approve</Button>
                      <Button variant="secondary">✎ Edit</Button>
                      <Button variant="ghost" onClick={() => setRequirementStatus(r.requirement_id, 'Rejected')}>✕ Reject</Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function Meta({ label, value }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-700">{value}</div>
    </div>
  )
}
