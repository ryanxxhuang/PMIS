// 組長簡報 PowerPoint 產生器（v2，2026-08-12 會後改版）
// ---------------------------------------------------------------------------
// v3（2026-08-12 會後）最重要的一件事：**這份是會後寄給組長自己看的文件，不是簡報稿。**
//   組長當時沒看到這份，而且他「還在想要怎麼合作」——所以任何「已確定／今天請您決定」
//   的寫法都是錯位的。第參幕整段從「請您決定的清單」改成「供參的行政整理」，
//   並新增 P19 合作方式四個層級（前兩格零採購），結尾只留一個零承諾的 ask。
//
// v2 相對 v1 的四個實質改動（都是使用者當面指定的，改文案時不要改回去）：
//   1) 全案不用黑。場景頁改成深鋼青藍 #154C74，內文最深的墨色也改成藍灰 #1D2B39。
//   2) 採購方式已經確定是小額採購逕洽，不再花一整頁分析採購法 → 壓成「已確定的事」一列。
//      同理，核定層級已確認為組長，不再當成待問事項。
//   3) 政府採購不是「不想用就結束」——v1 結尾那套試辦話術整段拿掉，
//      改成「有驗收標準的履約」＋ 一頁可寫進契約的服務承諾。
//   4) 新增「履約期間與驗收時點」一頁：簽一定要寫到何時驗收，這是本案唯一還沒定的事。
//
// 字型：Latin 走 Arial（數字／條號），中日韓走 Microsoft JhengHei（見 fix_ea.py）。

const pptxgen = require('pptxgenjs')

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

const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE'
pres.author = 'gov-agent.ai'
pres.title = '工程 Agent — 產品、資安與簽辦（組長版）'

let PAGE = 0
const TOTAL = 25

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

// ═══ 壹 · 產品 ═════════════════════════════════════════════════════════════

// 01 封面
{
  const s = slide('封面', { field: true })
  s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: W * 0.34, h: 7.5, fill: { color: C.fieldDeep }, line: { color: C.fieldDeep } })
  s.addText('公共工程專案管理', {
    x: 0.9, y: 2.55, w: W * 0.34 - 1.5, h: 0.32, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 13, bold: true, charSpacing: 2.6, color: C.safety,
  })
  s.addText('雲端訂閱服務', {
    x: 0.9, y: 2.96, w: W * 0.34 - 1.4, h: 0.5, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 21, bold: true, color: C.fieldInk,
  })
  s.addText('SaaS', {
    x: 0.9, y: 3.46, w: W * 0.34 - 1.4, h: 0.32, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 13, bold: true, charSpacing: 2.4, color: C.fieldInk2,
  })
  s.addText('gov-agent.ai', {
    x: 0.9, y: 4.3, w: W * 0.34 - 1.4, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 12.5, bold: true, charSpacing: 1.2, color: C.fieldInk2,
  })

  const bx = W * 0.34 + 0.95
  s.addText('每一個承辦人，\n配一個懂他業務的 Agent。', {
    x: bx, y: 2.35, w: W - bx - 0.8, h: 2.0, margin: 0, valign: 'top',
    fontFace: F, fontSize: 40, bold: true, color: C.fieldInk, lineSpacing: 52,
  })
  s.addText(
    [{ text: '這份簡報講三件事：' },
     { text: '系統有哪些功能', options: { bold: true, color: 'FFFFFF' } },
     { text: '、' },
     { text: '資安怎麼過', options: { bold: true, color: 'FFFFFF' } },
     { text: '、' },
     { text: '簽辦要引哪些規範', options: { bold: true, color: 'FFFFFF' } },
     { text: '。' }],
    { x: bx, y: 4.5, w: W - bx - 0.8, h: 0.72, margin: 0, valign: 'top', fontFace: F, fontSize: 16, color: C.fieldInk2, lineSpacing: 24 },
  )
  s.addText('接續 8 月 12 日談話的書面整理　·　中央大學總務處營繕組', {
    x: bx, y: 5.5, w: W - bx - 0.8, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 12, bold: true, charSpacing: 0.8, color: C.fieldInk2,
  })
  s.addNotes('這是寄給組長自己看的文件,不是簡報稿。語氣一律供參,不催決定。')
}

// 02 導覽
{
  const s = slide('導覽')
  const y = head(s, '本簡報架構', '把三個問題一次講完。', { q: true })
  const cw = (CW - 0.42 * 2) / 3
  const acts = [
    ['壹 · P04–P09', '系統有哪些功能', '九個功能面、十六個可獨立開關的 AI 模組、四個角色各一個 Agent。重點在「少輸入、多產出」。', 'act'],
    ['貳 · P11–P17', '資安怎麼過', '工程會一覽表歸類、普級 11 項逐項回覆、境外資料、弱點掃描、日誌、AI 的信任設計。', 'wip'],
    ['參 · P19–P25', '行政面怎麼走', '合作可以從很小開始、行政面我先查過的事、屆時的驗收方式、會寫進契約的服務承諾、文件現況。', 'act'],
  ]
  acts.forEach((a, i) => cardText(s, M + i * (cw + 0.42), y + 0.1, cw, 2.55, a[1], a[2], { chip: [a[0], a[3]], titleSize: 17 }))
  card(s, M, y + 3.0, CW, 1.05, { fill: C.steelTint, flat: true })
  s.addText(
    [{ text: '這份是接續 8 月 12 日談話的書面整理，供組長參考。', options: { bold: true, color: C.ink } },
     { text: '　第參部分是行政面的整理，不是要請組長現在決定什麼；有哪一頁與貴校實務不符，請直接指正。', options: { color: C.ink2 } }],
    { x: M + 0.3, y: y + 3.0, w: CW - 0.6, h: 1.05, margin: 0, valign: 'middle', fontFace: F, fontSize: 13, lineSpacing: 19 },
  )
}

// 分隔頁
function divider(sec, ord, title, sub, toc, notes) {
  const s = slide(sec, { field: true })
  s.addText(ord, {
    x: M, y: 2.3, w: 2, h: 1.0, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 62, bold: true, color: C.safety,
  })
  s.addText(title, {
    x: M, y: 3.42, w: CW * 0.55, h: 0.8, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 36, bold: true, color: C.fieldInk,
  })
  s.addText(sub, {
    x: M, y: 4.28, w: CW * 0.5, h: 0.6, margin: 0, valign: 'top',
    fontFace: F, fontSize: 14.5, color: C.fieldInk2, lineSpacing: 22,
  })
  bullets(s, M + CW * 0.62, 2.55, CW * 0.38, toc, 'dash', 12.5, C.fieldInk2)
  if (notes) s.addNotes(notes)
  return s
}
divider('壹 · 產品', '壹', '系統有哪些功能。',
  '九個功能面、四個角色、十六個 AI 模組。\n重點是「少輸入、多產出」。',
  ['現況：資料散在四個地方', '功能全覽與資料脊椎', '四個角色各一個 Agent', '佐證鏈：逐工項對帳', 'AI 模組與開關', '工程完成度'],
  '這一段講快一點，組長真正在意的是後面兩段。')

