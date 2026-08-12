// 組長簡報 PowerPoint 產生器
// 內容與 docs/pitch/組長簡報-產品資安與簽辦-2026-08-12.html 同源(23 頁 = 20 內容頁 + 3 幕別分隔頁)。
// 字型:Latin 走 Arial(數字/條號好看且到處都有),中日韓走 Microsoft JhengHei(Windows Office 標配);
// pptxgenjs 只寫 <a:latin>,ea/cs 由 fix-ea.py 後製補上,否則 PowerPoint 會用佈景主題預設的東亞字型。

const pptxgen = require('pptxgenjs')
const fs = require('fs')

const C = {
  ink: '16202B', ink2: '4D5C6A', ink3: '78848F',
  paper: 'F1F3F6', card: 'FFFFFF', rule: 'D8DFE6',
  steel: '1E5A85', steelText: '1B5480', steelTint: 'E5EEF5',
  safety: 'E8630C', safetyText: 'C8540A', safetyTint: 'FDEADD',
  good: '1A7F4E', goodTint: 'E2F2EA',
  bad: 'C73A34', badTint: 'FBE8E7',
  darkBg: '111A23', darkInk: 'E9EEF3', darkInk2: '9FABB8',
}
const F = 'Arial'          // Latin/數字
const W = 13.333, H = 7.5
const M = 0.62             // 左右邊界
const CW = W - M * 2       // 內容寬 12.093
const TOP = 0.5

const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE'
pres.author = 'gov-agent.ai'
pres.title = '工程 Agent — 產品、資安與簽辦（組長版）'

let PAGE = 0
const TOTAL = 23

// ── 版面零件 ───────────────────────────────────────────────────────────────
function footer(s, sec, dark) {
  PAGE += 1
  s.addText(sec, {
    x: M, y: 6.94, w: 6, h: 0.3, align: 'left', valign: 'middle', margin: 0,
    fontFace: F, fontSize: 9, color: dark ? C.darkInk2 : C.ink3, charSpacing: 1.6,
  })
  s.addText(`${String(PAGE).padStart(2, '0')} / ${TOTAL}`, {
    x: W - M - 2, y: 6.94, w: 2, h: 0.3, align: 'right', valign: 'middle', margin: 0,
    fontFace: F, fontSize: 9, color: dark ? C.darkInk2 : C.ink3, charSpacing: 1.6,
  })
}

function slide(sec, opts = {}) {
  const s = pres.addSlide()
  s.background = { color: opts.dark ? C.darkBg : C.paper }
  footer(s, sec, opts.dark)
  return s
}

// 眉標＋大標。回傳內容區的起始 y。
function head(s, eyebrow, title, opts = {}) {
  s.addText(eyebrow, {
    x: M, y: TOP, w: CW, h: 0.26, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 9.5, bold: true, charSpacing: 2.2,
    color: opts.q ? C.steelText : C.safetyText,
  })
  const size = opts.small ? 27 : 31
  s.addText(title, {
    x: M, y: TOP + 0.3, w: CW, h: 0.62, margin: 0, valign: 'middle',
    fontFace: F, fontSize: size, bold: true, color: C.ink,
  })
  return TOP + 1.06
}

// 卡片：白底、細框、圓角。回傳它自己，方便再往裡面塞東西。
function card(s, x, y, w, h, opts = {}) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.04,
    fill: { color: opts.fill || C.card },
    line: opts.fill ? { color: opts.fill } : { color: C.rule, width: 0.75 },
    shadow: opts.flat ? undefined
      : { type: 'outer', angle: 90, blur: 6, offset: 0.03, color: '9AA7B4', opacity: 0.18 },
  })
}

// 狀態籤(圓角小色塊)——本簡報唯一的重複視覺母題,而且它承載真實狀態,不是裝飾。
const CHIP = {
  ok: [C.goodTint, C.good], no: [C.badTint, C.bad],
  wip: [C.safetyTint, C.safetyText], na: ['E4E9EE', C.ink3],
  act: [C.steelTint, C.steelText],
}
function chip(s, x, y, text, kind = 'na', w) {
  const [bg, fg] = CHIP[kind]
  const width = w || (0.13 + cjkWidth(text, 9) / 72 + 0.13)
  s.addText(text, {
    x, y, w: width, h: 0.26, margin: 0, align: 'center', valign: 'middle',
    shape: pres.ShapeType.roundRect, rectRadius: 0.03,
    fill: { color: bg }, line: { color: bg },
    fontFace: F, fontSize: 9, bold: true, color: fg, charSpacing: 0.6,
  })
  return width
}

// 粗略字寬(pt):中日韓與全形標點算 1 em,其餘算 0.53 em。用來估卡片文字會不會爆框。
function cjkWidth(str, size) {
  let n = 0
  for (const ch of String(str)) n += /[⺀-￯]/.test(ch) ? 1 : 0.53
  return n * size
}
const WARN = []
function fits(label, text, boxW, boxH, size, pad = 0.22) {
  const usable = (boxW - pad * 2) * 72
  const lines = Math.ceil(cjkWidth(text, size) / usable)
  const needed = (lines * size * 1.42) / 72
  if (needed > boxH) WARN.push(`${label}: 需 ${needed.toFixed(2)}" > 有 ${boxH.toFixed(2)}" (${lines} 行)`)
  return needed
}

// 卡片內文字（標題＋內文），自動排版並做爆框檢查
function cardText(s, x, y, w, h, title, body, opts = {}) {
  card(s, x, y, w, h, opts)
  const px = 0.22
  let cy = y + 0.16
  if (opts.chip) { chip(s, x + px, cy, opts.chip[0], opts.chip[1]); cy += 0.38 }
  if (title) {
    s.addText(title, {
      x: x + px, y: cy, w: w - px * 2, h: 0.3, margin: 0, valign: 'middle',
      fontFace: F, fontSize: opts.titleSize || 14.5, bold: true, color: opts.titleColor || C.ink,
    })
    cy += 0.36
  }
  if (body) {
    const size = opts.bodySize || 11
    const bh = y + h - cy - 0.14
    fits(`${title || opts.chip?.[0] || ''}`, body.replace(/\n/g, ''), w, bh, size)
    s.addText(body, {
      x: x + px, y: cy, w: w - px * 2, h: bh, margin: 0, valign: 'top',
      fontFace: F, fontSize: size, color: opts.bodyColor || C.ink2, lineSpacing: size * 1.42,
    })
  }
}

// 打勾／打叉／破折清單
function bullets(s, x, y, w, h, items, mark = 'dash', size = 11) {
  const glyph = { tick: '✓', cross: '✕', dash: '—' }[mark]
  const color = { tick: C.good, cross: C.bad, dash: C.ink3 }[mark]
  const rowH = 0.29
  items.forEach((t, i) => {
    const yy = y + i * rowH
    s.addText(glyph, {
      x, y: yy, w: 0.24, h: rowH, margin: 0, valign: 'middle',
      fontFace: F, fontSize: mark === 'dash' ? 8 : 10.5, bold: true, color,
    })
    s.addText(t, {
      x: x + 0.24, y: yy, w: w - 0.24, h: rowH, margin: 0, valign: 'middle',
      fontFace: F, fontSize: size, color: C.ink2,
    })
  })
  return y + items.length * rowH
}

