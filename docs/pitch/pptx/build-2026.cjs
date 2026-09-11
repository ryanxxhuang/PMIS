// ============================================================================
// PMIS.ai 合作簡報（建築師事務所／工程顧問公司）— 2026-08 全新視覺版
// ----------------------------------------------------------------------------
// 視覺語彙直接沿用產品本體（src/index.css 的 Google Workspace 版 token）：
//   底 #F8FAFD ／ 卡面白 ＋ #E3E6EA 卡框 ／ 主色 #0B57D0 ／ 內文 #202124 · #5F6368
//   狀態色票 green/amber/red/purple 與產品同值 —— 簡報與產品放在一起要像同一家的東西。
//
// 兩條講話紅線（沿用舊檔，不要破壞）：
//   1) 標的一律「雲端訂閱服務（SaaS）」，不得出現「開發／客製／建置」。
//   2) 時程不寫死；金額只能出現在最後一頁（P16）。
//
// 產出（三步，缺一不可）：
//   node docs/pitch/pptx/shots.js          # 重截 demo 站畫面（UI 一直在動，不要用舊圖）
//   python3 docs/pitch/pptx/crop.py        # 裁掉側欄與頁首，產生 docs/pitch/shots-crop/
//   node docs/pitch/pptx/build-2026.cjs /tmp/raw.pptx
//   python3 docs/pitch/pptx/fix_ea.py /tmp/raw.pptx "docs/pitch/<檔名>.pptx"   # 補中日韓字型
//   python3 docs/pitch/pptx/check_fit.py "docs/pitch/<檔名>.pptx"              # 出血與表格撐高檢查
// ============================================================================
const pptxgen = require('pptxgenjs')
const path = require('node:path')

// 路徑一律相對於本檔,從 repo 根目錄或任何地方跑都一樣
const OUT = process.argv[2] || path.resolve(__dirname, '../../../tmp/raw.pptx')
const SHOTS = path.resolve(__dirname, '../shots-crop')

const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE'
pres.author = 'PMIS.ai'
pres.title = 'PMIS.ai 合作簡報｜建築師事務所與工程顧問公司'

// ── 色票（= 產品 token）─────────────────────────────────────────────────────
const C = {
  ink: '202124', ink2: '5F6368', ink3: '6A6E73',
  ground: 'F8FAFD', card: 'FFFFFF', line: 'E3E6EA', line2: 'E8EAED', surf2: 'F1F3F4',
  blue: '0B57D0', blueText: '174EA6', blueTint: 'E8F0FE',
  green: '137333', greenTint: 'E6F4EA',
  amber: 'B06000', amberTint: 'FEF7E0',
  red: 'A50E0E', redTint: 'FCE8E6',
  purple: '681DA8', purpleTint: 'F3E8FD',
  deep: '062E6F', deep2: '0A3D8F', onDeep: 'FFFFFF', onDeep2: 'A8C7FA', onDeep3: '7FA9E8',
}
const F = 'Arial'
const W = 13.333, H = 7.5, M = 0.62, CW = W - M * 2
const TOTAL = 16
let PAGE = 0

// ── 頁面骨架 ────────────────────────────────────────────────────────────────
function slide(sec, dark = false) {
  const s = pres.addSlide()
  s.background = { color: dark ? C.deep : C.ground }
  PAGE += 1
  if (!dark) {
    s.addShape(pres.ShapeType.line, { x: M, y: 6.86, w: CW, h: 0, line: { color: C.line2, width: 0.75 } })
  }
  s.addText([
    { text: 'PMIS', options: { bold: true, color: dark ? C.onDeep2 : C.ink3 } },
    { text: '.ai', options: { bold: true, color: dark ? C.onDeep2 : C.blue } },
    { text: '   ' + sec, options: { color: dark ? C.onDeep3 : C.ink3 } },
  ], { x: M, y: 6.96, w: 8, h: 0.28, margin: 0, valign: 'middle', fontFace: F, fontSize: 9, charSpacing: 1.2 })
  s.addText(`${String(PAGE).padStart(2, '0')} / ${TOTAL}`, {
    x: W - M - 2, y: 6.96, w: 2, h: 0.28, margin: 0, align: 'right', valign: 'middle',
    fontFace: F, fontSize: 9, color: dark ? C.onDeep3 : C.ink3, charSpacing: 1.2,
  })
  return s
}

// 頁首：藥丸眉標 ＋ 大標 ＋ 副標。回傳內容區起始 y。
function head(s, eyebrow, title, sub) {
  s.addText(eyebrow, {
    x: M, y: 0.44, w: eyebrowW(eyebrow), h: 0.3, margin: 0, align: 'center', valign: 'middle',
    shape: pres.ShapeType.roundRect, rectRadius: 0.14,
    fill: { color: C.blueTint }, line: { color: C.blueTint },
    fontFace: F, fontSize: 10, bold: true, charSpacing: 1.6, color: C.blueText,
  })
  s.addText(title, {
    x: M, y: 0.84, w: CW, h: 0.54, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 27, bold: true, color: C.ink,
  })
  if (sub) {
    s.addText(sub, {
      x: M, y: 1.4, w: CW, h: 0.3, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 13, color: C.ink2,
    })
    return 1.92
  }
  return 1.56
}

// 眉標藥丸的寬度要跟字數走,否則短標籤後面拖一條空白底
function eyebrowW(text) { return Math.max(1.15, 0.34 + text.length * 0.16) }
const head2 = head

// ── 元件 ────────────────────────────────────────────────────────────────────
function card(s, x, y, w, h, opts = {}) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.035,
    fill: { color: opts.fill || C.card },
    line: { color: opts.line || C.line, width: 1 },
    shadow: opts.flat ? undefined
      : { type: 'outer', angle: 90, blur: 4, offset: 0.5 / 72 * 3, color: '3C4043', opacity: 0.1 },
  })
}

function cardText(s, x, y, w, h, title, body, o = {}) {
  card(s, x, y, w, h, o)
  s.addText(title, {
    x: x + 0.26, y: y + 0.2, w: w - 0.52, h: o.titleH || 0.36, margin: 0, valign: 'middle',
    fontFace: F, fontSize: o.titleSize || 15, bold: true, color: o.titleColor || C.ink,
  })
  s.addText(body, {
    x: x + 0.26, y: y + 0.2 + (o.titleH || 0.36) + 0.08, w: w - 0.52, h: h - (o.titleH || 0.36) - 0.56,
    margin: 0, valign: 'top', fontFace: F, fontSize: o.bodySize || 11.5, color: C.ink2,
    lineSpacing: o.lineSpacing || (o.bodySize && o.bodySize < 11 ? 15.5 : 17),
  })
}

