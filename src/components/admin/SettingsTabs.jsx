import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { MSym } from '../icons.jsx'
import { Card, Badge, Select, Empty, ErrorBanner } from '../ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { overrideToRpcValue, overrideFromDb } from '../../store/slices/admin.js'
import { LoadingCard, TR, TDR, TD, THR, TH, fmtUsd, fmtInt, PLAN_COLOR, PLAN_LABEL, CATEGORY_LABEL } from './shared.jsx'

const PLANS = ['trial', 'standard', 'pro']

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

export function FeaturesTab({ features, setFeatures, loading, reload, setFeatureEnabled, setFeatureMinPlan }) {
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
    if (error) setActionError(friendlyError(error, `「${f.label}」開關切換失敗`))
    reload()
    setBusyKey(null)
  }
  const changeMinPlan = async (f, plan) => {
    setBusyKey(f.key); setActionError(null)
    setFeatures((rows) => rows.map((r) => (r.key === f.key ? { ...r, min_plan: plan } : r)))
    const { error } = await setFeatureMinPlan(f.key, plan)
    if (error) setActionError(friendlyError(error, `「${f.label}」方案門檻調整失敗`))
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
                  <div className="text-caption text-[var(--text-3)] num mt-0.5">
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

export function ProjectsTab({ projects, setProjects, features, loading, reload, setProjectPlan, setProjectOverride, loadProjectOverrides }) {
  const [actionError, setActionError] = useState(null)
  const [busyProject, setBusyProject] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [overrides, setOverrides] = useState([]) // 展開中專案的覆寫明細
  const [overridesLoading, setOverridesLoading] = useState(false)
  const [busyFeature, setBusyFeature] = useState(null)
  const selection = useRef({ id: null, request: 0 })
  useEffect(() => () => { selection.current = { id: null, request: 0 } }, [])

  const refreshOverrides = useCallback(async (projectId) => {
    const context = selection.current
    if (context.id !== projectId) return
    const request = ++context.request
    setOverridesLoading(true)
    const { rows, error } = await loadProjectOverrides(projectId)
    if (selection.current !== context || context.request !== request) return
    setOverrides(rows)
    if (error) setActionError(friendlyError(error, '覆寫明細載入失敗'))
    setOverridesLoading(false)
  }, [loadProjectOverrides])

  const toggleExpand = (p) => {
    const next = expandedId === p.project_id ? null : p.project_id
    // 換專案後,前一個讀取或儲存的回應不能改新專案的覆寫選單。
    selection.current = { id: next, request: 0 }
    setExpandedId(next)
    setBusyFeature(null); setActionError(null)
    if (!next) return
    setOverrides([])
    refreshOverrides(p.project_id)
  }

  // 樂觀更新 → RPC → 重載以 DB 為準(失敗時重載會還原樂觀值,並顯示錯誤)
  const changePlan = async (p, plan) => {
    setBusyProject(p.project_id); setActionError(null)
    setProjects((rows) => rows.map((r) => (r.project_id === p.project_id ? { ...r, ai_plan: plan } : r)))
    const { error } = await setProjectPlan(p.project_id, plan)
    if (error) setActionError(friendlyError(error, `「${p.name}」方案調整失敗`))
    reload()
    setBusyProject(null)
  }

  // 三態:follow → p_enabled=null(刪除覆寫)、on → true、off → false
  const changeOverride = async (projectId, f, state) => {
    const context = selection.current
    setBusyFeature(f.key); setActionError(null)
    const value = overrideToRpcValue(state)
    // 樂觀更新選單值(refreshOverrides 之後仍以 DB 為準)
    setOverrides((os) => {
      const rest = os.filter((o) => o.feature_key !== f.key)
      return value === null ? rest : [...rest, { feature_key: f.key, enabled: value }]
    })
    const { error } = await setProjectOverride(projectId, f.key, value)
    if (selection.current !== context) { reload(); return }
    if (error) setActionError(friendlyError(error, `「${f.label}」覆寫設定失敗`))
    await refreshOverrides(projectId)
    reload() // 覆寫數(override_count)變了,專案列表一併重載
    if (selection.current === context) setBusyFeature(null)
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

function FragmentRow({ children }) {
  return <>{children}</>
}
