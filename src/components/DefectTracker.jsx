// 統一缺失引擎的共用 UI(QA §9-4):品質/工安缺失同一張卡、同一套狀態機
// 開立 → 改善中 → 待複查 → 已結案。改善鏈=廠商;複查結案/退回/撤銷結案=監造
// (伺服器 defects_guard 強制,前端 can 只是 UX)。已結案僅能附原因撤銷,不可刪除。
//
// 版面是「清單＋詳情」殼(規範 §9.8 第一條)。改版前是列內動作列、沒有詳情:稽核在 390 量到
// /safety 同一頁兩套清單外觀一樣,工安紀錄點了有詳情、缺失點了沒反應;期限與改善說明排在
// 字串後段一定被 truncate 切掉;兩顆同名「開立缺失」(切換 vs 送出)。現在列只負責選取,
// 照片/標註、說明、工項與狀態動作全在詳情欄(桌機右欄、<lg 抽屜),與同頁的工安紀錄同形。
// 刻意不把缺失併進工安紀錄的清單:兩種資料、兩套動作、兩組 RLS,混成一列會把權限閘門弄糊。
// 這裡不掛 useListKeyboardNav:/safety 同頁已有工安紀錄的殼在聽 ↑/↓,兩份聽同一組鍵會同時
// 換兩邊的選取。
import { useState, useMemo } from 'react'
import { MSym } from './icons.jsx'
import { useStore } from '../store.jsx'
import { Card, Button, Field, Badge, BallChip, Dot, Empty, ErrorBanner, IconButton, Input, Select, Textarea, buttonClass } from './ui.jsx'
import { ListDetailLayout, SearchField, StatusChip, MetaGrid } from './listDetail.jsx'
import { useListDetailPane } from '../lib/useListDetailPane.js'
import { appConfirm, appPrompt } from './confirm.jsx'
import { exportCsv, stamp } from '../lib/exportCsv.js'
import { defectBall } from '../lib/ballInCourt.js'
import { friendlyError } from '../lib/errorMessage.js'
import { taipeiToday } from '../lib/dates.js'
import MarkupEditor, { MarkupThumb } from './MarkupEditor.jsx'

// 欄位一律用 ui.jsx 的 Input/Select/Textarea:本檔曾抄過一份 FIELD_BASE,
// 後來改抄字串別名 input——別名同樣會漏掉 Select 的箭頭留白與 Textarea 的 resize-y

