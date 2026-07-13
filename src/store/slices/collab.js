// Collab slice:監造協作——送審(Submittal)、工程疑義(RFI)、觀察事項、專案成員管理。
// 送審/RFI/觀察不依賴標單工項 → 寫入分流用 isPersistedProject 而非 dbMode:
// 否則真專案在匯入標單前的寫入只進記憶體,重新整理就消失(假成功)。
import { useState, useCallback } from 'react'
import { users } from '../../data/seed.js'
import { supabase } from '../../lib/supabase.js'
import { mutationOutcome } from './billing.js'

export function useCollabSlice({ isPersistedProject, currentProject, currentUser, wiMaps, log, saveMarkup }, createDefect) {
  // 監造協作:送審與工程疑義
  const [submittals, setSubmittals] = useState([])
  const [rfis, setRfis] = useState([])
  const [observations, setObservations] = useState([]) // 觀察事項(輕量提醒)

  const createSubmittal = useCallback(async (input) => {
    const row = {
      submittal_no: input.submittal_no || `SUB-${String(submittals.length + 1).padStart(3, '0')}`,
      title: input.title, category: input.category || '施工計畫',
      revision: 0, status: '已提送',
      submitted_date: input.submitted_date || null, due_date: input.due_date || null,
      decided_date: null, review_note: null, attachment_note: input.attachment_note || null,
    }
    if (!isPersistedProject) {
      setSubmittals((ss) => [{ ...row, id: `SUB-${Date.now()}` }, ...ss])
      return { error: null }
    }
    const { data, error } = await supabase.from('submittals')
      .insert({ ...row, project_id: currentProject.project_id, created_by: currentUser?.user_id }).select().single()
    if (error) return { error }
    setSubmittals((ss) => [data, ...ss])
    log('提送送審', `${row.submittal_no} ${row.title}`, { user: currentUser?.name, role: '施工' })
    return { error: null }
  }, [isPersistedProject, currentProject, currentUser, submittals, log])

  // 監造審定:審核中|核准|核備|退回補正|駁回。DB 成功才更新 UI(失敗=UI 不變)。
  const decideSubmittal = useCallback(async (id, status, review_note) => {
    const patch = { status, review_note: review_note || null }
    if (status !== '審核中') patch.decided_date = new Date().toISOString().slice(0, 10)
    if (isPersistedProject) {
      const res = await supabase.from('submittals').update(patch).eq('id', id).select('id')
      const { error } = mutationOutcome(res, '審定未寫入:可能無權限或這筆送審已被移除')
      if (error) return { error }
      log('送審審定', `${status}`, { user: currentUser?.name, role: '監造' })
    }
    setSubmittals((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    return { error: null }
  }, [isPersistedProject, currentUser, log])

  // 施工修正再送:退回補正 → 已提送(revision +1)
  // 修正再送:退回補正 → 已提送(版次+1)。DB 成功才更新 UI(P0-01:原本樂觀
  // 更新不回滾,guard 拒絕時畫面假成功、監造看不到,流程死路)。
  // 補正說明為必要證據,附記於附件說明(P1-08:一鍵再送缺實質補正紀錄)。
  const resubmitSubmittal = useCallback(async (id, correctionNote) => {
    const cur = submittals.find((s) => s.id === id)
    if (!cur) return { error: { message: '找不到這筆送審' } }
    const rev = (cur.revision || 0) + 1
    const note = correctionNote?.trim()
      ? `${cur.attachment_note ? `${cur.attachment_note}\n` : ''}補正(Rev.${rev}):${correctionNote.trim()}`
      : cur.attachment_note
    const patch = { status: '已提送', revision: rev, decided_date: null,
      submitted_date: new Date().toISOString().slice(0, 10), attachment_note: note || null }
    if (isPersistedProject) {
      const res = await supabase.from('submittals').update(patch).eq('id', id).select('id')
      const { error } = mutationOutcome(res, '再送未寫入:可能無權限或這筆送審已被移除')
      if (error) return { error }
      log('送審修正再送', `${cur.submittal_no} Rev.${rev}`, { user: currentUser?.name, role: '施工' })
    }
    setSubmittals((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    return { error: null }
  }, [isPersistedProject, submittals, currentUser, log])

  // DB 成功才移除(R3 P0-01:stale 分頁刪除已受理送審曾假成功;DB 另有 delete guard)
  const deleteSubmittal = useCallback(async (id) => {
    if (isPersistedProject) {
      const res = await supabase.from('submittals').delete().eq('id', id).select('id')
      const { error } = mutationOutcome(res, '刪除被拒絕:送審已進入審查或無權限')
      if (error) return { error }
    }
    setSubmittals((ss) => ss.filter((s) => s.id !== id))
    return { error: null }
  }, [isPersistedProject])

  const createRfi = useCallback(async (input) => {
    const markup_path = await saveMarkup(input.markup_data, 'rfi')
    const row = {
      markup_path,
      rfi_no: input.rfi_no || `RFI-${String(rfis.length + 1).padStart(3, '0')}`,
      title: input.title, question: input.question || null,
      answer: null, status: '待回覆',
      asked_date: input.asked_date || new Date().toISOString().slice(0, 10),
      due_date: input.due_date || null, answered_date: null,
      cost_impact: !!input.cost_impact, schedule_impact: !!input.schedule_impact,
    }
    if (!isPersistedProject) {
      setRfis((rs) => [{ ...row, id: `RFI-${Date.now()}` }, ...rs])
      return { error: null }
    }
    const { data, error } = await supabase.from('rfis')
      .insert({ ...row, project_id: currentProject.project_id, created_by: currentUser?.user_id }).select().single()
    if (error) return { error }
    setRfis((rs) => [data, ...rs])
    log('提出工程疑義', `${row.rfi_no} ${row.title}`, { user: currentUser?.name, role: '施工' })
    return { error: null }
  }, [isPersistedProject, currentProject, currentUser, rfis, saveMarkup, log])

  // 回覆/結案:DB 成功才更新 UI(失敗=UI 不變)。
  const answerRfi = useCallback(async (id, answer) => {
    const patch = { answer, status: '已回覆', answered_date: new Date().toISOString().slice(0, 10) }
    if (isPersistedProject) {
      const res = await supabase.from('rfis').update(patch).eq('id', id).select('id')
      const { error } = mutationOutcome(res, '回覆未寫入:可能無權限或這筆疑義已被移除')
      if (error) return { error }
      log('回覆工程疑義', answer.slice(0, 30), { user: currentUser?.name, role: '監造' })
    }
    setRfis((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    return { error: null }
  }, [isPersistedProject, currentUser, log])

  const closeRfi = useCallback(async (id) => {
    if (isPersistedProject) {
      const res = await supabase.from('rfis').update({ status: '已結案' }).eq('id', id).select('id')
      const { error } = mutationOutcome(res, '結案未寫入:可能無權限或這筆疑義已被移除')
      if (error) return { error }
    }
    setRfis((rs) => rs.map((r) => (r.id === id ? { ...r, status: '已結案' } : r)))
    return { error: null }
  }, [isPersistedProject])

  // DB 成功才移除(已回覆的 RFI 是履約證據,DB delete guard 會擋)
  const deleteRfi = useCallback(async (id) => {
    if (isPersistedProject) {
      const res = await supabase.from('rfis').delete().eq('id', id).select('id')
      const { error } = mutationOutcome(res, '刪除被拒絕:疑義已有回覆或無權限')
      if (error) return { error }
    }
    setRfis((rs) => rs.filter((r) => r.id !== id))
    return { error: null }
  }, [isPersistedProject])

  // ── 觀察事項:輕量提醒,可升級成正式缺失 ──────────────────────────────────
  const createObservation = useCallback(async (input) => {
    const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
    const markup_path = await saveMarkup(input.markup_data, 'obs')
    const row = {
      title: input.title, description: input.description || null, location: input.location || null,
      assigned_to: input.assigned_to || 'contractor', status: '待處理', markup_path,
    }
    if (!isPersistedProject) {
      setObservations((os) => [{ ...row, id: `OBS-${Date.now()}`, work_item_no: wi?.item_no || '' }, ...os])
      return { error: null }
    }
    const { data, error } = await supabase.from('observations')
      .insert({ ...row, project_id: currentProject.project_id, work_item_id: wi?.id || null, created_by: currentUser?.user_id })
      .select().single()
    if (error) return { error }
    setObservations((os) => [data, ...os])
    log('新增觀察事項', input.title, { user: currentUser?.name, role: '監造' })
    return { error: null }
  }, [isPersistedProject, currentProject, currentUser, wiMaps, saveMarkup, log])

  const updateObservation = useCallback(async (id, patch) => {
    setObservations((os) => os.map((o) => (o.id === id ? { ...o, ...patch } : o)))
    if (isPersistedProject) await supabase.from('observations').update(patch).eq('id', id)
    return { error: null }
  }, [isPersistedProject])

  // 升級為缺失:建立缺失(帶入標註)並把觀察標為「轉缺失」
  const escalateObservation = useCallback(async (obs) => {
    await createDefect({
      title: obs.title, description: obs.description || null, location: obs.location || '',
      severity: '一般', markup_data: obs.markup_path && obs.markup_path.startsWith('data:') ? obs.markup_path : undefined,
    })
    await updateObservation(obs.id, { status: '轉缺失' })
    return { error: null }
  }, [createDefect, updateObservation])

  const deleteObservation = useCallback(async (id) => {
    setObservations((os) => os.filter((o) => o.id !== id))
    if (isPersistedProject) await supabase.from('observations').delete().eq('id', id)
  }, [isPersistedProject])

  // 成員管理(RPC:email 對照 auth.users 必須在伺服器端做)。
  // 用 isPersistedProject 而非 dbMode:真專案「標單匯入前」也要能管成員/開正式模式,
  // 否則會靜默回落 demo 名單(即 QA 報告「另一測試專案的錯誤名單」)。
  const listMembers = useCallback(async () => {
    if (!isPersistedProject) {
      return users.map((u) => ({ user_id: u.user_id, full_name: u.name, company: u.company, org_type: u.org_type, member_role: u.user_id === 'U1' ? 'admin' : 'member' }))
    }
    const { data } = await supabase.rpc('list_project_members', { p_project: currentProject.project_id })
    return data || []
  }, [isPersistedProject, currentProject])

  const addMemberByEmail = useCallback(async (email, role = 'member') => {
    if (!isPersistedProject) return { error: { message: 'demo 模式不支援邀請成員' } }
    const { data, error } = await supabase.rpc('add_member_by_email', {
      p_project: currentProject.project_id, p_email: email, p_role: role,
    })
    if (error) return { error }
    if (data === 'not_found') return { error: { message: '找不到這個 email 的帳號，請對方先註冊。' } }
    log('加入成員', email, { user: currentUser?.name, role: '專案' })
    return { error: null }
  }, [isPersistedProject, currentProject, currentUser, log])

  const removeMember = useCallback(async (userId) => {
    if (!isPersistedProject) return { error: { message: 'demo 模式不支援移除成員' } }
    const { error } = await supabase.rpc('remove_member', { p_project: currentProject.project_id, p_user: userId })
    return { error }
  }, [isPersistedProject, currentProject])

  return {
    submittals, setSubmittals, rfis, setRfis, observations, setObservations,
    createSubmittal, decideSubmittal, resubmitSubmittal, deleteSubmittal,
    createRfi, answerRfi, closeRfi, deleteRfi,
    createObservation, updateObservation, escalateObservation, deleteObservation,
    listMembers, addMemberByEmail, removeMember,
  }
}
