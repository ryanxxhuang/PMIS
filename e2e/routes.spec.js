import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

test.describe('路由治理', () => {
  test('公開漏洞頁不需登入，列印頁未登入會導回登入', async ({ page }) => {
    await page.goto('/#/security')
    await expect(page.getByRole('heading', { name: '漏洞回報與應變機制' })).toBeVisible()

    await gotoHash(page, '/site-log/print')
    await expect(page).toHaveURL(/#\/login/)
    await expect(page.getByText('選擇 demo 角色登入：')).toBeVisible()
  })

  test('登入後可直接開啟不含工作台外框的列印深連結', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/site-log/print')

    await expect(page.getByRole('heading', { name: '公共工程施工日誌' })).toBeVisible()
    await expect(page.getByRole('button', { name: /列印/ })).toBeVisible()
    await expect(page.getByText('AI Agent', { exact: true })).toHaveCount(0)
  })

  test('共同框架固定六個工作面，GovAgent 是全域入口', async ({ page }) => {
    await loginAs(page, 'contractor')
    await expect(page.getByRole('heading', { name: '今日待辦' })).toBeVisible()
    const nav = page.getByRole('navigation', { name: '主要功能' })
    await expect(nav.getByRole('link')).toHaveCount(6)
    for (const label of ['今日待辦', '現場與品質', '審查與協作', '進度與金流', '文件與結案', '專案']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('link', { name: '問 GovAgent' })).toBeVisible()
  })

  test('375px 使用抽屜與工作面選單，頁面不產生水平溢位', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await loginAs(page, 'supervisor')
    await page.getByRole('button', { name: '選單', exact: true }).click()
    const nav = page.getByRole('navigation', { name: '主要功能' })
    await expect(nav.getByRole('link', { name: '現場與品質', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '關閉選單' }).click()

    await gotoHash(page, '/quality')
    const pagePicker = page.getByRole('combobox', { name: '現場與品質目前頁面' })
    await expect(pagePicker).toBeVisible()
    await expect(pagePicker).toHaveValue('/quality')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
})
