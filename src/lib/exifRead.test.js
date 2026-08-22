import { describe, it, expect } from 'vitest'
import { parseExif, readPhotoExif } from './exifRead.js'

// 測試自己拼最小 JPEG/TIFF 位元組——不放二進位 fixture 檔,誰壞了直接看得到
// 是哪個 byte。版面(offset 皆相對 TIFF 起點,兩種 endian 共用):
//   0  TIFF header('II'/'MM' + 42 + IFD0 位移=8)
//   8  IFD0:2 筆(0x8769 ExifIFD 指標 → 38、0x8825 GPS IFD 指標 → 76)
//   38 ExifIFD:1 筆(0x9003 DateTimeOriginal,ASCII 20 bytes → 56)
//   56 "2026:08:12 14:30:05\0"
//   76 GPS IFD:4 筆(LatRef 內嵌 / Lat → 130 / LngRef 內嵌 / Lng → 154)
//   130 緯度 3 個 RATIONAL(25°2'30")、154 經度 3 個 RATIONAL(121°30'0")
const LAT = 25 + 2 / 60 + 30 / 3600   // 25.0416667(toFixed(7) 後)
const LNG = 121.5

function buildTiff({ be = false, dateStr = '2026:08:12 14:30:05', latRef = 'N', lngRef = 'E',
                     latDen = [1, 1, 1], latNum = [25, 2, 30], lngNum = [121, 30, 0] } = {}) {
  const b = []
  const u16 = (v) => be ? b.push((v >> 8) & 0xff, v & 0xff) : b.push(v & 0xff, (v >> 8) & 0xff)
  const u32 = (v) => be
    ? b.push((v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff)
    : b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff)
  const ascii = (s, padTo) => { for (const c of s) b.push(c.charCodeAt(0)); for (let i = s.length; i < padTo; i++) b.push(0) }
  const entry = (tag, type, count, writeValue) => { u16(tag); u16(type); u32(count); writeValue() }

  b.push(...(be ? [0x4d, 0x4d] : [0x49, 0x49])); u16(0x002a); u32(8) // header
  u16(2) // IFD0
  entry(0x8769, 4, 1, () => u32(38))
  entry(0x8825, 4, 1, () => u32(76))
  u32(0) // next IFD:無
  u16(1) // ExifIFD
  entry(0x9003, 2, 20, () => u32(56))
  u32(0)
  ascii(dateStr, 20) // @56
  u16(4) // GPS IFD @76
  entry(0x0001, 2, 2, () => ascii(latRef, 4)) // count ≤ 4:值內嵌
  entry(0x0002, 5, 3, () => u32(130))
  entry(0x0003, 2, 2, () => ascii(lngRef, 4))
  entry(0x0004, 5, 3, () => u32(154))
  u32(0)
  for (let i = 0; i < 3; i++) { u32(latNum[i]); u32(latDen[i]) } // @130
  for (let i = 0; i < 3; i++) { u32(lngNum[i]); u32(1) }        // @154
  return b
}

function buildJpeg(tiffBytes) {
  const len = 2 + 6 + tiffBytes.length // 長度欄含自身,再含 'Exif\0\0'
  return new Uint8Array([
    0xff, 0xd8,                                        // SOI
    0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46,                // 先放一段 APP0:EXIF 不一定是第一段
    0xff, 0xe1, (len >> 8) & 0xff, len & 0xff,         // APP1(段長 big-endian)
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,                // 'Exif\0\0'
    ...tiffBytes,
    0xff, 0xd9,                                        // EOI
  ])
}

// EXIF 時間無時區,解讀為裝置當地時間(見 exifRead.js)——期望值同樣用本地建構
const EXPECT_ISO = new Date(2026, 7, 12, 14, 30, 5).toISOString()

describe('parseExif — DateTimeOriginal 與 GPS(兩種 endian)', () => {
  it('little-endian:拍攝時間與十進位度座標', () => {
    const r = parseExif(buildJpeg(buildTiff()))
    expect(r.takenAt).toBe(EXPECT_ISO)
    expect(r.gpsLat).toBeCloseTo(LAT, 6)
    expect(r.gpsLng).toBeCloseTo(LNG, 6)
  })

  it('big-endian:同一版面換 MM 也解得出來', () => {
    const r = parseExif(buildJpeg(buildTiff({ be: true })))
    expect(r.takenAt).toBe(EXPECT_ISO)
    expect(r.gpsLat).toBeCloseTo(LAT, 6)
    expect(r.gpsLng).toBeCloseTo(LNG, 6)
  })

  it('南緯/西經:Ref 決定正負號', () => {
    const r = parseExif(buildJpeg(buildTiff({ latRef: 'S', lngRef: 'W' })))
    expect(r.gpsLat).toBeCloseTo(-LAT, 6)
    expect(r.gpsLng).toBeCloseTo(-LNG, 6)
  })
})

