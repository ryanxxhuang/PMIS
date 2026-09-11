// 行銷站的產品畫面截圖:從真實 App 截,不再手繪。
//
// 為什麼要有這支:行銷站(PMIS_site repo)的 Hero 以前放的是手繪的 HTML 複製品,
// 產品每改版一次它就漂一次,最後變成「行銷站在賣一個不存在的畫面」。改成從 demo 建置
// 自動截圖之後,改版只要重跑這支、把圖複製到行銷站,畫面永遠是產品本人。
//
// 流程:npm run build:demo → Node 靜態伺服 dist/demo(HashRouter,路徑是 #/…)
//       → Playwright 以 demo 角色「監造」登入 → 等主畫面真的畫完 → 截 /dashboard。
// 兩張圖:桌機 1440×900、手機 390×844(現行 iPhone 邏輯解析度),皆 2x。
//
// 用法:npm run capture:appshots                    → 寫到 UIUX/appshots/
//       npm run capture:appshots -- --out <dir>      → 直接寫進行銷站 public/appshots/
// 跨 repo 邊界:圖由本 repo 產(它擁有 App),行銷站只消費;沒有自動同步,改版後要重跑
// 並複製過去,細節見 UIUX/appshots/README.md。
import { spawnSync } from 'node:child_process'
import { createReadStream, mkdirSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
import { loginAs } from '../e2e/helpers.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist', 'demo')

// 檔名固定:行銷站的 <img src> 寫死這兩個名字,改名要兩邊一起改。
const SHOTS = [
  { file: 'dashboard-desktop@2x.png', viewport: { width: 1440, height: 900 } },
  // 手機用 iPhone 的觸控/裝置模式,viewport meta 與觸控樣式才會照手機走,不是縮小的桌機
  { file: 'dashboard-phone@2x.png', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
}

function build() {
  const r = spawnSync('npm', ['run', 'build:demo'], { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`npm run build:demo 失敗(exit ${r.status})`)
}

// 只伺服 dist/demo 裡真的存在的檔:HashRouter 的路由都在 # 後面,不需要 SPA fallback;
// 拿不到的路徑就老實回 404,才不會把打錯的資源路徑悄悄糊成 index.html。
function serve() {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const target = resolve(DIST, `.${pathname === '/' ? '/index.html' : pathname}`)
    let st = null
    try { st = target.startsWith(DIST) ? statSync(target) : null } catch { st = null }
    if (!st || !st.isFile()) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': MIME[extname(target)] || 'application/octet-stream', 'content-length': st.size })
    createReadStream(target).pipe(res)
  })
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => ok({ server, origin: `http://127.0.0.1:${server.address().port}` }))
  })
}

// PNG IHDR 的寬高:用來印出實際尺寸,確認 2x 真的生效,而不是相信 viewport 設定。
function pngSize(path) {
  const fd = openSync(path, 'r')
  const head = Buffer.alloc(24)
  readSync(fd, head, 0, 24, 0)
  closeSync(fd)
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

async function capture(browser, origin, outDir, shot) {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: shot.viewport,
    deviceScaleFactor: 2,
    isMobile: !!shot.isMobile,
    hasTouch: !!shot.hasTouch,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    // 主題跟系統偏好走(public/theme-boot.js):截圖機器若是深色系統,不鎖住就會截到深色版
    colorScheme: 'light',
  })
  try {
    const page = await context.newPage()
    // 登入方式與 e2e 同一支(角色卡點「王建國」→ 落地 #/dashboard):登入流程改了兩邊一起變
    await loginAs(page, 'supervisor')
    // 等待條件不是 sleep,是「主畫面真的畫完」:h1 今日待辦 + 「現在輪到我」清單第一列,
    // 否則會截到骨架或空卡;最後等字型載完,免得截到 fallback 字型。
    await page.getByRole('heading', { level: 1, name: '今日待辦' }).waitFor()
    await page.getByRole('group', { name: '現在輪到我' }).getByRole('listitem').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const path = join(outDir, shot.file)
    // 進場動畫關掉:同一份 build 每次截出來要逐像素一樣,行銷站才好 diff
    await page.screenshot({ path, animations: 'disabled', caret: 'hide' })
    const { width, height } = pngSize(path)
    console.log(`${shot.file}: ${width}×${height}, ${(statSync(path).size / 1024).toFixed(0)} KB`)
  } finally {
    await context.close()
  }
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' } } })
  const outDir = values.out ? resolve(values.out) : join(ROOT, 'UIUX', 'appshots')
  mkdirSync(outDir, { recursive: true })

  build()
  const { server, origin } = await serve()
  const browser = await chromium.launch()
  try {
    for (const shot of SHOTS) await capture(browser, origin, outDir, shot)
    console.log(`輸出目錄:${outDir}`)
  } finally {
    await browser.close()
    server.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
