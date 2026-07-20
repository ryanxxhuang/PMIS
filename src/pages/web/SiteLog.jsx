import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Printer, ChevronRight, CopyPlus, Plus, CloudSun, Sparkles } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Empty, PageHeader, PrerequisiteEmptyState } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { previousLog, copyableFromLog, frequentItems, addUniqueRow } from '../../lib/siteLogHelpers.js'
import { WorkItemPicker } from '../../components/DefectTracker.jsx'

const fmt = (n) => (n == null || isNaN(n) ? '' : Math.round(n).toLocaleString('en-US'))
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 把 AI 讀到的工項文字模糊比對到標單末端工項（回 work item 或 null）。
// 含子串 → 取長度比;否則用字元交集 ×0.6;門檻 0.5。使用者最後會確認,寧可漏配也不要錯配。
function matchLeaf(text, leaves) {
  const t = (text || '').replace(/\s/g, '')
  if (!t) return null
  let best = null, score = 0
  for (const it of leaves) {
    const d = (it.description || '').replace(/\s/g, '')
    if (!d) continue
    let s
    if (d.includes(t) || t.includes(d)) s = Math.min(t.length, d.length) / Math.max(t.length, d.length)
    else { const overlap = [...new Set(t)].filter((c) => d.includes(c)).length; s = (overlap / Math.max(t.length, d.length)) * 0.6 }
    if (s > score) { score = s; best = it }
  }
  return score >= 0.5 ? best : null
}

