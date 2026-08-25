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

  test('桌面側欄常駐:精修期四個扁平入口,無展開子頁;收合偏好照舊', async ({ page }) => {
    await loginAs(page, 'contractor')
    await expect(page.getByRole('heading', { name: '今日待辦' })).toBeVisible()
    const nav = page.getByRole('navigation', { name: '主要功能' })
    for (const label of ['今日待辦', '專案文件', '契約重點', '標單工項']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    // 精修期收斂:被藏的工作面與其子頁完全不渲染,也沒有展開鈕
    await expect(nav.getByRole('link', { name: '現場與品質', exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: '施工日誌', exact: true })).toHaveCount(0)
    await expect(nav.getByRole('button', { name: /子頁/ })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '問 GovAgent' })).toBeVisible()

    await page.getByRole('button', { name: '收合側邊欄' }).click()
    await expect(page.getByRole('button', { name: '展開側邊欄' })).toBeVisible()
    await expect(nav.getByRole('link', { name: '契約重點', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '展開側邊欄' })).toBeVisible()
    await page.getByRole('button', { name: '展開側邊欄' }).click()
    await expect(nav.getByRole('link', { name: '標單工項', exact: true })).toBeVisible()
  })

  test('375px 抽屜:精修期四個扁平入口,點契約重點直達且無內容區下拉', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await loginAs(page, 'supervisor')
    await page.getByRole('button', { name: '選單', exact: true }).click()
    const nav = page.getByRole('navigation', { name: '主要功能' })
    for (const label of ['今日待辦', '專案文件', '契約重點', '標單工項']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    await expect(nav.getByRole('button', { name: /子頁/ })).toHaveCount(0)
    await nav.getByRole('link', { name: '契約重點', exact: true }).click()
    await expect(page.getByRole('heading', { name: '契約重點', exact: true })).toBeVisible()
    await expect(page.getByRole('tablist')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
})
