// W6 真後端 E2E 共用工具:用 service role 建立/清理臨時帳號與其專案。
// 只在隔離 staging 執行(config 已擋正式 Supabase);測後一律清乾淨,不留常駐資料。
import { createClient } from '@supabase/supabase-js'

const url = process.env.E2E_REAL_SUPABASE_URL?.trim().replace(/\/$/, '')
const serviceKey = process.env.E2E_REAL_SERVICE_ROLE_KEY?.trim()

// service role 只在測試機用來建 fixture 帳號與清理——缺就讓需要它的 spec 明確失敗
export function admin() {
  if (!serviceKey) throw new Error('W6 真後端 E2E 需要 E2E_REAL_SERVICE_ROLE_KEY(建立/清理臨時帳號)')
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

const PW = 'W6real123' // 符合登入規則:至少 8 碼、含大小寫與數字
export const password = PW

// 每次跑用唯一 email,避免殘留帳號造成重複(email 是 auth.users 唯一鍵)
export function uniqueEmail(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}@e2e.test`
}

// 直接建好一個 email 已確認的帳號(admin API);org_type 走 handle_new_user
// 從 user_metadata 建 profiles——供「被邀請方」等不需走註冊 UI 的 fixture。
export async function createConfirmedUser(email, orgType, fullName = '測試帳號') {
  const { data, error } = await admin().auth.admin.createUser({
    email, password: PW, email_confirm: true,
    user_metadata: { full_name: fullName, org_type: orgType },
  })
  if (error) throw new Error(`建立 fixture 帳號失敗(${email}):${error.message}`)
  return data.user.id
}

// Storage 物件不隨 DB cascade 刪除——刪專案前先清該案在兩個 bucket 的物件。
// 走 storage API+service key(storage-api 的合法管理路徑,無資料表 GRANT 問題)。
// 路徑慣例不同:contract-documents 在 projects/<id>/ 之下,photos 直接以 <id>/ 開頭。
const BUCKET_PREFIX = {
  'contract-documents': (projectId) => `projects/${projectId}`,
  photos: (projectId) => projectId,
}
const BUCKETS = Object.keys(BUCKET_PREFIX)
async function listAllObjectPaths(storage, bucket, prefix) {
  const entries = []
  const limit = 100
  for (let offset = 0;; offset += limit) {
    const { data, error } = await storage.from(bucket).list(prefix, { limit, offset })
    if (error) throw new Error(`列出 storage 失敗(${bucket}/${prefix}):${error.message}`)
    entries.push(...(data || []))
    if (!data || data.length < limit) break
  }
  const paths = []
  for (const entry of entries) {
    const full = `${prefix}/${entry.name}`
    if (entry.id === null) paths.push(...await listAllObjectPaths(storage, bucket, full)) // 資料夾 → 遞迴
    else paths.push(full)
  }
  return paths
}
export async function removeProjectStorage(projectId) {
  const storage = admin().storage
  for (const bucket of BUCKETS) {
    const paths = await listAllObjectPaths(storage, bucket, BUCKET_PREFIX[bucket](projectId))
    if (!paths.length) continue
    const { error } = await storage.from(bucket).remove(paths)
    if (error) throw new Error(`清理 storage 失敗(${bucket}):${error.message}`)
  }
}

// 清理專案:以「建立者本人」登入走產品的 delete_project RPC(真路徑,cascade
// 清全部業務資料)。不用 service role 直刪資料表——新版 CLI 的本機 stack 對
// service_role 沒有資料表 GRANT(secure-by-default),直刪會 permission denied。
export async function deleteOwnedProjects(email) {
  const anon = createClient(url, process.env.E2E_REAL_SUPABASE_ANON_KEY?.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password: PW })
  if (signInError) throw new Error(`清理登入失敗(${email}):${signInError.message}`)
  if (!signIn.user?.id) throw new Error(`清理登入失敗(${email}):找不到使用者 ID`)
  const { data: projects, error: listError } = await anon.from('projects')
    .select('id')
    .eq('created_by', signIn.user.id)
  if (listError) throw new Error(`清理列專案失敗(${email}):${listError.message}`)
  for (const p of projects || []) {
    await removeProjectStorage(p.id) // 先清 bucket 物件(DB cascade 不會清)
    const { error } = await anon.rpc('delete_project', { p_id: p.id })
    if (error) throw new Error(`清理刪專案失敗(${p.id}):${error.message}`)
  }
  await anon.auth.signOut()
}

// 清理帳號(admin API)。錯誤不吞:staging 殘留必須大聲失敗,不能靜默留資料。
// 呼叫前先確保其建立的專案已刪(projects.created_by FK 會擋 deleteUser)。
export async function cleanupUser(userId) {
  if (!userId) return
  const { error } = await admin().auth.admin.deleteUser(userId)
  if (error) throw new Error(`清理帳號失敗(${userId}):${error.message || JSON.stringify(error)}`)
}

// email → user id(admin listUsers;staging 帳號數量小,單頁即可)
export async function findUserIdByEmail(email) {
  const { data, error } = await admin().auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error) throw new Error(`listUsers 失敗:${error.message}`)
  return data?.users?.find((u) => u.email === email)?.id || null
}

// afterAll 清理鏈(PR #7 審查):逐步執行、收集錯誤最後一起 throw——
// 不能讓「專案清理失敗」跳過其後的帳號清理,否則失敗的跑次會留下
// 已確認+固定密碼的殘留帳號,違反「殘留 0」承諾。
export async function runCleanup(...steps) {
  const errors = []
  for (const step of steps) {
    try { await step() } catch (e) { errors.push(e) }
  }
  if (errors.length) throw new Error(`清理未完全:${errors.map((e) => e?.message || e).join(' | ')}`)
}

// hash router 導頁
export async function gotoHash(page, hash) {
  await page.goto(`/#${hash}`)
}

