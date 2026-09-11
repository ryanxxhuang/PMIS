// 「清單＋詳情」殼的選取與鍵盤行為:履約時程(/requirements)與擷取審核
// (/requirements/review)原本各抄一份——選取＋URL 單條連結、切案／切契約重置、
// 初次自動選取(深連結優先)、↑/↓/Enter//、<lg 抽屜開關——收斂到這兩支 hook。
// 拆成兩支不是為了抽象:鍵盤導覽的 Enter 要呼叫「開啟原文」,而開啟原文要先知道
// 選中哪一列;同一支 hook 會在宣告順序上自己咬自己。
//
// W8-5 真人驗收出來的無障礙合約(不得在抽取時弄丟):
// - 深連結列捲到畫面中央、鍵盤移動捲到最近位置;
// - 任何 modal 層(aria-modal)開著就整組停用,「/」不搶焦點到遮罩後的搜尋框;
// - 真正的輸入控件(input/textarea/select/contentEditable)裡不吃快捷鍵,
//   但點過清單列或快篩 chip 後焦點停在 button 上,快捷鍵必須照常運作;
// - Enter 落在 button/link 上讓原生 click 走,不搶;
// - 抽屜/全螢幕只屬於 <lg:桌機點列不留 detailOpen 殘值,縮窗才不會突然彈出遮罩。
import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// 「<lg」的 JS 版本,必須等於 Tailwind 的 lg(1024)——listDetail.jsx 的 DetailDrawer
// 寫的是 `lg:hidden`,兩邊不一致會出現「JS 認為要開抽屜、CSS 卻把抽屜藏起來」的
// 死狀態(1024px 整數點最容易踩到,所以上界寫 1023.98 而不是 1024)。
const BELOW_LG_QUERY = '(max-width: 1023.98px)'

// 改寫 URL query 的共用件。不用 react-router 的 setSearchParams(fn):它給 fn 的是「這次
// render 的快照」,不是當下的 URL。同一頁掛兩個殼(/safety:缺失 ?defect= 與工安紀錄
// ?record=)時,兩支 hook 的掛載 effect 在同一個 commit 先後寫——第二支拿的仍是舊快照,
// 會把第一支剛寫進去的參數蓋掉(實測 /safety 開頁後 URL 只剩 ?record=,缺失的預設選取
// 沒寫進去;切案重置時更會留下他案的舊 id)。
// 解法:記住「最後一次寫出的 search」與它是從哪一個 location 物件算出來的。同一個
// commit 內所有殼拿到的是同一個 location 物件(Router 的 context 只在 location 變時換新),
// 物件相同=router 還沒跟上,就以最後寫出的為基底;物件換了(router 已跟上、或換頁了)
// 就自然作廢,不需要清。模組層而非 context:不必為此在 App 外再包一層 provider。
// 讀也走同一份:切 scope 的重置與重新選取在同一個 commit,重選若讀 render 快照會把
// 剛刪掉的深連結又撿回來。
let lastWrite = null
function useLiveSearch() {
  const location = useLocation()
  const navigate = useNavigate()
  const read = useCallback(() => (lastWrite?.loc === location ? lastWrite.next : location.search), [location])
  const write = useCallback((mutate) => {
    const n = new URLSearchParams(read())
    mutate(n)
    lastWrite = { loc: location, next: n.toString() }
    // 相對路徑 "?x=1" 保住目前 pathname、清 hash;replace 不炸掉瀏覽歷史(與 setSearchParams 同義)
    navigate(`?${n}`, { replace: true })
  }, [location, navigate, read])
  return [read, write]
}

