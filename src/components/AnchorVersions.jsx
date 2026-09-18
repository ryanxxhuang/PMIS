// 基準日版本(P5c project_anchor_versions):期限追蹤與履約時程共用的純呈現元件——
// 目前依據哪一版(類別、生效日、依據函文)、變更後受影響了哪些事項(改期／移除／新增／保留原依據),
// 以及可展開的完整版本紀錄。版本列由 DB trigger／RPC 產生、append-only,這裡不寫任何東西。
// 規範 §1 第 6 條:「這個數字來自哪裡?點得進去嗎?」——到期日要能追到是依哪一版基準日、哪份文件算的。
import { useState } from 'react'
import { MSym } from './icons.jsx'
import { Badge } from './ui.jsx'
import { anchorVersionRows } from '../lib/obligationTimeline.js'

const EFFECT_LABEL = { rescheduled: '改期', removed: '移除', added: '新增', kept: '保留原依據' }
const EFFECT_COLOR = { rescheduled: 'amber', removed: 'red', added: 'blue', kept: 'slate' }
const fmt = (d) => (d ? String(d).slice(0, 10) : '—')

// 一版的受影響事項清單(單次義務:舊到期→新到期;期次:期別 舊→新)
export function AnchorVersionEffects({ effects, compact = false }) {
  if (!effects?.length) return <p className="text-caption text-[var(--text-3)] leading-relaxed">沒有受影響的事項。</p>
  return (
    <ul role="list" className={`divide-y divide-[var(--border-2)] ${compact ? '' : 'border border-[var(--border-2)] rounded-lg'}`}>
      {effects.map((e, i) => (
        <li key={`${e.obligation_id}-${e.period_key || 'single'}-${i}`} className="px-3 py-1.5 flex items-center gap-2 flex-wrap text-caption">
          <Badge color={EFFECT_COLOR[e.kind] || 'slate'}>{EFFECT_LABEL[e.kind] || e.kind}</Badge>
          <span className="text-[var(--text)] min-w-0 [text-wrap:pretty]">{e.title}{e.period_key ? `（${e.period_key} 期）` : ''}</span>
          <span className="num text-[var(--text-3)] ml-auto">
            {e.kind === 'kept' ? `到期 ${fmt(e.old_due)} 不變（${e.status || '已完成'}）`
              : e.kind === 'added' ? `到期 ${fmt(e.new_due)}`
                : e.kind === 'removed' ? `原到期 ${fmt(e.old_due)}`
                  : `${fmt(e.old_due)} → ${fmt(e.new_due)}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function AnchorVersions({ versions, latestOnly = false }) {
  const [open, setOpen] = useState(false)
  const rows = anchorVersionRows(versions)
  const current = rows[0]
  if (!current) {
    return <p className="text-caption text-[var(--text-3)] leading-relaxed">尚無基準日版本：第一次填入基準日時會自動留下第 1 版。</p>
  }
  const summary = (r) => [
    r.kindLabel, r.effectiveFrom ? `生效 ${r.effectiveFrom}` : null, r.sourceRef ? `依據 ${r.sourceRef}` : '未附依據文件',
    r.reason ? r.reason : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-footnote">
        <MSym name="history" size={15} className="text-[var(--text-3)]" />
        <span className="font-medium text-[var(--text)]">{current.versionNo ? `目前依據第 ${current.versionNo} 版基準日` : '目前依據（示範）'}</span>
        <span className="text-[var(--text-3)]">{summary(current)}</span>
        {rows.length > 1 && !latestOnly && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="ml-auto text-caption text-[var(--blue-text)] hover:underline pressable max-md:min-h-11">
            {open ? '收合版本紀錄' : `版本紀錄（${rows.length}）`}
          </button>
        )}
      </div>
      {current.changes.length > 0 && (
        <p className="num text-caption text-[var(--text-2)]">
          本版變更：{current.changes.map((c) => `${c.label} ${fmt(c.from)} → ${fmt(c.to)}`).join('、')}
          {current.affected > 0 ? `；${current.affected} 個事項因此改期／增減` : '；沒有事項因此改期'}
          {current.kept > 0 ? `，${current.kept} 個已完成事項保留原依據` : ''}
          {current.demo ? '（示範模式：期次不重算）' : ''}
        </p>
      )}
      {current.effects.length > 0 && <AnchorVersionEffects effects={current.effects} />}
      {open && (
        <ol role="list" aria-label="基準日版本紀錄" className="divide-y divide-[var(--border-2)] border border-[var(--border-2)] rounded-lg">
          {rows.map((r) => (
            <li key={r.id || r.versionNo} className="px-3 py-2 text-caption space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="num font-medium text-[var(--text)]">第 {r.versionNo ?? '—'} 版</span>
                <Badge color={r.kind === 'initial' ? 'slate' : 'blue'}>{r.kindLabel}</Badge>
                <span className="text-[var(--text-3)]">{[r.effectiveFrom ? `生效 ${r.effectiveFrom}` : null, r.sourceRef ? `依據 ${r.sourceRef}` : null, r.reason || null].filter(Boolean).join(' · ') || '未附依據'}</span>
                <span className="num text-[var(--text-3)] ml-auto">{r.createdAt ? String(r.createdAt).slice(0, 10) : ''}</span>
              </div>
              {r.changes.length > 0 && (
                <div className="num text-[var(--text-2)]">{r.changes.map((c) => `${c.label} ${fmt(c.from)} → ${fmt(c.to)}`).join('、')}</div>
              )}
              {r.kind === 'initial' && !r.changes.length && <div className="text-[var(--text-3)]">初值快照</div>}
              {r.effects.length > 0 && <AnchorVersionEffects effects={r.effects} compact />}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
