// 監造(王建國)動線:核定估驗 → 查驗不合格自動開缺失 → 日誌唯讀 → 請款路由被擋。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

test.describe('監造', () => {
  test('估驗:核定第 5 期(監造審核 → 已核定)', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/valuation')
    const tab5 = page.getByRole('button', { name: /第 5 期/ })
    await expect(tab5.getByText('監造審核')).toBeVisible()
    await page.getByRole('button', { name: '核定估驗' }).click()
    await expect(tab5.getByText('已核定')).toBeVisible()
    await expect(page.getByRole('button', { name: '退回核定' })).toBeVisible()
    await expect(page.getByText('本期狀態為「已核定」')).toBeVisible()
  })

  test('查驗:判不合格(必填原因)→ 自動開立缺失', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/quality')
    // 鎖定「4F 柱牆鋼筋查驗」那一列的不合格鈕(頁上有多筆待查驗)
    const row = page.getByText('4F 柱牆鋼筋查驗', { exact: false })
      .locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')
    await row.getByRole('button', { name: '不合格' }).click()
    // appPrompt 對話框:原因必填,空白時確認鈕鎖住
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/判定不合格：/)).toBeVisible()
    const confirmBtn = dialog.getByRole('button', { name: '判定不合格並開立缺失' })
    await expect(confirmBtn).toBeDisabled()
    await dialog.locator('textarea').fill('主筋間距超出容許值,需拆除重綁')
    await confirmBtn.click()
    // W8-4A:判定成功後查驗分段原地留結果列(可發現性)——連動缺失開在「缺失」分段,
    // 由「查看缺失」入口切段,才看得到那筆缺失
    await expect(page.getByText('已判定不合格並開立缺失')).toBeVisible()
    await page.getByRole('button', { name: '查看缺失' }).click()
    // 查驗變不合格 + 缺失清單多一筆連動缺失
    await expect(page.getByText('查驗不合格：4F 柱牆鋼筋查驗')).toBeVisible()
    // 剛判定的查驗當天就進「今天已完成」(demo 與真後端同樣寫 inspected_at)
    await gotoHash(page, '/dashboard')
    const done = page.getByRole('heading', { name: '今天已完成' })
      .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
    await expect(done.getByText('4F 柱牆鋼筋查驗')).toBeVisible()
    await expect(done.getByText('監造判定不合格')).toBeVisible()
  })

  // ── 缺失複查閉環的後半段(前半段=contractor.spec 的「開始改善 → 提送複查」)──
  // 三級品管的收尾:球回到監造,只有監造能結案或退回。狀態機歷史上出過 bug
  // (按下「開始改善」後標籤仍寫「待廠商改善」),所以兩條分支都要釘住
  // 「狀態 + 球權標籤 + 該角色還能按什麼」三件事一起變。
  // demo 種子的 DEF-DEMO-1 就落在「待複查」,不必先跑一遍廠商動線
  // (換角色要重新登入,demo 資料會整份重種,跨角色接力在 demo 模式做不到)。
  const DEFECT_UNDER_REVIEW = '查驗不合格：外牆窯燒磚打樣'
  const openDefectRow = async (page) => {
    await gotoHash(page, '/quality')
    await page.getByRole('group', { name: '品質分段' }).getByRole('button', { name: /缺失/ }).click()
    const row = page.getByText(DEFECT_UNDER_REVIEW)
      .locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')
    await expect(row.getByText('待監造複查')).toBeVisible()
    return row
  }

  test('缺失複查:合格結案 → 已結案、球權歸零、只剩撤銷結案', async ({ page }) => {
    await loginAs(page, 'supervisor')
    const row = await openDefectRow(page)
    await row.getByRole('button', { name: '複查結案' }).click()
    // 球權歸零(BallChip 由「待監造複查」轉「已結案」),不再是任何一方的待辦
    await expect(row.getByText('已結案')).toBeVisible()
    await expect(row.getByText('待監造複查')).toHaveCount(0)
    // 已結案=改善鏈終點:推進與退回鈕都消失,只留附原因的撤銷結案(不可直接刪)
    await expect(row.getByRole('button', { name: '複查結案' })).toHaveCount(0)
    await expect(row.getByRole('button', { name: '退回' })).toHaveCount(0)
    await expect(row.getByRole('button', { name: '撤銷結案' })).toBeVisible()
    // closed_at 是系統在按下當刻寫的 → 當天就進「今天已完成」(與查驗同一條規則)
    await gotoHash(page, '/dashboard')
    const done = page.getByRole('heading', { name: '今天已完成' })
      .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
    await expect(done.getByText(DEFECT_UNDER_REVIEW)).toBeVisible()
    await expect(done.getByText('監造已結案')).toBeVisible()
  })

  test('缺失複查:退回 → 回到廠商改善中,球權還給廠商', async ({ page }) => {
    await loginAs(page, 'supervisor')
    const row = await openDefectRow(page)
    await row.getByRole('button', { name: '退回' }).click()
    await expect(row.getByText('廠商改善中')).toBeVisible()
    await expect(row.getByText('待監造複查')).toHaveCount(0)
    // 球在廠商:監造這邊沒有任何可推進的鈕,只看得到「待廠商改善」
    await expect(row.getByText('待廠商改善')).toBeVisible()
    await expect(row.getByRole('button', { name: '複查結案' })).toHaveCount(0)
    await expect(row.getByRole('button', { name: '退回' })).toHaveCount(0)
    // 退回不是結案:不得混進「今天已完成」(球回廠商 → 只會出現在「等待對方」)
    await gotoHash(page, '/dashboard')
    const done = page.getByRole('heading', { name: '今天已完成' })
      .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
    await expect(done.getByText(DEFECT_UNDER_REVIEW)).toHaveCount(0)
  })

  test('施工日誌對監造唯讀:摘要式檢視、無假可編欄位', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/site-log')
    await expect(page.getByText(/此頁為唯讀/).first()).toBeVisible()
    // W8-4B:唯讀=摘要式,頁上唯一的 input 是切歷史用的日期——不再有 disabled 欄位假裝可編
    await expect(page.locator('input:not([type="date"])')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '存檔', exact: true })).toHaveCount(0)
    await expect(page.getByText('選照片 AI 辨識後上傳', { exact: true })).toHaveCount(0) // U-01:不給死按鈕(P0 #11 改名後同步)
    // 切到 demo 種子最近一筆日誌(右欄清單第一筆=昨天),摘要直接顯示該日內容
    const list = page.getByRole('heading', { name: /施工日誌（/ }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
    await list.getByRole('button', { name: /^\d{4}-\d{2}-\d{2}$/ }).first().click()
    const card = page.getByRole('heading', { name: '本日日誌' }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
    await expect(card.getByText('4F 版牆混凝土澆置、養護')).toBeVisible() // demoSeed 最近一筆(-1 天)的工作摘要
    await expect(page.getByRole('button', { name: '列印公定格式日誌' })).toBeVisible()
    // 有日誌的日期一樣是純文字摘要,不會長出可編欄位
    await expect(page.locator('input:not([type="date"])')).toHaveCount(0)
  })

  test('路由守衛:監造進不了請款收款', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/payments')
    await expect(page.getByText('你的角色沒有此頁的存取權限')).toBeVisible()
  })
})
