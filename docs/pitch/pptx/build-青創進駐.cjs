// ============================================================================
// GovAgent — 桃園市青創基地進駐簡報（依【附件4】公司商業模式簡報架構）
// ----------------------------------------------------------------------------
// 產物：docs/pitch/GovAgent-青創基地進駐簡報-2026-08.pptx
// 頁數：內頁 15 頁（附件4 上限），另有封面與封底（不計入頁數）。
// 講述：每組 6 分鐘 ＋ 統問統答 3 分鐘 —— 每頁 speaker notes 都寫了秒數配額。
//
// 【歷史視覺來源：Git c39e395 的 UIUX/design_handoff_pmis_google_ui/README.md ＋當時 src/index.css；本簡報尚未改版】
// 這份簡報不是「配色抄產品」，是直接套產品的 design token 與版面語彙：
//   · 字型     一套 Noto Sans TC 中英共用（index.css 的 harmonized family）
//   · 字級     照 handoff 的 px 值當 pt 用（頁面標題 24、卡片標題 15、正文 13、輔助 11.5、大數字 28）
//   · 字重     頁面標題與大數字一律 400（不是粗體）—— 這是 Google 感最關鍵的一項
//   · 字距     不放大字距（handoff 明列「不使用小型大寫或字距放大」）
//   · 顏色     底 #f8fafd／卡面 #fff／卡線 #e3e6ea／文字 #202124 · #5f6368 · #6a6e73
//   · 狀態     一律「色票 chip」：danger/warn/ok/info/mute 五語意，顏色＋文字並存
//   · 圓角     卡片 12、chip 8、色票 6、藥丸 100（＝ handoff 圓角表）
//   · 陰影     shadow-sm：0 1px 2px rgba(60,64,67,.3)
//   · 標誌     三個點＝機關（藍）監造（紅）廠商（黃），灰三角＝同一份契約事實
//              品牌四色只出現在標誌與封面圖例,不進入任何元件（handoff 明訂）
//   · 卡片不鋪色底、不加彩色頂條 —— handoff：顏色只出現在色票與動作鈕上
//
// 兩條講話紅線：
//   1) 標的一律「雲端訂閱服務（SaaS）」,不得出現「開發／客製／建置」。
//   2) 時程不寫死。金額只出現在 P09／P11／P12,改一頁要三頁一起改。
//
// 產出：
//   node    docs/pitch/pptx/build-青創進駐.cjs /tmp/raw-youth.pptx
//   python3 docs/pitch/pptx/fix_ea_fallback.py /tmp/raw-youth.pptx "docs/pitch/<檔名>.pptx"
// ============================================================================
const pptxgen = require('pptxgenjs')
const path = require('node:path')
const fs = require('node:fs')

const OUT = process.argv[2] || path.resolve(__dirname, '../../../tmp/raw-youth.pptx')
const SHOTS = path.resolve(__dirname, '../shots-crop')

const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE'
pres.author = 'GovAgent'
pres.title = 'GovAgent｜公共工程 — 青創基地進駐簡報'

// ── design token（= src/index.css）──────────────────────────────────────────
const C = {
  bg: 'F8FAFD', card: 'FFFFFF', surf2: 'F1F3F4',
  ink: '202124', ink2: '5F6368', ink3: '6A6E73',
  line: 'E3E6EA', line2: 'E8EAED', divider: 'DADCE0',
  blue: '0B57D0', blueText: '174EA6', blueTint: 'E8F0FE',
  aiTint: 'ECF3FE', aiText: '062E6F',
  green: '137333', greenTint: 'E6F4EA',
  amber: 'B06000', amberTint: 'FEF7E0',
  red: 'A50E0E', redTint: 'FCE8E6',
  purple: '681DA8', purpleTint: 'F3E8FD',
  // 品牌四色：只用於標誌與封面圖例
  brandBlue: '1A73E8', brandRed: 'EA4335', brandYellow: 'FBBC04', brandLine: 'DADCE0',
}
const F = 'Noto Sans TC'
// 字級：handoff 的 px 值直接當 pt（1440px 畫面 → 13.33in 版面,再放大 1.5 倍）
const T = { title: 24, sub: 13, cardTitle: 15, body: 13, small: 11.5, meta: 10.5, figure: 28 }
// 圓角（pt → in）
const R = { card: 0.167, chip: 0.111, status: 0.083, big: 0.39 }
const SHADOW = { type: 'outer', angle: 90, blur: 3, offset: 0.014, color: '3C4043', opacity: 0.22 }

const W = 13.333, M = 0.7, CW = W - M * 2
const TOP = 2.0            // 內容起點
const TOTAL = 15
let PAGE = 0
const MISSING = []

// ── 骨架 ────────────────────────────────────────────────────────────────────
function slide(opts = {}) {
  const s = pres.addSlide()
  s.background = { color: opts.bg || C.bg }
  if (!opts.noNum) {
    PAGE += 1
    s.addText(`${String(PAGE).padStart(2, '0')} / ${TOTAL}`, {
      x: W - M - 1.6, y: 6.95, w: 1.6, h: 0.28, margin: 0, align: 'right', valign: 'middle',
      fontFace: F, fontSize: 10.5, color: C.ink3,
    })
  }
  return s
}

// 頁首：標題（24pt/400）＋ 說明（13pt）
// tag 是【附件4】的項次對照,**刻意不畫在投影片上**——版面要乾淨。
// 它保留在每個 head() 的呼叫端,是這份程式碼與 README 對照表的唯一真相;
// 要拿去給審查方核對就看 README-青創進駐.md 的十項對照表。
function head(s, tag, title, sub) {
  s.addText(title, {
    x: M, y: 0.8, w: CW, h: 0.52, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.title, color: C.ink,
  })
  if (sub) {
    s.addText(sub, {
      x: M, y: 1.36, w: CW, h: 0.3, margin: 0, valign: 'middle',
      fontFace: F, fontSize: T.sub, color: C.ink2,
    })
  }
}

// ── 元件 ────────────────────────────────────────────────────────────────────
function card(s, x, y, w, h, o = {}) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: o.radius || R.card,
    fill: { color: o.fill || C.card },
    line: { color: o.line || C.line, width: 1 },
    shadow: o.flat ? undefined : SHADOW,
  })
}

// 狀態色票：22pt 高、6pt 圓角、11.5pt/500,顏色與文字並存
const TONE = {
  info: [C.blueTint, C.blueText], ok: [C.greenTint, C.green],
  warn: [C.amberTint, C.amber], danger: [C.redTint, C.red],
  mute: [C.surf2, C.ink2], purple: [C.purpleTint, C.purple],
}
// 色票寬度要跟「實際字寬」走：中日韓字約等於字級全寬,拉丁與數字只有一半。
// 用 text.length 一律乘同一個係數,中文標籤會被截掉、換行成兩層。
function chipW(text, size = T.small) {
  const em = size / 72
  let w = 0.34
  for (const ch of text) w += (ch.codePointAt(0) > 0x2000 ? em * 1.05 : em * 0.55)
  return Math.max(0.62, w)
}
function statusChip(s, x, y, text, tone = 'info', o = {}) {
  const [bg, fg] = TONE[tone]
  s.addText(text, {
    x, y, w: o.w || chipW(text, o.size || T.small), h: o.h || 0.3,
    margin: 0, align: 'center', valign: 'middle',
    shape: pres.ShapeType.roundRect, rectRadius: R.status,
    fill: { color: bg }, line: { color: bg },
    fontFace: F, fontSize: o.size || T.small, bold: true, color: fg,
  })
}

