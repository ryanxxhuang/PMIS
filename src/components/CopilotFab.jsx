// AI copilot 的浮層與桌機右下角浮動鈕——全站任何頁面伸手可及,點開懸浮對話面板。
// W3-2(D-008)薄入口定位:與 /agent 是同一個 Agent(同 runtime/persona/工具),
// 面板每次打開都是新對話(不帶 history,長對話請開完整頁);真專案不需先匯標單
// (對齊 W2-3——文件/成員/期限問題不依賴 BOQ)。列印頁隱藏。
//
// 手機(<md)不渲染 FAB(規範 §9.5):FAB 是 Material 語彙,z-[60] 蓋在抽屜與對話框之上,
// 連詳情全螢幕時都浮著,SiteLog 曾被逼手寫 pr-20 讓位。手機入口改在頂欄尾端(Layout 的
// TopBar),面板改成貼底的全高 sheet。開合 state 由 WebLayout 持有(open/onOpenChange),
// 桌機 FAB 與手機頂欄鈕都只是它的觸發器——兩份 state 遲早對不上。
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from './icons.jsx'
import { useStore } from '../store.jsx'
import { useAssistantData } from '../lib/assistantData.js'
import { displayAgentRole, AGENT_LABEL } from '../lib/agentRole.js'
import { useEscape } from '../lib/useEscape.js'
import { usePresence } from '../lib/usePresence.js'
import { useMediaQuery, BELOW_MD_QUERY } from '../lib/useMediaQuery.js'
import CopilotChat from './CopilotChat.jsx'

// 自訂 AI 標記:對話泡泡 + 靈感火花(比通用 Sparkles 更有識別度、更「設計感」)。
// 白色描邊泡泡 + 白色實心四角星,配漸層圓鈕;頂欄鈕(手機)沿用同一個標記。
export function CopilotMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7.2 17.5 4 20.3V17H4.8A2.8 2.8 0 0 1 2 14.2V6.3A2.8 2.8 0 0 1 4.8 3.5h14.4A2.8 2.8 0 0 1 22 6.3v7.9a2.8 2.8 0 0 1-2.8 2.8H7.2Z"
        stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" fill="none" />
      <path d="M12 6.1c.42 2.2 1.2 2.98 3.4 3.4-2.2.42-2.98 1.2-3.4 3.4-.42-2.2-1.2-2.98-3.4-3.4 2.2-.42 2.98-1.2 3.4-3.4Z"
        fill="currentColor" />
    </svg>
  )
}

// 入口能不能出現,桌機 FAB 與手機頂欄鈕必須是同一個答案:
// W2-3/W3-2 真專案選定即可用(不再要求先匯標單);批 B UX:agent 對話功能關閉時整個入口
// 藏起來(面板走 agent-run),說明入口在 /agent 頁;真正的閘門在伺服器端 openAiGate。
export function useCopilotAvailable() {
  const { isPersistedProject, demoMode, aiEnabled } = useStore() // 收合時只訂閱這幾個 key
  return (isPersistedProject || demoMode) && aiEnabled('agent.run')
}

