// 全站 Snackbar(README 狀態規格):左下角、深灰底、4 秒自動消失;
// 含動作(復原等)時延長至 8 秒。host-setter 模式同 confirm.jsx——
// <SnackbarHost /> 掛 App 頂層一次,appSnackbar() 從任何地方呼叫。
// 只接「新場景」的輕量回饋;被 e2e 釘住的既有 inline 回饋(已存檔 ✓ 等)不搬——
// 4 秒自動消失會讓連續斷言 race。
//
// 浮層圓角分三階(全站唯一一份說明,改之前先想清楚要動哪一階):
//   對話框 rounded-[28px] — confirm.jsx / MarkupEditor,要求使用者停下來回應
//   常駐面板 rounded-2xl  — CopilotFab,與卡片同一個圓角家族
//   瞬時浮層 rounded-lg   — snackbar 與各處下拉選單,出現即走、不該搶視覺重量
//
// 用法:
//   appSnackbar('已加入成員')
//   appSnackbar({ message: '已刪除 1 筆', actionLabel: '復原', onAction: undo })
import { useEffect, useState } from 'react'
import { MSym } from './icons.jsx'

let hostSetter = null

export function appSnackbar(opts) {
  const o = typeof opts === 'string' ? { message: opts } : opts
  hostSetter?.({ ...o, id: Symbol('snack') })
}

export function SnackbarHost() {
  const [snack, setSnack] = useState(null)
  useEffect(() => {
    hostSetter = setSnack
    return () => { hostSetter = null }
  }, [])
  useEffect(() => {
    if (!snack) return
    const t = setTimeout(() => setSnack(null), snack.actionLabel ? 8000 : 4000)
    return () => clearTimeout(t)
  }, [snack])
  if (!snack) return null
  return (
    <div role="status" aria-live="polite"
      className="fixed left-4 bottom-4 max-md:bottom-[84px] z-[90] max-w-[calc(100vw-2rem)] sm:max-w-md flex items-center gap-4 rounded-lg px-4 py-3.5 print:hidden enter-row
        bg-[var(--snackbar-bg)] text-[var(--snackbar-text)] [box-shadow:var(--shadow-md)]">
      <span className="text-[13px] leading-snug flex-1 min-w-0">{snack.message}</span>
      {snack.actionLabel && (
        <button onClick={() => { snack.onAction?.(); setSnack(null) }}
          className="shrink-0 text-[13px] font-medium text-[var(--snackbar-action)] hover:underline pressable">
          {snack.actionLabel}
        </button>
      )}
      {/* snackbar 在手機浮在底部導覽附近,關閉鈕更要吃滿 44px(W8-5 觸控標準) */}
      <button onClick={() => setSnack(null)} aria-label="關閉通知"
        className="shrink-0 w-8 h-8 max-md:w-11 max-md:h-11 -mr-2 rounded-full flex items-center justify-center opacity-70 hover:opacity-100">
        <MSym name="close" size={18} />
      </button>
    </div>
  )
}
