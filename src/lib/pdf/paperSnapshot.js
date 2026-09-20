// 把畫面上那張紙(.paper)的排版結果抄成「繪圖指令」,交給 renderPaperPdf.js 畫成向量 PDF。
//
// 為什麼從 DOM 抄,而不是照資料再畫一次:
//   四份紙本的欄位對應(mapping)只有一份,就寫在 SiteLogOfficialSheet / SelfCheckSheet /
//   InspectionFormSheet / SupervisorLogSheet 這些元件裡。PDF 若另外照 log/version 再排一次,
//   等於同一份欄位定義有兩套實作,日後 C 包把表格改成可編輯、B 包改草稿欄位結構,PDF 就會
//   悄悄跟畫面不一致。所以這裡只做一件事:讀瀏覽器已經算好的版面(位置、字級、框線、顏色),
//   逐字抄下來。Sheet 元件本身一行都不用改。
//
// 「不是低解析度截圖」:輸出的是文字 + 線段 + 原圖照片,PDF 裡的中文可選取、可搜尋、可複製,
//   框線是向量線;只有照片本身是點陣(照片本來就是點陣)。
//
// 量測用的字型固定成 PDF 內嵌的那一支(見 font.js),並關掉 kerning／連字／等寬數字——
//   瀏覽器與 PDF 兩邊都走純 advance width,字才會落在同一個位置。畫面上的紙用的是 PingFang
//   之類的系統字,寬度與 Noto 不同,直接拿畫面座標配 Noto 字型會跑版。

// ── 字元正規化:量到什麼字、就內嵌什麼字,但有兩種例外要先處理,否則會整份停在「缺字」。
//   ① CJK 相容表意文字(U+F900–FAFF):外部貼進來的資料常夾帶這種與統一表意文字同形的碼位
//      (實測示範資料就有 冷 U+F92E、流 U+F9CA)。NFC 正規化會還原成 U+51B7／U+6D41,
//      這同時讓 PDF 的文字層可以用一般的字搜尋得到——是修正,不是繞過。
//      只在「一個碼位仍對一個碼位」時套用,避免組合字被併掉而與逐字量到的位置對不上。
//   ② Noto Sans TC 本身沒有的符號:它有 ✓(U+2713) 卻沒有 ✕/✗/✘,而自主檢查表與查驗表單
//      的判定欄同時用這兩個。以同形的 ×(U+00D7) 代替——純粹是字型層找不到字的替代,
//      判定語意不變。表以外的缺字一律停手報錯(font.js),不默默印成豆腐格。
const GLYPH_FALLBACK = new Map([
  ['\u2715', '\u00d7'], // ✕ MULTIPLICATION X
  ['\u2717', '\u00d7'], // ✗ BALLOT X
  ['\u2718', '\u00d7'], // ✘ HEAVY BALLOT X
  ['\u2613', '\u00d7'], // ☓ SALTIRE
])

function normalizeChar(ch) {
  const fallback = GLYPH_FALLBACK.get(ch)
  if (fallback) return fallback
  const nfc = ch.normalize('NFC')
  return [...nfc].length === 1 ? nfc : ch
}

// ── 顏色:computed style 可能是 rgb()、rgba()、也可能是 oklch()(Tailwind v4 調色盤)。
// 與其一種一種解析,直接丟給 canvas 讓瀏覽器自己算,再讀回像素。結果快取,同一份紙通常只有幾種顏色。
function makeColorParser() {
  const cache = new Map()
  let ctx = null
  return (css) => {
    if (!css) return null
    const hit = cache.get(css)
    if (hit !== undefined) return hit
    if (!ctx) {
      const c = document.createElement('canvas')
      c.width = 1; c.height = 1
      ctx = c.getContext('2d', { willReadFrequently: true })
    }
    let out = null
    try {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000000'
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      out = { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: d[3] / 255 }
    } catch {
      out = null
    }
    cache.set(css, out)
    return out
  }
}

// ── 基線:PDF 的文字是以基線定位,DOM 只給得到字框。用一顆 vertical-align:baseline 的
// 零尺寸 inline-block 當探針,它的 top 就是基線 y。字框高度會受 line-height 影響,所以
// 探針要用「同字級＋同 line-height」量,結果以字級正規化後快取。
function makeBaselineProbe(host, fontFamily) {
  const cache = new Map()
  return (fontSizePx, lineHeight) => {
    const key = `${fontSizePx}|${lineHeight}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const wrap = document.createElement('div')
    wrap.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:pre;font-family:${fontFamily};font-size:${fontSizePx}px;line-height:${lineHeight};`
    const text = document.createElement('span')
    text.textContent = '漢Ag'
    const strut = document.createElement('span')
    strut.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;'
    wrap.append(text, strut)
    host.appendChild(wrap)
    let ratio = 0.8
    try {
      const range = document.createRange()
      range.selectNodeContents(text)
      const tr = range.getClientRects()[0]
      const sr = strut.getBoundingClientRect()
      if (tr && fontSizePx > 0) ratio = (sr.top - tr.top) / fontSizePx
    } finally {
      host.removeChild(wrap)
    }
    cache.set(key, ratio)
    return ratio
  }
}

