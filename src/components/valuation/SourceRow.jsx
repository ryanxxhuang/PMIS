// 估驗明細的「來源」展開列(P4c):這一期這個工項的數量是哪幾筆監造確認撐起來的。
// 全部欄位來自 DB(get_valuation_state.items[].sources ＋ inspection_confirmations 列),前端只排版:
//   批次／位置、階段、本期分配量、該確認的累計量、依據(查驗／監造確認單)、查驗與文件版本、確認人與時間。
// legacy 來源明確標「歷史遷移,非監造確認,需補證」——不把舊資料偽裝成確認。
// P4d:下方再列「本工項有效確認」(全部 active 確認,不限本期分配),監造在這裡撤銷／減量(監造確認單)、
// 簽發新確認單,已核定期有 legacy 來源時「補證此期」;其他角色只看到狀態與下一步由誰處理。
// 沿用 EvidenceRow 的語彙(該列下方插一列),不開 modal;memo 理由同 EvidenceRow。
import { memo } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from '../icons.jsx'
import { Badge, Button } from '../ui.jsx'
import { fmtAmount as fmt, fmtDateTime } from '../../lib/format.js'
import { evStatusColor } from '../../lib/evidence.js'

const KIND_LABEL = {
  confirmation: { text: '監造確認', color: 'green' },
  legacy: { text: '歷史遷移,非監造確認,需補證', color: 'amber' },
  clawback: { text: '扣回(確認撤銷／減量後的調整)', color: 'red' },
  adjustment: { text: '平台管理員調整', color: 'purple' },
}
const BASIS_LABEL = { inspection: '查驗', supervisor_certificate: '監造確認單', pro_rata_rule: '比例規則' }
const num = (n) => fmt(n, { empty: '0' })

