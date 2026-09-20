// F2｜send-reminders 流程本體的單元測試(Deno 執行期:npm run test:edge)。
// 以假件注入全部外部效應(sendRemindersRun.ts 的 SendRemindersDeps),釘住:
//   角色分流、跨案隔離、閘門 fail-closed 與記帳、dry 不寄不記、只寄給有事的人、寄信 payload、
//   Resend 失敗不計入、email/org_type 跨案只查一次、collectItems 失敗只影響該案、listProjects 失敗回 500、
//   x-cron-secret 驗證。真實 deps(Supabase／Resend)不在這裡;真後端 e2e chain 22 以 dry=1 對隔離棧驗。
import assert from 'node:assert/strict'
import { authorizeCron, runSendReminders } from './sendRemindersRun.ts'
import type { ReminderMail, SendRemindersDeps, SendRemindersOptions } from './sendRemindersRun.ts'
import type { OpenBallItem } from './ballInCourt.ts'
import { parseDateUTC } from './contractDue.ts'
import { gateVerdict } from './gatePolicy.ts'
import { sendViaResend, RESEND_ENDPOINT } from './sendRemindersDeps.ts'

const TODAY = parseDateUTC('2026-09-20')!
const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'
const CON = 'u-con', SUP = 'u-sup', OWN = 'u-own', CON_B = 'u-con-b'

const item = (over: Partial<OpenBallItem>): OpenBallItem => ({
  side: 'contractor', kind: '契約重點', id: 'x', title: '未命名', status: '待辦', meta: '', due_date: null, ...over,
})
// A 案:廠商逾期 1、監造 7 日內 1、待補設定 1(三方都看)、廠商無期限 1(只搭便車);B 案:廠商逾期 1(別案)
const ITEMS: Record<string, OpenBallItem[]> = {
  [A]: [
    item({ side: 'contractor', id: 'ob-a1', title: '第 5 期估驗送審', due_date: '2026-09-17', overdue_days: 3 }),
    item({ side: 'supervisor', id: 'ob-a2', title: '審查施工計畫', due_date: '2026-09-22' }),
    item({ side: 'unassigned', id: 'ob-a3', title: '責任方待補的義務', setup: { kind: 'responsible', label: '責任方待補' } as OpenBallItem['setup'] }),
    item({ side: 'contractor', id: 'rfi-a4', kind: '疑義', title: '無期限的疑義', status: '待回覆' }),
  ],
  [B]: [item({ side: 'contractor', id: 'ob-b1', title: 'B 案的逾期義務', due_date: '2026-09-10', overdue_days: 10 })],
}

type Calls = { send: ReminderMail[]; usage: { projectId: string; status: string; errorCode?: string }[]; emailOf: string[]; orgTypesOf: string[][]; logs: string[] }

function fakeDeps(over: Partial<SendRemindersDeps> = {}, opts: { gate?: Record<string, { allowed: boolean | null; failed: boolean }>; sendOk?: boolean } = {}) {
  // 假件同樣經 gateVerdict 產生判定(真實 deps 在 RPC 旁判定;流程本體只消費結果)
  const calls: Calls = { send: [], usage: [], emailOf: [], orgTypesOf: [], logs: [] }
  const deps: SendRemindersDeps = {
    listProjects: async () => ({ projects: [{ id: A, name: 'A 案' }, { id: B, name: 'B 案' }] }),
    featureAllowed: async (pid) => { const g = opts.gate?.[pid] ?? { allowed: true, failed: false }; return gateVerdict('reminder.daily', g.allowed, g.failed) },
    collectItems: async (pid) => ({ items: ITEMS[pid] ?? [] }),
    listTestSamples: async () => [],
    listMemberIds: async (pid) => (pid === A ? [CON, SUP, OWN] : [CON, CON_B]), // 廠商 CON 同時是 A、B 兩案成員
    orgTypesOf: async (ids) => {
      calls.orgTypesOf.push(ids)
      return new Map(ids.map((id) => [id, id === SUP ? 'supervisor' : id === OWN ? 'owner' : 'contractor']))
    },
    pendingDraftCounts: async (pid) => new Map(pid === A ? [[CON, 2]] : []),
    emailOf: async (uid) => { calls.emailOf.push(uid); return `${uid}@example.test` },
    send: async (mail) => { calls.send.push(mail); return opts.sendOk === false ? { ok: false, status: 422, body: 'bad' } : { ok: true } },
    recordUsage: async (args) => { calls.usage.push(args) },
    log: (m) => { calls.logs.push(m) },
    ...over,
  }
  return { deps, calls }
}
const OPTS: SendRemindersOptions = { dry: false, todayUTC: TODAY, resendConfigured: true, from: 'GovAgent <x@example.test>', agentUrl: 'https://app.example/#/agent' }

