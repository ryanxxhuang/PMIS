// 全站共用確認對話框 — 取代原生 window.confirm，樣式與 app 一致（深色模式、品牌色）。
//
// 用法（call site 最小改動）:
//   if (await appConfirm({ title: '刪除此查驗紀錄？' })) deleteInspection(id)
// 進階:
//   await appConfirm({ title, body, danger: true, confirmLabel: '永久刪除',
//                      requireText: project_name })  // 高危險操作要求輸入名稱確認
//
// <ConfirmHost /> 掛在 App 頂層一次；appConfirm 透過模組層 setter 連到 host。
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'
import { Button, Input } from './ui.jsx'

let hostSetter = null

export function appConfirm(opts) {
  const o = typeof opts === 'string' ? { title: opts } : opts
  // host 未掛載（理論上不會發生）→ 退回原生 confirm，功能不中斷
  if (!hostSetter) return Promise.resolve(window.confirm([o.title, o.body].filter(Boolean).join('\n')))
  return new Promise((resolve) => hostSetter({ ...o, resolve }))
}

export function ConfirmHost() {
  const [req, setReq] = useState(null)
  const [text, setText] = useState('')
  const confirmBtn = useRef(null)

  useEffect(() => {
    hostSetter = setReq
    return () => { hostSetter = null }
  }, [])
  useEffect(() => {
    setText('')
    // 無輸入欄時聚焦確認鈕 → Enter 直接確認、Tab 可到取消
    if (req && !req.requireText) confirmBtn.current?.focus()
  }, [req])

  if (!req) return null
  const { title, body, confirmLabel = '確定', cancelLabel = '取消', danger = false, requireText } = req
  const ready = !requireText || text === requireText
  const close = (result) => { setReq(null); req.resolve(result) }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') close(false)
    if (e.key === 'Enter' && ready) { e.preventDefault(); close(true) }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 print:hidden" role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/40" onClick={() => close(false)} />
      <div className="relative bg-[var(--surface)] text-[var(--text)] rounded-xl border border-[var(--border)] shadow-2xl w-full max-w-sm p-5">
        <div className="flex items-start gap-3">
          <span className={`w-9 h-9 rounded-full grid place-items-center shrink-0 ${danger ? 'bg-[var(--red-tint)] text-[var(--red-text)]' : 'bg-[var(--blue-tint)] text-[var(--blue-text)]'}`}>
            {danger ? <AlertTriangle size={18} aria-hidden /> : <HelpCircle size={18} aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[15px] leading-snug">{title}</div>
            {body && <p className="text-sm text-[var(--text-2)] mt-1.5 whitespace-pre-line leading-relaxed">{body}</p>}
            {requireText && (
              <div className="mt-3">
                <div className="text-xs text-[var(--text-2)] mb-1">
                  請輸入「<b className="text-[var(--text)]">{requireText}</b>」以確認：
                </div>
                <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={requireText} />
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" onClick={() => close(false)}>{cancelLabel}</Button>
          <Button ref={confirmBtn} variant={danger ? 'danger' : 'primary'} disabled={!ready} onClick={() => close(true)}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}
