// Site slice:施工日誌(唯讀:事實表由簽署 RPC 落庫,見 fieldDocs slice)、日誌照片查詢、
// AI 辨識(缺失照/工安照/月報草稿)、工安紀錄。工安紀錄不依賴標單 → isPersistedProject,
// 真專案匯標單前也要寫 DB(否則只進記憶體,重新整理就消失)。
import { useState, useCallback } from 'react'
import { supabase, isSupabaseConfigured, SIGNED_URL_TTL_S } from '../../lib/supabase.js'
import { imageToBase64 } from '../db.js'
import { pageAllInSafe, chunked } from '../../lib/pagedQuery.js'
import { mutationOutcome } from './billing.js'

export function useSiteSlice({ dbMode, demoMode, isPersistedProject, currentProject, currentUser, wiMaps }) {
  // 施工日誌（真 DB；每筆 items 為 { work_item_key: 當日完成數量 }）
  const [siteLogs, setSiteLogs] = useState([])
  // 工安紀錄（真 DB）
  const [safetyRecords, setSafetyRecords] = useState([])

  // 施工日誌的寫入路徑只有一條(P2c,D-026):field_documents 草稿 → save_field_document_version →
  // sign_field_document(簽署交易內落 daily_logs／daily_log_items)。舊 saveSiteLog／deleteSiteLog 的直接
  // upsert／delete 已移除——事實表由簽署 RPC 與 daily_logs_guard 管;這裡只讀 siteLogs 供估驗／月報／列印。
  // 既有未簽署日誌(正式 12 筆)開啟時以其內容建立文件草稿(來源標「既有紀錄、待核對」),見 lib/fieldDocs.js。

  // 施工日誌照片：檔案進 Storage（photos bucket）、metadata 進 photos 表。
  // 路徑慣例 <project_id>/<daily_log_id>/<photo_id>.<ext>（第一段=project_id，對應 Storage RLS）。
  const listSitePhotos = useCallback(async (dailyLogId) => {
    if (!dbMode || !dailyLogId) return []
    const { data } = await supabase.from('photos')
      .select('*').eq('daily_log_id', dailyLogId).order('created_at')
    if (!data?.length) return []
    // 私有 bucket → 批次產生簽名 URL 供 <img> 顯示
    const { data: signed } = await supabase.storage.from('photos')
      .createSignedUrls(data.map((p) => p.storage_path), SIGNED_URL_TTL_S)
    const urlByPath = new Map((signed || []).map((s) => [s.path, s.signedUrl]))
    return data.map((p) => ({ ...p, url: urlByPath.get(p.storage_path) || null }))
  }, [dbMode])

  // 照片上傳只走上傳批次(fieldDocs slice uploadIntakePhoto:photo_intakes＋photos.intake_id／content_sha256,
  // 由 Edge draft-field-documents 辨識起稿);舊「直接掛 daily_log_id 上傳」路徑已移除。

  // 先刪 DB 列(有 RLS/guard 把關,失敗如實回報),成功後再清 Storage 檔
  // (Storage 清失敗=孤兒檔,遠比「檔沒了、列還在」安全)——B-07。
  // AI 辨識「已上傳」照片後回寫說明/工項(P0 #11:批次辨識原本只吃新選檔,
  // 使用者先上傳再按 AI 什麼都不會發生)。ai_source 標記讓佐證鏈知道說明是 AI 生的。
  const updateSitePhotoMeta = useCallback(async (photoId, { caption, work_item_key }) => {
    if (!dbMode) return { error: { message: 'demo 模式不支援' } }
    const wi = work_item_key ? wiMaps.byKey.get(work_item_key) : null
    const patch = { ai_source: true }
    if (caption !== undefined) patch.caption = caption || null
    if (work_item_key !== undefined) patch.work_item_id = wi?.id || null
    const res = await supabase.from('photos').update(patch).eq('id', photoId).select('id')
    const { error } = mutationOutcome(res, '照片更新被拒:可能無權限')
    return { error }
  }, [dbMode, wiMaps])

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
    // 一期估驗可涵蓋數百個工項、上千張照片:工項 id 要分批進 .in(),結果要分頁
    const { data } = await pageAllInSafe(ids, (chunk, from, to) => supabase.from('photos')
      .select('*').eq('project_id', currentProject.project_id).in('work_item_id', chunk)
      .order('taken_at').order('id').range(from, to))
    if (!data?.length) return []
    // 簽名 URL 也有批次上限,照片分頁後跟著分批簽
    const urlByPath = new Map()
    for (const batch of chunked(data.map((p) => p.storage_path))) {
      const { data: signed } = await supabase.storage.from('photos').createSignedUrls(batch, SIGNED_URL_TTL_S)
      for (const s of signed || []) urlByPath.set(s.path, s.signedUrl)
    }
    return data.map((p) => ({ ...p, url: urlByPath.get(p.storage_path) || null, work_item_key: wiMaps.idToKey.get(p.work_item_id) || null }))
  }, [dbMode, currentProject, wiMaps])

  // 告示板／施工照片的逐張辨識已收進 Edge draft-field-documents(照片保存後由伺服器辨識、配工項、
  // 起稿並持久化 photos.ai_*);前端不再逐張打 read-whiteboard／classify-site-photo(舊 onWhiteboard 把板上
  // 未寫的數量填 0 的路徑一併退場)。describe-defect／analyze-safety-photo 仍是缺失／工安頁的單張入口。

  // AI 缺失描述:缺失照片 → describe-defect Edge Function → 缺失表單欄位。
  const describeDefect = useCallback(async (file) => {
    if (!isSupabaseConfigured) return { error: { message: '需登入（demo 模式不支援 AI 辨識）' } }
    let image_base64
    try { image_base64 = await imageToBase64(file) } catch { return { error: { message: '讀取照片失敗' } } }
    const { data, error } = await supabase.functions.invoke('describe-defect', {
      body: { image_base64, mime_type: 'image/jpeg', project_id: currentProject?.project_id },
    })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [currentProject])

  // AI 工安判讀:工地照片 → analyze-safety-photo Edge Function(職安衛法規比對)→
  // 危害類別/違反法規依據/嚴重度/改善建議,產出工安缺失草稿。差別於 describeDefect=比對職安衛法規。
  const analyzeSafetyPhoto = useCallback(async (file) => {
    if (!isSupabaseConfigured) return { error: { message: '需登入（demo 模式不支援 AI 判讀）' } }
    let image_base64
    try { image_base64 = await imageToBase64(file) } catch { return { error: { message: '讀取照片失敗' } } }
    const { data, error } = await supabase.functions.invoke('analyze-safety-photo', {
      body: { image_base64, mime_type: 'image/jpeg', project_id: currentProject?.project_id },
    })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [currentProject])

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
    const { data, error } = await supabase.functions.invoke('draft-monthly-review', {
      body: { ...payload, project_id: currentProject?.project_id },
    })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [demoMode, currentProject])

  // AI 本期估驗施工說明(估驗請款佐證包用):彙整本期工項/照片說明/日誌摘要 → 一段施工說明。
  // demo 用資料套模板生成(不依賴後端);真專案走 draft-valuation-summary edge fn。
  const draftValuationSummary = useCallback(async (payload) => {
    if (demoMode) {
      const its = payload.items || []
      const top = its.slice(0, 4).map((i) => i.name).filter(Boolean)
      const cap = (payload.photo_captions || []).slice(0, 3)
      // 照片為零就直說尚未檢附(W04):不替使用者宣稱沒有的佐證。photo_count 由佐證包頁面帶入
      const photoCount = payload.photo_count ?? cap.length
      const summary =
        `本期估驗金額 NT$ ${Math.round(payload.period_amount || 0).toLocaleString()}，累計完成 ${(payload.completion_pct || 0).toFixed(1)}%。` +
        (top.length ? `本期主要施作:${top.join('、')}等 ${its.length} 項工項。` : '') +
        (cap.length ? `現場佐證含${cap.join('、')}等紀錄。` : '') +
        `各工項完成數量已依施工日誌逐日累計，${photoCount > 0 ? `並附現場照片 ${photoCount} 張佐證，` : '本期尚未檢附現場照片，'}檢附估驗計價單辦理本期估驗計價。`
      return { error: null, result: { summary } }
    }
    if (!isSupabaseConfigured) return { error: { message: '需登入（Supabase 未設定）' } }
    const { data, error } = await supabase.functions.invoke('draft-valuation-summary', {
      body: { ...payload, project_id: currentProject?.project_id },
    })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [demoMode, currentProject])

  // (P6c,D-026 §4)auditSummary/audit-summary 已退場:勾稽檢核由確定性引擎在估驗流程給結果,
  // 不再把發現交給 AI 寫成機關稽核意見;DB 開關 20260919130400 關閉,伺服器閘門對舊呼叫回 403。

  // 工地座標 → 中央氣象局天氣(fetch-weather edge fn,授權碼在雲端 secret)。
  const fetchWeather = useCallback(async (lat, lon, date) => {
    if (!isSupabaseConfigured) return { error: '需登入(Supabase)才能連中央氣象局' }
    const { data, error } = await supabase.functions.invoke('fetch-weather', {
      body: { lat, lon, date, project_id: currentProject?.project_id },
    })
    if (error || data?.error) return { error: error?.message || data?.error || '天氣服務暫時無法使用' }
    return data // { am, pm, township, source }
  }, [currentProject])

  // (W3-3)askAssistant/assistant-chat 已退場:對話一律走 agent slice 的 runAgent(agent.run)

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
    return { error: null }
  }, [isPersistedProject, currentProject, currentUser])

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
    listSitePhotos, deleteSitePhoto, updateSitePhotoMeta, listPhotosByWorkItems,
    describeDefect, analyzeSafetyPhoto, draftMonthlyReview, draftValuationSummary, fetchWeather,
    createSafetyRecord, updateSafetyRecord, deleteSafetyRecord,
  }
}
