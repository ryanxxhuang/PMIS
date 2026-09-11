// 稽核事件只供本頁篩選與分頁，不進全域 Store。查詢保持 project-scoped，
// 若未來第二個頁面需要同一份事件清單，再抽共用函式。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import { Badge, Button, Card, Empty, ErrorBanner, Input, PageHeader, Select, SkeletonList, TablePager } from '../../components/ui.jsx'
import { ListDetailLayout, LIST_DETAIL_GRID, SearchField, StatusChip, MetaGrid } from '../../components/listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { friendlyError } from '../../lib/errorMessage.js'
import { fmtDateTime } from '../../lib/format.js'
import {
  AUDIT_ENTITY_LABELS, AUDIT_EVENT_LABELS, auditActorDisplay, auditEntityLabel,
  auditEventLabel, auditEventSubject, normalizeAuditFilters,
} from '../../lib/auditEvents.js'

// 伺服器端篩選(送進 range 查詢)。q 是頁內關鍵字,不進查詢——伺服器分頁下
// 只搜目前這一頁,搜不到就翻頁或縮小伺服器篩選,清單空狀態會這樣講。
const EMPTY_FILTERS = { actorUserId: '', eventType: '', entityType: '', dateFrom: '', dateTo: '' }

// payload 的 key-value 化:頂層鍵逐列,巢狀物件壓成 JSON 一行。稽核紀錄要看得見
// (規範 §1「每個動作留痕」),但不在這裡解讀欄位語意——各實體自己的頁面才是解讀處。
const flatRows = (obj) => Object.entries(obj || {}).map(([k, v]) => [
  k, v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v),
])

