// 自主檢查表分段(品質查驗頁;P6b-3 起只剩查閱):列出本案全部檢查紀錄(修訂鏈、判定、覆蓋程度、檢附查驗)。
// 新增與更正一律走自主檢查表「文件」(P3b /self-check):草稿 → 人逐項確認、量測填值 → 簽署即寫 checklist_records
// (判定由 DB 依範本量化標準算、不合格由 DB 同交易開缺失);已簽署的表要更正=在同一份文件建立新版本再簽(Rev.N)。
// 這裡原本的「直接登錄／修訂／刪除未判定」表單已退場——資料庫也收回了直接寫入(migration 20260920030000),
// 舊流程直接登錄的紀錄照常可查、可列印、可檢附查驗,但不再能就地修訂。
// 只借殼的零件整理:判定快篩 chip(StatusChip)＋ <ul role="list">/<li> 清單語意。
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MSym } from '../icons.jsx'
import { Card, Button, Badge, Dot, Empty } from '../ui.jsx'
import { StatusChip } from '../listDetail.jsx'
import { diffChecklistResults, checklistCoverage, coverageText } from '../../lib/qc.js'
import { navLabel } from '../../lib/navConfig.js'

// 修訂差異的值顯示:✓/✗(bool)、數值、—(未檢)
const fmtVal = (v) => (v === true ? '✓' : v === false ? '✗' : v ?? '—')

