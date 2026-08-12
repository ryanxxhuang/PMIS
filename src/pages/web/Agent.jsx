// /agent — 專屬 agent 主控台(批2):使用者不再需要知道「該去哪一頁做事」,
// 描述目的,由角色化 agent 去查、去擬。三塊:對話(主角,接 agent-run 多輪查詢)、
// 今日待我處理(ball-in-court 球在我方)、AI 草稿收件匣(agent_actions pending,
// 人接受/拒絕——AI 只擬草稿,決定權永遠在人)。
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Bot, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, PageHeader, Badge, Button, Empty, ErrorBanner, Input } from '../../components/ui.jsx'
import { useStore } from '../../store.jsx'
import { applyDraftQuantities, draftNeedsInputCount, checklistDraftCounts } from '../../store/slices/agent.js'
import { useAssistantData } from '../../lib/assistantData.js'
import { displayAgentRole, AGENT_LABEL } from '../../lib/agentRole.js'
import CopilotChat from '../../components/CopilotChat.jsx'

// agent_actions.kind → 使用者看得懂的草稿種類(未知 kind 原樣顯示,不擋新種類)
const KIND_LABEL = {
  draft_daily_log: '日誌草稿',
  draft_inspection: '查驗草稿',
  draft_submittal_review: '審查意見',
  audit_note: '稽核提示',
  handoff: '交接事項',
}
const KIND_COLOR = {
  draft_daily_log: 'blue',
  draft_inspection: 'green',
  draft_submittal_review: 'amber',
  audit_note: 'purple',
  handoff: 'red', // 球轉到你手上,視覺上要跳出來
}
// 稽核發現的狀態標籤(對齊 buildIntegrityFindings 的 status)
const FINDING_BADGE = { risk: { color: 'red', label: '風險' }, warn: { color: 'amber', label: '提醒' } }

