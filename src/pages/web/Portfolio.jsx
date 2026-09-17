// 跨案總覽:縮為「選案清單」(D-026 §4,P1b)。獨立的跨案分析儀表板已退場——原本的進度條、
// 累計估驗金額、預定 vs 實際、驗收階段與例外彙總帶都不再計算;留下的是多案角色真正需要的:
// 我被加入哪些案、各案還有幾件未結事項、最近一期估驗到哪,以及一格切換到該案。
// 真實模式走 portfolio_summary RPC(一次撈全部,不逐案打;D-024 已知它取最新期,不再擴充);
// demo 模式 = 本案(A 區,件數由 store 即時計算)+ 兩個靜態示範姊妹案。
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Badge, PageHeader, ErrorBanner, SkeletonList, PrerequisiteEmptyState } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { DEMO_PORTFOLIO } from '../../data/demoSeed.js'

const STATUS_COLOR = { 施工中: 'blue', 驗收中: 'amber', 保固中: 'green', 已結案: 'slate' }

export default function Portfolio() {
  const {
    demoMode, isSupabaseConfigured, projects, currentProject, switchProject, loadPortfolio,
    project, defects, inspections, changeOrders, valuations,
  } = useStore()
  const navigate = useNavigate()

  // ── 本案(目前載入中的專案):件數與最近期別直接來自 store,與各工作頁同一份資料 ──
  const latestVal = [...valuations].sort((a, b) => a.period_no - b.period_no).slice(-1)[0]
  const current = {
    key: 'current', isCurrent: true,
    name: project?.project_name, code: project?.project_code, status: project?.status || '施工中',
    openDefects: defects.filter((d) => d.status !== '已結案').length,
    pendingInspections: inspections.filter((i) => i.status === '待查驗').length,
    pendingCOs: changeOrders.filter((c) => c.status === '提出' || c.status === '審核中').length,
    latestPeriod: latestVal?.period_no ?? null, latestStatus: latestVal?.status ?? null,
  }

  // ── 其他專案:真實模式走 RPC;demo 用靜態示範案 ──
  // others=null 代表「還不知道」(載入中或失敗),不是 0 案:失敗時 RPC 回空列,若當成
  // 0 筆畫出來會變成「你只有這一案」——那是假的(規範 §6:查詢失敗要說失敗並給重試)。
  // attempt 只為了重跑同一個 effect,不改查詢語意。
  const [others, setOthers] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (demoMode) {
      setOthers(DEMO_PORTFOLIO.map((p) => ({ ...p, demo: true })))
      return
    }
    if (!isSupabaseConfigured) return
    let active = true
    setLoadErr(null)
    loadPortfolio().then(({ rows, error }) => {
      if (!active) return
      if (error) { setLoadErr(error); setOthers(null); return }
      const nameById = new Map(projects.map((p) => [p.project_id, p]))
      setOthers(rows
        .filter((r) => r.project_id !== currentProject?.project_id)
        .map((r) => {
          const meta = nameById.get(r.project_id)
          return {
            key: r.project_id, projectId: r.project_id,
            name: meta?.project_name || '—', code: meta?.project_code, status: meta?.status || '施工中',
            openDefects: r.open_defects, pendingInspections: r.pending_inspections, pendingCOs: r.pending_change_orders,
            latestPeriod: r.latest_period, latestStatus: r.latest_status,
          }
        }))
    }).catch((e) => { if (active) { setLoadErr(e); setOthers(null) } }) // 網路層例外也不能靜默成 0 案
    return () => { active = false }
  }, [demoMode, isSupabaseConfigured, projects, currentProject, loadPortfolio, attempt])
  const retry = () => setAttempt((n) => n + 1)
  // 載入中=真實模式、還沒拿到結果、也還沒失敗;demo 的 others 是同步設的,不會進這裡
  const loading = !demoMode && isSupabaseConfigured && others === null && !loadErr

  const rows = [current, ...(others || [])].filter((c) => c && c.name)

  const open = (c) => {
    if (c.isCurrent) { navigate('/dashboard'); return }
    if (c.demo) { if (c.to) navigate(c.to); return }
    switchProject(c.projectId)
    navigate('/dashboard')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="跨案總覽" tagline="選案"
        subtitle="你被加入的專案清單與各案尚未處理的件數；點一案切換到該案的今日工作。"
      />
      {/* 彙總失敗:說失敗、給重試;下方仍列本案(它不經 RPC),但明講其他案沒列出 */}
      {loadErr && (
        <ErrorBanner onRetry={retry}
          msg={`跨案清單讀取失敗：${friendlyError(loadErr, '連線異常')}。下方只有目前專案,其他專案未列出。`} />
      )}
      {loading && <p role="status" className="text-xs text-[var(--text-3)]">正在載入其他專案…</p>}
      {rows.length === 0 ? (
        loadErr ? null : loading ? (
          <Card><SkeletonList rows={2} label="正在載入專案清單…" /></Card>
        ) : (
          <Card bodyClass="p-0">
            <PrerequisiteEmptyState
              need="尚無任何專案。建立專案並上傳專案文件後,你被加入的每個專案都會列在這裡。"
              unlocks="在多案之間切換,並看到各案尚未處理的件數"
              to="/project/new" cta="建立專案" />
          </Card>
        )
      ) : (
        <Card title={`專案（${others === null && !demoMode ? '載入中' : rows.length}）`} bodyClass="p-0">
          <ul role="list" aria-label="專案清單" className="divide-y divide-[var(--border-2)]">
            {rows.map((c) => <ProjectRow key={c.key} c={c} onOpen={() => open(c)} />)}
          </ul>
        </Card>
      )}
      {demoMode && (
        <p className="text-xs text-[var(--text-3)]">
          B 區 / C 區為示範資料——真實帳號會列出你被加入的所有專案(件數由伺服器一次計算)。
        </p>
      )}
    </div>
  )
}

