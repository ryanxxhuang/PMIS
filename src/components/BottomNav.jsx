// 手機 bottom navigation(<768,規範 §9.3):五格 = 主畫面槽 + 前 3 個可見工作/參考項 + 「更多」
// (iOS tab bar 上限 5)。選取=56×30 藥丸+描邊加重圖示+caption/500 標籤。
// 「更多」開既有的導覽抽屜——稽核點名手機有「兩層平行導覽」:頂欄漢堡與底欄各開一套,
// 現在同一份抽屜只剩這一個入口,頂欄漢堡在 <md 退場。
// 「更多」的 accessible name 就是可見文字「更多」(WCAG 2.5.3 label-in-name),不用 aria-label
// 蓋成別的字;抽屜關閉時焦點還給它(moreRef 由 Layout 持有),與先前漢堡鈕的合約相同。
// 刻意不放進「主要功能」nav——抽屜關閉時該 nav 整個 invisible,
// 若共用同一個 nav,bottom nav 會跟著被判 hidden。
// z-40:低於抽屜 scrim(z-50),抽屜開啟時被遮、不搶點擊(z 階梯登記在 index.css)。
import { Link, useLocation } from 'react-router-dom'
import { MSym } from './icons.jsx'

// 短標籤只是顯示層,不進 navConfig(那是路由/權限的單一真相,不放表現欄位)。
// export 給 Layout 的 rail 共用——同一份 map,跨斷點標籤不分家。
// 球權來源不在這份裡:它們的短標跟定義走(navConfig BALL_SOURCES.short)。
export const NAV_SHORT = { 專案文件: '文件', 契約重點: '契約', 標單工項: '標單', 現場與品質: '現場', 審查與協作: '審查', 進度與金流: '金流', 報表與結案: '結案', 專案: '專案', 平台管理: '平台' }

// 格子皮膚只有這一份:Link 格與「更多」鈕共用,兩者視覺不得分家
const CELL = 'flex flex-col items-center gap-1 pt-2 pb-3 min-h-11'
const pillClass = (active) => `w-14 h-[30px] rounded-full flex items-center justify-center ${active ? 'bg-[var(--blue-tint)]' : ''}`
const iconClass = (active) => (active ? 'text-[var(--blue-text)]' : 'text-[var(--text-2)]')
const labelClass = (active) => `text-caption font-medium leading-none ${active ? 'text-[var(--blue-text)]' : 'text-[var(--text-2)]'}`

// 群組在「任一子頁」都算選取(與側欄 itemActive 同一條規則);主畫面槽只比 pathname,
// ?ball= 三個分段都在同一頁,任一段都算在主畫面
const isActive = (n, pathname) => pathname === n.to || n.tabs?.some((t) => t.to === pathname)

// home:主畫面槽(球權來源「現在輪到我」),固定第一格。來源模型後 /dashboard 不再是
// 工作/參考項,不能再靠「把含落地頁的項目排到最前」保住主畫面——改成明確的槽,
// 主畫面永遠在手機第一格,不受 items 的順序與角色過濾影響。
// menuOpen/onMore/moreRef:抽屜狀態在 Layout,這裡只是它的觸發鈕。
export default function BottomNav({ items, home, menuOpen = false, onMore, moreRef }) {
  const { pathname } = useLocation()
  const shown = [home, ...items.slice(0, 3)]
  // 現在的頁面落在「更多」裡(第 4 個之後的項目)也要亮:回答「我在哪裡」,不然五格全暗
  const moreActive = menuOpen || items.slice(3).some((n) => isActive(n, pathname))
  return (
    <nav aria-label="快速導覽"
      className="md:hidden print:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--bg)] border-t border-[var(--border-2)] grid pb-[env(safe-area-inset-bottom)]"
      style={{ gridTemplateColumns: `repeat(${shown.length + 1}, 1fr)` }}>
      {shown.map((n) => {
        const active = isActive(n, pathname)
        return (
          <Link key={n.to} to={n.to} aria-label={n.label} aria-current={active ? 'page' : undefined} className={CELL}>
            <span className={pillClass(active)}>
              <MSym name={n.icon} size={20} fill={active} className={iconClass(active)} />
            </span>
            {/* 主畫面槽帶自己的 short(球權來源定義);工作/參考項查 NAV_SHORT */}
            <span className={labelClass(active)}>{n.short || NAV_SHORT[n.label] || n.label}</span>
          </Link>
        )
      })}
      {/* aria-expanded 綁抽屜開合、aria-controls 指向 Layout 的 aside(id=app-drawer) */}
      <button ref={moreRef} type="button" onClick={onMore} aria-expanded={menuOpen} aria-controls="app-drawer" className={`${CELL} pressable`}>
        <span className={pillClass(moreActive)}>
          <MSym name="more_horiz" size={20} fill={moreActive} className={iconClass(moreActive)} />
        </span>
        <span className={labelClass(moreActive)}>更多</span>
      </button>
    </nav>
  )
}
