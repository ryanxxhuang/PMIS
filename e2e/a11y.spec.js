// W8-5 a11y／手機護欄:375px 全路由無溢位掃描、44px 觸控目標抽查、鍵盤 Esc 動線。
// 這份是「改完之後應成立」的合約——共用元件的 max-md:min-h-11(F1)、抽屜/對話框的
// Esc 與焦點管理(F2)落地後必須全綠;它不重複既有 spec 的業務斷言,只守版面與鍵盤。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

const MOBILE = { width: 375, height: 812 }
// 640-767 的縫:BottomNav 是 md:hidden(<768)所以這裡已是手機版面,
// 但觸控目標若寫成 max-sm(<640)就會塌回桌機尺寸。744 是 iPad mini 直式寬度。
const TABLET_GAP = { width: 744, height: 1024 }
// 768-1279 是 W9 新增的第三段版面(側欄強制收成 icon rail、全域搜尋收成圖示鈕),
// 上線時零測試覆蓋。1024 取這一段的中間,離 768/1280 兩個斷點都夠遠。
const TABLET_RAIL = { width: 1024, height: 768 }

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

// 逐頁等 h1 → 量整份文件寬度。失敗訊息一定帶路由名與尺寸,掃描一長串才知道紅在哪一頁。
// 尺寸清單走同一份路由、同一次登入:登入要整頁 reload(demo 資料重種),
// 每個尺寸各登一次會讓這三條測試的時間直接翻倍,矩陣不必爆到那個程度。
async function scanNoOverflow(page, role, routes, viewports = [MOBILE]) {
  await page.setViewportSize(viewports[0])
  await loginAs(page, role)
  for (const vp of viewports) {
    await page.setViewportSize(vp)
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
      expect(sw, `${vp.width}px 溢位:${path} scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw)
    }
  }
}

// 兩段版面各掃一次:375=手機抽屜版面,1024=W9 的 icon rail 版面(側欄佔 80px,
// 內容區被壓窄,表格/工具列是否溢位與手機不同題)。
const SCAN_VIEWPORTS = [MOBILE, TABLET_RAIL]

test.describe('375px／1024px 全路由無溢位', () => {
  test('施工廠商:全部可達路由無水平捲動', async ({ page }) => {
    test.setTimeout(180_000) // 逐頁掃 20+ 條路由 × 兩個尺寸,單頁 30s 不夠
    await scanNoOverflow(page, 'contractor', CONTRACTOR_ROUTES, SCAN_VIEWPORTS)
  })

  test('監造:全部可達路由無水平捲動', async ({ page }) => {
    test.setTimeout(180_000)
    await scanNoOverflow(page, 'supervisor', SUPERVISOR_ROUTES, SCAN_VIEWPORTS)
  })

  test('機關:全部可達路由無水平捲動', async ({ page }) => {
    test.setTimeout(180_000)
    await scanNoOverflow(page, 'owner', OWNER_ROUTES, SCAN_VIEWPORTS)
  })
})

test.describe('1024px icon rail(W9 平板版面)', () => {
  // rail 是 W9 全新的第三段版面:側欄強制收合(不吃桌機的 localStorage 偏好)、
  // 只留圖示+短標。這裡釘住「短標出現、全名收起、但 accessible name 仍是全名」——
  // 全名靠 NavLink 的 aria-label 恆掛,一旦有人把 aria-label 拿掉,
  // 報讀器與所有 getByRole('link', { name: 全名 }) 的既有合約會一起斷。
  test('側欄收成短標 rail,連結的 accessible name 仍是全名', async ({ page }) => {
    await page.setViewportSize(TABLET_RAIL)
    await loginAs(page, 'contractor')
    const nav = page.getByRole('navigation', { name: '主要功能' })
    await expect(nav.getByText('現場', { exact: true })).toBeVisible()      // NAV_SHORT
    await expect(nav.getByText('現場與品質', { exact: true })).toBeHidden()  // 全名 span 收起
    await expect(nav.getByRole('link', { name: '現場與品質', exact: true })).toBeVisible()
    // 側欄寬 = md:w-20(80px);沒收合就會是 256px,rail 直接沒發生
    const box = await page.locator('aside').boundingBox()
    expect(box?.width, `1024px 側欄寬 ${box?.width}px——沒收成 icon rail(應為 80px)`).toBeLessThan(120)
    // ≥768 不該同時出現底部導覽(那是手機版面);兩套導覽同時在=版面斷點打架
    await expect(page.getByRole('navigation', { name: '快速導覽' })).toBeHidden()
  })

  // 平板收合是「衍生值」,不得回寫桌機偏好:在 1024 逛一圈後回到 1280,
  // 側欄必須自己展開回全寬。W9 若把 isTablet 併進 sidebarCollapsed 就會回退成這條紅。
  test('平板的強制收合不污染桌機側欄偏好', async ({ page }) => {
    await page.setViewportSize(TABLET_RAIL)
    await loginAs(page, 'contractor')
    await expect(page.getByRole('navigation', { name: '主要功能' }).getByText('現場', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 800 })
    const nav = page.getByRole('navigation', { name: '主要功能' })
    await expect(nav.getByText('現場與品質', { exact: true })).toBeVisible()
    // 側欄寬帶 300ms transition,量到的可能是動畫中間值 → poll 到落定
    await expect
      .poll(async () => (await page.locator('aside').boundingBox())?.width,
        { message: '回到 1280 後側欄沒展開回全寬——平板收合污染了桌機偏好' })
      .toBeGreaterThan(120)
  })
})

test.describe('44px 觸控目標抽查(375px)', () => {
  // 抽查三個代表面:共用 Button(存檔)、手工 min-h-11(品質分段)、清單列主觸控目標。
  // 不逐顆掃全站——共用元件的高度由 F1 的 max-md:min-h-11 一次保證,這裡只釘代表點防回退。
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

  // 744px(iPad mini 直式)落在 640-767 這一段:BottomNav 已出現=手機版面,
  // 觸控目標若還綁 max-sm 就會塌成 32-36px。W9 上線時正是這個狀態。
  test('744px(手機版面下緣)觸控目標不得塌回桌機尺寸', async ({ page }) => {
    await page.setViewportSize(TABLET_GAP)
    await loginAs(page, 'contractor')
    await gotoHash(page, '/site-log')
    await expect(page.getByRole('navigation', { name: '快速導覽' })).toBeVisible()
    const save = page.getByRole('button', { name: '存檔', exact: true })
    const box = await save.boundingBox()
    expect(box?.height, `744px 下存檔鈕只有 ${box?.height}px——觸控目標斷點沒跟上手機版面斷點`).toBeGreaterThanOrEqual(44)
  })
})

test.describe('貼底元素不得被 BottomNav 蓋住', () => {
  // W9 迴歸:BottomNav(fixed bottom-0 z-40)整個蓋住施工日誌的 sticky 存檔列(z-10),
  // 廠商在工地填完整份日誌後按不到存檔。這條守的是「貼底元素必須讓開 --bottom-nav-h」。
  for (const vp of [MOBILE, TABLET_GAP]) {
    test(`${vp.width}px 施工日誌存檔鈕未被底部導覽遮蔽`, async ({ page }) => {
      await page.setViewportSize(vp)
      await loginAs(page, 'contractor')
      await gotoHash(page, '/site-log')

      const save = page.getByRole('button', { name: '存檔', exact: true })
      await expect(save).toBeVisible()
      await save.scrollIntoViewIfNeeded()
      const nav = page.getByRole('navigation', { name: '快速導覽' })
      await expect(nav).toBeVisible()

      const s = await save.boundingBox()
      const n = await nav.boundingBox()
      expect(s && n).toBeTruthy()
      // 幾何:存檔鈕底緣必須在 BottomNav 頂緣之上
      expect(s.y + s.height,
        `存檔鈕底緣 ${s.y + s.height} 越過底部導覽頂緣 ${n.y},會被蓋住`).toBeLessThanOrEqual(n.y)

      // 命中測試:存檔鈕中心點實際收得到點擊(而不是 BottomNav 收走)
      const hit = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y)
        return el ? el.closest('button')?.textContent?.trim() ?? el.tagName : null
      }, [s.x + s.width / 2, s.y + s.height / 2])
      expect(hit, '存檔鈕中心點被其他元素攔截').toContain('存檔')
    })
  }
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