// 面板內容獨立成元件:useAssistantData 訂閱幾乎全部 store key、每次資料變動都重算
// facts 快照——只有面板打開(掛載)時才付這個成本;收合時 FAB 僅訂閱 2 個 key。
// state/onTransitionEnd 來自 usePresence:手機 sheet 關閉先向下滑出再卸載。
function CopilotPanel({ onClose, state, onTransitionEnd }) {
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

  // 手機:貼底全高 sheet,高度綁 --vvh 減頂欄——軟鍵盤升起時 sheet 跟著縮,輸入列不會被壓在鍵盤下;
  // 頂欄留在上面,那顆 AI 鈕就是收合鈕。桌機(md+):右下錨定面板,尺寸與動效(enter-panel)不變。
  // z-[60]:z 階梯登記在 index.css。
  return (
    <div data-state={state} onTransitionEnd={onTransitionEnd}
      className="fixed z-[60] flex flex-col bg-[var(--surface)] border border-[var(--border-card)] [box-shadow:var(--shadow-overlay)] overflow-hidden enter-panel present-sheet
      inset-x-0 bottom-0 h-[calc(var(--vvh)_-_var(--top-bar-h))] rounded-t-2xl
      md:inset-x-auto md:right-6 md:bottom-24 md:w-[400px] md:h-[560px] md:max-h-[75vh] md:rounded-2xl"
      role="dialog" aria-modal="false" aria-label={label.name}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-2)] shrink-0">
        <span className="w-7 h-7 rounded-lg grid place-items-center bg-[var(--blue-tint)] text-[var(--blue-text)] shrink-0"><CopilotMark size={16} /></span>
        <div className="min-w-0 flex-1">
          {/* 面板頭=卡頭:字級對齊 Card title(15px/500);輔助字最小 11px(10px 在 1x 螢幕不可讀) */}
          <div className="text-callout font-medium text-[var(--text)] leading-tight">{label.name} <span className="font-normal text-caption text-[var(--text-3)]">新對話</span></div>
          <div className="text-caption text-[var(--text-3)]">與主控台同一個 Agent · 長對話請開<Link to="/agent" onClick={onClose} className="text-[var(--blue-text)] hover:underline">完整頁</Link></div>
        </div>
        <Link to="/agent" onClick={onClose} className="inline-flex items-center justify-center max-md:min-h-11 max-md:min-w-11 text-[var(--text-3)] hover:text-[var(--text)] p-1" aria-label="開啟完整頁面" title="開啟完整頁面"><MSym name="open_in_full" size={15} /></Link>
        <button onClick={onClose} className="inline-flex items-center justify-center max-md:min-h-11 max-md:min-w-11 text-[var(--text-3)] hover:text-[var(--text)] p-1" aria-label="關閉"><MSym name="close" size={17} /></button>
      </div>
      <CopilotChat data={data} onAsk={onAsk} fill />
    </div>
  )
}

export default function CopilotFab({ open, onOpenChange }) {
  const available = useCopilotAvailable()
  // <md 不渲染 FAB(不是 CSS 藏):藏起來的鈕仍在 DOM,「開啟 AI 助理」會有兩顆同名鈕
  const isMobile = useMediaQuery(BELOW_MD_QUERY)
  const close = () => onOpenChange(false)
  useEscape(open, close)
  // 只有手機 sheet 等出場;桌機面板維持「出場即時」(index.css .enter-* 的既有決定)
  const { mounted, state, onTransitionEnd } = usePresence(open, BELOW_MD_QUERY)

  if (!available) return null // 尚未選定專案(或未設 Supabase 又非 demo)、或 agent.run 關閉時不顯示

  return (
    <div className="print:hidden">
      {/* 展開面板(掛載時才計算 facts) */}
      {mounted && <CopilotPanel onClose={close} state={state} onTransitionEnd={onTransitionEnd} />}

      {/* 桌機浮動圓鈕:品牌漸層是刻意的識別度,但陰影/光環改走 token——
          Tailwind 原生 shadow-lg 與 ring-white/15 都不是設計色票,深色模式下白環會浮出來 */}
      {!isMobile && (
        <button
          onClick={() => onOpenChange(!open)}
          aria-label={open ? '收合 AI 助理' : '開啟 AI 助理'}
          className={`fixed z-[60] bottom-6 right-6 w-14 h-14 rounded-full grid place-items-center [box-shadow:var(--shadow-overlay)] transition-transform duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] hover:scale-105 active:scale-95
            ${open
              ? 'bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--border)]'
              : 'bg-gradient-to-br from-[var(--blue)] to-[var(--primary)] text-[var(--primary-fg)]'}`}>
          {open ? <MSym name="close" size={22} /> : <CopilotMark size={26} />}
        </button>
      )}
    </div>
  )
}
