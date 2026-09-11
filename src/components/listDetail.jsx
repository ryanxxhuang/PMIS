// 「清單＋詳情」殼的共用件:兩欄版面、<lg 詳情抽屜、置中 Modal 外殼、搜尋欄、
// 狀態快篩 chip、詳情 key-value 格、出處引述。狀態與鍵盤行為在 lib/useListDetailPane.js。
// 這是已核准 IA(規範 §0「疊合版」)的「殼」:詳情永遠出現在同一個位置,不跳頁。
// 這裡的每一件都有兩個實際使用點才抽(DEVELOPMENT.md §3 第 2 條);單頁專屬的
// 版面(履約執行卡、期程條、手動新增表單)留在各自頁面。
// 顏色一律走 token、字級走 @theme 階梯(規範 docs/UIUX-Apple-設計規範.md)。
// 這些本該住在 ui.jsx(規範 §6「primitives 一律從 ui.jsx 取」);本波不動 ui.jsx,
// 下次 ui.jsx 開檔時把 SearchField/StatusChip 併過去,呼叫端只改 import 路徑。
import { forwardRef, useEffect, useRef } from 'react'
import { MSym } from './icons.jsx'
import { Button, Card } from './ui.jsx'
import { useEscape } from '../lib/useEscape.js'

// 兩欄版面的欄寬與間距。骨架與正式版面必須共用這一份——兩邊不同寬的話
// 載入完成會整片位移(規範:載入完成不位移)。Tailwind 掃的是字面值,所以
// 這裡只能是完整字串,不能用變數拼 400px。
//
// 400 是定案值。抽出來之前 /requirements 寫 400、/requirements/review 寫 392,
// 同一個殼在兩頁差 8px——沒有人決定過那 8px,它就是複製貼上漂掉的。
export const LIST_DETAIL_GRID = 'grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_400px]'

// 寬版:詳情內容本身就是寬的(表格、巢狀編輯器)時用。殼承諾的是「詳情永遠出現在
// 同一個位置」,不是「詳情永遠 400px」——變更設計的追加/減帳明細是兩張約 620px
// 的表格,硬塞進 400px 只會逼那一頁自己在頁面裡刻一套寬度,漂移就從這裡開始
// (先前 400 vs 392 那 8px 就是這樣來的)。
// 640 = 620 表格 + 左右內距。同樣只能是完整字面值,Tailwind 掃的是字串。
export const LIST_DETAIL_GRID_WIDE = 'grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_640px]'

// 兩欄殼:左欄由呼叫端給(各頁的清單長得不一樣,連 Card 的 title/action 都不同),
// 右欄與抽屜由殼統一——它們正是「詳情永遠在同一個位置」這條 IA 的載體,
// 交給各頁自己寫就會像先前那樣各漂各的。
// detail 為空時右欄顯示 detailEmpty(要說「點左側清單查看」,不要只說沒有資料)。
// width='wide' 只給詳情含表格或巢狀編輯器的頁面(見 LIST_DETAIL_GRID_WIDE)。
// 不開放任意寬度:一開放就會回到每頁自己填一個數字的老路。
export function ListDetailLayout({ children, detail, detailLabel, detailEmpty = null, drawerOpen = false, onDrawerClose, width = 'default', className = '' }) {
  return (
    <>
      <div className={`${width === 'wide' ? LIST_DETAIL_GRID_WIDE : LIST_DETAIL_GRID} ${className}`}>
        {children}
        {/* sticky top-6:長清單捲動時詳情不會跟著捲走。aria-live 讓報讀器在
            選取換人時唸出新內容——桌機不開抽屜,沒有這個就完全無聲。 */}
        <Card className="hidden lg:block lg:sticky lg:top-6" bodyClass="p-0" aria-live="polite">
          {detail || detailEmpty}
        </Card>
      </div>
      {/* <lg 沒有右欄,同一份 detail 改由抽屜承載(768-1023 右滑入,<768 全螢幕) */}
      <DetailDrawer open={drawerOpen} onClose={onDrawerClose} label={detailLabel}>
        {detail}
      </DetailDrawer>
    </>
  )
}

// 抽屜與 Modal 共用:開啟時把焦點帶進面板(aria-modal 沒有焦點管理=報讀器仍停在
// 遮罩後的清單,W8-5 F2 同一課)。Esc 關閉走共用的 useEscape(理由見該檔)。
function useDismissable(open, onClose) {
  const ref = useRef(null)
  useEscape(open, onClose)
  useEffect(() => { if (open) ref.current?.focus() }, [open])
  return ref
}

// <lg 詳情抽屜(768-1023 右滑入)/全螢幕(<768,左上返回)。桌機(≥1024)不渲染,
// 詳情常駐右欄。label=對話框的 accessible name(義務詳情/條文詳情)。
export function DetailDrawer({ open, onClose, label, children }) {
  const ref = useDismissable(open, onClose)
  if (!open) return null
  return (
    <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-[var(--scrim)] enter-fade" onClick={onClose} />
      <div ref={ref} tabIndex={-1}
        className="absolute right-0 top-0 h-full w-[min(440px,92vw)] max-md:w-full bg-[var(--surface)] overflow-y-auto [box-shadow:var(--shadow-drawer)] outline-none" aria-live="polite">
        <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border-2)] px-3 py-2 flex items-center gap-2">
          {/* min-h-11 不帶 max-md:抽屜本身就是 <lg 的觸控版面,平板也要 44px */}
          <Button variant="ghost" size="md" className="min-h-11" onClick={onClose}>
            <MSym name="arrow_back" size={18} /> 返回清單
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}

