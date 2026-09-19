// 估驗明細的一列(重構波次 7 由 pages/web/Valuation.jsx 的 renderRow 閉包抽出)。
//
// 為什麼要抽成 memo 元件:真實 PCCES 標單有數千末端工項,原本 renderRow 是每次 render
// 重建的閉包(捕捉 expanded/evOpen/cumThis/selected…十幾個值),任一 state 變動整棵樹
// 逐列重畫。抽成元件後每列只收「自己的」純量與穩定 reference:
//   - it / getEvidence / state / flags:資料不變就是同一個 reference(useMemo 快取)
//   - isOpen / evIsOpen / srcIsOpen / cum / prevCum / qtyInput / editable / selectedId / inputEpoch:純量
//   - onToggle / onToggleEv / onToggleSrc / onQty / onSetBasis / onRevoke / onReduce / onIssue / onCover:頁面以 useCallback 釘住 identity
//   - activeConfirmations(P4d,本工項 active 確認的陣列):由頁面 useMemo 依 confirmations 分組,資料不變同一 reference
// 於是展開一列、改一格數量,只有「那一列＋其祖先(累計金額變了)」重畫。
// props 若有一個每次 render 換 identity 的物件/函式,memo 就整個失效——
// ValuationRow.test.jsx 用 getEvidence 呼叫次數當探針釘住這件事。
//
// 金額(cum/prevCum)由 boqCalc 以 DB 的 amount_cum 加總後傳進來;上限／可再增／缺件(state/flags)
// 來自 get_valuation_state。這裡不算金額、不算上限,只做「顯示」的減法與比例(P4c)。
import { memo } from 'react'
import { MSym } from '../icons.jsx'
import { fmtAmount as fmt } from '../../lib/format.js'
import { TreeToggle, Badge } from '../ui.jsx'
import { evSummary } from '../../lib/evidence.js'
import { classifyLogDiff } from '../../lib/integrityAudit.js'
import EvidenceRow from './EvidenceRow.jsx'
import SourceRow from './SourceRow.jsx'

// 總價／間接費的計價依據選項(續接清單 §6 Q3:暫時隔離;監造可在此解除隔離;pro_rata 需規則,待 Q3 定案後開放)
const BASIS_OPTIONS = [
  ['', '計價依據待設定(不計價)'],
  ['supervisor_certificate', '監造確認單'],
  ['inspection', '依查驗確認量'],
  ['excluded', '不由本系統計價'],
]