// 卡片標題（15pt/500 → 以 bold 近似）
function cardTitle(s, x, y, w, text, o = {}) {
  s.addText(text, {
    x, y, w, h: o.h || 0.34, margin: 0, valign: 'middle',
    fontFace: F, fontSize: o.size || T.cardTitle, bold: true, color: o.color || C.ink,
  })
}
function bodyText(s, x, y, w, h, text, o = {}) {
  s.addText(text, {
    x, y, w, h, margin: 0, valign: o.valign || 'top',
    fontFace: F, fontSize: o.size || T.body, color: o.color || C.ink2,
    lineSpacing: o.lineSpacing || (o.size || T.body) * 1.6,
  })
}

// 指標卡：標籤 11.5 ＋ 大數字 28/400（tabular）
function stat(s, x, y, w, h, label, figure, unit, o = {}) {
  card(s, x, y, w, h)
  s.addText(label, {
    x: x + 0.24, y: y + 0.2, w: w - 0.48, h: 0.26, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.small, color: C.ink2,
  })
  s.addText([
    { text: figure, options: { fontSize: o.figSize || T.figure, color: o.color || C.blue } },
    ...(unit ? [{ text: '  ' + unit, options: { fontSize: T.small, color: C.ink2 } }] : []),
  ], { x: x + 0.24, y: y + 0.52, w: w - 0.48, h: 0.5, margin: 0, valign: 'middle', fontFace: F })
}

// 產品截圖：白卡 ＋ 內縮圖 ＋ 圖說
const DIM = {
  'sv-dashboard': 1.6528, 'sv-contract': 1.5782, 'sv-agent-panel': 0.5541,
  'sv-quality': 1.8594, 'sv-valuation': 1.8594, 'ct-sitelog': 1.8594, 'sv-rail': 0.2861,
}
function shot(s, x, y, w, file, o = {}) {
  const pad = 0.1
  const iw = w - pad * 2
  const ih = iw / DIM[file]
  const h = ih + pad * 2 + (o.caption ? 0.32 : 0)
  const src = path.join(SHOTS, file + '.png')
  card(s, x, y, w, h, { flat: true })
  if (fs.existsSync(src)) {
    s.addImage({ path: src, x: x + pad, y: y + pad, w: iw, h: ih })
  } else {
    MISSING.push(file)
    s.addShape(pres.ShapeType.rect, { x: x + pad, y: y + pad, w: iw, h: ih, fill: { color: C.blueTint }, line: { color: C.blue, width: 1 } })
    s.addText(`缺截圖：${file}.png`, {
      x: x + pad, y: y + pad, w: iw, h: ih, margin: 0, align: 'center', valign: 'middle',
      fontFace: F, fontSize: T.body, bold: true, color: C.blueText,
    })
  }
  s.addShape(pres.ShapeType.rect, { x: x + pad, y: y + pad, w: iw, h: ih, fill: { type: 'none' }, line: { color: C.line2, width: 0.75 } })
  if (o.caption) {
    s.addText(o.caption, {
      x: x + pad, y: y + pad + ih + 0.02, w: iw, h: 0.28, margin: 0, valign: 'middle',
      fontFace: F, fontSize: T.meta, color: C.ink3,
    })
  }
  return h
}

// 表格：無框線,只有橫向細線,表頭淡底（＝產品表格）
function table(s, x, y, w, rows, colW, o = {}) {
  s.addTable(rows, {
    x, y, w, colW,
    border: [{ type: 'none' }, { type: 'none' }, { pt: 0.75, color: C.line2 }, { type: 'none' }],
    fontFace: F, fontSize: o.size || T.small, color: C.ink2, valign: 'middle',
    margin: [o.pad || 10, 12, o.pad || 10, 12],
  })
}
const th = (t) => ({ text: t, options: { color: C.ink3, fontSize: 10.5, fill: { color: C.surf2 } } })
const tdb = (t) => ({ text: t, options: { bold: true, color: C.ink } })
const td = (t, o = {}) => ({ text: t, options: o })

// 產品標誌：三個點（機關藍／監造紅／廠商黃）＋ 灰三角＝同一份契約事實
// 走 PNG 不走線段：三角形底邊是水平線(高度 0),PowerPoint 與 LibreOffice 對零高度
// 線段的處理不一致,會整條不見。PNG 由 brand_mark.py 依 pmis-mark.svg 的 48 單位座標算出。
const MARK = path.resolve(__dirname, '../brand/mark.png')
// 三個點在 48 單位方框內的相對位置（給圖例標籤定位用）
const DOT = { top: [0.5, 0.2583], br: [0.7167, 0.6333], bl: [0.2833, 0.6333], r: 0.1083 }
function mark(s, x, y, size) {
  if (!fs.existsSync(MARK)) { MISSING.push('brand/mark'); return }
  s.addImage({ path: MARK, x, y, w: size, h: size })
}


