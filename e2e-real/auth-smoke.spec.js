import { test, expect } from '@playwright/test'
import { uniqueEmail, createConfirmedUser, cleanupUser, password } from './helpers.js'

const email = uniqueEmail('auth-smoke')
let userId
test.beforeAll(async () => { userId = await createConfirmedUser(email, 'contractor', '登入測試') })
test.afterAll(async () => { if (userId) await cleanupUser(userId) })

test('真實 Supabase 帳號可登入、重整還原 session、再登出', async ({ page }) => {
  await page.goto('/#/login')
  // W8-1 登入頁改版移除 Supabase 術語;真實模式的識別改為此白話說明
  await expect(page.getByText('使用機關公務信箱或專案邀請信箱')).toBeVisible()

  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('密碼（至少 8 碼，含大小寫英文與數字）').fill(password)
  await page.locator('button[type="submit"]').click()

  await expect(page).toHaveURL(/#\/(dashboard|portfolio)$/)
  await expect(page.getByRole('button', { name: '登出', exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: '登出', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '登出', exact: true }).click()
  await expect(page).toHaveURL(/#\/login$/)
  // W12 登入改版:送出鈕依 mockup 文案為「下一步」(登入能力已由前段斷言驗畢)
  await expect(page.locator('button[type="submit"]')).toHaveText('下一步')
})
