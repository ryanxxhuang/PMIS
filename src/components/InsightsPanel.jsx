// AI 主動觀察面板(§9-8 去重:同一份 insights 只在 Dashboard 出現——
// Dashboard=待辦+風險、AI 助理=問答、提醒中心=期限,三頁各司其職)。
import { Link } from 'react-router-dom'
import { Sparkles, ShieldCheck, AlertTriangle, Clock, ArrowRight } from 'lucide-react'
import { Card, Empty } from './ui.jsx'

const SEV = {
  risk: { color: 'var(--red-text)', bg: 'var(--red-tint)', icon: AlertTriangle, label: '需注意' },
  watch: { color: 'var(--amber-text)', bg: 'var(--amber-tint)', icon: Clock, label: '留意' },
  ok: { color: 'var(--green-text)', bg: 'var(--green-tint)', icon: ShieldCheck, label: '正常' },
}

export default function InsightsPanel({ insights }) {
  return (
    <Card title={`AI 幫你看到的（${insights.length}）`} bodyClass={insights.length ? 'p-0' : 'p-6'}
      action={<span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-3)]"><Sparkles size={12} aria-hidden />主動分析</span>}>
      {insights.length === 0 ? (
        <Empty>目前沒有偵測到需要注意的事——都在軌道上。</Empty>
      ) : (
        <ul className="divide-y divide-[var(--border-2)]">
          {insights.map((it) => {
            const s = SEV[it.sev] || SEV.watch
            const Icon = s.icon
            return (
              <li key={it.id}>
                <Link to={it.to} className="group flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-2)] transition">
                  <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 mt-0.5" style={{ background: s.bg, color: s.color }}>
                    <Icon size={16} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text)]">{it.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: s.bg, color: s.color }}>{it.tag}</span>
                    </span>
                    <span className="block text-xs text-[var(--text-3)] mt-0.5 leading-relaxed">{it.detail}</span>
                  </span>
                  <ArrowRight size={15} className="text-[var(--text-3)] group-hover:text-[var(--text-2)] shrink-0 mt-1" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
