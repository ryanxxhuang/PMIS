// 文件生命週期卡(P2c 施工日誌、P3a 監造日誌、P3b 自主檢查表共用;設計 §4–§6):狀態、版本與雜湊、簽署(登入的平台帳號,
// 意願文字明示)、提送給對象方、對象方收件／退回(必填原因)、提送回執(P3d:對象、送出時間、回執編號＝submission_id、
// 收件狀態、下一責任方)、退回歷史(P3d:歷次退回原因、退回人、時間與補正再送的差異全部列出,不只最新一筆)。
// 責任方與提送對象由 doc_type 決定(lib/fieldDocs 的 TO_ORGS_BY_DOC_TYPE,單一來源鏡像 DB 對象矩陣):施工日誌／自檢 廠商→監造、
// 監造日誌 監造→機關、監造查驗表單 監造→廠商＋機關(每個對象一顆提送鈕、各自收件／退回;P3c);第三方只是查閱視角。
// signNote:該類文書簽署的效果補充(查驗表單:簽署即判定、確認量成為可估驗依據),顯示在意願聲明下並進確認框。
// 全部動作都是「人明確操作」;所有規則由 RPC 執行(PD001–PD010 分流見 lib/fieldDocs.fieldDocErrorGuidance),
// 這裡不做任何業務判斷,只把伺服器回的版本／雜湊／時間／差異(diff 由 DB trigger 算)如實顯示;時間一律換成台北時間,
// 下一責任方與今日工作球權同一支判定(lib/fieldDocs.nextResponsibleText → ballInCourtRules.fieldDocumentBalls)。
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Badge, Button } from '../ui.jsx'
import { MSym } from '../icons.jsx'
import { appConfirm, appPrompt } from '../confirm.jsx'
import {
  docStatusMeta, formatHash, signIntentText, ORG_LABEL, DOC_TYPE_LABEL, changedKeysLabel, fieldLabel, docToOrgs, docToOrgLabel, UNMET_STATUS_LABEL,
  submissionsChronological, submissionReceipts, returnHistory, nextResponsibleText, SIGN_METHOD_LABEL,
} from '../../lib/fieldDocs.js'
import { taipeiDateTime as fmtTs } from '../../lib/dates.js'

const ACTION_LABEL = { submit: '提送', receive: '收件', return: '退回' }
const ACTION_TONE = { submit: 'blue', receive: 'green', return: 'red' }

// 提送／收件／退回列只存 actor_id(append-only,沒有姓名快照):以既有 list_project_members(本案成員可讀)對照姓名。
// 已離開本案的成員對不到就只顯示單位,不猜;名單載入失敗如實標示。
function useMemberNames(enabled) {
  const { listMembers } = useStore()
  const [state, setState] = useState({ names: new Map(), error: null })
  useEffect(() => {
    if (!enabled) return
    let active = true
    listMembers().then(({ rows, error }) => {
      if (active) setState({ names: new Map((rows || []).map((m) => [m.user_id, m.full_name])), error: error || null })
    })
    return () => { active = false }
  }, [enabled, listMembers])
  return state
}

