import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

for (const [role, label] of [['contractor', '施工廠商'], ['supervisor', '監造單位'], ['owner', '主辦機關']]) {
  for (const width of [1440, 375]) {
    test(`契約流程 ${label} ${width}px：文件接續重點與角色範圍`, async ({ page }) => {
      await page.setViewportSize({ width, height: 960 })
      await loginAs(page, role)
      await gotoHash(page, '/contract')
      const flow = page.getByRole('region', { name: '契約整理流程' })
      await expect(flow.getByText(`${label}視角`)).toBeVisible()
      await expect(page.getByText(/可自動分析：文字型 PDF/)).toBeVisible()
      await flow.getByRole('link', { name: /查看契約重點/ }).click()
      const list = page.getByRole('list', { name: '履約義務時間軸' })
      await expect(list.getByText('提送施工月報')).toBeVisible()
      if (role === 'contractor') await expect(list.getByText('提送監造月報')).toHaveCount(0)
      else await expect(list.getByText('提送監造月報')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `/tmp/pmis-flow-${role}-${width}.png`, fullPage: true })
      await flow.getByRole('link', { name: /上傳契約/ }).click()
      await expect(page.getByRole('heading', { name: '專案文件', exact: true, level: 1 })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `/tmp/pmis-documents-${role}-${width}.png`, fullPage: true })
    })
  }
}
