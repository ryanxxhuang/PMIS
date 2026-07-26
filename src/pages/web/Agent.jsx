// /agent — 專屬 agent 主控台(批2):使用者不再需要知道「該去哪一頁做事」,
// 描述目的,由角色化 agent 去查、去擬。三塊:對話(主角,接 agent-run 多輪查詢)、
// 今日待我處理(ball-in-court 球在我方)、AI 草稿收件匣(agent_actions pending,
// 人接受/拒絕——AI 只擬草稿,決定權永遠在人)。
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Bot, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, PageHeader, Badge, Button, Empty, ErrorBanner, Input } from '../../components/ui.jsx'
import { useStore } from '../../store.jsx'
import { applyDraftQuantities, draftNeedsInputCount } from '../../store/slices/agent.js'
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

// '2026-07-25' → '7/25'(收件匣成功提示用;格式不符原樣顯示)
const mmdd = (d) => {
  const [, m, day] = String(d || '').split('-')
  return m ? `${+m}/${+day}` : d
}

function DraftInboxCard() {
  const { agentActions, agentActionsLoading, resolveAgentAction, acceptDraft } = useStore()
  const [resolvingId, setResolvingId] = useState(null)
  const [errMsg, setErrMsg] = useState(null)
  const [doneMsg, setDoneMsg] = useState(null) // 接受日誌草稿成功後的提示(帶去填數量連結)
  const [openRationale, setOpenRationale] = useState(null) // 展開理由的那一筆 id
  // 日誌草稿卡片上人填的工項數量:{ [action.id]: { [work_item_id]: 輸入字串 } }。
  // 數量誠實原則下草稿的 qty_today 一律 null,不在這裡填的話,接受後的日誌
  // 會一個工項都沒有——所以數量輸入直接放在卡片裡(不開新頁、不開 modal)。
  const [qtyDraft, setQtyDraft] = useState({})
  const setQty = (aid, wiId, val) => setQtyDraft((qs) => ({ ...qs, [aid]: { ...qs[aid], [wiId]: val } }))

  const pending = (agentActions || []).filter((a) => a.status === 'pending')

  const resolve = async (a, status) => {
    setResolvingId(a.id); setErrMsg(null); setDoneMsg(null)
    // 接受走 acceptDraft:日誌草稿會先真的建立日誌(saveSiteLog,含卡片上填的數量)才標已接受
    const res = status === 'accepted' ? await acceptDraft(a, qtyDraft[a.id]) : await resolveAgentAction(a.id, status)
    // RPC 在「非本人/已處理過/非法狀態」時 raise 中文訊息,原樣顯示
    if (res?.error) setErrMsg(res.error?.message || res.error)
    else if (res?.applied === 'daily_log') {
      // 成功提示要看「合併人填數量後」還缺不缺:全填了就只導去查看,還有缺才提示去補
      const merged = applyDraftQuantities(a.evidence?.payload, qtyDraft[a.id])
      setDoneMsg({ text: `已建立 ${mmdd(merged?.log_date)} 施工日誌`, needsQty: draftNeedsInputCount(merged) > 0 })
    }
    setResolvingId(null)
  }

  return (
    <Card title="AI 草稿收件匣"
      action={pending.length > 0 && <span className="text-[11px] text-[var(--text-3)] tabular-nums">{pending.length} 筆待覆核</span>}>
      <ErrorBanner msg={errMsg} onClose={() => setErrMsg(null)} className="mb-3" />
      {doneMsg && (
        <div className="mb-3 flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-2 bg-[var(--green-tint)] text-[var(--green-text)] enter-row">
          <span>{doneMsg.text}</span>
          <Link to="/site-log" className="shrink-0 inline-flex items-center gap-0.5 font-medium hover:underline">
            {doneMsg.needsQty ? '去填數量' : '查看日誌'} <ArrowRight size={11} aria-hidden />
          </Link>
        </div>
      )}
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
            // 數量誠實原則:照片只能證明「做了哪些工項」,不能證明「做了多少」——
            // 數量一律待人填,輸入列就放在卡片裡(產品表面只能縮不能長:不開新頁/modal)
            const draftItems = a.kind === 'draft_daily_log'
              ? Object.entries(a.evidence?.payload?.items || {}) : []
            const qtys = qtyDraft[a.id] || {}
            // 未填=輸入(或草稿預填值)解析後不 > 0;未填的接受時直接略過,不擋接受
            const unfilled = draftItems
              .filter(([wiId, v]) => !(Number(qtys[wiId] ?? v?.qty_today) > 0)).length
            return (
              <div key={a.id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                <div className="flex items-start gap-2">
                  <Badge color={KIND_COLOR[a.kind] || 'slate'} className="shrink-0 mt-0.5">{KIND_LABEL[a.kind] || a.kind}</Badge>
                  <div className="text-sm text-[var(--text)] leading-snug min-w-0 flex-1">{a.summary}</div>
                </div>
                {draftItems.length > 0 && (
                  <div className="rounded-lg border border-[var(--border-2)] divide-y divide-[var(--border-2)]">
                    {draftItems.map(([wiId, v]) => (
                      <div key={wiId} className="flex items-center gap-2 px-2.5 py-1.5">
                        <div className="min-w-0 flex-1 text-xs text-[var(--text-2)] truncate">
                          {v?.item_no && <span className="text-[var(--text-3)] mr-1">{v.item_no}</span>}
                          {v?.description || wiId}
                        </div>
                        <Input type="number" min="0" step="any" inputMode="decimal" placeholder="數量"
                          aria-label={`${v?.description || wiId} 本日數量`}
                          value={qtys[wiId] ?? v?.qty_today ?? ''}
                          onChange={(e) => setQty(a.id, wiId, e.target.value)}
                          className="!w-24 shrink-0 !py-1 text-right tabular-nums" />
                        <span className="w-8 shrink-0 text-[11px] text-[var(--text-3)]">{v?.unit || ''}</span>
                      </div>
                    ))}
                  </div>
                )}
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
                <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                  <Button size="sm" disabled={busy} onClick={() => resolve(a, 'accepted')}>
                    {draftItems.length > 0 ? '接受並建立日誌' : '接受'}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve(a, 'rejected')}>拒絕</Button>
                  {/* 不擋接受:有些日子確實沒有可計量的工項,只誠實提醒略過的後果 */}
                  {unfilled > 0 && (
                    <span className="text-[11px] text-[var(--text-3)]">未填數量的工項不會寫入日誌</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {/* 產品原則(批3):agent 能做的就把手動入口收起來——「施工日誌」已自側欄移除,
          日常由照片→agent 草稿→這裡接受。但沒拍照的日子 agent 擬不出草稿,不能讓
          使用者卡死,所以留這個次要手動入口(路由本身保留)。 */}
      <div className="mt-3 pt-3 border-t border-[var(--border-2)] text-right">
        <Link to="/site-log" className="inline-flex items-center gap-0.5 text-[11px] text-[var(--text-3)] hover:text-[var(--blue-text)]">
          手動寫施工日誌 <ArrowRight size={11} aria-hidden />
        </Link>
      </div>
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
