// Shared UI — Google Material styling (elevation surfaces, blue accent, tonal chips)

export function Card({ title, action, children, className = '' }) {
  return (
    <div className={`bg-[var(--surface)] rounded-xl g-elevation-1 ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-2)]">
          <h3 className="font-medium text-[var(--text)] text-[15px]">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
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

export function Badge({ color = 'slate', children }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeColors[color]}`}>{children}</span>
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
    primary: 'bg-[#1a73e8] text-white hover:bg-[#1765cc] shadow-sm hover:shadow',
    secondary: 'bg-[var(--surface)] text-[var(--blue)] border border-[var(--border)] hover:bg-[var(--bg)]',
    success: 'bg-[#1e8e3e] text-white hover:bg-[#188038] shadow-sm hover:shadow',
    danger: 'bg-[#d93025] text-white hover:bg-[#c5221f] shadow-sm hover:shadow',
    ghost: 'text-[var(--blue)] hover:bg-[var(--blue-tint)]',
  }
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 transition disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Stat({ label, value, sub, color = 'text-[var(--text)]' }) {
  return (
    <div className="bg-[var(--surface)] rounded-xl g-elevation-1 p-4">
      <div className="text-xs text-[var(--text-2)] tracking-wide">{label}</div>
      <div className={`text-2xl font-medium mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-xs text-[var(--text-3)] mt-0.5">{sub}</div>}
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
      📄 <span className="font-medium text-[var(--text)]">{doc}</span> · {page}
      {section && <span className="block text-[var(--text-3)] mt-0.5">{section}</span>}
    </div>
  )
}

export function Empty({ children }) {
  return <div className="text-center text-[var(--text-3)] text-sm py-10">{children}</div>
}