// 04 現況
{
  const s = slide('壹 · 產品')
  const y = head(s, '現況', '資料不是沒有，是散在四個地方。', { q: true })
  const cw = (CW - 0.3 * 3) / 4
  ;[['施工日誌', '廠商每月印一疊 PDF 送來'], ['估驗計價', 'Excel，每期一個檔'],
    ['查驗紀錄', '紙本，放監造那邊'], ['工地照片', 'LINE 群組，翻不到']]
    .forEach((a, i) => cardText(s, M + i * (cw + 0.3), y, cw, 1.15, a[0], a[1], { titleSize: 15 }))

  const cw3 = (CW - 0.34 * 2) / 3
  ;[['估驗核定', '廠商報這期做了多少，要人工翻日誌回頭對數量。對不完，就只能相信。'],
    ['稽核與審計', '被問「這期估驗的依據在哪」，得從四個地方重新湊一份出來。'],
    ['法定期限', '送審、月報、竣工文件、逾期違約金——沒有人在幫你算日子。']]
    .forEach((a, i) => cardText(s, M + i * (cw3 + 0.34), y + 1.48, cw3, 1.5, a[0], a[1], { titleSize: 15 }))

  card(s, M, y + 3.26, CW, 0.74, { fill: C.safetyTint, flat: true })
  s.addText('四份文件本來就應該互相對得上，但沒有人有時間逐工項去對。', {
    x: M + 0.3, y: y + 3.26, w: CW - 0.6, h: 0.74, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 15, bold: true, color: C.ink,
  })
}

// 05 功能全覽
{
  const s = slide('壹 · 產品')
  const y = head(s, '功能全覽', '九個功能面，一條資料脊椎串起來。')
  const cw = (CW - 0.3 * 2) / 3
  const ch = 1.5
  const items = [
    ['總覽', 'AI Agent 主控台', '依角色的今日待辦、草稿收件匣、對話式查詢。'],
    ['總覽', '跨案總覽', '機關端多案進度、金流與逾期一頁看完。'],
    ['總覽', '專案儀表', 'Dashboard、活動紀錄、施工月報、監造報表。'],
    ['成本與進度', '標單工項', 'PCCES 預算書匯入展成工項樹，全案數字的來源。'],
    ['成本與進度', '估驗與金流', '估驗計價、請款收款、成本管理、進度 S 曲線、逐工項排程。'],
    ['成本與進度', '施工日誌', '現場當天填，數量直接累計到估驗。'],
    ['品質與工安', '品質與工安', '品質查驗、檢驗停留點（ITP）、工安管理與缺失追蹤。'],
    ['契約與協作', '契約與協作', '專案文件、履約需求、送審文件、工程疑義（RFI）、變更設計、風險稽核。'],
    ['契約與協作', '驗收結算與成員', '法定期限倒數、驗收流程、專案成員與權限。'],
  ]
  items.forEach((it, i) => {
    cardText(s, M + (i % 3) * (cw + 0.3), y + Math.floor(i / 3) * (ch + 0.14), cw, ch, it[1], it[2],
      { chip: [it[0], 'na'], titleSize: 14, bodySize: 10.5, compact: true })
  })
  s.addText(
    [{ text: '資料脊椎：', options: { color: C.ink3 } },
     { text: '標單工項 → 施工日誌數量 → 估驗計價 → 請款', options: { bold: true, color: C.steelText } },
     { text: '，全線以同一個工項識別碼串接，所以才對得起來。', options: { color: C.ink3 } }],
    { x: M, y: y + 3 * ch + 0.38, w: CW, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 11 },
  )
}

// 06 四個角色
{
  const s = slide('壹 · 產品')
  const y = head(s, '角色', 'Agent 做草稿，人做決定。')
  table(s, M, y + 0.18, CW, [
    [th('角色'), th('Agent 幫他做'), th('他自己做（Agent 沒有這個工具）')],
    [tdb('現場（廠商）'), td('日誌零輸入（複製昨日、常用班組機具自學、依座標帶入當日天氣）；工地照片批次辨識，逐張產說明並配到工項；估驗數量從日誌累計帶出'), tdb('確認、送出')],
    [tdb('品管'), td('自主檢查表依契約規範生成；缺失照片產描述草稿；混凝土試體齡期到期提醒'), tdb('判定合格與否')],
    [tdb('監造'), td('送審文件逐項比對契約規範，出審查要點與意見草稿；RFI 回覆草稿；施工月報草稿'), tdb('審定、核備')],
    [tdb('機關'), td('佐證鏈逐工項對帳；稽核意見草稿；法定期限倒數與逾期違約金試算；跨案總覽'), tdb('核定、驗收、結案')],
  ], [1.6, 7.2, 3.093], { size: 11.5, pad: 18 })
  s.addText('加一個角色＝加一份人格設定與工具白名單，不是另外做一套系統。', {
    x: M, y: 5.9, w: CW, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 11, color: C.ink3,
  })
}

// 07 佐證鏈
{
  const s = slide('壹 · 產品')
  const y = head(s, '機關最有感的一頁', '佐證鏈：逐工項把四份文件對起來。')
  const after = chain(s, y + 0.12, [
    ['CLAIM', '估驗數量'], ['LOG', '日誌累計'], ['INSPECT', '查驗紀錄'],
    ['TEST', '試體強度'], ['PHOTO', '現場照片'],
  ])
  const cw = (CW - 0.42) / 2
  card(s, M, after + 0.42, cw, 2.5)
  s.addText('六項對帳，全部是程式算的', {
    x: M + 0.26, y: after + 0.56, w: cw - 0.52, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 14.5, bold: true, color: C.ink,
  })
  bullets(s, M + 0.26, after + 0.96, cw - 0.52, [
    '本期估驗量超過日誌累計量', '混凝土澆置日沒有對應試體', '估驗的工項沒有查驗紀錄',
    '品質缺失未結案就進入計價', '照片沒有對應到任何工項', '變更設計未核准就計價',
  ], 'dash', 11.5)
  cardText(s, M + cw + 0.42, after + 0.42, cw, 2.5, '判定確定性，AI 只寫文字',
    '哪裡對不上，是資料庫算出來的，數字永遠可回溯。\n\nAI 的工作只有一件：把對不上的地方寫成一段人看得懂的稽核意見草稿——而且只建議查證，不寫剔除、補強、停工、罰款。',
    { fill: C.safetyTint, flat: true, titleSize: 14.5, bodySize: 11.5 })
}

