import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Badge, Dot, Empty, PageHeader, SkeletonList, Input, Select, ErrorBanner } from '../../components/ui.jsx'
import { ListDetailLayout, LIST_DETAIL_GRID, SearchField, StatusChip, MetaGrid } from '../../components/listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../../components/confirm.jsx'

const ORGS = ['contractor', 'supervisor', 'owner']
const ORG_LABEL = { contractor: '施工廠商', supervisor: '監造單位', owner: '主辦機關' }
const ORG_COLOR = { contractor: 'blue', supervisor: 'amber', owner: 'purple' }
// project_memberships.project_role 的中文(僅顯示;權限不由它推導,DEVELOPMENT.md §4)
const ROLE_LABEL = {
  agency_pm: '機關專案經理', agency_engineer: '機關工程師',
  contractor_pm: '廠商專案經理', site_manager: '工地主任',
  quality_engineer: '品管工程師', safety_engineer: '工安工程師',
  supervisor_manager: '監造經理', supervisor_engineer: '監造工程師',
  document_controller: '文件管理員', viewer: '檢視者',
}
const DEFAULT_FILTERS = { q: '', org: '' }
const BLANK_INVITE = { email: '', org: '' }

// 成員頁的版面:改版前是「加入成員卡＋正式模式卡＋名單卡」三張直排,移除鈕掛在每一列。
// 現在是一份名單(三方快篩＋搜尋)＋詳情欄:身分快照與移除動作永遠在同一個位置
// (規範 §0 疊合版),邀請表單住在名單卡頂部就地處理,不跳頁、不開對話框(判準第 3 條)。
// 正式模式卡不是清單/詳情形狀,維持原樣放在殼下方。
export default function Members() {
  const { project, listMembers, addMemberByEmail, removeMember, currentUser,
    isSupabaseConfigured, currentProject, demoMode, enableFormalMode } = useStore()
  // 三態分離(W4-1/P1-05):members=null 載入中、loadError 載入失敗(可重試)、
  // []=真的沒成員——三者不可再共用同一個空陣列。
  const [members, setMembers] = useState(null)
  const [loadError, setLoadError] = useState(null)
  // 邀請表單:null=收起;{ email, org }=展開中(W4-3:邀請方必須宣告要邀哪一方)
  const [invite, setInvite] = useState(null)
  const [busy, setBusy] = useState(false)
  // 結果訊息帶 ok 旗標而非事後 includes() 比對字串:文案一改,語意色就跟著錯,
  // 而錯誤/成功要走的元件(ErrorBanner／Badge)不同,不能靠文字猜。
  const [msg, setMsg] = useState(null)
  const [formalMsg, setFormalMsg] = useState(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const searchRef = useRef(null)

  const reload = useCallback(async () => {
    setMembers(null); setLoadError(null)
    const { rows, error } = await listMembers()
    if (error) setLoadError(error)
    else setMembers(rows)
  }, [listMembers])
  useEffect(() => { reload() }, [reload])

  // 只有 project_members.role='admin' 可管理成員(D-022:created_by 已退出授權判斷);
  // 前端只鏡像,伺服器 RPC 才是強制點。demo 一律可管,保留三方角色劇本。
  const isAdmin = demoMode ? true : (members || []).find((m) => m.user_id === currentUser?.user_id)?.member_role === 'admin'

  // W4-4:三方到齊檢查——null=名單未載入(載入中/失敗),無法確認;[]=到齊
  const missingOrgs = members
    ? ORGS.filter((o) => !members.some((m) => m.org_type === o))
    : null

  // 三方件數走全體名單(不受搜尋影響):chip 上的數字是「本案這一方有幾人」,
  // 0 人的一方也留著——「監造還沒加入」正是開正式模式前要看到的資訊。
  const orgCounts = useMemo(
    () => Object.fromEntries(ORGS.map((o) => [o, (members || []).filter((m) => m.org_type === o).length])),
    [members],
  )
  // 目前畫面上的名單:三方 AND 關鍵字(姓名/公司/契約方),順序沿用 RPC(加入先後)。
  const ordered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return (members || [])
      .filter((m) => !filters.org || m.org_type === filters.org)
      .filter((m) => !q || [m.full_name, m.company, m.party_display_name].some((v) => (v || '').toLowerCase().includes(q)))
  }, [members, filters])
  const anyFilter = filters.q.trim() !== '' || filters.org !== ''

  // 選取/深連結(?member=)/切案重置/初次自動選取:共用殼 hook,預設選自己(開頁先看到
  // 自己在本案的身分快照),沒有就選第一位。
  const pid = currentProject?.project_id
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'member', idPrefix: 'mem-',
    scope: `${pid}/${demoMode}`,
    ready: !!members && members.length > 0, rows: members || [],
    pickDefault: () => (ordered.find((m) => m.user_id === currentUser?.user_id) || ordered[0])?.user_id,
    onSelect: () => setMsg(null),
    onReset: () => { setInvite(null); setFilters(DEFAULT_FILTERS) },
  })
  // 篩選後選中項被篩掉:右欄內容保留(與 /safety 同),清單中只是沒有高亮列
  const selected = (members || []).find((m) => m.user_id === selectedId) || null
  // 鍵盤:↑/↓ 移動選取、/ 聚焦搜尋。邀請表單開著就停用——焦點落在「加入專案」鈕上
  // 按 ↓ 會換選取,打到一半的 email 雖不會消失,但畫面焦點會跑掉。
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'mem-', modalUp: !!invite, searchRef })

  if (isSupabaseConfigured && !currentProject) {
    // 早退分支也給 PageHeader＋space-y-5:未選專案時頁面標題不該憑空消失(與 Activity/RiskAudit 一致)
    return (
      <div className="space-y-5">
        <PageHeader title="專案成員" tagline="Team" subtitle="邀請監造 / 機關 / 協力廠商加入本專案" />
        <Card bodyClass="p-0"><Empty>請先登入並選擇專案。</Empty></Card>
      </div>
    )
  }

  const onInvite = async () => {
    if (!invite?.email.trim() || !invite.org) return
    setBusy(true); setMsg(null)
    const { error } = await addMemberByEmail(invite.email.trim(), 'member', invite.org)
    setBusy(false)
    if (error) { setMsg({ ok: false, text: friendlyError(error, '成員加入失敗') }); return }
    setMsg({ ok: true, text: `已加入(${ORG_LABEL[invite.org]})。` })
    setInvite(null)
    reload()
  }
  const onRemove = async (m) => {
    // 移出是不可逆動作(對方失去本案存取),才用確認框(判準第 5 條)
    if (!(await appConfirm({ title: `將 ${m.full_name} 移出本專案？`, danger: true, confirmLabel: '移出' }))) return
    setMsg(null)
    const { error } = await removeMember(m.user_id)
    if (error) { setMsg({ ok: false, text: friendlyError(error, '成員移除失敗') }); return }
    closeDetail() // <lg 抽屜承載的正是這一位,移出後不留 detailOpen 殘值
    reload()
  }
  const onEnableFormal = async () => {
    // W4-4:確認畫面如實列出三方到齊狀態——不齊也可開(到齊與否是專案自己的決定),
    // 但缺哪方、後果是什麼要先講清楚;requireText 即二次確認。
    const readiness = missingOrgs === null
      ? '⚠ 目前無法確認三方成員是否到齊(名單載入中或載入失敗),建議先回成員名單確認。'
      : missingOrgs.length
        ? `⚠ 三方尚未到齊,目前缺:${missingOrgs.map((o) => ORG_LABEL[o]).join('、')}。開啟後,缺席角色負責的簽核(核定/判定/核准)將無人可執行,直到該身分的成員加入。`
        : '三方成員已到齊(施工廠商、監造單位、主辦機關)。'
    const ok = await appConfirm({
      title: '開啟正式模式？', danger: true, confirmLabel: '開啟（不可復原）',
      body: `${readiness}\n\n開啟後,估驗核定、查驗判定、送審審定、RFI 回覆、變更核准等簽核動作,必須由對應角色（監造/機關）的帳號執行;你將失去跨角色權限,僅保留成員與專案管理,且無法自行關閉。`,
      requireText: project.project_name,
    })
    if (!ok) return
    setBusy(true); setFormalMsg(null)
    const { error } = await enableFormalMode()
    setBusy(false)
    setFormalMsg(error ? { ok: false, text: friendlyError(error, '正式模式開啟失敗') } : { ok: true, text: '正式模式已開啟。' })
  }

  // 寫成同一行的 `const header = <PageHeader`:pageTabs.earlyReturn.test 靠這個字面辨認頁首變數
  const header = <PageHeader title="專案成員" tagline="Team" subtitle="邀請監造 / 機關 / 協力廠商加入本專案"
      meta={[{ k: '成員數', v: members ? String(members.length) : '—' }]}
      action={isAdmin && members && (
        <Button variant="secondary" onClick={() => { setInvite(invite ? null : { ...BLANK_INVITE }); setMsg(null) }}>
          {invite ? '取消邀請' : <><MSym name="add" size={16} />邀請成員</>}
        </Button>
      )} />

  // ── 詳情欄:身分快照 / key-value / 動作列。動作只看 isAdmin 且不是自己——
  // 與改版前列內移除鈕同一組條件,一條都沒放寬(RPC remove_member 另行強制)。
  // 「改角色」沒有既有 store 函式(admin 只在建案時指定),這裡不新增,只顯示。
  let detailBody = null
  if (selected) {
    const m = selected
    const isMe = m.user_id === currentUser?.user_id
    const removable = isAdmin && !isMe
    // region 以姓名命名:報讀器走地標時直接聽到「王建國 詳情」,e2e 也用同一個名字
    // 確認詳情欄正在顯示哪一位
    detailBody = (
      <section aria-label={`${m.full_name} 詳情`}>
        {/* 狀態列:三方身分＋管理權＋(你);顏色＋文字並存 */}
        <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <Badge color={ORG_COLOR[m.org_type] || 'slate'}>{ORG_LABEL[m.org_type] || m.org_type}</Badge>
          {m.member_role === 'admin' && <Badge color="green">管理員</Badge>}
          {isMe && <Badge color="slate">你</Badge>}
        </div>

        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--primary)] text-[var(--primary-fg)] flex items-center justify-center font-medium text-body shrink-0" aria-hidden>{m.full_name?.[0] || '?'}</div>
            <div className="min-w-0">
              <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{m.full_name}</div>
              <div className="text-footnote text-[var(--text-3)] truncate">{m.company || '—'}</div>
            </div>
          </div>
          {/* 空值一律顯示 —:五格固定,眼睛掃同一位置就知道有沒有填。
              加入時間 RPC 沒有回,不硬湊(list_project_members 只回身分欄位) */}
          <MetaGrid className="mt-3.5" rows={[
            ['三方身分', ORG_LABEL[m.org_type] || m.org_type || '—'],
            ['公司', m.company || '—'],
            ['管理權', m.member_role === 'admin' ? '管理員（可管理成員與專案設定）' : '成員'],
            ['契約方', m.party_display_name || '—'],
            ['專案職務', ROLE_LABEL[m.project_role] || m.project_role || '—'],
          ]} />
        </div>

        {/* 動作列:只有移出(不可逆→appConfirm)。自己與非管理員都看不到這列 */}
        {removable && (
          <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="secondary" onClick={() => onRemove(m)} disabled={busy}>移出本專案</Button>
          </div>
        )}
        {isMe && (
          <p className="px-4 pb-4 text-caption text-[var(--text-3)] leading-relaxed">這是你自己在本案的身分快照;管理員不能移出自己。</p>
        )}
      </section>
    )
  }

  // ── 名單卡頂部:邀請表單(就地處理)。W4-3(D-009):邀請方宣告受邀方身分,
  // 伺服器與對方註冊身分比對,不符即擋。
  const inviteForm = invite && (
    <div className="px-5 py-4 border-b border-[var(--border-2)] bg-[var(--surface-2)]">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]"><Field label="對方帳號 Email">
          <Input value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="supervisor@example.com" type="email" />
        </Field></div>
        <div className="min-w-[140px]"><Field label="受邀方身分">
          <Select value={invite.org} onChange={(e) => setInvite({ ...invite, org: e.target.value })}>
            <option value="">請選擇…</option>
            {ORGS.map((o) => <option key={o} value={o}>{ORG_LABEL[o]}</option>)}
          </Select>
        </Field></div>
        {/* min-h 補到與 input/select 同高(py-2+text-sm+1px 框 = 38px):Button 沒有框,
            差那 2px 會讓整列的底線看起來歪掉。手機的 max-md:min-h-11 仍然勝出(在 media query 內) */}
        <Button onClick={onInvite} disabled={busy || !invite.email.trim() || !invite.org} className="min-h-[38px]">{busy ? '加入中…' : '加入專案'}</Button>
      </div>
      {/* hint 拉出來自成一行:掛在 Email 欄的 Field 裡會把該欄整個頂高,
          另兩欄沒有 hint,items-end 下三者中線就錯開(W8-6 ISSUE-3) */}
      <p className="text-xs text-[var(--text-3)] mt-2">對方需先在本系統註冊；與你指定的身分不符時會被擋下,不會誤入專案。</p>
      {demoMode && <p className="text-xs text-[var(--text-3)] mt-1">（demo 模式為展示用，實際邀請需登入真實專案。）</p>}
    </div>
  )

  // ── 卡頭下方:搜尋 + 三方快篩(件數走全體),兩條件 AND
  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋姓名、公司…" aria-label="搜尋成員" />
      <div className="flex items-center gap-2 flex-wrap">
        {ORGS.map((o) => (
          <StatusChip key={o} active={filters.org === o} count={orgCounts[o]}
            onClick={() => setFilters((f) => ({ ...f, org: f.org === o ? '' : o }))}>
            <Dot color={ORG_COLOR[o]} />{ORG_LABEL[o]}
          </StatusChip>
        ))}
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>清除篩選</Button>
        )}
      </div>
    </div>
  )

  // ── 清單列:只負責選取(動作全在詳情欄),兩行=姓名＋標記＋三方身分 / 公司。
  // 真正的 <ul>/<li>(role="list" 要明寫:Tailwind preflight 的 list-style:none 會讓
  // Safari 拿掉清單語意);aria-current 與其他殼頁同一套選取語意。
  const listRows = (
    <ul role="list" aria-label="成員名單" className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <li className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的成員。<br />換一方身分,或試試姓名、公司關鍵字。
        </li>
      ) : ordered.map((m) => {
        const active = m.user_id === selectedId
        const isMe = m.user_id === currentUser?.user_id
        return (
          <li key={m.user_id}>
            <button type="button" id={`mem-${m.user_id}`}
              aria-current={active || undefined}
              onClick={() => select(m.user_id, { openPane: true })}
              className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer flex items-center gap-3 ${active
                ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
              <span className="w-9 h-9 rounded-full bg-[var(--primary)] text-[var(--primary-fg)] flex items-center justify-center font-medium text-sm shrink-0" aria-hidden>{m.full_name?.[0] || '?'}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-body text-[var(--text)] min-w-0 [text-wrap:pretty]">{m.full_name}</span>
                  {isMe && <span className="text-caption text-[var(--text-3)]">（你）</span>}
                  {m.member_role === 'admin' && <Badge color="green">管理員</Badge>}
                  <Badge color={ORG_COLOR[m.org_type] || 'slate'}>{ORG_LABEL[m.org_type] || m.org_type}</Badge>
                </span>
                <span className="block mt-0.5 text-caption text-[var(--text-3)] truncate">{m.company || '—'}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )

  // 正式模式卡不是清單/詳情形狀,維持原內容
  const formalCard = !demoMode && isSupabaseConfigured && (
    <Card title="正式模式">
      {currentProject?.formal_mode ? (
        <div className="flex items-start gap-2 text-sm">
          <Badge color="green">已開啟</Badge>
          <span className="text-[var(--text-2)]">簽核動作僅能由對應角色帳號執行;專案建立者僅保留成員與專案管理。</span>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-[var(--text-2)]">
            目前為<b>試用模式</b>:專案建立者擁有跨角色完整權限,方便單人試用。正式履約前請開啟正式模式,開啟後:
          </p>
          <ul className="text-sm text-[var(--text-2)] list-disc pl-5 space-y-0.5">
            <li>估驗核定、查驗判定、送審審定、RFI 回覆僅限監造帳號;變更設計核准僅限機關/監造。</li>
            <li>專案建立者僅保留成員管理與專案設定,依自己的組織別行事。</li>
            <li><b>開啟後不可自行關閉</b>(履約證據完整性)。</li>
          </ul>
          {/* W4-4:開啟前先看得到三方到齊狀態(對話框內會再確認一次) */}
          {/* 狀態色收進 Badge,句子本身回歸中性內文色;整句包 Badge 會因 nowrap 在 375px 撐出橫捲 */}
          {missingOrgs !== null && (
            missingOrgs.length
              ? <p className="text-sm text-[var(--text-2)]"><Badge color="amber">三方到齊檢查</Badge>:尚缺 {missingOrgs.map((o) => ORG_LABEL[o]).join('、')}。</p>
              : <p className="text-sm text-[var(--text-2)]"><Badge color="green">三方到齊檢查</Badge>:施工廠商、監造單位、主辦機關都已加入。</p>
          )}
          {/* W8-3A(D-014):首頁初始化清單是準備指引,不是開啟正式模式的前置條件。
              這裡照舊只做三方到齊提醒＋二次確認,不因清單未完成而 disabled。 */}
          <p className="text-xs text-[var(--text-3)]">
            首頁的專案初始化清單是準備指引:不要求清空 AI 整理出的建議,也不會擋住這裡開啟正式模式。
          </p>
          {isAdmin
            ? <Button variant="danger" onClick={onEnableFormal} disabled={busy}>開啟正式模式</Button>
            : <p className="text-xs text-[var(--text-3)]">僅專案管理員可開啟。</p>}
        </div>
      )}
      {formalMsg && (formalMsg.ok
        ? <p className="mt-2"><Badge color="green">{formalMsg.text}</Badge></p>
        : <ErrorBanner msg={formalMsg.text} className="mt-2" />)}
    </Card>
  )

  // W4-2/P1-06:文案以 can(store.jsx)與 RLS/guard(migrations)實際行為為準——
  // 機關不是唯讀:變更核准/駁回、估驗請款與撥款登錄、驗收各階段、風險稽核都是機關的簽核權。
  const footnote = (
    <p className="text-xs text-[var(--text-3)]">
      權限依組織別：<b>施工廠商</b>填報／提送（日誌、估驗提送、查驗申請、送審、疑義提出）；
      <b>監造單位</b>審核／判定（估驗核定、查驗判定、缺失複查結案、送審審定、疑義回覆、變更初審）；
      <b>主辦機關</b>契約級簽核（變更設計核准／駁回、估驗請款與撥款登錄、驗收各階段、風險稽核），對日常填報唯讀。
      專案建立者於試用模式有跨角色權限；開啟正式模式後回歸自己的組織別。
    </p>
  )

  // ── 版面分支:載入中的骨架與正式版面共用同一組欄寬(載入完成不位移)
  if (members === null && !loadError) {
    return (
      <div className="space-y-5">
        {header}
        <div className={LIST_DETAIL_GRID}>
          <Card title="成員名單" bodyClass="p-5" aria-busy="true"><SkeletonList rows={3} label="正在載入成員…" /></Card>
          <Card className="hidden lg:block"><SkeletonList rows={3} label="" /></Card>
        </div>
        {formalCard}
        {footnote}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {header}

      {/* 失敗走 ErrorBanner(會換行、帶 error 圖示),成功用 Badge——長錯誤訊息塞進 nowrap 的 Badge 會撐破 375px */}
      {msg && (msg.ok
        ? <p><Badge color="green">{msg.text}</Badge></p>
        : <ErrorBanner msg={msg.text} onClose={() => setMsg(null)} />)}

      {loadError ? (
        // 載入失敗不是空狀態:走 ErrorBanner 才說得出「失敗」並給重試(README 狀態規格)
        <Card title="成員名單"><ErrorBanner msg={friendlyError(loadError, '成員載入失敗')} onRetry={reload} /></Card>
      ) : members.length === 0 ? (
        <Card title="成員名單" bodyClass="p-0">
          {inviteForm}
          <Empty>此專案尚無成員。{isAdmin ? '用右上「邀請成員」加入施工廠商、監造單位與主辦機關的帳號;' : '請管理員邀請三方帳號;'}三方到齊後正式模式的簽核才有人可執行。</Empty>
        </Card>
      ) : (
        <ListDetailLayout
          detail={detailBody}
          detailLabel="成員詳情"
          detailEmpty={<Empty>點左側清單查看成員的身分快照。</Empty>}
          drawerOpen={detailOpen && !!selected}
          onDrawerClose={closeDetail}>
          {/* ── 左欄:一份名單(右欄與抽屜由殼統一,見 components/listDetail.jsx)。
              三方件數都在快篩 chip 上,同一個數字不寫兩次 */}
          <Card title={`成員名單（${members.length}）`} bodyClass="p-0">
            {inviteForm}
            {filterBar}
            {listRows}
          </Card>
        </ListDetailLayout>
      )}

      {formalCard}
      {footnote}
    </div>
  )
}
