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

  // 側欄=來源模型(規範 §0):球在誰手上(三來源)→ 工作(五組群組+子頁)→ 參考(三個扁平項)。
  // 「今日待辦」工作項已退場,/dashboard 只剩球權來源一個入口。
  const BALL = ['現在輪到我', '等待對方', '今天已完成']
  const WORK = ['現場與品質', '審查與協作', '進度與金流', '報表與結案', '專案']
  const REFERENCE = ['契約重點', '專案文件', '標單工項']

  test('桌面側欄常駐:三分區齊全、群組預設收合可展開再收合、今日待辦不重複;收合偏好照舊', async ({ page }) => {
    await loginAs(page, 'contractor')
    await expect(page.getByRole('heading', { name: '今日待辦' })).toBeVisible()
    const nav = page.getByRole('navigation', { name: '主要功能' })
    for (const title of ['球在誰手上', '工作', '參考']) {
      await expect(nav.getByText(title, { exact: true })).toBeVisible()
    }
    for (const label of [...BALL, ...WORK, ...REFERENCE]) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    // 今日待辦退場:側欄沒有第二個入口指向 /dashboard,aria-current 只落在「現在輪到我」
    await expect(nav.getByRole('link', { name: '今日待辦', exact: true })).toHaveCount(0)
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(nav.getByRole('link', { name: '現在輪到我', exact: true })).toHaveAttribute('aria-current', 'page')
    // 群組預設收合:子頁不渲染;展開後出現、收合後消失
    await expect(nav.getByRole('link', { name: '施工日誌', exact: true })).toBeHidden()
    await nav.getByRole('button', { name: '展開現場與品質子頁' }).click()
    await expect(nav.getByRole('link', { name: '施工日誌', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '品質查驗', exact: true })).toBeVisible()
    await nav.getByRole('button', { name: '收合現場與品質子頁' }).click()
    await expect(nav.getByRole('link', { name: '施工日誌', exact: true })).toBeHidden()
    // 廠商看不到機關專屬的風險稽核(roles:owner);其餘專案子頁照常
    await nav.getByRole('button', { name: '展開專案子頁' }).click()
    await expect(nav.getByRole('link', { name: '跨案總覽', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '風險稽核', exact: true })).toHaveCount(0)
    // 參考項是扁平項:沒有展開鈕
    for (const label of REFERENCE) {
      await expect(nav.getByRole('button', { name: `展開${label}子頁` })).toHaveCount(0)
    }
    await expect(page.getByRole('link', { name: '問 GovAgent' })).toBeVisible()

    // 深連結進子頁:所在群組仍預設收合,可展開再收合
    await gotoHash(page, '/quality')
    await expect(nav.getByRole('link', { name: '品質查驗', exact: true })).toBeHidden()
    await nav.getByRole('button', { name: '展開現場與品質子頁' }).click()
    await expect(nav.getByRole('link', { name: '品質查驗', exact: true })).toBeVisible()
    await nav.getByRole('button', { name: '收合現場與品質子頁' }).click()
    await expect(nav.getByRole('link', { name: '品質查驗', exact: true })).toBeHidden()

    await page.getByRole('button', { name: '收合側邊欄' }).click()
    await expect(page.getByRole('button', { name: '展開側邊欄' })).toBeVisible()
    await expect(nav.getByRole('link', { name: '現場與品質', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '契約重點', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '施工日誌', exact: true })).toBeHidden()
    await page.reload()
    await expect(page.getByRole('button', { name: '展開側邊欄' })).toBeVisible()
    await page.getByRole('button', { name: '展開側邊欄' }).click()
    await expect(nav.getByRole('link', { name: '標單工項', exact: true })).toBeVisible()
  })

  test('375px 抽屜:同一階層的分區與子頁,角色限制的子頁不出現,長清單可捲、無溢位,直達無內容區下拉', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await loginAs(page, 'supervisor')
    await page.getByRole('button', { name: '選單', exact: true }).click()
    const nav = page.getByRole('navigation', { name: '主要功能' })
    for (const label of [...BALL, ...WORK, ...REFERENCE]) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    // 監造:請款/成本/排程不是他的(roles),進度與金流只剩估驗與 S 曲線;報表多監造報表
    await nav.getByRole('button', { name: '展開進度與金流子頁' }).click()
    await expect(nav.getByRole('link', { name: '估驗計價', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '進度 S 曲線', exact: true })).toBeVisible()
    for (const label of ['請款收款', '成本管理', '逐工項排程']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0)
    }
    await nav.getByRole('button', { name: '展開報表與結案子頁' }).click()
    await expect(nav.getByRole('link', { name: '監造報表', exact: true })).toBeVisible()
    // 抽屜比 812px 高:nav 自己捲(不得橫向溢位),最底的標單工項點得到=可捲
    const navBox = await nav.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(navBox.sw, `抽屜 nav 橫向溢位:scrollWidth ${navBox.sw} > clientWidth ${navBox.cw}`).toBeLessThanOrEqual(navBox.cw)
    await nav.getByRole('link', { name: '標單工項', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: '標單工項' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    // 子頁直達:點品質查驗 → 該頁;內容區不重複子頁導覽(無下拉、無 tablist)
    await page.getByRole('button', { name: '選單', exact: true }).click()
    await nav.getByRole('button', { name: '展開現場與品質子頁' }).click()
    await nav.getByRole('link', { name: '品質查驗', exact: true }).click()
    await expect(page.getByRole('heading', { name: '品質查驗' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '現場與品質目前頁面' })).toHaveCount(0)
    await expect(page.getByRole('tablist', { name: '現場與品質' })).toHaveCount(0)

    // 參考項直達:契約重點是扁平項,點了直達且頁內沒有任何 tablist
    await page.getByRole('button', { name: '選單', exact: true }).click()
    await nav.getByRole('link', { name: '契約重點', exact: true }).click()
    await expect(page.getByRole('heading', { name: '契約重點', exact: true })).toBeVisible()
    await expect(page.getByRole('tablist')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
})
