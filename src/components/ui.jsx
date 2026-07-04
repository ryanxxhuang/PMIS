// Shared UI — brand styling (elevation surfaces, steel-blue primary, tonal chips)
import { FileText } from 'lucide-react'

export function Card({ title, action, children, className = '' }) {
  return (
    <div className={`bg-[var(--surface)] rounded-lg g-elevation-1 ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-2)]">
          <h3 className="font-semibold text-[var(--text)] text-[13px] tracking-wide">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

// 圖框頁首(title block):左=頁名+說明,右=等寬字資訊格(工程代碼/日期…),底=粗+細雙墨線
export function PageHeader({ title, tagline, subtitle, meta = [], action }) {
  return (
    <div className="title-block">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[var(--text)] tracking-tight leading-tight">
            {title}
            {tagline && <span className="ml-2 text-sm font-normal text-[var(--text-3)]">{tagline}</span>}
          </h1>
          {subtitle && <p className="text-xs text-[var(--text-2)] mt-1 truncate">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {meta.length > 0 && (
            <dl className="hidden sm:flex items-stretch divide-x divide-[var(--border)] border border-[var(--border)] rounded">
              {meta.map((m) => (
                <div key={m.k} className="px-2.5 py-1 leading-tight">
                  <dt className="text-[9px] tracking-[0.1em] text-[var(--text-3)]">{m.k}</dt>
                  <dd className="text-[11px] num text-[var(--text)]">{m.v}</dd>
                </div>
              ))}
            </dl>
          )}
          {action}
        </div>
      </div>
    </div>
  )
}

// Material tonal chips (Google semantic colors)
const badgeColors = {
  slate: 'bg-[var(--slate-tint)] text-[var(--slate-text)]',
  blue: 'bg-[var(--blue-tint)] text-[var(--blue-text)]',
  green: 'bg-[var(--green-tint)] text-[var(--green-text)]',
  amber: 'bg-[var(--amber-tint)] text-[var(--amber-text)]',
  red: 'bg-[var(--red-tint)] text-[var(--red-text)]',
  purple: 'bg-[var(--purple-tint)] text-[var(--purple-text)]',
}

// 章戳式標籤:方角小戳記,像文件上的核章,不用膠囊
export function Badge({ color = 'slate', children }) {
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-xs font-medium ${badgeColors[color]}`}>{children}</span>
}

// Pick a chip color from a status string
export function StatusBadge({ status }) {
  const map = {
    Review: 'amber', 'Not Started': 'slate', Submitted: 'blue', 'Submitted for Review': 'blue',
    'Under Review': 'amber', Approved: 'green', Closed: 'green', Rejected: 'red', Overdue: 'red',
    Open: 'red', 'In Progress': 'amber', '已上傳': 'slate', 'AI 已解析': 'purple',
    '草稿': 'slate', '已發布': 'green', '已送出': 'blue', '已產出': 'green', '施工中': 'blue',
    '審核中': 'amber', '核准': 'green', '核准(具註記)': 'green', '退回修正': 'red', '駁回': 'red', '已結案': 'green',
    '待回覆': 'amber', '已回覆': 'blue',
  }
  return <Badge color={map[status] || 'slate'}>{status}</Badge>
}

export function Button({ variant = 'primary', className = '', children, ...props }) {
  const styles = {
    primary: 'bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] shadow-sm hover:shadow',
    secondary: 'bg-[var(--surface)] text-[var(--blue-text)] border border-[var(--border)] hover:bg-[var(--bg)]',
    success: 'bg-[var(--success)] text-white hover:bg-[var(--success-hover)] shadow-sm hover:shadow',
    danger: 'bg-[var(--danger)] text-white hover:bg-[var(--danger-hover)] shadow-sm hover:shadow',
    ghost: 'text-[var(--blue)] hover:bg-[var(--blue-tint)]',
  }
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap shrink-0 transition disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Stat({ label, value, sub, color = 'text-[var(--text)]' }) {
  return (
    <div className="bg-[var(--surface)] rounded-lg g-elevation-1 px-3.5 py-3">
      <div className="text-[11px] text-[var(--text-3)] tracking-[0.06em]">{label}</div>
      <div className={`text-xl font-semibold mt-0.5 tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-3)] mt-0.5 tabular-nums truncate">{sub}</div>}
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-[var(--text)] mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[var(--text-3)] mt-1">{hint}</span>}
    </label>
  )
}

export function SourceTag({ doc, page, section }) {
  return (
    <div className="text-xs text-[var(--text-2)] bg-[var(--bg)] border border-[var(--border-2)] rounded-lg px-2.5 py-1.5">
      <FileText size={12} className="inline -mt-0.5 mr-1 text-[var(--text-3)]" aria-hidden /><span className="font-medium text-[var(--text)]">{doc}</span> · {page}
      {section && <span className="block text-[var(--text-3)] mt-0.5">{section}</span>}
    </div>
  )
}

export function Empty({ children }) {
  return <div className="text-center text-[var(--text-3)] text-sm py-10">{children}</div>
}
