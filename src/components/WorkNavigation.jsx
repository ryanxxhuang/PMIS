import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { ROLE_WORK, WORK_GUIDANCE, visibleNavGroups, roleWorkLinks } from '../lib/navConfig.js'
import { MSym } from './icons.jsx'
import { ModalShell, SearchField } from './listDetail.jsx'
import { buttonClass } from './ui.jsx'
import { BELOW_MD_QUERY } from '../lib/useMediaQuery.js'

export function CommonWork() {
  const { currentUser, can, isPlatformAdmin } = useStore()
  const org = currentUser?.org_type
  return (
    <nav aria-label="常用工作" className="hidden md:flex flex-wrap items-center gap-2">
      <span className="text-footnote text-[var(--text-3)] mr-1">{ROLE_WORK[org]?.label}常用</span>
      {roleWorkLinks(org, can?.override, isPlatformAdmin).map((n) => (
        <Link key={n.to} to={n.to} className={buttonClass('outline', 'sm')}><MSym name={n.icon} size={16} />{n.label}</Link>
      ))}
    </nav>
  )
}

// 功能名稱的確定性搜尋；既有角色過濾是唯一來源，與 AI 問答分開。
export function FindWork({ collapsed = false, onNavigate, mobileReturnRef }) {
  const { currentUser, can, isPlatformAdmin } = useStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const returnFocusRef = useRef(null)
  const org = currentUser?.org_type
  const groups = visibleNavGroups(org, can?.override, isPlatformAdmin)
  const q = query.trim().toLocaleLowerCase()
  const rows = groups.flatMap((g) => g.items.flatMap((n) => (n.tabs || [n]).map((r) => ({
    ...r, icon: n.icon, group: n.tabs ? n.label : g.title, hint: WORK_GUIDANCE[r.to]?.[org],
  })))).filter((r) => `${r.label} ${r.group} ${r.hint || ''}`.toLocaleLowerCase().includes(q))
  return (
    <>
      <button type="button" onClick={(e) => {
        returnFocusRef.current = window.matchMedia(BELOW_MD_QUERY).matches ? mobileReturnRef?.current : e.currentTarget
        setQuery(''); onNavigate?.(); setOpen(true)
      }} aria-label="尋找功能" title="尋找功能" aria-haspopup="dialog" aria-expanded={open}
        className={`mx-3 mb-2 min-h-11 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] px-3 text-body ${collapsed ? 'md:mx-auto md:w-14 md:justify-center' : ''}`}>
        <MSym name="search" size={18} /><span className={collapsed ? 'md:hidden' : ''}>尋找功能</span>
      </button>
      <ModalShell open={open} onClose={() => setOpen(false)} title="尋找功能" size="xl" returnFocusRef={returnFocusRef}>
        <SearchField aria-label="搜尋功能或工作" placeholder="例如：查驗、補正、付款" value={query} onChange={(e) => setQuery(e.target.value)} />
        <p className="text-footnote text-[var(--text-3)] my-3">只顯示你可使用的功能。選擇一項即可前往。</p>
        <nav aria-label="功能搜尋結果" className="max-h-[50vh] overflow-y-auto divide-y divide-[var(--border-2)]">
          {rows.map((r) => (
            <Link key={r.to} to={r.to} onClick={() => setOpen(false)} className="flex items-start gap-3 px-2 py-3 min-h-11 rounded-lg hover:bg-[var(--surface-2)]">
              <MSym name={r.icon} size={18} className="mt-0.5 shrink-0 text-[var(--blue-text)]" />
              <span className="min-w-0"><span className="block text-body font-medium text-[var(--text)]">{r.label}</span>
                <span className="block text-footnote text-[var(--text-3)]">{r.hint || r.group}</span></span>
            </Link>
          ))}
          {!rows.length && <p role="status" className="py-6 text-body text-[var(--text-2)]">找不到相符功能，請換個關鍵字或清除搜尋。</p>}
        </nav>
      </ModalShell>
    </>
  )
}

export function WorkContext() {
  const { pathname, search, state } = useLocation()
  const back = state?.taskReturn
  // 只接受站內的兩個收件匣來源；單据自己的 query 更新保留此 state。
  const canReturn = back && /^\/(dashboard|alerts)(\?|$)/.test(back.to) && !['/dashboard', '/alerts'].includes(pathname)
  if (!canReturn) return null
  return (
    <div className="mb-4 print:hidden space-y-2">
      {/* returnedTo:剛才那一筆的頁面與選取(pathname+search);原項離開清單時首頁靠它給確定的回找入口(W06) */}
      {canReturn && <Link to={back.to} state={{ returnedTask: back.key, returnedTo: `${pathname}${search}` }} className="inline-flex items-center gap-1 min-h-11 text-body font-medium text-[var(--blue-text)]">
        <MSym name="chevron_left" size={18} />返回{back.label}
      </Link>}
    </div>
  )
}
