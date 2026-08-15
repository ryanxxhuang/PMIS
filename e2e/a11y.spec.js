// W8-5 a11y／手機護欄:375px 全路由無溢位掃描、44px 觸控目標抽查、鍵盤 Esc 動線。
// 這份是「改完之後應成立」的合約——共用元件的 max-sm:min-h-11(F1)、抽屜/對話框的
// Esc 與焦點管理(F2)落地後必須全綠;它不重複既有 spec 的業務斷言,只守版面與鍵盤。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

const MOBILE = { width: 375, height: 812 }

// 路由 → 該頁 PageHeader 的 h1 標題。掃描時等「該路由自己的 h1」出現才量寬度——
// 路由是 lazy chunk,只等 main 非空會量到上一頁殘影,等到專屬 h1 才保證新頁已掛載。
const H1 = {
  '/dashboard': '今日待辦',
  '/site-log': '施工日誌',
  '/quality': '品質查驗',
  '/itp': '檢驗停留點',
  '/safety': '工安管理',
  '/requirements': '契約重點',
  '/submittals': '送審文件',
  '/rfi': '工程疑義',
  '/change-orders': '變更設計',
  '/boq': '標單工項',
  '/valuation': '估驗計價',
  '/payments': '請款收款',
  '/cost': '成本管理',
  '/progress': '進度管制',
  '/schedule': '逐工項排程',
  '/contract': '專案文件',
  '/monthly-report': '施工月報',
  '/supervisor-report': '監造報表',
  '/acceptance': '驗收結算',
  '/portfolio': '跨案總覽',
  '/activity': '專案活動紀錄',
  '/members': '專案成員',
  '/alerts': '提醒中心',
  '/audit': '風險稽核',
}
// /agent 的 h1 是角色化的 Agent 名稱(AGENT_LABEL),逐角色對照
const AGENT_H1 = { contractor: '廠商 Agent', supervisor: '監造 Agent', owner: '機關 Agent' }

// 各角色可達的主要路由(對齊 navConfig 的 roles 限制;print 路由不掃——bare layout 另有守衛測試)
const CONTRACTOR_ROUTES = [
  '/dashboard', '/site-log', '/quality', '/itp', '/safety',
  '/requirements', '/submittals', '/rfi', '/change-orders',
  '/boq', '/valuation', '/payments', '/cost', '/progress', '/schedule',
  '/contract', '/monthly-report', '/acceptance',
  '/portfolio', '/activity', '/members', '/agent', '/alerts',
]
// 監造:不經手請款、看不到廠商成本/排程;多監造報表
const SUPERVISOR_ROUTES = CONTRACTOR_ROUTES
  .filter((p) => !['/payments', '/cost', '/schedule'].includes(p))
  .concat('/supervisor-report')
// 機關:看不到廠商成本/排程;多風險稽核(hidden 路由,深連結仍允許)
const OWNER_ROUTES = CONTRACTOR_ROUTES
  .filter((p) => !['/cost', '/schedule'].includes(p))
  .concat('/audit')

