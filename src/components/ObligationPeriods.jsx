// 循環義務的期次區(P5b 逐期追蹤、P5d 完整 UI):履約時程(/requirements)與期限追蹤(/deadlines)
// 共用同一份——列的內容(期別／到期／倒數／狀態／遲交／待核對／依據)、沒有期次或不再產生的
// 說明與去哪裡補,兩頁各抄一份時 P5c 已經出現過措辭分岔。差異只在兩個插槽:
//   onSelect      期限追蹤:點某一期切到該期(?period=),列是 button、aria-current 標本期
//   renderActions 履約時程:每一期就地標記完成／取消／掛佐證,列是 li,動作由呼叫端渲染
//   anchorAction  基準日／停止條件缺口的處理入口(期限追蹤:文字指向下方基準日卡;履約時程:按鈕開設定列)
import { Link } from 'react-router-dom'
import { MSym } from './icons.jsx'
import { Badge } from './ui.jsx'
import { OB_STATUS, periodStat } from '../lib/obligationTimeline.js'

const COUNTDOWN_CLS = { overdue: 'text-[var(--red-text)]', due: 'text-[var(--amber-text)]' }

// 沒有期次的原因、或(P5c)停止條件判不出／已越界(DB 已停止產生新期,舊期仍在):說清楚去哪裡補
export function RecurrenceGapNote({ gap, ob, anchorAction = null, className = '' }) {
  if (!gap) return null
  const review = (
    <Link to={`/requirements/review?highlight=${encodeURIComponent(ob.id)}`} className="text-[var(--blue-text)] hover:underline mx-0.5">擷取審核</Link>
  )
  return (
    <p className={`text-footnote leading-relaxed text-[var(--text-3)] ${className}`}>
      {gap.label}
      {gap.kind === 'rule' && <>，請到{review}廢止取代後補登循環規則。</>}
      {gap.kind === 'anchor' && <>，補上基準日後期次會立即產生。{anchorAction}</>}
      {gap.kind === 'stop' && (ob.category === '保固'
        ? '，系統沒有保固期滿日可判定循環何時結束，暫不自動產生期次。'
        : <>，期次已停止自動產生：補上或展延竣工日，已竣工的請到<Link to="/acceptance" className="text-[var(--blue-text)] hover:underline mx-0.5">驗收</Link>登錄竣工，期次會依竣工日收尾。{anchorAction}</>)}
    </p>
  )
}

// 逐期準時率一句話(履約時程詳情與執行卡同一條定義 periodStat)
export function PeriodRateLine({ periods }) {
  const s = periodStat(periods)
  if (!s.total) return null
  return (
    <span className="num text-caption text-[var(--text-2)]">
      {s.rate == null ? '尚無到期的期' : `逐期準時率 ${s.rate}%（到期 ${s.settled} 期準時 ${s.onTime} 期）`}
    </span>
  )
}

export default function ObligationPeriods({ ob, periods, gap, currentId = null, onSelect, renderActions, anchorAction, showRate = false }) {
  const rowBody = (p) => (<>
    <span className="num font-medium text-[var(--text)]">{p.key} 期</span>
    <span className="num text-[var(--text-3)]">到期 {p.dateLabel}</span>
    <span className={`num text-caption ${COUNTDOWN_CLS[p.status] || 'text-[var(--text-2)]'}`}>{p.countdown}</span>
    <Badge color={OB_STATUS[p.status].badge} className="ml-auto">{p.rawStatus}</Badge>
    {p.status === 'done' && p.onTime === false && <span className="text-caption text-[var(--amber-text)]">遲交</span>}
    {p.reviewNote && <span className="w-full text-caption text-[var(--amber-text)]">待核對:{p.reviewNote}</span>}
    {/* 這一期依哪一版基準日產生／改期(P5c);已完成的期保留原依據 */}
    <span className="w-full num text-caption text-[var(--text-3)]">{p.basisLabel}</span>
  </>)
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <MSym name="event_repeat" size={15} className="text-[var(--text-3)]" />
        <span className="text-footnote font-medium text-[var(--text)]">期次（{periods.length}）</span>
        {showRate && <PeriodRateLine periods={periods} />}
      </div>
      <RecurrenceGapNote gap={gap} ob={ob} anchorAction={anchorAction} className="mb-2" />
      {periods.length === 0 ? (
        !gap && <p className="text-footnote leading-relaxed text-[var(--text-3)]">尚未產生期次。</p>
      ) : (
        <ul role="list" aria-label={`${ob.title} 期次`} className="divide-y divide-[var(--border-2)] border border-[var(--border-2)] rounded-lg">
          {periods.map((p) => {
            const current = currentId != null && currentId === p.id
            return (
              <li key={p.id}>
                {onSelect ? (
                  <button type="button" aria-current={current || undefined} onClick={() => onSelect(p)}
                    className={`w-full text-left px-3 py-2 max-md:min-h-11 flex items-center gap-2 flex-wrap text-footnote ${current ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
                    {rowBody(p)}
                  </button>
                ) : (
                  <div className={`px-3 py-2 flex items-center gap-2 flex-wrap text-footnote ${current ? 'bg-[var(--blue-tint)]' : ''}`}>
                    {rowBody(p)}
                    {renderActions?.(p)}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
