// 提醒中心:今日待辦的完整清單(首頁每桶只亮 5 筆,溢位往這裡)。
// 存在理由只有一個——首頁是「球在誰手上」的收件匣,一次一桶、五筆封頂;這裡是同一份
// 聚合(useTodayTasks)的全量視圖,改成以「期限」切:逾期／即將到期／待處理。
// 期限不在這裡算:due/overdueDays 由 lib/todayTasks.js 給,本頁只做分類與呈現。
// 版面走清單／詳情殼(規範 §0 疊合版):列只負責選取,詳情欄放來源單據摘要與「前往」。
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Badge, BallChip, Button, Dot, Empty, PageHeader } from '../../components/ui.jsx'
import { ListDetailLayout, SearchField, StatusChip, MetaGrid } from '../../components/listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { useTodayTasks } from '../../lib/useTodayTasks.js'
import { SOON_DAYS, daysBetween, taipeiISODate } from '../../lib/todayTasks.js'

// 三類快篩:逾期(overdueDays 有值)/即將到期(有到期日且 ≤ SOON_DAYS)/待處理
// (沒有到期日,或到期日還遠的協作項)。門檻沿用聚合的 SOON_DAYS,不另訂一個數字。
const BUCKETS = [
  { key: 'overdue', label: '逾期', color: 'red' },
  { key: 'soon', label: '即將到期', color: 'amber' },
  { key: 'pending', label: '待處理', color: 'slate' },
]
const BUCKET_META = Object.fromEntries(BUCKETS.map((b) => [b.key, b]))
const bucketOf = (t, todayIso) => {
  if (t.overdueDays) return 'overdue'
  const days = t.due ? daysBetween(t.due, todayIso) : null
  return days != null && days <= SOON_DAYS ? 'soon' : 'pending'
}
// setupChecklist.js 有一份同樣三個字的對照但沒有 export;三個字不值得為此開共用檔
const ORG_LABEL = { contractor: '廠商', supervisor: '監造', owner: '機關' }
const DEFAULT_FILTERS = { q: '', bucket: '' }

