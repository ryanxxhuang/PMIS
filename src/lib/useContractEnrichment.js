// 契約重點的出處 enrich:履約時程(/requirements)與擷取審核(/requirements/review)
// 原本各自抄了一份同樣的五段查詢(document_ingestion_runs → requirements →
// requirement_sources → document_versions(+documents) → contract_packages)與同樣
// 的 Map 組裝,收斂到這一支。
//
// 為什麼是 hook 不是 store slice(DEVELOPMENT.md §3 第 3 條「跨頁共享資料才進 Store」):
// 1. 三頁共用的是「查詢配方」不是「同一份狀態」——履約時程只要義務掛的那些
//    requirement、擷取審核要全案、專案文件頁要單一契約包的處理 run。進 store 就得
//    在切換專案時替所有頁面載入最大集合(全案 requirements + 全部出處),或在 slice
//    裡養三套 loader;兩者都比各頁按需載入貴,而且沒進契約頁的使用者也要付這筆錢。
// 2. 擷取審核在 RPC 回列後就地換列(patch),不重載整組——store 沒有這種局部寫回
//    語意(obligations 是整份重載),硬搬進去要新造一套 mutator 與失效規則。
// 3. 分析進行中每 5 秒輪詢是頁面行為,進 store 會變成全站輪詢。
// 所以:單頁掛載時載入、離開即丟,跨頁不共用快取——與改版前兩頁各自載入的成本相同。
//
// ⚠️ 下一波 Contract.jsx(專案文件頁)接上時:它的脊椎是 document_processing_runs
// (依契約包查),再反向拉 documents → document_versions → document_ingestion_runs;
// 能共用的是 packageOf/runsById/versionsById 的形狀與涵蓋率警示的輸入,不是整支
// hook——不要為了「三頁共用」硬把它塞成同一條查詢。
//
// 載入語意(兩頁原本一致,保留):
// - 切換專案 → 資料清空、loaded=false;同案重載(輪詢、義務集合變動、reload())
//   → 保留舊資料只翻 loaded,畫面不閃骨架。
// - 只暴露「目前 pid」的資料:切案後到 effect 落地前的那一次 render 也拿不到他案
//   資料(改版前兩頁在那一格會用舊案列做初次選取,現在不會)。
// - demo(enabled=false)不打 DB,loaded 直接 true、資料全空。
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './supabase.js'
import { pageAllSafe, pageAllInSafe } from './pagedQuery.js'
import { friendlyError } from './errorMessage.js'

const EMPTY = Object.freeze({
  rows: [], sourcesByReq: new Map(), versionsById: new Map(), runs: [], packages: [], reviewersById: new Map(),
})
const LOADING = Object.freeze({ ...EMPTY, loaded: false, error: '' })

const noRows = { data: [], error: null }
const sourcesFor = (ids) => (ids.length
  ? pageAllInSafe(ids, (chunk, from, to) => supabase.from('requirement_sources')
    .select('*').in('requirement_id', chunk).order('id').range(from, to))
  : noRows)

