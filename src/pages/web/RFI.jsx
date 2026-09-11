import { useState, useMemo, useRef } from 'react'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import MarkupEditor, { MarkupThumb } from '../../components/MarkupEditor.jsx'
import { Card, Button, Field, Input, Textarea, Badge, BallChip, Dot, Empty, PageHeader, ErrorBanner } from '../../components/ui.jsx'
import { ListDetailLayout, SearchField, StatusChip, MetaGrid } from '../../components/listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm, appPrompt } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { rfiBall } from '../../lib/ballInCourt.js'
import { taipeiToday } from '../../lib/dates.js'

// 版面:改版前每筆 RFI 是一張卡,問與答被 line-clamp-3 截斷、五顆動作鈕擠在卡右側——
// 疑義的本體就是那段問答,截斷等於把內容藏起來;動作離它影響的問答又隔了一整張卡的寬
// (判準第 3、4 條)。現在是一份清單(只負責選取)＋詳情欄:問答完整顯示、動作貼在
// 問答底下,詳情永遠在同一個位置(規範 §0 疊合版)。回覆仍走 appPrompt 對話框——
// 那是共用的「必填一段文字」互動,要不要搬進詳情欄是另一個決策,本波不動。
//
// 球權快篩:三段對應 rfis.status 的三個值,標籤講「輪到誰」而不是講狀態名
// (待回覆/已回覆是資料庫字串,對現場的人沒有「該催誰」的意思)。單選、再點取消,
// 與 /safety 的型別快篩同一手感。圓點色鏡像 ui.jsx BallChip 的責任方色
// (監造=amber、廠商=blue、結束=green);BALL_COLOR 沒有 export、本波不動 ui.jsx。
const BALL_FILTERS = [
  { status: '待回覆', label: '待監造回覆', color: 'amber' },
  { status: '已回覆', label: '待廠商確認結案', color: 'blue' },
  { status: '已結案', label: '已結案', color: 'green' },
]
const DEFAULT_FILTERS = { q: '', status: '' }
const CSV_COLUMNS = [
  { key: 'rfi_no', label: '編號' }, { key: 'title', label: '主旨' }, { key: 'status', label: '狀態' },
  { key: 'question', label: '疑義內容' }, { key: 'answer', label: '回覆' },
  { key: 'asked_date', label: '提出日' }, { key: 'due_date', label: '期限' }, { key: 'answered_date', label: '回覆日' },
]
const blankForm = () => ({ title: '', question: '', asked_date: taipeiToday(), due_date: '', cost_impact: false, schedule_impact: false })
// 工期/費用影響標記:清單列與詳情狀態列同一組,顏色＋文字並存
const impactBadges = (r) => (<>
  {r.schedule_impact && <Badge color="amber">工期</Badge>}
  {r.cost_impact && <Badge color="red">費用</Badge>}
</>)

