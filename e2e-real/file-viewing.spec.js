// 看上傳的檔案(真 Supabase):文件清單的檔名可點開原始檔、下載還原原始檔名。
// 走真路徑:上傳 txt(Storage+documents)→ 文件清單出現終態列 →
//   1. 點檔名 → 開新分頁,網址是 contract-documents 的一次性簽名 URL,內容可讀
//   2. 點「下載」→ Content-Disposition 還原 original_filename(storage key 已退化
//      成 ASCII,沒這層的話政府文件的中文檔名會存成底線醜檔名)
// 不需要 Edge runtime:AI 分析失敗只影響抽取,不影響「檔案已落地可開」——
// partial/failed(已上傳)列本來就必須能開檔,這正是要驗的韌性。
// 但 E 包起本機 Edge 與模型金鑰同一個 env-file 一起起(runbook),這條鏈就會真的等 live 抽取跑到終態:
// extract-requirements 單一 request 的牆鐘上限是 REQUEST_ABS_CAP_MS=140 s(大批次還會續跑),原本 60 s 的等待比產品
// 自己的預算短,live 慢一點就假紅(F2 全套實跑一次)。等待改依模式取:live 依產品預算,fixture 維持 60 s。
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

const LIVE_EDGE = Boolean(process.env.ANTHROPIC_API_KEY?.trim())
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
  test.setTimeout(LIVE_EDGE ? 300_000 : 90_000)
  await loginReal(page, conEmail)
  await gotoHash(page, '/contract')
  // 先等頁面就緒(契約選單載入、預設「我的施工契約」就位)再選檔——與 chain 3 同一組守門。
  // 進頁立刻 setInputFiles 會在 React 還沒接上 onChange／契約清單還沒載入時觸發,上傳靜默不發生
  // (trace 裡 storage／documents／Edge 一個請求都沒有),在較慢的機器上每次都中;之後再等「下載」只會等到逾時。
  await expect(page.getByText('專案文件一次上傳')).toBeVisible()
  await expect(page.getByRole('option', { name: /我的施工契約/ })).toBeAttached()
  await page.locator('input[type="file"]').setInputFiles({
    name: FILE_NAME, mimeType: 'text/plain',
    buffer: Buffer.from(CONTRACT_TEXT, 'utf-8'),
  })
  // 上傳一定要先看得到那一列(Storage＋documents 真路徑落地);拿不到列就是上傳失敗,不該再等 AI 終態
  await expect(page.getByText(FILE_NAME).first()).toBeVisible({ timeout: 15_000 })

  // 等 run 走到終態:文件清單列的「下載」只在非處理中出現(AI 分析失敗也算終態)
  const downloadBtn = page.getByRole('button', { name: '下載' })
  await expect(downloadBtn).toBeVisible({ timeout: LIVE_EDGE ? 240_000 : 60_000 })

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
