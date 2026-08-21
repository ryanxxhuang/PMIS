import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Badge, Empty, PageHeader, ErrorBanner, SkeletonList, Input, Select, Textarea, FilterChip, THEAD_CLS } from '../../components/ui.jsx'
import { CHIP_BASE, CHIP_ON, CHIP_OFF } from '../../components/PageTabs.jsx'
import { appConfirm, appPrompt } from '../../components/confirm.jsx'
import { judgeChecklist, judgeItem, diffChecklistResults, sampleAlerts } from '../../lib/qc.js'
import { collaborationItems } from '../../lib/ballInCourt.js'
import DefectTracker, { WorkItemPicker } from '../../components/DefectTracker.jsx'
import MarkupEditor, { MarkupThumb } from '../../components/MarkupEditor.jsx'

const inspColor = { 待查驗: 'amber', 合格: 'green', 不合格: 'red' }

// ── W8-4A 工作佇列「現在要處理」────────────────────────────────────────
// 佇列超過上限只顯示前幾筆＋「還有 N 項」:佇列是入口不是清單,完整內容在各分段。
export const QUALITY_QUEUE_LIMIT = 6

// 到期句沿用 W8-2 今日待辦的詞彙(todayTasks.js dueText):同一種期限,全站說同一句話
const dueText = (days, due) => (days < 0
  ? `逾期 ${-days} 天（到期 ${due}）`
  : days === 0 ? `今天到期（${due}）` : `還有 ${days} 天（到期 ${due}）`)

// collaborationItems 的 tag → 本頁分段。走白名單:未列的 tag(估驗/送審/工安缺失…)
// 一律不進佇列——本頁只管品質 domain,佇列點了卻在下方找不到的項目不准出現。
const QUEUE_SEGMENT_OF = { 查驗: '查驗', 缺失: '缺失', 觀察: '觀察' }

