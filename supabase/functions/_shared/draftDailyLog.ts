// 廠商 Agent:施工日誌草稿 draft_daily_log(B4 由 agentTools.ts 抽出)。
// ---------------------------------------------------------------------------
// 只寫 agent_actions(AI 草稿收件匣)—— 絕不寫 daily_logs。真正的日誌由使用者在
// 收件匣按「接受」後,由前端走 saveSiteLog 建立,既有 RLS / guard trigger 照常生效。
// buildDailyLogDraft 是純函式(確定性組裝、不呼叫 Claude),agentTools.test.ts 釘住
// 「數量誠實原則」:qty_today 一律 null + needs_input。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { formatDate, parseDateUTC, taipeiTodayUTC } from './contractDue.ts'
import { isDate, toolError } from './agentToolCommon.ts'

// ── 批3:施工日誌草稿(全部確定性組裝,不呼叫 Claude) ───────────────────────
const DAY_MS = 86400000

// buildDailyLogDraft 的輸入(查詢層撈好資料後交給純函式組裝,方便單元測試)
export type DailyLogDraftInput = {
  logDate: string
  photos: { id: string; work_item_id: string }[] // 已配對工項的當日照片
  workItems: { id: string; item_key?: string | null; item_no?: string | null; description: string; unit?: string | null; sort_order?: number | null }[]
  yesterday?: {
    log_date: string
    labor?: unknown[] | null
    equipment?: unknown[] | null
    materials?: unknown[] | null
    daily_log_items?: { work_item_id: string; qty_today?: number | null }[]
  } | null
  weather?: { am?: string; pm?: string } | null
  untaggedCount?: number // 當日未配對工項的照片數(誠實揭露「有照片但沒納入」)
}

// 數量的誠實原則(本批最重要的判斷,絕不可放寬):
// 照片能證明「今天做了這個工項」,不能證明「做了多少」。因此:
//   * 工項清單:自動帶出 —— 依據是照片的 work_item_id(確定性欄位比對,非 AI 判讀)。
//   * 數量:一律 qty_today: null + needs_input: true + source: null,由人填。
//     昨日同工項的數量「只寫進 rationale 供參考」,絕不預填(昨天做多少不代表今天)。
//     規格原訂「item_schedules 有當日排程量→預填 source:'schedule'」,但 repo 的
//     item_schedules 只有 planned_start/planned_finish 日期、沒有任何排程數量欄位
//     (見 baseline migration)—— 此預填分支在現行 schema 下不存在,優雅跳過。
//   * 出工/機具/材料:複製昨日日誌(source:'yesterday')—— 天天雷同,複製是合理
//     預設,填錯的代價遠低於數量。
//   * 天氣:既有 fetch-weather(中央氣象局),source:'cwa';失敗就留空。
export function buildDailyLogDraft(input: DailyLogDraftInput): {
  payload: Record<string, unknown>
  summary: string
  rationale: string
} {
  const { logDate, photos, yesterday, weather } = input
  // 展示順序照標單 sort_order(確定性排序,讓摘要/草稿逐次產生一致)
  const workItems = [...input.workItems].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const photoCountByItem = new Map<string, number>()
  for (const p of photos) {
    photoCountByItem.set(p.work_item_id, (photoCountByItem.get(p.work_item_id) ?? 0) + 1)
  }
  const yQtyByItem = new Map<string, number>()
  for (const it of yesterday?.daily_log_items ?? []) {
    if (typeof it.qty_today === 'number' && it.qty_today > 0) yQtyByItem.set(it.work_item_id, it.qty_today)
  }

  // items:key 用 work_item_id;附 item_key(saveSiteLog 的 items 以 item_key 為 key,
  // 前端接受草稿時要靠它轉形狀)與展示欄位。數量一律留空標 needs_input。
  const items: Record<string, unknown> = {}
  for (const wi of workItems) {
    items[wi.id] = {
      item_key: wi.item_key ?? null,
      item_no: wi.item_no ?? null,
      description: wi.description,
      unit: wi.unit ?? null,
      qty_today: null,
      needs_input: true,
      source: null,
    }
  }

  // work_summary:確定性字串拼接(不用 AI),誠實標明數量待填
  const parts = workItems.map((wi) => {
    const label = [wi.item_no, wi.description].filter(Boolean).join(' ')
    return `${label}(照片 ${photoCountByItem.get(wi.id) ?? 0} 張)`
  })
  const workSummary = `依現場照片,本日施作:${parts.join('、')}。各工項數量待現場確認後填寫。`

  const hasYesterday = !!yesterday
  const labor = (yesterday?.labor as unknown[] | null) ?? []
  const equipment = (yesterday?.equipment as unknown[] | null) ?? []
  const materials = (yesterday?.materials as unknown[] | null) ?? []
  const weatherAm = weather?.am || null
  const weatherPm = weather?.pm || null
  const weatherSource = weatherAm || weatherPm ? 'cwa' : null

  const payload = {
    log_date: logDate,
    weather_am: weatherAm,
    weather_pm: weatherPm,
    labor,
    equipment,
    materials,
    work_summary: workSummary,
    items,
    // 各欄位資料來源,前端據以呈現「哪些是帶入、哪些待填」
    field_sources: {
      items: 'photos',
      quantities: 'needs_input', // 數量沒有來源 —— 一律由人填
      weather: weatherSource,
      labor: hasYesterday && labor.length ? 'yesterday' : null,
      equipment: hasYesterday && equipment.length ? 'yesterday' : null,
      materials: hasYesterday && materials.length ? 'yesterday' : null,
    },
    photo_ids: photos.map((p) => p.id),
  }

  const [, m, d] = logDate.split('-')
  const summary =
    `已依 ${photos.length} 張現場照片擬好 ${Number(m)}/${Number(d)} 施工日誌草稿` +
    `(${workItems.length} 個工項,數量待你填)`

  // rationale:逐欄位交代依據 —— 給收件匣的人看,讓他知道哪些可信、哪些必須自己填
  const yRefs = workItems
    .filter((wi) => yQtyByItem.has(wi.id))
    .map((wi) => `${[wi.item_no, wi.description].filter(Boolean).join(' ')} 昨日 ${yQtyByItem.get(wi.id)} ${wi.unit || ''}`.trim())
  const rationaleParts = [
    `工項清單:依當日 ${photos.length} 張已配對工項的現場照片自動帶出(比對照片的工項欄位,確定性,非 AI 判讀)。`,
    '數量:一律留空待你親自填寫 —— 照片能證明有施作,不能證明做了多少,系統不猜數量。' +
      (yRefs.length ? `昨日同工項數量僅供參考:${yRefs.join('、')}。` : ''),
    hasYesterday
      ? `出工/機具/材料:複製自昨日(${yesterday!.log_date})日誌,請核對後調整。`
      : '出工/機具/材料:無昨日日誌可複製,留空待填。',
    weatherSource ? '天氣:依工地座標向中央氣象局預報自動帶入。' : '天氣:無工地座標或查詢失敗,未帶入,請手動填寫。',
    input.untaggedCount ? `另有 ${input.untaggedCount} 張當日照片尚未配對工項,未納入本草稿。` : '',
  ].filter(Boolean)

  return { payload, summary, rationale: rationaleParts.join('\n') }
}

