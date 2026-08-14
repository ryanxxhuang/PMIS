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
    await expect(page.getByRole('heading', { name: '跨案總覽' })).toBeVisible()
    await expect(page.getByText('現在輪到我')).toHaveCount(0) // portfolio 無待辦段(在今日待辦)
    // 落地第一眼要看到跨案例外數字帶(W8-4C C3),不是只有卡片牆
    await expect(page.getByText(/未結缺失/).first()).toBeVisible()
    // 已登入後重新開根路徑仍依角色落地，不被舊的固定 /dashboard 導向帶走。
    await page.goto('/')
    await expect(page).toHaveURL(/#\/portfolio/)
  })

  test('核准變更設計 → 變更後契約金額跨頁一致(B-02)', async ({ page }) => {
    await loginAs(page, 'owner')
    await gotoHash(page, '/change-orders')
    // 待核定的變更排在最前面,機關進來第一眼就是要核的東西(W8-4C C1)
    await expect(page.getByRole('heading', { name: /待核定/ })).toBeVisible()
    // CO-002 卡片上的狀態下拉(機關 can.ratify)
    const co2Card = page.locator('h3', { hasText: 'CO-002' })
      .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
    await co2Card.locator('select').selectOption('核准')
    // 本頁彙總即時更新
    await expect(page.getByText(`NT$ ${REVISED_AFTER_CO2}`).first()).toBeVisible()
    // 跨頁一致:估驗頁分母、Dashboard 發包工程費都是同一個數字
    await gotoHash(page, '/valuation')
    await expect(page.getByText(/變更後契約金額 7\.24 億/)).toBeVisible()
    await gotoHash(page, '/dashboard')
    await expect(page.getByText(`NT$ ${REVISED_AFTER_CO2}`)).toBeVisible()
  })

  test('今日待辦:機關拿得到驗收法定期限,拿不到廠商責任的事', async ({ page }) => {
    await loginAs(page, 'owner')
    await gotoHash(page, '/dashboard')
    // demoSeed:報竣 -28、竣工確認 -25 → 初驗法定 30 日內,期限將至
    const mine = page.getByRole('heading', { name: '現在輪到我' })
      .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
    await expect(mine.getByText('初驗期限將至')).toBeVisible()
    // 廠商責任的契約義務不得變成機關做不到的假待辦(AI 觀察那一行仍可提醒,但不是待辦)
    await expect(mine.getByText('第 5 期估驗計價送審')).toHaveCount(0)
    await expect(page.getByText('第 5 期估驗計價送審')).toHaveCount(1)
    // 提醒中心仍可深連結(W7 路由治理不回退),且吃同一份聚合
    await gotoHash(page, '/alerts')
    await expect(page.getByRole('heading', { name: '提醒中心' })).toBeVisible()
    await expect(page.getByText('初驗期限將至')).toBeVisible()
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
    await page.getByRole('link', { name: /回到跨案總覽/ }).click()
    await expect(page).toHaveURL(/#\/portfolio/)
  })
})
