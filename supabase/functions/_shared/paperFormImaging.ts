// 把「一張照片的 base64」變成「可以逐格辨識的小塊」的那一步(唯一同時碰影像解碼與版面的地方)。
// ---------------------------------------------------------------------------
// 分工:imageRaster.ts 只會解碼／裁切(唯一 import npm 的檔);paperFormLayout.ts 只做
// 確定性版面計算(純資料,vitest 可測);本檔把兩者接起來,供 draft-field-documents 注入
// 給 fieldDocDraftRun —— 執行流程本身照舊不 import 任何 npm,才能繼續用記憶體假物件測。
//
// 任何一步不成立(不是 JPEG、畫素太多、偵測不到紙張、切不出塊)都回 { tiles: [], reason }
// ——呼叫端退回「整張圖一次讀」的 B 路徑,不是硬切一塊送出去。

import { base64ToBytes, bytesToBase64, cropToJpeg, decodeJpeg } from './imageRaster.ts'
import { detectPaperRegion, planPaperFormTiles } from './paperFormLayout.ts'
import type { TilePlan } from './paperFormLayout.ts'

export type PreparedTile = TilePlan & { base64: string; mime: 'image/jpeg' }
export type PreparedTiles = {
  tiles: PreparedTile[]
  reason: string | null
  region: { x: number; y: number; w: number; h: number } | null
  notes: string[]
}

const NONE = (reason: string): PreparedTiles => ({ tiles: [], reason, region: null, notes: [] })

export function preparePaperFormTiles(
  base64: string,
  mime: string | null | undefined,
  opts: { maxTiles?: number; boundaryShift?: number; columns?: ('left' | 'right' | 'whole')[] } = {},
): PreparedTiles {
  if (mime && !/^image\/jpe?g$/i.test(mime)) return NONE(`逐格辨識只支援 JPEG,這張是 ${mime}`)
  const bytes = base64ToBytes(base64)
  if (!bytes) return NONE('照片位元組解不開,未做逐格辨識')
  const raster = decodeJpeg(bytes)
  if (!raster) return NONE('照片無法解碼或尺寸超過上限,未做逐格辨識')
  const region = detectPaperRegion(raster)
  if (!region) return NONE('畫面中找不到夠大的紙張區域,未做逐格辨識')
  const { tiles: all, notes } = planPaperFormTiles({ width: raster.width, height: raster.height }, region.rect, opts)
  // columns:只要其中一側(重切時只重讀讀不到欄名的那一側,另一側的結果照舊沿用)
  const plans = opts.columns?.length ? all.filter((t) => opts.columns!.includes(t.column)) : all
  if (!plans.length) return NONE('切不出可讀的區塊,未做逐格辨識')
  const tiles: PreparedTile[] = []
  for (const p of plans) {
    const jpg = cropToJpeg(raster, p.rect, p.scale)
    if (!jpg) { notes.push(`第 ${p.index + 1} 塊裁切失敗,略過`); continue }
    tiles.push({ ...p, base64: bytesToBase64(jpg), mime: 'image/jpeg' })
  }
  if (!tiles.length) return NONE('所有區塊裁切都失敗,未做逐格辨識')
  return { tiles, reason: null, region: region.rect, notes }
}
