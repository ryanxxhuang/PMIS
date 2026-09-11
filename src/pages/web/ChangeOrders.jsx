import { useState, useMemo, useRef } from 'react'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Stat, Empty, Button, Badge, Dot, Field, Input, PageHeader, ErrorBanner } from '../../components/ui.jsx'
import { ListDetailLayout, SearchField, StatusChip } from '../../components/listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { taipeiToday } from '../../lib/dates.js'
import { fmtAmount as money, fmtYi as yi } from '../../lib/format.js'
import { billableLeaves } from '../../lib/boqCalc.js'
import ChangeOrderDetail, { STATUS_COLOR, isPending, signCls, signed } from './ChangeOrderDetail.jsx'

// 版面:改版前每筆變更是一張可展開的卡,依「待核定／已核定」分成兩段各疊一疊——
// 追加/減帳明細表、匯入差異預覽、新增明細編輯器全攤在卡上,一筆變更就是一整屏,
// 核准鈕離它影響的明細隔了整張卡的高(判準第 3、4 條)。現在是一份清單(只負責選取)
// ＋詳情欄:明細表、巢狀編輯器、核定動作永遠在同一個位置(規範 §0 疊合版)。
// 詳情走殼的寬版(width="wide",640px):追加/減帳明細與匯入差異是兩張約 620px 的
// 表格,400px 只會逼這一頁自己刻一套寬度(理由見 listDetail.jsx LIST_DETAIL_GRID_WIDE)。
// 已定案變更的明細不再收合:改版前收合是因為多張卡疊在一起,詳情欄一次只顯示一筆。
//
// 狀態快篩:兩段沿用改版前的分群語意(待核定=提出/審核中、已核定／已結=核准/駁回),
// 件數掛在 chip 上;機關來這頁只為了「還沒定案的要不要核」,清單順序仍是待核定在前。
const GROUP_FILTERS = [
  { key: 'pending', label: '待核定', color: 'amber' },
  { key: 'settled', label: '已核定／已結', color: 'slate' },
]
const groupOf = (co) => (isPending(co.status) ? 'pending' : 'settled')
const DEFAULT_FILTERS = { q: '', group: '' }

