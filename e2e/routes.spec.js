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

  // 側欄=D-026 四主入口:今日工作(三個球權來源)→ 工作(現場紀錄/履約時程/估驗請款三組+子頁)
  // → 專案資料(文件往來/專案兩組+子頁)。/dashboard 只剩球權來源一個入口。
  const BALL = ['現在輪到我', '等待對方', '今天已完成']
  const WORK = ['現場紀錄', '履約時程', '估驗請款']
  const SECONDARY = ['文件往來', '專案']

  test('桌面側欄常駐:三分區齊全、群組預設收合可展開再收合、今日待辦不重複;收合偏好照舊', async ({ page }) => {
    await loginAs(page, 'contractor')
    await expect(page.getByRole('heading', { name: '今日待辦' })).toBeVisible()
    const nav = page.getByRole('navigation', { name: '主要功能' })
    for (const title of ['今日工作', '工作', '專案資料']) {
      await expect(nav.getByText(title, { exact: true })).toBeVisible()
    }
    for (const label of [...BALL, ...WORK, ...SECONDARY]) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    // 今日待辦退場:側欄沒有第二個入口指向 /dashboard,aria-current 只落在「現在輪到我」
    await expect(nav.getByRole('link', { name: '今日待辦', exact: true })).toHaveCount(0)
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(nav.getByRole('link', { name: '現在輪到我', exact: true })).toHaveAttribute('aria-current', 'page')
    // 群組預設收合:子頁不渲染;展開後出現、收合後消失
    await expect(nav.getByRole('link', { name: '施工日誌', exact: true })).toBeHidden()
    await nav.getByRole('button', { name: '展開現場紀錄子頁' }).click()
    await expect(nav.getByRole('link', { name: '現場總覽', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '施工日誌', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '品質查驗', exact: true })).toBeVisible()
    await nav.getByRole('button', { name: '收合現場紀錄子頁' }).click()
    await expect(nav.getByRole('link', { name: '施工日誌', exact: true })).toBeHidden()
    // 退場的 hidden 項不在側欄:廠商的成本管理、機關專屬的風險稽核都不出現;其餘子頁照常
    await nav.getByRole('button', { name: '展開估驗請款子頁' }).click()
    await expect(nav.getByRole('link', { name: '請款收款', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '成本管理', exact: true })).toHaveCount(0)
    await nav.getByRole('button', { name: '收合估驗請款子頁' }).click()
    await nav.getByRole('button', { name: '展開專案子頁' }).click()
    await expect(nav.getByRole('link', { name: '跨案總覽', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '風險稽核', exact: true })).toHaveCount(0)
    await nav.getByRole('button', { name: '收合專案子頁' }).click()
    await expect(page.getByRole('link', { name: '問 GovAgent' })).toBeVisible()

    // 深連結進子頁(入口方案 B):所在群組自動展開、子頁列在側欄,內容區不重複同組分頁列;
    // 手動收合後分頁列回來(入口不消失),再展開又收掉
    const tabsBar = page.getByRole('main').getByRole('navigation', { name: '現場紀錄分頁' })
    await gotoHash(page, '/quality')
    await expect(nav.getByRole('link', { name: '品質查驗', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '品質查驗', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(tabsBar).toHaveCount(0)
    await nav.getByRole('button', { name: '收合現場紀錄子頁' }).click()
    await expect(nav.getByRole('link', { name: '品質查驗', exact: true })).toBeHidden()
    await expect(tabsBar).toBeVisible()
    await expect(tabsBar.getByRole('link', { name: '品質查驗', exact: true })).toHaveAttribute('aria-current', 'page')
    await nav.getByRole('button', { name: '展開現場紀錄子頁' }).click()
    await expect(nav.getByRole('link', { name: '品質查驗', exact: true })).toBeVisible()
    await expect(tabsBar).toHaveCount(0)
    // 同組換頁(分頁列已收掉,改走側欄子頁):群組保持展開
    await nav.getByRole('link', { name: '施工日誌', exact: true }).click()
    await expect(page).toHaveURL(/#\/site-log(\?|$)/)
    await expect(nav.getByRole('link', { name: '施工日誌', exact: true })).toHaveAttribute('aria-current', 'page')
    await nav.getByRole('button', { name: '收合現場紀錄子頁' }).click()
    await expect(nav.getByRole('link', { name: '施工日誌', exact: true })).toBeHidden()

    // 履約時程底下有 /requirements 與 /requirements/review 兩條:子頁選取是精確比對,
    // 在擷取審核時契約重點不得同時亮
    await gotoHash(page, '/requirements/review')
    await expect(nav.getByRole('link', { name: '擷取審核', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('link', { name: '契約重點', exact: true })).not.toHaveAttribute('aria-current', 'page')
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)

    await page.getByRole('button', { name: '收合側邊欄' }).click()
    await expect(page.getByRole('button', { name: '展開側邊欄' })).toBeVisible()
    await expect(nav.getByRole('link', { name: '現場紀錄', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '履約時程', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '施工日誌', exact: true })).toBeHidden()
    await page.reload()
    await expect(page.getByRole('button', { name: '展開側邊欄' })).toBeVisible()
    await page.getByRole('button', { name: '展開側邊欄' }).click()
    await expect(nav.getByRole('link', { name: '估驗請款', exact: true })).toBeVisible()
  })

  test('375px 抽屜:同一階層的分區與子頁,角色限制與 hidden 的子頁不出現,長清單可捲、無溢位,直達無內容區下拉', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await loginAs(page, 'supervisor')
    await page.getByRole('button', { name: '更多', exact: true }).click()
    const nav = page.getByRole('navigation', { name: '主要功能' })
    for (const label of [...BALL, ...WORK, ...SECONDARY]) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    // 監造:請款不是他的(roles)、成本 hidden,估驗請款只剩估驗與標單;文件往來多監造月報
    await nav.getByRole('button', { name: '展開估驗請款子頁' }).click()
    await expect(nav.getByRole('link', { name: '估驗計價', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '標單工項', exact: true })).toBeVisible()
    for (const label of ['請款收款', '成本管理']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0)
    }
    await nav.getByRole('button', { name: '展開履約時程子頁' }).click()
    await expect(nav.getByRole('link', { name: '逐工項排程', exact: true })).toHaveCount(0)
    await nav.getByRole('button', { name: '展開文件往來子頁' }).click()
    await expect(nav.getByRole('link', { name: '監造月報', exact: true })).toBeVisible()
    // 抽屜比 812px 高:nav 自己捲(不得橫向溢位),最底的監造月報點得到=可捲
    const navBox = await nav.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(navBox.sw, `抽屜 nav 橫向溢位:scrollWidth ${navBox.sw} > clientWidth ${navBox.cw}`).toBeLessThanOrEqual(navBox.cw)
    await nav.getByRole('link', { name: '監造月報', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: '監造報表' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    // 子頁直達:點品質查驗 → 該頁;內容區不重複子頁導覽(無下拉、無 tablist)
    await page.getByRole('button', { name: '更多', exact: true }).click()
    await nav.getByRole('button', { name: '展開現場紀錄子頁' }).click()
    await nav.getByRole('link', { name: '品質查驗', exact: true }).click()
    await expect(page.getByRole('heading', { name: '品質查驗' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '現場紀錄目前頁面' })).toHaveCount(0)
    await expect(page.getByRole('tablist', { name: '現場紀錄' })).toHaveCount(0)

    // 群組列直達:點「履約時程」落在第一個子頁契約重點,頁內沒有任何 tablist
    await page.getByRole('button', { name: '更多', exact: true }).click()
    await nav.getByRole('link', { name: '履約時程', exact: true }).click()
    await expect(page.getByRole('heading', { name: '契約重點', exact: true })).toBeVisible()
    await expect(page.getByRole('tablist')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })

  test('退場頁 hidden 仍可依原角色直達;現場紀錄總覽三角色可達且列出現場入口', async ({ page }) => {
    await loginAs(page, 'contractor')
    // 成本管理:廠商可直達(歷史查閱),側欄沒有入口
    await gotoHash(page, '/cost')
    await expect(page.getByRole('heading', { level: 1, name: '成本管理' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '主要功能' }).getByRole('link', { name: '成本管理', exact: true })).toHaveCount(0)
    // 風險稽核:廠商被守衛擋(roles 不因 hidden 鬆綁)
    await gotoHash(page, '/audit')
    await expect(page.getByText('你的角色沒有此頁的存取權限')).toBeVisible()
    // 現場紀錄總覽:底欄/側欄第一個主入口,列出現場作業入口;點「施工日誌」直達今天
    await gotoHash(page, '/site')
    await expect(page.getByRole('heading', { level: 1, name: '現場紀錄' })).toBeVisible()
    const entries = page.getByRole('list', { name: '現場作業入口' })
    for (const name of ['施工日誌', '品質查驗', '自主檢查表', '試體試驗', '檢驗停留點', '工安管理']) {
      await expect(entries.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible()
    }
    await entries.getByRole('link', { name: /^施工日誌/ }).click()
    await expect(page).toHaveURL(/#\/site-log\?d=\d{4}-\d{2}-\d{2}$/)
    await expect(page.getByRole('heading', { level: 1, name: '施工日誌' })).toBeVisible()
  })
})
