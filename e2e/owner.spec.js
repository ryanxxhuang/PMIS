// 機關(李淑芬)動線:落地收件匣、從側欄「專案」到跨案總覽 → 核准變更設計 →
// 變更後契約金額跨頁一致(B-02)→ 廠商成本頁被擋 → 404 頁。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

// demoSeed:原發包 721,364,067;CO-001 已核准 +1,260,000;CO-002 審核中 +1,764,000。
// 核准 CO-002 後變更後契約金額 = 724,388,067——三頁必須同一個數字(B-02 回歸)。
const REVISED_AFTER_CO2 = '724,388,067'

test.describe('機關', () => {
  test('登入落在今日待辦(收件匣);跨案總覽從側欄「專案」子頁可達,風險稽核只給機關', async ({ page }) => {
    await loginAs(page, 'owner')
    await expect(page.getByRole('heading', { name: '今日待辦' })).toBeVisible()
    // 落地不依角色分流(規範 §0 方向 A):多案角色要看跨案總覽,從「專案」群組一格就到
    const nav = page.getByRole('navigation', { name: '主要功能' })
    await nav.getByRole('button', { name: '展開專案子頁' }).click()
    await expect(nav.getByRole('link', { name: '風險稽核', exact: true })).toBeVisible() // roles: owner
    await nav.getByRole('link', { name: '跨案總覽', exact: true }).click()
    await expect(page.getByRole('heading', { name: '跨案總覽' })).toBeVisible()
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
    // 清單列的狀態章即時翻成核准、核准鈕消失(不是只有彙總數字變)
    await expect(row.getByText('核准', { exact: true })).toBeVisible()
    await expect(d2.getByRole('button', { name: '核准', exact: true })).toHaveCount(0)
    // 本頁彙總即時更新
    await expect(page.getByText(`NT$ ${REVISED_AFTER_CO2}`).first()).toBeVisible()
    // 跨頁一致:估驗頁分母、Dashboard 發包工程費都是同一個數字
    await gotoHash(page, '/valuation')
    await expect(page.getByText(/變更後契約金額 7\.24 億/)).toBeVisible()
    // Apple 改版後首頁不再放指標卡(判準:不會被點的數字一律刪),第三個面改用
    // 跨案總覽——它與估驗頁同吃 store 的 revisedTotal(財務單一真相層 B-02),
    // 那裡渲染成不帶 NT$ 的裸數字,所以比對數字本身。
    await gotoHash(page, '/portfolio')
    await expect(page.getByText(REVISED_AFTER_CO2, { exact: false }).first()).toBeVisible()
  })

  test('今日待辦:機關拿得到驗收法定期限,拿不到廠商責任的事', async ({ page }) => {
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
    await expect(page.getByText('初驗期限將至')).toBeVisible()
  })

  test('風險稽核:清單＋詳情殼——嚴重度快篩、詳情欄判定依據、AI 稽核意見貼在該項底下', async ({ page }) => {
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
    // 按鈕名一律 exact:快篩 chip「風險 2」會被子字串比對吃成按鈕名
    await detail.getByRole('button', { name: '產生 AI 稽核意見', exact: true }).click()
    await expect(detail.getByText('AI 稽核意見', { exact: true })).toBeVisible()
    await expect(detail.getByText(/非違規認定/)).toBeVisible()
    // 清單列只負責選取:AI 鈕不在列裡
    await expect(chainRow.getByRole('button')).toHaveCount(0)
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
    await page.getByRole('link', { name: /回到今日待辦/ }).click()
    await expect(page).toHaveURL(/#\/dashboard/)
  })
})
