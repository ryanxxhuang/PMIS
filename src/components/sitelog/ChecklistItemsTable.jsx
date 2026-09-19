// 檢查／查驗項目表(P3b 自主檢查表、P3c 監造查驗表單共用;從 SelfCheckFields 抽出,版面與規則不變):
// 每項=範本項目(kind num／bool)＋值＋判定預覽章＋來源／狀態章。實測值(num)系統永遠不填:告示板讀數只以 hint 提示,人可一鍵
// 「採用」——採用也是人填(confirmed/human);勾選項由人勾。合格判定只是預覽(lib/qc.js judgeChecklist),簽署時 DB 以
// fn_checklist_judge 同一條規則重算為準。唯讀視角只有文字與章,不長出任何 input(唯讀 e2e 契約)。
import { Badge, THEAD_CLS } from '../ui.jsx'
import { judgeItem, judgeChecklist, checklistCoverage, coverageText } from '../../lib/qc.js'
import { fieldAnchorId } from './DailyLogFields.jsx'

const INPUT_CLS = 'border border-[var(--border)] rounded px-1.5 py-0.5 text-sm max-md:py-2 bg-[var(--surface)] text-[var(--text)] focus:border-[var(--blue)] focus:outline-none'

// 判定章:○ 合格 / ✕ 不合格 / — 未檢(與 ChecklistSection 同一套符號)
export function PassMark({ pass }) {
  if (pass === true) return <span className="text-[var(--green-text)] font-semibold">○</span>
  if (pass === false) return <span className="text-[var(--red-text)] font-semibold">✕</span>
  return <span className="text-[var(--text-3)]">—</span>
}

// template:本案 checklist_templates 列;values:{no: value};sources:field_sources;onSet(key, value)／onNa(key, title)／chip(key, extra)
// 由呼叫端提供(自檢表與查驗表單各自綁自己的 state 純函式);note:框架範本 results 欄的說明;measurer:實測值由誰量測(文案)
export default function ChecklistItemsTable({ template, values = {}, sources = {}, editable = false, onSet, onNa, chip, note = null, measurer = '廠商', label = '判定預覽' }) {
  const items = Array.isArray(template?.items) ? template.items : []
  const live = template ? judgeChecklist(template, values) : null
  const cov = template ? checklistCoverage(template, live?.results) : null
  let lastGroup = null
  return (
    <div>
      {note && <p className="text-caption text-[var(--text-3)] mb-2">{note}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className={`${THEAD_CLS} border-b border-[var(--border)]`}>
              <th className="text-left py-1.5 w-14">項次</th>
              <th className="text-left">檢查項目</th>
              <th className="text-left px-2">檢查標準</th>
              <th className="text-right px-2 w-32">實測值／勾選</th>
              <th className="text-center w-12">判定</th>
              <th className="text-left px-2">來源／狀態</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const key = `results.${it.no}`
              const v = values[it.no]
              const src = sources?.[key]
              const isNa = src?.status === 'na'
              const groupRow = it.group !== lastGroup
              lastGroup = it.group
              const title = `${it.no} ${it.item}`
              return [
                groupRow && it.group && (
                  <tr key={`g-${it.group}`}><td colSpan={6} className="pt-2 pb-1 text-caption font-semibold tracking-[0.08em] text-[var(--text-3)]">{it.group}</td></tr>
                ),
                <tr key={it.no} id={fieldAnchorId(key)} className="border-b border-[var(--border-2)] align-top">
                  <td className="py-1.5 text-xs text-[var(--text-3)] num">{it.no}</td>
                  <td className="py-1.5 pr-2">{it.item}</td>
                  <td className="py-1.5 px-2 text-xs text-[var(--text-2)]">{it.standard}{it.source ? <span className="text-[var(--text-3)]">（{it.source}）</span> : ''}</td>
                  <td className="py-1.5 px-2 text-right">
                    {isNa ? <span className="text-xs text-[var(--text-3)]">不適用</span> : editable ? (
                      it.kind === 'bool' ? (
                        <span className="inline-flex items-center gap-2 justify-end">
                          <label className="inline-flex items-center gap-1 max-md:min-h-11"><input type="checkbox" className="w-5 h-5" aria-label={`${title} 合格`} checked={v === true} onChange={(e) => onSet(key, e.target.checked ? true : null)} />合格</label>
                          <label className="inline-flex items-center gap-1 max-md:min-h-11"><input type="checkbox" className="w-5 h-5" aria-label={`${title} 不合格`} checked={v === false} onChange={(e) => onSet(key, e.target.checked ? false : null)} />不合格</label>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 justify-end">
                          <input type="number" step="any" inputMode="decimal" value={v ?? ''} aria-label={`${title} 實測值`}
                            onChange={(e) => onSet(key, e.target.value === '' ? null : Number(e.target.value))}
                            className={`${INPUT_CLS} w-24 text-right tabular-nums`} />
                          <span className="text-micro text-[var(--text-3)] w-10">{it.unit || ''}</span>
                        </span>
                      )
                    ) : (
                      <span className="num">{v === true ? '✓' : v === false ? '✗' : v ?? <span className="text-[var(--text-3)]">待補</span>}{typeof v === 'number' && it.unit ? ` ${it.unit}` : ''}</span>
                    )}
                    {editable && !isNa && src?.hint && v == null && (
                      <div className="mt-1 text-caption text-[var(--amber-text)]">
                        告示板讀數 {src.hint.value}{src.hint.unit || ''}（僅供參考）
                        <button type="button" onClick={() => onSet(key, src.hint.value)} className="ml-1 font-medium text-[var(--blue-text)] hover:underline min-h-11 md:min-h-0">親自量測後採用此值</button>
                      </div>
                    )}
                  </td>
                  <td className="text-center py-1.5"><PassMark pass={isNa ? null : judgeItem(it, v)} /></td>
                  <td className="px-2 py-1.5">{chip(key, { naLabel: '不適用', onNa: () => onNa(key, title) })}</td>
                </tr>,
              ]
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-3 flex-wrap text-footnote">
        {live?.overall
          ? <Badge color={live.overall === '合格' ? 'green' : 'red'}>{label}：{live.overall}{live.failed.length ? `（${live.failed.length} 項不合格）` : ''}</Badge>
          : <Badge color="slate">{label}：尚無已檢項目</Badge>}
        {cov && <span className={cov.unchecked ? 'text-[var(--amber-text)]' : 'text-[var(--text-3)]'}>{coverageText(cov)}{cov.unchecked ? '；判定僅依已檢項' : ''}</span>}
        <span className="text-caption text-[var(--text-3)]">簽署時由伺服器依範本量化標準重算，畫面判定只是預覽；實測值一律由{measurer}親自量測填寫。</span>
      </div>
    </div>
  )
}
