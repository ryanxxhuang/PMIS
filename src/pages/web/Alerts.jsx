import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Scale } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Empty, PageHeader } from '../../components/ui.jsx'
import { computeObligationDue } from '../../lib/contractDue.js'
import { parseLocalDate } from '../../lib/dates.js'

const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const diffDays = (d) => Math.round((d - today0()) / 86400000)

export default function Alerts() {
  const { project, obligations, defects, valuations, safetyRecords, currentProject, isSupabaseConfigured } = useStore()

  const alerts = useMemo(() => {
    const a = {
      award_date: currentProject?.award_date, notice_date: currentProject?.notice_date,
      commencement_date: currentProject?.commencement_date, end_date: currentProject?.end_date,
    }
    const out = []

    // 契約義務:未完成且有到期日
    for (const ob of obligations) {
      if (ob.status === '已提送' || ob.status === '已完成') continue
      const due = computeObligationDue(ob, a)
      if (!due) continue
      const d = diffDays(due)
      if (d < 0) out.push({ level: 'overdue', tag: '契約', title: ob.title, meta: `逾期 ${-d} 天(到期 ${iso(due)})`, extra: ob.penalty, to: '/contract' })
      else if (d <= 7) out.push({ level: 'soon', tag: '契約', title: ob.title, meta: `還有 ${d} 天(到期 ${iso(due)})`, extra: ob.penalty, to: '/contract' })
    }

    // 品質缺失:未結案
    for (const df of defects) {
      if (df.status === '已結案') continue
      const due = parseLocalDate(df.due_date)
      const d = due ? diffDays(due) : null
      if (d != null && d < 0) out.push({ level: 'overdue', tag: '缺失', title: df.title, meta: `改善逾期 ${-d} 天 · ${df.status}`, to: '/quality' })
      else if (d != null && d <= 7) out.push({ level: 'soon', tag: '缺失', title: df.title, meta: `${d} 天內應改善 · ${df.status}`, to: '/quality' })
      else out.push({ level: 'todo', tag: '缺失', title: df.title, meta: `未結案 · ${df.status}`, to: '/quality' })
    }

    // 工安缺失:未完成
    for (const s of safetyRecords) {
      if (s.record_type !== '工安缺失' || s.status === '已完成') continue
      const due = parseLocalDate(s.due_date)
      const d = due ? diffDays(due) : null
      if (d != null && d < 0) out.push({ level: 'overdue', tag: '工安', title: s.title, meta: `改善逾期 ${-d} 天 · ${s.status}`, to: '/safety' })
      else if (d != null && d <= 7) out.push({ level: 'soon', tag: '工安', title: s.title, meta: `${d} 天內應改善 · ${s.status}`, to: '/safety' })
      else out.push({ level: 'todo', tag: '工安', title: s.title, meta: `未改善 · ${s.status}`, to: '/safety' })
    }

    // 請款 / 收款
    for (const v of valuations) {
      if (v.status === '已核定' && !v.invoice_date) out.push({ level: 'todo', tag: '請款', title: `第 ${v.period_no} 期估驗待請款`, meta: '已核定,尚未請款', to: '/payments' })
      else if (v.invoice_date && !v.paid_date) out.push({ level: 'todo', tag: '收款', title: `第 ${v.period_no} 期待收款`, meta: `已於 ${v.invoice_date} 請款`, to: '/payments' })
    }
    return out
  }, [obligations, defects, valuations, safetyRecords, currentProject])

  const groups = [
    { key: 'overdue', label: '已逾期', color: 'red' },
    { key: 'soon', label: '即將到期(7 日內)', color: 'amber' },
    { key: 'todo', label: '待處理', color: 'blue' },
  ].map((g) => ({ ...g, items: alerts.filter((x) => x.level === g.key) }))

  if (isSupabaseConfigured && !currentProject) {
    return <Card title="提醒中心"><Empty>請先登入並選擇專案。</Empty></Card>
  }

  const tagColor = (t) => ({ 契約: 'var(--purple-text)', 缺失: 'var(--red-text)', 工安: 'var(--amber-text)', 請款: 'var(--blue-text)', 收款: 'var(--green-text)' }[t] || 'var(--text-3)')

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <PageHeader title="提醒中心" tagline="該處理的都在這" subtitle="彙整契約到期、缺失改善、請款收款的待辦與逾期" />
      </div>

      {alerts.length === 0 ? (
        <Card title="提醒"><Empty>目前沒有逾期或待處理事項 — 都跟上了。</Empty></Card>
      ) : groups.filter((g) => g.items.length).map((g) => (
        <Card key={g.key} title={`${g.label}（${g.items.length}）`}>
          <div className="space-y-1.5">
            {g.items.map((x, i) => (
              <Link key={i} to={x.to} className="flex items-start gap-3 px-3 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--surface-2)] transition">
                <span className="text-[11px] font-medium px-1.5 py-0.5 rounded shrink-0 mt-0.5" style={{ color: tagColor(x.tag), background: 'var(--surface-2)' }}>{x.tag}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[var(--text)] truncate">{x.title}</div>
                  <div className="text-xs text-[var(--text-3)]">{x.meta}</div>
                  {x.extra && <div className="text-xs text-[var(--amber-text)] truncate flex items-center gap-1"><Scale size={12} className="shrink-0" aria-hidden /> {x.extra}</div>}
                </div>
                <span className="text-[var(--text-3)] text-xs shrink-0 mt-0.5">→</span>
              </Link>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
