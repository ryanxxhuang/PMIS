// 右下角浮動 AI copilot——全站任何頁面伸手可及,點開懸浮對話面板。
// 只在有資料的專案顯示(imported);列印頁隱藏;行動版為全寬 bottom sheet。
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, X, Maximize2 } from 'lucide-react'
import { useAssistantData } from '../lib/assistantData.js'
import CopilotChat from './CopilotChat.jsx'

export default function CopilotFab() {
  const { data, facts, askAssistant, imported } = useAssistantData()
  const [open, setOpen] = useState(false)

  // Esc 關閉
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!imported) return null // 尚無專案資料時不顯示(與 /assistant 頁的空狀態一致)

  return (
    <div className="print:hidden">
      {/* 展開面板 */}
      {open && (
        <div className="fixed z-[60] flex flex-col bg-[var(--surface)] border border-[var(--border)] shadow-2xl overflow-hidden
          inset-x-2 bottom-2 top-16 rounded-2xl
          sm:inset-x-auto sm:top-auto sm:right-6 sm:bottom-24 sm:w-[400px] sm:h-[560px] sm:max-h-[75vh]"
          role="dialog" aria-modal="false" aria-label="AI 助理">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-2)] shrink-0">
            <span className="w-7 h-7 rounded-lg grid place-items-center bg-[var(--blue-tint)] text-[var(--blue-text)] shrink-0"><Sparkles size={15} aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--text)] leading-tight">AI 助理</div>
              <div className="text-[10px] text-[var(--text-3)]">問本案的事 · 唯讀 · 附出處</div>
            </div>
            <Link to="/assistant" onClick={() => setOpen(false)} className="text-[var(--text-3)] hover:text-[var(--text)] p-1" aria-label="開啟完整頁面" title="開啟完整頁面"><Maximize2 size={15} aria-hidden /></Link>
            <button onClick={() => setOpen(false)} className="text-[var(--text-3)] hover:text-[var(--text)] p-1" aria-label="關閉"><X size={17} aria-hidden /></button>
          </div>
          <CopilotChat data={data} facts={facts} askAssistant={askAssistant} minH={0} maxH={9999} />
        </div>
      )}

      {/* 浮動圓鈕 */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? '收合 AI 助理' : '開啟 AI 助理'}
        className={`fixed z-[60] bottom-6 right-6 w-14 h-14 rounded-full grid place-items-center shadow-lg transition-transform hover:scale-105 active:scale-95
          ${open ? 'bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--border)]' : 'bg-[var(--primary)] text-white'}`}>
        {open ? <X size={22} aria-hidden /> : <Sparkles size={22} aria-hidden />}
      </button>
    </div>
  )
}
