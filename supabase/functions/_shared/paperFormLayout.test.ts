// 紙表版面(確定性):紙張偵測的成立／不成立條件,與切塊計畫的安全性質。
// 這一支不碰模型、不碰真照片——真照片的逐欄比對在 scripts/vision-regression.ts(不進 CI)。
import { describe, it, expect } from 'vitest'
import {
  BAND_MAX_ASPECT, COLUMN_GUTTER_RATIO, FORM_PAD_RATIO, MAX_TILES, TILE_MAX_PIXELS, TILE_TARGET_LONG_EDGE,
  detectPaperRegion, planPaperFormTiles, tileScale,
} from './paperFormLayout.ts'

// ── 合成影像:深色且有高頻紋理的背景 + 一塊亮且平滑的「紙」 ──────────────────
function synth(opts: {
  w: number; h: number
  paper?: { x: number; y: number; w: number; h: number; luma?: number }
  bgLuma?: number; bgTexture?: number
}) {
  const { w, h } = opts
  const data = new Uint8Array(w * h * 4)
  const bg = opts.bgLuma ?? 40
  const tex = opts.bgTexture ?? 60
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      // 背景:粗格紋理 + 雜訊(模擬鋼筋／木板——刻意用 12px 等級的特徵,
      // 高頻棋盤在縮圖時會被平均掉,那是合成圖的假象,不是真實工地背景的樣子)
      const v = bg + ((Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? tex : 0) + Math.round(rnd() * 20)
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v))
      data[i + 3] = 255
    }
  }
  const p = opts.paper
  if (p) {
    const luma = p.luma ?? 200
    for (let y = p.y; y < p.y + p.h && y < h; y++) {
      for (let x = p.x; x < p.x + p.w && x < w; x++) {
        const i = (y * w + x) * 4
        // 紙面:亮、平滑,只有稀疏的細格線(每 40 px 一條)
        const line = x % 40 === 0 || y % 40 === 0
        const v = line ? luma - 90 : luma
        data[i] = data[i + 1] = data[i + 2] = v
      }
    }
  }
  return { width: w, height: h, data }
}

describe('detectPaperRegion:偵測不到就不做逐格辨識(寧可退回舊路徑)', () => {
  it('亮且平滑的大塊區域會被抓出來,框大致對得上', () => {
    const img = synth({ w: 640, h: 480, paper: { x: 160, y: 120, w: 320, h: 240 } })
    const r = detectPaperRegion(img)
    expect(r).toBeTruthy()
    // 分析是縮圖後做的,允許幾個分析格的誤差;重點是「框得住紙、沒把整張圖都框進去」
    expect(r!.rect.x).toBeGreaterThanOrEqual(120)
    expect(r!.rect.y).toBeGreaterThanOrEqual(80)
    expect(r!.rect.x + r!.rect.w).toBeLessThanOrEqual(520)
    expect(r!.rect.y + r!.rect.h).toBeLessThanOrEqual(400)
    expect(r!.areaRatio).toBeGreaterThan(0.1)
  })

  it('整張都是工地背景(沒有紙)→ 回 null,不會硬指一塊', () => {
    expect(detectPaperRegion(synth({ w: 640, h: 480 }))).toBeNull()
  })

  it('紙太小(佔畫面不到一成)→ 回 null,不值得切也多半是反光', () => {
    expect(detectPaperRegion(synth({ w: 640, h: 480, paper: { x: 20, y: 20, w: 60, h: 40 } }))).toBeNull()
  })

  it('輸入不合理(尺寸過小／資料長度不足)→ 回 null,不丟例外', () => {
    expect(detectPaperRegion({ width: 4, height: 4, data: new Uint8Array(64) })).toBeNull()
    expect(detectPaperRegion({ width: 640, height: 480, data: new Uint8Array(10) })).toBeNull()
  })
})

