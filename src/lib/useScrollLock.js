// 浮層開啟時鎖住背景捲動,關閉時還原到原本的位置。
//
// 為什麼不是 overflow:hidden:iOS Safari 對 body 的 overflow:hidden 長期不可靠,
// 手指照樣把底下的頁面捲走。body 定位固定(top:-scrollY)是可靠的寫法:視覺位置不變、
// 真的捲不動;關閉時拿掉定位再 scrollTo 回去。稽核實測 /requirements 進詳情 946 →
// 抽屜裡滾兩下 → 返回變 1446,原本那一筆已不在畫面上,就是沒鎖的後果。
//
// 引用計數放模組層:抽屜上再開對話框(兩處都用這支)時只有最外層真的動 body,
// 內層釋放不會提早還原捲動、也不會把「外層已固定」的樣式當成原狀存起來。
// DetailDrawer、ModalShell、導覽抽屜三處共用,不要各自再抄一份。
import { useEffect } from 'react'

let locks = 0
let saved = null

function lock() {
  if (locks++ > 0) return
  const y = window.scrollY
  const { style } = document.body
  // 捲軸消失會讓內容變寬(Windows / 開啟常駐捲軸的 mac):用 padding-right 補回捲軸寬,
  // 內容不位移。clientWidth 為 0 是 jsdom,沒有捲軸可補。
  const docW = document.documentElement.clientWidth
  const gutter = docW > 0 ? window.innerWidth - docW : 0
  saved = { y, position: style.position, top: style.top, width: style.width, paddingRight: style.paddingRight }
  style.position = 'fixed'
  style.top = `-${y}px`
  style.width = '100%'
  if (gutter > 0) style.paddingRight = `${gutter}px`
}

function unlock() {
  if (--locks > 0 || !saved) return
  const { style } = document.body
  const { y, position, top, width, paddingRight } = saved
  saved = null
  style.position = position
  style.top = top
  style.width = width
  style.paddingRight = paddingRight
  // instant:全站若哪天掛了 scroll-behavior:smooth,還原位置也不該用滑的
  if (window.scrollY !== y) window.scrollTo({ top: y, behavior: 'instant' })
}

export function useScrollLock(locked) {
  useEffect(() => {
    if (!locked) return undefined
    lock()
    return unlock
  }, [locked])
}