// 法源引註：白底方塊＋鋼青色標題,像公文裡的引註（不用色條）
function cite(s, x, y, w, h, label, text) {
  card(s, x, y, w, h, { flat: true })
  s.addText(
    [
      { text: label + '　', options: { bold: true, color: C.steelText } },
      { text, options: { color: C.ink2 } },
    ],
    {
      x: x + 0.24, y: y + 0.06, w: w - 0.48, h: h - 0.12, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 11, lineSpacing: 15.5,
    },
  )
}

// 表格
function table(s, x, y, w, rows, colW, opts = {}) {
  const size = opts.size || 10.5
  s.addTable(rows, {
    x, y, w, colW,
    fontFace: F, fontSize: size, color: C.ink2,
    border: { type: 'solid', color: C.rule, pt: 0.5 },
    align: 'left', valign: 'middle',
    margin: [opts.pad || 6, 8, opts.pad || 6, 8],
    autoPage: false,
  })
}
function th(t) {
  return { text: t, options: { bold: true, color: C.ink3, fontSize: 9.5, charSpacing: 1.2, fill: { color: 'E8ECF1' } } }
}
function td(t, o = {}) { return { text: t, options: { fill: { color: C.card }, ...o } } }
function tdb(t, o = {}) { return td(t, { bold: true, color: C.ink, ...o }) }

// 節點串（佐證鏈／會辦動線）
function chain(s, y, nodes, hotIdx = -1) {
  const gap = 0.34
  const nw = (CW - gap * (nodes.length - 1)) / nodes.length
  nodes.forEach((n, i) => {
    const x = M + i * (nw + gap)
    const hot = i === hotIdx
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w: nw, h: 0.86, rectRadius: 0.04,
      fill: { color: hot ? C.safetyTint : C.card },
      line: { color: hot ? C.safety : C.rule, width: hot ? 1.5 : 0.75 },
    })
    s.addText(n[0], {
      x, y: y + 0.12, w: nw, h: 0.22, margin: 0, align: 'center', valign: 'middle',
      fontFace: F, fontSize: 8.5, bold: true, charSpacing: 1.4, color: hot ? C.safetyText : C.ink3,
    })
    s.addText(n[1], {
      x, y: y + 0.36, w: nw, h: 0.34, margin: 0, align: 'center', valign: 'middle',
      fontFace: F, fontSize: 13.5, bold: true, color: C.ink,
    })
    if (i < nodes.length - 1) {
      s.addShape(pres.ShapeType.line, {
        x: x + nw + 0.06, y: y + 0.43, w: gap - 0.12, h: 0,
        line: { color: C.steel, width: 1.25, endArrowType: 'triangle' },
      })
    }
  })
  return y + 0.86
}

// 大數字
function stat(s, x, y, w, fig, cap, color = C.ink) {
  s.addText(String(fig), {
    x, y, w, h: 0.68, margin: 0, valign: 'bottom',
    fontFace: F, fontSize: 44, bold: true, color,
  })
  s.addText(cap, {
    x, y: y + 0.7, w, h: 0.26, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 9.5, bold: true, charSpacing: 1.6, color: C.ink3,
  })
}

// ── 01 封面 ────────────────────────────────────────────────────────────────
{
  const s = slide('封面', { dark: true })
  s.addText('公共工程專案管理　·　雲端訂閱服務（SaaS）', {
    x: M, y: 1.75, w: CW, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 12, bold: true, charSpacing: 2.4, color: C.safety,
  })
  s.addText('每一個承辦人，\n配一個懂他業務的 Agent。', {
    x: M, y: 2.2, w: CW, h: 1.9, margin: 0, valign: 'top',
    fontFace: F, fontSize: 46, bold: true, color: C.darkInk, lineSpacing: 58,
  })
  s.addText(
    [
      { text: '這份簡報講三件事：' },
      { text: '系統有哪些功能', options: { bold: true, color: 'FFFFFF' } },
      { text: '、' },
      { text: '資安怎麼過', options: { bold: true, color: 'FFFFFF' } },
      { text: '、' },
      { text: '簽辦要引哪些規範', options: { bold: true, color: 'FFFFFF' } },
      { text: '。' },
    ],
    {
      x: M, y: 4.32, w: CW, h: 0.4, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 17, color: C.darkInk2,
    },
  )
  s.addText('gov-agent.ai　·　2026 年 8 月 12 日　·　中央大學總務處營繕組', {
    x: M, y: 5.6, w: CW, h: 0.32, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 12, bold: true, charSpacing: 0.8, color: C.darkInk2,
  })
  s.addNotes('開場：今天想講三件事——功能、資安、簽辦。重點在最後一頁的四個問題，特別是引薦計網中心。')
}

// ── 02 三幕導覽 ────────────────────────────────────────────────────────────
{
  const s = slide('導覽')
  const y = head(s, '本簡報架構', '把三個問題一次講完。', { q: true })
  const cw = (CW - 0.42 * 2) / 3
  const acts = [
    ['第一幕 · P04–P09', '系統有哪些功能', '九個功能面、十六個可獨立開關的 AI 模組、四個角色各一個 Agent。重點在「少輸入、多產出」。'],
    ['第二幕 · P11–P17', '資安怎麼過', '工程會一覽表歸類、普級 11 項逐項回覆、境外資料、弱點掃描、日誌、AI 的信任設計。'],
    ['第三幕 · P19–P22', '簽辦要引哪些規範', '採購方式法源、簽稿七段骨架、七份附件與現況、會辦動線與時程。'],
  ]
  acts.forEach((a, i) => {
    cardText(s, M + i * (cw + 0.42), y + 0.1, cw, 2.5, a[1], a[2], {
      chip: [a[0], i === 1 ? 'wip' : 'act'], titleSize: 17,
    })
  })
  card(s, M, y + 2.92, CW, 1.05, { fill: C.steelTint })
  s.addText(
    [
      { text: '先說結論：資安不是這個案子的風險，歸類才是。', options: { bold: true, color: C.ink } },
      { text: '　同一套系統歸到不同的表，普級要求差好幾倍——所以第二幕的第一頁在講歸類，不是在講技術。', options: { color: C.ink2 } },
    ],
    { x: M + 0.28, y: y + 3.0, w: CW - 0.56, h: 0.9, margin: 0, valign: 'middle', fontFace: F, fontSize: 13, lineSpacing: 19 },
  )
}

// ── 03 分隔：第一幕 ────────────────────────────────────────────────────────
function divider(sec, no, title, sub, notes) {
  const s = slide(sec, { dark: true })
  s.addText(no, {
    x: M, y: 2.55, w: CW, h: 0.34, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 13, bold: true, charSpacing: 3, color: C.safety,
  })
  s.addText(title, {
    x: M, y: 3.0, w: CW, h: 0.95, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 40, bold: true, color: C.darkInk,
  })
  s.addText(sub, {
    x: M, y: 4.05, w: CW * 0.72, h: 0.4, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 15, color: C.darkInk2,
  })
  if (notes) s.addNotes(notes)
}
divider('第一幕 · 產品', '第 一 幕', '系統有哪些功能。', '九個功能面、四個角色、十六個 AI 模組——重點是「少輸入、多產出」。')

