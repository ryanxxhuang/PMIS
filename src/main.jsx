import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import { StoreProvider } from './store.jsx'
import { initSentry, Sentry } from './lib/sentry.js'
import { applyTheme, watchSystemTheme } from './lib/theme.js'
// 字型走 JS import self-host(機關禁外連 CDN):index.css 的 @import 會被
// Lightning CSS 在 build 時丟棄,JS import 完全繞開。
// 圖示已改成 lucide-react 的 SVG 元件(見 components/icons.jsx),不再有圖示字型——
// 也就不再有「漏字會靜默渲染成英文字」那個坑,漏對映在 dev 會 console 警告。
import '@fontsource-variable/noto-sans-tc'
import './index.css'

initSentry() // 錯誤監控(只在正式站且有 DSN 時啟用)

// 首繪前套用主題(U-07 三態:light/dark/system);system 模式跟隨 OS 即時切換
applyTheme()
watchSystemTheme()

// 全站錯誤邊界:render 崩潰時不再是白畫面,顯示友善畫面 + 上報 Sentry(若已啟用)。
// 樣式刻意寫死 hex 而不吃 token:崩潰畫面不假設 app CSS/主題已正常載入,
// 連 index.css 都可能沒進來,所以連底色與字色都要自己畫滿(否則深色 OS 下
// 會是深底配深字)。品牌換色時要手動同步 index.css 的 --primary/--text/
// --text-2/--bg/--radius-2xl —— 目前對齊 2026-09-11 的 Apple 色票。
function CrashFallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', textAlign: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif', background: '#f5f5f7', color: '#1d1d1f' }}>
      <div style={{ maxWidth: 420 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>頁面發生錯誤</h1>
        <p style={{ fontSize: 14, color: '#56565a', margin: '0 0 20px' }}>已自動回報，我們會盡快處理。你的資料已保存，請重新整理再試。</p>
        <button onClick={() => window.location.reload()}
          style={{ background: '#0071e3', color: '#fff', border: 0, borderRadius: 12, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          重新整理
        </button>
      </div>
    </div>
  )
}

// HashRouter:不綁伺服器 rewrite 設定,任何靜態主機的任何子路徑 + 重新整理都不會壞。
// (現行部署是 Cloudflare Workers,wrangler.jsonc 已設 SPA fallback;要換成
//  BrowserRouter 是產品決策——會動到所有深連結與 e2e 的 #/ 斷言,不在重構範圍。)
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<CrashFallback />}>
      <HashRouter>
        <StoreProvider>
          <App />
        </StoreProvider>
      </HashRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
)
