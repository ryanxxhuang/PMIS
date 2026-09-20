// imageRaster / paperFormImaging 的 Deno 測試(唯一會真的解碼 JPEG 的一層)。
// 跑法:npm run test:edge。用合成 JPEG,不讀任何真實現場照片。
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import jpeg from 'npm:jpeg-js@0.4.4'
import { MAX_DECODE_PIXELS, base64ToBytes, bytesToBase64, clampRect, cropToJpeg, decodeJpeg } from './imageRaster.ts'
import { preparePaperFormTiles } from './paperFormImaging.ts'

// 合成一張「工地背景 + 一塊亮紙」的 JPEG
function synthJpeg(w: number, h: number, paper?: { x: number; y: number; w: number; h: number }): Uint8Array {
  const data = new Uint8Array(w * h * 4)
  let seed = 11
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const v = 40 + ((Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? 60 : 0) + Math.round(rnd() * 20)
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  }
  if (paper) {
    for (let y = paper.y; y < paper.y + paper.h && y < h; y++) {
      for (let x = paper.x; x < paper.x + paper.w && x < w; x++) {
        const i = (y * w + x) * 4
        const v = x % 40 === 0 || y % 40 === 0 ? 110 : 205
        data[i] = data[i + 1] = data[i + 2] = v
      }
    }
  }
  return jpeg.encode({ data, width: w, height: h }, 92).data as Uint8Array
}

Deno.test('decodeJpeg:一般 JPEG 解得開,非 JPEG 回 null 不丟例外', () => {
  const bytes = synthJpeg(160, 120)
  const r = decodeJpeg(bytes)
  assert(r)
  assertEquals(r!.width, 160)
  assertEquals(r!.height, 120)
  assertEquals(r!.data.length, 160 * 120 * 4)
  assertEquals(decodeJpeg(new Uint8Array([1, 2, 3, 4])), null)
  assertEquals(decodeJpeg(new Uint8Array(0)), null)
})

Deno.test('clampRect:一律夾回影像內,寬高至少 1(不會切到負座標或越界)', () => {
  assertEquals(clampRect({ x: -50, y: -50, w: 500, h: 500 }, 100, 100), { x: 0, y: 0, w: 100, h: 100 })
  assertEquals(clampRect({ x: 95, y: 95, w: 50, h: 50 }, 100, 100), { x: 95, y: 95, w: 5, h: 5 })
  assertEquals(clampRect({ x: 10, y: 10, w: 0, h: 0 }, 100, 100), { x: 10, y: 10, w: 1, h: 1 })
})

Deno.test('cropToJpeg:裁切＋整數倍放大,尺寸正確且同輸入同輸出(可重現)', () => {
  const src = decodeJpeg(synthJpeg(200, 160))!
  const a = cropToJpeg(src, { x: 20, y: 20, w: 100, h: 80 }, 2)
  const b = cropToJpeg(src, { x: 20, y: 20, w: 100, h: 80 }, 2)
  assert(a && b)
  assertEquals(bytesToBase64(a!), bytesToBase64(b!)) // 位元組完全一致
  const out = decodeJpeg(a!)!
  assertEquals(out.width, 200)
  assertEquals(out.height, 160)
})

Deno.test('cropToJpeg:放大後超過畫素上限就回 null,不吃記憶體', () => {
  const src = decodeJpeg(synthJpeg(64, 64))!
  const big = Math.ceil(Math.sqrt(MAX_DECODE_PIXELS / (64 * 64))) + 2
  assertEquals(cropToJpeg(src, { x: 0, y: 0, w: 64, h: 64 }, big), null)
})

Deno.test('base64 往返不失真', () => {
  const bytes = synthJpeg(64, 48)
  const back = base64ToBytes(bytesToBase64(bytes))!
  assertEquals(back.length, bytes.length)
  assertEquals(back[0], bytes[0])
  assertEquals(back[back.length - 1], bytes[bytes.length - 1])
  assertEquals(base64ToBytes('!!!not base64!!!'), null)
})

Deno.test('preparePaperFormTiles:有紙 → 切出互不重疊的左右塊,每塊都帶原圖座標', () => {
  const bytes = synthJpeg(640, 480, { x: 160, y: 120, w: 320, h: 240 })
  const r = preparePaperFormTiles(bytesToBase64(bytes), 'image/jpeg')
  assertEquals(r.reason, null)
  assert(r.region)
  assert(r.tiles.length >= 2)
  const left = r.tiles.filter((t) => t.column === 'left')
  const right = r.tiles.filter((t) => t.column === 'right')
  assert(left.length > 0 && right.length > 0)
  for (const l of left) for (const rt of right) assert(l.rect.x + l.rect.w <= rt.rect.x)
  for (const t of r.tiles) {
    assert(t.base64.length > 0)
    assertEquals(t.mime, 'image/jpeg')
    const img = decodeJpeg(base64ToBytes(t.base64)!)!
    assertEquals(img.width, t.rect.w * t.scale)
    assertEquals(img.height, t.rect.h * t.scale)
  }
})

Deno.test('preparePaperFormTiles:沒有紙、非 JPEG、壞位元組 → 一律回原因而不是硬切', () => {
  const noPaper = preparePaperFormTiles(bytesToBase64(synthJpeg(640, 480)), 'image/jpeg')
  assertEquals(noPaper.tiles.length, 0)
  assert(noPaper.reason?.includes('紙張'))

  const png = preparePaperFormTiles('AAAA', 'image/png')
  assertEquals(png.tiles.length, 0)
  assert(png.reason?.includes('JPEG'))

  const broken = preparePaperFormTiles('!!!!', 'image/jpeg')
  assertEquals(broken.tiles.length, 0)
  assert(broken.reason)
})
