// 平台管理後台(批 C):全站 AI 用量/成本儀表、功能開關(kill switch)、專案方案。
// 僅平台管理員(profiles.is_platform_admin)可進——但前端的隱藏/守衛只是 UX,
// 真正的權限把關在資料庫:每支 admin RPC 第一行檢查 is_platform_admin() 並 raise,
// 就算繞過前端直接打 RPC,非平台管理員也拿不到任何跨租戶資料。
// 資料全部來自批 A 的 migrations(20260728000000/20260728000100);本頁不新增資料層。
// 圖表為純 CSS 長條(專案無圖表套件,也不引入)。
import { useState, useEffect, useMemo, useCallback } from 'react'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, PageHeader, Badge, Select, Input, Stat, Empty, ErrorBanner, SortableTh, TablePager, SkeletonList, THEAD_CLS } from '../../components/ui.jsx'
import { useTableSort, usePagination } from '../../lib/useTable.js'
import {
  TWD_PER_USD, toTwd, presetRange, customRange, pctOfTotal, overrideToRpcValue, overrideFromDb,
} from '../../store/slices/admin.js'
import { featureByKey } from '../../lib/aiFeatures.js'
import { CHIP_BASE, CHIP_ON, CHIP_OFF } from '../../components/PageTabs.jsx'

// ── 顯示用對照(與 aiFeatures.js 的 category 值域一致)──────────────────────
const CATEGORY_LABEL = {
  agent: 'Agent 對話', document: '讀文件', draft: '產草稿',
  vision: '看照片', integration: '外部介接', automation: '排程',
}
const CATEGORY_COLOR = { agent: 'blue', document: 'purple', draft: 'amber', vision: 'green', integration: 'slate', automation: 'slate' }
const PLAN_LABEL = { trial: '試用', standard: '標準', pro: '專業' }
const PLAN_COLOR = { trial: 'slate', standard: 'blue', pro: 'purple' }
const ORG_LABEL = { contractor: '施工廠商', supervisor: '監造', owner: '機關' }
const PLANS = ['trial', 'standard', 'pro']

