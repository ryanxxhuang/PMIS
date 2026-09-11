// ITP 檢驗停留點:回答「這個工項什麼時候必須通知監造」。
// H=停留點(監造未查驗不得續作)、W=見證點、R=文審點。
// 監造建點(依品質計畫/規範),廠商從點上一鍵申請查驗;狀態由連結查驗自動推導;
// 「施作中卻未叫驗」的 H 點紅色警示並進提醒中心——這就是停留點的存在理由。
import { useState, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Badge, Button, Dot, Field, Input, Select, Empty, PageHeader, ErrorBanner, SkeletonList } from '../../components/ui.jsx'
import { ListDetailLayout, SearchField, StatusChip, MetaGrid } from '../../components/listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { friendlyError } from '../../lib/errorMessage.js'
// 工項挑選器與品質缺失共用同一份(原本這裡有一份輕量複本,浮層陰影/命中區的修正只落在其中一邊)
import { WorkItemPicker } from '../../components/DefectTracker.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import { POINT_TYPES, itpStatus, itpActivity } from '../../lib/itp.js'
import { billableLeaves } from '../../lib/boqCalc.js'

const TYPE_KEYS = Object.keys(POINT_TYPES)
const TYPE_BADGE = { H: 'red', W: 'blue', R: 'slate' }
// 狀態色鍵與圖示:pending=灰、requested=藍、passed=綠、failed=紅;顏色＋文字並存
const STATUS_META = {
  pending: { label: '未申請查驗', color: 'slate', icon: 'radio_button_unchecked' },
  requested: { label: '已申請，待監造查驗', color: 'blue', icon: 'schedule' },
  passed: { label: '通過', color: 'green', icon: 'check_circle' },
  failed: { label: '不通過', color: 'red', icon: 'cancel' },
}
// 「施作中未叫驗」不是第五種狀態,是 pending 的子集(itpAlerts 的判斷式:未申請＋工項
// 已有日誌數量)。放進狀態快篩是因為它就是這一頁的存在理由——改版前用一張獨立警示卡
// 承載,同一筆停留點在頁面上出現兩次(卡一次、清單一次);現在警示只在清單列的紅底與
// 色票講,快篩 chip 的件數就是警示數。H 與 W 都算(itpAlerts 同一條規則),R 不進。
const HOT = 'hot'
const STATUS_FILTERS = [HOT, 'pending', 'requested', 'passed', 'failed']
const STATUS_FILTER_LABEL = { [HOT]: '施作中未叫驗', pending: '未申請', requested: '已申請', passed: '通過', failed: '不通過' }
const STATUS_FILTER_COLOR = { [HOT]: 'red', pending: 'slate', requested: 'blue', passed: 'green', failed: 'red' }
const DEFAULT_FILTERS = { q: '', type: '', status: '' }
const blankForm = () => ({ point_type: 'H', title: '', acceptance_criteria: '', frequency: '', source_clause: '', work_item_key: '', work_item_label: '' })

const SUBTITLE = 'H＝停留點（監造未查驗不得續作）、W＝見證點、R＝文審點。施作中未叫驗的 H 點會亮紅並進提醒中心。'

