// /agent — 專屬 agent 主控台(批2):使用者不再需要知道「該去哪一頁做事」,
// 描述目的,由角色化 agent 去查、去擬。三塊:對話(主角,接 agent-run 多輪查詢)、
// 今日待我處理(ball-in-court 球在我方)、AI 草稿收件匣(agent_actions pending,
// 人接受/拒絕——AI 只擬草稿,決定權永遠在人)。
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Bot, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, PageHeader, Badge, Button, Empty, ErrorBanner } from '../../components/ui.jsx'
import { useStore } from '../../store.jsx'
import { useAssistantData } from '../../lib/assistantData.js'
import { displayAgentRole, AGENT_LABEL } from '../../lib/agentRole.js'
import CopilotChat from '../../components/CopilotChat.jsx'

// agent_actions.kind → 使用者看得懂的草稿種類(未知 kind 原樣顯示,不擋新種類)
const KIND_LABEL = {
  draft_daily_log: '日誌草稿',
  draft_inspection: '查驗草稿',
  draft_submittal_review: '審查意見',
  audit_note: '稽核提示',
}
const KIND_COLOR = {
  draft_daily_log: 'blue',
  draft_inspection: 'green',
  draft_submittal_review: 'amber',
  audit_note: 'purple',
}

const ORG_LABEL = { contractor: '施工廠商', supervisor: '監造單位', owner: '主辦機關' }

// 今日待我處理:最多亮 8 筆,其餘導去提醒中心——這裡是行動入口不是完整清單
const MY_ITEMS_CAP = 8

function MyItemsCard({ myItems }) {
  return (
    <Card title="今日待我處理"
      action={myItems.length > 0 && <span className="text-[11px] text-[var(--text-3)] tabular-nums">{myItems.length} 件</span>}>
      {myItems.length === 0 ? (
        <Empty>目前沒有球在你手上的事項。</Empty>
      ) : (
        <div className="divide-y divide-[var(--border-2)]">
          {myItems.slice(0, MY_ITEMS_CAP).map((it, i) => (
            <Link key={i} to={it.to} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0 group">
              <Badge className="shrink-0 mt-0.5">{it.tag}</Badge>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-[var(--text)] truncate group-hover:text-[var(--blue-text)]">{it.title}</div>
                <div className="text-[11px] text-[var(--text-3)]">{it.meta}</div>
              </div>
              <ArrowRight size={13} className="shrink-0 mt-1 text-[var(--text-3)] opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
            </Link>
          ))}
          {myItems.length > MY_ITEMS_CAP && (
            <Link to="/alerts" className="block pt-2.5 text-xs text-[var(--blue-text)] hover:underline">
              還有 {myItems.length - MY_ITEMS_CAP} 件,到提醒中心看全部
            </Link>
          )}
        </div>
      )}
    </Card>
  )
}

