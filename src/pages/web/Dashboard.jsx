import { Link } from 'react-router-dom'
import { useMemo, useState, useEffect } from 'react'
import { Download, ChevronRight, Coins, FileCheck2, MessageSquareWarning, ShieldCheck, AlertTriangle, Eye, Wrench, CheckCircle2, Circle, Scale, FlaskConical, BadgeCheck, Octagon, NotebookPen } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import { Card, Empty, PageHeader } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { parseLocalDate } from '../../lib/dates.js'
import { buildTodayTasks } from '../../lib/todayTasks.js'
import { buildInsights, insightsForRole } from '../../lib/aiInsights.js'
import InsightsPanel from '../../components/InsightsPanel.jsx'

const fmt = (n) => (n == null || isNaN(n) ? '0' : Math.round(n).toLocaleString('en-US'))

// 初始化四步清單(W2-2 建立、W8-3A 依 D-014 修訂):真專案在正式模式開啟前顯示。
// 狀態全部由既有資料推導,不建 onboarding 資料表、不做逐步精靈;每步直達既有工作頁。
//
// W8-3A 的兩個關鍵修正:
//   ① 第 3 步只問「AI 整理完了沒」——`document_ingestion_runs` 有沒有一筆 completed。
//      不再讀 Requirement 的待審／核定數:那 106 筆是 AI 的產出,不是人要清空的初始化
//      門檻,更不該擋住開啟正式模式(D-014)。擷取結果 0 筆也算整理完成,那代表
//      「AI 讀完了但沒找到建議」,不是失敗。
//   ② 第 4 步永遠不因前三步或三方未到齊而卡住;原本「三方到齊後才能開啟」的文案
//      與 W4-4 已定案行為不符(不齊也可開,只是要二次確認)。
const ORG_LABEL = { contractor: '廠商', supervisor: '監造', owner: '機關' }
// 查詢失敗要說失敗,不能靜默當成 0 筆 —— 那會把「查不到」演成「還沒開始」,
// 使用者會去重做一次已經做完的事。
const LOAD_FAIL = '狀態載入失敗，前往專案文件查看'

// 由既有資料推導四步(純函式,便於釘住完成條件)。snap = null 代表仍在載入。
// 每步固定有:責任方、完成與否、唯一目的地;不提供逐筆打勾、略過或批次核定。
export function buildSetupSteps(snap, { imported } = {}) {
  const missingOrgs = ['contractor', 'supervisor', 'owner'].filter((o) => !snap?.orgs?.has(o))
  const ingestionDone = !!snap && !snap.ingestionError && snap.ingestionCompleted > 0
  return [
    {
      to: '/contract', label: '上傳專案文件與標單', owner: '施工廠商／專案建立者',
      done: !!snap && !snap.docsError && snap.docs > 0 && !!imported,
      detail: !snap ? '載入中…'
        : snap.docsError ? LOAD_FAIL
          : `文件 ${snap.docs} 件・標單${imported ? '已匯入' : '未匯入'}`,
    },
    {
      to: '/members', label: '確認三方成員', owner: '專案建立者',
      done: !!snap && !snap.membersError && missingOrgs.length === 0,
      detail: !snap ? '載入中…'
        : snap.membersError ? `${snap.membersError},到成員頁重試`
          : missingOrgs.length ? `尚缺:${missingOrgs.map((o) => ORG_LABEL[o]).join('、')}` : '廠商、監造、機關都已加入',
    },
    {
      // 完成後才導去看結果;沒整理完就回專案文件看處理狀態或重試(那裡才有上傳與重跑)
      to: ingestionDone ? '/requirements' : '/contract',
      label: 'AI 整理契約重點', owner: '系統自動', done: ingestionDone,
      detail: !snap ? '載入中…'
        : snap.ingestionError ? LOAD_FAIL
          : ingestionDone
            ? 'AI 已完成整理；只有要成為契約規則的內容才需人工核定，不影響開啟正式模式'
            : '尚未有完成的整理；到專案文件查看處理狀態或重試',
    },
    {
      to: '/members', label: '開啟正式模式', owner: '專案建立者',
      done: false, // 開啟後整張清單就不再顯示,所以在清單存在期間固定未完成
      detail: '由專案建立者在「專案成員」頁開啟；前面步驟未完成或三方未到齊也可以開啟，系統會再次確認',
    },
  ]
}

