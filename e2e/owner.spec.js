// 機關(李淑芬)動線:落地跨案總覽 → 核准變更設計 → 變更後契約金額跨頁一致(B-02)
// → 廠商成本頁被擋 → 404 頁。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

// demoSeed:原發包 721,364,067;CO-001 已核准 +1,260,000;CO-002 審核中 +1,764,000。
// 核准 CO-002 後變更後契約金額 = 724,388,067——三頁必須同一個數字(B-02 回歸)。
const REVISED_AFTER_CO2 = '724,388,067'

test.describe('機關', () => {
  test('登入落在跨案總覽', async ({ page }) => {
    await loginAs(page, 'owner')
    await expect(page.getByText('跨案總覽').first()).toBeVisible()
    await expect(page.getByText('待你核定／撥款')).toHaveCount(0) // portfolio 無行動中心(在 dashboard)
  })

  test('核准變更設計 → 變更後契約金額跨頁一致(B-02)', async ({ page }) => {
    await loginAs(page, 'owner')
    await gotoHash(page, '/change-orders')
    // CO-002 卡片上的狀態下拉(機關 can.ratify)
    const co2Card = page.locator('h3', { hasText: 'CO-002' })
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
    await co2Card.locator('select').selectOption('核准')
    // 本頁彙總即時更新
    await expect(page.getByText(`NT$ ${REVISED_AFTER_CO2}`).first()).toBeVisible()
    // 跨頁一致:估驗頁分母、Dashboard 發包工程費都是同一個數字
    await gotoHash(page, '/valuation')
    await expect(page.getByText(/變更後契約金額 7\.24 億/)).toBeVisible()
    await gotoHash(page, '/dashboard')
    await expect(page.getByText(`NT$ ${REVISED_AFTER_CO2}`)).toBeVisible()
  })

  test('路由守衛:機關進不了廠商成本頁', async ({ page }) => {
    await loginAs(page, 'owner')
    await gotoHash(page, '/cost')
    await expect(page.getByText('你的角色沒有此頁的存取權限')).toBeVisible()
  })

  test('打錯網址顯示 404 頁(U-02)', async ({ page }) => {
    await loginAs(page, 'owner')
    await gotoHash(page, '/no-such-page')
    await expect(page.getByText('找不到這個頁面')).toBeVisible()
    await page.getByRole('link', { name: /回到首頁/ }).click()
    await expect(page).toHaveURL(/#\/dashboard/)
  })
})
