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
})
