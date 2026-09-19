// 機關(李淑芬)動線:落地收件匣、從側欄「專案」到跨案總覽(選案清單)→ 核准變更設計 →
// 變更後契約金額跨頁一致(B-02)→ 估驗頁的缺件與檢核 → 廠商成本頁被擋 → 404 頁。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

// demoSeed:原發包 721,364,067;CO-001 已核准 +1,260,000;CO-002 審核中 +1,764,000。
// 核准 CO-002 後變更後契約金額 = 724,388,067——三頁必須同一個數字(B-02 回歸)。
const REVISED_AFTER_CO2 = '724,388,067'

test.describe('機關', () => {
  test('登入落在今日工作(收件匣);跨案總覽從側欄「專案」子頁可達,風險稽核 hidden 但機關仍可直達', async ({ page }) => {
    await loginAs(page, 'owner')
    await expect(page.getByRole('heading', { name: '今日工作' })).toBeVisible()
    // 落地不依角色分流(規範 §0 方向 A):多案角色要看跨案總覽,從「專案」群組一格就到
    const nav = page.getByRole('navigation', { name: '主要功能' })
    await nav.getByRole('button', { name: '展開專案子頁' }).click()
    // D-026 退場:風險稽核不進側欄(hidden),roles: owner 不變——深連結仍限機關(廠商被擋見 routes.spec)
    await expect(nav.getByRole('link', { name: '風險稽核', exact: true })).toHaveCount(0)
    await nav.getByRole('link', { name: '跨案總覽', exact: true }).click()
    await expect(page.getByRole('heading', { name: '跨案總覽' })).toBeVisible()
    // 縮為選案清單(D-026 P1b):本案＋兩個示範姊妹案各一列,整列可點;統計/例外帶不再出現
    const list = page.getByRole('list', { name: '專案清單' })
    await expect(list.getByRole('listitem')).toHaveCount(3)
    await expect(list.getByRole('listitem').first()).toContainText('目前專案')
    await expect(list.getByRole('listitem').nth(1)).toContainText('B 區道路改善工程')
    await expect(page.getByText(/各案均無未結例外|累計估驗/)).toHaveCount(0)
    await gotoHash(page, '/audit')
    await expect(page.getByRole('heading', { name: '風險稽核' })).toBeVisible()
    await expect(page.getByRole('note')).toContainText('已退場')
    await page.goto('/')
    await expect(page).toHaveURL(/#\/dashboard/)
  })

  test('核准變更設計 → 變更後契約金額跨頁一致(B-02)', async ({ page }) => {
    await loginAs(page, 'owner')
    await gotoHash(page, '/change-orders')
    // 改版後兩段分群是快篩 chip(不再是區段標題):「待核定 1」帶件數,機關進來第一眼
    // 就看到還有幾筆要核(W8-4C C1)。件數會隨劇本變,用 ^ 錨定標籤
    await expect(page.getByRole('button', { name: /^待核定/ })).toBeVisible()
    // 列只負責選取、核定動作全在詳情欄:先選中 CO-002,再在以編號命名的 region
    // (「CO-002 詳情」)裡按「核准」(機關 can.ratify;監造只剩受理審查/退回,
    // 核准/駁回=機關專屬,D-016)。定位一律走 role / aria-label / 文字,不綁視覺 class
    const row = page.getByRole('listitem').filter({ hasText: 'CO-002' })
    await row.click()
    await expect(row).toHaveAttribute('aria-current', 'true')
    const d2 = page.getByRole('region', { name: 'CO-002 詳情' })
    // 明細表真的在詳情欄裡(減帳與追加各一列),不是空面板
    await expect(d2.getByText('花崗石地坪（新增）')).toBeVisible()
    // 按鈕名一律 exact:快篩 chip「已核定／已結 1」會被子字串比對吃成按鈕名
    await d2.getByRole('button', { name: '核准', exact: true }).click()
    // 核定是不可逆的正式動作(UIUX 階段 5B):確認框指向明確單據與淨額,取消不改狀態
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('核准 CO-002？')).toBeVisible()
    await expect(dialog.getByText(/核准後變更後契約金額將為/)).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(row.getByText('審核中', { exact: true })).toBeVisible()
    await d2.getByRole('button', { name: '核准', exact: true }).click()
    await dialog.getByRole('button', { name: '核准', exact: true }).click()
    // 清單列的狀態章即時翻成核准、核准鈕消失(不是只有彙總數字變)
    await expect(row.getByText('核准', { exact: true })).toBeVisible()
    await expect(d2.getByRole('button', { name: '核准', exact: true })).toHaveCount(0)
    // 本頁彙總即時更新
    await expect(page.getByText(`NT$ ${REVISED_AFTER_CO2}`).first()).toBeVisible()
    // 跨頁一致:估驗頁分母、Dashboard 發包工程費都是同一個數字
    await gotoHash(page, '/valuation')
    await expect(page.getByText(/變更後契約金額 7\.24 億/)).toBeVisible()
    // Apple 改版後首頁不再放指標卡(判準:不會被點的數字一律刪),跨案總覽也縮為選案清單不再列金額,
    // 第三個面改用施工月報——它同吃 store 的 revisedTotal(財務單一真相層 B-02)。
    await gotoHash(page, '/monthly-report')
    await expect(page.getByText(`NT$ ${REVISED_AFTER_CO2}`).first()).toBeVisible()
  })

  test('今日工作:機關拿得到驗收法定期限,拿不到廠商責任的事', async ({ page }) => {
    await loginAs(page, 'owner')
    await gotoHash(page, '/dashboard')
    // demoSeed:報竣 -28、竣工確認 -25 → 初驗法定 30 日內,期限將至
    const mine = page.getByRole('group', { name: '現在輪到我', exact: true })
    await expect(mine.getByText('初驗期限將至')).toBeVisible()
    // 廠商責任的契約義務不得變成機關做不到的假待辦(AI 觀察那一行仍可提醒,但不是待辦)
    await expect(mine.getByText('第 5 期估驗計價送審')).toHaveCount(0)
    await expect(page.getByText('第 5 期估驗計價送審')).toHaveCount(1)
    // 提醒中心仍可深連結(W7 路由治理不回退),且吃同一份聚合
    await gotoHash(page, '/alerts')
    await expect(page.getByRole('heading', { name: '提醒中心' })).toBeVisible()
    // 殼化後同一筆會在清單列與詳情欄各出現一次,斷言鎖在清單內
    await expect(page.getByRole('list', { name: '提醒清單' }).getByRole('listitem').filter({ hasText: '初驗期限將至' })).toHaveCount(1)
  })

  test('風險稽核:清單＋詳情殼——嚴重度快篩、詳情欄判定依據與對應工項;AI 稽核意見已退場(P6c)', async ({ page }) => {
    await loginAs(page, 'owner')
    await gotoHash(page, '/audit')
    await expect(page.getByRole('heading', { name: '風險稽核' })).toBeVisible()
    // 檢核表與勾稽發現混成一份清單,嚴重度是快篩 chip(帶件數,件數隨劇本變,用 ^ 錨定標籤)
    await expect(page.getByRole('button', { name: /^風險/ })).toBeVisible()
    const rows = page.getByRole('list', { name: '稽核項目' }).getByRole('listitem')
    await expect(rows.first()).toBeVisible()
    // 開頁預設選最嚴重的一項;詳情欄是以標題命名的 region,判定依據完整顯示在裡面
    await expect(rows.first()).toHaveAttribute('aria-current', 'true')
    const detail = page.getByRole('region', { name: /詳情$/ })
    await expect(detail.getByText('判定依據')).toBeVisible()
    // 選一筆文件勾稽發現:AI 只對勾稽發現寫文字,判定是確定性引擎的結果
    const chainRow = rows.filter({ hasText: '文件勾稽' }).first()
    await chainRow.click()
    await expect(chainRow).toHaveAttribute('aria-current', 'true')
    await expect(detail.getByText('對應工項／項目')).toBeVisible()
    // P6c(D-026 §4):audit.summary 退場——詳情欄只剩「前往來源單據」,沒有任何 AI 稽核意見按鈕或說明;
    // 發現本身仍是確定性引擎的結果,頁尾維持「非違規認定」的定位
    await expect(detail.getByRole('button', { name: /AI 稽核意見/ })).toHaveCount(0)
    await expect(detail.getByText(/AI 稽核意見/)).toHaveCount(0)
    await expect(detail.getByRole('button', { name: /^前往/ })).toBeVisible()
    await expect(page.getByText(/非違規認定/)).toBeVisible()
    // 清單列只負責選取:動作鈕不在列裡
    await expect(chainRow.getByRole('button')).toHaveCount(0)
  })

  test('估驗計價頁逐期顯示缺件與檢核(原風險稽核的文件勾稽,P4c 併入 DB 缺件同一張卡);Agent 稽核提示連到估驗頁', async ({ page }) => {
    await loginAs(page, 'owner')
    await gotoHash(page, '/valuation')
    await expect(page.getByRole('heading', { name: '估驗計價', exact: true })).toBeVisible()
    // demo 劇本至少有一項勾稽發現(與 /audit 的「文件勾稽」同一引擎、同一組裝),列在缺件與檢核卡;
    // demo 沒有後端核對,卡上明講「未經後端監造確認量核對」,不假裝通過
    const checks = page.getByRole('list', { name: '缺件與檢核' })
    await expect(checks.getByRole('listitem').first()).toBeVisible()
    await expect(page.getByText(/0 項缺件 · \d+ 項風險 · \d+ 項注意 · 已勾稽 \d+ 項計價工項/)).toBeVisible()
    await expect(page.getByText(/示範資料:估驗數量未經後端監造確認量核對/)).toBeVisible()
    // Agent 的稽核提示卡:連結改指估驗計價(不再指 hidden 的 /audit)
    await gotoHash(page, '/agent')
    const link = page.getByRole('link', { name: /前往估驗計價查看勾稽檢核/ })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page.getByRole('heading', { name: '估驗計價', exact: true })).toBeVisible()
  })

  test('路由守衛:機關進不了廠商成本頁', async ({ page }) => {
    await loginAs(page, 'owner')
    await gotoHash(page, '/cost')
    await expect(page.getByText('你的角色沒有此頁的存取權限')).toBeVisible()
  })

  test('打錯網址顯示 404 頁(U-02)', async ({ page }) => {
    await loginAs(page, 'owner')
    await gotoHash(page, '/no-such-page')
    await expect(page.getByText('找不到這個頁面')).toBeVisible()
    await page.getByRole('link', { name: /回到今日工作/ }).click()
    await expect(page).toHaveURL(/#\/dashboard/)
  })
})