// ── 04 現況 ────────────────────────────────────────────────────────────────
{
  const s = slide('第一幕 · 產品')
  const y = head(s, '第一幕 · 現況', '資料不是沒有，是散在四個地方。', { q: true })
  const cw = (CW - 0.3 * 3) / 4
  const src = [
    ['施工日誌', '廠商每月印一疊 PDF 送來'],
    ['估驗計價', 'Excel，每期一個檔'],
    ['查驗紀錄', '紙本，放監造那邊'],
    ['工地照片', 'LINE 群組，翻不到'],
  ]
  src.forEach((a, i) => cardText(s, M + i * (cw + 0.3), y, cw, 1.15, a[0], a[1], { titleSize: 15 }))

  const cw3 = (CW - 0.34 * 2) / 3
  const cost = [
    ['估驗核定', '廠商報這期做了多少，要人工翻日誌回頭對數量。對不完，就只能相信。'],
    ['稽核與審計', '被問「這期估驗的依據在哪」，得從四個地方重新湊一份出來。'],
    ['法定期限', '送審、月報、竣工文件、逾期違約金——沒有人在幫你算日子。'],
  ]
  cost.forEach((a, i) => cardText(s, M + i * (cw3 + 0.34), y + 1.45, cw3, 1.5, a[0], a[1], { titleSize: 15 }))

  card(s, M, y + 3.2, CW, 0.72, { fill: C.safetyTint })
  s.addText('四份文件本來就應該互相對得上，但沒有人有時間逐工項去對。', {
    x: M + 0.28, y: y + 3.2, w: CW - 0.56, h: 0.72, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 15, bold: true, color: C.ink,
  })
}

// ── 05 功能全覽 ────────────────────────────────────────────────────────────
{
  const s = slide('第一幕 · 產品')
  const y = head(s, '第一幕 · 功能全覽', '九個功能面，一條資料脊椎串起來。')
  const cw = (CW - 0.3 * 2) / 3
  const ch = 1.55
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
    const col = i % 3, row = Math.floor(i / 3)
    cardText(s, M + col * (cw + 0.3), y + row * (ch + 0.13), cw, ch, it[1], it[2], {
      chip: [it[0], 'na'], titleSize: 14, bodySize: 10.5,
    })
  })
  s.addText(
    [
      { text: '資料脊椎：', options: { color: C.ink3 } },
      { text: '標單工項 → 施工日誌數量 → 估驗計價 → 請款', options: { bold: true, color: C.steelText } },
      { text: '，全線以同一個工項識別碼串接，所以才對得起來。', options: { color: C.ink3 } },
    ],
    { x: M, y: y + 3 * ch + 0.34, w: CW, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 11 },
  )
}

// ── 06 四個角色 ────────────────────────────────────────────────────────────
{
  const s = slide('第一幕 · 產品')
  const y = head(s, '第一幕 · 角色', 'Agent 做草稿，人做決定。')
  const rows = [
    [th('角色'), th('Agent 幫他做'), th('他自己做（Agent 沒有這個工具）')],
    [tdb('現場（廠商）'), td('日誌零輸入（複製昨日、常用班組機具自學、依座標帶入當日天氣）；工地照片批次辨識，逐張產說明並配到工項；估驗數量從日誌累計帶出'), tdb('確認、送出')],
    [tdb('品管'), td('自主檢查表依契約規範生成；缺失照片產描述草稿；混凝土試體齡期到期提醒'), tdb('判定合格與否')],
    [tdb('監造'), td('送審文件逐項比對契約規範，出審查要點與意見草稿；RFI 回覆草稿；施工月報草稿'), tdb('審定、核備')],
    [tdb('機關'), td('佐證鏈逐工項對帳；稽核意見草稿；法定期限倒數與逾期違約金試算；跨案總覽'), tdb('核定、驗收、結案')],
  ]
  table(s, M, y + 0.15, CW, rows, [1.55, 7.2, 3.343], { size: 11.5, pad: 18 })
  s.addText('加一個角色＝加一份人格設定與工具白名單，不是另外做一套系統。', {
    x: M, y: 5.95, w: CW, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 11, color: C.ink3,
  })
}

// ── 07 佐證鏈 ──────────────────────────────────────────────────────────────
{
  const s = slide('第一幕 · 產品')
  const y = head(s, '第一幕 · 機關最有感的一頁', '佐證鏈：逐工項把四份文件對起來。')
  const after = chain(s, y + 0.1, [
    ['CLAIM', '估驗數量'], ['LOG', '日誌累計'], ['INSPECT', '查驗紀錄'],
    ['TEST', '試體強度'], ['PHOTO', '現場照片'],
  ])
  const cw = (CW - 0.42) / 2
  card(s, M, after + 0.38, cw, 2.55)
  s.addText('六項對帳，全部是程式算的', {
    x: M + 0.24, y: after + 0.52, w: cw - 0.48, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 14.5, bold: true, color: C.ink,
  })
  bullets(s, M + 0.24, after + 0.92, cw - 0.48, 1.8, [
    '本期估驗量超過日誌累計量',
    '混凝土澆置日沒有對應試體',
    '估驗的工項沒有查驗紀錄',
    '品質缺失未結案就進入計價',
    '照片沒有對應到任何工項',
    '變更設計未核准就計價',
  ], 'dash', 11.5)

  cardText(s, M + cw + 0.42, after + 0.38, cw, 2.55, '判定確定性，AI 只寫文字',
    '哪裡對不上，是資料庫算出來的，數字永遠可回溯。\n\nAI 的工作只有一件：把對不上的地方寫成一段人看得懂的稽核意見草稿——而且只建議查證，不寫剔除、補強、停工、罰款。',
    { fill: C.safetyTint, flat: true, titleSize: 14.5, bodySize: 11.5, bodyColor: C.ink2 })
}

