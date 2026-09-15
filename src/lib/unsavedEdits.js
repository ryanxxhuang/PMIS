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
