// 佐證照片的 EXIF 保全:imageCompress.js 的 canvas 重取樣重編碼「不帶」EXIF,
// 而壓縮後原圖即棄置——拍攝時間與 GPS 是照片僅存的自證中繼資料(什麼時候、在哪拍),
// 同批才做「佐證照片不可竄改」凍結,不能一邊凍結一邊在上傳站把證據靜默丟掉。
// 所以壓縮「之前」先把 DateTimeOriginal 與 GPS 經緯度讀出來,由呼叫端回填 photos 列
// (photos.taken_at / gps_lat / gps_lng,baseline 就有這三欄)。
//
// 紅線:讀 EXIF 是加分,不是上傳閘門——畸形/超界/不支援格式一律回 null,絕不 throw,
// 不能因為一張怪照片擋住佐證上傳。刻意不引外部依賴(exifr 等):只要兩個欄位,
// 一段 TIFF IFD 走訪就夠,supply chain 面積越小越好。
// 範圍也刻意小:只解 JPEG(APP1/Exif);PNG/HEIC/WebP 直接回 null——
// 工地手機照經瀏覽器選檔幾乎都是 JPEG,為少數格式引入完整解析器不划算。

const EMPTY = Object.freeze({ takenAt: null, gpsLat: null, gpsLng: null })

// EXIF 的 DateTimeOriginal 沒有時區,只能當「裝置當地時間」解讀——工地照的拍攝
// 裝置與上傳者同在台灣,本地時區是最合理的假設(比丟掉整個時間戳好得多)。
// 年份界限:相機沒電池會把時鐘重設回 1970/2008 之類,太離譜的年份當畸形處理,
// 讓呼叫端 fallback 到上傳時刻,免得佐證掛著明顯錯誤的拍攝時間。
function exifDateToIso(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s || '')
  if (!m) return null
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number)
  if (y < 1990 || y > 2100) return null
  const date = new Date(y, mo - 1, d, h, mi, se)
  // Date 會把 2 月 30 日「進位」成 3 月——回頭核對元件才能抓出這種畸形值
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d ||
      date.getHours() !== h || date.getMinutes() !== mi || date.getSeconds() !== se) return null
  return date.toISOString()
}

// 純位元組解析(可測):Uint8Array → { takenAt, gpsLat, gpsLng }。
// 任何一步越界/畸形都吞掉回 null——見頂部紅線。
export function parseExif(bytes) {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length < 4) return { ...EMPTY }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (view.getUint16(0) !== 0xffd8) return { ...EMPTY } // 非 JPEG(SOI):PNG/HEIC/WebP 都在這裡出局

    // 走訪 JPEG 段落找 APP1/"Exif\0\0"。EXIF 規定在影像資料(SOS)之前,
    // 但前面可能先有 JFIF APP0、XMP(也是 APP1)等,要逐段跳。
    let off = 2
    while (off + 4 <= view.byteLength) {
      if (view.getUint8(off) !== 0xff) break // 段落結構壞了:放棄,不硬掃
      const marker = view.getUint8(off + 1)
      if (marker === 0xff) { off += 1; continue }      // padding 填充位元組
      if (marker === 0xda || marker === 0xd9) break    // SOS/EOI:後面不會再有 EXIF
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { off += 2; continue } // 無長度 marker
      const len = view.getUint16(off + 2) // 段長含長度欄自身,一律 big-endian
      if (len < 2 || off + 2 + len > view.byteLength) break
      if (marker === 0xe1 && len >= 10 &&
          view.getUint32(off + 4) === 0x45786966 && // 'Exif'
          view.getUint16(off + 8) === 0x0000) {
        return parseTiff(view, off + 10, off + 2 + len)
      }
      off += 2 + len
    }
    return { ...EMPTY }
  } catch {
    return { ...EMPTY }
  }
}

