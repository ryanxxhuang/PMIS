// AI copilot 聊天核心(訊息串 + 建議問句 + 輸入),無外殼——由呼叫端(/assistant
// 頁的 Card 或右下角浮動面板)自己套 chrome。AI 優先 → demo/失敗回退確定性問答。
import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from './icons.jsx'
import { Button } from './ui.jsx'
import { answerQuestion, SUGGESTED_QUESTIONS } from '../lib/assistantQA.js'

// 保險:AI 偶爾仍輸出 Markdown,純文字面板會顯示 literal 星號/井號(P2-02)——顯示前清掉標記
const stripMd = (s) => String(s || '')
  .replace(/\*\*(.*?)\*\*/g, '$1').replace(/(^|\n)\s*#{1,6}\s+/g, '$1')
  .replace(/(^|\n)\s*[-*]\s+/g, '$1').replace(/\*/g, '')

// agent 查詢工具 → 使用者看得懂的模組名(steps 的「查了:…」小字用;與後端
// agentTools.ts 的七支唯讀工具一一對應,未知工具名原樣顯示)
const TOOL_LABEL = {
  search_boq: '標單工項',
  list_daily_logs: '施工日誌',
  get_valuation: '估驗計價',
  get_requirements: '履約需求',
  list_my_open_items: '待辦事項',
  find_evidence: '佐證勾稽',
  get_record: '單筆明細',
}
// 只列成功的查詢(ok:false 表示工具失敗,不該讓使用者以為有查到),並去重
const stepLabels = (steps) =>
  [...new Set((steps || []).filter((s) => s.ok !== false).map((s) => TOOL_LABEL[s.tool] || s.tool))]

// 回覆分流(PR #4 review 釘住的 fail-closed 前端半邊):
//   answer → AI 回答;error → 如實顯示錯誤(絕不偽裝成離線快答——否則伺服器端
//   的 403 功能停用/503 閘門故障會被前端靜默吃掉,fail-closed 形同失效);
//   其餘(fallback:demo/未設 Supabase)→ 確定性離線快答。
// res.error 相容字串(runAgent)與 { message }(其他 slice)兩種形狀。
export function replyMessage(res, deterministic) {
  if (res?.answer) return { role: 'ai', text: res.answer, sources: res.sources || [], steps: stepLabels(res.steps), mode: 'ai' }
  if (res?.error) return { role: 'ai', text: String(res.error.message || res.error), sources: [], mode: 'error' }
  return deterministic()
}

// fill=true:填滿父容器(浮動面板固定高,訊息區 flex-1 撐開、輸入貼底,消除下方留白)。
// fill=false:頁面版,訊息區以 minH/maxH 內部捲動。
// onAsk:統一的問答函式 (text) => Promise<{ answer, sources?, steps? } | { fallback: true } | { error }>
// ——呼叫端自己決定接 agent-run 與否;分流規則見 replyMessage。
// initialQuestion:App bar 全域搜尋帶來的代問請求 { q, key }——key 是 history entry key,
// 同頁第二次搜尋 key 會變、代問會再觸發;askedKey ref 擋 StrictMode double-effect 與同 key 重放。
export default function CopilotChat({ data, onAsk, minH = 180, maxH = 360, fill = false, initialQuestion = null }) {
  const [msgs, setMsgs] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [msgs, busy])
  const askedKey = useRef(null)
  useEffect(() => {
    if (initialQuestion?.q && askedKey.current !== initialQuestion.key) {
      askedKey.current = initialQuestion.key
      ask(initialQuestion.q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion])

  // 確定性回退(demo/未設 Supabase/AI 服務失敗):關鍵字比對答本案資料
  const fallbackAnswer = (text) => {
    const r = answerQuestion(text, data)
    return r
      ? { role: 'ai', text: r.answer, sources: r.sources || [], mode: 'basic' }
      : { role: 'ai', text: '這個問題我還答不上來——我目前讀得懂本案的進度、估驗請款、缺失查驗、品管取樣和契約義務。換個說法，或點下面的建議問題試試。', sources: [], mode: 'basic' }
  }

  const ask = async (question) => {
    const text = (question ?? q).trim()
    if (!text || busy) return
    setQ(''); setMsgs((m) => [...m, { role: 'user', text }]); setBusy(true)
    const res = await onAsk(text) // AI 優先
    const ai = replyMessage(res, () => fallbackAnswer(text))
    if (ai.mode === 'error') ai.retry = text // 錯誤訊息旁給「重試」重問同一句
    setBusy(false)
    setMsgs((m) => [...m, ai])
  }

  return (
    <div className={`flex flex-col min-h-0 ${fill ? 'flex-1' : ''}`}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
        style={fill ? undefined : { minHeight: minH, maxHeight: maxH }}>
        {msgs.length === 0 ? (
          <div className="text-sm text-[var(--text-3)] py-6 text-center">
            問問看本案的進度、估驗、缺失、契約……<br />答案都從本案資料來、附上出處連結。
          </div>
        ) : msgs.map((m, i) => (
          <div key={i} className={`enter-row ${m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}>
            <div className="max-w-[85%] min-w-0">
              <div className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-line ${
                m.role === 'user' ? 'bg-[var(--primary)] text-[var(--primary-fg)] rounded-br-sm'
                  : m.mode === 'error' ? 'bg-[var(--red-tint,transparent)] border border-[var(--red-text)]/25 text-[var(--red-text)] rounded-bl-sm'
                    : 'bg-[var(--surface-2)] text-[var(--text)] rounded-bl-sm'}`}>
                {m.role === 'ai' ? stripMd(m.text) : m.text}
                {m.sources?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {m.sources.map((s, j) => (
                      <Link key={j} to={s.to} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border-2)] text-[var(--blue-text)] hover:bg-[var(--blue-tint)] inline-flex items-center gap-0.5">
                        {s.label} <MSym name="arrow_forward" size={10} />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              {/* agent 真的去查過哪些模組——透明化查詢路徑,建立「答案有憑有據」的信任 */}
              {m.steps?.length > 0 && (
                <div className="text-[10px] text-[var(--text-3)] mt-1 px-1">查了:{m.steps.join('、')}</div>
              )}
              {/* 確定性回退要看得出來(實際踩過:demo 站拿到回退答案卻以為是 agent 在回)——
                  只有 mode:'basic'(demo/未設 Supabase/AI 失敗)才顯示,agent 正常回答不顯示 */}
              {m.mode === 'basic' && (
                <div className="text-[10px] text-[var(--text-3)] mt-1 px-1">
                  <span title="未連上 AI agent,這是依本案資料的關鍵字快答"
                    className="inline-block px-1.5 py-0.5 rounded-full border border-[var(--border-2)] bg-[var(--surface-2)]">
                    離線快答
                  </span>
                </div>
              )}
              {/* fail-closed 的錯誤如實顯示後,給重試(閘門恢復後重問同一句即可) */}
              {m.mode === 'error' && (
                <div className="mt-1 px-1">
                  <button onClick={() => ask(m.retry)} disabled={busy}
                    className="text-[11px] text-[var(--blue-text)] hover:underline pressable disabled:opacity-40">
                    重試
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start enter-row">
            <div className="bg-[var(--surface-2)] text-[var(--text-3)] rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm inline-flex items-center gap-1.5">
              <MSym name="smart_toy" size={13} className="animate-pulse" />思考中…
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border-2)] p-3 space-y-2 shrink-0">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={busy}
              className="text-[11px] px-2 py-1 rounded-full border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] pressable disabled:opacity-40">
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); ask() }} className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="輸入問題…" disabled={busy}
            className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20 disabled:opacity-60" />
          <Button type="submit" size="sm" disabled={!q.trim() || busy} aria-label="送出"><MSym name="send" size={15} /></Button>
        </form>
      </div>
    </div>
  )
}
