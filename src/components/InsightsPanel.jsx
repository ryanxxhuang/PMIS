// AI 主動觀察(W8-2B → Google 改版):升級為「風險警示」卡,住在今日待辦右欄。
// 這裡的東西仍不是待辦——沒有球權、沒有完成條件、也沒有唯一目的地,
// 每則只是「發現+依據」,細節與處理一律走各自的目的頁;沒有風險就整張卡不渲染。
// 卡頭保持中性白底(README 明令不鋪紅底),紅色只出現在標題左側 warning 圖示與分級色票。
import { Link } from 'react-router-dom'
import { MSym } from './icons.jsx'
import { Badge, Card } from './ui.jsx'

// 風險分級(README):高=red、中=amber、低=green。嚴重度不能只靠顏色(W8-0 §8-6):
// 色盲與報讀器拿不到色差,所以色票一律帶等價文字——原本 aria-label 色點的升級版,
// 分級文字從隱藏屬性變成人人可見。
const SEV = {
  risk: { color: 'red', label: '風險 高' },
  watch: { color: 'amber', label: '風險 中' },
  ok: { color: 'green', label: '風險 低' },
}
const SHOWN = 3

export default function InsightsPanel({ insights }) {
  if (!insights?.length) return null // 沒有風險就不要多一張空卡
  const shown = insights.slice(0, SHOWN)
  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><MSym name="warning" size={20} className="text-[var(--danger)]" />風險警示</span>}
      action={<span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-3)] shrink-0"><MSym name="auto_awesome" size={12} />AI 幫你看到的 {insights.length} 件</span>}
      bodyClass="p-0"
    >
      <ul className="divide-y divide-[var(--border-2)]">
        {shown.map((it) => {
          const sev = SEV[it.sev] || SEV.watch
          return (
            <li key={it.id}>
              <Link to={it.to} className="group flex items-start gap-3 px-5 py-3 min-h-11 hover:bg-[var(--surface-2)] transition-colors">
                <Badge color={sev.color}>{sev.label}</Badge>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-[var(--text)]">{it.title}</span>
                  {/* 依據原本藏在 title tooltip,手機摸不到;改成可見小字 */}
                  {it.detail && <span className="block text-[11px] text-[var(--text-3)] leading-snug mt-0.5">{it.detail}</span>}
                </span>
                <MSym name="chevron_right" size={16} className="text-[var(--text-3)] group-hover:text-[var(--text-2)] shrink-0 mt-1" />
              </Link>
            </li>
          )
        })}
        {insights.length > SHOWN && (
          <li className="px-5 py-2 text-[11px] text-[var(--text-3)]">＋{insights.length - SHOWN} 項</li>
        )}
      </ul>
    </Card>
  )
}
