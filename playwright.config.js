// E2E 護欄:三角色簽核鏈冒煙測試(e2e/*.spec.js)。
// 跑 demo 模式(VITE_SUPABASE_URL 清空 → demoSeed 確定性 storyline):
// 不碰真 DB、不花雲端資源、每個測試 fresh context 重種資料 → 完全隔離。
// 本機:npm run test:e2e;CI 見 .github/workflows/ci.yml。
import { defineConfig } from '@playwright/test'

// 預設 5188。多個 worktree 並行時,埠已被別的 worktree 佔用就會直接失敗(見下方 reuseExistingServer),
// 這時用 E2E_DEMO_PORT 換一個本次專用的埠,例如 `E2E_DEMO_PORT=5288 npm run test:e2e`。
const PORT = Number(process.env.E2E_DEMO_PORT || 5188)
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error(`E2E_DEMO_PORT 不是有效埠號:${process.env.E2E_DEMO_PORT}`)
}

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'zh-TW',
    trace: 'on-first-retry',
  },
  webServer: {
    // 不監看檔案、埠被佔用就失敗的 dev server:跑測期間同一 worktree 改檔(連改 spec 都算)不會把受測頁面整頁重載(T1／T2,見該檔註解)
    command: 'npm run dev -- --config vite.e2e.config.js',
    port: PORT,
    // 一律自己起 server、不沿用埠上既有的:沿用的 server 可能是別的 worktree(別的分支)或會監看檔案的 `npm run dev`,
    // 測到的就不是本 worktree 的程式碼(T2 實測:另一個目錄起的 server 被直接沿用)。埠被佔用時 Playwright 會報
    // 「is already used」——改設 E2E_DEMO_PORT,不要改回沿用。
    reuseExistingServer: false,
    // 覆蓋 .env:清空 Supabase → demo 模式(process env 優先於 .env 檔)
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', PORT: String(PORT) },
  },
})
