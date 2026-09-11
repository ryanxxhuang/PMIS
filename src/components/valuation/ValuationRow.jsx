// 估驗明細的一列(重構波次 7 由 pages/web/Valuation.jsx 的 renderRow 閉包抽出)。
//
// 為什麼要抽成 memo 元件:真實 PCCES 標單有數千末端工項,原本 renderRow 是每次 render
// 重建的閉包(捕捉 expanded/evOpen/cumThis/selected…十幾個值),任一 state 變動整棵樹
// 逐列重畫。抽成元件後每列只收「自己的」純量與穩定 reference:
//   - it / getEvidence:資料不變就是同一個 reference(useMemo 快取)
//   - isOpen / evIsOpen / cum / prevCum / qtyInput / editable / selectedId:純量
//   - onToggle / onToggleEv / onQty:頁面以 useCallback 釘住 identity
// 於是展開一列、改一格數量,只有「那一列＋其祖先(累計金額變了)」重畫。
// props 若有一個每次 render 換 identity 的物件/函式,memo 就整個失效——
// ValuationRow.test.jsx 用 getEvidence 呼叫次數當探針釘住這件事。
//
// 所有金額/百分比仍由 boqCalc 的 cumMap 算好再傳進來,這裡只做「顯示」的減法與比例。
import { memo } from 'react'
import { MSym } from '../icons.jsx'
import { fmtAmount as fmt } from '../../lib/format.js'
import { OVER_TOL, evSummary } from '../../lib/evidence.js'
import EvidenceRow from './EvidenceRow.jsx'

