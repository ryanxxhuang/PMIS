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
    // 鎖定「4F 柱牆鋼筋查驗」那一列的不合格鈕(頁上有多筆待查驗;查驗列是 <li>)
    const row = page.getByRole('listitem').filter({ hasText: '4F 柱牆鋼筋查驗' })
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
    // 查驗變不合格 + 缺失清單多一筆連動缺失(新開立的在最前、也是殼的預設選取,
    // 標題同時出現在列與詳情欄,所以鎖列而不是鎖文字)
    await expect(page.getByRole('listitem').filter({ hasText: '查驗不合格：4F 柱牆鋼筋查驗' })).toBeVisible()
    // 剛判定的查驗當天就進「今天已完成」(demo 與真後端同樣寫 inspected_at)。
    // Apple 改版後三段不同時列出,要帶 ?ball=done 才聚焦到已完成那一段。
    await gotoHash(page, '/dashboard?ball=done')
    // Card 有 title 就是 role="group" 並以標題命名,「標題為 X 的那張卡」直接用名稱定位
    const done = page.getByRole('group', { name: '今天已完成', exact: true })
    await expect(done.getByText('4F 柱牆鋼筋查驗')).toBeVisible()
    await expect(done.getByText('監造判定不合格')).toBeVisible()
  })

  // ── 缺失複查閉環的後半段(前半段=contractor.spec 的「開始改善 → 提送複查」)──
  // 三級品管的收尾:球回到監造,只有監造能結案或退回。狀態機歷史上出過 bug
  // (按下「開始改善」後標籤仍寫「待廠商改善」),所以兩條分支都要釘住
  // 「狀態 + 球權標籤 + 該角色還能按什麼」三件事一起變。
  // demo 種子的 DEF-DEMO-1 就落在「待複查」,不必先跑一遍廠商動線
  // (換角色要重新登入,demo 資料會整份重種,跨角色接力在 demo 模式做不到)。
  // 缺失追蹤是清單＋詳情殼(規範 §9.8):列只負責選取,動作在 region「缺失詳情」裡——
  // 先點列、先證明詳情欄真的在顯示這一筆,之後的「某顆鈕不存在」才不是空洞斷言(規範 §8 坑②)。
  const DEFECT_UNDER_REVIEW = '查驗不合格：外牆窯燒磚打樣'
  const openDefectRow = async (page) => {
    await gotoHash(page, '/quality')
    await page.getByRole('group', { name: '品質分段' }).getByRole('button', { name: /缺失/ }).click()
    const row = page.getByRole('listitem').filter({ hasText: DEFECT_UNDER_REVIEW })
    await expect(row.getByText('待監造複查')).toBeVisible()
    await row.click()
    await expect(row).toHaveAttribute('aria-current', 'true')
    const detail = page.getByRole('region', { name: '缺失詳情' })
    await expect(detail).toContainText(DEFECT_UNDER_REVIEW)
    return { row, detail }
  }

  test('缺失複查:合格結案 → 已結案、球權歸零、只剩撤銷結案', async ({ page }) => {
    await loginAs(page, 'supervisor')
    const { row, detail } = await openDefectRow(page)
    // 快篩件數是動作前後的對照組:demo 品質缺失只有這一筆待複查
    await expect(page.getByRole('button', { name: '待監造複查 1', exact: true })).toBeVisible()
    await detail.getByRole('button', { name: '複查結案', exact: true }).click()
    // 球權歸零(BallChip 由「待監造複查」轉「已結案」),不再是任何一方的待辦
    await expect(row.getByText('已結案')).toBeVisible()
    await expect(row.getByText('待監造複查')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '待監造複查 0', exact: true })).toBeVisible()
    // 已結案=改善鏈終點:推進與退回鈕都消失,只留附原因的撤銷結案(不可直接刪)
    await expect(detail).toContainText('已結案')
    await expect(detail.getByRole('button', { name: '複查結案', exact: true })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: '退回', exact: true })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: '撤銷結案', exact: true })).toBeVisible()
    await expect(detail.getByRole('button', { name: '刪除缺失', exact: true })).toHaveCount(0)
    // closed_at 是系統在按下當刻寫的 → 當天就進「今天已完成」(與查驗同一條規則)
    await gotoHash(page, '/dashboard?ball=done')
    const done = page.getByRole('group', { name: '今天已完成', exact: true })
    await expect(done.getByText(DEFECT_UNDER_REVIEW)).toBeVisible()
    await expect(done.getByText('監造已結案')).toBeVisible()
  })

  test('缺失複查:退回 → 回到廠商改善中,球權還給廠商', async ({ page }) => {
    await loginAs(page, 'supervisor')
    const { row, detail } = await openDefectRow(page)
    await detail.getByRole('button', { name: '退回', exact: true }).click()
    await expect(row.getByText('廠商改善中')).toBeVisible()
    await expect(row.getByText('待監造複查')).toHaveCount(0)
    // 球在廠商:監造這邊沒有任何可推進的鈕,只看得到「待廠商改善」
    await expect(detail.getByText('待廠商改善')).toBeVisible()
    await expect(detail.getByRole('button', { name: '複查結案', exact: true })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: '退回', exact: true })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: '開始改善', exact: true })).toHaveCount(0)
    // 退回不是結案:不得混進「今天已完成」(球回廠商 → 只會出現在「等待對方」)
    await gotoHash(page, '/dashboard?ball=done')
    const done = page.getByRole('group', { name: '今天已完成', exact: true })
    // 否定斷言前先證明卡片真的渲染出來且有內容(規範 §8 坑②):demo 種子沒有任何當天的
    // closed_at/inspected_at,退回也不寫這兩個欄位 → 卡片就是「今天還沒有完成紀錄」空狀態
    await expect(done).toBeVisible()
    await expect(done.getByText('今天還沒有完成紀錄')).toBeVisible()
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
    const list = page.getByRole('group', { name: /施工日誌（/ })
    await list.getByRole('button', { name: /^\d{4}-\d{2}-\d{2}$/ }).first().click()
    const card = page.getByRole('group', { name: '本日日誌', exact: true })
    await expect(card.getByText('4F 版牆混凝土澆置、養護')).toBeVisible() // demoSeed 最近一筆(-1 天)的工作摘要
    await expect(page.getByRole('button', { name: '列印公定格式日誌' })).toBeVisible()
    // 有日誌的日期一樣是純文字摘要,不會長出可編欄位
    await expect(page.locator('input:not([type="date"])')).toHaveCount(0)
  })

  // 規範 §9.7 收件匣直達那一筆:待辦連結帶單條 query,落地就是該筆的詳情,不是頁首。
  // 選 SUB-002 與 RFI-002:兩筆是 demo 監造待辦裡到期最近的,穩定落在首頁 5 筆上限內。
  // SUB-002 不是 /submittals 的預設選取(預設是「待我處理」第一筆 SUB-003)——選中它
  // 才證明是 query 在選,不是頁面自己選到。定位零 class:group → listitem → region。
  test('收件匣直達那一筆:點待辦落在該頁且該筆已選中;375 直接推入詳情', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/dashboard?ball=mine')
    const mine = page.getByRole('group', { name: '現在輪到我', exact: true })
    await mine.getByRole('listitem').filter({ hasText: 'SUB-002' }).getByRole('link').click()
    await expect(page).toHaveURL(/#\/submittals\?submittal=SUB-DEMO-2/)
    await expect(page.getByRole('listitem').filter({ hasText: 'SUB-002' })).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('listitem').filter({ hasText: 'SUB-003' })).not.toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('region', { name: 'SUB-002 詳情' })).toContainText('4F 以上結構體施工計畫')

    // <lg:深連結進頁直接開抽屜(select(id, { openPane: true })),清單不用再點一次。
    // 抽屜是 dialog(aria-label=疑義詳情),該筆的 region 要在抽屜裡才算推入了詳情。
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoHash(page, '/dashboard?ball=mine')
    await mine.getByRole('listitem').filter({ hasText: 'RFI-002' }).getByRole('link').click()
    await expect(page).toHaveURL(/#\/rfi\?rfi=RFI-DEMO-2/)
    const drawer = page.getByRole('dialog', { name: '疑義詳情' })
    await expect(drawer.getByRole('region', { name: 'RFI-002 詳情' })).toContainText('3F 樑柱接頭鋼筋與機電套管衝突')
    await expect(drawer.getByRole('button', { name: '返回', exact: true })).toBeVisible()
  })

  test('路由守衛:監造進不了請款收款', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/payments')
    await expect(page.getByText('你的角色沒有此頁的存取權限')).toBeVisible()
  })
})