function SourceRow({ it, level, state, confirmationsById, inspectionsById, nameOf,
  activeConfirmations = [], periodStatus, canManage = false, onRevoke, onReduce, onIssue, onCover }) {
  const sources = state?.sources || []
  const legacyQty = sources.filter((s) => s.kind === 'legacy').reduce((sum, s) => sum + Number(s.qty || 0), 0)
  const periodApproved = periodStatus === '已核定' || periodStatus === '已請款'
  return (
    <tr className="border-b border-[var(--border-2)] bg-[var(--surface-2)]">
      <td colSpan={8} className="py-2.5 pl-5 pr-5">
        <div className="flex">
          <span style={{ width: level * 18 + 20 }} className="shrink-0" aria-hidden="true" />
          <div className="space-y-2 text-xs min-w-0 flex-1" role="group" aria-label={`${it.item_no} 來源`}>
            {/* 數量帳:全部是 DB 的值(cq_item_state),前端不加減 */}
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[var(--text-2)]">
              <div><dt className="inline text-[var(--text-3)]">前期累計 </dt><dd className="inline tabular-nums">{num(state?.prev_cum)} {it.unit}</dd></div>
              <div><dt className="inline text-[var(--text-3)]">本期增量 </dt><dd className="inline tabular-nums">{num(state?.delta)} {it.unit}</dd></div>
              <div><dt className="inline text-[var(--text-3)]">截止日前有效確認 </dt><dd className="inline tabular-nums">{num(state?.effective_cutoff)} {it.unit}</dd></div>
              <div><dt className="inline text-[var(--text-3)]">已計價／其他期占用 </dt><dd className="inline tabular-nums">{num(state?.billed)} / {num(state?.reserved)}</dd></div>
              <div><dt className="inline text-[var(--text-3)]">本期可再增 </dt><dd className="inline tabular-nums">{num(state?.headroom)} {it.unit}</dd></div>
              <div><dt className="inline text-[var(--text-3)]">計價依據 </dt><dd className="inline">{state?.basis ? (BASIS_LABEL[state.basis] || state.basis) : '待設定(不計價)'}</dd></div>
              {Array.isArray(state?.required_stages) && state.required_stages.length > 0 && (
                <div className="col-span-2"><dt className="inline text-[var(--text-3)]">必要查驗階段 </dt><dd className="inline">{state.required_stages.join('、')}</dd></div>
              )}
            </dl>
            {sources.length === 0 ? (
              <div className="text-[var(--text-3)]">本期沒有任何來源分配:這個工項在本期沒有計入監造確認量{state?.delta ? '(現有申報量未經確認,不計價)' : ''}。</div>
            ) : (
              <ul className="space-y-1.5" aria-label={`${it.item_no} 來源清單`}>
                {sources.map((s) => {
                  const kind = KIND_LABEL[s.kind] || { text: s.kind, color: 'slate' }
                  const c = s.confirmation_id ? confirmationsById?.get(s.confirmation_id) : null
                  const insp = c?.inspection_id ? inspectionsById?.get(c.inspection_id) : null
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--text-2)]">
                      <Badge color={kind.color}>{kind.text}</Badge>
                      <span className="tabular-nums font-medium text-[var(--text)]">{num(s.qty)} {it.unit}</span>
                      <span className="text-[var(--text-3)]">批次 {c?.location_label || s.batch_key}{c?.stage_key ? `・階段 ${c.stage_key}` : ''}</span>
                      {c && (
                        <>
                          <span className="text-[var(--text-3)]">確認累計 <span className="tabular-nums">{num(c.qty_cum)} {c.unit}</span></span>
                          <span className="text-[var(--text-3)]">依據 {BASIS_LABEL[c.basis] || c.basis}</span>
                          {insp && (
                            <Link to={`/quality?inspection=${encodeURIComponent(c.inspection_id)}`} className="inline-flex items-center gap-0.5 text-[var(--blue-text)] hover:underline">
                              {insp.title || '查驗'}<Badge color={evStatusColor(insp.status)} className="ml-1">{insp.status}</Badge><MSym name="arrow_forward" size={12} />
                            </Link>
                          )}
                          {c.document_id && (
                            <Link to={`/site?doc=${encodeURIComponent(c.document_id)}`} className="inline-flex items-center gap-0.5 text-[var(--blue-text)] hover:underline">
                              文件版本 v{c.document_version_no}<MSym name="arrow_forward" size={12} />
                            </Link>
                          )}
                          <span className="text-[var(--text-3)]">{nameOf ? nameOf(c.confirmed_by) : c.confirmed_by}・{fmtDateTime(c.confirmed_at)}</span>
                          {c.status === 'revoked' && <Badge color="red">已撤銷{c.reason ? `:${c.reason}` : ''}</Badge>}
                        </>
                      )}
                      {s.kind === 'legacy' && <span className="text-[var(--amber-text)]">遷移自舊估驗明細,沒有監造確認人、查驗或文件版本;{canManage && periodApproved ? '按「補證此期」由你簽發監造確認單補證。' : '待監造簽發監造確認單補證後才可登錄請款日。'}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
            {/* 有效確認(P4d):全案此工項的 active 確認,是撤銷／減量的對象;不是本期分配 */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--border-2)]">
              <span className="text-[var(--text-3)]">有效確認 {activeConfirmations.length} 筆</span>
              {canManage && (
                <Button variant="ghost" size="sm" onClick={() => onIssue?.(it)} aria-label={`簽發監造確認單 ${it.item_no}`}><MSym name="draft" size={13} />簽發監造確認單</Button>
              )}
              {canManage && periodApproved && legacyQty > 0 && (
                <Button variant="secondary" size="sm" onClick={() => onCover?.(it, legacyQty)} aria-label={`補證此期 ${it.item_no}`}><MSym name="verified" size={13} />補證此期({num(legacyQty)} {it.unit})</Button>
              )}
            </div>
            {activeConfirmations.length > 0 && (
              <ul className="space-y-1.5" aria-label={`${it.item_no} 有效確認`}>
                {activeConfirmations.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--text-2)]">
                    <Badge color="green">{BASIS_LABEL[c.basis] || c.basis}</Badge>
                    <span className="text-[var(--text-3)]">批次 {c.location_label || c.batch_key}{c.stage_key ? `・階段 ${c.stage_key}` : ''}</span>
                    <span className="text-[var(--text-3)]">累計 <span className="tabular-nums text-[var(--text)]">{num(c.qty_cum)} {c.unit}</span></span>
                    <span className="text-[var(--text-3)]">{nameOf ? nameOf(c.confirmed_by) : c.confirmed_by}・{fmtDateTime(c.confirmed_at)}</span>
                    {canManage && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => onRevoke?.(it, c)} aria-label={`撤銷確認 ${c.location_label || c.batch_key}`}>撤銷</Button>
                        {c.basis === 'supervisor_certificate' ? (
                          <Button variant="ghost" size="sm" onClick={() => onReduce?.(it, c)} aria-label={`減量確認 ${c.location_label || c.batch_key}`}>減量</Button>
                        ) : (
                          <span className="text-[var(--text-3)]" title="查驗確認量的減量要重簽查驗表單(同交易寫入較小累計);這裡只能撤銷">減量請重簽查驗表單</span>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

export default memo(SourceRow)