// draft_daily_log 執行:查詢一律走 userClient(RLS);service 只用來寫 agent_actions。
export async function draftDailyLog(
  db: SupabaseClient,
  projectId: string,
  service: SupabaseClient | null,
  userId: string | undefined,
  input: Record<string, unknown>,
) {
  // log_date 驗證:格式 + 回轉一致(擋 2026-13-40 這類會被 Date 進位吃掉的值)
  let logDate: string
  if (input.log_date !== undefined) {
    if (!isDate(input.log_date)) return { error: 'log_date 必須是 YYYY-MM-DD' }
    const ms = parseDateUTC(input.log_date)
    if (ms == null || formatDate(ms) !== input.log_date) return { error: 'log_date 不是有效日期' }
    logDate = input.log_date
  } else {
    logDate = formatDate(taipeiTodayUTC())
  }
  // service role 未設定 → 查詢工具照常可用,只有草稿功能誠實停用(見 agent-run)
  if (!service || !userId) return { error: '伺服器未設定,暫時無法建立草稿' }

  // 該日已有日誌 → 不重複擬(daily_logs 有 project_id+log_date 唯一約束)
  const { data: existing, error: exErr } = await db
    .from('daily_logs')
    .select('id')
    .eq('project_id', projectId)
    .eq('log_date', logDate)
    .maybeSingle()
  if (exErr) return toolError('draftDailyLog', exErr)
  if (existing) return { error: `該日(${logDate})已有施工日誌,請直接編輯` }

  // 當日照片(台北時區界):taken_at 落在該日;有無配對工項分開統計,誠實揭露
  const { data: dayPhotos, error: phErr } = await db
    .from('photos')
    .select('id, work_item_id, taken_at')
    .eq('project_id', projectId)
    .gte('taken_at', `${logDate}T00:00:00+08:00`)
    .lte('taken_at', `${logDate}T23:59:59+08:00`)
    .order('taken_at', { ascending: true })
  if (phErr) return toolError('draftDailyLog', phErr)
  const allPhotos = dayPhotos ?? []
  if (!allPhotos.length) {
    // 誠實回報,不是失敗 —— agent 要能把這句話轉述給使用者
    return { note: `該日(${logDate})沒有已上傳的現場照片,無法據以擬稿。請先上傳照片,或直接手動填寫日誌。` }
  }
  let tagged = allPhotos.filter((p) => !!p.work_item_id)
  if (!tagged.length) {
    return { note: `該日(${logDate})的 ${allPhotos.length} 張照片都尚未配對工項,無法據以擬稿。請先在照片批次辨識完成工項配對,或直接手動填寫日誌。` }
  }

  // 聚合工項(RLS + .eq(project_id) 縱深防禦;附 item_key 供前端轉 saveSiteLog 形狀)
  const wiIds = [...new Set(tagged.map((p) => p.work_item_id))]
  const { data: workItems, error: wiErr } = await db
    .from('work_items')
    .select('id, item_key, item_no, description, unit, sort_order')
    .eq('project_id', projectId)
    .in('id', wiIds)
  if (wiErr) return toolError('draftDailyLog', wiErr)
  const wiById = new Map((workItems ?? []).map((w) => [w.id, w]))
  tagged = tagged.filter((p) => wiById.has(p.work_item_id)) // 照片指向他案/已刪工項 → 不納入
  if (!tagged.length) {
    return { note: `該日(${logDate})照片配對的工項在本案標單中找不到,無法據以擬稿。請確認照片的工項配對,或直接手動填寫日誌。` }
  }

  // 昨日日誌:出工/機具/材料的複製來源;各工項昨日數量只進 rationale 供參考
  const yesterdayDate = formatDate(parseDateUTC(logDate)! - DAY_MS)
  const { data: ylog } = await db
    .from('daily_logs')
    .select('log_date, labor, equipment, materials, daily_log_items(work_item_id, qty_today)')
    .eq('project_id', projectId)
    .eq('log_date', yesterdayDate)
    .maybeSingle()

  // 排程預填:repo 的 item_schedules 沒有任何「當日排程量」欄位(只有起迄日),
  // 規格的 source:'schedule' 分支無從成立 —— 依規格指示優雅跳過,不查、不猜。

  // 天氣:有座標才呼叫既有 fetch-weather(userClient.functions.invoke 會帶原
  // Authorization header);任何失敗都不阻擋擬稿,天氣留空由人填
  let weather: { am?: string; pm?: string } | null = null
  const { data: proj } = await db.from('projects').select('latitude, longitude').eq('id', projectId).maybeSingle()
  if (proj?.latitude != null && proj?.longitude != null) {
    try {
      const { data: wx, error: wxErr } = await db.functions.invoke('fetch-weather', {
        body: { lat: proj.latitude, lon: proj.longitude, date: logDate },
      })
      if (!wxErr && wx && !wx.error && (wx.am || wx.pm)) weather = { am: wx.am, pm: wx.pm }
    } catch { /* 天氣失敗不阻擋擬稿 */ }
  }

  const { payload, summary, rationale } = buildDailyLogDraft({
    logDate,
    photos: tagged.map((p) => ({ id: p.id, work_item_id: p.work_item_id })),
    workItems: workItems ?? [],
    yesterday: (ylog as DailyLogDraftInput['yesterday']) ?? null,
    weather,
    untaggedCount: allPhotos.length - tagged.length,
  })

  // 唯一的寫入:agent_actions(service role;該表 authenticated 無寫入權)。
  // 絕不寫 daily_logs —— 真正的日誌由使用者在收件匣接受後、前端走 saveSiteLog 建立。
  const { data: action, error: insErr } = await service
    .from('agent_actions')
    .insert({
      project_id: projectId,
      actor_user: userId,
      agent_role: 'contractor',
      kind: 'draft_daily_log',
      target_table: 'daily_logs',
      summary,
      rationale,
      evidence: { payload, photo_ids: payload.photo_ids, work_items: workItems },
    })
    .select('id')
    .single()
  if (insErr) return toolError('draftDailyLog', insErr)

  // 回給模型的是「草稿已放入收件匣」的事實 —— 讓它據實轉述,不可宣稱日誌已建立
  return {
    ok: true,
    agent_action_id: action.id,
    log_date: logDate,
    工項數: Object.keys(payload.items as Record<string, unknown>).length,
    照片數: (payload.photo_ids as string[]).length,
    待填欄位: ['各工項數量'],
    note: '草稿已放進使用者的草稿收件匣;日誌尚未建立,須由使用者本人在收件匣確認,且各工項數量須由他親自填寫。',
  }
}
