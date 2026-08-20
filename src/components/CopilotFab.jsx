// 右下角浮動 AI copilot——全站任何頁面伸手可及,點開懸浮對話面板。
// W3-2(D-008)薄入口定位:與 /agent 是同一個 Agent(同 runtime/persona/工具),
// 面板每次打開都是新對話(不帶 history,長對話請開完整頁);真專案不需先匯標單
// (對齊 W2-3——文件/成員/期限問題不依賴 BOQ)。列印頁隱藏;行動版為全寬 bottom sheet。
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from './icons.jsx'
import { useStore } from '../store.jsx'
import { useAssistantData } from '../lib/assistantData.js'
import { displayAgentRole, AGENT_LABEL } from '../lib/agentRole.js'
import CopilotChat from './CopilotChat.jsx'

// 自訂 AI 標記:對話泡泡 + 靈感火花(比通用 Sparkles 更有識別度、更「設計感」)。
// 白色描邊泡泡 + 白色實心四角星,配漸層圓鈕。
function CopilotMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7.2 17.5 4 20.3V17H4.8A2.8 2.8 0 0 1 2 14.2V6.3A2.8 2.8 0 0 1 4.8 3.5h14.4A2.8 2.8 0 0 1 22 6.3v7.9a2.8 2.8 0 0 1-2.8 2.8H7.2Z"
        stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" fill="none" />
      <path d="M12 6.1c.42 2.2 1.2 2.98 3.4 3.4-2.2.42-2.98 1.2-3.4 3.4-.42-2.2-1.2-2.98-3.4-3.4 2.2-.42 2.98-1.2 3.4-3.4Z"
        fill="currentColor" />
    </svg>
  )
}

// 面板內容獨立成元件:useAssistantData 訂閱幾乎全部 store key、每次資料變動都重算
// facts 快照——只有面板打開(掛載)時才付這個成本;收合時 FAB 僅訂閱 2 個 key。
function CopilotPanel({ onClose }) {
  const { data, facts, org } = useAssistantData()
  const { runAgent } = useStore()
  // 角色只用於顯示(紅線:權限一律以伺服器為準);agent-run 回傳的 role 覆蓋前端推算
  const [serverRole, setServerRole] = useState(null)
  const role = serverRole || displayAgentRole({ orgType: org })
  const label = AGENT_LABEL[role] || AGENT_LABEL.contractor

  // 浮動面板不帶 history,保持輕量;fallback / error 由 CopilotChat 的確定性回退接手
  const onAsk = async (text) => {
    const res = await runAgent(text, { facts })
    if (res?.role && res.role !== role) setServerRole(res.role)
    return res?.text ? { answer: res.text, sources: res.sources || [], steps: res.steps } : res
  }

  return (
    <div className="fixed z-[60] flex flex-col bg-[var(--surface)] border border-[var(--border-card)] [box-shadow:var(--shadow-overlay)] overflow-hidden
      inset-x-2 bottom-2 top-16 rounded-2xl enter-panel
      sm:inset-x-auto sm:top-auto sm:right-6 sm:bottom-24 sm:w-[400px] sm:h-[560px] sm:max-h-[75vh]"
      role="dialog" aria-modal="false" aria-label={label.name}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-2)] shrink-0">
        <span className="w-7 h-7 rounded-lg grid place-items-center bg-[var(--blue-tint)] text-[var(--blue-text)] shrink-0"><CopilotMark size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--text)] leading-tight">{label.name} <span className="font-normal text-[10px] text-[var(--text-3)]">新對話</span></div>
          <div className="text-[10px] text-[var(--text-3)]">與主控台同一個 Agent · 長對話請開<Link to="/agent" onClick={onClose} className="text-[var(--blue-text)] hover:underline">完整頁</Link></div>
        </div>
        <Link to="/agent" onClick={onClose} className="text-[var(--text-3)] hover:text-[var(--text)] p-1" aria-label="開啟完整頁面" title="開啟完整頁面"><MSym name="open_in_full" size={15} /></Link>
        <button onClick={onClose} className="text-[var(--text-3)] hover:text-[var(--text)] p-1" aria-label="關閉"><MSym name="close" size={17} /></button>
      </div>
      <CopilotChat data={data} onAsk={onAsk} fill />
    </div>
  )
}

export default function CopilotFab() {
  const { isPersistedProject, demoMode, aiEnabled } = useStore() // 收合時只訂閱這幾個 key
  // W2-3/W3-2:真專案選定即可用,不再要求先匯標單(工項類問題 agent 會自行說明)
  const available = isPersistedProject || demoMode
  const [open, setOpen] = useState(false)

  // Esc 關閉
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!available) return null // 尚未選定專案(或未設 Supabase 又非 demo)時不顯示
  // 批 B UX:agent 對話功能關閉時整顆 FAB 藏起來(面板走 agent-run),
  // 說明入口在 /agent 頁;真正的閘門在伺服器端 openAiGate
  if (!aiEnabled('agent.run')) return null

  return (
    <div className="print:hidden">
      {/* 展開面板(掛載時才計算 facts) */}
      {open && <CopilotPanel onClose={() => setOpen(false)} />}

      {/* 浮動圓鈕:漸層 + 柔光環,更有質感 */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? '收合 AI 助理' : '開啟 AI 助理'}
        className={`fixed z-[60] bottom-6 right-6 w-14 h-14 rounded-full grid place-items-center shadow-lg ring-1 transition-transform duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] hover:scale-105 active:scale-95
          ${open
            ? 'bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--border)] ring-transparent'
            : 'bg-gradient-to-br from-[var(--blue)] to-[var(--primary)] text-white ring-white/15 shadow-[var(--blue)]/30'}`}>
        {open ? <MSym name="close" size={22} /> : <CopilotMark size={26} />}
      </button>
    </div>
  )
}
