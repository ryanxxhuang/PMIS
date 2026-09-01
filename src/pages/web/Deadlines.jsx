// 期限追蹤:已確認契約期限的到期管理(自 /requirements 的期限追蹤區塊遷出)。
// 契約重點頁改版(design_handoff_contract_highlights)後只留頂部摘要條,
// 逐項到期清單、標為已提送/佐證掛接、罰款試算與基準日/契約總價編輯全數移到
// 本頁——今日待辦的契約期限項與摘要條的「開啟期限追蹤」都導到這裡。
// 資料與規則不變:到期日由 computeObligationDue 依基準日即時計算,
// 狀態寫入走 updateObligationStatus(伺服器 RLS 把關)。
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import {
  Card, Empty, PageHeader, Badge, Button, Field, Input, Select, ErrorBanner, Surface, buttonClass,
} from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { computeObligationDue, formatObligationRule } from '../../lib/contractDue.js'
import { ORG_TO_PARTY, obligationParty } from '../../lib/obligationTimeline.js'
import { estimatePenalty, parsePenaltyRate } from '../../lib/penaltyCalc.js'

const PHASES = ['開工前', '施工中', '完工', '保固', '其他']
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// 狀態色點走 class 對照表(顏色由 className 帶 token,吃主題切換);
// 色點附等價文字(title/aria-label),狀態不得只靠顏色(W8-5)
const DOT_CLS = { done: 'bg-[var(--green-text)]', overdue: 'bg-[var(--red-text)]', soon: 'bg-[var(--amber-text)]', scheduled: 'bg-[var(--blue)]', nodate: 'bg-[var(--text-3)]' }
const DOT_LABEL = { done: '已完成', overdue: '已逾期', soon: '7 日內到期', scheduled: '排程中', nodate: '無期限' }

