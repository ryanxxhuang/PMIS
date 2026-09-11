import { Link } from 'react-router-dom'
import { MSym } from '../components/icons.jsx'

// 公開長文頁(服務條款/隱私權政策)共用的殼。第二個使用點出現才抽(DEVELOPMENT §3):
// Security.jsx 先寫了一次,條款與隱私是第二、第三個。Security.jsx 暫不改接,
// 下次動它時再換成這一份。
//
// 版面刻意例外(與 Security.jsx 同一組理由):公開長文不套 Card——白卡切段讓文件更難讀;
// h1 title2 / h2 base 500 / 內文 sm 三階;根節奏 space-y-10 讓段落像文件而非儀表板。
export const LEGAL_CONTACT = import.meta.env.VITE_SECURITY_CONTACT || 'security@gov-agent.ai'

export function LegalSection({ icon, title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-medium text-[var(--text)]">
        <MSym name={icon} size={18} className="text-[var(--blue-text)]" />
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-[var(--text-2)]">{children}</div>
    </section>
  )
}

export function LegalPage({ kicker, kickerIcon, title, updated, version, intro, children }) {
  const base = import.meta.env.BASE_URL
  return (
    <div className="min-h-screen bg-[var(--bg)] px-6 py-12">
      <main className="mx-auto w-full max-w-3xl space-y-10">
        <header className="space-y-3">
          {/* 字標與 Layout／Login／Security 同一組 lockup */}
          <Link to="/login" className="inline-flex items-center gap-1.5 max-md:min-h-11" aria-label="GovAgent 公共工程登入頁">
            <img src={`${base}brand/pmis-mark.svg`} alt="" className="w-6 h-6 dark:hidden" />
            <img src={`${base}brand/pmis-mark-dark.svg`} alt="" className="w-6 h-6 hidden dark:block" />
            <span className="text-title3 font-medium tracking-tight text-[var(--text)]">Gov<span className="text-[var(--blue)]">Agent</span></span>
          </Link>
          <div className="flex items-center gap-2 text-sm text-[var(--text-3)]">
            <MSym name={kickerIcon} size={16} />
            {kicker}
          </div>
          <h1 className="text-title2 font-normal tracking-[-0.005em] text-[var(--text)]">{title}</h1>
          <p className="text-xs text-[var(--text-3)]">版本 {version}・更新 {updated}</p>
          {intro && <p className="text-sm leading-relaxed text-[var(--text-2)]">{intro}</p>}
        </header>
        {children}
        <footer className="flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border)] pt-6 text-xs text-[var(--text-3)]">
          <Link to="/terms" className="hover:underline">服務條款</Link>
          <Link to="/privacy" className="hover:underline">隱私權政策</Link>
          <Link to="/security" className="hover:underline">漏洞回報</Link>
          <Link to="/login" className="hover:underline">回登入頁</Link>
        </footer>
      </main>
    </div>
  )
}
