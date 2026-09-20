// W6-1：真 Supabase 冒煙獨立於既有 demo E2E。
// 只由 `npm run test:e2e:real` 手動執行，不進預設 CI。
import { defineConfig } from '@playwright/test'

// 5189 已被另一個 worktree 的真後端 E2E 佔用時，Playwright 會直接報「is already used」而不沿用
// （reuseExistingServer: false，理由見 vite.e2e.config.js）。這時用 E2E_REAL_PORT 換一個本次專用的埠，
// 例如 `E2E_REAL_PORT=5289 npm run test:e2e:real`；與 Demo 端的 E2E_DEMO_PORT 同一個做法。
const PORT = Number(process.env.E2E_REAL_PORT || 5189)
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error(`E2E_REAL_PORT 不是有效埠號：${process.env.E2E_REAL_PORT}`)
}
const PRODUCTION_HOST = 'buylyonwoyvqdbvkkkbx.supabase.co'
const required = [
  'E2E_REAL_SUPABASE_URL',
  'E2E_REAL_SUPABASE_ANON_KEY',
  'E2E_REAL_SERVICE_ROLE_KEY',
]
const missing = required.filter((name) => !process.env[name]?.trim())

if (missing.length) {
  throw new Error(`真後端 E2E 缺少環境變數：${missing.join(', ')}`)
}

const supabaseUrl = process.env.E2E_REAL_SUPABASE_URL.trim().replace(/\/$/, '')
let supabaseHost
try {
  supabaseHost = new URL(supabaseUrl).host
} catch {
  throw new Error('E2E_REAL_SUPABASE_URL 不是有效 URL')
}
if (supabaseHost === PRODUCTION_HOST) {
  throw new Error('真後端 E2E 禁止連到正式 Supabase；請使用臨時 staging')
}

export default defineConfig({
  testDir: './e2e-real',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  projects: [{
    name: 'real-supabase',
    use: { browserName: 'chromium' },
  }],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'zh-TW',
    trace: 'retain-on-failure',
  },
  webServer: {
    // 與 Demo E2E 共用:不監看檔案、埠被佔用就失敗的 dev server(T1／T2,見該檔註解)
    command: 'npm run dev -- --config vite.e2e.config.js',
    port: PORT,
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORT: String(PORT),
      VITE_SUPABASE_URL: supabaseUrl,
      VITE_SUPABASE_ANON_KEY: process.env.E2E_REAL_SUPABASE_ANON_KEY,
    },
  },
})