function projectReport(res: Awaited<ReturnType<typeof runSendReminders>>, name: string) {
  assert.equal(res.status, 200)
  const p = (res.body as { projects: Record<string, unknown>[] }).projects.find((x) => x.project === name)
  assert.ok(p, `找不到 ${name} 的結果`)
  return p as { recipients?: { user_id: string; role: string; overdue: number; soon: number; pending: number; setup: number; drafts_pending: number; should_send: boolean; email: string | null; sections?: unknown }[]; emails_sent?: number; items_total?: number; skipped?: string; error?: string }
}

Deno.test('角色分流:廠商只收廠商的事、監造只收監造的事、待補設定三方都看;沒事的機關不寄', async () => {
  const { deps, calls } = fakeDeps()
  const res = await runSendReminders(deps, { ...OPTS, dry: true })
  const a = projectReport(res, 'A 案')
  const by = Object.fromEntries(a.recipients!.map((r) => [r.user_id, r]))
  assert.deepEqual([by[CON].role, by[CON].overdue, by[CON].soon, by[CON].pending, by[CON].setup, by[CON].drafts_pending, by[CON].should_send], ['contractor', 1, 0, 1, 1, 2, true])
  assert.deepEqual([by[SUP].role, by[SUP].overdue, by[SUP].soon, by[SUP].pending, by[SUP].setup, by[SUP].should_send], ['supervisor', 0, 1, 0, 1, true])
  assert.deepEqual([by[OWN].role, by[OWN].overdue, by[OWN].soon, by[OWN].pending, by[OWN].setup, by[OWN].should_send], ['owner', 0, 0, 0, 1, false])
  // 監造那筆不在廠商信裡;廠商那筆不在監造信裡(dry 回 sections 供核對)
  const conTitles = JSON.stringify(by[CON].sections)
  assert.ok(conTitles.includes('第 5 期估驗送審') && !conTitles.includes('審查施工計畫'))
  const supTitles = JSON.stringify(by[SUP].sections)
  assert.ok(supTitles.includes('審查施工計畫') && !supTitles.includes('第 5 期估驗送審'))
  assert.equal(by[OWN].sections, undefined, '不寄的人不附 sections')
  assert.equal(by[OWN].email, null, '不寄的人不查 email')
  assert.deepEqual(calls.emailOf.sort(), [CON, CON_B, SUP].sort(), '只有要寄的人才查 email(B 案的兩位廠商都有逾期,機關沒事)')
})

Deno.test('跨案隔離:同一位廠商在 A、B 兩案各收各的,A 案的信裡沒有 B 案的事;email/org_type 跨案只查一次', async () => {
  const { deps, calls } = fakeDeps()
  const res = await runSendReminders(deps, { ...OPTS, dry: true })
  const a = projectReport(res, 'A 案'), b = projectReport(res, 'B 案')
  const conA = a.recipients!.find((r) => r.user_id === CON)!, conB = b.recipients!.find((r) => r.user_id === CON)!
  assert.ok(!JSON.stringify(conA.sections).includes('B 案的逾期義務'))
  assert.ok(JSON.stringify(conB.sections).includes('B 案的逾期義務') && !JSON.stringify(conB.sections).includes('第 5 期估驗送審'))
  assert.equal(b.items_total, 1)
  assert.deepEqual(calls.emailOf.filter((u) => u === CON).length, 1, 'CON 的 email 兩案只查一次')
  assert.deepEqual(calls.orgTypesOf, [[CON, SUP, OWN], [CON_B]], 'org_type 只補查沒快取的人')
})

