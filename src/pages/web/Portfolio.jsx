// 跨案總覽:機關承辦/公司主管一頁比較手上所有專案——進度、未結事項、驗收階段。
// 機關登入的預設落地頁。真實模式走 portfolio_summary RPC(一次撈全部,不逐案打);
// demo 模式 = 本案(A 區)即時計算 + 兩個靜態示範姊妹案(驗收倒數/保固中)。
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Badge, PageHeader, Surface, ErrorBanner, SkeletonList, PrerequisiteEmptyState } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { plannedPctNow } from '../../lib/progressPlan.js'
import { fmtAmount as fmt } from '../../lib/format.js'
import { acceptanceStageSummary } from '../../lib/acceptance.js'
import { DEMO_PORTFOLIO } from '../../data/demoSeed.js'
import { portfolioExceptions } from '../../lib/portfolioExceptions.js'

export default function Portfolio() {
  const {
    demoMode, isSupabaseConfigured, projects, currentProject, switchProject, loadPortfolio,
    project, workItems, valuations, progressPlan, defects, inspections, changeOrders, acceptanceEvents,
    adjustedItems, revisedTotal,
  } = useStore()
  const navigate = useNavigate()
  const TODAY = new Date() // 每次 render 取(B-11)
  const plannedNow = plannedPctNow(progressPlan, TODAY)

  // ── 本案(目前載入中的專案)即時計算——與 Dashboard 同一套數學 ──
  const current = useMemo(() => {
    if (!workItems) return null
    // 財務單一真相層(B-02):與 Dashboard/估驗頁同一套計算(含已核准變更)
    const { roots, childrenMap } = buildBillableTree(adjustedItems)
    const billable = revisedTotal
    const latest = valuations[valuations.length - 1]
    const cum = latest ? totalCumAmount(roots, buildCumMap(roots, childrenMap, latest.items)) : 0
    return {
      name: project.project_name, code: project.project_code, status: project.status || '施工中',
      billable, cum, progressPct: billable ? (cum / billable) * 100 : 0, plannedPct: plannedNow,
      openDefects: defects.filter((d) => d.status !== '已結案').length,
      pendingInspections: inspections.filter((i) => i.status === '待查驗').length,
      pendingCOs: changeOrders.filter((c) => c.status === '提出' || c.status === '審核中').length,
      acceptance: acceptanceStageSummary(demoMode ? [] : acceptanceEvents), // demo 的驗收事件屬 B 區 storyline
      isCurrent: true,
    }
  }, [workItems, adjustedItems, revisedTotal, valuations, plannedNow, defects, inspections, changeOrders, acceptanceEvents, project, demoMode])

  // ── 其他專案:真實模式走 RPC;demo 用靜態示範案 ──
  // others=null 代表「還不知道」(載入中或失敗),不是 0 案:失敗時 RPC 回空列,若當成
  // 0 筆畫出來,例外帶會說「1 案 各案均無未結例外」——那是假的 0(規範 §6:查詢失敗
  // 要說失敗並給重試)。attempt 只為了重跑同一個 effect,不改查詢語意。
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
            billable: Number(r.billable_total) || 0, cum: Number(r.latest_cum) || 0,
            progressPct: r.billable_total > 0 ? (Number(r.latest_cum) / Number(r.billable_total)) * 100 : 0,
            plannedPct: null,
            latestPeriod: r.latest_period, latestStatus: r.latest_status,
            openDefects: r.open_defects, pendingInspections: r.pending_inspections, pendingCOs: r.pending_change_orders,
            acceptance: acceptanceStageSummary(r.acceptance_events || []),
          }
        }))
    }).catch((e) => { if (active) { setLoadErr(e); setOthers(null) } }) // 網路層例外也不能靜默成 0 案
    return () => { active = false }
  }, [demoMode, isSupabaseConfigured, projects, currentProject, loadPortfolio, attempt])
  const retry = () => setAttempt((n) => n + 1)
  // 載入中=真實模式、還沒拿到結果、也還沒失敗;demo 的 others 是同步設的,不會進這裡
  const loading = !demoMode && isSupabaseConfigured && others === null && !loadErr

  const cards = [current, ...(others || [])].filter(Boolean)

  const open = (c) => {
    if (c.isCurrent) { navigate('/dashboard'); return }
    if (c.demo) { if (c.to) navigate(c.to); return }
    switchProject(c.projectId)
    navigate('/dashboard')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="跨案總覽" tagline="Portfolio"
        subtitle="手上所有專案的進度、待辦與驗收階段,一頁比較;點卡片切換到該案。"
      />
      {/* 彙總失敗:說失敗、給重試;下方仍列本案即時卡(它不經 RPC),但明講其他案沒列出 */}
      {loadErr && (
        <ErrorBanner onRetry={retry}
          msg={`跨案彙總讀取失敗：${friendlyError(loadErr, '連線異常')}。下方只有目前專案的即時數字,其他專案未列出。`} />
      )}
      {loading && <p role="status" className="text-xs text-[var(--text-3)]">正在載入其他專案的彙總…</p>}
      {/* 例外帶只在「全部都到齊」時畫:載入中/失敗時案數與例外數都是殘缺的,畫出來就是假的 0 */}
      {cards.length > 0 && others !== null && <ExceptionBand ex={portfolioExceptions(cards)} />}
      {cards.length === 0 ? (
        loadErr ? null : loading ? (
          <Card><SkeletonList rows={2} label="正在載入跨案彙總…" /></Card>
        ) : (
          <Card bodyClass="p-0">
            <PrerequisiteEmptyState
              need="尚無任何專案。建立專案並上傳專案文件後,你被加入的每個專案都會列在這裡。"
              unlocks="跨案比較進度、未結缺失／查驗／變更與驗收階段"
              to="/project/new" cta="建立專案" />
          </Card>
        )
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {cards.map((c) => <ProjectCard key={c.key || 'current'} c={c} onOpen={() => open(c)} />)}
        </div>
      )}
      {demoMode && (
        <p className="text-xs text-[var(--text-3)]">
          B 區 / C 區為示範資料——真實帳號會列出你被加入的所有專案(彙總數字由伺服器一次計算)。
        </p>
      )}
    </div>
  )
}

