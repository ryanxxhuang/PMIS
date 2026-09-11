// 施工廠商(陳怡君)動線:Dashboard 概況 → 施工日誌零輸入存檔 → 估驗建期送審。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

test.describe('施工廠商', () => {
  // Apple 改版(疊合版 IA):主畫面是收件匣不是 dashboard。四張指標卡依判準
  // 「不會被點、不會改變決定的數字一律刪」移除,金額改到 /boq 與 /valuation 看;
  // 三段待辦不再同時列出,改成球權 Segmented 一次聚焦一段。
  test('今日待辦:球權三段各自聚焦(現在輪到我/等待對方/今天已完成)', async ({ page }) => {
    await loginAs(page, 'contractor')
    // 指標卡已退場:再出現代表有人把「多放一點資訊比較安全」加回來了
    await expect(page.getByText('累計實際進度')).toHaveCount(0)
    await expect(page.getByText('發包工程費')).toHaveCount(0)
    // 預設落在「現在輪到我」,另外兩段要切才看得到(一次一件事)
    const balls = page.getByRole('tablist', { name: '球在誰手上' })
    await expect(balls.getByRole('tab', { name: /現在輪到我/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: '現在輪到我' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '等待對方' })).toHaveCount(0)
    // 期限型待辦已進首頁:OB-6 契約期限(demoSeed 的 fixed_date 相對今天往前推)。
    // 逾期天數一定要綁在這一筆上斷言:demo 有多筆待辦會落在同一個到期日,
    // 全頁 getByText(/逾期 N 天/) 會同時命中別筆而觸發 strict mode violation。
    // 天數本身不寫死——demoSeed 以機器本地時鐘產日期,todayTasks 以台北日曆日判斷,
    // UTC 機器跑在台北的隔天時會多算一天(UTC 4 天 / Taipei 3 天),寫死就會隨時區紅。
    const overdueObligation = page.getByRole('link').filter({ hasText: '第 5 期估驗計價送審' })
    await expect(overdueObligation).toHaveCount(1) // 標題必須唯一命中,否則就是又出現重複入口
    await expect(overdueObligation).toContainText(/逾期 \d+ 天（到期 \d{4}-\d{2}-\d{2}）/)
    // 切到「等待對方」才看得到對手項:SUB-003 球在監造
    await balls.getByRole('tab', { name: /等待對方/ }).click()
    await expect(page.getByRole('heading', { name: '等待對方' })).toBeVisible()
    await expect(page.getByText(/SUB-003/)).toBeVisible()
    await expect(page.getByRole('heading', { name: '現在輪到我' })).toHaveCount(0)
  })

  // 規範 §9.7:契約期限待辦帶 ?obligation=<id>,落在 /deadlines 就是該筆的詳情。
  // OB-6(第 5 期估驗計價送審)是 demo 唯一穩定逾期的廠商義務;它同時也是該頁的預設
  // 選取,所以 URL 帶 query 是這條的關鍵斷言,region 只證明落地後詳情真的在。
  test('收件匣直達那一筆:契約期限落在 /deadlines 且該筆已選中', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/dashboard?ball=mine')
    const mine = page.getByRole('group', { name: '現在輪到我', exact: true })
    await mine.getByRole('listitem').filter({ hasText: '第 5 期估驗計價送審' }).getByRole('link').click()
    await expect(page).toHaveURL(/#\/deadlines\?obligation=OB-6/)
    await expect(page.getByRole('listitem').filter({ hasText: '第 5 期估驗計價送審' })).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('region', { name: '第 5 期估驗計價送審 詳情' })).toBeVisible()
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
    // 鎖定「3F 西側牆面蜂窩」(開立)那一列:缺失列是 DefectTracker 的 <li>,「現在要處理」
    // 佇列項是 button,所以 listitem 只會命中缺失列(與已轉殼的五頁同一套定位法)
    const row = page.getByRole('listitem').filter({ hasText: '3F 西側牆面蜂窩' })
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

  test('契約重點 · 履約時程:義務排上時程,廠商只看自己、動作看歸屬', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/requirements')
    // 義務直接排在時間軸上(不再收在摘要條下拉),含倒數與狀態色票
    await expect(page.getByText('提送施工月報').first()).toBeVisible()
    // 廠商只看自己:履約執行卡一張、無責任方篩選、監造義務不可見
    await expect(page.getByText('條義務')).toHaveCount(1)
    await expect(page.getByLabel('責任方')).toHaveCount(0)
    await expect(page.getByText('提送監造月報')).toHaveCount(0)
    // 預設選中第一條已逾期(OB-6 fixed_date 相對今天往前推),詳情動作列=標記完成
    const row = page.getByRole('listitem').filter({ hasText: '第 5 期估驗計價送審' }).first()
    await expect(row).toHaveAttribute('aria-current', 'true')
    await expect(row.getByText(/逾期 \d+ 日/)).toBeVisible()
    await expect(page.getByRole('button', { name: '標記完成' })).toBeVisible()
  })

  test('履約時程 → 擷取審核:審核流程遷出後入口不斷鏈', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/requirements')
    await page.getByRole('link', { name: /擷取審核/ }).click()
    await expect(page.getByRole('heading', { name: '擷取審核', exact: true })).toBeVisible()
    // 返回連結回履約時程
    await page.getByRole('link', { name: /返回履約時程/ }).click()
    await expect(page.getByText('履約期程').first()).toBeVisible()
  })

  test('履約時程:標記完成即時反映執行卡與狀態,取消完成可回復', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/requirements')
    const row = page.getByRole('listitem').filter({ hasText: '第 5 期估驗計價送審' }).first()
    await expect(row).toHaveAttribute('aria-current', 'true')
    await page.getByRole('button', { name: '標記完成' }).click()
    // 倒數欄與狀態色票都寫「已完成」——兩個都在才是整列翻面,取 first 避免 strict 衝突
    await expect(row.getByText('已完成').first()).toBeVisible()
    // 動作列翻成取消完成;按下回復待辦(demo 走記憶體,不打 DB)
    await page.getByRole('button', { name: '取消完成' }).click()
    await expect(page.getByRole('button', { name: '標記完成' })).toBeVisible()
  })

  test('期限追蹤:標為已提送可掛送審佐證(W-01)', async ({ page }) => {
    await loginAs(page, 'contractor')
    // 契約重點改版後,逐項期限管理(標為已提送/佐證)在獨立的期限追蹤頁
    await gotoHash(page, '/deadlines')
    // 清單＋詳情殼:列只負責選取,佐證 Badge、挑選器與動作全在詳情欄(region 以義務
    // 標題命名——找得到這個 region 就證明詳情欄正在顯示這一筆)。定位走 role/文字,
    // 不綁視覺 class。按鈕名一律 exact:「直接標為已提送」含「標為已提送」子字串
    const row = (title) => page.getByRole('listitem').filter({ hasText: title })
    const detail = (title) => page.getByRole('region', { name: `${title} 詳情` })
    // demo 預掛佐證:品質計畫義務 → SUB-001(核准);選中後佐證 Badge 在詳情欄
    await row('提送品質計畫書').click()
    await expect(detail('提送品質計畫書').getByText(/佐證:SUB-001/)).toBeVisible()
    // 對「提送施工月報」(待辦)掛 SUB-003 佐證並標為已提送
    await row('提送施工月報').click()
    await expect(row('提送施工月報')).toHaveAttribute('aria-current', 'true')
    const d = detail('提送施工月報')
    await d.getByRole('button', { name: '標為已提送', exact: true }).click()
    await d.getByRole('combobox', { name: '佐證送審文件' }).selectOption('SUB-DEMO-3')
    await d.getByRole('button', { name: '掛佐證並標為已提送', exact: true }).click()
    await expect(d.getByText(/佐證:SUB-003/)).toBeVisible()
    await expect(d.getByRole('button', { name: '已提送 ✓', exact: true })).toBeVisible()
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
