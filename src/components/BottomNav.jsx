// 手機 bottom navigation(<768,README 手機規格):主畫面槽 + 前 3 個可見工作/參考項,
// 選取=56×30 藥丸+FILL 1 圖示+11px/500 標籤。其餘入口由既有漢堡抽屜承接
// (375px 抽屜的焦點/Esc 行為是 e2e 合約,bottom nav 是補充不是取代)。
// 刻意不放進「主要功能」nav——抽屜關閉時該 nav 整個 invisible,
// 若共用同一個 nav,bottom nav 會跟著被判 hidden。
// z-40:低於抽屜 scrim(z-50),抽屜開啟時被遮、不搶點擊。
import { Link, useLocation } from 'react-router-dom'
import { MSym } from './icons.jsx'

// 短標籤只是顯示層,不進 navConfig(那是路由/權限的單一真相,不放表現欄位)。
// export 給 Layout 的 rail 共用——同一份 map,跨斷點標籤不分家。
// 球權來源不在這份裡:它們的短標跟定義走(navConfig BALL_SOURCES.short)。
export const NAV_SHORT = { 專案文件: '文件', 契約重點: '契約', 標單工項: '標單', 現場與品質: '現場', 審查與協作: '審查', 進度與金流: '金流', 報表與結案: '結案', 專案: '專案', 平台管理: '平台' }

// home:主畫面槽(球權來源「現在輪到我」),固定第一格。來源模型後 /dashboard 不再是
// 工作/參考項,不能再靠「把含落地頁的項目排到最前」保住主畫面——改成明確的槽,
// 主畫面永遠在手機第一格,不受 items 的順序與角色過濾影響。
export default function BottomNav({ items, home }) {
  const { pathname } = useLocation()
  const shown = [home, ...items.slice(0, 3)]
  return (
    <nav aria-label="快速導覽"
      className="md:hidden print:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--bg)] border-t border-[var(--border-2)] grid pb-[env(safe-area-inset-bottom)]"
      style={{ gridTemplateColumns: `repeat(${shown.length}, 1fr)` }}>
      {shown.map((n) => {
        // 群組在「任一子頁」都算選取(與側欄 itemActive 同一條規則);主畫面槽只比 pathname,
        // ?ball= 三個分段都在同一頁,任一段都算在主畫面
        const active = pathname === n.to || n.tabs?.some((t) => t.to === pathname)
        return (
          <Link key={n.to} to={n.to} aria-label={n.label} aria-current={active ? 'page' : undefined}
            className="flex flex-col items-center gap-1 pt-2 pb-3 min-h-11">
            <span className={`w-14 h-[30px] rounded-full flex items-center justify-center ${active ? 'bg-[var(--blue-tint)]' : ''}`}>
              <MSym name={n.icon} size={20} fill={active} className={active ? 'text-[var(--blue-text)]' : 'text-[var(--text-2)]'} />
            </span>
            {/* 主畫面槽帶自己的 short(球權來源定義);工作/參考項查 NAV_SHORT */}
            <span className={`text-caption font-medium leading-none ${active ? 'text-[var(--blue-text)]' : 'text-[var(--text-2)]'}`}>{n.short || NAV_SHORT[n.label] || n.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
