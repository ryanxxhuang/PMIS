import { createClient } from '@supabase/supabase-js'

// 從環境變數讀取（.env，前端可見的 anon key — 真正的權限由資料庫 RLS 控管）
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// ── 「保持登入」的真機制(W12 登入頁改版)────────────────────────────────
// 勾選(預設)→ token 進 localStorage,關瀏覽器仍在;取消勾選 → token 進
// sessionStorage,關閉瀏覽器即登出。不是假 checkbox:登入前呼叫
// setEphemeralAuth 切換旗標,adapter 依旗標決定寫進哪個 storage,
// 並清掉另一邊(避免舊的持久 token 在改選「不保持」後仍自動登入)。
// 讀取兩邊都查:切換偏好後既有 session 不會突然消失。
const EPHEMERAL_KEY = 'pmis-auth-ephemeral'
export function setEphemeralAuth(on) {
  try { on ? localStorage.setItem(EPHEMERAL_KEY, '1') : localStorage.removeItem(EPHEMERAL_KEY) } catch { /* noop */ }
}
const authStorage = {
  getItem: (k) => {
    try { return sessionStorage.getItem(k) ?? localStorage.getItem(k) } catch { return null }
  },
  setItem: (k, v) => {
    try {
      const ephemeral = localStorage.getItem(EPHEMERAL_KEY) === '1'
      ;(ephemeral ? sessionStorage : localStorage).setItem(k, v)
      ;(ephemeral ? localStorage : sessionStorage).removeItem(k)
    } catch { /* noop */ }
  },
  removeItem: (k) => {
    try { sessionStorage.removeItem(k); localStorage.removeItem(k) } catch { /* noop */ }
  },
}

// 私有 bucket 簽名 URL 的有效期(秒)。全站四個簽名點(照片清單、跨工項照片、
// 專案文件開檔、標註底圖)共用同一個值:URL 會被貼進 <img src>、開新分頁、
// 存進佐證包預覽,四處各寫一個 3600 的時候調整只會改到其中一處,剩下的靜默不一致。
// 1 小時 = 「看完一整份佐證包不會中途失效」與「外流的連結不會長期可用」的折衷;
// 真正的授權是 storage policy,這個 TTL 只是縮短既簽出連結的暴露窗口。
export const SIGNED_URL_TTL_S = 3600

// 尚未設定 Supabase 時為 null，App 會 fallback 回 prototype 模式，不會壞掉
export const supabase = url && anonKey
  ? createClient(url, anonKey, { auth: { storage: authStorage } })
  : null
export const isSupabaseConfigured = !!supabase
