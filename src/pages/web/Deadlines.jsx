// 期限追蹤:已確認契約期限的到期管理(自 /requirements 的期限追蹤區塊遷出)。
// 契約重點頁改版後只留頂部摘要條,逐項到期清單、標為已提送/佐證掛接、罰款試算
// 與基準日/契約總價編輯全數在本頁——今日待辦的契約期限項與摘要條的「開啟期限
// 追蹤」都導到這裡。資料與規則不變:到期日由 computeObligationDue 依基準日即時
// 計算,狀態寫入走 updateObligationStatus(伺服器 RLS 把關)。
//
// 版面:改版前是「五個期程分組、每組一疊卡」——同一筆義務的規則/倒數/罰則/佐證/
// 動作全攤在卡上,列內展開的佐證挑選器又把卡撐開、把下面的卡推走;要看「哪些
// 已逾期」得掃五組。現在是一份清單(期程順序、組內到期日近→遠,與改版前的閱讀
// 順序完全相同)＋期程快篩＋詳情欄:規則、倒數、罰款試算、佐證與動作永遠在同一
// 個位置(規範 §0 疊合版),標為已提送與佐證挑選就地在詳情欄處理,不跳頁、不開
// 對話框(判準第 3、4 條)。這是殼第一次承載會寫 DB 的表單,排版比照 /safety 的
// 更正表單。殼在 components/listDetail.jsx、行為在 lib/useListDetailPane.js。
import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import {
  Card, Empty, PageHeader, Badge, Button, Field, Input, Select, ErrorBanner, buttonClass,
} from '../../components/ui.jsx'
import { ListDetailLayout, SearchField, StatusChip, MetaGrid } from '../../components/listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { friendlyError } from '../../lib/errorMessage.js'
import { computeObligationDue, formatObligationRule } from '../../lib/contractDue.js'
import { ORG_TO_PARTY, obligationParty } from '../../lib/obligationTimeline.js'
import AnchorDates from '../../components/AnchorDates.jsx'
import { estimatePenalty, parsePenaltyRate } from '../../lib/penaltyCalc.js'
import { parseLocalDate, localISODate, taipeiToday } from '../../lib/dates.js'

const PHASES = ['開工前', '施工中', '完工', '保固', '其他']
const phaseOf = (ob) => (PHASES.includes(ob.category) ? ob.category : '其他')
// 逾期/即將到期的分界點:台北日曆日的午夜,不跟瀏覽器時區(法定期限跟著台灣時區走)
const today0 = () => parseLocalDate(taipeiToday())
// 狀態色點走 class 對照表(顏色由 className 帶 token,吃主題切換);
// 色點附等價文字(title/aria-label),狀態不得只靠顏色(W8-5)
const DOT_CLS = { done: 'bg-[var(--green-text)]', overdue: 'bg-[var(--red-text)]', soon: 'bg-[var(--amber-text)]', scheduled: 'bg-[var(--blue)]', nodate: 'bg-[var(--text-3)]' }
const DOT_LABEL = { done: '已完成', overdue: '已逾期', soon: '7 日內到期', scheduled: '排程中', nodate: '無期限' }
// 詳情狀態列的色票與清單倒數字色:與色點同一組色鍵,同一個狀態在列與詳情不得兩種顏色
const STATE_BADGE = { done: 'green', overdue: 'red', soon: 'amber', scheduled: 'blue', nodate: 'slate' }
const COUNTDOWN_CLS = { overdue: 'text-[var(--red-text)]', soon: 'text-[var(--amber-text)]', scheduled: 'text-[var(--text-2)]' }
// 倒數文案:清單列與詳情狀態列同一份;已完成/無期限不倒數
const countdownOf = (it) => (it.done || it.diff == null ? '' : it.diff < 0 ? `已逾期 ${-it.diff} 天` : `還有 ${it.diff} 天`)
const byDue = (x, y) => (x.due?.getTime() || Infinity) - (y.due?.getTime() || Infinity)
// 期程快篩單選、再點一次取消:與 /safety、/rfi 同一手感(StatusChip 本來就是單選分段)
const DEFAULT_FILTERS = { q: '', phase: '' }

