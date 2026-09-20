// 查驗分段:清單＋狀態快篩＋搜尋,詳情欄承載判定入口(監造查驗表單:判定＋本次確認數量,簽署即判定;P6b-3 起
// 「合格／不合格」快速判定退場——判定一律有簽署的文件版本,資料庫也收回了直接改判定欄)、檢附的自主檢查表、
// 申報數量／階段與刪除。舊流程快速判定的紀錄照常列出(確認數量欄標「舊流程快速判定」)。
// 版面走共用殼 ListDetailLayout(規範 §8 IA 殼):詳情永遠在同一個位置,動作就地處理。
// 狀態刻意留在頁面——「提出查驗申請」從檢查表分段預填 inspForm 再切段,分段是非當前
// 不渲染(unmount)的,表單 state 住這裡會在切段瞬間消失;errMsg 也是頁層 ErrorBanner。
// 所以本元件只收 props,刪除/送出的邏輯全在頁面;搜尋字串是分段自己的,切段歸零可接受。
//
// 清單列是 role=listitem 的 button:supervisor/a11y spec 用 getByRole('listitem')
// .filter({ hasText }) 選中那一列,再到 getByRole('region', { name: '<標題> 詳情' })
// 開監造查驗表單——「現在要處理」佇列刻意維持 button 不當 listitem,否則會雙重命中(規範 §7)。
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MSym } from '../icons.jsx'
import { Card, Button, Field, Badge, Dot, Empty, IconButton, Input, Select } from '../ui.jsx'
import { ListDetailLayout, SearchField, StatusChip, MetaGrid } from '../listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { appConfirm } from '../confirm.jsx'
import { taipeiToday } from '../../lib/dates.js'
import { checklistCoverage, coverageText } from '../../lib/qc.js'
import { requiredStagesFor } from '../../lib/fieldDocs.js'
import { WorkItemPicker } from '../DefectTracker.jsx'

const inspColor = { 待查驗: 'amber', 合格: 'green', 部分合格: 'amber', 不合格: 'red' }

// 查驗清單的狀態篩選(S-4):判定後的紀錄本來就留在清單裡,但純時間序要回答
// 「擋土牆到底合格了沒」只能逐列掃。'全部' 是唯一非狀態值,其餘直接對 inspections.status。
// 快篩 chip 只列三個狀態(單選、再點取消=全部),'全部' 由「沒有任何 chip 亮」承載。
export const INSP_FILTERS = ['全部', '待查驗', '合格', '部分合格', '不合格']
const INSP_STATUSES = INSP_FILTERS.slice(1)

export const EMPTY_INSP_FORM = () => ({ title: '', location: '', inspection_type: '施工查驗', requested_date: taipeiToday(), work_item_key: '', work_item_label: '', checklist_record_id: '', declared_qty: '', stage_key: '' })