// 08 AI 模組
{
  const s = slide('壹 · 產品')
  const y = head(s, 'AI 模組', '十六個 AI 模組，每一個都可以單獨關掉。')
  const cw = (CW - 0.3 * 3) / 4
  ;[['對話', ['AI Agent 主控台', 'AI 問答助理']],
    ['讀文件', ['契約解析（時程／罰則）', '規範需求抽取', '送審文件讀取']],
    ['產草稿', ['監造送審審查意見', 'RFI 回覆草稿', '機關稽核意見草稿', '施工月報草稿', '估驗施工說明草稿']],
    ['看照片 · 介接', ['工程告示板辨識', '缺失照片描述', '施工照片分類', '工安照片判讀', '天氣帶入（中央氣象署）', '每日 agent 早報']]]
    .forEach((g, i) => {
      const x = M + i * (cw + 0.3)
      card(s, x, y, cw, 2.5)
      chip(s, x + 0.24, y + 0.2, g[0], 'na')
      bullets(s, x + 0.22, y + 0.64, cw - 0.44, g[1], 'dash', 10.5)
    })
  const cw2 = (CW - 0.42) / 2
  cardText(s, M, y + 2.8, cw2, 1.32, '關掉之後，系統照常運作',
    '關閉只是少了草稿，估驗、日誌、查驗、驗收全部照走。若貴校不接受把資料送到境外的模型，十六個模組可以整組關掉。',
    { fill: C.goodTint, flat: true, titleSize: 14, bodySize: 11 })
  cardText(s, M + cw2 + 0.42, y + 2.8, cw2, 1.32, '每一次呼叫都計量',
    '功能、使用者、專案、耗用量與成本逐次入庫，機關看得到自己用了多少、花了多少——這也是後續編列預算的依據。',
    { titleSize: 14, bodySize: 11 })
}

// 09 工程狀態
{
  const s = slide('壹 · 產品')
  const y = head(s, '工程狀態', '不是原型，是可以放真案的系統。')
  const sw = CW / 4
  ;[[36, '功能頁面'], [16, 'AI 模組'], [503, '計算引擎單元測試'], [20, '套資料庫權限測試']]
    .forEach((st, i) => stat(s, M + i * sw, y + 0.22, sw, st[0], st[1], i === 2 ? C.steel : C.ink))
  const cw = (CW - 0.42) / 2
  cardText(s, M, y + 1.55, cw, 2.1, '權限不在前端',
    '誰能看、誰能寫、誰能改狀態，全部在資料庫層以資料列權限（RLS）與狀態轉移規則實作，逐角色逐表自動化實測（20 套、六百餘項）。\n\n把前端按鈕藏起來不算安全——這也是工程會一覽表「帳號控管措施」那一列的實質內容。',
    { titleSize: 15, bodySize: 11.5 })
  cardText(s, M + cw + 0.42, y + 1.55, cw, 2.1, '數字由確定性引擎算',
    '金額、數量、期限、逾期違約金由程式計算，503 項單元測試釘住。\n\nAI 只能複述引擎回傳的數字，不准自己乘除，也不准自己編法規條號。',
    { titleSize: 15, bodySize: 11.5 })
}

// ═══ 貳 · 資安 ═════════════════════════════════════════════════════════════
divider('貳 · 資安', '貳', '資安怎麼過。',
  '普級 11 項要求、High 0、日誌六個月。\n記住這三個數字就夠了。',
  ['歸類決定工作量', '普級 11 列逐項回覆', '境外資料：經同意即可', 'ISO 與第三方檢測的門檻', '弱點掃描與日誌', 'AI 的三條紅線', '個資委外'],
  '這一段是重點。第一頁的歸類講清楚，後面才成立。')

// 11 歸類
{
  const s = slide('貳 · 資安')
  const y = head(s, '資安', '第一件事是歸類，不是技術。')
  cite(s, M, y, CW, 0.62, '依據',
    '行政院公共工程委員會 112 年 9 月 25 日工程企字第 1120022701 號函檢送之「各類資訊(服務)採購之共通性資通安全基本要求參考一覽表」（普級部分自 113 年 3 月 1 日施行）')
  s.addText(
    [{ text: '一覽表共 9 張表，依「資料或系統類型」分。', options: { color: C.ink2 } },
     { text: '同一套系統歸到不同的表，普級要求差好幾倍。', options: { bold: true, color: C.safetyText } },
     { text: '本案應歸「雲端微服務（SaaS）套裝型」——這一格由使用單位主動敘明，不要等別人猜。', options: { color: C.ink2 } }],
    { x: M, y: y + 0.78, w: CW, h: 0.42, margin: 0, valign: 'middle', fontFace: F, fontSize: 12.5 },
  )
  table(s, M, y + 1.34, CW, [
    [th('類型'), th('普級新增的硬要求'), th('本案')],
    [tdb('雲端微服務（SaaS）套裝型'), td('帳號控管、資料傳輸屬「◎ 個案評估」；全表共 11 列'), tds('本案適用', 'ok')],
    [tdb('SaaS 辦公室生產力工具'), td('多因子認證 ●、帳號控管 ●、資料傳輸 ●、資料分類與標籤 ●、釣魚郵件過濾 ●'), td('排除：不提供郵件、行事曆、雲端硬碟、即時通訊')],
    [tdb('雲端平台（PaaS／IaaS）'), td('平台層控制措施'), td('排除：機關不取得平台資源，僅使用應用服務')],
    [tdb('應用軟體或系統開發服務'), td('附表十全構面 ●、上線前主機弱點掃描 ●、網站弱點掃描 ●、資安維運服務 ●、機關人員教育訓練 ●、SBOM ◎'), td('須排除：機關不委託開發、不取得原始碼、不驗收程式，僅按期訂閱既有服務', { color: C.bad })],
  ], [2.5, 6.0, 3.393], { size: 10.5, pad: 11 })
  s.addText(
    [{ text: '所以文件用語很重要：', options: { bold: true, color: C.ink } },
     { text: '標的名稱一律寫「雲端訂閱服務」，全案不出現「開發」「客製」「建置」。', options: { color: C.ink2 } }],
    { x: M, y: 6.3, w: CW, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 11.5 },
  )
}