function ValuationRow({ it, level, hasKids, isOpen, evIsOpen, cum, prevCum, qtyInput, editable, selectedId, getEvidence, onToggle, onToggleEv, onQty }) {
  const per = cum - prevCum
  const cumQty = qtyInput ?? 0
  // 佐證只對渲染到的葉項計算(getEvidence 內部有快取)
  const ev = hasKids ? null : getEvidence(it)
  // 差異警示:估驗累計 > 日誌累計 ×1.05(與稽核頁 OVER_TOL 同一容忍值)——
  // 把送審後才會被勾稽出的「超前計價」提前呈現在填報當下
  const overBilled = ev && Number(cumQty) > 0 && Number(cumQty) > ev.loggedTotal * OVER_TOL
  // 完成百分比：父項用金額比、葉項用數量比
  const pct = hasKids
    ? (it.amount ? (cum / it.amount) * 100 : 0)
    : (it.quantity ? (cumQty / it.quantity) * 100 : 0)
  const row = (
    <tr className={`border-b border-[var(--border-2)] hover:bg-[var(--surface-2)] ${hasKids ? 'bg-[var(--bg)] font-medium' : ''}`}>
      {/* table-fixed 下改用「固定寬佔位 span」縮排:padding 縮排會吃掉欄寬,
          深層工項一縮排整欄就被推歪;佔位法讓縮排永不推移其他欄位 */}
      <td className="py-1.5 pl-5 pr-2">
        <span className="flex items-center gap-1 min-w-0">
          <span style={{ width: level * 18 }} className="shrink-0" aria-hidden="true" />
          {hasKids ? (
            // 圖示 aria-hidden,可及名稱與展開狀態仍由 aria-label/aria-expanded 承擔
            <button onClick={() => onToggle(it.item_key)} aria-expanded={isOpen} aria-label={`${isOpen ? '收合' : '展開'} ${it.item_no}`}
              className="w-4 shrink-0 inline-flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text)] max-md:min-h-11 max-md:min-w-11 max-md:-m-3.5">
              <MSym name={isOpen ? 'expand_more' : 'chevron_right'} size={16} />
            </button>
          ) : <span className="w-4 shrink-0 inline-block" />}
          <span className="text-[var(--text-3)] text-xs tabular-nums shrink-0">{it.item_no}</span>
          {/* 長工項名 ellipsis 截斷不換行(列高一致),完整名稱靠 title 提示 */}
          <span className={`truncate ${it.depth <= 2 ? 'text-[var(--text)]' : ''}`} title={it.description}>{it.description}</span>
        </span>
      </td>
      <td className="text-right text-[var(--text-3)] text-xs px-2 whitespace-nowrap">{hasKids ? '' : it.unit}</td>
      <td className="text-right text-[var(--text-2)] px-2 tabular-nums whitespace-nowrap">{hasKids ? '' : fmt(it.quantity)}</td>
      <td className="text-right text-[var(--text-2)] px-2 tabular-nums whitespace-nowrap">{hasKids ? '' : fmt(it.unit_price)}</td>
      <td className="text-right px-2 whitespace-nowrap">
        {hasKids ? (
          <span className="text-[var(--text-3)] tabular-nums">{pct.toFixed(1)}%</span>
        ) : editable ? (
          <span className="inline-flex items-center gap-1 justify-end">
            <input
              type="number" min="0" max={it.quantity || undefined} step="any"
              key={`${selectedId}:${it.item_key}:${cumQty}`}
              defaultValue={qtyInput ?? ''}
              onBlur={(e) => onQty(it, e.target.value)}
              placeholder="0"
              className="w-20 text-right border border-[var(--border)] rounded-md px-1.5 py-0.5 max-md:py-2 text-sm tabular-nums focus:border-[var(--blue)] focus:outline-none"
            />
            <span className="text-micro text-[var(--text-3)] w-9 text-right tabular-nums">{pct.toFixed(0)}%</span>
          </span>
        ) : (
          <span className="text-[var(--text-2)] tabular-nums">{fmt(cumQty)} <span className="text-micro text-[var(--text-3)]">({pct.toFixed(0)}%)</span></span>
        )}
      </td>
      <td className="text-right text-[var(--text)] px-2 tabular-nums whitespace-nowrap">{fmt(cum)}</td>
      <td className={`text-right px-2 tabular-nums whitespace-nowrap ${per > 0 ? 'text-[var(--blue-text)] font-medium' : 'text-[var(--text-3)]'}`}>{fmt(per)}</td>
      {/* 佐證欄非數字欄:固定欄寬(colgroup 200px)下拿掉 nowrap 讓摘要與警示可換行,
          否則「疑超計」長字串會溢出儲存格蓋到相鄰欄 */}
      <td className="text-left px-2 pr-5 text-xs">
        {!hasKids && ev && (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {ev.counts.logs + ev.counts.inspections + ev.counts.checklists + ev.counts.samples === 0 ? (
              <span className="text-[var(--text-3)]">無</span>
            ) : (
              <button
                onClick={() => onToggleEv(it.item_key)}
                aria-expanded={evIsOpen}
                title="展開佐證細節(日誌/查驗/檢查表/試體)"
                className="inline-flex items-center gap-0.5 text-[var(--blue-text)] hover:underline"
              >
                <MSym name={evIsOpen ? 'expand_more' : 'chevron_right'} size={14} />{evSummary(ev.counts)}
              </button>
            )}
            {overBilled && (
              // 警示原本只有琥珀色+title,手機沒有 hover 就完全讀不到語意;
              // 補圖示與「疑超計」字樣,顏色只是輔助(W8-0 §8-6)
              <span className="inline-flex items-center gap-0.5 text-caption text-[var(--amber-text)]" title="累計估驗數量高於施工日誌累計完成量逾 5%,可能超計,建議查核佐證後再計價">
                <MSym name="warning" size={11} />疑超計 估驗 {fmt(cumQty)} &gt; 日誌 {fmt(ev.loggedTotal)}
              </span>
            )}
          </span>
        )}
      </td>
    </tr>
  )
  return (
    <>
      {row}
      {!hasKids && evIsOpen && <EvidenceRow it={it} ev={ev} level={level} />}
    </>
  )
}

export default memo(ValuationRow)
