// 拒絕 AI 草稿要不要一併捨棄那份現場文書(P3g;補 P6b-2 留下的缺口)。
// 條件與伺服器 discard_field_document 完全同一組(canDiscardFieldDocument):責任方、從未簽署、未提送。
import { describe, it, expect } from 'vitest'
import { planDraftRejection, isDraftedDocumentAction, DOC_DRAFT_KINDS } from './agent.js'

const action = (over = {}) => ({
  id: 'AGA-1', kind: 'draft_daily_log', target_table: 'field_documents', target_id: 'D1', ...over,
})
const doc = (over = {}) => ({
  id: 'D1', doc_type: 'daily_log', doc_date: '2026-09-18', owner_org: 'contractor', status: 'pending_input',
  current_version_no: 1, ...over,
})

describe('哪些草稿的拒絕會連動捨棄', () => {
  it('三種起稿 kind 都算(對話起稿兩種＋照片起稿)', () => {
    expect(DOC_DRAFT_KINDS).toEqual(['draft_daily_log', 'draft_inspection', 'draft_field_document'])
    for (const kind of DOC_DRAFT_KINDS) expect(isDraftedDocumentAction(action({ kind }))).toBe(true)
  })
  it('建議類(suggest_field_update)不算:那是對人在編的文件提建議,拒絕不該動文件', () => {
    expect(isDraftedDocumentAction(action({ kind: 'suggest_field_update' }))).toBe(false)
    expect(planDraftRejection(action({ kind: 'suggest_field_update' }), { doc: doc(), viewerOrg: 'contractor' }))
      .toMatchObject({ mode: 'reject', note: null })
  })
  it('沒有指向文件的草稿(稽核提示、審查意見)照舊只標拒絕', () => {
    expect(planDraftRejection(action({ kind: 'audit_note', target_table: 'audit_events' }), { viewerOrg: 'contractor' }))
      .toMatchObject({ mode: 'reject', note: null })
  })
})

describe('起稿類草稿:捨棄或保留', () => {
  it('未簽署的草稿(draft／pending_input／in_review)且是自己單位的 → 捨棄', () => {
    for (const status of ['draft', 'pending_input', 'in_review']) {
      expect(planDraftRejection(action(), { doc: doc({ status }), viewerOrg: 'contractor' }))
        .toMatchObject({ mode: 'discard' })
    }
  })
  it('已簽署／已提送／已收件／已退回 → 不動文件,並說明為什麼', () => {
    for (const status of ['signed', 'submitted', 'received', 'returned']) {
      const plan = planDraftRejection(action(), { doc: doc({ status }), viewerOrg: 'contractor' })
      expect(plan.mode).toBe('reject')
      expect(plan.note).toContain('已經簽署或提送')
      expect(plan.note).toContain('文件保留')
    }
  })
  it('簽後更正回到草稿狀態的文件曾經簽署 → 一樣不動(與伺服器 PD008 同一條)', () => {
    const plan = planDraftRejection(action(), { doc: doc({ status: 'draft' }), everSigned: true, viewerOrg: 'contractor' })
    expect(plan.mode).toBe('reject')
    expect(plan.note).toContain('已經簽署或提送')
  })
  it('不是自己單位的文件 → 不動(伺服器也會回 PD006)', () => {
    const plan = planDraftRejection(action({ kind: 'draft_inspection' }), { doc: doc({ owner_org: 'supervisor' }), viewerOrg: 'contractor' })
    expect(plan.mode).toBe('reject')
    expect(plan.note).toContain('不屬於你所在的單位')
  })
  it('文件已不在清單中(已捨棄／已取代／看不到) → 只標拒絕並說明', () => {
    const plan = planDraftRejection(action(), { doc: null, viewerOrg: 'contractor' })
    expect(plan.mode).toBe('reject')
    expect(plan.note).toContain('已不在清單中')
  })
})