// 12 逐項回覆表
{
  const s = slide('貳 · 資安')
  const y = head(s, '逐項回覆', 'SaaS 套裝型・普級全部 11 列，逐列已備妥。', { small: true })
  s.addText('●＝建議辦理　　◎＝經機關評估個案有必要時　　－＝不適用　　（圖示定義出自一覽表說明欄）', {
    x: M, y: y - 0.04, w: CW, h: 0.26, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 10, bold: true, color: C.ink3, charSpacing: 0.6,
  })
  const L = (t) => td(t, { align: 'center', bold: true, color: C.steelText })
  const N = (t) => td(t, { align: 'center', color: C.ink3 })
  table(s, M, y + 0.32, CW, [
    [th('#'), th('項目'), th('普級'), th('我方回覆與佐證'), th('狀態')],
    [N('1'), tdb('完善資通安全管理措施（或 ISO 27001）'), L('●'), td('走前者：資通系統防護基準普通級符合性對照表'), tds('已備齊', 'ok')],
    [N('2'), tdb('隱私資訊管理標準（ISO 27701）'), L('◎'), td('個資極少（姓名／職稱／公務聯絡方式／帳號），以個資委外附約替代'), tds('可談', 'na')],
    [N('3'), tdb('非大陸地區廠商、非第三地區含陸資'), L('●'), td('非陸資廠商聲明書'), tds('待具結', 'wip')],
    [N('4'), tdb('帳號控管措施'), L('◎'), td('伺服器端 RBAC ＋ 資料列權限逐表隔離'), tds('已具備', 'ok')],
    [N('5'), tdb('資料傳輸措施'), L('◎'), td('TLS 1.2 以上，附實測'), tds('已具備', 'ok')],
    [N('6'), tdb('事件日誌（含 IP 位址）保存，建議至少六個月'), L('●'), td('帳號權限變更、登入、時間、IP、資料存取皆入庫且不可竄改；書面留存政策可直接當附件'), tds('已備齊', 'ok')],
    [N('7'), tdb('供應商安全 ＋ 產品安全（各擇一）'), L('●'), td('供應商：公開漏洞回報機制（/security ＋ security.txt）；產品：弱點掃描報告 High 0'), tds('已備齊', 'ok')],
    [N('8'), tdb('廠商通過 CMMC'), L('－'), td('普級不適用'), tds('不適用', 'na')],
    [N('9'), tdb('未經機關審查同意，不得移至本國以外地區'), L('●'), td('主動送資料落地說明書，請機關審查同意（見下頁）'), tds('請機關核', 'wip')],
    [N('10'), tdb('存取、備份、備援不得位於大陸地區（含港澳）'), L('●'), td('完全不涉，寫入聲明書'), tds('乾淨', 'ok')],
    [N('11'), tdb('虛擬主機映像檔安全'), L('◎'), td('本服務為 SaaS，不提供虛擬主機予機關'), tds('不適用', 'na')],
  ], [0.44, 3.5, 0.62, 6.083, 1.35], { size: 10, pad: 6 })
}

// 13 境外
{
  const s = slide('貳 · 資安')
  const y = head(s, '最關鍵的一題', '境外不是禁止，是「經機關審查同意」。')
  s.addText(
    [{ text: '一覽表資料安全欄兩條的措辭刻意寫得不一樣——', options: { color: C.ink2 } },
     { text: '這個對比是整件事的關鍵。', options: { bold: true, color: C.safetyText } }],
    { x: M, y, w: CW, h: 0.32, margin: 0, valign: 'middle', fontFace: F, fontSize: 13 },
  )
  const cw = (CW - 0.42) / 2
  const y1 = y + 0.44
  ;[[M, C.steelTint, '境外', '「未經機關審查同意，不得將雲端資訊系統或儲存資料移至本國以外地區」', '→ 經審查同意就可以。要做的不是搬回校內，是備齊材料請機關審查。'],
    [M + cw + 0.42, C.safetyTint, '大陸地區', '存取、備份及備援之實體所在地「不得」位於大陸地區（含港澳），且不得跨該等境內傳輸', '→ 絕對禁止、無例外。本服務完全不涉。']]
    .forEach(([x, fill, label, quote, note]) => {
      card(s, x, y1, cw, 1.5, { fill, flat: true })
      chip(s, x + 0.26, y1 + 0.16, label, 'na')
      s.addText(quote, { x: x + 0.26, y: y1 + 0.5, w: cw - 0.52, h: 0.5, margin: 0, valign: 'middle', fontFace: F, fontSize: 12.5, bold: true, color: C.ink })
      s.addText(note, { x: x + 0.26, y: y1 + 1.03, w: cw - 0.52, h: 0.34, margin: 0, valign: 'middle', fontFace: F, fontSize: 11, color: C.ink2 })
    })

  const y2 = y1 + 1.76
  card(s, M, y2, cw, 2.05)
  s.addText('本案的事實', { x: M + 0.26, y: y2 + 0.16, w: cw - 0.52, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 14.5, bold: true, color: C.ink })
  bullets(s, M + 0.26, y2 + 0.56, cw - 0.52, [
    '資料庫位於日本；日本有完整個資保護法制（APPI）',
    '不涉大陸地區（含港澳），第二條完全乾淨',
    'AI 模組可整組關閉，關閉後不對外送任何內容',
    '傳輸 TLS 1.2 以上、靜態加密；資料可完整匯出',
  ], 'tick', 11.5)
  cardText(s, M + cw + 0.42, y2, cw, 2.05, '可參照的校內先例',
    '貴校自 112 年 12 月 1 日起全校實施 Office 365 A3（電子計算機中心公告），教職員信箱、行事曆與雲端硬碟均位於境外雲端。\n\n想請教貴校當時審查同意的作業方式，我方比照相同規格備妥文件即可。',
    { fill: C.steelTint, flat: true, titleSize: 14.5, bodySize: 11.5 })
}

// 14 常見三問
{
  const s = slide('貳 · 資安')
  const y = head(s, '常被問到的三題', 'ISO 是「或」，第三方檢測有門檻。')
  const cw = (CW - 0.42 * 2) / 3
  ;[['沒有 ISO 27001 可以嗎？', '一覽表原文：「須具備完善資通安全管理措施或通過 CNS 27001 或 ISO 27001 等標準、其他具有同等或以上效果之系統或標準」。關鍵是「或」。本案走前者，提供逐項的符合性對照表為佐證。'],
    ['要不要第三方安全性檢測？', '一覽表說明欄：屬機關核心資通系統，或委託金額達新臺幣一千萬元以上者，機關應自行或另行委託第三方檢測。本案兩者皆不是，不適用；改以我方提供的弱點掃描報告佐證。'],
    ['萬一有一項真的做不到？', '一覽表「供應商及產品安全要求」欄原文開頭即載明：「…提出佐證資料，若無符合條件者提請機關資安長確認風險」。制度設計的出口是風險確認，不是廢標。']]
    .forEach((q, i) => cardText(s, M + i * (cw + 0.42), y + 0.12, cw, 2.6, q[0], q[1], { titleSize: 15, bodySize: 11.5 }))
  card(s, M, y + 3.02, CW, 1.0, { fill: C.steelTint, flat: true })
  s.addText(
    [{ text: '另一個結構性事實：', options: { color: C.ink2 } },
     { text: '函文說明一寫明「由機關視個案特性將所列資安事項納入契約辦理」，且圖示 ●＝建議辦理。', options: { bold: true, color: C.ink } },
     { text: '這是「參考」一覽表，機關本就有裁量空間挑合理的子集。', options: { color: C.ink2 } }],
    { x: M + 0.3, y: y + 3.02, w: CW - 0.6, h: 1.0, margin: 0, valign: 'middle', fontFace: F, fontSize: 12.5, lineSpacing: 19 },
  )
}

