import { useState, useMemo, useRef } from 'react'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Stat, Empty, Button, Badge, Dot, Field, Input, Select, Textarea, PageHeader, ErrorBanner } from '../../components/ui.jsx'
import { ListDetailLayout, SearchField, StatusChip, MetaGrid } from '../../components/listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import DefectTracker from '../../components/DefectTracker.jsx'
import { taipeiToday } from '../../lib/dates.js'

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
const thisMonth = () => taipeiToday().slice(0, 7)

// 紀錄區的版面:改版前是「6 張型別卡」——同一種東西被型別切成六份,使用者要橫向
// 比較「這週工安做了什麼」得掃六張卡;列內展開的更正表單又會把列撐開、把下面的列
// 推走。現在是一份清單(日期新→舊)＋型別快篩＋詳情欄:詳情與動作永遠在同一個位置
// (規範 §0 疊合版),更正就地在詳情欄處理,不跳頁、不開對話框(判準第 3 條)。
// 型別快篩做「單選、再點一次取消」而不是多選:
//   - 與 /requirements 的狀態快篩同一個手感(StatusChip 本來就是單選分段,
//     aria-pressed 一次只亮一顆),全站一套心智模型;
//   - 六個型別各對應一方的一種紀錄,實際工作流只有「看全部(橫向比較)」與「只看
//     這一型(交件、匯出)」兩種,「自主檢查＋監造複查」這類組合沒有對應的業務動作;
//   - 單選讓 CSV 檔名能直接寫上型別,對應改版前「逐型別匯出」的交件習慣。
const DEFAULT_FILTERS = { q: '', type: '' }
// CSV 欄位與改版前逐型別匯出同一組,只多了「類型」放第一欄:匯出母體現在是混型別
// 的篩選結果,少了這欄同一張表裡的自主檢查與監造查驗就分不開。
const CSV_COLUMNS = [
  { key: 'record_type', label: '類型' }, { key: 'record_date', label: '日期' }, { key: 'title', label: '項目' },
  { key: 'location', label: '位置' }, { key: 'severity', label: '嚴重度' }, { key: 'status', label: '狀態' },
  { key: 'due_date', label: '改善期限' }, { key: 'note', label: '備註' },
]
// 檔名反映匯出範圍:工安_{型別|全部}[_搜尋-關鍵字]_{日期}。關鍵字進檔名前把路徑與
// 檔名保留字元換成 -,並截 20 字——各家瀏覽器對不合法檔名的處理不同,不賭。
const csvName = ({ q, type }) => {
  const kw = q.trim().replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 20)
  return ['工安', type || '全部', kw ? `搜尋-${kw}` : null, stamp()].filter(Boolean).join('_')
}