// ── 08 AI 模組 ─────────────────────────────────────────────────────────────
{
  const s = slide('第一幕 · 產品')
  const y = head(s, '第一幕 · AI 模組', '十六個 AI 模組，每一個都可以單獨關掉。')
  const cw = (CW - 0.3 * 3) / 4
  const groups = [
    ['對話', ['AI Agent 主控台', 'AI 問答助理']],
    ['讀文件', ['契約解析（時程／罰則）', '規範需求抽取', '送審文件讀取']],
    ['產草稿', ['監造送審審查意見', 'RFI 回覆草稿', '機關稽核意見草稿', '施工月報草稿', '估驗施工說明草稿']],
    ['看照片 · 介接', ['工程告示板辨識', '缺失照片描述', '施工照片分類', '工安照片判讀', '天氣帶入（中央氣象署）', '每日 agent 早報']],
  ]
  groups.forEach((g, i) => {
    const x = M + i * (cw + 0.3)
    card(s, x, y, cw, 2.5)
    chip(s, x + 0.22, y + 0.18, g[0], 'na')
    bullets(s, x + 0.2, y + 0.62, cw - 0.4, 1.7, g[1], 'dash', 10.5)
  })
  const cw2 = (CW - 0.42) / 2
  cardText(s, M, y + 2.78, cw2, 1.32, '關掉之後，系統照常運作',
    '關閉只是少了草稿，估驗、日誌、查驗、驗收全部照走。若貴校不接受把資料送到境外的模型，十六個模組可以整組關掉。',
    { fill: C.goodTint, flat: true, titleSize: 14, bodySize: 11 })
  cardText(s, M + cw2 + 0.42, y + 2.78, cw2, 1.32, '每一次呼叫都計量',
    '功能、使用者、專案、耗用量與成本逐次入庫，機關看得到自己用了多少、花了多少——這也是後續編列預算的依據。',
    { titleSize: 14, bodySize: 11 })
}

// ── 09 工程狀態 ────────────────────────────────────────────────────────────
{
  const s = slide('第一幕 · 產品')
  const y = head(s, '第一幕 · 工程狀態', '不是原型，是可以放真案的系統。')
  const sw = CW / 4
  const stats = [[36, '功能頁面'], [16, 'AI 模組'], [503, '計算引擎單元測試'], [20, '套資料庫權限測試']]
  stats.forEach((st, i) => stat(s, M + i * sw, y + 0.2, sw, st[0], st[1], i === 2 ? C.steel : C.ink))
  const cw = (CW - 0.42) / 2
  cardText(s, M, y + 1.5, cw, 2.1, '權限不在前端',
    '誰能看、誰能寫、誰能改狀態，全部在資料庫層以資料列權限（RLS）與狀態轉移規則實作，逐角色逐表自動化實測（20 套、六百餘項）。\n\n把前端按鈕藏起來不算安全——這也是工程會一覽表「帳號控管措施」那一列的實質內容。',
    { titleSize: 15, bodySize: 11.5 })
  cardText(s, M + cw + 0.42, y + 1.5, cw, 2.1, '數字由確定性引擎算',
    '金額、數量、期限、逾期違約金由程式計算，503 項單元測試釘住。\n\nAI 只能複述引擎回傳的數字，不准自己乘除，也不准自己編法規條號。',
    { titleSize: 15, bodySize: 11.5 })
}

// ── 10 分隔：第二幕 ────────────────────────────────────────────────────────
divider('第二幕 · 資安', '第 二 幕', '資安怎麼過。', '普級 11 項要求、High 0、日誌六個月——記住這三個數字就夠了。')

// ── 11 歸類 ────────────────────────────────────────────────────────────────
{
  const s = slide('第二幕 · 資安')
  const y = head(s, '第二幕 · 資安', '第一件事是歸類，不是技術。')
  cite(s, M, y, CW, 0.62, '依據',
    '行政院公共工程委員會 112 年 9 月 25 日工程企字第 1120022701 號函檢送之「各類資訊(服務)採購之共通性資通安全基本要求參考一覽表」（普級部分自 113 年 3 月 1 日施行）')
  s.addText(
    [
      { text: '一覽表共 9 張表，依「資料或系統類型」分。', options: { color: C.ink2 } },
      { text: '同一套系統歸到不同的表，普級要求差好幾倍。', options: { bold: true, color: C.safetyText } },
      { text: '本案應歸「雲端微服務（SaaS）套裝型」——這一格由使用單位主動敘明，不要等別人猜。', options: { color: C.ink2 } },
    ],
    { x: M, y: y + 0.76, w: CW, h: 0.42, margin: 0, valign: 'middle', fontFace: F, fontSize: 12.5 },
  )
  const rows = [
    [th('類型'), th('普級新增的硬要求'), th('本案')],
    [tdb('雲端微服務（SaaS）套裝型'), td('帳號控管、資料傳輸屬「◎ 個案評估」；全表共 11 列'), td('本案適用', { bold: true, color: C.good, fill: { color: C.goodTint } })],
    [tdb('SaaS 辦公室生產力工具'), td('多因子認證 ●、帳號控管 ●、資料傳輸 ●、資料分類與標籤 ●、釣魚郵件過濾 ●'), td('排除：不提供郵件、行事曆、雲端硬碟、即時通訊')],
    [tdb('雲端平台（PaaS／IaaS）'), td('平台層控制措施'), td('排除：機關不取得平台資源，僅使用應用服務')],
    [tdb('應用軟體或系統開發服務'), td('附表十全構面 ●、上線前主機弱點掃描 ●、網站弱點掃描 ●、資安維運服務 ●、機關人員教育訓練 ●、SBOM ◎'), td('須排除：機關不委託開發、不取得原始碼、不驗收程式，僅按期訂閱既有服務', { color: C.bad })],
  ]
  table(s, M, y + 1.3, CW, rows, [2.5, 6.0, 3.593], { size: 10.5, pad: 15 })
  s.addText(
    [
      { text: '所以文件用語很重要：', options: { bold: true, color: C.ink } },
      { text: '標的名稱一律寫「雲端訂閱服務」，全案不出現「開發」「客製」「建置」。', options: { color: C.ink2 } },
    ],
    { x: M, y: 6.28, w: CW, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 11.5 },
  )
}