// 15 技術佐證
{
  const s = slide('貳 · 資安')
  const y = head(s, '已完成的技術佐證', '能拿出報告的，都已經跑完了。')
  const cw = (CW - 0.42 * 2) / 3
  ;[['0', '高風險弱點', '弱點掃描報告',
     'OWASP ZAP baseline ＋ AJAX spider，受測標的為正式站。High 0、通過檢測項 60、警告 7 類（均為刻意設計、誤報或資訊性提示，逐項有處置說明）。\n\n另附修補歷程：首次掃描警告 13 類，移轉主機並統一設定安全標頭後複測，7 類根因相同者全部消失（13→7、通過 54→60）。', C.good],
    ['6', '個月日誌留存', '事件日誌',
     '一覽表明文列舉的六類全數入庫：帳號與權限變更、登入名稱、時間、IP 位址、資料存取、重要安全性事件。\n\nIP 由伺服器端解析（前端不得傳入）；紀錄只增不改；無任何自動清除機制；專案刪除亦留痕。', C.steel],
    ['2', '個公開回報入口', '漏洞回報應變機制',
     '公開頁面（不需登入）＋ 依 RFC 9116 的 /.well-known/security.txt，並載明內部應變流程六步與聯絡信箱。\n\n這一項滿足一覽表「供應商安全」的條件之一，不需要第三方檢測團隊。', C.steel]]
    .forEach((it, i) => {
      const x = M + i * (cw + 0.42)
      card(s, x, y, cw, 3.55)
      stat(s, x + 0.26, y + 0.18, cw - 0.52, it[0], it[1], it[4])
      s.addText(it[2], { x: x + 0.26, y: y + 1.16, w: cw - 0.52, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 14.5, bold: true, color: C.ink })
      fits(it[2], it[3].replace(/\n/g, ''), cw, 1.95, 11)
      s.addText(it[3], { x: x + 0.26, y: y + 1.52, w: cw - 0.52, h: 1.9, margin: 0, valign: 'top', fontFace: F, fontSize: 11, color: C.ink2, lineSpacing: 15.5 })
    })
  s.addText(
    [{ text: '一句話版本：', options: { color: C.ink3 } },
     { text: '普級 11 項要求、High 0、日誌六個月', options: { bold: true, color: C.ink } },
     { text: '——記住這三個數字就夠了。', options: { color: C.ink3 } }],
    { x: M, y: y + 3.78, w: CW, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 12 },
  )
}

// 16 三條紅線
{
  const s = slide('貳 · 資安')
  const y = head(s, 'AI 會不會亂做決定', '三條紅線，寫在架構裡，不是寫在簡報上。')
  ;[['紅線 01', 'AI 只產生草稿', '核定、判定、結案、驗收、凍結——Agent 的工具箱裡根本沒有這些工具。這是工具白名單保證的，不是靠提示詞叮嚀它。狀態轉移一律走資料庫層規則加上人簽核。'],
    ['紅線 02', '數字永遠由確定性引擎算', '金額、數量、期限、違約金由程式計算後回傳給 AI 複述。AI 不准自己乘除，也不准自己編法規條號——引用不到來源時，它必須寫「依適用條文與現場量測辦理」。'],
    ['紅線 03', '每個 Agent 動作都留痕', '角色、動作種類、目標、理由、引用佐證、人的覆核結果，逐筆入庫可匯出。稽核問「這個數字誰算的」，答案永遠是：程式，而且有紀錄。']]
    .forEach((l, i) => {
      const yy = y + i * 1.15
      // 這條橘線是「紅線」本身的具象化,不是裝飾
      s.addShape(pres.ShapeType.rect, { x: M, y: yy + 0.06, w: 0.045, h: 0.92, fill: { color: C.safety }, line: { color: C.safety } })
      s.addText(l[0], { x: M + 0.3, y: yy, w: 3, h: 0.24, margin: 0, valign: 'middle', fontFace: F, fontSize: 9.5, bold: true, charSpacing: 2, color: C.safetyText })
      s.addText(l[1], { x: M + 0.3, y: yy + 0.24, w: 5, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 15, bold: true, color: C.ink })
      s.addText(l[2], { x: M + 0.3, y: yy + 0.56, w: CW - 0.42, h: 0.46, margin: 0, valign: 'top', fontFace: F, fontSize: 11.5, color: C.ink2, lineSpacing: 16 })
    })
  card(s, M, y + 3.62, CW, 0.95, { fill: C.safetyTint, flat: true })
  s.addText(
    [{ text: '加上第四條：每個 AI 功能都是可獨立開關的模組。', options: { bold: true, color: C.ink } },
     { text: '　十六個模組逐一可關，關閉時系統照常運作。機關不必在「要 AI」和「不要 AI」之間二選一。', options: { color: C.ink2 } }],
    { x: M + 0.3, y: y + 3.62, w: CW - 0.6, h: 0.95, margin: 0, valign: 'middle', fontFace: F, fontSize: 12.5, lineSpacing: 19 },
  )
}

