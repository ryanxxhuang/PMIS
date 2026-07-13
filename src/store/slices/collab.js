// Collab slice:監造協作——送審(Submittal)、工程疑義(RFI)、觀察事項、專案成員管理。
// 送審/RFI/觀察不依賴標單工項 → 寫入分流用 isPersistedProject 而非 dbMode:
// 否則真專案在匯入標單前的寫入只進記憶體,重新整理就消失(假成功)。
import { useState, useCallback } from 'react'
import { users } from '../../data/seed.js'
import { supabase } from '../../lib/supabase.js'
import { mutationOutcome } from './billing.js'
import { fileToBase64, extractContractText } from '../db.js'

// 各類送審的「通用審查要點」——demo 或尚未解析契約規範時的回退清單(標「通用」)。
const SUBMITTAL_REVIEW_POINTS = {
  材料設備: ['出廠證明 / 品質保證書齊備', 'CNS 或契約指定規範之試驗報告', '型錄規格與契約規範相符', '樣品經核可(如契約要求)', '進場數量與需求/估驗相符'],
  配比: ['配比設計經核可', '抗壓強度符合設計要求', '試拌 / 試驗報告檢附', '材料來源與送審一致'],
  樣品: ['樣品規格與契約規範相符', '色澤 / 尺寸 / 材質符合', '經機關 / 監造確認並留樣'],
  施工計畫: ['施工順序與工法合理可行', '職業安全衛生措施完備', '品管計畫與檢驗停留點明確', '機具與人力配置合理', '交通維持 / 環境保護措施'],
  品質計畫: ['三級品管組織架構', '自主檢查表齊備', '檢驗停留點(H/W/R)設定', '不合格品處理程序'],
  其他: ['文件完整性', '與契約規範相符', '權責簽章齊備'],
}
function demoSubmittalReview(submittal, workItem) {
  const pts = SUBMITTAL_REVIEW_POINTS[submittal.category] || SUBMITTAL_REVIEW_POINTS['其他']
  const checklist = pts.map((point) => ({ point, basis: '通用', status: '需監造核對文件' }))
  const opinion = `本件「${submittal.title}」(${submittal.category})經初步審視，請依審查要點逐項核對文件本體`
    + `${workItem?.desc ? `，並確認與工項「${workItem.desc}」之規範相符` : ''}。`
    + `文件齊備且符合契約規範者建議核備；如有缺漏請敘明後退回補正。`
  return { checklist, opinion, suggested_decision: '需補充後再核',
    caution: '此為通用審查要點；上傳並解析契約/規範後可比對本專案實際履約需求。' }
}