const fmtInt = (n) => (Number(n) || 0).toLocaleString('en-US')
// 成本多半是小數美金:一般 2 位;小於 1 分但非 0 時給 4 位,不顯示成 $0.00
const fmtUsd = (n) => {
  const v = Number(n) || 0
  if (v > 0 && v < 0.01) return `$${v.toFixed(4)}`
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const fmtTwd = (usd) => `NT$ ${Math.round(toTwd(usd)).toLocaleString('en-US')}`

const TABS = [
  { id: 'overview', label: '用量總覽' },
  { id: 'byFeature', label: '依功能' },
  { id: 'byProject', label: '依專案' },
  { id: 'byUser', label: '依使用者' },
  { id: 'features', label: 'AI 功能開關' },
  { id: 'projects', label: '專案方案' },
]

const PRESETS = [
  { id: 'today', label: '今日' },
  { id: '7d', label: '近 7 日' },
  { id: '30d', label: '近 30 日' },
  { id: 'custom', label: '自訂' },
]

// 表頭字型層吃共用 THEAD_CLS(11px/500/text-2),對齊/內距本頁自決;內文 13px。
// 顏色只在 th 這一處決定——thead tr 上不得再疊第二層字色,兩層會互相打架。
const TH = `${THEAD_CLS} text-left py-2 px-3 whitespace-nowrap`
const THR = `${THEAD_CLS} text-right py-2 px-3 whitespace-nowrap`
const TD = 'py-2 px-3 text-[13px]'
const TDR = 'py-2 px-3 text-[13px] text-right num whitespace-nowrap'
// 資料列 hover 底色全站同一顆 token(不帶 alpha)
const TR = 'border-b border-[var(--border-2)] last:border-0 hover:bg-[var(--surface-2)]'
const EMPTY_MSG = '這段期間還沒有 AI 使用紀錄。'

// 載入中走骨架而不是 Empty:Empty 的 inbox 圖示等於先說「沒資料」
const LoadingCard = () => <Card bodyClass="p-5" aria-busy="true"><SkeletonList rows={3} /></Card>

export default function Admin() {
  const {
    isPlatformAdmin,
    loadAdminOverview, loadAdminByFeature, loadAdminByProject, loadAdminByUser, loadAdminDaily,
    loadAdminFeatures, loadAdminProjects, loadProjectOverrides,
    setFeatureEnabled, setFeatureMinPlan, setProjectPlan, setProjectOverride,
  } = useStore()

  const [tab, setTab] = useState('overview')

  // ── 期間選擇(全部分頁共用;半開區間 [from, to),換算邏輯在 admin slice)──
  const [preset, setPreset] = useState('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const range = useMemo(
    () => (preset === 'custom' ? customRange(customFrom, customTo) : presetRange(preset)),
    [preset, customFrom, customTo],
  )
  const rangeKey = `${range.from?.getTime() || ''}|${range.to?.getTime() || ''}`

  // ── 各分頁資料 ─────────────────────────────────────────────────────────────
  const [overview, setOverview] = useState(null)
  const [daily, setDaily] = useState([])
  const [byFeature, setByFeature] = useState([])
  const [byProject, setByProject] = useState([])
  const [byUser, setByUser] = useState([])
  const [features, setFeatures] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!isPlatformAdmin) return
    let active = true
    const { from, to } = range
    setLoadError(null)
    setLoading(true)
    ;(async () => {
      // 依分頁載入需要的資料;任何 RPC 錯誤如實顯示(admin RPC 被 DB 拒絕也會落在這裡)
      const fail = (e) => { if (active && e) setLoadError(e.message || '載入失敗') }
      if (tab === 'overview') {
        const [o, d] = await Promise.all([loadAdminOverview(from, to), loadAdminDaily(from, to)])
        if (!active) return
        setOverview(o.row); setDaily(d.rows); fail(o.error || d.error)
      } else if (tab === 'byFeature') {
        const r = await loadAdminByFeature(from, to)
        if (!active) return
        setByFeature(r.rows); fail(r.error)
      } else if (tab === 'byProject') {
        const r = await loadAdminByProject(from, to)
        if (!active) return
        setByProject(r.rows); fail(r.error)
      } else if (tab === 'byUser') {
        const r = await loadAdminByUser(from, to)
        if (!active) return
        setByUser(r.rows); fail(r.error)
      } else if (tab === 'features') {
        const r = await loadAdminFeatures()
        if (!active) return
        setFeatures(r.rows); fail(r.error)
      } else if (tab === 'projects') {
        const [p, f] = await Promise.all([loadAdminProjects(), loadAdminFeatures()])
        if (!active) return
        setProjects(p.rows); setFeatures(f.rows); fail(p.error || f.error)
      }
      if (active) setLoading(false)
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatformAdmin, tab, rangeKey, reloadKey])

  // 縱深防禦:路由守衛(App.jsx routeAllowed)已擋非平台管理員,這裡再擋一層——
  // 就算兩層都被繞過,DB 端 RPC 仍會 raise,本頁只會是一片載入錯誤。
  if (!isPlatformAdmin) {
    return (
      <div className="space-y-5">
        <Card>
          <Empty icon="gpp_maybe" title="需要平台管理員權限">
            此後台僅開放產品營運者;所有資料存取由伺服器端逐一驗證。
          </Empty>
        </Card>
      </div>
    )
  }

  const usageTab = tab === 'overview' || tab === 'byFeature' || tab === 'byProject' || tab === 'byUser'

  return (
    <div className="space-y-5">
      <PageHeader
        title="平台管理" tagline="Platform Admin"
        subtitle="全站 AI 用量與成本、功能開關、專案方案。權限由資料庫端 RPC 逐一把關;此頁僅平台管理員可見。"
      />

      {/* 平台管理的頁內功能分區，不是側欄路由子頁。
          視覺與工作面 chips(PageTabs)刻意同一套,但這裡是真的 tab(不換路由),
          所以 role=tablist/aria-selected 的機制不動,只換皮。 */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5" role="tablist" aria-label="平台管理">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`${CHIP_BASE} ${tab === t.id ? CHIP_ON : CHIP_OFF}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 期間選擇:用量分頁共用;開關/方案分頁與期間無關,不顯示避免誤導 */}
      {usageTab && (
        <div className="flex flex-wrap items-center gap-2">
          {/* 期間切換與上方分頁說同一種切換語言:同一組 chips 常數,不再是外框滑塊式分段控件 */}
          <div className="flex items-center gap-2">
            {PRESETS.map((p) => (
              <button key={p.id} onClick={() => setPreset(p.id)} aria-pressed={preset === p.id}
                className={`${CHIP_BASE} ${preset === p.id ? CHIP_ON : CHIP_OFF}`}>
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <Input type="date" aria-label="起日" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="!w-auto" />
              <span className="text-[var(--text-3)] text-sm">~</span>
              <Input type="date" aria-label="迄日" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="!w-auto" />
              <span className="text-xs text-[var(--text-3)]">迄日含當天;留空=不設界</span>
            </div>
          )}
          {loading && <span className="text-xs text-[var(--text-3)]">載入中…</span>}
        </div>
      )}

      <ErrorBanner msg={loadError} onClose={() => setLoadError(null)} />

      {tab === 'overview' && <OverviewTab overview={overview} daily={daily} loading={loading} />}
      {tab === 'byFeature' && <ByFeatureTab rows={byFeature} loading={loading} rangeKey={rangeKey} />}
      {tab === 'byProject' && <ByProjectTab rows={byProject} loading={loading} rangeKey={rangeKey} />}
      {tab === 'byUser' && <ByUserTab rows={byUser} loading={loading} rangeKey={rangeKey} />}
      {tab === 'features' && (
        <FeaturesTab features={features} setFeatures={setFeatures} loading={loading} reload={reload}
          setFeatureEnabled={setFeatureEnabled} setFeatureMinPlan={setFeatureMinPlan} />
      )}
      {tab === 'projects' && (
        <ProjectsTab projects={projects} setProjects={setProjects} features={features} loading={loading} reload={reload}
          setProjectPlan={setProjectPlan} setProjectOverride={setProjectOverride}
          loadProjectOverrides={loadProjectOverrides} />
      )}
    </div>
  )
}

// ── 分頁一:用量總覽 ─────────────────────────────────────────────────────────
function OverviewTab({ overview, daily, loading }) {
  const empty = !overview || Number(overview.total_calls) === 0
  if (empty) return loading ? <LoadingCard /> : <Card><Empty>{EMPTY_MSG}</Empty></Card>
  const o = overview
  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat label="總呼叫數" value={fmtInt(o.total_calls)}
          sub={`成功 ${fmtInt(o.ok_calls)}／失敗 ${fmtInt(o.error_calls)}／被擋下 ${fmtInt(o.blocked_calls)}`} />
        <Stat label="總成本(USD)" value={fmtUsd(o.cost_usd)}
          sub={`≈ ${fmtTwd(o.cost_usd)}(參考匯率 1 USD = ${TWD_PER_USD} TWD)`} />
        <Stat label="不重複使用者" value={fmtInt(o.distinct_users)} />
        <Stat label="不重複專案" value={fmtInt(o.distinct_projects)} />
      </div>
      <Card title="Token 用量">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            ['輸入 input', o.input_tokens],
            ['輸出 output', o.output_tokens],
            ['快取讀取 cache read', o.cache_read_tokens],
            ['快取寫入 cache write', o.cache_write_tokens],
          ].map(([label, v]) => (
            /* 標籤字級/色對齊 Stat(11px/text-2、無字距):同一頁不要有兩套數字標籤 */
            <div key={label} className="min-w-0">
              <div className="text-[11px] text-[var(--text-2)]">{label}</div>
              <div className="num text-lg font-normal text-[var(--text)] mt-0.5">{fmtInt(v)}</div>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="每日呼叫數">
          <DailyBars rows={daily} getV={(r) => Number(r.calls) || 0} fmt={fmtInt} barClass="bg-[var(--blue)]" />
        </Card>
        <Card title="每日成本(USD)">
          <DailyBars rows={daily} getV={(r) => Number(r.cost_usd) || 0} fmt={fmtUsd} barClass="bg-[var(--accent)]" />
        </Card>
      </div>
    </div>
  )
}

// 純 CSS 長條圖(不引入圖表套件):flex 尾端對齊,高度=佔最大值百分比,title 提示各日數值。
// 顏色走 class(呼叫端傳 barClass),只有高度這種逐列算出來的值才留在 inline style;
// 也不再壓 opacity——半透明長條疊在卡底上會讓兩張圖看起來不同色。
function DailyBars({ rows, getV, fmt, barClass }) {
  const max = Math.max(0, ...rows.map(getV))
  if (!rows.length || max <= 0) return <Empty>{EMPTY_MSG}</Empty>
  return (
    <div>
      <div className="flex items-end gap-[2px] h-36" role="img" aria-label={`每日長條圖,共 ${rows.length} 天,最高 ${fmt(max)}`}>
        {rows.map((r) => {
          const v = getV(r)
          return (
            <div key={r.day} title={`${r.day}:${fmt(v)}`}
              className={`flex-1 min-w-[3px] rounded-t-sm ${barClass}`}
              style={{ height: `${v > 0 ? Math.max((v / max) * 100, 2) : 0}%` }} />
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-[var(--text-3)] num mt-1.5">
        <span>{rows[0].day}</span>
        <span>最高 {fmt(max)}</span>
        <span>{rows[rows.length - 1].day}</span>
      </div>
    </div>
  )
}

// ── 分頁二:依功能 ───────────────────────────────────────────────────────────
function ByFeatureTab({ rows, loading, rangeKey }) {
  // 排序/分頁都是 client-side:admin RPC 一次回整段期間的彙總列,資料已在記憶體。
  // 佔總成本刻意用「全部列」算,不受排序與換頁影響——那是期間佔比,不是當頁佔比。
  const { sort, toggleSort, sorted, sortKey } = useTableSort(rows)
  // 換期間要回第 1 頁,但期間換了列數常常一樣(功能清單固定),光看列數看不出來,
  // 所以把 rangeKey 一起餵給 resetKey;手動重新整理(reloadKey)刻意不進來
  const { pageRows, pager } = usePagination(sorted, 25, `${rangeKey}|${sortKey}`)
  const totalCost = rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0)
  if (!rows.length) return loading ? <LoadingCard /> : <Card><Empty>{EMPTY_MSG}</Empty></Card>
  return (
    <Card bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[880px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={TH}>功能</th>
              <th className={TH}>分類</th>
              <SortableTh className={THR} align="right" numeric label="呼叫" field="calls" sort={sort} onSort={toggleSort} />
              <th className={THR}>失敗</th>
              <th className={THR}>被擋下</th>
              <SortableTh className={THR} align="right" numeric label="輸入" field="input_tokens" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="輸出" field="output_tokens" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="快取讀" field="cache_read_tokens" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="快取寫" field="cache_write_tokens" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="成本" field="cost_usd" sort={sort} onSort={toggleSort} />
              <th className={`${TH} min-w-[140px]`}>佔總成本</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const cat = featureByKey[r.feature_key]?.category
              const pct = pctOfTotal(r.cost_usd, totalCost)
              return (
                <tr key={r.feature_key} className={TR}>
                  <td className={TD}>
                    <div className="font-medium text-[var(--text)]">{r.label}</div>
                    <div className="text-[11px] text-[var(--text-3)] num">{r.feature_key}</div>
                  </td>
                  <td className={TD}>{cat && <Badge color={CATEGORY_COLOR[cat]}>{CATEGORY_LABEL[cat] || cat}</Badge>}</td>
                  <td className={TDR}>{fmtInt(r.calls)}</td>
                  <td className={`${TDR} ${Number(r.error_calls) > 0 ? 'text-[var(--red-text)]' : ''}`}>{fmtInt(r.error_calls)}</td>
                  <td className={`${TDR} ${Number(r.blocked_calls) > 0 ? 'text-[var(--amber-text)]' : ''}`}>{fmtInt(r.blocked_calls)}</td>
                  <td className={TDR}>{fmtInt(r.input_tokens)}</td>
                  <td className={TDR}>{fmtInt(r.output_tokens)}</td>
                  <td className={TDR}>{fmtInt(r.cache_read_tokens)}</td>
                  <td className={TDR}>{fmtInt(r.cache_write_tokens)}</td>
                  <td className={`${TDR} font-medium`}>{fmtUsd(r.cost_usd)}</td>
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden min-w-[60px]">
                        <div className="h-full rounded-full bg-[var(--blue)]" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <span className="num text-[11px] text-[var(--text-2)] w-11 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <TablePager {...pager} />
    </Card>
  )
}

// ── 分頁三:依專案 ───────────────────────────────────────────────────────────
function ByProjectTab({ rows, loading, rangeKey }) {
  const { sort, toggleSort, sorted, sortKey } = useTableSort(rows)
  const { pageRows, pager } = usePagination(sorted, 25, `${rangeKey}|${sortKey}`)
  if (!rows.length) return loading ? <LoadingCard /> : <Card><Empty>{EMPTY_MSG}</Empty></Card>
  return (
    <Card bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={TH}>專案</th>
              <th className={TH}>AI 方案</th>
              <SortableTh className={THR} align="right" numeric label="呼叫" field="calls" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="成本" field="cost_usd" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="輸入 token" field="input_tokens" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="輸出 token" field="output_tokens" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.project_id || 'none'} className={TR}>
                <td className={`${TD} font-medium text-[var(--text)]`}>
                  {r.project_name || <span className="text-[var(--text-3)] font-normal">(無專案脈絡或已刪除)</span>}
                </td>
                <td className={TD}>
                  {r.ai_plan && <Badge color={PLAN_COLOR[r.ai_plan]}>{PLAN_LABEL[r.ai_plan] || r.ai_plan}</Badge>}
                </td>
                <td className={TDR}>{fmtInt(r.calls)}</td>
                <td className={`${TDR} font-medium`}>{fmtUsd(r.cost_usd)}</td>
                <td className={TDR}>{fmtInt(r.input_tokens)}</td>
                <td className={TDR}>{fmtInt(r.output_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager {...pager} />
    </Card>
  )
}

// ── 分頁四:依使用者 ─────────────────────────────────────────────────────────
function ByUserTab({ rows, loading, rangeKey }) {
  const { sort, toggleSort, sorted, sortKey } = useTableSort(rows)
  const { pageRows, pager } = usePagination(sorted, 25, `${rangeKey}|${sortKey}`)
  if (!rows.length) return loading ? <LoadingCard /> : <Card><Empty>{EMPTY_MSG}</Empty></Card>
  return (
    <Card bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={TH}>使用者</th>
              <th className={TH}>公司</th>
              <th className={TH}>身分</th>
              <SortableTh className={THR} align="right" numeric label="呼叫" field="calls" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="成本" field="cost_usd" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.user_id || 'none'} className={TR}>
                <td className={`${TD} font-medium text-[var(--text)]`}>
                  {r.full_name || <span className="text-[var(--text-3)] font-normal">(帳號已刪除)</span>}
                </td>
                <td className={TD}>{r.company || '—'}</td>
                <td className={TD}>{r.org_type && <Badge color="slate">{ORG_LABEL[r.org_type] || r.org_type}</Badge>}</td>
                <td className={TDR}>{fmtInt(r.calls)}</td>
                <td className={`${TDR} font-medium`}>{fmtUsd(r.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager {...pager} />
    </Card>
  )
}

// ── 小元件:開關(toggle)────────────────────────────────────────────────────
// 焦點改 outline 方案與 ui.jsx Button 一致(W8-5):ring 直接畫在實心 pill 上
// checked 時幾乎看不出來,outline+offset 讓焦點環離開填色邊。
// 維持 <button role="switch">,不得換成 input[type=checkbox](監造唯讀 e2e 斷言依賴)。
function Toggle({ checked, disabled, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={onChange}
      className={`relative shrink-0 w-10 h-[22px] rounded-full transition-colors disabled:opacity-40 disabled:cursor-wait
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--blue)]
        ${checked ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'}`}>
      {/* M3 尺寸:軌 40×22、滑點 18 且上下左右各留 2 → 開啟位移 40−2−18−2 = 18px。
          滑點顏色走 token:開啟=--primary-fg(深色模式是深藍字色,配淺藍軌才看得見),
          關閉=--text-3(灰軌上的深/淺灰滑點,亮暗兩邊都有對比);寫死 bg-white 在深色模式會恆亮。 */}
      <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full [box-shadow:var(--shadow-card)] transition-transform
        ${checked ? 'translate-x-[18px] bg-[var(--primary-fg)]' : 'bg-[var(--text-3)]'}`} />
    </button>
  )
}

// ── 分頁五:AI 功能開關 ──────────────────────────────────────────────────────
function FeaturesTab({ features, setFeatures, loading, reload, setFeatureEnabled, setFeatureMinPlan }) {
  const [busyKey, setBusyKey] = useState(null)
  const [actionError, setActionError] = useState(null)

  // 依 category 分組(features 已依 sort_order 排序,分組後組內順序不變)
  const groups = useMemo(() => {
    const m = new Map()
    for (const f of features) {
      if (!m.has(f.category)) m.set(f.category, [])
      m.get(f.category).push(f)
    }
    return [...m.entries()]
  }, [features])

  // 切換:畫面先反映(控制元件不閃回舊值)→ 打 RPC → 整批重載以 DB 為準——
  // RPC 失敗時重載會把樂觀值還原,並顯示錯誤;kill switch 的真相永遠在 DB。
  const toggle = async (f) => {
    const next = !f.enabled
    setBusyKey(f.key); setActionError(null)
    setFeatures((rows) => rows.map((r) => (r.key === f.key ? { ...r, enabled: next } : r)))
    const { error } = await setFeatureEnabled(f.key, next)
    if (error) setActionError(`「${f.label}」開關切換失敗:${error.message}`)
    reload()
    setBusyKey(null)
  }
  const changeMinPlan = async (f, plan) => {
    setBusyKey(f.key); setActionError(null)
    setFeatures((rows) => rows.map((r) => (r.key === f.key ? { ...r, min_plan: plan } : r)))
    const { error } = await setFeatureMinPlan(f.key, plan)
    if (error) setActionError(`「${f.label}」方案門檻調整失敗:${error.message}`)
    reload()
    setBusyKey(null)
  }

  if (!features.length) return loading ? <LoadingCard /> : <Card><Empty>尚未載入功能註冊表。</Empty></Card>

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5 text-sm bg-[var(--blue-tint)] text-[var(--blue-text)] rounded-lg px-3.5 py-2.5">
        <MSym name="info" size={16} className="shrink-0 mt-0.5" />
        <span>關閉後,該功能在伺服器端就會被擋下（不是只把按鈕藏起來）;已在進行中的請求不受影響。專案級覆寫翻不過這裡的平台總開關。</span>
      </div>
      <ErrorBanner msg={actionError} onClose={() => setActionError(null)} />
      {groups.map(([cat, list]) => (
        <Card key={cat} title={`${CATEGORY_LABEL[cat] || cat}(${list.length})`} bodyClass="p-0">
          <div className="divide-y divide-[var(--border-2)]">
            {list.map((f) => (
              <div key={f.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="font-medium text-[var(--text)] flex items-center gap-2">
                    {f.label}
                    {!f.enabled && <Badge color="red">已停用</Badge>}
                  </div>
                  <div className="text-[11px] text-[var(--text-3)] num mt-0.5">
                    {f.key} → {f.edge_function}
                  </div>
                </div>
                <Badge color={f.is_llm ? 'purple' : 'slate'}>{f.is_llm ? 'LLM' : '非 LLM(僅計次)'}</Badge>
                <label className="flex items-center gap-2 text-xs text-[var(--text-3)]">
                  最低方案
                  <Select value={f.min_plan} disabled={busyKey === f.key}
                    onChange={(e) => changeMinPlan(f, e.target.value)}
                    className="!w-auto !py-1.5 text-sm" aria-label={`${f.label} 最低方案`}>
                    {PLANS.map((p) => <option key={p} value={p}>{PLAN_LABEL[p]} {p}</option>)}
                  </Select>
                </label>
                <div className="flex items-center gap-2">
                  {busyKey === f.key && <span className="text-xs text-[var(--text-3)]">處理中…</span>}
                  <Toggle checked={!!f.enabled} disabled={busyKey === f.key} onChange={() => toggle(f)}
                    label={`${f.label} 平台開關`} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── 分頁六:專案方案 ─────────────────────────────────────────────────────────
function ProjectsTab({ projects, setProjects, features, loading, reload, setProjectPlan, setProjectOverride, loadProjectOverrides }) {
  const [actionError, setActionError] = useState(null)
  const [busyProject, setBusyProject] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [overrides, setOverrides] = useState([]) // 展開中專案的覆寫明細
  const [overridesLoading, setOverridesLoading] = useState(false)
  const [busyFeature, setBusyFeature] = useState(null)

  const refreshOverrides = useCallback(async (projectId) => {
    setOverridesLoading(true)
    const { rows, error } = await loadProjectOverrides(projectId)
    setOverrides(rows)
    if (error) setActionError(error.message)
    setOverridesLoading(false)
  }, [loadProjectOverrides])

  const toggleExpand = (p) => {
    if (expandedId === p.project_id) { setExpandedId(null); return }
    setExpandedId(p.project_id)
    setOverrides([])
    refreshOverrides(p.project_id)
  }

  // 樂觀更新 → RPC → 重載以 DB 為準(失敗時重載會還原樂觀值,並顯示錯誤)
  const changePlan = async (p, plan) => {
    setBusyProject(p.project_id); setActionError(null)
    setProjects((rows) => rows.map((r) => (r.project_id === p.project_id ? { ...r, ai_plan: plan } : r)))
    const { error } = await setProjectPlan(p.project_id, plan)
    if (error) setActionError(`「${p.name}」方案調整失敗:${error.message}`)
    reload()
    setBusyProject(null)
  }

  // 三態:follow → p_enabled=null(刪除覆寫)、on → true、off → false
  const changeOverride = async (projectId, f, state) => {
    setBusyFeature(f.key); setActionError(null)
    const value = overrideToRpcValue(state)
    // 樂觀更新選單值(refreshOverrides 之後仍以 DB 為準)
    setOverrides((os) => {
      const rest = os.filter((o) => o.feature_key !== f.key)
      return value === null ? rest : [...rest, { feature_key: f.key, enabled: value }]
    })
    const { error } = await setProjectOverride(projectId, f.key, value)
    if (error) setActionError(`「${f.label}」覆寫設定失敗:${error.message}`)
    await refreshOverrides(projectId)
    reload() // 覆寫數(override_count)變了,專案列表一併重載
    setBusyFeature(null)
  }

  if (!projects.length) return loading ? <LoadingCard /> : <Card><Empty>目前沒有任何專案。</Empty></Card>

  const overrideMap = new Map(overrides.map((o) => [o.feature_key, o.enabled]))

  return (
    <div className="space-y-5">
      <ErrorBanner msg={actionError} onClose={() => setActionError(null)} />
      <Card bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className={TH}>專案</th>
                <th className={TH}>代號</th>
                <th className={TH}>AI 方案</th>
                <th className={THR}>覆寫數</th>
                <th className={THR}>近 30 日呼叫</th>
                <th className={THR}>近 30 日成本</th>
                <th className={`${TH} w-10`} aria-label="展開" />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const expanded = expandedId === p.project_id
                return (
                  <FragmentRow key={p.project_id}>
                    <tr className={`${TR} ${expanded ? 'bg-[var(--surface-2)]' : ''}`}>
                      <td className={`${TD} font-medium text-[var(--text)]`}>
                        <button onClick={() => toggleExpand(p)} className="flex items-center gap-1.5 max-md:min-h-11 text-left hover:text-[var(--blue-text)]"
                          aria-expanded={expanded}>
                          {expanded ? <MSym name="expand_more" size={14} /> : <MSym name="chevron_right" size={14} />}
                          {p.name}
                        </button>
                      </td>
                      <td className={`${TD} num text-[var(--text-2)]`}>{p.code || '—'}</td>
                      <td className={TD}>
                        <Select value={p.ai_plan} disabled={busyProject === p.project_id}
                          onChange={(e) => changePlan(p, e.target.value)}
                          className="!w-auto !py-1.5 text-sm" aria-label={`${p.name} AI 方案`}>
                          {PLANS.map((pl) => <option key={pl} value={pl}>{PLAN_LABEL[pl]} {pl}</option>)}
                        </Select>
                      </td>
                      <td className={TDR}>
                        {Number(p.override_count) > 0
                          ? <Badge color="amber">{p.override_count}</Badge>
                          : <span className="text-[var(--text-3)]">0</span>}
                      </td>
                      <td className={TDR}>{fmtInt(p.calls_30d)}</td>
                      <td className={`${TDR} font-medium`}>{fmtUsd(p.cost_30d)}</td>
                      <td className={TD} />
                    </tr>
                    {expanded && (
                      <tr className="border-b border-[var(--border-2)] bg-[var(--surface-2)]">
                        <td colSpan={7} className="px-5 pb-4 pt-1">
                          <div className="text-xs text-[var(--text-3)] mb-2">
                            逐功能覆寫:「跟隨方案」=依上方方案與功能門檻判定;「強制開啟/關閉」=無視門檻(但翻不過平台總開關)。
                          </div>
                          {overridesLoading ? (
                            <div className="text-sm text-[var(--text-3)] py-3">載入覆寫明細…</div>
                          ) : (
                            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1.5">
                              {features.map((f) => {
                                const state = overrideFromDb(overrideMap.get(f.key))
                                return (
                                  <div key={f.key} className="flex items-center gap-2 py-1 min-w-0">
                                    <span className="text-sm text-[var(--text)] truncate flex-1">{f.label}</span>
                                    {!f.enabled && <Badge color="red">平台已停用</Badge>}
                                    <Badge color={PLAN_COLOR[f.min_plan]}>{PLAN_LABEL[f.min_plan]}+</Badge>
                                    {/* max-md:!min-h-0:退掉 FIELD_BASE 的手機 44px——專案×功能矩陣是刻意壓縮的
                                        密集格,拉高會撐爆表格(W8-0 不重寫表格的已知例外;平台後台手機使用頻率低)。
                                        斷點必須跟手機層一致(max-md),寫成 max-sm 會讓 640-767 拿到手機版面+桌機尺寸。 */}
                                    <Select value={state} disabled={busyFeature === f.key}
                                      onChange={(e) => changeOverride(p.project_id, f, e.target.value)}
                                      className={`!w-auto !py-1 text-xs max-md:!min-h-0 ${state !== 'follow' ? 'font-medium' : ''}`}
                                      aria-label={`${p.name} 的 ${f.label} 覆寫`}>
                                      <option value="follow">跟隨方案</option>
                                      <option value="on">強制開啟</option>
                                      <option value="off">強制關閉</option>
                                    </Select>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// tbody 內一列+展開列的成對容器(React.Fragment 帶 key 的別名,讓上面 JSX 讀起來像表格結構)
function FragmentRow({ children }) {
  return <>{children}</>
}
