import { test, expect } from '@playwright/test'

test('真實 Supabase 帳號可登入、重整還原 session、再登出', async ({ page }) => {
  await page.goto('/#/login')
  // W8-1 登入頁改版移除 Supabase 術語;真實模式的識別改為此白話說明
  await expect(page.getByText('使用機關公務信箱或專案邀請信箱')).toBeVisible()

  await page.getByPlaceholder('Email').fill(process.env.E2E_REAL_EMAIL)
  await page.getByPlaceholder('密碼（至少 8 碼，含大小寫英文與數字）').fill(process.env.E2E_REAL_PASSWORD)
  await page.locator('button[type="submit"]').click()

  await expect(page).toHaveURL(/#\/(dashboard|portfolio)$/)
  await expect(page.getByRole('button', { name: '登出', exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: '登出', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '登出', exact: true }).click()
  await expect(page).toHaveURL(/#\/login$/)
  await expect(page.locator('button[type="submit"]')).toHaveText('登入')
})