export default function Deadlines() {
  const {
    currentProject, isPersistedProject, currentUser, workItems, can,
    obligations, updateObligationStatus, updateProjectAnchors, submittals,
  } = useStore()
  // 標記權限鏡像 DB(migration 20260825120000_obligation_ownership_completed_at):
  // 只看歸屬——自己方的義務才能標/退,機關自此也能標自己的(估驗撥付/初驗/驗收);
  // admin override(非正式模式的專案管理者)照舊放行。跨方按鈕不渲染,
  // 否則按下去只會吃 RLS 靜默 0 列的錯誤。
  const viewerParty = ORG_TO_PARTY[currentUser?.org_type] || '廠商'
  const canMark = (ob) => can.override || obligationParty(ob) === viewerParty
  // 罰款試算基準:手填契約價金總額優先,沒填退回標單加總(W10)
  const manualContractTotal = Number(currentProject?.contract_total) || 0
  const contractTotal = manualContractTotal > 0 ? manualContractTotal : (workItems?.meta?.billable_total || 0)

  const [anchors, setAnchors] = useState({ award_date: '', notice_date: '', commencement_date: '', end_date: '' })
  const [totalDraft, setTotalDraft] = useState('')
  const [anchorErr, setAnchorErr] = useState('')
  const [obligationMsg, setObligationMsg] = useState('')
  // 佐證挑選器只對「目前選中」那筆開;換選取即收——表單綁的是上一筆,留著會出現
  // 「詳情是 A、挑選器是 B」。busy 擋連點:同一筆連寫兩次會讓第二次吃到過期狀態。
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [evidencePick, setEvidencePick] = useState('')
  const [busy, setBusy] = useState(false)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const searchRef = useRef(null)

  useEffect(() => {
    setAnchors({
      award_date: currentProject?.award_date || '',
      notice_date: currentProject?.notice_date || '',
      commencement_date: currentProject?.commencement_date || '',
      end_date: currentProject?.end_date || '',
    })
    setTotalDraft(currentProject?.contract_total != null ? String(currentProject.contract_total) : '')
  }, [currentProject])

  // DB 成功才更新本地(B-04):非建立者被 RLS 靜默擋下時不可樂觀顯示新基準日
  const setAnchor = async (key, val) => {
    setAnchorErr('')
    if (isPersistedProject) {
      const { error } = await updateProjectAnchors({ [key]: val || null })
      if (error) { setAnchorErr(friendlyError(error, '基準日未儲存')); return }
    }
    setAnchors((a) => ({ ...a, [key]: val })) // demo:只進本地,供時間軸展示
  }

  // 到期日、倒數、狀態、期程(依基準日即時計算)。id 提到最外層:殼 hook 以 rows[].id
  // 做深連結查找與鍵盤走訪。
  const dueItems = useMemo(() => obligations.map((ob) => {
    const due = computeObligationDue(ob, anchors)
    const done = ob.status === '已提送' || ob.status === '已完成'
    let diff = null, state = 'nodate'
    if (done) state = 'done'
    else if (due) { diff = Math.round((due - today0()) / 86400000); state = diff < 0 ? 'overdue' : diff <= 7 ? 'soon' : 'scheduled' }
    return { id: ob.id, ob, due, diff, done, state, phase: phaseOf(ob) }
  }), [obligations, anchors])
  const dueCounts = useMemo(() => {
    let overdue = 0, soon = 0, done = 0
    for (const it of dueItems) { if (it.state === 'overdue') overdue++; else if (it.state === 'soon') soon++; if (it.done) done++ }
    return { overdue, soon, done }
  }, [dueItems])
  // 期程件數走全體(不受搜尋影響):chip 上的數字是「這一段有幾條義務」,0 也保留——
  // 「保固段還沒有義務」本身就是資訊(可能是契約重點漏確認),藏掉反而要人猜
  const phaseCounts = useMemo(
    () => Object.fromEntries(PHASES.map((ph) => [ph, dueItems.filter((it) => it.phase === ph).length])),
    [dueItems],
  )

  // 目前畫面上的清單:期程 AND 關鍵字(義務/責任方/罰則/條款/規則文字),
  // 期程順序、組內到期日近→遠(無期限墊底)——與改版前分組的閱讀順序一致,
  // 也與 /requirements 對同一批資料的順序一致,不在兩頁給出兩種順序。
  const ordered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return PHASES.flatMap((ph) => (filters.phase && filters.phase !== ph ? [] : dueItems
      .filter((it) => it.phase === ph)
      .filter((it) => !q || [it.ob.title, it.ob.responsible, it.ob.penalty, it.ob.source_clause, formatObligationRule(it.ob)]
        .some((v) => (v || '').toLowerCase().includes(q)))
      .sort(byDue)))
  }, [dueItems, filters])
  const anyFilter = filters.q.trim() !== '' || filters.phase !== ''

  // 選取/深連結(?obligation=,與 /requirements 同名,日後今日待辦可直接帶入)/切案
  // 重置/初次自動選取:共用殼 hook。預設選第一條已逾期 → 即將到期 → 清單第一條
  // (開頁就落在最該處理的那一筆,與 /requirements 的 pickDefaultId 同一規則)。
  const pid = currentProject?.project_id
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'obligation', idPrefix: 'dl-',
    scope: `${pid}/${viewerParty}/${can.override}`,
    ready: dueItems.length > 0, rows: dueItems,
    pickDefault: () => (ordered.find((it) => it.state === 'overdue') || ordered.find((it) => it.state === 'soon') || ordered[0])?.id,
    onSelect: () => { setEvidenceOpen(false); setEvidencePick(''); setObligationMsg('') },
    onReset: () => { setEvidenceOpen(false); setEvidencePick(''); setObligationMsg(''); setFilters(DEFAULT_FILTERS) },
  })
  // 篩選後選中項被篩掉:右欄內容保留(與 /safety 同),清單中只是沒有高亮列
  const selected = dueItems.find((it) => it.id === selectedId) || null
  // 鍵盤:↑/↓ 移動選取、/ 聚焦搜尋。佐證挑選器開著就停用——焦點落在確認鈕上
  // 按 ↓ 會換選取、連帶收掉挑到一半的佐證。
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'dl-', modalUp: evidenceOpen, searchRef })

  // 狀態寫入:store 保證 DB 成功才更新 UI;失敗訊息放在詳情欄動作列旁(離控制項最近)
  const write = async (it, status, extra) => {
    setBusy(true); setObligationMsg('')
    const { error } = await updateObligationStatus(it.ob.id, status, extra)
    setBusy(false)
    if (error) { setObligationMsg(friendlyError(error, '狀態未寫入')); return false }
    return true
  }
  // 退回待辦:一併解除佐證連結(W-01)——佐證是「那次提送」的證據,退回後留著會讓
  // 稽核點到一份不再對應的送審紀錄;不能簡化成只改狀態
  const revert = (it) => write(it, '待辦', { evidence_submittal_id: null })
  // 標為已提送:有送審文件可掛就先開挑選器(掛不掛由人決定),沒有就直接標
  const startMark = (it) => {
    if (submittals.length) { setEvidenceOpen(true); setEvidencePick('') }
    else write(it, '已提送')
  }
  const confirmMark = async (it) => {
    const ok = await write(it, '已提送', evidencePick ? { evidence_submittal_id: evidencePick } : {})
    if (ok) { setEvidenceOpen(false); setEvidencePick('') }
  }
  const cancelPick = () => { setEvidenceOpen(false); setEvidencePick('') }

  // ── 詳情欄:狀態列 / 標題與 key-value / 佐證 / 罰則與試算 / 出處 / 動作列或佐證挑選器。
  // 動作只看歸屬(canMark)——與改版前列內按鈕同一條條件,一條沒放寬:
  //   markable ∧ done   → 「已提送 ✓」(按下退回待辦並解除佐證,W-01)
  //   markable ∧ ¬done  → 「標為已提送」(有送審文件→開挑選器;無→直接標)
  //   ¬markable         → 唯讀字樣(改版前不渲染按鈕;現在把「為什麼沒有按鈕」講出來)
  // region 以義務標題命名:報讀器走地標直接聽到「提送施工月報 詳情」,e2e 也用同一個
  // 名字確認詳情欄正在顯示哪一筆
  let detailBody = null
  if (selected) {
    const it = selected
    const ob = it.ob
    const markable = canMark(ob)
    const countdown = countdownOf(it)
    const ev = ob.evidence_submittal_id ? submittals.find((s) => s.id === ob.evidence_submittal_id) : null
    // 逾期罰款金額試算(確定性 regex 抽罰率;抽不出就不顯示金額——寧缺勿錯)
    const est = it.state === 'overdue' && ob.penalty
      ? estimatePenalty({ penaltyText: ob.penalty, overdueDays: -it.diff, contractTotal }) : null
    detailBody = (
      <section aria-label={`${ob.title} 詳情`}>
        {/* 狀態列:狀態色票＋倒數＋期程;顏色＋文字並存 */}
        <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <Badge color={STATE_BADGE[it.state]}>{DOT_LABEL[it.state]}</Badge>
          {countdown && <span className={`num text-footnote font-medium ${COUNTDOWN_CLS[it.state]}`}>{countdown}</span>}
          <Badge color="slate" className="ml-auto">{it.phase}</Badge>
        </div>

        <div className="p-4">
          <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{ob.title}</div>
          {/* 空值一律顯示 —:四格固定,眼睛掃同一位置就知道有沒有填。到期日走 localISODate
              (台北日曆日),狀態是 DB 原值(待辦/已提送/已完成),不再翻譯一次 */}
          <MetaGrid className="mt-3.5" rows={[
            ['規則', formatObligationRule(ob) || '—'],
            ['到期日', it.due ? localISODate(it.due) : '—'],
            ['責任方', ob.responsible || '—'],
            ['狀態', ob.status || '待辦'],
          ]} />
          {/* 佐證連結:稽核可一路點到原始送審紀錄。Badge 文案與改版前逐字相同 */}
          {ob.evidence_submittal_id && (
            <Link to="/submittals" className="mt-3 inline-flex items-center max-w-full max-md:min-h-11 hover:underline">
              <Badge color="blue" className="max-w-full">
                <MSym name="description" size={11} />
                <span className="truncate">佐證:{ev ? `${ev.submittal_no} ${ev.title}（${ev.status}）` : '送審文件（已不存在或無權檢視）'}</span>
              </Badge>
            </Link>
          )}
        </div>

        {/* 罰則與逾期違約金試算:金額由 penaltyCalc 算(確定性引擎),這裡只複述 */}
        {ob.penalty && (
          <div className="px-4 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <MSym name="balance" size={15} className="text-[var(--text-3)]" />
              <span className="text-footnote font-medium text-[var(--text)]">罰則</span>
            </div>
            <p className="text-footnote leading-relaxed text-[var(--amber-text)] bg-[var(--amber-tint)] rounded-lg px-3 py-2">{ob.penalty}</p>
            {it.state === 'overdue' && (est ? (
              <p className="mt-2 text-footnote font-medium leading-relaxed text-[var(--red-text)] bg-[var(--red-tint)] rounded-lg px-3 py-2">
                預估逾期違約金約 NT$ {est.amount.toLocaleString('en-US')}{est.capped ? '(已達上限)' : ''}
                <span className="block font-normal text-[var(--text-3)]">{est.basis} · 概算供參,實際依契約認定</span>
              </p>
            ) : (
              <p className="mt-2 text-footnote leading-relaxed text-[var(--text-3)] bg-[var(--surface-2)] rounded-lg px-3 py-2">
                {parsePenaltyRate(ob.penalty)?.perDayFraction != null && !(contractTotal > 0)
                  ? '偵測到百分比制罰則;填入下方「契約價金總額」即可試算逾期違約金'
                  : '偵測到罰則,但金額格式需人工確認試算'}
              </p>
            ))}
          </div>
        )}

        {(ob.source_clause || ob.source_page) && (
          <div className="px-4 pb-4 num text-caption text-[var(--text-3)] flex items-center gap-1">
            <MSym name="description" size={11} /> 契約 {ob.source_clause} {ob.source_page}
          </div>
        )}

        <ErrorBanner msg={obligationMsg} onClose={() => setObligationMsg('')} className="mx-4 mb-3" />

        {/* 動作列 ⇄ 佐證挑選器:同一個位置二擇一,同一時間最多一顆實心鈕。
            挑選器的欄位、選項與兩顆確認鈕文案與改版前列內版完全相同 */}
        {markable && !it.done && evidenceOpen ? (
          <div className="px-4 py-3 border-t border-[var(--border-2)]">
            <div className="bg-[var(--surface-2)] rounded-lg p-3 space-y-2">
              <Field label="佐證送審文件">
                <Select value={evidencePick} onChange={(e) => setEvidencePick(e.target.value)}>
                  <option value="">（不掛佐證）</option>
                  {submittals.map((s) => (
                    <option key={s.id} value={s.id}>{s.submittal_no} {s.title}（{s.status}）</option>
                  ))}
                </Select>
              </Field>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" busy={busy} onClick={() => confirmMark(it)}>
                  {evidencePick ? '掛佐證並標為已提送' : '直接標為已提送'}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelPick}>取消</Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
            {markable && it.done && (<>
              <Button variant="secondary" busy={busy} onClick={() => revert(it)}>已提送 ✓</Button>
              <span className="text-caption text-[var(--text-3)] leading-relaxed">按下即退回待辦,並解除已掛的佐證</span>
            </>)}
            {markable && !it.done && <Button busy={busy} onClick={() => startMark(it)}>標為已提送</Button>}
            {!markable && (
              <span className="text-caption text-[var(--text-3)] leading-relaxed">由{obligationParty(ob)}負責提送,本頁為唯讀檢視。</span>
            )}
          </div>
        )}
      </section>
    )
  }

  // ── 左欄卡頭下方:搜尋 + 五段期程快篩(件數走全體),兩條件 AND。
  // 期程沒有狀態色,chip 不放色點——色點在這一頁專屬於到期狀態,兩種意義共用一個圓會混
  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋義務、責任方、罰則或條款…" aria-label="搜尋契約期限" />
      <div className="flex items-center gap-2 flex-wrap">
        {PHASES.map((ph) => (
          <StatusChip key={ph} active={filters.phase === ph} count={phaseCounts[ph]}
            onClick={() => setFilters((f) => ({ ...f, phase: f.phase === ph ? '' : ph }))}>
            {ph}
          </StatusChip>
        ))}
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>清除篩選</Button>
        )}
      </div>
    </div>
  )

  // ── 清單列:只負責選取(動作全在詳情欄),色點＋兩行=標題＋倒數 / 期程·規則·到期·責任方。
  // 期程進 meta 行是改版新增的——改版前期程由分組標題承載,混成一份後每列都要自己說。
  // role=listitem + aria-current 與 /safety、/rfi 同一套選取語意。
  const listRows = (
    <div role="list" aria-label="契約期限" className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的期限。<br />換一段期程,或試試義務名稱、責任方、條款關鍵字。
        </div>
      ) : ordered.map((it) => {
        const active = it.id === selectedId
        const countdown = countdownOf(it)
        return (
          <button key={it.id} type="button" role="listitem" id={`dl-${it.id}`}
            aria-current={active || undefined}
            onClick={() => select(it.id, { openPane: true })}
            className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer flex items-start gap-2.5 ${active
              ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
            {/* 色點附等價文字(title/aria-label),狀態不得只靠顏色(W8-5);
                報讀器唸列時會先聽到狀態再聽到標題。mt-[5px] 對齊第一行文字的 x-height */}
            <span className={`w-2.5 h-2.5 rounded-full mt-[5px] shrink-0 ${DOT_CLS[it.state]}`}
              role="img" title={DOT_LABEL[it.state]} aria-label={DOT_LABEL[it.state]} />
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-2 flex-wrap">
                <span className="text-body text-[var(--text)] min-w-0 [text-wrap:pretty]">{it.ob.title}</span>
                {countdown && <span className={`num text-caption ${COUNTDOWN_CLS[it.state]}`}>{countdown}</span>}
              </span>
              <span className="block mt-0.5 num text-caption text-[var(--text-3)] truncate">
                {[it.phase, formatObligationRule(it.ob), it.due ? `到期 ${localISODate(it.due)}` : '', it.ob.responsible].filter(Boolean).join(' · ')}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )

  // 基準日與契約總價:位置與內容都不動(在清單之下,設完基準日回頭看清單的到期日即時變)
  const anchorsCard = (
    <Card title="基準日與契約總價">
      <div className="flex flex-wrap gap-4">
        <AnchorDates anchors={anchors} onSet={setAnchor} disabled={!can.edit} />
        {/* 手填契約價金總額:百分比制逾期罰款的試算基準(W10);onBlur 才寫 DB */}
        <Field label="契約價金總額(元)">
          <Input type="number" min="0" step="1" value={totalDraft} placeholder="未填則採標單加總"
            onChange={(e) => setTotalDraft(e.target.value)}
            onBlur={() => {
              const v = totalDraft.trim() === '' ? null : Number(totalDraft)
              if (v != null && (!Number.isFinite(v) || v < 0)) { setAnchorErr('契約價金總額需為 0 以上的數字'); return }
              if ((currentProject?.contract_total ?? null) === v) return
              setAnchor('contract_total', v)
            }}
            disabled={!can.edit} />
        </Field>
      </div>
      <ErrorBanner msg={anchorErr} className="mt-2" />
      <p className="text-xs text-[var(--text-3)] mt-3">期限追蹤的到期日、倒數、逾期都依這些基準日即時計算;「開工日」請填實際開工日。契約價金總額用於逾期違約金試算,未填時以標單可計價金額代替。</p>
    </Card>
  )

  return (
    <div className="space-y-5">
      {/* 三個總數進頁首 meta 而不是另開一張卡:tagline 就寫「逾期有數」,這三個數字是
          本頁的承諾;它們不是篩選器(期程快篩才是),所以不做成 chip */}
      <PageHeader title="期限追蹤" tagline="到期不漏、逾期有數"
        subtitle="已確認的契約期限依基準日推算到期日;提送後掛上佐證,逾期自動試算違約金。新期限請到「契約重點」確認。"
        meta={dueItems.length ? [
          { k: '已逾期', v: `${dueCounts.overdue} 項` },
          { k: '7 日內到期', v: `${dueCounts.soon} 項` },
          { k: '已完成', v: `${dueCounts.done} 項` },
        ] : []} />

      {dueItems.length === 0 ? (
        <Card title="契約期限" bodyClass="p-0">
          <Empty>尚無已確認的履約義務。契約重點的項目確認後會自動出現在這裡(帶時點的會推算到期日)。</Empty>
        </Card>
      ) : (
        <ListDetailLayout
          detail={detailBody}
          detailLabel="期限詳情"
          detailEmpty={<Empty>點左側清單查看期限的規則、倒數、佐證與罰款試算。</Empty>}
          drawerOpen={detailOpen && !!selected}
          onDrawerClose={closeDetail}>
          {/* ── 左欄:一份清單(右欄與抽屜由殼統一,見 components/listDetail.jsx)。
              列印對照表從頂部摘要卡搬到卡頭:它印的就是這份清單 */}
          <Card title={`契約期限（${dueItems.length}）`} bodyClass="p-0" action={
            <Link to="/contract/print" className={buttonClass('outline', 'sm')}>
              <MSym name="print" size={14} /> 列印對照表
            </Link>
          }>
            {filterBar}
            {listRows}
          </Card>
        </ListDetailLayout>
      )}

      {anchorsCard}
    </div>
  )
}
