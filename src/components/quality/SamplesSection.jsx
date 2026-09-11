// 取樣試驗分段:澆置日誌 → 試體組 → 7/28 天齡期 → 抗壓值自動判定。
// 改版前是一張 7 欄表(min-w-720px、每列兩個就地輸入格),375px 只能橫向捲。現在是
// 清單＋狀態快篩＋搜尋,試驗值在詳情欄填(規範 §8 IA 殼:動作就地在詳情欄處理)。
// 判定與自動開缺失沿用 store 的 updateTestSample(真專案下沉 DB trigger 同一交易、
// demo 走本地 judgeConcrete + 去重),本元件只寫值,一條語意都不改。
import { useMemo, useRef, useState } from 'react'
import { MSym } from '../icons.jsx'
import { Card, Button, Field, Badge, Dot, Empty, IconButton, Input } from '../ui.jsx'
import { ListDetailLayout, SearchField, StatusChip, MetaGrid } from '../listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../confirm.jsx'
import { taipeiToday } from '../../lib/dates.js'

const SAMPLE_STATUSES = ['待試驗', '合格', '不合格']
const SAMPLE_COLOR = { 待試驗: 'amber', 合格: 'green', 不合格: 'red' }

export default function SamplesSection({ samples, onGenerate, onCreate, onUpdate, onDelete, canEdit, scope = '' }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [manual, setManual] = useState({ sampled_date: taipeiToday(), fc: 420, location: '' })
  const [addOpen, setAddOpen] = useState(false)
  const [filters, setFilters] = useState({ q: '', status: '' })
  const searchRef = useRef(null)
  const today = taipeiToday()

  const gen = async () => {
    setBusy(true); setMsg('')
    const { error, count } = await onGenerate()
    setBusy(false)
    setMsg(error ? friendlyError(error, '帶入未完成') : count ? `已由施工日誌帶入 ${count} 組取樣。` : '施工日誌沒有尚未建檔的澆置紀錄。')
  }
  const addManual = async () => {
    if (!manual.sampled_date) return
    setBusy(true)
    await onCreate([manual])
    setBusy(false); setAddOpen(false)
  }

  // 件數走全體試體(不受搜尋影響):chip 上的數字是「本案有幾組這一狀態」
  const statusCounts = useMemo(
    () => Object.fromEntries(SAMPLE_STATUSES.map((s) => [s, samples.filter((x) => x.status === s).length])),
    [samples],
  )
  // 目前畫面上的清單:狀態 AND 關鍵字(編號/位置/試驗項目)。順序沿用 store(取樣時序)。
  const ordered = useMemo(() => {
    const kw = filters.q.trim().toLowerCase()
    return samples
      .filter((s) => !filters.status || s.status === filters.status)
      .filter((s) => !kw || [s.sample_no, s.location, s.test_item].some((v) => (v || '').toLowerCase().includes(kw)))
  }, [samples, filters])
  const anyFilter = filters.q.trim() !== '' || filters.status !== ''

  // 逾期=尚未填值且到期日已過(與 sampleAlerts 同口徑);沒到期日就不講
  const isOverdue = (due, filled) => !!due && !filled && due < today
  const dueLabel = (due, filled) => {
    if (!due) return '—'
    return isOverdue(due, filled) ? `${due}（逾期）` : due
  }

  // 選取/深連結(?sample=)/切案重置/初次自動選取:預設選第一組「待試驗」(有欄位要填的),
  // 沒有就選清單第一組。
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'sample', idPrefix: 'ts-', scope,
    ready: samples.length > 0, rows: samples,
    pickDefault: () => (ordered.find((s) => s.status === '待試驗') || ordered[0])?.id,
    onSelect: () => setMsg(''),
    onReset: () => setFilters({ q: '', status: '' }),
  })
  const selected = samples.find((s) => s.id === selectedId) || null
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'ts-', modalUp: addOpen, searchRef })

  const writeValue = async (id, patch) => {
    const { error } = await onUpdate(id, patch)
    if (error) setMsg(friendlyError(error, '試驗值未寫入'))
  }
  const onDeleteClick = async (s) => {
    if (!(await appConfirm({ title: `刪除試體 ${s.sample_no}？`, danger: true, confirmLabel: '刪除' }))) return
    const { error } = await onDelete(s.id)
    if (error) { setMsg(friendlyError(error, '試體刪除未完成')); return }
    closeDetail() // <lg 抽屜承載的正是這組,刪掉後不留 detailOpen 殘值
  }

  // ── 詳情欄:狀態列 / 編號 / key-value / 試驗值輸入 / 動作列。
  // 輸入格與改版前表格內版完全相同(defaultValue + onBlur 寫入、aria-label 帶編號),
  // 沒有加 canEdit 閘門也是沿用——真正的寫入權在 RLS(DEVELOPMENT.md §4)。
  // key 綁試體 id:換選取時 defaultValue 才會重置,否則會把上一組的值帶到下一組。
  let detailBody = null
  if (selected) {
    const s = selected
    const d7Filled = s.d7_value != null
    const d28Filled = (s.d28_values || []).length > 0
    detailBody = (
      <section aria-label={`${s.sample_no} 詳情`} key={s.id}>
        <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <Badge color={SAMPLE_COLOR[s.status] || 'slate'}>{s.status}</Badge>
          {(isOverdue(s.d7_due, d7Filled) || isOverdue(s.d28_due, d28Filled)) && <Badge color="red">試驗逾期</Badge>}
        </div>

        <div className="p-4">
          <div className="num text-caption text-[var(--text-3)]">{s.test_item || '混凝土抗壓'}</div>
          <div className="mt-0.5 num text-callout font-medium leading-normal text-[var(--text)]">{s.sample_no}</div>
          <MetaGrid className="mt-3.5" rows={[
            ['取樣日', s.sampled_date || '—'],
            ['位置', s.location || '—'],
            ['fc′', s.fc ? `${s.fc} kgf/cm²` : '—'],
            ['試體數', s.cylinders ?? '—'],
            ['7天到期', dueLabel(s.d7_due, d7Filled)],
            ['28天到期', dueLabel(s.d28_due, d28Filled)],
          ]} />
        </div>

        <div className="px-4 pb-4 space-y-3">
          <Field label="7 天參考值 (kgf/cm²)">
            <Input type="number" step="any" inputMode="decimal" defaultValue={s.d7_value ?? ''} placeholder="值"
              aria-label={`${s.sample_no} 7天參考值`} className="num"
              onBlur={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n) && n !== s.d7_value) writeValue(s.id, { d7_value: n }) }} />
          </Field>
          <Field label="28 天各試體 (kgf/cm²)" hint="以逗號分隔,如 445, 432, 428;填入後自動判定">
            <Input defaultValue={(s.d28_values || []).join(', ')} placeholder="如 445, 432, 428"
              aria-label={`${s.sample_no} 28天各試體值`} className="num"
              onBlur={(e) => {
                const arr = e.target.value.split(/[,、\s]+/).map(Number).filter((n) => !isNaN(n) && n > 0)
                if (JSON.stringify(arr) !== JSON.stringify(s.d28_values || [])) writeValue(s.id, { d28_values: arr.length ? arr : null })
              }} />
          </Field>
        </div>

        {/* 已判定試體=品質證據,不提供刪除(DB 另有 guard) */}
        {s.status === '待試驗' && (
          <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2">
            <span className="text-footnote text-[var(--text-3)]">填入 28 天值後依 fc′ 自動判定</span>
            <IconButton name="close" label={`刪除試體 ${s.sample_no}`} onClick={() => onDeleteClick(s)} className="ml-auto -m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" />
          </div>
        )}
      </section>
    )
  }

  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋試體編號或位置…" aria-label="搜尋試體" />
      <div role="group" aria-label="試體狀態篩選" className="flex items-center gap-2 flex-wrap">
        {SAMPLE_STATUSES.map((st) => (
          <StatusChip key={st} active={filters.status === st} count={statusCounts[st]}
            onClick={() => setFilters((f) => ({ ...f, status: f.status === st ? '' : st }))}>
            <Dot color={SAMPLE_COLOR[st]} />{st}
          </StatusChip>
        ))}
        {anyFilter && <Button variant="ghost" size="sm" onClick={() => setFilters({ q: '', status: '' })}>清除篩選</Button>}
      </div>
    </div>
  )

  const listRows = (
    <div role="list" aria-label="試體" className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的試體。<br />換一個狀態,或試試試體編號、位置關鍵字。
        </div>
      ) : ordered.map((s) => {
        const active = s.id === selectedId
        const overdue = isOverdue(s.d7_due, s.d7_value != null) || isOverdue(s.d28_due, (s.d28_values || []).length > 0)
        return (
          <button key={s.id} type="button" role="listitem" id={`ts-${s.id}`}
            aria-current={active || undefined}
            onClick={() => select(s.id, { openPane: true })}
            className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer ${active
              ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
            <span className="flex items-center gap-2 flex-wrap">
              <span className="num text-body text-[var(--text)] min-w-0">{s.sample_no}</span>
              <Badge color={SAMPLE_COLOR[s.status] || 'slate'}>{s.status}</Badge>
              {overdue && <Badge color="red">逾期</Badge>}
            </span>
            <span className="block mt-0.5 num text-caption text-[var(--text-3)] truncate">
              {[s.location, s.sampled_date ? `取樣 ${s.sampled_date}` : '', s.fc ? `fc′ ${s.fc}` : '',
                s.d28_due ? `28天 ${s.d28_due}` : ''].filter(Boolean).join(' · ')}
            </span>
          </button>
        )
      })}
    </div>
  )

  const cardTitle = `取樣試驗（${samples.length}）`
  const cardAction = canEdit && (
    <div className="flex items-center gap-2 flex-wrap">
      <Button variant="secondary" onClick={gen} disabled={busy}><MSym name="bolt" size={14} />從施工日誌帶入</Button>
      <Button variant="secondary" onClick={() => setAddOpen((o) => !o)}>{addOpen ? '取消' : <><MSym name="add" size={16} />手動新增</>}</Button>
    </div>
  )
  // 訊息與手動新增表單住在清單卡頂端:所有視口都看得到
  const cardTop = (<>
    {msg && <p className="text-sm mx-5 mt-4 text-[var(--text-2)]">{msg}</p>}
    {addOpen && (
      <div className="m-5 bg-[var(--surface-2)] rounded-lg p-3 flex flex-wrap items-end gap-3">
        <Field label="取樣(澆置)日"><Input type="date" value={manual.sampled_date} onChange={(e) => setManual({ ...manual, sampled_date: e.target.value })} /></Field>
        <Field label="fc′ (kgf/cm²)"><Input type="number" inputMode="decimal" value={manual.fc} onChange={(e) => setManual({ ...manual, fc: Number(e.target.value) || null })} className="!w-28 text-right num" /></Field>
        <Field label="位置"><Input value={manual.location} onChange={(e) => setManual({ ...manual, location: e.target.value })} className="!w-36" /></Field>
        <Button onClick={addManual} disabled={busy}>建立試體組</Button>
      </div>
    )}
  </>)
  const footnote = <p className="text-caption text-[var(--text-3)] px-5 py-3 border-t border-[var(--border-2)]">28 天判定標準（03310）：任一試體 ≥ 0.85 fc′ 且平均 ≥ fc′；不合格自動開立缺失。到期未試驗會出現在提醒中心。</p>

  if (samples.length === 0) {
    return (
      <Card title={cardTitle} bodyClass="p-0" action={cardAction}>
        {cardTop}
        <Empty>尚無試體。按「從施工日誌帶入」，凡日誌材料含混凝土的澆置日會自動建檔並排 7 / 28 天試驗到期日。</Empty>
        {footnote}
      </Card>
    )
  }

  return (
    <ListDetailLayout
      detail={detailBody}
      detailLabel="試體詳情"
      detailEmpty={<Empty>點左側清單查看試體詳情並填試驗值。</Empty>}
      drawerOpen={detailOpen && !!selected}
      onDrawerClose={closeDetail}>
      <Card title={cardTitle} bodyClass="p-0" action={cardAction}>
        {cardTop}
        {filterBar}
        {listRows}
        {footnote}
      </Card>
    </ListDetailLayout>
  )
}
