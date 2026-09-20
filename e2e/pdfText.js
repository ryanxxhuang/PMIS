// 下載回來的 PDF 要怎麼驗:不能只看檔頭是不是 %PDF。
//
// 這支把 PDF 拆開,照 ToUnicode CMap 把內容流裡的 glyph 代碼還原成文字。
// 它同時證明三件 CI 也驗得到的事:
//   ① 頁數(多頁自動換頁);
//   ② 內容是「可選取、可搜尋的文字」而不是整頁截圖——截圖沒有 Tj,也沒有 ToUnicode;
//   ③ 中文有正確的 Unicode 對應(缺字或字型沒內嵌時,還原出來會是空的或亂碼)。
// 字有沒有「畫得出來」要靠實際算圖(本機用 poppler 逐頁渲染),這支不負責。
import zlib from 'node:zlib'

const latin1 = (buf) => Buffer.from(buf).toString('latin1')

function inflate(raw) {
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) {
    try { return fn(raw) } catch { /* 換下一種 */ }
  }
  return null
}

// 取出所有 `N 0 obj ... endobj` 區塊
function* objects(src) {
  const re = /(\d+)\s+0\s+obj\b/g
  let m
  while ((m = re.exec(src))) {
    const end = src.indexOf('endobj', m.index)
    if (end < 0) continue
    yield { num: Number(m[1]), start: m.index, body: src.slice(m.index, end) }
  }
}

function streamBytes(buf, src, obj) {
  const rel = obj.body.indexOf('stream')
  if (rel < 0) return null
  let dataStart = obj.start + rel + 'stream'.length
  if (src[dataStart] === '\r') dataStart += 1
  if (src[dataStart] === '\n') dataStart += 1
  const endRel = obj.body.indexOf('endstream', rel)
  if (endRel < 0) return null
  const dataEnd = obj.start + endRel
  return Buffer.from(buf.slice(dataStart, dataEnd))
}

// ToUnicode CMap → Map<4-hex code, 字串>
function parseToUnicode(text) {
  const map = new Map()
  for (const block of text.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(m[1].toUpperCase(), hexToStr(m[2]))
    }
  }
  for (const block of text.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(m[1], 16)
      const hi = parseInt(m[2], 16)
      const base = parseInt(m[3], 16)
      for (let c = lo; c <= hi && c - lo < 65536; c++) {
        map.set(c.toString(16).toUpperCase().padStart(m[1].length, '0'), String.fromCodePoint(base + (c - lo)))
      }
    }
  }
  return map
}

function hexToStr(hex) {
  let out = ''
  for (let i = 0; i + 3 < hex.length + 1; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16))
  return out
}

/**
 * @param {Buffer|Uint8Array} bytes 下載回來的 PDF
 * @returns {{pageCount:number, pages:string[], text:string, hasFontFile:boolean}}
 */
export function readPdf(bytes) {
  const buf = Buffer.from(bytes)
  const src = latin1(buf)
  if (!src.startsWith('%PDF-')) throw new Error('不是 PDF(缺 %PDF- 檔頭)')
  if (!src.trimEnd().endsWith('%%EOF')) throw new Error('PDF 沒有正常結尾(%%EOF)')

  const all = [...objects(src)]
  const pageObjs = all.filter((o) => /\/Type\s*\/Page[^s]/.test(o.body))
  const hasFontFile = all.some((o) => /\/FontFile2\b/.test(o.body)) || /\/FontFile2\b/.test(src)

  // ToUnicode:本專案每份 PDF 只有一支內嵌字型,全部併成一張表就夠
  const decodeStream = (o) => {
    const raw = streamBytes(buf, src, o)
    if (!raw) return null
    // pdf-lib 視情況壓不壓內容流,兩種都要吃得下
    return /\/Filter\s*\/FlateDecode/.test(o.body) ? inflate(raw) : raw
  }

  const toUnicode = new Map()
  for (const o of all) {
    const out = decodeStream(o)
    if (!out) continue
    const txt = out.toString('latin1')
    if (txt.includes('beginbfchar') || txt.includes('beginbfrange')) {
      for (const [k, v] of parseToUnicode(txt)) toUnicode.set(k, v)
    }
  }

  const hexToText = (hex) => {
    const up = hex.toUpperCase()
    let out = ''
    for (let i = 0; i + 4 <= up.length; i += 4) out += toUnicode.get(up.slice(i, i + 4)) ?? '�'
    return out
  }

  // `<hex> Tj` 與 `[ <hex> 位移 <hex> … ] TJ` 都要吃。TJ 的位移是 1/1000 em 的「往左移」,
  // 負得夠多才代表字與字之間有實際間隙——像 PDF 閱讀器一樣只在那裡還原成一個空白,
  // 而不是每個字之間都塞空白(否則整段中文會被拆成「公 共 工 程」)。
  const GAP = -200
  const decodeContent = (txt) => {
    let out = ''
    const re = /\[((?:\s*(?:<[0-9A-Fa-f]*>|-?[\d.]+))*)\s*\]\s*TJ|<([0-9A-Fa-f]+)>\s*Tj/g
    let m
    while ((m = re.exec(txt))) {
      if (m[2] != null) { out += `${hexToText(m[2])} `; continue }
      for (const part of m[1].matchAll(/<([0-9A-Fa-f]*)>|(-?[\d.]+)/g)) {
        if (part[1] != null) out += hexToText(part[1])
        else if (Number(part[2]) <= GAP) out += ' '
      }
      out += ' '
    }
    return out
  }

  const pages = []
  for (const page of pageObjs) {
    // /Contents 可能是單一參照,也可能是陣列(pdf-lib 兩種都寫得出來)
    const refs = [...page.body.matchAll(/\/Contents\s*(?:\[\s*)?((?:\d+\s+0\s+R\s*)+)/g)]
      .flatMap((m) => [...m[1].matchAll(/(\d+)\s+0\s+R/g)].map((x) => Number(x[1])))
    if (!refs.length) { pages.push(''); continue }
    let text = ''
    for (const num of refs) {
      const obj = all.find((o) => o.num === num)
      if (!obj) continue
      const out = decodeStream(obj)
      if (out) text += decodeContent(out.toString('latin1'))
    }
    pages.push(text)
  }

  return { pageCount: pageObjs.length, pages, text: pages.join('\n'), hasFontFile }
}
