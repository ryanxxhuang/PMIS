import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Badge, Empty, PageHeader } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'

const ORG_LABEL = { contractor: '施工廠商', supervisor: '監造單位', owner: '主辦機關' }
const ORG_COLOR = { contractor: 'blue', supervisor: 'amber', owner: 'purple' }
const PARTY_LABEL = { agency: '主辦機關', contractor: '施工廠商', supervisor: '監造單位', designer: '設計', consultant: '顧問', other: '待確認' }
const PARTY_COLOR = { agency: 'purple', contractor: 'blue', supervisor: 'amber', designer: 'slate', consultant: 'slate', other: 'slate' }
const input = 'w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm transition-colors placeholder:text-[var(--text-3)] focus:border-[var(--blue)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20'

export default function Members() {
  const { project, listMembers, addMemberByEmail, removeMember, currentUser,
    isSupabaseConfigured, currentProject, demoMode, can } = useStore()
  const [members, setMembers] = useState([])
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const reload = useCallback(async () => { setMembers(await listMembers()) }, [listMembers])
  useEffect(() => { reload() }, [reload])

  if (isSupabaseConfigured && !currentProject) {
    return <Card title="專案成員"><Empty>請先登入並選擇專案。</Empty></Card>
  }

  // P0-03:技術管理來自 v2 membership,不再以 legacy creator/admin 推導。
  const isAdmin = demoMode ? true : can.manageProjectIdentity

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
      <PageHeader title="專案成員" tagline="Team" subtitle="技術管理與契約角色分離；權限依本專案的參與方與角色套用"
        meta={[{ k: '成員數', v: String(members.length) }]} />

      {isAdmin && (
        <Card title="加入成員">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]"><Field label="對方帳號 Email" hint="對方需先註冊；既有邀請流程會以 profile 作遷移提示，未能可靠對應時保持待確認／唯讀。">
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
                      {m.is_project_admin && <Badge color="green">技術管理員</Badge>}
                      {m.user_id === currentUser?.user_id && <span className="text-xs text-[var(--text-3)] ml-1">（你）</span>}
                    </div>
                    <div className="text-xs text-[var(--text-3)] truncate">{m.company || '—'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge color={PARTY_COLOR[m.party_type] || ORG_COLOR[m.org_type] || 'slate'}>
                    {PARTY_LABEL[m.party_type] || ORG_LABEL[m.org_type] || '待確認'}
                  </Badge>
                  {m.project_role && <span className="text-xs text-[var(--text-3)]">{m.project_role}</span>}
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
        契約權限由 project party + project role 決定；技術管理員只能管理專案身分與設定，
        不會因此取得估驗核定、查驗判定、變更核准或成本資料權限。
      </p>
    </div>
  )
}