// ── 12 逐項回覆表 ──────────────────────────────────────────────────────────
{
  const s = slide('第二幕 · 資安')
  const y = head(s, '第二幕 · 逐項回覆', 'SaaS 套裝型・普級全部 11 列，逐列已備妥。', { small: true })
  s.addText('●＝建議辦理　　◎＝經機關評估個案有必要時　　－＝不適用　　（圖示定義出自一覽表說明欄）', {
    x: M, y: y - 0.06, w: CW, h: 0.26, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 10, bold: true, color: C.ink3, charSpacing: 0.6,
  })
  const L = (t) => td(t, { align: 'center', bold: true, color: C.ink })
  const S = (t, k) => td(t, { align: 'center', bold: true, color: CHIP[k][1], fill: { color: CHIP[k][0] } })
  const rows = [
    [th('#'), th('項目'), th('普級'), th('我方回覆與佐證'), th('狀態')],
    [td('1', { align: 'center' }), tdb('完善資通安全管理措施（或 ISO 27001）'), L('●'), td('走前者：資通系統防護基準普通級符合性對照表'), S('已備齊', 'ok')],
    [td('2', { align: 'center' }), tdb('隱私資訊管理標準（ISO 27701）'), L('◎'), td('個資極少（姓名／職稱／公務聯絡方式／帳號），以個資委外附約替代'), S('可談', 'na')],
    [td('3', { align: 'center' }), tdb('非大陸地區廠商、非第三地區含陸資'), L('●'), td('非陸資廠商聲明書'), S('待具結', 'wip')],
    [td('4', { align: 'center' }), tdb('帳號控管措施'), L('◎'), td('伺服器端 RBAC ＋ 資料列權限逐表隔離'), S('已具備', 'ok')],
    [td('5', { align: 'center' }), tdb('資料傳輸措施'), L('◎'), td('TLS 1.2 以上，附實測'), S('已具備', 'ok')],
    [td('6', { align: 'center' }), tdb('事件日誌（含 IP 位址）保存，建議至少六個月'), L('●'), td('帳號權限變更、登入、時間、IP、資料存取皆入庫且不可竄改；書面留存政策可直接當附件'), S('已備齊', 'ok')],
    [td('7', { align: 'center' }), tdb('供應商安全 ＋ 產品安全（各擇一）'), L('●'), td('供應商：公開漏洞回報機制（/security ＋ security.txt）；產品：弱點掃描報告 High 0'), S('已備齊', 'ok')],
    [td('8', { align: 'center' }), tdb('廠商通過 CMMC'), L('－'), td('普級不適用'), S('不適用', 'na')],
    [td('9', { align: 'center' }), tdb('未經機關審查同意，不得移至本國以外地區'), L('●'), td('主動送資料落地說明書，請機關審查同意（見下頁）'), S('請機關核', 'wip')],
    [td('10', { align: 'center' }), tdb('存取、備份、備援不得位於大陸地區（含港澳）'), L('●'), td('完全不涉，寫入聲明書'), S('乾淨', 'ok')],
    [td('11', { align: 'center' }), tdb('虛擬主機映像檔安全'), L('◎'), td('本服務為 SaaS，不提供虛擬主機予機關'), S('不適用', 'na')],
  ]
  table(s, M, y + 0.3, CW, rows, [0.42, 3.5, 0.6, 6.223, 1.35], { size: 10, pad: 5 })
}

// ── 13 境外 ────────────────────────────────────────────────────────────────
{
  const s = slide('第二幕 · 資安')
  const y = head(s, '第二幕 · 最關鍵的一題', '境外不是禁止，是「經機關審查同意」。')
  s.addText(
    [
      { text: '一覽表資料安全欄兩條的措辭刻意寫得不一樣——', options: { color: C.ink2 } },
      { text: '這個對比是整件事的關鍵。', options: { bold: true, color: C.safetyText } },
    ],
    { x: M, y, w: CW, h: 0.32, margin: 0, valign: 'middle', fontFace: F, fontSize: 13 },
  )
  const cw = (CW - 0.42) / 2
  const y1 = y + 0.42
  card(s, M, y1, cw, 1.5, { fill: C.steelTint, flat: true })
  chip(s, M + 0.24, y1 + 0.16, '境外', 'na')
  s.addText('「未經機關審查同意，不得將雲端資訊系統或儲存資料移至本國以外地區」', {
    x: M + 0.24, y: y1 + 0.5, w: cw - 0.48, h: 0.5, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 12.5, bold: true, color: C.ink,
  })
  s.addText('→ 經審查同意就可以。要做的不是搬回校內，是備齊材料請機關審查。', {
    x: M + 0.24, y: y1 + 1.02, w: cw - 0.48, h: 0.34, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 11, color: C.ink2,
  })
  card(s, M + cw + 0.42, y1, cw, 1.5, { fill: C.safetyTint, flat: true })
  chip(s, M + cw + 0.66, y1 + 0.16, '大陸地區', 'na')
  s.addText('存取、備份及備援之實體所在地「不得」位於大陸地區（含港澳），且不得跨該等境內傳輸', {
    x: M + cw + 0.66, y: y1 + 0.5, w: cw - 0.48, h: 0.5, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 12.5, bold: true, color: C.ink,
  })
  s.addText('→ 絕對禁止、無例外。本服務完全不涉。', {
    x: M + cw + 0.66, y: y1 + 1.02, w: cw - 0.48, h: 0.34, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 11, color: C.ink2,
  })

  const y2 = y1 + 1.76
  card(s, M, y2, cw, 2.05)
  s.addText('本案的事實', {
    x: M + 0.24, y: y2 + 0.14, w: cw - 0.48, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 14.5, bold: true, color: C.ink,
  })
  bullets(s, M + 0.24, y2 + 0.52, cw - 0.48, 1.4, [
    '資料庫位於日本；日本有完整個資保護法制（APPI）',
    '不涉大陸地區（含港澳），第二條完全乾淨',
    'AI 模組可整組關閉，關閉後不對外送任何內容',
    '傳輸 TLS 1.2 以上、靜態加密；資料可完整匯出',
  ], 'tick', 11.5)
  cardText(s, M + cw + 0.42, y2, cw, 2.05, '可參照的校內先例',
    '貴校自 112 年 12 月 1 日起全校實施 Office 365 A3（電子計算機中心公告），教職員信箱、行事曆與雲端硬碟均位於境外雲端。\n\n想請教貴校當時審查同意的作業方式，我方比照相同規格備妥文件即可。',
    { fill: C.steelTint, flat: true, titleSize: 14.5, bodySize: 11.5 })
}

// ── 14 常見三問 ────────────────────────────────────────────────────────────
{
  const s = slide('第二幕 · 資安')
  const y = head(s, '第二幕 · 常被問到的三題', 'ISO 是「或」，第三方檢測有門檻。')
  const cw = (CW - 0.42 * 2) / 3
  const qs = [
    ['沒有 ISO 27001 可以嗎？', '一覽表原文：「須具備完善資通安全管理措施或通過 CNS 27001 或 ISO 27001 等標準、其他具有同等或以上效果之系統或標準」。關鍵是「或」。本案走前者，提供逐項的符合性對照表為佐證。'],
    ['要不要第三方安全性檢測？', '一覽表說明欄：屬機關核心資通系統，或委託金額達新臺幣一千萬元以上者，機關應自行或另行委託第三方檢測。本案兩者皆不是，不適用；改以我方提供的弱點掃描報告佐證。'],
    ['萬一有一項真的做不到？', '一覽表「供應商及產品安全要求」欄原文開頭即載明：「…提出佐證資料，若無符合條件者提請機關資安長確認風險」。制度設計的出口是風險確認，不是廢標。'],
  ]
  qs.forEach((q, i) => cardText(s, M + i * (cw + 0.42), y + 0.1, cw, 2.6, q[0], q[1], { titleSize: 15, bodySize: 11.5 }))
  card(s, M, y + 3.0, CW, 1.0, { fill: C.steelTint })
  s.addText(
    [
      { text: '另一個結構性事實：', options: { color: C.ink2 } },
      { text: '函文說明一寫明「由機關視個案特性將所列資安事項納入契約辦理」，且圖示 ●＝建議辦理。', options: { bold: true, color: C.ink } },
      { text: '這是「參考」一覽表，機關本就有裁量空間挑合理的子集。', options: { color: C.ink2 } },
    ],
    { x: M + 0.28, y: y + 3.0, w: CW - 0.56, h: 1.0, margin: 0, valign: 'middle', fontFace: F, fontSize: 12.5, lineSpacing: 19 },
  )
}