export default function DocumentLifecycle({
  doc, version, signatures = [], submissions = [], viewerOrg, canAct = false, dirty = false, content = null,
  busy = null, onSign, onSubmit, onReceive, onReturn, message = null,
  labels = null, templateMeta = null, signNote = null,
}) {
  const members = useMemberNames(!!doc && submissions.some((s) => s?.actor_id))
  if (!doc) return null
  const who = (row) => {
    const name = row?.actor_id ? members.names.get(row.actor_id) : null
    return `${ORG_LABEL[row?.actor_org] || row?.actor_org || '—'}${name ? ` ${name}` : ''}`
  }
  const meta = docStatusMeta(doc, viewerOrg)
  const mine = doc.owner_org === viewerOrg
  const docLabel = DOC_TYPE_LABEL[doc.doc_type] || '文件'
  const ownerLabel = ORG_LABEL[doc.owner_org] || '責任方'
  const toOrgs = docToOrgs(doc)
  const toLabel = docToOrgLabel(doc)
  const canRespond = !mine && toOrgs.includes(viewerOrg) && canAct
  // 目前版本尚未提送的對象(多對象文件逐一提送;單對象文件提送後就沒有鈕)
  const submittedTo = new Set(submissions.filter((s) => s?.action === 'submit' && Number(s.version_no) === Number(doc.current_version_no)).map((s) => s.to_org))
  const pendingTargets = toOrgs.filter((o) => !submittedTo.has(o))
  const recheck = Array.isArray(doc.recheck) ? doc.recheck : []
  const pendingCount = recheck.filter((r) => !String(r.key || '').startsWith('attachments')).length
  const currentSig = signatures.find((s) => s.version_no === doc.current_version_no) || null
  const log = submissionsChronological(submissions)
  const returns = returnHistory(submissions)
  const lastReturn = returns[returns.length - 1] || null
  const receipts = submissionReceipts(submissions)
  const canSign = mine && canAct && ['draft', 'pending_input', 'in_review'].includes(doc.status) && doc.current_version_no > 0 && !dirty && pendingCount === 0 && recheck.length === 0
  const intent = version ? signIntentText({ docLabel, docDate: doc.doc_date, versionNo: doc.current_version_no, contentHash: version.content_hash }) : ''

  const sign = async () => {
    if (!(await appConfirm({ title: `簽署 ${doc.doc_date} ${docLabel}（版本 ${doc.current_version_no}）？`, body: `${intent}\n\n${signNote ? `${signNote}\n\n` : ''}簽署後內容雜湊、簽署者與伺服器時間會留存；之後更正必須另開版本重新簽署。`, confirmLabel: '簽署' }))) return
    onSign?.(intent)
  }
  const submit = async (to) => {
    const label = ORG_LABEL[to] || to
    if (!(await appConfirm({ title: `提送給${label}？`, body: `將提送 ${doc.doc_date} ${docLabel}版本 ${doc.current_version_no}（雜湊 ${formatHash(version?.content_hash)}）給${label}；重試會沿用同一筆送件，不會重複提送。`, confirmLabel: '提送' }))) return
    onSubmit?.(to)
  }
  const receive = async () => {
    if (!(await appConfirm({ title: '收件此版本？', body: `收件後${ownerLabel}不可再修改版本 ${doc.current_version_no}；如需更正只能另立新文件。`, confirmLabel: '收件' }))) return
    onReceive?.()
  }
  const ret = async () => {
    const reason = await appPrompt({ title: `退回 ${doc.doc_date} ${docLabel}`, label: `退回原因（必填，${ownerLabel}會看到）`, required: true })
    if (reason === null) return
    onReturn?.(reason)
  }

  return (
    <section aria-label="文件狀態與簽署" className="rounded-lg border border-[var(--border)] p-4 space-y-3 text-body">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge color={meta.tone}>{meta.label}</Badge>
        <span className="text-footnote text-[var(--text-2)] num">版本 {doc.current_version_no}{version ? `・雜湊 ${formatHash(version.content_hash)}` : ''}</span>
        {version?.author_kind === 'ai' && <Badge color="purple">AI 草稿</Badge>}
        {templateMeta?.is_demo && <Badge color="amber">{templateMeta.demo_label || '示範範本'}</Badge>}
        {meta.action && <span className="ml-auto text-footnote text-[var(--text-3)]">下一步：{meta.action}</span>}
      </div>
      {message && <p role="status" className={`text-footnote ${message.tone === 'success' ? 'text-[var(--green-text)]' : message.tone === 'info' ? 'text-[var(--blue-text)]' : 'text-[var(--red-text)]'}`}>{message.text}</p>}

      {/* 退回:最新原因永遠在最上面(責任方第一眼要看到為什麼) */}
      {doc.status === 'returned' && lastReturn && (
        <div className="rounded-lg bg-[var(--red-tint)] p-3 text-footnote">
          <div className="font-medium text-[var(--red-text)]">{ORG_LABEL[lastReturn.actor_org] || toLabel}退回（版本 {lastReturn.version_no}，{fmtTs(lastReturn.created_at)}）</div>
          <div className="text-[var(--text)] mt-0.5 whitespace-pre-wrap">{lastReturn.reason}</div>
          {mine && <div className="text-[var(--text-2)] mt-1">修正內容並存檔會建立新版本，需重新簽署後再提送；舊簽署仍綁在版本 {lastReturn.version_no}。</div>}
        </div>
      )}

      {/* 簽署區(責任方) */}
      {mine && ['draft', 'pending_input', 'in_review', 'returned'].includes(doc.status) && canAct && (
        <div className="space-y-2">
          {doc.status === 'returned' ? null : pendingCount > 0 || recheck.length > 0 ? (
            <p className="text-footnote text-[var(--amber-text)]">尚有 {pendingCount} 個必填欄位待補或待親自確認{recheck.length > pendingCount ? `、${recheck.length - pendingCount} 個附件問題` : ''}；補齊並存檔後才能簽署。</p>
          ) : dirty ? (
            <p className="text-footnote text-[var(--text-2)]">有未存檔的修改；先存檔，簽署的才是你看到的這一版。</p>
          ) : doc.current_version_no === 0 ? (
            <p className="text-footnote text-[var(--text-2)]">尚無版本；填好內容存檔後才能簽署。</p>
          ) : (
            <div className="rounded-lg bg-[var(--surface-2)] p-3 space-y-2">
              <div className="text-footnote text-[var(--text-2)]">簽署意願聲明（簽署時原文留存）</div>
              <p className="text-body text-[var(--text)]">{intent}</p>
              {signNote && <p role="note" className="text-footnote text-[var(--amber-text)]">{signNote}</p>}
              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={sign} busy={busy === 'sign'} disabled={!canSign}>簽署此版本</Button>
                <span className="text-caption text-[var(--text-3)]">以你登入的平台帳號簽署；伺服器記錄簽署者、時間與內容雜湊。</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 已簽署:綁定版本、簽署者、伺服器時間 */}
      {currentSig && (
        <div className="rounded-lg bg-[var(--green-tint)] p-3 text-footnote space-y-0.5">
          <div className="font-medium text-[var(--green-text)]">版本 {currentSig.version_no} 已由 {currentSig.signer_name_snapshot || ORG_LABEL[currentSig.signer_org] || '簽署者'} 簽署</div>
          <div className="text-[var(--text-2)] num">時間 {fmtTs(currentSig.signed_at)}・雜湊 {formatHash(currentSig.content_hash)}・方式 {SIGN_METHOD_LABEL[currentSig.method] || '平台帳號'}</div>
        </div>
      )}
      {/* 簽後更正提示:目前版本比最後簽署新 */}
      {!currentSig && signatures.length > 0 && ['draft', 'pending_input'].includes(doc.status) && (
        <p className="text-footnote text-[var(--text-2)]">版本 {signatures[0].version_no} 的簽署仍綁在該版本；目前版本 {doc.current_version_no} 是更正草稿，需重新簽署。</p>
      )}

      {/* 提送(責任方,已簽署;多對象文件每個尚未提送的對象一顆鈕) */}
      {mine && canAct && ['signed', 'submitted'].includes(doc.status) && pendingTargets.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {pendingTargets.map((to) => <Button key={to} onClick={() => submit(to)} busy={busy === 'submit'}>提送給{ORG_LABEL[to] || to}</Button>)}
          <span className="text-caption text-[var(--text-3)]">提送的是已簽署的版本 {doc.current_version_no}；{toLabel}收件或退回會顯示在這裡。</span>
        </div>
      )}
      {/* 提送對象:收件／退回(必填原因) */}
      {canRespond && ['submitted', 'received'].includes(doc.status) && (
        <div className="flex items-center gap-2 flex-wrap">
          {doc.status === 'submitted' && <Button onClick={receive} busy={busy === 'receive'}>收件</Button>}
          <Button variant="secondary" onClick={ret} busy={busy === 'return'}>退回（填原因）</Button>
          <span className="text-caption text-[var(--text-3)]">收件＝確認已收到此版本；退回會要求{ownerLabel}補正後重新簽署再送。</span>
        </div>
      )}
      {/* 提送與回執(最近一輪送件):對象、送出時間、送件版本與雜湊、回執編號(submission_id)、收件狀態、下一責任方 */}
      {receipts.length > 0 && (
        <div role="group" aria-label="提送與回執" className="rounded-lg border border-[var(--border)] p-3 text-footnote space-y-2">
          <div className="font-medium text-[var(--text)] flex items-center gap-1"><MSym name="receipt_long" size={14} />提送與回執</div>
          {receipts.map(({ submit, response }) => (
            <dl key={submit.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
              <dt className="text-[var(--text-3)]">提送對象</dt><dd className="min-w-0 text-[var(--text)]">{ORG_LABEL[submit.to_org] || submit.to_org}</dd>
              <dt className="text-[var(--text-3)]">送出</dt><dd className="min-w-0 text-[var(--text)] num">{fmtTs(submit.created_at)}・{who(submit)}</dd>
              <dt className="text-[var(--text-3)]">送件版本</dt><dd className="min-w-0 text-[var(--text)] num">版本 {submit.version_no}・雜湊 {formatHash(submit.content_hash)}</dd>
              <dt className="text-[var(--text-3)]">回執編號</dt><dd className="min-w-0 text-[var(--text)] num break-all">{submit.id}</dd>
              <dt className="text-[var(--text-3)]">收件狀態</dt>
              <dd className="min-w-0 num">
                {!response ? <span className="text-[var(--blue-text)]">待{ORG_LABEL[submit.to_org] || '對方'}收件</span>
                  : response.action === 'receive'
                    ? <span className="text-[var(--green-text)]">{ORG_LABEL[response.actor_org] || toLabel}已於 {fmtTs(response.created_at)} 收件（版本 {response.version_no}）{doc.status === 'received' ? '；本文件不可再修改' : ''}</span>
                    : <span className="text-[var(--red-text)]">已於 {fmtTs(response.created_at)} 退回（{who(response)}）</span>}
              </dd>
            </dl>
          ))}
          <div className="text-[var(--text-2)]">下一責任方：<span className="text-[var(--text)]">{nextResponsibleText(doc, submissions)}</span></div>
        </div>
      )}

      {/* 退回歷史:歷次退回原因、退回人、時間與補正再送的差異(DB 算的 diff)全部列出 */}
      {returns.length > 0 && (
        <div role="group" aria-label="退回歷史" className="rounded-lg border border-[var(--border)] p-3 text-footnote space-y-2">
          <div className="font-medium text-[var(--text)] flex items-center gap-1"><MSym name="undo" size={14} />退回歷史（{returns.length}）</div>
          <ol className="space-y-2">
            {returns.map((r, i) => (
              <li key={r.id} className="min-w-0 border-l-2 border-[var(--red-text)] pl-2 space-y-0.5">
                <div className="text-[var(--text)] num">第 {i + 1} 次・版本 {r.version_no}・{fmtTs(r.created_at)}・退回人 {who(r)}</div>
                <div className="text-[var(--red-text)] whitespace-pre-wrap break-words">原因：{r.reason || '（未記錄）'}</div>
                {r.resubmit ? (
                  <div className="text-[var(--text-2)] break-words">
                    補正：版本 {r.resubmit.version_no} 於 {fmtTs(r.resubmit.created_at)} 再送。
                    <span className="block">相對退回版本 {r.resubmit.diff.against_version_no} 的差異：{Array.isArray(r.resubmit.diff.changed_keys) && r.resubmit.diff.changed_keys.length ? changedKeysLabel(r.resubmit.diff, content, labels).join('、') : '無頂層欄位變更'}</span>
                  </div>
                ) : <div className="text-[var(--text-3)]">尚未補正再送</div>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {members.error && submissions.length > 0 && <p className="text-caption text-[var(--text-3)]">成員名單載入失敗，送件與退回人只顯示單位。</p>}

      {/* 歷次提送／收件／退回(append-only 完整流水,由舊到新) */}
      {log.length > 0 && (
        <details className="text-footnote">
          <summary className="cursor-pointer text-[var(--text-2)] min-h-11 md:min-h-0 inline-flex items-center gap-1"><MSym name="history" size={14} />歷次提送紀錄（{log.length}）</summary>
          <ol className="mt-2 space-y-1.5">
            {log.map((s) => (
              <li key={s.id} className="flex items-start gap-2">
                <Badge color={ACTION_TONE[s.action]}>{ACTION_LABEL[s.action] || s.action}</Badge>
                <div className="min-w-0 text-[var(--text)] num break-words">
                  版本 {s.version_no}・{who(s)}・{fmtTs(s.created_at)}{s.action === 'submit' ? `・送${ORG_LABEL[s.to_org] || s.to_org}・回執 ${String(s.id).slice(0, 8)}` : ''}
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
      {signatures.length > 1 && (
        <details className="text-footnote">
          <summary className="cursor-pointer text-[var(--text-2)] min-h-11 md:min-h-0 inline-flex items-center gap-1"><MSym name="draw" size={14} />歷次簽署（{signatures.length}）</summary>
          <ul className="mt-2 space-y-1">
            {signatures.map((s) => <li key={s.id} className="num text-[var(--text-2)]">版本 {s.version_no}・{s.signer_name_snapshot || ORG_LABEL[s.signer_org]}・{fmtTs(s.signed_at)}・雜湊 {formatHash(s.content_hash)}</li>)}
          </ul>
        </details>
      )}
      {recheck.length > 0 && (
        <div className="text-caption text-[var(--text-3)]">伺服器待補清單：{recheck.map((r) => `${fieldLabel(r.key, content, labels)}${r.status && r.status !== 'pending' && UNMET_STATUS_LABEL[r.status] ? `（${UNMET_STATUS_LABEL[r.status]}）` : ''}`).join('、')}</div>
      )}
      {!mine && !toOrgs.includes(viewerOrg) && <p className="text-caption text-[var(--text-3)]">{ORG_LABEL[viewerOrg] || '本方'}為查閱視角；提送對象是{toLabel}。</p>}
      {!canAct && mine && <p className="text-caption text-[var(--text-3)]">你目前沒有此文件的編輯權限。</p>}
      <Link to="/site" className="inline-flex items-center gap-1 text-caption text-[var(--blue-text)] hover:underline">回現場紀錄總覽 <MSym name="arrow_forward" size={11} /></Link>
    </section>
  )
}
