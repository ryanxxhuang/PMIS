import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Button, StatusBadge, Badge } from '../../components/ui.jsx'

// demo 用：一本「契約全本」，包山包海，使用者只需上傳這一個檔
const presetContract = { name: 'A區新建工程_工程契約全本.pdf', type: '工程契約（全本）', pages: 312 }

export default function ContractUpload() {
  const { documents, requirements, uploadContract, runAIExtraction, aiStatus } = useStore()
  const navigate = useNavigate()

  const uploaded = documents.length > 0
  // AI 解析完成後，從要求反推「這本契約裡 AI 自動辨識出的內含文件 / 章節」
  const detected = [...new Set(requirements.map((r) => r.source_document))]

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">契約上傳</h1>
        <p className="text-slate-500 text-sm mt-1">
          上傳「整本」工程契約即可 — 不用拆檔、不用標文件類型。AI 會自動辨識裡面的施工規範、品質計畫書、
          三級品管表單，並解析出現場要執行的要求、表單與查驗流程。支援 PDF / Word，可上百頁。
        </p>
      </div>

      <Card title="上傳契約">
        {!uploaded ? (
          <div className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center">
            <div className="text-5xl mb-3">📚</div>
            <p className="text-slate-600 text-sm font-medium mb-1">把整本契約拖曳到此，或點下方按鈕</p>
            <p className="text-slate-400 text-xs mb-5">
              系統會自動拆解章節、辨識文件類型、抽取契約要求 — 你只要上傳這一個檔。
            </p>
            <Button onClick={() => uploadContract(presetContract.name, presetContract.type)}>
              ＋ 上傳契約全本（demo 範例 · 約 {presetContract.pages} 頁）
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">📕</span>
              <div>
                <div className="font-medium text-slate-800">{documents[0].document_name}</div>
                <div className="text-xs text-slate-400">
                  {documents[0].document_type} · {documents[0].version} · 上傳者 {documents[0].uploaded_by} · {documents[0].uploaded_at}
                </div>
              </div>
            </div>
            <StatusBadge status={documents[0].status} />
          </div>
        )}
      </Card>

      {uploaded && (
        <Card
          title="AI 解析"
          action={
            aiStatus !== 'done' ? (
              <Button onClick={runAIExtraction} disabled={aiStatus === 'processing'}>
                {aiStatus === 'processing' ? '🤖 AI 解析中…' : '🤖 啟動 AI 解析整本契約'}
              </Button>
            ) : (
              <Button variant="success" onClick={() => navigate('/ai-review')}>查看解析結果 →</Button>
            )
          }
        >
          {aiStatus === 'idle' && (
            <p className="text-sm text-slate-500">
              點右上「啟動 AI 解析」，系統會通讀整本契約，辨識內含文件、抽取要求、表單、檢驗停留點與來源頁碼。
            </p>
          )}

          {aiStatus === 'processing' && (
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-sm text-violet-700 flex items-center gap-2">
              <span className="animate-spin">⏳</span>
              AI 正在通讀整本契約、拆解章節、辨識施工規範 / 品質計畫書、抽取契約要求與來源頁碼…（非同步處理）
            </div>
          )}

          {aiStatus === 'done' && (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-medium text-slate-400 mb-1.5">AI 自動辨識內含文件 / 章節</div>
                <div className="flex flex-wrap gap-2">
                  {detected.map((d) => (
                    <Badge key={d} color="purple">📄 {d}</Badge>
                  ))}
                </div>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-sm text-emerald-700">
                ✓ 解析完成：從這本契約抽取出 <b>{requirements.length}</b> 項契約要求，每項都標註了來源頁碼與章節。
                請至「AI 解析審核」進行人工確認。
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