// idsKey:'all'=全案;否則是排序去重後以逗號相接的 requirement id 清單
// (字串當 effect 依賴,義務陣列換 identity 但 id 集合沒變就不重抓)。
async function loadEnrichment(pid, { idsKey, reviewers }) {
  const ids = idsKey === 'all' ? null : (idsKey ? idsKey.split(',') : [])
  const [runRes, reqRes, packageRes, srcEarly] = await Promise.all([
    pageAllSafe((from, to) => supabase.from('document_ingestion_runs')
      // error_message/metadata:失敗揭露與涵蓋率警示;model_name/prompt_version:詳情追溯行
      .select('id, document_version_id, status, started_at, completed_at, model_name, prompt_version, error_message, metadata')
      .eq('project_id', pid).order('started_at', { ascending: false }).order('id').range(from, to)),
    ids === null
      ? pageAllSafe((from, to) => supabase.from('requirements').select('*')
        .eq('project_id', pid).order('created_at', { ascending: false }).order('id').range(from, to))
      : (ids.length
        ? pageAllInSafe(ids, (chunk, from, to) => supabase.from('requirements').select('*')
          .in('id', chunk).order('id').range(from, to))
        : noRows),
    pageAllSafe((from, to) => supabase.from('contract_packages').select('id, title, package_type')
      .eq('project_id', pid).order('created_at').order('id').range(from, to)),
    // 指定 id 時出處可與 requirements 並行(少一趟往返);全案要先拿到列才知道 id
    ids === null ? null : sourcesFor(ids),
  ])
  for (const r of [runRes, reqRes, packageRes]) if (r.error) throw r.error
  const runs = runRes.data || []
  const rows = reqRes.data || []
  // 一則需求可有多筆出處:300 則需求的出處合計會破單次上限,要分批 + 分頁
  const srcRes = srcEarly || await sourcesFor(rows.map((r) => r.id))
  if (srcRes.error) throw srcRes.error
  const sourcesByReq = new Map()
  for (const s of srcRes.data || []) {
    if (!sourcesByReq.has(s.requirement_id)) sourcesByReq.set(s.requirement_id, [])
    sourcesByReq.get(s.requirement_id).push(s)
  }
  const versionIds = [...new Set([
    ...(srcRes.data || []).map((s) => s.document_version_id),
    ...runs.map((r) => r.document_version_id),
  ].filter(Boolean))]
  let versions = []
  if (versionIds.length) {
    // storage 欄位:詳情的「開啟原文」直接開原始檔並跳到出處頁(documentFileAccess)
    const vRes = await pageAllInSafe(versionIds, (chunk, from, to) => supabase.from('document_versions')
      .select('id, version_label, storage_path, original_filename, mime_type, documents(title, document_type, contract_package_id)')
      .in('id', chunk).order('id').range(from, to))
    if (vRes.error) throw vRes.error
    versions = vRes.data || []
  }
  // 審查人名(核定紀錄要可歸責到人):profiles 只授權明確欄位,且 RLS 限同案成員
  // ——讀不到就退回「狀態+時間」,不擋頁面
  let profiles = []
  if (reviewers) {
    const reviewerIds = [...new Set(rows.map((r) => r.reviewed_by).filter(Boolean))]
    if (reviewerIds.length) {
      const pRes = await pageAllInSafe(reviewerIds, (chunk, from, to) => supabase.from('profiles')
        .select('id, full_name, company').in('id', chunk).order('id').range(from, to))
      if (!pRes.error) profiles = pRes.data || []
    }
  }
  return {
    rows, sourcesByReq, runs,
    versionsById: new Map(versions.map((v) => [v.id, v])),
    packages: packageRes.data || [],
    reviewersById: new Map(profiles.map((p) => [p.id, p])),
  }
}

// requirementIds:'all' 或 requirement id 陣列(可含 null/重複,這裡自己清)。
// reviewers:是否連審查人 profiles 一起拉(只有審核頁要)。
export function useContractEnrichment({ pid, enabled, requirementIds = 'all', reviewers = false }) {
  const idsKey = useMemo(
    () => (requirementIds === 'all' ? 'all' : [...new Set(requirementIds.filter(Boolean))].sort().join(',')),
    [requirementIds],
  )
  const [key, setKey] = useState(0)
  const reload = useCallback(() => setKey((k) => k + 1), [])
  const [state, setState] = useState({ ...LOADING, projectId: undefined })

  useEffect(() => {
    if (!enabled || !pid) {
      setState((s) => (s.loaded && s.projectId === pid && !s.error ? s : { ...EMPTY, projectId: pid, loaded: true, error: '' }))
      return undefined
    }
    let active = true
    setState((s) => ({ ...(s.projectId === pid ? s : EMPTY), projectId: pid, loaded: false, error: '' }))
    ;(async () => {
      try {
        const data = await loadEnrichment(pid, { idsKey, reviewers })
        if (active) setState({ ...data, projectId: pid, loaded: true, error: '' })
      } catch (error) {
        if (active) setState((s) => ({ ...s, projectId: pid, loaded: true, error: friendlyError(error, '契約重點與出處載入失敗') }))
      }
    })()
    return () => { active = false }
  }, [enabled, pid, idsKey, reviewers, key])

  // 就地寫回(審核頁 RPC 回列後換列、手動補登後插列):updater 回傳要覆蓋的欄位
  const patch = useCallback((updater) => setState((s) => ({ ...s, ...updater(s) })), [])

  const view = state.projectId === pid ? state : LOADING
  const reqById = useMemo(() => new Map(view.rows.map((r) => [r.id, r])), [view.rows])
  const runsById = useMemo(() => new Map(view.runs.map((r) => [r.id, r])), [view.runs])
  return {
    rows: view.rows, reqById, sourcesByReq: view.sourcesByReq, versionsById: view.versionsById,
    runs: view.runs, runsById, packages: view.packages, reviewersById: view.reviewersById,
    loaded: view.loaded, error: view.error, reload, patch,
  }
}
