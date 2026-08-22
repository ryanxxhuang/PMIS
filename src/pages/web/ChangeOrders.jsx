import { useState, useMemo } from 'react'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Stat, Surface, Empty, Button, Badge, Field, Input, buttonClass, THEAD_CLS, PageHeader, ErrorBanner } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { parsePccesXml } from '../../lib/parsePcces.js'
import { diffBoq } from '../../lib/coDiff.js'

const money = (n) => (n == null || isNaN(n) ? '0' : Math.round(n).toLocaleString('en-US'))
const yi = (n) => (n / 1e8).toFixed(2) + ' 億'
const STATUS_COLOR = { 提出: 'slate', 審核中: 'amber', 核准: 'green', 駁回: 'red' }
const isPending = (status) => status === '提出' || status === '審核中'
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function ChangeOrders() {
  const { project, workItems, dbMode, demoMode, changeOrders, can,
    createChangeOrder, updateChangeOrder, deleteChangeOrder,
    addChangeOrderItem, addChangeOrderItems, updateChangeOrderItem, deleteChangeOrderItem } = useStore()
  const original = workItems?.meta.billable_total || 0

  const [head, setHead] = useState({ co_no: '', title: '', co_date: todayStr() })
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 明細/狀態寫入失敗必須讓使用者看到(失敗=UI 不變)
  const [submitted, setSubmitted] = useState(false) // 廠商送出後就地回饋(O-4:提出≠已受理,球在監造)

  // 發包末端工項（給明細連結既有工項用）
  const leaves = useMemo(() => {
    if (!workItems) return []
    const childMap = new Map()
    for (const it of workItems.items) { const k = it.parent_key || '__root__'; if (!childMap.has(k)) childMap.set(k, []); childMap.get(k).push(it) }
    return workItems.items.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
  }, [workItems])

  const coNet = (co) => co.items.reduce((s, it) => s + (Number(it.amount_delta) || 0), 0)

  const totals = useMemo(() => {
    let approvedNet = 0, pendingNet = 0, add = 0, reduce = 0, pendingCount = 0
    for (const co of changeOrders) {
      const net = coNet(co)
      if (co.status === '核准') {
        approvedNet += net
        for (const it of co.items) { const a = Number(it.amount_delta) || 0; if (a >= 0) add += a; else reduce += a }
      } else if (co.status === '提出' || co.status === '審核中') { pendingNet += net; pendingCount += 1 }
    }
    return { approvedNet, pendingNet, add, reduce, pendingCount }
  }, [changeOrders])

  // 機關來這頁只為了「還沒定案的要不要核」——待核定排前面,已定案的往下沉;
  // 兩群各自維持原相對順序,避免使用者記憶中的清單順序被打亂。
  const groups = useMemo(() => {
    const pending = [], settled = []
    for (const co of changeOrders) (isPending(co.status) ? pending : settled).push(co)
    return [
      { key: 'pending', label: '待核定', list: pending },
      { key: 'settled', label: '已核定／已結', list: settled },
    ]
  }, [changeOrders])

  const revised = original + totals.approvedNet
  const ratio = original ? (totals.approvedNet / original) * 100 : 0

  const onCreate = async (e) => {
    e.preventDefault()
    if (!head.title.trim()) return
    setBusy(true)
    const { error } = await createChangeOrder(head)
    setBusy(false)
    if (!error) { setHead({ co_no: '', title: '', co_date: todayStr() }); setSubmitted(true) }
  }

  // 早退也保留 PageHeader:頁首與工作面分頁不該因為「還沒匯入標單」整組消失
  if (!dbMode && !demoMode) {
    return (
      <div className="space-y-5">
        <PageHeader title="變更設計" tagline="追加減帳・契約金額調整" subtitle="追加/減帳工項 → 僅「核准」的計入變更後契約金額" />
        <Card title="變更設計" bodyClass="p-0"><Empty>此功能需真實專案（已匯入標單）。請先到「專案文件」一次上傳標單 XML，才能對照原契約金額計算追加減。</Empty></Card>
      </div>
    )
  }

  const exportAll = () => {
    const rows = changeOrders.flatMap((co) => co.items.map((it) => ({
      co_no: co.co_no || '', co_title: co.title, status: co.status,
      item_no: it.item_no || '', description: it.description, unit: it.unit || '',
      qty_delta: it.qty_delta, unit_price: it.unit_price, amount_delta: it.amount_delta,
    })))
    exportCsv(`變更設計_${stamp()}`, rows, [
      { key: 'co_no', label: '變更編號' }, { key: 'co_title', label: '事由' }, { key: 'status', label: '狀態' },
      { key: 'item_no', label: '項次' }, { key: 'description', label: '工項' }, { key: 'unit', label: '單位' },
      { key: 'qty_delta', label: '數量增減' }, { key: 'unit_price', label: '單價' }, { key: 'amount_delta', label: '金額增減' },
    ])
  }

  return (
    <div className="space-y-5">
      <PageHeader title="變更設計" tagline="追加減帳・契約金額調整" subtitle="追加/減帳工項 → 僅「核准」的計入變更後契約金額" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="原契約金額" value={yi(original)} sub={`NT$ ${money(original)}`} color="text-[var(--text)]" />
        <Stat label="累計追加(核准)" value={money(totals.add)} sub="NT$" color="text-[var(--green-text)]" />
        <Stat label="累計減帳(核准)" value={money(Math.abs(totals.reduce))} sub="NT$" color="text-[var(--red-text)]" />
        <Stat label="變更後契約金額" value={yi(revised)} sub={`${ratio >= 0 ? '+' : ''}${ratio.toFixed(1)}% · NT$ ${money(revised)}`} color="text-[var(--blue-text)]" />
      </div>
      {totals.pendingNet !== 0 && (
        // 不用負 margin 硬拉近 Stat 列:頁面根層 space-y-5 的節奏由容器決定
        <p className="text-xs text-[var(--text-3)] leading-relaxed">另有 {totals.pendingCount} 件審核中/提出的變更淨額 <span className={totals.pendingNet >= 0 ? 'text-[var(--green-text)]' : 'text-[var(--red-text)]'}>{totals.pendingNet >= 0 ? '+' : ''}{money(totals.pendingNet)}</span>（尚未計入變更後契約金額）。</p>
      )}

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      {/* W8-5:表單區非表格,手機補到 44px 觸控目標不會壓縮任何列高 */}
      {can.edit && <Card title="新增變更設計">
        {/* 欄位標籤與控件全走共用 Field/Input,寬度交給外層容器 */}
        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
          <div className="w-28">
            <Field label="變更編號">
              <Input value={head.co_no} onChange={(e) => setHead({ ...head, co_no: e.target.value })} placeholder="第1次變更" />
            </Field>
          </div>
          <div className="flex-1 min-w-[180px]">
            <Field label="事由 / 名稱">
              <Input value={head.title} onChange={(e) => setHead({ ...head, title: e.target.value })} placeholder="如：因現場地質變更增設擋土措施" />
            </Field>
          </div>
          <div className="w-40">
            <Field label="日期">
              <Input type="date" value={head.co_date} onChange={(e) => setHead({ ...head, co_date: e.target.value })} />
            </Field>
          </div>
          <Button type="submit" disabled={busy || !head.title.trim()}>{busy ? '新增中…' : <><MSym name="add" size={16} />新增</>}</Button>
        </form>
        {/* role="status":送出成功用 live region 就地告知,不打斷鍵盤動線(W8-5 a11y) */}
        {submitted && <p role="status" className="text-xs text-[var(--green-text)] mt-2">已送出申請，待監造受理審查。</p>}
      </Card>}

      {changeOrders.length === 0 ? (
        <Card title="變更清單" bodyClass="p-0"><Empty>尚無變更設計。新增一筆後，在其中加入追加/減帳工項。</Empty></Card>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="ghost" onClick={exportAll}><MSym name="download" size={16} />匯出全部 CSV</Button>
          </div>
          {groups.map((g) => g.list.length === 0 ? null : (
            // 群標題只是安靜的分隔線索,不做成 Card——多一層卡片框會讓清單看起來更重
            <div key={g.key} className="space-y-4">
              <h2 className="text-sm font-medium text-[var(--text-2)]">{g.label}（{g.list.length}）</h2>
              {g.list.map((co) => (
                <ChangeOrderCard key={co.id} co={co} net={coNet(co)} leaves={leaves} allItems={workItems?.items || []}
                  // D-016 三段流程:監造受理審查/退回(can.review),機關核准/駁回(can.ratify)
                  canReview={can.review} canRatify={can.ratify}
                  // 明細可編=廠商填報權 且 尚未核准(核准後 DB 凍結,UI 同步凍結——P0-02)
                  canEdit={can.edit} itemsEditable={can.edit && co.status !== '核准'}
                  onStatus={async (s) => { setErrMsg(''); const { error } = await updateChangeOrder(co.id, { status: s }); if (error) setErrMsg(friendlyError(error, '變更狀態未更新')) }}
                  onDelete={async () => { if (await appConfirm({ title: `刪除變更「${co.title}」？`, body: '其明細將一併刪除。', danger: true, confirmLabel: '刪除' })) { setErrMsg(''); const { error } = await deleteChangeOrder(co.id); if (error) setErrMsg(friendlyError(error, '變更刪除未完成')) } }}
                  onAddItem={(input) => addChangeOrderItem(co.id, input)}
                  onAddItems={(rows) => addChangeOrderItems(co.id, rows)}
                  onUpdateItem={async (id, patch) => { setErrMsg(''); const { error } = await updateChangeOrderItem(co.id, id, patch); if (error) setErrMsg(friendlyError(error, '明細未寫入')) }}
                  onDeleteItem={async (id) => { setErrMsg(''); const { error } = await deleteChangeOrderItem(co.id, id); if (error) setErrMsg(friendlyError(error, '明細未刪除')) }} />
              ))}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-[var(--text-3)] leading-relaxed">
        變更後契約金額 = 原契約金額 + 已「核准」變更的追加減淨額。追加填正數量、減帳填負數量；連結既有工項會自動帶入單價，也可直接新增全新工項。
      </p>
    </div>
  )
}

const KIND_COLOR = { 數量增減: 'blue', '單價變更-減': 'amber', '單價變更-加': 'amber', 新增項: 'green', 刪除項: 'red' }

function ChangeOrderCard({ co, net, leaves, allItems, canReview, canRatify, canEdit, itemsEditable, onStatus, onDelete, onAddItem, onAddItems, onUpdateItem, onDeleteItem }) {
  const [draft, setDraft] = useState({ work_item_key: '', item_no: '', description: '', unit: '', qty_delta: '', unit_price: '', note: '' })
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [showItems, setShowItems] = useState(false) // 已定案變更的明細收合(預設收起,同原 <details>)
  const [diff, setDiff] = useState(null) // { fileName, rows, summary }
  const [diffErr, setDiffErr] = useState('')
  const [applying, setApplying] = useState(false)

  const onDiffFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setDiffErr('')
    try {
      const parsed = parsePccesXml(await f.text())
      setDiff({ fileName: f.name, ...diffBoq(allItems, parsed.items) })
    } catch (err) {
      setDiff(null)
      setDiffErr(friendlyError(err, '標單解析失敗'))
    }
  }
  const applyDiff = async () => {
    setApplying(true)
    const { error } = await onAddItems(diff.rows)
    setApplying(false)
    if (!error) setDiff(null)
  }

  const results = search.trim() ? leaves.filter((it) => it.description.includes(search.trim()) || (it.item_no || '').includes(search.trim())).slice(0, 10) : []
  const pick = (it) => {
    setDraft((d) => ({ ...d, work_item_key: it.item_key, item_no: it.item_no, description: it.description, unit: it.unit, unit_price: it.unit_price ?? '' }))
    setSearch('')
  }
  const submit = async () => {
    if (!draft.description.trim()) return
    setAdding(true)
    const { error } = await onAddItem(draft)
    setAdding(false)
    if (!error) setDraft({ work_item_key: '', item_no: '', description: '', unit: '', qty_delta: '', unit_price: '', note: '' })
  }

  // 已定案(核准/駁回)的變更不再需要逐項核對,明細收進 details;待核定的維持完全攤開
  const settled = !isPending(co.status)
  const itemsTable = (
    <table className="w-full text-sm min-w-[620px]">
      <thead>
        {/* 表頭字型層走共用 THEAD_CLS(全站曾有 uppercase/tracking-wide/text-3 三種寫法) */}
        <tr className={`${THEAD_CLS} border-b border-[var(--border)]`}>
          <th className="text-left py-1.5">工項</th>
          <th className="text-right px-2">單位</th>
          <th className="text-right px-2 whitespace-nowrap">數量增減</th>
          <th className="text-right px-2">單價</th>
          <th className="text-right px-2 whitespace-nowrap">金額增減</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {/* 已核准或無填報權=唯讀呈現(P0-02:先由狀態×角色決定唯讀,再渲染,不靠 API 事後擋) */}
        {co.items.map((it) => (
          <tr key={it.id} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
            <td className="py-1.5"><span className="text-[var(--text-3)] text-xs mr-2 num">{it.item_no}</span>{it.description}</td>
            <td className="px-2 text-right text-[var(--text-3)] text-xs whitespace-nowrap">{it.unit}</td>
            <td className="px-2 text-right num whitespace-nowrap">
              {itemsEditable ? (
                // 表格內輸入:圓角回到系統的 rounded-md,觸控斷點與全站手機層(max-md)一致
                <input type="number" step="any" inputMode="decimal" defaultValue={it.qty_delta ?? ''} aria-label={`${it.description} 數量增減`}
                  key={`q-${it.id}-${it.qty_delta ?? ''}`}
                  onBlur={(e) => { const n = parseFloat(e.target.value); if ((isNaN(n) ? 0 : n) !== (Number(it.qty_delta) || 0)) onUpdateItem(it.id, { qty_delta: isNaN(n) ? 0 : n }) }}
                  className="w-20 text-right border border-[var(--border)] rounded-md px-1.5 py-0.5 text-xs num max-md:py-2" />
              ) : <span>{it.qty_delta ?? 0}</span>}
            </td>
            <td className="px-2 text-right num whitespace-nowrap">
              {itemsEditable ? (
                <input type="number" step="any" inputMode="decimal" defaultValue={it.unit_price ?? ''} aria-label={`${it.description} 單價`}
                  key={`p-${it.id}-${it.unit_price ?? ''}`}
                  onBlur={(e) => { const n = parseFloat(e.target.value); if ((isNaN(n) ? 0 : n) !== (Number(it.unit_price) || 0)) onUpdateItem(it.id, { unit_price: isNaN(n) ? 0 : n }) }}
                  className="w-24 text-right border border-[var(--border)] rounded-md px-1.5 py-0.5 text-xs num max-md:py-2" />
              ) : <span>{money(it.unit_price)}</span>}
            </td>
            <td className={`px-2 text-right num whitespace-nowrap font-medium ${(Number(it.amount_delta) || 0) >= 0 ? 'text-[var(--green-text)]' : 'text-[var(--red-text)]'}`}>{(Number(it.amount_delta) || 0) >= 0 ? '+' : ''}{money(it.amount_delta)}</td>
            {/* p-2 -m-2:命中區擴到約 32px 但視覺與列高完全不變(表格內拉到 44px 會讓每列翻倍) */}
            <td className="text-right pl-2">{itemsEditable && <button onClick={() => onDeleteItem(it.id)} aria-label={`刪除明細 ${it.description}`} className="inline-flex items-center justify-center text-[var(--text-3)] hover:text-[var(--red-text)] p-2 -m-2"><MSym name="close" size={16} /></button>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <Card title={`${co.co_no ? co.co_no + '　' : ''}${co.title}`} action={
      <div className="flex items-center gap-2">
        <span className={`text-sm font-medium num whitespace-nowrap ${net >= 0 ? 'text-[var(--green-text)]' : 'text-[var(--red-text)]'}`}>{net >= 0 ? '+' : ''}{money(net)}</span>
        {/* D-016 三段流程動作鈕取代四值下拉:能按什麼=角色×狀態,順序(提出→審核中→
            核准/駁回)由 DB guard 強制,這裡只渲染當下合法的動作——監造看不到核准鈕 */}
        {co.status === '提出' && canReview && (
          <Button size="sm" variant="outline" onClick={() => onStatus('審核中')}>受理審查</Button>
        )}
        {co.status === '審核中' && canReview && (
          <Button size="sm" variant="outline" onClick={() => onStatus('提出')}>退回</Button>
        )}
        {co.status === '審核中' && canRatify && (<>
          <Button size="sm" onClick={() => onStatus('核准')}>核准</Button>
          <Button size="sm" variant="danger" onClick={() => onStatus('駁回')}>駁回</Button>
        </>)}
        {canEdit && <button onClick={onDelete} aria-label={`刪除變更單 ${co.title || co.co_no}`} className="inline-flex items-center justify-center text-[var(--text-3)] hover:text-[var(--red-text)] p-2 -m-2"><MSym name="close" size={16} /></button>}
      </div>
    }>
      <div className="flex items-center gap-2 mb-3 text-xs text-[var(--text-3)]">
        <Badge color={STATUS_COLOR[co.status] || 'slate'}>{co.status}</Badge>
        {co.co_date && <span>{co.co_date}</span>}
      </div>

      {co.items.length > 0 && (settled ? (
        // 收合走與專案文件同一套(button + chevron 旋轉),不交給瀏覽器預設三角形
        <div className="mb-3">
          <button onClick={() => setShowItems((s) => !s)} aria-expanded={showItems}
            className="text-sm text-[var(--text-2)] hover:text-[var(--text)] inline-flex items-center gap-1 max-md:min-h-11 px-1">
            <MSym name="chevron_right" size={14} className={`transition-transform duration-[var(--dur-fast)] ${showItems ? 'rotate-90' : ''}`} />
            工項明細（{co.items.length} 筆）
          </button>
          {showItems && <div className="overflow-x-auto mt-2">{itemsTable}</div>}
        </div>
      ) : (
        <div className="overflow-x-auto mb-3">{itemsTable}</div>
      ))}

      {/* 變更後預算書 diff → 自動產生明細(僅未核准且有填報權) */}
      {itemsEditable && <div className="mb-3">
        {/* 不能用 <button> 的檔案上傳 label 也吃同一套按鈕皮(藥丸+44px 觸控)。
            用 sm:按鈕皮帶 whitespace-nowrap,這行文案在 md(14px)下會撐破 375px 的卡身 */}
        <label className={`${buttonClass('outline', 'sm')} ${applying ? 'opacity-40' : 'cursor-pointer'}`}>
          <MSym name="upload_file" size={14} />上傳變更後預算書 XML，自動產生明細
          <input type="file" accept=".xml" className="hidden" onChange={onDiffFile} disabled={applying} />
        </label>
        {diffErr && <p className="text-xs text-[var(--red-text)] mt-1.5">{diffErr}</p>}
        {diff && (
          <Surface className="mt-2 p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-2)]">
              <span className="font-medium text-[var(--text)]">{diff.fileName}</span>
              <span>數量增減 {diff.summary.changed} 項</span>
              <span>單價變更 {diff.summary.priceChanged} 項</span>
              <span>新增 {diff.summary.added} 項</span>
              <span>刪除 {diff.summary.removed} 項</span>
              <span className={`font-medium num whitespace-nowrap ${diff.summary.net >= 0 ? 'text-[var(--green-text)]' : 'text-[var(--red-text)]'}`}>淨額 {diff.summary.net >= 0 ? '+' : ''}{money(diff.summary.net)}</span>
            </div>
            {diff.rows.length === 0 ? (
              <Empty>與現行標單無差異。</Empty>
            ) : (
              <>
                <div className="overflow-auto max-h-64 mt-2">
                  <table className="w-full text-sm min-w-[620px]">
                    <thead>
                      <tr className={`${THEAD_CLS} border-b border-[var(--border)]`}>
                        <th className="text-left py-1">類型</th>
                        <th className="text-left px-2">工項</th>
                        <th className="text-right px-2">單位</th>
                        <th className="text-right px-2 whitespace-nowrap">數量增減</th>
                        <th className="text-right px-2">單價</th>
                        <th className="text-right px-2 whitespace-nowrap">金額增減</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.rows.map((r, i) => (
                        <tr key={i} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
                          <td className="py-1"><Badge color={KIND_COLOR[r.kind] || 'slate'}>{r.kind}</Badge></td>
                          <td className="px-2"><span className="text-[var(--text-3)] text-xs mr-2 num">{r.item_no}</span>{r.description}</td>
                          <td className="px-2 text-right text-[var(--text-3)] text-xs whitespace-nowrap">{r.unit}</td>
                          <td className="px-2 text-right num whitespace-nowrap">{r.qty_delta}</td>
                          <td className="px-2 text-right num whitespace-nowrap">{money(r.unit_price)}</td>
                          <td className={`px-2 text-right num whitespace-nowrap font-medium ${r.amount_delta >= 0 ? 'text-[var(--green-text)]' : 'text-[var(--red-text)]'}`}>{r.amount_delta >= 0 ? '+' : ''}{money(r.amount_delta)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Button onClick={applyDiff} disabled={applying}>{applying ? '套用中…' : `套用 ${diff.rows.length} 筆明細`}</Button>
                  <Button variant="ghost" onClick={() => setDiff(null)}>取消</Button>
                </div>
              </>
            )}
          </Surface>
        )}
      </div>}

      {/* 新增明細(僅未核准且有填報權) */}
      {itemsEditable && <div className="bg-[var(--surface-2)] rounded-lg p-3">
        {/* 輸入全走共用 Input(focus ring/disabled/手機 44px 一次到位),寬度交給外層容器 */}
        <div className="relative mb-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋既有工項連結（可留空直接新增全新項）…" />
          {results.length > 0 && (
            // 浮層陰影走 token(Tailwind 原生 shadow-lg 是黑色硬陰影,不吃深色模式)
            <div className="absolute z-10 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg [box-shadow:var(--shadow-overlay)] max-h-56 overflow-auto enter-menu">
              {results.map((it) => (
                <button key={it.item_key} onClick={() => pick(it)} className="w-full text-left px-3 py-1.5 text-sm max-md:min-h-11 hover:bg-[var(--surface-2)] truncate">
                  <span className="text-[var(--text-3)] text-xs mr-2">{it.item_no}</span>{it.description}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[140px]">
            <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="工項名稱" />
          </div>
          <div className="w-16">
            <Input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="單位" />
          </div>
          <div className="w-24">
            <Input type="number" step="any" value={draft.qty_delta} onChange={(e) => setDraft({ ...draft, qty_delta: e.target.value })} placeholder="數量±"
              aria-label="新明細數量增減" className="text-right num" />
          </div>
          <div className="w-24">
            <Input type="number" step="any" value={draft.unit_price} onChange={(e) => setDraft({ ...draft, unit_price: e.target.value })} placeholder="單價"
              aria-label="新明細單價" className="text-right num" />
          </div>
          <Button onClick={submit} disabled={adding || !draft.description.trim()}>{adding ? '…' : <><MSym name="add" size={16} />明細</>}</Button>
        </div>
        <p className="text-[11px] text-[var(--text-3)] mt-1.5">追加填正數量、減帳填負數量。金額 = 數量 × 單價，自動計算。</p>
      </div>}
      {!itemsEditable && co.status === '核准' && (
        <p className="text-[11px] text-[var(--text-3)]">此變更已核准，明細凍結；如需調整請由機關撤銷核准後再修改（D-016：撤銷為機關專屬）。</p>
      )}
    </Card>
  )
}