// TIFF 結構(EXIF 本體):header 決定 big/little endian,之後 IFD0 →
// ExifIFD(0x8769,DateTimeOriginal 在裡面)與 GPS IFD(0x8825)。
// 所有位移都是「TIFF 起點相對」,且不得超出 APP1 段落(end)。
function parseTiff(view, tiffStart, end) {
  if (tiffStart + 8 > end) return { ...EMPTY } // 連 header(byte order+42+IFD0 位移)都裝不下
  const order = view.getUint16(tiffStart)
  const le = order === 0x4949 ? true : order === 0x4d4d ? false : null // 'II' / 'MM'
  if (le === null || view.getUint16(tiffStart + 2, le) !== 0x002a) return { ...EMPTY }

  // 越界=畸形:丟 RangeError 由各子區塊的 try/catch 接住(不讓 GPS 壞掉連拍攝時間也賠掉)
  const guard = (o, n) => {
    if (!Number.isInteger(o) || o < 0 || tiffStart + o + n > end) throw new RangeError('exif 位移越界')
  }
  const rd16 = (o) => { guard(o, 2); return view.getUint16(tiffStart + o, le) }
  const rd32 = (o) => { guard(o, 4); return view.getUint32(tiffStart + o, le) }

  // 走訪一個 IFD,回傳「想要的 tag → entry 位移」。entry 固定 12 bytes:
  // tag(2) type(2) count(4) value/offset(4)。上限 512 筆防畸形檔造出天量迴圈。
  const findTags = (dirOff, wanted) => {
    const n = rd16(dirOff)
    if (n > 512) return {}
    const found = {}
    for (let i = 0; i < n; i++) {
      const e = dirOff + 2 + i * 12
      guard(e, 12)
      const tag = rd16(e)
      if (wanted.has(tag)) found[tag] = e
    }
    return found
  }
  // ASCII 值(type 2):count ≤ 4 內嵌於 entry,否則 value 欄是位移
  const readAscii = (e) => {
    if (rd16(e + 2) !== 2) return null
    const count = rd32(e + 4)
    if (count < 1 || count > 64) return null
    const valOff = count <= 4 ? e + 8 : rd32(e + 8)
    guard(valOff, count)
    let s = ''
    for (let i = 0; i < count; i++) {
      const c = view.getUint8(tiffStart + valOff + i)
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s
  }
  // RATIONAL 值(type 5):每筆 8 bytes(分子/分母 u32),必在位移處
  const readRationals = (e, expectCount) => {
    if (rd16(e + 2) !== 5 || rd32(e + 4) !== expectCount) return null
    const valOff = rd32(e + 8)
    const out = []
    for (let i = 0; i < expectCount; i++) {
      const num = rd32(valOff + i * 8), den = rd32(valOff + i * 8 + 4)
      if (!den) return null // 分母 0:畸形
      out.push(num / den)
    }
    return out
  }
  // IFD 指標(SHORT/LONG 都收:規格是 LONG,但實務上有相機寫 SHORT)
  const readPointer = (e) => {
    const t = rd16(e + 2)
    return t === 4 || t === 3 ? rd32(e + 8) : null
  }

  const result = { ...EMPTY }
  let ifd0
  try { ifd0 = findTags(rd32(4), new Set([0x8769, 0x8825])) } catch { return result }

  // 拍攝時間(ExifIFD → 0x9003 DateTimeOriginal)
  try {
    if (ifd0[0x8769] != null) {
      const exifOff = readPointer(ifd0[0x8769])
      if (exifOff) {
        const tags = findTags(exifOff, new Set([0x9003]))
        if (tags[0x9003] != null) result.takenAt = exifDateToIso(readAscii(tags[0x9003]))
      }
    }
  } catch { /* 拍攝時間畸形:只放棄這一項 */ }

  // GPS(GPS IFD → Ref 定正負、座標為度/分/秒三個 RATIONAL)
  try {
    if (ifd0[0x8825] != null) {
      const gpsOff = readPointer(ifd0[0x8825])
      if (gpsOff) {
        const tags = findTags(gpsOff, new Set([0x0001, 0x0002, 0x0003, 0x0004]))
        const latRef = tags[0x0001] != null ? readAscii(tags[0x0001]) : null
        const lat = tags[0x0002] != null ? readRationals(tags[0x0002], 3) : null
        const lngRef = tags[0x0003] != null ? readAscii(tags[0x0003]) : null
        const lng = tags[0x0004] != null ? readRationals(tags[0x0004], 3) : null
        // 經緯度成對才有意義:缺一半的座標對佐證沒用,寧可兩個都不填
        if (lat && lng && (latRef === 'N' || latRef === 'S') && (lngRef === 'E' || lngRef === 'W')) {
          const latDeg = lat[0] + lat[1] / 60 + lat[2] / 3600
          const lngDeg = lng[0] + lng[1] / 60 + lng[2] / 3600
          // (0,0) 是 GPS 晶片沒定位就寫零的典型垃圾值,不是台灣工地會出現的座標
          if (latDeg <= 90 && lngDeg <= 180 && (latDeg !== 0 || lngDeg !== 0)) {
            // 小數 7 位 ≈ 1cm,足夠佐證定位,也避免浮點長尾進 numeric 欄
            result.gpsLat = Number(((latRef === 'S' ? -1 : 1) * latDeg).toFixed(7))
            result.gpsLng = Number(((lngRef === 'W' ? -1 : 1) * lngDeg).toFixed(7))
          }
        }
      }
    }
  } catch { /* GPS 畸形:只放棄這一項 */ }

  return result
}

// File/Blob → EXIF 中繼資料。只讀前 256KB:APP1 必在影像資料前、單段上限 64KB,
// 不必把 8MB 原圖整份讀進手機記憶體;EXIF 藏在超大 XMP/ICC 之後的罕見檔就當沒有。
export async function readPhotoExif(file) {
  try {
    if (!file || typeof file.slice !== 'function') return { ...EMPTY }
    const buf = await file.slice(0, 256 * 1024).arrayBuffer()
    return parseExif(new Uint8Array(buf))
  } catch {
    return { ...EMPTY }
  }
}
