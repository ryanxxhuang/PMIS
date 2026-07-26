// PostgREST 分頁載入。
//
// 為什麼一定要分頁:PostgREST 單次回傳有 max_rows 上限(預設 1000),超過就「靜默截斷」
// ——不報錯、沒有任何提示。大案(3,000+ 標單工項、日誌明細逐日累積、上千頁契約)會出現
// 估驗累計少算、S 曲線失真、勾稽漏抓、契約義務只讀到前 1,000 頁,而畫面看起來完全正常。
// 這種「數字錯了但畫面正常」對機關客戶特別致命,所以任何「撈一整份清單」的查詢都要走這裡。
//
// 放在 lib 而不是 store/db.js:db.js 靜態相依 pdf.js,頁面元件引它會把 pdf 一起拖進 chunk。
export const PAGE_SIZE = 1000
// .in() 的父層 id 清單是進 URL query string 的,一次塞上千個 uuid 會超過長度上限(414);分批送。
export const IN_CHUNK = 100

// build(from, to) 每次都要回傳「新的」query builder——supabase 的 builder 是一次性 thenable,
// 不能重複 await。呼叫端的排序一律要以唯一鍵(通常是 id)收尾:沒有唯一排序鍵時,
// range 分頁在並列的列上順序不保證,會重複或漏列。
export async function pageAllSafe(build) {
  const all = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    // 中途失敗回 data:null(與單次查詢失敗同形狀),不回半份資料
    if (error) return { data: null, error }
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return { data: all, error: null }
}

// 子表依父層 id 載入:id 清單分批進 .in(),每批再各自分頁。
export async function pageAllInSafe(ids, build) {
  const all = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK)
    const { data, error } = await pageAllSafe((from, to) => build(chunk, from, to))
    if (error) return { data: null, error }
    all.push(...data)
  }
  return { data: all, error: null }
}

// 會拋的版本(B-09):原本 `const { data } = await …` 在失敗時靜默回空陣列,
// 網路/RLS 失敗使用者看到「尚無資料」而非「載入失敗」——以為缺失都結案了。
// store.jsx 的載入 effect 統一 catch → 顯示重試 banner。
export async function pageAll(build, label) {
  const { data, error } = await pageAllSafe(build)
  if (error) throw new Error(`${label}讀取失敗:${error.message}`)
  return data
}

export async function pageAllIn(ids, build, label) {
  const { data, error } = await pageAllInSafe(ids, build)
  if (error) throw new Error(`${label}讀取失敗:${error.message}`)
  return data
}

// 把一份 id/路徑清單切成每批 IN_CHUNK 個,給非 PostgREST 但同樣有批次上限的 API 用
// (例:Storage createSignedUrls——查詢分頁後照片可能上千張,簽名也得跟著分批)。
export function chunked(list, size = IN_CHUNK) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
