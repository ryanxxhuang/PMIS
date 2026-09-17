// 驗收結算:報竣 → 竣工確認 → 初驗 → (缺失改善 → 複驗) → 正式驗收 → 結算證明 → 保固。
// 法定期限(採購法細則 §92/93/94、採購法 §73)自前一階段實際日自動起算,逾期紅字+進提醒中心。
// 機關主導、廠商報竣、監造陪驗——三方都能登錄(伺服器 RLS 同步放行本表)。
import { useState, useMemo, useId, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Badge, Button, Field, Input, Select, Empty, PageHeader, ErrorBanner } from '../../components/ui.jsx'
import { MetaGrid as MetaRows } from '../../components/listDetail.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { deriveAcceptance, needsFixFlow, acceptanceAlerts, ACCEPTANCE_STAGE_ORGS } from '../../lib/acceptance.js'
import { DEMO_PORTFOLIO } from '../../data/demoSeed.js'

const RESULT_STAGES = new Set(['initial', 'reinspect', 'final']) // 這幾關要記合格/不合格

// 階段角色白名單已移到 acceptance.js(僅 UX;真正強制在 DB trigger,
// 見 migration 20260712000100_acceptance_events_rbac.sql)——今日工作聚合要用同一份。
const STAGE_ORGS = ACCEPTANCE_STAGE_ORGS
const ORG_LABEL = { contractor: '廠商', supervisor: '監造', owner: '機關' }

