import { useState, useMemo, useRef } from 'react'
import { useStore } from '../../store.jsx'
import { MSym } from '../../components/icons.jsx'
import { Card, Stat, Empty, Badge, Dot, Button, Field, IconButton, Input, Select, PageHeader, ErrorBanner, MobileReadOnlyNote, THEAD_CLS } from '../../components/ui.jsx'
import { SearchField, StatusChip } from '../../components/listDetail.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { revisedContractTotal, approvedNetAmount } from '../../lib/changeOrders.js'
import { fmtAmount as money, fmtYi as yi } from '../../lib/format.js'

// 這一頁刻意「不套」清單／詳情殼(規範 §8 不套殼那句):成本明細是逐列就地編輯的帳冊
// (預算/實際每格本來就可改、狀態一點就翻),與 /payments 同形狀——每列有兩個可編輯數字,
// 硬套成「清單只選取、詳情欄編輯」會把原本一步的改數字變成兩步(判準第 3 條)。
// 只借殼零件整理:SearchField + 分類快篩 chip(單選、再點取消、附件數)放在明細表卡頭下,
// CSV 匯出「目前篩選結果」,表內數字欄改吃共用 Input。
const CATS = ['材料', '人工', '機具', '分包', '管理費', '其他']
// 分類上色走 Badge 的 color key(五語意+purple),不再 inline style 綁原始色票
const CAT_BADGE = {
  材料: 'blue', 人工: 'green', 機具: 'amber',
  分包: 'purple', 管理費: 'slate', 其他: 'slate',
}
const pct = (n) => (isFinite(n) ? n.toFixed(1) : '—')
// 不在六類內的歷史分類一律歸「其他」:分類成本表與快篩 chip 用同一把尺,件數才對得上
const catOf = (c) => (CATS.includes(c.category) ? c.category : '其他')
const DEFAULT_FILTERS = { q: '', category: '' }
const CSV_COLUMNS = [
  { key: 'category', label: '分類' }, { key: 'title', label: '項目' }, { key: 'vendor', label: '供應商/分包商' },
  { key: 'budget_amount', label: '預算' }, { key: 'actual_amount', label: '實際' }, { key: 'status', label: '狀態' },
]
// 檔名反映匯出範圍:成本明細_{分類|全部}[_搜尋-關鍵字]_{日期}(與 /safety 同一套規則)
const csvName = ({ q, category }) => {
  const kw = q.trim().replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 20)
  return ['成本明細', category || '全部', kw ? `搜尋-${kw}` : null, stamp()].filter(Boolean).join('_')
}