function bullets(s, x, y, w, items, o = {}) {
  const size = o.size || 11.5
  s.addText(items.map((t) => ({
    text: t,
    options: {
      bullet: { characterCode: o.tick ? '2713' : '2013', indent: 14 },
      breakLine: true, fontSize: size, color: o.color || C.ink2,
      paraSpaceAfter: o.gap === undefined ? 5 : o.gap,
    },
  })), {
    x, y, w, h: o.h || (items.length * (size / 72) * 2.15 + 0.2),
    margin: 0, valign: 'top', fontFace: F, lineSpacing: o.lineSpacing || size * 1.42,
  })
}

const TONE = {
  blue: [C.blueTint, C.blueText], green: [C.greenTint, C.green],
  amber: [C.amberTint, C.amber], red: [C.redTint, C.red],
  purple: [C.purpleTint, C.purple], mute: [C.surf2, C.ink2],
}
function chip(s, x, y, text, tone = 'blue', o = {}) {
  const [bg, fg] = TONE[tone]
  s.addText(text, {
    x, y, w: o.w || Math.max(0.7, 0.3 + text.length * 0.135), h: o.h || 0.28,
    margin: 0, align: 'center', valign: 'middle',
    shape: pres.ShapeType.roundRect, rectRadius: 0.16,
    fill: { color: bg }, line: { color: bg },
    fontFace: F, fontSize: o.size || 9.5, bold: true, color: fg,
  })
}

// 數字卡（對齊產品 Dashboard 的指標卡）
function stat(s, x, y, w, h, label, figure, unit, sub) {
  card(s, x, y, w, h)
  s.addText(label, {
    x: x + 0.24, y: y + 0.18, w: w - 0.48, h: 0.24, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 10, color: C.ink2,
  })
  s.addText([
    { text: figure, options: { fontSize: 27, bold: true, color: C.blue } },
    ...(unit ? [{ text: ' ' + unit, options: { fontSize: 12, bold: true, color: C.ink2 } }] : []),
  ], { x: x + 0.24, y: y + 0.46, w: w - 0.48, h: 0.5, margin: 0, valign: 'middle', fontFace: F })
  if (sub) {
    s.addText(sub, {
      x: x + 0.24, y: y + 0.98, w: w - 0.48, h: h - 1.16, margin: 0, valign: 'top',
      fontFace: F, fontSize: 9.5, color: C.ink3, lineSpacing: 13,
    })
  }
}

// 產品截圖框：白卡 ＋ 內縮圖 ＋ 圖說
function shot(s, x, y, w, file, o = {}) {
  const dim = { 'sv-dashboard': 1.653, 'sv-contract': 1.578, 'sv-agent': 1.625, 'sv-agent-panel': 0.554,
    'sv-quality': 1.859, 'sv-valuation': 1.859, 'sv-itp': 1.859, 'ct-sitelog': 1.859,
    'ow-portfolio': 1.859, 'ow-audit': 1.859, 'sv-nav': 1.6, 'sv-submittals': 1.859,
    'sv-rail': 0.2861 }[file]
  const pad = 0.1
  const iw = w - pad * 2
  const ih = iw / dim
  const h = ih + pad * 2 + (o.caption ? 0.34 : 0)
  card(s, x, y, w, h, { flat: true, line: C.line })
  s.addImage({ path: path.join(SHOTS, file + '.png'), x: x + pad, y: y + pad, w: iw, h: ih })
  s.addShape(pres.ShapeType.rect, { x: x + pad, y: y + pad, w: iw, h: ih, fill: { type: 'none' }, line: { color: C.line2, width: 0.75 } })
  if (o.caption) {
    s.addText(o.caption, {
      x: x + pad + 0.04, y: y + pad + ih + 0.02, w: iw - 0.08, h: 0.3, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 9.5, color: C.ink3,
    })
  }
  return h
}

// 出處／註記列
function cite(s, x, y, w, h, label, text) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.035, fill: { color: C.surf2 }, line: { color: C.surf2 },
  })
  s.addText(label, {
    x: x + 0.24, y: y + 0.14, w: 1.5, h: 0.24, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 9.5, bold: true, charSpacing: 1.4, color: C.ink3,
  })
  s.addText(text, {
    x: x + 1.72, y: y + 0.1, w: w - 1.96, h: h - 0.2, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 10, color: C.ink2, lineSpacing: 14,
  })
}

// 流程鏈
function chain(s, x, y, w, steps, o = {}) {
  const n = steps.length
  const arrow = 0.3
  const cw = (w - arrow * (n - 1)) / n
  steps.forEach(([t, b, tone], i) => {
    const cx = x + i * (cw + arrow)
    const [, fg] = TONE[tone || 'blue']
    card(s, cx, y, cw, o.h || 1.5, { flat: true })
    s.addShape(pres.ShapeType.rect, { x: cx, y, w: cw, h: 0.055, fill: { color: fg } })
    s.addText(t, {
      x: cx + 0.18, y: y + 0.24, w: cw - 0.36, h: 0.3, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 12.5, bold: true, color: C.ink,
    })
    s.addText(b, {
      x: cx + 0.18, y: y + 0.58, w: cw - 0.36, h: (o.h || 1.5) - 0.74, margin: 0, valign: 'top',
      fontFace: F, fontSize: 9.5, color: C.ink2, lineSpacing: 13,
    })
    if (i < n - 1) {
      s.addText('▸', {
        x: cx + cw, y: y + (o.h || 1.5) / 2 - 0.15, w: arrow, h: 0.3, margin: 0,
        align: 'center', valign: 'middle', fontFace: F, fontSize: 13, color: C.ink3,
      })
    }
  })
}

// 表格（產品表格的視覺：無框線、只有橫向細線、表頭淡底）
function table(s, x, y, w, rows, colW, o = {}) {
  s.addTable(rows, {
    x, y, w, colW,
    border: [{ type: 'none' }, { type: 'none' }, { pt: 0.75, color: C.line2 }, { type: 'none' }],
    fontFace: F, fontSize: o.size || 11, color: C.ink2, valign: 'middle',
    margin: [o.pad || 9, 10, o.pad || 9, 10],
  })
}
const th = (t) => ({ text: t, options: { bold: true, color: C.ink3, fontSize: 9.5, charSpacing: 1.2, fill: { color: C.surf2 } } })
const tdb = (t) => ({ text: t, options: { bold: true, color: C.ink } })
const td = (t, o = {}) => ({ text: t, options: o })

