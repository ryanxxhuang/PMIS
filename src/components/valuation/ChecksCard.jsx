// 缺件與檢核(P4c):lib/valuationChecks.js 的單一口徑就地顯示——
//   缺件(block)=DB 檢查點會擋送審／核定／請款的項目,送審前就看得到,每項給處理入口;
//   風險／注意=跨文件勾稽發現(只提醒不處置,判定不經 AI)。
// demo／state 尚未載入時只有勾稽發現,並明講「未經後端核對」,不假裝通過。
import { Card, Badge, Button } from '../ui.jsx'
import { MSym } from '../icons.jsx'

const STATUS = {
  block: { color: 'red', text: '缺件' },
  risk: { color: 'red', text: '風險' },
  warn: { color: 'amber', text: '注意' },
}

// 同步確認量的按鈕全頁只有動作列那一顆(e2e-real 對按鈕名嚴格單一命中;同一動作兩顆鈕也是重複):
// 這裡的 sync 缺件只指路,不再放第二顆。
export default function ChecksCard({ checks, demo, stateLoading, hasState, editable, canApprove, onExpandKeys, onEditPeriodEnd, navigate }) {
  const { findings, summary } = checks
  const actionButton = (f) => {
    if (f.status === 'block') {
      if (f.action === 'sync') return <span className="text-footnote text-[var(--text-3)]">{editable ? '按動作列的「同步確認量」以確認量為準' : '待廠商同步確認量'}</span>
      if (f.action === 'period_end' && editable && onEditPeriodEnd) return <Button variant="ghost" size="sm" onClick={onEditPeriodEnd}>填計價截止日</Button>
      if (f.action === 'basis') return <span className="text-footnote text-[var(--text-3)]">{canApprove ? '在明細列的「計價依據」下拉設定' : '由監造設定計價依據'}</span>
      if (f.action === 'certificate') return <span className="text-footnote text-[var(--text-3)]">{canApprove ? '展開該列來源,按「補證此期」簽發監造確認單' : '待監造簽發監造確認單補證;補證後才可登錄請款日'}</span>
      if (f.action === 'review') return <span className="text-footnote text-[var(--text-3)]">{canApprove ? '退回後由廠商同步重算' : '待監造退回'}</span>
      if (f.action === 'adjust') return <span className="text-footnote text-[var(--text-3)]">{canApprove ? '展開該列來源,撤銷或減量該筆確認(已核定量會轉成扣回)' : '待監造撤銷／減量確認;已核定量轉成扣回由機關處理'}</span>
      return null
    }
    if (f.route && f.route !== '/valuation') return <Button variant="ghost" size="sm" onClick={() => navigate(f.route)}>前往品質查驗<MSym name="arrow_forward" size={13} /></Button>
    return null
  }
  return (
    <Card title="缺件與檢核" bodyClass="p-0"
      action={<span className="text-footnote text-[var(--text-2)] num">{summary.block} 項缺件 · {summary.risk} 項風險 · {summary.warn} 項注意 · 已勾稽 {summary.checked} 項計價工項</span>}>
      {demo && (
        <p className="mx-5 mt-3 text-footnote text-[var(--amber-text)]">示範資料:估驗數量未經後端監造確認量核對(正式專案由資料庫在送審／核定／請款時強制)。</p>
      )}
      {!demo && !hasState && (
        <p className="mx-5 mt-3 text-footnote text-[var(--text-3)]" aria-busy={stateLoading || undefined}>{stateLoading ? '正在向資料庫核對本期缺件…' : '本期缺件尚未取得(重新整理後再試);下列只有勾稽發現。'}</p>
      )}
      {findings.length === 0 ? (
        <p className="px-5 py-4 text-footnote text-[var(--text-2)]">
          <MSym name="check_circle" size={14} className="inline align-text-bottom mr-1 text-[var(--green-text)]" />
          {hasState ? '本期沒有缺件:數量都有監造確認來源,估驗、施工日誌、查驗與試體對得起來。' : '本期估驗、施工日誌、查驗與試體對得起來,沒有勾稽異常。'}
        </p>
      ) : (
        <ul role="list" aria-label="缺件與檢核" className="divide-y divide-[var(--border-2)]">
          {findings.map((f) => (
            <li key={`${f.status}:${f.code || f.title}`} className="px-5 py-3 flex flex-wrap items-start gap-x-3 gap-y-1.5">
              <Badge color={STATUS[f.status]?.color || 'slate'}>{STATUS[f.status]?.text || f.status}</Badge>
              <span className="min-w-0 flex-1 basis-64">
                <span className="block text-body text-[var(--text)] [text-wrap:pretty]">{f.title}</span>
                <span className="block mt-0.5 text-footnote text-[var(--text-2)] break-words">{f.detail}</span>
              </span>
              <span className="flex items-center gap-1 flex-wrap">
                {f.keys?.length > 0 && onExpandKeys && (
                  <Button variant="ghost" size="sm" onClick={() => onExpandKeys(f.keys)} title="在明細表展開這些工項的來源與現場紀錄">展開 {f.keys.length} 列</Button>
                )}
                {actionButton(f)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
