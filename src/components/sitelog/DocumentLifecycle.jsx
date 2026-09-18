// 文件生命週期卡(P2c 施工日誌、P3a 監造日誌共用;設計 §4–§6):狀態、版本與雜湊、簽署(登入的平台帳號,
// 意願文字明示)、提送給對象方、對象方收件／退回(必填原因)、歷次退回原因與再送差異、回執與下一責任方。
// 責任方與提送對象由 doc_type 決定(lib/fieldDocs 的 TO_ORG_BY_DOC_TYPE,鏡像 DB 對象矩陣):施工日誌 廠商→監造、
// 監造日誌 監造→機關;第三方(施工日誌的機關、監造日誌的廠商)只是查閱視角。
// 全部動作都是「人明確操作」;所有規則由 RPC 執行(PD001–PD010 分流見 lib/fieldDocs.fieldDocErrorGuidance),
// 這裡不做任何業務判斷,只把伺服器回的版本／雜湊／時間如實顯示。
import { Link } from 'react-router-dom'
import { Badge, Button } from '../ui.jsx'
import { MSym } from '../icons.jsx'
import { appConfirm, appPrompt } from '../confirm.jsx'
import {
  docStatusMeta, formatHash, signIntentText, ORG_LABEL, DOC_TYPE_LABEL, changedKeysLabel, fieldLabel, docToOrg, docToOrgLabel, UNMET_STATUS_LABEL,
} from '../../lib/fieldDocs.js'

const ACTION_LABEL = { submit: '提送', receive: '收件', return: '退回' }
const ACTION_TONE = { submit: 'blue', receive: 'green', return: 'red' }
const fmtTs = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '—')

