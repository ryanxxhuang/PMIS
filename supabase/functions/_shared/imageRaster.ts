// JPEG 解碼／裁切／整數倍放大／重新編碼(紙表逐格辨識 B2 專用的最小影像層)。
// ---------------------------------------------------------------------------
// 為什麼需要這一層:2026-09-20 廠商驗收 B 之後,三張紙本查驗表約 8 個手寫實測值
// 只穩定抄到 1 個。實測(見 docs/reviews/2026-09-17-product-slimming-worklog.md §9)顯示
// 根因不是模型不夠強,而是**整張照片一次讀**——鋼筋背景 + 兩欄併排的密集手寫表格,
// 同一格連讀兩次會漂。把紙表區域切成「設計值欄／實測值欄」兩塊、以原圖解析度送出之後,
// 同一支 claude-haiku-4-5 對同一格連讀兩次結果一致且正確。所以這一層存在的唯一目的是
// **在伺服器端把原圖切出可讀的小塊**,不是做影像美化。
//
// 紅線:
//   * 只做確定性運算(最近鄰取樣、整數倍放大);不做去雜訊、不做自動對比、不做旋轉校正
//     ——任何會改變畫素內容的「修圖」都會讓「原文照抄」這件事失去意義。
//   * 這是整個 _shared 目錄裡**唯一**import npm 套件做影像處理的檔案;paperFormLayout.ts
//     與 paperFormCells.ts 一律只吃純資料(Raster/Rect),才能用 vitest(Node)測。
//   * 解碼有畫素上限:超過就回 null,由呼叫端退回「整張圖一次讀」的舊路徑,不吃掉記憶體。
//
// 「原圖」的定義:Edge 端拿得到的最原始檔案就是 Storage 裡使用者上傳的那一份
//(前端 src/lib/imageCompress.js 已在上傳前壓過一次)。本層**不再壓縮、不再縮小**,
// 一律從那份位元組以原解析度裁切;回歸腳本另外分「原圖」與「前端壓縮圖」兩個條件比對。

import jpeg from 'npm:jpeg-js@0.4.4'

export type Raster = { width: number; height: number; data: Uint8Array } // RGBA
export type Rect = { x: number; y: number; w: number; h: number }

/** 解碼上限(畫素)。前端上傳長邊已壓到 2000,正常在 3M 以下;超過視為異常輸入。 */
export const MAX_DECODE_PIXELS = 16_000_000
/** 重新編碼的 JPEG 品質:高到不會再引入壓縮雜訊,又不會讓 base64 爆掉。 */
export const TILE_JPEG_QUALITY = 90

export function decodeJpeg(bytes: Uint8Array): Raster | null {
  try {
    const head = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 512 }) as unknown as Raster
    if (!head || !Number.isInteger(head.width) || !Number.isInteger(head.height)) return null
    if (head.width <= 0 || head.height <= 0) return null
    if (head.width * head.height > MAX_DECODE_PIXELS) return null
    if (!head.data || head.data.length < head.width * head.height * 4) return null
    return { width: head.width, height: head.height, data: head.data }
  } catch (e) {
    console.error('imageRaster.decodeJpeg 失敗:', String((e as Error)?.message || e))
    return null
  }
}

/** 把 rect 夾回影像範圍內;寬高至少 1。 */
export function clampRect(r: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(width - 1, Math.round(r.x)))
  const y = Math.max(0, Math.min(height - 1, Math.round(r.y)))
  const w = Math.max(1, Math.min(width - x, Math.round(r.w)))
  const h = Math.max(1, Math.min(height - y, Math.round(r.h)))
  return { x, y, w, h }
}

/**
 * 裁切 + 整數倍最近鄰放大 → JPEG 位元組。
 * 放大不會增加資訊,但會讓視覺模型在同一格字上分到更多 image token;倍率一律是整數,
 * 同一張圖同一個 rect 永遠得到同一份位元組(可重現、可回溯)。
 */
export function cropToJpeg(src: Raster, rect: Rect, scale: number): Uint8Array | null {
  const r = clampRect(rect, src.width, src.height)
  const s = Math.max(1, Math.floor(scale))
  const w = r.w * s, h = r.h * s
  if (w * h > MAX_DECODE_PIXELS) return null
  try {
    const out = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      const sy = r.y + Math.floor(y / s)
      const rowBase = sy * src.width
      for (let x = 0; x < w; x++) {
        const si = (rowBase + r.x + Math.floor(x / s)) * 4
        const di = (y * w + x) * 4
        out[di] = src.data[si]
        out[di + 1] = src.data[si + 1]
        out[di + 2] = src.data[si + 2]
        out[di + 3] = 255
      }
    }
    return jpeg.encode({ data: out, width: w, height: h }, TILE_JPEG_QUALITY).data as Uint8Array
  } catch (e) {
    console.error('imageRaster.cropToJpeg 失敗:', String((e as Error)?.message || e))
    return null
  }
}

// base64 ↔ bytes:Edge 端照片是 base64 字串進出,分塊要先變回位元組再裁切。
export function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