// 安靜的數字帶(刻意不做成 Card):它是卡片 grid 的索引,不該和專案卡搶視覺層級。
// 值為 0 的項不渲染——0 是好消息,列出來只會稀釋真正要看的那幾個數字。
function ExceptionBand({ ex }) {
  const items = [
    { key: 'defects', icon: 'warning', text: `未結缺失 ${ex.openDefects}`, v: ex.openDefects, warn: true },
    { key: 'insp', icon: 'verified_user', text: `待查驗 ${ex.pendingInspections}`, v: ex.pendingInspections, warn: true },
    { key: 'co', icon: 'build', text: `待核定變更 ${ex.pendingCOs}`, v: ex.pendingCOs, warn: true },
    { key: 'acc', icon: 'verified', text: `驗收中 ${ex.acceptanceActive} 案`, v: ex.acceptanceActive },
    { key: 'accOver', icon: 'verified', text: `驗收逾期 ${ex.acceptanceOverdue} 案`, v: ex.acceptanceOverdue, red: true },
  ].filter((i) => i.v > 0)

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-[var(--text-2)]">
      <span className="num text-[var(--text-3)]">{ex.projects} 案</span>
      {items.length === 0 ? (
        <span className="text-[var(--text-3)]">各案均無未結例外</span>
      ) : items.map((i) => {
        return (
          <span key={i.key} className={`flex items-center gap-1.5 ${i.red ? 'text-[var(--red-text)] font-medium' : ''}`}>
            {/* warn 語意一律 --amber-text:--accent(安全橘)是非語意品牌標記,拿來當警示會與逾期/落後打架 */}
            <MSym name={i.icon} size={14} className={i.red ? 'text-[var(--red-text)]' : i.warn ? 'text-[var(--amber-text)]' : 'text-[var(--text-3)]'} />
            {i.text}
          </span>
        )
      })}
    </div>
  )
}

const STATUS_COLOR = { 施工中: 'blue', 驗收中: 'amber', 保固中: 'green', 已結案: 'slate' }

