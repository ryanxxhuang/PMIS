import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Button, Badge, StatusBadge, Empty, SourceTag } from '../../components/ui.jsx'

const fieldTypeLabel = {
  auto: '自動帶入', select: '下拉選單', passfail: '合格/不合格',
  photo: '照片上傳', textarea: '長文字', signature: '簽名', text: '文字',
}

export default function FormBuilder() {
  const { forms, publishForm } = useStore()
  const navigate = useNavigate()
  const form = forms[0]

  if (!form) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800">AI 表單產生器</h1>
        <Card><Empty>尚未建立表單。請至「AI 解析審核」核准要求後按「建立表單」</Empty></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">AI 表單產生器</h1>
        <p className="text-slate-500 text-sm mt-1">AI 依契約與三級品管表單，自動轉換成手機可填寫的 digital form。可編輯後發布。</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* 左：欄位編輯 */}
        <div className="lg:col-span-2 space-y-4">
          <Card
            title={form.form_name}
            action={
              form.status === '已發布'
                ? <StatusBadge status="已發布" />
                : <Button variant="success" onClick={() => publishForm(form.form_template_id)}>🚀 發布表單</Button>
            }
          >
            <div className="flex items-center gap-2 mb-4">
              <Badge color="blue">{form.form_type}</Badge>
              <Badge color="slate">{form.work_item}</Badge>
              <Badge color="purple">{form.version}</Badge>
              <SourceTag doc="工程契約_施工規範.pdf" page={form.source_page} />
            </div>
            <div className="space-y-2">
              {form.fields.map((f) => (
                <div key={f.key} className="flex items-center justify-between border border-slate-200 rounded-lg px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-700">{f.label}</span>
                    {f.required && <span className="text-rose-500 text-xs">必填</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {f.type === 'auto' && <span className="text-xs text-slate-400">{f.value}</span>}
                    <Badge color={f.type === 'auto' ? 'green' : 'slate'}>{fieldTypeLabel[f.type]}</Badge>
                  </div>
                </div>
              ))}
            </div>
            {form.status === '已發布' && (
              <div className="mt-4 bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-sm text-emerald-700">
                ✓ 表單已發布，現場工程師可在手機端填寫。
                <button onClick={() => navigate('/m/self-inspection')} className="ml-2 underline">前往手機填寫 →</button>
              </div>
            )}
          </Card>
        </div>

        {/* 右：手機預覽 */}
        <div>
          <div className="text-sm font-medium text-slate-600 mb-2">手機預覽</div>
          <div className="bg-black rounded-[2rem] p-2 shadow-lg">
            <div className="bg-slate-50 rounded-[1.6rem] overflow-hidden">
              <div className="bg-[#f26722] text-white px-4 py-3 text-sm font-semibold">{form.form_name}</div>
              <div className="p-3 space-y-2.5 max-h-[460px] overflow-auto">
                {form.fields.map((f) => (
                  <div key={f.key}>
                    <div className="text-xs text-slate-500 mb-1">{f.label}{f.required && <span className="text-rose-500"> *</span>}</div>
                    {f.type === 'passfail' ? (
                      <div className="flex gap-2">
                        <span className="flex-1 text-center text-xs border border-emerald-300 text-emerald-600 rounded py-1.5">合格</span>
                        <span className="flex-1 text-center text-xs border border-slate-200 text-slate-400 rounded py-1.5">不合格</span>
                      </div>
                    ) : f.type === 'photo' ? (
                      <div className="border border-dashed border-slate-300 rounded py-3 text-center text-xs text-slate-400">📷 拍照 / 上傳</div>
                    ) : f.type === 'signature' ? (
                      <div className="border border-dashed border-slate-300 rounded py-3 text-center text-xs text-slate-400">✍️ 簽名區</div>
                    ) : (
                      <div className="border border-slate-200 rounded py-1.5 px-2 text-xs text-slate-400 bg-white">
                        {f.type === 'auto' ? f.value : f.type === 'select' ? '請選擇…' : '輸入…'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