export default function ChangeOrders() {
  const { workItems, dbMode, demoMode, changeOrders, can, currentProject, currentUser,
    createChangeOrder, updateChangeOrder, deleteChangeOrder,
    addChangeOrderItem, addChangeOrderItems, updateChangeOrderItem, deleteChangeOrderItem } = useStore()
  const original = workItems?.meta.billable_total || 0

  const [head, setHead] = useState({ co_no: '', title: '', co_date: taipeiToday() })
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 明細/狀態寫入失敗必須讓使用者看到(失敗=UI 不變)
  const [submitted, setSubmitted] = useState(false) // 廠商送出後就地回饋(O-4:提出≠已受理,球在監造)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const searchRef = useRef(null)

  // 發包末端工項（給明細連結既有工項用）
  const leaves = useMemo(() => {
    if (!workItems) return []
    return billableLeaves(workItems.items)
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

  // 件數走全體(不受搜尋影響):chip 上的數字是「本案有幾筆還沒定案」,0 也保留
  const counts = useMemo(() => {
    const c = { pending: 0, settled: 0 }
    for (const co of changeOrders) c[groupOf(co)]++
    return c
  }, [changeOrders])
  // 目前畫面上的清單:狀態段 AND 關鍵字(編號/事由/理由/明細工項)。待核定排前面、
  // 已定案往下沉,兩段各自維持 store 順序(sort 穩定)——與改版前兩段分群的閱讀順序
  // 完全相同:機關進來第一眼就是要核的東西,使用者記憶中的清單順序不被打亂。
  const ordered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return changeOrders
      .filter((co) => !filters.group || groupOf(co) === filters.group)
      .filter((co) => !q || [co.co_no, co.title, co.reason, ...co.items.map((it) => it.description)]
        .some((v) => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => (isPending(a.status) ? 0 : 1) - (isPending(b.status) ? 0 : 1))
  }, [changeOrders, filters])
  const anyFilter = filters.q.trim() !== '' || filters.group !== ''

  // 選取/深連結(?co=)/切案重置/初次自動選取:共用殼 hook。預設選第一筆待核定
  // (開頁就落在該核的那一筆),沒有就選清單第一筆。
  const pid = currentProject?.project_id
  const org = currentUser?.org_type || 'contractor'
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'co', idPrefix: 'co-',
    scope: `${pid}/${org}`,
    ready: changeOrders.length > 0, rows: changeOrders,
    pickDefault: () => (ordered.find((co) => isPending(co.status)) || ordered[0])?.id,
    onSelect: () => setErrMsg(''),
    onReset: () => setFilters(DEFAULT_FILTERS),
  })
  // 篩選後選中項被篩掉:右欄內容保留(與 /submittals 同),清單中只是沒有高亮列——
  // 核准後這一筆離開「待核定」,詳情還在,機關看得到自己剛核了什麼
  const selected = changeOrders.find((co) => co.id === selectedId) || null
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'co-', searchRef })

  const revised = original + totals.approvedNet
  const ratio = original ? (totals.approvedNet / original) * 100 : 0

  const onCreate = async (e) => {
    e.preventDefault()
    if (!head.title.trim()) return
    setBusy(true)
    const { error } = await createChangeOrder(head)
    setBusy(false)
    if (!error) { setHead({ co_no: '', title: '', co_date: taipeiToday() }); setSubmitted(true) }
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

  // ── 詳情欄:巢狀編輯器(搜標單、匯入差異、新增明細)的狀態住在子元件、以 co.id 為 key,
  // 換選取就整組重置——否則會出現「詳情是 B、搜到一半的工項是 A 的」。
  // D-016 三段流程:監造受理審查/退回(can.review),機關核准/駁回(can.ratify);
  // 明細可編=廠商填報權 且 尚未核准(核准後 DB 凍結,UI 同步凍結——P0-02)
  const detailBody = selected ? (
    <ChangeOrderDetail key={selected.id} co={selected} net={coNet(selected)} leaves={leaves} allItems={workItems?.items || []}
      canReview={can.review} canRatify={can.ratify}
      canEdit={can.edit} itemsEditable={can.edit && selected.status !== '核准'}
      onStatus={async (s) => { setErrMsg(''); const { error } = await updateChangeOrder(selected.id, { status: s }); if (error) setErrMsg(friendlyError(error, '變更狀態未更新')) }}
      onDelete={async () => {
        if (!(await appConfirm({ title: `刪除變更「${selected.title}」？`, body: '其明細將一併刪除。', danger: true, confirmLabel: '刪除' }))) return
        setErrMsg('')
        const { error } = await deleteChangeOrder(selected.id)
        if (error) setErrMsg(friendlyError(error, '變更刪除未完成'))
        else closeDetail() // <lg 抽屜承載的正是這筆,刪掉後不留 detailOpen 殘值
      }}
      onAddItem={(input) => addChangeOrderItem(selected.id, input)}
      onAddItems={(rows) => addChangeOrderItems(selected.id, rows)}
      onUpdateItem={async (id, patch) => { setErrMsg(''); const { error } = await updateChangeOrderItem(selected.id, id, patch); if (error) setErrMsg(friendlyError(error, '明細未寫入')) }}
      onDeleteItem={async (id) => { setErrMsg(''); const { error } = await deleteChangeOrderItem(selected.id, id); if (error) setErrMsg(friendlyError(error, '明細未刪除')) }} />
  ) : null

  // ── 左欄卡頭下方:搜尋 + 兩段狀態快篩(件數走全體),兩條件 AND
  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋編號、事由、工項…" aria-label="搜尋變更設計" />
      <div className="flex items-center gap-2 flex-wrap">
        {GROUP_FILTERS.map((f) => (
          <StatusChip key={f.key} active={filters.group === f.key} count={counts[f.key]}
            onClick={() => setFilters((x) => ({ ...x, group: x.group === f.key ? '' : f.key }))}>
            <Dot color={f.color} />{f.label}
          </StatusChip>
        ))}
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>清除篩選</Button>
        )}
      </div>
    </div>
  )

  // ── 清單列:只負責選取(動作全在詳情欄),兩行=編號＋事由＋狀態 / 日期·筆數·淨額。
  // 淨額進列是改版前卡頭就有的數字(機關掃清單要先看金額量級再決定看哪一筆)。
  // role=listitem + aria-current 與 /rfi、/submittals 同一套選取語意。
  const listRows = (
    <div role="list" aria-label="變更清單" className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的變更。<br />換一段狀態,或試試編號、事由、工項關鍵字。
        </div>
      ) : ordered.map((co) => {
        const active = co.id === selectedId
        const net = coNet(co)
        return (
          <button key={co.id} type="button" role="listitem" id={`co-${co.id}`}
            aria-current={active || undefined}
            onClick={() => select(co.id, { openPane: true })}
            className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer ${active
              ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
            <span className="flex items-center gap-2 flex-wrap">
              {co.co_no && <span className="num text-caption text-[var(--text-3)]">{co.co_no}</span>}
              <span className="text-body text-[var(--text)] min-w-0 [text-wrap:pretty]">{co.title}</span>
              <Badge color={STATUS_COLOR[co.status] || 'slate'}>{co.status}</Badge>
            </span>
            <span className="block mt-0.5 num text-caption text-[var(--text-3)] truncate">
              {[co.co_date, `${co.items.length} 筆明細`].filter(Boolean).join(' · ')}
              <span className={`ml-2 font-medium ${signCls(net)}`}>{signed(net)}</span>
            </span>
          </button>
        )
      })}
    </div>
  )

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
        <p className="text-xs text-[var(--text-3)] leading-relaxed">另有 {totals.pendingCount} 件審核中/提出的變更淨額 <span className={signCls(totals.pendingNet)}>{signed(totals.pendingNet)}</span>（尚未計入變更後契約金額）。</p>
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
        <ListDetailLayout width="wide"
          detail={detailBody}
          detailLabel="變更詳情"
          detailEmpty={<Empty>點左側清單查看變更的追加/減帳明細與核定動作。</Empty>}
          drawerOpen={detailOpen && !!selected}
          onDrawerClose={closeDetail}>
          {/* ── 左欄:一份清單(右欄與抽屜由殼統一,見 components/listDetail.jsx)。
              匯出從清單上方的獨立一列搬到卡頭:它匯的就是這份清單 */}
          <Card title={`變更清單（${changeOrders.length}）`} bodyClass="p-0" action={
            <Button variant="ghost" size="sm" onClick={exportAll}><MSym name="download" size={14} />匯出 CSV</Button>
          }>
            {filterBar}
            {listRows}
          </Card>
        </ListDetailLayout>
      )}

      <p className="text-xs text-[var(--text-3)] leading-relaxed">
        變更後契約金額 = 原契約金額 + 已「核准」變更的追加減淨額。追加填正數量、減帳填負數量；連結既有工項會自動帶入單價，也可直接新增全新工項。
      </p>
    </div>
  )
}
