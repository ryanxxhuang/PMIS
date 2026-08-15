// 送審文件依球權分群(W8-4B B3):打開這頁第一眼要看到「哪幾件在等我」,
// 審定後該筆必須離開「待我處理」、落到「已完成」——分群若失準,催件就會催錯人。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

// 群標題是安靜的 h2,群內容是它所在的那層容器
const group = (page, name) => page.getByRole('heading', { name: new RegExp(name) })
  .locator('xpath=ancestor::div[contains(@class,"space-y-2")][1]')

test.describe('送審球權分群', () => {
  test('監造:待我處理含 SUB-003/SUB-002,核准後 SUB-002 移入已完成', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/submittals')

    const mine = group(page, '待我處理')
    await expect(mine.getByText('SUB-003')).toBeVisible()
    await expect(mine.getByText('SUB-002')).toBeVisible()
    // 已核准的 SUB-001 不該混在待辦裡
    await expect(mine.getByText('SUB-001')).toHaveCount(0)
    await expect(group(page, '已完成').getByText('SUB-001')).toBeVisible()

    // SUB-002 已在「審核中」→ 可直接核准;審查意見可留空,對話框確認鈕不鎖
    const row = page.getByText('SUB-002', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
    await row.getByRole('button', { name: '核准', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('核准：SUB-002')).toBeVisible()
    await dialog.getByRole('button', { name: '核准', exact: true }).click()

    // 球權改變 → 換群;不是只有狀態字改掉
    await expect(group(page, '已完成').getByText('SUB-002')).toBeVisible()
    await expect(group(page, '待我處理').getByText('SUB-002')).toHaveCount(0)
  })

  test('廠商:待審件落在等待對方,且沒有審定按鈕', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/submittals')

    // demo 種子沒有「退回補正」的送審,廠商此刻無球 → 待審兩筆都在等監造
    const waiting = group(page, '等待對方')
    await expect(waiting.getByText('SUB-002')).toBeVisible()
    await expect(waiting.getByText('SUB-003')).toBeVisible()

    // 審定是監造的權;廠商視角整頁不得出現審定按鈕群
    await expect(page.getByRole('button', { name: '核准', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '核備', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '受理審核', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '退回補正', exact: true })).toHaveCount(0)
  })
})
