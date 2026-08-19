// 合作簡報用的 demo 站截圖產生器。
// 為什麼要腳本而不是手動截圖:簡報每次改版都要重截(UI 一直在動),
// 手動截會出現尺寸不一、捲動位置不同、側欄展開狀態不同 → 版面在 PPT 裡看起來很髒。
//
// 跑法(先確保 demo 模式 dev server 在 5188):
//   VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --port 5188
//   node docs/pitch/pptx/shots.js
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.SHOT_BASE || 'http://localhost:5188'
const OUT = path.resolve('docs/pitch/shots')

// 角色 → Login 頁那顆按鈕的姓名(src/data/seed.js)
const ROLE_NAME = { contractor: '陳怡君', supervisor: '王建國', owner: '李淑芬' }

// 每張圖:檔名、角色、路徑、可選的進場動作(展開側欄子頁、點分頁…)
const SHOTS = [
  // ── 監造視角(這份簡報的主角:顧問公司就是監造單位)──
  { id: 'sv-dashboard',   role: 'supervisor', path: '/dashboard' },
  // Agent 頁空對話沒有說服力 → 先點一顆建議問題,截到「問了就有出處」的樣子
  { id: 'sv-agent',       role: 'supervisor', path: '/agent', ask: '有哪些未結案缺失？' },
  { id: 'sv-agent-inbox', role: 'supervisor', path: '/agent' },
  { id: 'sv-quality',     role: 'supervisor', path: '/quality' },
  { id: 'sv-itp',         role: 'supervisor', path: '/itp' },
  { id: 'sv-submittals',  role: 'supervisor', path: '/submittals' },
  { id: 'sv-valuation',   role: 'supervisor', path: '/valuation' },
  { id: 'sv-report',      role: 'supervisor', path: '/supervisor-report' },
  // 專案文件頁頂端是上傳框,demo 會顯示「Demo 模式不支援」→ 捲到義務時程再截
  { id: 'sv-contract',    role: 'supervisor', path: '/contract', scrollTo: '義務時程' },
  { id: 'sv-alerts',      role: 'supervisor', path: '/alerts' },
  { id: 'sv-rfi',         role: 'supervisor', path: '/rfi' },
  { id: 'sv-nav',         role: 'supervisor', path: '/dashboard', expandNav: true },
  // ── 廠商視角(監造要看到對方送進來的東西長什麼樣)──
  { id: 'ct-sitelog',     role: 'contractor', path: '/site-log' },
  { id: 'ct-boq',         role: 'contractor', path: '/boq' },
  { id: 'ct-progress',    role: 'contractor', path: '/progress' },
  { id: 'ct-safety',      role: 'contractor', path: '/safety' },
  { id: 'ct-payments',    role: 'contractor', path: '/payments' },
  { id: 'ct-changeorders',role: 'contractor', path: '/change-orders' },
  // ── 機關視角(共同投標時要講的那一端)──
  { id: 'ow-portfolio',   role: 'owner',      path: '/portfolio' },
  { id: 'ow-audit',       role: 'owner',      path: '/audit' },
  { id: 'ow-acceptance',  role: 'owner',      path: '/acceptance' },
  { id: 'ow-members',     role: 'owner',      path: '/members' },
]

fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const results = []

for (const role of ['supervisor', 'contractor', 'owner']) {
  const shots = SHOTS.filter((s) => s.role === role)
  if (!shots.length) continue
  // 每個角色一個 fresh context:demoSeed 在記憶體重種,角色之間不互相污染
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,     // Retina:貼進 PPT 放大也不糊
    locale: 'zh-TW',
    colorScheme: 'light',     // 簡報一律淺色,深色在投影機上會糊
    reducedMotion: 'reduce',  // 關掉轉場,避免截到動畫中間
  })
  const page = await ctx.newPage()

  await page.goto(`${BASE}/`)
  await page.getByRole('button', { name: ROLE_NAME[role] }).click()
  await page.waitForLoadState('networkidle')

  for (const shot of shots) {
    // HashRouter 頁內導航:不整頁 reload,保住記憶體裡的 demo 資料
    await page.evaluate((p) => { window.location.hash = `#${p}` }, shot.path)
    await page.waitForTimeout(900)
    if (shot.ask) {
      // demo 模式走 assistantQA 的確定性關鍵字比對,不打後端也答得出來
      const chip = page.getByRole('button', { name: shot.ask })
      if (await chip.count()) await chip.first().click()
      else { await page.getByPlaceholder('輸入問題…').fill(shot.ask); await page.keyboard.press('Enter') }
      await page.waitForTimeout(1200)
    }
    if (shot.scrollTo) {
      // scrollIntoViewIfNeeded 對「已經在視窗內、但位置太低」的標題不會動作;
      // 而且版面的捲動容器不是 window,所以一律用元素自己的 scrollIntoView。
      await page.getByText(shot.scrollTo, { exact: true }).first()
        .evaluate((el) => el.scrollIntoView({ block: 'start' }))
      // block:'start' 會把標題推到捲動容器頂端,但頁首是 sticky 的 → 標題下方那排
      // 摘要籤會被蓋掉一半。往回捲一個頁首高度,截出來才不會有切一半的元素。
      await page.evaluate(() => {
        const scroller = [...document.querySelectorAll('*')].find((e) => e.scrollTop > 0)
        if (scroller) scroller.scrollTop -= 150
        else window.scrollBy(0, -150)
      })
      await page.waitForTimeout(500)
    }
    if (shot.expandNav) {
      for (const label of ['現場與品質', '審查與協作', '進度與金流']) {
        const btn = page.getByRole('button', { name: `展開${label}子頁` })
        if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(150) }
      }
      await page.waitForTimeout(300)
    }
    if (!shot.scrollTo) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250) }
    const file = path.join(OUT, `${shot.id}.png`)
    await page.screenshot({ path: file })
    const kb = Math.round(fs.statSync(file).size / 1024)
    results.push(`${shot.id}\t${shot.role}\t${shot.path}\t${kb}KB`)
    console.log(`✓ ${shot.id.padEnd(16)} ${shot.path.padEnd(20)} ${kb}KB`)
  }
  await ctx.close()
}

await browser.close()
console.log(`\n${results.length} 張,輸出於 ${OUT}`)
