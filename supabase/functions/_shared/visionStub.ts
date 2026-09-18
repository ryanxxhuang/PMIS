// 本機確定性視覺 stub(P2c 真後端 E2E 用):沒有模型金鑰也能走完「上傳→起稿→補缺→簽署→提送」
// 流程。**只在本機 `supabase functions serve` 生效、正式環境無法啟用**——兩個條件缺一不可:
//   1. 環境變數 PMIS_VISION_STUB=1(正式 Edge 不設);
//   2. SUPABASE_URL 是本機 stack 的明文 http 位址(kong／localhost／127.0.0.1／host.docker.internal);
//      正式 Edge 的 SUPABASE_URL 一律是 https://<ref>.supabase.co,永遠不符合。
// stub 輸出固定、不看影像內容:只證明流程,不證明辨識正確(模型品質見 P7b);起稿回應會在 notes 明示
// 「模型輸出為本機 stub」,前端與 BASELINE 都如實標示。work_item_hint 可由 PMIS_VISION_STUB_HINT 指定
// (E2E 用來讓照片配到標單工項、產生待補的當日數量欄)。
import type { SitePhotoResult, WhiteboardResult } from './sitePhotoVision.ts'

export const STUB_NOTE = '模型輸出為本機 stub(非真實辨識,只證明流程)'
export const STUB_MODEL = 'stub:local'

const LOCAL_HOSTS = new Set(['kong', 'localhost', '127.0.0.1', 'host.docker.internal'])

export function stubAllowed(env: { flag?: string | null; supabaseUrl?: string | null }): boolean {
  if ((env.flag ?? '').trim() !== '1') return false
  let url: URL
  try {
    url = new URL(env.supabaseUrl ?? '')
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  return LOCAL_HOSTS.has(host) || host.startsWith('supabase_kong')
}

export function stubClassify(hint?: string | null): SitePhotoResult {
  return {
    caption: '本機 stub:現場照片(非真實辨識)', category: '施工作業', is_construction: true, legible: true, has_board: false,
    work_item_hint: (hint ?? '').trim(), visible_progress: '', location: null,
  }
}

export function stubWhiteboard(): WhiteboardResult {
  return { log_date: '', weather: '', location: '', work_summary: '', items: [] }
}
