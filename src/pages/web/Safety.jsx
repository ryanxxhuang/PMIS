import { useState, useMemo } from 'react'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Stat, Empty, Button, Badge, Field, Input, Select, Textarea, PageHeader, ErrorBanner } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import DefectTracker from '../../components/DefectTracker.jsx'

// 伺服器 safety_records_guard 矩陣的鏡像(僅 UX;真正強制在 DB trigger,
// 見 migrations 20260712000200 + 20260712001400):廠商=三類原始紀錄,監造=監造三類,機關唯讀。
// 工安缺失已併入統一缺失引擎(下方「工安缺失追蹤」卡,與品質缺失同狀態機)。
const CONTRACTOR_TYPES = ['自主檢查', '教育訓練', '危害告知']
const SUPERVISOR_TYPES = ['監造觀察', '監造查驗', '監造複查']
const TYPES = [...CONTRACTOR_TYPES, ...SUPERVISOR_TYPES]
const TYPE_COLOR = { 自主檢查: 'blue', 教育訓練: 'green', 危害告知: 'amber', 監造觀察: 'slate', 監造查驗: 'purple', 監造複查: 'purple' }
const STATUS_COLOR = { 待改善: 'red', 改善中: 'amber', 已完成: 'green' }
const NEEDS_FLOW = (t) => t === '自主檢查'
const NEXT = { 待改善: '改善中', 改善中: '已完成' }
const NEXT_LABEL = { 待改善: '開始改善', 改善中: '標為完成' }
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const thisMonth = () => todayStr().slice(0, 7)

