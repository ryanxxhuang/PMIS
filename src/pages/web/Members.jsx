import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Badge, Empty, PageHeader, SkeletonList, Input, Select, ErrorBanner } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../../components/confirm.jsx'

const ORG_LABEL = { contractor: '施工廠商', supervisor: '監造單位', owner: '主辦機關' }
const ORG_COLOR = { contractor: 'blue', supervisor: 'amber', owner: 'purple' }

export default function Members() {
  const { project, listMembers, addMemberByEmail, removeMember, currentUser,
    isSupabaseConfigured, currentProject, demoMode, enableFormalMode } = useStore()
  // 三態分離(W4-1/P1-05):members=null 載入中、loadError 載入失敗(可重試)、
  // []=真的沒成員——三者不可再共用同一個空陣列。
  const [members, setMembers] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [email, setEmail] = useState('')
  const [inviteOrg, setInviteOrg] = useState('') // W4-3:邀請方必須宣告要邀哪一方
  const [busy, setBusy] = useState(false)
  // 結果訊息帶 ok 旗標而非事後 includes() 比對字串:文案一改,語意色就跟著錯,
  // 而錯誤/成功要走的元件(ErrorBanner／Badge)不同,不能靠文字猜。
  const [msg, setMsg] = useState(null)
  const [formalMsg, setFormalMsg] = useState(null)

  const reload = useCallback(async () => {
    setMembers(null); setLoadError(null)
    const { rows, error } = await listMembers()
    if (error) setLoadError(error)
    else setMembers(rows)
  }, [listMembers])
  useEffect(() => { reload() }, [reload])

  if (isSupabaseConfigured && !currentProject) {
    // 早退分支也給 PageHeader＋space-y-5:未選專案時頁面標題不該憑空消失(與 Activity/RiskAudit 一致)
    return (
      <div className="space-y-5">
        <PageHeader title="專案成員" tagline="Team" subtitle="邀請監造 / 機關 / 協力廠商加入本專案" />
        <Card bodyClass="p-0"><Empty>請先登入並選擇專案。</Empty></Card>
      </div>
    )
  }

  // 只有專案建立者(admin)可管理成員
  const isAdmin = demoMode ? true : (members || []).find((m) => m.user_id === currentUser?.user_id)?.member_role === 'admin'

  // W4-4:三方到齊檢查——null=名單未載入(載入中/失敗),無法確認;[]=到齊
  const missingOrgs = members
    ? ['contractor', 'supervisor', 'owner'].filter((o) => !members.some((m) => m.org_type === o))
    : null

  const onAdd = async () => {
    if (!email.trim() || !inviteOrg) return
    setBusy(true); setMsg(null)
    const { error } = await addMemberByEmail(email.trim(), 'member', inviteOrg)
    setBusy(false)
    if (error) { setMsg({ ok: false, text: friendlyError(error, '成員加入失敗') }); return }
    setEmail(''); setMsg({ ok: true, text: `已加入(${ORG_LABEL[inviteOrg]})。` })
    reload()
  }
  const onRemove = async (m) => {
    if (!(await appConfirm({ title: `將 ${m.full_name} 移出本專案？`, danger: true, confirmLabel: '移出' }))) return
    await removeMember(m.user_id)
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

  return (
    <div className="space-y-5">
      <PageHeader title="專案成員" tagline="Team" subtitle="邀請監造 / 機關 / 協力廠商加入本專案"
        meta={[{ k: '成員數', v: members ? String(members.length) : '—' }]} />

      {isAdmin && (
        <Card title="加入成員">
          {/* W4-3(D-009):邀請方宣告受邀方身分,伺服器與對方註冊身分比對,不符即擋 */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]"><Field label="對方帳號 Email">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="supervisor@example.com" type="email" />
            </Field></div>
            <div className="min-w-[140px]"><Field label="受邀方身分">
              <Select value={inviteOrg} onChange={(e) => setInviteOrg(e.target.value)}>
                <option value="">請選擇…</option>
                <option value="contractor">施工廠商</option>
                <option value="supervisor">監造單位</option>
                <option value="owner">主辦機關</option>
              </Select>
            </Field></div>
            {/* min-h 補到與 input/select 同高(py-2+text-sm+1px 框 = 38px):Button 沒有框,
                差那 2px 會讓整列的底線看起來歪掉。手機的 max-md:min-h-11 仍然勝出(在 media query 內) */}
            <Button onClick={onAdd} disabled={busy || !email.trim() || !inviteOrg} className="min-h-[38px]">{busy ? '加入中…' : '＋ 加入專案'}</Button>
          </div>
          {/* hint 拉出來自成一行:掛在 Email 欄的 Field 裡會把該欄整個頂高,
              另兩欄沒有 hint,items-end 下三者中線就錯開(W8-6 ISSUE-3) */}
          <p className="text-xs text-[var(--text-3)] mt-2">對方需先在本系統註冊；與你指定的身分不符時會被擋下,不會誤入專案。</p>
          {/* 失敗走 ErrorBanner(會換行、帶 error 圖示),成功用 Badge——長錯誤訊息塞進 nowrap 的 Badge 會撐破 375px */}
          {msg && (msg.ok
            ? <p className="mt-2"><Badge color="green">{msg.text}</Badge></p>
            : <ErrorBanner msg={msg.text} className="mt-2" />)}
          {demoMode && <p className="text-xs text-[var(--text-3)] mt-2">（demo 模式為展示用，實際邀請需登入真實專案。）</p>}
        </Card>
      )}

      {!demoMode && isSupabaseConfigured && (
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
                : <p className="text-xs text-[var(--text-3)]">僅專案建立者可開啟。</p>}
            </div>
          )}
          {formalMsg && (formalMsg.ok
            ? <p className="mt-2"><Badge color="green">{formalMsg.text}</Badge></p>
            : <ErrorBanner msg={formalMsg.text} className="mt-2" />)}
        </Card>
      )}

      <Card title="成員名單" aria-busy={members === null ? 'true' : undefined}>
        {loadError ? (
          // 載入失敗不是空狀態:走 ErrorBanner 才說得出「失敗」並給重試(README 狀態規格)
          <ErrorBanner msg={friendlyError(loadError, '成員載入失敗')} onRetry={reload} />
        ) : members === null ? <SkeletonList rows={3} />
          : members.length === 0 ? <Empty>此專案尚無成員。</Empty> : (
          <div className="divide-y divide-[var(--border-2)]">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-[var(--primary)] text-[var(--primary-fg)] flex items-center justify-center font-medium text-sm shrink-0">{m.full_name?.[0] || '?'}</div>
                  <div className="min-w-0">
                    <div className="text-sm text-[var(--text)] truncate">{m.full_name}
                      {m.member_role === 'admin' && <Badge color="green">建立者</Badge>}
                      {m.user_id === currentUser?.user_id && <span className="text-xs text-[var(--text-3)] ml-1">（你）</span>}
                    </div>
                    <div className="text-xs text-[var(--text-3)] truncate">{m.company || '—'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge color={ORG_COLOR[m.org_type] || 'slate'}>{ORG_LABEL[m.org_type] || m.org_type}</Badge>
                  {isAdmin && m.user_id !== currentUser?.user_id && (
                    <Button size="sm" variant="ghost" onClick={() => onRemove(m)}>移除</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* W4-2/P1-06:文案以 can(store.jsx)與 RLS/guard(migrations)實際行為為準——
          機關不是唯讀:變更核准/駁回、估驗請款與撥款登錄、驗收各階段、風險稽核都是機關的簽核權。 */}
      <p className="text-xs text-[var(--text-3)]">
        權限依組織別：<b>施工廠商</b>填報／提送（日誌、估驗提送、查驗申請、送審、疑義提出）；
        <b>監造單位</b>審核／判定（估驗核定、查驗判定、缺失複查結案、送審審定、疑義回覆、變更初審）；
        <b>主辦機關</b>契約級簽核（變更設計核准／駁回、估驗請款與撥款登錄、驗收各階段、風險稽核），對日常填報唯讀。
        專案建立者於試用模式有跨角色權限；開啟正式模式後回歸自己的組織別。
      </p>
    </div>
  )
}
