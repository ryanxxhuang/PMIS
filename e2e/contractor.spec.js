// 施工廠商(陳怡君)動線:Dashboard 概況 → 施工日誌零輸入存檔 → 估驗建期送審。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

test.describe('施工廠商', () => {
  test('Dashboard:進度橫幅與行動中心', async ({ page }) => {
    await loginAs(page, 'contractor')
    await expect(page.getByText('累計實際進度')).toBeVisible()
    await expect(page.getByText('發包工程費')).toBeVisible()
    await expect(page.getByText('待你送出／改善')).toBeVisible() // 角色化行動中心(施工視角)
  })

  test('施工日誌:複製昨日 → 存檔 → 列印鈕/照片區解鎖', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/site-log')
    // 今天(新日期)有「複製昨日」;帶入班組/機具/材料
    await page.getByRole('button', { name: /複製昨日/ }).click()
    await expect(page.getByText(/已帶入 .* 的班組/)).toBeVisible()
    await page.getByRole('button', { name: '存檔', exact: true }).click()
    await expect(page.getByText('已存檔 ✓')).toBeVisible()
    // 跨元件同步:列印鈕出現、照片區解鎖(P-01 tracked store 的回歸點)
    await expect(page.getByRole('button', { name: /列印公定格式日誌/ })).toBeVisible()
    await expect(page.getByText('AI 批次辨識照片', { exact: true })).toBeVisible()
  })

  test('契約義務:標為已提送可掛送審佐證(W-01)', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/contract')
    // demo 預掛佐證:品質計畫義務 → SUB-001(核准)
    await expect(page.getByText(/佐證:SUB-001/)).toBeVisible()
    // 對「提送施工月報」(待辦)掛 SUB-003 佐證並標為已提送
    const card = page.getByText('提送施工月報')
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
    await card.getByRole('button', { name: '標為已提送' }).click()
    await card.getByRole('combobox').selectOption('SUB-DEMO-3')
    await card.getByRole('button', { name: '掛佐證並標為已提送' }).click()
    await expect(card.getByText(/佐證:SUB-003/)).toBeVisible()
    await expect(card.getByRole('button', { name: '已提送 ✓' })).toBeVisible()
  })

  test('估驗:新增估驗期 → 送監造審核', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/valuation')
    await expect(page.getByRole('button', { name: /第 5 期/ })).toBeVisible()
    await page.getByRole('button', { name: '＋ 新增估驗期' }).click()
    // 新一期建立、成為選中頁籤、狀態草稿
    const tab6 = page.getByRole('button', { name: /第 6 期/ })
    await expect(tab6).toBeVisible()
    await expect(tab6.getByText('草稿')).toBeVisible()
    await page.getByRole('button', { name: '送監造審核' }).click()
    await expect(tab6.getByText('監造審核')).toBeVisible()
    // 施工角色送審後只能等監造(不出現核定鈕)
    await expect(page.getByText('待監造核定')).toBeVisible()
  })
})
