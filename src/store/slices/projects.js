// Projects slice:專案清單/目前專案/成員角色 + 標單工項(BOQ 脊椎)的載入與匯入。
// dbMode/demoMode 也在這裡導出(所有其他 slice 的寫入分流依據)。
import { useState, useCallback, useEffect, useMemo } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabase.js'
import { loadWorkItems } from '../../lib/boqCalc.js'
import { indexProjectMemberships } from '../../lib/projectIdentity.js'
import { deriveProjectModes } from '../../lib/projectMode.js'
import {
  normalizeProject, fetchAllWorkItems, wiCacheGet, wiCachePut, wiCacheDel, dbToWorkItems,
} from '../db.js'

export function useProjectsSlice({ currentUser, log }) {
  const [projects, setProjects] = useState([])
  const [currentProjectId, setCurrentProjectId] = useState(null)
  const [myMemberRoles, setMyMemberRoles] = useState({}) // { project_id: 'admin' | … }
  const [projectMembershipsByProject, setProjectMembershipsByProject] = useState({})
  const [projectLoading, setProjectLoading] = useState(isSupabaseConfigured)
  const currentProject = useMemo(
    () => projects.find((p) => p.project_id === currentProjectId) || null,
    [projects, currentProjectId],
  )
  const currentProjectMembership = useMemo(
    () => projectMembershipsByProject[currentProjectId] || null,
    [projectMembershipsByProject, currentProjectId],
  )
  const [workItems, setWorkItems] = useState(null)            // { items, meta }
  const [workItemsSource, setWorkItemsSource] = useState('sample') // 'db' | 'sample'

  // 切換目前專案（記住選擇，重整後沿用）
  const switchProject = useCallback((id) => {
    setCurrentProjectId(id)
    try { localStorage.setItem('pmis-current-project', id) } catch { /* noop */ }
  }, [])

  // 登入後載入此使用者的「所有」專案；選上次用的或第一個。
  // 同時取自己的成員角色(project_members.role)——admin(建立者)擁有完整權限。
  useEffect(() => {
    if (!isSupabaseConfigured) { setProjectLoading(false); return }
    if (!currentUser?.real) {
      setProjects([]); setCurrentProjectId(null); setMyMemberRoles({})
      setProjectMembershipsByProject({}); setProjectLoading(false); return
    }
    let active = true
    setProjectLoading(true)
    Promise.all([
      supabase.from('projects').select('*').order('created_at'),
      supabase.from('project_members').select('project_id, role').eq('user_id', currentUser.user_id),
      supabase.from('project_memberships')
        .select('id, project_id, project_party_id, project_role, is_project_admin, project_parties(party_type, display_name, is_active)')
        .eq('user_id', currentUser.user_id),
    ]).then(([{ data }, { data: legacyMemberships }, { data: projectMemberships }]) => {
      if (!active) return
      const list = (data || []).map(normalizeProject)
      setProjects(list)
      setMyMemberRoles(Object.fromEntries((legacyMemberships || []).map((m) => [m.project_id, m.role])))
      setProjectMembershipsByProject(indexProjectMemberships(projectMemberships || []))
      const saved = (() => { try { return localStorage.getItem('pmis-current-project') } catch { return null } })()
      const pick = list.find((p) => p.project_id === saved) || list[0] || null
      setCurrentProjectId(pick?.project_id || null)
      setProjectLoading(false)
    })
    return () => { active = false }
  }, [currentUser])

  // 載入標單工項：有真專案且 DB 有資料 → 讀 DB；否則 fallback 範例 JSON。
  // 先打「筆數」head 查詢（幾乎零流量）驗證本地快取，命中就不重新下載整份標單；
  // 依賴用 project_id（字串）而非物件參考，避免專案清單重載時無謂重抓。
  useEffect(() => {
    let active = true
    ;(async () => {
      setWorkItems(null)
      if (isSupabaseConfigured && currentProject) {
        const pid = currentProject.project_id
        try {
          const { count, error } = await supabase.from('work_items')
            .select('id', { count: 'exact', head: true }).eq('project_id', pid)
          if (error) throw error
          if (count) {
            const cached = await wiCacheGet(pid)
            let rows = cached && cached.length === count ? cached : null
            if (!rows) { rows = await fetchAllWorkItems(pid); wiCachePut(pid, rows) }
            if (!active) return
            setWorkItems(dbToWorkItems(rows, currentProject)); setWorkItemsSource('db'); return
          }
        } catch { /* 落到範例 */ }
      }
      const json = await loadWorkItems()
      if (!active) return
      setWorkItems({ items: json.items, meta: json.meta })
      setWorkItemsSource('sample')
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.project_id])

  // 工項查表（item_key↔work_item uuid）+ 是否走真 DB（估驗/進度才寫回 DB）
  const wiMaps = useMemo(() => {
    const byKey = new Map(), idToKey = new Map(), byId = new Map()
    if (workItems) for (const it of workItems.items) {
      byKey.set(it.item_key, it)
      if (it.id) { idToKey.set(it.id, it.item_key); byId.set(it.id, it) }
    }
    return { byKey, idToKey, byId }
  }, [workItems])
  const { isPersistedProject, hasDbBoq } = deriveProjectModes({
    isSupabaseConfigured, currentUser, currentProject, workItemsSource,
  })
  const dbMode = hasDbBoq
  // demo 模式：未設 Supabase → 全站用 demoSeed storyline，寫入只進記憶體
  const demoMode = !isSupabaseConfigured

  // 透過 SECURITY DEFINER RPC 建立專案（繞過 projects insert RLS、自動加建立者為成員）
  const createProject = useCallback(async (input) => {
    const { data, error } = await supabase.rpc('create_project', {
      p_name: input.project_name, p_code: input.project_code, p_owner: input.owner_name,
      p_contractor: input.contractor_name, p_supervisor: input.supervisor_name,
      p_location: input.location, p_start: input.start_date || null, p_end: input.end_date || null,
    })
    if (!error && data) {
      const np = normalizeProject(data)
      // The project-creation trigger has already dual-written both membership
      // models. Load that identity before selecting the project so Contract
      // package permissions are correct immediately, without a page refresh.
      const [{ data: scopedRows }, { data: legacyRows }] = await Promise.all([
        supabase.from('project_memberships')
          .select('id, project_id, project_party_id, project_role, is_project_admin, project_parties(party_type, display_name, is_active)')
          .eq('project_id', np.project_id).eq('user_id', currentUser?.user_id).limit(1),
        supabase.from('project_members').select('project_id, role')
          .eq('project_id', np.project_id).eq('user_id', currentUser?.user_id).limit(1),
      ])
      setProjects((prev) => [...prev, np])
      if (scopedRows?.length) {
        const indexed = indexProjectMemberships(scopedRows)
        setProjectMembershipsByProject((prev) => ({ ...prev, ...indexed }))
      }
      if (legacyRows?.length) {
        setMyMemberRoles((prev) => ({ ...prev, [np.project_id]: legacyRows[0].role }))
      }
      setCurrentProjectId(np.project_id)
      try { localStorage.setItem('pmis-current-project', np.project_id) } catch { /* noop */ }
    }
    return { error }
  }, [currentUser])

  // 匯入標單工項到此專案的 work_items（client 端產 uuid 維持父子關係，分批寫入）。
  // parsed = 上傳 XML 解析結果 { items }；未帶則用內建範例（國際原住民標單）。
  const importWorkItems = useCallback(async (parsed) => {
    if (!currentProject) return { error: { message: '尚無專案' } }
    const data = parsed || await loadWorkItems()
    const idMap = new Map()
    for (const it of data.items) idMap.set(it.item_key, crypto.randomUUID())
    const rows = data.items.map((it) => ({
      id: idMap.get(it.item_key), project_id: currentProject.project_id,
      parent_id: it.parent_key ? idMap.get(it.parent_key) : null,
      item_key: it.item_key, item_no: it.item_no, ref_item_code: it.ref_item_code,
      item_kind: it.item_kind, description: it.description, unit: it.unit,
      quantity: it.quantity, unit_price: it.unit_price, amount: it.amount,
      section: it.section, depth: it.depth, sort_order: it.sort_order,
      is_leaf: it.is_leaf, is_rollup: it.is_rollup,
      is_price_adjustable: it.is_price_adjustable, is_billable: it.is_billable,
      weight: it.weight, remark: it.remark,
    })).sort((a, b) => a.sort_order - b.sort_order) // 父先於子，避免 FK 違反
    const size = 500
    for (let i = 0; i < rows.length; i += size) {
      const { error } = await supabase.from('work_items').insert(rows.slice(i, i + size))
      if (error) return { error }
    }
    const fresh = await fetchAllWorkItems(currentProject.project_id)
    wiCachePut(currentProject.project_id, fresh)
    setWorkItems(dbToWorkItems(fresh, currentProject))
    setWorkItemsSource('db')
    log('匯入標單工項', `${rows.length} 項`, { user: currentUser?.name || '系統', role: '施工品管' })
    return { error: null, count: rows.length }
  }, [currentProject, currentUser, log])

  // 基準日(決標/接獲通知/開工)→ 寫回 projects 欄位 + 本地
  const updateProjectAnchors = useCallback(async (patch) => {
    if (!isPersistedProject) return { error: { message: '需真專案' } }
    const pid = currentProject.project_id
    setProjects((ps) => ps.map((p) => (p.project_id === pid ? { ...p, ...patch } : p)))
    const { error } = await supabase.from('projects').update(patch).eq('id', pid)
    return { error }
  }, [isPersistedProject, currentProject])

  // 刪除專案（RPC，security definer 連同所有相依資料一併刪）
  const deleteProject = useCallback(async (id) => {
    const { error } = await supabase.rpc('delete_project', { p_id: id })
    if (error) return { error }
    wiCacheDel(id)
    setProjects((prev) => {
      const next = prev.filter((p) => p.project_id !== id)
      if (currentProjectId === id) {
        const pick = next[0]?.project_id || null
        setCurrentProjectId(pick)
        try { pick ? localStorage.setItem('pmis-current-project', pick) : localStorage.removeItem('pmis-current-project') } catch { /* noop */ }
      }
      return next
    })
    return { error: null }
  }, [currentProjectId])

  // 跨案總覽:一支 RPC 撈回所有專案的彙總(金額/估驗/缺失/查驗/變更/驗收事件)
  const loadPortfolio = useCallback(async () => {
    const { data, error } = await supabase.rpc('portfolio_summary')
    return { rows: data || [], error }
  }, [])

  // 登出時的專案側清理(由 store.jsx 的 logout 呼叫)
  const clearOnLogout = useCallback(() => {
    setProjects([]); setCurrentProjectId(null); setMyMemberRoles({})
    setProjectMembershipsByProject({})
  }, [])

  return {
    projects, setProjects, currentProjectId, currentProject, myMemberRoles,
    projectMembershipsByProject, currentProjectMembership, projectLoading,
    workItems, setWorkItems, workItemsSource, setWorkItemsSource, wiMaps,
    isPersistedProject, hasDbBoq, dbMode, demoMode,
    switchProject, createProject, importWorkItems, updateProjectAnchors, deleteProject, clearOnLogout,
    loadPortfolio,
  }
}
