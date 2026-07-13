import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Printer, ChevronDown, ChevronRight, CopyPlus, Plus } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Empty, PageHeader } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { previousLog, copyableFromLog, frequentItems, addUniqueRow } from '../../lib/siteLogHelpers.js'

// 天氣快選(點選免打字);仍可在輸入框自訂
const WEATHER_PRESETS = ['晴', '晴時多雲', '多雲', '陰', '短暫雨', '陣雨', '雨', '雷陣雨']

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
  const { project, workItems, siteLogs, saveSiteLog, deleteSiteLog, isSupabaseConfigured, currentProject, workItemsSource,
    listSitePhotos, uploadSitePhoto, deleteSitePhoto, readWhiteboard, can } = useStore()
  const navigate = useNavigate()
  const [date, setDate] = useState(todayStr())
  const [weather, setWeather] = useState('晴')       // 上午天氣（相容舊欄位）
  const [weatherPm, setWeatherPm] = useState('')     // 下午天氣
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

  // 發包末端工項（可回報的單元）+ 查表
  const { leaves, byKey } = useMemo(() => {
    if (!workItems) return { leaves: [], byKey: new Map() }
    const childMap = new Map()
    for (const it of workItems.items) {
      const k = it.parent_key || '__root__'
      if (!childMap.has(k)) childMap.set(k, [])
      childMap.get(k).push(it)
    }
    const m = new Map(workItems.items.map((it) => [it.item_key, it]))
    const lv = workItems.items.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
    return { leaves: lv, byKey: m }
  }, [workItems])

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

  if (!workItems) return <Empty>載入中…</Empty>
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return <Card title="施工日誌"><Empty>此專案的標單尚未匯入資料庫。請先到「標單工項」匯入標單，才能回報工項數量。</Empty></Card>
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
    await deleteSitePhoto(p)
    if (currentLog?.id) setPhotos(await listSitePhotos(currentLog.id))
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
            <div className="flex items-end gap-3 flex-wrap mb-2">
              <Field label="日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" /></Field>
              <Field label="天氣(上午)"><input value={weather} onChange={(e) => setWeather(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm w-20" /></Field>
              <Field label="天氣(下午)"><input value={weatherPm} onChange={(e) => setWeatherPm(e.target.value)} placeholder="同上午" className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm w-20" /></Field>
              <div className="w-full sm:w-auto"><Field label="工作摘要"><input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="今日施工概況" className="w-full sm:w-64 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" /></Field></div>
              {/* 零輸入:一鍵帶入前一筆日誌的班組/機具/材料(僅新日期、且有前一筆時) */}
              {can.edit && !dateHasLog && prevLog && (
                <Button variant="secondary" onClick={copyYesterday} title={`帶入 ${prevLog.log_date} 的班組/機具/材料`}>
                  <CopyPlus size={14} aria-hidden />複製昨日
                </Button>
              )}
            </div>
            {/* 天氣快選:點選免打字(仍可在上方輸入框自訂) */}
            {can.edit && (
              <div className="flex flex-wrap items-center gap-1.5 mb-4 text-[11px]">
                <span className="text-[var(--text-3)]">快選天氣</span>
                {WEATHER_PRESETS.map((w) => (
                  <span key={w} className="inline-flex rounded-full border border-[var(--border)] overflow-hidden">
                    <button onClick={() => setWeather(w)} className={`px-2 py-0.5 hover:bg-[var(--surface-2)] ${weather === w ? 'bg-[var(--blue-tint)] text-[var(--blue-text)] font-medium' : 'text-[var(--text-2)]'}`} title="設為上午">{w}</button>
                    <button onClick={() => setWeatherPm(w)} className={`px-1.5 py-0.5 border-l border-[var(--border)] hover:bg-[var(--surface-2)] ${weatherPm === w ? 'bg-[var(--amber-tint)] text-[var(--amber-text)] font-medium' : 'text-[var(--text-3)]'}`} title="設為下午">下</button>
                  </span>
                ))}
              </div>
            )}

            {can.edit && <div className="mb-3 p-3 rounded-lg bg-[var(--blue-tint)] border border-[var(--blue)]/30">
              <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 transition ${aiBusy ? 'opacity-50' : 'cursor-pointer bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] shadow-sm'}`}>
                <input type="file" accept="image/*" capture="environment" disabled={aiBusy} onChange={onWhiteboard} className="hidden" />
                <Camera size={15} aria-hidden /> {aiBusy ? 'AI 辨識中…' : 'AI 拍照自動填寫'}
              </label>
              <p className={`text-xs mt-2 ${aiMsg.startsWith('辨識失敗') ? 'text-rose-600' : 'text-[var(--text-2)]'}`}>
                {aiMsg || '拍下工程告示板或現場照片，AI 辨識後自動帶入日期、天氣與各工項當日數量。'}
              </p>
            </div>}

            <div className="relative mb-3">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋工項加入今日回報…" className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:border-[var(--blue)] focus:outline-none" />
              {results.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg max-h-64 overflow-auto">
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
                          <input type="number" min="0" step="any" value={items[key] ?? ''} onChange={(e) => setQty(key, e.target.value)}
                            className="w-24 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-sm tabular-nums focus:border-[var(--blue)] focus:outline-none" />
                        </td>
                        <td className="text-right pl-2"><button onClick={() => removeItem(key)} className="text-[var(--text-3)] hover:text-rose-500">✕</button></td>
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
                {officialOpen ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                公定格式欄位（出工人數・機具・材料・安衛…）
                <span className="ml-auto text-[11px] text-[var(--text-3)] font-normal">
                  {labor.length + equipment.length + materials.length > 0 ? `已填 ${labor.length + equipment.length + materials.length} 列` : '選填，列印公定格式日誌用'}
                </span>
              </button>
              {officialOpen && (
                <div className="px-3 pb-3 space-y-4">
                  <div>
                    <FreqChips items={freq.labor} label={(r) => r.type}
                      onAdd={(r) => setLabor((rows) => addUniqueRow(rows, r, (x) => x.type))} />
                    <RowsEditor title="出工人數（工別）" rows={labor} onChange={setLabor}
                      fields={[{ key: 'type', ph: '工別（如 鋼筋工）', w: 'flex-1' }, { key: 'count', ph: '人數', w: 'w-20', num: true }]} />
                  </div>
                  <div>
                    <FreqChips items={freq.equipment} label={(r) => r.name}
                      onAdd={(r) => setEquipment((rows) => addUniqueRow(rows, r, (x) => x.name))} />
                    <RowsEditor title="機具使用" rows={equipment} onChange={setEquipment}
                      fields={[{ key: 'name', ph: '機具名稱', w: 'flex-1' }, { key: 'count', ph: '數量', w: 'w-20', num: true }]} />
                  </div>
                  <div>
                    <FreqChips items={freq.materials} label={(r) => `${r.name}${r.unit ? `（${r.unit}）` : ''}`}
                      onAdd={(r) => setMaterials((rows) => addUniqueRow(rows, r, (x) => x.name))} />
                    <RowsEditor title="材料使用" rows={materials} onChange={setMaterials}
                      fields={[{ key: 'name', ph: '材料名稱', w: 'flex-1' }, { key: 'unit', ph: '單位', w: 'w-16' }, { key: 'qty', ph: '本日數量', w: 'w-24', num: true }]} />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <label className="block">
                      <span className="block text-xs font-medium text-[var(--text-2)] mb-1">四、應置技術士（種類及人數，無則留空）</span>
                      <input value={extras.technicians || ''} onChange={(e) => setExtras({ ...extras, technicians: e.target.value })}
                        placeholder="如：混凝土工程技術士 2 名" className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
                    </label>
                    <div>
                      <span className="block text-xs font-medium text-[var(--text-2)] mb-1">五、職業安全衛生</span>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm py-1">
                        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!extras.edu} onChange={(e) => setExtras({ ...extras, edu: e.target.checked })} />勤前教育（含危害告知）</label>
                        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!extras.ppe} onChange={(e) => setExtras({ ...extras, ppe: e.target.checked })} />檢查個人防護具</label>
                        <label className="inline-flex items-center gap-1.5">新進勞工提報勞保
                          <select value={extras.insured || '無新進勞工'} onChange={(e) => setExtras({ ...extras, insured: e.target.value })}
                            className="border border-[var(--border)] rounded px-1.5 py-0.5 text-xs">
                            {['有', '無', '無新進勞工'].map((s) => <option key={s}>{s}</option>)}
                          </select>
                        </label>
                      </div>
                    </div>
                    <label className="block">
                      <span className="block text-xs font-medium text-[var(--text-2)] mb-1">六、施工取樣試驗紀錄</span>
                      <input value={extras.sampling || ''} onChange={(e) => setExtras({ ...extras, sampling: e.target.value })}
                        placeholder="如：混凝土圓柱試體 2 組、坍度 18±2.5cm" className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
                    </label>
                    <label className="block">
                      <span className="block text-xs font-medium text-[var(--text-2)] mb-1">七、通知協力廠商辦理事項</span>
                      <input value={extras.notice || ''} onChange={(e) => setExtras({ ...extras, notice: e.target.value })}
                        className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="block text-xs font-medium text-[var(--text-2)] mb-1">八、重要事項紀錄</span>
                      <input value={extras.important || ''} onChange={(e) => setExtras({ ...extras, important: e.target.value })}
                        className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
                    </label>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 mt-4">
              {can.edit ? <Button onClick={onSave} disabled={saving}>{saving ? '存檔中…' : '存檔'}</Button> : <span className="text-xs text-[var(--text-3)]">監造帳號唯讀，日誌由施工廠商填報。</span>}
              {currentLog && (
                <button onClick={() => navigate(`/site-log/print?d=${date}`)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--blue)]">
                  <Printer size={15} aria-hidden />列印公定格式日誌
                </button>
              )}
              {savedMsg && <span className={`text-sm ${savedMsg.includes('✓') ? 'text-emerald-600' : 'text-rose-600'}`}>{savedMsg}</span>}
            </div>
          </Card>

          <Card title="現場照片" className="mt-5">
            {!currentLog ? (
              <Empty>先存檔本日日誌，才能附上現場照片。</Empty>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 border border-[var(--border)] transition ${photoBusy ? 'opacity-40' : 'cursor-pointer hover:bg-[var(--surface-2)] text-[var(--blue)]'}`}>
                    <input type="file" accept="image/*" capture="environment" multiple disabled={photoBusy} onChange={onAddPhotos} className="hidden" />
                    {photoBusy ? '上傳中…' : '＋ 加照片'}
                  </label>
                  <span className="text-xs text-[var(--text-3)]">{photos.length} 張　·　手機可直接開相機拍</span>
                </div>
                {photos.length === 0 ? (
                  <Empty>尚無照片。</Empty>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {photos.map((p) => (
                      <div key={p.id} className="group relative aspect-square rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--surface-2)]">
                        {p.url && <img src={p.url} alt={p.caption || '現場照片'} loading="lazy" className="w-full h-full object-cover" />}
                        <button onClick={() => onDeletePhoto(p)} title="刪除照片"
                          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 text-white text-xs leading-none opacity-0 group-hover:opacity-100 transition">✕</button>
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
                <div key={l.id} className={`px-3 py-2 rounded-lg text-sm border transition ${l.log_date === date ? 'bg-[var(--blue-tint)] border-[var(--blue)]' : 'border-[var(--border)] hover:bg-[var(--surface-2)]'}`}>
                  <div className="flex justify-between items-center gap-2">
                    <button onClick={() => setDate(l.log_date)} className="font-medium text-[var(--text)] tabular-nums text-left flex-1 truncate">{l.log_date}</button>
                    <span className="text-xs text-[var(--text-3)]">{Object.keys(l.items).length} 工項</span>
                    <button onClick={async () => { if (await appConfirm({ title: `刪除 ${l.log_date} 的施工日誌？`, danger: true, confirmLabel: '刪除' })) deleteSiteLog(l.id) }} className="text-[var(--text-3)] hover:text-rose-500">✕</button>
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
          className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--blue-tint)] hover:text-[var(--blue-text)] hover:border-[var(--blue)] transition">
          <Plus size={10} aria-hidden />{label(r)}
        </button>
      ))}
    </div>
  )
}

function RowsEditor({ title, rows, onChange, fields }) {
  const set = (i, key, val) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: val } : r)))
  const add = () => onChange([...rows, Object.fromEntries(fields.map((f) => [f.key, f.num ? '' : '']))])
  const del = (i) => onChange(rows.filter((_, j) => j !== i))
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-[var(--text-2)]">{title}</span>
        <button onClick={add} className="text-xs text-[var(--blue)] hover:underline">＋ 加一列</button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--text-3)]">（未填）</p>
      ) : rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 mb-1.5">
          {fields.map((f) => (
            <input key={f.key} value={r[f.key] ?? ''} placeholder={f.ph}
              type={f.num ? 'number' : 'text'} min={f.num ? 0 : undefined} step={f.num ? 'any' : undefined}
              onChange={(e) => set(i, f.key, f.num ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
              className={`${f.w} border border-[var(--border)] rounded-lg px-2 py-1 text-sm ${f.num ? 'text-right tabular-nums' : ''}`} />
          ))}
          <button onClick={() => del(i)} className="text-[var(--text-3)] hover:text-rose-500">✕</button>
        </div>
      ))}
    </div>
  )
}
