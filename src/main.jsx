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
// 品牌換色時要記得手動同步(Google 藍 #0b57d0/次要字 #5f6368)。
function CrashFallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 420 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>頁面發生錯誤</h1>
        <p style={{ fontSize: 14, color: '#5f6368', margin: '0 0 20px' }}>已自動回報，我們會盡快處理。你的資料已保存，請重新整理再試。</p>
        <button onClick={() => window.location.reload()}
          style={{ background: '#0b57d0', color: '#fff', border: 0, borderRadius: 100, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          重新整理
        </button>
      </div>
    </div>
  )
}

// HashRouter：GitHub Pages（及任何靜態主機）子路徑 + 重新整理都不會壞，免伺服器設定
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