export default function Deadlines() {
  const {
    currentProject, isPersistedProject, currentUser, workItems, can,
    obligations, updateObligationStatus, updateProjectAnchors, submittals,
  } = useStore()
  // 標記權限鏡像 DB(migration 20260825120000_obligation_ownership_completed_at):
  // 只看歸屬——自己方的義務才能標/退,機關自此也能標自己的(估驗撥付/初驗/驗收);
  // admin override(非正式模式的專案管理者)照舊放行。跨方按鈕不再渲染,
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
  const [evidenceFor, setEvidenceFor] = useState(null)  // 義務 id;'' 表示不掛
  const [evidencePick, setEvidencePick] = useState('')

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

  // 到期日、倒數、階段分組(依基準日即時計算)
  const dueItems = useMemo(() => obligations.map((ob) => {
    const due = computeObligationDue(ob, anchors)
    const done = ob.status === '已提送' || ob.status === '已完成'
    let diff = null, state = 'nodate'
    if (done) state = 'done'
    else if (due) { diff = Math.round((due - today0()) / 86400000); state = diff < 0 ? 'overdue' : diff <= 7 ? 'soon' : 'scheduled' }
    return { ob, due, diff, done, state }
  }), [obligations, anchors])
  const dueCounts = useMemo(() => {
    let overdue = 0, soon = 0, done = 0
    for (const it of dueItems) { if (it.state === 'overdue') overdue++; else if (it.state === 'soon') soon++; if (it.done) done++ }
    return { overdue, soon, done }
  }, [dueItems])
  const dueGroups = useMemo(() => PHASES.map((ph) => ({
    ph, list: dueItems.filter((it) => (PHASES.includes(it.ob.category) ? it.ob.category : '其他') === ph)
      .sort((x, y) => (x.due?.getTime() || Infinity) - (y.due?.getTime() || Infinity)),
  })).filter((g) => g.list.length), [dueItems])

  const anchorsCard = (
    <Card title="基準日與契約總價">
      <div className="flex flex-wrap gap-4">
        {[
          ['award_date', '決標日'],
          ['notice_date', '接獲開工通知日'],
          ['commencement_date', '開工日'],
          ['end_date', '竣工日(完工期限基準)'],
        ].map(([k, label]) => (
          <Field key={k} label={label}>
            <Input type="date" value={anchors[k]} onChange={(e) => setAnchor(k, e.target.value)}
              disabled={!can.edit} />
          </Field>
        ))}
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
      <PageHeader title="期限追蹤" tagline="到期不漏、逾期有數" subtitle="已確認的契約期限依基準日推算到期日;提送後掛上佐證,逾期自動試算違約金。新期限請到「契約重點」確認。" />

      <Card title="期限追蹤" action={
        <div className="flex items-center gap-2">
          {obligations.length > 0 && (
            <Link to="/contract/print" className={buttonClass('outline', 'sm')}>
              <MSym name="print" size={14} /> 列印對照表
            </Link>
          )}
        </div>
      }>
        <div className="flex flex-wrap gap-2">
          <Badge color="red">已逾期 {dueCounts.overdue} 項</Badge>
          <Badge color="amber">7 日內到期 {dueCounts.soon} 項</Badge>
          <Badge color="green">已完成 {dueCounts.done} 項</Badge>
        </div>
        {dueGroups.length === 0 && (
          <Empty>尚無已確認的期限。契約重點的期限型項目確認後會自動出現在這裡(引文與數字核對無誤的會自動確認)。</Empty>
        )}
        <ErrorBanner msg={obligationMsg} className="mt-2" />
      </Card>

      {dueGroups.map((g) => (
        <div key={g.ph}>
          <h2 className="text-sm font-medium text-[var(--text-2)] mb-2">{g.ph}</h2>
          <div className="space-y-2">
            {g.list.map((it) => (
              <div key={it.ob.id} className="flex gap-3">
                <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${DOT_CLS[it.state]}`}
                  role="img" title={DOT_LABEL[it.state]} aria-label={DOT_LABEL[it.state]} />
                <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-medium text-[var(--text)]">{it.ob.title}</span>
                    {canMark(it.ob) && <button onClick={async () => {
                      if (it.done) {
                        // 退回待辦:一併解除佐證連結(W-01)
                        const { error } = await updateObligationStatus(it.ob.id, '待辦', { evidence_submittal_id: null })
                        if (error) setObligationMsg(friendlyError(error, '狀態未寫入'))
                      } else if (submittals.length) {
                        setEvidenceFor(evidenceFor === it.ob.id ? null : it.ob.id); setEvidencePick('')
                      } else {
                        const { error } = await updateObligationStatus(it.ob.id, '已提送')
                        if (error) setObligationMsg(friendlyError(error, '狀態未寫入'))
                      }
                    }}
                      className={it.done
                        ? 'text-xs h-8 px-3 rounded-full font-medium whitespace-nowrap shrink-0 inline-flex items-center max-md:min-h-11 pressable bg-[var(--green-tint)] text-[var(--green-text)]'
                        : `${buttonClass('outline', 'sm')} shrink-0`}>
                      {it.done ? '已提送 ✓' : '標為已提送'}
                    </button>}
                  </div>
                  {/* W-01 佐證挑選:掛上對應的送審文件 */}
                  {evidenceFor === it.ob.id && !it.done && (
                    <Surface className="mt-2 p-2.5 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-[var(--text-2)] shrink-0">佐證送審文件</span>
                      <Select value={evidencePick} onChange={(e) => setEvidencePick(e.target.value)} className="flex-1 min-w-[200px]">
                        <option value="">（不掛佐證）</option>
                        {submittals.map((s) => (
                          <option key={s.id} value={s.id}>{s.submittal_no} {s.title}（{s.status}）</option>
                        ))}
                      </Select>
                      <Button size="sm" onClick={async () => {
                        const { error } = await updateObligationStatus(it.ob.id, '已提送',
                          evidencePick ? { evidence_submittal_id: evidencePick } : {})
                        if (error) { setObligationMsg(friendlyError(error, '狀態未寫入')); return }
                        setEvidenceFor(null)
                      }}>{evidencePick ? '掛佐證並標為已提送' : '直接標為已提送'}</Button>
                      <Button variant="ghost" size="sm" onClick={() => setEvidenceFor(null)}>取消</Button>
                    </Surface>
                  )}
                  {/* 佐證連結:稽核可一路點到原始送審紀錄 */}
                  {it.ob.evidence_submittal_id && (() => {
                    const ev = submittals.find((s) => s.id === it.ob.evidence_submittal_id)
                    return (
                      <Link to="/submittals" className="mt-1.5 inline-flex hover:underline">
                        <Badge color="blue">
                          <MSym name="description" size={11} />
                          佐證:{ev ? `${ev.submittal_no} ${ev.title}（${ev.status}）` : '送審文件（已不存在或無權檢視）'}
                        </Badge>
                      </Link>
                    )
                  })()}
                  <div className="text-xs text-[var(--text-3)] mt-1">
                    {formatObligationRule(it.ob)}{it.due ? `　·　到期 ${isoDate(it.due)}` : ''}
                    {it.ob.responsible ? `　·　${it.ob.responsible}` : ''}
                  </div>
                  {!it.done && it.due && (
                    it.state === 'overdue' || it.state === 'soon'
                      ? <div className="mt-1"><Badge color={it.state === 'overdue' ? 'red' : 'amber'}>{it.state === 'overdue' ? `已逾期 ${-it.diff} 天` : `還有 ${it.diff} 天`}</Badge></div>
                      : (
                        <div className="text-xs font-medium mt-0.5 text-[var(--text-2)]">
                          還有 {it.diff} 天
                        </div>
                      )
                  )}
                  {it.ob.penalty && (
                    <div className="text-xs text-[var(--amber-text)] bg-[var(--amber-tint)] rounded-md px-2 py-1 mt-2 inline-flex items-center gap-1"><MSym name="balance" size={12} /> {it.ob.penalty}</div>
                  )}
                  {/* 逾期罰款金額試算(確定性 regex 抽罰率;抽不出就不顯示——寧缺勿錯) */}
                  {it.state === 'overdue' && it.ob.penalty && (() => {
                    const est = estimatePenalty({ penaltyText: it.ob.penalty, overdueDays: -it.diff, contractTotal })
                    return est ? (
                      <div className="text-xs font-medium text-[var(--red-text)] bg-[var(--red-tint)] rounded-md px-2 py-1 mt-1.5 flex items-start gap-1.5">
                        <MSym name="balance" size={12} className="mt-0.5 shrink-0" />
                        <span>預估逾期違約金約 NT$ {est.amount.toLocaleString('en-US')}{est.capped ? '(已達上限)' : ''}
                          <span className="font-normal text-[var(--text-3)]"> · {est.basis} · 概算供參,實際依契約認定</span>
                        </span>
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--text-3)] bg-[var(--surface-2)] rounded-md px-2 py-1 mt-1.5 inline-flex items-center gap-1.5">
                        <MSym name="balance" size={12} className="shrink-0" />
                        {parsePenaltyRate(it.ob.penalty)?.perDayFraction != null && !(contractTotal > 0)
                          ? '偵測到百分比制罰則;填入「契約價金總額」即可試算逾期違約金'
                          : '偵測到罰則,但金額格式需人工確認試算'}
                      </div>
                    )
                  })()}
                  {(it.ob.source_clause || it.ob.source_page) && (
                    <div className="text-[11px] text-[var(--text-3)] mt-2 flex items-center gap-1"><MSym name="description" size={11} /> 契約 {it.ob.source_clause} {it.ob.source_page}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {anchorsCard}
    </div>
  )
}
