import { useState, useMemo, useEffect } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Badge, Empty, PageHeader, ErrorBanner, SkeletonList } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { CHIP_BASE, CHIP_ON, CHIP_OFF } from '../../components/PageTabs.jsx'
import { sampleAlerts } from '../../lib/qc.js'
import { itpStatus } from '../../lib/itp.js'
import { taipeiToday } from '../../lib/dates.js'
import { billableLeaves } from '../../lib/boqCalc.js'
import { projectStageKeys } from '../../lib/fieldDocs.js'
import { buildQualityQueue, QUALITY_QUEUE_LIMIT } from '../../lib/qualityQueue.js'
import DefectTracker from '../../components/DefectTracker.jsx'
// 五個分段各住一檔(重構波次 7);分段之間只透過本頁的 state 與 store 動作往來
import InspectionsSection from '../../components/quality/InspectionsSection.jsx'
import ChecklistSection from '../../components/quality/ChecklistSection.jsx'
import ChecklistTemplatesCard from '../../components/quality/ChecklistTemplatesCard.jsx'
import SamplesSection from '../../components/quality/SamplesSection.jsx'
import ObservationsSection from '../../components/quality/ObservationsSection.jsx'

const QUEUE_TAG_COLOR = { 查驗: 'amber', 缺失: 'red', 觀察: 'slate', 試驗: 'blue' }
const SEGMENTS = ['查驗', '缺失', '觀察', '檢查表', '試驗']
// 分段 → 該分段殼的 URL 單條參數名(與各段 useListDetailPane 的 param 一致;檢查表沒有殼)
const QUEUE_PARAM = { 查驗: 'inspection', 缺失: 'defect', 觀察: 'observation', 試驗: 'sample' }
const SEGMENT_OF_PARAM = Object.entries(QUEUE_PARAM)
// 分段本身也進 URL(?seg=,UIUX 階段 3B):重新整理、從單據返回、分享網址都回到同一段;
// 用 ASCII 鍵不用中文,網址才讀得出來。單條參數(?defect= 等)仍優先決定分段。
const SEG_KEY = { 查驗: 'inspections', 缺失: 'defects', 觀察: 'observations', 檢查表: 'checklist', 試驗: 'samples' }
const SEG_OF_KEY = Object.fromEntries(Object.entries(SEG_KEY).map(([seg, k]) => [k, seg]))