// 活動紀錄的版面:改版前是「篩選卡＋事件卡」直排,每列只擠得下標題與一行摘要,
// 變更前後的內容(稽核的本體)完全看不到。現在是一份事件清單(時間新→舊,實體快篩
// ＋頁內搜尋)＋詳情欄:執行者、時間、變更前後與 metadata 永遠在同一個位置
// (規範 §0 疊合版)。伺服器分頁(TablePager)原樣保留,只是搬進清單卡底。
export default function Activity() {
  const { currentProject, isPersistedProject } = useStore()
  const [events, setEvents] = useState([])
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  // 原固定 PAGE_SIZE=50 改為可選(TablePager);預設維持 50,既有使用行為不變
  const [pageSize, setPageSize] = useState(50)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(0)
  const searchRef = useRef(null)

  const loadEvents = useCallback(async () => {
    if (!isPersistedProject || !currentProject?.project_id || !supabase) return
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    const f = normalizeAuditFilters(filters)
    let query = supabase.from('audit_events').select(
      'id,project_id,actor_user_id,actor_project_party_id,actor_party_type,actor_project_role,actor_is_project_admin,event_type,entity_type,entity_id,action,before_data,after_data,metadata,correlation_id,occurred_at',
      { count: 'exact' },
    ).eq('project_id', currentProject.project_id)
    if (f.actorUserId === 'system') query = query.is('actor_user_id', null)
    else if (f.actorUserId) query = query.eq('actor_user_id', f.actorUserId)
    if (f.eventType) query = query.eq('event_type', f.eventType)
    if (f.entityType) query = query.eq('entity_type', f.entityType)
    if (f.dateFrom) query = query.gte('occurred_at', f.dateFrom)
    if (f.dateToExclusive) query = query.lt('occurred_at', f.dateToExclusive)
    const from = page * pageSize
    const { data, count, error: queryError } = await query
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + pageSize - 1)
    if (requestId !== requestRef.current) return
    if (queryError) {
      setError(friendlyError(queryError, '活動紀錄載入失敗'))
      setEvents([])
      setTotal(0)
    } else {
      setEvents(data || [])
      setTotal(count || 0)
    }
    setLoading(false)
    setLoaded(true)
  }, [currentProject, isPersistedProject, filters, page, pageSize])

  useEffect(() => { loadEvents() }, [loadEvents])
  useEffect(() => { setPage(0) }, [currentProject?.project_id])

  const actors = useMemo(() => {
    const found = new Map()
    for (const event of events) {
      if (event.actor_user_id && !found.has(event.actor_user_id)) {
        found.set(event.actor_user_id, auditActorDisplay(event))
      }
    }
    return [...found.entries()]
  }, [events])

  const setFilter = (key, value) => {
    setPage(0)
    setFilters((current) => ({ ...current, [key]: value }))
  }

  // 目前畫面上的清單:這一頁的事件 AND 頁內關鍵字(事件/實體/主旨/執行者/實體 ID)。
  // 順序沿用查詢(occurred_at 新→舊),不另外排序。
  const ordered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return events
    return events.filter((e) => [
      auditEventLabel(e.event_type), auditEntityLabel(e.entity_type), auditEventSubject(e),
      auditActorDisplay(e), e.entity_id, e.event_type,
    ].some((v) => (v || '').toLowerCase().includes(kw)))
  }, [events, q])
  const anyFilter = q.trim() !== '' || Object.values(filters).some((v) => v !== '')

  // 選取/深連結(?event=)/切案重置/初次自動選取:共用殼 hook,預設選最新一筆。
  // 翻頁或改伺服器篩選後選中項不在這一頁:右欄回到空狀態(事件本身沒被載入,
  // 沒有內容可保留),清單中也沒有高亮列。
  const pid = currentProject?.project_id
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'event', idPrefix: 'evt-',
    scope: `${pid}`,
    ready: loaded && !loading && events.length > 0, rows: events,
    pickDefault: () => ordered[0]?.id,
    onReset: () => { setFilters(EMPTY_FILTERS); setQ(''); setPage(0) },
  })
  const selected = events.find((e) => e.id === selectedId) || null
  // 鍵盤:↑/↓ 移動選取、/ 聚焦搜尋(頁面沒有 modal,不必停用)
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'evt-', searchRef })

  if (!isPersistedProject) {
    return (
      <div className="space-y-5">
        <PageHeader title="專案活動紀錄" tagline="Audit History" subtitle="伺服器產生的持久、不可竄改專案事件" />
        <Card bodyClass="p-0"><Empty>範例模式不建立權威活動紀錄；請在真實專案中查看。</Empty></Card>
      </div>
    )
  }

  // 寫成同一行的 `const header = <PageHeader`:pageTabs.earlyReturn.test 靠這個字面辨認頁首變數
  const header = <PageHeader title="專案活動紀錄" tagline="Audit History"
      subtitle="狀態變更與執行者專案身分的持久證據紀錄"
      meta={[{ k: '事件數', v: String(total) }]}
      action={<Button variant="outline" onClick={loadEvents} disabled={loading}><MSym name="refresh" size={14} />重新整理</Button>} />

  // ── 詳情欄:狀態列 / 主旨 / key-value / 變更前後 / metadata。
  // 稽核事件唯讀(伺服器 trigger 產生,無寫入 API),所以沒有動作列。
  let detailBody = null
  if (selected) {
    const e = selected
    const before = flatRows(e.before_data)
    const after = flatRows(e.after_data)
    const meta = flatRows(e.metadata)
    // region 以事件名命名:報讀器走地標時直接聽到「估驗核定 詳情」
    detailBody = (
      <section aria-label={`${auditEventLabel(e.event_type)} 詳情`}>
        {/* 狀態列:實體＋動作;顏色＋文字並存 */}
        <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <Badge>{auditEntityLabel(e.entity_type)}</Badge>
          {e.action && <Badge color="slate"><span className="font-mono">{e.action}</span></Badge>}
        </div>

        <div className="p-4">
          <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{auditEventLabel(e.event_type)}</div>
          <div className="mt-0.5 text-body text-[var(--text-2)] break-words">{auditEventSubject(e)}</div>
          {/* 空值一律顯示 —:六格固定,眼睛掃同一位置就知道有沒有填。
              ID 類值 break-all:UUID 沒有可斷字的空白,不斷會撐破 400px 欄 */}
          <MetaGrid className="mt-3.5 [&_.num]:break-all" rows={[
            ['執行者', auditActorDisplay(e)],
            ['時間', fmtDateTime(e.occurred_at)],
            ['事件', e.event_type || '—'],
            ['實體 ID', e.entity_id || '—'],
            ['關聯 ID', e.correlation_id || '—'],
            ['執行者 ID', e.actor_user_id || '—'],
          ]} />
        </div>

        {/* 變更前後:稽核的本體。空的那一側不畫(建立事件沒有「變更前」,刪除沒有「變更後」) */}
        {[['變更前', 'history', before], ['變更後', 'check_circle', after], ['其他資訊', 'info', meta]]
          .filter(([, , rows]) => rows.length > 0)
          .map(([title, icon, rows]) => (
            <div key={title} className="px-4 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <MSym name={icon} size={15} className="text-[var(--text-3)]" />
                <span className="text-footnote font-medium text-[var(--text)]">{title}</span>
              </div>
              <MetaGrid className="bg-[var(--surface-2)] rounded-lg px-3 py-2 [&_.num]:break-all" rows={rows} />
            </div>
          ))}
      </section>
    )
  }

  // ── 卡頭下方:頁內搜尋 + 實體快篩(伺服器篩選,件數是伺服器分頁後的數,不標)
  // + 執行者/事件/日期(維持原有伺服器篩選,一個都沒少)。
  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="搜尋本頁事件、主旨、執行者…" aria-label="搜尋活動紀錄" />
      <div className="flex items-center gap-2 flex-wrap">
        {Object.entries(AUDIT_ENTITY_LABELS).map(([value, label]) => (
          <StatusChip key={value} active={filters.entityType === value}
            onClick={() => setFilter('entityType', filters.entityType === value ? '' : value)}>
            {label}
          </StatusChip>
        ))}
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => { setFilters(EMPTY_FILTERS); setQ(''); setPage(0) }}>清除篩選</Button>
        )}
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">
        <div>
          <Input list="activity-actors" value={filters.actorUserId}
            onChange={(e) => setFilter('actorUserId', e.target.value)}
            placeholder="篩選執行者（點選下方清單）" aria-label="執行者" />
          <datalist id="activity-actors">
            <option value="system">系統</option>
            {actors.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </datalist>
        </div>
        <Select value={filters.eventType} onChange={(e) => setFilter('eventType', e.target.value)} aria-label="事件類型">
          <option value="">全部事件</option>
          {Object.entries(AUDIT_EVENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Input type="date" value={filters.dateFrom} onChange={(e) => setFilter('dateFrom', e.target.value)} aria-label="開始日期" />
        <Input type="date" value={filters.dateTo} onChange={(e) => setFilter('dateTo', e.target.value)} aria-label="結束日期" />
      </div>
    </div>
  )

  // ── 清單列:只負責選取(事件唯讀,詳情欄也沒有動作),三行=事件＋實體 / 主旨 / 執行者·時間。
  // 真正的 <ul>/<li>(role="list" 要明寫:Tailwind preflight 的 list-style:none 會讓
  // Safari 拿掉清單語意);aria-current 與其他殼頁同一套選取語意。
  const listRows = (
    <ul role="list" aria-label="活動紀錄" className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <li className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          {events.length === 0
            ? <>目前沒有符合條件的活動紀錄。<br />放寬實體、事件或日期篩選;簽核動作發生後事件會自動出現。</>
            : <>本頁沒有符合關鍵字的事件。<br />翻到其他頁,或改用上方實體、事件、日期篩選讓伺服器找。</>}
        </li>
      ) : ordered.map((e) => {
        const active = e.id === selectedId
        return (
          <li key={e.id}>
            <button type="button" id={`evt-${e.id}`}
              aria-current={active || undefined}
              onClick={() => select(e.id, { openPane: true })}
              className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer ${active
                ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
              <span className="flex items-center gap-2 flex-wrap">
                <span className="text-body font-medium text-[var(--text)] min-w-0 [text-wrap:pretty]">{auditEventLabel(e.event_type)}</span>
                <Badge>{auditEntityLabel(e.entity_type)}</Badge>
              </span>
              <span className="block mt-0.5 text-footnote text-[var(--text-2)] truncate">{auditEventSubject(e)}</span>
              <span className="block mt-0.5 num text-caption text-[var(--text-3)] truncate">
                {auditActorDisplay(e)} · {fmtDateTime(e.occurred_at)}
                {e.entity_id && <span className="ml-2 font-mono">{e.entity_id.slice(0, 8)}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )

  // ── 版面分支:首次載入的骨架與正式版面共用同一組欄寬(載入完成不位移);
  // 之後的重新載入(翻頁/改篩選)只在清單卡上標 aria-busy,不整片換骨架。
  if (!loaded) {
    return (
      <div className="space-y-5">
        {header}
        <div className={LIST_DETAIL_GRID}>
          <Card title="活動紀錄" aria-busy="true"><SkeletonList rows={3} label="正在載入活動紀錄…" /></Card>
          <Card className="hidden lg:block"><SkeletonList rows={3} label="" /></Card>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {header}

      <ListDetailLayout
        detail={detailBody}
        detailLabel="活動詳情"
        detailEmpty={<Empty>點左側清單查看事件的執行者、時間與變更內容。</Empty>}
        drawerOpen={detailOpen && !!selected}
        onDrawerClose={closeDetail}>
        {/* ── 左欄:一份清單(右欄與抽屜由殼統一,見 components/listDetail.jsx)。
            頁碼交給 TablePager 單一真相:卡頭不再寫一次「第 N 頁」 */}
        <Card title="活動紀錄" bodyClass="p-0" aria-busy={loading ? 'true' : undefined}>
          {filterBar}
          {error
            ? <div className="p-5"><ErrorBanner msg={error} onRetry={loadEvents} /></div>
            : listRows}
          {/* 伺服器分頁(range 查詢):只共用 TablePager 皮,頁碼/總數仍由本頁 state 驅動。
              載入中整組鎖住,對應原本兩顆按鈕的 loading disabled 行為 */}
          <TablePager page={page} pageSize={pageSize} total={total} disabled={loading}
            onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }} />
        </Card>
      </ListDetailLayout>

      <p className="text-xs text-[var(--text-3)]">依發生時間由新到舊。</p>
    </div>
  )
}