// ═══════════════════════════════════════════════════════════════════════════
// 01 封面
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('合作簡報', true)
  // 右側大面積淡藍色塊：呼應產品 App bar 的搜尋框藍
  s.addShape(pres.ShapeType.rect, { x: 8.6, y: 0, w: 4.733, h: H, fill: { color: C.deep2 } })
  s.addShape(pres.ShapeType.rect, { x: 8.6, y: 0, w: 0.04, h: H, fill: { color: C.onDeep2 } })

  s.addText([
    { text: 'PMIS', options: { bold: true, color: C.onDeep } },
    { text: '.ai', options: { bold: true, color: C.onDeep2 } },
  ], { x: M, y: 1.0, w: 5, h: 0.7, margin: 0, valign: 'middle', fontFace: F, fontSize: 34 })
  s.addText('公共工程', {
    x: M + 2.1, y: 1.08, w: 2, h: 0.5, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 15, color: C.onDeep3, charSpacing: 1.6,
  })

  s.addText('讓監造與專管的\n每一位工程師，\n配一個讀過本案契約的 Agent。', {
    x: M, y: 2.3, w: 7.6, h: 2.3, margin: 0, valign: 'top',
    fontFace: F, fontSize: 30, bold: true, color: C.onDeep, lineSpacing: 46,
  })
  s.addText('契約與規範由 AI 讀成可追的要求與期限；現場填一次，日誌、查驗、估驗與報表一起長出來。\n判定、核准與簽名，永遠留在貴所的工程師手上。', {
    x: M, y: 4.8, w: 7.5, h: 0.9, margin: 0, valign: 'top',
    fontFace: F, fontSize: 12.5, color: C.onDeep2, lineSpacing: 20,
  })

  s.addShape(pres.ShapeType.line, { x: M, y: 5.95, w: 7.4, h: 0, line: { color: '2A5AA8', width: 1 } })
  s.addText('合作簡報　·　建築師事務所與工程顧問公司　·　2026 年 8 月', {
    x: M, y: 6.1, w: 7.4, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 11, color: C.onDeep3, charSpacing: 0.8,
  })

  // 右欄：今天要講的四件事
  const items = [
    ['壹', '我是誰', '監造、機關、系統，這三方我都待過'],
    ['貳', '要解決什麼', '同一件事被記在四個地方'],
    ['參', '產品做到哪', '正式站在跑，不是原型'],
    ['肆', '怎麼合作', '從零承諾的一步開始'],
  ]
  items.forEach(([n, t, b], i) => {
    const y = 1.55 + i * 1.16
    s.addText(n, {
      x: 9.05, y, w: 0.42, h: 0.42, margin: 0, align: 'center', valign: 'middle',
      shape: pres.ShapeType.roundRect, rectRadius: 0.2,
      fill: { color: '154A9E' }, line: { color: '154A9E' },
      fontFace: F, fontSize: 12, bold: true, color: C.onDeep2,
    })
    s.addText(t, {
      x: 9.62, y, w: 3.3, h: 0.4, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 15.5, bold: true, color: C.onDeep,
    })
    s.addText(b, {
      x: 9.62, y: y + 0.42, w: 3.3, h: 0.5, margin: 0, valign: 'top',
      fontFace: F, fontSize: 10, color: C.onDeep3, lineSpacing: 14,
    })
  })
  s.addText('示範站　gov-agent.ai　·　選任一角色即可進入，不需帳號', {
    x: 9.05, y: 6.1, w: 3.9, h: 0.4, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 9.5, color: C.onDeep3, lineSpacing: 13,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 02 為什麼是我
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('壹 · 背景')
  const y = head2(s, '背景', '為什麼是我', '產品分成監造、機關、系統三方；這三方我剛好都待過。')
  const gap = 0.3, cw = (CW - gap * 2) / 3
  const cols = [
    ['監造這一側', '台灣世曦工程顧問｜監造', 'green', [
      '查驗、送審、估驗覆核都自己做過',
      '監造報表與缺失追蹤的工時，我自己耗過',
      '土木本科出身，看得懂圖也看得懂標單',
    ]],
    ['機關這一側', '公務機關｜4 年', 'blue', [
      '走過簽辦、審查、發包到驗收的內部流程',
      '知道承辦人真正會被卡在哪一關',
      '也知道機關為什麼對 AI 特別謹慎',
    ]],
    ['系統這一側', 'AI Agent 新創｜產品經理', 'purple', [
      '這套系統是我自己做的，不是外包',
      '從資料模型到 AI 邊界都自己決定',
      '土木出身，之後補了資工與商管',
    ]],
  ]
  cols.forEach(([tag, role, tone, items], i) => {
    const x = M + i * (cw + gap)
    card(s, x, y, cw, 2.06)
    chip(s, x + 0.24, y + 0.2, tag, tone)
    s.addText(role, {
      x: x + 0.24, y: y + 0.56, w: cw - 0.48, h: 0.38, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 15.5, bold: true, color: C.ink,
    })
    bullets(s, x + 0.24, y + 1.0, cw - 0.48, items, { size: 10.5, gap: 4 })
  })

  // 獎項橫帶：整頁唯一的琥珀實色元素，視線一定先落在這裡
  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: y + 2.24, w: CW, h: 0.6, rectRadius: 0.06,
    fill: { color: C.amberTint }, line: { color: 'F0C27B', width: 1 },
  })
  s.addText('工程榮譽', {
    x: M + 0.28, y: y + 2.24, w: 1.4, h: 0.6, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 9.5, bold: true, charSpacing: 1.6, color: C.amber,
  })
  s.addText('擔任主辦的工程，獲公共工程金質獎、金品獎', {
    x: M + 1.72, y: y + 2.24, w: CW - 2.0, h: 0.6, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 16, bold: true, color: C.ink,
  })

  cardText(s, M, y + 3.02, CW, 1.22,
    '所以「這個痛點是不是真的」，我不用回去問人。',
    '監造的查驗與送審、機關的簽辦與驗收、系統的資料模型與 AI 邊界——這三件事平常分屬三種人，很少落在同一個人身上。這套系統之所以敢把 AI 鎖在草稿這一側、把判定與簽名留給人，正是因為我知道簽下去的人要承擔什麼。',
    { titleSize: 15, bodySize: 11.5 })

  cite(s, M, y + 4.4, CW, 0.44, '學歷',
    '中央大學土木工程學士　·　交通大學土木工程碩士　·　Georgia Tech 資訊工程碩士（MSCS）　·　UCLA 企業管理碩士（MBA）')
}

