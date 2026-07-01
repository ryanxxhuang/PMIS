import { useState, useMemo, useEffect } from 'react'
import { Camera } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Empty } from '../../components/ui.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'

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
    listSitePhotos, uploadSitePhoto, deleteSitePhoto, readWhiteboard } = useStore()
  const [date, setDate] = useState(todayStr())
  const [weather, setWeather] = useState('晴')
  const [summary, setSummary] = useState('')
  const [items, setItems] = useState({}) // item_key -> 當日數量
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [photos, setPhotos] = useState([])      // 本日日誌的現場照片（含簽名 URL）
  const [photoBusy, setPhotoBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)   // AI 讀白板中
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
    if (lg) { setWeather(lg.weather || '晴'); setSummary(lg.work_summary || ''); setItems({ ...lg.items }) }
    else { setItems({}); setSummary('') }
  }, [date, siteLogs])

  // 切換日期 → 載入該日已存日誌的現場照片（未存檔的日期沒有 daily_log_id，無照片）
  useEffect(() => {
    const lg = siteLogs.find((l) => l.log_date === date)
    if (lg?.id) listSitePhotos(lg.id).then(setPhotos)
    else setPhotos([])
  }, [date, siteLogs, listSitePhotos])

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
    const { error } = await saveSiteLog({ log_date: date, weather, work_summary: summary, items })
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

  // 拍/選白板照片 → AI 辨識 → 自動填日期/天氣/摘要 + 把工項數量帶入（工項用模糊比對到標單）
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
        <h1 className="text-xl font-bold text-[var(--text)]">施工日誌 <span className="text-[var(--text-3)] font-normal text-base">每日進度回報</span></h1>
        <p className="text-sm font-medium text-[var(--text)] mt-1 truncate">{project.project_name}</p>
        <p className="text-xs text-[var(--text-3)] mt-0.5">填各工項當日完成數量，估驗可一鍵帶入累計</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Card title="本日日誌">
            <div className="flex items-end gap-3 flex-wrap mb-4">
              <Field label="日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" /></Field>
              <Field label="天氣"><input value={weather} onChange={(e) => setWeather(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm w-20" /></Field>
              <div className="w-full sm:w-auto"><Field label="工作摘要"><input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="今日施工概況" className="w-full sm:w-64 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" /></Field></div>
            </div>

            <div className="mb-3 p-3 rounded-lg bg-[var(--blue-tint)] border border-[var(--blue)]/30">
              <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 transition ${aiBusy ? 'opacity-50' : 'cursor-pointer bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] shadow-sm'}`}>
                <input type="file" accept="image/*" capture="environment" disabled={aiBusy} onChange={onWhiteboard} className="hidden" />
                <Camera size={15} aria-hidden /> {aiBusy ? 'AI 辨識中…' : '拍白板自動填寫'}
              </label>
              <p className={`text-xs mt-2 ${aiMsg.startsWith('辨識失敗') ? 'text-rose-600' : 'text-[var(--text-2)]'}`}>
                {aiMsg || '在白板寫好工項與數量、跟現場一起拍，AI 自動帶入下面的工項與當日數量。'}
              </p>
            </div>

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

            <div className="flex items-center gap-3 mt-4">
              <Button onClick={onSave} disabled={saving}>{saving ? '存檔中…' : '存檔'}</Button>
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
                    <button onClick={() => { if (window.confirm(`刪除 ${l.log_date} 的施工日誌？`)) deleteSiteLog(l.id) }} className="text-[var(--text-3)] hover:text-rose-500">✕</button>
                  </div>
                  {l.work_summary && <div className="text-xs text-[var(--text-2)] truncate mt-0.5">{l.work_summary}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <p className="text-xs text-[var(--text-3)]">
        一天一筆（同日再存會覆蓋）。各日「當日完成數量」加總 = 估驗的「累計完成數量」——到估驗頁按「從施工日誌帶入」即可自動填入。
      </p>
    </div>
  )
}
