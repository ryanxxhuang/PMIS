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
    await supabase.from('daily_log_items').delete().eq('daily_log_id', up.id)
    const rows = Object.entries(items || {}).map(([key, q]) => {
      const wi = wiMaps.byKey.get(key)
      return (wi && q) ? { daily_log_id: up.id, work_item_id: wi.id, qty_today: q } : null
    }).filter(Boolean)
    if (rows.length) {
      const { error: e2 } = await supabase.from('daily_log_items').insert(rows)
      if (e2) return { error: e2 }
    }
    setSiteLogs(await loadSiteLogsFromDB(currentProject.project_id, wiMaps.idToKey))
    log('施工日誌送出', `${log_date}（${rows.length} 工項）`, { user: currentUser?.name || '系統', role: '施工現場' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, wiMaps, log])

  const deleteSiteLog = useCallback(async (logId) => {
    if (dbMode) await supabase.from('daily_logs').delete().eq('id', logId)
    setSiteLogs((ls) => ls.filter((l) => l.id !== logId))
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

  const deleteSitePhoto = useCallback(async (photo) => {
    if (!dbMode) return { error: { message: '需真專案' } }
    await supabase.storage.from('photos').remove([photo.storage_path])
    await supabase.from('photos').delete().eq('id', photo.id)
    return { error: null }
  }, [dbMode])

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
    saveSiteLog, deleteSiteLog, listSitePhotos, uploadSitePhoto, deleteSitePhoto,
    readWhiteboard, describeDefect, draftMonthlyReview,
    createSafetyRecord, updateSafetyRecord, deleteSafetyRecord,
  }
}