export default function Safety() {
  const { project, isPersistedProject, demoMode, safetyRecords, createSafetyRecord, updateSafetyRecord, deleteSafetyRecord, defects, currentUser, can } = useStore()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  // 更正已完成紀錄:{ id, reason, note, revert } 一次只開一筆
  const [correcting, setCorrecting] = useState(null)

  const org = currentUser?.org_type || 'contractor'
  const isAdmin = !demoMode && can.override // demo 刻意不套 admin 例外,保留三方角色劇本;正式模式=關
  const creatableTypes = isAdmin ? TYPES
    : org === 'contractor' ? CONTRACTOR_TYPES
    : org === 'supervisor' ? SUPERVISOR_TYPES : []
  // 本方紀錄才可操作(型別↔org 一對一;伺服器另以建立者 org 精準強制)
  const canTouch = (r) => isAdmin
    || (org === 'supervisor' ? r.record_type.startsWith('監造')
      : org === 'contractor' ? !r.record_type.startsWith('監造') : false)

  const counts = useMemo(() => {
    // 工安缺失=統一缺失引擎(defects, domain='safety'),未結案即未改善
    const openDef = defects.filter((d) => (d.domain || 'quality') === 'safety' && d.status !== '已結案').length
    const checksThisMonth = safetyRecords.filter((r) => r.record_type === '自主檢查' && (r.record_date || '').startsWith(thisMonth())).length
    const trainings = safetyRecords.filter((r) => r.record_type === '教育訓練').length
    return { openDef, checksThisMonth, trainings }
  }, [safetyRecords, defects])

  const groups = useMemo(() => TYPES.map((t) => ({
    t, list: safetyRecords.filter((r) => r.record_type === t),
  })).filter((g) => g.list.length), [safetyRecords])

  const openForm = (type) => setForm({
    record_type: type, title: '', location: '', record_date: todayStr(), note: '', result: '合格',
  })

  const onSubmit = async () => {
    if (!form.title.trim()) return
    setBusy(true); setErrMsg('')
    // 自主檢查依「檢查結果」決定狀態:合格=已完成、不合格=待改善(P2-02:
    // 原本一律待改善,把正常檢查自動當缺失,產生假待辦)
    const payload = form.record_type === '自主檢查'
      ? { ...form, status: form.result === '合格' ? '已完成' : '待改善' }
      : form
    const { error } = await createSafetyRecord(payload)
    setBusy(false)
    if (error) setErrMsg(friendlyError(error, '工安紀錄新增未完成'))
    else setForm(null)
  }

  const onFlow = async (r) => {
    setErrMsg('')
    const { error } = await updateSafetyRecord(r.id, { status: NEXT[r.status] })
    if (error) setErrMsg(friendlyError(error, '狀態更新未完成'))
  }

  const onDelete = async (r) => {
    if (!await appConfirm({ title: '刪除此工安紀錄？', danger: true, confirmLabel: '刪除' })) return
    setErrMsg('')
    const { error } = await deleteSafetyRecord(r.id)
    if (error) setErrMsg(friendlyError(error, '工安紀錄刪除未完成'))
  }

  const onCorrect = async () => {
    if (!correcting?.reason.trim()) return
    setErrMsg('')
    const patch = { correction_reason: correcting.reason.trim(), note: correcting.note || null }
    if (correcting.revert) patch.status = '改善中'
    const { error } = await updateSafetyRecord(correcting.id, patch)
    if (error) setErrMsg(friendlyError(error, '更正未完成'))
    else setCorrecting(null)
  }

  // 工安不依賴標單:真專案選定即可用(寫入走 isPersistedProject),不必等標單匯入
  // 早退也保留 PageHeader:頁首與工作面分頁不該因為「還沒選專案」整組消失
  if (!isPersistedProject && !demoMode) {
    return (
      <div className="space-y-5">
        <PageHeader title="工安管理" tagline="自主檢查・缺失・教育訓練" subtitle="工安缺失走統一缺失引擎;自主檢查、教育訓練與危害告知在此登錄" />
        <Card title="工安管理" bodyClass="p-0"><Empty>此功能需真實專案。請先建立或選擇專案。</Empty></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title="工安管理" tagline="自主檢查・缺失・教育訓練" subtitle="工安缺失走統一缺失引擎;自主檢查、教育訓練與危害告知在此登錄" />

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      {/* Stat 列斷點與 Dashboard 一致:375px 擠三欄會把數字壓成兩行 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat label="未結案工安缺失" value={counts.openDef} sub="件" color={counts.openDef > 0 ? 'text-[var(--red-text)]' : 'text-[var(--green-text)]'} />
        <Stat label="本月自主檢查" value={counts.checksThisMonth} sub="次" color="text-[var(--blue-text)]" />
        <Stat label="教育訓練累計" value={counts.trainings} sub="場" color="text-[var(--green-text)]" />
      </div>

      {/* 工安缺失:統一缺失引擎(與品質缺失同一狀態機/稽核),以 domain=safety 分類 */}
      <DefectTracker domain="safety" />

      {/* 這排是「新增」動作,不是視圖切換:改共用 Button 的次級,不再自寫實心選取態 chip
          (選了哪一型由下方表單自己的型別色票說明) */}
      <Card title="新增工安紀錄" bodyClass={form ? 'p-5' : 'p-0'} action={
        <div className="flex flex-wrap gap-2">
          {creatableTypes.map((t) => (
            <Button key={t} size="sm" variant="secondary" onClick={() => openForm(t)}>
              <MSym name="add" size={16} />{t}
            </Button>
          ))}
        </div>
      }>
        {!form ? (
          creatableTypes.length === 0 ? (
            <Empty icon="visibility">機關為監督視角：工安紀錄由施工廠商與監造登錄，此頁唯讀。</Empty>
          ) : (
            <Empty>
              點右上選一種類型新增：{creatableTypes.join('、')}。
              {org === 'supervisor' && ' 監造僅能「新增」觀察/查驗/複查事件，不可改寫廠商原始紀錄。'}
            </Empty>
          )
        ) : (
          <div className="bg-[var(--surface-2)] rounded-lg p-4 space-y-3">
            <Badge color={TYPE_COLOR[form.record_type]}>{form.record_type}</Badge>
            {/* 表單欄位全走共用 Field/Input/Select/Textarea:標籤字級與 focus/disabled/
                手機 44px 一次由 FIELD_BASE 給,不再各頁自寫一份 input class */}
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={form.record_type === '教育訓練' ? '課程 / 主題' : form.record_type === '危害告知' ? '危害項目' : '項目 / 標題'}>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder={form.record_type === '自主檢查' ? '如：用電設備自主檢查' : ''} />
              </Field>
              <Field label="位置 / 場所">
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </Field>
              <Field label="日期">
                <Input type="date" value={form.record_date} onChange={(e) => setForm({ ...form, record_date: e.target.value })} />
              </Field>
              {form.record_type === '自主檢查' && (
                <Field label="檢查結果">
                  {/* 正常檢查不是缺失:合格即完成,不合格才進改善流程(第二輪 P2-02) */}
                  <Select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })}>
                    <option value="合格">合格</option>
                    <option value="不合格">不合格（進改善追蹤）</option>
                  </Select>
                </Field>
              )}
            </div>
            <Field label={`備註 ${form.record_type === '教育訓練' ? '（講師 / 參與人數）' : ''}`}>
              <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
            <div className="flex gap-2">
              <Button onClick={onSubmit} disabled={busy || !form.title.trim()}>{busy ? '新增中…' : '新增'}</Button>
              <Button variant="secondary" onClick={() => setForm(null)}>取消</Button>
            </div>
          </div>
        )}
      </Card>

      {groups.length === 0 ? (
        <Card title="工安紀錄" bodyClass="p-0"><Empty>尚無工安紀錄。用上方新增自主檢查、教育訓練或危害告知;工安缺失請用上方「工安缺失追蹤」開立。</Empty></Card>
      ) : groups.map((g) => (
        <Card key={g.t} title={`${g.t}（${g.list.length}）`} bodyClass="p-0" action={
          <Button variant="ghost" onClick={() => exportCsv(`工安_${g.t}_${stamp()}`, g.list, [
            { key: 'record_date', label: '日期' }, { key: 'title', label: '項目' }, { key: 'location', label: '位置' },
            { key: 'severity', label: '嚴重度' }, { key: 'status', label: '狀態' }, { key: 'due_date', label: '改善期限' }, { key: 'note', label: '備註' },
          ])}><MSym name="download" size={16} />CSV</Button>
        }>
          {/* 清單列走全站同一套:divide-y 分隔、hover 走 --surface-2、內距對齊卡頭 px-5 */}
          <ul className="divide-y divide-[var(--border-2)]">
            {g.list.map((r) => (
              <li key={r.id} className="px-5 py-3 text-sm hover:bg-[var(--surface-2)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[var(--text)]">
                      {r.title}
                      {NEEDS_FLOW(r.record_type) && <> <Badge color={STATUS_COLOR[r.status] || 'slate'}>{r.status}</Badge></>}
                      {r.correction_reason && <> <Badge color="amber">已更正</Badge></>}
                    </div>
                    <div className="text-xs text-[var(--text-3)] truncate">
                      {[r.record_date, r.location, r.due_date ? `期限 ${r.due_date}` : '', r.note].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0 items-center">
                    {/* 列內動作一律 sm:同一列不並排 36px 與 20px 兩種命中區 */}
                    {canTouch(r) && NEEDS_FLOW(r.record_type) && r.status !== '已完成' && (
                      <Button size="sm" variant={r.status === '改善中' ? 'success' : 'secondary'} onClick={() => onFlow(r)} disabled={busy}>
                        {NEXT_LABEL[r.status]}
                      </Button>
                    )}
                    {canTouch(r) && r.status === '已完成' && (
                      <button onClick={() => setCorrecting(correcting?.id === r.id ? null : { id: r.id, reason: '', note: r.note || '', revert: false })}
                        className="text-xs text-[var(--blue-text)] hover:underline inline-flex items-center max-md:min-h-11 px-1">更正</button>
                    )}
                    {canTouch(r) && r.status !== '已完成' && (
                      // p-2 -m-2 只擴命中區、視覺與列高不變(同 DefectTracker/ITP 的刪除鈕)
                      <button onClick={() => onDelete(r)} className="inline-flex items-center justify-center p-2 -m-2 max-md:min-h-11 text-[var(--text-3)] hover:text-[var(--red-text)]" aria-label="刪除紀錄"><MSym name="close" size={16} /></button>
                    )}
                  </div>
                </div>
                {correcting?.id === r.id && (
                  <div className="mt-2 bg-[var(--surface-2)] rounded-lg p-3 space-y-2">
                    <Field label="更正原因（必填，留存稽核）">
                      <Input value={correcting.reason} onChange={(e) => setCorrecting({ ...correcting, reason: e.target.value })}
                        placeholder="如：誤標完成 / 日期登錄錯誤" />
                    </Field>
                    <Field label="備註（更正後內容）">
                      <Textarea rows={2} value={correcting.note} onChange={(e) => setCorrecting({ ...correcting, note: e.target.value })} />
                    </Field>
                    {NEEDS_FLOW(r.record_type) && (
                      // 原生 checkbox 預設約 13px,是全站最小的互動元素;w-5 h-5 提到 20px,外層 label 補 44px 命中區
                      <label className="flex items-center gap-1.5 text-xs text-[var(--text-2)] cursor-pointer max-md:min-h-11">
                        <input type="checkbox" className="w-5 h-5" checked={correcting.revert} onChange={(e) => setCorrecting({ ...correcting, revert: e.target.checked })} />
                        狀態退回「改善中」（誤標完成）
                      </label>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={onCorrect} disabled={!correcting.reason.trim()}>送出更正</Button>
                      <Button size="sm" variant="secondary" onClick={() => setCorrecting(null)}>取消</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <p className="text-xs text-[var(--text-3)] leading-relaxed">
        公共工程必備：工安缺失走與品質缺失相同的統一改善狀態機（開立→改善→複查→結案）；
        廠商的自主檢查、教育訓練與危害告知，加上監造的觀察/查驗/複查事件都集中在此，可逐類匯出 CSV 交件。
        已完成紀錄不可刪除，更正會連同原因留存稽核。
      </p>
    </div>
  )
}