// 表單控件沒有 text node,量不到字。在離畫面的複本裡把它換成等效的 div,
// 讓瀏覽器照原本的字型／寬度／內距重新斷行,後面就能跟一般文字一樣逐字量。
function inlineFormControls(root) {
  const controls = root.querySelectorAll('input, textarea, select')
  for (const el of controls) {
    const cs = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    let value = ''
    if (el.tagName === 'SELECT') value = el.selectedOptions?.[0]?.textContent || ''
    else if (el.type === 'checkbox' || el.type === 'radio') value = el.checked ? '■' : '□'
    else value = el.value ?? ''
    const div = document.createElement('div')
    div.textContent = value
    div.style.cssText = [
      `width:${box.width}px`, `min-height:${box.height}px`,
      `font:${cs.font || `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`}`,
      `padding:${cs.padding}`, `color:${cs.color}`, `text-align:${cs.textAlign}`,
      'white-space:pre-wrap', 'overflow-wrap:break-word', 'box-sizing:border-box',
    ].join(';')
    el.replaceWith(div)
  }
}

function rectOf(r, originX, originY) {
  return { x: r.left - originX, y: r.top - originY, w: r.width, h: r.height }
}

function pushBorders(ops, style, r, originX, originY, theadId, parseColor) {
  const sides = [
    ['Top', r.left, r.top, r.right, r.top],
    ['Bottom', r.left, r.bottom, r.right, r.bottom],
    ['Left', r.left, r.top, r.left, r.bottom],
    ['Right', r.right, r.top, r.right, r.bottom],
  ]
  for (const [side, x1, y1, x2, y2] of sides) {
    const w = parseFloat(style[`border${side}Width`]) || 0
    const st = style[`border${side}Style`]
    if (w <= 0 || st === 'none' || st === 'hidden') continue
    // 線畫在框線寬度的中線上,才不會整體外擴半個線寬
    const off = w / 2
    const dx = side === 'Left' ? off : side === 'Right' ? -off : 0
    const dy = side === 'Top' ? off : side === 'Bottom' ? -off : 0
    ops.push({
      t: 'line', theadId,
      x1: x1 - originX + dx, y1: y1 - originY + dy,
      x2: x2 - originX + dx, y2: y2 - originY + dy,
      width: w, dashed: st === 'dashed' || st === 'dotted',
      color: parseColor(style[`border${side}Color`]),
    })
  }
}

/**
 * 量測一張紙,回傳繪圖指令與分頁所需的資訊。
 * @param {HTMLElement} paperEl 畫面上的 .paper 元素(不會被改動,內部自己複製一份離畫面量)
 * @param {{fontFamily:string}} opts fontFamily = PDF 內嵌字型在瀏覽器註冊的 family 名
 */
