// 送審文件依球權分段(W8-4B B3):打開這頁第一眼要看到「哪幾件在等我」,
// 審定後該筆必須離開「待我處理」、落到「已完成」——分段若失準,催件就會催錯人。
// 改版後三段分群是快篩 chip(不再是區段標題)、列只負責選取、審定動作全在詳情欄,
// 所以測的是行為:點 chip → 清單只剩該段 → 選中某筆 → 詳情欄的審定鈕 → 球權轉移。
// 定位一律走 role / aria-label / 文字,不綁視覺 class(規範 §7)。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

// 快篩 chip 的 accessible name 是「待我處理 2」(標籤＋件數),件數會隨劇本變,
// 用 ^ 錨定標籤;三個標籤互不為前綴,不會串到別顆。
const chip = (page, label) => page.getByRole('button', { name: new RegExp(`^${label}`) })
// 清單:role=list 以「送審清單」命名——只在清單內找編號,詳情欄也印同一個編號
const list = (page) => page.getByRole('list', { name: '送審清單' })
const row = (page, no) => page.getByRole('listitem').filter({ hasText: no })
// 詳情欄:region 以編號命名(「SUB-002 詳情」)——找得到這個 region 本身就證明
// 詳情欄正在顯示這一筆,不必再猜右欄現在是誰。
// 按鈕名一律 exact:快篩 chip「等待對方 0」之類的文字會被子字串比對吃成按鈕名
const detail = (page, no) => page.getByRole('region', { name: `${no} 詳情` })

test.describe('送審球權分段', () => {
  test('監造:待我處理含 SUB-003/SUB-002,核准後 SUB-002 移入已完成', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/submittals')

    // 待我處理:兩筆待審都在;已核准的 SUB-001 不該混在待辦裡
    await chip(page, '待我處理').click()
    await expect(chip(page, '待我處理')).toHaveAttribute('aria-pressed', 'true')
    await expect(list(page).getByText('SUB-003')).toBeVisible()
    await expect(list(page).getByText('SUB-002')).toBeVisible()
    await expect(list(page).getByText('SUB-001')).toHaveCount(0)
    // 已完成:SUB-001 在這一段
    await chip(page, '已完成').click()
    await expect(list(page).getByText('SUB-001')).toBeVisible()

    // SUB-002 已在「審核中」→ 可直接核准;審查意見可留空,對話框確認鈕不鎖。
    // 動作在詳情欄:先選列,再在 region 裡找鈕
    await chip(page, '待我處理').click()
    await row(page, 'SUB-002').click()
    await expect(row(page, 'SUB-002')).toHaveAttribute('aria-current', 'true')
    const d2 = detail(page, 'SUB-002')
    await d2.getByRole('button', { name: '核准', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('核准：SUB-002')).toBeVisible()
    await dialog.getByRole('button', { name: '核准', exact: true }).click()

    // 球權改變 → 換段;不是只有狀態字改掉:仍停在「待我處理」時清單已沒有它,
    // 切到「已完成」才看得到
    await expect(list(page).getByText('SUB-002')).toHaveCount(0)
    await chip(page, '已完成').click()
    await expect(list(page).getByText('SUB-002')).toBeVisible()
  })

  test('廠商:待審件落在等待對方,且沒有審定按鈕', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/submittals')

    // demo 種子沒有「退回補正」的送審,廠商此刻無球 → 待審兩筆都在等監造
    await chip(page, '等待對方').click()
    await expect(list(page).getByText('SUB-002')).toBeVisible()
    await expect(list(page).getByText('SUB-003')).toBeVisible()

    // 審定是監造的權;選中待審的 SUB-002 讓詳情欄的動作列真的渲染出來,
    // 整頁(清單＋詳情)仍不得出現任何一顆審定鈕
    await row(page, 'SUB-002').click()
    await expect(detail(page, 'SUB-002').getByText('待監造審定', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '核准', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '核備', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '受理審核', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '退回補正', exact: true })).toHaveCount(0)
  })
})
