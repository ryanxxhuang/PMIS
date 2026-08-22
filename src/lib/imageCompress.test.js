import { describe, it, expect } from 'vitest'
import { targetDimensions, shouldSkipCompression, compressImage, MAX_EDGE_PX, SKIP_BELOW_BYTES } from './imageCompress.js'

// canvas/createImageBitmap 在 node 環境不存在,壓縮成功路徑(重取樣+toBlob)
// 測不到——這裡釘住的是純邏輯(尺寸計算、放行判斷)與「失敗必回原檔」的紅線。

describe('targetDimensions — 長邊上限等比縮放', () => {
  it('超過上限:長邊縮到 2000、短邊等比', () => {
    expect(targetDimensions(4000, 3000)).toEqual({ width: 2000, height: 1500, scaled: true })
    expect(targetDimensions(3000, 4000)).toEqual({ width: 1500, height: 2000, scaled: true })
  })

  it('未超過上限:原尺寸不動(只縮不放大)', () => {
    expect(targetDimensions(1600, 1200)).toEqual({ width: 1600, height: 1200, scaled: false })
    expect(targetDimensions(MAX_EDGE_PX, 100)).toEqual({ width: MAX_EDGE_PX, height: 100, scaled: false })
  })

  it('極端長寬比:短邊四捨五入、不歸零', () => {
    const { width, height } = targetDimensions(10000, 100)
    expect(width).toBe(2000)
    expect(height).toBe(20)
  })

  it('缺尺寸(解碼異常)不縮放', () => {
    expect(targetDimensions(0, 3000).scaled).toBe(false)
    expect(targetDimensions(undefined, undefined).scaled).toBe(false)
  })
})

describe('shouldSkipCompression — 放行判斷', () => {
  const f = (type, size) => ({ type, size })

  it('非圖片(PDF/文件)一律放行——重編碼會壞檔', () => {
    expect(shouldSkipCompression(f('application/pdf', 5e6))).toBe(true)
    expect(shouldSkipCompression(f('', 5e6))).toBe(true)
  })

  it('GIF/SVG 放行——動畫與向量重編碼是劣化', () => {
    expect(shouldSkipCompression(f('image/gif', 5e6))).toBe(true)
    expect(shouldSkipCompression(f('image/svg+xml', 5e6))).toBe(true)
  })

  it('小圖放行、大圖要壓(門檻 300KB)', () => {
    expect(shouldSkipCompression(f('image/jpeg', SKIP_BELOW_BYTES - 1))).toBe(true)
    expect(shouldSkipCompression(f('image/jpeg', SKIP_BELOW_BYTES))).toBe(false)
    expect(shouldSkipCompression(f('image/png', 5e6))).toBe(false)
    expect(shouldSkipCompression(f('image/heic', 5e6))).toBe(false) // 先試壓,壓不動再 fallback
  })

  it('空值/無 size 放行(防禦)', () => {
    expect(shouldSkipCompression(null)).toBe(true)
    expect(shouldSkipCompression({})).toBe(true)
  })
})

describe('compressImage — 壓縮是優化不是閘門', () => {
  it('放行的檔案原封不動回傳(同一個參照)', async () => {
    const pdf = { type: 'application/pdf', size: 5e6 }
    expect(await compressImage(pdf)).toBe(pdf)
  })

  it('解碼失敗(此環境無 createImageBitmap)fallback 回原檔,不丟錯', async () => {
    const big = { type: 'image/jpeg', size: 5e6, name: 'site.jpg' }
    expect(await compressImage(big)).toBe(big)
  })
})