export default function DocumentLifecycle({
  doc, version, signatures = [], submissions = [], viewerOrg, canAct = false, dirty = false, content = null,
  busy = null, onSign, onSubmit, onReceive, onReturn, message = null,
  labels = null, templateMeta = null,
}) {
  if (!doc) return null
  const meta = docStatusMeta(doc, viewerOrg)
  const mine = doc.owner_org === viewerOrg
  const docLabel = DOC_TYPE_LABEL[doc.doc_type] || '文件'
  const ownerLabel = ORG_LABEL[doc.owner_org] || '責任方'
  const toOrg = docToOrg(doc)
  const toLabel = docToOrgLabel(doc)
  const canRespond = !mine && viewerOrg === toOrg && canAct
  const recheck = Array.isArray(doc.recheck) ? doc.recheck : []
  const pendingCount = recheck.filter((r) => !String(r.key || '').startsWith('attachments')).length
  const currentSig = signatures.find((s) => s.version_no === doc.current_version_no) || null
  const lastReturn = submissions.find((s) => s.action === 'return') || null
  const latestSubmit = submissions.find((s) => s.action === 'submit' && s.version_no === doc.current_version_no) || null
  const receiveRow = submissions.find((s) => s.action === 'receive') || null
  const canSign = mine && canAct && ['draft', 'pending_input', 'in_review'].includes(doc.status) && doc.current_version_no > 0 && !dirty && pendingCount === 0 && recheck.length === 0
  const intent = version ? signIntentText({ docLabel, docDate: doc.doc_date, versionNo: doc.current_version_no, contentHash: version.content_hash }) : ''

  const sign = async () => {
    if (!(await appConfirm({ title: `簽署 ${doc.doc_date} ${docLabel}（版本 ${doc.current_version_no}）？`, body: `${intent}\n\n簽署後內容雜湊、簽署者與伺服器時間會留存；之後更正必須另開版本重新簽署。`, confirmLabel: '簽署' }))) return
    onSign?.(intent)
  }
  const submit = async () => {
    if (!(await appConfirm({ title: `提送給${toLabel}？`, body: `將提送 ${doc.doc_date} ${docLabel}版本 ${doc.current_version_no}（雜湊 ${formatHash(version?.content_hash)}）給${toLabel}；重試會沿用同一筆送件，不會重複提送。`, confirmLabel: '提送' }))) return
    onSubmit?.()
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
          <div className="text-[var(--text-2)] num">時間 {fmtTs(currentSig.signed_at)}・雜湊 {formatHash(currentSig.content_hash)}・方式 平台帳號</div>
        </div>
      )}
      {/* 簽後更正提示:目前版本比最後簽署新 */}
      {!currentSig && signatures.length > 0 && ['draft', 'pending_input'].includes(doc.status) && (
        <p className="text-footnote text-[var(--text-2)]">版本 {signatures[0].version_no} 的簽署仍綁在該版本；目前版本 {doc.current_version_no} 是更正草稿，需重新簽署。</p>
      )}

      {/* 提送(責任方,已簽署) */}
      {mine && canAct && doc.status === 'signed' && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={submit} busy={busy === 'submit'}>提送給{toLabel}</Button>
          <span className="text-caption text-[var(--text-3)]">提送的是已簽署的版本 {doc.current_version_no}；{toLabel}收件或退回會顯示在這裡。</span>
        </div>
      )}
      {doc.status === 'submitted' && latestSubmit && (
        <p className="text-footnote text-[var(--text-2)]">已於 {fmtTs(latestSubmit.created_at)} 提送給{ORG_LABEL[latestSubmit.to_org] || latestSubmit.to_org}（版本 {latestSubmit.version_no}）；等待{ORG_LABEL[latestSubmit.to_org] || toLabel}收件。回執編號 {String(latestSubmit.id).slice(0, 8)}。</p>
      )}
      {/* 提送對象:收件／退回(必填原因) */}
      {canRespond && ['submitted', 'received'].includes(doc.status) && (
        <div className="flex items-center gap-2 flex-wrap">
          {doc.status === 'submitted' && <Button onClick={receive} busy={busy === 'receive'}>收件</Button>}
          <Button variant="secondary" onClick={ret} busy={busy === 'return'}>退回（填原因）</Button>
          <span className="text-caption text-[var(--text-3)]">收件＝確認已收到此版本；退回會要求{ownerLabel}補正後重新簽署再送。</span>
        </div>
      )}
      {doc.status === 'received' && receiveRow && (
        <p className="text-footnote text-[var(--green-text)]">{ORG_LABEL[receiveRow.actor_org] || toLabel}已於 {fmtTs(receiveRow.created_at)} 收件（版本 {receiveRow.version_no}）；本文件不可再修改。</p>
      )}

      {/* 歷次提送／收件／退回(append-only;退回原因與再送差異全部保留) */}
      {submissions.length > 0 && (
        <details className="text-footnote">
          <summary className="cursor-pointer text-[var(--text-2)] min-h-11 md:min-h-0 inline-flex items-center gap-1"><MSym name="history" size={14} />歷次提送紀錄（{submissions.length}）</summary>
          <ol className="mt-2 space-y-1.5">
            {submissions.map((s) => (
              <li key={s.id} className="flex items-start gap-2">
                <Badge color={ACTION_TONE[s.action]}>{ACTION_LABEL[s.action] || s.action}</Badge>
                <div className="min-w-0">
                  <div className="text-[var(--text)] num">版本 {s.version_no}・{ORG_LABEL[s.actor_org] || s.actor_org}・{fmtTs(s.created_at)}{s.action === 'submit' ? `・送${ORG_LABEL[s.to_org] || s.to_org}` : ''}</div>
                  {s.reason && <div className="text-[var(--red-text)] whitespace-pre-wrap">原因：{s.reason}</div>}
                  {s.diff && Array.isArray(s.diff.changed_keys) && (
                    <div className="text-[var(--text-2)]">相對退回版本 {s.diff.against_version_no} 的差異：{s.diff.changed_keys.length ? changedKeysLabel(s.diff, content, labels).join('、') : '無頂層欄位變更'}</div>
                  )}
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
      {!mine && viewerOrg !== toOrg && <p className="text-caption text-[var(--text-3)]">{ORG_LABEL[viewerOrg] || '本方'}為查閱視角；提送對象是{toLabel}。</p>}
      {!canAct && mine && <p className="text-caption text-[var(--text-3)]">你目前沒有此文件的編輯權限。</p>}
      <Link to="/site" className="inline-flex items-center gap-1 text-caption text-[var(--blue-text)] hover:underline">回現場紀錄總覽 <MSym name="arrow_forward" size={11} /></Link>
    </section>
  )
}