// ═══════════════════════════════════════════════════════════════════════════
// 03 一頁講完
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('壹 · 背景')
  const y = head2(s, '一頁講完', '契約進來，紀錄出去，中間那段由系統接。', '同一份資料只填一次，日誌、查驗、估驗、報表與稽核佐證一起長出來。')

  chain(s, M, y, CW, [
    ['① 契約與規範', '整本 PDF／Word 丟進來，不必拆檔、不必先標類型', 'blue'],
    ['② AI 讀出要求', '期限、罰則、查驗停留點，每一條都帶條號與頁碼', 'purple'],
    ['③ 人核定', '核定後才成為本案規則——AI 的結果不會自己生效', 'green'],
    ['④ 現場填一次', '手機填日誌與自主檢查；照片可先傳，AI 擬草稿', 'blue'],
    ['⑤ 紀錄自動長出', '查驗、缺失、估驗、報表與佐證包沿同一條資料線', 'amber'],
  ], { h: 1.66 })

  const gap = 0.3, cw = (CW - gap * 2) / 3
  const roles = [
    ['廠商', '現場填報、施工日誌、估驗、成本、品質與工安', 'blue'],
    ['監造', '查驗、送審審查、缺失複查、估驗覆核', 'green'],
    ['機關', '跨案監督、契約期限、付款、驗收與勾稽稽核', 'purple'],
  ]
  roles.forEach(([t, b, tone], i) => {
    const x = M + i * (cw + gap)
    card(s, x, y + 1.94, cw, 1.24)
    chip(s, x + 0.24, y + 2.12, t + ' Agent', tone)
    s.addText(b, {
      x: x + 0.24, y: y + 2.48, w: cw - 0.48, h: 0.62, margin: 0, valign: 'top',
      fontFace: F, fontSize: 11, color: C.ink2, lineSpacing: 15,
    })
  })

  cardText(s, M, y + 3.42, CW, 1.28,
    '三方在同一個案子裡，看同一份資料，各自只有自己該有的權限。',
    '不是三套系統互相寄檔案，也不是共用一個帳號。權限、狀態轉移與稽核留痕都在伺服器端與資料庫層強制執行——監造改不了廠商送出的原始填報，廠商也關不掉監造開立的缺失。',
    { titleSize: 15, bodySize: 11.5 })
}

// ═══════════════════════════════════════════════════════════════════════════
// 04 問題（一）
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('貳 · 痛點')
  const y = head2(s, '痛點', '資料不是沒有，是同一件事被記在四個地方。', '每多一個地方，就多一次重打、一次版本差異、一次對不起來。')

  const gap = 0.26, cw = (CW - gap * 3) / 4
  const src = [
    ['LINE 群組', '現場照片、口頭指示、臨時協調——找得到的當下有用，三個月後查不回來。', 'green'],
    ['Excel', '估驗表、缺失追蹤表、進度表各一份，版本靠檔名，改了不會互相通知。', 'blue'],
    ['紙本／PDF', '契約、規範、施工計畫、查驗表。期限藏在條文裡，沒有人再讀第二次。', 'red'],
    ['信箱', '送審往返與退回補正。審了幾次、上次退什麼理由，要往回翻信。', 'amber'],
  ]
  src.forEach(([t, b, tone], i) => {
    const x = M + i * (cw + gap)
    card(s, x, y, cw, 1.66)
    s.addShape(pres.ShapeType.rect, { x, y, w: cw, h: 0.055, fill: { color: TONE[tone][1] } })
    s.addText(t, {
      x: x + 0.24, y: y + 0.24, w: cw - 0.48, h: 0.32, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 14.5, bold: true, color: C.ink,
    })
    s.addText(b, {
      x: x + 0.24, y: y + 0.62, w: cw - 0.48, h: 0.9, margin: 0, valign: 'top',
      fontFace: F, fontSize: 10.5, color: C.ink2, lineSpacing: 15,
    })
  })

  cardText(s, M, y + 1.9, CW, 1.36,
    '結果不是「資料遺失」，是「對不起來」。',
    '估驗報的數量，對不上施工日誌的完成量；缺失結案了，但佐證照片在誰的手機裡沒人知道；監造報表每個月重打一次，因為來源資料本來就不在同一個地方。這些正是機關驗收與稽核最愛問、也最花貴所人力回答的問題。',
    { titleSize: 15, bodySize: 11.5 })

  bullets(s, M + 0.04, y + 3.46, CW, [
    '貴所賣的是專業判斷，不是把同一筆數字抄到第四個檔案裡的工時',
    '同一批人力能接的案量，取決於「行政重工」佔掉多少小時',
    '機關近年要的佐證越來越完整——缺的不是能力，是把既有紀錄串起來的工具',
  ], { size: 12.5, color: C.ink, gap: 7 })
}

// ═══════════════════════════════════════════════════════════════════════════
// 05 問題（二）
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('貳 · 痛點')
  const y = head2(s, '痛點', '真正的成本不在打字，在「說不清楚」。', '監造的簽名是有責任的；出事時要拿得出來的，是佐證與時序。')

  const gap = 0.3, cw = (CW - gap) / 2
  const left = [
    ['期限藏在條文裡', '開工後 15 日內、每月幾號前、逾期每日按契約價金 0.5‰ 計罰——寫在契約第 9 條、第 13 條，沒有人每天回去翻。'],
    ['退件理由散在信裡', '同一份送審審了三次，上一次退什麼、改了沒有，要靠承辦人記憶或往回翻信箱。'],
    ['佐證要用時才發現缺', '缺失結案了，改善照片在誰的手機；試體逾期未試驗，沒有人被提醒。'],
  ]
  const right = [
    ['月報與結算是重工高峰', '資料本來就分散，所以每個月、每一期都要重新彙整一次，而且每次都可能對不起來。'],
    ['爭議時翻不出時序', '誰在哪一天指示了什麼、依據哪一條、誰核定的——這些答不出來，責任就會往簽名的人身上靠。'],
    ['機關的要求只會更細', '稽核、審計與驗收要的是佐證鏈，不是一疊各自為政的報表。'],
  ]
  const draw = (x, items, tone) => {
    card(s, x, y, cw, 3.12)
    items.forEach(([t, b], i) => {
      const iy = y + 0.24 + i * 0.98
      s.addShape(pres.ShapeType.roundRect, {
        x: x + 0.26, y: iy + 0.03, w: 0.24, h: 0.24, rectRadius: 0.2,
        fill: { color: TONE[tone][0] }, line: { color: TONE[tone][0] },
      })
      s.addText(String(i + 1), {
        x: x + 0.26, y: iy + 0.03, w: 0.24, h: 0.24, margin: 0, align: 'center', valign: 'middle',
        fontFace: F, fontSize: 9, bold: true, color: TONE[tone][1],
      })
      s.addText(t, {
        x: x + 0.62, y: iy, w: cw - 0.9, h: 0.3, margin: 0, valign: 'middle',
        fontFace: F, fontSize: 13.5, bold: true, color: C.ink,
      })
      s.addText(b, {
        x: x + 0.62, y: iy + 0.32, w: cw - 0.9, h: 0.58, margin: 0, valign: 'top',
        fontFace: F, fontSize: 10.5, color: C.ink2, lineSpacing: 14.5,
      })
    })
  }
  draw(M, left, 'red')
  draw(M + cw + gap, right, 'amber')

  cardText(s, M, y + 3.36, CW, 1.34,
    '所以這套系統的第一件事，不是「幫你寫字」，是把期限、責任方與佐證接起來。',
    'AI 把契約讀成一條一條帶出處的要求，人核定之後就變成本案的提醒；現場的每一筆填報都掛在工項上，查驗、缺失、估驗與報表沿同一條資料線走。到了驗收與稽核，佐證是自然備齊的，不是事後補的。',
    { titleSize: 15, bodySize: 11.5 })
}