// 置中 Modal 外殼:遮罩淡入、面板微縮放浮現(index.css enter-*);標題列右側是關閉
// 圖示鈕(圖示鈕維持正圓——藥丸退場只針對文字鈕)。size:md=表單一欄、xl=手動新增
// 那種多欄表單;面板 90vh 內捲,手機不會撐破。
// Contract.jsx 的上傳面板關閉鈕是同一顆圖示鈕;下一波接上時再抽 IconButton,
// 現在只有這一個使用點,不先抽。
const MODAL_SIZES = { md: 'max-w-md', xl: 'max-w-xl' }
export function ModalShell({ open, onClose, title, label = title, size = 'md', children }) {
  const ref = useDismissable(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-[var(--scrim)] enter-fade" onClick={onClose} />
      <div ref={ref} tabIndex={-1}
        className={`relative w-full ${MODAL_SIZES[size] || MODAL_SIZES.md} max-h-[90vh] overflow-y-auto bg-[var(--surface)] border border-[var(--border-card)] rounded-2xl [box-shadow:var(--shadow-overlay)] p-5 outline-none enter-modal`}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="text-callout font-medium text-[var(--text)]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="關閉"
            className="w-8 h-8 max-md:w-11 max-md:h-11 rounded-full flex items-center justify-center text-[var(--text-3)] hover:bg-[var(--surface-2)]">
            <MSym name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// 清單搜尋欄:label 包 icon+input(點 icon 也聚焦)。焦點呈現與 ui.jsx FIELD_BASE 同一套
// (3px 光暈+1px 主色描邊)掛在 focus-within,input 自己 outline-none。
// 8px 圓角:藥丸退場(規範 §4),capsule 不再給文字控件。
// ref 直通 input:頁面的「/」快捷鍵要能聚焦它。
export const SearchField = forwardRef(function SearchField({ value, onChange, placeholder, className = '', ...props }, ref) {
  return (
    <label className={`flex items-center gap-2.5 h-10 max-md:h-11 px-3.5 border border-[var(--border)] rounded-lg bg-[var(--surface)] transition-colors focus-within:outline-[3px] focus-within:outline-offset-0 focus-within:outline-[var(--focus-glow)] focus-within:border-[var(--focus)] ${className}`}>
      <MSym name="search" size={20} className="text-[var(--text-3)] shrink-0" />
      {/* 手機觸控目標 ≥ 44px(規範 §6)落在 label 外框(max-md:h-11):整個框都是點了就聚焦的命中區,
          與 Button 的 max-md:min-h-11 同一個斷點 */}
      <input ref={ref} type="search" value={value} onChange={onChange} placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent border-0 outline-none text-body text-[var(--text)] placeholder:text-[var(--text-3)]" {...props} />
    </label>
  )
})

// 狀態快篩 chip:單選分段帶件數(aria-pressed 供報讀器)。與 ui.jsx 兩個現成件都不同——
// FilterChip 是「套用/移除」語意(帶 filter_list/close 圖示),Segmented 是 role=tablist
// (e2e/routes.spec.js 釘 /requirements 的 tablist 數為 0,而且它是給顯示模式用的)。
// 8px 圓角:藥丸退場。children 放圓點+文字(顏色不可單獨承載語意,規範 §2)。
export function StatusChip({ active, onClick, count, children, className = '' }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={`h-[30px] px-3 rounded-lg border text-footnote font-medium inline-flex items-center gap-1.5 pressable max-md:min-h-11 ${active
        ? 'border-[var(--primary)] bg-[var(--blue-tint)] text-[var(--blue-text)]'
        : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--bg)]'} ${className}`}>
      {children}
      {count != null && <span className="num opacity-75">{count}</span>}
    </button>
  )
}

// 詳情 key-value 格:label 欄固定寬、值欄吃剩餘;數字/日期走 .num。
// rows=[[label, value], …]。規範 §0 方向 C 之後詳情會改成「原文＋條文高亮」,
// 這格屆時整個退場,所以刻意不再長 props。
export function MetaGrid({ rows, className = '' }) {
  return (
    <div className={`grid grid-cols-[70px_minmax(0,1fr)] gap-x-3 gap-y-[7px] text-footnote leading-relaxed ${className}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <span className="text-[var(--text-3)]">{k}</span>
          <span className="num text-[var(--text)]">{v}</span>
        </div>
      ))}
    </div>
  )
}

// 出處引述:figure/figcaption/cite/blockquote 語意(報讀器唸得出「引述自…」)。
// cite 只放出處(文件·條款·頁碼);核對狀態由呼叫端在小標列的彙總色票講一次,
// 逐筆不重複——同一狀態兩種文案並排會讓人以為是兩件事。
export function SourceQuote({ cite, quote, className = '' }) {
  return (
    <figure className={`m-0 bg-[var(--bg)] border border-[var(--border-2)] rounded-lg px-3 py-[11px] ${className}`}>
      <figcaption className="num text-caption text-[var(--text-3)] leading-relaxed">
        <cite className="not-italic">{cite}</cite>
      </figcaption>
      {quote && <blockquote className="m-0 mt-[7px] text-footnote leading-[1.85] text-[var(--text)]">「{quote}」</blockquote>}
    </figure>
  )
}