Deno.test('dry=1:不寄、不記帳;非 dry:只寄給 should_send 的人,payload 是角色化主旨與 HTML,寄出才記一筆 ok', async () => {
  const dryRun = fakeDeps()
  await runSendReminders(dryRun.deps, { ...OPTS, dry: true })
  assert.deepEqual(dryRun.calls.send, [])
  assert.deepEqual(dryRun.calls.usage, [])

  const live = fakeDeps()
  const res = await runSendReminders(live.deps, OPTS)
  const a = projectReport(res, 'A 案'), b = projectReport(res, 'B 案')
  assert.equal(a.emails_sent, 2)
  assert.equal(b.emails_sent, 2, 'B 案兩位廠商都有逾期')
  assert.equal(live.calls.send.length, 4, 'A 案廠商＋監造、B 案兩位廠商;A 案機關沒事不寄')
  const conMail = live.calls.send.find((m) => m.to === `${CON}@example.test`)!
  assert.equal(conMail.from, OPTS.from)
  assert.equal(conMail.subject, '【GovAgent】廠商 Agent · A 案:逾期 1 件、7 日內到期 0 件')
  assert.ok(conMail.html.includes('第 5 期估驗送審') && conMail.html.includes('已逾期 3 天') && conMail.html.includes('2 筆待覆核'))
  assert.ok(!conMail.html.includes('審查施工計畫'), '廠商的信裡沒有監造的事')
  const supMail = live.calls.send.find((m) => m.to === `${SUP}@example.test`)!
  assert.equal(supMail.subject, '【GovAgent】監造 Agent · A 案:逾期 0 件、7 日內到期 1 件')
  assert.ok(supMail.html.includes('審查施工計畫') && supMail.html.includes('還有 2 天'))
  assert.ok(supMail.html.includes('責任方待補的義務'), '待補設定搭便車出現在信裡')
  assert.deepEqual(live.calls.usage, [{ projectId: A, status: 'ok' }, { projectId: B, status: 'ok' }], '每案寄出 ≥1 封記一筆 ok')
  assert.equal(a.recipients!.find((r) => r.user_id === CON)!.sections, undefined, '非 dry 不回 sections')
})

Deno.test('沒有 RESEND_API_KEY:非 dry 也不寄、不記 ok;要寄的人仍查得到 email(回應可核對)', async () => {
  const { deps, calls } = fakeDeps()
  const res = await runSendReminders(deps, { ...OPTS, resendConfigured: false })
  assert.deepEqual(calls.send, [])
  assert.deepEqual(calls.usage, [])
  const a = projectReport(res, 'A 案')
  assert.equal(a.emails_sent, 0)
  assert.equal(a.recipients!.find((r) => r.user_id === CON)!.email, `${CON}@example.test`)
})

Deno.test('Resend 失敗:記 log、不計入 emails_sent、不記 ok', async () => {
  const { deps, calls } = fakeDeps({}, { sendOk: false })
  const res = await runSendReminders(deps, OPTS)
  assert.equal(projectReport(res, 'A 案').emails_sent, 0)
  assert.equal(calls.send.length, 4, '仍嘗試寄')
  assert.ok(calls.logs.some((l) => l.includes('Resend failed for project')))
  assert.deepEqual(calls.usage, [], '沒寄出就不記 ok')
})

Deno.test('閘門:明確 false 跳過並記 blocked(feature_disabled);查詢失敗 fail-closed 跳過並記 blocked(gate_unavailable);dry 不記', async () => {
  const gate = { [A]: { allowed: false, failed: false }, [B]: { allowed: null, failed: true } }
  const live = fakeDeps({}, { gate })
  const res = await runSendReminders(live.deps, OPTS)
  assert.equal(projectReport(res, 'A 案').skipped, 'reminder.daily 未啟用')
  assert.equal(projectReport(res, 'B 案').skipped, 'reminder.daily 開關暫時無法確認(fail-closed 跳過)')
  assert.deepEqual(live.calls.send, [], '被擋的案一封都不寄')
  assert.deepEqual(live.calls.usage, [
    { projectId: A, status: 'blocked', errorCode: 'feature_disabled' },
    { projectId: B, status: 'blocked', errorCode: 'gate_unavailable' },
  ])
  assert.ok(live.calls.logs.some((l) => l.includes('fail-closed')))
  const dry = fakeDeps({}, { gate })
  await runSendReminders(dry.deps, { ...OPTS, dry: true })
  assert.deepEqual(dry.calls.usage, [], 'dry 一律不記帳')
  // RPC 成功卻回 null:與 D-010 同一條,往擋的方向倒
  const nullGate = fakeDeps({}, { gate: { [A]: { allowed: null, failed: false }, [B]: { allowed: true, failed: false } } })
  const res2 = await runSendReminders(nullGate.deps, { ...OPTS, dry: true })
  assert.equal(projectReport(res2, 'A 案').skipped, 'reminder.daily 開關暫時無法確認(fail-closed 跳過)')
  assert.equal(projectReport(res2, 'B 案').items_total, 1, '沒被擋的案照跑')
})

