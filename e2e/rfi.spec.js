// RFI 球權與角色動作:回覆是監造的球、結案是廠商的球。DB 有 rfis_guard 兜底,
// 但 UI 把動作放錯人手上就是引人撞牆——這裡釘住「誰看得到哪顆按鈕」與回覆全流程。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

// RFI 卡片:編號 span 往上找到整張圓角卡
const row = (page, no) => page.getByText(no, { exact: true })
  .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')

test.describe('工程疑義(RFI)', () => {
  test('監造:回覆待回覆疑義,球轉給廠商確認結案', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/rfi')

    // RFI-002 待回覆 → 球在監造,有「回覆」
    const r2 = row(page, 'RFI-002')
    await expect(r2.getByText('待監造/設計回覆')).toBeVisible()
    await r2.getByRole('button', { name: '回覆', exact: true }).click()

    // appPrompt 對話框:必填回覆內容
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('回覆：RFI-002')).toBeVisible()
    await dialog.locator('textarea').fill('依建築師釋疑,套管可平移 5cm,主筋不得切斷。')
    await dialog.getByRole('button', { name: '送出回覆' }).click()

    // 球權改變:答案上卡、轉待廠商確認;監造只剩「補充回覆」
    await expect(r2.getByText(/答：依建築師釋疑/)).toBeVisible()
    await expect(r2.getByText('待廠商確認結案')).toBeVisible()
    await expect(r2.getByRole('button', { name: '補充回覆' })).toBeVisible()
    await expect(r2.getByRole('button', { name: '回覆', exact: true })).toHaveCount(0)
  })

  test('廠商:不見回覆按鈕,只能確認結案與撤回未回覆疑義', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/rfi')

    // 回覆是監造的權:廠商整頁沒有「回覆」鈕,待回覆卡顯示等待字樣
    const r2 = row(page, 'RFI-002')
    await expect(r2.getByText('待監造回覆')).toBeVisible()
    await expect(page.getByRole('button', { name: '回覆', exact: true })).toHaveCount(0)

    // 撤回只在「待回覆」開放:已回覆=履約證據,不給刪除入口
    const r1 = row(page, 'RFI-001')
    await expect(r2.getByRole('button', { name: '刪除' })).toBeVisible()
    await expect(r1.getByRole('button', { name: '刪除' })).toHaveCount(0)

    // 已回覆的 RFI-001:廠商確認結案 → 球結束
    await r1.getByRole('button', { name: '確認結案' }).click()
    await expect(r1.getByText('已結案')).toBeVisible()
    await expect(r1.getByRole('button', { name: '確認結案' })).toHaveCount(0)
  })
})
