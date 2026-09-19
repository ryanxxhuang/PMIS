// 施工廠商(陳怡君)動線:Dashboard 概況 → 施工日誌零輸入存檔 → 估驗建期送審。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

test.describe('施工廠商', () => {
  // Apple 改版(疊合版 IA):主畫面是收件匣不是 dashboard。四張指標卡依判準
  // 「不會被點、不會改變決定的數字一律刪」移除,金額改到 /boq 與 /valuation 看;
  // 三段待辦不再同時列出,改成球權 Segmented 一次聚焦一段。
  test('今日工作:球權三段各自聚焦(現在輪到我/等待對方/今天已完成)', async ({ page }) => {
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

  test('Agent 不再重複待辦清單,只留前往今日工作的入口', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/agent')
    await expect(page.getByRole('heading', { name: 'AI 草稿收件匣' })).toBeVisible()
    await expect(page.getByText('今日待我處理')).toHaveCount(0)
    const toTasks = page.getByRole('link', { name: /前往今日工作/ })
    await expect(toTasks).toBeVisible()
    await toTasks.click()
    await expect(page.getByRole('heading', { name: '今日工作' })).toBeVisible()
  })

  test('提醒中心與今日工作同一份來源,溢位看得到完整清單', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/alerts')
    await expect(page.getByRole('heading', { name: '提醒中心' })).toBeVisible()
    // 殼化後同一筆會在清單列與詳情欄各出現一次,斷言鎖在清單內(getByRole('listitem'))
    const list = page.getByRole('list', { name: '提醒清單' })
    await expect(list.getByRole('listitem').filter({ hasText: '第 5 期估驗計價送審' })).toHaveCount(1)
    // 首頁被 5 筆上限截掉的期限型待辦,在這裡看得到
    await expect(list.getByRole('listitem').filter({ hasText: /停留點|7天試驗|28天抗壓試驗/ }).first()).toBeVisible()
    // 詳情欄跟著預設選取渲染,唯一動作是「前往處理」(提醒不能在這頁完成)
    const detail = page.getByRole('region', { name: '提醒詳情' })
    await expect(detail.getByRole('button', { name: '前往處理', exact: true })).toBeVisible()
  })

  // P2c:施工日誌是「文件」——存檔=伺服器保存版本(demo 只進記憶體)、列出待補;簽署／提送需正式專案。
  // P3d 列印:有文件印簽署版本,未簽署印最新存檔版本並整張標「草稿・未簽署」;只有既有紀錄(demo 種子的昨天)印該列並標既有紀錄。
  test('施工日誌:複製昨日 → 存檔成版本並列待補 → 草稿與既有紀錄列印都標未簽署;示範模式不假裝可簽署／上傳', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/site-log')
    await expect(page.getByRole('status', { name: /保存狀態/ })).toHaveText('本日尚無日誌')
    // 今天(新日期)有「複製昨日」;帶入班組/機具/材料,來源標「沿用昨日」
    await page.getByRole('button', { name: /複製昨日/ }).click()
    await expect(page.getByText(/已帶入 .* 的班組/)).toBeVisible()
    await expect(page.getByRole('status', { name: /保存狀態/ })).toHaveText('未存檔')
    await page.getByRole('button', { name: '存檔', exact: true }).click()
    await expect(page.getByText('已存檔 ✓')).toBeVisible()
    await expect(page.getByRole('status', { name: /保存狀態/ })).toHaveText(/已存檔.*版本 1/)
    // 待補集中呈現(天氣／摘要／工項數量都還沒填),簽署要等補齊;示範模式沒有簽署與上傳
    await expect(page.getByText(/待補 \d+ 項/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '簽署此版本' })).toHaveCount(0)
    await expect(page.getByText('示範模式無法上傳照片').first()).toBeVisible()
    // 已存版本的草稿也能印:印最新存檔版本(版本 1)並整張標「草稿・未簽署」,不假裝是正式紀錄
    await page.getByRole('button', { name: /列印公定格式日誌/ }).click()
    const stamp = page.getByRole('group', { name: '文件版本與簽署' })
    await expect(stamp).toContainText('版本 1')
    await expect(stamp).toContainText('草稿・未簽署')
    await page.getByRole('button', { name: /返回施工日誌/ }).click()
    // 切到昨天(demo 種子的既有紀錄):可列印;既有紀錄以「待核對」帶入,列印標既有紀錄・未簽署(無版本與雜湊)
    const list = page.getByRole('group', { name: /施工日誌（/ })
    await list.getByRole('button', { name: /^\d{4}-\d{2}-\d{2}$/ }).nth(1).click()
    await expect(page.getByRole('status', { name: /保存狀態/ })).toHaveText(/既有紀錄/)
    await page.getByRole('button', { name: /列印公定格式日誌/ }).click()
    await expect(stamp).toContainText('既有紀錄（舊流程寫入，無文件版本與內容雜湊）')
    await expect(stamp).toContainText('草稿・未簽署')
  })

  // P3b:自主檢查表是「文件」——新建(選本案範本)→ 填實測值即時判定預覽 → 存檔成版本並列待補;示範模式不假裝可簽署。
  // 示範框架範本標示與免責聲明來自 fixture(對 migration 釘住);demo 種子的檢查表範本是 03310。
  test('自主檢查表:新建 → 填實測值(判定預覽)→ 存檔成版本並列待補;示範框架範本標示、示範模式不假裝可簽署', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/self-check')
    await expect(page.getByRole('heading', { level: 1, name: '自主檢查表' })).toBeVisible()
    const card = page.getByRole('group', { name: '新自主檢查表', exact: true })
    await expect(card.getByText('示範範本').first()).toBeVisible()
    await expect(card.getByRole('note')).toContainText('非任何機關公定或法定格式')
    await expect(page.getByRole('status', { name: /保存狀態/ })).toHaveText('尚未建立（新自主檢查表）')
    // demo 種子範本(03310)預設帶入,項目由範本帶出;填坍度 30 → 判定預覽不合格(超規);未填的項目仍待補
    await expect(card.getByRole('combobox', { name: '檢查表範本' })).toHaveValue(/./)
    await expect(card.getByRole('cell', { name: '坍度' })).toBeVisible()
    await card.getByRole('spinbutton', { name: 'C2 坍度 實測值' }).fill('30')
    await expect(card.getByText('判定預覽：不合格')).toBeVisible()
    await expect(page.getByRole('status', { name: /保存狀態/ })).toHaveText('未存檔')
    await page.getByRole('button', { name: '存檔', exact: true }).click()
    await expect(page.getByText(/已存檔 ✓ 版本 1，尚有 \d+ 項待補或待確認/)).toBeVisible()
    await expect(page).toHaveURL(/#\/self-check\?doc=/)
    await expect(page.getByRole('status', { name: /保存狀態/ })).toHaveText(/已存檔.*版本 1/)
    await expect(page.getByText(/待補 \d+ 項/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '簽署此版本' })).toHaveCount(0) // 待補未齊不給簽
    await expect(page.getByText('示範模式：草稿只存在本次瀏覽')).toBeVisible()
    // 右欄清單列出這份;/site 現場文書清單也可直達(不再標尚未支援)
    await expect(page.getByRole('group', { name: /自主檢查表（1）/ })).toBeVisible()
    await gotoHash(page, '/site')
    const docCard = page.getByRole('group', { name: '現場文書' })
    await expect(docCard.getByRole('link', { name: /自主檢查表/ })).toBeVisible()
    await expect(docCard.getByText(/尚未支援/)).toHaveCount(0)
  })

  test('品質:缺失改善鏈——切到缺失分段 → 開始改善 → 提送複查(W8-4A)', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/quality')
    // 預設分段是查驗;由分段控制切到「缺失」操作 demo 種子(佇列點擊走同一條路)
    await page.getByRole('group', { name: '品質分段' }).getByRole('button', { name: /缺失/ }).click()
    // 鎖定「3F 西側牆面蜂窩」(開立)那一列:缺失列是 DefectTracker 殼的 listitem,「現在要處理」
    // 佇列項是 button,所以 listitem 只會命中缺失列(與已轉殼的頁同一套定位法)。
    // 列只負責選取,動作在 region「缺失詳情」裡(規範 §9.8):先選中、證明詳情在顯示這一筆
    const row = page.getByRole('listitem').filter({ hasText: '3F 西側牆面蜂窩' })
    await row.click()
    const detail = page.getByRole('region', { name: '缺失詳情' })
    await expect(detail).toContainText('3F 西側牆面蜂窩')
    await detail.getByRole('button', { name: '開始改善', exact: true }).click()
    await expect(row.getByText('廠商改善中')).toBeVisible()
    // 提送複查走 appPrompt:改善說明必填
    await detail.getByRole('button', { name: '提送複查', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/提送複查：/)).toBeVisible()
    await dialog.locator('textarea').fill('已鑿除蜂窩並以無收縮水泥砂漿修補完成')
    await dialog.getByRole('button', { name: '提送複查', exact: true }).click()
    // 待複查=球轉監造(列的 BallChip 寫「待監造複查」;詳情欄動作列只剩等待文案、廠商改善說明顯示出來)
    await expect(row.getByText('待監造複查')).toBeVisible()
    // exact:詳情欄的狀態列 BallChip 也寫「⏳ 待監造複查」,這裡要的是動作列那句等待文案
    await expect(detail.getByText('待監造複查', { exact: true })).toBeVisible()
    await expect(detail).toContainText('已鑿除蜂窩並以無收縮水泥砂漿修補完成')
    await expect(detail.getByRole('button', { name: '提送複查', exact: true })).toHaveCount(0)
  })

  // 規範 §9.7 + §9.8:缺失待辦帶 ?defect=<id>;/quality 的預設分段是查驗,帶 query 進頁要自動落在
  // 「缺失」分段並選中那一筆(DEF-DEMO-2 不是預設選取——demo 順序第一筆是 DEF-DEMO-1)
  test('收件匣直達缺失:/quality?defect= 自動落在缺失分段並選中該筆;離開分段就拿掉 query', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/quality?defect=DEF-DEMO-2')
    const segments = page.getByRole('group', { name: '品質分段' })
    await expect(segments.getByRole('button', { name: /缺失/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('listitem').filter({ hasText: '3F 西側牆面蜂窩' })).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('listitem').filter({ hasText: '查驗不合格：外牆窯燒磚打樣' })).not.toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('region', { name: '缺失詳情' })).toContainText('3F 西側牆面蜂窩')
    // 換到查驗分段:URL 不再帶 ?defect=,切回缺失分段時殼才不會把它當深連結、<lg 又彈一次抽屜
    await segments.getByRole('button', { name: /查驗/ }).click()
    await expect(page).not.toHaveURL(/defect=/)
    await expect(page).toHaveURL(/#\/quality/)
  })

  // 規範 §9.8 第一條:工安缺失追蹤是清單＋詳情殼。開立 → 出現在清單 → 選中 → 狀態動作在詳情欄
  // → 快篩件數跟著變。廠商在 /safety 可自行開立(工安缺失不是自動開立的那種)。
  // 卡頭「開立缺失」與表單「送出缺失」改版前同名,這裡按名字就必須 exact。
  test('工安缺失套殼:開立 → 列出 → 選中 → 詳情內開始改善,快篩件數跟著變', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/safety')
    const tracker = page.getByRole('group', { name: /工安缺失追蹤/ })
    await expect(tracker.getByRole('button', { name: '待廠商改善 1', exact: true })).toBeVisible()
    await tracker.getByRole('button', { name: '開立缺失', exact: true }).click()
    await tracker.getByLabel('缺失標題').fill('E2E 安全網未掛設')
    await tracker.getByRole('button', { name: '送出缺失', exact: true }).click()
    const row = page.getByRole('listitem').filter({ hasText: 'E2E 安全網未掛設' })
    await expect(row).toBeVisible()
    await expect(tracker.getByRole('button', { name: '待廠商改善 2', exact: true })).toBeVisible()
    await row.click()
    await expect(row).toHaveAttribute('aria-current', 'true')
    const detail = page.getByRole('region', { name: '工安缺失詳情' })
    await expect(detail).toContainText('E2E 安全網未掛設')
    await detail.getByRole('button', { name: '開始改善', exact: true }).click()
    await expect(row.getByText('廠商改善中')).toBeVisible()
    await expect(tracker.getByRole('button', { name: '待廠商改善 1', exact: true })).toBeVisible()
    await expect(tracker.getByRole('button', { name: '廠商改善中 2', exact: true })).toBeVisible()
  })

  // 規範 §9.8 兩條的手機面:Stat 收成三格數字條後「開立缺失」留在第一屏(稽核量到 y=475);
  // 點列推入抽屜(dialog),狀態動作在抽屜裡的 region。視窗尺寸在登入前就設好——桌機載入後
  // 再縮窗,側欄等殼件的版面不會重算,量到的幾何不是手機的幾何。
  test('390:工安缺失的開立鈕在第一屏,點列推入抽屜且動作在抽屜裡', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'contractor')
    await gotoHash(page, '/safety')
    const tracker = page.getByRole('group', { name: /工安缺失追蹤/ })
    const openBtn = tracker.getByRole('button', { name: '開立缺失', exact: true })
    await expect(openBtn).toBeVisible()
    // 門檻 400 是規範 §9.8 的驗收值(改版前量到 475);量的是頂緣,與稽核同一個基準
    const box = await openBtn.boundingBox()
    expect(box.y, `開立缺失鈕頂緣 y=${box.y}px,不在第一屏`).toBeLessThan(400)
    // 預設選取不開抽屜(規範 §9.7:只有深連結才推入);先證明沒有 dialog,再點列
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('listitem').filter({ hasText: '4F 臨邊開口未設護欄' }).click()
    const drawer = page.getByRole('dialog', { name: '工安缺失詳情' })
    await expect(drawer.getByRole('region', { name: '工安缺失詳情' })).toContainText('4F 臨邊開口未設護欄')
    await expect(drawer.getByRole('button', { name: '開始改善', exact: true })).toBeVisible()
    await expect(drawer.getByRole('button', { name: '返回', exact: true })).toBeVisible()
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

  test('履約時程承接關鍵工項與停留點(P5d):近期／全期、待補設定篩選、逐期就地標記;/schedule 退場唯讀', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/requirements')
    const list = page.getByRole('list', { name: '履約義務時間軸' })
    // 摘要卡:關鍵工項與停留點的件數(demo 種子 10 項排程、5 個停留點),廠商有加入關鍵工項的搜尋
    const card = page.getByRole('group', { name: '關鍵工項與停留點' })
    await expect(card).toContainText('關鍵工項 10 項')
    await expect(card).toContainText('停留點 5 個')
    await expect(card.getByRole('textbox', { name: '加入關鍵工項' })).toBeVisible()
    // 近期視圖:落後的關鍵工項與該叫驗的 H 點與契約義務在同一條時間軸;預設選中仍是第一條逾期的義務
    const late = list.getByRole('listitem').filter({ hasText: '關鍵工項' }).filter({ hasText: '落後' }).first()
    await expect(late).toBeVisible()
    await expect(list.getByRole('listitem').filter({ hasText: '模板組立查驗（每層）' })).toContainText('施作中未申請查驗')
    await expect(list.getByRole('listitem').filter({ hasText: '第 5 期估驗計價送審' }).first()).toHaveAttribute('aria-current', 'true')
    // 關鍵工項詳情:計畫起迄在詳情維護(廠商),改日期即寫入 store(demo 走記憶體),列上的計畫迄跟著變
    await late.click()
    const finish = page.getByLabel('計畫完成日')
    await expect(finish).toBeVisible()
    await finish.fill('2099-12-31')
    // 該工項的列與掛在它上面的停留點(到期=工項計畫迄)都跟著變:兩列都看得到新日期
    await expect(list.getByRole('listitem').filter({ hasText: '關鍵工項' }).filter({ hasText: '2099-12-31' })).toHaveCount(1)
    await expect(list.getByRole('listitem').filter({ hasText: '停留點' }).filter({ hasText: '2099-12-31' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: '移除關鍵工項' })).toBeVisible()
    // 待補設定篩選:demo 種子沒有缺口 → 任一待補設定 0 件、清單空
    await page.getByRole('combobox', { name: '待補設定' }).selectOption('any')
    await expect(list.getByRole('listitem')).toHaveCount(0)
    await page.getByRole('button', { name: '清除篩選' }).click()
    // 全期:依期程分段,一年後的保固義務也在
    await page.getByRole('tab', { name: /全期/ }).click()
    await expect(list.getByText('保固期', { exact: true }).first()).toBeVisible() // 分段標題(列的階段字也會命中)
    await expect(list.getByRole('listitem').filter({ hasText: '一般工項保固期滿' })).toBeVisible()
    // 循環義務逐期就地標記(不再導到期限追蹤):本期標記完成可掛佐證,期次列翻成已完成
    await list.getByRole('listitem').filter({ hasText: '提送施工月報' }).first().click()
    await expect(page.getByRole('button', { name: '到期限追蹤逐期標記' })).toHaveCount(0)
    await page.getByRole('button', { name: /^標記 \d{4}-\d{2} 期完成$/ }).first().click()
    await page.getByRole('combobox', { name: /期佐證送審文件$/ }).selectOption('SUB-DEMO-3')
    await page.getByRole('button', { name: '掛佐證並標記完成', exact: true }).click()
    await expect(page.getByRole('button', { name: /^退回 \d{4}-\d{2} 期待辦$/ }).first()).toBeVisible()
    await expect(page.getByText(/逐期準時率 \d+%/)).toBeVisible()
    // /schedule:hidden(側欄沒有入口),廠商深連結仍可達但唯讀——沒有輸入框、沒有加入／移除,只剩 CSV 與指路
    await gotoHash(page, '/schedule')
    await expect(page.getByRole('heading', { level: 1, name: '逐工項排程' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '主要功能' }).getByRole('link', { name: '逐工項排程', exact: true })).toHaveCount(0)
    await expect(page.getByRole('note')).toContainText('已退出新作業')
    const main = page.getByRole('main')
    await expect(main.getByRole('table', { name: '逐工項排程' })).toBeVisible()
    await expect(main.getByRole('button', { name: /^CSV/ })).toBeVisible()
    await expect(main.locator('input')).toHaveCount(0)
    await expect(main.getByRole('button', { name: /移除/ })).toHaveCount(0)
    // 剛改的計畫迄在退場頁同一份資料看得到(同一個 store、同一條推導)
    await expect(main.getByRole('table', { name: '逐工項排程' })).toContainText('2099-12-31')
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
    // P4c:建期必填計價截止日(Q7),對話框預填今天;確認後才建期
    const dialog = page.getByRole('dialog', { name: /建立第 6 期估驗/ })
    await expect(dialog.getByLabel(/計價截止日/)).toHaveValue(/\d{4}-\d{2}-\d{2}/)
    await dialog.getByRole('button', { name: '建立估驗期' }).click()
    // 新一期建立、成為選中頁籤、狀態草稿
    const tab6 = page.getByRole('button', { name: /第 6 期/ })
    await expect(tab6).toBeVisible()
    await expect(tab6.getByText('草稿')).toBeVisible()
    await expect(page.getByText('計價截止日', { exact: false }).first()).toBeVisible()
    // demo 沒有監造確認資料:可估驗清單與缺件卡都明講,不假裝後端核對通過;沒有「帶入日誌累計」這條舊路徑
    await expect(page.getByText('示範模式沒有監造確認資料', { exact: false })).toBeVisible()
    await expect(page.getByText(/示範資料:估驗數量未經後端監造確認量核對/)).toBeVisible()
    await expect(page.getByRole('button', { name: /帶入日誌累計/ })).toHaveCount(0)
    await page.getByRole('button', { name: '送監造審核' }).click()
    await expect(tab6.getByText('監造審核')).toBeVisible()
    // 施工角色送審後只能等監造(不出現核定鈕)
    await expect(page.getByText('待監造核定')).toBeVisible()
  })
})
