import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Badge, Empty, PageHeader, ErrorBanner, SkeletonList } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { CHIP_BASE, CHIP_ON, CHIP_OFF } from '../../components/PageTabs.jsx'
import { appPrompt } from '../../components/confirm.jsx'
import { sampleAlerts } from '../../lib/qc.js'
import { taipeiToday } from '../../lib/dates.js'
import { billableLeaves } from '../../lib/boqCalc.js'
import { buildQualityQueue, QUALITY_QUEUE_LIMIT } from '../../lib/qualityQueue.js'
import DefectTracker from '../../components/DefectTracker.jsx'
// 五個分段各住一檔(重構波次 7);分段之間只透過本頁的 state 與 store 動作往來
import InspectionsSection from '../../components/quality/InspectionsSection.jsx'
import ChecklistSection from '../../components/quality/ChecklistSection.jsx'
import SamplesSection from '../../components/quality/SamplesSection.jsx'
import ObservationsSection from '../../components/quality/ObservationsSection.jsx'

const QUEUE_TAG_COLOR = { 查驗: 'amber', 缺失: 'red', 觀察: 'slate', 試驗: 'blue' }
const SEGMENTS = ['查驗', '缺失', '觀察', '檢查表', '試驗']

export default function Quality() {
  const { workItems, inspections, createInspection, recordInspectionResult, deleteInspection,
    checklistTemplates, checklistRecords, createChecklistRecord, deleteChecklistRecord,
    testSamples, createTestSamples, generateSamplesFromLogs, updateTestSample, deleteTestSample,
    observations, createObservation, updateObservation, escalateObservation, deleteObservation,
    defects, currentUser,
    isSupabaseConfigured, currentProject, workItemsSource, can, resolveMarkup } = useStore()
  const [inspForm, setInspForm] = useState(null) // null=收起；物件=展開
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 判定寫入失敗必須讓使用者看到(失敗=UI 不變)
  // 預設分段固定「查驗」:三角色一致,監造判定動線不必先切段。例外是 URL 帶 ?defect=
  // (收件匣的缺失待辦直達那一筆,規範 §9.7):缺失分段是清單＋詳情殼,query 要落到它身上
  // 才有意義,所以帶 query 進頁直接落在「缺失」。
  const [params, setSearchParams] = useSearchParams()
  const [segment, setSegment] = useState(() => (params.has('defect') ? '缺失' : '查驗'))
  // 缺失殼的重掛鍵:佇列點一筆缺失時 +1,讓殼重新讀 ?defect= 選中那一筆(殼只在掛載時讀深連結;
  // 已經停在缺失分段時不重掛就只會換 URL、不會換選取)
  const [defectFocus, setDefectFocus] = useState(0)
  // ?defect= 只在缺失分段有意義:離開分段就拿掉,否則切回來時殼會把它當深連結、<lg 又彈一次抽屜
  const changeSegment = (s) => {
    if (s !== '缺失' && params.has('defect')) {
      setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('defect'); return n }, { replace: true })
    }
    setSegment(s)
  }
  // 佇列點缺失:寫 ?defect=<id> 再進缺失分段,殼掛載時讀到就選中它(<lg 直接推入詳情)
  const focusQueueItem = (q) => {
    if (q.tag === '缺失' && q.id) {
      setSearchParams((p) => { const n = new URLSearchParams(p); n.set('defect', q.id); return n }, { replace: true })
      setDefectFocus((k) => k + 1)
    }
    setSegment(q.segment)
  }
  // 判定成功的原地回饋(沿用各區塊 savedMsg 模式,不進全域狀態):
  // 判不合格開的缺失在「缺失」分段,不給入口使用者會以為判定沒發生
  const [resultMsg, setResultMsg] = useState(null) // null | { pass: boolean }
  // 查驗清單的狀態篩選(S-4 查驗履歷):預設「全部」,不改變既有清單的預設內容
  const [inspFilter, setInspFilter] = useState('全部')

  const leaves = useMemo(() => {
    if (!workItems) return []
    return billableLeaves(workItems.items)
  }, [workItems])

  // 檢附自主檢查表(S-2)候選:已判定(合格/不合格皆可)的「現行版」檢查紀錄。
  // 工項對應沿用 ChecklistSection 的雙鍵慣例(demo 存 work_item_key、真 DB 存 uuid);
  // 未掛工項的檢查表不排除——掛工項本來就是選填,嚴格同鍵會把多數表藏光,
  // 明確掛了「別的」工項才確定不相干。歷次版本不列:被修訂的舊證據不該再被檢附。
  const attachableChecklists = useMemo(() => {
    const leafByRef = new Map()
    for (const l of leaves) { leafByRef.set(l.item_key, l); if (l.id) leafByRef.set(l.id, l) }
    const currentByRoot = new Map()
    for (const r of checklistRecords) {
      const root = r.root_id || r.id
      if ((currentByRoot.get(root)?.rev || 0) <= (r.rev || 0)) currentByRoot.set(root, r)
    }
    const formKey = inspForm?.work_item_key || null
    return [...currentByRoot.values()]
      .filter((r) => r.overall)
      .filter((r) => {
        const key = (leafByRef.get(r.work_item_key) || leafByRef.get(r.work_item_id))?.item_key || null
        return key == null || key === formKey
      })
      .sort((a, b) => (b.check_date || '').localeCompare(a.check_date || ''))
  }, [checklistRecords, leaves, inspForm?.work_item_key])

  // 早退也保留 PageHeader:工作面分頁列(PageTabs)長在 PageHeader 裡,早退不帶頁首
  // 等於整條分頁列消失;平板(768–1279)與收合側欄的 icon rail 又不列子頁,
  // 使用者會被關在載入/空狀態畫面裡,換不到同工作面的其他頁。
  const header = <PageHeader title="品質查驗" tagline="三級品管" subtitle="查驗、缺失、觀察、檢查表與試驗——先看「現在要處理」，再進分段完成" />
  if (!workItems) {
    return (
      <div className="space-y-5">
        {header}
        <Card bodyClass="p-5" aria-busy="true"><SkeletonList rows={3} /></Card>
      </div>
    )
  }
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return (
      <div className="space-y-5">
        {header}
        <Card title="品質查驗"><Empty>此專案的標單尚未匯入資料庫。請先到「專案文件」一次上傳標單 XML。</Empty></Card>
      </div>
    )
  }

  // 失敗要讓使用者看到、表單不關(B-07:原本吞掉 error,看起來像成功)
  const submitInsp = async () => {
    // 申請查驗日是三級品管的起算點(監造多久沒來查、逾期與否都靠它),
    // 沒有它的查驗單事後補不回來 → 送出前擋住,不只是把鈕變灰
    if (!inspForm.title || !inspForm.requested_date) {
      setErrMsg('查驗申請未送出:查驗項目與申請查驗日必填。'); return
    }
    setErrMsg(''); setBusy(true)
    const { error } = await createInspection(inspForm)
    setBusy(false)
    if (error) { setErrMsg(friendlyError(error, '查驗申請未送出')); return }
    setInspForm(null)
  }
  // 三級品管一級交二級的正流程:自主檢查合格 → 提查驗申請並檢附該紀錄。
  // 只預填表單(工項/項目/位置/檢附/申請日),送出仍由人按——與檢附 select 的
  // 候選規則一致(現行版+已判定),所以預填的 id 一定會出現在下拉裡。
  const requestInspectionFromChecklist = (r, tplTitle, wi) => {
    changeSegment('查驗')
    setInspForm({
      title: tplTitle || '', location: r.location || '',
      inspection_type: '施工查驗', requested_date: taipeiToday(),
      work_item_key: wi?.item_key || '', work_item_label: wi ? `${wi.item_no} ${wi.description}` : '',
      checklist_record_id: r.id,
    })
  }

  const onResult = async (insp, pass) => {
    let note = ''
    if (!pass) {
      note = await appPrompt({
        title: `判定不合格：${insp.title}`, label: '不合格原因 / 缺失說明（必填）',
        required: true, danger: true, confirmLabel: '判定不合格並開立缺失',
      })
      if (note === null) return
    }
    setErrMsg(''); setBusy(true)
    const { error, defectError } = await recordInspectionResult(insp, pass, note)
    setBusy(false)
    if (error) { setErrMsg(friendlyError(error, '查驗判定未寫入')); return }
    // 判定已寫入但自動開缺失失敗:不能亮「已開立缺失」的綠訊息騙人——
    // 走既有 ErrorBanner 如實提示手動補開(同檢查表 defectError 的處理慣例)
    if (defectError) {
      setErrMsg(`查驗判定已記錄，但缺失開立失敗：${friendlyError(defectError, '請稍後重試')}。請至「缺失」分段手動補開缺失。`)
      return
    }
    setResultMsg({ pass })
  }
  // 刪除鈕在查驗分段內(確認對話框也在那),頁層只負責錯誤呈現(errMsg 是頁層 ErrorBanner)
  const onDeleteInsp = async (id) => { setErrMsg(''); const { error } = await deleteInspection(id); if (error) setErrMsg(friendlyError(error, '查驗紀錄刪除未完成')) }
  // 逐狀態計數一次算完:卡片標題、篩選 chips 與分段徽章共用同一份口徑,
  // 免得「待查驗 N」在三處各自 filter 一遍還可能漂移
  const inspCount = { 全部: inspections.length, 待查驗: 0, 合格: 0, 不合格: 0 }
  // hasOwn 而非 in:狀態值來自 DB,不該讓 'constructor' 這種原型鍵意外命中計數器
  for (const i of inspections) if (Object.hasOwn(inspCount, i.status)) inspCount[i.status] += 1
  const openInsp = inspCount['待查驗']

  // 「今天」每次 render 取(B-11:工地平板整週不關分頁,模組層常數會停在開頁那天)。
  // 傳日曆日字串給期限引擎:含時間的「現在」會把 8 個日曆日壓成 7(W8-2 踩過的坑)。
  const today = taipeiToday()
  const myOrg = currentUser?.org_type || 'contractor'
  const queue = buildQualityQueue(myOrg, { inspections, defects, observations, testSamples }, today)
  // 分段計數:各分段「還有幾件事沒完」,與區塊內既有的計數口徑一致
  const openDefects = defects.filter((d) => (d.domain || 'quality') === 'quality' && d.status !== '已結案').length
  const openObs = observations.filter((o) => o.status === '待處理').length
  const segCount = { 查驗: openInsp, 缺失: openDefects, 觀察: openObs, 檢查表: null, 試驗: sampleAlerts(testSamples, today).length }

  return (
    <div className="space-y-5">
      <div>{header}</div>

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      {/* 工作佇列:輪到登入角色處理的品質事項,點一筆切到對應分段(不捲頁) */}
      <Card title="現在要處理">
        {queue.length === 0 ? <Empty>目前沒有輪到你處理的品質事項</Empty> : (
          <div className="space-y-1">
            {queue.slice(0, QUALITY_QUEUE_LIMIT).map((q) => (
              // 整列可點的鈕,手機補到 44px 不會破版。這裡刻意不是 <li>:缺失列/查驗列
              // 才是清單,contractor/supervisor spec 用 getByRole('listitem') 鎖那兩處的列,
              // 佇列若也當 listitem 會雙重命中
              <button key={q.key} onClick={() => focusQueueItem(q)}
                className="w-full flex items-center gap-3 text-left text-sm rounded-lg px-2 py-1.5 max-md:min-h-11 hover:bg-[var(--surface-2)] pressable">
                <Badge color={QUEUE_TAG_COLOR[q.tag] || 'slate'}>{q.tag}</Badge>
                <span className="min-w-0 flex-1 truncate text-[var(--text)]">{q.title}</span>
                <span className="text-xs text-[var(--text-3)] shrink-0">{q.meta}</span>
              </button>
            ))}
            {queue.length > QUALITY_QUEUE_LIMIT && (
              <p className="text-xs text-[var(--text-3)] px-2 pt-1">還有 {queue.length - QUALITY_QUEUE_LIMIT} 項</p>
            )}
          </div>
        )}
      </Card>

      {/* 分段控制:與工作面分頁/Admin tabs 同一種 chips 切換語言(CHIP_BASE/ON/OFF),
          實心 primary 滑塊式 segmented 退場;flex-wrap 保 375px 不橫向溢位。
          min-h-11 是 a11y e2e 契約(品質分段五顆 ≥44px,桌機同樣保留)。
          非當前分段不渲染(unmount)——已知取捨:切段會失去該段未送出的表單 state;
          各段表單皆短,重填成本低,換來的是頁面不再五卡直落、每段各自可專心操作 */}
      <div role="group" aria-label="品質分段" className="flex flex-wrap gap-1.5">
        {SEGMENTS.map((s) => (
          <button key={s} onClick={() => changeSegment(s)} aria-pressed={segment === s}
            className={`${CHIP_BASE} ${segment === s ? CHIP_ON : CHIP_OFF} min-h-11 gap-1`}>
            {s}
            {segCount[s] > 0 && <span className="num opacity-80">{segCount[s]}</span>}
          </button>
        ))}
      </div>

      {/* 查驗:標題同時給「全部」與「待查驗」——這張卡不只是待辦盒,也是本案的查驗履歷 */}
      {segment === '查驗' && (
      <InspectionsSection inspections={inspections} inspCount={inspCount} filter={inspFilter} onFilter={setInspFilter}
        form={inspForm} onFormChange={setInspForm} onSubmit={submitInsp} busy={busy}
        resultMsg={resultMsg} onShowDefects={() => changeSegment('缺失')}
        leaves={leaves} attachableChecklists={attachableChecklists} templates={checklistTemplates}
        can={can} onResult={onResult} onDelete={onDeleteInsp} />
      )}

      {/* 缺失:統一缺失引擎(與工安缺失同狀態機),此處只列品質 domain。清單＋詳情殼住在元件裡,
          key 見 defectFocus */}
      {segment === '缺失' && <DefectTracker key={defectFocus} domain="quality" leaves={leaves} />}

      {/* 觀察事項:比缺失輕的現場提醒,可升級成正式缺失 */}
      {segment === '觀察' && (
      <ObservationsSection observations={observations} canWrite={can.edit || can.approve}
        onCreate={createObservation} onUpdate={updateObservation} onEscalate={escalateObservation}
        onDelete={deleteObservation} resolveMarkup={resolveMarkup} />
      )}

      {/* 自主檢查表:量化標準 → 實測值 → 自動判定 */}
      {segment === '檢查表' && (
      <ChecklistSection templates={checklistTemplates} records={checklistRecords} canEdit={can.edit} leaves={leaves}
        onCreate={createChecklistRecord} onDelete={deleteChecklistRecord}
        inspections={inspections} onRequestInspection={can.submit ? requestInspectionFromChecklist : null} />
      )}

      {/* 取樣試驗:試體齡期追蹤 + fc′ 自動判定 */}
      {segment === '試驗' && (
      <SamplesSection samples={testSamples} onGenerate={generateSamplesFromLogs} canEdit={can.edit}
        onCreate={createTestSamples} onUpdate={updateTestSample} onDelete={deleteTestSample} />
      )}

      {/* 三級品管說明:所有分段共用,固定頁尾 */}
      <p className="text-xs text-[var(--text-3)]">三級品管：廠商提查驗申請 → 監造現場查驗（合格/不合格）→ 不合格自動開缺失 → 廠商改善 → 監造複查結案。自主檢查依範本量化標準自動判定、試體依 fc′ 自動判定，不合格皆自動開缺失；試驗到期自動進提醒中心。</p>
    </div>
  )
}
