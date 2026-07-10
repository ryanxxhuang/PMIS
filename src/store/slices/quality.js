// Quality slice:三級品管——查驗/缺失、自主檢查表(量化標準自動判定)、取樣試驗(齡期追蹤)。
import { useState, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase.js'
import { judgeChecklist, judgeConcrete, sampleDues, pendingSamplesFromLogs } from '../../lib/qc.js'
import { TEMPLATE_03310 } from '../../data/checklist03310.js'
import { loadQualityFromDB } from '../db.js'

export function useQualitySlice({ dbMode, currentProject, currentUser, wiMaps, log, saveMarkup }, siteLogs) {
  // 品質：查驗 + 缺失（真 DB）
  const [inspections, setInspections] = useState([])
  const [defects, setDefects] = useState([])
  // 品管:自主檢查表範本/紀錄、取樣試驗試體
  const [checklistTemplates, setChecklistTemplates] = useState([])
  const [checklistRecords, setChecklistRecords] = useState([])
  const [testSamples, setTestSamples] = useState([])

  const reloadQuality = useCallback(async () => {
    const qual = await loadQualityFromDB(currentProject.project_id, wiMaps.byId)
    setInspections(qual.inspections); setDefects(qual.defects)
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

  const createDefect = useCallback(async (input) => {
    const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
    const markup_path = await saveMarkup(input.markup_data, 'defect')
    if (!dbMode) {
      setDefects((ds) => [{
        id: `DEF-${Date.now()}`, title: input.title, description: input.description || null,
        severity: input.severity || '一般', location: input.location || null,
        due_date: input.due_date || null, status: '開立', improvement_note: null, markup_path,
        work_item_no: wi?.item_no || '', work_item_desc: wi?.description || '',
      }, ...ds])
      return { error: null }
    }
    const { error } = await supabase.from('defects').insert({
      project_id: currentProject.project_id, work_item_id: wi?.id || null,
      title: input.title, description: input.description || null,
      severity: input.severity || '一般', location: input.location || null,
      due_date: input.due_date || null, status: '開立', created_by: currentUser?.user_id, markup_path,
    })
    if (error) return { error }
    await reloadQuality()
    log('開立缺失', input.title, { user: currentUser?.name, role: '監造' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, wiMaps, saveMarkup, reloadQuality, log])

  // 缺失狀態推進：開立 → 改善中 → 待複查 → 已結案
  const updateDefectStatus = useCallback(async (defectId, status, extra = {}) => {
    const patch = { status }
    if (extra.improvement_note !== undefined) patch.improvement_note = extra.improvement_note
    if (status === '已結案') patch.closed_at = new Date().toISOString()
    if (!dbMode) {
      setDefects((ds) => ds.map((d) => (d.id === defectId ? { ...d, ...patch } : d)))
      return { error: null }
    }
    const { error } = await supabase.from('defects').update(patch).eq('id', defectId)
    if (error) return { error }
    await reloadQuality()
    log('缺失更新', status, { user: currentUser?.name, role: '品管' })
    return { error: null }
  }, [dbMode, currentUser, reloadQuality, log])

  const deleteInspection = useCallback(async (id) => {
    if (dbMode) { await supabase.from('inspections').delete().eq('id', id); await reloadQuality() }
    else setInspections((is) => is.filter((i) => i.id !== id))
  }, [dbMode, reloadQuality])

  const deleteDefect = useCallback(async (id) => {
    if (dbMode) { await supabase.from('defects').delete().eq('id', id); await reloadQuality() }
    else setDefects((ds) => ds.filter((d) => d.id !== id))
  }, [dbMode, reloadQuality])

  // ── 品管自動化:自主檢查表(量化標準自動判定) + 取樣試驗(齡期追蹤) ─────────
  // 可用範本 = 專案範本 ∪ 內建 03310(尚無同源範本時顯示;首次使用才落 DB)
  const allChecklistTemplates = useMemo(() => {
    if (checklistTemplates.some((t) => t.source === TEMPLATE_03310.source)) return checklistTemplates
    return [{ id: TEMPLATE_03310.key, ...TEMPLATE_03310, builtin: true }, ...checklistTemplates]
  }, [checklistTemplates])

  const createChecklistRecord = useCallback(async ({ template, check_date, location, values, note }) => {
    const { results, overall, failed } = judgeChecklist(template, values)
    const openDefect = async () => {
      if (overall !== '不合格') return
      await createDefect({
        title: `自主檢查不合格：${template.title}`,
        description: `不合格項目：${failed.map((f) => `${f.no} ${f.item}（標準 ${f.standard}）`).join('、')}`,
        severity: '一般', location,
      })
    }
    if (!dbMode) {
      setChecklistRecords((rs) => [{
        id: `CLR-${Date.now()}`, template_id: template.id, check_date, location: location || null,
        results, overall, note: note || null,
      }, ...rs])
      await openDefect()
      return { error: null, overall }
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
    }).select().single()
    if (error) return { error }
    setChecklistRecords((rs) => [rec, ...rs])
    await openDefect()
    log('自主檢查', `${template.title} ${check_date} → ${overall || '未判定'}`, { user: currentUser?.name, role: '施工品管' })
    return { error: null, overall }
  }, [dbMode, currentProject, currentUser, createDefect, log])

  const deleteChecklistRecord = useCallback(async (id) => {
    setChecklistRecords((rs) => rs.filter((r) => r.id !== id))
    if (dbMode) await supabase.from('checklist_records').delete().eq('id', id)
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

  // 更新試體(填 7 天參考值 / 28 天各試體值);28 天值依 fc′ 自動判定,不合格自動開缺失
  const updateTestSample = useCallback(async (id, patch) => {
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
    if (!dbMode) return { error: null }
    const dbPatch = { ...patch }
    if (judged) dbPatch.status = judged.merged.status
    const { error } = await supabase.from('test_samples').update(dbPatch).eq('id', id)
    return { error }
  }, [dbMode, createDefect])

  const deleteTestSample = useCallback(async (id) => {
    setTestSamples((ss) => ss.filter((s) => s.id !== id))
    if (dbMode) await supabase.from('test_samples').delete().eq('id', id)
  }, [dbMode])

  return {
    inspections, setInspections, defects, setDefects,
    checklistTemplates, setChecklistTemplates, allChecklistTemplates,
    checklistRecords, setChecklistRecords, testSamples, setTestSamples,
    reloadQuality, createInspection, recordInspectionResult, createDefect, updateDefectStatus,
    deleteInspection, deleteDefect,
    createChecklistRecord, deleteChecklistRecord,
    createTestSamples, generateSamplesFromLogs, updateTestSample, deleteTestSample,
  }
}
