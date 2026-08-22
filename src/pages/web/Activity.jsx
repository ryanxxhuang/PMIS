// 稽核事件只供本頁篩選與分頁，不進全域 Store。查詢保持 project-scoped，
// 若未來第二個頁面需要同一份事件清單，再抽共用函式。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import { Badge, Button, Card, Empty, ErrorBanner, Input, PageHeader, Select, SkeletonList, TablePager } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import {
  AUDIT_ENTITY_LABELS, AUDIT_EVENT_LABELS, auditActorDisplay, auditEntityLabel,
  auditEventLabel, auditEventSubject, normalizeAuditFilters,
} from '../../lib/auditEvents.js'

const EMPTY_FILTERS = { actorUserId: '', eventType: '', entityType: '', dateFrom: '', dateTo: '' }

function formatTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-TW', { hour12: false })
}

export default function Activity() {
  const { currentProject, isPersistedProject } = useStore()
  const [events, setEvents] = useState([])
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  // 原固定 PAGE_SIZE=50 改為可選(TablePager);預設維持 50,既有使用行為不變
  const [pageSize, setPageSize] = useState(50)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

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

  if (!isPersistedProject) {
    return (
      <div className="space-y-5">
        <PageHeader title="專案活動紀錄" tagline="Audit History" subtitle="伺服器產生的持久、不可竄改專案事件" />
        <Card bodyClass="p-0"><Empty>範例模式不建立權威活動紀錄；請在真實專案中查看。</Empty></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title="專案活動紀錄" tagline="Audit History"
        subtitle="狀態變更與執行者專案身分的持久證據紀錄"
        meta={[{ k: '事件數', v: String(total) }]}
        action={<Button variant="outline" onClick={loadEvents} disabled={loading}><MSym name="refresh" size={14} />重新整理</Button>} />

      <Card title="篩選">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
          <Select value={filters.entityType} onChange={(e) => setFilter('entityType', e.target.value)} aria-label="實體類型">
            <option value="">全部實體</option>
            {Object.entries(AUDIT_ENTITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Input type="date" value={filters.dateFrom} onChange={(e) => setFilter('dateFrom', e.target.value)} aria-label="開始日期" />
          <Input type="date" value={filters.dateTo} onChange={(e) => setFilter('dateTo', e.target.value)} aria-label="結束日期" />
        </div>
      </Card>

      {/* 頁碼交給 TablePager 單一真相:卡頭再寫一次「第 N 頁」等於同一狀態兩份來源 */}
      <Card title="活動紀錄" bodyClass="p-0" aria-busy={loading ? 'true' : undefined}>
        {/* 卡片本體是 p-0(清單自帶 px-5),骨架屏與錯誤橫幅得自己補回同一組內距 */}
        {loading ? <div className="px-5 py-3.5"><SkeletonList rows={3} /></div>
          : error ? <div className="p-5"><ErrorBanner msg={error} onRetry={loadEvents} /></div>
          : events.length === 0 ? (
          <Empty>目前沒有符合條件的活動紀錄。</Empty>
        ) : (
          <ul className="divide-y divide-[var(--border-2)]">
            {events.map((event) => (
              <li key={event.id} className="flex items-start gap-3 px-5 py-3.5">
                <span className="w-9 h-9 rounded-lg grid place-items-center bg-[var(--blue-tint)] text-[var(--blue-text)] shrink-0">
                  <MSym name="history" size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text)]">{auditEventLabel(event.event_type)}</span>
                    <Badge>{auditEntityLabel(event.entity_type)}</Badge>
                  </div>
                  <div className="text-sm text-[var(--text-2)] mt-0.5 truncate">{auditEventSubject(event)}</div>
                  <div className="text-xs text-[var(--text-3)] mt-1">
                    {auditActorDisplay(event)} · {formatTime(event.occurred_at)}
                    {event.entity_id && <span className="ml-2 font-mono">{event.entity_id.slice(0, 8)}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {/* 伺服器分頁(range 查詢):只共用 TablePager 皮,頁碼/總數仍由本頁 state 驅動。
            載入中整組鎖住,對應原本兩顆按鈕的 loading disabled 行為 */}
        <TablePager page={page} pageSize={pageSize} total={total} disabled={loading}
          onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }} />
      </Card>

      <p className="text-xs text-[var(--text-3)]">依發生時間由新到舊。</p>
    </div>
  )
}