function DraftInboxCard() {
  const { agentActions, agentActionsLoading, resolveAgentAction } = useStore()
  const [resolvingId, setResolvingId] = useState(null)
  const [errMsg, setErrMsg] = useState(null)
  const [openRationale, setOpenRationale] = useState(null) // 展開理由的那一筆 id

  const pending = (agentActions || []).filter((a) => a.status === 'pending')

  const resolve = async (id, status) => {
    setResolvingId(id); setErrMsg(null)
    const res = await resolveAgentAction(id, status)
    // RPC 在「非本人/已處理過/非法狀態」時 raise 中文訊息,原樣顯示
    if (res?.error) setErrMsg(res.error?.message || res.error)
    setResolvingId(null)
  }

  return (
    <Card title="AI 草稿收件匣"
      action={pending.length > 0 && <span className="text-[11px] text-[var(--text-3)] tabular-nums">{pending.length} 筆待覆核</span>}>
      <ErrorBanner msg={errMsg} onClose={() => setErrMsg(null)} className="mb-3" />
      {agentActionsLoading ? (
        <div className="text-sm text-[var(--text-3)] py-6 text-center">載入草稿中…</div>
      ) : pending.length === 0 ? (
        <Empty>
          目前沒有待覆核的 AI 草稿。
          <span className="block text-xs mt-1.5 max-w-xs mx-auto">
            之後 agent 幫你擬好的日誌、查驗單、審查意見會先出現在這裡，由你確認後才生效。
          </span>
        </Empty>
      ) : (
        <div className="divide-y divide-[var(--border-2)]">
          {pending.map((a) => {
            const busy = resolvingId === a.id
            const opened = openRationale === a.id
            return (
              <div key={a.id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                <div className="flex items-start gap-2">
                  <Badge color={KIND_COLOR[a.kind] || 'slate'} className="shrink-0 mt-0.5">{KIND_LABEL[a.kind] || a.kind}</Badge>
                  <div className="text-sm text-[var(--text)] leading-snug min-w-0 flex-1">{a.summary}</div>
                </div>
                {a.rationale && (
                  <button onClick={() => setOpenRationale(opened ? null : a.id)}
                    className="inline-flex items-center gap-0.5 text-[11px] text-[var(--text-3)] hover:text-[var(--text-2)]">
                    {opened ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
                    為什麼這樣擬
                  </button>
                )}
                {opened && a.rationale && (
                  <div className="text-[11px] text-[var(--text-2)] bg-[var(--surface-2)] rounded-lg px-2.5 py-1.5 enter-row">{a.rationale}</div>
                )}
                <div className="flex items-center gap-2 pt-0.5">
                  <Button size="sm" disabled={busy} onClick={() => resolve(a.id, 'accepted')}>接受</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve(a.id, 'rejected')}>拒絕</Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

export default function Agent() {
  const { data, facts, imported, org } = useAssistantData()
  const { runAgent, currentProjectMembership, demoMode, currentUser } = useStore()

  // 角色只用於顯示(紅線:權限一律以伺服器為準);agent-run 回傳的 role 覆蓋前端推算
  const [serverRole, setServerRole] = useState(null)
  const role = serverRole || displayAgentRole({ demoMode, currentUser, projectRole: currentProjectMembership?.project_role, orgType: org })
  const label = AGENT_LABEL[role] || AGENT_LABEL.field

  // 對話 history 由 onAsk 這層自行累積(CopilotChat 的訊息串是它的內部 state):
  // 前端先收斂到最近 10 則、每則 2000 字元省 token(後端另有 20 則/4000 上限)
  const historyRef = useRef([])
  const onAsk = async (text) => {
    const history = historyRef.current.slice(-10).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
    const res = await runAgent(text, { facts, history })
    if (res?.role && res.role !== role) setServerRole(res.role)
    if (res?.text) {
      historyRef.current = [...historyRef.current, { role: 'user', content: text }, { role: 'assistant', content: res.text }].slice(-10)
      return { answer: res.text, sources: res.sources || [], steps: res.steps }
    }
    return res // { fallback }(demo)或 { error }→ CopilotChat 確定性回退接手
  }

  if (!imported) {
    return (
      <div className="space-y-5">
        <PageHeader title={label.name} tagline="AI Agent" subtitle={label.desc} />
        <Card><Empty>此專案尚未匯入標單，agent 還沒有資料可查。請先到「標單工項」匯入 PCCES 預算書。</Empty></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title={label.name} tagline="AI Agent" subtitle={label.desc}
        meta={[{ k: '目前身分', v: ORG_LABEL[org] || ORG_LABEL.contractor }]} />

      {/* 行動版順序:待我處理 → 草稿收件匣 → 對話(先讓人看到要做什麼);
          桌機:對話為主排左、兩張側卡排右 */}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px] items-start">
        <Card title="跟你的 agent 說" bodyClass="p-0" className="order-2 lg:order-1"
          action={<span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-3)]"><Bot size={12} aria-hidden />會自己查本案資料</span>}>
          <CopilotChat data={data} onAsk={onAsk} minH={360} maxH={560} />
        </Card>
        <div className="space-y-5 order-1 lg:order-2 min-w-0">
          <MyItemsCard myItems={data.myItems || []} />
          <DraftInboxCard />
        </div>
      </div>
    </div>
  )
}
