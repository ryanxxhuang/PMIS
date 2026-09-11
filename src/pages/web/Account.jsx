import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Button, Badge, ErrorBanner, PageHeader, Input, Empty } from '../../components/ui.jsx'
import { MSym } from '../../components/icons.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import { friendlyError } from '../../lib/errorMessage.js'

// 帳號安全:兩步驟驗證(TOTP)的啟用／停用。個人層設定,不分三方角色。
//
// 為什麼是「每個帳號自選」而不是全站強制:工程會一覽表 SaaS 套裝型・普級不要求 MFA
// (高級才要求,見 docs/資安/資通系統防護基準-普通級-符合性對照.md);先提供給要的機關
// 承辦人與管理者,全站強制等有機關契約明訂再做(要另加 RLS 依 aal 分級)。
//
// 流程(Supabase Auth 原生):enroll → 顯示 QR 與金鑰 → 使用者用驗證器 App 掃描 →
// 輸入第一組 6 位數 challengeAndVerify → 因子變 verified,下次登入要驗證碼。
// 沒驗完的 unverified 因子不算啟用;enrollMfa 會先清掉殘留再建新的。
export default function Account() {
  const { currentUser, isSupabaseConfigured, listMfaFactors, enrollMfa, confirmMfaEnrollment, unenrollMfa } = useStore()
  const [factors, setFactors] = useState(null) // null=載入中
  const [loadErr, setLoadErr] = useState('')
  const [pending, setPending] = useState(null) // { factorId, qrCode, secret }
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')

  const reload = useCallback(async () => {
    setLoadErr('')
    // demo 沒有 Supabase Auth:沒有因子可列,也不能啟用;頁面照常渲染但只顯示說明
    if (!isSupabaseConfigured) { setFactors([]); return }
    const { factors: list, error } = await listMfaFactors()
    if (error) { setLoadErr(friendlyError(error, '讀取驗證設定失敗')); setFactors([]); return }
    setFactors(list.filter((f) => f.status === 'verified'))
  }, [listMfaFactors, isSupabaseConfigured])
  useEffect(() => { reload() }, [reload])

  const start = async () => {
    setErr(''); setDone(''); setBusy(true)
    const r = await enrollMfa()
    setBusy(false)
    if (r.error) { setErr(friendlyError(r.error, '無法開始啟用，請稍後再試')); return }
    setPending(r); setCode('')
  }
  const confirm = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await confirmMfaEnrollment(pending.factorId, code)
    setBusy(false)
    if (error) { setErr(friendlyError(error, '驗證碼不正確，請看驗證器 App 重新輸入')); setCode(''); return }
    setPending(null); setDone('兩步驟驗證已啟用。下次登入除了密碼，還需要輸入驗證器 App 的 6 位數。')
    reload()
  }
  const cancel = async () => {
    // 沒驗完就取消:把 unverified 因子清掉,否則它會留在帳號上
    if (pending?.factorId) { try { await unenrollMfa(pending.factorId) } catch { /* noop */ } }
    setPending(null); setCode(''); setErr('')
  }
  const remove = async (f) => {
    const ok = await appConfirm({
      title: '停用兩步驟驗證？',
      body: '停用後只需密碼即可登入。若你是機關承辦人或專案管理者，建議保留。',
      confirmLabel: '停用', danger: true,
    })
    if (!ok) return
    setErr(''); setDone(''); setBusy(true)
    const { error } = await unenrollMfa(f.id)
    setBusy(false)
    if (error) { setErr(friendlyError(error, '停用失敗，請稍後再試')); return }
    setDone('兩步驟驗證已停用。')
    reload()
  }

  const enabled = (factors || []).length > 0

  return (
    <div className="space-y-5">
      <PageHeader title="帳號安全" subtitle="兩步驟驗證與登入資訊。設定只影響你自己的帳號。" />

      <Card title="登入資訊">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-[var(--text-3)]">Email</dt><dd className="text-[var(--text)]">{currentUser?.email}</dd>
          <dt className="text-[var(--text-3)]">身分</dt><dd className="text-[var(--text)]">{currentUser?.label}</dd>
        </dl>
      </Card>

      <Card title="兩步驟驗證（驗證器 App）">
        <div className="space-y-3 text-sm">
          <p className="text-[var(--text-2)]">
            啟用後，登入時除了密碼還要輸入驗證器 App（Google Authenticator、Microsoft Authenticator、1Password 等）顯示的 6 位數，
            密碼外洩時帳號仍不會被登入。
          </p>
          <ErrorBanner msg={loadErr || err} />
          {done && <p role="status" className="flex items-center gap-1.5 text-[var(--success-text,var(--text))]"><MSym name="check_circle" size={16} />{done}</p>}

          {factors === null && !loadErr ? (
            <p className="text-[var(--text-3)]">讀取中…</p>
          ) : pending ? (
            <form onSubmit={confirm} className="space-y-3" aria-label="啟用兩步驟驗證">
              <ol className="list-decimal space-y-2 pl-5 text-[var(--text-2)]">
                <li>用驗證器 App 掃描下方 QR code；無法掃描時手動輸入金鑰。</li>
                <li>輸入 App 顯示的 6 位數完成啟用。</li>
              </ol>
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                {pending.qrCode && <img src={pending.qrCode} alt="兩步驟驗證 QR code" width={168} height={168} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-white p-2" />}
                <div className="space-y-1 min-w-0">
                  <div className="text-[var(--text-3)]">金鑰（手動輸入用）</div>
                  <code className="block break-all rounded bg-[var(--surface-2)] px-2 py-1 text-xs select-all">{pending.secret}</code>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Input aria-label="驗證碼" placeholder="6 位數驗證碼" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                  autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required className="w-40" />
                <Button type="submit" busy={busy} disabled={code.length !== 6}>完成啟用</Button>
                <Button type="button" variant="secondary" onClick={cancel} disabled={busy}>取消</Button>
              </div>
            </form>
          ) : enabled ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2"><Badge color="green">已啟用</Badge><span className="text-[var(--text-2)]">登入時需要驗證碼。</span></div>
              <ul role="list" className="divide-y divide-[var(--border)]">
                {factors.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="text-[var(--text)]">{f.friendly_name || '驗證器 App'}</div>
                      <div className="text-xs text-[var(--text-3)]">啟用於 {f.created_at ? f.created_at.slice(0, 10) : '—'}</div>
                    </div>
                    <Button variant="secondary" size="sm" busy={busy} onClick={() => remove(f)}>停用</Button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[var(--text-3)]">遺失驗證器時無法自行登入，請聯絡平台管理員協助停用後重新啟用。</p>
            </div>
          ) : (
            <div className="space-y-3">
              <Empty icon="shield" title="尚未啟用">啟用需要一台裝有驗證器 App 的手機；完成後下次登入就會要求驗證碼。</Empty>
              {isSupabaseConfigured
                ? <Button onClick={start} busy={busy}>啟用兩步驟驗證</Button>
                : <p className="text-[var(--text-3)]">示範環境沒有帳號驗證，正式登入後才能啟用。</p>}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
