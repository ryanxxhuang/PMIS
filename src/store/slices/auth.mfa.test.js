// @vitest-environment jsdom
// 兩步驟驗證(TOTP)的登入閘門:帳密對了但 session 只有 aal1、帳號有已驗證因子時,
// currentUser 必須維持 null 並舉旗 mfaRequired;驗證碼通過(MFA_CHALLENGE_VERIFIED
// 帶 aal2 session)後才載入 profile。這層是 UX 閘門,不是 RLS;測的是「不會把 aal1
// 當成登入成功」與「因子只認 verified」兩件事。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { configured } from '../../testUtils/supabaseMock.js'
import { renderHook } from '../../testUtils/renderHook.js'

const h = vi.hoisted(() => {
  const state = { aal: { currentLevel: 'aal1', nextLevel: 'aal1' }, factors: [], listener: null, session: null }
  const profileBuilder = () => ({
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { full_name: '王承辦', company: '機關', org_type: 'owner', role: '承辦' }, error: null }) }) }),
  })
  return {
    state,
    client: {
      from: () => profileBuilder(),
      auth: {
        getSession: () => Promise.resolve({ data: { session: state.session } }),
        onAuthStateChange: (cb) => { state.listener = cb; return { data: { subscription: { unsubscribe: () => {} } } } },
        signOut: () => Promise.resolve({ error: null }),
        mfa: {
          getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: state.aal, error: null }),
          listFactors: () => Promise.resolve({ data: { totp: state.factors, all: state.factors }, error: null }),
          challengeAndVerify: vi.fn(({ code }) => {
            if (code !== '123456') return Promise.resolve({ error: new Error('Invalid TOTP code') })
            // 驗證成功:Supabase 會發 MFA_CHALLENGE_VERIFIED 帶升級後的 session
            state.aal = { currentLevel: 'aal2', nextLevel: 'aal2' }
            state.listener?.('MFA_CHALLENGE_VERIFIED', state.session)
            return Promise.resolve({ data: {}, error: null })
          }),
        },
      },
    },
  }
})
vi.mock('../../lib/supabase.js', () => configured(h.client))

import { useAuthSlice } from './auth.js'

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const session = { user: { id: 'u-owner', email: 'owner@example.test' } }

describe('auth slice:兩步驟驗證閘門', () => {
  beforeEach(() => {
    h.state.aal = { currentLevel: 'aal1', nextLevel: 'aal1' }
    h.state.factors = []
    h.state.session = null
    h.state.listener = null
    h.client.auth.mfa.challengeAndVerify.mockClear()
  })

  it('沒有 MFA 因子(nextLevel=aal1):session 直接載入 profile,不舉旗', async () => {
    h.state.session = session
    const result = renderHook(() => useAuthSlice())
    await flush(); await flush()
    expect(result.current.mfaRequired).toBe(false)
    expect(result.current.currentUser?.user_id).toBe('u-owner')
  })

  it('有已驗證因子但 session 是 aal1:currentUser 維持 null、mfaRequired=true', async () => {
    h.state.session = session
    h.state.aal = { currentLevel: 'aal1', nextLevel: 'aal2' }
    h.state.factors = [{ id: 'f1', status: 'verified', factor_type: 'totp' }]
    const result = renderHook(() => useAuthSlice())
    await flush(); await flush()
    expect(result.current.mfaRequired).toBe(true)
    expect(result.current.currentUser).toBeNull()
    expect(result.current.authReady).toBe(true) // 守衛可以判定,不是永久載入中
  })

  it('verifyMfa 只用 verified 因子;錯碼回 error 且仍未登入,對碼後載入 profile', async () => {
    h.state.session = session
    h.state.aal = { currentLevel: 'aal1', nextLevel: 'aal2' }
    h.state.factors = [
      { id: 'f-half', status: 'unverified', factor_type: 'totp' },
      { id: 'f1', status: 'verified', factor_type: 'totp' },
    ]
    const result = renderHook(() => useAuthSlice())
    await flush(); await flush()
    expect(result.current.mfaRequired).toBe(true)

    let r
    await act(async () => { r = await result.current.verifyMfa('000000') })
    expect(r.error).toBeTruthy()
    expect(h.client.auth.mfa.challengeAndVerify).toHaveBeenLastCalledWith({ factorId: 'f1', code: '000000' })
    expect(result.current.currentUser).toBeNull()

    await act(async () => { r = await result.current.verifyMfa(' 123456 ') })
    expect(r.error).toBeNull()
    await flush(); await flush()
    expect(result.current.mfaRequired).toBe(false)
    expect(result.current.currentUser?.user_id).toBe('u-owner')
  })

  it('沒有任何 verified 因子時 verifyMfa 回明確錯誤,不呼叫 challenge', async () => {
    h.state.session = null
    h.state.factors = [{ id: 'f-half', status: 'unverified', factor_type: 'totp' }]
    const result = renderHook(() => useAuthSlice())
    await flush()
    let r
    await act(async () => { r = await result.current.verifyMfa('123456') })
    expect(r.error?.message).toContain('沒有可用的驗證因子')
    expect(h.client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled()
  })

  it('登出清掉 mfaRequired', async () => {
    h.state.session = session
    h.state.aal = { currentLevel: 'aal1', nextLevel: 'aal2' }
    h.state.factors = [{ id: 'f1', status: 'verified', factor_type: 'totp' }]
    const result = renderHook(() => useAuthSlice())
    await flush(); await flush()
    expect(result.current.mfaRequired).toBe(true)
    await act(async () => { await result.current.signOutBase() })
    expect(result.current.mfaRequired).toBe(false)
    expect(result.current.currentUser).toBeNull()
  })
})
