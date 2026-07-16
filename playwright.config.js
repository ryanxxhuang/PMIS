// E2E 護欄:三角色簽核鏈冒煙測試(e2e/*.spec.js)。
// 跑 demo 模式(VITE_SUPABASE_URL 清空 → demoSeed 確定性 storyline):
// 不碰真 DB、不花雲端資源、每個測試 fresh context 重種資料 → 完全隔離。
// 本機:npm run test:e2e;CI 見 .github/workflows/ci.yml。
import { defineConfig } from '@playwright/test'

const PORT = 5188

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
    command: 'npm run dev',
    port: PORT,
    reuseExistingServer: !process.env.CI,
    // 覆蓋 .env:清空 Supabase → demo 模式(process env 優先於 .env 檔)
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', PORT: String(PORT) },
  },
})