export default function Quality() {
  const { workItems, inspections, createInspection, deleteInspection,
    checklistTemplates, checklistRecords, saveChecklistTemplate,
    testSamples, createTestSamples, generateSamplesFromLogs, updateTestSample, deleteTestSample,
    observations, createObservation, updateObservation, escalateObservation, deleteObservation,
    defects, currentUser, fieldDocuments, inspectionPoints,
    isSupabaseConfigured, currentProject, workItemsSource, can, resolveMarkup } = useStore()
  // 自主檢查表文件(P3b)簽署落下的紀錄:record id → 文件(顯示「已簽署 v{n}」、下鑽到文件列印版)
  const signedDocByRecord = useMemo(() => {
    const m = new Map()
    for (const d of fieldDocuments?.documents || []) if (d.doc_type === 'self_check' && d.target_id && ['signed', 'submitted', 'received'].includes(d.status)) m.set(d.target_id, d)
    return m
  }, [fieldDocuments])
  // 監造查驗表單文件(P3c):查驗 id → 活文件(詳情欄「監造查驗表單」直達;簽署即判定並寫入確認量)
  const formDocByInspection = useMemo(() => {
    const m = new Map()
    for (const d of fieldDocuments?.documents || []) if (d.doc_type === 'inspection_form' && d.target_key && !['discarded', 'superseded'].includes(d.status)) m.set(d.target_key, d)
    return m
  }, [fieldDocuments])
  const [inspForm, setInspForm] = useState(null) // null=收起；物件=展開
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 申請／刪除寫入失敗必須讓使用者看到(失敗=UI 不變)
  // 佇列點一筆=切段並把該筆寫進 URL 單條連結參數(各分段的殼 hook 讀自己的 param):
  // 分段是非當前不渲染的,切段時重新掛載,殼的初次自動選取會優先吃深連結,詳情欄直接
  // 落在那一筆(規範 §1 判準第 3 題:從發現到完成少一步;§9.7 收件匣直達那一筆)。
  const [params, setSearchParams] = useSearchParams()
  // 切段/點佇列改寫 query 時保住 location.state:「返回今日工作」的來源住在 state,丟掉就沒有返回入口(W05)
  const { state: navState } = useLocation()
  // 預設分段固定「查驗」(三角色一致,監造判定動線不必先切段);例外是 URL 已帶某分段的
  // 單條參數(收件匣的 ?defect= / 佇列的 ?inspection= 等)——query 要落到那個殼身上才有意義。
  const [segment, setSegment] = useState(() => SEGMENT_OF_PARAM.find(([, k]) => params.has(k))?.[0] || SEG_OF_KEY[params.get('seg')] || '查驗')
  // 查驗申請送出成功的回饋(只講真的成功的部分:已送出、等待監造;有檢附就說檢附了什麼)
  const [inspNotice, setInspNotice] = useState('')
  // 已經在同一分段時分段不會重新掛載、深連結不會被讀——用 key 強制該分段重掛
  const [queueTick, setQueueTick] = useState(0)
  // 單條參數只在自己的分段有意義:離開分段就拿掉,否則切回來時殼會把它當深連結、<lg 又彈一次抽屜
  const changeSegment = (s) => {
    const stale = SEGMENT_OF_PARAM.filter(([seg, k]) => seg !== s && params.has(k)).map(([, k]) => k)
    setSearchParams((p) => { const n = new URLSearchParams(p); stale.forEach((k) => n.delete(k)); n.set('seg', SEG_KEY[s]); return n }, { replace: true, state: navState })
    setSegment(s)
  }
  // 佇列點一筆:寫入該段的單條參數並重掛該段的殼(初次自動選取才會讀深連結)。
  // 自主檢查表不在佇列裡,不重掛。
  const openQueueItem = (q) => {
    const param = QUEUE_PARAM[q.segment]
    setSearchParams((p) => {
      const n = new URLSearchParams(p)
      SEGMENT_OF_PARAM.filter(([seg]) => seg !== q.segment).forEach(([, k]) => n.delete(k))
      if (param && q.id) n.set(param, q.id)
      n.set('seg', SEG_KEY[q.segment])
      return n
    }, { replace: true, state: navState })
    setSegment(q.segment); setQueueTick((t) => t + 1)
  }
  // 自主檢查表文件頁「提出查驗申請（檢附此表）」:?attach=<record_id> 預填檢附(候選規則同下拉:現行版＋已判定),讀一次即拿掉
  useEffect(() => {
    const attachId = params.get('attach')
    if (!attachId || !can.submit) return
    const r = checklistRecords.find((x) => x.id === attachId)
    if (r) {
      const wi = leaves.find((l) => l.id === r.work_item_id || l.item_key === r.work_item_key)
      setInspForm({
        title: checklistTemplates.find((t) => t.id === r.template_id)?.title || '', location: r.location || '',
        inspection_type: '施工查驗', requested_date: taipeiToday(),
        work_item_key: wi?.item_key || '', work_item_label: wi ? `${wi.item_no} ${wi.description}` : '',
        checklist_record_id: r.id,
      })
      setSegment('查驗')
    }
    setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('attach'); n.set('seg', SEG_KEY['查驗']); return n }, { replace: true, state: navState })
  }, [params, checklistRecords]) // eslint-disable-line react-hooks/exhaustive-deps
  // 查驗清單的狀態篩選(S-4 查驗履歷):預設「全部」,不改變既有清單的預設內容
  const [inspFilter, setInspFilter] = useState('全部')
  const leaves = useMemo(() => {
    if (!workItems) return []
    return billableLeaves(workItems.items)
  }, [workItems])
  // 本案的必要查驗階段(H 點):查驗表單範本綁階段時只能從這裡選,階段鍵的語意單一來源是檢驗停留點
  const stageKeys = useMemo(() => projectStageKeys(inspectionPoints), [inspectionPoints])

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
    setErrMsg(''); setBusy(true); setInspNotice('')
    const { error, id } = await createInspection(inspForm)
    setBusy(false)
    // 失敗:表單與已選的檢附紀錄都留著,可重試
    if (error) { setErrMsg(friendlyError(error, '查驗申請未送出')); return }
    const attached = inspForm.checklist_record_id ? checklistRecords.find((r) => r.id === inspForm.checklist_record_id) : null
    const attachedText = attached
      ? `，已檢附自主檢查表 ${attached.check_date}${attached.rev ? ` Rev.${attached.rev}` : ''}（${attached.overall || '未判定'}）`
      : ''
    setInspNotice(`查驗申請「${inspForm.title}」已送出${attachedText}，等待監造現場查驗。`)
    setInspForm(null)
    // 新送出的查驗直接選中(與佇列點一筆同一條路:寫 ?inspection= 並重掛殼)
    if (id) openQueueItem({ segment: '查驗', id })
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

  // 刪除鈕在查驗分段內(確認對話框也在那),頁層只負責錯誤呈現(errMsg 是頁層 ErrorBanner)
  const onDeleteInsp = async (id) => { setErrMsg(''); const { error } = await deleteInspection(id); if (error) setErrMsg(friendlyError(error, '查驗紀錄刪除未完成')) }
  // 逐狀態計數一次算完:卡片標題、篩選 chips 與分段徽章共用同一份口徑,
  // 免得「待查驗 N」在三處各自 filter 一遍還可能漂移
  const inspCount = { 全部: inspections.length, 待查驗: 0, 合格: 0, 部分合格: 0, 不合格: 0 }
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
  // 停留點未處理件數(入口嵌回查驗分段用):未申請查驗／已申請待監造查驗,與 /itp 同一支推導。
  // 與上面幾個計數一樣每次 render 直接算(本頁在此之前已有提前 return,不能再多掛 hook)
  const itpOpen = { total: (inspectionPoints || []).length, pending: 0, requested: 0 }
  for (const p of inspectionPoints || []) {
    const k = itpStatus(p, inspections).key
    if (k === 'pending') itpOpen.pending += 1
    else if (k === 'requested') itpOpen.requested += 1
  }
  // 三個轉殼分段的切案重置範圍(殼 hook 的 scope):換專案或身分就清掉選取與 URL 參數
  const paneScope = `${currentProject?.project_id || 'demo'}/${myOrg}`

  return (
    <div className="space-y-5">
      <div>{header}</div>

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      {/* 工作佇列:輪到登入角色處理的品質事項,點一筆切到對應分段並直接選中那一筆(不捲頁) */}
      <Card title="現在要處理">
        {queue.length === 0 ? <Empty>目前沒有輪到你處理的品質事項</Empty> : (
          <div className="space-y-1">
            {queue.slice(0, QUALITY_QUEUE_LIMIT).map((q) => (
              // 整列可點的鈕,手機補到 44px 不會破版。這裡刻意不是 <li>:缺失列/查驗列
              // 才是清單,contractor/supervisor spec 用 getByRole('listitem') 鎖那兩處的列,
              // 佇列若也當 listitem 會雙重命中
              <button key={q.key} onClick={() => openQueueItem(q)}
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
          非當前分段不渲染(unmount),頁面不會五卡直落;各段表單皆短、重填成本低
          (自主檢查表分段自 P6b-3 起只剩查閱,不再需要常駐保留輸入) */}
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
      <InspectionsSection key={queueTick} inspections={inspections} inspCount={inspCount} filter={inspFilter} onFilter={setInspFilter}
        form={inspForm} onFormChange={setInspForm} onSubmit={submitInsp} busy={busy}
        notice={inspNotice} onCloseNotice={() => setInspNotice('')}
        leaves={leaves} attachableChecklists={attachableChecklists} templates={checklistTemplates} signedDocByRecord={signedDocByRecord}
        inspectionPoints={inspectionPoints} formDocByInspection={formDocByInspection}
        can={can} onDelete={onDeleteInsp} scope={paneScope} />
      )}

      {/* 檢驗停留點:入口嵌回查驗流程(2026-09-20 廠商驗收 A 包;側欄不再與品質查驗並列一項)。
          停留點決定「施作到哪裡要先叫驗」,是同一條查驗流程的前一步,不是另一個模組。
          件數與 /itp 同一支推導(lib/itp.itpStatus),不在這裡另造判斷。 */}
      {segment === '查驗' && itpOpen.total > 0 && (
        <p className="text-footnote text-[var(--text-2)]">
          本案有 {itpOpen.total} 個檢驗停留點{itpOpen.pending > 0 ? `，其中 ${itpOpen.pending} 個尚未申請查驗` : ''}{itpOpen.requested > 0 ? `，${itpOpen.requested} 個待監造查驗` : ''}。
          <Link to="/itp" className="text-[var(--blue-text)] hover:underline mx-1">檢驗停留點</Link>
          可查看允收標準與逐點狀態；H 點未查驗不得續作。
        </p>
      )}

      {/* 缺失:統一缺失引擎(與工安缺失同狀態機),此處只列品質 domain。清單＋詳情殼住在元件裡,
          key 與其他分段同一個 queueTick(佇列點一筆時重掛,殼才會重讀 ?defect=) */}
      {segment === '缺失' && <DefectTracker key={queueTick} domain="quality" leaves={leaves} />}

      {/* 觀察事項:比缺失輕的現場提醒,可升級成正式缺失 */}
      {segment === '觀察' && (
      <ObservationsSection key={queueTick} observations={observations} canWrite={can.edit || can.approve}
        onCreate={createObservation} onUpdate={updateObservation} onEscalate={escalateObservation}
        onDelete={deleteObservation} resolveMarkup={resolveMarkup} scope={paneScope} />
      )}

      {/* 自主檢查表:只剩查閱(P6b-3)——新增與更正在自主檢查表文件頁起稿、確認、簽署;這裡列紀錄、檢附查驗與列印。
          範本(P3g)住同一段:自主檢查表與監造查驗表單的項目都由範本決定,兩種用途在同一張卡維護。 */}
      {segment === '檢查表' && (<>
        <ChecklistTemplatesCard key={`tpl-${paneScope}`} templates={checklistTemplates} records={checklistRecords}
          inspections={inspections} leaves={leaves} stageKeys={stageKeys} can={can} onSave={saveChecklistTemplate} />
        <ChecklistSection key={paneScope} templates={checklistTemplates} records={checklistRecords} canEdit={can.edit} leaves={leaves} signedDocByRecord={signedDocByRecord}
          inspections={inspections} onRequestInspection={can.submit ? requestInspectionFromChecklist : null} />
      </>)}

      {/* 取樣試驗:試體齡期追蹤 + fc′ 自動判定 */}
      {segment === '試驗' && (
      <SamplesSection key={queueTick} samples={testSamples} onGenerate={generateSamplesFromLogs} canEdit={can.edit}
        onCreate={createTestSamples} onUpdate={updateTestSample} onDelete={deleteTestSample} scope={paneScope} />
      )}

      {/* 三級品管說明:所有分段共用,固定頁尾 */}
      <p className="text-xs text-[var(--text-3)]">三級品管：廠商以自主檢查表文件自檢並提查驗申請 → 監造以查驗表單判定並簽署（合格／部分合格／不合格，含本次確認數量）→ 不合格自動開缺失 → 廠商改善 → 監造複查結案。自主檢查依範本量化標準、試體依 fc′ 自動判定，不合格皆自動開缺失；試驗到期自動進提醒中心。</p>
    </div>
  )
}