// 17 個資
{
  const s = slide('貳 · 資安')
  const y = head(s, '個資委外', '個資這層是契約題，不是技術題。')
  cite(s, M, y, CW, 0.62, '個人資料保護法施行細則第 8 條',
    '公務機關委託他人蒐集、處理或利用個人資料者，應對受託者為適當之監督，並明確約定監督事項及方式。')
  const cw = (CW - 0.42) / 2
  const y1 = y + 0.88
  card(s, M, y1, cw, 2.5)
  s.addText(
    [{ text: '本服務涉及的個資範圍很窄：', options: { color: C.ink2 } },
     { text: '姓名、職稱、單位、公務聯絡方式、系統帳號', options: { bold: true, color: C.ink } },
     { text: '——不涉特種個資、不涉學籍或健康資料，也不以機關資料訓練模型。', options: { color: C.ink2 } }],
    { x: M + 0.26, y: y1 + 0.2, w: cw - 0.52, h: 0.8, margin: 0, valign: 'top', fontFace: F, fontSize: 12, lineSpacing: 17 },
  )
  s.addText(
    [{ text: '貴校的個資制度建在教育部「教育體系資通安全暨個人資料管理規範」上，委外附約通常照該規範 B.12.1.2 的八要項撰寫，境外傳輸則對應 B.11.1.1 的五條。', options: { color: C.ink2 } },
     { text: '我方直接照那些條目先寫好附約草案，法制單位不必起草。', options: { bold: true, color: C.ink } }],
    { x: M + 0.26, y: y1 + 1.08, w: cw - 0.52, h: 1.3, margin: 0, valign: 'top', fontFace: F, fontSize: 11.5, lineSpacing: 16.5 },
  )
  card(s, M + cw + 0.42, y1, cw, 2.5, { fill: C.steelTint, flat: true })
  s.addText('附約會寫進去的事', { x: M + cw + 0.68, y: y1 + 0.18, w: cw - 0.52, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 14.5, bold: true, color: C.ink })
  bullets(s, M + cw + 0.68, y1 + 0.58, cw - 0.52, [
    '蒐集處理利用之範圍、類別、目的與期間', '保密義務與事故責任', '機關保有稽核權（含實地稽核）',
    '再委外（分包）之限制', '資安事故之通知義務與時限', '契約終止時資料返還、刪除與銷毀切結',
  ], 'dash', 11.5)
  s.addText('補充：個資法第 21 條（國際傳輸限制）規範對象為非公務機關；國立中央大學屬公務機關，故境外傳輸並無法定禁令，而是回到前頁的「機關審查同意」與本頁的契約約定。', {
    x: M, y: y1 + 2.68, w: CW, h: 0.36, margin: 0, valign: 'middle', fontFace: F, fontSize: 11, color: C.ink3,
  })
}

// ═══ 參 · 行政與合作 ═══════════════════════════════════════════════════════
// ⚠️ v3 語氣：組長「還在想要怎麼合作」，所以這一段一律是**供參的整理**，
//    不是請他決定的清單。任何「已確定／請您選」的寫法都不要放回來。
divider('參 · 行政', '參', '真的要合作的話，行政面怎麼走。',
  '這一段是供參的整理，不是要請組長現在決定。\n重點只有一個：這一格不會卡。',
  ['合作可以從很小開始', '行政面我先查過的事', '屆時的驗收方式', '若合作，會寫進契約的承諾', '簽長什麼樣子', '文件現況'],
  '這一段不要用催的口氣講。')

// 19 合作方式的四個層級（回應「他還在想要怎麼合作」）
{
  const s = slide('參 · 行政')
  const y = head(s, '合作方式', '合作可以從很小開始。')
  s.addText('由淺到深四個層級，不必一次跳到最後一格。前兩格完全不涉採購，也不需要任何行政程序。', {
    x: M, y, w: CW, h: 0.32, margin: 0, valign: 'middle', fontFace: F, fontSize: 12.5, color: C.ink2,
  })
  table(s, M, y + 0.46, CW, [
    [th('層級'), th('做什麼'), th('貴組要投入'), th('涉不涉採購')],
    [tdb('一　先看'), td('我開一個示範專案帳號，組長與承辦人自己點，想看哪裡點哪裡'), td('約半小時'), tds('不涉', 'ok')],
    [tdb('二　用貴組真的文件跑一次'), td('給我一份不含個資的契約與標單，我建好之後讓貴組看實際長什麼樣'), td('交一次檔'), tds('不涉', 'ok')],
    [tdb('三　單一功能先用'), td('挑最痛的一塊先上（例如施工日誌＋照片辨識，或估驗佐證包）'), td('一位承辦人'), td('免費期間不涉')],
    [tdb('四　單案訂閱'), td('一個在建案的完整流程，一年期'), td('承辦人＋廠商監造聯絡人'), td('小額採購')],
  ], [2.6, 5.4, 2.0, 2.093], { size: 11, pad: 14 })
  card(s, M, y + 3.5, CW, 1.05, { fill: C.steelTint, flat: true })
  s.addText(
    [{ text: '我的建議是先做到第二格。', options: { bold: true, color: C.ink } },
     { text: '　它零採購、零風險，而且組長會直接看到系統吃了貴組真實的契約與標單之後長什麼樣子，'
        + '再決定要不要往下走。這一步我這邊不收費，也不需要貴組跑任何程序。', options: { color: C.ink2 } }],
    { x: M + 0.3, y: y + 3.5, w: CW - 0.6, h: 1.05, margin: 0, valign: 'middle', fontFace: F, fontSize: 12.5, lineSpacing: 19 },
  )
  s.addNotes('這是這份文件的核心一頁。他還在想怎麼合作，給他一個零成本的第一步。')
}

// 20 行政面先查過的事 ＋ 會辦動線
{
  const s = slide('參 · 行政')
  const y = head(s, '行政面', '若走到第四格，這些我先查過了。', { small: true })
  s.addText('以下是我方查證與理解，供組長參考；如與貴校實務有出入，請直接指正，我照貴組的做法調整。', {
    x: M, y: y - 0.04, w: CW, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 11.5, color: C.ink3,
  })
  const cw = (CW - 0.3 * 3) / 4
  ;[['採購方式', '小額採購逕洽', '15 萬元以下，得不經公告程序逕洽廠商，免提供報價或企劃書，亦無須三家比價。'],
    ['核定層級', '應在組長權責內', '屬小額採購，理解上本組即可核定；實際權責仍以貴校分層負責明細表為準。'],
    ['財產登記', '應不涉財產登記', '純訂閱服務，機關未取得軟硬體所有權。'],
    ['校內規定', '未見加嚴規定', '查詢所得貴校對 15 萬以下無額外加嚴要求；若有內規請組長告知。']]
    .forEach((a, i) => cardText(s, M + i * (cw + 0.3), y + 0.36, cw, 1.72, a[1], a[2],
      { chip: [a[0], 'act'], titleSize: 14.5, bodySize: 10.5, compact: true }))

  s.addText('會辦動線', {
    x: M, y: y + 2.3, w: CW, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 14.5, bold: true, color: C.ink,
  })
  chain(s, y + 2.66, [
    ['使用單位', '營繕組擬簽'], ['會辦 · 資安', '電子計算機中心'], ['會辦 · 個資', '個資／法制單位'],
    ['核定', '依校內權責'], ['續辦', '請購 · 簽約'],
  ], 1)
  card(s, M, y + 3.76, CW, 0.85, { fill: C.safetyTint, flat: true })
  s.addText(
    [{ text: '資訊類採購會會辦計網中心，所以簽送出去的那一刻資安文件就要完整——', options: { color: C.ink2 } },
     { text: '不能先簽再補，一退件就是一輪時間。', options: { bold: true, color: C.ink } },
     { text: '這也是為什麼我把第貳部分的文件先備齊。', options: { color: C.ink2 } }],
    { x: M + 0.3, y: y + 3.76, w: CW - 0.6, h: 0.85, margin: 0, valign: 'middle', fontFace: F, fontSize: 12, lineSpacing: 18 },
  )
}

