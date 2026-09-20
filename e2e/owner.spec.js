// 機關(李淑芬)動線:落地收件匣、從側欄「專案」到跨案總覽(選案清單)→ 核准變更設計 →
// 變更後契約金額跨頁一致(B-02)→ 估驗頁的缺件與檢核 → 廠商成本頁被擋 → 404 頁。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

// demoSeed:原發包 721,364,067;CO-001 已核准 +1,260,000;CO-002 審核中 +1,764,000。
// 核准 CO-002 後變更後契約金額 = 724,388,067——三頁必須同一個數字(B-02 回歸)。
const REVISED_AFTER_CO2 = '724,388,067'

test.describe('機關', () => {
  test('登入落在今日工作(收件匣);跨案總覽入口已收起、深連結仍可達,風險稽核舊連結(P6b 移除頁面)導向估驗計價', async ({ page }) => {
    await loginAs(page, 'owner')
    await expect(page.getByRole('heading', { name: '今日工作' })).toBeVisible()
    // 落地不依角色分流(規範 §0 方向 A)。2026-09-20 廠商驗收 A 包:跨案總覽的側欄入口先收起
    // (選案改走頁首的專案切換器),頁面、RPC 與舊連結都不動——這裡釘住「入口沒了、能力還在」。
    const nav = page.getByRole('navigation', { name: '主要功能' })
    await nav.getByRole('button', { name: '展開專案子頁' }).click()
    await expect(nav.getByRole('link', { name: '活動紀錄', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '跨案總覽', exact: true })).toHaveCount(0)
    // D-026 退場、P6b 移除頁面:風險稽核不在側欄;舊連結仍限機關(廠商被擋見 routes.spec)
    await gotoHash(page, '/portfolio')
    await expect(page.getByRole('heading', { name: '跨案總覽' })).toBeVisible()
    // 縮為選案清單(D-026 P1b):本案＋兩個示範姊妹案各一列,整列可點;統計/例外帶不再出現
    const list = page.getByRole('list', { name: '專案清單' })
    await expect(list.getByRole('listitem')).toHaveCount(3)
    await expect(list.getByRole('listitem').first()).toContainText('目前專案')
    await expect(list.getByRole('listitem').nth(1)).toContainText('B 區道路改善工程')
    await expect(page.getByText(/各案均無未結例外|累計估驗/)).toHaveCount(0)
    await expect(nav.getByRole('link', { name: '風險稽核', exact: true })).toHaveCount(0)
    // 機關的 /audit 舊連結(書籤、提醒信、Agent 回答)導到估驗計價——勾稽與缺件檢核的承接位置
    await gotoHash(page, '/audit')
    await expect(page).toHaveURL(/#\/valuation/)
    await expect(page.getByRole('heading', { name: '估驗計價', exact: true })).toBeVisible()
    await expect(page.getByRole('list', { name: '缺件與檢核' })).toBeVisible()
    // 逐工項排程是廠商的:機關的舊連結被守衛擋,不會被導進履約時程(roles 不因退場鬆綁)
    await gotoHash(page, '/schedule')
    await expect(page.getByText('你的角色沒有此頁的存取權限')).toBeVisible()
    await expect(page).toHaveURL(/#\/schedule$/)
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

  test('估驗計價頁逐期顯示缺件與檢核(原風險稽核的文件勾稽,P4c 併入 DB 缺件同一張卡);Agent 稽核提示連到估驗頁', async ({ page }) => {
    await loginAs(page, 'owner')
    await gotoHash(page, '/valuation')
    await expect(page.getByRole('heading', { name: '估驗計價', exact: true })).toBeVisible()
    // demo 劇本至少有一項勾稽發現(原風險稽核頁的「文件勾稽」同一引擎、同一組裝),列在缺件與檢核卡;
    // demo 沒有後端核對,卡上明講「未經後端監造確認量核對」,不假裝通過
    const checks = page.getByRole('list', { name: '缺件與檢核' })
    await expect(checks.getByRole('listitem').first()).toBeVisible()
    await expect(page.getByText(/0 項缺件 · \d+ 項風險 · \d+ 項注意 · 已勾稽 \d+ 項計價工項/)).toBeVisible()
    await expect(page.getByText(/示範資料:估驗數量未經後端監造確認量核對/)).toBeVisible()
    // Agent 的稽核提示卡:連結改指估驗計價(不再指已移除的 /audit)
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
