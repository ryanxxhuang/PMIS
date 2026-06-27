import { createClient } from '@supabase/supabase-js'

// 從環境變數讀取（.env，前端可見的 anon key — 真正的權限由資料庫 RLS 控管）
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// 尚未設定 Supabase 時為 null，App 會 fallback 回 prototype 模式，不會壞掉
export const supabase = url && anonKey ? createClient(url, anonKey) : null
export const isSupabaseConfigured = !!supabase