export default function Cost() {
  const { workItems, dbMode, demoMode, costItems, createCostItem, updateCostItem, deleteCostItem, changeOrders } = useStore()
  // 合約收入 = 變更後契約金額(原發包 + 已核准追加減)
  const revenue = revisedContractTotal(workItems?.meta.billable_total || 0, changeOrders)
  const coNet = approvedNetAmount(changeOrders)

  const [form, setForm] = useState({ category: '分包', title: '', vendor: '', budget_amount: '', actual_amount: '' })
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 寫入失敗如實回報(B-07)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const searchRef = useRef(null)

  // 分類件數走全體(不受搜尋影響);0 件的分類也留著——「還沒登任何人工成本」本身就是資訊
  const catCounts = useMemo(
    () => Object.fromEntries(CATS.map((cat) => [cat, costItems.filter((c) => catOf(c) === cat).length])),
    [costItems],
  )
  // 目前畫面上的明細:分類 AND 關鍵字(項目/供應商/備註),順序沿用 store(sort_order)
  const ordered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return costItems
      .filter((c) => !filters.category || catOf(c) === filters.category)
      .filter((c) => !q || [c.title, c.vendor, c.note].some((v) => (v || '').toLowerCase().includes(q)))
  }, [costItems, filters])
  const anyFilter = filters.q.trim() !== '' || filters.category !== ''
  const onUpdate = async (id, patch) => {
    setErrMsg('')
    const { error } = await updateCostItem(id, patch)
    if (error) setErrMsg(friendlyError(error, '成本未寫入'))
  }
  const onDelete = async (id) => {
    setErrMsg('')
    const { error } = await deleteCostItem(id)
    if (error) setErrMsg(friendlyError(error, '成本項刪除未完成'))
  }

  const totals = useMemo(() => {
    let budget = 0, actual = 0
    for (const c of costItems) { budget += Number(c.budget_amount) || 0; actual += Number(c.actual_amount) || 0 }
    return { budget, actual }
  }, [costItems])

  const byCat = useMemo(() => CATS.map((cat) => {
    const list = costItems.filter((c) => catOf(c) === cat)
    const budget = list.reduce((s, c) => s + (Number(c.budget_amount) || 0), 0)
    const actual = list.reduce((s, c) => s + (Number(c.actual_amount) || 0), 0)
    return { cat, n: list.length, budget, actual }
  }).filter((g) => g.n > 0), [costItems])

  const budgetMargin = revenue - totals.budget
  const actualMargin = revenue - totals.actual
  const budgetRate = revenue ? (budgetMargin / revenue) * 100 : NaN
  const actualRate = revenue ? (actualMargin / revenue) * 100 : NaN

  const onAdd = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setErrMsg(''); setBusy(true)
    const { error } = await createCostItem(form)
    setBusy(false)
    if (error) { setErrMsg(friendlyError(error, '成本項新增未完成')); return }
    setForm({ category: form.category, title: '', vendor: '', budget_amount: '', actual_amount: '' })
  }

  // 早退也保留 PageHeader:工作面分頁列(PageTabs)長在 PageHeader 裡,早退不帶頁首
  // 等於整條分頁列消失;平板(768–1279)與收合側欄的 icon rail 又不列子頁,
  // 使用者會被關在空狀態畫面裡,換不到同工作面的其他頁。
  if (!dbMode && !demoMode) {
    return (
      <div className="space-y-5">
        <PageHeader title="成本管理" tagline="預算 vs 實際・毛利" subtitle="合約收入（發包工程費）對照成本與分包，即時算出預估與實際毛利" />
        <Card title="成本管理"><Empty>此功能需真實專案（已匯入標單）。請先到「專案文件」一次上傳標單 XML，才能對照合約收入計算毛利。</Empty></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title="成本管理" tagline="預算 vs 實際・毛利" subtitle="合約收入（發包工程費）對照成本與分包，即時算出預估與實際毛利" />

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat label={coNet !== 0 ? '合約收入（變更後契約金額）' : '合約收入（發包工程費）'} value={yi(revenue)} sub={coNet !== 0 ? `NT$ ${money(revenue)} · 含核准追加減 ${coNet > 0 ? '+' : ''}${money(coNet)}` : `NT$ ${money(revenue)}`} color="text-[var(--blue-text)]" />
        <Stat label="預估毛利（收入−預算成本）" value={`${pct(budgetRate)}%`} sub={`NT$ ${money(budgetMargin)}`} color={budgetMargin >= 0 ? 'text-[var(--green-text)]' : 'text-[var(--red-text)]'} />
        <Stat label="實際毛利（收入−實際成本）" value={`${pct(actualRate)}%`} sub={`NT$ ${money(actualMargin)}`} color={actualMargin >= 0 ? 'text-[var(--green-text)]' : 'text-[var(--red-text)]'} />
        <Stat label="預算成本合計" value={money(totals.budget)} sub="NT$" color="text-[var(--text)]" />
        <Stat label="實際成本合計" value={money(totals.actual)} sub="NT$" color="text-[var(--text)]" />
        <Stat label="成本超支 / 結餘" value={money(totals.budget - totals.actual)} sub={totals.actual > totals.budget ? '已超出預算' : '尚在預算內'} color={totals.actual > totals.budget ? 'text-[var(--red-text)]' : 'text-[var(--text-2)]'} />
      </div>

      {byCat.length > 0 && (
        <Card title="分類成本" bodyClass="p-0">
          {/* 斷點跟手機層對齊(BottomNav 是 md:hidden);520px 五欄表在 390 要橫捲 1.3 個
              螢幕寬,手機改列同一份資料的卡片摘要(規範 §9.6) */}
          <div className="overflow-x-auto max-md:hidden">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                {/* 表頭字型層走共用 THEAD_CLS(對齊/內距各表自決) */}
                <tr className="border-b border-[var(--border)]">
                  <th className={`${THEAD_CLS} text-left py-2 pl-5`}>分類</th>
                  <th className={`${THEAD_CLS} text-right px-2`}>項數</th>
                  <th className={`${THEAD_CLS} text-right px-2`}>預算</th>
                  <th className={`${THEAD_CLS} text-right px-2`}>實際</th>
                  <th className={`${THEAD_CLS} text-right px-2 pr-5`}>差異</th>
                </tr>
              </thead>
              <tbody>
                {byCat.map((g) => (
                  <tr key={g.cat} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
                    <td className="py-2 pl-5"><Badge color={CAT_BADGE[g.cat] || 'slate'}>{g.cat}</Badge></td>
                    <td className="px-2 text-right tabular-nums text-[var(--text-3)]">{g.n}</td>
                    <td className="px-2 text-right tabular-nums">{money(g.budget)}</td>
                    <td className="px-2 text-right tabular-nums">{money(g.actual)}</td>
                    <td className={`px-2 pr-5 text-right tabular-nums ${g.actual > g.budget ? 'text-[var(--red-text)]' : 'text-[var(--text-2)]'}`}>{money(g.budget - g.actual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 手機:同一份 byCat(已算好的分類加總),一列一個分類。實際擺主位、預算擺佐證,
              因為毛利看的是實際;差異一欄在手機省掉——它等於兩個已顯示數字的減法。 */}
          <ul role="list" className="md:hidden divide-y divide-[var(--border-2)]">
            {byCat.map((g) => (
              <li key={g.cat} className="px-5 py-3 flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 min-w-0">
                  <Badge color={CAT_BADGE[g.cat] || 'slate'}>{g.cat}</Badge>
                  <span className="text-footnote text-[var(--text-3)] tabular-nums">{g.n} 項</span>
                </span>
                <span className="text-right shrink-0">
                  <span className={`block text-body tabular-nums ${g.actual > g.budget ? 'text-[var(--red-text)]' : ''}`}>{money(g.actual)}</span>
                  <span className="block text-footnote text-[var(--text-3)] tabular-nums">預算 {money(g.budget)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 新增成本項是寫入:手機整張卡不渲染(規範 §9.6 的決策——成本是辦公室作業,
          手機只給唯讀摘要)。桌機零變化。 */}
      <Card title="新增成本 / 分包項目" className="max-md:hidden">
        {/* 表單控件一律 Field+Select/Input(FIELD_BASE):自寫 input class 退場;
            定寬(金額)/伸縮(名稱)交給外層 div——Field 不收 className */}
        <form onSubmit={onAdd} className="flex flex-wrap items-end gap-3">
          <Field label="分類">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <div className="flex-1 min-w-[160px]">
            <Field label="項目名稱">
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：鋼筋分包、預拌混凝土" />
            </Field>
          </div>
          <div className="flex-1 min-w-[140px]">
            <Field label="供應商 / 分包商">
              <Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="選填" />
            </Field>
          </div>
          <div className="w-32">
            <Field label="預算金額">
              <Input type="number" min="0" step="any" value={form.budget_amount} onChange={(e) => setForm({ ...form, budget_amount: e.target.value })}
                className="text-right tabular-nums" />
            </Field>
          </div>
          <div className="w-32">
            <Field label="實際金額">
              <Input type="number" min="0" step="any" value={form.actual_amount} onChange={(e) => setForm({ ...form, actual_amount: e.target.value })}
                className="text-right tabular-nums" />
            </Field>
          </div>
          <Button type="submit" disabled={busy || !form.title.trim()}>{busy ? '新增中…' : <><MSym name="add" size={15} />新增</>}</Button>
        </form>
      </Card>

      {/* CSV 匯出的是目前篩選結果——匯出你看到的;鈕上帶件數,按下去前就知道會拿到幾筆 */}
      <Card title={`成本明細（${costItems.length}）`} bodyClass="p-0" action={costItems.length > 0 && (
        <Button variant="ghost" onClick={() => exportCsv(csvName(filters), ordered, CSV_COLUMNS)}
          disabled={ordered.length === 0} title="匯出目前篩選結果">
          <MSym name="download" size={16} />CSV（{ordered.length}）
        </Button>
      )}>
        {costItems.length === 0 ? (
          <Empty>尚無成本項目。把分包發包、材料、人工等成本登進來，這裡會即時對照合約收入算毛利。</Empty>
        ) : (<>
          {/* 卡頭下方:搜尋 + 六分類快篩(件數走全體),兩條件 AND——殼零件,版面不是殼 */}
          <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
            <SearchField ref={searchRef} value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="搜尋項目、供應商或備註…" aria-label="搜尋成本項目" />
            <div className="flex items-center gap-2 flex-wrap">
              {CATS.map((cat) => (
                <StatusChip key={cat} active={filters.category === cat} count={catCounts[cat]}
                  onClick={() => setFilters((f) => ({ ...f, category: f.category === cat ? '' : cat }))}>
                  <Dot color={CAT_BADGE[cat]} />{cat}
                </StatusChip>
              ))}
              {anyFilter && (
                <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>清除篩選</Button>
              )}
            </div>
          </div>
          {ordered.length === 0 ? (
            <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
              沒有符合條件的成本項目。<br />換一個分類,或試試項目名稱、供應商關鍵字。
            </div>
          ) : (<>
          {/* 斷點跟手機層對齊(BottomNav 是 md:hidden):760px 七欄表在 390 要橫捲兩個螢幕寬,
              而且金額格是就地編輯——表格內輸入在手機明文豁免 44px(§9.2),等於既讀不了也點不準。
              手機改渲染唯讀清單,寫入(改金額、切狀態、刪除)一律留在桌機(§9.6)。
              搜尋與分類快篩兩邊共用:手機清單也走 ordered,篩了什麼就看什麼。 */}
          <div className="overflow-x-auto max-md:hidden">
            <table className="w-full text-sm min-w-[760px]" aria-label="成本明細">
              <thead>
                {/* 表頭字型層走共用 THEAD_CLS(對齊/內距各表自決) */}
                <tr className="border-b border-[var(--border)]">
                  <th className={`${THEAD_CLS} text-left py-2 pl-5`}>分類</th>
                  <th className={`${THEAD_CLS} text-left px-2`}>項目</th>
                  <th className={`${THEAD_CLS} text-left px-2`}>供應商/分包商</th>
                  <th className={`${THEAD_CLS} text-right px-2`}>預算</th>
                  <th className={`${THEAD_CLS} text-right px-2`}>實際</th>
                  <th className={`${THEAD_CLS} text-left px-2`}>狀態</th>
                  <th className="px-2 pr-5"></th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
                    <td className="py-1.5 pl-5"><Badge color={CAT_BADGE[c.category] || 'slate'}>{c.category}</Badge></td>
                    <td className="px-2 min-w-[140px]">{c.title}</td>
                    <td className="px-2 text-[var(--text-2)]">{c.vendor || '—'}</td>
                    {/* 就地編輯的數字欄改吃共用 Input(FIELD_BASE 給 focus/手機 44px);定寬交給外層 div,
                        aria-label 帶項目名,報讀器才分得出是哪一列的預算 */}
                    <td className="px-2 text-right">
                      <div className="w-28 ml-auto">
                        <Input type="number" min="0" step="any" defaultValue={c.budget_amount ?? ''} aria-label={`${c.title} 預算金額`}
                          onBlur={(e) => { const n = parseFloat(e.target.value); onUpdate(c.id, { budget_amount: isNaN(n) ? 0 : n }) }}
                          className="text-right tabular-nums" />
                      </div>
                    </td>
                    <td className="px-2 text-right">
                      <div className="w-28 ml-auto">
                        <Input type="number" min="0" step="any" defaultValue={c.actual_amount ?? ''} aria-label={`${c.title} 實際金額`}
                          onBlur={(e) => { const n = parseFloat(e.target.value); onUpdate(c.id, { actual_amount: isNaN(n) ? 0 : n }) }}
                          className="text-right tabular-nums" />
                      </div>
                    </td>
                    <td className="px-2">
                      {/* 狀態顯示走 Badge 五語意;切換仍是同一顆按鈕(不加新文案),tooltip 講明可點 */}
                      <button onClick={() => onUpdate(c.id, { status: c.status === '已結算' ? '進行中' : '已結算' })}
                        title="點擊切換 已結算/進行中" className="inline-flex items-center pressable max-md:min-h-11">
                        <Badge color={c.status === '已結算' ? 'green' : 'slate'}>{c.status}</Badge>
                      </button>
                    </td>
                    <td className="px-2 pr-5 text-right">
                      <IconButton name="close" label={`刪除 ${c.title}`}
                        onClick={async () => { if (await appConfirm({ title: `刪除「${c.title}」？`, danger: true, confirmLabel: '刪除' })) onDelete(c.id) }}
                        className="-m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 手機:每個成本項一列(名稱、實際金額、佔實際成本合計的比例)。
              佔比的分母是上方已算好的 totals.actual,不是在這裡另外加總一次金額;
              合計為 0 時不硬印 0%,直接留「—」。 */}
          <div className="md:hidden">
            <MobileReadOnlyNote of="各成本項金額與佔比" className="px-5 py-3 border-b border-[var(--border-2)]" />
            <ul role="list" className="divide-y divide-[var(--border-2)]">
              {ordered.map((c) => {
                const actual = Number(c.actual_amount) || 0
                return (
                  <li key={c.id} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-body font-medium min-w-0 truncate">{c.title}</span>
                      <span className="text-body font-medium tabular-nums shrink-0">{money(actual)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <Badge color={CAT_BADGE[c.category] || 'slate'}>{c.category}</Badge>
                      <span className="text-footnote text-[var(--text-3)] tabular-nums">
                        佔實際成本 {totals.actual ? `${pct((actual / totals.actual) * 100)}%` : '—'}・預算 {money(Number(c.budget_amount) || 0)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
          </>)}
        </>)}
      </Card>

      <p className="text-xs text-[var(--text-3)]">
        毛利 = 合約收入（發包工程費）− 成本合計。預估毛利用「預算成本」，實際毛利用「實際成本（已發生/已付）」。分包請在分類選「分包」並填供應商，視為成本一併計入。
      </p>
    </div>
  )
}
