// 查驗分段(重構波次 7 由 pages/web/Quality.jsx 原地搬出,JSX 零改動):
// 申請表單/狀態篩選/查驗列/判定鈕。狀態刻意留在頁面——「提出查驗申請」從檢查表分段
// 預填 inspForm 再切段,分段是非當前不渲染(unmount)的,表單 state 住這裡會在切段瞬間消失;
// errMsg 也是頁層 ErrorBanner。所以本元件只收 props,判定/刪除/送出的邏輯全在頁面。
//
// ⚠️ 查驗列的 `flex items-center justify-between` 是 e2e 契約(supervisor/a11y spec 以
// justify-between 祖先鎖列),class 名與 DOM 層級不可動。
import { useNavigate } from 'react-router-dom'
import { MSym } from '../icons.jsx'
import { Card, Button, Field, Badge, Empty, Input, Select, FilterChip } from '../ui.jsx'
import { appConfirm } from '../confirm.jsx'
import { taipeiToday } from '../../lib/dates.js'
import { WorkItemPicker } from '../DefectTracker.jsx'

const inspColor = { 待查驗: 'amber', 合格: 'green', 不合格: 'red' }

// 查驗清單的狀態篩選(S-4):判定後的紀錄本來就留在清單裡,但純時間序要回答
// 「擋土牆到底合格了沒」只能逐列掃。'全部' 是唯一非狀態值,其餘直接對 inspections.status。
export const INSP_FILTERS = ['全部', '待查驗', '合格', '不合格']

export const EMPTY_INSP_FORM = () => ({ title: '', location: '', inspection_type: '施工查驗', requested_date: taipeiToday(), work_item_key: '', work_item_label: '', checklist_record_id: '' })

export default function InspectionsSection({
  inspections, inspCount, filter, onFilter,
  form, onFormChange, onSubmit, busy, resultMsg, onShowDefects,
  leaves, attachableChecklists, templates, can, onResult, onDelete,
}) {
  const navigate = useNavigate() // 查驗列的「附自主檢查表」chip 導向既有列印檢視
  const openInsp = inspCount['待查驗']
  const shownInsp = filter === '全部' ? inspections : inspections.filter((i) => i.status === filter)
  return (
    <Card title={`查驗（全部 ${inspCount['全部']}・待查驗 ${openInsp}）`} action={can.submit && <Button variant="secondary" onClick={() => onFormChange(form ? null : EMPTY_INSP_FORM())}>{form ? '取消' : <><MSym name="add" size={16} />查驗申請</>}</Button>}>
      {resultMsg && (
        <div className="flex items-center gap-3 flex-wrap rounded-lg bg-[var(--green-tint)] text-[var(--green-text)] text-sm px-3 py-2 mb-3">
          <span>{resultMsg.pass ? '已判定合格' : '已判定不合格並開立缺失'}</span>
          {!resultMsg.pass && (
            <button onClick={onShowDefects} className="font-medium underline hover:opacity-80">查看缺失</button>
          )}
        </div>
      )}
      {form && (
        <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
          {/* 換工項連同清掉已選檢附:候選是「同工項」口徑,留著舊選擇會掛到不相干的表 */}
          <WorkItemPicker leaves={leaves} value={form.work_item_key} label={form.work_item_label} onPick={(k, l) => onFormChange((f) => ({ ...f, work_item_key: k || '', work_item_label: l, checklist_record_id: '' }))} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="查驗項目"><Input value={form.title} onChange={(e) => onFormChange((f) => ({ ...f, title: e.target.value }))} placeholder="如 混凝土澆置前查驗" /></Field>
            <Field label="位置"><Input value={form.location} onChange={(e) => onFormChange((f) => ({ ...f, location: e.target.value }))} placeholder="如 A 區 1F" /></Field>
            <Field label="類型"><Select value={form.inspection_type} onChange={(e) => onFormChange((f) => ({ ...f, inspection_type: e.target.value }))}><option>施工查驗</option><option>材料查驗</option><option>隱蔽查驗</option></Select></Field>
            {/* 預設今天:全站慣例是「事件已發生的記錄日預設今天」(檢查表/取樣皆同),
                申請查驗這件事就是按下去的當天發生,空白只會讓現場忘了填 */}
            <Field label="申請查驗日（必填）"><Input type="date" value={form.requested_date} onChange={(e) => onFormChange((f) => ({ ...f, requested_date: e.target.value }))} /></Field>
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
                      {r.check_date} {templates.find((t) => t.id === r.template_id)?.title || '自主檢查表'}{r.rev ? ` Rev.${r.rev}` : ''}{r.location ? `（${r.location}）` : ''} — {r.overall}
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
      {/* 狀態篩選:判定後的紀錄一直都留在這張清單,但純時間序回答不了
          「擋土牆合格了沒」。flex-wrap 是 375px 的保命符,四個 chip 一行放不下要能換行。
          資料篩選一律 ui.jsx FilterChip(rounded-full 舊 chip 退場;aria-pressed 由元件內建) */}
      {inspections.length > 0 && (
        <div role="group" aria-label="查驗狀態篩選" className="flex flex-wrap gap-1.5 mb-3">
          {INSP_FILTERS.map((f) => (
            <FilterChip key={f} active={filter === f} onToggle={() => onFilter(f)}
              label={<span className="inline-flex items-center gap-1">{f}<span className="num opacity-80">{inspCount[f]}</span></span>} />
          ))}
        </div>
      )}
      {inspections.length === 0 ? <Empty>尚無查驗紀錄</Empty> : shownInsp.length === 0 ? (
        <Empty>沒有「{filter}」的查驗紀錄</Empty>
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
                {can.edit && i.status === '待查驗' && <button onClick={async () => { if (await appConfirm({ title: '刪除此查驗紀錄？', danger: true, confirmLabel: '刪除' })) onDelete(i.id) }} className="text-[var(--text-3)] hover:text-[var(--red-text)] p-2 -m-2" aria-label={`刪除查驗 ${i.title}`}><MSym name="close" size={16} /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