// ═══════════════════════════════════════════════════════════════════════════
// 封面：直接長成產品的登入頁（#f8fafd 底 ＋ 28pt 圓角白卡 ＋ shadow-sm）
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide({ noNum: true })
  const cx = 1.15, cy = 1.25, cw = W - cx * 2, ch = 5.0
  card(s, cx, cy, cw, ch, { radius: R.big })

  const px = cx + 0.9, lw = 5.9

  mark(s, px, cy + 0.72, 0.5)
  s.addText([
    { text: 'GovAgent', options: { color: C.ink } },
    { text: '.ai', options: { color: C.blue } },
    { text: '　｜　公共工程', options: { fontSize: 13, color: C.ink2 } },
  ], { x: px + 0.62, y: cy + 0.72, w: 5.4, h: 0.5, margin: 0, valign: 'middle', fontFace: F, fontSize: 26 })

  s.addText('讓 AI 完成可以自動化的行政工作，\n工程師只負責需要專業判斷的審核。', {
    x: px, y: cy + 1.52, w: lw + 0.5, h: 1.5, margin: 0, valign: 'top',
    fontFace: F, fontSize: 29, color: C.ink, lineSpacing: 50,
  })
  s.addText('以 AI 深度整合公共工程流程的 PMIS 平台。機關、監造與承攬廠商，同一套資料。', {
    x: px, y: cy + 3.08, w: lw + 0.6, h: 0.32, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.sub, color: C.ink2,
  })

  s.addShape(pres.ShapeType.line, { x: px, y: cy + 3.74, w: lw, h: 0, line: { color: C.line2, width: 1 } })
  s.addText('欣宇數位科技有限公司　·　2026 年 8 月', {
    x: px, y: cy + 3.9, w: lw, h: 0.32, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.small, color: C.ink3,
  })
  statusChip(s, px, cy + 4.34, '桃園市青創基地第二期進駐申請', 'info', { h: 0.34, size: T.body })

  // 右欄：標誌放大 ＋ 三方圖例（品牌四色只出現在這裡,不進入任何元件）
  const mSize = 2.0
  const mx = cx + cw - mSize - 1.0, my = cy + 1.0
  mark(s, mx, my, mSize)
  const label = (p, text, color) => {
    const cxp = mx + p[0] * mSize
    const top = p[1] < 0.4
    s.addText(text, {
      x: cxp - 0.55, y: my + p[1] * mSize + (top ? -0.62 : 0.24), w: 1.1, h: 0.3,
      margin: 0, align: 'center', valign: 'middle', fontFace: F, fontSize: T.small, color,
    })
  }
  label(DOT.top, '機關', C.brandBlue)
  label(DOT.br, '監造', C.brandRed)
  label(DOT.bl, '承攬廠商', C.brandYellow)
  s.addText('三方，同一套工程資料', {
    x: mx - 0.5, y: my + mSize + 0.24, w: mSize + 1.0, h: 0.3,
    margin: 0, align: 'center', valign: 'middle', fontFace: F, fontSize: T.meta, color: C.ink3,
  })

  s.addNotes('【0:00–0:15】只講一句：GovAgent.ai 是以 AI 深度整合公共工程流程的 PMIS 平台，核心價值是讓 AI 完成可以自動化的行政工作，工程師只負責需要專業判斷的審核。\n右邊標誌順帶一句：三個點是機關、監造、承攬廠商，灰線是同一套工程資料。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 01 ① 公司／團隊基本情況
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ①　公司／團隊基本情況', '公司今年 8 月成立，產品五月啟動、六月就有 MVP。',
    '精實創業模式：初始投入約 2 萬元，無固定工程師人事成本，由創辦人主導產品與商業驗證。')

  const lw = 5.4
  card(s, M, TOP, lw, 2.62)
  cardTitle(s, M + 0.3, TOP + 0.3, lw - 0.6, '公司沿革')
  const hist = [
    ['2026 / 5', '專案啟動，開始開發 AI 公共工程管理平台'],
    ['2026 / 6', '完成第一階段 MVP：專案管理、施工日誌、AI 文件處理'],
    ['2026 / 7', '官網與產品 Demo 上線，接觸顧問公司、PCM 與營造業'],
    ['2026 / 8', '正式成立欣宇數位科技有限公司'],
  ]
  hist.forEach(([k, v], i) => {
    const ry = TOP + 0.8 + i * 0.44
    s.addText(k, { x: M + 0.3, y: ry, w: 1.1, h: 0.34, margin: 0, valign: 'middle', fontFace: F, fontSize: T.small, color: C.blue })
    s.addText(v, { x: M + 1.5, y: ry, w: lw - 1.8, h: 0.34, margin: 0, valign: 'middle', fontFace: F, fontSize: T.small, color: C.ink })
  })

  const rx = M + lw + 0.3, rw = M + CW - rx
  card(s, rx, TOP, rw, 2.62)
  cardTitle(s, rx + 0.3, TOP + 0.3, rw - 0.6, '同一個工程專案，三方使用同一套資料')
  const roles = [['承攬廠商', 'info'], ['監造單位', 'ok'], ['機關端', 'purple']]
  roles.forEach(([t, tone], i) => statusChip(s, rx + 0.3 + i * 1.62, TOP + 0.86, t, tone, { w: 1.42, h: 0.34, size: T.body }))
  bodyText(s, rx + 0.3, TOP + 1.42, rw - 0.6, 1.0,
    '依角色設定權限與審核流程：承攬廠商無法自行關閉監造開立的缺失，\n監造也無法修改承攬廠商已送出的原始紀錄。\n所有重要操作均留下歷程，工程資訊可以持續追溯。')

  const sy = TOP + 2.98, gap = 0.28, sw = (CW - gap * 3) / 4
  stat(s, M, sy, sw, 1.4, '功能頁面', '40', '個')
  stat(s, M + sw + gap, sy, sw, 1.4, 'AI 模組', '16', '個')
  stat(s, M + (sw + gap) * 2, sy, sw, 1.4, '資料庫版本', '56', '個 migration')
  stat(s, M + (sw + gap) * 3, sy, sw, 1.4, '自動化測試', '600', '＋ 項')

  s.addNotes([
    '【0:15–0:45｜30 秒】',
    '「五月啟動、六月做出 MVP、七月官網跟 Demo 上線、八月公司正式成立。目前一個人，精實創業，初始投入大概兩萬塊。」',
    '「產品不是簡報做出來的——下面四個數字是從程式碼直接數出來的。」',
    '數字重數日期 2026-08-26：40 個頁面、16 個 AI 模組、56 個 migration、619 項單元測試（保守寫 600＋）、另有 33 檔資料庫安全測試。',
    '委員最可能問「一個人做得完嗎」→ 留到 P13 與 P14。',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 02 ② 公司業務描述 — 問題
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ②　公司業務描述', '真正的問題不是「資料很多」，是資料斷裂與行政負擔。',
    '公共工程可以執行五年甚至十年，人員卻不斷更換。')

  const gap = 0.3, cw = (CW - gap) / 2
  card(s, M, TOP, cw, 2.3)
  statusChip(s, M + 0.3, TOP + 0.3, '問題一　資料斷裂', 'danger', { h: 0.34, size: T.body })
  bodyText(s, M + 0.3, TOP + 0.88, cw - 0.6, 1.2,
    '照片與臨時指示留在 LINE；估驗、缺失與進度各自存在不同 Excel；\n契約與規範是 PDF 或紙本；送審與退件紀錄留在 Email。\n\n人員一離職，專案知識就跟著消失。')

  card(s, M + cw + gap, TOP, cw, 2.3)
  statusChip(s, M + cw + gap + 0.3, TOP + 0.3, '問題二　行政負擔', 'warn', { h: 0.34, size: T.body })
  bodyText(s, M + cw + gap + 0.3, TOP + 0.88, cw - 0.6, 1.2,
    '既有 PMIS 多數只是把紙本表單搬到網路上。\n紙本填一次、PMIS 再輸入一次——資訊化沒有減少工作。\n\n施工日誌因此流於事後補登或形式作業。')

  card(s, M, TOP + 2.6, CW, 1.66)
  s.addText('工程師原本要填的紙本並沒有消失，反而變成填兩次。', {
    x: M + 0.36, y: TOP + 2.92, w: CW - 0.72, h: 0.44, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 20, color: C.ink,
  })
  s.addText('這就是許多監造與施工廠商對 PMIS 產生抗拒的原因——也是 GovAgent.ai 要解決的兩個根本問題。', {
    x: M + 0.36, y: TOP + 3.46, w: CW - 0.72, h: 0.4, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.body, color: C.ink2,
  })

  s.addNotes([
    '【0:45–1:15｜30 秒】',
    '「工程的資料不是沒有，是散在四個地方，而且人一走專案知識就消失。」',
    '「更麻煩的是第二個問題：現在的 PMIS 只是把紙本搬到網路上，工程師紙本填一次、系統再填一次。資訊化沒有減少工作，反而增加行政負擔——這才是第一線抗拒的真正原因。」',
    '以施工日誌為例：本來的目的是承攬廠商每日記錄出工人數、機具、工項與完成數量，監造審查後機關即時掌握。但因為填寫繁瑣，實務上容易流於事後補登。',
    '外部佐證（口頭備用）：營造業勞工空缺 46,151 人，其中工地主任 3,007、專任工程人員 1,400（113 年國土管理署調查）——缺的正是填這些東西的人。',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 03 ② 公司業務描述 — 解法
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ②　公司業務描述', '從「表單數位化」走到「工作自動化」。',
    '核心概念不是要求工程師輸入更多資料，而是讓現場本來就會產生的照片與資訊自動轉成表單。')

  const gap = 0.3, cw = (CW - gap) / 2
  card(s, M, TOP, cw, 1.86, { fill: C.surf2, line: C.line2, flat: true })
  s.addText('既有 PMIS', {
    x: M + 0.32, y: TOP + 0.26, w: cw - 0.64, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.small, color: C.ink3,
  })
  s.addText('工程師填資料　→　系統保存', {
    x: M + 0.32, y: TOP + 0.72, w: cw - 0.64, h: 0.5, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 19, color: C.ink2,
  })
  s.addText('人是資料輸入者', {
    x: M + 0.32, y: TOP + 1.3, w: cw - 0.64, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.small, color: C.ink3,
  })

  card(s, M + cw + gap, TOP, cw, 1.86, { fill: C.aiTint, line: 'D3E3FD' })
  s.addText('GovAgent.ai', {
    x: M + cw + gap + 0.32, y: TOP + 0.26, w: cw - 0.64, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.small, color: C.blueText,
  })
  s.addText('工程發生　→　系統取得資料\n→　AI 完成行政作業　→　工程師審核', {
    x: M + cw + gap + 0.32, y: TOP + 0.62, w: cw - 0.64, h: 0.8, margin: 0, valign: 'top',
    fontFace: F, fontSize: 16, color: C.aiText, lineSpacing: 26,
  })
  s.addText('人是審核者', {
    x: M + cw + gap + 0.32, y: TOP + 1.44, w: cw - 0.64, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.small, color: C.blueText,
  })

  const cy2 = TOP + 2.2
  card(s, M, cy2, CW, 2.06)
  cardTitle(s, M + 0.36, cy2 + 0.3, CW - 0.72, '最終建立的不是一堆彼此獨立的電子表單，而是一條持續累積的工程資料鏈')
  const chainSteps = ['契約', '工項', '現場施工', '品質管理', '施工日誌', '進度', '估驗', '驗收結案']
  const n = chainSteps.length
  const sw2 = (CW - 0.72 - 0.16 * (n - 1)) / n
  chainSteps.forEach((t, i) => {
    const x = M + 0.36 + i * (sw2 + 0.16)
    s.addShape(pres.ShapeType.roundRect, {
      x, y: cy2 + 0.92, w: sw2, h: 0.52, rectRadius: R.chip,
      fill: { color: C.blueTint }, line: { color: C.blueTint },
    })
    s.addText(t, {
      x, y: cy2 + 0.92, w: sw2, h: 0.52, margin: 0, align: 'center', valign: 'middle',
      fontFace: F, fontSize: T.body, color: C.blueText,
    })
    if (i < n - 1) {
      s.addText('›', {
        x: x + sw2, y: cy2 + 0.92, w: 0.16, h: 0.52, margin: 0, align: 'center', valign: 'middle',
        fontFace: F, fontSize: 14, color: C.ink3,
      })
    }
  })
  s.addText('每日施工日誌中已確認的工項與完成數量，直接累積至工程進度與後續估驗計價，工程師不必在月底重新統計與輸入。', {
    x: M + 0.36, y: cy2 + 1.56, w: CW - 0.72, h: 0.36, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.small, color: C.ink2,
  })

  s.addNotes([
    '【1:15–1:50｜35 秒】',
    '這頁是全場的核心。左右兩塊要對比著念：',
    '「現在的 PMIS 是——工程師填資料、系統保存，人是資料輸入者。」',
    '「GovAgent.ai 是——工程發生、系統取得資料、AI 完成行政作業、工程師審核，人變成審核者。」',
    '下面那條資料鏈講一句就好：「最後留下的不是一堆獨立的電子表單，是一條從契約到驗收結案持續累積的工程資料鏈。」',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 04 ④ 主要產品／服務介紹 — 功能全景
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ④　主要產品／服務介紹', '六個工作面，涵蓋公共工程三級品質管理與履約流程。',
    '左邊是產品真實的側邊欄，不是示意圖。')

  shot(s, M, TOP, 1.3, 'sv-rail')

  const rx = M + 1.3 + 0.3, rw = M + CW - rx
  const gap = 0.28, cw = (rw - gap * 2) / 3, ch = 1.9
  const faces = [
    ['專案總覽', '工程進度管理、風險預警、機關多專案 Dashboard'],
    ['契約與履約管理', '契約與施工規範 AI 文件理解、履約期限及重要事項追蹤'],
    ['施工與日誌', 'AI 施工照片辨識、AI 自動產生施工日誌、每日數量累積'],
    ['品質與工安', '自主檢查、監造查驗、材料送審與試驗、缺失追蹤'],
    ['估驗與金流', 'PCCES／BOQ 工項解析、估驗計價、數量自動串聯'],
    ['佐證與問答', '施工照片與文件佐證鏈、完整審核歷程、AI Agent 工程問答'],
  ]
  faces.forEach(([t, b], i) => {
    const x = rx + (i % 3) * (cw + gap)
    const cy = TOP + Math.floor(i / 3) * (ch + 0.3)
    card(s, x, cy, cw, ch)
    cardTitle(s, x + 0.28, cy + 0.36, cw - 0.56, t)
    bodyText(s, x + 0.28, cy + 0.86, cw - 0.56, 0.86, b)
  })

  s.addNotes([
    '【1:50–2:10｜20 秒】',
    '不要念六個方塊。只講：「產品分六個工作面，涵蓋公共工程三級品質管理與履約流程；左邊那條是產品真實的側邊欄。」',
    '接著馬上翻頁——功能清單不是說服力，畫面才是。',
    '被問服務型態：雲端訂閱服務（SaaS），多租戶，客戶不必自建 IT 團隊、不必自行開發與維護 PMIS。',
    '產品不要求工程人員改變既有公共工程制度去配合軟體，而是讓軟體配合公共工程真正的工作方式。',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 05 ④ 產品亮點：AI 自動產生施工日誌
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ④　主要產品／服務介紹', '現場只上傳照片，AI 產生施工日誌草稿。',
    '工程師只需要確認內容並按下送出，監造即可直接審查。')

  shot(s, M, TOP, 7.1, 'ct-sitelog', { caption: '產品實際畫面：施工日誌 — 天氣自動帶入、數量填一次、照片可先傳' })

  const rx = M + 7.1 + 0.3, rw = M + CW - rx
  card(s, rx, TOP, rw, 1.86)
  cardTitle(s, rx + 0.3, TOP + 0.3, rw - 0.6, 'AI 負責做事')
  bodyText(s, rx + 0.3, TOP + 0.82, rw - 0.6, 0.9,
    '讀取資料　·　整理資料　·　產生草稿\n找出異常　·　提醒風險　·　提供查詢', { lineSpacing: 26 })

  card(s, rx, TOP + 2.16, rw, 1.86)
  cardTitle(s, rx + 0.3, TOP + 2.46, rw - 0.6, '工程師負責判斷')
  bodyText(s, rx + 0.3, TOP + 2.98, rw - 0.6, 0.9,
    '核定　·　判定　·　驗收　·　缺失結案\n涉及專業責任的動作，一律由人執行。', { lineSpacing: 26 })

  s.addNotes([
    '【2:10–2:40｜30 秒】',
    '「這是產品真實畫面。以施工日誌為例：現場工程師每天只要把施工照片跟必要資訊上傳，AI 就辨識照片裡的施工內容，再結合本案的 PCCES 標單、工項與專案資料，自動產生施工日誌草稿。」',
    '「工程師只需要確認內容並按下送出，監造單位就可以直接審查，機關也即時看得到當日實際施工狀況。」',
    '右邊那兩張卡是整個產品的邊界，念一次：「讓 AI 負責做事，工程師負責判斷。」',
    '相同的設計邏輯延伸到三級品質管理：自主檢查、監造查驗、材料送審、材料試驗、缺失改善、估驗計價、工程進度、履約文件與佐證。',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 06 ④ 產品亮點：數位記憶
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ④　主要產品／服務介紹', '為工程專案建立「數位記憶」。',
    '工程可以執行五年甚至十年，人員卻不斷更換；知識不該跟著人一起離開。')

  const gap = 0.28, cw = (CW - gap * 2) / 3
  shot(s, M, TOP, cw, 'sv-contract', { caption: '契約與規範：AI 讀出期限與罰則，保留原始條文與頁碼' })
  shot(s, M + cw + gap, TOP, cw, 'sv-quality', { caption: '品質查驗：停留點、缺失與複查同一條鏈' })
  shot(s, M + (cw + gap) * 2, TOP, cw, 'sv-valuation', { caption: '估驗計價：數量來自日誌，確定性程式計算' })

  const ly = TOP + 2.34
  card(s, M, ly, CW, 1.92)
  cardTitle(s, M + 0.36, ly + 0.3, CW - 0.72, '事件、照片、文件、審查、決策、契約依據與後續結果，全部連在一起')
  const q = ['當時發生什麼事？', '為什麼做這個決定？', '依據哪一條契約？', '後來如何處理？']
  const qw = (CW - 0.72 - 0.54) / 4
  q.forEach((t, i) => {
    const x = M + 0.36 + i * (qw + 0.18)
    s.addShape(pres.ShapeType.roundRect, {
      x, y: ly + 0.84, w: qw, h: 0.5, rectRadius: R.chip,
      fill: { color: C.surf2 }, line: { color: C.surf2 },
    })
    s.addText(t, { x, y: ly + 0.84, w: qw, h: 0.5, margin: 0, align: 'center', valign: 'middle', fontFace: F, fontSize: T.body, color: C.ink })
  })
  s.addText('承辦人、監造主任或廠商工程師更換時，新接手的人仍能迅速理解——人員可以交接，工程專案的知識不需要重新開始。', {
    x: M + 0.36, y: ly + 1.46, w: CW - 0.72, h: 0.36, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.small, color: C.ink2,
  })

  s.addNotes([
    '【2:40–3:05｜25 秒】',
    '三張圖快速帶過，重點在下半頁：「工程可以做五年十年，但人一直在換。我們把事件、照片、文件、審查、決策、契約依據跟後續結果連在一起，讓新接手的人問得出這四個問題、也答得出來。」',
    '這一段是產品最難被複製的價值，也是機關最有感的部分——爭議處理與驗收時，佐證找得回來。',
    '口頭補充：金額與判定一律由確定性程式計算，AI 不自己乘除、不編法規條號；所有重要操作留下歷程。',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 07 ④ 產品發展階段、智財與短中長期規劃
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ④　產品發展階段與智慧財產權', '已完成第一階段 MVP，正進入實際工程驗證。',
    '目前尚未申請專利；原始碼與資料模型全部自主開發，著作權自有。')

  const gap = 0.3, cw = (CW - gap * 2) / 3
  const phase = [
    ['第一階段', '監造端', 'info', '以工程顧問公司、PCM 或建築師事務所的實際案件驗證監造端工作流程'],
    ['第二階段', '＋ 承攬廠商', 'ok', '加入施工端，驗證雙方日常施工填報、查驗、缺失及文件流程'],
    ['第三階段', '＋ 機關端', 'purple', '完整跑通公共工程三級品質管理與主要履約管理流程'],
  ]
  phase.forEach(([t, tag, tone, b], i) => {
    const x = M + i * (cw + gap)
    card(s, x, TOP, cw, 1.9)
    s.addText(t, { x: x + 0.3, y: TOP + 0.3, w: 1.5, h: 0.32, margin: 0, valign: 'middle', fontFace: F, fontSize: T.small, color: C.ink3 })
    statusChip(s, x + 0.3, TOP + 0.7, tag, tone, { h: 0.34, size: T.body })
    bodyText(s, x + 0.3, TOP + 1.2, cw - 0.6, 0.56, b, { size: T.small })
  })

  const ty = TOP + 2.2
  const tw = CW
  const rows = [
    [th('期程'), th('發展目標'), th('預定完成量化目標')],
    [tdb('短期 0–2 月'), td('完成監造端實案驗證'), td('至少取得 1 件實際工程專案進行 Pilot')],
    [tdb('短期 2–4 月'), td('監造 × 承攬廠商協作'), td('至少完成 1 件工程雙方協作測試')],
    [tdb('短期 4–6 月'), td('機關 × 監造 × 承攬廠商三級流程'), td('1 件三方實案驗證；累積 3–5 家試用；至少 1 家付費客戶')],
    [tdb('中期 6–18 月'), td('建立可複製 B2B SaaS 模式'), td('累積 10 件以上實際工程專案，建立穩定 SaaS 營收')],
    [tdb('長期 18–36 月'), td('機關級 AI 工程管理平台'), td('跨專案管理能力；至少 1 項非公共工程政府業務 PoC')],
  ]
  table(s, M, ty, tw, rows, [tw * 0.16, tw * 0.31, tw * 0.53], { size: T.small, pad: 9 })

  s.addNotes([
    '【3:05–3:25｜20 秒】',
    '講快。「產品已經完成第一階段 MVP，接下來分三階段落地：先做監造端，再加承攬廠商，最後導入機關端。」',
    '「下面這張表是短中長期的量化目標——六個月內要拿到三方實案驗證、3 到 5 家試用、至少 1 家付費。」',
    '智財：原始碼與資料模型全部自主開發、未外包，著作權自有；目前尚未申請專利。商標與專利佈局是我要進駐求輔導的事之一。',
    '成長指標（口頭）：六個月內接觸至少 30 家潛在客戶，追蹤 Demo-to-Pilot、Pilot-to-Paid 轉換率、AI 自動產製文件數量與人工修改比例。',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 08 ⑤ 市場規模
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ⑤　市場規模', '台灣約有 4 萬件在建公共工程。',
    '以較保守的模型估算：每年 2,000 件具導入需求的中大型案，平均每案 50 萬元。')

  const gap = 0.3, cw = (CW - gap * 2) / 3
  const mk = [
    ['全球市場', '83–129', '億美元', 'mute', 'Construction Management Software 市場（2026），年複合成長率約 10%'],
    ['台灣可服務市場', '10', '億元／年', 'info', '2,000 案 × 平均 50 萬元；尚未計入 AI Token 與機關級 Portfolio 收入'],
    ['三年目標市占', '1', '%', 'ok', '約 20 案／年、平台營收約 1,000 萬元。5% 為 5,000 萬、10% 為 1 億'],
  ]
  mk.forEach(([name, fig, unit, tone, body], i) => {
    const x = M + i * (cw + gap)
    card(s, x, TOP, cw, 2.4)
    statusChip(s, x + 0.3, TOP + 0.3, name, tone, { w: cw - 0.6, h: 0.34, size: T.body })
    s.addText([
      { text: fig, options: { fontSize: 38, color: tone === 'mute' ? C.ink2 : TONE[tone][1] } },
      { text: '  ' + unit, options: { fontSize: T.body, color: C.ink2 } },
    ], { x: x + 0.3, y: TOP + 0.88, w: cw - 0.6, h: 0.7, margin: 0, valign: 'middle', fontFace: F })
    bodyText(s, x + 0.3, TOP + 1.66, cw - 0.6, 0.68, body, { size: T.small })
  })

  card(s, M, TOP + 2.7, CW, 1.56)
  cardTitle(s, M + 0.36, TOP + 2.98, CW - 0.72, '短期不追求市占，而是先取得第一批實際工程案例')
  bodyText(s, M + 0.36, TOP + 3.46, CW - 0.72, 0.6,
    '一旦形成標準化導入流程，即可透過工程顧問公司、PCM、建築師事務所及營造廠的既有專案快速複製。\n初期不直接進入全球市場，先在台灣公共工程建立 Product-Market Fit，再評估亞洲其他高度制度化的公共工程市場。',
    { size: T.small })

  s.addNotes([
    '【3:25–3:55｜30 秒】',
    '「台灣大概有 4 萬件在建公共工程。我用比較保守的模型算：假設每年只有 2,000 件是有導入需求的中大型案，平均每案 50 萬，可服務市場大概 10 億一年。」',
    '「三年拿到 1%，就是 20 案、1,000 萬。這個數字跟第 11 頁的財務預測是同一組。」',
    '「但短期我不追市占——先拿到第一批實際案例，把標準化導入流程做出來，才有得複製。」',
    '全球數字出處：Grand View Research 2026（83 億美元→2033 年 164 億，CAGR 10.2%）、Fortune Business Insights（2026 年 129.2 億→2034 年 280.5 億，CAGR 10.18%）。口徑不同刻意寫成區間。',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 09 ⑥ 商業模式
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ⑥　商業模式', 'B2B SaaS，以「工程專案」作為收費單位。',
    '客戶不必自行投入人力開發與維護 PMIS，可依承接的工程專案導入，並納入投標及履約服務內容。')

  const tw = 6.6
  const rows = [
    [th('工程契約金額'), th('平台費')],
    [tdb('1 億元以下'), td('NT$ 25 萬／案', { color: C.blue })],
    [tdb('1 – 10 億元'), td('NT$ 50 萬／案', { color: C.blue })],
    [tdb('10 – 100 億元'), td('NT$ 75 萬／案', { color: C.blue })],
    [tdb('100 億元以上'), td('NT$ 100 萬／案', { color: C.blue })],
  ]
  table(s, M, TOP, tw, rows, [tw * 0.55, tw * 0.45], { size: T.small, pad: 11 })

  const rx = M + tw + 0.3, rw = M + CW - rx
  card(s, rx, TOP, rw, 1.5)
  s.addText('AI Token 使用量', {
    x: rx + 0.28, y: TOP + 0.22, w: rw - 0.56, h: 0.26, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.small, color: C.ink2,
  })
  s.addText([
    { text: '3', options: { fontSize: T.figure, color: C.amber } },
    { text: '  倍 API 實際成本', options: { fontSize: T.small, color: C.ink2 } },
  ], { x: rx + 0.28, y: TOP + 0.6, w: rw - 0.56, h: 0.6, margin: 0, valign: 'middle', fontFace: F })

  card(s, rx, TOP + 1.8, rw, 2.46)
  cardTitle(s, rx + 0.3, TOP + 2.1, rw - 0.6, '行銷模式：實際工程 Pilot ＋ 案例行銷 ＋ B2B 業務開發')
  bodyText(s, rx + 0.3, TOP + 2.62, rw - 0.6, 1.4,
    '不以大量廣告投放為主要行銷方式。\n工程產業重視實際案例、可靠性與同業經驗。\n\n第一階段先把 GovAgent.ai 導入至少一件真實公共工程，\n再以節省的行政時間與使用者回饋向同業推廣。',
    { size: T.small, lineSpacing: 21 })

  const by = TOP + 4.56
  s.addText('使用者三類：承攬廠商（工地主任、現場與品管工程師）　·　監造單位（監造主任、顧問公司、PCM、建築師事務所）　·　機關端（工程承辦人、主管）', {
    x: M, y: by, w: CW, h: 0.34, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.small, color: C.ink2,
  })

  s.addNotes([
    '【3:55–4:25｜30 秒】',
    '「收費單位是『工程專案』，不是人頭也不是年費——因為公共工程本來就是以案為單位在管理，客戶承接一個案子就導入一個案子。」',
    '「依契約金額分四級，25 萬到 100 萬一案，AI Token 依 API 實際成本三倍另計，涵蓋模型、雲端、系統維運與持續開發。」',
    '「行銷不靠廣告，靠一件真實工程做出來的案例。工程業重視的是同業經驗。」',
    '被問「為什麼不按人頭」：工程專案的使用者數會隨工期大幅變動，按案收費客戶才敢把三方都拉進來，資料才會完整。',
    '通路（口頭）：直接 B2B 業務開發、創辦人既有公共工程人脈、桃園青創基地媒合、工程公協會與產業活動、官網與線上 Demo、客戶案例與同業轉介。',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 10 ⑦ 競爭者分析
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ⑦　競爭者分析', '不是取代工程顧問公司，而是成為他們可以共同使用的平台。',
    '目前台灣公共工程 PMIS 市場主要有兩類既有方案。')

  const gap = 0.3, cw = (CW - gap) / 2
  const comp = [
    ['第一類　大型顧問自行開發', 'danger', '中興工程顧問、台灣世曦等',
      '本業是工程顧問服務，PMIS 多半是承接大型公共工程時的一部分工具，配合自身承接案件使用，不對外銷售。'],
    ['第二類　一般工程管理軟體', 'warn', '資訊系統或工程管理軟體業者',
      '提供專案管理、文件管理、估驗或施工管理等功能，但多數仍需要工程師大量人工輸入資料。'],
  ]
  comp.forEach(([t, tone, who, b], i) => {
    const x = M + i * (cw + gap)
    card(s, x, TOP, cw, 2.0)
    statusChip(s, x + 0.3, TOP + 0.3, t, tone, { h: 0.34, size: T.body })
    s.addText(who, { x: x + 0.3, y: TOP + 0.78, w: cw - 0.6, h: 0.32, margin: 0, valign: 'middle', fontFace: F, fontSize: T.body, bold: true, color: C.ink })
    bodyText(s, x + 0.3, TOP + 1.2, cw - 0.6, 0.66, b, { size: T.small })
  })

  const py = TOP + 2.3
  card(s, M, py, CW, 1.96)
  cardTitle(s, M + 0.36, py + 0.3, CW - 0.72, 'GovAgent.ai 的定位：獨立 SaaS 軟體公司')
  bodyText(s, M + 0.36, py + 0.78, CW - 0.72, 0.5,
    '大型顧問有能力自建系統，但大量中小型顧問公司、建築師事務所與營造廠沒有專職資訊人力。\n市場機會在於提供「即開即用、按專案收費、不需自行建立 IT 團隊」的 SaaS 模式。',
    { size: T.small })
  s.addText('AI 原生　×　台灣公共工程 Domain Knowledge　×　機關／監造／承攬廠商三方協作　×　工程資料長期累積', {
    x: M + 0.36, y: py + 1.42, w: CW - 0.72, h: 0.4, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 15, color: C.blueText,
  })

  s.addNotes([
    '【4:25–4:55｜30 秒】',
    '「台灣現在有兩類方案。第一類是大型顧問自己開發的——中興、世曦，但那是配合他們自己承接的案子用，不外賣。第二類是一般工程管理軟體，但多數還是要工程師大量人工輸入。」',
    '「我的定位跟他們都不一樣：我是獨立的 SaaS 軟體公司，要成為工程顧問公司、PCM、建築師事務所跟營造廠投標公共工程時可以直接採用的標準化 AI PMIS 平台。」',
    '「我不以低價為唯一優勢，是以標準化 SaaS 加 AI 自動化做差異化。核心競爭位置不是取代工程顧問公司，是成為他們可以共同使用的基礎平台。」',
    '最下面那行是核心競爭優勢，可以直接念。',
    '國際廠商（問答備用）：Procore 官方支援 15 種語言不含繁體中文（2026-01-05）；日本 ANDPAD 2025-12 才新增繁中。兩者都沒有 PCCES 標單、台灣估驗計價與三級品管。',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 11 ⑧ 未來三年損益分析
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ⑧　未來三年財務預測', '2026 年以產品驗證為主，2028 年營收目標 600 萬元。',
    '每一年的營收都等於「付費案件數 × 平台費級距」，可以直接驗算。')

  const tw = 7.4
  const rows = [
    [th('會計項目'), th('2026 年'), th('2027 年'), th('2028 年')],
    [tdb('營業收入'), td('500,000', { color: C.blue }), td('2,500,000', { color: C.blue }), td('6,000,000', { color: C.blue })],
    [tdb('製造成本'), td('100,000'), td('450,000'), td('1,000,000')],
    [tdb('營業毛利'), td('400,000'), td('2,050,000'), td('5,000,000')],
    [tdb('管銷費用'), td('250,000'), td('900,000'), td('2,000,000')],
    [tdb('營業損益'), td('150,000', { color: C.green }), td('1,150,000', { color: C.green }), td('3,000,000', { color: C.green })],
  ]
  table(s, M, TOP, tw, rows, [tw * 0.25, tw * 0.25, tw * 0.25, tw * 0.25], { size: T.small, pad: 11 })

  const rx = M + tw + 0.3, rw = M + CW - rx
  card(s, rx, TOP, rw, 1.9)
  cardTitle(s, rx + 0.3, TOP + 0.3, rw - 0.6, '付費案件數')
  bodyText(s, rx + 0.3, TOP + 0.82, rw - 0.6, 0.9,
    '2026　1–2 件　·　產品驗證為主\n2027　5–7 件\n2028　案例與標準化導入模式建立', { size: T.small, lineSpacing: 21 })

  card(s, rx, TOP + 2.2, rw, 2.06, { fill: C.amberTint, line: 'F0DBA8' })
  statusChip(s, rx + 0.3, TOP + 2.5, '誠實揭露', 'warn')
  bodyText(s, rx + 0.3, TOP + 3.06, rw - 0.6, 1.0,
    '初期無固定工程師人事成本——由創辦人自行負責產品開發、AI 系統整合、客戶開發與公司營運。\n這不是永久結構，第二年起必須開始補人。',
    { size: T.small, color: C.ink, lineSpacing: 20 })

  s.addNotes([
    '【4:55–5:20｜25 秒】',
    '「2026 年還是以產品驗證為主，只抓 1 到 2 件付費案、50 萬。2027 年 5 到 7 件、250 萬。2028 年 600 萬。」',
    '「這幾個數字是付費案件數乘平台費級距推出來的，委員可以直接驗算；2028 年的 600 萬大概是 12 件，也就是可服務市場的 0.6%。」',
    '「要誠實講的是：現在沒有固定的工程師人事成本，是因為產品開發、AI 整合、客戶開發跟公司營運都是我一個人。這不是永久結構。」',
    '主要支出：雲端主機、資料庫、AI API、軟體工具、會計行政及市場開發費用。',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 12 ⑧ 資金籌措計畫
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ⑧　資金籌措計畫', '暫無股權募資計畫：以客戶營收與創辦人自有資金支應。',
    '待完成實際工程驗證、建立穩定付費客戶與可複製的 B2B SaaS 模式後，再評估天使投資或 Seed Round。')

  const tw = 7.4
  const rows = [
    [th('資金用途'), th('2026 年'), th('2027 年'), th('2028 年')],
    [tdb('產品及系統開發'), td('100,000'), td('300,000'), td('600,000')],
    [tdb('AI／雲端服務'), td('100,000'), td('450,000'), td('1,000,000')],
    [tdb('行銷及業務拓展'), td('50,000'), td('300,000'), td('800,000')],
    [tdb('行政及其他營運'), td('100,000'), td('300,000'), td('600,000')],
  ]
  table(s, M, TOP, tw, rows, [tw * 0.28, tw * 0.24, tw * 0.24, tw * 0.24], { size: T.small, pad: 11 })

  const rx = M + tw + 0.3, rw = M + CW - rx
  card(s, rx, TOP, rw, 2.2)
  cardTitle(s, rx + 0.3, TOP + 0.3, rw - 0.6, '規劃申請的政府資源')
  const funds = [['中央 SBIR', 'info'], ['桃園地方型 SBIR', 'ok'], ['AI／數位轉型相關資源', 'purple']]
  funds.forEach(([t, tone], i) => statusChip(s, rx + 0.3, TOP + 0.86 + i * 0.44, t, tone, { h: 0.34, size: T.small }))
  bodyText(s, rx + 0.3, TOP + 2.24, rw - 0.6, 0.3, '', { size: T.small })

  card(s, rx, TOP + 2.5, rw, 1.76)
  cardTitle(s, rx + 0.3, TOP + 2.8, rw - 0.6, '為什麼現在不募股權')
  bodyText(s, rx + 0.3, TOP + 3.28, rw - 0.6, 0.8,
    '產品尚未完成實際工程驗證，估值談不出好價格；\n一人公司的稀釋成本太高。先把 PMF 做出來再談。',
    { size: T.small })

  s.addNotes([
    '【5:20–5:45｜25 秒】',
    '「短期以客戶營收加創辦人自有資金支應，現階段暫無股權募資計畫。」',
    '「規劃申請的是中央 SBIR、桃園地方型 SBIR 跟 AI／數位轉型相關的政府資源——這也是我進駐想要的輔導之一。」',
    '「等產品完成實際工程驗證、有穩定付費客戶跟可複製的商業模式之後，再視市場擴張與人力需求評估天使投資或 Seed Round。」',
    '⚠️ 若委員追問補助金額：各案上限與收件時程以當年度申請須知為準；SBIR 的補助款不得高於自籌款，自籌款不宜大於資本額——所以增資是申請前的必要動作。',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 13 ⑨ 團隊成員
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ⑨　團隊成員', '曾在桃園市政府新建工程處，也在台灣世曦做過監造與 PCM。',
    '公司目前採精實創業模式，由創辦人主導產品與商業驗證，不規劃立即擴大固定人力。')

  const gap = 0.3, cw = (CW - gap * 2) / 3
  const cols = [
    ['機關端', 'purple', '桃園市政府新建工程處', '具備多年大型公共工程管理經驗；\n知道承辦人會被卡在哪一關。'],
    ['監造與 PCM', 'ok', '台灣世曦工程顧問公司', '參與大型公共工程及專案管理，\n累積監造、PCM 級顧問端實務經驗。'],
    ['系統與 AI', 'info', '產品設計、AI 與系統開發', '目前就讀 UCLA Anderson MBA\n與 Georgia Tech MSCS。'],
  ]
  cols.forEach(([tag, tone, role, body], i) => {
    const x = M + i * (cw + gap)
    card(s, x, TOP, cw, 2.2)
    statusChip(s, x + 0.3, TOP + 0.3, tag, tone, { h: 0.32 })
    cardTitle(s, x + 0.3, TOP + 0.78, cw - 0.6, role)
    bodyText(s, x + 0.3, TOP + 1.28, cw - 0.6, 0.7, body, { size: T.small })
  })

  const ay = TOP + 2.5
  card(s, M, ay, CW, 0.66, { fill: C.amberTint, line: 'F0DBA8', flat: true })
  s.addText('創辦人', {
    x: M + 0.34, y: ay, w: 1.0, h: 0.66, margin: 0, valign: 'middle',
    fontFace: F, fontSize: T.small, color: C.amber,
  })
  s.addText('黃慶宇　·　本業年資 5 年　·　專精領域：土木工程、資訊工程、企業管理', {
    x: M + 1.4, y: ay, w: CW - 1.74, h: 0.66, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 17, color: C.ink,
  })

  const by = ay + 0.96, g2 = 0.3, cw2 = (CW - g2) / 2
  card(s, M, by, cw2, 1.3)
  cardTitle(s, M + 0.32, by + 0.28, cw2 - 0.64, '創辦人目前負責', { size: 14, color: C.blueText })
  bodyText(s, M + 0.32, by + 0.72, cw2 - 0.64, 0.5,
    '產品策略與產品管理　·　AI 與系統開發　·　公共工程流程與 Domain Knowledge\n客戶開發與產品驗證　·　公司營運與策略規劃', { size: T.small })

  card(s, M + cw2 + g2, by, cw2, 1.3)
  cardTitle(s, M + cw2 + g2 + 0.32, by + 0.28, cw2 - 0.64, '後續招募', { size: 14, color: C.green })
  bodyText(s, M + cw2 + g2 + 0.32, by + 0.72, cw2 - 0.64, 0.5,
    '待商業模式與客戶需求確認後，再依實際需求招募\n軟體／AI 工程、客戶成功及業務開發人員。', { size: T.small })

  s.addNotes([
    '【5:45–6:10｜25 秒】',
    '「產品要處理機關、監造、承攬廠商三方。機關端我在桃園市政府新建工程處做過，監造跟 PCM 我在台灣世曦做過，系統跟 AI 是我自己寫的。」',
    '桃園新工處這一段對這場審查特別重要，要講清楚、但不要誇大。',
    '⚠️ 學位是「目前就讀」UCLA Anderson MBA 與 Georgia Tech MSCS，不是已取得。當面被問一定照實答。',
    '「目前不規劃立即擴大固定人力——等商業模式跟客戶需求確認後，再依實際需求招募軟體／AI 工程、客戶成功跟業務開發人員。」',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 14 ⑩ 風險評估與因應策略
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ⑩　風險評估與因應策略', '六個風險，每一個都有對應的動作。', '排序依「會不會讓公司死掉」。')

  const gap = 0.3, cw = (CW - gap * 2) / 3, ch = 2.06
  const risks = [
    ['取得第一批案例', '高', 'danger', '公共工程資訊系統導入多由業主驅動。因應：先由監造端切入，不需要業主先點頭；透過青創基地媒合桃園在地顧問、PCM 與營造廠。'],
    ['一人團隊', '高', 'danger', '文件先行制度、測試全自動化；商業模式確認後即招募；與客戶的契約載明原始碼託管與資料可攜。'],
    ['AI 出錯的責任', '中', 'warn', 'AI 只負責讀取、整理、產生草稿、找異常；核定、判定、驗收與缺失結案一律由人執行，且每個動作留下歷程。'],
    ['資料權責與資安', '中', 'warn', '資通系統防護基準普通級對照、弱掃無高風險、日誌保存六個月；SaaS 服務合約與資料權責條款列入進駐輔導需求。'],
    ['既有業者跟進', '中', 'warn', '大型顧問自建系統不對外銷售；差異化在標準化 SaaS ＋ AI 自動化與台灣公共工程 Domain Knowledge。'],
    ['政府資源申請未果', '中', 'info', '短期以客戶營收與自有資金支應，補助當加速器不當生存前提；固定成本壓到最低，AI 與雲端成本隨用量走。'],
  ]
  risks.forEach(([t, level, tone, fix], i) => {
    const x = M + (i % 3) * (cw + gap)
    const cy = TOP + Math.floor(i / 3) * (ch + 0.3)
    card(s, x, cy, cw, ch)
    cardTitle(s, x + 0.3, cy + 0.32, cw - 1.2, t)
    statusChip(s, x + cw - 0.86, cy + 0.32, level, tone, { w: 0.56, h: 0.34 })
    s.addShape(pres.ShapeType.line, { x: x + 0.3, y: cy + 0.82, w: cw - 0.6, h: 0, line: { color: C.line2, width: 0.75 } })
    bodyText(s, x + 0.3, cy + 0.96, cw - 0.6, ch - 1.2, fix, { size: T.small })
  })

  s.addNotes([
    '【6:10–6:30｜20 秒】',
    '六格不要念完。只講第一格：「最大的風險是拿不到第一批案例——公共工程的系統導入多半是業主驅動，監造跟承攬廠商通常缺乏主動更換工作方式的誘因。所以我的因應是從監造端切入，不需要業主先點頭。」',
    '第二句：「其他五個風險跟對應動作都寫在這裡，問答時可以挑任何一個問我。」',
    '最後一格值得多念一次：補助當加速器，不當生存前提。',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 15 ③ 進駐需求
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide()
  head(s, '附件4 ③　進駐需求', '最主要的需求不是辦公空間，是第一批產業合作案例。',
    'GovAgent.ai 已由產品開發階段進入市場驗證及商業化階段。')

  const gap = 0.28, cw = (CW - gap * 2) / 3, ch = 1.86
  const needs = [
    ['①', '業務拓展與案例媒合', 'danger', '接觸桃園在地工程顧問公司、PCM、建築師事務所、營造廠，尋找願意以實際公共工程進行 Pilot 的夥伴'],
    ['②', '取得實際工程案例', 'danger', 'MVP 可供展示與測試，但單靠模擬資料無法完整驗證。希望先由監造端導入，再逐步加入承攬廠商與機關'],
    ['③', '產官學研資源媒合', 'purple', '屬於 GovTech、AI 與 Construction Tech 交叉領域，希望建立與桃園市政府、工程機關、公協會及學校的合作管道'],
    ['④', '商業模式及定價輔導', 'info', '已初步建立以工程規模分級的 B2B SaaS 收費架構，希望透過實際 Pilot 與業師輔導驗證付費意願與採購模式'],
    ['⑤', '政府創新資源申請', 'ok', '規劃申請中央 SBIR、桃園地方型 SBIR 及 AI／數位轉型相關資源，希望取得提案、計畫書與資源媒合輔導'],
    ['⑥', '法律、財務及營運輔導', 'warn', 'SaaS 服務合約、資料權責、資訊安全、智慧財產權、會計稅務及後續公司營運相關議題'],
  ]
  needs.forEach(([n, t, tone, b], i) => {
    const x = M + (i % 3) * (cw + gap)
    const cy = TOP + Math.floor(i / 3) * (ch + 0.28)
    card(s, x, cy, cw, ch)
    statusChip(s, x + 0.28, cy + 0.3, n, tone, { w: 0.42, h: 0.32 })
    cardTitle(s, x + 0.82, cy + 0.3, cw - 1.1, t, { size: 14, h: 0.32 })
    bodyText(s, x + 0.28, cy + 0.8, cw - 0.56, 0.92, b, { size: T.small })
  })

  s.addText('請幫我找到第一件願意讓 GovAgent.ai 進場的公共工程。', {
    x: M, y: TOP + 4.28, w: CW, h: 0.5, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 24, color: C.ink,
  })

  s.addNotes([
    '【6:30–6:50｜這是全場最重要的 20 秒】',
    '六張卡不要一張一張念。只講：「進駐我最主要的需求不是辦公空間，是第一批產業合作案例。」',
    '再點兩項：「業務媒合跟取得實際工程案例是最急的；其他四項——產官學研、定價輔導、政府資源申請、法律財務營運——都寫在這裡。」',
    '最後一句一定要留：「請幫我找到第一件願意讓 GovAgent.ai 進場的公共工程。」講完就停，把時間留給統問統答。',
  ].join('\n'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 封底
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide({ noNum: true })
  mark(s, W / 2 - 0.45, 2.45, 0.9)
  s.addText([
    { text: 'GovAgent', options: { color: C.ink } },
    { text: '.ai', options: { color: C.blue } },
    { text: '　｜　公共工程', options: { fontSize: 14, color: C.ink2 } },
  ], { x: 0, y: 3.6, w: W, h: 0.5, margin: 0, align: 'center', valign: 'middle', fontFace: F, fontSize: 28 })

  s.addText('讓 AI 負責做事，工程師負責判斷。', {
    x: 0, y: 4.2, w: W, h: 0.34, margin: 0, align: 'center', valign: 'middle',
    fontFace: F, fontSize: T.body, color: C.ink2,
  })
  s.addText('欣宇數位科技有限公司　·　gov-agent.ai　·　2026 年 8 月', {
    x: 0, y: 4.7, w: W, h: 0.32, margin: 0, align: 'center', valign: 'middle',
    fontFace: F, fontSize: T.small, color: C.ink3,
  })

  s.addNotes('【統問統答 3 分鐘】最需要準備的三題：一個人做不做得完（P13、P14）、真實案件跑過沒有（P07 三階段）、為什麼現在不募股權（P12）。')
}

pres.writeFile({ fileName: OUT }).then(() => {
  console.log('✓ ' + OUT + '　內頁 ' + PAGE + ' 頁（另有封面與封底）')
  if (MISSING.length) {
    console.error('\n⚠️  以下截圖不存在,已用佔位框代替 —— 不要就這樣拿去簡報：')
    MISSING.forEach((f) => console.error('    ' + path.join(SHOTS, f + '.png')))
    console.error('    修法：node docs/pitch/pptx/shots.js && python3 docs/pitch/pptx/crop.py，然後重跑本檔。\n')
    process.exitCode = 1
  }
})
