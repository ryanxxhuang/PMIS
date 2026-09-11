import { useState, useMemo, useRef } from 'react'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Input, Select, Textarea, buttonClass, Badge, BallChip, Dot, Empty, PageHeader, ErrorBanner } from '../../components/ui.jsx'
import { ListDetailLayout, SearchField, StatusChip, MetaGrid } from '../../components/listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm, appPrompt } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { submittalBall } from '../../lib/ballInCourt.js'
import { taipeiToday } from '../../lib/dates.js'

// 版面:改版前每筆送審是一張卡,分成「待我處理／等待對方／已完成」三段各疊一疊——
// 附件、審查意見、AI 助手面板與五顆審定鈕全攤在卡上,AI 面板一開就把下面的卡推走;
// 審定鈕離它影響的審查意見隔了一整張卡的寬(判準第 3、4 條)。現在是一份清單(只負責
// 選取)＋詳情欄:附件、審查意見、AI 助手、審定動作永遠在同一個位置(規範 §0 疊合版)。
// 審定仍走 appPrompt 對話框——那是共用的「必填一段意見」互動,要不要搬進詳情欄是
// 另一個決策,本波不動。
//
// 球權快篩:三段沿用改版前的分群語意(輪到誰,不是狀態名),與 /rfi 同一手感——
// 同一個球權軸 RFI 已經做成 chip,長得一樣就要行為一樣。件數掛在 chip 上,
// 「一眼看到整體工作量」不靠區段標題。分段是「相對於看的人」:同一筆對監造是
// 待我處理、對廠商是等待對方;機關在送審流程不持球,「待我處理」永遠 0(改版前
// 該群直接不顯示;0 也保留是規範的空狀態原則——說清楚輪不到你,不要讓人猜)。
const BALL_FILTERS = [
  { key: 'mine', label: '待我處理' },
  { key: 'waiting', label: '等待對方' },
  { key: 'done', label: '已完成' },
]
// 快篩圓點鏡像 ui.jsx BallChip 的責任方色(廠商=blue、監造=amber、結束=green;
// BALL_COLOR 沒有 export、本波不動 ui.jsx):點下 chip 後清單裡每列的球權章就是這個色。
// 「等待對方」對機關是廠商與監造混合,沒有單一對應色 → slate。
const PARTY_DOT = { contractor: 'blue', supervisor: 'amber' }
const COUNTERPART = { contractor: 'supervisor', supervisor: 'contractor' }
const chipDot = (key, org) => (key === 'done' ? 'green' : PARTY_DOT[key === 'mine' ? org : COUNTERPART[org]] || 'slate')
// 球權一律取自 submittalBall(全平台同一份責任語言),這裡不自己判狀態;
// org 只影響分段,能不能按審定仍由 can.* 決定。
const ballKey = (s, org) => { const { who } = submittalBall(s); return who === 'done' ? 'done' : who === org ? 'mine' : 'waiting' }
const BALL_RANK = { mine: 0, waiting: 1, done: 2 }
const DEFAULT_FILTERS = { q: '', ball: '' }

const CATEGORIES = ['施工計畫', '品質計畫', '材料設備', '樣品', '配比', '其他']
const CHECK_COLOR = { 已於送審敘明: 'green', 需補件: 'amber', 需監造核對文件: 'slate', 不適用: 'slate' }
const READ_COLOR = { 符合: 'green', 部分符合: 'amber', 不符: 'red', 未涵蓋: 'slate', 需人工確認: 'blue', 不適用: 'slate' }
const DECISION_COLOR = { 核准: 'green', 核備: 'green', 退回補正: 'red', 需補充後再核: 'amber' }
// AI 偶爾把換行輸出成 literal「\n」;顯示前正規化成分隔號(P2-03)
const fixNl = (s) => String(s || '').replace(/\\n|\n/g, '；').replace(/；+/g, '；').replace(/^；|；$/g, '')
// 「待審」= 已提送或審核中:審定、AI 助手、上傳、等待字樣都掛在這個條件上
const isPending = (s) => s.status === '已提送' || s.status === '審核中'
const CSV_COLUMNS = [
  { key: 'submittal_no', label: '編號' }, { key: 'title', label: '名稱' }, { key: 'category', label: '類別' },
  { key: 'revision', label: '版次' }, { key: 'status', label: '狀態' },
  { key: 'submitted_date', label: '提送日' }, { key: 'due_date', label: '審回期限' },
  { key: 'decided_date', label: '審定日' }, { key: 'review_note', label: '審查意見' },
]
const blankForm = () => ({ title: '', category: '施工計畫', submitted_date: taipeiToday(), due_date: '', attachment_note: '' })

