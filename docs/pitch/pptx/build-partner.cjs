// 合作簡報 PowerPoint 產生器 —— 對象：建築師事務所／工程顧問公司
// ---------------------------------------------------------------------------
// 這份跟 build.js（給機關組長的簽辦版）是完全不同的說服對象，不要互相抄文案：
//   組長版  = 我要把東西賣進你的機關，重點在採購歸類與資安過關。
//   本檔    = 我要跟你「一起做」，重點在你自己用得到什麼、我們一起接案各出什麼。
//
// 使用者已指定合作主軸只有三條（沒有「通路引薦抽成」那條，不要加回去）：
//   甲 你們自己當使用者（監造／PCM 導入）
//   乙 共同投標／技術合作（一起接案）
//   丙 領域知識合作（你們出 know-how，我方出系統）
//
// 兩條講話紅線（沿用組長版，理由見 README）：
//   1) 講到機關採購時，標的一律「雲端訂閱服務（SaaS）」，不出現「開發／客製／建置」。
//      ⚠️ 但 P20、P22 在講「我們兩家之間」的技術合作，那裡出現開發是正確的——
//         工程會一覽表管的是「機關買什麼」，不是「兩家民間公司怎麼分工」。
//   2) 不寫死價格與時程。
//
// 數字全部在 2026-08-19 當日重跑核對，出處寫在各頁註腳；改版前請重跑，不要沿用。
//
// 重建：
//   npm i pptxgenjs --no-save --os=darwin --cpu=arm64
//   node docs/pitch/pptx/build-partner.cjs raw.pptx
//   python3 docs/pitch/pptx/fix_ea.py raw.pptx docs/pitch/PMIS-ai-合作簡報-事務所顧問公司-2026-08-19.pptx
//   python3 docs/pitch/pptx/check_fit.py docs/pitch/PMIS-ai-合作簡報-事務所顧問公司-2026-08-19.pptx

const path = require('path')
const { createKit } = require('./deck.cjs')

// 預設是**銷售版 19 頁**:只留「你的痛 → 產品畫面 → 為什麼信得過 → 怎麼開始」。
// 加 --full 會補回 9 頁背景說明(幕別、北極星定位、資料脊椎、AI 模組表、技術現況數字、
// 機關端趨勢、誠實頁)共 28 頁——那是給「已經有興趣、要深談或要寄出去自己看」的場合。
// ⚠️ 使用者明確要求銷售版不要講這些,不要把它們改回預設。
const FULL = process.argv.includes('--full')
const SEC = FULL
  ? { sys: '壹 · 系統', biz: '貳 · 一起接案', go: '參 · 開始' }
  : { sys: '產品', biz: '一起接案', go: '怎麼開始' }

const K = createKit({
  total: FULL ? 29 : 20,
  title: 'PMIS.ai — 合作簡報（事務所／工程顧問公司）',
  author: 'PMIS.ai',
})
const { pres, C, F, W, M, CW, TOP, WARN,
  slide, head, card, cardText, chip, bullets, cite, table, chain, stat, shot,
  th, td, tdb, tds } = K

const SHOTS = path.resolve(__dirname, '../shots')
const img = (name) => path.join(SHOTS, `${name}.png`)

// 截圖頁的固定版面：左欄說明、右邊 16:10 畫面。三個以上尺寸會讓翻頁時圖在跳。
const LX = M, LW = 3.55
const IX = M + LW + 0.42, IW = CW - LW - 0.42

// 截圖頁共用：左欄標題 + 條列 + 右邊畫面
function shotSlide(sec, eyebrow, title, lead, points, file, caption) {
  const s = slide(sec)
  head(s, eyebrow, title)
  s.addText(lead, {
    x: LX, y: 1.62, w: LW, h: 0.92, margin: 0, valign: 'top',
    fontFace: F, fontSize: 12.5, color: C.ink2, lineSpacing: 19,
  })
  bullets(s, LX, 2.72, LW, points, 'tick', 10.5)
  shot(s, IX, 1.62, IW, img(file), { caption })
  return s
}

