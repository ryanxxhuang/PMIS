// RFI 球權與角色動作:回覆是監造的球、結案是廠商的球。DB 有 rfis_guard 兜底,
// 但 UI 把動作放錯人手上就是引人撞牆——這裡釘住「誰看得到哪顆按鈕」與回覆全流程。
// 改版後列只負責選取、動作全在詳情欄,所以測的是行為:選中某筆 → 詳情欄的狀態與
// 可用動作 → 執行 → 球權轉移。定位一律走 role / aria-label / 文字,不綁視覺 class
// (規範 §7:單元測試已零視覺耦合,e2e 往同一方向走)。
import { test, expect } from '@playwright/test'
import { loginAs, gotoHash } from './helpers.js'

// 清單列:role=listitem 帶編號;詳情欄:region 以編號命名(「RFI-002 詳情」)——
// 找得到這個 region 本身就證明詳情欄正在顯示這一筆,不必再猜右欄現在是誰。
// 按鈕名一律 exact:快篩 chip「待廠商確認結案 N」會被子字串比對吃成「確認結案」鈕
const row = (page, no) => page.getByRole('listitem').filter({ hasText: no })
const detail = (page, no) => page.getByRole('region', { name: `${no} 詳情` })

test.describe('工程疑義(RFI)', () => {
  test('監造:回覆待回覆疑義,球轉給廠商確認結案', async ({ page }) => {
    await loginAs(page, 'supervisor')
    await gotoHash(page, '/rfi')

    // RFI-002 待回覆 → 球在監造:選中後詳情欄標「待監造/設計回覆」、有「回覆」
    await row(page, 'RFI-002').click()
    await expect(row(page, 'RFI-002')).toHaveAttribute('aria-current', 'true')
    const d2 = detail(page, 'RFI-002')
    await expect(d2.getByText('待監造/設計回覆')).toBeVisible()
    // 問題全文在詳情欄(改版前被 line-clamp 截斷,這句在第三行之後)
    await expect(d2.getByText(/請釋疑是否可調整套管位置/)).toBeVisible()
    await d2.getByRole('button', { name: '回覆', exact: true }).click()

    // appPrompt 對話框(共用,未搬進詳情欄):必填回覆內容
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('回覆：RFI-002')).toBeVisible()
    await dialog.locator('textarea').fill('依建築師釋疑,套管可平移 5cm,主筋不得切斷。')
    await dialog.getByRole('button', { name: '送出回覆', exact: true }).click()

    // 球權改變:答案進詳情欄、清單列與詳情都轉「待廠商確認結案」;
    // 監造只剩「補充回覆」——整頁不得再有「回覆」鈕(不是只看某一列)
    await expect(d2.getByText(/依建築師釋疑/)).toBeVisible()
    await expect(d2.getByText('待廠商確認結案')).toBeVisible()
    await expect(row(page, 'RFI-002').getByText('待廠商確認結案')).toBeVisible()
    await expect(d2.getByRole('button', { name: '補充回覆', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '回覆', exact: true })).toHaveCount(0)
  })

  test('廠商:不見回覆按鈕,只能確認結案與撤回未回覆疑義', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/rfi')

    // 回覆是監造的權:選中待回覆的 RFI-002,詳情欄只有等待字樣與撤回,整頁沒有「回覆」鈕
    await row(page, 'RFI-002').click()
    const d2 = detail(page, 'RFI-002')
    await expect(d2.getByText('待監造回覆', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '回覆', exact: true })).toHaveCount(0)
    await expect(d2.getByRole('button', { name: '刪除', exact: true })).toBeVisible()

    // 撤回只在「待回覆」開放:已回覆=履約證據,選中 RFI-001 後整頁不給刪除入口;
    // 補充回覆是監造的動作,廠商在已回覆這一段也看不到
    await row(page, 'RFI-001').click()
    const d1 = detail(page, 'RFI-001')
    await expect(d1.getByText('待廠商確認結案')).toBeVisible()
    await expect(page.getByRole('button', { name: '刪除', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '補充回覆', exact: true })).toHaveCount(0)

    // 已回覆的 RFI-001:廠商確認結案 → 球結束,清單列與詳情都標已結案,結案鈕消失
    await d1.getByRole('button', { name: '確認結案', exact: true }).click()
    await expect(d1.getByText('已結案')).toBeVisible()
    await expect(row(page, 'RFI-001').getByText('已結案')).toBeVisible()
    await expect(page.getByRole('button', { name: '確認結案', exact: true })).toHaveCount(0)
  })
})