export default function Alerts() {
  const { currentProject, isSupabaseConfigured, currentUser } = useStore()
  const tasks = useTodayTasks()
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const searchRef = useRef(null)
  const org = currentUser?.org_type || 'contractor'
  const todayIso = taipeiISODate(new Date())

  // 一份清單:輪到我在前、等待對方在後(聚合內各自已依到期日近→遠排好)。
  // id 用聚合的 key(已保證唯一);side 讓列與詳情講得出「球在誰手上」。
  const rows = useMemo(() => [
    ...tasks.mine.map((t) => ({ ...t, id: t.key, side: 'mine', bucket: bucketOf(t, todayIso) })),
    ...tasks.waiting.map((t) => ({ ...t, id: t.key, side: 'waiting', bucket: bucketOf(t, todayIso) })),
  ], [tasks, todayIso])

  // 件數走全體(不受搜尋影響):0 也保留——「沒有逾期」本身就是資訊
  const counts = useMemo(
    () => Object.fromEntries(BUCKETS.map((b) => [b.key, rows.filter((r) => r.bucket === b.key).length])),
    [rows],
  )
  const ordered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return rows
      .filter((r) => !filters.bucket || r.bucket === filters.bucket)
      .filter((r) => !q || [r.title, r.meta, r.tag].some((v) => (v || '').toLowerCase().includes(q)))
  }, [rows, filters])
  const anyFilter = filters.q.trim() !== '' || filters.bucket !== ''

  // 選取/深連結(?alert=)/切案重置/初次自動選取:預設選第一筆(=最急的一筆:輪到我且最逾期)
  const pid = currentProject?.project_id
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'alert', idPrefix: 'alert-',
    scope: `${pid}/${org}`,
    ready: rows.length > 0, rows,
    pickDefault: () => ordered[0]?.id,
    onReset: () => setFilters(DEFAULT_FILTERS),
  })
  const selected = rows.find((r) => r.id === selectedId) || null
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'alert-', searchRef })

  if (isSupabaseConfigured && !currentProject) {
    return (
      <div className="space-y-5">
        <PageHeader title="提醒中心" tagline="逾期與到期的完整清單" />
        <Card title="提醒中心" bodyClass="p-0"><Empty>請先登入並選擇專案。</Empty></Card>
      </div>
    )
  }

  const ballOf = (r) => ({ who: r.ball, label: r.side === 'mine' ? '現在輪到我' : `等待${ORG_LABEL[r.ball] || '對方'}` })

  // ── 詳情欄:狀態列 / 來源單據摘要 / 前往。這裡不重算任何期限——到期日與逾期天數
  // 都是聚合給的;「說明」就是首頁同一句 meta,兩頁講同一句話。
  let detailBody = null
  if (selected) {
    const r = selected
    const b = BUCKET_META[r.bucket]
    const days = r.due ? daysBetween(r.due, todayIso) : null
    detailBody = (
      <section aria-label="提醒詳情">
        <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <Badge color={b.color}>{b.label}</Badge>
          <BallChip ball={ballOf(r)} />
          <Badge color="slate">{r.tag}</Badge>
        </div>
        <div className="p-4">
          <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{r.title}</div>
          <MetaGrid className="mt-3.5" rows={[
            ['來源', r.tag],
            ['球權', r.side === 'mine' ? '現在輪到我' : `等待${ORG_LABEL[r.ball] || '對方'}`],
            ['到期日', r.due || '—'],
            ['剩餘', days == null ? '—' : days < 0 ? `逾期 ${-days} 天` : days === 0 ? '今天到期' : `還有 ${days} 天`],
            ['說明', r.meta || '—'],
          ]} />
        </div>
        {/* 前往=這一頁唯一的動作:提醒本身不能在這裡完成,要到來源單據所在的頁面 */}
        <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
          <Link to={r.to} className="inline-flex rounded-lg">
            <Button tabIndex={-1}>前往處理<MSym name="chevron_right" size={14} /></Button>
          </Link>
        </div>
      </section>
    )
  }

  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋事項、說明、來源…" aria-label="搜尋提醒" />
      <div className="flex items-center gap-2 flex-wrap">
        {BUCKETS.map((b) => (
          <StatusChip key={b.key} active={filters.bucket === b.key} count={counts[b.key]}
            onClick={() => setFilters((f) => ({ ...f, bucket: f.bucket === b.key ? '' : b.key }))}>
            <Dot color={b.color} />{b.label}
          </StatusChip>
        ))}
        {anyFilter && <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>清除篩選</Button>}
      </div>
    </div>
  )

  // ── 清單列:只負責選取,兩行=來源＋事項＋球權 / 說明(含聚合給的到期句)
  const listRows = (
    <div role="list" aria-label="提醒清單" className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的提醒。<br />換一類期限,或試試事項、說明關鍵字。
        </div>
      ) : ordered.map((r) => {
        const active = r.id === selectedId
        return (
          <button key={r.id} type="button" role="listitem" id={`alert-${r.id}`}
            aria-current={active || undefined}
            onClick={() => select(r.id, { openPane: true })}
            className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer ${active
              ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
            <span className="flex items-center gap-2 flex-wrap">
              <Badge color={BUCKET_META[r.bucket].color}>{BUCKET_META[r.bucket].label}</Badge>
              <span className="text-body text-[var(--text)] min-w-0 [text-wrap:pretty]">{r.title}</span>
              <BallChip ball={ballOf(r)} />
            </span>
            <span className="block mt-0.5 num text-caption text-[var(--text-3)] truncate">
              {[r.tag, r.meta].filter(Boolean).join(' · ')}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-5">
      <PageHeader title="提醒中心" tagline="逾期與到期的完整清單"
        subtitle="與首頁「今日待辦」同一份來源:首頁每桶只列前 5 筆,這裡看全部,依逾期／即將到期／待處理切。" />

      {rows.length === 0 ? (
        <Card title="提醒" bodyClass="p-0"><Empty>目前沒有逾期或待處理事項 — 都跟上了。</Empty></Card>
      ) : (
        <ListDetailLayout
          detail={detailBody}
          detailLabel="提醒詳情"
          detailEmpty={<Empty>點左側清單查看提醒的來源與到期日。</Empty>}
          drawerOpen={detailOpen && !!selected}
          onDrawerClose={closeDetail}>
          <Card title={`提醒（${rows.length}）`} bodyClass="p-0">
            {filterBar}
            {listRows}
          </Card>
        </ListDetailLayout>
      )}

      {/* 期限「已提送」鈕在期限追蹤頁,且機關唯讀(鏡像 can_write),所以機關責任的
          期限不會出現在上面——不做誠實說明的話,那些期限會像憑空消失。 */}
      <p className="text-xs text-[var(--text-3)]">
        契約期限的完整時程與責任方在「
        <Link to="/requirements" className="text-[var(--blue-text)] hover:underline">契約重點</Link>
        」；這裡只列你這方現在做得到的事，以及在等對方的事。
      </p>
    </div>
  )
}