// ═══════════════════════════════════════════════════════════════════════════
// 06 亮點總覽
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('參 · 產品')
  const y = head2(s, '產品亮點', '六個工作面，一條資料線。', '側欄就是工程的做事順序，不是功能清單。')

  // 左側：產品真實側欄（工作面就是做事順序）
  shot(s, M, y, 1.5, 'sv-rail')

  const gx = M + 1.5 + 0.3, gw = W - M - gx
  const gap = 0.26, cw = (gw - gap) / 2
  const feats = [
    ['今日待辦', 'blue', '現在輪到我／等待對方／今天已完成——球權由既有業務狀態推導，不是人工勾選。'],
    ['現場與品質', 'green', '施工日誌、照片、自主檢查、品質查驗、檢驗停留點、取樣試驗、缺失與工安。'],
    ['審查與協作', 'purple', '契約重點、材料與施工送審、工程疑義（RFI）、變更設計，每輪都留意見與版本。'],
    ['進度與金流', 'amber', 'PCCES 標單工項、逐工項排程與 S 曲線、估驗計價、請款收款與成本。'],
    ['文件與結案', 'red', '契約整包解析、義務時程、佐證包、驗收結算與稽核留痕。'],
    ['專案與跨案', 'mute', '三方成員與權限、機關端跨案總覽與例外清單、AI 用量與成本。'],
  ]
  feats.forEach(([t, tone, b], i) => {
    const x = gx + (i % 2) * (cw + gap)
    const yy = y + Math.floor(i / 2) * 1.5
    card(s, x, yy, cw, 1.3)
    chip(s, x + 0.24, yy + 0.2, t, tone)
    s.addText(b, {
      x: x + 0.24, y: yy + 0.58, w: cw - 0.48, h: 0.62, margin: 0, valign: 'top',
      fontFace: F, fontSize: 10.5, color: C.ink2, lineSpacing: 14.5,
    })
  })

  cite(s, gx, y + 4.5, gw, 0.44, '接下來五頁',
    '都是現在打得開的畫面。示範站 gov-agent.ai 選任一角色即可進入，資料是示範資料，流程與畫面都是真的。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 07 亮點① 今日待辦
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('參 · 產品')
  const y = head2(s, '亮點 ①', '打開系統第一眼：現在輪到我的是哪幾件。', '球權不是人工勾選的狀態，是從送審、查驗、估驗、缺失與契約期限推導出來的。')
  const iw = CW * 0.56
  shot(s, M, y, iw, 'sv-dashboard')
  const x = M + iw + 0.32, w = CW - iw - 0.32
  const rows = [
    ['現在輪到我', '待監造審定的送審、待覆核的估驗、待查驗的工項，一次列完。'],
    ['等待對方', '已經送出去的、正在等廠商改善的——逾期天數自動算。'],
    ['風險警示', '進度落後、試體逾期未試驗、缺失逾期未結案，附上建議動作。'],
    ['AI 今日已代辦', 'AI 擬好的草稿在收件匣等你覆核，件數只有一個真相來源。'],
  ]
  rows.forEach(([t, b], i) => {
    const yy = y + i * 1.04
    card(s, x, yy, w, 0.92)
    s.addText(t, {
      x: x + 0.22, y: yy + 0.12, w: w - 0.44, h: 0.28, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 13, bold: true, color: C.ink,
    })
    s.addText(b, {
      x: x + 0.22, y: yy + 0.42, w: w - 0.44, h: 0.44, margin: 0, valign: 'top',
      fontFace: F, fontSize: 10, color: C.ink2, lineSpacing: 13.5,
    })
  })
  cite(s, M, y + 4.3, CW, 0.5, '這頁的重點',
    '待辦只由既有業務狀態推導——未核定的 AI 建議進不了待辦，做不到的事也不會列給你（沒有核定權的角色不會看到按不下去的按鈕）。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 08 亮點② 契約 → 義務時程
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('參 · 產品')
  const y = head2(s, '亮點 ②', '契約不再只是 PDF：期限、責任方、罰則、出處。', '整本丟進來，AI 讀出要求；人核定之後，才變成本案會提醒你的義務。')
  const iw = CW * 0.56
  shot(s, M, y, iw, 'sv-contract')
  const x = M + iw + 0.32, w = CW - iw - 0.32
  cardText(s, x, y, w, 1.5, '每一條都指得回原文',
    '「開工後 15 日內提送品質計畫書·廠商·逾期每日按契約價金總額 0.5‰ 計罰·契約第 9 條 p.12」——條號與頁碼是抽取結果的一部分，不是事後補的。',
    { titleSize: 13.5, bodySize: 10.5 })
  cardText(s, x, y + 1.66, w, 1.5, 'AI 不會自己生效',
    '抽取結果先進待審清單，人核定後才建立提醒與期限追蹤。沒被核定的建議只留在追溯區，不會混進正式工作流。',
    { titleSize: 13.5, bodySize: 10.5 })
  cardText(s, x, y + 3.32, w, 1.46, '佐證掛在義務上',
    '哪一份送審對應哪一條義務、完成了沒有、逾期幾天，同一張時程上就看得完。',
    { titleSize: 13.5, bodySize: 10.5 })
}

// ═══════════════════════════════════════════════════════════════════════════
// 09 亮點③ AI 草稿收件匣
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('參 · 產品')
  const y = head2(s, '亮點 ③', 'AI 只做到「擬好」，按下去的還是人。', '現場先傳照片，AI 擬出當日施工日誌與自主檢查表草稿；數量與判定留空，等人填、等人按。')
  const iw = CW * 0.56
  shot(s, M, y, iw, 'sv-agent')
  const x = M + iw + 0.32, w = CW - iw - 0.32
  const items = [
    ['照片 → 日誌草稿', 'green', '18 張現場照片辨識出工項與施作區域，彙整成當日草稿；數量欄一律留空。'],
    ['照片 → 檢查表草稿', 'purple', '逐項標「符合／待填」並附依據，12 項實測值等品管人員填——AI 不猜數值。'],
    ['問本案，答案帶出處', 'blue', '「有哪些未結案缺失？」「第幾期估驗還沒收款？」答案附連結，點得進去查。'],
    ['接受或拒絕，都留痕', 'amber', '每一則草稿的角色、理由、佐證與人的覆核結果都寫進稽核紀錄。'],
  ]
  items.forEach(([t, tone, b], i) => {
    const yy = y + i * 1.04
    card(s, x, yy, w, 0.92)
    s.addShape(pres.ShapeType.rect, { x, y: yy, w: 0.055, h: 0.92, fill: { color: TONE[tone][1] } })
    s.addText(t, {
      x: x + 0.24, y: yy + 0.12, w: w - 0.46, h: 0.28, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 13, bold: true, color: C.ink,
    })
    s.addText(b, {
      x: x + 0.24, y: yy + 0.42, w: w - 0.46, h: 0.44, margin: 0, valign: 'top',
      fontFace: F, fontSize: 10, color: C.ink2, lineSpacing: 13.5,
    })
  })
  cite(s, M, y + 4.3, CW, 0.5, '為什麼這樣設計',
    '任何「AI 幫你判定合格」的產品，貴所都不能用——出事時簽名的是貴所的技師，不是模型。所以 AI 的工具箱裡根本沒有核定、判定、結案、驗收這些工具。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 10 亮點④ 品質查驗一條鏈
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('參 · 產品')
  const y = head2(s, '亮點 ④', '自主檢查、查驗、缺失、試體：同一條鏈，不用互相抄。', '三級品管的每一步都掛在工項上，所以佐證是自然備齊的。')
  const iw = CW * 0.56
  shot(s, M, y, iw, 'sv-quality')
  const x = M + iw + 0.32, w = CW - iw - 0.32
  chain(s, x, y, w, [['自主檢查', '廠商填、判定合格後可一鍵預填查驗申請', 'blue']], { h: 0.94 })
  chain(s, x, y + 1.06, w, [['監造查驗', '不合格原地開缺失，檢附的檢查紀錄跟著走', 'green']], { h: 0.94 })
  chain(s, x, y + 2.12, w, [['缺失與試體', '改善期限、複查結案、試體齡期逾期自動提醒', 'amber']], { h: 0.94 })
  chain(s, x, y + 3.18, w, [['佐證包', '驗收與稽核要的照片、紀錄與時序，直接輸出', 'purple']], { h: 0.94 })

  cite(s, M, y + 4.3, CW, 0.5, '不交給 AI 的部分',
    '合格與否、逾期天數、齡期到期日、罰則金額——一律由程式與資料庫規則計算並留下稽核事件；AI 只能引用工具回傳的值，不自己乘除。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 11 亮點⑤ 估驗、金流與跨案
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('參 · 產品')
  const y = head2(s, '亮點 ⑤', '估驗與請款：數字從日誌長出來，差異先攤開再簽。', '監造首屏就看到「超計 N 項／無佐證 M 項」，不必自己逐項比對。')
  const iw = CW * 0.56
  shot(s, M, y, iw, 'sv-valuation', { caption: '監造視角 · 估驗覆核：狀態、責任方與差異彙總在同一列' })
  const x = M + iw + 0.32, w = CW - iw - 0.32
  const cards3 = [
    ['數量有出處', 'PCCES 標單匯入後，日誌的完成量沿工項累計；估驗帶入的是日誌累計值，不是重打一次。'],
    ['金額是算出來的', '估驗、保留款、請款與收款由確定性引擎計算；「已收款」需收款日與實收金額都登錄才算數。'],
    ['三方各簽各的', '廠商提送、監造覆核、機關核定，狀態轉移由資料庫規則守住，改不了別人那一段。'],
  ]
  cards3.forEach(([t, b], i) => {
    cardText(s, x, y + i * 1.5, w, 1.36, t, b, { titleSize: 13.5, bodySize: 10.5 })
  })

  cite(s, M, y + 4.3, CW, 0.5, '機關那一端也接得上',
    '同一份資料到了主辦機關，是跨案總覽的例外清單、契約期限與付款節點——共同投標時，這一段可以由我方負責。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 12 邊界與信任
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('參 · 產品')
  const y = head2(s, '邊界', '三條紅線寫在架構裡，不是寫在簡報上。', '這三條是「顧問公司敢不敢用」的前提，所以放在功能之前談。')
  const gap = 0.3, cw = (CW - gap * 2) / 3
  const lines = [
    ['一', 'AI 只產生草稿', '核定、判定、結案、驗收、凍結——agent 的工具箱裡根本沒有這些工具。靠工具白名單保證，不是靠 prompt 約束；狀態轉移一律走資料庫規則加人簽核。'],
    ['二', '數字由確定性引擎算', 'AI 可以複述金額，但金額必須由計價程式算出、經工具回傳。AI 不准自己乘除，不准自己編法規條號。'],
    ['三', '每個動作都留痕', '角色、種類、目標、理由、佐證、人的覆核結果全部寫進稽核表。機關要查「這個判定是誰按的、依據什麼」，答得出來。'],
  ]
  lines.forEach(([n, t, b], i) => {
    const x = M + i * (cw + gap)
    card(s, x, y, cw, 2.3)
    s.addText(n, {
      x: x + 0.26, y: y + 0.22, w: 0.4, h: 0.4, margin: 0, align: 'center', valign: 'middle',
      shape: pres.ShapeType.roundRect, rectRadius: 0.2,
      fill: { color: C.redTint }, line: { color: C.redTint },
      fontFace: F, fontSize: 14, bold: true, color: C.red,
    })
    s.addText(t, {
      x: x + 0.26, y: y + 0.74, w: cw - 0.52, h: 0.34, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 15.5, bold: true, color: C.ink,
    })
    s.addText(b, {
      x: x + 0.26, y: y + 1.14, w: cw - 0.52, h: 1.0, margin: 0, valign: 'top',
      fontFace: F, fontSize: 10.5, color: C.ink2, lineSpacing: 15,
    })
  })

  cardText(s, M, y + 2.54, CW, 1.24,
    '第四條：每個 AI 功能都是可以單獨關掉的模組。',
    '16 個 AI 功能各自註冊、各自開關，閘門在伺服器端而不是把前端按鈕藏起來；每一次呼叫都記錄功能、使用者、專案、token 與成本。機關問「AI 用在哪、用了多少、能不能關掉」，三個問題都答得出來——不接受某一項，就關掉那一項，其他照常運作。',
    { titleSize: 15, bodySize: 11.5 })

  cite(s, M, y + 3.94, CW, 0.84, '資安',
    '依公共工程的政府採購要求建置：資通系統防護基準普通級符合性對照、弱點掃描報告（無高風險）、公開的漏洞回報機制、日誌含 IP 位址保存六個月、權限一律在伺服器端與資料庫層檢查。個資委外與境外傳輸的對策文件亦已備妥，可隨投標文件一併交出。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 13 現況
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('參 · 產品')
  const y = head2(s, '現況', '不是原型：這些數字現在就查得到。', '正式站已上線並持續改版；下面每一個數字都是從程式碼與測試直接數出來的。')

  const gap = 0.24, sw = (CW - gap * 3) / 4
  stat(s, M, y, sw, 1.5, '前端功能頁面', '36', '條路由', '每一條都登記在路由表，未登記的業務路由一律擋下')
  stat(s, M + (sw + gap), y, sw, 1.5, 'AI 功能模組', '16', '個', '各自註冊、各自開關、逐次計量成本')
  stat(s, M + (sw + gap) * 2, y, sw, 1.5, '資料庫版本', '39', '個 migration', '資料表、權限與狀態規則的唯一真相')
  stat(s, M + (sw + gap) * 3, y, sw, 1.5, '資料庫安全測試', '25', '檔', '權限與狀態轉移的 pgTAP 測試，隨變更自動跑')

  const gap2 = 0.3, cw2 = (CW - gap2 * 2) / 3
  cardText(s, M, y + 1.74, cw2, 1.44, '測試基線',
    '單元測試 500＋ 項（55 檔）、端對端測試 32 條、真後端整鏈測試 5 條；資料庫測試進獨立 CI，每次資料庫變更自動全套跑。',
    { titleSize: 13.5, bodySize: 10.5 })
  cardText(s, M + cw2 + gap2, y + 1.74, cw2, 1.44, '真後端跑得完整鏈',
    '初始化、估驗三方簽核與請款收款、文件上傳到履約要求核定並物化義務、標單匯入失敗全案回復——四條業務鏈都在真環境驗過。',
    { titleSize: 13.5, bodySize: 10.5 })
  cardText(s, M + (cw2 + gap2) * 2, y + 1.74, cw2, 1.44, '正式站在跑',
    'gov-agent.ai 部署於 Cloudflare；後端 Supabase（Postgres、列級權限、Edge Functions），AI 走 Claude，伺服器端閘門與計量。',
    { titleSize: 13.5, bodySize: 10 })

  cardText(s, M, y + 3.42, CW, 1.32,
    '該講的短處我先講。',
    '目前尚未有完整走完一整個工程週期的正式案件——這正是我要找合作對象的原因。手機端與部分機關端模板仍在補；真實案件的表單眉角、機關的退件理由，這些買不到，也不是多寫幾行程式能補的。',
    { titleSize: 15, bodySize: 11.5 })
}

// ═══════════════════════════════════════════════════════════════════════════
// 14 怎麼合作：階梯
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('肆 · 合作')
  const y = head2(s, '怎麼合作', '可以從很小開始，前兩格零採購、零承諾。', '走到第四格才需要談錢與採購程序。')
  const gap = 0.26, cw = (CW - gap * 3) / 4
  const steps = [
    ['①', '先看', '零承諾', 'green', '示範站現在就能打開，貴所自己點完整流程。要更深入的話，我方到貴所做一次一小時的操作說明。', '30 分鐘，現在就可以'],
    ['②', '用真文件跑一次', '零採購', 'green', '貴所挑一份手上的契約與規範（可去識別化），我方在測試環境跑一次抽取與期限建立，讓貴所看真文件出來的結果，不是示範資料。', '貴所出一份文件，我方數小時'],
    ['③', '單一功能先用', '小範圍', 'blue', '不必整套導入。例如只用契約期限追蹤，或只用送審審查助手，綁在一個案子上試一段時間。', '綁一個案子，先試一段'],
    ['④', '年度訂閱', '正式合作', 'blue', '貴所一份年度訂閱、案件數不限，三方（廠商／監造／機關）都進來。此時才需要走採購程序，屆時再談掛名方式。', '依規模級距計，走採購程序'],
  ]
  steps.forEach(([n, t, tag, tone, b, cost], i) => {
    const x = M + i * (cw + gap)
    card(s, x, y, cw, 3.4)
    s.addText(n, {
      x: x + 0.24, y: y + 0.2, w: 0.42, h: 0.42, margin: 0, align: 'center', valign: 'middle',
      fontFace: F, fontSize: 18, bold: true, color: C.blue,
    })
    s.addText(t, {
      x: x + 0.24, y: y + 0.7, w: cw - 0.48, h: 0.34, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 15.5, bold: true, color: C.ink,
    })
    chip(s, x + 0.24, y + 1.1, tag, tone)
    s.addText(b, {
      x: x + 0.24, y: y + 1.5, w: cw - 0.48, h: 1.4, margin: 0, valign: 'top',
      fontFace: F, fontSize: 10.5, color: C.ink2, lineSpacing: 15,
    })
    s.addShape(pres.ShapeType.line, { x: x + 0.24, y: y + 2.94, w: cw - 0.48, h: 0, line: { color: C.line2, width: 0.75 } })
    s.addText(cost, {
      x: x + 0.24, y: y + 3.0, w: cw - 0.48, h: 0.28, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 10.5, bold: true, color: C.blueText,
    })
  })

  cite(s, M, y + 3.64, CW, 0.9, '建議從 ② 開始',
    '示範資料再漂亮，都回答不了貴所真正的問題：「我的契約丟進去，抽得出東西嗎？」跑一次真文件只花我方幾個小時，卻是唯一能讓雙方同時知道值不值得繼續的做法。貴所不必先付費、不必先簽約，只要願意提供一份文件，保密約定我方先簽。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 15 三種形狀與共同投標分工
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('肆 · 合作')
  const y = head2(s, '合作形狀', '三種形狀：你們自己用、一起接案、你們出 know-how。', '不必今天選；但要選的時候，下面是各自的分工。')

  const gap = 0.26, cw = (CW - gap * 2) / 3
  const forms = [
    ['甲', '你們自己用', 'blue', '監造／專管導入。查驗、送審、缺失、估驗覆核與監造報表在同一條資料線上。'],
    ['乙', '一起接案', 'green', '共同投標／技術合作。你們有機關關係與工程專業，我方有系統與資安合規文件。'],
    ['丙', '你們出 know-how', 'purple', '真實案件的作業流程、表單與眉角由貴所提供，換取優先使用、共同掛名或其他對價。'],
  ]
  forms.forEach(([n, t, tone, b], i) => {
    const x = M + i * (cw + gap)
    card(s, x, y, cw, 1.34)
    s.addText(n, {
      x: x + 0.24, y: y + 0.18, w: 0.4, h: 0.4, margin: 0, align: 'center', valign: 'middle',
      shape: pres.ShapeType.roundRect, rectRadius: 0.2,
      fill: { color: TONE[tone][0] }, line: { color: TONE[tone][0] },
      fontFace: F, fontSize: 13, bold: true, color: TONE[tone][1],
    })
    s.addText(t, {
      x: x + 0.74, y: y + 0.18, w: cw - 1.0, h: 0.4, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 15.5, bold: true, color: C.ink,
    })
    s.addText(b, {
      x: x + 0.24, y: y + 0.66, w: cw - 0.48, h: 0.6, margin: 0, valign: 'top',
      fontFace: F, fontSize: 10.5, color: C.ink2, lineSpacing: 14.5,
    })
  })

  const g2 = 0.3, cw2 = (CW - g2) / 2
  const yy = y + 1.58
  card(s, M, yy, cw2, 2.06)
  s.addText('一起投標時，我方負責', {
    x: M + 0.26, y: yy + 0.16, w: cw2 - 0.52, h: 0.32, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 14.5, bold: true, color: C.blueText,
  })
  bullets(s, M + 0.26, yy + 0.58, cw2 - 0.52, [
    '系統本體與雲端維運（正式站、備份、可用率）',
    '資安文件：防護基準對照、弱掃、漏洞回報、日誌政策',
    '依本案契約與規範做的資料設定（標單、期限、停留點）',
    '教育訓練與導入期間的技術窗口',
    'AI 模組的開關、用量與成本控管',
  ], { size: 10.5, tick: true, gap: 3 })

  card(s, M + cw2 + g2, yy, cw2, 2.06)
  s.addText('貴所負責', {
    x: M + cw2 + g2 + 0.26, y: yy + 0.16, w: cw2 - 0.52, h: 0.32, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 14.5, bold: true, color: C.green,
  })
  bullets(s, M + cw2 + g2 + 0.26, yy + 0.58, cw2 - 0.52, [
    '機關關係、標案資訊與投標主導',
    '工程專業與簽證責任（監造、專管、技師簽章）',
    '本案的作業流程、表單格式與審查眉角',
    '現場人力與實際履約',
    '對機關的單一窗口（由貴所出面，我方在後）',
  ], { size: 10.5, tick: true, gap: 3 })

  cite(s, M, yy + 2.28, CW, 0.86, '兩件先講清楚',
    '一、掛名與計費方式（分包、共同投標、或貴所直接訂閱系統再由我方供應）三種都可以談，但要在投標前定，因為它會影響採購歸類與資安要求的層級。二、資料歸屬：案件資料屬於機關與貴所，我方不做跨案商業利用，契約可寫明期滿刪除與資料可攜。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 16 價格與下一步（全案唯一出現金額的一頁）
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('肆 · 合作')
  const y = head2(s, '價格與下一步', '兩張帳單：系統看規模，AI 用量按次算。', '雲端訂閱服務（SaaS），年度制；級距以貴所年度經手工程總額計。')

  const rows = [
    [th('年度經手工程總額'), th('平台費（年）'), th('含 AI 次數／年'), th('含文件解析／年')],
    [tdb('3 億以下'), td('NT$ 12 萬', { bold: true, color: C.blue }), td('4 萬次'), td('30 份')],
    [tdb('3 億 – 10 億'), td('NT$ 30 萬', { bold: true, color: C.blue }), td('10 萬次'), td('80 份')],
    [tdb('10 億 – 30 億'), td('NT$ 60 萬', { bold: true, color: C.blue }), td('20 萬次'), td('160 份')],
    [tdb('30 億 – 100 億'), td('NT$ 120 萬', { bold: true, color: C.blue }), td('40 萬次'), td('320 份')],
  ]
  const tw = CW * 0.56
  table(s, M, y, tw, rows, [tw * 0.3, tw * 0.24, tw * 0.24, tw * 0.22], { size: 10.5, pad: 8 })

  const x2 = M + tw + 0.32, w2 = CW - tw - 0.32
  const pw = (w2 - 0.24) / 2
  const price = (x, label, fig, unit, sub) => {
    card(s, x, y, pw, 1.42)
    s.addText(label, {
      x: x + 0.2, y: y + 0.16, w: pw - 0.4, h: 0.24, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 9.5, bold: true, charSpacing: 1.2, color: C.ink3,
    })
    s.addText([
      { text: fig, options: { fontSize: 24, bold: true, color: C.amber } },
      { text: ' ' + unit, options: { fontSize: 11, bold: true, color: C.ink2 } },
    ], { x: x + 0.2, y: y + 0.44, w: pw - 0.4, h: 0.42, margin: 0, valign: 'middle', fontFace: F })
    s.addText(sub, {
      x: x + 0.2, y: y + 0.9, w: pw - 0.4, h: 0.42, margin: 0, valign: 'top',
      fontFace: F, fontSize: 9.5, color: C.ink2, lineSpacing: 13,
    })
  }
  price(x2, '超額 · AI 次數', 'NT$ 1', '／次', '問答、照片辨識、草稿、審查意見')
  price(x2 + pw + 0.24, '超額 · 文件解析', 'NT$ 40', '／份', '契約與規範整包、履約要求抽取')

  cardText(s, x2, y + 1.58, w2, 1.36, '額度怎麼算',
    '確定性的部分不佔額度——天氣帶入、金額與期限計算、報表輸出、提醒信都不呼叫模型。額度年度制、不遞延；用到八成與用滿各通知一次，超額不斷線，按次併入次月帳單。',
    { titleSize: 13.5, bodySize: 10 })

  cardText(s, M, y + 3.06, CW, 1.22,
    '下一步：願不願意提供一份手上的契約與規範，讓我跑一次？',
    '可以去識別化，可以是已結案的舊案。跑完把結果整理成一份對照給貴所看：抽到哪些期限、哪些罰則、出處對不對、漏了什麼。不必簽約、不必付費，保密約定我方先簽。',
    { titleSize: 15, bodySize: 10.5 })

  cite(s, M, y + 4.4, CW, 0.5, '單價出處',
    '額度與超額單價由正式站實測用量回推（2026-08、匯率 NT$32／US$）：契約整包解析 NT$10.6／份、履約要求抽取 NT$15.1／份、問答 NT$0.72／次、照片辨識 NT$0.17／張。「年度經手工程總額」指前一年度監造／專管契約對應之工程預算金額合計；100 億以上另議。')
}

pres.writeFile({ fileName: OUT }).then(() => console.log('✓ ' + OUT + '  ' + PAGE + ' 頁'))