// 逐頁等 h1 → 量整份文件寬度。失敗訊息一定帶路由名,掃描一長串才知道紅在哪一頁。
async function scanNoOverflow(page, role, routes) {
  await page.setViewportSize(MOBILE)
  await loginAs(page, role)
  for (const path of routes) {
    const h1 = path === '/agent' ? AGENT_H1[role] : H1[path]
    await gotoHash(page, path)
    await expect(
      page.getByRole('heading', { level: 1, name: h1 }),
      `路由 ${path} 的頁面標題「${h1}」未出現(頁面未載入或角色被擋)`,
    ).toBeVisible()
    const { sw, cw } = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }))
    expect(sw, `375px 溢位:${path} scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw)
  }
}

test.describe('375px 全路由無溢位', () => {
  test('施工廠商:全部可達路由無水平捲動', async ({ page }) => {
    test.setTimeout(90_000) // 逐頁掃 20+ 條路由,單頁 30s 不夠
    await scanNoOverflow(page, 'contractor', CONTRACTOR_ROUTES)
  })

  test('監造:全部可達路由無水平捲動', async ({ page }) => {
    test.setTimeout(90_000)
    await scanNoOverflow(page, 'supervisor', SUPERVISOR_ROUTES)
  })

  test('機關:全部可達路由無水平捲動', async ({ page }) => {
    test.setTimeout(90_000)
    await scanNoOverflow(page, 'owner', OWNER_ROUTES)
  })
})

test.describe('44px 觸控目標抽查(375px)', () => {
  // 抽查三個代表面:共用 Button(存檔)、手工 min-h-11(品質分段)、清單列主觸控目標。
  // 不逐顆掃全站——共用元件的高度由 F1 的 max-sm:min-h-11 一次保證,這裡只釘代表點防回退。
  test('施工日誌存檔鈕高度 ≥ 44px', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await loginAs(page, 'contractor')
    await gotoHash(page, '/site-log')
    const save = page.getByRole('button', { name: '存檔', exact: true })
    await expect(save).toBeVisible()
    const box = await save.boundingBox()
    expect(box?.height, `存檔鈕高度 ${box?.height}px 未達 44px`).toBeGreaterThanOrEqual(44)
  })

  test('品質分段五顆鈕高度皆 ≥ 44px', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await loginAs(page, 'contractor')
    await gotoHash(page, '/quality')
    const seg = page.getByRole('group', { name: '品質分段' }).getByRole('button')
    await expect(seg).toHaveCount(5)
    for (const btn of await seg.all()) {
      const label = (await btn.textContent())?.trim()
      const box = await btn.boundingBox()
      expect(box?.height, `品質分段「${label}」高度 ${box?.height}px 未達 44px`).toBeGreaterThanOrEqual(44)
    }
  })

  // 規格點名的「下一步」CTA 只在真專案的初始化清單出現(demo 專案不渲染 SetupChecklist),
  // demo E2E 改釘同頁的主要觸控目標:今日待辦列(期限型待辦連結)。
  test('今日待辦列(主要觸控目標)高度 ≥ 44px', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await loginAs(page, 'contractor')
    const task = page.getByRole('link').filter({ hasText: '第 5 期估驗計價送審' })
    await expect(task).toBeVisible()
    const box = await task.boundingBox()
    expect(box?.height, `今日待辦列高度 ${box?.height}px 未達 44px`).toBeGreaterThanOrEqual(44)
  })
})

test.describe('鍵盤可達性', () => {
  test('375px 抽屜:Esc 關閉並把焦點還給選單鈕', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await loginAs(page, 'contractor')
    await page.getByRole('button', { name: '選單', exact: true }).click()
    const nav = page.getByRole('navigation', { name: '主要功能' })
    await expect(nav.getByRole('link', { name: '現場與品質', exact: true })).toBeVisible()
    // F2 合約:開啟時焦點移入抽屜(關閉鈕),鍵盤使用者不會被留在遮罩底下
    await expect(page.getByRole('button', { name: '關閉選單' })).toBeFocused()
    await page.keyboard.press('Escape')
    // 關閉=側欄項不可見(visibility/不掛載皆可,但不能只是移出畫面仍可聚焦)
    await expect(nav.getByRole('link', { name: '現場與品質', exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: '選單', exact: true })).toBeFocused()
  })

  test('appPrompt:Esc 取消判定,對話框消失且頁面狀態不變', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/quality')
    // 與 supervisor.spec 同一列定位法,但這裡走「取消」分支,不與其成功路徑重複
    const row = page.getByText('4F 柱牆鋼筋查驗', { exact: false })
      .locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')
    await row.getByRole('button', { name: '不合格' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/判定不合格：/)).toBeVisible()
    // F2 合約:Esc 掛在 window 層——即使焦點不在對話框內也要能取消
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // 取消=什麼都沒發生:沒有成功提示、該筆查驗仍可判定
    await expect(page.getByText('已判定不合格並開立缺失')).toHaveCount(0)
    await expect(row.getByRole('button', { name: '不合格' })).toBeVisible()
  })
})
