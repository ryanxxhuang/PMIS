import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // 相對路徑 → 可部署到 GitHub Pages 的任何子路徑（username.github.io/repo/）
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    // 尊重外部指定的 PORT(preview/CI 自動配 port),沒有就用 Vite 預設 5173
    port: Number(process.env.PORT) || undefined,
    // 避免編輯 .claude 設定或文件時觸發整頁 reload、清掉 demo 進行中的記憶體狀態
    watch: { ignored: ['**/.claude/**', '**/PRD.md'] },
  },
  test: {
    environment: 'node', // parsePcces 需要 DOM 的測試檔自帶 @vitest-environment jsdom
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'], // .claude 下有背景任務的 worktree
  },
})
