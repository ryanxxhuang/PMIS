// 手機 bottom navigation(<768,README 手機規格):前 4 個可見工作面,
// 選取=56×30 藥丸+FILL 1 圖示+11px/500 標籤。其餘入口由既有漢堡抽屜承接
// (375px 抽屜的焦點/Esc 行為是 e2e 合約,bottom nav 是補充不是取代)。
// 刻意不放進「主要功能」nav——抽屜關閉時該 nav 整個 invisible,
// 若共用同一個 nav,bottom nav 會跟著被判 hidden。
// z-40:低於抽屜 scrim(z-50),抽屜開啟時被遮、不搶點擊。
import { Link, useLocation } from 'react-router-dom'
import { MSym } from './icons.jsx'

// 短標籤只是顯示層,不進 navConfig(那是路由/權限的單一真相,不放表現欄位)
const SHORT = { 今日待辦: '待辦', 現場與品質: '現場', 審查與協作: '審查', 進度與金流: '金流', 文件與結案: '文件', 專案: '專案', 平台管理: '平台' }

export default function BottomNav({ items }) {
  const { pathname } = useLocation()
  const shown = items.slice(0, 4)
  if (!shown.length) return null
  return (
    <nav aria-label="快速導覽"
      className="md:hidden print:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--bg)] border-t border-[var(--border-2)] grid pb-[env(safe-area-inset-bottom)]"
      style={{ gridTemplateColumns: `repeat(${shown.length}, 1fr)` }}>
      {shown.map((n) => {
        // 工作面在「任一子頁」都算選取(與側欄 itemActive 同一條規則)
        const active = pathname === n.to || n.tabs?.some((t) => t.to === pathname)
        return (
          <Link key={n.to} to={n.to} aria-label={n.label} aria-current={active ? 'page' : undefined}
            className="flex flex-col items-center gap-1 pt-2 pb-3 min-h-11">
            <span className={`w-14 h-[30px] rounded-full flex items-center justify-center ${active ? 'bg-[var(--blue-tint)]' : ''}`}>
              <MSym name={n.icon} size={20} fill={active} className={active ? 'text-[var(--blue-text)]' : 'text-[var(--text-2)]'} />
            </span>
            <span className={`text-[11px] font-medium leading-none ${active ? 'text-[var(--blue-text)]' : 'text-[var(--text-2)]'}`}>{SHORT[n.label] || n.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