export function snapshotPaper(paperEl, { fontFamily }) {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.className = 'pdf-export-host'
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1400px;z-index:-1;pointer-events:none;'
  const clone = paperEl.cloneNode(true)
  clone.classList.add('pdf-export')
  host.appendChild(clone)
  document.body.appendChild(host)

  try {
    inlineFormControls(clone)

    const rootRect = clone.getBoundingClientRect()
    const rootStyle = getComputedStyle(clone)
    const pad = {
      top: parseFloat(rootStyle.paddingTop) || 0,
      right: parseFloat(rootStyle.paddingRight) || 0,
      bottom: parseFloat(rootStyle.paddingBottom) || 0,
      left: parseFloat(rootStyle.paddingLeft) || 0,
    }
    const originX = rootRect.left + pad.left
    const originY = rootRect.top + pad.top
    const contentWidth = rootRect.width - pad.left - pad.right
    if (!(contentWidth > 10)) throw new Error('量不到紙張寬度,無法產生 PDF')

    const parseColor = makeColorParser()
    const baselineRatio = makeBaselineProbe(host, fontFamily)
    const ops = []
    const atoms = []
    const tables = []
    const usedChars = new Set()
    const images = []
    const range = document.createRange()
    let theadSeq = 0
    let maxBottom = 0

    const track = (bottom) => { if (bottom > maxBottom) maxBottom = bottom }

    function collectText(node, style, theadId) {
      const data = node.data
      if (!data) return
      const size = parseFloat(style.fontSize) || 12
      const weight = parseInt(style.fontWeight, 10) || 400
      const color = parseColor(style.color)
      const ratio = baselineRatio(size, style.lineHeight)

      // 逐字量:位置一律以瀏覽器算出來的為準,空白折疊、換行、對齊都自動吃到。
      const chars = []
      for (let i = 0; i < data.length; i++) {
        const cp = data.codePointAt(i)
        const len = cp > 0xffff ? 2 : 1
        const ch = normalizeChar(data.slice(i, i + len))
        i += len - 1
        range.setStart(node, i - len + 1)
        range.setEnd(node, i + 1)
        const list = range.getClientRects()
        if (list.length === 0) continue
        const rr = list[0]
        if (rr.width <= 0) continue // 被折疊掉的空白、零寬字元:沒有位置就不抄
        chars.push({ ch, left: rr.left, top: rr.top, bottom: rr.bottom, right: rr.right })
      }
      if (chars.length === 0) return

      // 同一列(top 相同)的字併成一個 run
      let run = null
      const flush = () => {
        if (!run) return
        const text = run.chars.map((c) => c.ch).join('')
        if (text.trim() !== '') {
          for (const c of text) usedChars.add(c)
          ops.push({
            t: 'text', theadId, size, weight, color,
            x: run.chars[0].left - originX,
            baseline: run.top - originY + ratio * size,
            top: run.top - originY,
            bottom: run.bottom - originY,
            text,
            xs: run.chars.map((c) => c.left - originX),
            right: run.chars[run.chars.length - 1].right - originX,
          })
          atoms.push({ top: run.top - originY, bottom: run.bottom - originY })
          track(run.bottom - originY)
        }
        run = null
      }
      for (const c of chars) {
        if (run && Math.abs(c.top - run.top) < 0.6 && c.left >= run.lastRight - 1) {
          run.chars.push(c)
          run.bottom = Math.max(run.bottom, c.bottom)
          run.lastRight = c.right
        } else {
          flush()
          run = { top: c.top, bottom: c.bottom, chars: [c], lastRight: c.right }
        }
      }
      flush()
    }

    function walk(el, theadId, isRoot = false) {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return
      const tag = el.tagName
      if (tag === 'svg' || tag === 'SVG' || tag === 'CANVAS' || tag === 'SCRIPT' || tag === 'STYLE') return

      const r = el.getBoundingClientRect()
      if (!isRoot) {
        // 紙張本身的白底與陰影不必畫(PDF 頁面本來就是白的),也不能拿它的 bottom 當內容底部——
        // 那會把紙張自己的 padding-bottom 算成內容,憑空多出一頁。
        const bg = parseColor(style.backgroundColor)
        if (bg && bg.a > 0.02 && r.width > 0 && r.height > 0) {
          ops.push({ t: 'rect', theadId, ...rectOf(r, originX, originY), color: bg })
          track(r.bottom - originY)
        }
        if (r.width > 0 || r.height > 0) pushBorders(ops, style, r, originX, originY, theadId, parseColor)
        if (r.height > 0) track(r.bottom - originY)
      }

      if (tag === 'IMG') {
        if (r.width > 1 && r.height > 1) {
          const op = {
            t: 'image', theadId, ...rectOf(r, originX, originY),
            src: el.currentSrc || el.src,
            fit: style.objectFit || 'fill',
            natural: { w: el.naturalWidth || 0, h: el.naturalHeight || 0 },
            alt: el.alt || '',
          }
          ops.push(op)
          images.push(op)
          atoms.push({ top: op.y, bottom: op.y + op.h })
        }
        return
      }

      let nextTheadId = theadId
      if (tag === 'THEAD') {
        nextTheadId = `th${theadSeq++}`
        const table = el.closest('table')
        if (table) {
          const tr = table.getBoundingClientRect()
          const hr = r
          tables.push({
            id: nextTheadId,
            top: tr.top - originY, bottom: tr.bottom - originY,
            headTop: hr.top - originY, headBottom: hr.bottom - originY,
          })
        }
      }
      if (tag === 'TR' && r.height > 0) atoms.push({ top: r.top - originY, bottom: r.bottom - originY })
      // 明確標過「不要切開」的區塊(佐證包的照片組、簽核列)照辦
      if (el.classList?.contains('break-inside-avoid') && r.height > 0) {
        atoms.push({ top: r.top - originY, bottom: r.bottom - originY })
      }

      for (const node of el.childNodes) {
        if (node.nodeType === 3) collectText(node, style, nextTheadId)
        else if (node.nodeType === 1) walk(node, nextTheadId)
      }
    }

    walk(clone, null, true)

    return {
      contentWidth,
      contentHeight: Math.max(1, maxBottom),
      padding: pad,
      ops,
      atoms,
      tables,
      images,
      usedChars,
    }
  } finally {
    document.body.removeChild(host)
  }
}