Deno.test('收集失敗只影響該案:回 {project, error},其他案照跑;listProjects 失敗回 500 與遮罩後代碼', async () => {
  const { deps } = fakeDeps({ collectItems: async (pid) => (pid === A ? { error: '讀取失敗' } : { items: ITEMS[B] }) })
  const res = await runSendReminders(deps, { ...OPTS, dry: true })
  assert.equal(projectReport(res, 'A 案').error, '讀取失敗')
  assert.equal(projectReport(res, 'B 案').items_total, 1)
  const broken = fakeDeps({ listProjects: async () => ({ error: { message: '資料存取失敗，請稍後再試', code: 'db_error' } }) })
  const res2 = await runSendReminders(broken.deps, OPTS)
  assert.deepEqual(res2, { status: 500, body: { error: '資料存取失敗，請稍後再試', code: 'db_error' } })
  assert.deepEqual(broken.calls.send, [])
})

Deno.test('試體齡期:7 日內到期且未填的試驗進廠商的 7 日內;已填或已判定的不列', async () => {
  const { deps } = fakeDeps({
    collectItems: async () => ({ items: [] }),
    listTestSamples: async (pid) => (pid === A ? [
      { id: 's1', sample_no: 'S-1', test_item: '混凝土抗壓', status: '待試驗', d7_due: '2026-09-23', d28_due: '2026-10-14', d7_value: null, d28_values: [] },
      { id: 's2', sample_no: 'S-2', test_item: '混凝土抗壓', status: '待試驗', d7_due: '2026-09-23', d28_due: null, d7_value: 30, d28_values: [] },
      { id: 's3', sample_no: 'S-3', test_item: '混凝土抗壓', status: '合格', d7_due: '2026-09-21', d28_due: null, d7_value: null, d28_values: [] },
    ] : []),
  })
  const res = await runSendReminders(deps, { ...OPTS, dry: true })
  const a = projectReport(res, 'A 案')
  const con = a.recipients!.find((r) => r.user_id === CON)!
  assert.deepEqual([con.soon, con.should_send], [1, true])
  assert.ok(JSON.stringify(con.sections).includes('S-1 混凝土抗壓 7天試驗'))
  assert.equal(a.recipients!.find((r) => r.user_id === SUP)!.soon, 0, '試驗是廠商責任,監造不收')
})

Deno.test('authorizeCron:沒設 CRON_SECRET 一律拒絕;標頭不符拒絕;相符放行', () => {
  const req = (h?: string) => new Request('https://x/functions/v1/send-reminders', { method: 'POST', headers: h ? { 'x-cron-secret': h } : {} })
  assert.equal(authorizeCron(req('s'), undefined), false)
  assert.equal(authorizeCron(req('s'), ''), false)
  assert.equal(authorizeCron(req(), 's'), false)
  assert.equal(authorizeCron(req('wrong'), 's'), false)
  assert.equal(authorizeCron(req('s'), 's'), true)
})

Deno.test('sendViaResend:POST 到 Resend、Bearer 金鑰、to 為陣列;非 2xx 回狀態與內文', async () => {
  const seen: { url: string; init: RequestInit }[] = []
  const okFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init! })
    return new Response('{"id":"1"}', { status: 200 })
  }) as typeof fetch
  const mail: ReminderMail = { from: 'F <f@example.test>', to: 't@example.test', subject: 'S', html: '<b>H</b>' }
  assert.deepEqual(await sendViaResend('re_key', mail, okFetch), { ok: true })
  assert.equal(seen[0].url, RESEND_ENDPOINT)
  assert.equal(seen[0].init.method, 'POST')
  assert.equal((seen[0].init.headers as Record<string, string>).Authorization, 'Bearer re_key')
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { from: mail.from, to: [mail.to], subject: 'S', html: '<b>H</b>' })
  const badFetch = (async () => new Response('invalid', { status: 422 })) as typeof fetch
  assert.deepEqual(await sendViaResend('re_key', mail, badFetch), { ok: false, status: 422, body: 'invalid' })
})