export default function SiteLog() {
  const { project, workItems, adjustedItems, siteLogs, saveSiteLog, deleteSiteLog, isSupabaseConfigured, currentProject, workItemsSource,
    listSitePhotos, uploadSitePhoto, deleteSitePhoto, readWhiteboard, classifySitePhoto, fetchWeather, updateProjectAnchors, can } = useStore()
  const navigate = useNavigate()
  const [date, setDate] = useState(todayStr())
  const [weather, setWeather] = useState('晴')       // 上午天氣（相容舊欄位）
  const [weatherPm, setWeatherPm] = useState('')     // 下午天氣
  const [weatherBusy, setWeatherBusy] = useState(false)
  const [coordOpen, setCoordOpen] = useState(false)
  const [lat, setLat] = useState(currentProject?.latitude ?? '') // 工地座標(CWA 天氣)
  const [lon, setLon] = useState(currentProject?.longitude ?? '')
  const [summary, setSummary] = useState('')
  const [items, setItems] = useState({}) // item_key -> 當日數量
  // 公定格式欄位（工程會公共工程施工日誌）
  const [officialOpen, setOfficialOpen] = useState(false)
  const [labor, setLabor] = useState([])         // [{type,count}]
  const [equipment, setEquipment] = useState([]) // [{name,count}]
  const [materials, setMaterials] = useState([]) // [{name,unit,qty}]
  const [extras, setExtras] = useState({})       // 四~八節
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [photos, setPhotos] = useState([])      // 本日日誌的現場照片（含簽名 URL）
  const [photoBusy, setPhotoBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)   // AI 現場辨識中
  const [aiMsg, setAiMsg] = useState('')
  // AI 批次辨識照片:選檔後先進 staging 逐張判讀,使用者覆核可編說明/工項,再一鍵全上傳
  const [staging, setStaging] = useState([])    // [{key,file,previewUrl,status,caption,category,work_item_key,work_item_label}]
  const [batchBusy, setBatchBusy] = useState(false)

  // 發包末端工項（可回報的單元）+ 查表。
  // 用「已核准變更套回後」的工項(B-02 小尾巴):否則核准追加數量後,
  // 當日回報上限(setQty 夾在 0~契約數量)仍卡在舊契約數量。
  const { leaves, byKey } = useMemo(() => {
    if (!workItems) return { leaves: [], byKey: new Map() }
    const childMap = new Map()
    for (const it of adjustedItems) {
      const k = it.parent_key || '__root__'
      if (!childMap.has(k)) childMap.set(k, [])
      childMap.get(k).push(it)
    }
    const m = new Map(adjustedItems.map((it) => [it.item_key, it]))
    const lv = adjustedItems.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
    return { leaves: lv, byKey: m }
  }, [workItems, adjustedItems])

  // 切換日期 → 載入該日已存的日誌
  useEffect(() => {
    const lg = siteLogs.find((l) => l.log_date === date)
    if (lg) {
      setWeather(lg.weather_am || lg.weather || '晴'); setWeatherPm(lg.weather_pm || '')
      setSummary(lg.work_summary || ''); setItems({ ...lg.items })
      setLabor(lg.labor || []); setEquipment(lg.equipment || []); setMaterials(lg.materials || []); setExtras(lg.extras || {})
    } else { setItems({}); setSummary(''); setWeatherPm(''); setLabor([]); setEquipment([]); setMaterials([]); setExtras({}) }
  }, [date, siteLogs])

  // 切換日期 → 載入該日已存日誌的現場照片（未存檔的日期沒有 daily_log_id，無照片）
  useEffect(() => {
    const lg = siteLogs.find((l) => l.log_date === date)
    if (lg?.id) listSitePhotos(lg.id).then(setPhotos)
    else setPhotos([])
  }, [date, siteLogs, listSitePhotos])

  // 零輸入:複製昨日 + 從歷史自學常用項目
  const prevLog = useMemo(() => previousLog(siteLogs, date), [siteLogs, date])
  const freq = useMemo(() => frequentItems(siteLogs), [siteLogs])
  const dateHasLog = siteLogs.some((l) => l.log_date === date)
  const copyYesterday = () => {
    const c = copyableFromLog(prevLog)
    if (!c) return
    setLabor(c.labor); setEquipment(c.equipment); setMaterials(c.materials); setExtras(c.extras)
    if (c.weather) setWeather(c.weather)
    setWeatherPm(c.weather_pm)
    setSavedMsg(`已帶入 ${c.from} 的班組/機具/材料,請調整今日差異後存檔`)
  }

  // 天氣:工地座標 → 中央氣象局自動帶入(座標存一次,之後每天一鍵)
  const hasCoords = currentProject?.latitude != null && currentProject?.longitude != null
  const pullWeather = async () => {
    if (!hasCoords) { setCoordOpen(true); return }
    setWeatherBusy(true); setSavedMsg('')
    const r = await fetchWeather(currentProject.latitude, currentProject.longitude, date)
    setWeatherBusy(false)
    if (r?.error) { setSavedMsg(`天氣未帶入:${r.error}`); return }
    if (r.am) setWeather(r.am)
    if (r.pm) setWeatherPm(r.pm)
    setSavedMsg(`天氣已帶入(資料來源:${r.source || '中央氣象局'}）`)
  }
  const saveCoords = async () => {
    const la = parseFloat(lat), lo = parseFloat(lon)
    if (isNaN(la) || isNaN(lo)) { setSavedMsg('請輸入有效的經緯度數字'); return }
    setWeatherBusy(true)
    const { error } = await updateProjectAnchors({ latitude: la, longitude: lo })
    setWeatherBusy(false)
    if (error) { setSavedMsg(`座標未儲存:${error.message}`); return }
    setCoordOpen(false)
    // 存好座標後直接撈一次天氣
    setWeatherBusy(true); setSavedMsg('')
    const r = await fetchWeather(la, lo, date)
    setWeatherBusy(false)
    if (r?.error) { setSavedMsg(`座標已存,但天氣未帶入:${r.error}`); return }
    if (r.am) setWeather(r.am); if (r.pm) setWeatherPm(r.pm)
    setSavedMsg(`工地座標已儲存;天氣已帶入(${r.source || '中央氣象局'}）`)
  }

  if (!workItems) return <Empty>載入中…</Empty>
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return (
      <Card title="施工日誌">
        <PrerequisiteEmptyState
          need="施工日誌要掛在標單工項上回報當日完成數量,此專案的標單尚未匯入。"
          unlocks="工項數量回報、現場照片、天氣帶入、估驗自動累計"
          to={can.edit ? '/boq' : undefined} cta={can.edit ? '前往標單工項匯入' : undefined}
          who={!can.edit ? '施工日誌由施工廠商填報;待廠商匯入標單並回報後即可檢視。' : undefined} />
      </Card>
    )
  }

  const q = search.trim()
  const results = q ? leaves.filter((it) => it.description.includes(q) || (it.item_no || '').includes(q)).slice(0, 20) : []
  const addItem = (key) => { setItems((p) => ({ ...p, [key]: p[key] ?? 0 })); setSearch('') }
  const setQty = (key, val) => {
    let n = parseFloat(val); if (isNaN(n)) n = 0
    const it = byKey.get(key); const mq = it?.quantity || 0
    n = Math.max(0, mq > 0 ? Math.min(mq, n) : n)
    setItems((p) => ({ ...p, [key]: n }))
  }
  const removeItem = (key) => setItems((p) => { const n = { ...p }; delete n[key]; return n })

  const onSave = async () => {
    setSaving(true); setSavedMsg('')
    const { error } = await saveSiteLog({
      log_date: date, weather, weather_am: weather, weather_pm: weatherPm,
      labor, equipment, materials, extras, work_summary: summary, items,
    })
    setSaving(false)
    setSavedMsg(error ? (error.message || '存檔失敗') : '已存檔 ✓')
  }

  // 本日已存檔的日誌（有 id 才能掛照片）
  const currentLog = siteLogs.find((l) => l.log_date === date)

  const onAddPhotos = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // 允許重新選同一檔
    if (!currentLog?.id || !files.length) return
    setPhotoBusy(true)
    for (const f of files) {
      const { error } = await uploadSitePhoto(currentLog.id, f, { caption: summary || null })
      if (error) { setSavedMsg(error.message || '照片上傳失敗'); break }
    }
    setPhotos(await listSitePhotos(currentLog.id))
    setPhotoBusy(false)
  }

  const onDeletePhoto = async (p) => {
    const { error } = await deleteSitePhoto(p)
    if (error) { setSavedMsg(`照片刪除失敗:${error.message}`); return }
    if (currentLog?.id) setPhotos(await listSitePhotos(currentLog.id))
  }

  // AI 批次辨識:多檔 → 逐張 classify（併發 3）+ 模糊配工項 → 進 staging 覆核 → 一鍵全上傳。
  // 覆核制:AI 猜的說明/工項先給人改再存,不直接落庫(寧可讓人確認也不錯配)。
  const onBatchPhotos = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!currentLog?.id || !files.length) return
    const stage = files.map((file) => ({
      key: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file),
      status: 'analyzing', caption: '', category: '', work_item_key: '', work_item_label: '', errMsg: '',
    }))
    setStaging(stage)
    setBatchBusy(true)
    let i = 0
    const worker = async () => {
      while (i < stage.length) {
        const s = stage[i++]
        const { error, result } = await classifySitePhoto(s.file)
        const wi = !error && result?.work_item_hint ? matchLeaf(result.work_item_hint, leaves) : null
        setStaging((prev) => prev.map((p) => p.key === s.key ? {
          ...p, status: error ? 'error' : 'done',
          caption: error ? '' : (result.caption || ''), category: error ? '' : (result.category || ''),
          errMsg: error ? (error.message || '判讀失敗') : '',
          notSite: !error && result?.is_construction === false, // AI 判為非工地照,提醒人工確認
          work_item_key: wi?.item_key || '', work_item_label: wi ? `${wi.item_no} ${wi.description}` : '',
        } : p))
      }
    }
    await Promise.all([worker(), worker(), worker()])
    setBatchBusy(false)
  }

  const patchStaging = (key, patch) => setStaging((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  const removeStaging = (key) => setStaging((prev) => {
    const s = prev.find((p) => p.key === key); if (s) URL.revokeObjectURL(s.previewUrl)
    return prev.filter((p) => p.key !== key)
  })
  const cancelBatch = () => { staging.forEach((s) => URL.revokeObjectURL(s.previewUrl)); setStaging([]) }

  const confirmBatchUpload = async () => {
    if (!currentLog?.id) return
    setBatchBusy(true); setSavedMsg('')
    let ok = 0, fail = 0
    for (const s of staging) {
      if (s.status === 'analyzing') continue // 判讀中的略過;error 張仍可帶人工說明上傳(P1-02)
      const { error } = await uploadSitePhoto(currentLog.id, s.file, {
        caption: s.caption || null, work_item_key: s.work_item_key || null,
      })
      if (error) { fail++ } else { ok++; URL.revokeObjectURL(s.previewUrl) }
    }
    setPhotos(await listSitePhotos(currentLog.id))
    setStaging([]); setBatchBusy(false)
    setSavedMsg(`已上傳 ${ok} 張照片${fail ? `,${fail} 張未成功` : ''}（AI 生說明，可再刪改）`)
  }

  // AI 現場辨識:拍工程告示板/現場照片 → 自動填日期/天氣/摘要 + 把工項數量帶入（工項用模糊比對到標單）
  const onWhiteboard = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setAiBusy(true); setAiMsg('AI 辨識中…')
    const { error, result } = await readWhiteboard(file)
    setAiBusy(false)
    if (error) { setAiMsg(`辨識失敗:${error.message || ''}`); return }
    if (result.log_date && /^\d{4}-\d{2}-\d{2}$/.test(result.log_date)) setDate(result.log_date)
    if (result.weather) setWeather(result.weather)
    if (result.work_summary) setSummary((s) => s || result.work_summary)
    const next = { ...items }; let matched = 0; const missed = []
    for (const it of result.items || []) {
      const wi = matchLeaf(it.description, leaves)
      if (wi) { next[wi.item_key] = it.quantity || 0; matched++ } else if (it.description) missed.push(it.description)
    }
    setItems(next)
    setAiMsg(`AI 帶入 ${matched} 項${missed.length ? `,未對應:${missed.join('、')}` : ''}。請確認數量後存檔。`)
  }

  const reportedKeys = Object.keys(items)

  return (
    <div className="space-y-5">
      <div>
        <PageHeader title="施工日誌" tagline="每日進度回報" subtitle="填各工項當日完成數量，估驗可一鍵帶入累計" />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Card title="本日日誌">
            {!can.edit && (
              <div className="mb-3 text-xs text-[var(--text-2)] bg-[var(--surface-2)] rounded-lg px-3 py-2">
                {can.oversee ? '機關監督檢視' : '監造檢視'}：施工日誌由施工廠商填報，此頁為<b>唯讀</b>，可切換日期檢視歷史紀錄。
              </div>
            )}
            <div className="flex items-end gap-3 flex-wrap mb-2">
              <Field label="日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" /></Field>
              <Field label="天氣(上午)"><input value={weather} disabled={!can.edit} onChange={(e) => setWeather(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm w-20 disabled:opacity-50 disabled:bg-[var(--surface-2)]" /></Field>
              <Field label="天氣(下午)"><input value={weatherPm} disabled={!can.edit} onChange={(e) => setWeatherPm(e.target.value)} placeholder="同上午" className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm w-20 disabled:opacity-50 disabled:bg-[var(--surface-2)]" /></Field>
              <div className="w-full sm:w-auto"><Field label="工作摘要"><input value={summary} disabled={!can.edit} onChange={(e) => setSummary(e.target.value)} placeholder="今日施工概況" className="w-full sm:w-64 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm disabled:opacity-50 disabled:bg-[var(--surface-2)]" /></Field></div>
              {can.edit && (
                <Button variant="secondary" onClick={pullWeather} disabled={weatherBusy} title="依工地座標向中央氣象局帶入今日天氣">
                  <CloudSun size={14} aria-hidden />{weatherBusy ? '帶入中…' : '帶入天氣'}
                </Button>
              )}
              {/* 零輸入:一鍵帶入前一筆日誌的班組/機具/材料(僅新日期、且有前一筆時) */}
              {can.edit && !dateHasLog && prevLog && (
                <Button variant="secondary" onClick={copyYesterday} title={`帶入 ${prevLog.log_date} 的班組/機具/材料`}>
                  <CopyPlus size={14} aria-hidden />複製昨日
                </Button>
              )}
            </div>
            {/* 工地座標設定(首次帶天氣時出現;存一次之後每天一鍵帶入) */}
            {can.edit && coordOpen && (
              <div className="mb-4 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex flex-wrap items-end gap-3">
                <div className="text-xs text-[var(--text-2)] w-full">設定工地經緯度(存一次,之後每天一鍵帶入中央氣象局天氣)。可在 Google 地圖長按工地位置複製座標。</div>
                <Field label="緯度 Latitude"><input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="24.9937" className="w-28 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm tabular-nums" /></Field>
                <Field label="經度 Longitude"><input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="121.3009" className="w-28 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm tabular-nums" /></Field>
                <Button onClick={saveCoords} disabled={weatherBusy}>{weatherBusy ? '處理中…' : '儲存並帶入天氣'}</Button>
                <button onClick={() => setCoordOpen(false)} className="text-sm text-[var(--text-3)] hover:underline">取消</button>
              </div>
            )}
            {can.edit && hasCoords && !coordOpen && (
              <div className="mb-4 -mt-1 text-[11px] text-[var(--text-3)]">
                工地座標 {Number(currentProject.latitude).toFixed(4)}, {Number(currentProject.longitude).toFixed(4)}
                <button onClick={() => { setLat(currentProject.latitude); setLon(currentProject.longitude); setCoordOpen(true) }} className="ml-2 text-[var(--blue-text)] hover:underline">修改</button>
              </div>
            )}

            {can.edit && <div className="mb-3 p-3 rounded-lg bg-[var(--blue-tint)] border border-[var(--blue)]/30">
              <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 pressable ${aiBusy ? 'opacity-50' : 'cursor-pointer bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] shadow-sm'}`}>
                <input type="file" accept="image/*" capture="environment" disabled={aiBusy} onChange={onWhiteboard} className="hidden" />
                <Camera size={15} aria-hidden /> {aiBusy ? 'AI 辨識中…' : 'AI 拍照自動填寫'}
              </label>
              <p className={`text-xs mt-2 ${aiMsg.startsWith('辨識失敗') ? 'text-[var(--red-text)]' : 'text-[var(--text-2)]'}`}>
                {aiMsg || '拍下工程告示板或現場照片，AI 辨識後自動帶入日期、天氣與各工項當日數量。'}
              </p>
            </div>}

            <div className="relative mb-3">
              <input value={search} disabled={!can.edit} onChange={(e) => setSearch(e.target.value)} placeholder={can.edit ? '搜尋工項加入今日回報…' : '唯讀檢視'} className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:border-[var(--blue)] focus:outline-none disabled:opacity-50 disabled:bg-[var(--surface-2)]" />
              {results.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg max-h-64 overflow-auto enter-menu">
                  {results.map((it) => (
                    <button key={it.item_key} onClick={() => addItem(it.item_key)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] flex justify-between gap-2">
                      <span className="truncate"><span className="text-[var(--text-3)] text-xs mr-2">{it.item_no}</span>{it.description}</span>
                      <span className="text-[var(--text-3)] text-xs shrink-0">{it.unit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {reportedKeys.length === 0 ? (
              <Empty>尚未加入工項。用上面搜尋把今天有施作的工項加進來，填當日數量。</Empty>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[460px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                    <th className="text-left py-1.5">工項</th>
                    <th className="text-right px-2 whitespace-nowrap">單位</th>
                    <th className="text-right px-2 whitespace-nowrap">契約數量</th>
                    <th className="text-right px-2 whitespace-nowrap">當日完成數量</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {reportedKeys.map((key) => {
                    const it = byKey.get(key) || {}
                    return (
                      <tr key={key} className="border-b border-[var(--border-2)]">
                        <td className="py-1.5"><span className="text-[var(--text-3)] text-xs mr-2 tabular-nums">{it.item_no}</span>{it.description}</td>
                        <td className="text-right text-[var(--text-3)] text-xs px-2 whitespace-nowrap">{it.unit}</td>
                        <td className="text-right text-[var(--text-2)] px-2 tabular-nums whitespace-nowrap">{fmt(it.quantity)}</td>
                        <td className="text-right px-2">
                          <input type="number" min="0" step="any" value={items[key] ?? ''} disabled={!can.edit} onChange={(e) => setQty(key, e.target.value)}
                            className="w-24 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-sm tabular-nums focus:border-[var(--blue)] focus:outline-none disabled:opacity-50 disabled:bg-[var(--surface-2)]" />
                        </td>
                        <td className="text-right pl-2">{can.edit && <button onClick={() => removeItem(key)} className="text-[var(--text-3)] hover:text-[var(--red-text)]" aria-label="移除此工項">✕</button>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            )}

            {/* 公定格式欄位（工程會「公共工程施工日誌」二~八節）*/}
            <div className="mt-4 border border-[var(--border)] rounded-lg">
              <button onClick={() => setOfficialOpen((o) => !o)}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--text-2)] hover:bg-[var(--surface-2)] rounded-lg">
                <ChevronRight size={15} aria-hidden className={`transition-transform duration-[var(--dur-fast)] ${officialOpen ? 'rotate-90' : ''}`} />
                公定格式欄位（出工人數・機具・材料・安衛…）
                <span className="ml-auto text-[11px] text-[var(--text-3)] font-normal">
                  {labor.length + equipment.length + materials.length > 0 ? `已填 ${labor.length + equipment.length + materials.length} 列` : '選填，列印公定格式日誌用'}
                </span>
              </button>
              {officialOpen && (
                <div className="px-3 pb-3 space-y-4">
                  <div>
                    {can.edit && <FreqChips items={freq.labor} label={(r) => r.type}
                      onAdd={(r) => setLabor((rows) => addUniqueRow(rows, r, (x) => x.type))} />}
                    <RowsEditor title="出工人數（工別）" rows={labor} onChange={setLabor} disabled={!can.edit}
                      fields={[{ key: 'type', ph: '工別（如 鋼筋工）', w: 'flex-1' }, { key: 'count', ph: '人數', w: 'w-20', num: true }]} />
                  </div>
                  <div>
                    {can.edit && <FreqChips items={freq.equipment} label={(r) => r.name}
                      onAdd={(r) => setEquipment((rows) => addUniqueRow(rows, r, (x) => x.name))} />}
                    <RowsEditor title="機具使用" rows={equipment} onChange={setEquipment} disabled={!can.edit}
                      fields={[{ key: 'name', ph: '機具名稱', w: 'flex-1' }, { key: 'count', ph: '數量', w: 'w-20', num: true }]} />
                  </div>
                  <div>
                    {can.edit && <FreqChips items={freq.materials} label={(r) => `${r.name}${r.unit ? `（${r.unit}）` : ''}`}
                      onAdd={(r) => setMaterials((rows) => addUniqueRow(rows, r, (x) => x.name))} />}
                    <RowsEditor title="材料使用" rows={materials} onChange={setMaterials} disabled={!can.edit}
                      fields={[{ key: 'name', ph: '材料名稱', w: 'flex-1' }, { key: 'unit', ph: '單位', w: 'w-16' }, { key: 'qty', ph: '本日數量', w: 'w-24', num: true }]} />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <label className="block">
                      <span className="block text-xs font-medium text-[var(--text-2)] mb-1">四、應置技術士（種類及人數，無則留空）</span>
                      <input value={extras.technicians || ''} disabled={!can.edit} onChange={(e) => setExtras({ ...extras, technicians: e.target.value })}
                        placeholder="如：混凝土工程技術士 2 名" className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm disabled:opacity-50 disabled:bg-[var(--surface-2)]" />
                    </label>
                    <div>
                      <span className="block text-xs font-medium text-[var(--text-2)] mb-1">五、職業安全衛生</span>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm py-1">
                        <label className="inline-flex items-center gap-1.5"><input type="checkbox" disabled={!can.edit} checked={!!extras.edu} onChange={(e) => setExtras({ ...extras, edu: e.target.checked })} />勤前教育（含危害告知）</label>
                        <label className="inline-flex items-center gap-1.5"><input type="checkbox" disabled={!can.edit} checked={!!extras.ppe} onChange={(e) => setExtras({ ...extras, ppe: e.target.checked })} />檢查個人防護具</label>
                        <label className="inline-flex items-center gap-1.5">新進勞工提報勞保
                          <select value={extras.insured || '無新進勞工'} disabled={!can.edit} onChange={(e) => setExtras({ ...extras, insured: e.target.value })}
                            className="border border-[var(--border)] rounded px-1.5 py-0.5 text-xs">
                            {['有', '無', '無新進勞工'].map((s) => <option key={s}>{s}</option>)}
                          </select>
                        </label>
                      </div>
                    </div>
                    <label className="block">
                      <span className="block text-xs font-medium text-[var(--text-2)] mb-1">六、施工取樣試驗紀錄</span>
                      <input value={extras.sampling || ''} disabled={!can.edit} onChange={(e) => setExtras({ ...extras, sampling: e.target.value })}
                        placeholder="如：混凝土圓柱試體 2 組、坍度 18±2.5cm" className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm disabled:opacity-50 disabled:bg-[var(--surface-2)]" />
                    </label>
                    <label className="block">
                      <span className="block text-xs font-medium text-[var(--text-2)] mb-1">七、通知協力廠商辦理事項</span>
                      <input value={extras.notice || ''} disabled={!can.edit} onChange={(e) => setExtras({ ...extras, notice: e.target.value })}
                        className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm disabled:opacity-50 disabled:bg-[var(--surface-2)]" />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="block text-xs font-medium text-[var(--text-2)] mb-1">八、重要事項紀錄</span>
                      <input value={extras.important || ''} disabled={!can.edit} onChange={(e) => setExtras({ ...extras, important: e.target.value })}
                        className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm disabled:opacity-50 disabled:bg-[var(--surface-2)]" />
                    </label>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 mt-4">
              {can.edit ? <Button onClick={onSave} disabled={saving}>{saving ? '存檔中…' : '存檔'}</Button> : <span className="text-xs text-[var(--text-3)]">{can.oversee ? '機關監督檢視' : '監造檢視'}：施工日誌由施工廠商填報，此頁為唯讀。</span>}
              {currentLog && (
                <button onClick={() => navigate(`/site-log/print?d=${date}`)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--blue)]">
                  <Printer size={15} aria-hidden />列印公定格式日誌
                </button>
              )}
              {savedMsg && <span className={`text-sm ${savedMsg.includes('✓') ? 'text-[var(--green-text)]' : 'text-[var(--red-text)]'}`}>{savedMsg}</span>}
            </div>
          </Card>

          <Card title="現場照片" className="mt-5">
            {!currentLog ? (
              <Empty>先存檔本日日誌，才能附上現場照片。</Empty>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {/* 照片上傳=施工廠商的事:唯讀角色(監造/機關)不顯示死按鈕(U-01) */}
                  {can.edit && <>
                    <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 pressable shadow-sm ${(photoBusy || batchBusy) ? 'opacity-40 bg-[var(--primary)] text-white' : 'cursor-pointer bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]'}`}>
                      {/* 批次=從相簿多選(不加 capture,否則手機會強開相機只能拍一張) */}
                      <input type="file" accept="image/*" multiple disabled={photoBusy || batchBusy} onChange={onBatchPhotos} className="hidden" />
                      <Sparkles size={15} aria-hidden /> AI 批次辨識照片
                    </label>
                    <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 border border-[var(--border)] pressable ${(photoBusy || batchBusy) ? 'opacity-40' : 'cursor-pointer hover:bg-[var(--surface-2)] text-[var(--text-2)]'}`}>
                      <input type="file" accept="image/*" capture="environment" multiple disabled={photoBusy || batchBusy} onChange={onAddPhotos} className="hidden" />
                      {photoBusy ? '上傳中…' : '＋ 直接加照片'}
                    </label>
                  </>}
                  <span className="text-xs text-[var(--text-3)]">{photos.length} 張{can.edit ? '　·　批次辨識＝AI 自動生說明並配對工項' : '（照片由施工廠商上傳）'}</span>
                </div>

                {/* 批次辨識覆核區:AI 逐張判讀後,人可改說明/工項再一鍵全上傳 */}
                {staging.length > 0 && (
                  <div className="mb-4 border border-[var(--blue)]/30 bg-[var(--blue)]/[0.04] rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-[var(--text)] inline-flex items-center gap-1.5">
                        <Sparkles size={14} className="text-[var(--blue)]" aria-hidden />
                        AI 辨識覆核（{staging.filter((s) => s.status === 'done').length}/{staging.length}）
                        {batchBusy && <span className="text-xs font-normal text-[var(--text-3)]">判讀中…</span>}
                      </div>
                      <button onClick={cancelBatch} disabled={batchBusy} className="text-xs text-[var(--text-3)] hover:text-[var(--red-text)]">取消</button>
                    </div>
                    <div className="space-y-2 max-h-[28rem] overflow-auto">
                      {staging.map((s) => (
                        <div key={s.key} className="flex gap-3 items-start bg-[var(--surface)] border border-[var(--border)] rounded-lg p-2">
                          <img src={s.previewUrl} alt="待上傳" className="w-16 h-16 rounded object-cover shrink-0 border border-[var(--border)]" />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            {s.status === 'analyzing' ? (
                              <div className="text-xs text-[var(--text-3)] py-3">AI 判讀中…</div>
                            ) : s.status === 'error' ? (
                              <div className="text-xs text-[var(--red-text)] py-1">辨識失敗：{s.errMsg}。仍可自行填說明後上傳。</div>
                            ) : null}
                            <input value={s.caption} disabled={s.status === 'analyzing'} placeholder="照片說明（AI 生成，可改）"
                              onChange={(e) => patchStaging(s.key, { caption: e.target.value })}
                              className="w-full border border-[var(--border)] rounded px-2 py-1 text-sm bg-[var(--surface)]" />
                            {s.status !== 'analyzing' && (
                              <>
                                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                                  {s.category && <span className="px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-2)]">{s.category}</span>}
                                  {s.notSite && <span className="px-1.5 py-0.5 rounded bg-[var(--amber-tint)] text-[var(--amber-text)] border border-[var(--amber-text)]/25">⚠ 疑似非工地照,請確認</span>}
                                </div>
                                {/* 可搜尋改選/清除工項(P1-02:不再只能取消配對)*/}
                                <WorkItemPicker leaves={leaves} value={s.work_item_key} label={s.work_item_label || '（搜尋工項…）'}
                                  onPick={(k, l) => patchStaging(s.key, { work_item_key: k || '', work_item_label: k ? l : '' })} />
                              </>
                            )}
                          </div>
                          <button onClick={() => removeStaging(s.key)} disabled={batchBusy} title="移除此張"
                            className="shrink-0 text-[var(--text-3)] hover:text-[var(--red-text)] text-sm leading-none">✕</button>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Button onClick={confirmBatchUpload} disabled={batchBusy || staging.every((s) => s.status === 'analyzing')}>
                        {batchBusy ? '處理中…' : `全部上傳（${staging.filter((s) => s.status !== 'analyzing').length}）`}
                      </Button>
                      <Button variant="secondary" onClick={cancelBatch} disabled={batchBusy}>取消</Button>
                    </div>
                  </div>
                )}

                {photos.length === 0 ? (
                  <Empty>尚無照片。用「AI 批次辨識照片」一次丟多張，AI 自動生說明並配工項。</Empty>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {photos.map((p) => (
                      <div key={p.id} className="group relative rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--surface-2)]">
                        <div className="aspect-square">
                          {p.url && <img src={p.url} alt={p.caption || '現場照片'} loading="lazy" className="w-full h-full object-cover" />}
                        </div>
                        {p.caption && (
                          <div className="px-1.5 py-1 text-[11px] leading-tight text-[var(--text-2)] bg-[var(--surface)] border-t border-[var(--border-2)] truncate" title={p.caption}>
                            {p.caption}
                          </div>
                        )}
                        {can.edit && <button onClick={() => onDeletePhoto(p)} title="刪除照片"
                          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 text-white text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity">✕</button>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        <Card title={`施工日誌（${siteLogs.length}）`} action={siteLogs.length > 0 && (
          <button onClick={() => {
            const flat = siteLogs.flatMap((l) => Object.entries(l.items).map(([key, qty]) => ({
              log_date: l.log_date, weather: l.weather || '', work_summary: l.work_summary || '',
              item_no: byKey.get(key)?.item_no || '', description: byKey.get(key)?.description || key,
              unit: byKey.get(key)?.unit || '', qty,
            })))
            exportCsv(`施工日誌_${stamp()}`, flat, [
              { key: 'log_date', label: '日期' }, { key: 'weather', label: '天氣' }, { key: 'work_summary', label: '工作摘要' },
              { key: 'item_no', label: '項次' }, { key: 'description', label: '工項' }, { key: 'unit', label: '單位' }, { key: 'qty', label: '當日數量' },
            ])
          }} className="text-sm font-medium text-[var(--blue)] hover:underline">⬇ CSV</button>
        )}>
          {siteLogs.length === 0 ? <Empty>尚無日誌</Empty> : (
            <div className="space-y-1.5">
              {siteLogs.map((l) => (
                <div key={l.id} className={`px-3 py-2 rounded-lg text-sm border transition-colors ${l.log_date === date ? 'bg-[var(--blue-tint)] border-[var(--blue)]' : 'border-[var(--border)] hover:bg-[var(--surface-2)]'}`}>
                  <div className="flex justify-between items-center gap-2">
                    <button onClick={() => setDate(l.log_date)} className="font-medium text-[var(--text)] tabular-nums text-left flex-1 truncate">{l.log_date}</button>
                    <span className="text-xs text-[var(--text-3)]">{Object.keys(l.items).length} 工項</span>
                    {can.edit && <button onClick={async () => { if (await appConfirm({ title: `刪除 ${l.log_date} 的施工日誌？`, danger: true, confirmLabel: '刪除' })) { const { error } = await deleteSiteLog(l.id); if (error) setSavedMsg(`日誌刪除失敗:${error.message}`) } }} className="text-[var(--text-3)] hover:text-[var(--red-text)]" aria-label={`刪除 ${l.log_date} 日誌`}>✕</button>}
                  </div>
                  {l.work_summary && <div className="text-xs text-[var(--text-2)] truncate mt-0.5">{l.work_summary}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <p className="text-xs text-[var(--text-3)]">
        一天一筆（同日再存會覆蓋）。零輸入:新日期可「複製昨日」帶入班組/機具/材料、天氣點選快填、常用項目一鍵加入（依你的歷史自動學）。各日「當日完成數量」加總 = 估驗的「累計完成數量」——到估驗頁（草稿期）按「AI 估驗草擬」即可自動帶入。
      </p>
    </div>
  )
}

// 小型列編輯器（出工/機具/材料共用）：fields = [{key, ph, w, num}]
// 常用項目一鍵帶入(從歷史自學):點 chip 加入一列,已有同項則略過
function FreqChips({ items, label, onAdd }) {
  if (!items?.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1 mb-1.5">
      <span className="text-[10px] text-[var(--text-3)]">常用</span>
      {items.map((r, i) => (
        <button key={i} onClick={() => onAdd(r)}
          className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--blue-tint)] hover:text-[var(--blue-text)] hover:border-[var(--blue)] pressable">
          <Plus size={10} aria-hidden />{label(r)}
        </button>
      ))}
    </div>
  )
}

function RowsEditor({ title, rows, onChange, fields, disabled = false }) {
  const set = (i, key, val) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: val } : r)))
  const add = () => onChange([...rows, Object.fromEntries(fields.map((f) => [f.key, f.num ? '' : '']))])
  const del = (i) => onChange(rows.filter((_, j) => j !== i))
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-[var(--text-2)]">{title}</span>
        {!disabled && <button onClick={add} className="text-xs text-[var(--blue)] hover:underline">＋ 加一列</button>}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--text-3)]">（未填）</p>
      ) : rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 mb-1.5">
          {fields.map((f) => (
            <input key={f.key} value={r[f.key] ?? ''} placeholder={f.ph} disabled={disabled}
              type={f.num ? 'number' : 'text'} min={f.num ? 0 : undefined} step={f.num ? 'any' : undefined}
              onChange={(e) => set(i, f.key, f.num ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
              className={`${f.w} border border-[var(--border)] rounded-lg px-2 py-1 text-sm ${f.num ? 'text-right tabular-nums' : ''} disabled:opacity-50 disabled:bg-[var(--surface-2)]`} />
          ))}
          {!disabled && <button onClick={() => del(i)} className="text-[var(--text-3)] hover:text-[var(--red-text)]" aria-label="刪除此列">✕</button>}
        </div>
      ))}
    </div>
  )
}
