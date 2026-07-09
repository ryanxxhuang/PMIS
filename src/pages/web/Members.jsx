import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Badge, Empty, PageHeader } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'

const ORG_LABEL = { contractor: '施工廠商', supervisor: '監造單位', owner: '主辦機關' }
const ORG_COLOR = { contractor: 'blue', supervisor: 'amber', owner: 'purple' }
const input = 'w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm transition-colors placeholder:text-[var(--text-3)] focus:border-[var(--blue)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20'

export default function Members() {
  const { project, listMembers, addMemberByEmail, removeMember, currentUser,
    isSupabaseConfigured, currentProject, demoMode } = useStore()
  const [members, setMembers] = useState([])
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const reload = useCallback(async () => { setMembers(await listMembers()) }, [listMembers])
  useEffect(() => { reload() }, [reload])

  if (isSupabaseConfigured && !currentProject) {
    return <Card title="專案成員"><Empty>請先登入並選擇專案。</Empty></Card>
  }

  // 只有專案建立者(admin)可管理成員
  const isAdmin = demoMode ? true : members.find((m) => m.user_id === currentUser?.user_id)?.member_role === 'admin'

  const onAdd = async () => {
    if (!email.trim()) return
    setBusy(true); setMsg('')
    const { error } = await addMemberByEmail(email.trim())
    setBusy(false)
    if (error) { setMsg(error.message || '加入失敗'); return }
    setEmail(''); setMsg('已加入。')
    reload()
  }
  const onRemove = async (m) => {
    if (!(await appConfirm({ title: `將 ${m.full_name} 移出本專案？`, danger: true, confirmLabel: '移出' }))) return
    await removeMember(m.user_id)
    reload()
  }

  return (
    <div className="space-y-5">
      <PageHeader title="專案成員" tagline="Team" subtitle="邀請監造 / 機關 / 協力廠商加入，依組織別自動套用權限"
        meta={[{ k: '成員數', v: String(members.length) }]} />

      {isAdmin && (
        <Card title="加入成員">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]"><Field label="對方帳號 Email" hint="對方需先在本系統註冊；權限依其註冊時選的組織別（施工/監造/機關）自動套用。">
              <input className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="supervisor@example.com" type="email" />
            </Field></div>
            <Button onClick={onAdd} disabled={busy || !email.trim()}>{busy ? '加入中…' : '＋ 加入專案'}</Button>
          </div>
          {msg && <p className={`text-sm mt-2 ${msg.includes('已加入') ? 'text-emerald-600' : 'text-rose-600'}`}>{msg}</p>}
          {demoMode && <p className="text-xs text-[var(--text-3)] mt-2">（demo 模式為展示用，實際邀請需登入真實專案。）</p>}
        </Card>
      )}

      <Card title="成員名單">
        {members.length === 0 ? <Empty>載入中…</Empty> : (
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center justify-between gap-3 border-b border-[var(--border-2)] pb-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-[var(--primary)] text-white flex items-center justify-center font-medium text-sm shrink-0">{m.full_name?.[0] || '?'}</div>
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
                    <button onClick={() => onRemove(m)} className="text-[var(--text-3)] hover:text-rose-500 text-xs">移除</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="text-xs text-[var(--text-3)]">
        權限依組織別：<b>施工廠商</b>填報 / 提送（日誌、估驗送審、查驗申請、送審、疑義提出）；
        <b>監造單位</b>審核 / 判定（核定估驗、查驗合格判定、缺失複查結案、送審核備、疑義回覆）；
        <b>主辦機關</b>唯讀。專案建立者不受此限，擁有完整權限。
      </p>
    </div>
  )
}