export function useCollabSlice({ isPersistedProject, demoMode, currentProject, currentUser, wiMaps, log, saveMarkup }, createDefect) {
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

  // AI 送審審查助手:依本專案已解析履約需求 + 送審類別/工項 → 審查要點清單 + 意見草稿 + 建議判定。
  // demo/無需求 → 確定性通用要點;真專案撈 requirements(有工項優先該工項連結)交 review-submittal edge fn。
  const reviewSubmittal = useCallback(async (submittal) => {
    const wi = submittal.work_item_id ? wiMaps.byId.get(submittal.work_item_id) : null
    const workItem = (submittal.work_item_desc || wi)
      ? { no: submittal.work_item_no || wi?.item_no || '', desc: submittal.work_item_desc || wi?.description || '', unit: wi?.unit || '' }
      : null
    if (demoMode || !isPersistedProject) return { error: null, result: demoSubmittalReview(submittal, workItem) }
    const pid = currentProject.project_id
    const { data: reqs } = await supabase.from('requirements')
      .select('id,title,requirement_type,acceptance_criteria,evidence_requirement,status')
      .eq('project_id', pid).in('status', ['approved', 'needs_review'])
      .in('requirement_type', ['submittal', 'test', 'evidence', 'checklist', 'inspection', 'report', 'other']).limit(60)
    let relevant = reqs || []
    if (submittal.work_item_id && relevant.length) {
      const { data: links } = await supabase.from('requirement_work_items').select('requirement_id').eq('work_item_id', submittal.work_item_id)
      const linkedIds = new Set((links || []).map((l) => l.requirement_id))
      const linked = relevant.filter((r) => linkedIds.has(r.id))
      relevant = (linked.length ? [...linked, ...relevant.filter((r) => !linkedIds.has(r.id))] : relevant).slice(0, 25)
    } else relevant = relevant.slice(0, 25)
    const payload = {
      submittal: { title: submittal.title, category: submittal.category, attachment_note: submittal.attachment_note, revision: submittal.revision },
      work_item: workItem,
      requirements: relevant.map((r) => ({
        title: r.title, type: r.requirement_type, acceptance_criteria: r.acceptance_criteria,
        evidence_requirement: r.evidence_requirement, authoritative: r.status === 'approved',
      })),
    }
    const { data, error } = await supabase.functions.invoke('review-submittal', { body: payload })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [demoMode, isPersistedProject, currentProject, wiMaps])

  // 送審主文件上傳:存 photos bucket(<pid>/submittals/<id>.<ext>,沿用其 project 資料夾 RLS)+ 寫 metadata。
  const uploadSubmittalFile = useCallback(async (submittalId, file) => {
    if (!isPersistedProject) return { error: { message: '需真專案才能上傳送審文件' } }
    const pid = currentProject.project_id
    const ext = (file.name?.split('.').pop() || 'bin').toLowerCase()
    const path = `${pid}/submittals/${submittalId}.${ext}`
    const { error: upErr } = await supabase.storage.from('photos').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: true })
    if (upErr) return { error: upErr }
    const patch = { attachment_path: path, attachment_name: file.name || `文件.${ext}`, attachment_mime: file.type || null }
    const res = await supabase.from('submittals').update(patch).eq('id', submittalId).select('id')
    const { error } = mutationOutcome(res, '文件已上傳但 metadata 未寫入:可能無權限')
    if (error) { await supabase.storage.from('photos').remove([path]); return { error } }
    setSubmittals((ss) => ss.map((s) => (s.id === submittalId ? { ...s, ...patch } : s)))
    log('送審文件上傳', patch.attachment_name, { user: currentUser?.name, role: '施工' })
    return { error: null }
  }, [isPersistedProject, currentProject, currentUser, log])

  // AI 審讀送審文件:下載附件 → 抽文字(數位 PDF/docx,比看圖準)或轉 base64(掃描/圖走視覺)
  // → 交 read-submittal edge fn 逐項比對契約需求。反幻覺全在 edge fn(未涵蓋不臆測符合)。
  const readSubmittalDoc = useCallback(async (submittal) => {
    if (!isPersistedProject) return { error: { message: '需真專案' } }
    if (!submittal.attachment_path) return { error: { message: '此送審尚未上傳文件' } }
    const { data: blob, error: dlErr } = await supabase.storage.from('photos').download(submittal.attachment_path)
    if (dlErr || !blob) return { error: dlErr || { message: '下載送審文件失敗' } }
    const file = new File([blob], submittal.attachment_name || 'doc', { type: submittal.attachment_mime || blob.type })
    let doc_text = ''
    try { doc_text = await extractContractText(file) } catch { doc_text = '' }
    const pid = currentProject.project_id
    const { data: reqs } = await supabase.from('requirements')
      .select('title,acceptance_criteria,evidence_requirement,status')
      .eq('project_id', pid).in('status', ['approved', 'needs_review']).limit(30)
    const body = {
      submittal: { title: submittal.title, category: submittal.category },
      requirements: (reqs || []).map((r) => ({ title: r.title, acceptance_criteria: r.acceptance_criteria, evidence_requirement: r.evidence_requirement })),
    }
    if (doc_text && doc_text.trim().length > 40) body.doc_text = doc_text.slice(0, 24000)
    else {
      try { body.file_base64 = await fileToBase64(file) } catch { return { error: { message: '讀取文件失敗' } } }
      body.mime_type = submittal.attachment_mime || 'application/pdf'
    }
    const { data, error } = await supabase.functions.invoke('read-submittal', { body })
    if (error || data?.error) return { error: { message: error?.message || data?.error || 'AI 審讀暫時無法使用' } }
    return { error: null, result: { ...data, mode: body.doc_text ? 'text' : 'vision' } }
  }, [isPersistedProject, currentProject])

  // AI RFI 回覆草稿:依本專案契約履約需求 + 疑義內容草擬監造回覆 + 工期/費用影響研判。
  // demo/未設 → 通用草稿(涉設計判斷一律建議轉設計釋疑,不臆造);真專案撈 requirements 交 draft-rfi-reply。
  const draftRfiReply = useCallback(async (rfi) => {
    if (demoMode || !isPersistedProject) {
      return { error: null, result: {
        answer: `關於「${rfi.title}」,經審視契約圖說與施工規範,請依原設計圖說及規範辦理;如現場實際情形與圖說確有出入或涉及設計變更,建議檢附現場照片與圖說對照,轉請設計單位釋疑後辦理,不宜逕予認定。`,
        basis: '通用', needs_designer: true,
        cost_impact: !!rfi.cost_impact, schedule_impact: !!rfi.schedule_impact,
        caution: '此為通用草稿;上傳並解析契約/規範後可比對本專案實際履約需求。',
      } }
    }
    const pid = currentProject.project_id
    const { data: reqs } = await supabase.from('requirements')
      .select('title,acceptance_criteria,evidence_requirement,status')
      .eq('project_id', pid).in('status', ['approved', 'needs_review']).limit(25)
    const payload = {
      rfi: { title: rfi.title, question: rfi.question, cost_impact: rfi.cost_impact, schedule_impact: rfi.schedule_impact },
      requirements: (reqs || []).map((r) => ({ title: r.title, acceptance_criteria: r.acceptance_criteria, evidence_requirement: r.evidence_requirement })),
    }
    const { data, error } = await supabase.functions.invoke('draft-rfi-reply', { body: payload })
    if (error || data?.error) return { error: { message: error?.message || data?.error || 'AI 回覆草稿暫時無法使用' } }
    return { error: null, result: data }
  }, [demoMode, isPersistedProject, currentProject])

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
    createSubmittal, decideSubmittal, resubmitSubmittal, deleteSubmittal, reviewSubmittal, uploadSubmittalFile, readSubmittalDoc,
    createRfi, answerRfi, closeRfi, deleteRfi, draftRfiReply,
    createObservation, updateObservation, escalateObservation, deleteObservation,
    listMembers, addMemberByEmail, removeMember,
  }
}