// ═══════════════════════════════════════════════════════════════════════════
// 01 封面
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('封面', { field: true })
  s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: W * 0.35, h: 7.5, fill: { color: C.fieldDeep }, line: { color: C.fieldDeep } })
  s.addText('PMIS', {
    x: 0.9, y: 2.72, w: W * 0.35 - 1.4, h: 0.62, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 40, bold: true, color: C.fieldInk,
  })
  s.addText('.ai', {
    x: 0.9 + 1.36, y: 2.72, w: 1.4, h: 0.62, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 40, bold: true, color: C.safety,
  })
  s.addText('公共工程 AI Agent 平台', {
    x: 0.9, y: 3.42, w: W * 0.35 - 1.4, h: 0.32, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 13, bold: true, charSpacing: 2.2, color: C.fieldInk2,
  })
  s.addText('gov-agent.ai', {
    x: 0.9, y: 4.34, w: W * 0.35 - 1.4, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 12, bold: true, charSpacing: 1.2, color: C.fieldInk2,
  })

  s.addText('合作簡報', {
    x: W * 0.35 + 0.85, y: 2.22, w: 6.6, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 12, bold: true, charSpacing: 3.4, color: C.safety,
  })
  s.addText('監造與專管的每一位工程師，\n配一個讀過本案契約的 Agent。', {
    x: W * 0.35 + 0.85, y: 2.66, w: 7.2, h: 1.5, margin: 0, valign: 'top',
    fontFace: F, fontSize: 30, bold: true, color: C.fieldInk, lineSpacing: 45,
  })
  s.addText('給建築師事務所與工程顧問公司', {
    x: W * 0.35 + 0.85, y: 4.34, w: 7, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 14, color: C.fieldInk2,
  })
  s.addText('2026-08-19', {
    x: W * 0.35 + 0.85, y: 4.76, w: 7, h: 0.28, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 11, charSpacing: 1.2, color: C.fieldInk2,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 02 為什麼是我
// ---------------------------------------------------------------------------
// 這頁擺在封面之後、議程之前:第一次見面對方第一秒想的就是「這人是誰」。
// 三欄刻意對齊產品的三方模型(監造／機關／系統),因為這個人的經歷剛好就是那三方——
// 這比任何一句「我們很懂工程」都有說服力。
//
// ⚠️ 年資的處理:台灣世曦監造 1 年、AI 新創產品經理半年、公務員 4 年。
//    只寫了公務員的 4 年,另外兩段寫職稱不寫年資——不是隱瞞,是不把最短的兩個數字
//    放在最顯眼的位置。對方當面問一定要照實答,所以這頁不能出現任何暗示更久的字眼。
//
// 獎項:使用者當時是**主辦**,所以從第一欄的條列升級成三欄下方的整條橫帶。
//    這是全頁最硬的一個憑證,對工程圈聽眾的份量高於任何學歷,不要再把它降回條列。
//    「擔任主辦的工程獲…」的寫法在機關側或監造側都成立,不必依附某一欄。
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('關於我')
  const y = head(s, '為什麼是我', '這三方，我都待過。')
  const gap = 0.34, cw = (CW - gap * 2) / 3
  const cols = [
    ['監造這一側', '台灣世曦工程顧問｜監造', [
      '查驗、送審、估驗覆核都自己做過',
      '監造報表與缺失追蹤的工時，我自己耗過',
      '土木本科出身，看得懂圖也看得懂標單',
    ], C.safetyText, C.safetyTint],
    ['機關這一側', '公務機關｜4 年', [
      '走過簽辦、審查、發包到驗收的內部流程',
      '知道承辦人真正會被卡在哪一關',
      '也知道機關為什麼對 AI 特別謹慎',
    ], C.steelText, C.steelTint],
    ['系統這一側', 'AI Agent 新創｜產品經理', [
      '這套系統是我自己做的，不是外包',
      '從資料模型到 AI 邊界都自己決定',
      '土木出身，之後補了資工與商管',
    ], C.ink, 'E3E9EF'],
  ]
  cols.forEach(([tag, role, items, col, tint], i) => {
    const x = M + i * (cw + gap)
    card(s, x, y, cw, 2.2)
    s.addText(tag, {
      x: x + 0.24, y: y + 0.2, w: cw - 0.48, h: 0.3, margin: 0, align: 'center', valign: 'middle',
      shape: pres.ShapeType.roundRect, rectRadius: 0.03,
      fill: { color: tint }, line: { color: tint },
      fontFace: F, fontSize: 10, bold: true, charSpacing: 1.6, color: col,
    })
    s.addText(role, {
      x: x + 0.24, y: y + 0.6, w: cw - 0.48, h: 0.4, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 16.5, bold: true, color: C.ink,
    })
    bullets(s, x + 0.24, y + 1.06, cw - 0.48, items, 'dash', 11)
  })

  // 獎項橫帶:整頁唯一用安全橘實色的元素,視線一定先落在這裡
  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: y + 2.36, w: CW, h: 0.62, rectRadius: 0.035,
    fill: { color: C.safetyTint }, line: { color: C.safety, width: 1 },
  })
  s.addText('工程榮譽', {
    x: M + 0.3, y: y + 2.36, w: 1.3, h: 0.62, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 10, bold: true, charSpacing: 1.8, color: C.safetyText,
  })
  s.addText('擔任主辦的工程，獲公共工程金質獎、金品獎', {
    x: M + 1.7, y: y + 2.36, w: CW - 2.0, h: 0.62, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 17, bold: true, color: C.ink,
  })

  cardText(s, M, y + 3.16, CW, 1.28,
    '所以「這個痛點是不是真的」，我不用回去問人。',
    '監造的查驗與送審、機關的簽辦與驗收、系統的資料模型與 AI 邊界——這三件事平常分屬三種人，很少落在同一個人身上。這套系統之所以敢把 AI 鎖在草稿這一側、把判定與簽名留給人，正是因為我知道簽下去的人要承擔什麼。',
    { titleSize: 17, bodySize: 12.5 })

  cite(s, M, y + 4.56, CW, 0.5, '學歷',
    '中央大學土木工程學士　·　交通大學土木工程碩士　·　Georgia Tech 資訊工程碩士（MSCS）　·　UCLA 企業管理碩士（MBA）')
}