// ── 15 技術佐證 ────────────────────────────────────────────────────────────
{
  const s = slide('第二幕 · 資安')
  const y = head(s, '第二幕 · 已完成的技術佐證', '能拿出報告的，都已經跑完了。')
  const cw = (CW - 0.42 * 2) / 3
  const items = [
    ['0', '高風險弱點', '弱點掃描報告',
      'OWASP ZAP baseline ＋ AJAX spider，受測標的為正式站。High 0、通過檢測項 60、警告 7 類（均為刻意設計、誤報或資訊性提示，逐項有處置說明）。\n\n另附修補歷程：首次掃描警告 13 類，移轉主機並統一設定安全標頭後複測，7 類根因相同者全部消失（13→7、通過 54→60）。', C.good],
    ['6', '個月日誌留存', '事件日誌',
      '一覽表明文列舉的六類全數入庫：帳號與權限變更、登入名稱、時間、IP 位址、資料存取、重要安全性事件。\n\nIP 由伺服器端解析（前端不得傳入）；紀錄只增不改；無任何自動清除機制；專案刪除亦留痕。', C.steel],
    ['2', '個公開回報入口', '漏洞回報應變機制',
      '公開頁面（不需登入）＋ 依 RFC 9116 的 /.well-known/security.txt，並載明內部應變流程六步與聯絡信箱。\n\n這一項滿足一覽表「供應商安全」的條件之一，不需要第三方檢測團隊。', C.steel],
  ]
  items.forEach((it, i) => {
    const x = M + i * (cw + 0.42)
    card(s, x, y, cw, 3.55)
    stat(s, x + 0.24, y + 0.16, cw - 0.48, it[0], it[1], it[4])
    s.addText(it[2], {
      x: x + 0.24, y: y + 1.12, w: cw - 0.48, h: 0.3, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 14.5, bold: true, color: C.ink,
    })
    fits(it[2], it[3].replace(/\n/g, ''), cw, 1.95, 11)
    s.addText(it[3], {
      x: x + 0.24, y: y + 1.48, w: cw - 0.48, h: 1.95, margin: 0, valign: 'top',
      fontFace: F, fontSize: 11, color: C.ink2, lineSpacing: 15.5,
    })
  })
  s.addText(
    [
      { text: '一句話版本：', options: { color: C.ink3 } },
      { text: '普級 11 項要求、High 0、日誌六個月', options: { bold: true, color: C.ink } },
      { text: '——記住這三個數字就夠了。', options: { color: C.ink3 } },
    ],
    { x: M, y: y + 3.75, w: CW, h: 0.3, margin: 0, valign: 'middle', fontFace: F, fontSize: 12 },
  )
}

// ── 16 三條紅線 ────────────────────────────────────────────────────────────
{
  const s = slide('第二幕 · 資安')
  const y = head(s, '第二幕 · AI 會不會亂做決定', '三條紅線，寫在架構裡，不是寫在簡報上。')
  const lines = [
    ['紅線 01', 'AI 只產生草稿', '核定、判定、結案、驗收、凍結——Agent 的工具箱裡根本沒有這些工具。這是工具白名單保證的，不是靠提示詞叮嚀它。狀態轉移一律走資料庫層規則加上人簽核。'],
    ['紅線 02', '數字永遠由確定性引擎算', '金額、數量、期限、違約金由程式計算後回傳給 AI 複述。AI 不准自己乘除，也不准自己編法規條號——引用不到來源時，它必須寫「依適用條文與現場量測辦理」。'],
    ['紅線 03', '每個 Agent 動作都留痕', '角色、動作種類、目標、理由、引用佐證、人的覆核結果，逐筆入庫可匯出。稽核問「這個數字誰算的」，答案永遠是：程式，而且有紀錄。'],
  ]
  lines.forEach((l, i) => {
    const yy = y + i * 1.15
    // 這條橘線是「紅線」本身的具象化,不是裝飾用的色條
    s.addShape(pres.ShapeType.rect, { x: M, y: yy + 0.06, w: 0.045, h: 0.92, fill: { color: C.safety }, line: { color: C.safety } })
    s.addText(l[0], {
      x: M + 0.28, y: yy, w: 3, h: 0.24, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 9.5, bold: true, charSpacing: 2, color: C.safetyText,
    })
    s.addText(l[1], {
      x: M + 0.28, y: yy + 0.24, w: 5, h: 0.3, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 15, bold: true, color: C.ink,
    })
    s.addText(l[2], {
      x: M + 0.28, y: yy + 0.56, w: CW - 0.4, h: 0.46, margin: 0, valign: 'top',
      fontFace: F, fontSize: 11.5, color: C.ink2, lineSpacing: 16,
    })
  })
  card(s, M, y + 3.6, CW, 0.95, { fill: C.safetyTint })
  s.addText(
    [
      { text: '加上第四條：每個 AI 功能都是可獨立開關的模組。', options: { bold: true, color: C.ink } },
      { text: '　十六個模組逐一可關，關閉時系統照常運作。機關不必在「要 AI」和「不要 AI」之間二選一。', options: { color: C.ink2 } },
    ],
    { x: M + 0.28, y: y + 3.6, w: CW - 0.56, h: 0.95, margin: 0, valign: 'middle', fontFace: F, fontSize: 12.5, lineSpacing: 19 },
  )
}

// ── 17 個資 ────────────────────────────────────────────────────────────────
{
  const s = slide('第二幕 · 資安')
  const y = head(s, '第二幕 · 個資委外', '個資這層是契約題，不是技術題。')
  cite(s, M, y, CW, 0.62, '個人資料保護法施行細則第 8 條',
    '公務機關委託他人蒐集、處理或利用個人資料者，應對受託者為適當之監督，並明確約定監督事項及方式。')
  const cw = (CW - 0.42) / 2
  const y1 = y + 0.86
  card(s, M, y1, cw, 2.5)
  s.addText(
    [
      { text: '本服務涉及的個資範圍很窄：', options: { color: C.ink2 } },
      { text: '姓名、職稱、單位、公務聯絡方式、系統帳號', options: { bold: true, color: C.ink } },
      { text: '——不涉特種個資、不涉學籍或健康資料，也不以機關資料訓練模型。', options: { color: C.ink2 } },
    ],
    { x: M + 0.24, y: y1 + 0.18, w: cw - 0.48, h: 0.8, margin: 0, valign: 'top', fontFace: F, fontSize: 12, lineSpacing: 17 },
  )
  s.addText(
    [
      { text: '貴校的個資制度建在教育部「教育體系資通安全暨個人資料管理規範」上，委外附約通常照該規範 B.12.1.2 的八要項撰寫，境外傳輸則對應 B.11.1.1 的五條。', options: { color: C.ink2 } },
      { text: '我方直接照那些條目先寫好附約草案，法制單位不必起草。', options: { bold: true, color: C.ink } },
    ],
    { x: M + 0.24, y: y1 + 1.05, w: cw - 0.48, h: 1.3, margin: 0, valign: 'top', fontFace: F, fontSize: 11.5, lineSpacing: 16.5 },
  )
  card(s, M + cw + 0.42, y1, cw, 2.5, { fill: C.steelTint, flat: true })
  s.addText('附約會寫進去的事', {
    x: M + cw + 0.66, y: y1 + 0.16, w: cw - 0.48, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 14.5, bold: true, color: C.ink,
  })
  bullets(s, M + cw + 0.66, y1 + 0.56, cw - 0.48, 1.8, [
    '蒐集處理利用之範圍、類別、目的與期間',
    '保密義務與事故責任',
    '機關保有稽核權（含實地稽核）',
    '再委外（分包）之限制',
    '資安事故之通知義務與時限',
    '契約終止時資料返還、刪除與銷毀切結',
  ], 'dash', 11.5)
  s.addText('補充：個資法第 21 條（國際傳輸限制）規範對象為非公務機關；國立中央大學屬公務機關，故境外傳輸並無法定禁令，而是回到前頁的「機關審查同意」與本頁的契約約定。', {
    x: M, y: y1 + 2.66, w: CW, h: 0.36, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 11, color: C.ink3,
  })
}