export default function ITP() {
  const {
    workItems, inspections, siteLogs, inspectionPoints, can,
    createInspectionPoint, deleteInspectionPoint, requestInspectionForPoint,
    isSupabaseConfigured, currentProject, workItemsSource, currentUser,
  } = useStore()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 寫入失敗如實回報(B-07)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const searchRef = useRef(null)

  const leaves = useMemo(() => (workItems ? billableLeaves(workItems.items) : []), [workItems])

  // 每個停留點的推導狀態與施作狀態只算一次:清單列、快篩件數、詳情欄三處共用,
  // 三處各自呼叫 itpStatus 會在同一畫面對同一筆算三次(結果一樣,但下一次有人
  // 只改其中一處就會分岔)。hot = pending ∧ 施作中 ∧ 非 R(與 lib/itp.js itpAlerts 同一條規則)。
  const rows = useMemo(() => inspectionPoints.map((p) => {
    const st = itpStatus(p, inspections)
    const active = itpActivity(p, siteLogs)
    return { ...p, st, active, hot: st.key === 'pending' && active && p.point_type !== 'R' }
  }), [inspectionPoints, inspections, siteLogs])

  // 件數走全體(不受搜尋與另一軸影響):chip 上的數字是「本案有幾筆」,0 也保留——
  // 「還沒有不通過」本身就是資訊。兩軸(類型/狀態)各自單選、可疊加。
  const typeCounts = useMemo(
    () => Object.fromEntries(TYPE_KEYS.map((t) => [t, rows.filter((r) => r.point_type === t).length])),
    [rows],
  )
  const statusCounts = useMemo(() => Object.fromEntries(STATUS_FILTERS.map((s) => [
    s, rows.filter((r) => (s === HOT ? r.hot : r.st.key === s)).length,
  ])), [rows])

  // 目前畫面上的清單:類型 AND 狀態 AND 關鍵字(名稱/工項/標準/頻率/出處)。
  // 順序沿用 store(建立序=品質計畫的檢驗順序),不另外排——停留點的先後本來就是
  // 施工順序,照字母或狀態重排反而讓監造對不回品質計畫的清單。
  const ordered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return rows
      .filter((r) => !filters.type || r.point_type === filters.type)
      .filter((r) => !filters.status || (filters.status === HOT ? r.hot : r.st.key === filters.status))
      .filter((r) => !q || [r.title, r.work_item_no, r.work_item_desc, r.acceptance_criteria, r.frequency, r.source_clause]
        .some((v) => (v || '').toLowerCase().includes(q)))
  }, [rows, filters])
  const anyFilter = filters.q.trim() !== '' || filters.type !== '' || filters.status !== ''

  // 選取/深連結(?point=)/切案重置/初次自動選取:共用殼 hook。預設選第一筆「施作中
  // 未叫驗」(開頁就看到該做的事),其次第一筆未申請,再來清單第一筆。
  const pid = currentProject?.project_id
  const org = currentUser?.org_type || 'contractor'
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'point', idPrefix: 'itp-',
    scope: `${pid}/${org}`,
    ready: inspectionPoints.length > 0, rows: inspectionPoints,
    pickDefault: () => (ordered.find((r) => r.hot) || ordered.find((r) => r.st.key === 'pending') || ordered[0])?.id,
    onSelect: () => setErrMsg(''),
    onReset: () => { setFilters(DEFAULT_FILTERS); setForm(null) },
  })
  // 篩選後選中項被篩掉:右欄內容保留(與 /safety 同),清單中只是沒有高亮列
  const selected = rows.find((r) => r.id === selectedId) || null
  // 鍵盤:↑/↓ 移動選取、/ 聚焦搜尋。建點表單開著就停用——焦點落在表單按鈕上按 ↓
  // 會換選取,畫面焦點跑掉。
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'itp-', modalUp: !!form, searchRef })

  // 載入分支同樣要保留 PageHeader:工作面分頁列(PageTabs)長在 PageHeader 裡,
  // 之前只補了「標單未匯入」那一支,載入中仍會整條分頁列消失。
  if (!workItems) {
    return (
      <div className="space-y-5">
        <PageHeader title="檢驗停留點" tagline="ITP" subtitle={SUBTITLE} />
        <Card bodyClass="p-5" aria-busy="true"><SkeletonList rows={3} /></Card>
      </div>
    )
  }
  // 停留點掛在標單工項上(slice 寫入走 dbMode):標單未匯入前擋牆,避免寫進記憶體假成功。
  // 早退也保留 PageHeader:頁首與工作面分頁不該因為「標單還沒匯入」整組消失
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return (
      <div className="space-y-5">
        <PageHeader title="檢驗停留點" tagline="ITP" subtitle={SUBTITLE} />
        <Card title="檢驗停留點" bodyClass="p-0"><Empty>此專案的標單尚未匯入資料庫。請先到「專案文件」一次上傳標單 XML，停留點才能掛在工項上。</Empty></Card>
      </div>
    )
  }

  const submit = async () => {
    setErrMsg(''); setBusy(true)
    const { error } = await createInspectionPoint(form)
    setBusy(false)
    if (error) { setErrMsg(friendlyError(error, '停留點未建立')); return }
    setForm(null)
  }
  const onRequest = async (p) => {
    setErrMsg(''); setBusy(true)
    const { error } = await requestInspectionForPoint(p)
    setBusy(false)
    if (error) setErrMsg(friendlyError(error, '查驗申請未送出'))
  }
  const onDelete = async (p) => {
    if (!(await appConfirm({ title: `刪除停留點「${p.title}」？`, danger: true, confirmLabel: '刪除' }))) return
    setErrMsg('')
    const { error } = await deleteInspectionPoint(p.id)
    if (error) setErrMsg(friendlyError(error, '停留點刪除未完成'))
    else closeDetail() // <lg 抽屜承載的正是這筆,刪掉後不留 detailOpen 殘值
  }

  // ── 詳情欄:狀態列 / 名稱 / key-value / 對應查驗 / 動作列。
  // 動作條件與改版前列內動作逐條相同,一條都沒放寬(伺服器 RLS 兜底):
  //   申請查驗 = pending ∧ can.submit ∧ 非 R(文審點走送審流程,不在此叫驗)
  //   查驗紀錄 = requested ∨ failed → 連到 /quality
  //   刪除     = can.approve(監造建點、監造刪點)
  let detailBody = null
  if (selected) {
    const p = selected
    const sm = STATUS_META[p.st.key]
    const insp = p.inspection_id ? inspections.find((i) => i.id === p.inspection_id) : null
    const requestable = p.st.key === 'pending' && can.submit && p.point_type !== 'R'
    const hasRecord = p.st.key === 'requested' || p.st.key === 'failed'
    // region 名固定「停留點詳情」:報讀器走地標與 e2e 都用同一個名字找詳情欄
    detailBody = (
      <section aria-label="停留點詳情">
        {/* 狀態列:類型＋推導狀態＋施作中未叫驗;顏色＋文字並存 */}
        <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <Badge color={TYPE_BADGE[p.point_type]}>{POINT_TYPES[p.point_type]?.label || p.point_type}</Badge>
          <Badge color={sm.color}><MSym name={sm.icon} size={12} /> {p.st.label}</Badge>
          {p.hot && <Badge color="red">施作中未叫驗</Badge>}
        </div>

        <div className="p-4">
          <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{p.title}</div>
          {/* 空值一律顯示 —:格子固定,眼睛掃同一位置就知道有沒有填 */}
          <MetaGrid className="mt-3.5" rows={[
            ['工項', p.work_item_no ? `${p.work_item_no} ${p.work_item_desc || ''}`.trim() : '—'],
            ['類型', POINT_TYPES[p.point_type]?.desc || '—'],
            ['允收標準', p.acceptance_criteria || '—'],
            ['頻率', p.frequency || '—'],
            ['出處', p.source_clause || '—'],
            // 施作狀態=該工項是否已有日誌數量(lib/itp.js itpActivity);沒掛工項就判不出來
            ['施作狀態', !p.work_item_key ? '未掛工項' : p.active ? '施作中' : '尚未施作'],
            ['對應查驗', insp ? `${insp.title}（${insp.status}${insp.requested_date ? `・申請 ${insp.requested_date}` : ''}）` : '—'],
          ]} />
          {p.hot && (
            <p className="mt-3 text-footnote leading-relaxed text-[var(--red-text)] bg-[var(--red-tint)] rounded-lg px-3 py-2">
              {p.point_type === 'H' ? '該工項已在施作——停留點未經監造查驗不得續作。' : '該工項施作中，應通知監造到場見證。'}
            </p>
          )}
        </div>

        {/* 動作列:同一時間最多一顆實心鈕。申請查驗維持次級——緊急性由狀態列的
            紅色票承擔,不讓同一份清單依狀態長出兩種按鈕階級。 */}
        <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
          {requestable && <Button variant="secondary" disabled={busy} onClick={() => onRequest(p)}>申請查驗</Button>}
          {p.st.key === 'pending' && p.point_type === 'R' && (
            <span className="text-footnote text-[var(--text-2)]">文審點由「送審文件」查核，不在此申請查驗。</span>
          )}
          {p.st.key === 'pending' && !can.submit && p.point_type !== 'R' && (
            <span className="text-footnote text-[var(--text-2)]">待廠商施作到點申請查驗</span>
          )}
          {hasRecord && (
            <Link to="/quality" className="inline-flex items-center gap-0.5 max-md:min-h-11 text-footnote font-medium text-[var(--blue-text)] hover:underline">
              查驗紀錄<MSym name="chevron_right" size={13} />
            </Link>
          )}
          {/* 灰轉紅文字鈕不在三級語言內,改共用 Button 的第三級;ml-auto 靠右與主動作拉開 */}
          {can.approve && <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onDelete(p)}>刪除</Button>}
        </div>
      </section>
    )
  }

  // ── 左欄卡頭下方:搜尋 + 類型快篩 + 狀態快篩(件數走全體),三條件 AND
  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋名稱、工項、允收標準、出處…" aria-label="搜尋停留點" />
      <div className="flex items-center gap-2 flex-wrap">
        {TYPE_KEYS.map((t) => (
          <StatusChip key={t} active={filters.type === t} count={typeCounts[t]}
            onClick={() => setFilters((f) => ({ ...f, type: f.type === t ? '' : t }))}>
            <Dot color={TYPE_BADGE[t]} />{POINT_TYPES[t].label}
          </StatusChip>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <StatusChip key={s} active={filters.status === s} count={statusCounts[s]}
            onClick={() => setFilters((f) => ({ ...f, status: f.status === s ? '' : s }))}>
            <Dot color={STATUS_FILTER_COLOR[s]} />{STATUS_FILTER_LABEL[s]}
          </StatusChip>
        ))}
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>清除篩選</Button>
        )}
      </div>
    </div>
  )

  // ── 清單列:只負責選取(動作全在詳情欄),兩行=類型＋名稱＋狀態 / 工項與標準 meta。
  // role=listitem + aria-current 與 /safety 同一套選取語意;施作中未叫驗的列底色走
  // --red-tint 原值(對 token 加 /40 是自製色階,深色模式會失真),選中時仍以選取藍為準。
  const listRows = (
    <div role="list" aria-label="停留點清單" className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的停留點。<br />換一個類型或狀態,或試試名稱、工項、出處關鍵字。
        </div>
      ) : ordered.map((p) => {
        const active = p.id === selectedId
        const sm = STATUS_META[p.st.key]
        return (
          <button key={p.id} type="button" role="listitem" id={`itp-${p.id}`}
            aria-current={active || undefined}
            onClick={() => select(p.id, { openPane: true })}
            className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer ${active
              ? 'bg-[var(--blue-tint)]' : p.hot ? 'bg-[var(--red-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
            <span className="flex items-center gap-2 flex-wrap">
              <Badge color={TYPE_BADGE[p.point_type]}>{p.point_type}</Badge>
              <span className="text-body text-[var(--text)] min-w-0 [text-wrap:pretty]">{p.title}</span>
              <Badge color={sm.color}><MSym name={sm.icon} size={12} /> {p.st.label}</Badge>
              {p.hot && <Badge color="red">施作中未叫驗</Badge>}
            </span>
            <span className="block mt-0.5 num text-caption text-[var(--text-3)] truncate">
              {[p.work_item_no ? `${p.work_item_no} ${p.work_item_desc || ''}`.trim() : '', p.frequency ? `頻率 ${p.frequency}` : '', p.source_clause ? `出處 ${p.source_clause}` : '']
                .filter(Boolean).join(' · ') || '未掛工項'}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-5">
      {/* 類型件數不再進 PageHeader meta:三個數字都在快篩 chip 上,同一個數字不寫兩次 */}
      <PageHeader title="檢驗停留點" tagline="ITP" subtitle={SUBTITLE}
        action={can.approve && (
          <Button variant="secondary" onClick={() => setForm(form ? null : blankForm())}>
            {form ? '取消' : <><MSym name="add" size={16} />建立停留點</>}
          </Button>
        )} />

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      {form && (
        <Card title="建立停留點">
          {/* 表單欄位全走共用 Field/Input/Select:標籤字級與 focus/手機 44px 一次由 FIELD_BASE 給 */}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="類型">
              <Select value={form.point_type} onChange={(e) => setForm((f) => ({ ...f, point_type: e.target.value }))}>
                {Object.entries(POINT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label} — {v.desc}</option>)}
              </Select>
            </Field>
            <Field label="停留點名稱">
              <Input placeholder="如：柱牆鋼筋查驗（每層）" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </Field>
            {/* 挑選器不包 Field:Field 是 <label>,選定後挑選器的第一個可標記元素是「清除已選工項」
                鈕,點標籤文字就會把選好的工項清掉。這裡自帶同款標籤 span。 */}
            <div>
              <span className="block text-body font-medium text-[var(--text)] mb-1">掛在工項</span>
              <WorkItemPicker leaves={leaves} value={form.work_item_key} label={form.work_item_label}
                onPick={(k, l) => setForm((f) => ({ ...f, work_item_key: k || '', work_item_label: l }))} />
            </div>
            <Field label="允收標準">
              <Input placeholder="如：間距/搭接長度符合圖說" value={form.acceptance_criteria} onChange={(e) => setForm((f) => ({ ...f, acceptance_criteria: e.target.value }))} />
            </Field>
            <Field label="頻率">
              <Input placeholder="每層／每批／每次澆置前…" value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))} />
            </Field>
            <Field label="出處">
              <Input placeholder="品質計畫 §4.2／規範 03310…" value={form.source_clause} onChange={(e) => setForm((f) => ({ ...f, source_clause: e.target.value }))} />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={submit} disabled={busy || !form.title.trim()}>{busy ? '建立中…' : '建立'}</Button>
            <Button variant="secondary" onClick={() => setForm(null)}>取消</Button>
          </div>
        </Card>
      )}

      {inspectionPoints.length === 0 ? (
        <Card title="停留點清單" bodyClass="p-0">
          <Empty>
            尚未建立停留點。監造依「品質計畫／施工規範」把 W／H／R 點掛上工項，
            廠商施作到點就從這裡申請查驗。
          </Empty>
        </Card>
      ) : (
        <ListDetailLayout
          detail={detailBody}
          detailLabel="停留點詳情"
          detailEmpty={<Empty>點左側清單查看停留點的工項、允收標準與對應查驗。</Empty>}
          drawerOpen={detailOpen && !!selected}
          onDrawerClose={closeDetail}>
          {/* ── 左欄:一份清單(右欄與抽屜由殼統一,見 components/listDetail.jsx)。
              改版前的「施作中未叫驗」警示卡退場:同一筆不再在頁面上出現兩次,
              警示數在狀態快篩 chip、列底色與詳情欄的紅字說明上。 */}
          <Card title={`停留點清單（${inspectionPoints.length}）`} bodyClass="p-0">
            {filterBar}
            {listRows}
          </Card>
        </ListDetailLayout>
      )}

      <p className="text-xs text-[var(--text-3)] leading-relaxed">
        <MSym name="flag" size={12} className="inline -mt-0.5 mr-1" />
        停留點來源通常是「品質計畫」的檢驗停留點清單與施工規範的檢驗規定；
        之後可用 AI 從上傳的規範自動抽出建議停留點（同契約解析模式），由監造審核後生效。
      </p>
    </div>
  )
}
