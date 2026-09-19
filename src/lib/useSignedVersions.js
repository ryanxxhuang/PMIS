// 報表頁載入「已簽署版本」的簽署列(P6a:施工月報／監造月報／估驗佐證包)。每個類型一次查詢(store listSignedVersions),
// 失敗如實回 error——頁面顯示「無法確認簽署狀態」,不把讀取失敗當成「全部未簽署」或「全部已簽署」。
// refreshKey 變動(例:store 的現場文書清單在簽署／提送後重載)就重取;示範模式 store 回空(無法簽署)。
import { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'

export default function useSignedVersions(docTypes = [], refreshKey = null) {
  const { listSignedVersions } = useStore()
  const key = docTypes.join(',')
  const [state, setState] = useState({ key: null, loading: true, error: null, rows: {} })

  useEffect(() => {
    let alive = true
    const types = key ? key.split(',') : []
    Promise.all(types.map((t) => listSignedVersions(t))).then((results) => {
      if (!alive) return
      const failed = results.find((r) => r?.error)
      setState({
        key, loading: false, error: failed ? failed.error : null,
        rows: Object.fromEntries(types.map((t, i) => [t, results[i]?.rows || []])),
      })
    })
    return () => { alive = false }
  }, [key, refreshKey, listSignedVersions])

  // 類型集合剛換:舊結果不算數,回 loading
  if (state.key !== key) return { loading: true, error: null, rows: {} }
  return state
}