// ═══════════════════════════════════════════════════════════════════════════
// 03 一頁講完
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('總覽')
  const y = head(s, '一頁講完', '三種合作，共用同一套系統。')
  const gap = 0.34, cw = (CW - gap * 2) / 3
  const cards = [
    ['甲', '你們自己用', '監造／專管導入',
      '查驗、送審、缺失、估驗覆核、監造報表在同一條資料線上。\n\nAI 只出草稿，判定與核准永遠是貴所的工程師按的。'],
    ['乙', '一起接案', '共同投標／技術合作',
      '你們有機關關係與工程專業，我方有系統與資安合規文件。\n\n組合起來投 PCM／專案管理標案，資訊系統那一段由我方負責。'],
    ['丙', '你們出 know-how', '領域知識合作',
      '真實案件的作業流程、表單與眉角由貴所提供，系統由我方建。\n\n換取優先使用、共同掛名或其他對價——形狀可談。'],
  ]
  const KICKOFF = [
    '挑一個案子，先只用一個功能',
    '下一個要投的標，提早一個月談',
    '一份可去識別化的舊案文件',
  ]
  cards.forEach(([n, t, sub, body], i) => {
    const x = M + i * (cw + gap)
    card(s, x, y, cw, 4.5)
    s.addText(n, {
      x: x + 0.26, y: y + 0.24, w: 0.5, h: 0.5, margin: 0, align: 'center', valign: 'middle',
      shape: pres.ShapeType.roundRect, rectRadius: 0.04,
      fill: { color: C.steelTint }, line: { color: C.steelTint },
      fontFace: F, fontSize: 17, bold: true, color: C.steelText,
    })
    s.addText(t, {
      x: x + 0.26, y: y + 0.92, w: cw - 0.52, h: 0.42, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 20, bold: true, color: C.ink,
    })
    s.addText(sub, {
      x: x + 0.26, y: y + 1.36, w: cw - 0.52, h: 0.28, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 10.5, bold: true, charSpacing: 1.2, color: C.safetyText,
    })
    s.addText(body, {
      x: x + 0.26, y: y + 1.8, w: cw - 0.52, h: 1.8, margin: 0, valign: 'top',
      fontFace: F, fontSize: 11.5, color: C.ink2, lineSpacing: 18,
    })
    s.addShape(pres.ShapeType.line, {
      x: x + 0.26, y: y + 3.68, w: cw - 0.52, h: 0, line: { color: C.rule2, width: 0.75 },
    })
    s.addText('起手式', {
      x: x + 0.26, y: y + 3.8, w: cw - 0.52, h: 0.24, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 9.5, bold: true, charSpacing: 1.6, color: C.ink3,
    })
    s.addText(KICKOFF[i], {
      x: x + 0.26, y: y + 4.06, w: cw - 0.52, h: 0.3, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 12, bold: true, color: C.steelText,
    })
  })
  cite(s, M, y + 4.72, CW, 0.5, '這場會的目的',
    '不是要你今天決定買什麼。是要你看完系統之後，告訴我甲乙丙哪一條對貴所最有意義——或者三條都不是。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 03 幕別：壹（--full 才出現）
// ═══════════════════════════════════════════════════════════════════════════
if (FULL) {
  const s = slide('幕別', { field: true })
  s.addText('壹', {
    x: M, y: 2.5, w: 2.2, h: 1.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 74, bold: true, color: C.safety,
  })
  s.addText('這套系統是什麼。', {
    x: M + 2.3, y: 2.66, w: 9, h: 0.9, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 38, bold: true, color: C.fieldInk,
  })
  s.addText('以下畫面全部是可以現場打開的示範站，資料是示範資料，流程是真的。', {
    x: M + 2.3, y: 3.66, w: 9, h: 0.4, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 14, color: C.fieldInk2,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 04 我們在做什麼（--full 才出現）
// ═══════════════════════════════════════════════════════════════════════════
if (FULL) {
  const s = slide(SEC.sys)
  const y = head(s, '定位', '長期做政府業務的 Agent，現在只做公共工程。')
  cardText(s, M, y, CW, 1.06,
    '終極目標：政府機關的每一位承辦人，都配一個懂他業務、法規與文書格式的 AI Agent。',
    '公共工程是第一個垂直領域，不是終點——工程是政府業務裡最複雜的一種，撐得起工程的骨架，其他業務都是它的子集。',
    { titleSize: 16 })

  const gap = 0.34, cw = (CW - gap * 2) / 3
  const rows = [
    ['平台層', '換成戶政也成立', '多級權限／文件→義務解析／法定期限引擎／佐證鏈／AI 草稿收件匣／稽核留痕', C.steelText],
    ['公共工程領域層', '換成戶政就沒意義', 'PCCES 標單、估驗計價、ITP 三級品管、施工日誌、送審、變更設計、驗收結算', C.safetyText],
    ['介面層', '每個專案方一個 Agent', '廠商 Agent／監造 Agent／機關 Agent——同一份資料，三種視角與三組權限', C.ink],
  ]
  rows.forEach(([t, tag, body, col], i) => {
    const x = M + i * (cw + gap)
    cardText(s, x, y + 1.3, cw, 1.98, t, body, { titleColor: col, titleSize: 15, bodySize: 11 })
    s.addText(tag, {
      x: x + 0.24, y: y + 1.3 + 1.62, w: cw - 0.48, h: 0.26, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 9.5, bold: true, charSpacing: 1.2, color: C.ink3,
    })
  })

  cardText(s, M, y + 3.52, CW, 1.18,
    '現階段界線：只做公共工程。',
    '平台層的命名與資料模型保持業務中立，但不為假想的未來業務寫抽象層、外掛機制或 DSL。過早抽象比重寫更貴——這一點會直接影響貴所評估「這家公司會不會做到一半跑去做別的」。',
    { titleSize: 15 })
  cite(s, M, y + 4.78, CW, 0.44, '命名',
    '產品與介面名稱為 PMIS.ai，網域目前是 gov-agent.ai——網域晚一步跟上，內容完全相同。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 05 痛點
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide(SEC.sys)
  const y = head(s, '問題', '資料不是沒有，是同一件事被記在四個地方。')
  const gap = 0.3, cw = (CW - gap * 3) / 4
  const src = [
    ['LINE 群組', '現場照片、口頭指示、臨時協調——找得到的當下有用，三個月後查不回來。'],
    ['Excel', '估驗表、缺失追蹤表、進度表各一份，版本靠檔名，改了不會互相通知。'],
    ['紙本／PDF', '契約、規範、施工計畫、查驗表。期限藏在條文裡，沒有人再讀第二次。'],
    ['信箱', '送審往返與退回補正。審了幾次、上次退什麼理由，要往回翻信。'],
  ]
  src.forEach(([t, b], i) => {
    cardText(s, M + i * (cw + gap), y, cw, 1.7, t, b, { titleSize: 14, bodySize: 10.5 })
  })

  cardText(s, M, y + 1.94, CW, 1.5,
    '結果不是「資料遺失」，是「對不起來」。',
    '估驗報的數量，對不上施工日誌的完成量；缺失結案了，但佐證照片在誰的手機裡沒人知道；監造報表每個月重打一次，因為來源資料本來就不在同一個地方。這些是機關驗收與稽核最愛問、也最花貴所人力回答的問題。',
    { titleSize: 15.5, bodySize: 11.5 })

  bullets(s, M, y + 3.68, CW, [
    '貴所賣的是專業判斷，不是把同一筆數字抄到第四個檔案裡的工時',
    '同一批人力，能接的案量取決於「行政重工」佔掉多少小時',
    '機關近年要的佐證越來越完整——缺的不是能力，是把既有紀錄串起來的工具',
  ], 'dash', 12.5)
}

// ═══════════════════════════════════════════════════════════════════════════
// 06 兩條資料脊椎（--full 才出現）
// ═══════════════════════════════════════════════════════════════════════════
if (FULL) {
  const s = slide(SEC.sys)
  const y = head(s, '架構', '兩條資料脊椎，一次輸入，全線可查。')

  s.addText('工程數量與財務', {
    x: M, y: y + 0.02, w: 4, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 11, bold: true, charSpacing: 1.8, color: C.steelText,
  })
  chain(s, y + 0.4, [
    ['PCCES', '標單工項'], ['每日', '施工日誌'], ['每期', '估驗計價'], ['請款', '收款與 S 曲線'],
  ])

  s.addText('文件與履約要求', {
    x: M, y: y + 1.72, w: 4, h: 0.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 11, bold: true, charSpacing: 1.8, color: C.steelText,
  })
  chain(s, y + 2.1, [
    ['上傳', '契約與規範'], ['AI', '抽出履約要求'], ['人工', '核定才生效'], ['引擎', '期限與提醒'],
  ], 1)

  cardText(s, M, y + 3.44, CW * 0.485, 1.5,
    '所有數量都掛在同一個工項 ID 上',
    '日誌填的數量、估驗報的數量、查驗的工項、試體的取樣，全部沿 work_item_id 串。所以系統可以確定性地回答「這期估驗有沒有超前日誌」——不是 AI 猜的，是對帳算出來的。',
    { titleSize: 14, bodySize: 11 })
  cardText(s, M + CW * 0.515, y + 3.44, CW * 0.485, 1.5,
    '只有人核定過的要求才算數',
    'AI 從契約抽出的期限與罰則是「建議」，停在待審清單裡。監造或機關核定之後，才會在同一筆交易裡產生一項會到期、會提醒、會計罰的義務。沒核定的東西不會變成任何人的待辦。',
    { titleSize: 14, bodySize: 11 })
}

// ═══════════════════════════════════════════════════════════════════════════
// 07–14 產品畫面
// ═══════════════════════════════════════════════════════════════════════════
shotSlide(SEC.sys, '導覽', '六個工作面，不是二十二個選單。',
  '側欄只有六格：今日待辦、現場與品質、審查與協作、進度與金流、文件與結案、專案。子頁收在工作面底下，需要時再展開。',
  ['以「一天要處理什麼」分組，不以資料表分組', '同一套階層在手機抽屜完全一致', '權限不足的頁面不會出現在側欄，也進不去'],
  'sv-nav', '示範站畫面（示範資料）｜監造身分')

shotSlide(SEC.sys, '首頁', '打開系統的第一眼：現在輪到誰。',
  '不放統計圖表，只放三段：現在輪到我、等待對方、今天已完成。每一筆都標明還有幾天或逾期幾天。',
  ['待辦由既有業務狀態推導，不是另一張待辦表', 'AI 草稿與未核定建議結構上進不了待辦', '逾期天數用台北日曆日判斷，傍晚開頁不會少算'],
  'sv-dashboard', '示範站畫面（示範資料）｜監造身分')

shotSlide(SEC.sys, '契約', '契約裡的期限與罰則，被抽出來會自己到期。',
  '整包契約與規範一次上傳，系統抽出履約要求；人工核定後進入義務時程，到期自動出現在提醒與待辦。',
  ['每一條都保留出處：契約第幾條、第幾頁', '罰則原文一併帶出（例：逾期每日 0.5‰）', '完成時可掛佐證，例如以核准的 SUB-001 品質計畫結案'],
  'sv-contract', '示範站畫面（示範資料）｜監造身分')

shotSlide(SEC.sys, 'Agent', 'Agent 做草稿，人做決定。',
  '左邊問本案問題、答案附出處連結；右邊是 AI 草稿收件匣——日誌草稿、查驗表草稿都要人接受或拒絕才會生效。',
  ['照片可擬出日誌與自主檢查表草稿，實測值一律留空給人填', '每筆草稿都能展開「為什麼這樣擬」', '接受／拒絕都寫進稽核紀錄'],
  'sv-agent', '示範站畫面（示範資料）｜監造身分。示範站無後端，答案走離線確定性引擎')

shotSlide(SEC.sys, '品質', '查驗到缺失到結案，是一條鎖住的鏈。',
  '查驗申請 → 監造查驗 → 不合格開缺失 → 廠商改善 → 監造複查結案。已結案不可刪除，撤銷結案要附原因並留存稽核。',
  ['自主檢查表不合格會自動開缺失，且一組試體只開一筆', '缺失逾期未結案會進機關端的風險稽核', '缺失清單可直接匯出 CSV'],
  'sv-quality', '示範站畫面（示範資料）｜監造身分')

shotSlide(SEC.sys, 'ITP', '停留點沒叫驗就繼續施作，系統會亮紅。',
  'H（停留點，未查驗不得續作）、W（見證點）、R（文審點）各自追蹤，來源可回溯到品質計畫或施工規範的條號。',
  ['H 點未申請查驗但工項已在施作 → 直接示警並進提醒中心', '每個停留點記標準、頻率與出處（例：規範 03310）', '之後可由 AI 從上傳規範自動擬停留點，監造審核後生效'],
  'sv-itp', '示範站畫面（示範資料）｜監造身分')

shotSlide(SEC.sys, '送審', '送審往返有版次，退回理由留在案上。',
  '施工提送 → 監造受理審核 → 核准／核備／退回補正；退回後廠商修正再送，版次自動加一，前一次的審查意見留在同一串。',
  ['「AI 審查助手」逐項比對契約需求並擬審查意見草稿', '意見只引用本案已核定的需求，不自行編造法規條號', '判定仍由監造按，AI 沒有核准這個動作'],
  'sv-submittals', '示範站畫面（示範資料）｜監造身分')

shotSlide(SEC.sys, '估驗', '估驗金額由引擎算，三方看同一份明細。',
  '逐工項累計完成數量 → 本期金額、保留款、本期應付全部由確定性程式計算；廠商提送、監造核定、機關付款走同一份資料。',
  ['變更後契約金額自動反映已核准的追加減', '可一鍵組請款佐證包（本期明細＋施工說明＋佐證照片）', '估驗超前日誌完成量會被勾稽出來，不必等機關發現'],
  'sv-valuation', '示範站畫面（示範資料）｜監造身分')

shotSlide(SEC.sys, '機關端', '機關看得到的，貴所最好先看得到。',
  '機關端有跨案總覽與風險稽核：逐工項把估驗、日誌、查驗、試體對起來，標出值得複查的異常。',
  ['六項確定性對帳（例：估驗超前日誌逾 5%）', '判定是算出來的，AI 只負責把它寫成人看得懂的意見', '這頁是機關防弊工具——貴所提前自查，等於少一輪被退'],
  'ow-audit', '示範站畫面（示範資料）｜機關身分')

// ═══════════════════════════════════════════════════════════════════════════
// 15 三條紅線
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide(SEC.sys)
  const y = head(s, '邊界', '三條紅線，寫在架構裡，不是寫在簡報上。')
  const gap = 0.34, cw = (CW - gap * 2) / 3
  const lines = [
    ['一', 'AI 只產生草稿', '核定、判定、結案、驗收、凍結——agent 的工具箱裡根本沒有這些工具。靠工具白名單保證，不是靠 prompt 約束。狀態轉移一律走資料庫 trigger 加人簽核。'],
    ['二', '數字由確定性引擎算', 'AI 可以複述金額，但金額必須由計價程式算出、經工具回傳。AI 不准自己乘除，不准自己編法規條號。'],
    ['三', '每個動作都留痕', '角色、種類、目標、理由、佐證、人的覆核結果全部寫進稽核表。機關要查「這個判定是誰按的、依據什麼」，答得出來。'],
  ]
  lines.forEach(([n, t, b], i) => {
    const x = M + i * (cw + gap)
    card(s, x, y, cw, 2.5)
    s.addText(n, {
      x: x + 0.26, y: y + 0.24, w: 0.44, h: 0.44, margin: 0, align: 'center', valign: 'middle',
      shape: pres.ShapeType.roundRect, rectRadius: 0.04,
      fill: { color: C.badTint }, line: { color: C.badTint },
      fontFace: F, fontSize: 15, bold: true, color: C.bad,
    })
    s.addText(t, {
      x: x + 0.26, y: y + 0.82, w: cw - 0.52, h: 0.36, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 16, bold: true, color: C.ink,
    })
    s.addText(b, {
      x: x + 0.26, y: y + 1.24, w: cw - 0.52, h: 1.1, margin: 0, valign: 'top',
      fontFace: F, fontSize: 11, color: C.ink2, lineSpacing: 16,
    })
  })

  cardText(s, M, y + 2.74, CW, 1.34,
    '為什麼要跟顧問公司特別講這三條',
    '監造的簽名是有責任的。任何「AI 幫你判定合格」的產品，貴所都不能用——出事的時候簽名的是貴所的技師，不是模型。所以這套系統把 AI 放在草稿這一側，把責任留在人這一側；系統的價值是把佐證備齊、把該提醒的提醒到，不是替工程師承擔判斷。',
    { titleSize: 15.5, bodySize: 12 })

  cite(s, M, y + 4.3, CW, 0.5, '第四條',
    '每個 AI 功能都是可獨立開關的模組——機關若不接受把資料送到境外模型，整組關掉，其他功能照常運作。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 16 AI 模組（--full 才出現）
// ═══════════════════════════════════════════════════════════════════════════
if (FULL) {
  const s = slide(SEC.sys)
  const y = head(s, 'AI 模組', '16 個已註冊的 AI 模組，每一個都能單獨關掉。')
  const rows = [
    [th('分類'), th('模組'), th('做什麼')],
    [tdb('對話'), td('AI Agent 主控台'), td('問本案進度、估驗、缺失、契約，答案附出處連結')],
    [tdb('讀文件'), td('契約解析／規範需求抽取／送審文件讀取'), td('從上傳的契約與規範抽出時程、罰則與履約要求，全部保留頁碼出處')],
    [tdb('產草稿'), td('監造審查意見／RFI 回覆／稽核意見／施工月報／估驗施工說明'), td('全部是草稿，要人接受才生效')],
    [tdb('看照片'), td('工程告示板辨識／缺失照片描述／施工照片分類／工安照片判讀'), td('照片轉成日誌與檢查表草稿；工安判讀不捏造法規條號')],
    [tdb('介接'), td('天氣帶入（中央氣象署）'), td('依工地座標帶入逐三小時天氣，日誌不必手抄')],
    [tdb('自動化'), td('每日 agent 早報'), td('每天把逾期、待辦與異常寄到信箱')],
  ]
  table(s, M, y, CW, rows, [1.15, 4.5, CW - 5.65], { size: 10.5, pad: 6 })

  cardText(s, M, y + 3.1, CW * 0.485, 1.62,
    '為什麼要能單獨關',
    '機關的資安審查是逐項的。把 AI 綁死在核心流程裡，等於讓整套系統陪著一個模組被卡住；拆成模組之後，關掉任一個，其餘功能照常運作。',
    { titleSize: 14, bodySize: 11 })
  cardText(s, M + CW * 0.515, y + 3.1, CW * 0.485, 1.62,
    '而且是伺服器端關',
    '閘門在後端，不是把前端按鈕藏起來。查詢閘門失敗時預設拒絕服務（fail-closed），每次呼叫記錄功能、專案、token 與成本，平台後台可以逐案看用量。',
    { titleSize: 14, bodySize: 11 })

  cite(s, M, y + 4.82, CW, 0.42, '出處',
    'src/lib/aiFeatures.js 與 supabase/functions/_shared/aiFeatures.ts（兩份值域由測試釘住）；其中 1 個對話模組已退場，資料列與用量歷史保留。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 17 技術現況（--full 才出現）
// ═══════════════════════════════════════════════════════════════════════════
if (FULL) {
  const s = slide(SEC.sys)
  const y = head(s, '現況', '不是原型：這些數字現在就查得到。')
  const gap = 0.3, cw = (CW - gap * 3) / 4
  const figs = [
    ['587', '單元測試', C.steel], ['23', '資料庫權限測試套', C.steel],
    ['19', '端對端流程測試', C.steel], ['36', 'App 路由全數登記', C.steel],
  ]
  figs.forEach(([f, c, col], i) => {
    const x = M + i * (cw + gap)
    card(s, x, y, cw, 1.5)
    stat(s, x + 0.26, y + 0.16, cw - 0.52, f, c, col)
  })

  const rows = [
    [th('項目'), th('現況'), th('這對貴所的意義')],
    [tdb('伺服器端權限'), td('資料表全面套 RLS，並以 23 組 pgTAP 測試釘住；前端的權限判斷只是介面體驗，不是安全邊界'), td('廠商看不到監造的審查草稿，機關看不到廠商成本——這是資料庫擋的')],
    [tdb('狀態轉移'), td('核定、結案、驗收由資料庫 guard trigger 保護，繞過前端也改不了'), td('稽核時可以說「系統結構上不允許」，不是「我們規定不可以」')],
    [tdb('真後端驗證'), td('5 條真 Supabase 端對端測試：初始化、估驗三方簽核與請款、文件上傳到義務物化、標單匯入失敗整包回復'), td('不是只有 demo 跑得動')],
    [tdb('部署'), td('正式站 gov-agent.ai，Cloudflare 靜態資產 ＋ Supabase（資料庫在日本）'), td('有自有網域與正式站，不是本機展示')],
  ]
  table(s, M, y + 1.74, CW, rows, [1.55, 5.6, CW - 7.15], { size: 10, pad: 7 })

  cite(s, M, y + 4.62, CW, 0.44, '核對日',
    '2026-08-19 重跑：60 個測試檔 587 個測試全數通過。數字每次改版都會重跑，不沿用舊值。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 18 幕別：貳（--full 才出現）
// ═══════════════════════════════════════════════════════════════════════════
if (FULL) {
  const s = slide('幕別', { field: true })
  s.addText('貳', {
    x: M, y: 2.5, w: 2.2, h: 1.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 74, bold: true, color: C.safety,
  })
  s.addText('一起接案。', {
    x: M + 2.3, y: 2.66, w: 9, h: 0.9, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 38, bold: true, color: C.fieldInk,
  })
  s.addText('機關端要的東西這兩年變了，變的那一塊剛好不是工程專業。', {
    x: M + 2.3, y: 3.66, w: 9.5, h: 0.4, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 14, color: C.fieldInk2,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 19 機關端門檻（--full 才出現）
// ═══════════════════════════════════════════════════════════════════════════
if (FULL) {
  const s = slide(SEC.biz)
  const y = head(s, '趨勢', '標案裡越來越常出現「資訊系統」這一段。')
  const gap = 0.34, cw = (CW - gap * 2) / 3
  const cols = [
    ['資安變成前置條件', '資訊類採購會辦資安單位。送件那一刻文件就要完整，不能先簽再補——這一關擋掉的通常不是工程能力。'],
    ['佐證要求變細', '機關要的不再是「有做」，是「拿得出逐工項的佐證鏈」。人工整理的成本，最後都算在監造人力上。'],
    ['AI 開始被寫進需求', '需求書開始出現 AI 或自動化字樣，但機關同時怕 AI 亂做決定。能同時回答「有 AI」與「AI 不能核定」的人不多。'],
  ]
  cols.forEach(([t, b], i) => {
    cardText(s, M + i * (cw + gap), y, cw, 1.86, t, b, { titleSize: 15, bodySize: 11.5 })
  })

  cardText(s, M, y + 2.1, CW, 1.34,
    '這一段不是貴所該自己養團隊做的事。',
    '為了投一個標，去長期養工程師、做弱點掃描、寫資安符合性對照、維運一套雲端系統——攤下來的固定成本，通常撐不起接案的頻率。這正是我方存在的位置：貴所出工程專業與機關關係，資訊系統與資安文件那一段由我方負責。',
    { titleSize: 15.5, bodySize: 12 })

  bullets(s, M, y + 3.66, CW, [
    '一覽表歸類會決定要求多寡：同一套系統歸「SaaS 套裝型」與歸「系統開發服務」，要求差好幾倍',
    '這個歸類是投標策略問題，不是技術問題——早一步討論，比事後補件便宜得多',
    '我方已備妥的合規文件，貴所投標時可以直接引用（下一頁逐項）',
  ], 'dash', 12)
}

// ═══════════════════════════════════════════════════════════════════════════
// 20 合規彈藥
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide(SEC.biz)
  const y = head(s, '合規', '資安這一段，我方已經備好可以交出去的東西。')
  const rows = [
    [th('機關會要的'), th('我方現況'), th('狀態')],
    [tdb('完善資通安全管理措施'), td('資通系統防護基準（普通級）逐條符合性對照表；一覽表原文是「或 ISO 27001」，走前者'), tds('已備', 'ok')],
    [tdb('公開漏洞回報應變機制'), td('不需登入即可瀏覽的公開頁 ＋ security.txt（RFC 9116）＋ 內部應變流程'), tds('已上線', 'ok')],
    [tdb('弱點掃描報告'), td('OWASP ZAP baseline ＋ AJAX spider 對正式站掃描，High 風險 0 項，處置對照留檔'), tds('已完成', 'ok')],
    [tdb('日誌保存'), td('稽核事件含 IP 位址（伺服器端解析，前端不得傳參），保存政策六個月，無自動清除'), tds('已完成', 'ok')],
    [tdb('伺服器端權限檢查'), td('資料表全面 RLS ＋ 23 組資料庫測試；這一條多數同業是靠前端隱藏按鈕硬答的'), tds('可交報告', 'ok')],
    [tdb('境外資料'), td('資料庫在日本、不涉大陸地區。條文是「未經機關審查同意不得移出」，走審查同意，附資料落地說明'), tds('需逐案辦理', 'wip')],
    [tdb('個資保護'), td('系統內個資極少（姓名、職稱、聯絡方式）；送模型的內容不含個資'), tds('契約層處理', 'wip')],
  ]
  table(s, M, y, CW, rows, [2.5, CW - 4.0, 1.5], { size: 10, pad: 11 })

  cite(s, M, y + 4.2, CW, 0.86, '依據',
    '工程會 112 年 9 月 25 日工程企字第 1120022701 號函之《各類資訊(服務)採購之共通性資通安全基本要求參考一覽表》，「雲端微服務（SaaS）套裝型・普通級」共 11 列。這是參考一覽表，機關可視個案挑選；需第三方安全性檢測的門檻為委託金額一千萬以上。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 21 共同投標分工
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide(SEC.biz)
  const y = head(s, '分工', '一起投的時候，各出什麼。')
  const gap = 0.4, cw = (CW - gap) / 2
  const mine = [
    '系統本體與雲端維運（正式站、備份、可用率）',
    '資安文件：防護基準對照、弱點掃描、漏洞回報機制、日誌政策',
    '依本案契約與規範做的資料設定（標單匯入、期限與停留點）',
    '教育訓練與導入期間的技術窗口',
    'AI 模組的開關、用量與成本控管',
  ]
  const yours = [
    '機關關係、標案資訊與投標主導',
    '工程專業與簽證責任（監造、專管、技師簽章）',
    '本案的作業流程、表單格式與審查眉角',
    '現場人力與實際履約',
    '對機關的單一窗口（由貴所出面，我方在後）',
  ]
  card(s, M, y, cw, 3.3)
  s.addText('我方負責', {
    x: M + 0.26, y: y + 0.2, w: cw - 0.52, h: 0.36, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 17, bold: true, color: C.steelText,
  })
  bullets(s, M + 0.26, y + 0.72, cw - 0.52, mine, 'tick', 11.5)

  card(s, M + cw + gap, y, cw, 3.3)
  s.addText('貴所負責', {
    x: M + cw + gap + 0.26, y: y + 0.2, w: cw - 0.52, h: 0.36, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 17, bold: true, color: C.safetyText,
  })
  bullets(s, M + cw + gap + 0.26, y + 0.72, cw - 0.52, yours, 'tick', 11.5)

  cardText(s, M, y + 3.54, CW, 1.26,
    '兩件先講清楚，之後才不會卡',
    '一、掛名與計費方式（分包、共同投標、或貴所直接向機關訂閱系統再由我方供應）三種都可以談，但要在投標前定，因為它會影響採購歸類與資安要求的層級。二、資料歸屬：案件資料屬於機關與貴所，我方不做跨案商業利用，契約可寫明期滿刪除與資料可攜。',
    { titleSize: 15, bodySize: 11.5 })
}

// ═══════════════════════════════════════════════════════════════════════════
// 22 幕別：參（--full 才出現）
// ═══════════════════════════════════════════════════════════════════════════
if (FULL) {
  const s = slide('幕別', { field: true })
  s.addText('參', {
    x: M, y: 2.5, w: 2.2, h: 1.3, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 74, bold: true, color: C.safety,
  })
  s.addText('怎麼開始。', {
    x: M + 2.3, y: 2.66, w: 9, h: 0.9, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 38, bold: true, color: C.fieldInk,
  })
  s.addText('前兩格零採購、零程序，也不必貴所先做任何承諾。', {
    x: M + 2.3, y: 3.66, w: 9.5, h: 0.4, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 14, color: C.fieldInk2,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 23 四個層級
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide(SEC.go)
  const y = head(s, '階梯', '合作可以從很小開始。')
  const gap = 0.3, cw = (CW - gap * 3) / 4
  const steps = [
    ['①', '先看', '零承諾', '示範站現在就能打開，貴所自己點完整流程。要更深入的話，我方到貴所做一次一小時的操作說明。'],
    ['②', '用真文件跑一次', '零採購', '貴所挑一份手上的契約與規範（可去識別化），我方在測試環境跑一次抽取與期限建立，讓貴所看真文件出來的結果，不是示範資料。'],
    ['③', '單一功能先用', '小範圍', '不必整套導入。例如只用契約期限追蹤，或只用送審審查助手，綁在一個案子上試三到六個月。'],
    ['④', '單案訂閱', '正式合作', '一個專案一份訂閱，三方（廠商／監造／機關）都進來。此時才需要走採購程序，屆時再談甲乙丙哪種掛名方式。'],
  ]
  const COST = ['30 分鐘，現在就可以', '貴所出一份文件，我方數小時', '綁一個案子，三到六個月', '依專案期程，走採購程序']
  steps.forEach(([n, t, tag, b], i) => {
    const x = M + i * (cw + gap)
    card(s, x, y, cw, 3.5)
    s.addText(n, {
      x: x + 0.24, y: y + 0.22, w: 0.44, h: 0.44, margin: 0, align: 'center', valign: 'middle',
      fontFace: F, fontSize: 19, bold: true, color: C.steel,
    })
    s.addText(t, {
      x: x + 0.24, y: y + 0.76, w: cw - 0.48, h: 0.36, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 16.5, bold: true, color: C.ink,
    })
    chip(s, x + 0.24, y + 1.2, tag, i < 2 ? 'ok' : 'act')
    s.addText(b, {
      x: x + 0.24, y: y + 1.62, w: cw - 0.48, h: 1.36, margin: 0, valign: 'top',
      fontFace: F, fontSize: 11, color: C.ink2, lineSpacing: 16.5,
    })
    s.addShape(pres.ShapeType.line, {
      x: x + 0.24, y: y + 3.06, w: cw - 0.48, h: 0, line: { color: C.rule2, width: 0.75 },
    })
    s.addText(COST[i], {
      x: x + 0.24, y: y + 3.14, w: cw - 0.48, h: 0.3, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 11, bold: true, color: C.steelText,
    })
  })

  cite(s, M, y + 3.74, CW, 0.86, '為什麼建議從②開始',
    '示範資料再漂亮，都回答不了貴所真正的問題：「我的契約丟進去，抽得出東西嗎？」跑一次真文件只花我方幾個小時，卻是唯一能讓雙方同時知道值不值得繼續的做法。貴所不必先付費、不必先簽約，只要願意提供一份文件。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 24 領域知識合作
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide(SEC.go)
  const y = head(s, '丙案', '你們出 know-how，我方出系統。')
  cardText(s, M, y, CW, 1.24,
    '這條路對我方的價值高於前兩條，所以對價可以談得比較開。',
    '系統的骨架已經有了，缺的是「真正在做這件事的人怎麼做」——哪張表機關一定會退、哪個欄位其實沒人填、哪個順序在現場根本跑不動。這種東西買不到，也不是多寫幾行程式能補的。',
    { titleSize: 15.5, bodySize: 12 })

  const gap = 0.4, cw = (CW - gap) / 2
  card(s, M, y + 1.44, cw, 2.66)
  s.addText('貴所可能提供', {
    x: M + 0.26, y: y + 1.62, w: cw - 0.52, h: 0.34, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 16, bold: true, color: C.safetyText,
  })
  bullets(s, M + 0.26, y + 2.1, cw - 0.52, [
    '一到兩個真實案件的完整文件（可去識別化）',
    '貴所實際在用的表單、檢核表與報表格式',
    '每兩週一次、一小時的意見回饋',
    '被機關退件的真實案例與理由',
    '願意當第一個對外可提及的合作對象',
  ], 'dash', 11.5)

  card(s, M + cw + gap, y + 1.44, cw, 2.66)
  s.addText('我方可能提供', {
    x: M + cw + gap + 0.26, y: y + 1.62, w: cw - 0.52, h: 0.34, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 16, bold: true, color: C.steelText,
  })
  bullets(s, M + cw + gap + 0.26, y + 2.1, cw - 0.52, [
    '依貴所流程調整的功能，優先排進開發順序',
    '導入期間的長期優惠或免費使用',
    '共同掛名（對外案例、投標實績）',
    '貴所案件的資料匯出權，隨時可帶走',
    '其他對價形式——包含股權，可談',
  ], 'dash', 11.5)

  cite(s, M, y + 4.3, CW, 0.5, '保密',
    '任何文件在交付前先簽保密約定；去識別化程度由貴所決定，我方不需要真實的機關名稱與金額也能做。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 25 誠實頁（--full 才出現）
// ═══════════════════════════════════════════════════════════════════════════
if (FULL) {
  const s = slide(SEC.go)
  const y = head(s, '現況', '該講的短處，我先講。')
  const gap = 0.4, cw = (CW - gap) / 2

  card(s, M, y, cw, 2.9)
  s.addText('已經做完、可以驗證的', {
    x: M + 0.26, y: y + 0.2, w: cw - 0.52, h: 0.34, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 16, bold: true, color: C.good,
  })
  bullets(s, M + 0.26, y + 0.68, cw - 0.52, [
    '三方協作全流程，正式站已部署可登入',
    '伺服器端權限與狀態轉移，有資料庫測試佐證',
    '資安：弱點掃描 High 0、漏洞回報機制、日誌政策',
    '真後端端對端測試五條全綠（含估驗簽核與請款）',
    'AI 模組化與伺服器端閘門、用量計費',
    '自有網域與正式站，不是本機或臨時網址',
  ], 'tick', 11.5)

  card(s, M + cw + gap, y, cw, 2.9)
  s.addText('還沒做完、不會粉飾的', {
    x: M + cw + gap + 0.26, y: y + 0.2, w: cw - 0.52, h: 0.34, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 16, bold: true, color: C.safetyText,
  })
  bullets(s, M + cw + gap + 0.26, y + 0.68, cw - 0.52, [
    '尚無已簽約的付費客戶，正在與機關洽談中',
    '真實案件從頭到尾跑完一輪（dry-run）還沒做過',
    'AI 讀真文件的端對端自動驗證尚未收官（工具鏈問題）',
    '手機版與無障礙仍在收尾，桌機是目前最完整的介面',
    '目前是小團隊，導入節奏要一起排，不會假裝有大團隊',
    '沒有 ISO 27001 驗證（走逐條符合性對照，一覽表原文是「或」）',
  ], 'cross', 11.5)

  cardText(s, M, y + 3.3, CW, 1.5,
    '為什麼把這些放進簡報',
    '因為貴所遲早會問，而且問到的時候如果答案跟簡報不一樣，前面二十幾頁就全部失效。反過來說——第②格「用真文件跑一次」正好可以把上面第二、三項一次補掉，這也是我最想要的東西。',
    { titleSize: 15, bodySize: 12 })
}

// ═══════════════════════════════════════════════════════════════════════════
// 26 下一步
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide(SEC.go)
  const y = head(s, '下一步', '今天只要決定一件事就好。')
  cardText(s, M, y, CW, 1.5,
    '貴所願不願意提供一份手上的契約與規範，讓我跑一次？',
    '可以去識別化，可以是已結案的舊案。我方跑完之後把結果整理成一份對照給貴所看：抽到哪些期限、哪些罰則、出處對不對、漏了什麼。看完之後貴所再決定要不要繼續談甲乙丙。不需要簽約，不需要付費，保密約定我方先簽。',
    { titleSize: 18, bodySize: 12.5 })

  const gap = 0.34, cw = (CW - gap * 2) / 3
  const asks = [
    ['不急，但想問', '貴所目前手上的監造／專管案，最花人力的是哪一段？', C.ink],
    ['不急，但想問', '機關近兩年要求貴所補的佐證，最常是哪一類？', C.ink],
    ['真的不急', '如果未來要合作，貴所偏好甲、乙、丙哪一種形狀？', C.ink],
  ]
  asks.forEach(([tag, q], i) => {
    const x = M + i * (cw + gap)
    card(s, x, y + 1.74, cw, 1.5)
    s.addText(tag, {
      x: x + 0.24, y: y + 1.9, w: cw - 0.48, h: 0.26, margin: 0, valign: 'middle',
      fontFace: F, fontSize: 9.5, bold: true, charSpacing: 1.4, color: C.ink3,
    })
    s.addText(q, {
      x: x + 0.24, y: y + 2.2, w: cw - 0.48, h: 0.9, margin: 0, valign: 'top',
      fontFace: F, fontSize: 13, bold: true, color: C.ink, lineSpacing: 20,
    })
  })

  cite(s, M, y + 3.48, CW, 0.5, '示範站',
    'gov-agent.ai — 選任一角色即可進入，不需帳號、不必留資料。裡面是示範資料，流程與畫面都是真的。')
}

// ═══════════════════════════════════════════════════════════════════════════
// 27 封底
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = slide('封底', { field: true })
  s.addText('PMIS', {
    x: M, y: 3.0, w: 3, h: 0.72, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 44, bold: true, color: C.fieldInk,
  })
  s.addText('.ai', {
    x: M + 1.50, y: 3.0, w: 1.4, h: 0.72, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 44, bold: true, color: C.safety,
  })
  s.addText('讓監造與專管的每一位工程師，配一個讀過本案契約的 Agent。', {
    x: M, y: 3.86, w: 10.5, h: 0.4, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 16, color: C.fieldInk2,
  })
  s.addText('gov-agent.ai', {
    x: M, y: 4.5, w: 6, h: 0.32, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 13, bold: true, charSpacing: 1.4, color: C.fieldInk2,
  })
  s.addShape(pres.ShapeType.line, {
    x: M, y: 5.24, w: 5.6, h: 0, line: { color: '2E6B96', width: 1 },
  })
  s.addText('甲　你們自己用　·　乙　一起接案　·　丙　你們出 know-how', {
    x: M, y: 5.44, w: 9, h: 0.32, margin: 0, valign: 'middle',
    fontFace: F, fontSize: 13, color: C.fieldInk2,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
const out = process.argv[2] || 'partner-raw.pptx'
pres.writeFile({ fileName: out }).then(() => {
  console.log(`✓ ${out}（${K.page()} 頁）`)
  if (WARN.length) {
    console.log('\n⚠️ 估算會爆框的文字（cjkWidth 只是估算，仍要跑 check_fit.py）：')
    WARN.forEach((w) => console.log('  ' + w))
  } else {
    console.log('  文字長度估算：無超框')
  }
})