// 小工項挑選器（搜尋 → 選一個;品質缺失/查驗共用）
export function WorkItemPicker({ leaves, value, label, onPick }) {
  const [q, setQ] = useState('')
  const results = q.trim() ? leaves.filter((it) => it.description.includes(q.trim()) || (it.item_no || '').includes(q.trim())).slice(0, 12) : []
  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface-2)]">
        <span className="truncate flex-1">{label}</span>
        {/* 圖示鈕統一走 IconButton。負 margin 是「吸回流內寬」的對齊手法:IconButton 方框
            桌機 32、手機 44,減掉 -m-2／-m-3.5 後流內都回到原本的 16px——命中區長大、版面不動 */}
        <IconButton name="close" label="清除已選工項" onClick={() => onPick(null, '')} className="-m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" />
      </div>
    )
  }
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋並選擇工項（可不填）…" />
      {results.length > 0 && (
        // 浮層陰影走 token(Tailwind 原生 shadow-lg 是黑色硬陰影,不吃深色模式)
        <div className="absolute z-10 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg [box-shadow:var(--shadow-overlay)] max-h-56 overflow-auto enter-menu">
          {results.map((it) => (
            <button key={it.item_key} onClick={() => { onPick(it.item_key, `${it.item_no} ${it.description}`); setQ('') }}
              className="w-full text-left px-3 py-1.5 text-sm max-md:min-h-11 hover:bg-[var(--surface-2)] truncate">
              <span className="text-[var(--text-3)] text-xs mr-2">{it.item_no}</span>{it.description}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const NEXT_LABEL = { 開立: '開始改善', 改善中: '提送複查', 待複查: '複查結案' }
// 快篩依狀態切,chip 上的字用球權標籤(defectBall):列上的 BallChip 講的就是「現在等誰」,
// chip 若改講「開立/改善中」就是同一件事兩套語彙(規範 §8:分群一律改快篩 chip)。
// 狀態值本身留給詳情欄 MetaGrid 的「狀態」列。色點與文字並存,顏色不單獨承載語意。
const STATUSES = ['開立', '改善中', '待複查', '已結案']
const STATUS_COLOR = { 開立: 'red', 改善中: 'amber', 待複查: 'purple', 已結案: 'green' }
const WHO_LABEL = { contractor: '施工廠商', supervisor: '監造' }
const DEFAULT_FILTERS = { q: '', status: '' }

export default function DefectTracker({ domain = 'quality', leaves = [] }) {
  const { defects, currentProject, currentUser, createDefect, updateDefectStatus, deleteDefect, describeDefect, analyzeSafetyPhoto, resolveMarkup, can, aiEnabled } = useStore()
  const isSafety = domain === 'safety'
  // 批 B UX:對應 AI 功能(工安=safety.photo、品質=defect.describe)關閉時藏拍照入口
  const aiPhotoOn = aiEnabled(isSafety ? 'safety.photo' : 'defect.describe')
  const list = useMemo(() => defects.filter((d) => (d.domain || 'quality') === domain), [defects, domain])
  const openCount = list.filter((d) => d.status !== '已結案').length
  const kind = isSafety ? '工安缺失' : '缺失'
  const title = isSafety ? '工安缺失追蹤' : '缺失追蹤'
  // 領域規則(C-8):品質缺失的正途是監造判查驗／自主檢查／試體不合格時「自動」開立,
  // 廠商自行開一張品質缺失不是三級品管裡存在的動作,入口留著只會讓廠商以為要自己開。
  // 工安缺失相反:廠商工安人員本就自行開立並追蹤改善,維持 can.edit||can.approve。
  // 只收前端入口——自動開立仍以廠商身分 insert,不動 RLS 也不動任何自動路徑。
  const canOpenManually = isSafety ? (can.edit || can.approve) : can.approve

  const [form, setForm] = useState(null)
  const [markupOpen, setMarkupOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState('')
  // 失敗與否用明確狀態,不用 /失敗/ 比對訊息字串決定狀態色(換句文案就漏色)
  const [aiErr, setAiErr] = useState('')
  const [errMsg, setErrMsg] = useState('') // 寫入失敗必須讓使用者看到(失敗=UI 不變)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)

  // 狀態件數走全體(不受搜尋影響):chip 上的數字是「本案有幾筆在這一站」,0 也留著——
  // 「沒有待複查」本身就是資訊。清單順序沿用 store(新開立的在最前),不另排序。
  const statusCounts = useMemo(
    () => Object.fromEntries(STATUSES.map((s) => [s, list.filter((d) => d.status === s).length])),
    [list],
  )
  const ordered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return list
      .filter((d) => !filters.status || d.status === filters.status)
      .filter((d) => !q || [d.title, d.location, d.description, d.improvement_note, d.work_item_no, d.work_item_desc, d.record_date, d.due_date]
        .some((v) => (v || '').toLowerCase().includes(q)))
  }, [list, filters])
  const anyFilter = filters.q.trim() !== '' || filters.status !== ''

  // 選取/深連結(?defect=)/切案重置/初次自動選取:共用殼 hook。param 與同頁工安紀錄的
  // ?record= 不同名,兩個殼各寫各的 query(hook 的 reset 也只刪自己的)。
  // 換選取就收掉開立表單與錯誤:表單不綁列,但留著會讓「詳情是 A、上面還在填 B」並存。
  const pid = currentProject?.project_id
  const org = currentUser?.org_type || 'contractor'
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'defect', idPrefix: 'def-',
    scope: `${pid}/${domain}/${org}`,
    ready: list.length > 0, rows: list,
    pickDefault: () => ordered[0]?.id,
    onSelect: () => setErrMsg(''),
    onReset: () => { setFilters(DEFAULT_FILTERS); setForm(null) },
  })
  // 篩選後選中項被篩掉:詳情內容保留(與 /safety 工安紀錄同),清單中只是沒有高亮列
  const selected = list.find((d) => d.id === selectedId) || null

  const emptyForm = () => ({
    title: '', description: '', severity: '一般', location: '', due_date: '',
    work_item_key: '', work_item_label: '', ...(isSafety ? { record_date: taipeiToday() } : {}),
  })

  // 拍缺失照片 → AI 填表。品質缺失=describe-defect(描述缺失);
  // 工安缺失=analyze-safety-photo(職安衛法規判讀:危害類別+違反法規依據+建議)。
  const onPhoto = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setAiBusy(true); setAiErr(''); setAiMsg(isSafety ? 'AI 判讀職安衛中…' : 'AI 辨識中…')
    const { error, result } = await (isSafety ? analyzeSafetyPhoto(file) : describeDefect(file))
    setAiBusy(false)
    if (error) { setAiMsg(''); setAiErr(friendlyError(error, isSafety ? 'AI 判讀失敗' : 'AI 辨識失敗')); return }
    if (isSafety) {
      // 危害類別 + 現況 + 違反法規依據 + 改善建議,組成 grounded 的工安缺失說明
      const desc = [
        result.description,
        result.violated_regulation && `依據:${result.violated_regulation}`,
        result.suggestion && `建議:${result.suggestion}`,
      ].filter(Boolean).join(' ')
      setForm((f) => ({
        ...f,
        title: result.title || f.title,
        description: desc || f.description,
        severity: result.severity || f.severity,
        location: f.location || result.location || '',
      }))
      setAiMsg(result.has_violation && result.title
        ? `AI 判讀:【${result.hazard_type}】${result.violated_regulation || ''}｜已填入，請確認後送出(法條條號請現場核對)。`
        : 'AI 未判讀出明顯職安衛危害;如仍要開立請人工填寫。')
      return
    }
    setForm((f) => ({
      ...f,
      title: result.title || f.title,
      description: [result.description, result.suggestion && `建議:${result.suggestion}`].filter(Boolean).join(' '),
      severity: result.severity || f.severity,
      location: f.location || result.location || '',
    }))
    setAiMsg(result.title ? 'AI 已填入，請確認後送出。' : 'AI 未辨識出明顯缺失，請人工填寫。')
  }

  const submit = async () => {
    setErrMsg(''); setBusy(true)
    const { error } = await createDefect({ ...form, domain })
    setBusy(false)
    if (error) { setErrMsg(friendlyError(error, '缺失未開立')); return }
    setForm(null)
  }

  const advance = async (d) => {
    let res
    if (d.status === '開立') res = await updateDefectStatus(d.id, '改善中')
    else if (d.status === '改善中') {
      const note = await appPrompt({
        title: `提送複查：${d.title}`, label: '改善說明（必填）',
        defaultValue: d.improvement_note || '', required: true, confirmLabel: '提送複查',
      })
      if (note === null) return
      res = await updateDefectStatus(d.id, '待複查', { improvement_note: note })
    }
    else if (d.status === '待複查') res = await updateDefectStatus(d.id, '已結案')
    if (res?.error) setErrMsg(friendlyError(res.error, '缺失狀態未更新'))
  }

  // 退回=監造把待複查退回改善中(改版前列內直接呼叫、沒接錯誤;現在與其他動作一樣進 ErrorBanner)
  const sendBack = async (d) => {
    const res = await updateDefectStatus(d.id, '改善中')
    if (res?.error) setErrMsg(friendlyError(res.error, '缺失退回未完成'))
  }

  // 撤銷結案=監造附原因(伺服器留 defect_audits 稽核;已結案不可直接刪改)
  const reopen = async (d) => {
    const reason = await appPrompt({
      title: `撤銷結案：${d.title}`, label: '更正原因（必填，留存稽核）',
      required: true, danger: true, confirmLabel: '撤銷結案',
    })
    if (reason === null) return
    const res = await updateDefectStatus(d.id, '改善中', { correction_reason: reason })
    if (res?.error) setErrMsg(friendlyError(res.error, '撤銷結案未完成'))
  }

  const remove = async (d) => {
    if (!await appConfirm({ title: `刪除此${kind}？`, danger: true, confirmLabel: '刪除' })) return
    setErrMsg('')
    const { error } = await deleteDefect(d.id)
    if (error) setErrMsg(friendlyError(error, '缺失刪除被拒絕'))
    else closeDetail() // <lg 抽屜承載的正是這筆,刪掉後不留 detailOpen 殘值
  }

  const csvCols = [
    { key: 'title', label: '缺失標題' },
    ...(isSafety ? [{ key: 'record_date', label: '發現日' }] : [{ key: 'work_item_no', label: '工項' }]),
    { key: 'location', label: '位置' }, { key: 'severity', label: '嚴重度' }, { key: 'status', label: '狀態' },
    { key: 'due_date', label: '改善期限' }, { key: 'improvement_note', label: '改善說明' },
  ]

  // ── 詳情欄:狀態列 / 標題 / key-value / 說明＋標註 / 改善說明 / 更正紀錄 / 動作列。
  // 動作條件與改版前列內動作一字不改(對照:開始改善・提送複查=未結案且非待複查∧can.edit;
  // 退回・複查結案=待複查∧can.approve;撤銷結案=已結案∧can.approve;刪除=can.edit∧未結案),
  // 只是從列尾搬到詳情欄底部。等待文案(待廠商改善/待監造複查)同樣搬過來。
  let detailBody = null
  if (selected) {
    const d = selected
    const ball = defectBall(d)
    const closed = d.status === '已結案'
    const contractorStep = !closed && d.status !== '待複查' // 開立 / 改善中
    const reviewStep = d.status === '待複查'
    const canAdvance = contractorStep && can.edit
    const canReview = reviewStep && can.approve
    const canReopen = closed && can.approve
    const canDelete = can.edit && !closed
    const waitingContractor = contractorStep && !can.edit
    const waitingSupervisor = reviewStep && !can.approve
    const hasActions = canAdvance || canReview || canReopen || canDelete || waitingContractor || waitingSupervisor
    // region 以種類命名(缺失沒有編號):報讀器走地標聽到「工安缺失詳情」,e2e 用同一個名字
    // 確認動作真的在詳情欄裡
    detailBody = (
      <section aria-label={`${kind}詳情`}>
        {/* 狀態列:球權＋嚴重＋已更正;顏色＋文字並存 */}
        <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <BallChip ball={ball} />
          {d.severity === '嚴重' && <Badge color="red">嚴重</Badge>}
          {d.correction_reason && <Badge color="amber">已更正</Badge>}
        </div>

        <div className="p-4">
          <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{d.title}</div>
          {/* 空值一律顯示 —:格子固定,眼睛掃同一位置就知道有沒有填。開立人 DB 只有 created_by
              的 uuid、demo 沒有,顯示不出名字,所以給開立日(created_at,demo 為 —) */}
          <MetaGrid className="mt-3.5" rows={[
            ['狀態', d.status || '—'],
            ['責任方', WHO_LABEL[ball.who] || '—'],
            ['嚴重度', d.severity || '—'],
            ['位置', d.location || '—'],
            isSafety
              ? ['發現日', d.record_date || '—']
              : ['工項', d.work_item_no ? `${d.work_item_no} ${d.work_item_desc || ''}`.trim() : '—'],
            ['改善期限', d.due_date || '—'],
            ['開立日', d.created_at ? String(d.created_at).slice(0, 10) : '—'],
          ]} />
        </div>

        {/* 說明(AI 拍照填入或人工填寫)＋圖面/照片標註:完整顯示、保留換行,這是這一筆的內容本體 */}
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <MSym name="description" size={15} className="text-[var(--text-3)]" />
            <span className="text-footnote font-medium text-[var(--text)]">缺失說明</span>
          </div>
          <p className="text-body leading-[1.8] text-[var(--text)] whitespace-pre-line break-words">{d.description || '（未填寫）'}</p>
          {d.markup_path && <div className="mt-2.5"><MarkupThumb src={d.markup_path} resolve={resolveMarkup} /></div>}
        </div>

        {/* 改善說明:廠商提送複查時填的,用 --blue-tint 底與說明分開(不靠顏色單獨承載,小標同在) */}
        {d.improvement_note && (
          <div className="px-4 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <MSym name="build" size={15} className="text-[var(--text-3)]" />
              <span className="text-footnote font-medium text-[var(--text)]">廠商改善說明</span>
            </div>
            <p className="text-body leading-[1.8] text-[var(--text)] whitespace-pre-line break-words bg-[var(--blue-tint)] border border-[var(--border-2)] rounded-lg px-3 py-2">{d.improvement_note}</p>
          </div>
        )}

        {/* 更正紀錄:稽核軌跡要看得見(規範 §1 三條不可退讓),不折進說明裡 */}
        {d.correction_reason && (
          <div className="px-4 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <MSym name="history" size={15} className="text-[var(--text-3)]" />
              <span className="text-footnote font-medium text-[var(--text)]">更正紀錄</span>
            </div>
            <p className="text-footnote leading-relaxed text-[var(--text-2)] bg-[var(--surface-2)] rounded-lg px-3 py-2">
              撤銷結案原因:{d.correction_reason}
            </p>
          </div>
        )}

        {/* 動作列:改善鏈=廠商(開始改善/提送複查);複查結案/退回只有監造能按;已結案只留撤銷結案。
            同一時間最多一顆實心鈕(複查結案) */}
        {hasActions && (
          <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
            {canAdvance && <Button variant="secondary" onClick={() => advance(d)} disabled={busy}>{NEXT_LABEL[d.status]}</Button>}
            {waitingContractor && <span className="text-footnote text-[var(--text-2)]">待廠商改善</span>}
            {canReview && <>
              <Button variant="ghost" onClick={() => sendBack(d)} disabled={busy}>退回</Button>
              <Button variant="success" onClick={() => advance(d)} disabled={busy}>複查結案</Button>
            </>}
            {waitingSupervisor && <span className="text-footnote text-[var(--text-2)]">待監造複查</span>}
            {canReopen && <Button variant="ghost" onClick={() => reopen(d)} disabled={busy}>撤銷結案</Button>}
            {canDelete && (
              // IconButton 給滿 44×44,負 margin 吸回流內寬;ml-auto 靠右與主動作拉開
              <IconButton name="close" label="刪除缺失" onClick={() => remove(d)} className="ml-auto -m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" />
            )}
          </div>
        )}
      </section>
    )
  }

  // ── 開立表單:住在卡頭鈕下方、清單上方(照現況展開,不開對話框)。
  // 表單一併吃 canOpenManually:權限變動(切正式模式/換角色)時殘留的展開表單不可以還留在
  // 畫面上——藏鈕不藏表單等於沒藏。卡頭鈕叫「開立缺失」、表單送出叫「送出缺失」:
  // 改版前兩顆同名,報讀器與 e2e 都分不出哪顆是切換、哪顆是送出。
  const openForm = canOpenManually && form && (
    <div className="p-5 border-b border-[var(--border-2)]">
      <div className="bg-[var(--surface-2)] rounded-lg p-4 space-y-3">
        {aiPhotoOn ? (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <label className={`${buttonClass('primary', 'sm')} ${aiBusy ? 'opacity-50' : 'cursor-pointer'}`}>
                <input type="file" accept="image/*" capture="environment" disabled={aiBusy} onChange={onPhoto} className="hidden" />
                <MSym name="photo_camera" size={15} /> {aiBusy ? (isSafety ? 'AI 判讀中…' : 'AI 辨識中…') : (isSafety ? '拍工安照片 AI 判讀' : '拍缺失照片 AI 填表')}
              </label>
              <span className="text-xs text-[var(--text-2)]">{aiMsg || (isSafety ? '拍現場照片，AI 依職安衛法規判讀危害類別、違反依據並填表(條號請現場核對)。' : '拍缺失現場，AI 自動填標題/說明/嚴重度。')}</span>
            </div>
            {/* AI 判讀失敗=寫入失敗以外的另一種失敗,同樣走 ErrorBanner,不再用紅字小字 */}
            <ErrorBanner msg={aiErr} onClose={() => setAiErr('')} />
          </>
        ) : (
          <p className="text-caption text-[var(--text-3)]">此 AI 功能未啟用（{isSafety ? '工安照片判讀' : '缺失照片描述'}），請人工填寫下方欄位。</p>
        )}
        {!isSafety && leaves.length > 0 && (
          <WorkItemPicker leaves={leaves} value={form.work_item_key} label={form.work_item_label}
            onPick={(k, l) => setForm((f) => ({ ...f, work_item_key: k || '', work_item_label: l }))} />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="缺失標題"><Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder={isSafety ? '如 施工架未掛安全網' : '如 鋼筋保護層不足'} /></Field>
          <Field label="位置"><Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} /></Field>
          <Field label="嚴重度"><Select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}><option>輕微</option><option>一般</option><option>嚴重</option></Select></Field>
          <Field label="改善期限"><Input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} /></Field>
          {isSafety && <Field label="發現日期"><Input type="date" value={form.record_date} onChange={(e) => setForm((f) => ({ ...f, record_date: e.target.value }))} /></Field>}
        </div>
        <Field label="說明"><Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={submit} disabled={busy || !form.title}>送出缺失</Button>
          <Button variant="secondary" onClick={() => setMarkupOpen(true)}><MSym name="draw" size={16} />圖面/照片標註{form.markup_data ? '（已附）' : ''}</Button>
          {form.markup_data && <MarkupThumb src={form.markup_data} />}
        </div>
        {markupOpen && <MarkupEditor title="把缺失位置匡起來" initialImage={form.markup_data}
          onSave={(d) => { setForm((f) => ({ ...f, markup_data: d })); setMarkupOpen(false) }} onClose={() => setMarkupOpen(false)} />}
      </div>
    </div>
  )

  // ── 左欄卡頭下方:搜尋 + 四站快篩(件數走全體),兩條件 AND
  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋標題、位置、說明…" aria-label={`搜尋${kind}`} />
      <div className="flex items-center gap-2 flex-wrap">
        {STATUSES.map((s) => (
          <StatusChip key={s} active={filters.status === s} count={statusCounts[s]}
            onClick={() => setFilters((f) => ({ ...f, status: f.status === s ? '' : s }))}>
            <Dot color={STATUS_COLOR[s]} />{defectBall({ status: s }).label}
          </StatusChip>
        ))}
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>清除篩選</Button>
        )}
      </div>
    </div>
  )

  // ── 清單列:只負責選取(動作全在詳情欄),兩行=標題＋球權＋嚴重 / meta。
  // role=listitem + aria-current 與工安紀錄同一套選取語意(e2e 用 getByRole('listitem') 鎖列);
  // <div role="list"> 而不是 <ul>:列是 button,ul 只能裝 li。
  const listRows = (
    <div role="list" aria-label={`${kind}清單`} className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的{kind}。<br />換一個狀態,或試試標題、位置、說明關鍵字。
        </div>
      ) : ordered.map((d) => {
        const active = d.id === selectedId
        const meta = [isSafety ? d.record_date : d.work_item_no, d.location, d.due_date ? `期限 ${d.due_date}` : ''].filter(Boolean).join(' · ')
        return (
          <button key={d.id} type="button" role="listitem" id={`def-${d.id}`}
            aria-current={active || undefined}
            onClick={() => select(d.id, { openPane: true })}
            className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer ${active
              ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
            <span className="flex items-center gap-2 flex-wrap">
              <span className="text-body text-[var(--text)] min-w-0 [text-wrap:pretty]">{d.title}</span>
              <BallChip ball={defectBall(d)} />
              {d.severity === '嚴重' && <Badge color="red">嚴重</Badge>}
              {d.correction_reason && <Badge color="amber">已更正</Badge>}
            </span>
            {meta && <span className="block mt-0.5 num text-caption text-[var(--text-3)] truncate">{meta}</span>}
          </button>
        )
      })}
    </div>
  )

  const card = (
    <Card title={`${title}（未結案 ${openCount}）`} bodyClass="p-0" action={<div className="flex items-center gap-3">
      {/* 第三級=純文字連結色 --blue-text(--blue 只作底色/邊框);符號 ⬇ 改 MSym */}
      {list.length > 0 && <button onClick={() => exportCsv(`${kind}清單_${stamp()}`, list, csvCols)}
        className="inline-flex items-center gap-1 max-md:min-h-11 text-sm font-medium text-[var(--blue-text)] hover:underline"><MSym name="download" size={16} />CSV</button>}
      {canOpenManually && (
        <Button variant="secondary" onClick={() => { setForm(form ? null : emptyForm()); setAiMsg(''); setAiErr('') }}>{form ? '取消' : <><MSym name="add" size={16} />開立缺失</>}</Button>
      )}
    </div>}>
      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} className="mx-5 mt-4" />
      {openForm}
      {list.length === 0 ? <Empty>尚無{kind}</Empty> : <>{filterBar}{listRows}</>}
      <p className="px-5 py-3 border-t border-[var(--border-2)] text-caption text-[var(--text-3)] leading-relaxed">
        {isSafety
          ? '工安缺失與品質缺失共用同一套改善狀態機：開立 → 廠商改善 → 提送複查 → 監造複查結案。已結案不可刪除，撤銷結案須附原因並留存稽核。'
          : '品質缺失由監造判查驗不合格、或自主檢查表／試體判定不合格時自動開立，廠商不自行開立。缺失改善鏈：開立 → 廠商改善 → 提送複查 → 監造複查結案。已結案不可刪除，撤銷結案須附原因並留存稽核。'}
      </p>
    </Card>
  )

  // 一筆都沒有就不套殼:右欄「點左側清單」對著空清單是廢話,開立表單仍在卡裡
  if (list.length === 0) return card
  return (
    <ListDetailLayout
      detail={detailBody}
      detailLabel={`${kind}詳情`}
      detailEmpty={<Empty>點左側清單查看{kind}詳情。</Empty>}
      drawerOpen={detailOpen && !!selected}
      onDrawerClose={closeDetail}>
      {card}
    </ListDetailLayout>
  )
}
