// W6-1：真 Supabase 冒煙獨立於既有 demo E2E。
// 只由 `npm run test:e2e:real` 手動執行，不進預設 CI。
import { defineConfig } from '@playwright/test'

const PORT = 5189
const PRODUCTION_HOST = 'buylyonwoyvqdbvkkkbx.supabase.co'
const required = [
  'E2E_REAL_SUPABASE_URL',
  'E2E_REAL_SUPABASE_ANON_KEY',
  'E2E_REAL_EMAIL',
  'E2E_REAL_PASSWORD',
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
    command: 'npm run dev',
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
