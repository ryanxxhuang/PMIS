// 施工廠商(陳怡君)動線:Dashboard 概況 → 施工日誌零輸入存檔 → 估驗建期送審。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

test.describe('施工廠商', () => {
  test('今日待辦:進度摘要與三段待辦(現在輪到我/等待對方/今天已完成)', async ({ page }) => {
    await loginAs(page, 'contractor')
    await expect(page.getByText('累計實際進度')).toBeVisible()
    await expect(page.getByText('發包工程費')).toBeVisible()
    for (const section of ['現在輪到我', '等待對方', '今天已完成']) {
      await expect(page.getByRole('heading', { name: section })).toBeVisible()
    }
    // 期限型待辦已進首頁:OB-6 契約義務(demoSeed 的 fixed_date 相對今天往前推)。
    // 逾期天數一定要綁在這一筆上斷言:demo 有多筆待辦會落在同一個到期日,
    // 全頁 getByText(/逾期 N 天/) 會同時命中別筆而觸發 strict mode violation。
    // 天數本身不寫死——demoSeed 以機器本地時鐘產日期,todayTasks 以台北日曆日判斷,
    // UTC 機器跑在台北的隔天時會多算一天(UTC 4 天 / Taipei 3 天),寫死就會隨時區紅。
    const overdueObligation = page.getByRole('link').filter({ hasText: '第 5 期估驗計價送審' })
    await expect(overdueObligation).toHaveCount(1) // 標題必須唯一命中,否則就是又出現重複入口
    await expect(overdueObligation).toContainText(/逾期 \d+ 天（到期 \d{4}-\d{2}-\d{2}）/)
    // 等待對方只列直接相關的對手項:SUB-003 球在監造
    await expect(page.getByText(/SUB-003/)).toBeVisible()
  })

  test('Agent 不再重複待辦清單,只留前往今日待辦的入口', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/agent')
    await expect(page.getByRole('heading', { name: 'AI 草稿收件匣' })).toBeVisible()
    await expect(page.getByText('今日待我處理')).toHaveCount(0)
    const toTasks = page.getByRole('link', { name: /前往今日待辦/ })
    await expect(toTasks).toBeVisible()
    await toTasks.click()
    await expect(page.getByRole('heading', { name: '今日待辦' })).toBeVisible()
  })

  test('提醒中心與今日待辦同一份來源,溢位看得到完整清單', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/alerts')
    await expect(page.getByRole('heading', { name: /現在輪到我/ })).toBeVisible()
    await expect(page.getByText('第 5 期估驗計價送審')).toBeVisible()
    // 首頁被 5 筆上限截掉的期限型待辦,在這裡看得到
    await expect(page.getByText(/停留點|7天試驗|28天抗壓試驗/).first()).toBeVisible()
  })

  test('施工日誌:複製昨日 → 存檔 → 列印鈕/照片區解鎖', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/site-log')
    // 今天(新日期)有「複製昨日」;帶入班組/機具/材料
    await page.getByRole('button', { name: /複製昨日/ }).click()
    await expect(page.getByText(/已帶入 .* 的班組/)).toBeVisible()
    await page.getByRole('button', { name: '存檔', exact: true }).click()
    await expect(page.getByText('已存檔 ✓')).toBeVisible()
    // 跨元件同步:列印鈕出現、照片區解鎖(P-01 tracked store 的回歸點)
    await expect(page.getByRole('button', { name: /列印公定格式日誌/ })).toBeVisible()
    await expect(page.getByText('選照片 AI 辨識後上傳', { exact: true })).toBeVisible() // P0 #11 改名:區分「選檔辨識」與「辨識已上傳」兩條路
  })

  test('品質:缺失改善鏈——切到缺失分段 → 開始改善 → 提送複查(W8-4A)', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/quality')
    // 預設分段是查驗;由分段控制切到「缺失」操作 demo 種子(佇列點擊走同一條路)
    await page.getByRole('group', { name: '品質分段' }).getByRole('button', { name: /缺失/ }).click()
    // 鎖定「3F 西側牆面蜂窩」(開立)那一列:佇列項是 button 不含 justify-between div,
    // 此 xpath 只會命中 DefectTracker 的缺失列
    const row = page.getByText('3F 西側牆面蜂窩')
      .locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')
    await row.getByRole('button', { name: '開始改善' }).click()
    await expect(row.getByText('廠商改善中')).toBeVisible()
    // 提送複查走 appPrompt:改善說明必填
    await row.getByRole('button', { name: '提送複查' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/提送複查：/)).toBeVisible()
    await dialog.locator('textarea').fill('已鑿除蜂窩並以無收縮水泥砂漿修補完成')
    await dialog.getByRole('button', { name: '提送複查' }).click()
    // 待複查=球轉監造(BallChip 與狀態列都寫「待監造複查」)
    await expect(row.getByText('待監造複查').first()).toBeVisible()
  })

  test('契約義務:標為已提送可掛送審佐證(W-01)', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/contract')
    // demo 預掛佐證:品質計畫義務 → SUB-001(核准)
    await expect(page.getByText(/佐證:SUB-001/)).toBeVisible()
    // 對「提送施工月報」(待辦)掛 SUB-003 佐證並標為已提送
    const card = page.getByText('提送施工月報')
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
    await card.getByRole('button', { name: '標為已提送' }).click()
    await card.getByRole('combobox').selectOption('SUB-DEMO-3')
    await card.getByRole('button', { name: '掛佐證並標為已提送' }).click()
    await expect(card.getByText(/佐證:SUB-003/)).toBeVisible()
    await expect(card.getByRole('button', { name: '已提送 ✓' })).toBeVisible()
  })

  test('估驗:新增估驗期 → 送監造審核', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/valuation')
    await expect(page.getByRole('button', { name: /第 5 期/ })).toBeVisible()
    await page.getByRole('button', { name: '＋ 新增估驗期' }).click()
    // 新一期建立、成為選中頁籤、狀態草稿
    const tab6 = page.getByRole('button', { name: /第 6 期/ })
    await expect(tab6).toBeVisible()
    await expect(tab6.getByText('草稿')).toBeVisible()
    await page.getByRole('button', { name: '送監造審核' }).click()
    await expect(tab6.getByText('監造審核')).toBeVisible()
    // 施工角色送審後只能等監造(不出現核定鈕)
    await expect(page.getByText('待監造核定')).toBeVisible()
  })
})
