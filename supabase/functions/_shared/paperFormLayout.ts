// 紙本表單的**確定性版面**:紙張區域偵測 + 切塊計畫。純資料進出,不碰模型、不碰 npm。
// ---------------------------------------------------------------------------
// 2026-09-20 廠商驗收 B2。為什麼版面不交給模型決定:
//   實測過三張真實紙表,要模型回「表單外框 + 設計/實測分欄線」的 0~1000 相對座標,
//   分欄線的答案**每次都是 500**(它給的是先驗中點,不是量出來的),外框誤差最大到畫面 1/3。
//   把裁切交給這種輸出,等於把「這一格屬於設計欄還是實測欄」建立在模型的猜測上——
//   而這正是 B 包留下來的錯(整張圖一次讀,設計/實測分不清)。所以:
//     * 紙張區域 → 確定性影像分析(亮、低紋理、最大連通區);實測 IoU 0.72~0.82,
//       覆蓋真實表單 94~99%,~20ms。
//     * 分欄位置 → 紙張區域的**幾何中線往左偏一個固定比例**(純算術;見 COLUMN_BOUNDARY_SHIFT_RATIO)。
//       與模型給的 500/1000 等價但不必多打一次 API,而且同一張圖永遠切在同一個位置(可重現);
//       偏移量是版面決定的,不是調參數:右欄的欄名貼著分欄線右側,切在中點就會把它切掉。
//     * 「這一塊到底是設計欄還是實測欄」→ **不由幾何決定**,由該塊裡印刷的欄位標題決定
//       (見 paperFormCells.ts 的 column_seen 核對);幾何只負責把兩欄切開且**互不重疊**,
//       所以同一個畫素不可能同時被當成設計值與實測值。
//   切歪的代價因此是「讀不到、留空待人填」,不是「把設計值填進實測欄」。
//
// 座標一律是**原圖畫素**,隨結果一路帶到 observations.source,人可以回頭看是從哪一塊讀來的。

export type Rect = { x: number; y: number; w: number; h: number }
export type RasterLike = { width: number; height: number; data: Uint8Array } // RGBA

// ── 紙張區域偵測 ───────────────────────────────────────────────────────────
/** 分析縮圖長邊(夠看出紙張輪廓,又讓整支在數十毫秒內跑完)。 */
export const PAPER_ANALYSIS_EDGE = 240
/** 亮度下限:量過三張真實紙表,表單內 p10 亮度 98~106,背景中位數 35~44。 */
export const PAPER_MIN_LUMA = 85
/** 紙張至少要佔畫面這麼大,否則不值得切(也多半是誤判的反光點)。 */
export const PAPER_MIN_AREA_RATIO = 0.10
/** 連通區要填滿自己的外框到這個比例,擋掉細長的反光條與邊框。 */
export const PAPER_MIN_FILL = 0.45

export type PaperRegion = { rect: Rect; fill: number; areaRatio: number }

/**
 * 找畫面中最大的一塊「亮且低紋理」區域當作紙張。
 * 低紋理是關鍵:工地背景(鋼筋、木板、碎石)再亮也有高頻紋理,紙面只有細格線與字。
 * 不符合面積／填滿比例就回 null——**偵測不到就不做逐格辨識**,退回整張圖一次讀的舊路徑。
 */
