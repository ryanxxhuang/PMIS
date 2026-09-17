// 未存檔輸入的最小登記簿(UIUX 階段 3B U07):不是草稿同步系統,不存內容、不跨頁恢復,
// 只回答「現在頁面上有沒有還沒存的東西、是什麼」——讓會把它弄丟的動作(切換專案、
// 重新整理/關閉分頁)先問一聲。內容本身仍留在各元件自己的 state 裡。
// 登記者:目前只有品質頁的自主檢查表;第二個使用點出現前不再抽象。
import { useEffect } from 'react'

const entries = new Map() // key → 給使用者看的標籤,例如「自主檢查表（未存檔）」

export function setUnsavedEdit(key, label) {
  if (label) entries.set(key, label)
  else entries.delete(key)
}

export function unsavedEditLabels() {
  return [...entries.values()]
}

// 使用者確認放棄後清空:讓緊接著的導覽不再被攔;卸載的元件本來也會自己移除
export function clearUnsavedEdits() {
  entries.clear()
}

// 站內離頁保護(W01):攔截所有站內連結(<a href="#/…">)的點擊——側欄、頁首、常用工作、待辦列、
// 分頁列都是連結,一支 capture 監聽就涵蓋。同一路徑只改 query(球權分段、選取)不算離頁。
// 瀏覽器返回鍵與程式呼叫 navigate() 不經這裡:前者由 beforeunload 之外沒有可取消的事件,
// 後者由各頁自己在呼叫前確認(施工日誌的列印鈕)。回傳 true=已攔下(不論最後是否放行)。
export function guardInAppNavigation(event, confirmLeave) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  const a = event.target?.closest?.('a[href]')
  if (!a) return false
  const href = a.getAttribute('href') || ''
  if (!href.startsWith('#/')) return false
  const targetPath = href.slice(1).split('?')[0]
  const currentPath = (window.location.hash || '#/').slice(1).split('?')[0]
  if (targetPath === currentPath) return false
  const labels = unsavedEditLabels()
  if (!labels.length) return false
  event.preventDefault()
  event.stopPropagation()
  Promise.resolve(confirmLeave(labels)).then((ok) => {
    if (!ok) return
    clearUnsavedEdits()
    a.click() // 登記已清,這次點擊直接放行(保留 Link 的 state,例如返回今日工作的來源)
  })
  return true
}

export function useInAppLeaveGuard(confirmLeave) {
  useEffect(() => {
    const onClick = (e) => { guardInAppNavigation(e, confirmLeave) }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [confirmLeave])
}

// 元件用:label 有值=登記(並掛 beforeunload 讓瀏覽器在重新整理/關閉時提示),
// 空值或卸載=移除。beforeunload 的文案由瀏覽器決定,不能自訂。
export function useUnsavedEdit(key, label) {
  useEffect(() => {
    setUnsavedEdit(key, label)
    return () => setUnsavedEdit(key, null)
  }, [key, label])
  useEffect(() => {
    if (!label) return undefined
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [label])
}