function ValuationRow({ it, level, hasKids, isOpen, evIsOpen, srcIsOpen, cum, prevCum, qtyInput, editable, selectedId, inputEpoch = 0,
  state, flags, basisEditable = false, confirmationsById, inspectionsById, nameOf,
  activeConfirmations, periodStatus, canManage = false, onRevoke, onReduce, onIssue, onCover,
  getEvidence, onToggle, onToggleEv, onToggleSrc, onQty, onSetBasis }) {
  const per = cum - prevCum
  const cumQty = qtyInput ?? 0
  // 佐證只對渲染到的葉項計算(getEvidence 內部有快取)
  const ev = hasKids ? null : getEvidence(it)
  // 日誌申報量 vs 估驗累計的差異(與下方「缺件與檢核」發現 1／2 同一支 classifyLogDiff);申報只作比對,不計價
  const logDiff = ev ? classifyLogDiff(cumQty, ev.loggedTotal) : 'ok'
  // 完成百分比：父項用金額比、葉項用數量比
  const pct = hasKids
    ? (it.amount ? (cum / it.amount) * 100 : 0)
    : (it.quantity ? (cumQty / it.quantity) * 100 : 0)
  const unbacked = !!(flags && flags.length)
  const sourceCount = state?.sources?.length || 0
  const row = (
    <tr className={`border-b border-[var(--border-2)] hover:bg-[var(--surface-2)] ${hasKids ? 'bg-[var(--bg)] font-medium' : ''}`}>
      {/* table-fixed 下改用「固定寬佔位 span」縮排:padding 縮排會吃掉欄寬,
          深層工項一縮排整欄就被推歪;佔位法讓縮排永不推移其他欄位 */}
      <td className="py-1.5 pl-5 pr-2">
        <span className="flex items-center gap-1 min-w-0">
          <span style={{ width: level * 18 }} className="shrink-0" aria-hidden="true" />
          {hasKids ? (
            // 形狀(16px 溝槽 / 手機 44 命中區 / 圖示)收斂在 TreeToggle,這裡只給語意:
            // 可及名稱與展開狀態由 aria-label/aria-expanded 承擔,圖示本身 aria-hidden
            <TreeToggle open={isOpen} label={`${isOpen ? '收合' : '展開'} ${it.item_no}`} onClick={() => onToggle(it.item_key)} />
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
          <span className="inline-flex flex-col items-end gap-0.5">
            <span className="inline-flex items-center gap-1 justify-end">
              <input
                type="number" min="0" step="any"
                // key 含 inputEpoch:DB 拒絕(VQ006 等)後頁面 bump epoch,輸入框回到 DB 的值,不留被拒的數字
                key={`${selectedId}:${it.item_key}:${cumQty}:${inputEpoch}`}
                defaultValue={qtyInput ?? ''}
                onBlur={(e) => onQty(it, e.target.value)}
                placeholder="0"
                aria-label={`${it.item_no} 累計完成數量`}
                className="w-20 text-right border border-[var(--border)] rounded-md px-1.5 py-0.5 max-md:py-2 text-sm tabular-nums focus:border-[var(--blue)] focus:outline-none"
              />
              <span className="text-micro text-[var(--text-3)] w-9 text-right tabular-nums">{pct.toFixed(0)}%</span>
            </span>
            {/* 上限來自 DB(headroom=本期還能再分配的確認量);沒有 state(demo／載入中)就不顯示,不假造 */}
            {state && (
              <span className="text-micro text-[var(--text-3)] tabular-nums whitespace-nowrap">
                {state.basis == null ? '計價依據待設定' : `可再增 ${fmt(state.headroom, { empty: '0' })}`}
              </span>
            )}
          </span>
        ) : (
          <span className="text-[var(--text-2)] tabular-nums">{fmt(cumQty)} <span className="text-micro text-[var(--text-3)]">({pct.toFixed(0)}%)</span></span>
        )}
      </td>
      <td className="text-right text-[var(--text)] px-2 tabular-nums whitespace-nowrap">{fmt(cum)}</td>
      <td className={`text-right px-2 tabular-nums whitespace-nowrap ${per > 0 ? 'text-[var(--blue-text)] font-medium' : 'text-[var(--text-3)]'}`}>{fmt(per)}</td>
      {/* 佐證／來源欄非數字欄:固定欄寬(colgroup)下拿掉 nowrap 讓摘要與警示可換行 */}
      <td className="text-left px-2 pr-5 text-xs">
        {!hasKids && (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {/* 依據標示:缺件(申報未確認／歷史遷移／待設定依據…)優先;其次 DB 的 backing */}
            {unbacked ? (
              <Badge color="amber" className="!whitespace-normal !h-auto py-0.5">{flags[0].label}{flags.length > 1 ? ` +${flags.length - 1}` : ''}{state?.delta ? '・申報,不計價' : ''}</Badge>
            ) : state?.backing === 'confirmed' && state?.delta ? (
              <Badge color="green">監造確認</Badge>
            ) : state?.backing === 'adjusted' ? (
              <Badge color="purple">管理員調整</Badge>
            ) : null}
            {state && (
              <button onClick={() => onToggleSrc(it.item_key)} aria-expanded={!!srcIsOpen}
                title="展開來源(批次、位置、確認量、查驗與文件版本、確認人與時間)"
                className="inline-flex items-center gap-0.5 text-[var(--blue-text)] hover:underline">
                <MSym name={srcIsOpen ? 'expand_more' : 'chevron_right'} size={14} />{sourceCount ? `來源 ${sourceCount} 筆` : '無確認來源'}
              </button>
            )}
            {state && state.basis == null && basisEditable && (
              <select aria-label={`${it.item_no} 計價依據`} value="" onChange={(e) => { if (e.target.value) onSetBasis(it, e.target.value) }}
                className="text-xs border border-[var(--border)] rounded-md px-1 py-0.5 bg-[var(--surface)] text-[var(--text)]">
                {BASIS_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            )}
            {ev && (ev.counts.logs + ev.counts.inspections + ev.counts.checklists + ev.counts.samples === 0 ? (
              <span className="text-[var(--text-3)]">無現場紀錄</span>
            ) : (
              <button
                onClick={() => onToggleEv(it.item_key)}
                aria-expanded={evIsOpen}
                title="展開現場紀錄(日誌申報/查驗/檢查表/試體);日誌申報量只作差異比對,不是計價依據"
                className="inline-flex items-center gap-0.5 text-[var(--blue-text)] hover:underline"
              >
                <MSym name={evIsOpen ? 'expand_more' : 'chevron_right'} size={14} />{evSummary(ev.counts)}
              </button>
            ))}
            {ev && logDiff === 'over' && (
              // 顏色只是輔助,補圖示與字樣(W8-0 §8-6);申報量不是計價依據,這裡只指出差異
              <span className="inline-flex items-center gap-0.5 text-caption text-[var(--amber-text)]" title="累計估驗數量高於施工日誌申報累計逾 5%;日誌是申報,未確認,不計價,請查核後再核定">
                <MSym name="warning" size={11} />超前日誌申報 估驗 {fmt(cumQty)} &gt; 申報 {fmt(ev.loggedTotal)}
              </span>
            )}
            {ev && logDiff === 'no_log' && (
              <span className="inline-flex items-center gap-0.5 text-caption text-[var(--text-3)]" title="有計價但施工日誌沒有申報量;日誌是申報,未確認,不計價">
                <MSym name="info" size={11} />無日誌申報
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
      {!hasKids && srcIsOpen && state && (
        <SourceRow it={it} level={level} state={state} confirmationsById={confirmationsById} inspectionsById={inspectionsById} nameOf={nameOf}
          activeConfirmations={activeConfirmations} periodStatus={periodStatus} canManage={canManage}
          onRevoke={onRevoke} onReduce={onReduce} onIssue={onIssue} onCover={onCover} />
      )}
      {!hasKids && evIsOpen && <EvidenceRow it={it} ev={ev} level={level} />}
    </>
  )
}

export default memo(ValuationRow)
