// Site slice:施工日誌(含公定格式欄位)、日誌照片、AI 辨識(告示板/缺失照/月報草稿)、工安紀錄。
// 施工日誌掛在標單工項上(數量回報)→ dbMode;工安紀錄不依賴標單 → isPersistedProject,
// 真專案匯標單前也要寫 DB(否則只進記憶體,重新整理就消失)。
import { useState, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabase.js'
import { loadSiteLogsFromDB, imageToBase64 } from '../db.js'
import { mutationOutcome } from './billing.js'

export function useSiteSlice({ dbMode, demoMode, isPersistedProject, currentProject, currentUser, wiMaps, log }) {
  // 施工日誌（真 DB；每筆 items 為 { work_item_key: 當日完成數量 }）
  const [siteLogs, setSiteLogs] = useState([])
  // 工安紀錄（真 DB）
  const [safetyRecords, setSafetyRecords] = useState([])

  // 施工日誌：存某日各工項當日完成數量（一天一筆，沿用 project_id+log_date 唯一）
  // 公定格式欄位:weather_am/pm、labor/equipment/materials(陣列)、extras(四~八節)
  const saveSiteLog = useCallback(async ({ log_date, weather, weather_am, weather_pm, labor, equipment, materials, extras, work_summary, items }) => {
    const official = {
      weather_am: weather_am || null, weather_pm: weather_pm || null,
      labor: labor?.length ? labor : null, equipment: equipment?.length ? equipment : null,
      materials: materials?.length ? materials : null,
      extras: extras && Object.keys(extras).length ? extras : null,
    }
    if (!dbMode) {
      // demo：本機 upsert（同日覆蓋），維持日期新→舊排序
      setSiteLogs((ls) => [
        { id: `LOG-${Date.now()}`, log_date, weather: weather || null, ...official, work_summary: work_summary || null, status: '已送出', items: items || {} },
        ...ls.filter((l) => l.log_date !== log_date),
      ].sort((a, b) => b.log_date.localeCompare(a.log_date)))
      return { error: null }
    }
    const { data: up, error: e1 } = await supabase.from('daily_logs').upsert(
      { project_id: currentProject.project_id, log_date, weather: weather || null, ...official, work_summary: work_summary || null, status: '已送出', created_by: currentUser?.user_id },
      { onConflict: 'project_id,log_date' },
    ).select().single()
    if (e1) return { error: e1 }
    // 明細用 diff 寫入(B-05):原本「先全刪再插」,插入失敗時該日工項數量已被刪光。
    // 現在逐列比對:只刪被移除的、更新有變的、插入新增的——任一步失敗,其餘資料仍在。
    const { data: existing, error: eq } = await supabase.from('daily_log_items')
      .select('id, work_item_id, qty_today').eq('daily_log_id', up.id)
    if (eq) return { error: eq }
    const byWi = new Map((existing || []).map((r) => [r.work_item_id, r]))
    const nextRows = Object.entries(items || {}).map(([key, q]) => {
      const wi = wiMaps.byKey.get(key)
      return (wi && q) ? { work_item_id: wi.id, qty_today: q } : null
    }).filter(Boolean)
    const nextIds = new Set(nextRows.map((r) => r.work_item_id))
    const toDelete = (existing || []).filter((r) => !nextIds.has(r.work_item_id)).map((r) => r.id)
    if (toDelete.length) {
      const { error: ed } = await supabase.from('daily_log_items').delete().in('id', toDelete)
      if (ed) return { error: ed }
    }
    for (const r of nextRows) {
      const cur = byWi.get(r.work_item_id)
      if (cur) {
        if (Number(cur.qty_today) !== Number(r.qty_today)) {
          const { error: eu } = await supabase.from('daily_log_items')
            .update({ qty_today: r.qty_today }).eq('id', cur.id)
          if (eu) return { error: eu }
        }
      } else {
        const { error: ei } = await supabase.from('daily_log_items')
          .insert({ daily_log_id: up.id, ...r })
        if (ei) return { error: ei }
      }
    }
    const rows = nextRows
    // 寫入已成功;重載失敗不可偽裝成存檔失敗(B-09 載入層會 throw)
    try { setSiteLogs(await loadSiteLogsFromDB(currentProject.project_id, wiMaps.idToKey)) } catch { /* 保留現況 */ }
    log('施工日誌送出', `${log_date}（${rows.length} 工項）`, { user: currentUser?.name || '系統', role: '施工現場' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, wiMaps, log])

  // DB 刪成功才從 UI 移除(B-07:RLS 拒絕時原本假消失,重整即復活)
  const deleteSiteLog = useCallback(async (logId) => {
    if (dbMode) {
      const res = await supabase.from('daily_logs').delete().eq('id', logId).select('id')
      const { error } = mutationOutcome(res, '刪除被拒絕:可能無權限或日誌已被移除')
      if (error) return { error }
    }
    setSiteLogs((ls) => ls.filter((l) => l.id !== logId))
    return { error: null }
  }, [dbMode])

  // 施工日誌照片：檔案進 Storage（photos bucket）、metadata 進 photos 表。
  // 路徑慣例 <project_id>/<daily_log_id>/<photo_id>.<ext>（第一段=project_id，對應 Storage RLS）。
  const listSitePhotos = useCallback(async (dailyLogId) => {
    if (!dbMode || !dailyLogId) return []
    const { data } = await supabase.from('photos')
      .select('*').eq('daily_log_id', dailyLogId).order('created_at')
    if (!data?.length) return []
    // 私有 bucket → 批次產生簽名 URL 供 <img> 顯示
    const { data: signed } = await supabase.storage.from('photos')
      .createSignedUrls(data.map((p) => p.storage_path), 3600)
    const urlByPath = new Map((signed || []).map((s) => [s.path, s.signedUrl]))
    return data.map((p) => ({ ...p, url: urlByPath.get(p.storage_path) || null }))
  }, [dbMode])

  const uploadSitePhoto = useCallback(async (dailyLogId, file, meta = {}) => {
    if (!dbMode || !dailyLogId) return { error: { message: '需先存檔日誌' } }
    const pid = currentProject.project_id
    const id = crypto.randomUUID()
    const ext = (file.name?.split('.').pop() || file.type?.split('/')[1] || 'jpg').toLowerCase()
    const path = `${pid}/${dailyLogId}/${id}.${ext}`
    const { error: upErr } = await supabase.storage.from('photos')
      .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
    if (upErr) return { error: upErr }
    const wi = meta.work_item_key ? wiMaps.byKey.get(meta.work_item_key) : null
    const { error: insErr } = await supabase.from('photos').insert({
      id, project_id: pid, daily_log_id: dailyLogId, work_item_id: wi?.id || null,
      storage_path: path, caption: meta.caption || null,
      taken_at: meta.taken_at || new Date().toISOString(), uploaded_by: currentUser?.user_id,
    })
    if (insErr) { await supabase.storage.from('photos').remove([path]); return { error: insErr } } // 回滾孤兒檔
    log('施工日誌照片上傳', meta.caption || file.name || '照片', { user: currentUser?.name || '系統', role: '施工現場' })
    return { error: null, id }
  }, [dbMode, currentProject, currentUser, wiMaps, log])

  // 先刪 DB 列(有 RLS/guard 把關,失敗如實回報),成功後再清 Storage 檔
  // (Storage 清失敗=孤兒檔,遠比「檔沒了、列還在」安全)——B-07。
  const deleteSitePhoto = useCallback(async (photo) => {
    if (!dbMode) return { error: { message: '需真專案' } }
    const res = await supabase.from('photos').delete().eq('id', photo.id).select('id')
    const { error } = mutationOutcome(res, '刪除被拒絕:可能無權限或照片已被移除')
    if (error) return { error }
    await supabase.storage.from('photos').remove([photo.storage_path])
    return { error: null }
  }, [dbMode])

  // 依工項撈全案照片(估驗佐證包用):給一組 work_item_key → 回該些工項的照片(含簽名 URL + 工項 key)。
  // 吃 classify-site-photo 生成的 work_item_id 標籤:批次辨識配好工項的照片,估驗時自動歸位當佐證。
  const listPhotosByWorkItems = useCallback(async (workItemKeys) => {
    if (!dbMode || !currentProject) return []
    const ids = [...new Set((workItemKeys || []).map((k) => wiMaps.byKey.get(k)?.id).filter(Boolean))]
    if (!ids.length) return []
    const { data } = await supabase.from('photos')
      .select('*').eq('project_id', currentProject.project_id).in('work_item_id', ids).order('taken_at')
    if (!data?.length) return []
    const { data: signed } = await supabase.storage.from('photos').createSignedUrls(data.map((p) => p.storage_path), 3600)
    const urlByPath = new Map((signed || []).map((s) => [s.path, s.signedUrl]))
    return data.map((p) => ({ ...p, url: urlByPath.get(p.storage_path) || null, work_item_key: wiMaps.idToKey.get(p.work_item_id) || null }))
  }, [dbMode, currentProject, wiMaps])

  // AI 現場辨識:工程告示板/現場照片 → read-whiteboard Edge Function（Claude 視覺）→ 結構化日誌欄位。
  // 金鑰在雲端函式,前端只送壓好的 base64;工項對應(item_key)由前端用標單模糊比對。
  const readWhiteboard = useCallback(async (file) => {
    if (!isSupabaseConfigured) return { error: { message: '需登入（Supabase 未設定）' } }
    let image_base64
    try { image_base64 = await imageToBase64(file) } catch { return { error: { message: '讀取照片失敗' } } }
    const { data, error } = await supabase.functions.invoke('read-whiteboard', {
      body: { image_base64, mime_type: 'image/jpeg' },
    })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [])

  // AI 缺失描述:缺失照片 → describe-defect Edge Function → 缺失表單欄位。
  const describeDefect = useCallback(async (file) => {
    if (!isSupabaseConfigured) return { error: { message: '需登入（demo 模式不支援 AI 辨識）' } }
    let image_base64
    try { image_base64 = await imageToBase64(file) } catch { return { error: { message: '讀取照片失敗' } } }
    const { data, error } = await supabase.functions.invoke('describe-defect', {
      body: { image_base64, mime_type: 'image/jpeg' },
    })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [])

  // AI 工安判讀:工地照片 → analyze-safety-photo Edge Function(職安衛法規比對)→
  // 危害類別/違反法規依據/嚴重度/改善建議,產出工安缺失草稿。差別於 describeDefect=比對職安衛法規。
  const analyzeSafetyPhoto = useCallback(async (file) => {
    if (!isSupabaseConfigured) return { error: { message: '需登入（demo 模式不支援 AI 判讀）' } }
    let image_base64
    try { image_base64 = await imageToBase64(file) } catch { return { error: { message: '讀取照片失敗' } } }
    const { data, error } = await supabase.functions.invoke('analyze-safety-photo', {
      body: { image_base64, mime_type: 'image/jpeg' },
    })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [])

  // AI 施工照片分類:單張現場照 → classify-site-photo Edge Function → 照片簿說明/類別/工項關鍵詞。
  // 「批次辨識」由前端對多檔各呼叫一次;工項對應由前端 matchLeaf 模糊比對標單。
  const classifySitePhoto = useCallback(async (file) => {
    if (!isSupabaseConfigured) return { error: { message: '需登入（demo 模式不支援 AI 辨識）' } }
    let image_base64
    try { image_base64 = await imageToBase64(file) } catch { return { error: { message: '讀取照片失敗' } } }
    const { data, error } = await supabase.functions.invoke('classify-site-photo', {
      body: { image_base64, mime_type: 'image/jpeg' },
    })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [])

  // AI 月報草稿:彙整數據 → draft-monthly-review Edge Function → 檢討/下月計畫。
  // demo 模式在本地用數據套模板生成(銷售 demo 不依賴後端)。
  const draftMonthlyReview = useCallback(async (payload) => {
    if (demoMode) {
      const s = payload.stats || {}
      const behind = s.diff != null && s.diff < 0
      const review =
        `本月完成估驗金額 NT$ ${Math.round(s.thisMonthVal || 0).toLocaleString()}，累計實際進度 ${(s.actualPct || 0).toFixed(1)}%` +
        (s.plannedPct != null ? `，較預定進度${behind ? '落後' : '超前'} ${Math.abs(s.diff).toFixed(1)}%。` : '。') +
        `本月施工 ${s.workDays || 0} 天（雨天 ${s.rainDays || 0} 天），查驗 ${s.inspections || 0} 次` +
        (s.failed ? `（不合格 ${s.failed} 件，均已開立缺失追蹤改善）` : '（均合格）') +
        `。` + (behind ? '落後主因為雨天影響戶外作業，已調整人力於室內工項並研擬趕工計畫。' : '整體進度受控，持續依計畫推進。')
      const next_plan =
        `預定持續辦理${(s.logSummaries || []).slice(-1)[0] || '主體結構工程'}之後續作業，` +
        `並依進度計畫安排後續工項進場；持續落實三級品管自主檢查與工安巡檢，如有變更設計核定將即時納入估驗。`
      return { error: null, result: { review, next_plan } }
    }
    if (!isSupabaseConfigured) return { error: { message: '需登入（Supabase 未設定）' } }
    const { data, error } = await supabase.functions.invoke('draft-monthly-review', { body: payload })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [demoMode])

  // AI 本期估驗施工說明(估驗請款佐證包用):彙整本期工項/照片說明/日誌摘要 → 一段施工說明。
  // demo 用資料套模板生成(不依賴後端);真專案走 draft-valuation-summary edge fn。
  const draftValuationSummary = useCallback(async (payload) => {
    if (demoMode) {
      const its = payload.items || []
      const top = its.slice(0, 4).map((i) => i.name).filter(Boolean)
      const cap = (payload.photo_captions || []).slice(0, 3)
      const summary =
        `本期估驗金額 NT$ ${Math.round(payload.period_amount || 0).toLocaleString()}，累計完成 ${(payload.completion_pct || 0).toFixed(1)}%。` +
        (top.length ? `本期主要施作:${top.join('、')}等 ${its.length} 項工項。` : '') +
        (cap.length ? `現場佐證含${cap.join('、')}等紀錄。` : '') +
        `各工項完成數量已依施工日誌逐日累計，並附現場照片佐證,檢附估驗計價單辦理本期估驗計價。`
      return { error: null, result: { summary } }
    }
    if (!isSupabaseConfigured) return { error: { message: '需登入（Supabase 未設定）' } }
    const { data, error } = await supabase.functions.invoke('draft-valuation-summary', { body: payload })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [demoMode])

  // AI 稽核摘要:文件勾稽鏈的「確定性發現」(integrityAudit.js)→ 機關稽核意見+建議事項。
  // demo/未設 → 由發現套模板生成(判定全在確定性引擎,AI 只寫文字,不臆造)。
  const auditSummary = useCallback(async (payload) => {
    const findings = payload.findings || []
    if (demoMode || !isSupabaseConfigured) {
      if (!findings.length) return { error: null, result: { opinion: '本案經文件勾稽鏈自動比對（估驗、施工日誌、查驗、試體），未發現明顯對不起來之處，證據鏈大致完整。仍請依契約與相關法令續行常態監督。', recommendations: [] } }
      const risks = findings.filter((f) => f.status === 'risk')
      const opinion = `本案經文件勾稽鏈自動比對（估驗、施工日誌、查驗、試體），發現風險 ${payload.summary?.risk || 0} 項、注意 ${payload.summary?.warn || 0} 項`
        + `${risks.length ? `，其中「${risks.slice(0, 2).map((f) => f.title.split('：')[0].split(':')[0]).join('」「')}」等項目尤應優先複查` : ''}。`
        + `上開為系統比對之異常提示，非違規認定，實際處置請依契約與相關法令查證。`
      const recommendations = findings.slice(0, 6).map((f) => `就「${f.title.split('：')[0].split(':')[0]}」，請查核相關佐證並依契約與三級品管程序處置。`)
      return { error: null, result: { opinion, recommendations } }
    }
    const { data, error } = await supabase.functions.invoke('audit-summary', { body: payload })
    if (error || data?.error) return { error: { message: error?.message || data?.error || 'AI 稽核摘要暫時無法使用' } }
    return { error: null, result: data }
  }, [demoMode])

  // 工地座標 → 中央氣象局天氣(fetch-weather edge fn,授權碼在雲端 secret)。
  const fetchWeather = useCallback(async (lat, lon, date) => {
    if (!isSupabaseConfigured) return { error: '需登入(Supabase)才能連中央氣象局' }
    const { data, error } = await supabase.functions.invoke('fetch-weather', { body: { lat, lon, date } })
    if (error || data?.error) return { error: error?.message || data?.error || '天氣服務暫時無法使用' }
    return data // { am, pm, township, source }
  }, [])

  // 開放式 copilot 問答:送本案 facts 快照到 assistant-chat edge fn。
  // demo/未設 Supabase → 回 fallback,由 Assistant.jsx 改用確定性 answerQuestion。
  const askAssistant = useCallback(async (question, facts) => {
    if (!isSupabaseConfigured) return { fallback: true }
    const { data, error } = await supabase.functions.invoke('assistant-chat', { body: { question, facts } })
    if (error || data?.error) return { error: error?.message || data?.error || 'AI 服務暫時無法使用' }
    return { answer: data.answer, sources: data.sources || [] }
  }, [])

  // 工安：新增 / 更新 / 刪除工安紀錄（demo 只進記憶體）。
  // 工安缺失已併入統一缺失引擎(defects, domain='safety',見 quality slice)——
  // safety_records 僅存原始紀錄六類,伺服器 guard 會拒絕工安缺失類型。
  const createSafetyRecord = useCallback(async (input) => {
    const row = {
      record_type: input.record_type || '自主檢查', title: input.title,
      location: input.location || null, record_date: input.record_date || null,
      severity: input.severity || '一般',
      // 事件型紀錄(訓練/告知/監造三類)生即完成;自主檢查走改善流程
      status: ['教育訓練', '危害告知', '監造觀察', '監造查驗', '監造複查'].includes(input.record_type)
        ? '已完成' : (input.status || '待改善'),
      due_date: input.due_date || null, note: input.note || null,
    }
    if (!isPersistedProject) {
      setSafetyRecords((rs) => [{ ...row, id: `SAF-${Date.now()}` }, ...rs])
      return { error: null }
    }
    const { data, error } = await supabase.from('safety_records')
      .insert({ ...row, project_id: currentProject.project_id, created_by: currentUser?.user_id }).select().single()
    if (error) return { error }
    setSafetyRecords((rs) => [data, ...rs])
    log('新增工安紀錄', `${row.record_type}·${row.title}`, { user: currentUser?.name || '系統', role: '工安' })
    return { error: null }
  }, [isPersistedProject, currentProject, currentUser, log])

  // 更新工安紀錄:DB 成功才更新 UI(guard 拒絕——他方紀錄/已完成未附原因——如實回報)
  const updateSafetyRecord = useCallback(async (id, patch) => {
    if (isPersistedProject) {
      const res = await supabase.from('safety_records').update(patch).eq('id', id).select('id')
      const { error } = mutationOutcome(res, '未寫入:可能無權限或紀錄已被移除')
      if (error) return { error }
    }
    setSafetyRecords((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    return { error: null }
  }, [isPersistedProject])

  // 刪除工安紀錄:DB 刪成功才從 UI 移除(已完成紀錄由 guard 擋下,不可假消失)
  const deleteSafetyRecord = useCallback(async (id) => {
    if (isPersistedProject) {
      const res = await supabase.from('safety_records').delete().eq('id', id).select('id')
      const { error } = mutationOutcome(res, '刪除被拒絕:可能無權限或紀錄已被移除')
      if (error) return { error }
    }
    setSafetyRecords((rs) => rs.filter((r) => r.id !== id))
    return { error: null }
  }, [isPersistedProject])

  return {
    siteLogs, setSiteLogs, safetyRecords, setSafetyRecords,
    saveSiteLog, deleteSiteLog, listSitePhotos, uploadSitePhoto, deleteSitePhoto, listPhotosByWorkItems,
    readWhiteboard, describeDefect, analyzeSafetyPhoto, classifySitePhoto, draftMonthlyReview, draftValuationSummary, auditSummary, askAssistant, fetchWeather,
    createSafetyRecord, updateSafetyRecord, deleteSafetyRecord,
  }
}