export default function Acceptance() {
  const { acceptanceEvents, recordAcceptanceEvent, clearAcceptanceEvent, demoMode, isPersistedProject, project, currentUser, can } = useStore()
  const [errMsg, setErrMsg] = useState('')
  const org = currentUser?.org_type || 'contractor'
  // 專案管理者=授權主驗(正式模式=關);demo 刻意不套 admin 例外,保留三方角色劇本
  const canStage = (key) => (!demoMode && can.override) || (STAGE_ORGS[key] || []).includes(org)

  const stages = useMemo(() => deriveAcceptance(acceptanceEvents), [acceptanceEvents])
  const fixFlow = needsFixFlow(acceptanceEvents)
  const alerts = useMemo(() => acceptanceAlerts(acceptanceEvents), [acceptanceEvents])
  const visible = stages.filter((s) => !s.optional || fixFlow || s.event)
  // 當前階段=第一個未完成(與 StageRow 的順序 gate 同一條規則);前置=它前一個可見階段
  const currentIndex = visible.findIndex((x) => x.state !== 'done')
  const current = currentIndex >= 0 ? visible[currentIndex] : null
  const prerequisite = currentIndex > 0 ? visible[currentIndex - 1] : null
  // 待辦深連結 ?stage=(UIUX 階段 5C):只定位與說明實際狀態,不自動在別的階段開編輯
  const [params] = useSearchParams()
  const requestedStage = params.get('stage')
  const requested = requestedStage ? stages.find((s) => s.key === requestedStage) : null
  const deepLinkNote = !requestedStage ? null
    : !requested ? `找不到指定的驗收階段「${requestedStage}」；${current ? `目前階段是「${current.label}」。` : '驗收已全部完成。'}`
      : requested.state === 'done' ? `指定的階段「${requested.label}」已於 ${requested.event.event_date} 登錄完成${requested.event.result ? `（${requested.event.result}）` : ''}；${current ? `目前階段是「${current.label}」。要更正請在時間軸該列按「修改」。` : '驗收已全部完成。'}`
        : current && requested.key !== current.key ? `指定的階段「${requested.label}」尚未輪到；目前階段是「${current.label}」，需先完成它。`
          : null
  // 剛登錄成功的結果:留在頁面說「登錄了什麼、下一階段是誰」,不進全域狀態
  const [notice, setNotice] = useState(null) // { label, date, result } | null
  useEffect(() => {
    if (!requested || requested.key !== current?.key) return
    document.getElementById(`stage-${requested.key}`)?.scrollIntoView?.({ block: 'center' })
  }, [requested, current?.key])

  const reportDate = stages.find((s) => s.key === 'report')?.event?.event_date
  const finalStage = stages.find((s) => s.key === 'final')
  const warrantyDate = stages.find((s) => s.key === 'warranty')?.event?.event_date

  // demo 的驗收 storyline 屬於 B 區(見 DEMO_PORTFOLIO);真實專案顯示本案
  const displayName = demoMode ? DEMO_PORTFOLIO[0].name : project.project_name

  // 真實模式但尚未選定專案:登錄只會進記憶體(假成功),擋下
  // 早退也保留 PageHeader:頁首與工作面分頁不該因為「還沒選專案」整組消失
  if (!demoMode && !isPersistedProject) {
    return (
      <div className="space-y-5">
        <PageHeader title="驗收結算" tagline="Acceptance" subtitle="報竣到保固的法定時程,期限自動起算、逾期即提醒。" />
        <Card title="驗收結算" bodyClass="p-0"><Empty>此功能需真實專案。請先建立或選擇專案。</Empty></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="驗收結算" tagline="Acceptance"
        // keepSubtitle:角色提示只講怎麼做,專案名稱是這一頁的案件脈絡,不能被提示句取代(UIUX 階段 1 U13)
        keepSubtitle
        subtitle={`${displayName} — 報竣到保固的法定時程,期限自動起算、逾期即提醒。`}
        meta={[
          { k: '報竣日', v: reportDate || '—' },
          { k: '驗收合格', v: (finalStage?.event?.result === '合格' && finalStage.event.event_date) || '—' },
          { k: '保固起算', v: warrantyDate || '—' },
        ]}
      />

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      {deepLinkNote && <p role="status" className="rounded-lg px-3 py-2 text-footnote leading-relaxed bg-[var(--amber-tint)] text-[var(--amber-text)]">{deepLinkNote}</p>}
      {notice && (
        <p role="status" className="rounded-lg px-3 py-2 text-footnote leading-relaxed bg-[var(--green-tint)] text-[var(--green-text)]">
          已登錄 {notice.label} {notice.date}{notice.result ? ` ${notice.result}` : ''}；
          {current ? `下一階段：${current.label}（${current.by}）${current.due ? `，期限 ${current.due}` : ''}。` : '驗收流程已全部完成。'}
        </p>
      )}

      {/* 當前階段(UIUX 階段 5C):進頁先知道現在輪到哪一關、誰能登錄、前置是什麼、我的下一步。
          全部由 deriveAcceptance 的既有欄位推導,不改期限演算法與階段順序 */}
      <Card title="目前階段">
        {!current ? (
          <p className="text-body text-[var(--text-2)]">驗收流程已全部完成，進入保固。歷史各階段仍可在下方時間軸查閱。</p>
        ) : (() => {
          const orgs = (STAGE_ORGS[current.key] || []).map((o) => ORG_LABEL[o]).join('、')
          const mine = canStage(current.key)
          return (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-callout font-medium text-[var(--text)]">{current.label}</span>
                <Badge color={current.overdue ? 'red' : current.daysLeft != null && current.daysLeft <= 7 ? 'amber' : 'slate'} className="num">
                  {current.due ? `期限 ${current.due}${current.daysLeft != null ? (current.overdue ? `（逾期 ${-current.daysLeft} 天）` : `（還有 ${current.daysLeft} 天）`) : ''}` : '無法定期限'}
                </Badge>
              </div>
              <MetaRows rows={[
                ['主辦', current.by],
                ['可登錄者', orgs || '—'],
                ['前置', prerequisite ? `${prerequisite.label} 已於 ${prerequisite.event.event_date} 完成` : '無（第一階段）'],
                ['依據', current.basis],
              ]} />
              <p className="text-footnote text-[var(--text-2)]">
                {mine
                  ? `你的下一步：在下方「${current.label}」登錄實際辦理日${RESULT_STAGES.has(current.key) ? '與結果（合格／不合格需明選）' : ''}，登錄前會列出核對句。`
                  : `你的下一步：等待${orgs || current.by}登錄；你在此階段沒有可登錄的動作，可查閱歷史與期限。`}
              </p>
              {mine && (
                <Button size="sm" variant="outline" onClick={() => {
                  document.getElementById(`stage-${current.key}`)?.scrollIntoView?.({ block: 'center' })
                  document.getElementById(`stage-${current.key}-date`)?.focus()
                }}>前往登錄</Button>
              )}
            </div>
          )
        })()}
      </Card>

      {demoMode && (
        // 底色用 --blue-tint 原值:對 token 加 /50 是自製色階,深色模式疊底會失真
        <div className="text-xs rounded-lg border border-[var(--border-2)] bg-[var(--blue-tint)] text-[var(--text-2)] px-3 py-2">
          示範資料：<b>{DEMO_PORTFOLIO[0].name}</b>（驗收中）。真實專案將顯示該案自己的驗收時程。
        </div>
      )}

      {/* 這張卡沒有標題時只是一串紅字,讀者無從知道它「憑什麼」提醒——
          補上標題,把採購法期限的來源講明,才是機關承辦會信的提醒 */}
      {alerts.length > 0 && (
        <Card title="法定期限提醒" bodyClass="p-0">
          <ul className="divide-y divide-[var(--border-2)]">
            {alerts.map((a) => (
              // 嚴重度不得只靠文字顏色(W8-5):色票標籤與顏色並存,列內距對齊卡頭 px-5
              <li key={a.stage} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-5 py-2.5 text-sm">
                <MSym name="warning" size={15} className={a.level === 'overdue' ? 'text-[var(--red-text)]' : 'text-[var(--amber-text)]'} />
                <Badge color={a.level === 'overdue' ? 'red' : 'amber'}>{a.level === 'overdue' ? '逾期' : '將到期'}</Badge>
                <span className={`font-medium ${a.level === 'overdue' ? 'text-[var(--red-text)]' : 'text-[var(--text)]'}`}>{a.title}</span>
                <span className="text-[var(--text-3)] text-xs">{a.meta}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="驗收流程" bodyClass="p-0">
        <ol>
          {visible.map((s, i) => (
            <StageRow key={s.key} stage={s} last={i === visible.length - 1}
              allowed={canStage(s.key)} current={i === currentIndex}
              // 順序 gate(P1-03):只開放「第一個未完成」階段登錄;
              // 之後的階段只顯示預計期限,不可先填(正式驗收不得先於初驗)
              sequentialOk={i === currentIndex}
              onSave={async (patch) => {
                setErrMsg(''); setNotice(null)
                const { error } = await recordAcceptanceEvent(s.key, patch)
                if (error) setErrMsg(friendlyError(error, `「${s.label}」登錄失敗`))
                else setNotice({ label: s.label, date: patch.event_date, result: patch.result })
                return { error }
              }}
              onClear={async () => {
                setErrMsg('')
                const { error } = await clearAcceptanceEvent(s.key)
                if (error) setErrMsg(friendlyError(error, `「${s.label}」撤銷失敗`))
                return { error }
              }} />
          ))}
        </ol>
      </Card>

      <p className="text-xs text-[var(--text-3)] leading-relaxed">
        期限依據：竣工確認＝報竣後 7 日（採購法施行細則 §92）、初驗＝竣工確認後 30 日（§93）、
        正式驗收＝初驗合格後 20 日（§94）、結算驗收證明書＝驗收後 15 日（採購法 §73、細則 §101）。
        初驗記「不合格」會自動展開「缺失改善 → 複驗」兩關。實際期限以契約及主管機關函釋為準。
      </p>
    </div>
  )
}

// export 只給單元測試(結果必選、失敗保留輸入);頁面仍只由 Acceptance 使用。
export function StageRow({ stage, last, allowed, sequentialOk, onSave, onClear, current = false }) {
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(stage.event?.event_date || '')
  const [result, setResult] = useState(stage.event?.result || '')
  const [note, setNote] = useState(stage.event?.note || '')
  // 結果未明選就按登錄:就近提示＋把焦點放回結果欄,不送寫入(UIUX 階段 1 U01)
  const [resultMissing, setResultMissing] = useState(false)
  const resultId = useId()
  const done = stage.state === 'done'
  const needsResult = RESULT_STAGES.has(stage.key)

  const save = async () => {
    if (!date) return
    // 空值不得預設合格:畫面沒表達使用者選了合格,送出的資料就不能含合格
    if (needsResult && !result) {
      setResultMissing(true)
      document.getElementById(resultId)?.focus()
      return
    }
    const res = await onSave({ event_date: date, result: needsResult ? result : null, note })
    if (!res?.error) setEditing(false) // 失敗保持編輯狀態(日期/結果/備註都留著),錯誤訊息顯示在頁面 banner
  }

  // 期限三級(O-8):逾期紅、7 日內琥珀、其餘灰。門檻與提醒中心的 acceptanceAlerts
  // 同為 7 日——同一件事在時間軸與提醒卡不可以有兩套「快到期」定義。
  // 級距只是呈現,天數與逾期判定仍由 acceptance.js 確定性算出。
  const soon = !done && !stage.overdue && stage.daysLeft != null && stage.daysLeft <= 7
  // 三級都走同一顆 Badge:字級與字重由色票決定,不再逐級跳 11px/12px、medium/semibold
  const dueBadge = !done && stage.due && (
    <Badge color={stage.overdue ? 'red' : soon ? 'amber' : 'slate'} className="num">
      <MSym name="event" size={12} />
      期限 {stage.due}{stage.daysLeft != null && (stage.overdue ? `（逾期 ${-stage.daysLeft} 天）` : `（還有 ${stage.daysLeft} 天）`)}
    </Badge>
  )

  return (
    <li id={`stage-${stage.key}`} aria-current={current ? 'step' : undefined}
      className={`flex gap-3 px-5 py-4 ${!last ? 'border-b border-[var(--border-2)]' : ''} ${current ? 'bg-[var(--blue-tint)]' : ''}`}>
      {/* 時間軸節點:7px 方點(刻意不加圓角)——同頁的圓形圖示與藥丸都是「可操作」的
          語彙,時序節點做成方點才不會被當成按鈕。已完成填滿主色、未辦只留邊框。
          aria-hidden:狀態不得只靠顏色(W8-5),完成與否由日期、期限與結果色票的
          文字承擔,方點只是視覺節奏,不重複播報。 */}
      <span aria-hidden className={`w-[7px] h-[7px] mt-[7px] shrink-0 border border-[var(--blue)] ${done ? 'bg-[var(--blue)]' : 'bg-transparent'}`} />

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* Workspace 不用粗體撐層級:標題一律 500,強弱交給顏色(已完成/進行中為主文字色) */}
          <span className={`text-sm font-medium ${done ? 'text-[var(--text)]' : stage.state === 'due' ? 'text-[var(--text)]' : 'text-[var(--text-3)]'}`}>
            {stage.label}
          </span>
          <span className="text-caption text-[var(--text-3)]">主辦：{stage.by}</span>
          {stage.event?.result && <Badge color={stage.event.result === '合格' ? 'green' : 'red'}>{stage.event.result}</Badge>}
          {dueBadge}
        </div>
        {/* 法定期限依據不是裝飾性後設資料——是使用者判斷「這關為什麼有期限」的唯一說明,
            11px + text-3(3.8:1) 讀不了,升到 12px/text-2(≈7.3:1);其餘 11px 標註維持原樣 */}
        <div className="text-xs text-[var(--text-2)] mt-0.5">{stage.basis}</div>

        {done && !editing ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {/* 方點欄不再有 20px 圖示撐高後,14px 的日期會壓過同列的階段標題;
                降到 13px 讓「階段→依據→日期」三行由大到小收斂成一列時序 */}
            <span className="num text-body text-[var(--text)]">{stage.event.event_date}</span>
            {stage.event.note && <span className="text-[var(--text-2)] text-xs">{stage.event.note}</span>}
            {/* 「修改」是進入該階段編輯的唯一入口。原本是手寫 <button>+一堆 class,只補了
                min-h,稽核在 390 量到 37×44(寬度不足,規範 §9.2 講的是最小面積)。
                改吃共用 Button:ghost 保住原本「藍字、無框」的第三級視覺,sm 是這一列
                (階段→依據→日期)的字級,44×44 由 BTN_SIZES 一次給,不再各頁自己補。 */}
            {allowed && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>修改</Button>}
          </div>
        ) : !allowed ? (
          (stage.state === 'due' || stage.state === 'pending') && (
            <div className="mt-1.5 text-caption text-[var(--text-3)]">由{stage.by === '—' ? '機關' : stage.by}登錄</div>
          )
        ) : !editing && !sequentialOk ? (
          <div className="mt-1.5 text-caption text-[var(--text-3)]">
            需先完成前一階段{stage.due ? `；預計期限 ${stage.due}` : ''}
          </div>
        ) : (
          // 欄位標籤走共用 Field,寬度交給外層容器——不再用 ! 壓掉 FIELD_BASE 的
          // 內距(那會連帶壓掉手機 44px 觸控高度),也不再各頁自寫一套 12px 標籤
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Field label="實際辦理日">
                <Input id={`stage-${stage.key}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={`${stage.label} 實際辦理日`} />
              </Field>
            </div>
            {needsResult && (
              <div className="w-28">
                {/* required 只是視覺星號;真正的擋在 save():未選不送寫入、提示就在欄位下方 */}
                <Field label="結果" required>
                  <Select id={resultId} value={result} onChange={(e) => { setResult(e.target.value); if (e.target.value) setResultMissing(false) }}
                    aria-label={`${stage.label} 結果`} aria-invalid={resultMissing || undefined}
                    aria-describedby={resultMissing ? `${resultId}-hint` : undefined}>
                    <option value="">請選擇</option>
                    <option value="合格">合格</option>
                    <option value="不合格">不合格</option>
                  </Select>
                </Field>
                {resultMissing && (
                  <span id={`${resultId}-hint`} role="alert" className="block text-footnote text-[var(--red-text)] mt-1">
                    請先選合格或不合格
                  </span>
                )}
              </div>
            )}
            <div className="flex-1 min-w-[180px]">
              <Field label="備註">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="會勘/驗收紀要…" aria-label={`${stage.label} 備註`} />
              </Field>
            </div>
            {/* 一次核對:登錄前把階段、日期、結果放成一句;不替人預選合格 */}
            {date && (
              <span className="w-full text-caption text-[var(--text-2)]">
                將登錄：{stage.label} · {date}{needsResult ? ` · ${result || '（尚未選結果）'}` : ''}{note ? ` · ${note}` : ''}
              </span>
            )}
            <Button size="sm" onClick={save} disabled={!date}>登錄</Button>
            {editing && (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>取消</Button>
                {/* 破壞性動作用 danger 變體本身表達,不用 ! 把 ghost 改色 */}
                <Button size="sm" variant="danger" onClick={async () => { const res = await onClear(); if (!res?.error) { setEditing(false); setDate(''); setResult(''); setNote('') } }}>撤銷此階段</Button>
              </>
            )}
          </div>
        )}
      </div>
      {done && <MSym name="verified" size={16} className="text-[var(--green-text)] shrink-0 mt-1 hidden sm:block" />}
    </li>
  )
}
