// E2E 共用:demo 角色登入。每個測試是 fresh browser context(localStorage 乾淨),
// 一律從角色選擇頁進入;demoSeed 在記憶體重種,測試間互不污染。
import { expect } from '@playwright/test'

export const ROLES = {
  contractor: '陳怡君', // 施工 / 品管工程師(can.edit/submit)
  supervisor: '王建國', // 監造(can.approve)
  owner: '李淑芬',      // 機關(can.ratify/oversee;登入落在 /portfolio)
}

export async function loginAs(page, role) {
  await page.goto('/')
  await page.getByRole('button', { name: ROLES[role] }).click()
  // 施工/監造 → dashboard;機關 → portfolio
  await expect(page).toHaveURL(role === 'owner' ? /#\/portfolio/ : /#\/dashboard/)
}

// HashRouter 頁內導航(不整頁 reload,保留記憶體 demo 資料的當次變更)
export async function gotoHash(page, path) {
  await page.evaluate((p) => { window.location.hash = p }, path)
}