export default function InspectionsSection({
  inspections, inspCount, filter, onFilter,
  form, onFormChange, onSubmit, busy, notice = '', onCloseNotice = null,
  leaves, attachableChecklists, templates, can, onDelete, scope = '', signedDocByRecord = new Map(),
  inspectionPoints = [], formDocByInspection = new Map(),
}) {
  const navigate = useNavigate() // 詳情欄的「附自主檢查表」導向既有列印檢視;「監造查驗表單」導向文件頁
  // 申請表單所選工項的 ITP 必要階段(P3c):有 H 點的工項申請時就選階段,監造表單才對得上
  const formWi = form?.work_item_key ? leaves.find((l) => l.item_key === form.work_item_key) : null
  const formStages = useMemo(() => requiredStagesFor(inspectionPoints, formWi ? [formWi.id, formWi.item_key] : []), [inspectionPoints, formWi])
  const [q, setQ] = useState('')
  const searchRef = useRef(null)

  // 目前畫面上的清單:狀態 AND 關鍵字(項目/位置/工項/類型/判定說明)。順序沿用 store
  // (申請時序),不另外排序——這裡不該與佇列對同一批資料給出兩種順序。
  const ordered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return inspections
      .filter((i) => filter === '全部' || i.status === filter)
      .filter((i) => !kw || [i.title, i.location, i.work_item_no, i.work_item_desc, i.inspection_type, i.result_note]
        .some((v) => (v || '').toLowerCase().includes(kw)))
  }, [inspections, filter, q])
  const anyFilter = q.trim() !== '' || filter !== '全部'

  // 選取/深連結(?inspection=)/切案重置/初次自動選取:共用殼 hook。預設選第一筆
  // 「待查驗」(開頁就看到該判的事),沒有就選清單第一筆。
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'inspection', idPrefix: 'insp-', scope,
    ready: inspections.length > 0, rows: inspections,
    pickDefault: () => (ordered.find((i) => i.status === '待查驗') || ordered[0])?.id,
    onReset: () => { setQ(''); onFilter('全部') },
  })
  // 篩選後選中項被篩掉:右欄內容保留(與 /safety 同),清單中只是沒有高亮列
  const selected = inspections.find((i) => i.id === selectedId) || null
  // 鍵盤:↑/↓ 移動選取、/ 聚焦搜尋。申請表單開著就停用——焦點落在表單上按 ↓ 會換選取。
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'insp-', modalUp: !!form, searchRef })

  const onDeleteClick = async (i) => {
    if (!(await appConfirm({ title: '刪除此查驗紀錄？', danger: true, confirmLabel: '刪除' }))) return
    onDelete(i.id)
    closeDetail() // <lg 抽屜承載的正是這筆,刪掉後不留 detailOpen 殘值
  }

  // ── 詳情欄:狀態列 / 標題 / key-value / 檢附的自主檢查表 / 動作列。
  // region 以查驗項目命名:報讀器走地標直接聽到「4F 柱牆鋼筋查驗 詳情」,e2e 也用
  // 同一個名字確認詳情欄正在顯示哪一筆。動作條件:判定入口(監造查驗表單)=can.approve 且待查驗;
  // 刪除=can.edit 且待查驗(已判定查驗=品質證據,DB 另有 guard)。
  let detailBody = null
  if (selected) {
    const i = selected
    const judgeable = i.status === '待查驗' && can.approve
    const deletable = can.edit && i.status === '待查驗'
    const formDoc = formDocByInspection.get(i.id) || null
    // 舊流程快速判定(P6b-3 退場前)留下的紀錄:有判定卻沒有簽署文件、也沒有確認數量,
    // 因此估驗拿不到可請款的量。監造可就地建立監造查驗表單補判定與確認數量(P3g;
    // 與待查驗走同一支 create_inspection_form_draft,簽署後即為正式判定,舊紀錄照樣留著可查)。
    const legacyFixable = can.approve && i.status !== '待查驗' && !i.document_id && !formDoc
    const qtyText = i.declared_qty != null ? `${i.declared_qty} ${i.unit || ''}`.trim() : '—'
    detailBody = (
      <section aria-label={`${i.title} 詳情`}>
        <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <Badge color={inspColor[i.status] || 'slate'}>{i.status}</Badge>
          <Badge color="slate">{i.inspection_type || '施工查驗'}</Badge>
        </div>

        <div className="p-4">
          <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{i.title}</div>
          {/* 空值一律顯示 —:格子固定,眼睛掃同一位置就知道有沒有填 */}
          <MetaGrid className="mt-3.5" rows={[
            ['工項', i.work_item_no ? `${i.work_item_no} ${i.work_item_desc || ''}`.trim() : '—'],
            ['位置', i.location || '—'],
            ['申請日', i.requested_date || '—'],
            ['申報數量', qtyText],
            ['查驗階段', i.stage_key || '—'],
            ['判定日', i.inspected_at ? String(i.inspected_at).slice(0, 10) : '—'],
            ['本次確認數量', i.confirmed_qty != null ? `${i.confirmed_qty} ${i.unit || ''}`.trim() : (i.status === '待查驗' ? '—' : i.document_id ? '（未確認數量）' : '（舊流程快速判定，未填確認數量）')],
          ]} />
        </div>

        {/* 判定說明(不合格原因):改版前藏在列的 meta 字串最後、被 truncate 先切掉;
            這是監造判定的依據,詳情欄完整顯示、保留換行 */}
        {i.result_note && (
          <div className="px-4 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <MSym name="rate_review" size={15} className="text-[var(--text-3)]" />
              <span className="text-footnote font-medium text-[var(--text)]">判定說明</span>
            </div>
            <p className="text-body leading-[1.8] text-[var(--text)] whitespace-pre-line break-words">{i.result_note}</p>
          </div>
        )}

        {/* 檢附的自主檢查表(S-2):點開既有列印檢視(成本最低的下鑽——檢查紀錄本來
            就以列印頁為完整檢視,詳情欄不再自建展開) */}
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <MSym name="checklist" size={15} className="text-[var(--text-3)]" />
            <span className="text-footnote font-medium text-[var(--text)]">第一級自主檢查</span>
          </div>
          {i.checklist_record_id ? (() => {
            // 監造看到的摘要也要有覆蓋程度(W03):現行版紀錄在 attachableChecklists 找得到;舊版就只給連結。
            // 簽署文件(P3b)落下的紀錄下鑽到文件列印版(印簽署版本、雜湊與簽署者),直接登錄的走既有列印檢視
            const rec = attachableChecklists.find((r) => r.id === i.checklist_record_id)
            const cov = rec ? checklistCoverage(templates.find((t) => t.id === rec.template_id), rec.results) : null
            const signedDoc = signedDocByRecord.get(i.checklist_record_id)
            return (
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="secondary" size="sm" onClick={() => navigate(signedDoc ? `/self-check/print?doc=${encodeURIComponent(signedDoc.id)}` : `/quality/checklist-print?id=${i.checklist_record_id}`)}
                  title="檢視檢附的自主檢查表">附自主檢查表{signedDoc ? `（已簽署 v${signedDoc.current_version_no}）` : ''}</Button>
                {rec && <span className={`text-footnote ${cov.unchecked ? 'text-[var(--amber-text)]' : 'text-[var(--text-2)]'}`}>{rec.overall || '未判定'}（{coverageText(cov)}）</span>}
              </div>
            )
          })() : (
            <p className="text-footnote text-[var(--text-3)]">未檢附自主檢查表。</p>
          )}
        </div>

        {/* 監造查驗表單(P3c):判定＋本次確認數量的正式文件;已有活文件就直達,判定後也連得到。
            P3g 起,舊流程快速判定的紀錄也有入口:監造可補建表單更正判定並填確認數量 */}
        {(formDoc || judgeable || legacyFixable) && (
          <div className="px-4 pb-4 flex items-center gap-2 flex-wrap">
            <Button variant={judgeable ? 'primary' : 'secondary'} size="sm" onClick={() => navigate(formDoc ? `/inspection-form?doc=${encodeURIComponent(formDoc.id)}` : `/inspection-form?inspection=${encodeURIComponent(i.id)}`)}>
              <MSym name="task_alt" size={15} />{formDoc ? `監造查驗表單（版本 ${formDoc.current_version_no}）` : legacyFixable ? '以查驗表單更正判定（補確認數量）' : '以監造查驗表單判定（填確認數量）'}
            </Button>
            {judgeable && <span className="text-caption text-[var(--text-3)]">簽署即判定，確認數量成為廠商可估驗的依據。</span>}
            {legacyFixable && (
              <span className="text-caption text-[var(--text-3)] leading-relaxed">
                這筆是舊流程快速判定、沒有簽署文件也沒有確認數量，廠商因此估不到量。建立表單、判定並簽署後即為正式判定；舊紀錄保留可查。
              </span>
            )}
          </div>
        )}
        {/* 動作列:待監造查驗(非監造)/ 刪除(廠商)。監造的判定只有上方「以監造查驗表單判定」一條路
            (P6b-3:快速判定退場;不合格的缺失由 DB 在簽署交易內開立) */}
        {i.status === '待查驗' && (!judgeable || deletable) && (
          <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
            {!judgeable && <span className="text-footnote text-[var(--text-3)]">待監造查驗</span>}
            {deletable && (
              // p-2 -m-2 只擴命中區、視覺與列高不變;ml-auto 靠右與主動作拉開
              <IconButton name="close" label={`刪除查驗 ${i.title}`} onClick={() => onDeleteClick(i)} className="ml-auto -m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" />
            )}
          </div>
        )}
      </section>
    )
  }

  // ── 左欄卡頭下方:搜尋 + 三狀態快篩(件數走全體 inspCount,不受搜尋影響),兩條件 AND
  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="搜尋查驗項目、位置或工項…" aria-label="搜尋查驗紀錄" />
      <div role="group" aria-label="查驗狀態篩選" className="flex items-center gap-2 flex-wrap">
        {INSP_STATUSES.map((s) => (
          <StatusChip key={s} active={filter === s} count={inspCount[s]}
            onClick={() => onFilter(filter === s ? '全部' : s)}>
            <Dot color={inspColor[s]} />{s}
          </StatusChip>
        ))}
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(''); onFilter('全部') }}>清除篩選</Button>
        )}
      </div>
    </div>
  )

  // ── 清單列:只負責選取(動作全在詳情欄),兩行=標題＋狀態 / meta。
  const listRows = (
    <div role="list" aria-label="查驗紀錄" className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的查驗紀錄。<br />換一個狀態,或試試查驗項目、位置關鍵字。
        </div>
      ) : ordered.map((i) => {
        const active = i.id === selectedId
        return (
          <button key={i.id} type="button" role="listitem" id={`insp-${i.id}`}
            aria-current={active || undefined}
            onClick={() => select(i.id, { openPane: true })}
            className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer ${active
              ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
            <span className="flex items-center gap-2 flex-wrap">
              <span className="text-body text-[var(--text)] min-w-0 [text-wrap:pretty]">{i.title}</span>
              <Badge color={inspColor[i.status] || 'slate'}>{i.status}</Badge>
              {i.checklist_record_id && <Badge color="slate">附自檢表</Badge>}
            </span>
            <span className="block mt-0.5 num text-caption text-[var(--text-3)] truncate">
              {[i.work_item_no, i.location, i.inspection_type, i.requested_date, i.result_note].filter(Boolean).join(' · ')}
            </span>
          </button>
        )
      })}
    </div>
  )

  // 卡頭標題不再重複「待查驗 N」:三段件數都在快篩 chip 上,同一個數字不寫兩次
  const cardTitle = `查驗（${inspCount['全部']}）`
  const cardAction = can.submit && (
    <Button variant="secondary" onClick={() => onFormChange(form ? null : EMPTY_INSP_FORM())}>
      {form ? '取消' : <><MSym name="add" size={16} />查驗申請</>}
    </Button>
  )

  // 申請送出的回饋與申請表單住在清單卡頂端:所有視口都看得到(詳情欄在 <lg 是抽屜,可能已關)
  const cardTop = (<>
    {/* 查驗申請送出成功(廠商):已送出＋檢附了什麼＋等待監造;失敗走頁層 ErrorBanner、表單留著 */}
    {notice && (
      <div role="status" className="mx-5 mt-4 flex items-center gap-3 flex-wrap rounded-lg bg-[var(--green-tint)] text-[var(--green-text)] text-sm px-3 py-2">
        <span className="min-w-0">{notice}</span>
        {onCloseNotice && <button onClick={onCloseNotice} className="ml-auto font-medium underline hover:opacity-80 max-md:min-h-11">關閉</button>}
      </div>
    )}
    {form && (
      <div className="m-5 bg-[var(--surface-2)] rounded-lg p-4 space-y-3">
        {/* 換工項連同清掉已選檢附與階段:候選是「同工項」口徑,留著舊選擇會掛到不相干的表 */}
        <WorkItemPicker leaves={leaves} value={form.work_item_key} label={form.work_item_label} onPick={(k, l) => onFormChange((f) => ({ ...f, work_item_key: k || '', work_item_label: l, checklist_record_id: '', stage_key: '' }))} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="查驗項目"><Input value={form.title} onChange={(e) => onFormChange((f) => ({ ...f, title: e.target.value }))} placeholder="如 混凝土澆置前查驗" /></Field>
          <Field label="位置"><Input value={form.location} onChange={(e) => onFormChange((f) => ({ ...f, location: e.target.value }))} placeholder="如 A 區 1F" /></Field>
          <Field label="類型"><Select value={form.inspection_type} onChange={(e) => onFormChange((f) => ({ ...f, inspection_type: e.target.value }))}><option>施工查驗</option><option>材料查驗</option><option>隱蔽查驗</option></Select></Field>
          {/* 預設今天:全站慣例是「事件已發生的記錄日預設今天」(檢查表/取樣皆同),
              申請查驗這件事就是按下去的當天發生,空白只會讓現場忘了填 */}
          <Field label="申請查驗日（必填）"><Input type="date" value={form.requested_date} onChange={(e) => onFormChange((f) => ({ ...f, requested_date: e.target.value }))} /></Field>
          {/* 申報數量(P3c):本次申請查驗的施作量;監造查驗表單的確認數量以此為上限。單位取自工項 */}
          <Field label={`申報數量${formWi?.unit ? `（${formWi.unit}）` : ''}`}>
            <Input type="number" step="any" inputMode="decimal" min="0" value={form.declared_qty ?? ''} onChange={(e) => onFormChange((f) => ({ ...f, declared_qty: e.target.value }))} placeholder={formWi ? '本次申報的施作數量' : '先選工項'} disabled={!formWi} />
          </Field>
          {/* 查驗階段(P3c):工項在檢驗停留點設有 H 點必要階段時才出現;全部階段皆確認的量才可估驗 */}
          {formStages.length > 0 && (
            <Field label="查驗階段（此工項有必要階段）">
              <Select value={form.stage_key || ''} onChange={(e) => onFormChange((f) => ({ ...f, stage_key: e.target.value }))} aria-label="查驗階段">
                <option value="">請選擇階段…</option>
                {formStages.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          )}
          {/* 檢附自主檢查表(S-2):正式查驗單本來就要附第一級自主檢查證據——
              選填不擋送出,但監造一眼看得出第一級做了沒。只列已判定的現行版,
              「僅限已判定」是 UI 收斂(DB 只驗 FK 存在)。 */}
          <Field label="檢附自主檢查表（選填）">
            <Select value={form.checklist_record_id || ''}
              onChange={(e) => onFormChange((f) => ({ ...f, checklist_record_id: e.target.value }))}>
              {attachableChecklists.length === 0 ? (
                <option value="" disabled>此工項尚無已判定的自主檢查紀錄</option>
              ) : (<>
                <option value="">不檢附</option>
                {attachableChecklists.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.check_date} {templates.find((t) => t.id === r.template_id)?.title || '自主檢查表'}{r.rev ? ` Rev.${r.rev}` : ''}{r.location ? `（${r.location}）` : ''} — {r.overall}（{coverageText(checklistCoverage(templates.find((t) => t.id === r.template_id), r.results))}）{signedDocByRecord.has(r.id) ? `・已簽署文件 v${signedDocByRecord.get(r.id).current_version_no}` : ''}
                  </option>
                ))}
              </>)}
            </Select>
          </Field>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={onSubmit} disabled={busy || !form.title || !form.requested_date}>送出查驗申請</Button>
          {!form.requested_date && <span className="text-xs text-[var(--text-3)]">請先填寫申請查驗日</span>}
        </div>
      </div>
    )}
  </>)

  if (inspections.length === 0) {
    return (
      <Card title={cardTitle} bodyClass="p-0" action={cardAction}>
        {cardTop}
        <Empty>尚無查驗紀錄。廠商自主檢查合格後提出查驗申請,監造以查驗表單判定並簽署;不合格會自動開立缺失。</Empty>
      </Card>
    )
  }

  return (
    <ListDetailLayout
      detail={detailBody}
      detailLabel="查驗詳情"
      detailEmpty={<Empty>點左側清單查看查驗詳情與判定。</Empty>}
      drawerOpen={detailOpen && !!selected}
      onDrawerClose={closeDetail}>
      {/* ── 左欄:一份清單(右欄與抽屜由殼統一,見 components/listDetail.jsx) */}
      <Card title={cardTitle} bodyClass="p-0" action={cardAction}>
        {cardTop}
        {filterBar}
        {listRows}
      </Card>
    </ListDetailLayout>
  )
}