// ── 18 分隔：第三幕 ────────────────────────────────────────────────────────
divider('第三幕 · 簽辦', '第 三 幕', '簽辦要引哪些規範。', '採購方式法源、簽稿七段骨架、七份附件、會辦動線。')

// ── 19 採購法源 ────────────────────────────────────────────────────────────
{
  const s = slide('第三幕 · 簽辦')
  const y = head(s, '第三幕 · 簽辦', '採購方式：小額採購逕洽，法源三條。')
  cite(s, M, y, CW, 0.5, '政府採購法第 3 條', '公立學校辦理採購，依本法之規定。')
  cite(s, M, y + 0.62, CW, 0.72, '工程會 111 年 12 月 23 日工程企字第 1110100798 號令',
    '自 112 年 1 月 1 日起，公告金額為新臺幣 150 萬元；中央機關小額採購金額為新臺幣 15 萬元以下。')
  cite(s, M, y + 1.46, CW, 0.72, '中央機關未達公告金額採購招標辦法第 5 條',
    '公告金額十分之一以下採購之招標，得不經公告程序，逕洽廠商採購，免提供報價或企劃書。')
  const cw = (CW - 0.34 * 2) / 3
  const cards = [
    ['本案規劃', '總價壓在 15 萬元以下，以單一在建工程案為試辦標的，走小額採購逕洽。正式估價單另送。', C.goodTint],
    ['不需要做的事', '未逾 15 萬，無採購法第 49 條公開取得三家書面報價之適用；經確認貴校對 15 萬以下亦無加嚴規定。', null],
    ['財產登記', '純訂閱服務，機關未取得軟硬體所有權，不涉財產登記——簽裡直接寫明可省一段流程。', null],
  ]
  cards.forEach((c, i) => cardText(s, M + i * (cw + 0.34), y + 2.42, cw, 1.5, c[0], c[1],
    { fill: c[2], flat: !!c[2], titleSize: 14.5, bodySize: 11.5 }))
  card(s, M, y + 4.1, CW, 0.72, { fill: C.safetyTint })
  s.addText('我們不建議、也不配合為了規避公開招標而分批辦理。試辦範圍就是一個案子；需求擴大時，走上一級的程序。', {
    x: M + 0.28, y: y + 4.1, w: CW - 0.56, h: 0.72, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 12, color: C.ink,
  })
}

// ── 20 簽稿七段 ────────────────────────────────────────────────────────────
{
  const s = slide('第三幕 · 簽辦')
  const y = head(s, '第三幕 · 簽稿骨架', '七段說明，每一段都有對應的法源。', { small: true })
  const rows = [
    [th('段'), th('寫什麼'), th('法源／依據')],
    [td('一', { align: 'center', bold: true }), tdb('需求緣由'), td('現行以紙本與 Excel 彙整進度、估驗、日誌與查驗紀錄，人工重複登打、佐證散落；以某工程為試辦標的，載明服務期間')],
    [td('二', { align: 'center', bold: true }), tdb('採購方式之依據'), td('採購法 §3 ／ 工程會 111 年令（15 萬）／ 未達公告金額招標辦法 §5 逕洽 ／ 敘明無 §49 適用')],
    [td('三', { align: 'center', bold: true }), tdb('資安要求之依據及辦理情形'), td('工程會 112/9/25 工程企字第 1120022701 號函；敘明歸屬「SaaS 套裝型」及排除理由；系統防護需求等級評估為普級，請計網中心卓核；廠商逐項回覆詳附件二')],
    [td('四', { align: 'center', bold: true }), tdb('境外資料之審查同意'), td('一覽表資料安全欄；資料庫位於日本（非大陸地區），廠商提出落地說明（附件四），請計網中心審查，經同意後於契約載明')],
    [td('五', { align: 'center', bold: true }), tdb('個人資料委外'), td('個資法施行細則 §8；契約附個資委外處理附約（附件五）')],
    [td('六', { align: 'center', bold: true }), tdb('資安經費'), td('「資訊服務採購作業指引」一、(一)2 要求估算並單獨計列；本案為標準訂閱服務，資安措施已內含於訂閱費用無法拆分，敘明原因')],
    [td('七', { align: 'center', bold: true }), tdb('履約與驗收'), td('由本組指定人員驗收，以服務可用性及約定功能項目為驗收標準；不涉財產登記')],
  ]
  table(s, M, y + 0.15, CW, rows, [0.55, 2.6, 8.943], { size: 10.5, pad: 9 })
  s.addText(
    [
      { text: '擬辦：', options: { bold: true, color: C.ink } },
      { text: '一、同意依上開方式辦理小額採購並簽訂服務契約。二、', options: { color: C.ink2 } },
      { text: '會辦電子計算機中心', options: { bold: true, color: C.safetyText } },
      { text: '（第三、四點）。三、會辦個資業務單位／法制（第五點）。四、奉核後續辦請購。', options: { color: C.ink2 } },
    ],
    { x: M, y: 5.85, w: CW, h: 0.34, margin: 0, valign: 'middle', fontFace: F, fontSize: 11.5 },
  )
  s.addText('以上為廠商整理的參考骨架與法源清單，實際簽稿文字仍由貴組承辦人依校內格式撰擬。', {
    x: M, y: 6.24, w: CW, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 10.5, color: C.ink3,
  })
}

