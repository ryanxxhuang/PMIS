// 共用小元件

export function Card({ title, action, children, className = '' }) {
  return (
    <div className={`bg-white rounded-lg border border-slate-200 shadow-sm ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800 text-[15px]">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  )
}

const badgeColors = {
  slate: 'bg-slate-100 text-slate-700',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-rose-100 text-rose-700',
  purple: 'bg-violet-100 text-violet-700',
}

export function Badge({ color = 'slate', children }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeColors[color]}`}>{children}</span>
}

// 依狀態字串挑顏色
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
    primary: 'bg-[#f26722] text-white hover:bg-[#dd5c14]',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    ghost: 'text-slate-500 hover:bg-slate-100',
  }
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 transition disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Stat({ label, value, sub, color = 'text-slate-800' }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    </label>
  )
}

export function SourceTag({ doc, page, section }) {
  return (
    <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
      📄 <span className="font-medium text-slate-600">{doc}</span> · {page}
      {section && <span className="block text-slate-400 mt-0.5">{section}</span>}
    </div>
  )
}

export function Empty({ children }) {
  return <div className="text-center text-slate-400 text-sm py-10">{children}</div>
}
