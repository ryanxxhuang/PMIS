// 變更設計的詳情欄(清單＋詳情殼的右欄/抽屜內容)。從 ChangeOrders.jsx 搬出來不是因為
// 它可以共用——只有那一頁用——而是它太重:巢狀編輯器(搜標單、匯入差異、新增明細,
// 五個 state)加兩張約 620px 的明細表,留在主檔會讓單檔 540 行,與 repo 的拆檔方向相反
// (Contract 1080→592、Quality 813→272、SiteLog 961→696)。純搬移:金額算式
// (coNet/totals 留在主檔,diffBoq 在 lib)與角色閘門一個字都沒改。
// 狀態色票/正負號格式化/isPending 由兩檔共用,住這裡再 export 回主檔——主檔的
// 清單列與快篩靠它們,子件的狀態列與明細表也靠它們,同一個狀態在列與詳情不得兩種顏色。
import { useState } from 'react'
import { MSym } from '../../components/icons.jsx'
import { Surface, Empty, Button, Badge, IconButton, Input, buttonClass, THEAD_CLS } from '../../components/ui.jsx'
import { MetaGrid } from '../../components/listDetail.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { parsePccesXml } from '../../lib/parsePcces.js'
import { diffBoq } from '../../lib/coDiff.js'
import { fmtAmount as money } from '../../lib/format.js'

export const STATUS_COLOR = { 提出: 'slate', 審核中: 'amber', 核准: 'green', 駁回: 'red' }
export const isPending = (status) => status === '提出' || status === '審核中'
// 金額增減的文字色與正負號:清單列、詳情狀態列、兩張明細表同一組——顏色＋符號並存
export const signCls = (n) => (n >= 0 ? 'text-[var(--green-text)]' : 'text-[var(--red-text)]')
export const signed = (n) => `${n >= 0 ? '+' : ''}${money(n)}`

const KIND_COLOR = { 數量增減: 'blue', '單價變更-減': 'amber', '單價變更-加': 'amber', 新增項: 'green', 刪除項: 'red' }

