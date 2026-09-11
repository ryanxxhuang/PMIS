// 觀察事項分段:輕量現場提醒(比缺失輕)→ 標記已處理 或 升級為缺失。
// 清單＋狀態快篩＋搜尋,說明全文、標註圖與動作在詳情欄(規範 §8 IA 殼)。改版前
// description 被 truncate 只能 hover title 看全文——這是一筆觀察唯一的內容本體,
// 詳情欄完整顯示。升級為缺失沿用 store 的 escalateObservation(缺失建立失敗即中止)。
import { useMemo, useRef, useState } from 'react'
import { MSym } from '../icons.jsx'
import { Card, Button, Field, Badge, Dot, Empty, ErrorBanner, Input, Textarea } from '../ui.jsx'
import { ListDetailLayout, SearchField, StatusChip, MetaGrid } from '../listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../confirm.jsx'
import MarkupEditor, { MarkupThumb } from '../MarkupEditor.jsx'

const OBS_STATUSES = ['待處理', '已處理', '轉缺失']
const OBS_STATUS_COLOR = { 待處理: 'amber', 已處理: 'green', 轉缺失: 'slate' }
const ASSIGNEE_LABEL = { contractor: '施工廠商', supervisor: '監造', owner: '機關' }

export default function ObservationsSection({ observations, canWrite, onCreate, onUpdate, onEscalate, onDelete, resolveMarkup, scope = '' }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [markupOpen, setMarkupOpen] = useState(false)
  const [filters, setFilters] = useState({ q: '', status: '' })
  const searchRef = useRef(null)

  // 寫入失敗如實回報(B-07):失敗時表單不關、清單不動
  const run = async (label, fn) => {
    setErr(''); setBusy(true)
    const { error } = (await fn()) || {}
    setBusy(false)
    if (error) { setErr(friendlyError(error, `${label}未完成`)); return false }
    return true
  }
  const submit = async () => { if (await run('新增觀察', () => onCreate(form))) setForm(null) }

  const statusCounts = useMemo(
    () => Object.fromEntries(OBS_STATUSES.map((s) => [s, observations.filter((o) => o.status === s).length])),
    [observations],
  )
  // 狀態 AND 關鍵字(主旨/位置/說明);順序沿用 store(新增的插在最前)
  const ordered = useMemo(() => {
    const kw = filters.q.trim().toLowerCase()
    return observations
      .filter((o) => !filters.status || o.status === filters.status)
      .filter((o) => !kw || [o.title, o.location, o.description].some((v) => (v || '').toLowerCase().includes(kw)))
  }, [observations, filters])
  const anyFilter = filters.q.trim() !== '' || filters.status !== ''

  // 預設選第一筆「待處理」(有動作可做的),沒有就選清單第一筆
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'observation', idPrefix: 'obs-', scope,
    ready: observations.length > 0, rows: observations,
    pickDefault: () => (ordered.find((o) => o.status === '待處理') || ordered[0])?.id,
    onSelect: () => setErr(''),
    onReset: () => setFilters({ q: '', status: '' }),
  })
  const selected = observations.find((o) => o.id === selectedId) || null
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'obs-', modalUp: !!form || markupOpen, searchRef })

  const onDeleteClick = async (o) => {
    if (!(await appConfirm({ title: '刪除此觀察？', danger: true, confirmLabel: '刪除' }))) return
    if (await run('刪除觀察', () => onDelete(o.id))) closeDetail()
  }
  // 升級=建立正式缺失單,不可逆 → 保留確認框(規範 §1 第 5 題)
  const onEscalateClick = async (o) => {
    if (!(await appConfirm({ title: '升級為正式缺失？', body: '將自動開立缺失單追蹤改善。', confirmLabel: '升級' }))) return
    run('升級為缺失', () => onEscalate(o))
  }

  // ── 詳情欄:動作條件與改版前列內版完全相同——canWrite 且非轉缺失才有動作列,
  // 待處理才有「標記已處理／升級為缺失」,刪除鈕對待處理與已處理都給。
  let detailBody = null
  if (selected) {
    const o = selected
    const actionable = canWrite && o.status !== '轉缺失'
    detailBody = (
      <section aria-label={`${o.title} 詳情`}>
        <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <Badge color={OBS_STATUS_COLOR[o.status] || 'slate'}>{o.status}</Badge>
        </div>

        <div className="p-4">
          <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{o.title}</div>
          <MetaGrid className="mt-3.5" rows={[
            ['位置', o.location || '—'],
            ['提醒對象', ASSIGNEE_LABEL[o.assigned_to] || o.assigned_to || '—'],
            ['工項', o.work_item_no || '—'],
          ]} />
        </div>

        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <MSym name="visibility" size={15} className="text-[var(--text-3)]" />
            <span className="text-footnote font-medium text-[var(--text)]">觀察說明</span>
          </div>
          <p className="text-body leading-[1.8] text-[var(--text)] whitespace-pre-line break-words">{o.description || '（未填寫）'}</p>
          {o.markup_path && <div className="mt-2.5"><MarkupThumb src={o.markup_path} resolve={resolveMarkup} /></div>}
        </div>

        {actionable && (
          <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
            {o.status === '待處理' && (<>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => run('標記已處理', () => onUpdate(o.id, { status: '已處理' }))}>標記已處理</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onEscalateClick(o)}>升級為缺失</Button>
            </>)}
            <button disabled={busy} onClick={() => onDeleteClick(o)} aria-label={`刪除觀察 ${o.title}`}
              className="ml-auto inline-flex items-center justify-center p-2 -m-2 max-md:min-h-11 text-[var(--text-3)] hover:text-[var(--red-text)]"><MSym name="close" size={16} /></button>
          </div>
        )}
      </section>
    )
  }

  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋觀察主旨、位置或說明…" aria-label="搜尋觀察事項" />
      <div role="group" aria-label="觀察狀態篩選" className="flex items-center gap-2 flex-wrap">
        {OBS_STATUSES.map((st) => (
          <StatusChip key={st} active={filters.status === st} count={statusCounts[st]}
            onClick={() => setFilters((f) => ({ ...f, status: f.status === st ? '' : st }))}>
            <Dot color={OBS_STATUS_COLOR[st]} />{st}
          </StatusChip>
        ))}
        {anyFilter && <Button variant="ghost" size="sm" onClick={() => setFilters({ q: '', status: '' })}>清除篩選</Button>}
      </div>
    </div>
  )

  const listRows = (
    <div role="list" aria-label="觀察事項" className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的觀察事項。<br />換一個狀態,或試試主旨、位置關鍵字。
        </div>
      ) : ordered.map((o) => {
        const active = o.id === selectedId
        return (
          <button key={o.id} type="button" role="listitem" id={`obs-${o.id}`}
            aria-current={active || undefined}
            onClick={() => select(o.id, { openPane: true })}
            className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer ${active
              ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
            <span className="flex items-center gap-2 flex-wrap">
              <span className="text-body text-[var(--text)] min-w-0 [text-wrap:pretty]">{o.title}</span>
              <Badge color={OBS_STATUS_COLOR[o.status] || 'slate'}>{o.status}</Badge>
              {o.markup_path && <Badge color="slate">有標註</Badge>}
            </span>
            <span className="block mt-0.5 text-caption text-[var(--text-3)] truncate">
              {[o.location, o.description].filter(Boolean).join(' · ')}
            </span>
          </button>
        )
      })}
    </div>
  )

  // 卡頭不再重複「待處理 N」:件數在快篩 chip 上,同一個數字不寫兩次
  const cardTitle = `觀察事項（${observations.length}）`
  const cardAction = canWrite && (
    <Button variant="secondary" onClick={() => setForm(form ? null : { title: '', description: '', location: '', assigned_to: 'contractor' })}>
      {form ? '取消' : <><MSym name="add" size={16} />新增觀察</>}
    </Button>
  )
  const cardTop = (<>
    {form && (
      <div className="m-5 bg-[var(--surface-2)] rounded-lg p-4 space-y-3">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="觀察主旨"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 4F 東側樓梯開口未設護欄" /></Field>
          <Field label="位置"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="如 4F 東側" /></Field>
        </div>
        <Field label="說明"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="現場觀察到、提醒改善的事項（尚未到開立缺失的程度）" /></Field>
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={submit} disabled={busy || !form.title}>新增觀察</Button>
          <Button variant="secondary" onClick={() => setMarkupOpen(true)}><MSym name="draw" size={16} />圖面/照片標註{form.markup_data ? '（已附）' : ''}</Button>
          {form.markup_data && <MarkupThumb src={form.markup_data} />}
        </div>
        {markupOpen && <MarkupEditor title="把觀察位置匡起來" initialImage={form.markup_data}
          onSave={(d) => { setForm((f) => ({ ...f, markup_data: d })); setMarkupOpen(false) }} onClose={() => setMarkupOpen(false)} />}
      </div>
    )}
    {/* 區塊層錯誤統一走 ErrorBanner,不再自寫紅字段落 */}
    <ErrorBanner msg={err} onClose={() => setErr('')} className="mx-5 mt-4" />
  </>)
  const footnote = <p className="text-caption text-[var(--text-3)] px-5 py-3 border-t border-[var(--border-2)]">觀察事項是比缺失輕的提醒（現場口頭提醒的數位化）：可標記已處理，或在必要時一鍵升級為正式缺失單（進入改善→複查→結案流程）。</p>

  if (observations.length === 0) {
    return (
      <Card title={cardTitle} bodyClass="p-0" action={cardAction}>
        {cardTop}
        <Empty>尚無觀察事項。現場看到「不對但還沒到缺失」的狀況先記為觀察，處理掉或必要時一鍵升級為缺失。</Empty>
        {footnote}
      </Card>
    )
  }

  return (
    <ListDetailLayout
      detail={detailBody}
      detailLabel="觀察詳情"
      detailEmpty={<Empty>點左側清單查看觀察說明與處理動作。</Empty>}
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
