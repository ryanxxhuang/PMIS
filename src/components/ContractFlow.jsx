import { Link } from 'react-router-dom'
import { MSym } from './icons.jsx'

const ROLES = {
  contractor: { label: '施工廠商', scope: '我的契約與履約事項' },
  supervisor: { label: '監造單位', scope: '監造與廠商的契約及履約事項' },
  owner: { label: '主辦機關', scope: '三方契約與履約事項' },
}

// 兩個實際工作頁共用的接續入口；不是另一份處理進度或授權來源。
export default function ContractFlow({ active, role, packageId = '' }) {
  const view = ROLES[role]
  const query = packageId ? `?package=${encodeURIComponent(packageId)}` : ''
  return (
    <section aria-label="契約整理流程" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-2 sm:flex items-stretch gap-2 text-xs w-full sm:w-auto">
          {[['documents', '/contract', 'upload_file', '上傳契約・AI 自動整理'],
            ['highlights', '/requirements', 'fact_check', '查看契約重點']].map(([key, path, icon, label], i) => (
            <Link key={key} to={`${path}${query}`} aria-current={active === key ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-2 sm:px-3 ${active === key
                ? 'bg-[var(--blue-tint)] text-[var(--blue-text)] font-medium' : 'text-[var(--text-2)] hover:bg-[var(--surface-2)]'}`}>
              <span className="num shrink-0">{i + 1}</span><MSym name={icon} size={17} className="shrink-0 max-sm:hidden" /><span>{label}</span>
            </Link>
          ))}
        </div>
        <p className="text-xs text-[var(--text-2)] flex items-center gap-2">
          <MSym name="visibility" size={17} />{view ? `${view.label}視角` : '專案可見範圍'}
        </p>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-3)]">
        {view ? `目前查看：${view.scope}。` : '依登入身分顯示可存取的契約。'}整理結果自動歸檔，可隨時對照原文。
      </p>
    </section>
  )
}