export function detectPaperRegion(img: RasterLike): PaperRegion | null {
  const { width: W, height: H, data } = img
  if (W < 8 || H < 8 || data.length < W * H * 4) return null
  const step = Math.max(1, Math.round(Math.max(W, H) / PAPER_ANALYSIS_EDGE))
  const aw = Math.floor(W / step), ah = Math.floor(H / step)
  if (aw < 4 || ah < 4) return null

  const lum = new Float32Array(aw * ah)
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      let r = 0, g = 0, b = 0, n = 0
      for (let dy = 0; dy < step; dy++) {
        const rowBase = (y * step + dy) * W
        for (let dx = 0; dx < step; dx++) {
          const i = (rowBase + x * step + dx) * 4
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
        }
      }
      lum[y * aw + x] = (0.299 * r + 0.587 * g + 0.114 * b) / n
    }
  }

  // 局部紋理 = 5×5 窗內的平均絕對偏差
  const R = 2
  const tex = new Float32Array(aw * ah)
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      let sum = 0, n = 0
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= ah) continue
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= aw) continue
          sum += lum[yy * aw + xx]; n++
        }
      }
      const mean = sum / n
      let dev = 0
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= ah) continue
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= aw) continue
          dev += Math.abs(lum[yy * aw + xx] - mean)
        }
      }
      tex[y * aw + x] = dev / n
    }
  }

  const lumTh = Math.max(PAPER_MIN_LUMA, percentile(lum, 0.70))
  const texTh = percentile(tex, 0.50)
  const mask = new Uint8Array(aw * ah)
  for (let i = 0; i < mask.length; i++) mask[i] = lum[i] >= lumTh && tex[i] <= texTh ? 1 : 0

  // 閉運算:格線與手寫會在紙面上打洞,先膨脹再侵蝕把紙補回一整塊
  const closed = erode3(dilate3(mask, aw, ah), aw, ah)

  // 最大 4-連通元件
  const comp = new Int32Array(aw * ah).fill(-1)
  let best: { size: number; x0: number; y0: number; x1: number; y1: number } | null = null
  const stack: number[] = []
  for (let seed = 0; seed < closed.length; seed++) {
    if (!closed[seed] || comp[seed] >= 0) continue
    stack.length = 0
    stack.push(seed)
    comp[seed] = seed
    let size = 0, x0 = aw, y0 = ah, x1 = 0, y1 = 0
    while (stack.length) {
      const c = stack.pop()!
      const cx = c % aw, cy = (c - cx) / aw
      size++
      if (cx < x0) x0 = cx
      if (cx > x1) x1 = cx
      if (cy < y0) y0 = cy
      if (cy > y1) y1 = cy
      if (cx > 0) push(c - 1)
      if (cx < aw - 1) push(c + 1)
      if (cy > 0) push(c - aw)
      if (cy < ah - 1) push(c + aw)
    }
    if (!best || size > best.size) best = { size, x0, y0, x1, y1 }
    function push(k: number) { if (closed[k] && comp[k] < 0) { comp[k] = seed; stack.push(k) } }
  }
  if (!best) return null

  const bw = best.x1 - best.x0 + 1, bh = best.y1 - best.y0 + 1
  const fill = best.size / (bw * bh)
  const areaRatio = best.size / (aw * ah)
  if (areaRatio < PAPER_MIN_AREA_RATIO || fill < PAPER_MIN_FILL) return null
  return {
    rect: { x: best.x0 * step, y: best.y0 * step, w: Math.min(W - best.x0 * step, bw * step), h: Math.min(H - best.y0 * step, bh * step) },
    fill,
    areaRatio,
  }
}

function percentile(a: Float32Array, p: number): number {
  const s = Float32Array.from(a).sort()
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))]
}
function dilate3(m: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let on = 0
    for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1 && !on; dx++) {
      const yy = y + dy, xx = x + dx
      if (yy >= 0 && yy < h && xx >= 0 && xx < w && m[yy * w + xx]) on = 1
    }
    o[y * w + x] = on
  }
  return o
}
function erode3(m: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let all = 1
    for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1 && all; dx++) {
      const yy = y + dy, xx = x + dx
      if (yy < 0 || yy >= h || xx < 0 || xx >= w || !m[yy * w + xx]) all = 0
    }
    o[y * w + x] = all
  }
  return o
}

// ── 切塊計畫 ───────────────────────────────────────────────────────────────
/** 每張照片最多切幾塊(用量上限的一部分:塊數 × 每塊次數 = 呼叫次數上限)。 */
export const MAX_TILES = 4
/** 每塊最多讀幾次(兩次一致才採用,沿用 B 的規則)。 */
export const PASSES_PER_TILE = 2
/** 偵測到的紙張往外多留一點,補償連通區被陰影吃掉的邊。 */
export const FORM_PAD_RATIO = 0.02
/** 兩欄之間各退這麼多,確保兩塊**互不重疊**(同一畫素不會同時算設計與實測)。 */
export const COLUMN_GUTTER_RATIO = 0.008
/**
 * 分欄界線往**左**(設計欄那側)挪這麼多。不是隨便調的常數,是版面決定的:
 * 台灣這類查驗表左右兩欄的名稱都印在**該欄的最左上角**——左欄的「設計值:」貼在整張表的左邊,
 * 永遠在左塊裡;右欄的「實測值:」則緊貼分欄線右側,界線只要落在分欄線右邊一點,它就被切掉了。
 * 切掉的後果不是讀錯而是**整塊作廢**(kind 只能來自印刷的欄位標題),白花錢又讀不到。
 * 所以界線刻意往左偏一點,讓右塊一定含得到自己的欄名;左欄的值一般不會寫到欄位最右緣,
 * 偏太多才會吃到設計值——真的吃到時,右塊會同時看到兩個欄名而整塊作廢,還是不會把設計值當實測。
 * 實測(2026-09-20 三張真實紙表):界線在紙寬中點左移 3% 時,三張的右塊都含得到「實測值:」。
 */
export const COLUMN_BOUNDARY_SHIFT_RATIO = 0.03
/**
 * 第一次切完,若**剛好有一側讀不到自己的欄名**(另一側讀得到),就用這個比例再切一次那一側。
 * 為什麼要重試而不是一開始就偏更多:偏越多,右塊越可能吃到左欄的值;3% 對三張實測樣本裡的
 * 兩張夠用,第三張的分欄線比中點左 6%,只好多付一次。重試只做**沒讀到欄名的那一側**、只做一次,
 * 成本上限是每張照片多兩次呼叫;重試後仍讀不到欄名就留空待人填,不再往左試。
 */