export default function Submittals() {
  const { submittals, createSubmittal, decideSubmittal, resubmitSubmittal, deleteSubmittal, reviewSubmittal,
    uploadSubmittalFile, readSubmittalDoc, isSupabaseConfigured, currentProject, currentUser, can, aiEnabled } = useStore()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 審定寫入失敗必須讓使用者看到(失敗=UI 不變)
  const [aiReview, setAiReview] = useState({}) // { [submittalId]: { result, opinion } } AI 審查助手結果
  const [reviewBusy, setReviewBusy] = useState(null) // 正在跑審查的 submittal id
  const [aiRead, setAiRead] = useState({})     // { [submittalId]: result } AI 讀文件審查結果
  const [readBusy, setReadBusy] = useState(null)
  const [uploadBusy, setUploadBusy] = useState(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const searchRef = useRef(null)

  const org = currentUser?.org_type || 'contractor'

  // 件數走全體(不受搜尋影響):chip 上的數字是「本案有幾筆輪到這一方」,0 也保留
  const counts = useMemo(() => {
    const c = { mine: 0, waiting: 0, done: 0 }
    for (const s of submittals) c[ballKey(s, org)]++
    return c
  }, [submittals, org])
  // 目前畫面上的清單:球權 AND 關鍵字(編號/名稱/類別/附件說明/審查意見)。
  // 順序=待我處理→等待對方→已完成、段內沿用 store——與改版前三段分群的閱讀順序
  // 完全相同:沒點 chip 時「輪到我的」仍然在最上面,不會混進已結案裡。
  const ordered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return submittals
      .map((s) => ({ s, key: ballKey(s, org) }))
      .filter(({ key }) => !filters.ball || key === filters.ball)
      .filter(({ s }) => !q || [s.submittal_no, s.title, s.category, s.attachment_note, s.review_note]
        .some((v) => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => BALL_RANK[a.key] - BALL_RANK[b.key])
      .map(({ s }) => s)
  }, [submittals, filters, org])
  const anyFilter = filters.q.trim() !== '' || filters.ball !== ''

  // 選取/深連結(?submittal=)/切案重置/初次自動選取:共用殼 hook。預設選「待我處理」
  // 的第一筆(開頁就看到該做的事),沒有就選清單第一筆。
  const pid = currentProject?.project_id
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'submittal', idPrefix: 'sub-',
    scope: `${pid}/${org}`,
    ready: submittals.length > 0, rows: submittals,
    pickDefault: () => (ordered.find((s) => ballKey(s, org) === 'mine') || ordered[0])?.id,
    onSelect: () => setErrMsg(''),
    onReset: () => setFilters(DEFAULT_FILTERS),
  })
  // 篩選後選中項被篩掉:右欄內容保留(與 /rfi 同),清單中只是沒有高亮列——
  // 核准後這一筆離開「待我處理」,詳情還在,監造看得到自己剛做了什麼
  const selected = submittals.find((s) => s.id === selectedId) || null
  // 鍵盤:↑/↓ 移動選取、/ 聚焦搜尋。提送表單開著就停用——焦點落在表單按鈕上
  // 按 ↓ 會換選取,打到一半的送審名稱雖不會消失,但畫面焦點會跑掉。
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'sub-', modalUp: !!form, searchRef })

  // 早退也保留 PageHeader:頁首與工作面分頁不該因為「還沒選專案」整組消失
  if (isSupabaseConfigured && !currentProject) {
    return (
      <div className="space-y-5">
        <PageHeader title="送審文件" tagline="Submittal" subtitle="施工計畫 / 品質計畫 / 材料設備 / 樣品送審 → 監造審核核備" />
        <Card title="送審文件" bodyClass="p-0"><Empty>請先登入並選擇專案。</Empty></Card>
      </div>
    )
  }

  const submit = async () => {
    setBusy(true); await createSubmittal(form); setBusy(false); setForm(null)
  }
  const onDecide = async (s, status) => {
    const required = status === '退回補正' || status === '駁回'
    // AI 審查助手/讀文件審查已備妥意見 → 帶入為預設(監造仍可改);否則沿用原邏輯(退回/駁回不預填舊意見)
    const aiOpinion = aiReview[s.id]?.opinion || aiRead[s.id]?.summary_opinion
    const note = await appPrompt({
      title: `${status}：${s.submittal_no}`, body: s.title,
      label: required ? `${status}原因 / 審查意見（必填）` : '審查意見（可留空）',
      defaultValue: aiOpinion || (required ? '' : (s.review_note || '')), required, danger: required, confirmLabel: status,
    })
    if (note === null) return
    setErrMsg(''); setBusy(true)
    const { error } = await decideSubmittal(s.id, status, note || s.review_note)
    setBusy(false)
    if (error) setErrMsg(friendlyError(error, `${status}未寫入`))
    else { // 審定後收起助手面板
      setAiReview((m) => { const n = { ...m }; delete n[s.id]; return n })
      setAiRead((m) => { const n = { ...m }; delete n[s.id]; return n })
    }
  }

  // AI 送審審查助手:產生審查要點清單 + 意見草稿 + 建議判定
  const onReview = async (s) => {
    setReviewBusy(s.id); setErrMsg('')
    const { error, result } = await reviewSubmittal(s)
    setReviewBusy(null)
    if (error) { setErrMsg(friendlyError(error, 'AI 審查助手失敗')); return }
    setAiReview((m) => ({ ...m, [s.id]: { result, opinion: result.opinion || '' } }))
  }
  const closeReview = (id) => setAiReview((m) => { const n = { ...m }; delete n[id]; return n })

  // 廠商上傳送審主文件
  const onUpload = async (s, e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setUploadBusy(s.id); setErrMsg('')
    const { error } = await uploadSubmittalFile(s.id, file)
    setUploadBusy(null)
    if (error) setErrMsg(friendlyError(error, '文件上傳失敗'))
  }
  // AI 讀文件審查:讀送審文件本體逐項比對契約需求
  const onRead = async (s) => {
    setReadBusy(s.id); setErrMsg('')
    const { error, result } = await readSubmittalDoc(s)
    setReadBusy(null)
    if (error) { setErrMsg(friendlyError(error, 'AI 讀文件審查失敗')); return }
    setAiRead((m) => ({ ...m, [s.id]: result }))
  }
  const closeRead = (id) => setAiRead((m) => { const n = { ...m }; delete n[id]; return n })

  // 修正再送:補正說明必填(P0-01 持久化 + P1-08 實質補正證據)
  const onResubmit = async (s) => {
    const note = await appPrompt({
      title: `修正再送：${s.submittal_no}`, body: s.review_note ? `退回原因：${s.review_note}` : s.title,
      label: '補正說明（必填，將併入附件說明留存）', required: true, confirmLabel: `再送（Rev.${(s.revision || 0) + 1}）`,
    })
    if (note === null) return
    setErrMsg(''); setBusy(true)
    const { error } = await resubmitSubmittal(s.id, note)
    setBusy(false)
    if (error) setErrMsg(friendlyError(error, '再送未寫入'))
  }
  const onDelete = async (s) => {
    if (!(await appConfirm({ title: '刪除此送審？', danger: true, confirmLabel: '刪除' }))) return
    setErrMsg('')
    const { error } = await deleteSubmittal(s.id)
    if (error) setErrMsg(friendlyError(error, '送審刪除未完成'))
    else closeDetail() // <lg 抽屜承載的正是這筆,刪掉後不留 detailOpen 殘值
  }

  const exportRows = () => exportCsv(`送審文件_${stamp()}`, submittals, CSV_COLUMNS)

  // ── 詳情欄:狀態列 / 編號主旨與 meta / 附件 / 審查意見 / AI 助手面板 / 動作列。
  // 動作條件與改版前列內動作逐條相同,一條都沒放寬(伺服器 submittals_guard 兜底):
  //   canDecide   = can.approve ∧ 待審(已提送∨審核中)   → 審定群:退回補正恆在
  //   canAccept   = canDecide ∧ 已提送                  → 受理審核(先受理才可核准/核備,P1-08)
  //   canRule     = canDecide ∧ 審核中                  → 核准 / 核備 / 駁回(駁回=終局,R3 P2-02)
  //   canAiReview = canDecide ∧ 功能開 ∧ 尚無結果       → AI 審查助手
  //   canAiRead   = canDecide ∧ 功能開 ∧ 已附文件 ∧ 尚無結果 → AI 讀文件審查
  //   aiOff       = canDecide ∧ 兩個功能都關            → 「AI 審查功能未啟用」
  //   canResubmit = can.submit ∧ 退回補正               → 修正再送
  //   canUpload   = can.submit ∧ (待審 ∨ 退回補正)      → 上傳/更換文件(留在附件區,離它影響的東西最近)
  //   canDelete   = can.submit ∧ 已提送 ∧ ¬(Rev>0)      → 刪除(一經受理即履約證據,DB 另有 guard)
  //   待審字樣與角色無關(改版前即如此),待審就顯示「待監造審定」
  let detailBody = null
  if (selected) {
    const s = selected
    const pending = isPending(s)
    const canDecide = can.approve && pending
    const canAccept = canDecide && s.status === '已提送'
    const canRule = canDecide && s.status === '審核中'
    const review = aiReview[s.id]
    const read = aiRead[s.id]
    const canAiReview = canDecide && aiEnabled('submittal.review') && !review
    const canAiRead = canDecide && aiEnabled('submittal.read') && !!s.attachment_path && !read
    const aiOff = canDecide && !aiEnabled('submittal.review') && !aiEnabled('submittal.read')
    const canResubmit = can.submit && s.status === '退回補正'
    const canUpload = can.submit && (pending || s.status === '退回補正')
    const canDelete = can.submit && s.status === '已提送' && !(s.revision > 0)
    // 已結案且無可做的事(廠商看核准件)就不畫動作列:空的一條框線只會讓人找按鈕
    const hasActions = canDecide || canResubmit || canDelete || pending
    // region 以編號命名:報讀器走地標時直接聽到「SUB-002 詳情」,e2e 也用同一個名字
    // 確認詳情欄正在顯示哪一筆
    detailBody = (
      <section aria-label={`${s.submittal_no} 詳情`}>
        {/* 狀態列:球權章＋類別;顏色＋文字並存。狀態原值(已提送/審核中/核准…)在下方
            MetaGrid,球權章講的是「輪到誰」,兩者不是同一件事 */}
        <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <BallChip ball={submittalBall(s)} />
          <Badge color="slate" className="ml-auto">{s.category}</Badge>
        </div>

        <div className="p-4">
          <div className="num text-caption text-[var(--text-3)]">{s.submittal_no}</div>
          <div className="mt-0.5 text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{s.title}</div>
          {/* 空值一律顯示 —:六格固定,眼睛掃同一位置就知道有沒有填 */}
          <MetaGrid className="mt-3.5" rows={[
            ['類別', s.category || '—'],
            ['版次', `Rev.${s.revision || 0}`],
            ['狀態', s.status || '—'],
            ['提送日', s.submitted_date || '—'],
            ['審查期限', s.due_date || '—'],
            ['審定日', s.decided_date || '—'],
          ]} />
        </div>

        {/* 附件:說明文字＋文件本體(廠商上傳,監造可 AI 審讀)。上傳鈕就放在「尚未上傳」
            旁邊——控制項離它影響的東西最近(判準第 4 條) */}
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <MSym name="attach_file" size={15} className="text-[var(--text-3)]" />
            <span className="text-footnote font-medium text-[var(--text)]">附件</span>
          </div>
          {s.attachment_note && <p className="text-footnote leading-relaxed text-[var(--text-2)] whitespace-pre-line break-words">{s.attachment_note}</p>}
          <div className={`flex items-center gap-2 flex-wrap ${s.attachment_note ? 'mt-2' : ''}`}>
            {s.attachment_path
              ? <span className="text-footnote inline-flex items-center gap-1 text-[var(--blue-text)]"><MSym name="description" size={13} />已附文件：{s.attachment_name || '文件'}</span>
              : <span className="text-footnote text-[var(--text-3)]">尚未上傳文件本體</span>}
            {/* 不能用 <button> 的檔案上傳 label 也吃同一套按鈕皮(44px 觸控) */}
            {canUpload && (
              <label className={`${buttonClass('outline', 'sm')} ${uploadBusy === s.id ? 'opacity-50' : 'cursor-pointer'}`}>
                <input type="file" accept=".pdf,.doc,.docx,image/*" disabled={uploadBusy === s.id} onChange={(e) => onUpload(s, e)} className="hidden" />
                <MSym name="upload" size={14} />{uploadBusy === s.id ? '上傳中…' : (s.attachment_path ? '更換文件' : '上傳文件')}
              </label>
            )}
          </div>
        </div>

        {/* 審查意見:改版前擠在列裡的一行 amber 字;這是監造留給廠商的正式文字,
            完整顯示、保留換行。尚無意見時明說,不留空白格 */}
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <MSym name="rate_review" size={15} className="text-[var(--text-3)]" />
            <span className="text-footnote font-medium text-[var(--text)]">審查意見</span>
          </div>
          {s.review_note ? (
            <p className="text-body leading-[1.8] text-[var(--amber-text)] whitespace-pre-line break-words bg-[var(--amber-tint)] rounded-lg px-3 py-2">{s.review_note}</p>
          ) : (
            <p className="text-footnote text-[var(--text-3)]">尚無審查意見。</p>
          )}
        </div>

        {/* 監造:AI 審查助手——依契約規範/工項產生審查要點+意見草稿。
            草稿只是草稿:按審定鈕才帶入對話框,最終判定由監造裁量 */}
        {review && (() => {
          const r = review.result
          return (
            <div className="px-4 pb-4">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="text-footnote font-medium text-[var(--text)] inline-flex items-center gap-1.5 flex-wrap">
                  <MSym name="auto_awesome" size={14} className="text-[var(--blue)]" />AI 審查助手
                  {r.suggested_decision && <Badge color={DECISION_COLOR[r.suggested_decision] || 'slate'}>建議：{r.suggested_decision}</Badge>}
                </div>
                {/* 收起不是破壞性動作:共用 Button 的第三級 */}
                <Button variant="ghost" size="sm" onClick={() => closeReview(s.id)}>收起</Button>
              </div>
              {r.caution && <div className="text-footnote text-[var(--amber-text)] mb-2 flex items-start gap-1"><MSym name="warning" size={14} className="mt-px" />{fixNl(r.caution)}</div>}
              <div className="text-caption font-medium text-[var(--text-2)] mb-1">審查要點</div>
              <ul className="space-y-1 mb-3">
                {(r.checklist || []).map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-body">
                    <Badge color={CHECK_COLOR[c.status] || 'slate'}>{c.status}</Badge>
                    <span className="min-w-0"><span className="text-[var(--text)]">{c.point}</span>
                      {c.basis && <span className="text-[var(--text-3)] text-footnote"> · 依據：{c.basis}</span>}</span>
                  </li>
                ))}
              </ul>
              <div className="text-caption font-medium text-[var(--text-2)] mb-1">審查意見草稿（可修改，核准/核備/退回時自動帶入）</div>
              <Textarea rows={3} value={review.opinion}
                onChange={(e) => setAiReview((m) => ({ ...m, [s.id]: { ...m[s.id], opinion: e.target.value } }))} />
              <p className="text-caption text-[var(--text-3)] mt-1">依契約規範/工項自動草擬，僅供監造參考；文件本體仍須人工核對，最終判定由監造裁量。</p>
            </div>
          )
        })()}
        {/* 監造:AI 讀文件審查——讀送審文件本體逐項比對契約需求(需已上傳文件) */}
        {read && (
          <div className="px-4 pb-4">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="text-footnote font-medium text-[var(--text)] inline-flex items-center gap-1.5 flex-wrap">
                <MSym name="find_in_page" size={14} className="text-[var(--blue)]" />AI 讀文件審查
                {read.suggested_decision && <Badge color={DECISION_COLOR[read.suggested_decision] || 'slate'}>建議：{read.suggested_decision}</Badge>}
                <span className="text-caption text-[var(--text-2)] font-normal">{read.mode === 'text' ? '已讀文件文字' : '視覺讀取'}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => closeRead(s.id)}>收起</Button>
            </div>
            {read.doc_summary && <div className="text-footnote text-[var(--text-2)] mb-2">文件摘要：{read.doc_summary}</div>}
            {read.caution && <div className="text-footnote text-[var(--amber-text)] mb-2 flex items-start gap-1"><MSym name="warning" size={14} className="mt-px" />{fixNl(read.caution)}</div>}
            <div className="text-caption font-medium text-[var(--text-2)] mb-1">逐項比對契約需求</div>
            <ul className="space-y-1 mb-3">
              {(read.findings || []).map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-body">
                  <Badge color={READ_COLOR[f.status] || 'slate'}>{f.status}</Badge>
                  <span className="min-w-0"><span className="text-[var(--text)]">{f.requirement}</span>
                    {f.note && <span className="text-[var(--text-3)] text-footnote"> · {f.note}</span>}</span>
                </li>
              ))}
            </ul>
            <div className="text-caption font-medium text-[var(--text-2)] mb-1">審查意見草稿（可修改，核准/核備/退回時自動帶入）</div>
            <Textarea rows={3} value={read.summary_opinion || ''}
              onChange={(e) => setAiRead((m) => ({ ...m, [s.id]: { ...m[s.id], summary_opinion: e.target.value } }))} />
            <p className="text-caption text-[var(--text-3)] mt-1">AI 讀送審文件本體逐項比對契約需求；「需人工確認/未涵蓋」項仍須監造核對，最終判定由監造裁量。</p>
          </div>
        )}

        {/* 動作列:同一時間最多一顆實心鈕(核准);其餘次級/第三級。
            批 B UX:AI 功能關閉時藏按鈕、留簡短說明(真正的閘門在伺服器端) */}
        {hasActions && <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
          {canAccept && <Button variant="secondary" disabled={busy} onClick={() => onDecide(s, '審核中')}>受理審核</Button>}
          {canRule && <>
            <Button variant="success" disabled={busy} onClick={() => onDecide(s, '核准')}>核准</Button>
            <Button variant="secondary" disabled={busy} onClick={() => onDecide(s, '核備')}>核備</Button>
          </>}
          {canDecide && <Button variant="danger" disabled={busy} onClick={() => onDecide(s, '退回補正')}>退回補正</Button>}
          {canRule && <Button variant="danger" disabled={busy} onClick={() => onDecide(s, '駁回')}>駁回</Button>}
          {canAiReview && (
            <Button variant="secondary" disabled={reviewBusy === s.id} onClick={() => onReview(s)}>
              <MSym name="auto_awesome" size={13} />{reviewBusy === s.id ? ' AI 審查中…' : ' AI 審查助手'}
            </Button>
          )}
          {canAiRead && (
            <Button variant="secondary" disabled={readBusy === s.id} onClick={() => onRead(s)}>
              <MSym name="find_in_page" size={13} />{readBusy === s.id ? ' AI 讀文件中…' : ' AI 讀文件審查'}
            </Button>
          )}
          {aiOff && <span className="text-footnote text-[var(--text-2)]">AI 審查功能未啟用</span>}
          {/* 施工:退回補正後修正再送(補正說明必填=實質補正證據) */}
          {canResubmit && <Button variant="secondary" disabled={busy} onClick={() => onResubmit(s)}>修正再送</Button>}
          {pending && <span className="text-footnote text-[var(--text-2)]">待監造審定</span>}
          {/* 灰轉紅文字鈕不在三級語言內,改共用 Button 的第三級;ml-auto 靠右與主動作拉開 */}
          {canDelete && <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onDelete(s)}>刪除</Button>}
        </div>}
      </section>
    )
  }

  // ── 左欄卡頭下方:搜尋 + 三段球權快篩(件數走全體),兩條件 AND
  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋編號、名稱、類別、審查意見…" aria-label="搜尋送審文件" />
      <div className="flex items-center gap-2 flex-wrap">
        {BALL_FILTERS.map((f) => (
          <StatusChip key={f.key} active={filters.ball === f.key} count={counts[f.key]}
            onClick={() => setFilters((x) => ({ ...x, ball: x.ball === f.key ? '' : f.key }))}>
            <Dot color={chipDot(f.key, org)} />{f.label}
          </StatusChip>
        ))}
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>清除篩選</Button>
        )}
      </div>
    </div>
  )

  // ── 清單列:只負責選取(動作全在詳情欄),兩行=編號＋名稱＋版次＋球權 / 類別·日期 meta。
  // role=listitem + aria-current 與 /rfi、/safety 同一套選取語意。
  const listRows = (
    <div role="list" aria-label="送審清單" className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的送審。<br />換一段球權,或試試編號、名稱、審查意見關鍵字。
        </div>
      ) : ordered.map((s) => {
        const active = s.id === selectedId
        return (
          <button key={s.id} type="button" role="listitem" id={`sub-${s.id}`}
            aria-current={active || undefined}
            onClick={() => select(s.id, { openPane: true })}
            className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer ${active
              ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
            <span className="flex items-center gap-2 flex-wrap">
              <span className="num text-caption text-[var(--text-3)]">{s.submittal_no}</span>
              <span className="text-body text-[var(--text)] min-w-0 [text-wrap:pretty]">{s.title}</span>
              {s.revision > 0 && <span className="num text-caption text-[var(--text-3)]">Rev.{s.revision}</span>}
              <BallChip ball={submittalBall(s)} />
            </span>
            <span className="block mt-0.5 num text-caption text-[var(--text-3)] truncate">
              {[s.category, `提送 ${s.submitted_date || '—'}`, s.due_date ? `應審回 ${s.due_date}` : '', s.decided_date ? `審定 ${s.decided_date}` : ''].filter(Boolean).join(' · ')}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-5">
      <PageHeader title="送審文件" tagline="Submittal" subtitle="施工計畫 / 品質計畫 / 材料設備 / 樣品送審 → 監造審核核備"
        action={
          <div className="flex items-center gap-2">
            {submittals.length > 0 && <Button variant="ghost" onClick={exportRows}><MSym name="download" size={16} />CSV</Button>}
            {can.submit && <Button variant="secondary" onClick={() => setForm(form ? null : blankForm())}>{form ? '取消' : <><MSym name="add" size={16} />提送送審</>}</Button>}
          </div>
        } />

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />
      {/* AI 長任務狀態(P1-10):讀文件需下載→抽字→比對,設時間預期避免以為卡住 */}
      {(readBusy || reviewBusy) && (
        <div className="flex items-center gap-2 text-sm bg-[var(--blue-tint)] text-[var(--blue-text)] rounded-lg px-3 py-2">
          <MSym name="auto_awesome" size={15} className="animate-pulse shrink-0" />
          {readBusy ? 'AI 正在下載並讀取送審文件、逐項比對契約規範…較長文件約需 20–30 秒,可離開此頁稍後回來查看。' : 'AI 審查中…'}
        </div>
      )}

      {form && (
        <Card>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="送審名稱"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 4F 以上結構體施工計畫" /></Field>
            <Field label="類別"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="提送日"><Input type="date" value={form.submitted_date} onChange={(e) => setForm({ ...form, submitted_date: e.target.value })} /></Field>
            <Field label="監造應審回期限"><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
            <div className="md:col-span-2"><Field label="附件說明"><Input value={form.attachment_note} onChange={(e) => setForm({ ...form, attachment_note: e.target.value })} placeholder="如 含出廠證明、CNS 試驗報告（文件另以公文/雲端連結提送）" /></Field></div>
          </div>
          <div className="mt-3"><Button onClick={submit} disabled={busy || !form.title}>{busy ? '提送中…' : '提送'}</Button></div>
        </Card>
      )}

      {submittals.length === 0 ? (
        <Card title="送審清單" bodyClass="p-0"><Empty>尚無送審文件。施工廠商提送計畫/材料，監造審核核備。</Empty></Card>
      ) : (
        <ListDetailLayout
          detail={detailBody}
          detailLabel="送審詳情"
          detailEmpty={<Empty>點左側清單查看送審的附件、審查意見與審定動作。</Empty>}
          drawerOpen={detailOpen && !!selected}
          onDrawerClose={closeDetail}>
          {/* ── 左欄:一份清單(右欄與抽屜由殼統一,見 components/listDetail.jsx)。
              「待審 N」不再進卡標題:三段球權件數都在快篩 chip 上,同一個數字不寫兩次 */}
          <Card title={`送審清單（${submittals.length}）`} bodyClass="p-0">
            {filterBar}
            {listRows}
          </Card>
        </ListDetailLayout>
      )}

      <p className="text-xs text-[var(--text-3)] leading-relaxed">送審採 ball-in-court：施工提送 → 監造受理審核 → 核准/核備/退回補正；退回補正後施工修正再送（版次 +1）。廠商可上傳送審文件本體（PDF/圖），監造以「AI 讀文件審查」逐項比對契約需求並草擬意見。</p>
    </div>
  )
}
