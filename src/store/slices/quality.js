// Quality slice:三級品管——查驗/缺失、自主檢查表(量化標準自動判定)、取樣試驗(齡期追蹤)。
// 缺失=統一缺失引擎(domain: quality|safety,QA §9-4):不依賴標單 → 走 isPersistedProject
// (工安缺失在匯標單前也要進 DB,否則只進記憶體=假成功);查驗掛工項 → 維持 dbMode。
import { useState, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase.js'
import { judgeChecklist, judgeConcrete, sampleDues, pendingSamplesFromLogs } from '../../lib/qc.js'
import { TEMPLATE_03310 } from '../../data/checklist03310.js'
import { loadQualityFromDB, loadDefectsFromDB } from '../db.js'
import { mutationOutcome } from './billing.js'

export function useQualitySlice({ dbMode, isPersistedProject, currentProject, currentUser, wiMaps, log, saveMarkup }, siteLogs) {
  // 品質：查驗 + 缺失（真 DB）
  const [inspections, setInspections] = useState([])
  const [defects, setDefects] = useState([])
  // 品管:自主檢查表範本/紀錄、取樣試驗試體
  const [checklistTemplates, setChecklistTemplates] = useState([])
  const [checklistRecords, setChecklistRecords] = useState([])
  const [testSamples, setTestSamples] = useState([])
  // ITP 檢驗停留點(W/H/R;狀態由連結查驗推導,見 lib/itp.js)
  const [inspectionPoints, setInspectionPoints] = useState([])

  const reloadQuality = useCallback(async () => {
    const qual = await loadQualityFromDB(currentProject.project_id, wiMaps.byId)
    setInspections(qual.inspections); setDefects(qual.defects)
  }, [currentProject, wiMaps])

  // 缺失單獨重載(缺失不依賴標單;匯標單前 wiMaps 為空,工項欄位留白即可)
  const reloadDefects = useCallback(async () => {
    setDefects(await loadDefectsFromDB(currentProject.project_id, wiMaps.byId))
  }, [currentProject, wiMaps])

  const createInspection = useCallback(async (input) => {
    const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
    if (!dbMode) {
      setInspections((is) => [{
        id: `INSP-${Date.now()}`, title: input.title, location: input.location || null,
        inspection_type: input.inspection_type || '施工查驗',
        requested_date: input.requested_date || null, status: '待查驗', result_note: null,
        work_item_no: wi?.item_no || '', work_item_desc: wi?.description || '',
      }, ...is])
      return { error: null }
    }
    const { error } = await supabase.from('inspections').insert({
      project_id: currentProject.project_id, work_item_id: wi?.id || null,
      title: input.title, location: input.location || null,
      inspection_type: input.inspection_type || '施工查驗',
      requested_date: input.requested_date || null,
      requested_by: currentUser?.user_id, status: '待查驗',
    })
    if (error) return { error }
    await reloadQuality()
    log('查驗申請', input.title, { user: currentUser?.name, role: '施工品管' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, wiMaps, reloadQuality, log])

  // 監造查驗：合格 / 不合格（不合格可一併開缺失）
  const recordInspectionResult = useCallback(async (insp, pass, note) => {
    if (!dbMode) {
      setInspections((is) => is.map((i) => (i.id === insp.id ? { ...i, status: pass ? '合格' : '不合格', result_note: note || null } : i)))
      if (!pass) {
        setDefects((ds) => [{
          id: `DEF-${Date.now()}`, title: `查驗不合格：${insp.title}`, description: note || null,
          severity: '一般', location: insp.location || null, due_date: null, status: '開立', improvement_note: null,
          work_item_no: insp.work_item_no || '', work_item_desc: insp.work_item_desc || '',
        }, ...ds])
      }
      return { error: null }
    }
    const { error } = await supabase.from('inspections').update({
      status: pass ? '合格' : '不合格', result_note: note || null,
      inspected_by: currentUser?.user_id, inspected_at: new Date().toISOString(),
    }).eq('id', insp.id)
    if (error) return { error }
    if (!pass) {
      await supabase.from('defects').insert({
        project_id: currentProject.project_id, inspection_id: insp.id, work_item_id: insp.work_item_id || null,
        title: `查驗不合格：${insp.title}`, description: note || null, location: insp.location || null,
        status: '開立', created_by: currentUser?.user_id,
      })
    }
    await reloadQuality()
    log('監造查驗', `${insp.title} — ${pass ? '合格' : '不合格'}`, { user: currentUser?.name, role: '監造' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, reloadQuality, log])

  // 開立缺失(統一引擎):domain 分品質/工安;工安缺失可在匯標單前寫入(isPersistedProject)
  const createDefect = useCallback(async (input) => {
    const domain = input.domain || 'quality'
    const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
    const markup_path = await saveMarkup(input.markup_data, 'defect')
    if (!isPersistedProject) {
      setDefects((ds) => [{
        id: `DEF-${Date.now()}`, domain, title: input.title, description: input.description || null,
        severity: input.severity || '一般', location: input.location || null,
        due_date: input.due_date || null, record_date: input.record_date || null,
        status: '開立', improvement_note: null, markup_path,
        source_checklist_record_id: input.source_checklist_record_id || null,
        work_item_no: wi?.item_no || '', work_item_desc: wi?.description || '',
      }, ...ds])
      return { error: null }
    }
    const { error } = await supabase.from('defects').insert({
      project_id: currentProject.project_id, work_item_id: wi?.id || null,
      domain, title: input.title, description: input.description || null,
      severity: input.severity || '一般', location: input.location || null,
      due_date: input.due_date || null, record_date: input.record_date || null,
      status: '開立', created_by: currentUser?.user_id, markup_path,
      source_checklist_record_id: input.source_checklist_record_id || null,
    })
    if (error) return { error }
    await reloadDefects()
    log('開立缺失', input.title, { user: currentUser?.name, role: domain === 'safety' ? '工安' : '監造' })
    return { error: null }
  }, [isPersistedProject, currentProject, currentUser, wiMaps, saveMarkup, reloadDefects, log])

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
    log('缺失更新', status, { user: currentUser?.name, role: '品管' })
    return { error: null }
  }, [isPersistedProject, currentUser, reloadDefects, log])

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

  // 存檔自主檢查(P1-07 修訂版次):revises=被修訂的紀錄 → 新增 Rev.N(舊證據不覆寫,
  // rev/root_id 由 DB guard 依鏈計算);缺失掛鏈根,同鏈最多一筆未結案缺失(不重複開)。
  const createChecklistRecord = useCallback(async ({ template, check_date, location, values, note, revises, revision_reason }) => {
    const { results, overall, failed } = judgeChecklist(template, values)
    // 缺失連動:不合格 → 鏈上沒有未結案缺失才開新的;更正為合格 → 不動原缺失
    // (結案是監造的權限),只回報仍在追蹤讓 UI 提示。
    const syncDefect = async (rootId, rev) => {
      let openDefect = null
      if (dbMode) {
        const { data } = await supabase.from('defects').select('id,status')
          .eq('source_checklist_record_id', rootId).neq('status', '已結案').limit(1)
        openDefect = data?.[0] || null
      } else {
        openDefect = defects.find((d) => d.source_checklist_record_id === rootId && d.status !== '已結案') || null
      }
      if (overall !== '不合格') return { defectAction: null, openDefectRemains: !!openDefect }
      if (openDefect) return { defectAction: 'linked', openDefectRemains: true }
      const { error } = await createDefect({
        title: `自主檢查不合格：${template.title}`,
        description: `不合格項目：${failed.map((f) => `${f.no} ${f.item}（標準 ${f.standard}）`).join('、')}${rev > 0 ? `（Rev.${rev} 更正後判定）` : ''}`,
        severity: '一般', location,
        // 檢查表在記憶體時(demo)缺失也在記憶體,本地 id 可直掛;真 DB 掛 uuid
        source_checklist_record_id: rootId,
      })
      // 並發下由唯一索引擋掉重複開立(23505)=已有原缺失,視為已關聯
      if (error?.code === '23505') return { defectAction: 'linked', openDefectRemains: true }
      if (error) return { defectAction: null, openDefectRemains: false, defectError: error }
      return { defectAction: 'created', openDefectRemains: false }
    }
    if (!dbMode) {
      const id = `CLR-${Date.now()}`
      const rev = revises ? (revises.rev || 0) + 1 : 0
      const rootId = revises ? (revises.root_id || revises.id) : id
      setChecklistRecords((rs) => [{
        id, template_id: template.id, check_date, location: location || null,
        results, overall, note: note || null,
        rev, root_id: rootId, supersedes_id: revises?.id || null,
        revision_reason: revises ? (revision_reason || null) : null,
      }, ...rs])
      const link = await syncDefect(rootId, rev)
      return { error: null, overall, rev, ...link }
    }
    let templateId = template.id
    if (template.builtin) {
      const { data: t, error: te } = await supabase.from('checklist_templates').insert({
        project_id: currentProject.project_id, title: template.title, source: template.source,
        items: template.items, created_by: currentUser?.user_id,
      }).select().single()
      if (te) return { error: te }
      setChecklistTemplates((ts) => [...ts, t])
      templateId = t.id
    }
    const { data: rec, error } = await supabase.from('checklist_records').insert({
      project_id: currentProject.project_id, template_id: templateId, check_date,
      location: location || null, results, overall, note: note || null, created_by: currentUser?.user_id,
      supersedes_id: revises?.id || null, revision_reason: revises ? revision_reason : null,
    }).select().single()
    if (error) return { error }
    setChecklistRecords((rs) => [rec, ...rs])
    const link = await syncDefect(rec.root_id, rec.rev)
    log('自主檢查', `${template.title} ${check_date}${rec.rev ? ` Rev.${rec.rev}` : ''} → ${overall || '未判定'}`, { user: currentUser?.name, role: '施工品管' })
    return { error: null, overall, rev: rec.rev, ...link }
  }, [dbMode, currentProject, currentUser, defects, createDefect, log])

  // 刪除檢查紀錄:DB 先行(已判定/被修訂引用由 guard 擋下,不可假消失)
  const deleteChecklistRecord = useCallback(async (id) => {
    if (dbMode) {
      const res = await supabase.from('checklist_records').delete().eq('id', id).select('id')
      const { error } = mutationOutcome(res, '刪除被拒絕:可能無權限或紀錄已被移除')
      if (error) return { error }
    }
    setChecklistRecords((rs) => rs.filter((r) => r.id !== id))
    return { error: null }
  }, [dbMode])

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
    log('建立取樣試體', `${data.length} 組`, { user: currentUser?.name, role: '施工品管' })
    return { error: null, count: data.length }
  }, [dbMode, currentProject, currentUser, log])

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
      let judged = null
      setTestSamples((ss) => ss.map((s) => {
        if (s.id !== id) return s
        const merged = { ...s, ...patch }
        if ('d28_values' in patch || 'fc' in patch) {
          const r = judgeConcrete(merged.fc, merged.d28_values)
          merged.status = r.status || '待試驗'
          judged = { merged, r }
        }
        return merged
      }))
      if (judged?.r.status === '不合格') {
        const { merged, r } = judged
        await createDefect({
          title: `試體抗壓不合格：${merged.sample_no}`,
          description: `28天抗壓 平均 ${Math.round(r.avg)} / 最低 ${Math.round(r.min)} kgf/cm²，未達 fc′ ${merged.fc}（標準：任一 ≥0.85fc′ 且平均 ≥fc′）`,
          severity: '嚴重', location: merged.location || '',
        })
      }
      return { error: null }
    }
    const res = await supabase.from('test_samples').update(patch).eq('id', id).select('id')
    const { error } = mutationOutcome(res, '試驗值未寫入:可能無權限或試體已被移除')
    if (error) return { error }
    await reloadQuality() // 取回 trigger 推導的狀態 + 自動開立的缺失
    return { error: null }
  }, [dbMode, createDefect, reloadQuality])

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
    log('建立停留點', `${row.point_type}·${row.title}`, { user: currentUser?.name, role: '監造' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, wiMaps, log])

  const deleteInspectionPoint = useCallback(async (id) => {
    setInspectionPoints((ps) => ps.filter((p) => p.id !== id))
    if (dbMode) await supabase.from('inspection_points').delete().eq('id', id)
  }, [dbMode])

  // 從停留點發起查驗申請:建立查驗並回寫 inspection_id 連結(狀態自此由查驗推導)
  const requestInspectionForPoint = useCallback(async (point) => {
    const today = new Date().toISOString().slice(0, 10)
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
    log('停留點申請查驗', point.title, { user: currentUser?.name, role: '施工品管' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, reloadQuality, log])

  return {
    inspections, setInspections, defects, setDefects,
    inspectionPoints, setInspectionPoints,
    createInspectionPoint, deleteInspectionPoint, requestInspectionForPoint,
    checklistTemplates, setChecklistTemplates, allChecklistTemplates,
    checklistRecords, setChecklistRecords, testSamples, setTestSamples,
    reloadQuality, createInspection, recordInspectionResult, createDefect, updateDefectStatus,
    deleteInspection, deleteDefect,
    createChecklistRecord, deleteChecklistRecord,
    createTestSamples, generateSamplesFromLogs, updateTestSample, deleteTestSample,
  }
}
