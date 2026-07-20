// 全站共用確認/意見對話框 — 取代原生 window.confirm / window.prompt，
// 樣式與 app 一致（深色模式、品牌色）。原生對話框在自動化測試與嵌入式瀏覽器
// 會被封鎖成「按了沒反應」，全站一律走這裡。
//
// 用法（call site 最小改動）:
//   if (await appConfirm({ title: '刪除此查驗紀錄？' })) deleteInspection(id)
//   const note = await appPrompt({ title: '退回補正', label: '退回原因（必填）', required: true })
//   if (note !== null) ...   // null = 取消；字串（可空）= 確認
// 進階:
//   await appConfirm({ title, body, danger: true, confirmLabel: '永久刪除',
//                      requireText: project_name })  // 高危險操作要求輸入名稱確認
//
// <ConfirmHost /> 掛在 App 頂層一次；appConfirm / appPrompt 透過模組層 setter 連到 host。
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, HelpCircle, PencilLine } from 'lucide-react'
import { Button, Input } from './ui.jsx'

let hostSetter = null

export function appConfirm(opts) {
  const o = typeof opts === 'string' ? { title: opts } : opts
  // host 未掛載（理論上不會發生）→ 退回原生 confirm，功能不中斷
  if (!hostSetter) return Promise.resolve(window.confirm([o.title, o.body].filter(Boolean).join('\n')))
  return new Promise((resolve) => hostSetter({ ...o, resolve }))
}

// 意見/原因輸入面板：resolve 字串＝確認（required 時保證非空白）、null＝取消。
export function appPrompt(opts) {
  const o = typeof opts === 'string' ? { title: opts } : opts
  if (!hostSetter) return Promise.resolve(window.prompt([o.title, o.label].filter(Boolean).join('\n'), o.defaultValue || ''))
  return new Promise((resolve) => hostSetter({ ...o, prompt: true, resolve }))
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
    setText(req?.prompt ? (req.defaultValue || '') : '')
    // 無輸入欄時聚焦確認鈕 → Enter 直接確認、Tab 可到取消
    if (req && !req.requireText && !req.prompt) confirmBtn.current?.focus()
  }, [req])

  if (!req) return null
  const { title, body, confirmLabel = '確定', cancelLabel = '取消', danger = false, requireText,
    prompt: isPrompt, label, placeholder, required } = req
  const ready = isPrompt ? (!required || text.trim() !== '') : (!requireText || text === requireText)
  // confirm 模式 resolve boolean;prompt 模式 resolve 字串（確認）或 null（取消）
  const close = (ok) => { setReq(null); req.resolve(isPrompt ? (ok ? text : null) : ok) }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') close(false)
    if (e.key !== 'Enter' || !ready) return
    // prompt 的多行輸入欄:Enter 換行,Ctrl/Cmd+Enter 確認
    if (isPrompt && !(e.metaKey || e.ctrlKey)) return
    e.preventDefault(); close(true)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 print:hidden" role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/40 enter-fade" onClick={() => close(false)} />
      <div className="relative bg-[var(--surface)] text-[var(--text)] rounded-xl border border-[var(--border)] shadow-2xl w-full max-w-sm p-5 enter-modal">
        <div className="flex items-start gap-3">
          <span className={`w-9 h-9 rounded-full grid place-items-center shrink-0 ${danger ? 'bg-[var(--red-tint)] text-[var(--red-text)]' : 'bg-[var(--blue-tint)] text-[var(--blue-text)]'}`}>
            {danger ? <AlertTriangle size={18} aria-hidden /> : isPrompt ? <PencilLine size={18} aria-hidden /> : <HelpCircle size={18} aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[15px] leading-snug">{title}</div>
            {body && <p className="text-sm text-[var(--text-2)] mt-1.5 whitespace-pre-line leading-relaxed">{body}</p>}
            {isPrompt && (
              <div className="mt-3">
                {label && <div className="text-xs text-[var(--text-2)] mb-1">{label}</div>}
                <textarea autoFocus rows={3} value={text} placeholder={placeholder}
                  onChange={(e) => setText(e.target.value)}
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm transition-colors placeholder:text-[var(--text-3)] focus:border-[var(--blue)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20 resize-y" />
                {required && text.trim() === '' && <div className="text-[11px] text-[var(--text-3)] mt-1">此欄必填。</div>}
              </div>
            )}
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
