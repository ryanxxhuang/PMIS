// E2E 共用:demo 角色登入。每個測試是 fresh browser context(localStorage 乾淨),
// 一律從角色選擇頁進入;demoSeed 在記憶體重種,測試間互不污染。
import { expect } from '@playwright/test'

export const ROLES = {
  contractor: '陳怡君', // 施工廠商(can.edit/submit，現場／品管工作皆可處理)
  supervisor: '王建國', // 監造(can.approve;事務所同時監多案 → 落在 /portfolio)
  owner: '李淑芬',      // 機關(can.ratify/oversee;登入落在 /portfolio)
}

export async function loginAs(page, role) {
  await page.goto('/')
  await page.getByRole('button', { name: ROLES[role] }).click()
  // 落地頁對齊 navConfig 的 defaultLandingPath:管多案的機關/監造 → portfolio,廠商 → dashboard
  await expect(page).toHaveURL(role === 'contractor' ? /#\/dashboard/ : /#\/portfolio/)
}

// HashRouter 頁內導航(不整頁 reload,保留記憶體 demo 資料的當次變更)
export async function gotoHash(page, path) {
  await page.evaluate((p) => { window.location.hash = p }, path)
}
