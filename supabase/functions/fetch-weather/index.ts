// Supabase Edge Function: fetch-weather
// ---------------------------------------------------------------------------
// 工地座標 → 中央氣象局逐 3 小時鄉鎮預報(F-D0047-091)→ 該日上午/下午天氣現象。
// 授權碼只在雲端 secret(CWA_API_KEY),永不進前端。verify_jwt 預設開啟。
// 部署(colima 下必須 --use-api):supabase functions deploy fetch-weather --use-api
//
// 回 { am, pm, township, source } 或 { error }。防禦式解析 CWA 新舊欄位大小寫。

import { cors, jsonResponse as json } from '../_shared/claude.ts'

const DATASET = 'F-D0047-089' // 鄉鎮天氣預報-臺灣未來 3 天(逐 3 小時,含天氣現象/3小時降雨機率)
const R = Math.PI / 180
const dist2 = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  // 平面近似即可(找最近鄉鎮,不需精確大圓)
  const dLat = (aLat - bLat), dLon = (aLon - bLon) * Math.cos(((aLat + bLat) / 2) * R)
  return dLat * dLat + dLon * dLon
}
const num = (v: unknown) => (v == null ? NaN : Number(v))

// 從 CWA 回應取「各鄉鎮清單」——相容大小寫(Locations/locations、Location/location)
function pickLocations(records: Record<string, unknown>): Record<string, unknown>[] {
  const locs = (records.Locations || records.locations) as Record<string, unknown>[] | undefined
  const first = locs?.[0]
  return ((first?.Location || first?.location) as Record<string, unknown>[]) || []
}
const locLat = (l: Record<string, unknown>) => num(l.Latitude ?? l.lat)
const locLon = (l: Record<string, unknown>) => num(l.Longitude ?? l.lon)
const locName = (l: Record<string, unknown>) => String(l.LocationName ?? l.locationName ?? '')

// 取某鄉鎮的「天氣現象」時間序列
function wxTimes(loc: Record<string, unknown>): Record<string, unknown>[] {
  const els = (loc.WeatherElement || loc.weatherElement) as Record<string, unknown>[] | undefined
  const wx = els?.find((e) => {
    const n = String(e.ElementName ?? e.elementName ?? '')
    return n.includes('天氣現象') || n === 'Wx'
  })
  return ((wx?.Time || wx?.time) as Record<string, unknown>[]) || []
}
// 一個時段的天氣文字
function wxText(t: Record<string, unknown>): string {
  const ev = (t.ElementValue || t.elementValue) as Record<string, unknown>[] | Record<string, unknown> | undefined
  const first = Array.isArray(ev) ? ev[0] : ev
  return String((first?.Weather ?? first?.value ?? '') || '').trim()
}
const startOf = (t: Record<string, unknown>) => String(t.StartTime ?? t.startTime ?? t.DataTime ?? t.dataTime ?? '')

// 從時間序列挑「date 當天、時段落在 [loHour,hiHour) 內、最接近 targetHour」的天氣。
// 用窗口避免傍晚/夜間時段被誤當成上午(例如傍晚才填當天日誌時,上午時段已過→留空由人工填)。
function wxAt(times: Record<string, unknown>[], date: string, loHour: number, hiHour: number, targetHour: number): string {
  let best = '', bestDiff = Infinity
  for (const t of times) {
    const st = startOf(t)
    if (!st.startsWith(date)) continue
    const hour = Number(st.slice(11, 13))
    if (isNaN(hour) || hour < loHour || hour >= hiHour) continue
    const diff = Math.abs(hour - targetHour)
    if (diff < bestDiff) { bestDiff = diff; best = wxText(t) }
  }
  return best
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const key = Deno.env.get('CWA_API_KEY')
    if (!key) return json({ error: '伺服器未設定 CWA_API_KEY(中央氣象局授權碼)' }, 500)
    const { lat, lon, date } = await req.json()
    if (lat == null || lon == null) return json({ error: '缺少工地座標' }, 400)
    const day = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : new Date().toISOString().slice(0, 10)

    const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${DATASET}?Authorization=${encodeURIComponent(key)}`
    const resp = await fetch(url)
    if (!resp.ok) return json({ error: `中央氣象局 ${resp.status}` }, 502)
    const body = await resp.json()
    if (body?.success === 'false' || body?.success === false) return json({ error: '中央氣象局:授權碼無效或查詢失敗' }, 502)

    const locations = pickLocations(body.records || {})
    if (!locations.length) return json({ error: '中央氣象局回應無鄉鎮資料(格式可能已變更)' }, 502)

    // 找最近鄉鎮
    let near: Record<string, unknown> | null = null, nd = Infinity
    for (const l of locations) {
      const la = locLat(l), lo = locLon(l)
      if (isNaN(la) || isNaN(lo)) continue
      const d = dist2(Number(lat), Number(lon), la, lo)
      if (d < nd) { nd = d; near = l }
    }
    if (!near) return json({ error: '找不到最近鄉鎮(座標可能不在台灣範圍,請確認緯經度)' }, 200)

    const times = wxTimes(near)
    const am = wxAt(times, day, 6, 12, 9)    // 上午:06–12 時,取最接近 09 時
    const pm = wxAt(times, day, 12, 18, 15)  // 下午:12–18 時,取最接近 15 時
    if (!am && !pm) return json({ error: `中央氣象局預報未涵蓋 ${day}(逐 3 小時僅約未來 3 天,過去或太遠日期請手動填寫天氣)` }, 200)

    const township = locName(near)
    return json({ am, pm, township, source: `中央氣象局 ${township}` }, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