function SetupChecklist({ imported }) {
  const { listMembers, currentProject } = useStore()
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

  const steps = buildSetupSteps(snap, { imported })
  const doneCount = steps.filter((s) => s.done).length
  // 下一步 = 前 3 步第一個未完成;前三步都完成就指向第 4 步(開啟正式模式)
  const next = steps.slice(0, 3).find((s) => !s.done) || steps[3]

  return (
    <Card title="專案初始化" action={<span className="num text-xs text-[var(--text-3)]">已完成 {doneCount}/4</span>}>
      <Link to={next.to}
        className="flex items-center gap-2 rounded-lg bg-[var(--blue-tint)] text-[var(--blue-text)] px-3 py-2 mb-3 text-sm font-medium hover:brightness-95 transition-[filter]">
        <span className="min-w-0 flex-1">下一步：{next.label}</span>
        <ChevronRight size={15} className="shrink-0" aria-hidden />
      </Link>
      <ol className="divide-y divide-[var(--border-2)]">
        {steps.map((s, i) => (
          <li key={i}>
            <Link to={s.to} className="flex items-start gap-3 py-2.5 group">
              {s.done
                ? <CheckCircle2 size={18} className="text-[var(--green-text)] shrink-0 mt-0.5" aria-hidden />
                : <Circle size={18} className="text-[var(--text-3)] shrink-0 mt-0.5" aria-hidden />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-sm ${s.done ? 'text-[var(--text-3)] line-through' : 'text-[var(--text)] font-medium'}`}>{i + 1}. {s.label}</span>
                  <span className="text-[11px] text-[var(--text-3)]">{s.owner}</span>
                </div>
                <div className="text-xs text-[var(--text-3)] mt-0.5 leading-snug">{s.detail}</div>
              </div>
              <ChevronRight size={15} className="text-[var(--text-3)] group-hover:text-[var(--text-2)] shrink-0 mt-0.5" aria-hidden />
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
    adjustedItems, revisedTotal, inspectionPoints,
    checklistTemplates, checklistRecords, testSamples, submittals, rfis, observations, acceptanceEvents } = useStore()
  const imported = workItemsSource === 'db' || demoMode
  // 「今天」每次 render 取:工地平板整週不關分頁,模組層常數會讓日期/逾期判斷停在開頁那天(B-11)
  const TODAY = new Date()
  const todayISO = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`
  const myOrg = currentUser?.org_type || 'contractor'
  const anchors = {
    award_date: project?.award_date, notice_date: project?.notice_date,
    commencement_date: project?.commencement_date, end_date: project?.end_date,
  }
  // 今日待辦的唯一來源(W8-2B):協作項＋期限型全部在 todayTasks 聚合,
  // 提醒中心吃的是同一支函式——首頁與提醒中心不會再說出兩種待辦。
  const tasks = useMemo(() => buildTodayTasks({
    org: myOrg, today: TODAY, anchors,
    rfis, submittals, valuations, defects, inspections, observations, changeOrders,
    obligations, testSamples, acceptanceEvents, inspectionPoints, siteLogs,
  }), [myOrg, todayISO, project, rfis, submittals, valuations, defects, inspections, observations, changeOrders,
    obligations, testSamples, acceptanceEvents, inspectionPoints, siteLogs]) // eslint-disable-line react-hooks/exhaustive-deps

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
    a.download = `PMIS匯出_${project.project_name}_${todayISO}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // 財務單一真相層(B-02):完成率/金額一律以「已核准變更套回後」計算,與估驗/進度頁一致
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
  const behind = plannedNow != null ? plannedNow - completion : null

  // AI 主動觀察(§9-8:從 AI 助理搬來——Dashboard=待辦+風險,助理只留問答)
  const insights = useMemo(() => insightsForRole(buildInsights({
    progress: { actualPct: completion, plannedPct: plannedNow }, siteLogs, defects, testSamples,
    obligations, valuations, changeOrders, anchors,
  }, TODAY), myOrg), [completion, plannedNow, siteLogs, defects, testSamples, obligations, valuations, changeOrders, myOrg, todayISO]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <PageHeader
        title="今日待辦"
        tagline={project.project_name}
        subtitle={`${project.owner_name} · 施工：${project.contractor_name || '—'} · 監造：${project.supervisor_name || '—'}`}
        meta={[
          { k: '工程代碼', v: project.project_code || '—' },
          { k: '日期', v: todayISO },
        ]}
        action={imported && (
          <button onClick={exportAll} title="把本專案所有資料打包下載(JSON)"
            className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md px-2.5 py-1.5 border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] pressable">
            <Download size={13} aria-hidden />匯出整案資料
          </button>
        )}
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
              此專案尚未匯入標單。請到「<Link to="/contract" className="text-[var(--blue)]">專案文件</Link>」把標單 XML 與契約等文件一次上傳，
              之後估驗、進度、施工日誌、品質查驗才會有資料。
            </Empty>
          </Card>
        )
      ) : (
        <div className="space-y-5">
          {isPersistedProject && !project.formal_mode && <SetupChecklist imported />}

          {/* 進度摘要:待辦是主角,進度縮成一條狀態帶(落後仍亮橘色) */}
          <section className="bg-[var(--surface)] rounded-2xl border border-[var(--border-card)] [box-shadow:var(--shadow-card)] px-5 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-[0.09em] text-[var(--text-3)]">累計實際進度</div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-0.5">
                <span className="num text-[26px] leading-none font-semibold text-[var(--text)]">
                  {completion.toFixed(1)}<span className="text-base text-[var(--text-3)] ml-0.5">%</span>
                </span>
                {plannedNow != null && <span className="text-xs text-[var(--text-2)] num">目標 {plannedNow.toFixed(1)}%</span>}
                {behind != null && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold num ${
                    behind > 5 ? 'bg-[var(--accent-tint)] text-[var(--accent-text)]'
                    : behind < -2 ? 'bg-[var(--green-tint)] text-[var(--green-text)]'
                    : 'bg-[var(--slate-tint)] text-[var(--slate-text)]'
                  }`}>
                    {behind > 5 ? `落後 ${behind.toFixed(1)}%` : behind < -2 ? `超前 ${(-behind).toFixed(1)}%` : '進度正常'}
                  </span>
                )}
              </div>
              <div className="relative h-1.5 w-full min-w-[180px] rounded-full bg-[var(--surface-2)] mt-2.5 overflow-visible">
                <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--blue)]" style={{ width: `${Math.min(100, completion)}%` }} />
                {plannedNow != null && (
                  <div className="absolute -top-1 -bottom-1 w-[2px] rounded bg-[var(--text-2)]" style={{ left: `${Math.min(100, plannedNow)}%` }} title={`今日預定 ${plannedNow.toFixed(1)}%`} />
                )}
              </div>
            </div>
            <div className="flex gap-6 sm:ml-auto">
              <div>
                <div className="text-[10px] font-medium tracking-[0.06em] text-[var(--text-3)] uppercase">發包工程費</div>
                <div className="num text-[15px] font-semibold text-[var(--blue-text)] mt-0.5">NT$ {fmt(billableTotal)}</div>
              </div>
              <div>
                <div className="text-[10px] font-medium tracking-[0.06em] text-[var(--text-3)] uppercase">累計估驗</div>
                <div className="num text-[15px] font-semibold text-[var(--text)] mt-0.5">NT$ {fmt(actualCum)}</div>
              </div>
            </div>
          </section>

          {/* 三段今日待辦。狀態全部由既有業務流程更新——在目的頁做完事就自動退出,
              不需要回這裡打勾;這裡也永遠不會出現 AI 自己產生的工作。 */}
          {/* 真人驗收(2026-08-19):什麼都還沒上傳的專案也說「都跟上了」會誤導。
              store 沒有文件清單、不為此加查詢,退而求其次用「義務為空」當代理條件:
              義務由契約解析而來,義務空=多半連契約都還沒整理,補一句指路即可 */}
          <TaskSection title="現在輪到我" items={tasks.mine} seeAll
            empty="目前沒有輪到你處理的事項 — 都跟上了。"
            hint={obligations.length === 0 ? '上傳契約後，AI 會整理期限並在此提醒。' : null} />
          <TaskSection title="等待對方" items={tasks.waiting} seeAll
            empty="目前沒有在等其他單位的事項。" />
          <TaskSection title="今天已完成" items={tasks.doneToday} done
            empty="今天還沒有你這方完成的紀錄。" />

          {/* AI 主動觀察:一行摘要,不是待辦(AI 不得替人產生人工工作) */}
          <InsightsPanel insights={insights} />

          {/* 次要:最近紀錄。已完成的日誌不是待辦,也不併進「今天已完成」
              (log_date 是人可回填的業務日期,不等於今天完成了什麼) */}
          <Card title="最近施工日誌" bodyClass={siteLogs.length ? 'p-0' : 'p-6'}
            action={<Link to="/site-log" className="text-xs font-medium text-[var(--blue-text)] hover:underline inline-flex items-center gap-0.5">施工日誌 <ChevronRight size={13} aria-hidden /></Link>}>
            {siteLogs.length === 0 ? <Empty>尚無施工日誌</Empty> : (
              <ul className="divide-y divide-[var(--border-2)]">
                {siteLogs.slice(0, 6).map((l) => (
                  <li key={l.id}>
                    <Link to="/site-log" className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-[var(--surface-2)] transition-colors">
                      <span className="num text-[var(--text-2)] shrink-0">{l.log_date}</span>
                      <span className="text-[var(--text)] truncate ml-3 flex-1 text-right">{l.work_summary || `${Object.keys(l.items).length} 工項`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

// 每種待辦的圖示 + 色票(icon 方塊底色/字色)——一眼分辨類型
const TAG_META = {
  估驗: { icon: Coins, c: 'var(--blue-text)', bg: 'var(--blue-tint)' },
  送審: { icon: FileCheck2, c: 'var(--blue-text)', bg: 'var(--blue-tint)' },
  疑義: { icon: MessageSquareWarning, c: 'var(--purple-text)', bg: 'var(--purple-tint)' },
  查驗: { icon: ShieldCheck, c: 'var(--amber-text)', bg: 'var(--amber-tint)' },
  缺失: { icon: AlertTriangle, c: 'var(--red-text)', bg: 'var(--red-tint)' },
  工安缺失: { icon: AlertTriangle, c: 'var(--red-text)', bg: 'var(--red-tint)' },
  觀察: { icon: Eye, c: 'var(--slate-text)', bg: 'var(--slate-tint)' },
  變更: { icon: Wrench, c: 'var(--green-text)', bg: 'var(--green-tint)' },
  契約: { icon: Scale, c: 'var(--purple-text)', bg: 'var(--purple-tint)' },
  試驗: { icon: FlaskConical, c: 'var(--accent-text)', bg: 'var(--accent-tint)' },
  驗收: { icon: BadgeCheck, c: 'var(--green-text)', bg: 'var(--green-tint)' },
  停留點: { icon: Octagon, c: 'var(--red-text)', bg: 'var(--red-tint)' },
  日誌: { icon: NotebookPen, c: 'var(--blue-text)', bg: 'var(--blue-tint)' },
}

// 首頁每段最多 5 筆;完整清單在提醒中心,首頁不再無限長。
const SECTION_CAP = 5

function TaskSection({ title, items, empty, hint = null, seeAll = false, done = false }) {
  const shown = items.slice(0, SECTION_CAP)
  const countPill = (
    <span className={`num text-xs font-semibold px-2 py-0.5 rounded-full ${
      done ? 'bg-[var(--green-tint)] text-[var(--green-text)]'
        : items.length ? 'bg-[var(--accent-tint)] text-[var(--accent-text)]' : 'bg-[var(--green-tint)] text-[var(--green-text)]'
    }`}>{items.length}</span>
  )
  return (
    <Card title={title} action={countPill} bodyClass={items.length ? 'p-0' : 'p-6'}>
      {items.length === 0 ? (
        <Empty>
          {empty}
          {/* 次要說明:只在呼叫端判斷「空得可疑」時出現(如義務為空=契約可能還沒上傳) */}
          {hint && <div className="mt-1 text-xs text-[var(--text-3)]">{hint}</div>}
        </Empty>
      ) : (
        <ul className="divide-y divide-[var(--border-2)]">
          {shown.map((x) => {
            const m = TAG_META[x.tag] || { icon: Eye, c: 'var(--text-3)', bg: 'var(--surface-2)' }
            const Icon = m.icon
            return (
              <li key={x.key}>
                <Link to={x.to} className="group flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-2)] transition-colors">
                  <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: m.bg, color: m.c }}>
                    <Icon size={16} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-[var(--text)]">{x.title}</span>
                    <span className="block text-[11px] text-[var(--text-3)] leading-snug">
                      <span className={x.overdueDays ? 'text-[var(--red-text)] font-medium' : ''}>{x.meta}</span>
                    </span>
                  </span>
                  <ChevronRight size={16} className="text-[var(--text-3)] group-hover:text-[var(--text-2)] shrink-0 mt-1" aria-hidden />
                </Link>
              </li>
            )
          })}
          {/* 溢位一定要有出口:提醒中心吃同一份聚合,點過去看得到剩下那幾件 */}
          {items.length > shown.length && seeAll && (
            <li className="px-4 py-2.5">
              <Link to="/alerts" className="text-xs font-medium text-[var(--blue-text)] hover:underline inline-flex items-center gap-0.5">
                看全部 {items.length} 件 <ChevronRight size={13} aria-hidden />
              </Link>
            </li>
          )}
          {items.length > shown.length && !seeAll && (
            <li className="px-4 py-2 text-[11px] text-[var(--text-3)]">還有 {items.length - shown.length} 項…</li>
          )}
        </ul>
      )}
    </Card>
  )
}
