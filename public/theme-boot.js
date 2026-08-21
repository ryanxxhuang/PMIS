// 主題 bootstrap:在樣式表生效前同步把 .dark 掛上 <html>。
// 沒有這一段的話,深色使用者每次載入都先吃到 :root 的亮色 token,等 main.jsx
// 這支 module script 執行(deferred,首繪之後)才補上 .dark → 全螢幕閃白。
//
// 為什麼是獨立檔而不是 index.html 的 inline script:public/_headers 的 CSP
// script-src 是嚴格 'self'(政府客戶的弱點掃描要求,見該檔說明),inline script
// 會被正式站擋掉而本機 dev 完全看不出來。走 same-origin 檔案就不必為了它開
// 'unsafe-inline',也不必在 _headers 維護一份會隨手改而失效的 sha256 白名單。
//
// ⚠️ 判定邏輯必須與 src/lib/theme.js 的 getThemeMode()/applyTheme() 逐字一致
// (KEY、模式清單、class 名、system 的 matchMedia 判定)。任一邊改了另一邊沒跟上,
// 會從「載入時閃一次白」惡化成「bootstrap 判深、掛載後判淺」的雙重閃爍。
;(function () {
  var v = null
  // localStorage 在隱私模式/企業政策下會 throw;與 getThemeMode 一樣退回 system
  try { v = localStorage.getItem('pmis-theme') } catch (e) { /* noop */ }
  var mode = ['light', 'dark', 'system'].indexOf(v) >= 0 ? v : 'system'
  var dark = mode === 'dark'
    || (mode === 'system' && !!window.matchMedia
      && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (dark) document.documentElement.classList.add('dark')
})()
