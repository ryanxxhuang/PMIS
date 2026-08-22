import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 圖示字型 preload。
 *
 * 為什麼要特別處理:`.material-symbols-outlined` 是 `font-display: block`(缺字寧可空白,
 * 也不要先閃出 ligature 的英文原文字 —— 那比空白更像壞掉)。代價是瀏覽器要「下載完整包
 * 樣式表 → 解析到 @font-face → 才開始抓字型」,而那份樣式表是 render-blocking 且被
 * Noto Sans TC 的 105 條 @font-face 撐到 170KB 以上;這段空窗期全站圖示都是空的。
 * preload 讓 preload scanner 在解析 <head> 時就跟樣式表併行抓這支 15KB subset,
 * 圖示不必再等 CSS 解析完。字型檔本身沒變大,純粹是把請求提前。
 *
 * 為什麼要寫成外掛而不是直接在 index.html 寫死一行:字型檔名帶 content hash
 * (public/_headers 對 /assets/* 設了 immutable 永久快取,靠 hash 換檔破快取),
 * 寫死路徑上線就 404。只能在 build 期從 bundle 撈出實際檔名再注入。
 * dev 不需要(Vite 直接吐原始路徑,沒有打包樣式表的阻塞問題),故 apply: 'build'。
 */
function preloadIconFont() {
  let base = '/'
  let logger = console
  return {
    name: 'pmis-preload-icon-font',
    apply: 'build',
    configResolved(config) {
      base = config.base
      logger = config.logger
    },
    transformIndexHtml: {
      // post:要等 bundle 產出、檔名(含 hash)確定後才撈得到
      order: 'post',
      handler(html, ctx) {
        const file = Object.keys(ctx.bundle ?? {}).find((name) =>
          /(^|\/)material-symbols-pmis-[^/]*\.woff2$/.test(name),
        )
        // 字型改名或不再打包時只提醒、不擋 build:preload 少一條是效能退步,不是壞掉
        if (!file) {
          logger.warn('[pmis-preload-icon-font] 找不到圖示字型,略過 preload(是否改名或移出 bundle?)')
          return html
        }
        return {
          html,
          tags: [{
            tag: 'link',
            // 字型一律以 CORS 模式抓取,即使同源;少了 crossorigin 會變成抓兩次(preload 白做)
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: base + file, crossorigin: '' },
            injectTo: 'head',
          }],
        }
      },
    },
  }
}

export default defineConfig({
  // 相對路徑 → 可部署到 GitHub Pages 的任何子路徑（username.github.io/repo/）
  base: './',
  plugins: [react(), tailwindcss(), preloadIconFont()],
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