export default function Safety() {
  const { isPersistedProject, demoMode, currentProject, safetyRecords, createSafetyRecord, updateSafetyRecord, deleteSafetyRecord, defects, currentUser, can } = useStore()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  // 更正已完成紀錄:{ id, reason, note, revert } 一次只開一筆;表單住在詳情欄
  const [correcting, setCorrecting] = useState(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const searchRef = useRef(null)

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

  // 型別件數走全體紀錄(不受搜尋影響):chip 上的數字是「本案有幾筆這一型」,
  // 0 筆的型別也留著——「還沒有監造複查」本身就是資訊,藏掉反而要人猜。
  const typeCounts = useMemo(
    () => Object.fromEntries(TYPES.map((t) => [t, safetyRecords.filter((r) => r.record_type === t).length])),
    [safetyRecords],
  )

  // 目前畫面上的清單:型別 AND 關鍵字(項目/位置/備註/日期/更正原因),日期新→舊。
  // 改版前依型別分卡、卡內照 store 順序;混成一份後只有時間序能讓不同型別並排比較。
  const ordered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return safetyRecords
      .filter((r) => !filters.type || r.record_type === filters.type)
      .filter((r) => !q || [r.title, r.location, r.note, r.record_date, r.correction_reason]
        .some((v) => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => (b.record_date || '').localeCompare(a.record_date || ''))
  }, [safetyRecords, filters])
  const anyFilter = filters.q.trim() !== '' || filters.type !== ''

  // 選取/深連結(?record=)/切案重置/初次自動選取:共用殼 hook,預設選最新一筆。
  // 換選取就收掉更正表單:表單綁的是上一筆的 id,留著會出現「詳情是 A、表單是 B」。
  const pid = currentProject?.project_id
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'record', idPrefix: 'saf-',
    scope: `${pid}/${org}/${isAdmin}`,
    ready: safetyRecords.length > 0, rows: safetyRecords,
    pickDefault: () => ordered[0]?.id,
    onSelect: () => { setCorrecting(null); setErrMsg('') },
    onReset: () => { setCorrecting(null); setFilters(DEFAULT_FILTERS) },
  })
  // 篩選後選中項被篩掉:右欄內容保留(與 /requirements 同),清單中只是沒有高亮列
  const selected = safetyRecords.find((r) => r.id === selectedId) || null
  // 鍵盤:↑/↓ 移動選取、/ 聚焦搜尋。更正表單開著就停用——焦點落在「送出更正」鈕上
  // 按 ↓ 會換選取、連帶清掉打到一半的原因。
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'saf-', modalUp: !!correcting, searchRef })

  const openForm = (type) => setForm({
    record_type: type, title: '', location: '', record_date: taipeiToday(), note: '', result: '合格',
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
    else closeDetail() // <lg 抽屜承載的正是這筆,刪掉後不留 detailOpen 殘值
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

  // ── 詳情欄:狀態列 / 標題 / key-value / 更正紀錄 / 動作列 / 更正表單。
  // 動作只看歸屬(canTouch)——與改版前列內動作同一組條件,一條都沒放寬;
  // 已完成紀錄沒有刪除鈕,只有「更正」(留痕:原因必填、留存 correction_reason)。
  let detailBody = null
  if (selected) {
    const r = selected
    const flowable = canTouch(r) && NEEDS_FLOW(r.record_type) && r.status !== '已完成'
    const correctable = canTouch(r) && r.status === '已完成'
    const deletable = canTouch(r) && r.status !== '已完成'
    const isCorrecting = correcting?.id === r.id
    detailBody = (<>
      {/* 狀態列:型別＋流程狀態(只有自主檢查有流程)＋已更正;顏色＋文字並存 */}
      <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
        <Badge color={TYPE_COLOR[r.record_type]}>{r.record_type}</Badge>
        {NEEDS_FLOW(r.record_type) && <Badge color={STATUS_COLOR[r.status] || 'slate'}>{r.status}</Badge>}
        {r.correction_reason && <Badge color="amber">已更正</Badge>}
      </div>

      <div className="p-4">
        <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{r.title}</div>
        {/* 空值一律顯示 —:六格固定,眼睛掃同一位置就知道有沒有填,不讓格子隨資料消失 */}
        <MetaGrid className="mt-3.5" rows={[
          ['日期', r.record_date || '—'],
          ['位置', r.location || '—'],
          ['嚴重度', r.severity || '—'],
          ['狀態', r.status || '—'],
          ['改善期限', r.due_date || '—'],
          ['備註', r.note || '—'],
        ]} />
      </div>

      {/* 更正紀錄:稽核軌跡要看得見(規範 §1 三條不可退讓),不折進備註裡 */}
      {r.correction_reason && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <MSym name="history" size={15} className="text-[var(--text-3)]" />
            <span className="text-footnote font-medium text-[var(--text)]">更正紀錄</span>
          </div>
          <p className="text-footnote leading-relaxed text-[var(--text-2)] bg-[var(--surface-2)] rounded-lg px-3 py-2">
            更正原因:{r.correction_reason}
          </p>
        </div>
      )}

      {/* 動作列:流程推進 / 更正 / 刪除。三顆互斥於狀態(未完成→推進＋刪除、已完成→更正),
          同一時間最多一顆實心鈕 */}
      {(flowable || correctable || deletable) && (
        <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
          {flowable && (
            <Button size="sm" variant={r.status === '改善中' ? 'success' : 'secondary'} onClick={() => onFlow(r)} disabled={busy}>
              {NEXT_LABEL[r.status]}
            </Button>
          )}
          {correctable && !isCorrecting && (
            <Button size="sm" variant="secondary" onClick={() => setCorrecting({ id: r.id, reason: '', note: r.note || '', revert: false })}>更正</Button>
          )}
          {deletable && (
            // p-2 -m-2 只擴命中區、視覺與列高不變(同 DefectTracker/ITP 的刪除鈕);ml-auto 靠右與主動作拉開
            <button onClick={() => onDelete(r)} className="ml-auto inline-flex items-center justify-center p-2 -m-2 max-md:min-h-11 text-[var(--text-3)] hover:text-[var(--red-text)]" aria-label="刪除紀錄"><MSym name="close" size={16} /></button>
          )}
        </div>
      )}

      {/* 更正表單:欄位與驗證與改版前列內版完全相同(原因必填、revert 只給自主檢查) */}
      {isCorrecting && (
        <div className="px-4 pb-4">
          <div className="bg-[var(--surface-2)] rounded-lg p-3 space-y-2">
            <Field label="更正原因（必填，留存稽核）">
              <Input value={correcting.reason} onChange={(e) => setCorrecting({ ...correcting, reason: e.target.value })}
                placeholder="如：誤標完成 / 日期登錄錯誤" />
            </Field>
            <Field label="備註（更正後內容）">
              <Textarea rows={2} value={correcting.note} onChange={(e) => setCorrecting({ ...correcting, note: e.target.value })} />
            </Field>
            {NEEDS_FLOW(r.record_type) && (
              // 原生 checkbox 預設約 13px,是全站最小的互動元素;w-5 h-5 提到 20px,外層 label 補 44px 命中區
              <label className="flex items-center gap-1.5 text-footnote text-[var(--text-2)] cursor-pointer max-md:min-h-11">
                <input type="checkbox" className="w-5 h-5" checked={correcting.revert} onChange={(e) => setCorrecting({ ...correcting, revert: e.target.checked })} />
                狀態退回「改善中」（誤標完成）
              </label>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={onCorrect} disabled={!correcting.reason.trim()}>送出更正</Button>
              <Button size="sm" variant="secondary" onClick={() => setCorrecting(null)}>取消</Button>
            </div>
          </div>
        </div>
      )}
    </>)
  }

  // ── 左欄卡頭下方:搜尋 + 六型別快篩(件數走全體),兩條件 AND
  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋項目、位置或備註…" aria-label="搜尋工安紀錄" />
      <div className="flex items-center gap-2 flex-wrap">
        {TYPES.map((t) => (
          <StatusChip key={t} active={filters.type === t} count={typeCounts[t]}
            onClick={() => setFilters((f) => ({ ...f, type: f.type === t ? '' : t }))}>
            <Dot color={TYPE_COLOR[t]} />{t}
          </StatusChip>
        ))}
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>清除篩選</Button>
        )}
      </div>
    </div>
  )

  // ── 清單列:只負責選取(動作全在詳情欄),兩行=型別＋標題＋狀態 / meta。
  // 型別 Badge 是改版新增的——改版前型別由卡片標題承載,混成一份後每列都要自己說。
  // role=listitem + aria-current 與 /requirements 同一套選取語意;divide-y 不在最後一列
  // 留下與卡底重疊的雙線。
  const listRows = (
    <div role="list" aria-label="工安紀錄" className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的紀錄。<br />換一個型別,或試試項目名稱、位置、備註關鍵字。
        </div>
      ) : ordered.map((r) => {
        const active = r.id === selectedId
        return (
          <button key={r.id} type="button" role="listitem" id={`saf-${r.id}`}
            aria-current={active || undefined}
            onClick={() => select(r.id, { openPane: true })}
            className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer ${active
              ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
            <span className="flex items-center gap-2 flex-wrap">
              <Badge color={TYPE_COLOR[r.record_type]}>{r.record_type}</Badge>
              <span className="text-body text-[var(--text)] min-w-0 [text-wrap:pretty]">{r.title}</span>
              {NEEDS_FLOW(r.record_type) && <Badge color={STATUS_COLOR[r.status] || 'slate'}>{r.status}</Badge>}
              {r.correction_reason && <Badge color="amber">已更正</Badge>}
            </span>
            <span className="block mt-0.5 num text-caption text-[var(--text-3)] truncate">
              {[r.record_date, r.location, r.due_date ? `期限 ${r.due_date}` : '', r.note].filter(Boolean).join(' · ')}
            </span>
          </button>
        )
      })}
    </div>
  )

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

      {safetyRecords.length === 0 ? (
        <Card title="工安紀錄" bodyClass="p-0"><Empty>尚無工安紀錄。用上方新增自主檢查、教育訓練或危害告知;工安缺失請用上方「工安缺失追蹤」開立。</Empty></Card>
      ) : (
        <ListDetailLayout
          detail={detailBody}
          detailLabel="工安紀錄詳情"
          detailEmpty={<Empty>點左側清單查看紀錄詳情。</Empty>}
          drawerOpen={detailOpen && !!selected}
          onDrawerClose={closeDetail}>
          {/* ── 左欄:一份清單(右欄與抽屜由殼統一,見 components/listDetail.jsx)。
              CSV 從「逐型別一顆」改成卡頭一顆,匯出的是目前篩選結果——匯出你看到的;
              鈕上帶件數,按下去前就知道會拿到幾筆。 */}
          <Card title={`工安紀錄（${safetyRecords.length}）`} bodyClass="p-0" action={
            <Button variant="ghost" onClick={() => exportCsv(csvName(filters), ordered, CSV_COLUMNS)}
              disabled={ordered.length === 0} title="匯出目前篩選結果">
              <MSym name="download" size={16} />CSV（{ordered.length}）
            </Button>
          }>
            {filterBar}
            {listRows}
          </Card>
        </ListDetailLayout>
      )}

      <p className="text-xs text-[var(--text-3)] leading-relaxed">
        公共工程必備：工安缺失走與品質缺失相同的統一改善狀態機（開立→改善→複查→結案）；
        廠商的自主檢查、教育訓練與危害告知，加上監造的觀察/查驗/複查事件都集中在此，可逐類匯出 CSV 交件。
        已完成紀錄不可刪除，更正會連同原因留存稽核。
      </p>
    </div>
  )
}