export default function ChecklistSection({ templates, records, canEdit, leaves = [], inspections = [], onRequestInspection = null, signedDocByRecord = new Map() }) {
  const navigate = useNavigate()
  const [historyOf, setHistoryOf] = useState(null) // 展開歷次版本的鏈根 id
  const [judgeFilter, setJudgeFilter] = useState('') // 判定快篩:''=全部(單選、再點取消)
  const docPage = navLabel('/self-check')

  // 紀錄 → 末端工項:demo 存 work_item_key、真 DB 存 work_item_id(uuid),一張表查兩種鍵
  const leafByRef = useMemo(() => {
    const m = new Map()
    for (const l of leaves) { m.set(l.item_key, l); if (l.id) m.set(l.id, l) }
    return m
  }, [leaves])
  const wiOf = (r) => leafByRef.get(r.work_item_key) || leafByRef.get(r.work_item_id)

  // 修訂鏈:依 root_id 分組,rev 最大者為現行版,其餘為歷次版本
  const chains = useMemo(() => {
    const byRoot = new Map()
    for (const r of records) {
      const root = r.root_id || r.id
      if (!byRoot.has(root)) byRoot.set(root, [])
      byRoot.get(root).push(r)
    }
    return [...byRoot.values()]
      .map((revs) => {
        revs.sort((a, b) => (b.rev || 0) - (a.rev || 0))
        return { current: revs[0], history: revs.slice(1) }
      })
      .sort((a, b) => (b.current.check_date || '').localeCompare(a.current.check_date || ''))
  }, [records])

  // 反向標記:這條修訂鏈的任一版被哪張查驗檢附(查驗刻意留在舊版=證據不可變,
  // 所以要整鏈查,不能只看現行版 id)。有檢附就不再給「提出查驗申請」,避免重複送。
  const attachedInspByRecordId = useMemo(() => {
    const m = new Map()
    for (const i of inspections) if (i.checklist_record_id) m.set(i.checklist_record_id, i)
    return m
  }, [inspections])
  const attachedInspOfChain = (current, history) =>
    [current, ...history].map((rev) => attachedInspByRecordId.get(rev.id)).find(Boolean) || null

  // 判定快篩:件數走全體修訂鏈(現行版的判定),0 件也留著——「還沒有不合格」本身是資訊
  const JUDGE_FILTERS = [['合格', 'green'], ['不合格', 'red'], ['未判定', 'slate']]
  const judgeOf = (r) => r.overall || '未判定'
  const judgeCounts = Object.fromEntries(JUDGE_FILTERS.map(([j]) => [j, chains.filter((c) => judgeOf(c.current) === j).length]))
  const shownChains = judgeFilter ? chains.filter((c) => judgeOf(c.current) === judgeFilter) : chains

  return (
    <Card title={`自主檢查表（${chains.length}）`} action={
      canEdit && <Button variant="secondary" onClick={() => navigate('/self-check')}><MSym name="add" size={16} />新增自主檢查表</Button>
    }>
      {chains.length > 0 && (
        <div role="group" aria-label="檢查表判定篩選" className="flex items-center gap-2 flex-wrap mb-3">
          {JUDGE_FILTERS.map(([j, color]) => (
            <StatusChip key={j} active={judgeFilter === j} count={judgeCounts[j]}
              onClick={() => setJudgeFilter(judgeFilter === j ? '' : j)}>
              <Dot color={color} />{j}
            </StatusChip>
          ))}
        </div>
      )}
      {chains.length === 0 ? <Empty>尚無自主檢查紀錄。到「{docPage}」起稿、逐項填寫並簽署，簽署後即成為品質證據並依量化標準自動判定。</Empty> : shownChains.length === 0 ? (
        <Empty>沒有「{judgeFilter}」的檢查紀錄。</Empty>
      ) : (
        // role="list" 要明寫:Tailwind preflight 的 list-style: none 會讓 Safari 拿掉 <ul> 清單語意
        <ul role="list" className="space-y-1.5">
          {shownChains.map(({ current: r, history }) => {
            const tpl = templates.find((t) => t.id === r.template_id)
            const rootId = r.root_id || r.id
            const prev = history.find((h) => h.id === r.supersedes_id)
            const diffs = (r.rev || 0) > 0 && tpl && prev ? diffChecklistResults(tpl, prev.results, r.results) : []
            const attachedInsp = attachedInspOfChain(r, history)
            const signedDoc = signedDocByRecord.get(r.id)
            return (
              <li key={rootId} className="border-b border-[var(--border-2)] pb-1.5">
                {/* <md 改上下排:右側判定＋動作是 shrink-0,並排時會把左側標題擠成一字寬的直欄 */}
                <div className="flex items-center justify-between gap-3 text-sm max-md:flex-col max-md:items-start max-md:gap-1">
                  <div className="min-w-0">
                    <span className="num text-[var(--text-3)] text-xs mr-2">{r.check_date}</span>
                    <span className="text-[var(--text)]">{tpl?.title || '（範本已刪除）'}</span>
                    {(r.rev || 0) > 0 && <Badge color="blue">Rev.{r.rev}</Badge>}
                    {/* 簽署文件落下的紀錄——版本、雜湊與簽署者在文件頁(更正也在那裡建立新版本);舊流程直接登錄的紀錄沒有簽署列 */}
                    {signedDoc
                      ? <button onClick={() => navigate(`/self-check?doc=${encodeURIComponent(signedDoc.id)}`)} className="ml-2 inline-flex items-center max-md:min-h-11" title="開啟已簽署的自主檢查表文件(更正請在文件建立新版本再簽)"><Badge color="green">已簽署文件 v{signedDoc.current_version_no}</Badge></button>
                      : <span className="ml-2"><Badge color="slate">舊流程登錄</Badge></span>}
                    {r.location && <span className="text-xs text-[var(--text-3)] ml-2">{r.location}</span>}
                    {wiOf(r) && <span className="text-xs text-[var(--text-3)] ml-2" title={wiOf(r).description}>工項 {wiOf(r).item_no}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <Badge color={r.overall === '合格' ? 'green' : r.overall === '不合格' ? 'red' : 'slate'}>{r.overall || '未判定'}</Badge>
                    {(() => { const cov = checklistCoverage(tpl, r.results); return <span className={`text-caption whitespace-nowrap ${cov.unchecked ? 'text-[var(--amber-text)]' : 'text-[var(--text-3)]'}`}>{coverageText(cov)}</span> })()}
                    {attachedInsp && (
                      <span title={`已檢附於查驗:${attachedInsp.title}`}><Badge color="slate">已附查驗</Badge></span>
                    )}
                    {/* 一級交二級:自檢合格才有資格提查驗;已檢附過就不再給(避免重複送)。
                        列動作=第三級文字鈕:一律 --blue-text(--blue 只作底色/邊框)+手機 44px */}
                    {onRequestInspection && r.overall === '合格' && !attachedInsp && (
                      <button onClick={() => onRequestInspection(r, tpl?.title || '', wiOf(r))}
                        title="以此檢查紀錄為附件,預填查驗申請(送出前可改)"
                        className="text-[var(--blue-text)] hover:underline text-xs whitespace-nowrap inline-flex items-center max-md:min-h-11">提出查驗申請</button>
                    )}
                    <button onClick={() => navigate(signedDoc ? `/self-check/print?doc=${encodeURIComponent(signedDoc.id)}` : `/quality/checklist-print?id=${r.id}`)} title="列印自主檢查表"
                      className="text-[var(--blue-text)] hover:underline text-xs inline-flex items-center gap-1 max-md:min-h-11"><MSym name="print" size={13} />列印</button>
                    {history.length > 0 && (
                      <button onClick={() => setHistoryOf(historyOf === rootId ? null : rootId)}
                        className="text-[var(--blue-text)] hover:underline text-xs inline-flex items-center max-md:min-h-11">歷次 {history.length}</button>
                    )}
                  </div>
                </div>
                {(r.rev || 0) > 0 && r.revision_reason && (
                  <div className="text-caption text-[var(--text-3)] mt-0.5">
                    更正原因：{r.revision_reason}
                    {diffs.length > 0 && <span className="ml-2">異動：{diffs.map((d) => `${d.no} ${fmtVal(d.from)}→${fmtVal(d.to)}`).join('、')}</span>}
                  </div>
                )}
                {historyOf === rootId && history.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 text-xs text-[var(--text-3)] mt-1 pl-4">
                    <span>Rev.{h.rev || 0}</span>
                    <span className="num">{h.check_date}</span>
                    <Badge color="slate">{h.overall || '未判定'}</Badge>
                    <span>已由新版取代</span>
                    {/* 更正原因是稽核性說明,這一列沒有下鑽入口 → 至少要能 hover 看全文 */}
                    {(h.rev || 0) > 0 && h.revision_reason && <span className="truncate" title={h.revision_reason}>（{h.revision_reason}）</span>}
                    <button onClick={() => navigate(`/quality/checklist-print?id=${h.id}`)}
                      className="text-[var(--blue-text)] hover:underline shrink-0">列印</button>
                  </div>
                ))}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-caption text-[var(--text-3)] mt-2">檢查紀錄是品質證據：新增與更正一律在「{docPage}」起稿、逐項確認後簽署，判定由系統依範本量化標準計算，不合格自動開立缺失（同一張表已有未結案缺失時不重複開）；已簽署的表要更正，請在該文件建立新版本再簽署（留存 Rev.N 與更正原因）。舊流程直接登錄的紀錄僅供查閱、列印與檢附查驗，不能就地修訂。</p>
    </Card>
  )
}
