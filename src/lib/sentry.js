import * as Sentry from '@sentry/react'

// 錯誤監控:只在「正式站(PROD build)且已設定 DSN」時啟用;demo/本機/未設 DSN 皆不送。
// DSN 是前端公開值(安全,可進 bundle),放 .env 的 VITE_SENTRY_DSN。
// Session Replay 預設遮罩所有文字與輸入、阻擋媒體 → 契約/金額/個資不會外流到 Sentry。
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn || !import.meta.env.PROD) return
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENV || 'production',
    release: import.meta.env.VITE_APP_VERSION || undefined,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
    ],
    tracesSampleRate: 0.1,          // 效能追蹤取樣 10%
    replaysSessionSampleRate: 0,    // 不錄一般 session(省流量、保護隱私)
    replaysOnErrorSampleRate: 1.0,  // 一出錯就錄 replay,供事後除錯
    // 過濾非產品雜訊(瀏覽器擴充、暫時性網路錯誤)
    ignoreErrors: [
      'ResizeObserver loop', 'Non-Error promise rejection captured',
      'Failed to fetch', 'NetworkError', 'Load failed', 'AbortError',
    ],
  })
}

export { Sentry }
