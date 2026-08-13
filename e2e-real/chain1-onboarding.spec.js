// W6-2｜鏈 1:註冊 → 登入 → 建案 → 邀請 → 正式模式(真 Supabase,不用 demoSeed)。
// 驗證的是 W2/W4 在真後端的整條初始化路:
//   註冊落地建案頁 → 建案導向專案文件(D-007) → 邀請宣告身分、錯配被擋(D-009)
//   → 三方到齊檢查(W4-4) → requireText 二次確認開啟正式模式 → 被邀方登入看得到專案。
// 帳號全部本次產生(唯一 email),測後 afterAll 以 service role 連專案一併清除。
import { test, expect } from '@playwright/test'
import { password, uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, findUserIdByEmail, registerViaUI, gotoHash, runCleanup } from './helpers.js'

const PROJECT_NAME = `鏈1驗收工程-${Date.now().toString(36)}`
const creatorEmail = uniqueEmail('w6c1-adm')
const supEmail = uniqueEmail('w6c1-sup')
const ownEmail = uniqueEmail('w6c1-own')
let supId, ownId, creatorId

test.beforeAll(async () => {
  // 被邀方不需走註冊 UI:admin API 直接建好已確認帳號(org_type 進 profiles)
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈一監造')
  ownId = await createConfirmedUser(ownEmail, 'owner', '鏈一機關')
})

test.afterAll(async () => {
  // runCleanup:各步錯誤收集最後一起 throw——建立者若在註冊前就失敗,
  // 專案清理會失敗,但不得因此跳過 sup/own 兩個 beforeAll 帳號的清理。
  await runCleanup(
    () => deleteOwnedProjects(creatorEmail),
    async () => { creatorId = creatorId || await findUserIdByEmail(creatorEmail); await cleanupUser(creatorId) },
    () => cleanupUser(supId),
    () => cleanupUser(ownId),
  )
})

test('鏈 1:註冊→建案→邀請(含錯配拒絕)→三方到齊→正式模式→被邀方可見', async ({ page }) => {
  // ── 註冊(廠商)→ 自動登入 → 落在建案頁 ──────────────────────────────────
  await registerViaUI(page, { email: creatorEmail, orgType: 'contractor', name: '鏈一建立者', company: '鏈一營造' })
  await expect(page.getByPlaceholder('如 ○○新建工程')).toBeVisible()

  // ── 建案 → 導向專案文件(D-007/W2-1)─────────────────────────────────────
  await page.getByPlaceholder('如 ○○新建工程').fill(PROJECT_NAME)
  await page.getByRole('button', { name: '建立專案', exact: true }).click()
  await expect(page).toHaveURL(/#\/contract$/)
  await expect(page.getByText('專案文件一次上傳')).toBeVisible()

  // ── 邀請:錯配必須被擋(D-009/W4-3)───────────────────────────────────────
  await gotoHash(page, '/members')
  const emailBox = page.getByPlaceholder('supervisor@example.com')
  await emailBox.fill(supEmail)
  await page.locator('select').first().selectOption('owner') // 故意宣告錯:監造帳號宣告成機關
  await page.getByRole('button', { name: '＋ 加入專案' }).click()
  await expect(page.getByText(/身分不符:該帳號的註冊身分是「監造單位」/)).toBeVisible()

  // ── 邀請:正確宣告 → 監造與機關入案 ──────────────────────────────────────
  await emailBox.fill(supEmail)
  await page.locator('select').first().selectOption('supervisor')
  await page.getByRole('button', { name: '＋ 加入專案' }).click()
  await expect(page.getByText('已加入(監造單位)。')).toBeVisible()
  await emailBox.fill(ownEmail)
  await page.locator('select').first().selectOption('owner')
  await page.getByRole('button', { name: '＋ 加入專案' }).click()
  await expect(page.getByText('已加入(主辦機關)。')).toBeVisible()

  // ── 三方到齊檢查轉綠(W4-4)──────────────────────────────────────────────
  await expect(page.getByText('三方到齊檢查:施工廠商、監造單位、主辦機關都已加入。')).toBeVisible()

  // ── 開啟正式模式:requireText 輸入專案名稱=二次確認 ───────────────────────
  await page.getByRole('button', { name: '開啟正式模式' }).click()
  await expect(page.getByText('三方成員已到齊(施工廠商、監造單位、主辦機關)。')).toBeVisible()
  await page.getByPlaceholder(PROJECT_NAME).fill(PROJECT_NAME)
  await page.getByRole('button', { name: '開啟（不可復原）' }).click()
  await expect(page.getByText('正式模式已開啟。')).toBeVisible()
  await expect(page.getByText('已開啟', { exact: true })).toBeVisible()

  // ── 被邀方(監造)登入,確認真的看得到專案(RLS 下的成員資格)────────────────
  await page.getByRole('button', { name: '登出', exact: true }).click()
  await expect(page).toHaveURL(/#\/login$/)
  await page.getByPlaceholder('Email').fill(supEmail)
  await page.getByPlaceholder('密碼（至少 8 碼，含大小寫英文與數字）').fill(password)
  await page.locator('button[type="submit"]').click()
  await expect(page.getByRole('button', { name: '登出', exact: true })).toBeVisible()
  await expect(page.getByText(PROJECT_NAME).first()).toBeVisible()
})