export const COLUMN_BOUNDARY_RETRY_SHIFT_RATIO = 0.07
/** 一塊太瘦長(高/寬 超過這個值)就再切成上下列帶,免得字太小。 */
export const BAND_MAX_ASPECT = 2.2
/** 列帶之間的重疊比例,避免正好把一列切成兩半。 */
export const BAND_OVERLAP_RATIO = 0.12
/** 放大後的目標長邊;整數倍放大,不超過上限。 */
export const TILE_TARGET_LONG_EDGE = 1400
/** 單塊放大後的畫素上限(控 image token)。 */
export const TILE_MAX_PIXELS = 1_600_000

export type TileColumn = 'left' | 'right' | 'whole'
export type TilePlan = {
  index: number
  column: TileColumn
  band: number       // 第幾條列帶(1 起)
  bands: number      // 這一欄共幾條列帶
  rect: Rect         // 原圖畫素座標(可回溯)
  scale: number      // 整數倍放大
}

/** 同一張圖、同一個紙張區域,永遠得到同一份切塊計畫(純算術,可單元測試)。 */
export function planPaperFormTiles(
  img: { width: number; height: number },
  region: Rect,
  opts: { maxTiles?: number; boundaryShift?: number } = {},
): { tiles: TilePlan[]; notes: string[] } {
  const notes: string[] = []
  const maxTiles = Math.max(1, opts.maxTiles ?? MAX_TILES)
  // 界線偏移只准落在這個範圍:偏到 0 就等於中點切(右塊會切掉自己的欄名),
  // 偏超過 0.15 就等於把左欄的值送進右塊,兩種都不安全。
  const shift = Math.min(0.15, Math.max(0, opts.boundaryShift ?? COLUMN_BOUNDARY_SHIFT_RATIO))
  const pad = Math.round(FORM_PAD_RATIO * Math.max(img.width, img.height))
  const fx0 = Math.max(0, Math.round(region.x) - pad)
  const fy0 = Math.max(0, Math.round(region.y) - pad)
  const fx1 = Math.min(img.width, Math.round(region.x + region.w) + pad)
  const fy1 = Math.min(img.height, Math.round(region.y + region.h) + pad)
  const form: Rect = { x: fx0, y: fy0, w: Math.max(1, fx1 - fx0), h: Math.max(1, fy1 - fy0) }

  const gutter = Math.max(1, Math.round(COLUMN_GUTTER_RATIO * img.width))
  // 界線=紙寬中點往左偏(見 COLUMN_BOUNDARY_SHIFT_RATIO:右欄的欄名貼著分欄線右側,切掉就整塊作廢)
  const boundary = form.x + Math.round(form.w * (0.5 - shift))
  const leftW = boundary - gutter - form.x
  const rightX = boundary + gutter
  const rightW = form.x + form.w - rightX

  // 欄寬太窄就不分欄(單欄表單／偵測到的區域本來就很窄):整塊讀,kind 仍由欄位標題決定
  const columns: { column: TileColumn; rect: Rect }[] = leftW >= 80 && rightW >= 80
    ? [
      { column: 'left', rect: { x: form.x, y: form.y, w: leftW, h: form.h } },
      { column: 'right', rect: { x: rightX, y: form.y, w: rightW, h: form.h } },
    ]
    : [{ column: 'whole', rect: form }]
  if (columns.length === 1) notes.push('紙張區域太窄,未分左右欄,整塊讀取')

  const perColumn = Math.max(1, Math.floor(maxTiles / columns.length))
  const tiles: TilePlan[] = []
  for (const c of columns) {
    const wanted = Math.max(1, Math.ceil(c.rect.h / (c.rect.w * BAND_MAX_ASPECT)))
    const bands = Math.min(wanted, perColumn)
    if (wanted > bands) notes.push(`${c.column} 欄本應切 ${wanted} 條列帶,受每張照片 ${maxTiles} 塊上限限制,只切 ${bands} 條`)
    const overlap = bands > 1 ? Math.round(c.rect.h * BAND_OVERLAP_RATIO) : 0
    const baseH = Math.ceil((c.rect.h + overlap * (bands - 1)) / bands)
    for (let b = 0; b < bands; b++) {
      const y = Math.max(c.rect.y, Math.round(c.rect.y + b * (baseH - overlap)))
      const h = Math.min(baseH, c.rect.y + c.rect.h - y)
      if (h <= 0) continue
      const rect: Rect = { x: c.rect.x, y, w: c.rect.w, h }
      tiles.push({ index: tiles.length, column: c.column, band: b + 1, bands, rect, scale: tileScale(rect) })
    }
  }
  return { tiles, notes }
}

/** 整數倍放大:把長邊拉到目標值,但不超過單塊畫素上限。 */
export function tileScale(rect: Rect): number {
  const longEdge = Math.max(rect.w, rect.h)
  let s = Math.max(1, Math.floor(TILE_TARGET_LONG_EDGE / Math.max(1, longEdge)))
  while (s > 1 && rect.w * s * rect.h * s > TILE_MAX_PIXELS) s--
  return s
}
