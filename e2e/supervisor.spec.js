// 監造(王建國)動線:核定估驗 → 查驗不合格自動開缺失 → 日誌唯讀 → 請款路由被擋。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

test.describe('監造', () => {
  test('估驗:核定第 5 期(監造審核 → 已核定)', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/valuation')
    const tab5 = page.getByRole('button', { name: /第 5 期/ })
    await expect(tab5.getByText('監造審核')).toBeVisible()
    await page.getByRole('button', { name: '核定估驗' }).click()
    await expect(tab5.getByText('已核定')).toBeVisible()
    await expect(page.getByRole('button', { name: '退回核定' })).toBeVisible()
    await expect(page.getByText('本期狀態為「已核定」')).toBeVisible()
  })

  test('查驗:判不合格(必填原因)→ 自動開立缺失', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/quality')
    // 鎖定「4F 柱牆鋼筋查驗」那一列的不合格鈕(頁上有多筆待查驗)
    const row = page.getByText('4F 柱牆鋼筋查驗', { exact: false })
      .locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')
    await row.getByRole('button', { name: '不合格' }).click()
    // appPrompt 對話框:原因必填,空白時確認鈕鎖住
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/判定不合格：/)).toBeVisible()
    const confirmBtn = dialog.getByRole('button', { name: '判定不合格並開立缺失' })
    await expect(confirmBtn).toBeDisabled()
    await dialog.locator('textarea').fill('主筋間距超出容許值,需拆除重綁')
    await confirmBtn.click()
    // 查驗變不合格 + 缺失清單多一筆連動缺失
    await expect(page.getByText('查驗不合格：4F 柱牆鋼筋查驗')).toBeVisible()
  })

  test('施工日誌對監造唯讀:欄位鎖定、無存檔/上傳鈕', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/site-log')
    await expect(page.getByText(/此頁為唯讀/).first()).toBeVisible()
    await expect(page.getByPlaceholder('唯讀檢視')).toBeDisabled()
    await expect(page.getByPlaceholder('今日施工概況')).toBeDisabled()
    await expect(page.getByRole('button', { name: '存檔', exact: true })).toHaveCount(0)
    await expect(page.getByText('AI 批次辨識照片', { exact: true })).toHaveCount(0) // U-01:不給死按鈕
  })

  test('路由守衛:監造進不了請款收款', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/payments')
    await expect(page.getByText('你的角色沒有此頁的存取權限')).toBeVisible()
  })
})
