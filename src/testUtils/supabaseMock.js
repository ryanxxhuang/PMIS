// 兩種在測試裡反覆出現的 supabase 模組替身。
//
// 為什麼是「回傳 factory 的函式」而不是常數:vi.mock 的呼叫會被提升到所有 import
// 之前,factory 本體卻要等被 mock 的模組第一次載入時才執行——那時本檔(在 vi.mock
// 之後、目標模組之前 import)已經初始化完畢,所以 factory 內部可以安全引用這裡的
// 匯出;反過來在 vi.mock 那一行就呼叫(例如 configured(client))則會踩到 TDZ。
//
// 用法:
//   vi.mock('../../lib/supabase.js', unconfigured)
//   vi.mock('../../lib/supabase.js', () => configured(h.client))

// demo 模式:模組鏈只是要 import 過去,測的是純函式,不該真的建 supabase client
// (node 環境沒有 WebSocket,真 client 會炸)。
export const unconfigured = () => ({ supabase: null, isSupabaseConfigured: false })

// 真後端模式:把可斷言的假 client 掛上去,讓「有沒有打到 DB」變成可測。
export const configured = (client) => ({ supabase: client, isSupabaseConfigured: true })