// param:URL 單條連結的 query 名(?obligation= / ?highlight=);idPrefix:清單列 DOM id
// 前綴(ob-/hl-);scope:字串,變了就整組重置(專案、身分、契約範圍);
// ready:可以做初次自動選取了(資料載好且有列);rows:深連結查找母體;
// pickDefault:無深連結時回預設 id;onSelect/onReset/onDeepLink:頁面自有的副作用
// (清訊息、載詳情、重設篩選、撐分頁)。回呼一律讀最新版(ref),effect 依賴只留
// 資料本身,與改版前兩頁的依賴形狀一致。
export function useListDetailPane({
  param, idPrefix, scope, ready, rows, pickDefault, onSelect, onReset, onDeepLink,
}) {
  const [readSearch, writeSearch] = useLiveSearch()
  const [selectedId, setSelectedId] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)  // <lg 抽屜/全螢幕詳情
  const latest = useRef({})
  latest.current = { rows, pickDefault, onSelect, onReset, onDeepLink, readSearch }

  // writeUrl=false 只給初次自動選取用:預設選取不是使用者的選擇,寫進 URL 後 reload 就變成
  // 深連結、<lg 會憑空彈出抽屜(/safety 兩個殼各寫一個,reload 疊兩層抽屜)。分享 URL 也沒有
  // 損失——沒帶 query 的頁本來就會選到同一個預設。
  const select = useCallback((id, { openPane = false, writeUrl = true } = {}) => {
    setSelectedId(id)
    latest.current.onSelect?.(id)
    // 抽屜/全螢幕只屬於 <lg:桌機點列不留 detailOpen 殘值,縮窗才不會突然彈出遮罩
    if (openPane && window.matchMedia(BELOW_LG_QUERY).matches) setDetailOpen(true)
    // URL 帶單條連結可分享
    if (writeUrl) writeSearch((n) => n.set(param, id))
  }, [param, writeSearch])
  const closeDetail = useCallback(() => setDetailOpen(false), [])

  // 切換專案/契約範圍(不經 route 卸載)時整組重置:殘留他案的 selectedId/URL 參數
  // 會讓右欄空白、URL 指向別案的列。首次掛載不算切換。
  const initialPicked = useRef(false)
  const seenScope = useRef(scope)
  useEffect(() => {
    if (seenScope.current === scope) return
    seenScope.current = scope
    initialPicked.current = false
    setSelectedId(null); setDetailOpen(false)
    latest.current.onReset?.()
    writeSearch((n) => n.delete(param))  // 只刪自己的 param:同頁另一個殼的深連結不受影響
  }, [scope, param, writeSearch])

  // 初次載入:深連結優先並捲到該列;否則交給頁面的預設規則(第一條已逾期→即將到期
  // →清單第一條 / 第一條待確認)。只選一次,之後由使用者主導。
  // 深連結才 openPane(規範 §9.7):收件匣點「那一筆」進來,<lg 直接推入詳情,不是停在
  // 清單再點一次;≥lg 的 select 本來就忽略 openPane(詳情常駐右欄)。預設選取不開——
  // 手機打開一頁就彈全螢幕詳情,等於把清單藏起來。
  // 捲動延後 60ms 等列掛上;計時器只在卸載時清(scrollTimer),不能掛在這個 effect 的
  // cleanup——select() 改了 URL 就會讓 select 換 identity、effect 重跑,捲動會被自己取消。
  const scrollTimer = useRef(null)
  useEffect(() => () => clearTimeout(scrollTimer.current), [])
  useEffect(() => {
    if (initialPicked.current || !ready) return
    initialPicked.current = true
    const { rows: pool, pickDefault: pick, onDeepLink: deepHook, readSearch: read } = latest.current
    const wanted = new URLSearchParams(read()).get(param)
    const deep = wanted ? pool.find((r) => r.id === wanted) : null
    const targetId = deep ? deep.id : pick?.()
    if (!targetId) return
    // 深連結的 query 本來就在 URL 裡、預設選取不該進 URL:初次選取一律不寫(理由見 select)
    select(targetId, { openPane: !!deep, writeUrl: false })
    if (deep) {
      deepHook?.(deep)
      scrollTimer.current = setTimeout(() => document.getElementById(`${idPrefix}${deep.id}`)?.scrollIntoView({ block: 'center' }), 60)
    }
  }, [ready, rows, scope, param, idPrefix, select])

  return { selectedId, setSelectedId, detailOpen, setDetailOpen, select, closeDetail }
}

// 鍵盤:↑/↓ 移動選取、Enter 開啟原文、/ 聚焦搜尋。ordered=目前畫面上的走訪序
// (篩選後、分頁內);modalUp=頁面自有的 modal 旗標(回報/手動新增/編輯中),
// aria-modal 的層另外自己偵測。
export function useListKeyboardNav({ ordered, selectedId, select, idPrefix, onEnter, modalUp = false, searchRef }) {
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      const inField = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)
      const up = modalUp || document.querySelector('[aria-modal="true"]') != null
      if (e.key === '/' && !inField && !up) { e.preventDefault(); searchRef?.current?.focus(); return }
      if (inField || up || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Enter' && t && /^(BUTTON|A)$/.test(t.tagName)) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!ordered.length) return
        const idx = ordered.findIndex((it) => it.id === selectedId)
        const next = e.key === 'ArrowDown'
          ? ordered[Math.min(idx + 1, ordered.length - 1)]
          : ordered[Math.max(idx - 1, 0)]
        if (next && next.id !== selectedId) {
          select(next.id)
          document.getElementById(`${idPrefix}${next.id}`)?.scrollIntoView({ block: 'nearest' })
        }
      } else if (e.key === 'Enter') {
        onEnter?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ordered, selectedId, select, idPrefix, onEnter, modalUp, searchRef])
}
