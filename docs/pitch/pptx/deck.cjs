// 簡報排版工具組 —— 從 build.js（組長簡報）抽出的共用版面元件。
// ---------------------------------------------------------------------------
// 為什麼抽出來:第二份簡報(build-partner.js,給事務所／顧問公司的合作簡報)要用同一套
// 色票與版面,否則兩份文件放在一起會像兩家公司做的。
// ⚠️ build.js 目前仍保留自己那份副本,沒有改它——它是已經寄出去的成品,
//    重構它的風險大於重複這 200 行。改動本檔不會影響組長簡報。
//
// 用法:
//   const { createKit } = require('./deck.js')
//   const { pres, C, F, W, M, CW, slide, head, ... } = createKit({ total: 26, title: '…' })

const pptxgen = require('pptxgenjs')

function createKit({ total, title, author = 'PMIS.ai' }) {
  const pres = new pptxgen()
  pres.layout = 'LAYOUT_WIDE'
  pres.author = author
  pres.title = title

  let PAGE = 0
  const TOTAL = total

  // ── 色票：深鋼青藍當場景色，內文用藍灰,全案無純黑 ─────────────────────────
  const C = {
    ink: '1D2B39', ink2: '4E5F70', ink3: '7A8794',
    paper: 'F2F5F8', card: 'FFFFFF', rule: 'D6DEE6', rule2: 'E6EBF0',
    steel: '1E5A85', steelText: '1B5480', steelTint: 'E4EDF5',
    safety: 'E8630C', safetyText: 'C05209', safetyTint: 'FCE9DC',
    good: '1A7F4E', goodTint: 'E1F1E9',
    bad: 'C0392F', badTint: 'FAE8E6',
    field: '154C74', fieldDeep: '10405F', fieldInk: 'FFFFFF', fieldInk2: 'A9C8DE',
  }
  const F = 'Arial'
  const W = 13.333
  const M = 0.72
  const CW = W - M * 2
  const TOP = 0.52



  // ── 頁面骨架 ───────────────────────────────────────────────────────────────
  function footer(s, sec, field) {
    PAGE += 1
    s.addText(sec, {
      x: M, y: 6.92, w: 7, h: 0.3, align: 'left', valign: 'middle', margin: 0,
      fontFace: F, fontSize: 9, color: field ? C.fieldInk2 : C.ink3, charSpacing: 1.8,
    })
    s.addText(`${String(PAGE).padStart(2, '0')} / ${TOTAL}`, {
      x: W - M - 2, y: 6.92, w: 2, h: 0.3, align: 'right', valign: 'middle', margin: 0,
      fontFace: F, fontSize: 9, color: field ? C.fieldInk2 : C.ink3, charSpacing: 1.8,
    })
  }
  function slide(sec, opts = {}) {
    const s = pres.addSlide()
    s.background = { color: opts.field ? C.field : C.paper }
    footer(s, sec, opts.field)
    return s
  }
  function head(s, eyebrow, title, opts = {}) {
    s.addText(eyebrow, {
      x: M, y: TOP, w: CW, h: 0.26, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 9.5, bold: true, charSpacing: 2.4,
      color: opts.q ? C.steelText : C.safetyText,
    })
    s.addText(title, {
      x: M, y: TOP + 0.32, w: CW, h: 0.64, margin: 0, valign: 'middle',
      fontFace: F, fontSize: opts.small ? 27 : 31, bold: true, color: C.ink,
    })
    return TOP + 1.1
  }

  function card(s, x, y, w, h, opts = {}) {
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w, h, rectRadius: 0.035,
      fill: { color: opts.fill || C.card },
      line: opts.fill ? { color: opts.fill } : { color: C.rule2, width: 0.75 },
      shadow: opts.flat ? undefined
        : { type: 'outer', angle: 90, blur: 7, offset: 0.035, color: '93A3B2', opacity: 0.16 },
    })
  }

  const CHIP = {
    ok: [C.goodTint, C.good], no: [C.badTint, C.bad],
    wip: [C.safetyTint, C.safetyText], na: ['E3E9EF', C.ink3],
    act: [C.steelTint, C.steelText],
  }
  function chip(s, x, y, text, kind = 'na') {
    const [bg, fg] = CHIP[kind]
    const width = 0.26 + cjkWidth(text, 9) / 72
    s.addText(text, {
      x, y, w: width, h: 0.26, margin: 0, align: 'center', valign: 'middle',
      shape: pres.ShapeType.roundRect, rectRadius: 0.03,
      fill: { color: bg }, line: { color: bg },
      fontFace: F, fontSize: 9, bold: true, color: fg, charSpacing: 0.6,
    })
    return width
  }

  // 中日韓算 1 em、拉丁 0.53 em——用來估文字會不會爆框
  function cjkWidth(str, size) {
    let n = 0
    for (const ch of String(str)) n += /[⺀-￯]/.test(ch) ? 1 : 0.53
    return n * size
  }
  const WARN = []
  function fits(label, text, boxW, boxH, size, pad = 0.24) {
    const lines = Math.ceil(cjkWidth(text, size) / ((boxW - pad * 2) * 72))
    const needed = (lines * size * 1.44) / 72
    if (needed > boxH) WARN.push(`${label}: 需 ${needed.toFixed(2)}" > 有 ${boxH.toFixed(2)}" (${lines} 行)`)
  }

  function cardText(s, x, y, w, h, title, body, opts = {}) {
    card(s, x, y, w, h, opts)
    const px = 0.24
    let cy = y + (opts.compact ? 0.14 : 0.18)
    if (opts.chip) { chip(s, x + px, cy, opts.chip[0], opts.chip[1]); cy += opts.compact ? 0.34 : 0.4 }
    if (title) {
      s.addText(title, {
        x: x + px, y: cy, w: w - px * 2, h: 0.3, margin: 0, valign: 'middle',
        fontFace: F, fontSize: opts.titleSize || 14.5, bold: true, color: opts.titleColor || C.ink,
      })
      cy += opts.compact ? 0.33 : 0.38
    }
    if (body) {
      const size = opts.bodySize || 11
      const bh = y + h - cy - 0.16
      fits(title || opts.chip?.[0] || '', body.replace(/\n/g, ''), w, bh, size)
      s.addText(body, {
        x: x + px, y: cy, w: w - px * 2, h: bh, margin: 0, valign: 'top',
        fontFace: F, fontSize: size, color: opts.bodyColor || C.ink2, lineSpacing: size * 1.44,
      })
    }
  }

  function bullets(s, x, y, w, items, mark = 'dash', size = 11, color = C.ink2) {
    const glyph = { tick: '✓', cross: '✕', dash: '—' }[mark]
    const gc = { tick: C.good, cross: C.bad, dash: C.ink3 }[mark]
    const rowH = size > 11.5 ? 0.32 : 0.29
    items.forEach((t, i) => {
      const yy = y + i * rowH
      s.addText(glyph, {
        x, y: yy, w: 0.24, h: rowH, margin: 0, valign: 'middle',
        fontFace: F, fontSize: mark === 'dash' ? 8 : 10.5, bold: true, color: gc,
      })
      s.addText(t, {
        x: x + 0.24, y: yy, w: w - 0.24, h: rowH, margin: 0, valign: 'middle',
        fontFace: F, fontSize: size, color,
      })
    })
    return y + items.length * rowH
  }

  function cite(s, x, y, w, h, label, text) {
    card(s, x, y, w, h, { flat: true })
    s.addText(
      [{ text: label + '　', options: { bold: true, color: C.steelText } },
       { text, options: { color: C.ink2 } }],
      { x: x + 0.26, y: y + 0.06, w: w - 0.52, h: h - 0.12, margin: 0, valign: 'middle', fontFace: F, fontSize: 11, lineSpacing: 15.5 },
    )
  }

  function table(s, x, y, w, rows, colW, opts = {}) {
    s.addTable(rows, {
      x, y, w, colW,
      fontFace: F, fontSize: opts.size || 10.5, color: C.ink2,
      border: { type: 'solid', color: C.rule2, pt: 0.5 },
      align: 'left', valign: 'middle',
      margin: [opts.pad || 8, 10, opts.pad || 8, 10],
      autoPage: false,
    })
  }
  const th = (t) => ({ text: t, options: { bold: true, color: C.steelText, fontSize: 9.5, charSpacing: 1.2, fill: { color: C.steelTint } } })
  const td = (t, o = {}) => ({ text: t, options: { fill: { color: C.card }, ...o } })
  const tdb = (t, o = {}) => td(t, { bold: true, color: C.ink, ...o })
  const tds = (t, k) => td(t, { align: 'center', bold: true, color: CHIP[k][1], fill: { color: CHIP[k][0] } })

  function chain(s, y, nodes, hotIdx = -1) {
    const gap = 0.34
    const nw = (CW - gap * (nodes.length - 1)) / nodes.length
    nodes.forEach((n, i) => {
      const x = M + i * (nw + gap)
      const hot = i === hotIdx
      s.addShape(pres.ShapeType.roundRect, {
        x, y, w: nw, h: 0.88, rectRadius: 0.035,
        fill: { color: hot ? C.safetyTint : C.card },
        line: { color: hot ? C.safety : C.rule2, width: hot ? 1.5 : 0.75 },
      })
      s.addText(n[0], {
        x, y: y + 0.13, w: nw, h: 0.22, margin: 0, align: 'center', valign: 'middle',
        fontFace: F, fontSize: 8.5, bold: true, charSpacing: 1.4, color: hot ? C.safetyText : C.ink3,
      })
      s.addText(n[1], {
        x, y: y + 0.37, w: nw, h: 0.34, margin: 0, align: 'center', valign: 'middle',
        fontFace: F, fontSize: 13.5, bold: true, color: C.ink,
      })
      if (i < nodes.length - 1) {
        s.addShape(pres.ShapeType.line, {
          x: x + nw + 0.06, y: y + 0.44, w: gap - 0.12, h: 0,
          line: { color: C.steel, width: 1.25, endArrowType: 'triangle' },
        })
      }
    })
    return y + 0.88
  }

  function stat(s, x, y, w, fig, cap, color = C.ink) {
    s.addText(String(fig), {
      x, y, w, h: 0.7, margin: 0, valign: 'bottom',
      fontFace: F, fontSize: 44, bold: true, color,
    })
    s.addText(cap, {
      x, y: y + 0.72, w, h: 0.26, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 9.5, bold: true, charSpacing: 1.6, color: C.ink3,
    })
  }


  // ── 截圖:16:10 的 demo 畫面,加細框讓它在淺灰底上有邊界 ──────────────────
  function shot(s, x, y, w, file, opts = {}) {
    const h = opts.h || w / 1.6            // 截圖一律 1440x900
    s.addShape(pres.ShapeType.rect, {
      x: x - 0.03, y: y - 0.03, w: w + 0.06, h: h + 0.06,
      fill: { color: C.card }, line: { color: C.rule, width: 0.75 },
      shadow: { type: 'outer', angle: 90, blur: 10, offset: 0.05, color: '93A3B2', opacity: 0.22 },
    })
    s.addImage({ path: file, x, y, w, h })
    if (opts.caption) {
      s.addText(opts.caption, {
        x, y: y + h + 0.06, w, h: 0.22, margin: 0, valign: 'middle',
        fontFace: F, fontSize: 9, color: C.ink3, charSpacing: 0.6,
      })
    }
    return y + h
  }

  return {
    pres, C, F, W, M, CW, TOP, WARN,
    slide, head, card, cardText, chip, bullets, cite, table, chain, stat, shot,
    th, td, tdb, tds, cjkWidth, fits,
    page: () => PAGE,
  }
}

module.exports = { createKit }
