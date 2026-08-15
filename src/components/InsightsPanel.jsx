// AI 主動觀察摘要(W8-2B):降為今日待辦下方的一行風險摘要。
// 這裡的東西不是待辦——沒有球權、沒有完成條件、也沒有唯一目的地,
// 而且多數在語意上重複真待辦(缺失逾期/契約到期/待撥款/待核定變更/試體逾期)。
// 佔一整張卡會讓人以為要逐項處理,所以只留一行,細節走各自的目的頁。
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'

const SEV_DOT = { risk: 'var(--red-text)', watch: 'var(--amber-text)', ok: 'var(--green-text)' }
// 嚴重度不能只靠顏色(W8-0 §8-6):色盲與報讀器都拿不到紅/琥珀/綠的差別,
// 所以同一顆點要帶等價的文字名稱
const SEV_LABEL = { risk: '需注意', watch: '留意', ok: '正常' }
const SHOWN = 3

export default function InsightsPanel({ insights }) {
  if (!insights?.length) return null // 沒有風險就不要多一行空話
  const shown = insights.slice(0, SHOWN)
  return (
    <div className="bg-[var(--surface)] rounded-xl border border-[var(--border-card)] px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-3)] shrink-0">
        <Sparkles size={12} aria-hidden />AI 幫你看到的 {insights.length} 件
      </span>
      {shown.map((it) => (
        <Link key={it.id} to={it.to} title={it.detail}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-2)] hover:text-[var(--blue-text)] hover:underline">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SEV_DOT[it.sev] || SEV_DOT.watch }}
            role="img" aria-label={SEV_LABEL[it.sev] || SEV_LABEL.watch} />
          {it.title}
        </Link>
      ))}
      {insights.length > SHOWN && (
        <span className="text-[11px] text-[var(--text-3)]">＋{insights.length - SHOWN} 項</span>
      )}
    </div>
  )
}
