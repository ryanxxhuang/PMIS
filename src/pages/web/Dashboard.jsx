import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useMemo, useState, useEffect, useRef } from 'react'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import { Badge, Button, Card, Empty, PageHeader, Segmented, Select } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { plannedPctNow } from '../../lib/progressPlan.js'
import { latestValuationAt } from '../../lib/progressAsOf.js'
import { taipeiISODate } from '../../lib/dates.js'
import { useTodayTasks } from '../../lib/useTodayTasks.js'
import { BALL_SOURCES, BALL_SOURCES_TITLE, resolveBallKey, ROLE_WORK, navLabel } from '../../lib/navConfig.js'
import { KIND_LABEL } from '../../lib/agentRole.js'
import { buildInsights, insightsForRole } from '../../lib/aiInsights.js'
import { buildSetupSteps } from '../../lib/setupChecklist.js'
import InsightsPanel from '../../components/InsightsPanel.jsx'
import TaskRow from '../../components/TaskRow.jsx'
import { CommonWork } from '../../components/WorkNavigation.jsx'
import { SearchField, StatusChip } from '../../components/listDetail.jsx'
import { appSnackbar } from '../../components/snackbar.jsx'

function SetupChecklist({ imported }) {
  const { listMembers, currentProject, obligations, can } = useStore()
  const [snap, setSnap] = useState(null)
  const pid = currentProject?.project_id
  useEffect(() => {
    if (!pid) return
    let active = true
    ;(async () => {
      const [members, docsRes, ingRes] = await Promise.all([
        listMembers().catch(() => ({ rows: [], error: '成員載入失敗' })),
        supabase.from('documents').select('id', { count: 'exact', head: true }).eq('project_id', pid),
        // 第 3 步的唯一依據:本案有沒有跑完過一次履約要求擷取
        supabase.from('document_ingestion_runs').select('id', { count: 'exact', head: true })
          .eq('project_id', pid).eq('status', 'completed'),
      ])
      if (!active) return
      setSnap({
        orgs: new Set((members?.rows || []).map((m) => m.org_type).filter(Boolean)),
        membersError: members?.error || null, // W4-1:載入失敗要說失敗,不能假裝「尚缺三方」
        docs: docsRes?.count || 0,
        docsError: docsRes?.error || null,
        ingestionCompleted: ingRes?.count || 0,
        ingestionError: ingRes?.error || null,
      })
    })()
    return () => { active = false }
  }, [pid, imported, listMembers]) // 標單匯入後重推導(文件數會變)

  // 開工日步驟的素材:等待開工日的義務數只算還沒完成的(已提送/已完成不催)
  const waitingOnCommencement = useMemo(
    () => obligations.filter((ob) => ob.trigger_event === 'commencement'
      && ob.status !== '已提送' && ob.status !== '已完成').length,
    [obligations],
  )
  const steps = buildSetupSteps(snap, {
    imported,
    commencement: currentProject?.commencement_date || null,
    waitingOnCommencement,
  })
  const doneCount = steps.filter((s) => s.done).length
  // 下一步 = 前 4 步第一個未完成;都完成就指向第 5 步(開啟正式模式)
  const next = steps.slice(0, 4).find((s) => !s.done) || steps[4]

  return (
    <Card title="專案初始化" action={<span className="num text-xs text-[var(--text-3)]">已完成 {doneCount}/5</span>}>
      {/* 一般成員不被要求越權設定(UIUX 階段 2 U05):清單仍可看(知道案子準備到哪),
          但明說由誰完成、自己該做什麼;can.admin 只是 UX,伺服器仍由 is_project_admin() 把關 */}
      {!can?.admin && (
        <p className="text-footnote text-[var(--text-2)] mb-3">初始化由專案管理者完成，你不需要執行這些設定；輪到你的事項列在下方，可直接處理。</p>
      )}
      <Link to={next.to}
        className="flex items-center gap-2 rounded-lg bg-[var(--blue-tint)] text-[var(--blue-text)] px-3 py-2 mb-3 text-sm font-medium hover:bg-[var(--g-search-h)] transition-colors">
        <span className="min-w-0 flex-1">下一步：{next.label}</span>
        <MSym name="chevron_right" size={15} className="shrink-0" />
      </Link>
      <ol className="divide-y divide-[var(--border-2)]">
        {steps.map((s, i) => (
          <li key={i}>
            <Link to={s.to} className="flex items-start gap-3 py-2.5 group">
              {s.done
                ? <MSym name="check_circle" size={18} className="text-[var(--green-text)] shrink-0 mt-0.5" />
                : <MSym name="radio_button_unchecked" size={18} className="text-[var(--text-3)] shrink-0 mt-0.5" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-sm ${s.done ? 'text-[var(--text-3)] line-through' : 'text-[var(--text)] font-medium'}`}>{i + 1}. {s.label}</span>
                  <span className="text-caption text-[var(--text-3)]">{s.owner}</span>
                </div>
                <div className="text-xs text-[var(--text-3)] mt-0.5 leading-snug">{s.detail}</div>
              </div>
              <MSym name="chevron_right" size={15} className="text-[var(--text-3)] group-hover:text-[var(--text-2)] shrink-0 mt-0.5" />
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  )
}

export default function Dashboard() {
  const { project, currentUser, workItems, workItemsSource, demoMode, isPersistedProject, valuations, progressPlan, inspections, defects, siteLogs,
    obligations, costItems, safetyRecords, changeOrders, itemSchedules,
    adjustedItems, revisedTotal, aiEnabled,
    checklistTemplates, checklistRecords, testSamples, submittals, rfis, observations, acceptanceEvents } = useStore()
  const navigate = useNavigate()
  const imported = workItemsSource === 'db' || demoMode
  // 「今天」每次 render 取:工地平板整週不關分頁,模組層常數會讓日期/逾期判斷停在開頁那天(B-11)
  const TODAY = new Date()
  const todayISO = taipeiISODate(TODAY)
  const myOrg = currentUser?.org_type || 'contractor'
  const anchors = {
    award_date: project?.award_date, notice_date: project?.notice_date,
    commencement_date: project?.commencement_date, end_date: project?.end_date,
  }
  // 今日工作的唯一來源(W8-2B):協作項＋期限型全部在 todayTasks 聚合。
  // 改吃 useTodayTasks 這支「唯一」hook(側欄 badge 與提醒中心同源)——
  // 首頁再自己組一次 buildTodayTasks,件數遲早跟側欄分岔。
  const tasks = useTodayTasks()
  // 球權聚焦(Apple 改版第二包,疊合版 IA §0):主畫面不是 dashboard,是收件匣。
  // 側欄「球在誰手上」選哪個來源,這裡就只渲染那一組(mine/waiting/doneToday 1:1
  // 對上 BALL_SOURCES),處理完就消失;?ball= 的解析與側欄選取態同一支(navConfig)。
  const [searchParams] = useSearchParams()
  const ball = resolveBallKey(searchParams)
  const sourceTo = (key) => BALL_SOURCES.find((b) => b.key === key).to

  // 整案資料匯出:所有模組打包成一個 JSON 檔——資料是使用者的,隨時拿得走
  const exportAll = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      project, work_items: workItems, valuations, progress_plan: progressPlan,
      site_logs: siteLogs, inspections, defects, obligations,
      cost_items: costItems, safety_records: safetyRecords, change_orders: changeOrders,
      item_schedules: itemSchedules, checklist_templates: checklistTemplates,
      checklist_records: checklistRecords, test_samples: testSamples,
      submittals, rfis, observations, acceptance_events: acceptanceEvents,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `GovAgent匯出_${project.project_name}_${todayISO}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    // 瀏覽器下載沒有可見回饋:不吭一聲會讓人以為按鈕壞了,連按好幾次
    appSnackbar('已匯出整案資料（JSON）')
  }

  // 財務單一真相層(B-02):完成率/金額一律以「已核准變更套回後」計算,與估驗/進度頁一致。
  // 四張指標卡(累計進度/發包工程費/累計估驗/剩餘工期)已自主畫面退場(判準 2:
  // 不會被點、不改變決定的數字一律刪;金額在估驗/標單頁、工期在契約重點頁都追得到來源)。
  // completion/plannedNow 留下來只因為風險警示引擎(buildInsights)拿它們判「進度落後」,
  // 不再當裝飾數字渲染;剩餘工期(remainDays)沒有下游,連同計算一起清掉。
  const { roots, childrenMap } = useMemo(
    () => (workItems ? buildBillableTree(adjustedItems) : { roots: [], childrenMap: new Map() }),
    [workItems, adjustedItems],
  )
  const billableTotal = workItems ? revisedTotal : 0
  const latestVal = latestValuationAt(valuations, TODAY) // 截至今天、狀態不論(D-024)
  const actualCum = useMemo(
    () => (latestVal ? totalCumAmount(roots, buildCumMap(roots, childrenMap, latestVal)) : 0),
    [roots, childrenMap, latestVal],
  )
  const completion = billableTotal ? (actualCum / billableTotal) * 100 : 0

  const plannedNow = plannedPctNow(progressPlan, TODAY)

  // AI 主動觀察(§9-8:從 AI 助理搬來——Dashboard=待辦+風險,助理只留問答)
  const insights = useMemo(() => insightsForRole(buildInsights({
    progress: { actualPct: completion, plannedPct: plannedNow }, siteLogs, defects, testSamples,
    obligations, valuations, changeOrders, anchors,
  }, TODAY), myOrg), [completion, plannedNow, siteLogs, defects, testSamples, obligations, valuations, changeOrders, myOrg, todayISO]) // eslint-disable-line react-hooks/exhaustive-deps

  // 球權聚焦的清單:三組共用 TaskSection,只差來源、文案與空狀態的指路。
  // 空狀態不說「沒有資料」(規範 §6):說球不在誰手上、要去哪裡看——mine 空了指向
  // 等對方,waiting/done 空了指回待我處理;件數為 0 就不掛數字,免得寫出「看 0 件」。
  const withCount = (label, n) => (n ? `${label}（${n} 件）` : label)
  const focus = ball === 'waiting' ? (
    <TaskSection title="等待對方" items={tasks.waiting}
      emptyTitle="沒有在等任何人" empty="目前沒有送出去等其他單位回覆的事項。"
      emptyTo={{ to: sourceTo('mine'), label: withCount('回到待我處理', tasks.mine.length) }} />
  ) : ball === 'done' ? (
    <TaskSection title="今天已完成" items={tasks.doneToday} done
      emptyTitle="今天還沒有完成紀錄" empty="今天你這方還沒有缺失結案或查驗判定的紀錄。"
      emptyTo={{ to: sourceTo('mine'), label: withCount('去看待我處理', tasks.mine.length) }} />
  ) : (
    // 真人驗收(2026-08-19):什麼都還沒上傳的專案也說「都跟上了」會誤導。
    // store 沒有文件清單、不為此加查詢,退而求其次用「義務為空」當代理條件:
    // 義務由契約解析而來,義務空=多半連契約都還沒整理,補一句指路即可
    <TaskSection title="現在輪到我" items={tasks.mine}
      emptyTitle="球不在你手上" empty="目前沒有輪到你處理的事項；有人把球交回來時，它會出現在這裡。"
      hint={obligations.length === 0 ? '上傳契約後，AI 會整理期限並在此提醒。' : null}
      emptyTo={{ to: sourceTo('waiting'), label: withCount('看等對方', tasks.waiting.length) }} />
  )
  // 待補設定(P5a):責任方推不出三方、或基準日沒填而推不出到期日的事項。系統無法判斷球在誰
  // 手上,所以不進任何一方的「現在輪到我」,也不算件數;三方都看得到同一份,每筆導到能補的
  // 地方(契約重點該筆／期限追蹤的基準日)。Agent 工具與早報列的是同一份規則的同一組事項。
  const setupSection = ball === 'mine' && tasks.setup.length > 0 && (
    <Card title="待補設定" action={<Badge color="slate" className="num">{tasks.setup.length}</Badge>} bodyClass="p-0">
      <p className="px-4 pt-3 text-footnote text-[var(--text-3)]">責任方或基準日尚未設定，系統無法判斷球在誰手上；三方都看得到這份清單，補齊後事項會回到對應的人。</p>
      <ul role="list" aria-label="待補設定清單" className="divide-y divide-[var(--border-2)]">
        {tasks.setup.map((x) => <li key={x.key}><TaskRow task={x} /></li>)}
      </ul>
    </Card>
  )

  return (
    <div className="space-y-5">
      {/* 頁名=側欄分區名 BALL_SOURCES_TITLE(今日工作):同一頁只有一個名字,h1、側欄、
          返回連結(taskReturn)、各頁指路文案都吃 navConfig 這一份——先前 h1 叫「今日工作」、
          側欄叫「今日工作」,同一個地方兩個名字違反 wayfinding(P1c 移交、P1b 統一)。
          三個球權桶改用 Segmented 露在頁首下方——側欄的來源是落地點,頁內的分段控制讓人
          不必回側欄就能切,兩者選取態同一份 ?ball=。 */}
      <PageHeader
        title={BALL_SOURCES_TITLE}
        tagline={project.project_name}
        subtitle={`${ROLE_WORK[myOrg].label}工作清單 · ${ROLE_WORK[myOrg].summary}`}
        meta={[
          { k: '工程代碼', v: project.project_code || '—' },
          { k: '日期', v: todayISO },
        ]}
      />

      <CommonWork />

      <Segmented
        aria-label="球在誰手上"
        value={ball}
        onChange={(key) => navigate(sourceTo(key))}
        options={BALL_SOURCES.map((b) => ({
          value: b.key,
          label: b.label,
          count: b.key === 'mine' ? tasks.mine.length
            : b.key === 'waiting' ? tasks.waiting.length : tasks.doneToday.length,
        }))}
      />

      {workItemsSource === 'error' ? (
        <Card>
          <Empty>標單工項讀取失敗，資料暫時無法顯示。請用上方紅色橫幅的「重試」重新載入。</Empty>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* 初始化清單、風險警示、AI 今日已代辦只跟著「待我處理」走:它們是「現在該做
              什麼」的脈絡,不是「等對方」或「已完成」的脈絡。單欄直排:收件匣就是一條清單。
              三方常用入口在頁首，主體保留工作清單而不加頁面摘要卡。
              未匯標單(UIUX 階段 2 U05):初始化是「有責任人的準備事項」,與已可執行的待辦並存——
              送審/疑義/履約期限不靠標單就能做,不能被整頁的初始化取代;真正依賴標單的頁
              (估驗、進度、品質查驗)仍由各頁自己揭露前置條件。 */}
          {ball === 'mine' && !imported && (
            isPersistedProject ? <SetupChecklist imported={false} /> : (
              <Card>
                <Empty>
                  此專案尚未匯入標單。請到「<Link to="/contract" className="text-[var(--blue-text)] hover:underline">{navLabel('/contract')}</Link>」把標單 XML 與契約等文件一次上傳，
                  之後估驗、進度、施工日誌、品質查驗才會有資料。
                </Empty>
              </Card>
            )
          )}
          {ball === 'mine' && imported && isPersistedProject && !project.formal_mode && <SetupChecklist imported />}

          {/* 狀態全部由既有業務流程更新——在目的頁做完事就自動退出,
              不需要回這裡打勾;這裡也永遠不會出現 AI 自己產生的工作。 */}
          <div key={ball}>{focus}</div>
          {setupSection}

          {/* 風險警示與 AI 代辦以標單/進度為素材,沒有標單就沒有可靠依據,不畫 */}
          {ball === 'mine' && imported && (
            <>
              {/* AI 主動觀察:風險警示卡,不是待辦(AI 不得替人產生人工工作) */}
              <InsightsPanel insights={insights} />
              {/* AI 今日已代辦:agent 今天替你做掉了什麼 */}
              <AgentDoneCard />
            </>
          )}
        </div>
      )}

      {imported && <details className="text-footnote text-[var(--text-3)] print:hidden">
        <summary className="cursor-pointer min-h-11 inline-flex items-center gap-1">專案資料工具<MSym name="expand_more" size={14} /></summary>
        <div className="mt-2"><Button variant="outline" size="sm" onClick={exportAll}><MSym name="download" size={16} />匯出整案資料</Button></div>
      </details>}

      {/* 手機 CTA(README 手機今日工作):滑到最底不知道下一步該做什麼時,一句話問 agent。
          與 App bar 全域搜尋走同一條代問機制(router state 帶 q,Agent 頁消費即清),
          也吃同一個 aiEnabled 閘門——功能關閉就整顆不渲染,不擺一顆按了會失望的鈕。
          在內容流最底而非 fixed:不與 bottom nav / FAB 疊,也不遮住任何待辦列。
          只在「待我處理」出現:問的是「現在該做什麼」,不是等對方或已完成的脈絡。 */}
      {ball === 'mine' && aiEnabled('agent.run') && (
        <Button size="lg" className="w-full md:hidden"
          onClick={() => navigate('/agent', { state: { q: '今天最該處理什麼？' } })}>
          <MSym name="smart_toy" size={18} />問 GovAgent：今天最該處理什麼？
        </Button>
      )}
    </div>
  )
}

// AI 今日已代辦(README dash 右下):agent 今天替這個帳號完成了哪些草稿、
// 還有幾件等覆核。純顯示統計——紅線:不產生任何待辦、不提供接受/核定動作,
// 覆核一律回 /agent 收件匣逐筆處理(決定權永遠在人)。
// agentActions 由 store 的 agent slice 在真專案選定時就載入(demo 走種子),
// 不是 /agent 頁才觸發——這裡直接讀,不另發請求。
// 「今日」用台北日曆日(taipeiISODate):resolved_at 存 UTC,台灣早上接受的草稿
// 用 UTC 判斷會整天不出現——與 todayTasks「今天已完成」同一套規則(W8-2A §3.3)。
function AgentDoneCard() {
  const { agentActions } = useStore()
  const todayIso = taipeiISODate(new Date())
  const acceptedToday = (agentActions || []).filter((a) => a.status === 'accepted' && taipeiISODate(a.resolved_at) === todayIso)
  const pendingCount = (agentActions || []).filter((a) => a.status === 'pending').length
  // 兩個數字都是 0 → 整卡不渲染:誠實原則,沒代辦就不擺空卡自我宣傳
  if (acceptedToday.length === 0 && pendingCount === 0) return null
  // 依 kind 分組成「種類 × N 件」;未知 kind 原樣顯示(對齊收件匣,不擋新種類)
  const byKind = [...acceptedToday.reduce((m, a) => m.set(a.kind, (m.get(a.kind) || 0) + 1), new Map())]
  return (
    <Card title="AI 今日已代辦" bodyClass="p-5">
      {byKind.length > 0 && (
        <ul className="space-y-1.5">
          {byKind.map(([kind, n]) => (
            <li key={kind} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-[var(--text-2)]">{KIND_LABEL[kind] || kind}</span>
              <span className="shrink-0 text-[var(--text-3)] text-xs">
                × <span className="num text-[var(--blue-text)] font-semibold text-sm">{n}</span> 件
              </span>
            </li>
          ))}
        </ul>
      )}
      {pendingCount > 0 && (
        <div className={`flex items-center justify-between gap-3 text-sm ${byKind.length ? 'mt-2.5 pt-2.5 border-t border-[var(--border-2)]' : ''}`}>
          <span className="text-[var(--text-2)]">
            待覆核 <span className="num text-[var(--blue-text)] font-semibold">{pendingCount}</span> 件
          </span>
          {/* 手機觸控 ≥44px:連結自己撐高,不靠父層 padding */}
          <Link to="/agent" className="max-md:min-h-11 inline-flex items-center shrink-0 text-xs font-medium text-[var(--blue-text)] hover:underline">
            到收件匣覆核 <MSym name="chevron_right" size={13} />
          </Link>
        </div>
      )}
    </Card>
  )
}

// 清單、篩選、載入筆數都留在同一頁；URL 保存篩選，從單據返回不必重新找。
function TaskSection({ title, items, empty, emptyTitle, emptyTo = null, hint = null, done = false }) {
  const [params, setParams] = useSearchParams()
  const { state } = useLocation()
  const q = params.get('q') || ''
  const searchRef = useRef(null)
  const type = params.get('type') || ''
  const urgent = params.get('urgent') === '1'
  const [filtersOpen, setFiltersOpen] = useState(() => !!(q || type || urgent))
  const limit = Math.max(20, Math.min(10000, Number(params.get('limit')) || 20))
  const today = taipeiISODate(new Date())
  const tags = [...new Set(items.map((t) => t.tag))]
  if (type && !tags.includes(type)) tags.push(type)
  const matched = items.filter((t) => (!type || t.tag === type)
    && (!urgent || (t.due && t.due <= today))
    && `${t.title} ${t.meta} ${t.tag}`.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase()))
  const shown = matched.slice(0, limit)
  const change = (patch) => setParams((previous) => {
    const next = new URLSearchParams(previous)
    next.delete('limit')
    for (const [key, value] of Object.entries(patch)) value ? next.set(key, value) : next.delete(key)
    return next
  }, { replace: true })
  // 從單據返回:原項還在就聚焦它;已不在(做完了、球交給對方)就明說,不讓人以為被吃掉(U11)
  const [returnedGone, setReturnedGone] = useState(false)
  useEffect(() => {
    if (!state?.returnedTask) return
    const el = document.getElementById(`task-${state.returnedTask}`)
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView?.({ block: 'center' }); setReturnedGone(false) }
    else { searchRef.current?.focus(); setReturnedGone(true) }
  }, [state])
  return (
    <Card title={title} action={<div className="flex items-center gap-2">
      <Badge color={done || !items.length ? 'green' : 'amber'} className="num">{items.length}</Badge>
      {items.length > 0 && <Button variant="ghost" size="sm" className="md:hidden" aria-expanded={filtersOpen} aria-label="篩選待辦" onClick={() => setFiltersOpen((v) => !v)}><MSym name="tune" size={16} />篩選</Button>}
    </div>} bodyClass="p-0">
      {items.length > 0 && <div className={`p-4 border-b border-[var(--border-2)] space-y-3 ${filtersOpen ? '' : 'max-md:hidden'}`}>
        <div className="flex flex-col sm:flex-row gap-2">
          <SearchField ref={searchRef} aria-label="搜尋待辦" placeholder="搜尋事項、編號或處理內容" value={q} onChange={(e) => change({ q: e.target.value })} className="flex-1" />
          <Select aria-label="待辦類型" className="sm:w-48" value={type} onChange={(e) => change({ type: e.target.value })}>
            <option value="">所有類型</option>
            {tags.map((tag) => <option key={tag} value={tag}>{tag}（{items.filter((t) => t.tag === tag).length}）</option>)}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!done && <StatusChip active={urgent} onClick={() => change({ urgent: urgent ? '' : '1' })}>逾期與今天到期</StatusChip>}
          {(q || type || urgent) && <Button variant="ghost" size="sm" onClick={() => change({ q: '', type: '', urgent: '' })}>清除篩選</Button>}
          <span role="status" className="text-footnote text-[var(--text-3)] sm:ml-auto">顯示 {shown.length} / {matched.length} 件</span>
        </div>
      </div>}
      {/* 不指向不一定找得到它的「今天已完成」(那裡只列有完成時間的缺失與查驗);給確定的回找入口(W06) */}
      {returnedGone && (
        <p role="status" className="px-4 pt-3 text-footnote text-[var(--text-2)] flex items-center gap-2 flex-wrap">
          <span>剛才處理的事項已不在「{title}」，可能已完成或已交給對方。</span>
          {state?.returnedTo && <Link to={state.returnedTo} className="inline-flex items-center gap-0.5 min-h-11 font-medium text-[var(--blue-text)] hover:underline">回到剛才處理的那一筆<MSym name="chevron_right" size={14} /></Link>}
        </p>
      )}
      {done && <p className="px-4 pt-3 text-footnote text-[var(--text-3)]">此處僅列有完成時間的缺失結案與查驗判定。其他操作請查閱<Link to="/activity" className="text-[var(--blue-text)] inline-flex items-center min-h-11">活動紀錄</Link>。</p>}
      {items.length === 0 ? (
        <Empty title={emptyTitle}>
          {empty}
          {hint && <div className="mt-1 text-footnote text-[var(--text-3)]">{hint}</div>}
          {emptyTo && <div className="mt-3"><Link to={emptyTo.to} className="inline-flex items-center gap-0.5 min-h-11 text-body font-medium text-[var(--blue-text)] hover:underline">
            {emptyTo.label}<MSym name="chevron_right" size={14} />
          </Link></div>}
        </Empty>
      ) : matched.length === 0 ? (
        <Empty title="沒有符合篩選的事項">請更換關鍵字或清除篩選，查看其他待辦。</Empty>
      ) : (
        <>
          <ul role="list" aria-label={`${title}清單`} className="divide-y divide-[var(--border-2)]">
            {shown.map((x) => <li key={x.key}><TaskRow task={x} /></li>)}
          </ul>
          {matched.length > shown.length && <div className="p-3 border-t border-[var(--border-2)] text-center">
            <Button variant="outline" onClick={() => change({ limit: String(limit + 20) })}>顯示更多（還有 {matched.length - shown.length} 件）</Button>
          </div>}
        </>
      )}
    </Card>
  )
}
