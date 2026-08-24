// 看上傳的檔案(真 Supabase):文件清單的檔名可點開原始檔、下載還原原始檔名。
// 走真路徑:上傳 txt(Storage+documents)→ 文件清單出現終態列 →
//   1. 點檔名 → 開新分頁,網址是 contract-documents 的一次性簽名 URL,內容可讀
//   2. 點「下載」→ Content-Disposition 還原 original_filename(storage key 已退化
//      成 ASCII,沒這層的話政府文件的中文檔名會存成底線醜檔名)
// 不需要 Edge runtime:AI 分析失敗只影響抽取,不影響「檔案已落地可開」——
// partial/failed(已上傳)列本來就必須能開檔,這正是要驗的韌性。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects,
  signInClient, loginReal, gotoHash, runCleanup,
} from './helpers.js'

const PROJECT_NAME = `檔案檢視工程-${Date.now().toString(36)}`
const FILE_NAME = '契約書.txt'
const CONTRACT_TEXT = [
  '本契約甲方為機關、乙方為廠商。',
  '第三條 工程期限：乙方應於2026年10月31日前完成全部工程。',
].join('\n')

const conEmail = uniqueEmail('fv-con')
let conId

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '檔案檢視廠商')
  const c = await signInClient(conEmail)
  const { error } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商',
    p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (error) throw new Error(`建案失敗:${error.message}`)
  await c.auth.signOut()
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(conId),
  )
})

test('檔名開啟簽名 URL 預覽,下載還原中文原始檔名', async ({ page }) => {
  test.setTimeout(90_000)
  await loginReal(page, conEmail)
  await gotoHash(page, '/contract')
  await page.locator('input[type="file"]').setInputFiles({
    name: FILE_NAME, mimeType: 'text/plain',
    buffer: Buffer.from(CONTRACT_TEXT, 'utf-8'),
  })

  // 等 run 走到終態:文件清單列的「下載」只在非處理中出現(AI 分析失敗也算終態)
  const downloadBtn = page.getByRole('button', { name: '下載' })
  await expect(downloadBtn).toBeVisible({ timeout: 60_000 })

  // ── 1. 檔名可點:text/plain 走預覽分支,新分頁網址是私有 bucket 簽名 URL ──
  const nameBtn = page.getByRole('button', { name: FILE_NAME })
  await expect(nameBtn).toBeVisible()
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    nameBtn.click(),
  ])
  await popup.waitForURL(/\/object\/sign\/contract-documents\//, { timeout: 15_000 })
  // 內容斷言走 request(位元組層),不受瀏覽器 text/plain 無 charset 的解碼影響
  const res = await page.request.get(popup.url())
  expect(res.status()).toBe(200)
  expect((await res.body()).toString('utf-8')).toContain('本契約甲方為機關')
  await popup.close()

  // ── 2. 下載:Content-Disposition 還原 original_filename(中文檔名)──
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadBtn.click(),
  ])
  expect(download.suggestedFilename()).toBe(FILE_NAME)
})