export default function RFI() {
  const { rfis, createRfi, answerRfi, closeRfi, deleteRfi, draftRfiReply, resolveMarkup,
    isSupabaseConfigured, currentProject, currentUser, can, aiEnabled } = useStore()
  const [markupOpen, setMarkupOpen] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 回覆/結案寫入失敗必須讓使用者看到(失敗=UI 不變)
  const [aiDraft, setAiDraft] = useState({}) // { [rfiId]: result } AI 回覆草稿
  const [draftBusy, setDraftBusy] = useState(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const searchRef = useRef(null)

  const org = currentUser?.org_type || 'contractor'
  const aiOn = aiEnabled('rfi.draft_reply')

  // 件數走全體(不受搜尋影響):chip 上的數字是「本案有幾筆輪到這一方」,0 也保留
  const counts = useMemo(
    () => Object.fromEntries(BALL_FILTERS.map((f) => [f.status, rfis.filter((r) => r.status === f.status).length])),
    [rfis],
  )
  // 目前畫面上的清單:球權 AND 關鍵字(編號/主旨/問/答)。順序沿用 store
  // (created_at 新→舊、新提出的插在最前),不另外排序——這裡不該與其他頁對同一批
  // 資料給出兩種順序。
  const ordered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return rfis
      .filter((r) => !filters.status || r.status === filters.status)
      .filter((r) => !q || [r.rfi_no, r.title, r.question, r.answer].some((v) => (v || '').toLowerCase().includes(q)))
  }, [rfis, filters])
  const anyFilter = filters.q.trim() !== '' || filters.status !== ''

  // 選取/深連結(?rfi=)/切案重置/初次自動選取:共用殼 hook。預設選「球在我手上」的
  // 第一筆(開頁就看到該做的事),沒有就選清單第一筆。
  const pid = currentProject?.project_id
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'rfi', idPrefix: 'rfi-',
    scope: `${pid}/${org}`,
    ready: rfis.length > 0, rows: rfis,
    pickDefault: () => (ordered.find((r) => rfiBall(r).who === org) || ordered[0])?.id,
    onSelect: () => setErrMsg(''),
    onReset: () => setFilters(DEFAULT_FILTERS),
  })
  // 篩選後選中項被篩掉:右欄內容保留(與 /safety 同),清單中只是沒有高亮列
  const selected = rfis.find((r) => r.id === selectedId) || null
  // 鍵盤:↑/↓ 移動選取、/ 聚焦搜尋。提出疑義表單開著就停用——焦點落在表單按鈕上
  // 按 ↓ 會換選取,打到一半的疑義內容雖不會消失,但畫面焦點會跑掉。
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'rfi-', modalUp: !!form, searchRef })

  // 早退也保留 PageHeader:頁首與工作面分頁不該因為「還沒選專案」整組消失
  if (isSupabaseConfigured && !currentProject) {
    return (
      <div className="space-y-5">
        <PageHeader title="工程疑義" tagline="RFI" subtitle="施工提出疑義 → 監造回覆 → 結案；可標註工期 / 費用影響" />
        <Card title="工程疑義" bodyClass="p-0"><Empty>請先登入並選擇專案。</Empty></Card>
      </div>
    )
  }

  const submit = async () => {
    setBusy(true); await createRfi(form); setBusy(false); setForm(null)
  }
  const onAnswer = async (r) => {
    const ans = await appPrompt({
      title: `回覆：${r.rfi_no}`, body: r.question || r.title,
      // AI 草稿已備妥 → 帶入為預設(監造仍可改)
      label: '回覆內容（必填）', defaultValue: aiDraft[r.id]?.answer || r.answer || '', required: true, confirmLabel: '送出回覆',
    })
    if (ans === null) return
    setErrMsg(''); setBusy(true)
    const { error } = await answerRfi(r.id, ans.trim())
    setBusy(false)
    if (error) setErrMsg(friendlyError(error, '回覆未寫入'))
    else setAiDraft((m) => { const n = { ...m }; delete n[r.id]; return n }) // 回覆後收起草稿
  }

  // AI 回覆草稿:依契約規範/工項草擬監造回覆
  const onDraft = async (r) => {
    setDraftBusy(r.id); setErrMsg('')
    const { error, result } = await draftRfiReply(r)
    setDraftBusy(null)
    if (error) { setErrMsg(friendlyError(error, 'AI 回覆草稿失敗')); return }
    setAiDraft((m) => ({ ...m, [r.id]: result }))
  }
  const closeDraft = (id) => setAiDraft((m) => { const n = { ...m }; delete n[id]; return n })
  const onClose = async (r) => {
    setErrMsg(''); setBusy(true)
    const { error } = await closeRfi(r.id)
    setBusy(false)
    if (error) setErrMsg(friendlyError(error, '結案未寫入'))
  }
  const onDelete = async (r) => {
    if (!(await appConfirm({ title: '刪除此疑義？', danger: true, confirmLabel: '刪除' }))) return
    setErrMsg('')
    const { error } = await deleteRfi(r.id)
    if (error) setErrMsg(friendlyError(error, 'RFI 刪除未完成'))
    else closeDetail() // <lg 抽屜承載的正是這筆,刪掉後不留 detailOpen 殘值
  }

  const exportRows = () => exportCsv(`工程疑義_${stamp()}`, rfis, CSV_COLUMNS)

  // ── 詳情欄:狀態列 / 標題與 meta / 問 / 答 / 圖面標註 / AI 草稿 / 動作列。
  // 動作條件與改版前列內動作逐條相同,一條都沒放寬(伺服器 rfis_guard 兜底):
  //   canReply      = 待回覆 ∧ can.approve            → 回覆
  //   waitingReply  = 待回覆 ∧ ¬can.approve           → 「待監造回覆」等待字樣
  //   canClose      = 已回覆 ∧ can.submit             → 確認結案
  //   canSupplement = 已回覆 ∧ ¬can.submit ∧ can.approve → 補充回覆
  //   draftEligible = can.approve ∧ (待回覆 ∨ 已回覆)  → AI 草稿鈕(功能開且尚無草稿)
  //                                                      / 「AI 回覆草稿未啟用」(功能關)
  //   canDelete     = can.submit ∧ 待回覆             → 刪除(已回覆=履約證據,DB 另有 guard)
  let detailBody = null
  if (selected) {
    const r = selected
    const replyable = r.status === '待回覆' || r.status === '已回覆'
    const canReply = r.status === '待回覆' && can.approve
    const waitingReply = r.status === '待回覆' && !can.approve
    const canClose = r.status === '已回覆' && can.submit
    const canSupplement = r.status === '已回覆' && !can.submit && can.approve
    const draftEligible = can.approve && replyable
    const canDelete = can.submit && r.status === '待回覆'
    const draft = aiDraft[r.id]
    // region 以編號命名:報讀器走地標時直接聽到「RFI-002 詳情」,e2e 也用同一個名字
    // 確認詳情欄正在顯示哪一筆
    detailBody = (
      <section aria-label={`${r.rfi_no} 詳情`}>
        {/* 狀態列:球權＋工期/費用;顏色＋文字並存 */}
        <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <BallChip ball={rfiBall(r)} />
          {impactBadges(r)}
        </div>

        <div className="p-4">
          <div className="num text-caption text-[var(--text-3)]">{r.rfi_no}</div>
          <div className="mt-0.5 text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{r.title}</div>
          {/* 空值一律顯示 —:四格固定,眼睛掃同一位置就知道有沒有填 */}
          <MetaGrid className="mt-3.5" rows={[
            ['提出日', r.asked_date || '—'],
            ['回覆期限', r.due_date || '—'],
            ['回覆日', r.answered_date || '—'],
            ['影響', [r.schedule_impact && '工期', r.cost_impact && '費用'].filter(Boolean).join('、') || '—'],
          ]} />
        </div>

        {/* 問與答:完整顯示、保留換行,不再 line-clamp——這兩段就是這一頁的內容本體。
            答案用 --blue-tint 底與問題分開(沿用改版前「答:」的藍色身分),不靠顏色單獨
            承載語意,小標「監造回覆」同時在。 */}
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <MSym name="help" size={15} className="text-[var(--text-3)]" />
            <span className="text-footnote font-medium text-[var(--text)]">疑義內容</span>
          </div>
          <p className="text-body leading-[1.8] text-[var(--text)] whitespace-pre-line break-words">{r.question || '（未填寫）'}</p>
          {r.markup_path && <div className="mt-2.5"><MarkupThumb src={r.markup_path} resolve={resolveMarkup} /></div>}
        </div>
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <MSym name="rate_review" size={15} className="text-[var(--text-3)]" />
            <span className="text-footnote font-medium text-[var(--text)]">監造回覆</span>
          </div>
          {r.answer ? (
            <p className="text-body leading-[1.8] text-[var(--text)] whitespace-pre-line break-words bg-[var(--blue-tint)] border border-[var(--border-2)] rounded-lg px-3 py-2">{r.answer}</p>
          ) : (
            <p className="text-footnote text-[var(--text-3)]">尚未回覆。</p>
          )}
        </div>

        {/* 監造:AI 回覆草稿——依契約規範草擬回覆,涉設計判斷會提示轉設計釋疑。
            草稿只是草稿:按「回覆/補充回覆」才帶入對話框,最終內容由監造裁量 */}
        {draft && (
          <div className="px-4 pb-4">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="text-footnote font-medium text-[var(--text)] inline-flex items-center gap-1.5 flex-wrap">
                <MSym name="auto_awesome" size={14} className="text-[var(--blue)]" />AI 回覆草稿
                {draft.needs_designer && <Badge color="amber">建議轉設計釋疑</Badge>}
                {draft.schedule_impact && <Badge color="amber">工期</Badge>}
                {draft.cost_impact && <Badge color="red">費用</Badge>}
              </div>
              {/* 收起不是破壞性動作:共用 Button 的第三級 */}
              <Button variant="ghost" size="sm" onClick={() => closeDraft(r.id)}>收起</Button>
            </div>
            {/* 底色走 --blue-tint 原值:對 --blue 加 4%/20% 是自製色階,深色模式下 --blue 是淺藍會失真 */}
            <p className="text-body leading-relaxed text-[var(--text-2)] bg-[var(--blue-tint)] border border-[var(--border-2)] rounded-lg px-3 py-2 whitespace-pre-line">{draft.answer}</p>
            <div className="text-caption text-[var(--text-3)] mt-1">依據：{draft.basis || '—'}{draft.caution ? ` ｜ ${draft.caution}` : ''}</div>
            <p className="text-caption text-[var(--text-3)] mt-1">按下方「{r.status === '待回覆' ? '回覆' : '補充回覆'}」會自動帶入此草稿供修改；回覆為正式契約文件，最終內容由監造裁量。</p>
          </div>
        )}

        {/* 動作列:同一時間最多一顆實心鈕(確認結案);其餘次級/第三級。
            批 B UX:AI 功能關閉時藏按鈕、留簡短說明(真正的閘門在伺服器端) */}
        <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
          {canReply && <Button variant="secondary" disabled={busy} onClick={() => onAnswer(r)}>回覆</Button>}
          {waitingReply && <span className="text-footnote text-[var(--text-2)]">待監造回覆</span>}
          {canClose && <Button variant="success" disabled={busy} onClick={() => onClose(r)}>確認結案</Button>}
          {canSupplement && <Button variant="secondary" disabled={busy} onClick={() => onAnswer(r)}>補充回覆</Button>}
          {draftEligible && aiOn && !draft && (
            <Button variant="secondary" disabled={draftBusy === r.id} onClick={() => onDraft(r)}>
              <MSym name="auto_awesome" size={13} />{draftBusy === r.id ? ' AI 草擬中…' : ' AI 回覆草稿'}
            </Button>
          )}
          {draftEligible && !aiOn && <span className="text-footnote text-[var(--text-2)]">AI 回覆草稿未啟用</span>}
          {/* 灰轉紅文字鈕不在三級語言內,改共用 Button 的第三級(順帶拿到 44px 觸控高度);
              ml-auto 靠右與主動作拉開 */}
          {canDelete && <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onDelete(r)}>刪除</Button>}
        </div>
      </section>
    )
  }

  // ── 左欄卡頭下方:搜尋 + 三段球權快篩(件數走全體),兩條件 AND
  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋編號、主旨、問答內容…" aria-label="搜尋工程疑義" />
      <div className="flex items-center gap-2 flex-wrap">
        {BALL_FILTERS.map((f) => (
          <StatusChip key={f.status} active={filters.status === f.status} count={counts[f.status]}
            onClick={() => setFilters((x) => ({ ...x, status: x.status === f.status ? '' : f.status }))}>
            <Dot color={f.color} />{f.label}
          </StatusChip>
        ))}
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>清除篩選</Button>
        )}
      </div>
    </div>
  )

  // ── 清單列:只負責選取(動作全在詳情欄),兩行=編號＋主旨＋球權＋影響 / 日期 meta。
  // role=listitem + aria-current 與 /safety 同一套選取語意。
  const listRows = (
    <div role="list" aria-label="疑義清單" className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的疑義。<br />換一段球權,或試試編號、主旨、問答關鍵字。
        </div>
      ) : ordered.map((r) => {
        const active = r.id === selectedId
        return (
          <button key={r.id} type="button" role="listitem" id={`rfi-${r.id}`}
            aria-current={active || undefined}
            onClick={() => select(r.id, { openPane: true })}
            className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer ${active
              ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
            <span className="flex items-center gap-2 flex-wrap">
              <span className="num text-caption text-[var(--text-3)]">{r.rfi_no}</span>
              <span className="text-body text-[var(--text)] min-w-0 [text-wrap:pretty]">{r.title}</span>
              <BallChip ball={rfiBall(r)} />
              {impactBadges(r)}
            </span>
            <span className="block mt-0.5 num text-caption text-[var(--text-3)] truncate">
              {[`提出 ${r.asked_date || '—'}`, r.due_date ? `期限 ${r.due_date}` : '', r.answered_date ? `回覆 ${r.answered_date}` : ''].filter(Boolean).join(' · ')}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-5">
      <PageHeader title="工程疑義" tagline="RFI" subtitle="施工提出疑義 → 監造回覆 → 結案；可標註工期 / 費用影響"
        action={
          <div className="flex items-center gap-2">
            {rfis.length > 0 && <Button variant="ghost" onClick={exportRows}><MSym name="download" size={16} />CSV</Button>}
            {can.submit && <Button variant="secondary" onClick={() => setForm(form ? null : blankForm())}>{form ? '取消' : <><MSym name="add" size={16} />提出疑義</>}</Button>}
          </div>
        } />

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      {form && (
        <Card>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2"><Field label="主旨"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 3F 樑柱接頭鋼筋與機電套管衝突" /></Field></div>
            <div className="md:col-span-2"><Field label="疑義內容"><Textarea rows={3} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="描述現場狀況、涉及圖說編號、請釋疑的事項…" /></Field></div>
            <Field label="提出日"><Input type="date" value={form.asked_date} onChange={(e) => setForm({ ...form, asked_date: e.target.value })} /></Field>
            <Field label="希望回覆期限"><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
            {/* 原生 checkbox 預設約 13px,是全站最小的互動元素;w-5 h-5 提到 20px,外層 label 補 44px 命中區 */}
            <label className="flex items-center gap-2 text-sm max-md:min-h-11"><input type="checkbox" className="w-5 h-5" checked={form.schedule_impact} onChange={(e) => setForm({ ...form, schedule_impact: e.target.checked })} />涉及工期影響</label>
            <label className="flex items-center gap-2 text-sm max-md:min-h-11"><input type="checkbox" className="w-5 h-5" checked={form.cost_impact} onChange={(e) => setForm({ ...form, cost_impact: e.target.checked })} />涉及費用影響</label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={submit} disabled={busy || !form.title}>{busy ? '提出中…' : '提出疑義'}</Button>
            <Button variant="secondary" onClick={() => setMarkupOpen(true)}><MSym name="draw" size={16} />圖面標註{form.markup_data ? '（已附）' : ''}</Button>
            {form.markup_data && <MarkupThumb src={form.markup_data} />}
          </div>
          {markupOpen && <MarkupEditor title="把圖面有疑義的位置匡起來" initialImage={form.markup_data}
            onSave={(d) => { setForm({ ...form, markup_data: d }); setMarkupOpen(false) }} onClose={() => setMarkupOpen(false)} />}
        </Card>
      )}

      {rfis.length === 0 ? (
        <Card title="疑義清單" bodyClass="p-0"><Empty>尚無工程疑義。施工遇圖說不明或現場衝突可提出，監造回覆後結案。</Empty></Card>
      ) : (
        <ListDetailLayout
          detail={detailBody}
          detailLabel="疑義詳情"
          detailEmpty={<Empty>點左側清單查看疑義的完整問答。</Empty>}
          drawerOpen={detailOpen && !!selected}
          onDrawerClose={closeDetail}>
          {/* ── 左欄:一份清單(右欄與抽屜由殼統一,見 components/listDetail.jsx)。
              「待回覆 N」不再進卡標題:三段球權件數都在快篩 chip 上,同一個數字不寫兩次 */}
          <Card title={`疑義清單（${rfis.length}）`} bodyClass="p-0">
            {filterBar}
            {listRows}
          </Card>
        </ListDetailLayout>
      )}

      <p className="text-xs text-[var(--text-3)] leading-relaxed">工程疑義（RFI）：施工遇圖說不明、現場衝突或需設計釋疑時正式提出，監造/設計回覆後由施工確認結案；標註工期/費用影響者，後續可作為變更設計或展延的依據。</p>
    </div>
  )
}