describe('parseExif — 畸形資料一律 null、絕不 throw', () => {
  it('非 JPEG(PNG 簽名)/空值/太短', () => {
    const EMPTY = { takenAt: null, gpsLat: null, gpsLng: null }
    expect(parseExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual(EMPTY)
    expect(parseExif(new Uint8Array([]))).toEqual(EMPTY)
    expect(parseExif(null)).toEqual(EMPTY)
  })

  it('JPEG 但沒有 EXIF 段(只有 APP0)', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xd9])
    expect(parseExif(jpeg)).toEqual({ takenAt: null, gpsLat: null, gpsLng: null })
  })

  it('中途截斷(IFD 指到段落外)不 throw', () => {
    const whole = buildJpeg(buildTiff())
    for (const cut of [4, 13, 20, 60, 100]) {
      expect(() => parseExif(whole.slice(0, cut))).not.toThrow()
    }
    expect(parseExif(whole.slice(0, 20))).toEqual({ takenAt: null, gpsLat: null, gpsLng: null })
  })

  it('IFD 指標指到段落外:該項放棄、他項不受牽連', () => {
    const tiff = buildTiff()
    // ExifIFD 指標(IFD0 第 1 筆 entry 的 value 欄,TIFF 相對位移 18)改指到 60000
    tiff.splice(18, 4, 0x60, 0xea, 0x00, 0x00) // 60000 LE
    const r = parseExif(buildJpeg(tiff))
    expect(r.takenAt).toBeNull()
    expect(r.gpsLat).toBeCloseTo(LAT, 6) // GPS IFD 指標沒壞,照常解
  })

  it('日期字串畸形 → takenAt null;GPS 不受牽連', () => {
    const r = parseExif(buildJpeg(buildTiff({ dateStr: '2026-08-12 14:30:05' }))) // 減號不是 EXIF 格式
    expect(r.takenAt).toBeNull()
    expect(r.gpsLat).toBeCloseTo(LAT, 6)
  })

  it('相機時鐘壞掉(1970)當畸形:寧可 fallback 上傳時刻', () => {
    expect(parseExif(buildJpeg(buildTiff({ dateStr: '1970:01:01 00:00:00' }))).takenAt).toBeNull()
  })

  it('GPS 分母 0 → 座標 null;拍攝時間不受牽連', () => {
    const r = parseExif(buildJpeg(buildTiff({ latDen: [1, 0, 1] })))
    expect(r.gpsLat).toBeNull()
    expect(r.gpsLng).toBeNull() // 成對原則:一半壞=兩個都不填
    expect(r.takenAt).toBe(EXPECT_ISO)
  })

  it('緯度超過 90 度 → 座標 null', () => {
    const r = parseExif(buildJpeg(buildTiff({ latNum: [95, 0, 0] })))
    expect(r.gpsLat).toBeNull()
    expect(r.gpsLng).toBeNull()
  })

  it('(0,0) 是 GPS 沒定位的垃圾值 → 座標 null', () => {
    const r = parseExif(buildJpeg(buildTiff({ latNum: [0, 0, 0], lngNum: [0, 0, 0] })))
    expect(r.gpsLat).toBeNull()
    expect(r.gpsLng).toBeNull()
  })

  it('Ref 不是 N/S/E/W → 座標 null(正負號無從判定)', () => {
    const r = parseExif(buildJpeg(buildTiff({ latRef: 'X' })))
    expect(r.gpsLat).toBeNull()
    expect(r.gpsLng).toBeNull() // 成對原則
  })
})

describe('readPhotoExif — File/Blob 入口', () => {
  it('Blob 走 slice+arrayBuffer 讀得到同一組值', async () => {
    const r = await readPhotoExif(new Blob([buildJpeg(buildTiff())]))
    expect(r.takenAt).toBe(EXPECT_ISO)
    expect(r.gpsLat).toBeCloseTo(LAT, 6)
  })

  it('非 Blob/null 回 null 物件,不 throw', async () => {
    expect(await readPhotoExif(null)).toEqual({ takenAt: null, gpsLat: null, gpsLng: null })
    expect(await readPhotoExif({})).toEqual({ takenAt: null, gpsLat: null, gpsLng: null })
  })
})