// 21 驗收方式（供參，不催決定）
{
  const s = slide('參 · 行政')
  const y = head(s, '屆時的行政細節', '如果走到採購，驗收怎麼訂。')
  s.addText('這頁不是現在要決定的事，是先讓組長知道這一格不會卡。三種方式我方都接受。', {
    x: M, y, w: CW, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 12.5, color: C.ink2,
  })
  cite(s, M, y + 0.42, CW, 0.78, '政府採購法施行細則',
    '§90-1　勞務驗收，得以書面或召開審查會方式辦理；其書面驗收文件或審查會紀錄，得視為驗收紀錄。　　'
    + '§94　無初驗程序者，除契約另有規定外，機關應於接獲廠商通知備驗或可得驗收之程序完成後三十日內辦理驗收。')
  table(s, M, y + 1.42, CW, [
    [th('方式'), th('驗收時點'), th('付款'), th('對貴組'), th('')],
    [tdb('甲　期滿驗收'), td('服務期間屆滿後書面驗收'), td('期滿一次付清'), td('最保守，但整個服務期間沒有檢核點'), tds('可以', 'na')],
    [tdb('乙　開通驗收'), td('服務開通、貴組確認約定功能可用後三十日內書面驗收'), td('驗收合格後一次付款'), td('一次驗收一次核銷，作業最省'), tds('實務常見', 'act')],
    [tdb('丙　分期驗收'), td('開通驗收 ＋ 期滿結案驗收'), td('分二期'), td('多一個檢核點，但要跑兩次驗收與核銷'), tds('可以', 'na')],
  ], [1.5, 3.1, 1.5, 4.393, 1.0], { size: 10.5, pad: 12 })
  card(s, M, y + 4.02, CW, 0.86, { fill: C.steelTint, flat: true })
  s.addText(
    [{ text: '訂閱服務實務上多採乙（開通驗收），因為服務的價值在期間內持續提供，把驗收拖到期末並不會多一分保障；'
        + '真正的保障是下一頁那六項寫進契約的承諾。', options: { color: C.ink2 } },
     { text: '但要用哪一種，等貴組決定合作方式之後再談就好。', options: { bold: true, color: C.ink } }],
    { x: M + 0.3, y: y + 4.02, w: CW - 0.6, h: 0.86, margin: 0, valign: 'middle', fontFace: F, fontSize: 12, lineSpacing: 18 },
  )
}

// 22 服務承諾（直接回應「這家公司會不會做一做就不見了」）
{
  const s = slide('參 · 行政')
  const y = head(s, '服務承諾', '若真的合作，這六項會寫進契約。')
  s.addText('對一家新公司，最合理的疑慮是「會不會做一做就不見了」。所以以下六項不是口頭保證，是擬全部寫進服務契約、可被檢核的義務。', {
    x: M, y, w: CW, h: 0.32, margin: 0, valign: 'middle', fontFace: F, fontSize: 12.5, color: C.ink2,
  })
  const cw = (CW - 0.3 * 2) / 3
  const ch = 1.42
  ;[['服務可用率', '月可用率 99% 以上（不含預告維護）。未達標時，當月服務費按比例折抵次期費用。'],
    ['回應時限', '一般問題一個工作日內回覆；影響貴組作業之障礙四小時內回應，並於當日提出處置方式。'],
    ['資料可攜', '貴組隨時可自行完整匯出（含工項、估驗、日誌、佐證與 agent 動作紀錄），格式為通用試算表。'],
    ['期滿或終止', '完整交付資料後依約刪除，並出具資料刪除與銷毀切結書。不以任何形式扣留機關資料。'],
    ['資料不作訓練', '不以貴校資料訓練或改良模型。AI 模組可整組關閉，關閉後不對外送出任何內容。'],
    ['每月服務報告', '每月提供用量、事件與已處理問題之書面報告，可直接作為履約管理之佐證。']]
    .forEach((a, i) => cardText(s, M + (i % 3) * (cw + 0.3), y + 0.44 + Math.floor(i / 3) * (ch + 0.18), cw, ch, a[0], a[1],
      { titleSize: 14.5, bodySize: 11 }))
  card(s, M, y + 3.6, CW, 0.92, { fill: C.goodTint, flat: true })
  s.addText(
    [{ text: '為什麼敢這樣寫：', options: { bold: true, color: C.ink } },
     { text: '系統已經上線並有自有網域，弱點掃描無高風險，權限在資料庫層逐表實測，每個動作都留痕。'
        + '這不是等簽約後才要開始做的東西——是已經在跑的東西。', options: { color: C.ink2 } }],
    { x: M + 0.3, y: y + 3.6, w: CW - 0.6, h: 0.92, margin: 0, valign: 'middle', fontFace: F, fontSize: 12.5, lineSpacing: 19 },
  )
  s.addNotes('可用率 99% 與四小時回應是會被寫進契約的義務——確認自己做得到再送出這份文件。')
}

// 23 簽稿骨架（幫承辦人省時間，不是催簽）
{
  const s = slide('參 · 行政')
  const y = head(s, '供參', '真的要簽的時候，簽大概長這樣。', { small: true })
  s.addText('放這頁的目的是幫承辦人省起草時間，不是催組長簽。文字仍由貴組依校內格式撰擬。', {
    x: M, y: y - 0.04, w: CW, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 11.5, color: C.ink3,
  })
  table(s, M, y + 0.34, CW, [
    [th('段'), th('寫什麼'), th('依據／要點')],
    [td('一', { align: 'center', bold: true, color: C.steelText }), tdb('需求緣由'), td('現行以紙本與 Excel 彙整進度、估驗、日誌與查驗紀錄，人工重複登打、佐證散落；以某工程為標的，載明服務期間')],
    [td('二', { align: 'center', bold: true, color: C.steelText }), tdb('採購方式'), td('小額採購逕洽（15 萬元以下，得不經公告程序，免提供報價或企劃書）；敘明無須三家比價')],
    [td('三', { align: 'center', bold: true, color: C.steelText }), tdb('資安要求之依據及辦理情形'), td('工程會 112/9/25 工程企字第 1120022701 號函；敘明歸屬「SaaS 套裝型」及排除理由；系統防護需求等級評估為普級，請計網中心卓核；廠商逐項回覆詳附件二')],
    [td('四', { align: 'center', bold: true, color: C.steelText }), tdb('境外資料之審查同意'), td('一覽表資料安全欄；資料庫位於日本（非大陸地區），廠商提出落地說明（附件四），請計網中心審查，經同意後於契約載明')],
    [td('五', { align: 'center', bold: true, color: C.steelText }), tdb('個人資料委外'), td('個資法施行細則 §8；契約附個資委外處理附約（附件五）')],
    [td('六', { align: 'center', bold: true, color: C.steelText }), tdb('資安經費'), td('「資訊服務採購作業指引」要求估算並單獨計列；本案為標準訂閱服務，資安措施已內含於訂閱費用無法拆分，敘明原因')],
    [td('七', { align: 'center', bold: true, color: C.steelText }), tdb('履約期間與驗收'), td('服務期間；驗收方式依前頁擇一載明；勞務採購採書面驗收；服務承諾條款納入契約；不涉財產登記')],
  ], [0.55, 2.7, 8.843], { size: 10.5, pad: 9 })
  s.addText(
    [{ text: '擬辦大意：', options: { bold: true, color: C.ink } },
     { text: '同意辦理小額採購並簽訂服務契約；', options: { color: C.ink2 } },
     { text: '會辦電子計算機中心', options: { bold: true, color: C.safetyText } },
     { text: '（第三、四點）與個資業務單位／法制（第五點）；奉核後續辦請購。', options: { color: C.ink2 } }],
    { x: M, y: 6.02, w: CW, h: 0.34, margin: 0, valign: 'middle', fontFace: F, fontSize: 11.5 },
  )
}