// 詳情欄:狀態列 / 編號主旨與 meta / 追加減明細表 / 匯入差異 / 新增明細 / 動作列。
// 動作條件與改版前卡頭動作逐條相同,一條沒放寬(順序 提出→審核中→核准/駁回由 DB guard
// 強制,這裡只渲染當下合法的動作——監造看不到核准鈕):
//   canAccept = 提出 ∧ can.review    → 受理審查(監造)
//   canReturn = 審核中 ∧ can.review  → 退回(監造)
//   canRule   = 審核中 ∧ can.ratify  → 核准 / 駁回(機關專屬,D-016)
//   canDelete = can.edit             → 刪除變更單(廠商;改版前是卡頭的 ✕ 圖示鈕)
//   waiting   = 待核定 ∧ 看的人在這一步沒有動作 → 等待字樣(改版前不渲染;現在把
//               「為什麼沒有按鈕」講出來,與 /rfi 的「待監造回覆」同一做法)
export default function ChangeOrderDetail({ co, net, leaves, allItems, canReview, canRatify, canEdit, itemsEditable, onStatus, onDelete, onAddItem, onAddItems, onUpdateItem, onDeleteItem }) {
  const [draft, setDraft] = useState({ work_item_key: '', item_no: '', description: '', unit: '', qty_delta: '', unit_price: '', note: '' })
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [diff, setDiff] = useState(null) // { fileName, rows, summary }
  const [diffErr, setDiffErr] = useState('')
  const [applying, setApplying] = useState(false)

  const canAccept = co.status === '提出' && canReview
  const canReturn = co.status === '審核中' && canReview
  const canRule = co.status === '審核中' && canRatify
  const canDelete = canEdit
  const waiting = co.status === '提出' && !canReview ? '待監造受理審查' : co.status === '審核中' && !canRatify ? '待機關核定' : ''

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

  // 明細表約 620px:寬版詳情內距後剛好放得下;<lg 抽屜與 375px 由外層 overflow-x-auto 橫向捲動
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
            <td className={`px-2 text-right num whitespace-nowrap font-medium ${signCls(Number(it.amount_delta) || 0)}`}>{signed(Number(it.amount_delta) || 0)}</td>
            {/* 命中區桌機 32、手機 44,但負 margin 讓流內寬仍是 16px——表格列高完全不變
                (原本怕「拉到 44 會讓每列翻倍」,吸回流內寬之後就不會) */}
            <td className="text-right pl-2">{itemsEditable && <IconButton name="close" label={`刪除明細 ${it.description}`} onClick={() => onDeleteItem(it.id)} className="-m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  // region 以編號命名:報讀器走地標時直接聽到「CO-002 詳情」,e2e 也用同一個名字
  // 確認詳情欄正在顯示哪一筆;沒填編號的變更退回用事由命名
  return (
    <section aria-label={`${co.co_no || co.title} 詳情`}>
      {/* 狀態列:狀態色票＋淨額;顏色＋文字並存。淨額是改版前卡頭最顯眼的那個數字,
          仍由 coNet 算(確定性加總),這裡只複述 */}
      <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
        <Badge color={STATUS_COLOR[co.status] || 'slate'}>{co.status}</Badge>
        <span className={`ml-auto num text-footnote font-medium whitespace-nowrap ${signCls(net)}`}>淨額 {signed(net)}</span>
      </div>

      <div className="p-4">
        {co.co_no && <div className="num text-caption text-[var(--text-3)]">{co.co_no}</div>}
        <div className="mt-0.5 text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{co.title}</div>
        {/* 空值一律顯示 —:四格固定,眼睛掃同一位置就知道有沒有填 */}
        <MetaGrid className="mt-3.5" rows={[
          ['日期', co.co_date || '—'],
          ['狀態', co.status],
          ['明細', `${co.items.length} 筆`],
          ['理由', co.reason || '—'],
        ]} />
      </div>

      {/* 追加/減帳明細:一次只顯示一筆變更,不再收合(改版前收合是因為多張卡疊在一起) */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <MSym name="list_alt" size={15} className="text-[var(--text-3)]" />
          <span className="text-footnote font-medium text-[var(--text)]">追加／減帳明細</span>
        </div>
        {co.items.length > 0 ? (
          // lg:-mx-3:寬版內距後剩 606px,表格 min-w 620——不往卡邊外溢桌機就永遠帶一條橫向
          // 捲軸、刪除鈕被切掉半顆。lg:pr-2 吃掉列尾 ✕ 鈕 -m-2 往右的 8px 命中區,否則它會
          // 把捲動寬度撐大 8px、捲軸還是在。<lg 抽屜本來就橫向捲,留 16px 邊距不外溢
          <div className="overflow-x-auto lg:-mx-3 lg:pr-2">{itemsTable}</div>
        ) : (
          <p className="text-footnote text-[var(--text-3)]">尚無明細。{itemsEditable ? '在下方加入工項,或上傳變更後預算書自動產生。' : ''}</p>
        )}
      </div>

      {/* 變更後預算書 diff → 自動產生明細(僅未核准且有填報權) */}
      {itemsEditable && <div className="px-4 pb-4">
        {/* 不能用 <button> 的檔案上傳 label 也吃同一套按鈕皮(44px 觸控)。
            用 sm:按鈕皮帶 whitespace-nowrap,這行文案在 md(14px)下會撐破 375px 的抽屜 */}
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
              <span className={`font-medium num whitespace-nowrap ${signCls(diff.summary.net)}`}>淨額 {signed(diff.summary.net)}</span>
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
                          <td className={`px-2 text-right num whitespace-nowrap font-medium ${signCls(r.amount_delta)}`}>{signed(r.amount_delta)}</td>
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
      {itemsEditable && <div className="px-4 pb-4"><div className="bg-[var(--surface-2)] rounded-lg p-3">
        {/* 輸入全走共用 Input(focus ring/disabled/手機 44px 一次到位),寬度交給外層容器 */}
        <div className="relative mb-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋既有工項連結（可留空直接新增全新項）…" aria-label="搜尋既有工項" />
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
            <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="工項名稱" aria-label="新明細工項名稱" />
          </div>
          <div className="w-16">
            <Input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="單位" aria-label="新明細單位" />
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
        <p className="text-caption text-[var(--text-3)] mt-1.5">追加填正數量、減帳填負數量。金額 = 數量 × 單價，自動計算。</p>
      </div></div>}
      {!itemsEditable && co.status === '核准' && (
        <p className="px-4 pb-4 text-caption text-[var(--text-3)]">此變更已核准，明細凍結；如需調整請由機關撤銷核准後再修改（D-016：撤銷為機關專屬）。</p>
      )}

      {/* 動作列:同一時間最多一顆實心主鈕(核准);其餘次級/第三級。
          灰轉紅的 ✕ 圖示刪除鈕不在三級語言內,改共用 Button 的第三級,ml-auto 靠右與核定動作拉開 */}
      {(canAccept || canReturn || canRule || canDelete || waiting) && (
        <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
          {canAccept && <Button variant="secondary" onClick={() => onStatus('審核中')}>受理審查</Button>}
          {canReturn && <Button variant="secondary" onClick={() => onStatus('提出')}>退回</Button>}
          {canRule && (<>
            <Button onClick={() => onStatus('核准')}>核准</Button>
            <Button variant="danger" onClick={() => onStatus('駁回')}>駁回</Button>
          </>)}
          {waiting && <span className="text-footnote text-[var(--text-2)]">{waiting}</span>}
          {canDelete && <Button variant="ghost" size="sm" className="ml-auto" onClick={onDelete}>刪除變更單</Button>}
        </div>
      )}
    </section>
  )
}
