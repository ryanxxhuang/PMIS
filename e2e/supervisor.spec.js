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

  // P6b-3:「合格／不合格」快速判定退場——判定只經監造查驗表單(判定＋本次確認數量,簽署即判定並寫入可估驗的確認量;
  // 不合格由 DB 在簽署交易內開缺失,真後端 chain 10 走完)。示範模式不能簽署,這裡只釘住「沒有第二條判定路」與入口。
  test('查驗:詳情只有「以監造查驗表單判定」,沒有快速判定;入口直達該查驗的表單草稿', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/quality')
    // 清單＋詳情殼:列只負責選取,動作在詳情欄。先選中「4F 柱牆鋼筋查驗」那一列(查驗列是 listitem)
    const row = page.getByRole('listitem').filter({ hasText: '4F 柱牆鋼筋查驗' })
    await row.click()
    const detail = page.getByRole('region', { name: '4F 柱牆鋼筋查驗 詳情' })
    await expect(detail.getByRole('button', { name: '合格', exact: true })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: '不合格', exact: true })).toHaveCount(0)
    await expect(detail.getByText('快速判定不計確認數量')).toHaveCount(0)
    await detail.getByRole('button', { name: /以監造查驗表單判定/ }).click()
    await expect(page).toHaveURL(/#\/inspection-form\?/)
    await expect(page.getByRole('heading', { level: 1, name: '監造查驗表單' })).toBeVisible()
    // 舊流程快速判定的查驗照常列在清單(判定不變),詳情標「舊流程快速判定,未填確認數量」
    await gotoHash(page, '/quality')
    const legacy = page.getByRole('listitem').filter({ hasText: '3F 柱牆鋼筋查驗' })
    await legacy.click()
    await expect(page.getByRole('region', { name: '3F 柱牆鋼筋查驗 詳情' })).toContainText('舊流程快速判定，未填確認數量')
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
    await expect(page.getByRole('button', { name: '簽署此版本' })).toHaveCount(0) // U-01:不給死按鈕——簽署與上傳都是廠商的事(P2c)
    await expect(page.getByLabel('選擇照片上傳')).toHaveCount(0)
    // 切到 demo 種子最近一筆日誌(右欄清單第一筆=昨天),摘要直接顯示該日內容
    const list = page.getByRole('group', { name: /施工日誌（/ })
    await list.getByRole('button', { name: /^\d{4}-\d{2}-\d{2}$/ }).first().click()
    const card = page.getByRole('group', { name: '本日日誌', exact: true })
    await expect(card.getByText('4F 版牆混凝土澆置、養護')).toBeVisible() // demoSeed 最近一筆(-1 天)的工作摘要
    await expect(page.getByRole('button', { name: '列印公定格式日誌' })).toBeVisible()
    // 有日誌的日期一樣是純文字摘要,不會長出可編欄位
    await expect(page.locator('input:not([type="date"])')).toHaveCount(0)
  })

  // P3a 監造日誌頁(示範模式):監造可達、範本標「示範範本」、到場人員要親自確認(人填≠確認)、
  // 存檔後草稿只在本次瀏覽;簽署回「示範模式無法簽署」不假裝已簽(沒有雜湊／簽署者／伺服器時間可核對)。
  test('監造日誌:示範範本標示、到場人員親自確認後才可簽;示範模式不假裝可簽署', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/supervisor-log')
    await expect(page.getByRole('heading', { level: 1, name: '監造日誌' })).toBeVisible()
    const card = page.getByRole('group', { name: '本日監造日誌', exact: true })
    await expect(card.getByText('示範範本').first()).toBeVisible()
    await expect(card.getByRole('note')).toContainText('非任何機關公定或法定格式')
    await expect(page.getByRole('status', { name: /保存狀態/ })).toHaveText('本日尚無監造日誌')
    await expect(page.getByText(/待補 \d+ 項/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '簽署此版本' })).toHaveCount(0)
    // 到場:帶入本人 → 「已填・待親自確認」仍在待補;確認後離開待補
    await card.getByRole('button', { name: '帶入本人' }).click()
    await expect(card.getByText('已填・待親自確認')).toBeVisible()
    await expect(card.getByText(/到場人員與時段（待親自確認）/)).toBeVisible()
    await card.getByRole('button', { name: '確認到場人員' }).click()
    await expect(card.getByText(/到場人員與時段（待親自確認）/)).toHaveCount(0)
    // 天氣、監造事項、廠商施工情形補齊 → 存檔成版本 1、可簽署
    await page.getByRole('textbox', { name: '天氣(上午)' }).fill('晴')
    await page.getByRole('textbox', { name: '天氣(下午)' }).fill('晴')
    await card.getByRole('button', { name: '加一項監造事項' }).click()
    await page.getByLabel('監造事項 1 內容').fill('抽查 4F 版牆鋼筋綁紮')
    await page.getByRole('textbox', { name: '施工情形摘要' }).fill('4F 版牆混凝土澆置 120 M3')
    await page.getByRole('button', { name: '存檔', exact: true }).click()
    await expect(page.getByText(/已存檔 ✓ 版本 1，可簽署/)).toBeVisible()
    await expect(page.getByText('示範模式：草稿只存在本次瀏覽')).toBeVisible()
    // 示範模式簽署:按下去回明確訊息,不會出現「已由 … 簽署」
    const lifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
    await expect(lifecycle.getByText(/本人確認 .* 監造日誌\(版本 1,內容雜湊/)).toBeVisible()
    await lifecycle.getByRole('button', { name: '簽署此版本' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '簽署', exact: true }).click()
    await expect(lifecycle.getByText(/示範模式無法簽署／提送/)).toBeVisible()
    await expect(lifecycle.getByText(/已由 .* 簽署/)).toHaveCount(0)
    // 375:整頁無水平溢位(到場列、監造事項列在窄版面自己折行)。從桌機縮到手機時側欄有 300ms 收合過場,
    // 量到的可能是動畫中間值 → poll 到落定(與 a11y.spec 量側欄寬同一做法),不是放寬斷言。
    await page.setViewportSize({ width: 375, height: 812 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), { timeout: 5_000 }).toBe(true)
  })

  // P3c:監造查驗表單是「文件」——由待查驗申請建立、查驗申請資料帶入待核對、判定與本次確認數量親自填、存檔成版本;
  // 示範範本標示與免責聲明來自 fixture(對 migration 釘住);示範模式不假裝可簽署。demo 種子 INSP-DEMO-4「4F 柱牆鋼筋查驗」待查驗。
  test('監造查驗表單:由待查驗申請建立 → 核對申請資料、判部分合格、填確認數量 → 存檔成版本;示範範本標示、示範模式不假裝可簽署', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/inspection-form')
    await expect(page.getByRole('heading', { level: 1, name: '監造查驗表單' })).toBeVisible()
    const newCard = page.getByRole('group', { name: '建立監造查驗表單', exact: true })
    await expect(newCard.getByText('示範範本').first()).toBeVisible()
    await expect(newCard.getByRole('note')).toContainText('非任何機關公定或法定格式')
    await expect(page.getByRole('status', { name: /保存狀態/ })).toHaveText('尚未選擇查驗申請')
    await newCard.getByRole('combobox', { name: '待查驗的申請' }).selectOption({ label: '4F 柱牆鋼筋查驗（4F）' })
    await newCard.getByRole('button', { name: '建立表單' }).click()
    await expect(page).toHaveURL(/#\/inspection-form\?doc=/)
    const card = page.getByRole('group', { name: '本份監造查驗表單', exact: true })
    await expect(card.getByRole('link', { name: '4F 柱牆鋼筋查驗' })).toBeVisible()
    // 查驗申請帶入的位置要核對確認;申報量示範種子沒有 → 待補;判定與確認量待補
    await expect(page.getByText(/待補 \d+ 項/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '簽署此版本' })).toHaveCount(0)
    while (await page.getByRole('button', { name: '確認', exact: true }).count()) await page.getByRole('button', { name: '確認', exact: true }).first().click()
    await page.getByRole('spinbutton', { name: '申報數量' }).fill('10')
    await page.getByRole('radio', { name: '部分合格' }).check()
    await page.getByRole('spinbutton', { name: '本次確認數量' }).fill('6')
    const qtyBox = page.getByRole('group', { name: '確認數量' })
    await expect(qtyBox).toContainText('申報數量')
    await expect(qtyBox).toContainText('本次確認')
    await expect(page.getByRole('alert', { name: '判定與確認數量檢查' })).toContainText('必須填寫判定說明')
    await page.getByRole('textbox', { name: '判定說明' }).fill('主筋間距超出容許值,局部拆除重綁')
    await expect(page.getByRole('alert', { name: '判定與確認數量檢查' })).toHaveCount(0)
    await page.getByRole('button', { name: '存檔', exact: true }).click()
    await expect(page.getByText(/已存檔 ✓ 版本 1，可簽署/)).toBeVisible()
    await expect(page.getByText('示範模式：草稿只存在本次瀏覽')).toBeVisible()
    const lifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
    await expect(lifecycle.getByRole('note')).toContainText('可估驗的依據')
    await lifecycle.getByRole('button', { name: '簽署此版本' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '簽署', exact: true }).click()
    await expect(lifecycle.getByText(/示範模式無法簽署／提送/)).toBeVisible()
    await expect(lifecycle.getByText(/已由 .* 簽署/)).toHaveCount(0)
    // 右欄清單列出這份(另兩份是 demo 種子的示範已簽署表單,O2);/site 現場文書清單可直達;品質查驗詳情有「監造查驗表單」入口
    await expect(page.getByRole('group', { name: /監造查驗表單（3）/ })).toBeVisible()
    await gotoHash(page, '/site')
    const docCard = page.getByRole('group', { name: '現場文書' })
    await expect(docCard.getByRole('link', { name: /監造查驗表單/ }).first()).toBeVisible()
    await expect(docCard.getByText(/尚未支援/)).toHaveCount(0)
    await gotoHash(page, '/quality')
    // lazy 路由切換時舊頁(現場文書清單的 li)仍在 DOM,鎖到查驗紀錄清單內的列
    await page.getByRole('list', { name: '查驗紀錄' }).getByRole('listitem').filter({ hasText: '4F 柱牆鋼筋查驗' }).click()
    await expect(page.getByRole('region', { name: '4F 柱牆鋼筋查驗 詳情' }).getByRole('button', { name: /監造查驗表單（版本 1）/ })).toBeVisible()
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoHash(page, '/inspection-form')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), { timeout: 5_000 }).toBe(true)
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