// 24 文件現況
{
  const s = slide('參 · 行政')
  const y = head(s, '文件現況', '七份附件，六份已經備妥。')
  table(s, M, y + 0.18, CW, [
    [th('附件'), th('文件'), th('用途'), th('狀態')],
    [td('一', { align: 'center', bold: true, color: C.steelText }), tdb('廠商估價單'), td('金額與服務期間'), tds('商業登記核准後即可出具', 'wip')],
    [td('二', { align: 'center', bold: true, color: C.steelText }), tdb('資安要求逐項回覆表'), td('SaaS 套裝型・普級 11 列（本文件 P12）'), tds('已定稿', 'ok')],
    [td('三', { align: 'center', bold: true, color: C.steelText }), tdb('非陸資廠商聲明書'), td('對應第 3、10 列'), tds('具結中', 'wip')],
    [td('四', { align: 'center', bold: true, color: C.steelText }), tdb('資料落地與境外傳輸說明書'), td('供計網中心審查（第 9 列）'), tds('材料齊備', 'ok')],
    [td('五', { align: 'center', bold: true, color: C.steelText }), tdb('個人資料委外處理附約（草案）'), td('個資法施行細則 §8'), tds('草案可提供', 'ok')],
    [td('六', { align: 'center', bold: true, color: C.steelText }), tdb('服務條款與隱私權政策'), td('含個資申訴窗口'), tds('整理中', 'wip')],
    [td('七', { align: 'center', bold: true, color: C.steelText }), tdb('資通系統防護基準普通級符合性對照表'), td('對應第 1 列（走「完善資通安全管理措施」）'), tds('已完成', 'ok')],
  ], [0.7, 4.0, 5.15, 2.243], { size: 11, pad: 8 })
  card(s, M, y + 4.05, CW, 0.9, { fill: C.steelTint, flat: true })
  s.addText(
    [{ text: '不論最後怎麼合作，這六份文件都可以先給貴組與計網中心看。', options: { bold: true, color: C.ink } },
     { text: '　估價單要等商業登記核准（辦理中）才開得出來，但那是最後一步，不影響前面任何討論。', options: { color: C.ink2 } }],
    { x: M + 0.3, y: y + 4.05, w: CW - 0.6, h: 0.9, margin: 0, valign: 'middle', fontFace: F, fontSize: 12, lineSpacing: 18 },
  )
}

// 25 結尾（不催決定）
{
  const s = slide('結尾', { field: true })
  s.addText('下一步', {
    x: M, y: 0.85, w: CW, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 11, bold: true, charSpacing: 2.6, color: C.safety,
  })
  s.addText('不用現在決定\n要怎麼合作。', {
    x: M, y: 1.32, w: CW * 0.52, h: 1.7, margin: 0, valign: 'top',
    fontFace: F, fontSize: 37, bold: true, color: C.fieldInk, lineSpacing: 48,
  })
  s.addText('這份文件是接續上次談話的書面整理，把系統做到哪、資安過不過得了、行政面怎麼走，一次寫清楚，方便組長自己看。', {
    x: M, y: 3.25, w: CW * 0.5, h: 0.95, margin: 0, valign: 'top',
    fontFace: F, fontSize: 14, color: C.fieldInk2, lineSpacing: 22,
  })
  s.addText('若有哪一頁與貴校實務不符，請直接指正，我照著改。', {
    x: M, y: 4.35, w: CW * 0.5, h: 0.34, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 13, bold: true, color: C.fieldInk,
  })
  s.addText('聯絡：security@gov-agent.ai　·　gov-agent.ai', {
    x: M, y: 4.9, w: CW * 0.5, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 12, color: C.fieldInk2,
  })

  const bx = M + CW * 0.56
  const bw = CW * 0.44
  s.addShape(pres.ShapeType.roundRect, {
    x: bx, y: 1.32, w: bw, h: 4.0, rectRadius: 0.04,
    fill: { color: C.fieldDeep }, line: { color: '2A6997', width: 1 },
  })
  s.addText('若方便，只想請組長幫一件事', {
    x: bx + 0.34, y: 1.62, w: bw - 0.68, h: 0.34, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 16, bold: true, color: C.fieldInk,
  })
  s.addText('引薦計網中心的窗口。', {
    x: bx + 0.34, y: 2.06, w: bw - 0.68, h: 0.36, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 19, bold: true, color: C.safety,
  })
  s.addText('不論最後用哪一種合作方式，資安這一關遲早要過。提前對過一次，之後不論走到哪一步都會順很多——而且這一步不需要貴組做任何決定。', {
    x: bx + 0.34, y: 2.52, w: bw - 0.68, h: 1.0, margin: 0, valign: 'top',
    fontFace: F, fontSize: 12, color: C.fieldInk2, lineSpacing: 17,
  })
  s.addText('其他兩件，不急：', {
    x: bx + 0.34, y: 3.66, w: bw - 0.68, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 12.5, bold: true, color: C.fieldInk,
  })
  bullets(s, bx + 0.34, 4.02, bw - 0.68, [
    '合作想從哪一格開始（P19）',
    '若想看真實文件跑一次，需要一份契約與標單',
  ], 'dash', 11.5, C.fieldInk2)
  s.addNotes('這頁只留一個 ask，而且是零承諾的那一個。不要催他決定合作方式。')
}

const OUT = process.argv[2] || 'deck.pptx'
pres.writeFile({ fileName: OUT }).then(() => {
  console.log(`寫出 ${OUT}，共 ${PAGE} 頁`)
  if (WARN.length) { console.log('\n⚠️ 可能爆框：'); WARN.forEach((w) => console.log('  ' + w)) }
  else console.log('文字量估算：全數在框內')
})
