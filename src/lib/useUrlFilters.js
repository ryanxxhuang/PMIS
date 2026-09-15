// 清單頁的篩選保存在 URL(UIUX 階段 2／6 U11):提醒中心、送審、疑義、變更設計四頁原本各自
// 一份 useState,從單據「返回」時 taskReturn 帶的是 pathname+search,篩選不進 URL 就會遺失。
// 第四個使用點出現後才抽成 hook(D-004)。規則:只放可分享、非敏感的識別(關鍵字、球權/狀態
// 分段);等於預設值就從 URL 刪掉,網址保持乾淨;replace 不炸掉瀏覽歷史。
// defaults 必須是模組層常數(穩定 reference),否則 filters 每次 render 都是新物件。
import { useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

export function useUrlFilters(defaults) {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(
    () => Object.fromEntries(Object.keys(defaults).map((k) => [k, params.get(k) ?? defaults[k]])),
    [params, defaults],
  )
  // 函式型更新要讀「當下」的 filters:setParams 的 previous 是 URLSearchParams,不是我們的物件
  const latest = useRef(filters)
  latest.current = filters
  const setFilters = useCallback((update) => {
    setParams((previous) => {
      const patch = typeof update === 'function' ? update(latest.current) : update
      const next = new URLSearchParams(previous)
      for (const key of Object.keys(defaults)) {
        const value = patch[key]
        if (value && value !== defaults[key]) next.set(key, value)
        else next.delete(key)
      }
      return next
    }, { replace: true })
  }, [defaults, setParams])
  return [filters, setFilters]
}
