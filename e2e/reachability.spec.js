// 點擊可達性(ROADMAP「履約與可達性」):三個角色各一條,從首頁側欄一路「用點的」走到
// navConfig 裡該角色看得見的每一個工作面子頁與參考項——不是深連結、不是打網址。
// 深連結測得到「路由存在」,測不到「使用者找得到」;2026-08-12 施工日誌藏到擁有者都
// 找不到,就是深連結全綠、可達性全紅。
// 期望值直接從 navConfig 的 visibleNavGroups / BALL_SOURCES 算,不在這裡手抄清單:
// 導覽定義改了(解封/收斂/改 roles)這條自動跟著改,漏一個子頁就紅一個。
// 定位只走 role+名稱(exact),範圍鎖在「主要功能」nav——PageTabs 在 main 內也有同名
// NavLink,不鎖範圍會 strict 衝突。
import { test, expect } from '@playwright/test'
import { loginAs, ROLES } from './helpers.js'
import { visibleNavGroups, BALL_SOURCES, coreOnlyNav } from '../src/lib/navConfig.js'

// demo 角色:無 override、非平台管理員(與 routes.spec 的可見性斷言同一前提)
const expectedFor = (org) => visibleNavGroups(org, false, false)
// hash 路由的 URL 斷言:#/site-log 後面只能是結尾或 ?(避免 /site-log 命中 /site-log/print)
const urlOf = (to) => new RegExp(`#${to.replace(/[?]/g, '\\?')}(\\?|$)`)

for (const role of Object.keys(ROLES)) {
  test(`${role}:側欄可點到 navConfig 每一個可見子頁與參考項`, async ({ page }) => {
    test.setTimeout(120_000) // 20+ 條路由逐一點擊,含 lazy chunk 載入
    await loginAs(page, role)
    const nav = page.getByRole('navigation', { name: '主要功能' })
    const reached = []

    // 廠商三核心(2026-09-21):側欄沒有今日工作來源;落地頁(施工日誌)所在群組已自動展開,先收回再逐組走
    if (coreOnlyNav(role)) {
      for (const b of BALL_SOURCES) await expect(nav.getByRole('link', { name: b.label, exact: true })).toHaveCount(0)
      // 先離開群組頁(今日工作仍可深連結),否則再點同一頁的群組列不會觸發自動展開
      await page.evaluate(() => { window.location.hash = '/dashboard' })
      await nav.getByRole('button', { name: `收合${expectedFor(role)[0].items[0].label}子頁` }).click()
    }
    // 球在誰手上:三個來源共用 /dashboard,以 ?ball= 分流;aria-current 只落在點到的那個
    for (const b of coreOnlyNav(role) ? [] : BALL_SOURCES) {
      const link = nav.getByRole('link', { name: b.label, exact: true })
      await link.click()
      await expect(page).toHaveURL(urlOf(b.to))
      await expect(link).toHaveAttribute('aria-current', 'page')
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
      reached.push(b.to)
    }

    for (const group of expectedFor(role)) {
      for (const item of group.items) {
        if (!item.tabs) {
          // 參考項:扁平,直達
          const link = nav.getByRole('link', { name: item.label, exact: true })
          await link.click()
          await expect(page).toHaveURL(urlOf(item.to))
          await expect(link).toHaveAttribute('aria-current', 'page')
          reached.push(item.to)
          continue
        }
        // 工作群組(入口方案 B,2026-09-15):還沒進這一組時預設收合;點群組列進第一個子頁,
        // 所屬群組自動展開、子頁在側欄列出,此時內容區不畫同組分頁列(D-015 不重複導覽)。
        // 手動收合後子頁入口改由分頁列承接(入口不消失),再展開分頁列又收掉。
        await expect(nav.getByRole('button', { name: `展開${item.label}子頁` })).toBeVisible()
        const groupLink = nav.getByRole('link', { name: item.label, exact: true })
        await groupLink.click()
        await expect(page).toHaveURL(urlOf(item.to))
        const collapseBtn = nav.getByRole('button', { name: `收合${item.label}子頁` })
        await expect(collapseBtn).toBeVisible()
        // 分頁列只在同組有兩個以上子頁時才存在;監造的「報表與結案」等單子頁組本來就沒有
        const tabsBar = page.getByRole('main').getByRole('navigation', { name: `${item.label}分頁` })
        const hasTabsBar = item.tabs.length >= 2
        if (hasTabsBar) await expect(tabsBar).toHaveCount(0)
        for (const tab of item.tabs) {
          const link = nav.getByRole('link', { name: tab.label, exact: true })
          await link.click()
          await expect(page).toHaveURL(urlOf(tab.to))
          await expect(link).toHaveAttribute('aria-current', 'page')
          reached.push(tab.to)
        }
        // 手動收合仍可用,而且收合後同組入口由分頁列接手;再展開又收掉——鍵盤走同一顆按鈕
        await collapseBtn.click()
        const expandBtn = nav.getByRole('button', { name: `展開${item.label}子頁` })
        await expect(expandBtn).toBeVisible()
        if (hasTabsBar) {
          await expect(tabsBar).toBeVisible()
          await expandBtn.focus()
          await page.keyboard.press('Enter')
          await expect(collapseBtn).toBeVisible()
          await expect(tabsBar).toHaveCount(0)
          await collapseBtn.click()
        }
        // 走完收回:下一組展開時側欄不會越長越長(手機抽屜高度有限,桌機也一樣守)
        await expect(expandBtn).toBeVisible()
      }
    }
    // 走過的路由數印進報告(回報涵蓋數用),不寫死——navConfig 變動時數字跟著變
    console.log(`[reachability] ${role}: ${reached.length} 條 → ${reached.join(' ')}`)
  })
}
