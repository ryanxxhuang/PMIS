import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMemo, useState, useEffect } from 'react'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import { Badge, Button, Card, Empty, PageHeader, Segmented } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { parseLocalDate, taipeiISODate } from '../../lib/dates.js'
import { useTodayTasks } from '../../lib/useTodayTasks.js'
import { BALL_SOURCES, resolveBallKey } from '../../lib/navConfig.js'
import { KIND_LABEL } from '../../lib/agentRole.js'
import { buildInsights, insightsForRole } from '../../lib/aiInsights.js'
import { buildSetupSteps } from '../../lib/setupChecklist.js'
import InsightsPanel from '../../components/InsightsPanel.jsx'
import TaskRow from '../../components/TaskRow.jsx'
import { appSnackbar } from '../../components/snackbar.jsx'

function SetupChecklist({ imported }) {
  const { listMembers, currentProject, obligations } = useStore()
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
  // 今日待辦的唯一來源(W8-2B):協作項＋期限型全部在 todayTasks 聚合。
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
  const latestVal = valuations[valuations.length - 1]
  const actualCum = useMemo(
    () => (latestVal ? totalCumAmount(roots, buildCumMap(roots, childrenMap, latestVal.items)) : 0),
    [roots, childrenMap, latestVal],
  )
  const completion = billableTotal ? (actualCum / billableTotal) * 100 : 0

  const plannedNow = useMemo(() => {
    if (!progressPlan) return null
    const months = progressPlan.months, N = months.length
    const start = parseLocalDate(progressPlan.start)
    const elapsed = (TODAY.getFullYear() - start.getFullYear()) * 12 + (TODAY.getMonth() - start.getMonth()) + (TODAY.getDate() - 1) / 30
    if (elapsed <= 0) return 0
    if (elapsed >= N - 1) return months[N - 1].plannedPct
    const lo = Math.floor(elapsed), f = elapsed - lo
    return months[lo].plannedPct + (months[lo + 1].plannedPct - months[lo].plannedPct) * f
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressPlan, todayISO])

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
    <TaskSection title="等待對方" items={tasks.waiting} seeAll
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
    <TaskSection title="現在輪到我" items={tasks.mine} seeAll
      emptyTitle="球不在你手上" empty="目前沒有輪到你處理的事項；有人把球交回來時，它會出現在這裡。"
      hint={obligations.length === 0 ? '上傳契約後，AI 會整理期限並在此提醒。' : null}
      emptyTo={{ to: sourceTo('waiting'), label: withCount('看等對方', tasks.waiting.length) }} />
  )

  return (
    <div className="space-y-5">
      {/* 頁首維持「今日待辦」:這個名字全站都在用(/agent 的「前往今日待辦」、
          /alerts 的「回到今日待辦」),h1 改叫來源名會變成同一個地方兩個名字,
          違反 wayfinding。三個球權桶改用 Segmented 露在頁首下方——側欄的來源
          是落地點,頁內的分段控制讓人不必回側欄就能切,兩者選取態同一份 ?ball=。 */}
      <PageHeader
        title="今日待辦"
        tagline={project.project_name}
        subtitle={`${project.owner_name} · 施工：${project.contractor_name || '—'} · 監造：${project.supervisor_name || '—'}`}
        meta={[
          { k: '工程代碼', v: project.project_code || '—' },
          { k: '日期', v: todayISO },
        ]}
        action={imported && (
          <Button variant="outline" size="sm" onClick={exportAll} title="把本專案所有資料打包下載(JSON)">
            <MSym name="download" size={16} />匯出整案資料
          </Button>
        )}
      />

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
      ) : !imported ? (
        // 未匯標單:初始化清單就是指引(第 2 步=到專案文件一次上傳,與全站說法一致)
        isPersistedProject ? <SetupChecklist imported={false} /> : (
          <Card>
            <Empty>
              此專案尚未匯入標單。請到「<Link to="/contract" className="text-[var(--blue-text)] hover:underline">專案文件</Link>」把標單 XML 與契約等文件一次上傳，
              之後估驗、進度、施工日誌、品質查驗才會有資料。
            </Empty>
          </Card>
        )
      ) : (
        <div className="space-y-5">
          {/* 初始化清單、風險警示、AI 今日已代辦只跟著「待我處理」走:它們是「現在該做
              什麼」的脈絡,不是「等對方」或「已完成」的脈絡。單欄直排:收件匣就是一條清單。
              ⚠️「最近施工日誌」卡刻意保留:/site-log 目前是 hidden:true,而其餘連得到它的
              /valuation 也 hidden,拿掉這張卡等於拆掉可見表面通往施工日誌的最後一條路——
              2026-08-12 實測就是「藏到連擁有者都找不到」。解封現場與品質工作面之前不要動它。 */}
          {ball === 'mine' && isPersistedProject && !project.formal_mode && <SetupChecklist imported />}

          {/* 狀態全部由既有業務流程更新——在目的頁做完事就自動退出,
              不需要回這裡打勾;這裡也永遠不會出現 AI 自己產生的工作。 */}
          {focus}

          {ball === 'mine' && (
            <>
              {/* AI 主動觀察:風險警示卡,不是待辦(AI 不得替人產生人工工作) */}
              <InsightsPanel insights={insights} />
              {/* AI 今日已代辦:agent 今天替你做掉了什麼 */}
              <AgentDoneCard />
              {/* 最近施工日誌:這張卡的存在理由不是「首頁該有摘要」,而是可發現性——
                  /site-log 與 /valuation 都是 hidden:true,拿掉它之後可見表面就沒有
                  任何一條路通往施工日誌。解封「現場與品質」工作面之後才可以移除。 */}
              <Card title="最近施工日誌" bodyClass="p-0"
                action={<Link to="/site-log" className="text-footnote font-medium text-[var(--blue-text)] hover:underline inline-flex items-center gap-0.5">施工日誌 <MSym name="chevron_right" size={13} /></Link>}>
                {siteLogs.length === 0 ? <Empty>尚無施工日誌</Empty> : (
                  <ul className="divide-y divide-[var(--border-2)]">
                    {siteLogs.slice(0, 6).map((l) => (
                      <li key={l.id}>
                        <Link to="/site-log" className="flex items-center justify-between gap-3 px-5 py-2.5 text-body hover:bg-[var(--surface-2)] transition-colors">
                          <span className="num text-[var(--text-2)] shrink-0">{l.log_date}</span>
                          <span className="text-[var(--text)] truncate ml-3 flex-1 text-right">{l.work_summary || `${Object.keys(l.items).length} 工項`}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}
        </div>
      )}

      {/* 手機 CTA(README 手機今日待辦):滑到最底不知道下一步該做什麼時,一句話問 agent。
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

// 每種待辦的圖示 + 色票(icon 方塊底色/字色)——一眼分辨類型
// 首頁每段最多 5 筆;完整清單在提醒中心,首頁不再無限長。
const SECTION_CAP = 5

// emptyTitle/emptyTo:空狀態的一句話標題與指路連結(規範 §6:空狀態要說缺什麼、
// 輪到誰、去哪裡看),由呼叫端依球權來源決定文案,這裡只負責排版。
function TaskSection({ title, items, empty, emptyTitle, emptyTo = null, hint = null, seeAll = false, done = false }) {
  const shown = items.slice(0, SECTION_CAP)
  const countPill = (
    <Badge color={done || !items.length ? 'green' : 'amber'} className="num">{items.length}</Badge>
  )
  return (
    <Card title={title} action={countPill} bodyClass="p-0">
      {items.length === 0 ? (
        <Empty title={emptyTitle}>
          {empty}
          {/* 次要說明:只在呼叫端判斷「空得可疑」時出現(如義務為空=契約可能還沒上傳) */}
          {hint && <div className="mt-1 text-footnote text-[var(--text-3)]">{hint}</div>}
          {emptyTo && (
            <div className="mt-3">
              {/* 手機觸控 ≥44px:連結自己撐高 */}
              <Link to={emptyTo.to} className="inline-flex items-center gap-0.5 max-md:min-h-11 text-body font-medium text-[var(--blue-text)] hover:underline">
                {emptyTo.label} <MSym name="chevron_right" size={14} />
              </Link>
            </div>
          )}
        </Empty>
      ) : (
        <ul className="divide-y divide-[var(--border-2)]">
          {shown.map((x) => <li key={x.key}><TaskRow task={x} /></li>)}
          {/* 溢位一定要有出口:提醒中心吃同一份聚合,點過去看得到剩下那幾件 */}
          {items.length > shown.length && seeAll && (
            <li className="px-4 py-2.5">
              <Link to="/alerts" className="text-xs font-medium text-[var(--blue-text)] hover:underline inline-flex items-center gap-0.5">
                看全部 {items.length} 件 <MSym name="chevron_right" size={13} />
              </Link>
            </li>
          )}
          {items.length > shown.length && !seeAll && (
            <li className="px-4 py-2 text-caption text-[var(--text-3)]">還有 {items.length - shown.length} 項…</li>
          )}
        </ul>
      )}
    </Card>
  )
}
