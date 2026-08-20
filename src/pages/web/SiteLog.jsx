import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { matchLeaf } from '../../lib/photoMatch.js' // dry-run 修配對率 0%:評分修正+可測試
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Empty, PageHeader, PrerequisiteEmptyState } from '../../components/ui.jsx'
import SiteLogOfficialSheet from '../../components/SiteLogOfficialSheet.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { previousLog, copyableFromLog, frequentItems, addUniqueRow } from '../../lib/siteLogHelpers.js'
import { mergeDraftItems, draftSummaryFromCaptions } from '../../lib/photoLogDraft.js' // 照片先行:辨識結果 → 日誌表單草稿(純函式)
import { WorkItemPicker } from '../../components/DefectTracker.jsx'

const fmt = (n) => (n == null || isNaN(n) ? '' : Math.round(n).toLocaleString('en-US'))
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 把 AI 讀到的工項文字模糊比對到標單末端工項（回 work item 或 null）。
// 含子串 → 取長度比;否則用字元交集 ×0.6;門檻 0.5。使用者最後會確認,寧可漏配也不要錯配。
export default function SiteLog() {
  const { project, workItems, adjustedItems, siteLogs, saveSiteLog, deleteSiteLog, isSupabaseConfigured, currentProject, workItemsSource, dbMode,
    listSitePhotos, uploadSitePhoto, deleteSitePhoto, updateSitePhotoMeta, readWhiteboard, classifySitePhoto, fetchWeather, updateProjectAnchors, can, aiEnabled } = useStore()
  const navigate = useNavigate()
  const [date, setDate] = useState(todayStr())
  const [weather, setWeatherRaw] = useState('晴')       // 上午天氣（相容舊欄位）
  const [weatherPm, setWeatherPmRaw] = useState('')     // 下午天氣
  const [weatherBusy, setWeatherBusy] = useState(false)
  const [coordOpen, setCoordOpen] = useState(false)
  const [lat, setLat] = useState(currentProject?.latitude ?? '') // 工地座標(CWA 天氣)
  const [lon, setLon] = useState(currentProject?.longitude ?? '')
  const [summary, setSummaryRaw] = useState('')
  const [items, setItemsRaw] = useState({}) // item_key -> 當日數量
  // 公定格式欄位（工程會公共工程施工日誌）——法定欄位,預設展開不降級(ISSUE-5a)
  const [officialOpen, setOfficialOpen] = useState(true)
  const [labor, setLaborRaw] = useState([])         // [{type,count}]
  const [equipment, setEquipmentRaw] = useState([]) // [{name,count}]
  const [materials, setMaterialsRaw] = useState([]) // [{name,unit,qty}]
  const [extras, setExtrasRaw] = useState({})       // 四~八節
  // ISSUE-6a dirty 防護:表單有未存檔編輯時,載入 effect 不得用 store 覆寫表單。
  // 編輯一律走下面的 wrapper setter 標記 dirty;raw setter 只給載入 effect 用(載入不是編輯)。
  // 「帶入天氣/AI 帶入/複製昨日」也算編輯——6a 的資料遺失正是帶入天氣後
  // saveCoords→setProjects→siteLogs 選取器換 identity→載入 effect 重跑,把剛帶入的內容洗掉。
  const [dirty, setDirty] = useState(false)
  const setWeather = (v) => { setDirty(true); setWeatherRaw(v) }
  const setWeatherPm = (v) => { setDirty(true); setWeatherPmRaw(v) }
  const setSummary = (v) => { setDirty(true); setSummaryRaw(v) }
  const setItems = (v) => { setDirty(true); setItemsRaw(v) }
  const setLabor = (v) => { setDirty(true); setLaborRaw(v) }
  const setEquipment = (v) => { setDirty(true); setEquipmentRaw(v) }
  const setMaterials = (v) => { setDirty(true); setMaterialsRaw(v) }
  const setExtras = (v) => { setDirty(true); setExtrasRaw(v) }
  // S-8 唯讀紙本化:監造/機關預設看公定格式紙本,摘要保留為切換
  const [roSummary, setRoSummary] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  // ISSUE-6b 訊息分 tone:info(帶入/提示)/success(含 ✓)/error。
  // 原本只有「含 ✓ 綠、其餘紅」,「已帶入…」「天氣未帶入…」這類資訊全被渲染成紅色錯誤。
  const [savedMsg, setSavedMsgRaw] = useState(null) // { text, tone } | null
  const setSavedMsg = (text, tone = 'error') => setSavedMsgRaw(text ? { text, tone } : null)
  const [photos, setPhotos] = useState([])      // 本日日誌的現場照片（含簽名 URL）
  const [photoBusy, setPhotoBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)   // AI 現場辨識中
  const [aiMsg, setAiMsg] = useState('')
  // AI 批次辨識照片:選檔後先進 staging 逐張判讀,使用者覆核可編說明/工項,再一鍵全上傳
  const [staging, setStaging] = useState([])    // [{key,file,previewUrl,status,caption,category,work_item_key,work_item_label}]
  const [batchBusy, setBatchBusy] = useState(false)
  // P0 #11「辨識已上傳照片」的執行狀態。⚠️ 必須在 139 行「載入中」早退之前宣告,
  // 否則首次 render(workItems 未載入)與後續 render 的 hook 數不一致,React 會整頁炸掉
  // (2026-08-12 已炸過一次:插在中段 → 頁面發生錯誤)。
  const [existingBusy, setExistingBusy] = useState(false)
  const [existingMsg, setExistingMsg] = useState('')

  // 發包末端工項（可回報的單元）+ 查表。
  // 用「已核准變更套回後」的工項(B-02 小尾巴):否則核准追加數量後,
  // 當日回報上限(setQty 夾在 0~契約數量)仍卡在舊契約數量。
  const { leaves, byKey, byId } = useMemo(() => {
    if (!workItems) return { leaves: [], byKey: new Map(), byId: new Map() }
    const childMap = new Map()
    for (const it of adjustedItems) {
      const k = it.parent_key || '__root__'
      if (!childMap.has(k)) childMap.set(k, [])
      childMap.get(k).push(it)
    }
    const m = new Map(adjustedItems.map((it) => [it.item_key, it]))
    const lv = adjustedItems.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
    // byId:照片卡顯示「配到哪個工項」用(photos.work_item_id → 工項)
    const idMap = new Map(adjustedItems.filter((it) => it.id).map((it) => [it.id, it]))
    return { leaves: lv, byKey: m, byId: idMap }
  }, [workItems, adjustedItems])

  // 載入該日已存的日誌(ISSUE-6a P0):
  // - 日期變更 → 一律整包載入(切日期=使用者要看別天,並重置 dirty);
  // - 同日期下 siteLogs 換 identity(存檔後重載、或其他 slice 寫入讓選取器重算)→
  //   只在 !dirty 時同步,dirty 時絕不清空使用者未存檔的輸入。
  const prevDateRef = useRef(date)
  useEffect(() => {
    const dateChanged = prevDateRef.current !== date
    prevDateRef.current = date
    if (!dateChanged && dirty) return // 有未存檔編輯:不覆寫
    const lg = siteLogs.find((l) => l.log_date === date)
    if (lg) {
      setWeatherRaw(lg.weather_am || lg.weather || '晴'); setWeatherPmRaw(lg.weather_pm || '')
      setSummaryRaw(lg.work_summary || ''); setItemsRaw({ ...lg.items })
      setLaborRaw(lg.labor || []); setEquipmentRaw(lg.equipment || []); setMaterialsRaw(lg.materials || []); setExtrasRaw(lg.extras || {})
    } else { setItemsRaw({}); setSummaryRaw(''); setWeatherPmRaw(''); setLaborRaw([]); setEquipmentRaw([]); setMaterialsRaw([]); setExtrasRaw({}) }
    if (dateChanged) setDirty(false) // 新日期從乾淨狀態開始
  }, [date, siteLogs, dirty])

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
    // C-4:種出昨日工項的「列骨架」(數量留空,已手動加入的列不覆蓋)並展開公定格式區——
    // 原本帶入的內容全落在收合區,使用者看起來「完全沒帶入」
    setItems((p) => ({ ...c.items, ...p }))
    setOfficialOpen(true)
    if (c.weather) setWeather(c.weather)
    setWeatherPm(c.weather_pm)
    setSavedMsg(`已帶入 ${c.from} 的班組/機具/材料與工項列表,數量請填今日實際值後存檔`, 'info')
  }

  // 天氣:工地座標 → 中央氣象局自動帶入(座標存一次,之後每天一鍵)
  const hasCoords = currentProject?.latitude != null && currentProject?.longitude != null
  const pullWeather = async () => {
    if (!hasCoords) { setCoordOpen(true); return }
    setWeatherBusy(true); setSavedMsg('')
    const r = await fetchWeather(currentProject.latitude, currentProject.longitude, date)
    setWeatherBusy(false)
    if (r?.error) { setSavedMsg(`天氣未帶入:${r.error}`, 'info'); return } // 帶不到≠系統錯誤,不渲染成紅字
    if (r.am) setWeather(r.am)
    if (r.pm) setWeatherPm(r.pm)
    setSavedMsg(`天氣已帶入(資料來源:${r.source || '中央氣象局'}）`, 'info')
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
    if (r?.error) { setSavedMsg(`座標已存,但天氣未帶入:${r.error}`, 'info'); return }
    if (r.am) setWeather(r.am); if (r.pm) setWeatherPm(r.pm)
    setSavedMsg(`工地座標已儲存;天氣已帶入(${r.source || '中央氣象局'}）`, 'info')
  }

  if (!workItems) return <Empty>載入中…</Empty>
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return (
      <Card title="施工日誌">
        <PrerequisiteEmptyState
          need="施工日誌要掛在標單工項上回報當日完成數量,此專案的標單尚未匯入。"
          unlocks="工項數量回報、現場照片、天氣帶入、估驗自動累計"
          to={can.edit ? '/contract' : undefined} cta={can.edit ? '前往專案文件上傳標單' : undefined}
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
    const { error, warning } = await saveSiteLog({
      log_date: date, weather, weather_am: weather, weather_pm: weatherPm,
      labor, equipment, materials, extras, work_summary: summary, items,
    })
    setSaving(false)
    if (error) { setSavedMsg(error.message || '存檔失敗'); return }
    // 已存檔但重載失敗(ISSUE-6b):保留 dirty——store 還沒有這筆,清了 dirty
    // 會讓載入 effect 在下次 siteLogs 變動時把表單洗回「無日誌」空白
    if (warning) { setSavedMsg(warning); return }
    setDirty(false) // 存檔成功=表單與 store 一致,載入 effect 可安全同步
    setSavedMsg('已存檔 ✓', 'success')
  }

  // 本日已存檔的日誌（有 id 才能掛照片）
  const currentLog = siteLogs.find((l) => l.log_date === date)

  const onAddPhotos = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // 允許重新選同一檔
    if (!files.length) return // 使用者取消選檔:不是錯誤
    if (!currentLog?.id) { setSavedMsg('請先存檔本日日誌,才能上傳照片'); return } // P0 #11:靜默失敗變可見
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
    if (!files.length) return // 取消選檔
    // 照片先行(W8-7 C-6):該日還沒存檔也不擋——選檔即開始辨識,
    // 「全部上傳」按下去時才自動建立草稿日誌(見 confirmBatchUpload)
    const stage = files.map((file) => ({
      key: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file),
      status: 'analyzing', caption: '', category: '', work_item_key: '', work_item_label: '', errMsg: '', location: '',
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
          // 施作區域(白板抄錄):舊版 edge fn 沒這欄=undefined,一律視同 null → 空字串(向後相容)
          location: error ? '' : (result.location || ''),
          errMsg: error ? (error.message || '判讀失敗') : '',
          notSite: !error && result?.is_construction === false, // AI 判為非工地照,提醒人工確認
          work_item_key: wi?.item_key || '', work_item_label: wi ? `${wi.item_no} ${wi.description}` : '',
        } : p))
      }
    }
    await Promise.all([worker(), worker(), worker()])
    setBatchBusy(false)
  }

  // AI 辨識「已上傳」的照片(P0 #11):使用者的直覺是先上傳、再按 AI 辨識——
  // 原本批次辨識只吃「新選檔」,對既有照片無能為力,按了等於沒反應。
  // 這裡把缺說明的既有照片抓下來(簽名 URL → blob)逐張判讀,回寫說明與工項。
  // (existingBusy/existingMsg 的 useState 在頂部——139 行的載入早退之前,rules of hooks)
  // 缺說明「或」缺工項都可重跑(配對失敗後要能重試,不必刪照片重傳);非工地照重跑成本極低且是使用者主動觸發
  const photosNeedingAI = photos.filter((p) => (!p.caption || !p.work_item_id) && p.url)
  const onClassifyExisting = async () => {
    if (!photosNeedingAI.length || existingBusy) return
    setExistingBusy(true); setExistingMsg('')
    let ok = 0, fail = 0, matched = 0, i = 0
    let firstErr = '' // 全失敗時要能說出「為什麼」——這次事故就是 catch 吞掉錯誤查了三層
    const list = photosNeedingAI
    const worker = async () => {
      while (i < list.length) {
        const ph = list[i++]
        try {
          const blob = await (await fetch(ph.url)).blob()
          const file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' })
          const { error, result } = await classifySitePhoto(file)
          if (error) { fail++; firstErr = firstErr || (error.message || 'AI 判讀失敗'); continue }
          const wi = result?.work_item_hint ? matchLeaf(result.work_item_hint, leaves) : null
          const { error: upErr } = await updateSitePhotoMeta(ph.id, {
            caption: result?.is_construction === false ? '（AI 判讀:疑似非工地照片,請人工確認）' : (result?.caption || ''),
            work_item_key: wi?.item_key,
          })
          if (upErr) { fail++; firstErr = firstErr || (upErr.message || '寫回失敗') } else { ok++; if (wi) matched++ }
        } catch (e) { fail++; firstErr = firstErr || (e?.message || '處理失敗') }
        setExistingMsg(`辨識中… ${ok + fail}/${list.length}`)
      }
    }
    await Promise.all([worker(), worker(), worker()])
    if (currentLog?.id) setPhotos(await listSitePhotos(currentLog.id))
    setExistingMsg(fail
      ? `完成:${ok} 張已生成說明,${fail} 張失敗${firstErr ? `(${firstErr})` : ''},可重按重試`
      : `完成:${ok} 張已生成說明,${matched} 張配對到工項${matched < ok ? '(其餘辨識不出對應工項,可自行歸類)' : ''}`)
    setExistingBusy(false)
  }

  const patchStaging = (key, patch) => setStaging((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  const removeStaging = (key) => setStaging((prev) => {
    const s = prev.find((p) => p.key === key); if (s) URL.revokeObjectURL(s.previewUrl)
    return prev.filter((p) => p.key !== key)
  })
  const cancelBatch = () => { staging.forEach((s) => URL.revokeObjectURL(s.previewUrl)); setStaging([]) }

  const confirmBatchUpload = async () => {
    setBatchBusy(true); setSavedMsg('')
    // 照片先行(W8-7):該日尚無日誌 → 先用既有 upsert(onConflict project_id,log_date)
    // 自動建「空白草稿日誌」再掛照片。人按「全部上傳」=人觸發(紅線:AI 不自己寫 DB);
    // 只建骨架(工項/摘要皆空),表單上未存檔的內容不在這裡落庫,日誌本體仍由人按「存檔」寫入。
    // 建檔引發的 siteLogs 重載吃 W8-6 dirty 防護:dirty 時載入 effect 不重設表單;
    // 乾淨表單被同步成空白日誌內容也無損(本來就是空的),下面的草稿回填走 wrapper setter 會標 dirty。
    let logId = currentLog?.id
    if (!logId && !dbMode) {
      // demo 雙引擎同步:demo 的照片本來就不落庫(uploadSitePhoto 逐張回錯),
      // 先建了空白日誌只會在 demo 劇本裡多一筆假日誌——直接講明,不留半套殘骸
      setBatchBusy(false); setSavedMsg('demo 模式不支援照片上傳(需真專案),辨識覆核流程請在真專案體驗'); return
    }
    if (!logId) {
      const { error: cErr, id } = await saveSiteLog({
        log_date: date, weather, weather_am: weather, weather_pm: weatherPm,
        labor: [], equipment: [], materials: [], extras: {}, work_summary: '', items: {},
      })
      if (cErr || !id) { setBatchBusy(false); setSavedMsg(cErr?.message || '自動建立本日日誌失敗,請先手動存檔再上傳'); return }
      logId = id
    }
    let ok = 0, fail = 0
    const uploaded = [] // 只有上傳成功的張才回填草稿:日誌草稿要跟照片佐證對得上
    for (const s of staging) {
      if (s.status === 'analyzing') continue // 判讀中的略過;error 張仍可帶人工說明上傳(P1-02)
      const { error } = await uploadSitePhoto(logId, s.file, {
        caption: s.caption || null, work_item_key: s.work_item_key || null, location: s.location || null,
      })
      if (error) { fail++ } else { ok++; uploaded.push(s); URL.revokeObjectURL(s.previewUrl) }
    }
    // 辨識結果回填表單(AI 只產草稿):配到工項→僅加列、數量留空由人填,不覆蓋既有列;
    // caption 彙整→摘要草稿(僅摘要為空時,前綴「AI 草稿:」)。只動表單 state,落庫仍由人按「存檔」。
    // functional update 對「最新」表單合併——上面自動建檔的重載可能已重跑載入 effect;
    // closure 版 mergeDraftItems 只為算 N(訊息用),merge 具冪等性,兩者不會分歧出錯列。
    const { added } = mergeDraftItems(items, uploaded)
    if (added) setItems((p) => mergeDraftItems(p, uploaded).items)
    const draftSummary = draftSummaryFromCaptions(summary, uploaded)
    if (draftSummary) setSummary((s) => ((s || '').trim() ? s : draftSummary))
    setPhotos(await listSitePhotos(logId))
    setStaging([]); setBatchBusy(false)
    // 全數成功=成功綠;有失敗才走錯誤紅(原本一律紅,成功也像出事)
    const draftParts = [added ? `${added} 個工項` : '', draftSummary ? '摘要草稿' : ''].filter(Boolean)
    setSavedMsg(
      `已上傳 ${ok} 張照片${fail ? `,${fail} 張未成功` : ''}` +
      (draftParts.length ? `;AI 帶入 ${draftParts.join('與')},請覆核數量後存檔` : '（AI 生說明，可再刪改）'),
      fail ? 'error' : 'success',
    )
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

  // W8-4B B1 唯讀摘要:公定格式各節壓成「有資料才顯示」的 [節名, 內容] 行。
  // 不用 useMemo:每節列數只有個位數,重算成本遠低於多養一個 hook(hooks 順序紅線)。
  const roOfficial = []
  if (!can.edit && currentLog) {
    const push = (label, text) => { if (text) roOfficial.push([label, text]) }
    push('出工人數', (currentLog.labor || []).filter((r) => r.type).map((r) => `${r.type}×${r.count ?? '—'}`).join('、'))
    push('機具使用', (currentLog.equipment || []).filter((r) => r.name).map((r) => `${r.name}×${r.count ?? '—'}`).join('、'))
    push('材料使用', (currentLog.materials || []).filter((r) => r.name).map((r) => `${r.name}×${r.qty ?? '—'}${r.unit ? ` ${r.unit}` : ''}`).join('、'))
    const ex = currentLog.extras || {}
    push('四、應置技術士', ex.technicians)
    // 五、安衛:勾選/選單壓成一句;insured 預設「無新進勞工」不算有值(否則每天都多一行雜訊)
    push('五、職業安全衛生', [
      ex.edu && '勤前教育（含危害告知）',
      ex.ppe && '檢查個人防護具',
      ex.insured && ex.insured !== '無新進勞工' && `新進勞工提報勞保:${ex.insured}`,
    ].filter(Boolean).join('、'))
    push('六、施工取樣試驗紀錄', ex.sampling)
    push('七、通知協力廠商辦理事項', ex.notice)
    push('八、重要事項紀錄', ex.important)
  }

  return (
    <div className="space-y-5">
      <div>
        <PageHeader title="施工日誌" tagline="每日進度回報" subtitle="填各工項當日完成數量，估驗可一鍵帶入累計" />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Card title="本日日誌">
            {/* W8-0 §6.2 + S-8:唯讀(監造/機關)不用整排 disabled input 假裝可編——
                disabled 欄位會誤導成「暫時鎖住的表單」,唯讀角色要的只是「看」。
                預設看公定格式紙本(SiteLogOfficialSheet,與列印同版面),可切換摘要檢視。
                分支只做在 render 層、不拆元件:所有 hook 無條件照跑,可編/唯讀 hook 數才會一致
                (2026-08-12 hooks 順序事故的同型地雷);state 對唯讀多算是可接受的浪費。 */}
            {!can.edit ? (<>
              <div className="mb-3 text-xs text-[var(--text-2)] bg-[var(--surface-2)] rounded-lg px-3 py-2">
                {can.oversee ? '機關監督檢視' : '監造檢視'}：施工日誌由施工廠商填報，此頁為<b>唯讀</b>，可切換日期檢視歷史紀錄。
              </div>
              {/* 日期本來就對唯讀開放(切歷史用),是唯讀頁上唯一的 input */}
              <div className="mb-3 flex items-end gap-3 flex-wrap">
                <Field label="日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" /></Field>
                {/* S-8:預設紙本(公定格式)、可切回摘要——鈕上寫「切過去會看到的那個檢視」 */}
                {currentLog && (
                  <button onClick={() => setRoSummary((v) => !v)}
                    className="text-sm font-medium rounded-lg px-3 py-1.5 border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--text-2)]">
                    {roSummary ? '公定格式檢視' : '摘要檢視'}
                  </button>
                )}
              </div>
              {!currentLog ? (
                <Empty>此日期尚無日誌。施工日誌由施工廠商填報。</Empty>
              ) : !roSummary ? (
                // S-8 紙本化:監造/機關調閱的本來就是公定格式正式版面,預設直接內嵌 A4 文件本體。
                // sheet 為純顯示無 input(唯讀頁 e2e 契約);紙本表格在手機縮不進 375px,
                // 用 overflow-x-auto+min-w 讓紙本自己橫向捲,頁面不溢位(a11y 全路由無溢位掃描)。
                <div className="overflow-x-auto">
                  <SiteLogOfficialSheet project={project} log={currentLog} siteLogs={siteLogs} itemList={adjustedItems} className="min-w-[640px]" />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 天氣與摘要:純文字,空值顯示 —／（未填）而不是空輸入框 */}
                  <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                    <div><div className="text-xs text-[var(--text-3)] mb-0.5">天氣(上午)</div><div>{currentLog.weather_am || currentLog.weather || '—'}</div></div>
                    <div><div className="text-xs text-[var(--text-3)] mb-0.5">天氣(下午)</div><div>{currentLog.weather_pm || '—'}</div></div>
                    <div className="min-w-0 flex-1 basis-full sm:basis-auto"><div className="text-xs text-[var(--text-3)] mb-0.5">工作摘要</div><div>{currentLog.work_summary || '（未填）'}</div></div>
                  </div>
                  {/* 工項回報:表頭同可編視角,數字改純文字。當日數量不走 fmt(會四捨五入),
                      日誌常見 0.x 之類的小數,照原值顯示才對得上列印與估驗累計 */}
                  {Object.keys(currentLog.items || {}).length === 0 ? (
                    <Empty>本日未回報工項數量。</Empty>
                  ) : (
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[460px]">
                      <thead>
                        <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                          <th className="text-left py-1.5">工項</th>
                          <th className="text-right px-2 whitespace-nowrap">單位</th>
                          <th className="text-right px-2 whitespace-nowrap">契約數量</th>
                          <th className="text-right px-2 whitespace-nowrap">當日完成數量</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(currentLog.items || {}).map(([key, qty]) => {
                          const it = byKey.get(key) || {}
                          return (
                            <tr key={key} className="border-b border-[var(--border-2)]">
                              <td className="py-1.5"><span className="text-[var(--text-3)] text-xs mr-2 tabular-nums">{it.item_no}</span>{it.description || key}</td>
                              <td className="text-right text-[var(--text-3)] text-xs px-2 whitespace-nowrap">{it.unit}</td>
                              <td className="text-right text-[var(--text-2)] px-2 tabular-nums whitespace-nowrap">{fmt(it.quantity)}</td>
                              <td className="text-right px-2 tabular-nums whitespace-nowrap">{qty}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    </div>
                  )}
                  {/* 公定格式:只列有資料的節;全部沒填收成一行,唯讀不需要一排空欄位 */}
                  <div>
                    <div className="text-xs font-medium text-[var(--text-2)] mb-1">公定格式欄位（出工人數・機具・材料・安衛…）</div>
                    {roOfficial.length === 0 ? (
                      <p className="text-xs text-[var(--text-3)]">本日未填公定格式欄位</p>
                    ) : (
                      <dl className="text-sm space-y-1">
                        {roOfficial.map(([label, text]) => (
                          <div key={label} className="flex gap-3">
                            <dt className="w-32 shrink-0 text-xs text-[var(--text-3)] pt-0.5">{label}</dt>
                            <dd className="min-w-0 flex-1">{text}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                </div>
              )}
              {/* 列印公定格式:對唯讀角色保留(監造/機關本來就要調閱正式格式) */}
              {currentLog && (
                <div className="mt-4">
                  <button onClick={() => navigate(`/site-log/print?d=${date}`)}
                    className="inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--blue)]">
                    <MSym name="print" size={15} />列印公定格式日誌
                  </button>
                </div>
              )}
            </>) : (<>
            <div className="flex items-end gap-3 flex-wrap mb-2">
              <Field label="日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" /></Field>
              <Field label="天氣(上午)"><input value={weather} disabled={!can.edit} onChange={(e) => setWeather(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm w-20 disabled:opacity-50 disabled:bg-[var(--surface-2)]" /></Field>
              <Field label="天氣(下午)"><input value={weatherPm} disabled={!can.edit} onChange={(e) => setWeatherPm(e.target.value)} placeholder="同上午" className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm w-20 disabled:opacity-50 disabled:bg-[var(--surface-2)]" /></Field>
              <div className="w-full sm:w-auto"><Field label="工作摘要"><input value={summary} disabled={!can.edit} onChange={(e) => setSummary(e.target.value)} placeholder="今日施工概況" className="w-full sm:w-64 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm disabled:opacity-50 disabled:bg-[var(--surface-2)]" /></Field></div>
              {can.edit && (
                <Button variant="secondary" onClick={pullWeather} disabled={weatherBusy} title="依工地座標向中央氣象局帶入今日天氣">
                  <MSym name="partly_cloudy_day" size={14} />{weatherBusy ? '帶入中…' : '帶入天氣'}
                </Button>
              )}
              {/* CWA 預報資料集只涵蓋未來約 3 天,過去日期打 API 必然帶不到——先講明,不讓使用者按了才看到失敗 */}
              {can.edit && date < todayStr() && (
                <span className="text-[11px] text-[var(--text-3)] pb-2">僅支援近 3 天預報,過去日期請手動填寫</span>
              )}
              {/* 零輸入:一鍵帶入前一筆日誌的班組/機具/材料(僅新日期、且有前一筆時) */}
              {can.edit && !dateHasLog && prevLog && (
                <Button variant="secondary" onClick={copyYesterday} title={`帶入 ${prevLog.log_date} 的班組/機具/材料`}>
                  <MSym name="library_add" size={14} />複製昨日
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

            {/* 批 B UX:告示板辨識功能關閉時整塊藏起來(真正的閘門在伺服器端) */}
            {can.edit && aiEnabled('sitelog.whiteboard') && <div className="mb-3 p-3 rounded-lg bg-[var(--blue-tint)] border border-[var(--blue)]/30">
              <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 pressable ${aiBusy ? 'opacity-50' : 'cursor-pointer bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] shadow-sm'}`}>
                <input type="file" accept="image/*" capture="environment" disabled={aiBusy} onChange={onWhiteboard} className="hidden" />
                <MSym name="photo_camera" size={15} /> {aiBusy ? 'AI 辨識中…' : 'AI 拍照自動填寫'}
              </label>
              <p className={`text-xs mt-2 ${aiMsg.startsWith('辨識失敗') ? 'text-[var(--red-text)]' : 'text-[var(--text-2)]'}`}>
                {aiMsg || '拍下工程告示板或現場照片，AI 辨識後自動帶入日期、天氣與各工項當日數量。'}
              </p>
            </div>}
            {can.edit && !aiEnabled('sitelog.whiteboard') && (
              <p className="mb-3 text-[11px] text-[var(--text-3)]">此 AI 功能未啟用（工程告示板辨識），請直接於下方手動填寫。</p>
            )}

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
                          {/* W8-5:表格內輸入只提到 ~38px(max-sm:py-2),不加 min-h——加了整張表列高會翻倍 */}
                          <input type="number" min="0" step="any" inputMode="decimal" value={items[key] ?? ''} disabled={!can.edit} onChange={(e) => setQty(key, e.target.value)}
                            className="w-24 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-sm tabular-nums max-sm:py-2 focus:border-[var(--blue)] focus:outline-none disabled:opacity-50 disabled:bg-[var(--surface-2)]" />
                        </td>
                        {/* p-2 -m-2:命中區擴大但視覺與列高不變 */}
                        <td className="text-right pl-2">{can.edit && <button onClick={() => removeItem(key)} className="text-[var(--text-3)] hover:text-[var(--red-text)] p-2 -m-2" aria-label="移除此工項">✕</button>}</td>
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
                <MSym name="chevron_right" size={15} className={`transition-transform duration-[var(--dur-fast)] ${officialOpen ? 'rotate-90' : ''}`} />
                公定格式欄位（出工人數・機具・材料・安衛…）
                <span className="ml-auto text-[11px] text-[var(--text-3)] font-normal">
                  {/* ISSUE-5a:這是工程會公定格式的法定欄位,副標不用「選填」降級,改中性說明 */}
                  {labor.length + equipment.length + materials.length > 0 ? `已填 ${labor.length + equipment.length + materials.length} 列` : '公定格式日誌欄位，列印時輸出'}
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
                      {/* 原生 checkbox 預設約 13px,是全站最小的互動元素;w-5 h-5 提到 20px 且不動文字基線 */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm py-1">
                        <label className="inline-flex items-center gap-1.5 max-sm:min-h-11"><input type="checkbox" className="w-5 h-5" disabled={!can.edit} checked={!!extras.edu} onChange={(e) => setExtras({ ...extras, edu: e.target.checked })} />勤前教育（含危害告知）</label>
                        <label className="inline-flex items-center gap-1.5 max-sm:min-h-11"><input type="checkbox" className="w-5 h-5" disabled={!can.edit} checked={!!extras.ppe} onChange={(e) => setExtras({ ...extras, ppe: e.target.checked })} />檢查個人防護具</label>
                        <label className="inline-flex items-center gap-1.5">新進勞工提報勞保
                          <select value={extras.insured || '無新進勞工'} disabled={!can.edit} onChange={(e) => setExtras({ ...extras, insured: e.target.value })}
                            className="border border-[var(--border)] rounded px-1.5 py-0.5 text-xs max-sm:min-h-11">
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

            {/* W8-0 §7:手機存檔列貼底固定——公定格式欄位展開後表單很長,捲到底才找得到存檔鈕
                是現場回報的痛點;-mx-5 抵掉 Card 內距讓底條滿版,pr-16 避開右下浮動 Copilot FAB(bottom-6 right-6)。
                這一列只有可編視角會渲染(唯讀已在上方走摘要分支),can.edit 條件保留是讓 DOM 與歷史版本逐字一致。
                pl-5/pr-16 拆開寫而不用 px-5,是避免 padding-inline 與 padding-right 的 cascade 順序不確定 */}
            <div className={`flex items-center gap-3 mt-4${can.edit ? ' max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:bg-[var(--surface)] max-sm:border-t max-sm:border-[var(--border-2)] max-sm:-mx-5 max-sm:pl-5 max-sm:pr-16 max-sm:py-2.5 sm:static sm:border-0' : ''}`}>
              {can.edit ? <Button onClick={onSave} disabled={saving}>{saving ? '存檔中…' : '存檔'}</Button> : <span className="text-xs text-[var(--text-3)]">{can.oversee ? '機關監督檢視' : '監造檢視'}：施工日誌由施工廠商填報，此頁為唯讀。</span>}
              {currentLog && (
                <button onClick={() => navigate(`/site-log/print?d=${date}`)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--blue)]">
                  <MSym name="print" size={15} />列印公定格式日誌
                </button>
              )}
              {/* ISSUE-6b tone:success 綠(「已存檔 ✓」e2e 凍結字串)/info 藍(帶入類資訊)/error 紅 */}
              {savedMsg && <span className={`text-sm ${savedMsg.tone === 'success' ? 'text-[var(--green-text)]' : savedMsg.tone === 'info' ? 'text-[var(--blue-text)]' : 'text-[var(--red-text)]'}`}>{savedMsg.text}</span>}
            </div>
            </>)}
          </Card>

          <Card title="現場照片" className="mt-5">
            {/* 照片先行(W8-7 C-6):可編角色不再被「先存檔」擋住——沒日誌也直接給批次辨識入口,
                「全部上傳」時自動建草稿日誌。唯讀角色維持等待文案(W8-4B,也不得長出 input——唯讀 e2e 契約);
                AI 辨識未啟用時沒有「辨識→確認」那步可觸發自動建檔,維持先存檔的原提示 */}
            {!currentLog && !can.edit ? (
              <Empty>該日日誌建立後，廠商上傳的現場照片會顯示在這裡。</Empty>
            ) : !currentLog && !aiEnabled('photo.classify') ? (
              <Empty>先存檔本日日誌，才能附上現場照片。</Empty>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {/* 照片上傳=施工廠商的事:唯讀角色(監造/機關)不顯示死按鈕(U-01) */}
                  {can.edit && <>
                    {/* 批 B UX:照片分類功能關閉時藏 AI 批次入口,保留「直接加照片」 */}
                    {aiEnabled('photo.classify') && (
                      <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 pressable shadow-sm ${(photoBusy || batchBusy || existingBusy) ? 'opacity-40 bg-[var(--primary)] text-white' : 'cursor-pointer bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]'}`}>
                        {/* 批次=從相簿多選(不加 capture,否則手機會強開相機只能拍一張) */}
                        <input type="file" accept="image/*" multiple disabled={photoBusy || batchBusy || existingBusy} onChange={onBatchPhotos} className="hidden" />
                        <MSym name="auto_awesome" size={15} /> 選照片 AI 辨識後上傳
                      </label>
                    )}
                    {/* P0 #11:已上傳但沒說明的照片,一鍵補 AI 說明+配工項——使用者的直覺是「先上傳,再辨識」 */}
                    {aiEnabled('photo.classify') && photosNeedingAI.length > 0 && (
                      <Button variant="secondary" onClick={onClassifyExisting} disabled={photoBusy || batchBusy || existingBusy}>
                        <MSym name="auto_awesome" size={14} />{existingBusy ? '辨識中…' : `AI 補辨識/配對 ${photosNeedingAI.length} 張`}
                      </Button>
                    )}
                    {/* 「不辨識」=選檔即上傳、沒有確認步驟——不替使用者自動建檔,仍要先存檔才出現 */}
                    {currentLog && (
                      <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 border border-[var(--border)] pressable ${(photoBusy || batchBusy || existingBusy) ? 'opacity-40' : 'cursor-pointer hover:bg-[var(--surface-2)] text-[var(--text-2)]'}`}>
                        <input type="file" accept="image/*" capture="environment" multiple disabled={photoBusy || batchBusy || existingBusy} onChange={onAddPhotos} className="hidden" />
                        {photoBusy ? '上傳中…' : '＋ 上傳照片(不辨識)'}
                      </label>
                    )}
                  </>}
                  {!currentLog ? (
                    // 照片先行的引導:講清楚「確認上傳」會自動建檔+回填表單,人只要覆核數量再存檔
                    <span className="text-xs text-[var(--text-3)]">本日尚未存檔日誌:選照片辨識後按「全部上傳」,會自動建立草稿日誌,並把配到的工項與摘要草稿帶進表單</span>
                  ) : (
                    <span className="text-xs text-[var(--text-3)]">{photos.length} 張{can.edit ? (aiEnabled('photo.classify') ? '　·　AI 辨識＝自動生說明並配對工項' : '　·　AI 批次辨識未啟用') : '（照片由施工廠商上傳）'}</span>
                  )}
                  {existingMsg && <span className={`text-xs font-medium ${existingMsg.includes('失敗') ? 'text-[var(--red-text)]' : 'text-[var(--green-text)]'}`}>{existingMsg}</span>}
                </div>

                {/* 批次辨識覆核區:AI 逐張判讀後,人可改說明/工項再一鍵全上傳 */}
                {staging.length > 0 && (
                  <div className="mb-4 border border-[var(--blue)]/30 bg-[var(--blue)]/[0.04] rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-[var(--text)] inline-flex items-center gap-1.5">
                        <MSym name="auto_awesome" size={14} className="text-[var(--blue)]" />
                        AI 辨識覆核（{staging.filter((s) => s.status === 'done').length}/{staging.length}）
                        {batchBusy && <span className="text-xs font-normal text-[var(--text-3)]">判讀中…</span>}
                      </div>
                      <button onClick={cancelBatch} disabled={batchBusy} className="text-xs text-[var(--text-3)] hover:text-[var(--red-text)]">取消</button>
                    </div>
                    <div className="space-y-2 max-h-[28rem] overflow-auto">
                      {staging.map((s) => (
                        <div key={s.key} className="flex gap-3 items-start bg-[var(--surface)] border border-[var(--border)] rounded-lg p-2">
                          {/* alt 帶檔名:多張待上傳時報讀器才分得出是哪一張 */}
                          <img src={s.previewUrl} alt={`待上傳照片 ${s.file?.name || ''}`} className="w-16 h-16 rounded object-cover shrink-0 border border-[var(--border)]" />
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
                                  {/* 施作區域=AI 自白板照抄的草稿:只給「清除」不給改寫——照抄原則,
                                      人工要寫別的區域應該改在說明欄,不冒充板上文字 */}
                                  {s.location && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--blue-tint)] text-[var(--blue-text)]">
                                      📍 {s.location}
                                      <button onClick={() => patchStaging(s.key, { location: '' })} title="清除施作區域"
                                        aria-label={`清除施作區域 ${s.location}`} className="leading-none hover:text-[var(--red-text)]">✕</button>
                                    </span>
                                  )}
                                  {s.notSite && <span className="px-1.5 py-0.5 rounded bg-[var(--amber-tint)] text-[var(--amber-text)] border border-[var(--amber-text)]/25">⚠ 疑似非工地照,請確認</span>}
                                </div>
                                {/* 可搜尋改選/清除工項(P1-02:不再只能取消配對)*/}
                                <WorkItemPicker leaves={leaves} value={s.work_item_key} label={s.work_item_label || '（搜尋工項…）'}
                                  onPick={(k, l) => patchStaging(s.key, { work_item_key: k || '', work_item_label: k ? l : '' })} />
                              </>
                            )}
                          </div>
                          <button onClick={() => removeStaging(s.key)} disabled={batchBusy} title="移除此張" aria-label="移除此張待上傳照片"
                            className="shrink-0 text-[var(--text-3)] hover:text-[var(--red-text)] text-sm leading-none p-2 -m-2">✕</button>
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
                  // 唯讀角色沒有上傳入口:不指路「AI 批次辨識」這種按不到的操作
                  <Empty>{can.edit ? '尚無照片。用「AI 批次辨識照片」一次丟多張，AI 自動生說明並配工項。' : '該日尚無現場照片。'}</Empty>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {photos.map((p, i) => (
                      <div key={p.id} className="group relative rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--surface-2)]">
                        <div className="aspect-square">
                          {/* 無說明時用序號當 fallback:同一天多張照片,固定字串會讓報讀器全部同名 */}
                          {p.url && <img src={p.url} alt={p.caption || `現場照片 ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />}
                        </div>
                        {(p.caption || p.work_item_id || p.location) && (
                          <div className="px-1.5 py-1 bg-[var(--surface)] border-t border-[var(--border-2)]">
                            {p.caption && <div className="text-[11px] leading-tight text-[var(--text-2)] truncate" title={p.caption}>{p.caption}</div>}
                            {/* 施作區域(W8-7):同工項不同區域靠這行分辨;舊照片無 location(null)不渲染,顯示不受影響 */}
                            {p.location && <div className="text-[10px] leading-tight text-[var(--text-3)] truncate" title={`施作區域 ${p.location}`}>📍 {p.location}</div>}
                            {/* 賣點的可見性:配到的工項一定要看得到,否則配對成功=白做(dry-run #17 教訓) */}
                            {p.work_item_id && byId.get(p.work_item_id) && (
                              <div className="text-[10px] leading-tight text-[var(--blue-text)] truncate" title={`${byId.get(p.work_item_id).item_no} ${byId.get(p.work_item_id).description}`}>
                                ⛓ {byId.get(p.work_item_id).item_no} {byId.get(p.work_item_id).description}
                              </div>
                            )}
                          </div>
                        )}
                        {/* 手機沒有 hover:opacity-0 等於這顆鈕在手機根本看不見也按不到,所以 max-sm 直接常駐並放大到 36px
                            (縮圖只有半個 grid 欄寬,44px 會蓋掉照片主體,列為 W8-5 已知例外);鍵盤 focus 也要現形 */}
                        {can.edit && <button onClick={() => onDeletePhoto(p)} title="刪除照片" aria-label={`刪除照片 ${p.caption || `現場照片 ${i + 1}`}`}
                          className="absolute top-1 right-1 w-6 h-6 max-sm:w-9 max-sm:h-9 rounded-full bg-black/55 text-white text-xs leading-none opacity-0 max-sm:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity">✕</button>}
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
                    {can.edit && <button onClick={async () => { if (await appConfirm({ title: `刪除 ${l.log_date} 的施工日誌？`, danger: true, confirmLabel: '刪除' })) { const { error } = await deleteSiteLog(l.id); if (error) setSavedMsg(`日誌刪除失敗:${error.message}`) } }} className="text-[var(--text-3)] hover:text-[var(--red-text)] p-2 -m-2" aria-label={`刪除 ${l.log_date} 日誌`}>✕</button>}
                  </div>
                  {l.work_summary && <div className="text-xs text-[var(--text-2)] truncate mt-0.5">{l.work_summary}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 廠商操作說明:唯讀角色沒有存檔/複製昨日/快填這些入口,整段只對可編視角渲染 */}
      {can.edit && (
        <p className="text-xs text-[var(--text-3)]">
          一天一筆（同日再存會覆蓋）。零輸入:新日期可「複製昨日」帶入班組/機具/材料、天氣點選快填、常用項目一鍵加入（依你的歷史自動學）。各日「當日完成數量」加總 = 估驗的「累計完成數量」——到估驗頁（草稿期）按「帶入日誌累計」即可自動帶入。
        </p>
      )}
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
      {/* chips 一排多顆密集排列,手機最容易點錯:min-h-11 + 較寬 padding(flex-wrap 容器,只會變高不會破版) */}
      {items.map((r, i) => (
        <button key={i} onClick={() => onAdd(r)}
          className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 max-sm:min-h-11 max-sm:px-3 rounded-full border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--blue-tint)] hover:text-[var(--blue-text)] hover:border-[var(--blue)] pressable">
          <MSym name="add" size={10} />{label(r)}
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
        {!disabled && <button onClick={add} className="inline-flex items-center max-sm:min-h-11 px-1 text-xs text-[var(--blue)] hover:underline">＋ 加一列</button>}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--text-3)]">（未填）</p>
      ) : rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 mb-1.5">
          {fields.map((f) => (
            // 這是 flex 列不是 table:加 min-h 只讓每列長高,不會像表格那樣整張翻倍
            <input key={f.key} value={r[f.key] ?? ''} placeholder={f.ph} disabled={disabled}
              type={f.num ? 'number' : 'text'} min={f.num ? 0 : undefined} step={f.num ? 'any' : undefined}
              inputMode={f.num ? 'decimal' : undefined}
              onChange={(e) => set(i, f.key, f.num ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
              className={`${f.w} border border-[var(--border)] rounded-lg px-2 py-1 text-sm max-sm:min-h-11 ${f.num ? 'text-right tabular-nums' : ''} disabled:opacity-50 disabled:bg-[var(--surface-2)]`} />
          ))}
          {!disabled && <button onClick={() => del(i)} className="text-[var(--text-3)] hover:text-[var(--red-text)] p-2 -m-2" aria-label="刪除此列">✕</button>}
        </div>
      ))}
    </div>
  )
}
