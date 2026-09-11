// 平台管理:頁面負責資料載入;用量與設定分頁各自呈現。RPC 負責真正授權。
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useStore } from '../../store.jsx'
import { Card, PageHeader, Input, Empty, ErrorBanner } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { presetRange, customRange } from '../../store/slices/admin.js'
import { CHIP_BASE, CHIP_ON, CHIP_OFF } from '../../components/PageTabs.jsx'
import { OverviewTab, ByFeatureTab, ByProjectTab, ByUserTab } from '../../components/admin/UsageTabs.jsx'
import { FeaturesTab, ProjectsTab } from '../../components/admin/SettingsTabs.jsx'

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
      const fail = (e) => { if (active && e) setLoadError(friendlyError(e, '用量資料載入失敗')) }
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