function ProjectCard({ c, onOpen }) {
  const behind = c.plannedPct != null ? c.plannedPct - c.progressPct : null
  const clickable = c.isCurrent || c.projectId || c.to
  // 卡殼吃共用 Surface(白卡/圓角/框線/陰影一份定義),這裡只留「可點卡片」自己的互動樣式;
  // hover 陰影走 token:--shadow-* 沒註冊進 @theme,Tailwind 的 shadow-md 吃到的是它自己的黑影
  return (
    <Surface as="button" onClick={onOpen} disabled={!clickable}
      className={`text-left h-full flex flex-col p-5 pressable ${clickable ? 'hover:border-[var(--blue)] hover:[box-shadow:var(--shadow-md)] cursor-pointer' : 'cursor-default'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-callout font-medium text-[var(--text)] truncate flex items-center gap-2">
            {c.name}
            {c.isCurrent && <Badge color="blue">目前專案</Badge>}
          </div>
          <div className="text-caption text-[var(--text-3)] num mt-0.5">{c.code || '—'}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge color={STATUS_COLOR[c.status] || 'slate'}>{c.status}</Badge>
          {clickable && <MSym name="chevron_right" size={15} className="text-[var(--text-3)]" />}
        </div>
      </div>

      {/* 進度:百分比一行 → 進度條 → 金額固定一行——每張卡同構,寬窄都不會亂跳行 */}
      <div className="mt-4">
        <div className="flex items-baseline gap-2">
          <span className="num text-lg leading-none font-semibold text-[var(--text)]">{c.progressPct.toFixed(1)}%</span>
          {/* 實際 vs 計畫吃五語意色票:落後=red(與進度管制頁同一個 5% 門檻)、超前/正常=green;
              不再用只有這裡看得到的 accent 橘——跨頁看同一件事,顏色要是同一個意思 */}
          {behind != null && (
            <Badge color={behind > 5 ? 'red' : 'green'}>
              {behind > 5 ? `落後 ${behind.toFixed(1)}%` : behind < -2 ? `超前 ${(-behind).toFixed(1)}%` : '進度正常'}
            </Badge>
          )}
        </div>
        <div className="relative h-2 rounded-full bg-[var(--surface-2)] mt-2 overflow-hidden">
          <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--blue)]" style={{ width: `${Math.min(100, c.progressPct)}%` }} />
          {c.plannedPct != null && (
            /* 標記線只有顏色與位置,沒有文字說明;比照 Dashboard 同一標記補 title/aria-label */
            <div className="absolute inset-y-0 w-[2px] bg-[var(--text-2)]" style={{ left: `${Math.min(100, c.plannedPct)}%` }}
              role="img" title={`今日預定 ${c.plannedPct.toFixed(1)}%`} aria-label={`今日預定 ${c.plannedPct.toFixed(1)}%`} />
          )}
        </div>
        <div className="num text-caption text-[var(--text-3)] mt-1.5 text-right">
          <span className="whitespace-nowrap">累計估驗 NT$ {fmt(c.cum)}</span> ／ <span className="whitespace-nowrap">{fmt(c.billable)}</span>
        </div>
      </div>

      {/* 待辦計數(mt-auto 把底部區塊釘齊卡底,三張卡對齊) */}
      <div className="mt-auto pt-4 grid grid-cols-3 gap-2 text-caption w-full">
        {[
          { icon: 'warning', label: '缺失', title: '未結案缺失', v: c.openDefects, warn: c.openDefects > 0 },
          { icon: 'verified_user', label: '待查驗', title: '待監造查驗', v: c.pendingInspections, warn: c.pendingInspections > 0 },
          { icon: 'build', label: '變更', title: '變更設計待核定', v: c.pendingCOs, warn: c.pendingCOs > 0 },
        ].map((s) => {
          return (
            <div key={s.label} title={s.title} className="flex items-center gap-1.5 rounded-lg bg-[var(--surface-2)] px-2 py-1.5 min-w-0">
              <MSym name={s.icon} size={13} className={`shrink-0 ${s.warn ? 'text-[var(--amber-text)]' : 'text-[var(--text-3)]'}`} />
              <span className="text-[var(--text-3)] truncate">{s.label}</span>
              <span className={`num ml-auto font-semibold ${s.warn ? 'text-[var(--amber-text)]' : 'text-[var(--text-2)]'}`}>{s.v}</span>
            </div>
          )
        })}
      </div>

      {/* 驗收階段:永遠顯示同一列(沒進驗收就淡色),三張卡底部才會整齊 */}
      <div className="mt-3 flex items-center gap-2 text-footnote w-full">
        <MSym name="verified" size={14} className={!c.acceptance ? 'text-[var(--text-3)] opacity-60' : c.acceptance.overdue ? 'text-[var(--red-text)]' : c.acceptance.finished ? 'text-[var(--green-text)]' : 'text-[var(--blue-text)]'} />
        <span className={c.acceptance ? 'text-[var(--text-2)]' : 'text-[var(--text-3)]'}>
          驗收：{c.acceptance ? c.acceptance.label : '尚未進入驗收程序'}
        </span>
        {c.acceptance && <span className="num text-[var(--text-3)] ml-auto">{c.acceptance.done}/{c.acceptance.total}</span>}
      </div>
    </Surface>
  )
}
