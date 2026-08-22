// 現場照片上傳前的 client 端壓縮。工地手機照動輒 3–8MB,原圖直傳 Storage 後,
// 清單縮圖與估驗佐證包都抓同一份原圖——Supabase egress 按量計費,載入時間也隨
// 照片數線性爆炸,所以在上傳這一站先重取樣。
//
// 品質取捨(照片是佐證,不是美術品,但也不能壓到看不清):長邊 2000px + JPEG 0.82
// 對缺失佐證、估驗佐證的辨識度綽綽有餘(裂縫、鋼筋號數、告示板文字都還讀得到),
// 檔案通常縮到數百 KB;不要為了再省流量壓到 1280px 以下——佐證照片放大檢視時
// 細節會開始糊掉,省的那點 egress 不值得賠上證據力。
//
// 紅線:壓縮是流量優化,不是上傳閘門。任何一步失敗(不支援的格式如 HEIC、
// canvas 記憶體不足…)一律 fallback 原圖照傳——寧可多花流量,不能讓佐證傳不上去。

export const MAX_EDGE_PX = 2000        // 長邊上限(見上方品質取捨)
export const JPEG_QUALITY = 0.82
export const SKIP_BELOW_BYTES = 300 * 1024 // 已經夠小的檔再壓只是白耗手機 CPU

// 等比縮放後的目標尺寸(純邏輯,可測)。只縮不放大:小圖放大只會變糊變大。
export function targetDimensions(width, height, maxEdge = MAX_EDGE_PX) {
  if (!width || !height) return { width, height, scaled: false }
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height, scaled: false }
  const scale = maxEdge / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale), scaled: true }
}

// 哪些檔案直接放行(純邏輯,可測):非圖片(PDF 等文件重編碼會壞)、
// GIF/SVG(動圖會失去動畫、向量轉點陣是劣化)、已經夠小的圖。
export function shouldSkipCompression(file, skipBelow = SKIP_BELOW_BYTES) {
  if (!file || typeof file.size !== 'number') return true
  const type = file.type || ''
  if (!type.startsWith('image/')) return true
  if (type === 'image/gif' || type === 'image/svg+xml') return true
  return file.size < skipBelow
}

// File/Blob → 壓縮後的 File(JPEG)。跳過或失敗時原封不動回傳輸入值,
// 呼叫端不必分辨有沒有壓成——直接拿回傳值上傳即可。
export async function compressImage(file, { maxEdge = MAX_EDGE_PX, quality = JPEG_QUALITY, skipBelow = SKIP_BELOW_BYTES } = {}) {
  if (shouldSkipCompression(file, skipBelow)) return file
  let bitmap
  try {
    // from-image:解碼時套用 EXIF 方向,輸出像素已轉正——否則手機直拍經 canvas
    // 重取樣後 EXIF 被剝掉,照片就永遠躺著了
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const { width, height, scaled } = targetDimensions(bitmap.width, bitmap.height, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    // 重編碼反而變大(常見於已高度壓縮、又不需縮邊的圖):留原檔
    if (!blob?.size || (!scaled && blob.size >= file.size)) return file
    // 內容已轉成 JPEG,副檔名必須跟著換——上傳路徑的 ext 取自 file.name
    const base = (file.name || 'photo').replace(/\.[^.]+$/, '')
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified ?? Date.now() })
  } catch {
    return file // 見頂部紅線:壓不了就照傳原圖
  } finally {
    bitmap?.close?.()
  }
}