// 以某帳號簽入的 anon client(走 RLS 的真使用者身分)——fixture 佈置用產品窄門
// (create_project/import_work_items/add_member_by_email 等 RPC),不繞過權限。
export async function signInClient(email) {
  const anon = createClient(url, process.env.E2E_REAL_SUPABASE_ANON_KEY?.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await anon.auth.signInWithPassword({ email, password: PW })
  if (error) throw new Error(`fixture 登入失敗(${email}):${error.message}`)
  return anon
}

// UI 登入(既有帳號)
export async function loginReal(page, email) {
  await gotoHash(page, '/login')
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('密碼（至少 8 碼，含大小寫英文與數字）').fill(PW)
  await page.locator('button[type="submit"]').click()
  await page.getByRole('button', { name: '登出', exact: true }).waitFor()
}

// UI 登出(回登入頁)
export async function logoutReal(page) {
  await page.getByRole('button', { name: '登出', exact: true }).click()
  await page.locator('button[type="submit"]').waitFor()
}

// 註冊表單的角色選擇=三張 radio 卡(W12 之前是一顆 1×1px 的隱形 select,
// 測試點得到、真人點不到)。統一從這裡點,測的就是使用者真的會走的那條路。
const ORG_CARD_LABEL = { contractor: '施工廠商', supervisor: '監造單位', owner: '機關／業主' }
export async function pickOrgCard(page, orgType) {
  await page.getByRole('radio', { name: ORG_CARD_LABEL[orgType], exact: true }).click()
}

// 走註冊 UI 建立並登入一個新帳號,回傳其 email(建立者一律走真流程,不抄捷徑)
export async function registerViaUI(page, { email, orgType, name = '建立者', company = '測試單位' }) {
  await gotoHash(page, '/login')
  await page.getByRole('button', { name: '建立帳戶', exact: true }).click()
  await page.getByPlaceholder('姓名').fill(name)
  await page.getByPlaceholder('公司 / 單位').fill(company)
  await pickOrgCard(page, orgType)
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('密碼（至少 8 碼，含大小寫英文與數字）').fill(PW)
  await page.getByRole('button', { name: '下一步：驗證信箱' }).click()
}

// ── 兩步驟驗證(P2c 簽署要 aal2)──────────────────────────────────────────────
// 本機 GoTrue 的 TOTP:以使用者身分 enroll(拿 secret)→ 用 Node 算 6 位數 challengeAndVerify → 因子 verified。
// 之後 UI 登入會停在「輸入驗證碼」,loginRealWithTotp 用同一把 secret 算碼進入 aal2。
// 純標準 TOTP(RFC 6238,SHA-1、30 秒、6 位):只用 node:crypto,不引入第三方套件。
import { createHmac } from 'node:crypto'
function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of String(str).replace(/=+$/, '').toUpperCase()) {
    const v = alphabet.indexOf(c)
    if (v < 0) continue
    bits += v.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}
export function totpCode(secret, time = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(time / 1000 / step)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest()
  const off = h[h.length - 1] & 0xf
  const code = (((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff)) % 10 ** digits
  return String(code).padStart(digits, '0')
}
export async function enrollTotp(email) {
  const c = await signInClient(email)
  const { data, error } = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'e2e' })
  if (error) throw new Error(`TOTP enroll 失敗(${email}):${error.message}(本機 supabase/config.toml 需 [auth.mfa.totp] enroll_enabled=true 並重啟 stack)`)
  const secret = data.totp?.secret
  if (!secret) throw new Error('TOTP enroll 沒有回 secret')
  const { error: e2 } = await c.auth.mfa.challengeAndVerify({ factorId: data.id, code: totpCode(secret) })
  if (e2) throw new Error(`TOTP verify 失敗(${email}):${e2.message}`)
  await c.auth.signOut()
  return secret
}
// UI 登入(帳號已啟用 TOTP):帳密 → 驗證碼畫面 → 6 位數 → 進工作區(aal2)
export async function loginRealWithTotp(page, email, secret) {
  await gotoHash(page, '/login')
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('密碼（至少 8 碼，含大小寫英文與數字）').fill(PW)
  await page.locator('button[type="submit"]').click()
  const codeBox = page.getByPlaceholder('6 位數驗證碼')
  await codeBox.waitFor()
  await codeBox.fill(totpCode(secret))
  await page.getByRole('button', { name: '驗證並登入', exact: true }).click()
  // 落地=收件匣;不等「登出」鈕——手機(<md)的登出在抽屜裡,頂欄沒有
  await page.waitForURL(/#\/(dashboard|portfolio)/)
  await page.getByRole('heading', { level: 1 }).first().waitFor()
}

// 最小可解碼的 JPEG(1×1,134 bytes)——照片上傳的 fixture。seed 追加在 EOI 之後:內容雜湊不同、仍可解碼,
// 用來模擬「不同照片」與「同一張重傳」。
const TINY_JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
export function tinyJpeg(seed = '') {
  return Buffer.concat([Buffer.from(TINY_JPEG_B64, 'base64'), Buffer.from(String(seed), 'utf8')])
}