describe('planPaperFormTiles:切割是純算術,同一輸入永遠同一結果', () => {
  const img = { width: 1477, height: 1108 }
  const region = { x: 552, y: 474, w: 918, h: 624 }

  it('同一輸入跑兩次得到完全相同的切塊(可重現、可回溯)', () => {
    expect(planPaperFormTiles(img, region)).toEqual(planPaperFormTiles(img, region))
  })

  it('左右兩塊**互不重疊**——同一個畫素不可能同時被當成設計值與實測值', () => {
    const { tiles } = planPaperFormTiles(img, region)
    const left = tiles.filter((t) => t.column === 'left')
    const right = tiles.filter((t) => t.column === 'right')
    expect(left.length).toBeGreaterThan(0)
    expect(right.length).toBeGreaterThan(0)
    for (const l of left) {
      for (const r of right) {
        expect(l.rect.x + l.rect.w).toBeLessThanOrEqual(r.rect.x)
      }
    }
    // 中間確實留了空隙(gutter),不是剛好貼齊
    const gap = Math.min(...right.map((r) => r.rect.x)) - Math.max(...left.map((l) => l.rect.x + l.rect.w))
    expect(gap).toBeGreaterThanOrEqual(2 * Math.round(COLUMN_GUTTER_RATIO * img.width))
  })

  it('切塊一律落在影像範圍內,且含紙張外擴的邊界補償', () => {
    const { tiles } = planPaperFormTiles(img, region)
    for (const t of tiles) {
      expect(t.rect.x).toBeGreaterThanOrEqual(0)
      expect(t.rect.y).toBeGreaterThanOrEqual(0)
      expect(t.rect.x + t.rect.w).toBeLessThanOrEqual(img.width)
      expect(t.rect.y + t.rect.h).toBeLessThanOrEqual(img.height)
    }
    const pad = Math.round(FORM_PAD_RATIO * Math.max(img.width, img.height))
    expect(Math.min(...tiles.map((t) => t.rect.y))).toBe(region.y - pad)
  })

  it('紙張貼齊畫面邊緣時外擴會被夾住,不會切到負座標', () => {
    const { tiles } = planPaperFormTiles(img, { x: 0, y: 0, w: img.width, h: img.height })
    for (const t of tiles) {
      expect(t.rect.x).toBeGreaterThanOrEqual(0)
      expect(t.rect.x + t.rect.w).toBeLessThanOrEqual(img.width)
      expect(t.rect.y + t.rect.h).toBeLessThanOrEqual(img.height)
    }
  })

  it('用量上限:塊數不超過 MAX_TILES(每張照片的呼叫次數因此有界)', () => {
    // 又高又窄的紙:本來會想切很多條列帶,必須被上限擋住並揭露
    const tall = { x: 100, y: 0, w: 300, h: 1100 }
    const { tiles, notes } = planPaperFormTiles(img, tall)
    expect(tiles.length).toBeLessThanOrEqual(MAX_TILES)
    expect(notes.join(' ')).toContain('上限')
  })

  it('自訂更小的上限也要守住(呼叫端可再收緊)', () => {
    const { tiles } = planPaperFormTiles(img, { x: 100, y: 0, w: 300, h: 1100 }, { maxTiles: 2 })
    expect(tiles.length).toBeLessThanOrEqual(2)
  })

  it('瘦長的欄會切成有重疊的上下列帶,避免正好把一列切成兩半', () => {
    const tall = { x: 300, y: 0, w: 400, h: 1100 }
    const { tiles } = planPaperFormTiles(img, tall, { maxTiles: 4 })
    const left = tiles.filter((t) => t.column === 'left')
    expect(left.length).toBe(2)
    expect(left[0].bands).toBe(2)
    // 下一條的起點要比上一條的終點早(重疊)
    expect(left[1].rect.y).toBeLessThan(left[0].rect.y + left[0].rect.h)
    // 兩條合起來要蓋滿整欄,不能中間漏掉一段
    expect(left[0].rect.y).toBe(tiles[0].rect.y)
    expect(left[1].rect.y + left[1].rect.h).toBe(Math.min(img.height, tall.y + tall.h + Math.round(FORM_PAD_RATIO * img.width)))
  })

  it('區域太窄就不分欄,整塊讀並揭露(單欄表單不會被硬切成兩半)', () => {
    const narrow = { x: 700, y: 400, w: 120, h: 300 }
    const { tiles, notes } = planPaperFormTiles(img, narrow)
    expect(tiles.every((t) => t.column === 'whole')).toBe(true)
    expect(notes.join(' ')).toContain('未分左右欄')
  })

  it('每一塊都帶原圖座標與放大倍率(observations.source 的來源)', () => {
    const { tiles } = planPaperFormTiles(img, region)
    for (const t of tiles) {
      expect(Number.isInteger(t.rect.x)).toBe(true)
      expect(Number.isInteger(t.scale)).toBe(true)
      expect(t.scale).toBeGreaterThanOrEqual(1)
      expect(t.band).toBeGreaterThanOrEqual(1)
      expect(t.bands).toBeGreaterThanOrEqual(t.band)
    }
  })
})

describe('tileScale:整數倍放大,且不超過單塊畫素上限', () => {
  it('小塊放大到接近目標長邊', () => {
    expect(tileScale({ x: 0, y: 0, w: 300, h: 400 })).toBe(Math.floor(TILE_TARGET_LONG_EDGE / 400))
  })
  it('已經夠大的塊不再放大', () => {
    expect(tileScale({ x: 0, y: 0, w: 1600, h: 1200 })).toBe(1)
  })
  it('放大後不得超過畫素上限', () => {
    const rect = { x: 0, y: 0, w: 700, h: 900 }
    const s = tileScale(rect)
    expect(rect.w * s * rect.h * s).toBeLessThanOrEqual(TILE_MAX_PIXELS)
  })
  it('常數維持在合理範圍(改動要有意識)', () => {
    expect(BAND_MAX_ASPECT).toBeGreaterThan(1)
    expect(MAX_TILES).toBeGreaterThanOrEqual(2)
  })
})
