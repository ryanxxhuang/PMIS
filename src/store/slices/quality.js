// Quality slice:三級品管——查驗/缺失、自主檢查表(量化標準自動判定)、取樣試驗(齡期追蹤)。
// 缺失=統一缺失引擎(domain: quality|safety,QA §9-4):不依賴標單 → 走 isPersistedProject
// (工安缺失在匯標單前也要進 DB,否則只進記憶體=假成功);查驗掛工項 → 維持 dbMode。
import { useState, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase.js'
import { deriveTestSampleUpdate, shouldCreateTestSampleDefect, sampleDues, pendingSamplesFromLogs } from '../../lib/qc.js'
import { TEMPLATE_03310 } from '../../data/checklist03310.js'
import { loadQualityFromDB, loadDefectsFromDB } from '../db.js'
import { taipeiToday } from '../../lib/dates.js'
import { mutationOutcome } from './billing.js'

export function useQualitySlice({ dbMode, isPersistedProject, currentProject, currentUser, wiMaps, saveMarkup }, siteLogs) {
  // 品質：查驗 + 缺失（真 DB）
  const [inspections, setInspections] = useState([])
  const [defects, setDefects] = useState([])
  // 品管:自主檢查表範本/紀錄、取樣試驗試體
  const [checklistTemplates, setChecklistTemplates] = useState([])
  const [checklistRecords, setChecklistRecords] = useState([])
  const [testSamples, setTestSamples] = useState([])
  // ITP 檢驗停留點(W/H/R;狀態由連結查驗推導,見 lib/itp.js)
  const [inspectionPoints, setInspectionPoints] = useState([])

  // 載入層失敗會 throw(B-09);這裡是「寫入成功後的重載」——重載失敗不可把
  // 成功的寫入偽裝成錯誤,保留現況即可(下次進頁會重載補齊)。
  const reloadQuality = useCallback(async () => {
    try {
      const qual = await loadQualityFromDB(currentProject.project_id, wiMaps.byId)
      setInspections(qual.inspections); setDefects(qual.defects)
    } catch { /* 保留現況 */ }
  }, [currentProject, wiMaps])

  // 缺失單獨重載(缺失不依賴標單;匯標單前 wiMaps 為空,工項欄位留白即可)
  const reloadDefects = useCallback(async () => {
    try { setDefects(await loadDefectsFromDB(currentProject.project_id, wiMaps.byId)) } catch { /* 保留現況 */ }
  }, [currentProject, wiMaps])

  const createInspection = useCallback(async (input) => {
    const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
    // 回傳新 id:頁面送出成功後直接選中這一筆(UIUX 階段 3B)
    if (!dbMode) {
      const id = `INSP-${Date.now()}`
      setInspections((is) => [{
        id, title: input.title, location: input.location || null,
        inspection_type: input.inspection_type || '施工查驗',
        requested_date: input.requested_date || null, status: '待查驗', result_note: null,
        // 檢附自主檢查表(S-2):單向引用第一級證據,demo 與真 DB 同欄名才不會雙引擎漂移
        checklist_record_id: input.checklist_record_id || null,
        // 申報數量／查驗階段(P3c):監造查驗表單的確認量以此為上限與階段(真 DB 由 guard 正規化單位／批次鍵)
        declared_qty: input.declared_qty === '' || input.declared_qty == null ? null : Number(input.declared_qty),
        stage_key: input.stage_key || null, unit: wi?.unit || null, work_item_key: wi?.item_key || null,
        work_item_no: wi?.item_no || '', work_item_desc: wi?.description || '',
      }, ...is])
      return { error: null, id }
    }
    const { data, error } = await supabase.from('inspections').insert({
      project_id: currentProject.project_id, work_item_id: wi?.id || null,
      title: input.title, location: input.location || null,
      inspection_type: input.inspection_type || '施工查驗',
      requested_date: input.requested_date || null,
      // 檢附自主檢查表(S-2):只在申請時掛上,查驗結果不回寫檢查紀錄(單向)
      checklist_record_id: input.checklist_record_id || null,
      // 申報數量／查驗階段(P3c):guard 正規化並由工項帶單位;已判定後不可改
      declared_qty: input.declared_qty === '' || input.declared_qty == null ? null : Number(input.declared_qty),
      stage_key: input.stage_key || null,
      requested_by: currentUser?.user_id, status: '待查驗',
    }).select('id').single()
    if (error) return { error }
    await reloadQuality()
    return { error: null, id: data?.id }
  }, [dbMode, currentProject, currentUser, wiMaps, reloadQuality])

  // 查驗判定(合格／部分合格／不合格＋本次確認數量)只由監造查驗表單簽署寫入(P3c;fieldDocs slice 的
  // signFieldDocument → sign_field_document);P6b-3 起「快速判定」直接改 status 的路徑退場,DB 也收回了
  // authenticated 對 inspections 的 UPDATE(migration 20260920030000)。不合格的缺失由 DB 在簽署交易內開立。

  // 開立缺失(統一引擎):domain 分品質/工安;工安缺失可在匯標單前寫入(isPersistedProject)
  const createDefect = useCallback(async (input) => {
    const domain = input.domain || 'quality'
    const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
    const markup_path = await saveMarkup(input.markup_data, 'defect')
    if (!isPersistedProject) {
      setDefects((ds) => {
        if (input.test_sample_id && !shouldCreateTestSampleDefect(ds, input.test_sample_id)) return ds
        return [{
          id: `DEF-${Date.now()}`, domain, title: input.title, description: input.description || null,
          severity: input.severity || '一般', location: input.location || null,
          due_date: input.due_date || null, record_date: input.record_date || null,
          status: '開立', improvement_note: null, markup_path,
          source_checklist_record_id: input.source_checklist_record_id || null,
          test_sample_id: input.test_sample_id || null,
          work_item_no: wi?.item_no || '', work_item_desc: wi?.description || '',
        }, ...ds]
      })
      return { error: null }
    }
    const { error } = await supabase.from('defects').insert({
      project_id: currentProject.project_id, work_item_id: wi?.id || null,
      domain, title: input.title, description: input.description || null,
      severity: input.severity || '一般', location: input.location || null,
      due_date: input.due_date || null, record_date: input.record_date || null,
      status: '開立', created_by: currentUser?.user_id, markup_path,
      source_checklist_record_id: input.source_checklist_record_id || null,
      test_sample_id: input.test_sample_id || null,
    })
    if (error) return { error }
    await reloadDefects()
    return { error: null }
  }, [isPersistedProject, currentProject, currentUser, wiMaps, saveMarkup, reloadDefects])

  // 缺失狀態推進：開立 → 改善中 → 待複查 → 已結案;撤銷結案須附 correction_reason(留稽核)
  const updateDefectStatus = useCallback(async (defectId, status, extra = {}) => {
    const patch = { status }
    if (extra.improvement_note !== undefined) patch.improvement_note = extra.improvement_note
    if (extra.correction_reason !== undefined) patch.correction_reason = extra.correction_reason
    if (status === '已結案') patch.closed_at = new Date().toISOString()
    if (!isPersistedProject) {
      setDefects((ds) => ds.map((d) => (d.id === defectId ? { ...d, ...patch } : d)))
      return { error: null }
    }
    const res = await supabase.from('defects').update(patch).eq('id', defectId).select('id')
    const { error } = mutationOutcome(res, '未寫入:可能無權限或缺失已被移除')
    if (error) return { error }
    await reloadDefects()
    return { error: null }
  }, [isPersistedProject, reloadDefects])

  // DB 成功才移除(已判定查驗=品質證據,DB delete guard 會擋)
  const deleteInspection = useCallback(async (id) => {
    if (dbMode) {
      const res = await supabase.from('inspections').delete().eq('id', id).select('id')
      const { error } = mutationOutcome(res, '刪除被拒絕:查驗已判定或無權限')
      if (error) return { error }
      await reloadQuality()
      return { error: null }
    }
    setInspections((is) => is.filter((i) => i.id !== id))
    return { error: null }
  }, [dbMode, reloadQuality])

  // 刪除缺失:DB 刪成功才從 UI 移除(已結案由 guard 擋下,不可假消失)
  const deleteDefect = useCallback(async (id) => {
    if (isPersistedProject) {
      const res = await supabase.from('defects').delete().eq('id', id).select('id')
      const { error } = mutationOutcome(res, '刪除被拒絕:可能無權限或缺失已被移除')
      if (error) return { error }
    }
    setDefects((ds) => ds.filter((d) => d.id !== id))
    return { error: null }
  }, [isPersistedProject])

  // ── 品管自動化:自主檢查表(量化標準自動判定) + 取樣試驗(齡期追蹤) ─────────
  // 可用範本 = 專案範本 ∪ 內建 03310(尚無同源範本時顯示;首次使用才落 DB)
  const allChecklistTemplates = useMemo(() => {
    if (checklistTemplates.some((t) => t.source === TEMPLATE_03310.source)) return checklistTemplates
    return [{ id: TEMPLATE_03310.key, ...TEMPLATE_03310, builtin: true }, ...checklistTemplates]
  }, [checklistTemplates])

  // 內建範本(builtin 03310)首次使用才落 DB:檢查表紀錄與自檢表文件(P3b)都掛本案 checklist_templates 的 id,
  // 同一條規則只在這裡。demo 模式／已在 DB 的範本原樣回傳。
  const ensureChecklistTemplate = useCallback(async (template) => {
    if (!template) return { error: { message: '請先選擇檢查表範本' } }
    if (!dbMode || !template.builtin) return { error: null, template }
    const { data: t, error } = await supabase.from('checklist_templates').insert({
      project_id: currentProject.project_id, title: template.title, source: template.source,
      items: template.items, created_by: currentUser?.user_id,
    }).select().single()
    if (error) return { error }
    setChecklistTemplates((ts) => [...ts, t])
    return { error: null, template: t }
  }, [dbMode, currentProject, currentUser])

  // 自主檢查紀錄(checklist_records)只由自主檢查表文件簽署寫入(P3b;首簽 Rev.0、簽後更正 Rev.N,判定由 DB 依範本
  // 量化標準重算、不合格由 DB trigger 同交易開缺失)。P6b-3 起品質頁的「直接登錄／修訂／刪除未判定」與 Agent 查驗草稿
  // 的直接存檔都已退場,DB 收回了 authenticated 對 checklist_records 的 INSERT／UPDATE／DELETE(migration 20260920030000)。

  // 建立試體組(手動或由日誌帶入);自動算 7/28 天到期日
  const createTestSamples = useCallback(async (rows) => {
    const prepared = rows.map((r) => ({
      sample_no: r.sample_no || `TS-${(r.sampled_date || '').replaceAll('-', '')}`,
      test_item: r.test_item || '混凝土抗壓', fc: r.fc ?? null,
      sampled_date: r.sampled_date, location: r.location || null, cylinders: r.cylinders ?? 6,
      ...sampleDues(r.sampled_date), d7_value: null, d28_values: null, status: '待試驗', note: r.note || null,
    }))
    if (!dbMode) {
      const stamp = Date.now()
      setTestSamples((ss) => [...prepared.map((p, i) => ({ ...p, id: `TS-${stamp}-${i}` })), ...ss]
        .sort((a, b) => b.sampled_date.localeCompare(a.sampled_date)))
      return { error: null, count: prepared.length }
    }
    const { data, error } = await supabase.from('test_samples')
      .insert(prepared.map((p) => ({ ...p, project_id: currentProject.project_id, created_by: currentUser?.user_id })))
      .select()
    if (error) return { error }
    setTestSamples((ss) => [...data, ...ss].sort((a, b) => b.sampled_date.localeCompare(a.sampled_date)))
    return { error: null, count: data.length }
  }, [dbMode, currentProject, currentUser])

  // 掃施工日誌(材料含混凝土) → 補建缺漏的取樣組
  const generateSamplesFromLogs = useCallback(async () => {
    const pending = pendingSamplesFromLogs(siteLogs, testSamples)
    if (!pending.length) return { error: null, count: 0 }
    return createTestSamples(pending)
  }, [siteLogs, testSamples, createTestSamples])

  // 更新試體(填 7 天參考值 / 28 天各試體值)。
  // 真專案:判定與自動開缺失已下沉 DB trigger(同一交易;R3 P0-02 前端三步非交易
  // 會被 reload 蓋掉/半套落庫)——這裡只寫值,成功後 reload 取回導出的狀態與缺失。
  // demo:維持本地 judgeConcrete + 本地開缺失。
  const updateTestSample = useCallback(async (id, patch) => {
    if (!dbMode) {
      const current = testSamples.find((s) => s.id === id)
      if (!current) return { error: null }
      const { sample: merged, judgement } = deriveTestSampleUpdate(current, patch)
      setTestSamples((ss) => ss.map((s) => (s.id === id ? merged : s)))
      if (judgement?.status === '不合格') {
        await createDefect({
          title: `試體抗壓不合格：${merged.sample_no}`,
          description: `28天抗壓 平均 ${Math.round(judgement.avg)} / 最低 ${Math.round(judgement.min)} kgf/cm²，未達 fc′ ${merged.fc}（標準：任一 ≥0.85fc′ 且平均 ≥fc′）`,
          severity: '嚴重', location: merged.location || '', test_sample_id: merged.id,
        })
      }
      return { error: null }
    }
    const res = await supabase.from('test_samples').update(patch).eq('id', id).select('id')
    const { error } = mutationOutcome(res, '試驗值未寫入:可能無權限或試體已被移除')
    if (error) return { error }
    await reloadQuality() // 取回 trigger 推導的狀態 + 自動開立的缺失
    return { error: null }
  }, [dbMode, testSamples, createDefect, reloadQuality])

  // DB 成功才移除(已判定試體=品質證據,DB delete guard 會擋)
  const deleteTestSample = useCallback(async (id) => {
    if (dbMode) {
      const res = await supabase.from('test_samples').delete().eq('id', id).select('id')
      const { error } = mutationOutcome(res, '刪除被拒絕:試體已判定或無權限')
      if (error) return { error }
    }
    setTestSamples((ss) => ss.filter((s) => s.id !== id))
    return { error: null }
  }, [dbMode])

  // ── ITP 停留點:建立/更新/刪除 + 從停留點一鍵申請查驗 ────────────────────
  const createInspectionPoint = useCallback(async (input) => {
    const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
    const row = {
      point_type: input.point_type || 'H', title: input.title,
      acceptance_criteria: input.acceptance_criteria || null,
      frequency: input.frequency || null, source_clause: input.source_clause || null,
      sort_order: input.sort_order ?? null,
    }
    if (!dbMode) {
      setInspectionPoints((ps) => [...ps, {
        ...row, id: `ITP-${Date.now()}`, inspection_id: null,
        work_item_key: wi?.item_key || null, work_item_no: wi?.item_no || '', work_item_desc: wi?.description || '',
      }])
      return { error: null }
    }
    const { data, error } = await supabase.from('inspection_points')
      .insert({ ...row, project_id: currentProject.project_id, work_item_id: wi?.id || null, created_by: currentUser?.user_id })
      .select().single()
    if (error) return { error }
    setInspectionPoints((ps) => [...ps, {
      ...data, work_item_key: wi?.item_key || null, work_item_no: wi?.item_no || '', work_item_desc: wi?.description || '',
    }])
    return { error: null }
  }, [dbMode, currentProject, currentUser, wiMaps])

  // DB 刪成功才從 UI 移除(B-07:原本樂觀移除,RLS 拒絕時假消失)
  const deleteInspectionPoint = useCallback(async (id) => {
    if (dbMode) {
      const res = await supabase.from('inspection_points').delete().eq('id', id).select('id')
      const { error } = mutationOutcome(res, '刪除被拒絕:可能無權限或停留點已被移除')
      if (error) return { error }
    }
    setInspectionPoints((ps) => ps.filter((p) => p.id !== id))
    return { error: null }
  }, [dbMode])

  // 從停留點發起查驗申請:建立查驗並回寫 inspection_id 連結(狀態自此由查驗推導)
  const requestInspectionForPoint = useCallback(async (point) => {
    // 申請日是業務日期:台北日曆日(UTC 在台灣凌晨會落成前一天)
    const today = taipeiToday()
    if (!dbMode) {
      const inspId = `INSP-${Date.now()}`
      setInspections((is) => [{
        id: inspId, title: point.title, location: null,
        inspection_type: '停留點查驗', requested_date: today, status: '待查驗', result_note: null,
        work_item_no: point.work_item_no || '', work_item_desc: point.work_item_desc || '',
      }, ...is])
      setInspectionPoints((ps) => ps.map((p) => (p.id === point.id ? { ...p, inspection_id: inspId } : p)))
      return { error: null }
    }
    const inspId = crypto.randomUUID()
    const { error } = await supabase.from('inspections').insert({
      id: inspId, project_id: currentProject.project_id,
      work_item_id: point.work_item_id || null, title: point.title,
      inspection_type: '停留點查驗', requested_date: today,
      requested_by: currentUser?.user_id, status: '待查驗',
    })
    if (error) return { error }
    const { error: e2 } = await supabase.from('inspection_points').update({ inspection_id: inspId }).eq('id', point.id)
    if (e2) return { error: e2 }
    setInspectionPoints((ps) => ps.map((p) => (p.id === point.id ? { ...p, inspection_id: inspId } : p)))
    await reloadQuality()
    return { error: null }
  }, [dbMode, currentProject, currentUser, reloadQuality])

  return {
    inspections, setInspections, defects, setDefects,
    inspectionPoints, setInspectionPoints,
    createInspectionPoint, deleteInspectionPoint, requestInspectionForPoint,
    checklistTemplates, setChecklistTemplates, allChecklistTemplates,
    checklistRecords, setChecklistRecords, testSamples, setTestSamples,
    reloadQuality, createInspection, createDefect, updateDefectStatus,
    deleteInspection, deleteDefect,
    ensureChecklistTemplate,
    createTestSamples, generateSamplesFromLogs, updateTestSample, deleteTestSample,
  }
}