// 一列一案:案名＋代碼＋狀態 / 三個未結件數 / 最近估驗期。整列可點=切換到該案(選案就是這一頁
// 唯一的動作);件數為 0 用中性色,有件數才用警示色,掃一眼就知道哪一案還有事。
function ProjectRow({ c, onOpen }) {
  const clickable = c.isCurrent || c.projectId || c.to
  const counts = [
    { label: '缺失', title: '未結案缺失', v: c.openDefects },
    { label: '待查驗', title: '待監造查驗', v: c.pendingInspections },
    { label: '變更', title: '變更設計待核定', v: c.pendingCOs },
  ]
  return (
    <li>
      <button type="button" onClick={onOpen} disabled={!clickable}
        className={`w-full text-left px-5 py-3 min-h-11 flex flex-wrap items-center gap-x-4 gap-y-1.5 ${clickable ? 'hover:bg-[var(--surface-2)] cursor-pointer pressable' : 'cursor-default'}`}>
        <span className="min-w-0 flex-1 basis-56">
          <span className="text-body font-medium text-[var(--text)] flex items-center gap-2 flex-wrap">
            <span className="truncate">{c.name}</span>
            {c.isCurrent && <Badge color="blue">目前專案</Badge>}
            <Badge color={STATUS_COLOR[c.status] || 'slate'}>{c.status}</Badge>
          </span>
          <span className="block text-caption text-[var(--text-3)] num mt-0.5">
            {c.code || '—'}
            {c.latestPeriod != null && <> · 最近估驗 第 {c.latestPeriod} 期{c.latestStatus ? `（${c.latestStatus}）` : ''}</>}
          </span>
        </span>
        <span className="flex items-center gap-3 text-caption tabular-nums">
          {counts.map((s) => (
            <span key={s.label} title={s.title} className={`flex items-center gap-1 ${s.v > 0 ? 'text-[var(--amber-text)] font-medium' : 'text-[var(--text-3)]'}`}>
              {s.label} <span className="num">{Number(s.v) || 0}</span>
            </span>
          ))}
        </span>
        {clickable && <MSym name="chevron_right" size={15} className="text-[var(--text-3)] shrink-0" />}
      </button>
    </li>
  )
}