// 工作佇列純函式:只組合既有引擎(collaborationItems + sampleAlerts),不自創狀態規則。
// 結構上只收 { inspections, defects, observations, testSamples } 四種輸入——
// AI 草稿(agent_actions)與未核定 Requirement 根本進不來,是紅線 1 的結構保證,
// 不是靠呼叫端自律。today 由呼叫端注入(頁面 render 時的當天),純函式不讀時鐘,
// 測試才能用固定日期斷言逾期天數。
export function buildQualityQueue(org, data = {}, today) {
  const { inspections = [], observations = [], testSamples = [] } = data
  // 工安缺失屬 /safety;本頁 DefectTracker 只列 quality domain,佇列必須同一份範圍
  const defects = (data.defects || []).filter((d) => d.domain !== 'safety')
  const out = []
  collaborationItems({ defects, inspections, observations }).forEach((it, i) => {
    if (it.who !== org) return
    const segment = QUEUE_SEGMENT_OF[it.tag]
    if (!segment) return
    out.push({ key: `${it.tag}:${it.id ?? `${it.title}#${i}`}`, tag: it.tag, title: it.title, meta: it.meta, segment })
  })
  // 試驗到期只給廠商:填試驗值的欄位在試驗分段吃 can.edit(=廠商),
  // 塞給監造/機關只會是點了做不到的假待辦
  if (org === 'contractor') {
    for (const a of sampleAlerts(testSamples, today)) {
      out.push({
        key: `試驗:${a.sample.id ?? a.sample.sample_no}:${a.label}`,
        tag: '試驗',
        title: `${a.sample.sample_no || ''} ${a.sample.test_item || ''} ${a.label}`.trim(),
        meta: dueText(a.days, a.due),
        segment: '試驗',
      })
    }
  }
  return out
}

const QUEUE_TAG_COLOR = { 查驗: 'amber', 缺失: 'red', 觀察: 'slate', 試驗: 'blue' }
const SEGMENTS = ['查驗', '缺失', '觀察', '檢查表', '試驗']

// 查驗清單的狀態篩選(S-4):判定後的紀錄本來就留在清單裡,但純時間序要回答
// 「擋土牆到底合格了沒」只能逐列掃。'全部' 是唯一非狀態值,其餘直接對 inspections.status。
const INSP_FILTERS = ['全部', '待查驗', '合格', '不合格']

export default function Quality() {
  const { project, workItems, inspections, createInspection, recordInspectionResult, deleteInspection,
    checklistTemplates, checklistRecords, createChecklistRecord, deleteChecklistRecord,
    testSamples, createTestSamples, generateSamplesFromLogs, updateTestSample, deleteTestSample,
    observations, createObservation, updateObservation, escalateObservation, deleteObservation,
    defects, currentUser,
    isSupabaseConfigured, currentProject, workItemsSource, can, resolveMarkup } = useStore()
  const navigate = useNavigate() // 查驗列的「附自主檢查表」chip 導向既有列印檢視
  const [inspForm, setInspForm] = useState(null) // null=收起；物件=展開
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 判定寫入失敗必須讓使用者看到(失敗=UI 不變)
  // 預設分段固定「查驗」:三角色一致,監造判定動線不必先切段
  const [segment, setSegment] = useState('查驗')
  // 判定成功的原地回饋(沿用各區塊 savedMsg 模式,不進全域狀態):
  // 判不合格開的缺失在「缺失」分段,不給入口使用者會以為判定沒發生
  const [resultMsg, setResultMsg] = useState(null) // null | { pass: boolean }
  // 查驗清單的狀態篩選(S-4 查驗履歷):預設「全部」,不改變既有清單的預設內容
  const [inspFilter, setInspFilter] = useState('全部')

  const leaves = useMemo(() => {
    if (!workItems) return []
    const childMap = new Map()
    for (const it of workItems.items) { const k = it.parent_key || '__root__'; if (!childMap.has(k)) childMap.set(k, []); childMap.get(k).push(it) }
    return workItems.items.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
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

  if (!workItems) return <Card bodyClass="p-5" aria-busy="true"><SkeletonList rows={3} /></Card>
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return <Card title="品質查驗"><Empty>此專案的標單尚未匯入資料庫。請先到「專案文件」一次上傳標單 XML。</Empty></Card>
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
    if (error) { setErrMsg(`查驗申請未送出:${error.message}`); return }
    setInspForm(null)
  }
  // 三級品管一級交二級的正流程:自主檢查合格 → 提查驗申請並檢附該紀錄。
  // 只預填表單(工項/項目/位置/檢附/申請日),送出仍由人按——與檢附 select 的
  // 候選規則一致(現行版+已判定),所以預填的 id 一定會出現在下拉裡。
  const requestInspectionFromChecklist = (r, tplTitle, wi) => {
    setSegment('查驗')
    setInspForm({
      title: tplTitle || '', location: r.location || '',
      inspection_type: '施工查驗', requested_date: todayIso(),
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
    if (error) { setErrMsg(`查驗判定未寫入：${error.message}`); return }
    // 判定已寫入但自動開缺失失敗:不能亮「已開立缺失」的綠訊息騙人——
    // 走既有 ErrorBanner 如實提示手動補開(同檢查表 defectError 的處理慣例)
    if (defectError) {
      setErrMsg(`查驗判定已記錄，但缺失開立失敗：${defectError.message}。請至「缺失」分段手動補開缺失。`)
      return
    }
    setResultMsg({ pass })
  }
  // 逐狀態計數一次算完:卡片標題、篩選 chips 與分段徽章共用同一份口徑,
  // 免得「待查驗 N」在三處各自 filter 一遍還可能漂移
  const inspCount = { 全部: inspections.length, 待查驗: 0, 合格: 0, 不合格: 0 }
  // hasOwn 而非 in:狀態值來自 DB,不該讓 'constructor' 這種原型鍵意外命中計數器
  for (const i of inspections) if (Object.hasOwn(inspCount, i.status)) inspCount[i.status] += 1
  const openInsp = inspCount['待查驗']
  const shownInsp = inspFilter === '全部' ? inspections : inspections.filter((i) => i.status === inspFilter)

  // 「今天」每次 render 取(B-11:工地平板整週不關分頁,模組層常數會停在開頁那天)。
  // 傳日曆日字串給期限引擎:含時間的「現在」會把 8 個日曆日壓成 7(W8-2 踩過的坑)。
  const today = todayIso()
  const myOrg = currentUser?.org_type || 'contractor'
  const queue = buildQualityQueue(myOrg, { inspections, defects, observations, testSamples }, today)
  // 分段計數:各分段「還有幾件事沒完」,與區塊內既有的計數口徑一致
  const openDefects = defects.filter((d) => (d.domain || 'quality') === 'quality' && d.status !== '已結案').length
  const openObs = observations.filter((o) => o.status === '待處理').length
  const segCount = { 查驗: openInsp, 缺失: openDefects, 觀察: openObs, 檢查表: null, 試驗: sampleAlerts(testSamples, today).length }

  return (
    <div className="space-y-5">
      <div>
        <PageHeader title="品質查驗" tagline="三級品管" subtitle="查驗、缺失、觀察、檢查表與試驗——先看「現在要處理」，再進分段完成" />
      </div>

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      {/* 工作佇列:輪到登入角色處理的品質事項,點一筆切到對應分段(不捲頁) */}
      <Card title="現在要處理">
        {queue.length === 0 ? <Empty>目前沒有輪到你處理的品質事項</Empty> : (
          <div className="space-y-1">
            {queue.slice(0, QUALITY_QUEUE_LIMIT).map((q) => (
              // 整列可點的鈕,手機補到 44px 不會破版(class 刻意仍不含 justify-between:
              // contractor/supervisor spec 用 justify-between 祖先鎖缺失/查驗列)
              <button key={q.key} onClick={() => setSegment(q.segment)}
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
          <button key={s} onClick={() => setSegment(s)} aria-pressed={segment === s}
            className={`${CHIP_BASE} ${segment === s ? CHIP_ON : CHIP_OFF} min-h-11 gap-1`}>
            {s}
            {segCount[s] > 0 && <span className="num opacity-80">{segCount[s]}</span>}
          </button>
        ))}
      </div>

      {/* 查驗:標題同時給「全部」與「待查驗」——這張卡不只是待辦盒,也是本案的查驗履歷 */}
      {segment === '查驗' && (
      <Card title={`查驗（全部 ${inspCount['全部']}・待查驗 ${openInsp}）`} action={can.submit && <Button variant="secondary" onClick={() => setInspForm(inspForm ? null : { title: '', location: '', inspection_type: '施工查驗', requested_date: todayIso(), work_item_key: '', work_item_label: '', checklist_record_id: '' })}>{inspForm ? '取消' : <><MSym name="add" size={16} />查驗申請</>}</Button>}>
        {resultMsg && (
          <div className="flex items-center gap-3 flex-wrap rounded-lg bg-[var(--green-tint)] text-[var(--green-text)] text-sm px-3 py-2 mb-3">
            <span>{resultMsg.pass ? '已判定合格' : '已判定不合格並開立缺失'}</span>
            {!resultMsg.pass && (
              <button onClick={() => setSegment('缺失')} className="font-medium underline hover:opacity-80">查看缺失</button>
            )}
          </div>
        )}
        {inspForm && (
          <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
            {/* 換工項連同清掉已選檢附:候選是「同工項」口徑,留著舊選擇會掛到不相干的表 */}
            <WorkItemPicker leaves={leaves} value={inspForm.work_item_key} label={inspForm.work_item_label} onPick={(k, l) => setInspForm((f) => ({ ...f, work_item_key: k || '', work_item_label: l, checklist_record_id: '' }))} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="查驗項目"><Input value={inspForm.title} onChange={(e) => setInspForm((f) => ({ ...f, title: e.target.value }))} placeholder="如 混凝土澆置前查驗" /></Field>
              <Field label="位置"><Input value={inspForm.location} onChange={(e) => setInspForm((f) => ({ ...f, location: e.target.value }))} placeholder="如 A 區 1F" /></Field>
              <Field label="類型"><Select value={inspForm.inspection_type} onChange={(e) => setInspForm((f) => ({ ...f, inspection_type: e.target.value }))}><option>施工查驗</option><option>材料查驗</option><option>隱蔽查驗</option></Select></Field>
              {/* 預設今天:全站慣例是「事件已發生的記錄日預設今天」(檢查表/取樣皆同),
                  申請查驗這件事就是按下去的當天發生,空白只會讓現場忘了填 */}
              <Field label="申請查驗日（必填）"><Input type="date" value={inspForm.requested_date} onChange={(e) => setInspForm((f) => ({ ...f, requested_date: e.target.value }))} /></Field>
              {/* 檢附自主檢查表(S-2):正式查驗單本來就要附第一級自主檢查證據——
                  選填不擋送出,但監造一眼看得出第一級做了沒。只列已判定的現行版,
                  「僅限已判定」是 UI 收斂(DB 只驗 FK 存在)。 */}
              <Field label="檢附自主檢查表（選填）">
                <Select value={inspForm.checklist_record_id || ''}
                  onChange={(e) => setInspForm((f) => ({ ...f, checklist_record_id: e.target.value }))}>
                  {attachableChecklists.length === 0 ? (
                    <option value="" disabled>此工項尚無已判定的自主檢查紀錄</option>
                  ) : (<>
                    <option value="">不檢附</option>
                    {attachableChecklists.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.check_date} {checklistTemplates.find((t) => t.id === r.template_id)?.title || '自主檢查表'}{r.rev ? ` Rev.${r.rev}` : ''}{r.location ? `（${r.location}）` : ''} — {r.overall}
                      </option>
                    ))}
                  </>)}
                </Select>
              </Field>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button onClick={submitInsp} disabled={busy || !inspForm.title || !inspForm.requested_date}>送出查驗申請</Button>
              {!inspForm.requested_date && <span className="text-xs text-[var(--text-3)]">請先填寫申請查驗日</span>}
            </div>
          </div>
        )}
        {/* 狀態篩選:判定後的紀錄一直都留在這張清單,但純時間序回答不了
            「擋土牆合格了沒」。flex-wrap 是 375px 的保命符,四個 chip 一行放不下要能換行。
            資料篩選一律 ui.jsx FilterChip(rounded-full 舊 chip 退場;aria-pressed 由元件內建) */}
        {inspections.length > 0 && (
          <div role="group" aria-label="查驗狀態篩選" className="flex flex-wrap gap-1.5 mb-3">
            {INSP_FILTERS.map((f) => (
              <FilterChip key={f} active={inspFilter === f} onToggle={() => setInspFilter(f)}
                label={<span className="inline-flex items-center gap-1">{f}<span className="num opacity-80">{inspCount[f]}</span></span>} />
            ))}
          </div>
        )}
        {inspections.length === 0 ? <Empty>尚無查驗紀錄</Empty> : shownInsp.length === 0 ? (
          <Empty>沒有「{inspFilter}」的查驗紀錄</Empty>
        ) : (
          <div className="space-y-2">
            {shownInsp.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 border-b border-[var(--border-2)] pb-2 text-sm">
                <div className="min-w-0">
                  <div className="text-[var(--text)]">{i.title} <Badge color={inspColor[i.status] || 'slate'}>{i.status}</Badge>
                    {/* 附自主檢查表 chip:點開既有列印檢視(成本最低的下鑽——檢查紀錄
                        本來就以列印頁為完整檢視,查驗列不再自建展開) */}
                    {i.checklist_record_id && (
                      <Button variant="secondary" size="sm" className="ml-1.5 align-middle"
                        onClick={() => navigate(`/quality/checklist-print?id=${i.checklist_record_id}`)}
                        title="檢視檢附的自主檢查表">附自主檢查表</Button>
                    )}
                  </div>
                  {/* result_note(不合格原因)排在字串最後最先被切,而這一列沒有詳情頁可下鑽 → 補 title */}
                <div className="text-xs text-[var(--text-3)] truncate"
                  title={[i.work_item_no, i.location, i.inspection_type, i.requested_date, i.result_note].filter(Boolean).join(' · ')}>{i.work_item_no && `${i.work_item_no} `}{i.location} · {i.inspection_type} · {i.requested_date || ''}{i.result_note ? ` · ${i.result_note}` : ''}</div>
                </div>
                <div className="flex gap-2 shrink-0 items-center">
                  {i.status === '待查驗' && (can.approve ? <>
                    <Button variant="success" onClick={() => onResult(i, true)} disabled={busy}>合格</Button>
                    <Button variant="danger" onClick={() => onResult(i, false)} disabled={busy}>不合格</Button>
                  </> : <span className="text-xs text-[var(--text-3)]">待監造查驗</span>)}
                  {/* 已判定查驗=品質證據,不提供刪除(DB 另有 guard) */}
                  {can.edit && i.status === '待查驗' && <button onClick={async () => { if (await appConfirm({ title: '刪除此查驗紀錄？', danger: true, confirmLabel: '刪除' })) { setErrMsg(''); const { error } = await deleteInspection(i.id); if (error) setErrMsg(`刪除失敗：${error.message}`) } }} className="text-[var(--text-3)] hover:text-[var(--red-text)] p-2 -m-2" aria-label={`刪除查驗 ${i.title}`}><MSym name="close" size={16} /></button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      )}

      {/* 缺失:統一缺失引擎(與工安缺失同狀態機),此處只列品質 domain */}
      {segment === '缺失' && <DefectTracker domain="quality" leaves={leaves} />}

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

// 判定章:○ 合格 / ✕ 不合格 / — 未檢
function PassMark({ pass }) {
  if (pass === true) return <span className="text-[var(--green-text)] font-semibold">○</span>
  if (pass === false) return <span className="text-[var(--red-text)] font-semibold">✕</span>
  return <span className="text-[var(--text-3)]">—</span>
}

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// 修訂差異的值顯示:✓/✗(bool)、數值、—(未檢)
const fmtVal = (v) => (v === true ? '✓' : v === false ? '✗' : v ?? '—')

// ── 自主檢查表:選範本 → 填實測值 → 依量化標準自動判定 → 不合格自動開缺失。
// 存檔後為證據不可就地修改:更正一律建立修訂版次 Rev.N(必附原因),重新判定
// 並連動缺失(同鏈不重複開);僅未判定的紀錄可刪除。
function ChecklistSection({ templates, records, onCreate, onDelete, canEdit, leaves = [], inspections = [], onRequestInspection = null }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [revising, setRevising] = useState(null) // 修訂模式:被修訂的紀錄(現行版)
  const [reason, setReason] = useState('')
  const [tplId, setTplId] = useState(templates[0]?.id)
  const [date, setDate] = useState(todayIso())
  const [location, setLocation] = useState('')
  const [wiKey, setWiKey] = useState('') // 對應工項(選填,佐證鏈:估驗佐證欄靠它對回檢查表)
  const [wiLabel, setWiLabel] = useState('')
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)
  // 訊息 tone 由呼叫端決定(success/warn/error),不再用字串比對「不合格/拒絕」推斷顏色——
  // 判定不合格是合法結果走 amber,寫入失敗才是 red(五語意色票,不用 --accent)
  const [msg, setMsgRaw] = useState(null) // { text, tone } | null
  const setMsg = (text, tone = 'success') => setMsgRaw(text ? { text, tone } : null)
  const [historyOf, setHistoryOf] = useState(null) // 展開歷次版本的鏈根 id

  // 紀錄 → 末端工項:demo 存 work_item_key、真 DB 存 work_item_id(uuid),一張表查兩種鍵
  const leafByRef = useMemo(() => {
    const m = new Map()
    for (const l of leaves) { m.set(l.item_key, l); if (l.id) m.set(l.id, l) }
    return m
  }, [leaves])
  const wiOf = (r) => leafByRef.get(r.work_item_key) || leafByRef.get(r.work_item_id)

  const template = revising
    ? templates.find((t) => t.id === revising.template_id)
    : (templates.find((t) => t.id === tplId) || templates[0])
  const live = useMemo(() => (template ? judgeChecklist(template, values) : null), [template, values])

  // 修訂鏈:依 root_id 分組,rev 最大者為現行版,其餘為歷次版本
  const chains = useMemo(() => {
    const byRoot = new Map()
    for (const r of records) {
      const root = r.root_id || r.id
      if (!byRoot.has(root)) byRoot.set(root, [])
      byRoot.get(root).push(r)
    }
    return [...byRoot.values()]
      .map((revs) => {
        revs.sort((a, b) => (b.rev || 0) - (a.rev || 0))
        return { current: revs[0], history: revs.slice(1) }
      })
      .sort((a, b) => (b.current.check_date || '').localeCompare(a.current.check_date || ''))
  }, [records])

  // 反向標記:這條修訂鏈的任一版被哪張查驗檢附(查驗刻意留在舊版=證據不可變,
  // 所以要整鏈查,不能只看現行版 id)。有檢附就不再給「提出查驗申請」,避免重複送。
  const attachedInspByRecordId = useMemo(() => {
    const m = new Map()
    for (const i of inspections) if (i.checklist_record_id) m.set(i.checklist_record_id, i)
    return m
  }, [inspections])
  const attachedInspOfChain = (current, history) =>
    [current, ...history].map((rev) => attachedInspByRecordId.get(rev.id)).find(Boolean) || null

  const setVal = (no, v) => setValues((p) => ({ ...p, [no]: v }))
  const closeForm = () => { setOpen(false); setRevising(null); setValues({}); setReason(''); setWiKey(''); setWiLabel('') }
  const startRevise = (r) => {
    setMsg(''); setRevising(r); setOpen(true); setReason('')
    setDate(r.check_date || todayIso()); setLocation(r.location || '')
    const wi = wiOf(r) // 修訂帶入原紀錄的工項關聯,可改可清
    setWiKey(wi?.item_key || ''); setWiLabel(wi ? `${wi.item_no} ${wi.description}` : '')
    setValues(Object.fromEntries(
      Object.entries(r.results || {}).filter(([, v]) => v?.value != null).map(([no, v]) => [no, v.value])))
  }
  const save = async () => {
    setSaving(true); setMsg('')
    const res = await onCreate({
      template, check_date: date, location, values,
      work_item_key: wiKey || undefined,
      revises: revising || undefined, revision_reason: revising ? reason.trim() : undefined,
    })
    setSaving(false)
    if (res.error) { setMsg(res.error.message || '存檔失敗', 'error'); return }
    const revTag = res.rev ? `Rev.${res.rev}：` : ''
    if (res.defectAction === 'created') setMsg(`已存檔 ${revTag}判定不合格，系統已自動開立缺失。`, 'warn')
    else if (res.defectAction === 'linked') setMsg(`已存檔 ${revTag}判定不合格；此檢查表已有未結案缺失，未重複開立。`, 'warn')
    else if (res.defectError) setMsg(`已存檔 ${revTag}判定不合格，但缺失開立失敗：${res.defectError.message}`, 'error')
    else if (res.overall === '合格' && res.openDefectRemains) setMsg(`已存檔 ${revTag}更正後判定合格。原自動開立的缺失仍在追蹤中，請至缺失區確認後續處理。`)
    else setMsg(`已存檔 ${revTag}判定${res.overall || '未完成'} ✓`, res.overall === '不合格' ? 'warn' : 'success')
    closeForm()
  }
  const del = async (r) => {
    if (!(await appConfirm({ title: '刪除此檢查紀錄？', body: '僅未判定的紀錄可刪除；已判定的證據請以「修訂」更正。', danger: true, confirmLabel: '刪除' }))) return
    const res = await onDelete(r.id)
    if (res?.error) setMsg(res.error.message, 'error')
  }

  let lastGroup = null
  return (
    <Card title={`自主檢查表（${chains.length}）`} action={
      canEdit && <Button variant="secondary" onClick={() => { if (open) closeForm(); else setOpen(true); setMsg('') }}>{open ? '取消' : <><MSym name="add" size={16} />新增檢查</>}</Button>
    }>
      {msg && <p className={`text-sm mb-3 ${msg.tone === 'error' ? 'text-[var(--red-text)]' : msg.tone === 'warn' ? 'text-[var(--amber-text)]' : 'text-[var(--green-text)]'}`}>{msg.text}</p>}

      {open && template && (
        <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
          {revising && (
            <p className="text-sm font-medium text-[var(--text)]">
              修訂 Rev.{(revising.rev || 0) + 1} — 原版{revising.rev ? ` Rev.${revising.rev}` : ''}（{revising.check_date} 判定{revising.overall || '未判定'}）不會被覆寫，將以新版次留存差異。
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="檢查表範本">
              {revising ? (
                <span className="text-sm px-2.5 py-1.5 inline-block">{template.title}</span>
              ) : (
                <Select value={tplId} onChange={(e) => { setTplId(e.target.value); setValues({}) }}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </Select>
              )}
            </Field>
            <Field label="檢查日期"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="檢查位置"><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="如 4F 版牆" className="!w-36" /></Field>
            <div className="w-72"><Field label="對應工項（選填）">
              <WorkItemPicker leaves={leaves} value={wiKey} label={wiLabel}
                onPick={(k, l) => { setWiKey(k || ''); setWiLabel(l) }} />
            </Field></div>
            {revising && (
              <Field label="更正原因（必填）">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如 坍度登載錯誤，依取樣紀錄更正"
                  className="!w-72" />
              </Field>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-3)]">依據：{template.source}。填實測值即時判定；未填的項目視為未檢，不列入判定。</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                {/* th 字型層走 THEAD_CLS 單一真相(掛在 tr 由 th 繼承),對齊/內距各表自決 */}
                <tr className={`${THEAD_CLS} border-b border-[var(--border)]`}>
                  <th className="text-left py-1.5 w-14">項次</th>
                  <th className="text-left">檢查項目</th>
                  <th className="text-left px-2">檢查標準</th>
                  <th className="text-right px-2 w-36">實測值</th>
                  <th className="text-center w-12">判定</th>
                </tr>
              </thead>
              <tbody>
                {template.items.map((it) => {
                  const groupRow = it.group !== lastGroup
                  lastGroup = it.group
                  return [
                    groupRow && (
                      <tr key={`g-${it.group}`}><td colSpan={5} className="pt-2 pb-1 text-[11px] font-semibold tracking-[0.08em] text-[var(--text-3)]">{it.group}</td></tr>
                    ),
                    <tr key={it.no} className="border-b border-[var(--border-2)]">
                      <td className="py-1.5 text-xs text-[var(--text-3)] num">{it.no}</td>
                      <td className="py-1.5 pr-2">{it.item}</td>
                      <td className="py-1.5 px-2 text-xs text-[var(--text-2)]">{it.standard}</td>
                      <td className="py-1.5 px-2 text-right">
                        {it.kind === 'bool' ? (
                          // 20px:原生 checkbox 預設 13px,和同列 text-sm 一樣高所以不撐列
                          <input type="checkbox" className="w-5 h-5" checked={values[it.no] === true}
                            onChange={(e) => setVal(it.no, e.target.checked)} />
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {/* 表格內輸入只提到 ~38px(max-sm:py-2),不加 min-h——加了整張檢查表列高會翻倍 */}
                            <input type="number" step="any" inputMode="decimal" value={values[it.no] ?? ''}
                              onChange={(e) => setVal(it.no, e.target.value === '' ? '' : Number(e.target.value))}
                              className="w-24 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-sm tabular-nums bg-[var(--surface)] max-sm:py-2" />
                            <span className="text-[10px] text-[var(--text-3)] w-10">{it.unit || ''}</span>
                          </span>
                        )}
                      </td>
                      <td className="text-center"><PassMark pass={judgeItem(it, values[it.no])} /></td>
                    </tr>,
                  ]
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            {/* busy prop:送出中禁用+旋轉圖示由 Button 統一,不再用文字切換載入態 */}
            <Button onClick={save} busy={saving} disabled={revising && !reason.trim()}>{revising ? `存檔為 Rev.${(revising.rev || 0) + 1} 並重新判定` : '存檔並判定'}</Button>
            {revising && !reason.trim() && <span className="text-xs text-[var(--text-3)]">請先填寫更正原因</span>}
            {live?.overall && (
              <Badge color={live.overall === '合格' ? 'green' : 'red'}>目前判定：{live.overall}{live.failed.length ? `（${live.failed.length} 項不合格）` : ''}</Badge>
            )}
          </div>
        </div>
      )}

      {chains.length === 0 ? <Empty>尚無自主檢查紀錄。選範本填實測值，系統依量化標準自動判定。</Empty> : (
        <div className="space-y-1.5">
          {chains.map(({ current: r, history }) => {
            const tpl = templates.find((t) => t.id === r.template_id)
            const rootId = r.root_id || r.id
            const prev = history.find((h) => h.id === r.supersedes_id)
            const diffs = (r.rev || 0) > 0 && tpl && prev ? diffChecklistResults(tpl, prev.results, r.results) : []
            const attachedInsp = attachedInspOfChain(r, history)
            return (
              <div key={rootId} className="border-b border-[var(--border-2)] pb-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="num text-[var(--text-3)] text-xs mr-2">{r.check_date}</span>
                    <span className="text-[var(--text)]">{tpl?.title || '（範本已刪除）'}</span>
                    {(r.rev || 0) > 0 && <Badge color="blue">Rev.{r.rev}</Badge>}
                    {r.location && <span className="text-xs text-[var(--text-3)] ml-2">{r.location}</span>}
                    {wiOf(r) && <span className="text-xs text-[var(--text-3)] ml-2" title={wiOf(r).description}>工項 {wiOf(r).item_no}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge color={r.overall === '合格' ? 'green' : r.overall === '不合格' ? 'red' : 'slate'}>{r.overall || '未判定'}</Badge>
                    {attachedInsp && (
                      <span title={`已檢附於查驗:${attachedInsp.title}`}><Badge color="slate">已附查驗</Badge></span>
                    )}
                    {/* 一級交二級:自檢合格才有資格提查驗;已檢附過就不再給(避免重複送)。
                        列動作=第三級文字鈕:一律 --blue-text(--blue 只作底色/邊框)+手機 44px */}
                    {onRequestInspection && r.overall === '合格' && !attachedInsp && (
                      <button onClick={() => onRequestInspection(r, tpl?.title || '', wiOf(r))}
                        title="以此檢查紀錄為附件,預填查驗申請(送出前可改)"
                        className="text-[var(--blue-text)] hover:underline text-xs whitespace-nowrap inline-flex items-center max-md:min-h-11">提出查驗申請</button>
                    )}
                    <button onClick={() => navigate(`/quality/checklist-print?id=${r.id}`)} title="列印自主檢查表"
                      className="text-[var(--blue-text)] hover:underline text-xs inline-flex items-center gap-1 max-md:min-h-11"><MSym name="print" size={13} />列印</button>
                    {canEdit && tpl && (
                      <button onClick={() => startRevise(r)} title="以修訂版次更正（不覆寫舊證據）"
                        className="text-[var(--blue-text)] hover:underline text-xs inline-flex items-center max-md:min-h-11">修訂</button>
                    )}
                    {history.length > 0 && (
                      <button onClick={() => setHistoryOf(historyOf === rootId ? null : rootId)}
                        className="text-[var(--blue-text)] hover:underline text-xs inline-flex items-center max-md:min-h-11">歷次 {history.length}</button>
                    )}
                    {canEdit && !r.overall && (
                      <button onClick={() => del(r)} aria-label="刪除未判定的檢查紀錄" className="text-[var(--text-3)] hover:text-[var(--red-text)] p-2 -m-2"><MSym name="close" size={16} /></button>
                    )}
                  </div>
                </div>
                {(r.rev || 0) > 0 && r.revision_reason && (
                  <div className="text-[11px] text-[var(--text-3)] mt-0.5">
                    更正原因：{r.revision_reason}
                    {diffs.length > 0 && <span className="ml-2">異動：{diffs.map((d) => `${d.no} ${fmtVal(d.from)}→${fmtVal(d.to)}`).join('、')}</span>}
                  </div>
                )}
                {historyOf === rootId && history.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 text-xs text-[var(--text-3)] mt-1 pl-4">
                    <span>Rev.{h.rev || 0}</span>
                    <span className="num">{h.check_date}</span>
                    <Badge color="slate">{h.overall || '未判定'}</Badge>
                    <span>已由新版取代</span>
                    {/* 更正原因是稽核性說明,這一列沒有下鑽入口 → 至少要能 hover 看全文 */}
                    {(h.rev || 0) > 0 && h.revision_reason && <span className="truncate" title={h.revision_reason}>（{h.revision_reason}）</span>}
                    <button onClick={() => navigate(`/quality/checklist-print?id=${h.id}`)}
                      className="text-[var(--blue-text)] hover:underline shrink-0">列印</button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
      <p className="text-[11px] text-[var(--text-3)] mt-2">檢查表存檔後即為品質證據，不可就地修改：更正一律以「修訂」建立 Rev.N 留存差異與原因，並重新自動判定；改判不合格會自動開立缺失（同一張表已有未結案缺失時不重複開）。僅未判定的紀錄可刪除。</p>
    </Card>
  )
}

// ── 取樣試驗:澆置日誌 → 試體組 → 7/28 天齡期 → 抗壓值自動判定 ──
function SamplesSection({ samples, onGenerate, onCreate, onUpdate, onDelete, canEdit }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [manual, setManual] = useState({ sampled_date: todayIso(), fc: 420, location: '' })
  const [addOpen, setAddOpen] = useState(false)
  const today = todayIso()

  const gen = async () => {
    setBusy(true); setMsg('')
    const { error, count } = await onGenerate()
    setBusy(false)
    setMsg(error ? (error.message || '帶入失敗') : count ? `已由施工日誌帶入 ${count} 組取樣。` : '施工日誌沒有尚未建檔的澆置紀錄。')
  }
  const addManual = async () => {
    if (!manual.sampled_date) return
    setBusy(true)
    await onCreate([manual])
    setBusy(false); setAddOpen(false)
  }
  const dueCell = (due, filled) => {
    if (!due) return null
    const overdue = !filled && due < today
    // 逾期=五語意的 red(全站 Dashboard/Alerts 同語意);--accent 不再當警示色
    return <span className={`num text-xs ${overdue ? 'text-[var(--red-text)] font-semibold' : 'text-[var(--text-3)]'}`}>{due}{overdue ? ' 逾期' : ''}</span>
  }

  return (
    <Card title={`取樣試驗（${samples.length}）`} action={
      canEdit && <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={gen} disabled={busy}><MSym name="bolt" size={14} />從施工日誌帶入</Button>
        <Button variant="secondary" onClick={() => setAddOpen((o) => !o)}>{addOpen ? '取消' : <><MSym name="add" size={16} />手動新增</>}</Button>
      </div>
    }>
      {msg && <p className="text-sm mb-3 text-[var(--text-2)]">{msg}</p>}
      {addOpen && (
        <div className="bg-[var(--surface-2)] rounded-lg p-3 mb-4 flex flex-wrap items-end gap-3">
          <Field label="取樣(澆置)日"><Input type="date" value={manual.sampled_date} onChange={(e) => setManual({ ...manual, sampled_date: e.target.value })} /></Field>
          <Field label="fc′ (kgf/cm²)"><Input type="number" inputMode="decimal" value={manual.fc} onChange={(e) => setManual({ ...manual, fc: Number(e.target.value) || null })} className="!w-28 text-right num" /></Field>
          <Field label="位置"><Input value={manual.location} onChange={(e) => setManual({ ...manual, location: e.target.value })} className="!w-36" /></Field>
          <Button onClick={addManual} disabled={busy}>建立試體組</Button>
        </div>
      )}

      {samples.length === 0 ? (
        <Empty>尚無試體。按「從施工日誌帶入」，凡日誌材料含混凝土的澆置日會自動建檔並排 7 / 28 天試驗到期日。</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              {/* th 字型層走 THEAD_CLS 單一真相(掛在 tr 由 th 繼承),對齊/內距各表自決 */}
              <tr className={`${THEAD_CLS} border-b border-[var(--border)]`}>
                <th className="text-left py-1.5">試體編號</th>
                <th className="text-left px-2">取樣日</th>
                <th className="text-right px-2">fc′</th>
                <th className="text-right px-2">7天(參考)</th>
                <th className="text-right px-2">28天各試體 kgf/cm²</th>
                <th className="text-center px-2">判定</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => (
                <tr key={s.id} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
                  <td className="py-1.5 num text-xs">{s.sample_no}<div className="text-[10px] text-[var(--text-3)]">{s.location}</div></td>
                  <td className="px-2 num text-xs text-[var(--text-2)]">{s.sampled_date}</td>
                  <td className="px-2 text-right num whitespace-nowrap">{s.fc || '—'}</td>
                  <td className="px-2 text-right">
                    {/* 表格內輸入:只加 max-sm:py-2(~38px),不加 min-h 以免試體表列高翻倍 */}
                    <input type="number" step="any" inputMode="decimal" defaultValue={s.d7_value ?? ''} placeholder="值"
                      aria-label={`${s.sample_no} 7天參考值`}
                      onBlur={async (e) => { const n = parseFloat(e.target.value); if (!isNaN(n) && n !== s.d7_value) { const { error } = await onUpdate(s.id, { d7_value: n }); if (error) setMsg(`未寫入：${error.message}`) } }}
                      className="w-16 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums max-sm:py-2" />
                    <div>{dueCell(s.d7_due, s.d7_value != null)}</div>
                  </td>
                  <td className="px-2 text-right">
                    <input defaultValue={(s.d28_values || []).join(', ')} placeholder="如 445, 432, 428"
                      aria-label={`${s.sample_no} 28天各試體值`}
                      onBlur={async (e) => {
                        const arr = e.target.value.split(/[,、\s]+/).map(Number).filter((n) => !isNaN(n) && n > 0)
                        if (JSON.stringify(arr) !== JSON.stringify(s.d28_values || [])) {
                          const { error } = await onUpdate(s.id, { d28_values: arr.length ? arr : null })
                          if (error) setMsg(`試驗值未寫入：${error.message}`)
                        }
                      }}
                      className="w-36 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums max-sm:py-2" />
                    <div>{dueCell(s.d28_due, (s.d28_values || []).length > 0)}</div>
                  </td>
                  <td className="px-2 text-center">
                    <Badge color={s.status === '合格' ? 'green' : s.status === '不合格' ? 'red' : 'slate'}>{s.status}</Badge>
                  </td>
                  {/* 已判定試體=品質證據,不提供刪除(DB 另有 guard) */}
                  <td className="text-right pl-2">{s.status === '待試驗' && (
                    <button onClick={async () => { if (await appConfirm({ title: `刪除試體 ${s.sample_no}？`, danger: true, confirmLabel: '刪除' })) { const { error } = await onDelete(s.id); if (error) setMsg(`刪除失敗：${error.message}`) } }} className="text-[var(--text-3)] hover:text-[var(--red-text)] p-2 -m-2" aria-label={`刪除試體 ${s.sample_no}`}><MSym name="close" size={16} /></button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-[var(--text-3)] mt-2">28 天判定標準（03310）：任一試體 ≥ 0.85 fc′ 且平均 ≥ fc′；不合格自動開立缺失。到期未試驗會出現在提醒中心。</p>
    </Card>
  )
}

// ── 觀察事項:輕量現場提醒（比缺失輕）→ 標記已處理 或 升級為缺失 ──
const OBS_STATUS_COLOR = { 待處理: 'amber', 已處理: 'green', 轉缺失: 'slate' }
function ObservationsSection({ observations, canWrite, onCreate, onUpdate, onEscalate, onDelete, resolveMarkup }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [markupOpen, setMarkupOpen] = useState(false)

  // 寫入失敗如實回報(B-07):失敗時表單不關、清單不動
  const run = async (label, fn) => {
    setErr(''); setBusy(true)
    const { error } = (await fn()) || {}
    setBusy(false)
    if (error) { setErr(`${label}失敗:${error.message}`); return false }
    return true
  }
  const submit = async () => { if (await run('新增觀察', () => onCreate(form))) setForm(null) }
  const open = observations.filter((o) => o.status === '待處理').length

  return (
    <Card title={`觀察事項（待處理 ${open}）`} action={
      canWrite && <Button variant="secondary" onClick={() => setForm(form ? null : { title: '', description: '', location: '', assigned_to: 'contractor' })}>{form ? '取消' : <><MSym name="add" size={16} />新增觀察</>}</Button>
    }>
      {form && (
        <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="觀察主旨"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 4F 東側樓梯開口未設護欄" /></Field>
            <Field label="位置"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="如 4F 東側" /></Field>
          </div>
          <Field label="說明"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="現場觀察到、提醒改善的事項（尚未到開立缺失的程度）" /></Field>
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={submit} disabled={busy || !form.title}>新增觀察</Button>
            <Button variant="secondary" onClick={() => setMarkupOpen(true)}><MSym name="draw" size={16} />圖面/照片標註{form.markup_data ? '（已附）' : ''}</Button>
            {form.markup_data && <MarkupThumb src={form.markup_data} />}
          </div>
          {markupOpen && <MarkupEditor title="把觀察位置匡起來" initialImage={form.markup_data}
            onSave={(d) => { setForm((f) => ({ ...f, markup_data: d })); setMarkupOpen(false) }} onClose={() => setMarkupOpen(false)} />}
        </div>
      )}

      {/* 區塊層錯誤統一走 ErrorBanner,不再自寫紅字段落 */}
      <ErrorBanner msg={err} onClose={() => setErr('')} className="mb-2" />
      {observations.length === 0 ? <Empty>尚無觀察事項。現場看到「不對但還沒到缺失」的狀況先記為觀察，處理掉或必要時一鍵升級為缺失。</Empty> : (
        <div className="space-y-2">
          {observations.map((o) => (
            <div key={o.id} className="flex items-start justify-between gap-3 border-b border-[var(--border-2)] pb-2">
              <div className="min-w-0">
                <div className="text-sm text-[var(--text)]">{o.title} <Badge color={OBS_STATUS_COLOR[o.status] || 'slate'}>{o.status}</Badge></div>
                {/* description 是這筆觀察唯一的內容說明,無詳情頁 → 補 title 才看得到全文 */}
                <div className="text-xs text-[var(--text-3)] truncate" title={[o.location, o.description].filter(Boolean).join(' · ')}>{o.location}{o.description ? ` · ${o.description}` : ''}</div>
                {o.markup_path && <div className="mt-1"><MarkupThumb src={o.markup_path} resolve={resolveMarkup} /></div>}
              </div>
              {canWrite && o.status !== '轉缺失' && (
                <div className="flex items-center gap-2 shrink-0">
                  {o.status === '待處理' && <>
                    <Button variant="secondary" disabled={busy} onClick={() => run('標記已處理', () => onUpdate(o.id, { status: '已處理' }))}>標記已處理</Button>
                    <Button variant="outline" disabled={busy} onClick={async () => { if (await appConfirm({ title: '升級為正式缺失？', body: '將自動開立缺失單追蹤改善。', confirmLabel: '升級' })) run('升級為缺失', () => onEscalate(o)) }}>升級為缺失</Button>
                  </>}
                  <button disabled={busy} onClick={async () => { if (await appConfirm({ title: '刪除此觀察？', danger: true, confirmLabel: '刪除' })) run('刪除觀察', () => onDelete(o.id)) }} aria-label={`刪除觀察 ${o.title}`} className="text-[var(--text-3)] hover:text-[var(--red-text)] p-2 -m-2"><MSym name="close" size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-[var(--text-3)] mt-2">觀察事項是比缺失輕的提醒（現場口頭提醒的數位化）：可標記已處理，或在必要時一鍵升級為正式缺失單（進入改善→複查→結案流程）。</p>
    </Card>
  )
}