// ── 21 附件 ────────────────────────────────────────────────────────────────
{
  const s = slide('第三幕 · 簽辦')
  const y = head(s, '第三幕 · 附件', '七份附件，六份在我這邊。')
  const S = (t, k) => td(t, { align: 'center', bold: true, color: CHIP[k][1], fill: { color: CHIP[k][0] } })
  const rows = [
    [th('附件'), th('文件'), th('用途'), th('狀態')],
    [td('一', { align: 'center', bold: true }), tdb('廠商估價單'), td('金額與服務期間'), S('商業登記核准後即送', 'wip')],
    [td('二', { align: 'center', bold: true }), tdb('資安要求逐項回覆表'), td('SaaS 套裝型・普級 11 列（本簡報 P12）'), S('已定稿', 'ok')],
    [td('三', { align: 'center', bold: true }), tdb('非陸資廠商聲明書'), td('對應第 3、10 列'), S('具結中', 'wip')],
    [td('四', { align: 'center', bold: true }), tdb('資料落地與境外傳輸說明書'), td('供計網中心審查同意（第 9 列）'), S('材料齊備', 'ok')],
    [td('五', { align: 'center', bold: true }), tdb('個人資料委外處理附約（草案）'), td('個資法施行細則 §8'), S('草案可提供', 'ok')],
    [td('六', { align: 'center', bold: true }), tdb('服務條款與隱私權政策'), td('含個資申訴窗口'), S('整理中', 'wip')],
    [td('七', { align: 'center', bold: true }), tdb('資通系統防護基準普通級符合性對照表'), td('對應第 1 列（走「完善資通安全管理措施」）'), S('已完成', 'ok')],
  ]
  table(s, M, y + 0.15, CW, rows, [0.7, 4.0, 5.2, 2.193], { size: 11, pad: 9 })
  card(s, M, y + 4.0, CW, 0.9, { fill: C.safetyTint })
  s.addText(
    [
      { text: '唯一會卡住整案的是附件一。', options: { bold: true, color: C.ink } },
      { text: '　本公司商業登記正在辦理中，核准後統一編號、商業登記證明與估價單會一併送達。其餘六份不受影響，可先行提供貴組與計網中心預覽。', options: { color: C.ink2 } },
    ],
    { x: M + 0.28, y: y + 4.0, w: CW - 0.56, h: 0.9, margin: 0, valign: 'middle', fontFace: F, fontSize: 12, lineSpacing: 18 },
  )
}

// ── 22 會辦動線 ────────────────────────────────────────────────────────────
{
  const s = slide('第三幕 · 簽辦')
  const y = head(s, '第三幕 · 動線', '資訊類採購會會辦計網中心，所以文件要一次到位。', { small: true })
  const after = chain(s, y + 0.2, [
    ['使用單位', '營繕組擬簽'], ['會辦 · 資安', '電子計算機中心'], ['會辦 · 個資', '個資／法制單位'],
    ['核定', '權責長官'], ['續辦', '請購 · 簽約'],
  ], 1)
  const cw = (CW - 0.42) / 2
  cardText(s, M, after + 0.5, cw, 2.2, '關鍵推論',
    '會辦是必然，所以簽送出去的那一刻，資安文件就必須完整——不能先簽再補，一退件就是一輪時間。\n\n附件二、三、四、七要一次到位，讓會辦是「核對」而不是「索資」。',
    { fill: C.safetyTint, flat: true, titleSize: 15, bodySize: 12 })
  cardText(s, M + cw + 0.42, after + 0.5, cw, 2.2, '想請組長幫的一件事',
    '與其等會辦時計網中心來要資料，想在正式送簽前先與他們對一次要求。若他們有自己的委外資安檢核表，我照他們的表逐欄對映，不另編一份。\n\n方便請組長幫忙引薦窗口嗎？',
    { fill: C.steelTint, flat: true, titleSize: 15, bodySize: 12 })
  s.addNotes('這頁講完直接問引薦。這是今天最重要的一個 ask。')
}

// ── 23 下一步 ──────────────────────────────────────────────────────────────
{
  const s = slide('結尾', { dark: true })
  s.addText('下一步', {
    x: M, y: 0.75, w: CW, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 11, bold: true, charSpacing: 2.4, color: C.safety,
  })
  s.addText('給我一個案子。\n四週後您自己判斷。', {
    x: M, y: 1.2, w: CW * 0.55, h: 1.7, margin: 0, valign: 'top',
    fontFace: F, fontSize: 38, bold: true, color: C.darkInk, lineSpacing: 50,
  })
  s.addText('試辦範圍就是一個進行中的工程案。四週後如果承辦人不想繼續用，我們把資料完整匯出給貴組，就結束。', {
    x: M, y: 3.1, w: CW * 0.52, h: 0.8, margin: 0, valign: 'top',
    fontFace: F, fontSize: 14, color: C.darkInk2, lineSpacing: 22,
  })
  s.addText('貴組需要投入的', {
    x: M, y: 4.05, w: CW * 0.52, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 13, bold: true, color: C.darkInk,
  })
  const invest = ['一位承辦人，每週約一小時', '一個進行中的案子（契約＋標單）', '廠商與監造各一位聯絡人']
  invest.forEach((t, i) => {
    s.addText('—', { x: M, y: 4.42 + i * 0.3, w: 0.22, h: 0.28, margin: 0, valign: 'middle', fontFace: F, fontSize: 8, bold: true, color: C.safety })
    s.addText(t, { x: M + 0.22, y: 4.42 + i * 0.3, w: CW * 0.5, h: 0.28, margin: 0, valign: 'middle', fontFace: F, fontSize: 12.5, color: C.darkInk2 })
  })

  const bx = M + CW * 0.58
  const bw = CW * 0.42
  s.addShape(pres.ShapeType.roundRect, {
    x: bx, y: 1.2, w: bw, h: 4.1, rectRadius: 0.04,
    fill: { color: '1B2833' }, line: { color: '2C3D4C', width: 1 },
  })
  s.addText('今天想請教的四件事', {
    x: bx + 0.32, y: 1.48, w: bw - 0.64, h: 0.34, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 16, bold: true, color: C.darkInk,
  })
  const asks = [
    ['經費來源', '是校務基金、計畫項下，還是單位自籌？'],
    ['需不需要壓在本年度 12/31 前', '驗收結案？'],
    ['這個金額的核定層級', '到哪一級？'],
    ['能否幫我引薦計網中心', '，送簽前先對一次資安要求？'],
  ]
  asks.forEach((a, i) => {
    const yy = 2.02 + i * 0.62
    s.addText(String(i + 1), {
      x: bx + 0.32, y: yy, w: 0.3, h: 0.3, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 12, bold: true, color: C.safety,
    })
    s.addText(
      [{ text: a[0], options: { bold: true, color: 'FFFFFF' } }, { text: a[1], options: { color: C.darkInk2 } }],
      { x: bx + 0.66, y: yy, w: bw - 1.0, h: 0.5, margin: 0, valign: 'top', fontFace: F, fontSize: 12.5, lineSpacing: 17 },
    )
  })
  s.addText('最後一題最重要——它決定這個簽會不會被退件。', {
    x: bx + 0.32, y: 4.68, w: bw - 0.64, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 11, color: C.safety,
  })
  s.addNotes('收尾一定要問到這四題。第四題（引薦計網中心）價值最高。')
}

const OUT = process.argv[2] || 'deck.pptx'
pres.writeFile({ fileName: OUT }).then(() => {
  console.log(`寫出 ${OUT}，共 ${PAGE} 頁`)
  if (WARN.length) { console.log('\n⚠️ 可能爆框：'); WARN.forEach((w) => console.log('  ' + w)) }
  else console.log('文字量估算：全數在框內')
})
