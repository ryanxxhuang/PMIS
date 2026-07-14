// AI copilot 聊天核心(訊息串 + 建議問句 + 輸入),無外殼——由呼叫端(/assistant
// 頁的 Card 或右下角浮動面板)自己套 chrome。AI 優先 → demo/失敗回退確定性問答。
import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Send, ArrowRight, Bot } from 'lucide-react'
import { Button } from './ui.jsx'
import { answerQuestion, SUGGESTED_QUESTIONS } from '../lib/assistantQA.js'

// 保險:AI 偶爾仍輸出 Markdown,純文字面板會顯示 literal 星號/井號(P2-02)——顯示前清掉標記
const stripMd = (s) => String(s || '')
  .replace(/\*\*(.*?)\*\*/g, '$1').replace(/(^|\n)\s*#{1,6}\s+/g, '$1')
  .replace(/(^|\n)\s*[-*]\s+/g, '$1').replace(/\*/g, '')

// fill=true:填滿父容器(浮動面板固定高,訊息區 flex-1 撐開、輸入貼底,消除下方留白)。
// fill=false:頁面版,訊息區以 minH/maxH 內部捲動。
export default function CopilotChat({ data, facts, askAssistant, minH = 180, maxH = 360, fill = false }) {
  const [msgs, setMsgs] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [msgs, busy])

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
    const res = await askAssistant(text, facts) // AI 優先
    let ai
    if (res?.answer) ai = { role: 'ai', text: res.answer, sources: res.sources || [], mode: 'ai' }
    else ai = fallbackAnswer(text) // res.fallback(demo) 或 res.error 都走這
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
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-line ${
              m.role === 'user' ? 'bg-[var(--primary)] text-white rounded-br-sm' : 'bg-[var(--surface-2)] text-[var(--text)] rounded-bl-sm'}`}>
              {m.role === 'ai' ? stripMd(m.text) : m.text}
              {m.sources?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {m.sources.map((s, j) => (
                    <Link key={j} to={s.to} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border-2)] text-[var(--blue-text)] hover:bg-[var(--blue-tint)] inline-flex items-center gap-0.5">
                      {s.label} <ArrowRight size={10} aria-hidden />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-[var(--surface-2)] text-[var(--text-3)] rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm inline-flex items-center gap-1.5">
              <Bot size={13} className="animate-pulse" aria-hidden />思考中…
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border-2)] p-3 space-y-2 shrink-0">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={busy}
              className="text-[11px] px-2 py-1 rounded-full border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition disabled:opacity-40">
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); ask() }} className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="輸入問題…" disabled={busy}
            className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20 disabled:opacity-60" />
          <Button type="submit" size="sm" disabled={!q.trim() || busy} aria-label="送出"><Send size={15} aria-hidden /></Button>
        </form>
      </div>
    </div>
  )
}
