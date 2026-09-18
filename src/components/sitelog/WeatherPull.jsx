// 「帶入天氣」(施工日誌 P2c、監造日誌 P3a 共用):依工地座標向中央氣象署取當日天氣;沒座標先就地設定
// (存到專案基準,之後每天一鍵)。P3a 從 SiteLog 抽出來共用,行為不變:結果由呼叫端以 onApply 寫進表單
// (值與來源 cwa 一起走),訊息由 onMessage 回報,這裡不碰表單狀態。
import { useState } from 'react'
import { useStore } from '../../store.jsx'
import { Button, Field, Input } from '../ui.jsx'
import { MSym } from '../icons.jsx'
import { friendlyError } from '../../lib/errorMessage.js'

export default function WeatherPull({ date, onApply, onMessage }) {
  const { currentProject, fetchWeather, updateProjectAnchors } = useStore()
  const [busy, setBusy] = useState(false)
  const [coordOpen, setCoordOpen] = useState(false)
  const [lat, setLat] = useState(currentProject?.latitude ?? '')
  const [lon, setLon] = useState(currentProject?.longitude ?? '')
  const hasCoords = currentProject?.latitude != null && currentProject?.longitude != null

  const pull = async () => {
    if (!hasCoords) { setCoordOpen(true); return }
    setBusy(true); onMessage?.('')
    const r = await fetchWeather(currentProject.latitude, currentProject.longitude, date)
    setBusy(false)
    if (r?.error) { onMessage?.(`天氣未帶入:${r.error}`, 'info'); return }
    onApply(r)
    onMessage?.(`天氣已帶入(資料來源:${r.source || '中央氣象局'}）`, 'info')
  }
  const saveCoords = async () => {
    const la = parseFloat(lat), lo = parseFloat(lon)
    if (isNaN(la) || isNaN(lo)) { onMessage?.('請輸入有效的經緯度數字'); return }
    setBusy(true)
    const { error } = await updateProjectAnchors({ latitude: la, longitude: lo })
    if (error) { setBusy(false); onMessage?.(friendlyError(error, '座標未儲存')); return }
    setCoordOpen(false)
    const r = await fetchWeather(la, lo, date)
    setBusy(false)
    if (r?.error) { onMessage?.(`座標已存,但天氣未帶入:${r.error}`, 'info'); return }
    onApply(r)
    onMessage?.(`工地座標已儲存;天氣已帶入(${r.source || '中央氣象局'}）`, 'info')
  }

  return (
    <>
      <Button variant="secondary" onClick={pull} disabled={busy} title="依工地座標向中央氣象局帶入今日天氣">
        <MSym name="partly_cloudy_day" size={14} />{busy ? '帶入中…' : '帶入天氣'}
      </Button>
      {coordOpen && (
        <div className="w-full mb-1 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex flex-wrap items-end gap-3">
          <div className="text-xs text-[var(--text-2)] w-full">設定工地經緯度(存一次,之後每天一鍵帶入中央氣象局天氣)。可在 Google 地圖長按工地位置複製座標。</div>
          <Field label="緯度 Latitude"><Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="24.9937" className="!w-28 num" /></Field>
          <Field label="經度 Longitude"><Input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="121.3009" className="!w-28 num" /></Field>
          <Button onClick={saveCoords} busy={busy}>{busy ? '處理中…' : '儲存並帶入天氣'}</Button>
          <Button variant="ghost" size="sm" onClick={() => setCoordOpen(false)}>取消</Button>
        </div>
      )}
    </>
  )
}
