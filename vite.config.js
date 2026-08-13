import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // 相對路徑 → 可部署到 GitHub Pages 的任何子路徑（username.github.io/repo/）
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    // 只綁 localhost,不對區域網路公開。dev server 的路徑類漏洞(如 GHSA-fx2h-pf6j-xcff
    // 的 server.fs.deny 繞過)只有在 server 聽得到外部連線時才有人打得到 —— 明寫比靠預設值安全。
    // 真要讓手機連本機測,才臨時下 `npm run dev -- --host`。
    host: 'localhost',
    // 尊重外部指定的 PORT(preview/CI 自動配 port),沒有就用 Vite 預設 5173
    port: Number(process.env.PORT) || undefined,
    // 避免編輯 .claude 設定或文件時觸發整頁 reload、清掉 demo 進行中的記憶體狀態
    watch: { ignored: ['**/.claude/**', '**/PRD.md'] },
  },
  test: {
    environment: 'node', // parsePcces 需要 DOM 的測試檔自帶 @vitest-environment jsdom
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', '**/e2e/**', '**/e2e-real/**'], // .claude 下有背景任務的 worktree;兩套 e2e 各由 Playwright 跑
  },
})