// 審查意見草稿:要點狀態與建議判定的 Badge 顏色(對齊後端 draft_submittal_review 的字彙;
// 未知值退 slate 不擋新字彙)。建議判定只是建議——文字一律帶「建議:」前綴,不可像已審定
const REVIEW_STATUS_COLOR = { 已於送審敘明: 'green', 需補件: 'amber', 需監造核對文件: 'blue', 不適用: 'slate' }
const REVIEW_DECISION_COLOR = { 核准: 'green', 核備: 'green', 退回補正: 'red', 需補充後再核: 'amber' }

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
  // checklistTemplates:store 對外名(store.jsx 把 allChecklistTemplates 以此名輸出),
  // 已含內建 03310 範本——查驗草稿卡片用它把項次 no 對回項目文字
  const { agentActions, agentActionsLoading, resolveAgentAction, acceptDraft, checklistTemplates } = useStore()
  const [resolvingId, setResolvingId] = useState(null)
  const [errMsg, setErrMsg] = useState(null)
  const [doneMsg, setDoneMsg] = useState(null) // 接受成功後的提示 { text, to, cta }(帶去補填/查看連結)
  const [openRationale, setOpenRationale] = useState(null) // 展開理由的那一筆 id
  const [openFindings, setOpenFindings] = useState(null) // 展開稽核發現清單的那一筆 id
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
      setDoneMsg({
        text: `已建立 ${mmdd(merged?.log_date)} 施工日誌`, to: '/site-log',
        cta: draftNeedsInputCount(merged) > 0 ? '去填數量' : '查看日誌',
      })
    } else if (res?.applied === 'checklist') {
      // 查驗草稿的實測值一律留白(AI 不猜數值),接受後人必須進品質管理補填
      setDoneMsg({ text: '已建立自主檢查表(實測值待填)', to: '/quality', cta: '去填實測值' })
    } else if (res?.applied === 'submittal_review') {
      // 採用只存意見+推進到審核中,審定(核准/退回)必須由監造本人到送審頁做
      setDoneMsg({ text: '已存下審查意見,送審推進到「審核中」——審定請到送審頁自行操作', to: '/submittals', cta: '去審定' })
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
          <Link to={doneMsg.to} className="shrink-0 inline-flex items-center gap-0.5 font-medium hover:underline">
            {doneMsg.cta} <ArrowRight size={11} aria-hidden />
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
            // 稽核提示:確定性引擎產出的發現清單(evidence.findings),展開可看 title+detail;
            // 「知道了」只標 accepted,不產生任何業務資料(發現本身就是交付物)
            const findings = a.kind === 'audit_note' ? (a.evidence?.findings || []) : []
            const findingsOpened = openFindings === a.id
            // 查驗草稿:顯示範本標題與待填項數;bool 的 AI 建議值必須標「AI 建議」——
            // 使用者要一眼看得出哪些是 AI 從照片猜的,按「接受」才算人背書
            const clPayload = a.kind === 'draft_inspection' ? a.evidence?.payload : null
            const clTpl = clPayload
              ? ((checklistTemplates || []).find((t) => t.id === clPayload.template_id)
                || (checklistTemplates || []).find((t) => t.title === clPayload.template_title))
              : null
            const clCounts = clPayload ? checklistDraftCounts(clPayload) : null
            const clItemByNo = new Map((clTpl?.items || []).map((it) => [it.no, it]))
            const clSuggested = clPayload
              ? Object.entries(clPayload.results || {}).filter(([, v]) => v?.ai_suggested && v?.value != null) : []
            // 審查意見草稿(批6):要點清單+意見草稿+「建議」判定。採用只存意見並推進到
            // 審核中(見 acceptDraft 審定紅線),核准/退回一律由監造本人在送審頁操作
            const subPayload = a.kind === 'draft_submittal_review' ? a.evidence?.payload : null
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
                {clPayload && (
                  <div className="rounded-lg border border-[var(--border-2)] divide-y divide-[var(--border-2)]">
                    <div className="px-2.5 py-1.5 text-xs text-[var(--text-2)]">
                      <span className="font-medium text-[var(--text)]">{clTpl?.title || clPayload.template_title || '檢查表範本'}</span>
                      <span className="text-[var(--text-3)] ml-1.5">{[clPayload.check_date, clPayload.location].filter(Boolean).join('・')}</span>
                    </div>
                    {clSuggested.map(([no, v]) => (
                      <div key={no} className="px-2.5 py-1.5 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1 text-xs text-[var(--text-2)] truncate">
                            <span className="text-[var(--text-3)] mr-1">{no}</span>
                            {clItemByNo.get(no)?.item || ''}
                          </div>
                          <span className={`shrink-0 text-xs ${v.value === false ? 'text-[var(--red-text)]' : 'text-[var(--text-2)]'}`}>
                            {v.value === true ? '✓ 符合' : v.value === false ? '✗ 不符' : String(v.value)}
                          </span>
                          <Badge color="purple" className="shrink-0 !text-[10px] !px-1.5">AI 建議</Badge>
                        </div>
                        {/* 依據:AI 憑什麼這樣勾 —— 沒有依據的建議後端已拒收,這裡把依據攤在人眼前 */}
                        {v.ai_basis && (
                          <div className="text-[11px] text-[var(--text-3)] leading-snug">依據:{v.ai_basis}</div>
                        )}
                      </div>
                    ))}
                    {clCounts?.needsInput > 0 && (
                      <div className="px-2.5 py-1.5 text-[11px] text-[var(--text-3)]">
                        {clCounts.needsInput} 項實測值待你填——AI 不猜數值,接受後到品質管理補填,判定由系統依量化標準自動跑
                      </div>
                    )}
                  </div>
                )}
                {subPayload && (
                  <div className="rounded-lg border border-[var(--border-2)] divide-y divide-[var(--border-2)]">
                    <div className="flex items-center gap-2 px-2.5 py-1.5">
                      <div className="min-w-0 flex-1 text-xs text-[var(--text-2)] truncate">
                        {subPayload.submittal_no && <span className="text-[var(--text-3)] mr-1">{subPayload.submittal_no}</span>}
                        <span className="font-medium text-[var(--text)]">{subPayload.submittal_title || ''}</span>
                      </div>
                      {/* 「建議:」前綴不可省——這只是 AI 的建議,不是審定結果 */}
                      {subPayload.suggested_decision && (
                        <Badge color={REVIEW_DECISION_COLOR[subPayload.suggested_decision] || 'slate'} className="shrink-0">
                          建議:{subPayload.suggested_decision}
                        </Badge>
                      )}
                    </div>
                    {(subPayload.checklist || []).map((c, i) => (
                      <div key={i} className="px-2.5 py-1.5 space-y-0.5">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1 text-xs text-[var(--text-2)] leading-snug">{c.point}</div>
                          <Badge color={REVIEW_STATUS_COLOR[c.status] || 'slate'} className="shrink-0 !text-[10px] !px-1.5">{c.status}</Badge>
                        </div>
                        {c.basis && <div className="text-[11px] text-[var(--text-3)] leading-snug">依據:{c.basis}</div>}
                      </div>
                    ))}
                    {subPayload.opinion && (
                      <div className="px-2.5 py-1.5">
                        <div className="text-[11px] text-[var(--text-3)] mb-0.5">審查意見草稿</div>
                        <div className="text-xs text-[var(--text)] leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                          {subPayload.opinion}
                        </div>
                      </div>
                    )}
                    {subPayload.caution && (
                      <div className="px-2.5 py-1.5 text-[11px] font-medium text-[var(--amber-text)] leading-snug">⚠ {subPayload.caution}</div>
                    )}
                  </div>
                )}
                {findings.length > 0 && (
                  <button onClick={() => setOpenFindings(findingsOpened ? null : a.id)}
                    className="inline-flex items-center gap-0.5 text-[11px] text-[var(--text-3)] hover:text-[var(--text-2)]">
                    {findingsOpened ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
                    勾稽發現 {findings.length} 項
                  </button>
                )}
                {findingsOpened && findings.length > 0 && (
                  <div className="rounded-lg border border-[var(--border-2)] divide-y divide-[var(--border-2)] enter-row">
                    {findings.map((f, i) => (
                      <div key={i} className="px-2.5 py-2 space-y-1">
                        <div className="flex items-start gap-2">
                          <Badge color={FINDING_BADGE[f.status]?.color || 'slate'} className="shrink-0 mt-0.5 !text-[10px] !px-1.5">
                            {FINDING_BADGE[f.status]?.label || f.status}
                          </Badge>
                          <div className="min-w-0 flex-1 text-xs text-[var(--text)] leading-snug">{f.title}</div>
                        </div>
                        {f.detail && <div className="text-[11px] text-[var(--text-2)] leading-relaxed">{f.detail}</div>}
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
                    {a.kind === 'audit_note' ? '知道了'
                      : draftItems.length > 0 ? '接受並建立日誌'
                        : clPayload ? '接受並建立檢查表'
                          : subPayload ? '採用意見' : '接受'}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve(a, 'rejected')}>拒絕</Button>
                  {/* 不擋接受:有些日子確實沒有可計量的工項,只誠實提醒略過的後果 */}
                  {unfilled > 0 && (
                    <span className="text-[11px] text-[var(--text-3)]">未填數量的工項不會寫入日誌</span>
                  )}
                  {/* 審定紅線的使用者話術:採用≠審定,決定權在人 */}
                  {subPayload && (
                    <span className="text-[11px] text-[var(--text-3)]">採用只會存下意見草稿,核准/退回仍需你在送審頁面自行審定</span>
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
  const { runAgent, aiEnabled } = useStore()
  const agentOn = aiEnabled('agent.run') // 批 B UX:功能關閉時藏對話入口(真正的閘門在伺服器端)

  // 角色只用於顯示(紅線:權限一律以伺服器為準);agent-run 回傳的 role 覆蓋前端推算
  const [serverRole, setServerRole] = useState(null)
  const role = serverRole || displayAgentRole({ orgType: org })
  const label = AGENT_LABEL[role] || AGENT_LABEL.contractor

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

  return (
    <div className="space-y-5">
      <PageHeader title={label.name} tagline="AI Agent" subtitle={label.desc}
        meta={[{ k: '目前身分', v: ORG_LABEL[org] || ORG_LABEL.contractor }]} />

      {/* W2-3(D-007):未匯標單不再整頁擋住——文件/成員/期限問題不依賴 BOQ,
          只有工項類(估驗/進度/數量)要先匯入;指引與全站一致(專案文件一次上傳)。 */}
      {!imported && (
        <div className="bg-[var(--amber-tint)] border border-[var(--amber-text)]/25 rounded-lg px-4 py-3 text-sm text-amber-800">
          此專案尚未匯入標單:文件、成員與期限問題可以直接問;估驗、進度、工項數量類問題要先到「
          <Link to="/contract" className="font-medium underline">專案文件</Link>」上傳標單 XML 才有資料。
        </div>
      )}

      {/* 行動版順序:待我處理 → 草稿收件匣 → 對話(先讓人看到要做什麼);
          桌機:對話為主排左、兩張側卡排右 */}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px] items-start">
        <Card title="跟你的 agent 說" bodyClass="p-0" className="order-2 lg:order-1"
          action={<span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-3)]"><Bot size={12} aria-hidden />會自己查本案資料</span>}>
          {agentOn
            ? <CopilotChat data={data} onAsk={onAsk} minH={360} maxH={560} />
            : <div className="p-4"><Empty>此 AI 功能未啟用（AI Agent 主控台）。待我處理與草稿收件匣仍可使用；如需開通請聯絡系統管理者。</Empty></div>}
        </Card>
        <div className="space-y-5 order-1 lg:order-2 min-w-0">
          <MyItemsCard myItems={data.myItems || []} />
          <DraftInboxCard />
        </div>
      </div>
    </div>
  )
}
