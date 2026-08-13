import { describe, expect, it } from 'vitest'
import {
  DOCX_EXTRACTION_METHOD,
  MIN_PAGE_TEXT_LENGTH,
  PDF_EXTRACTION_METHOD,
  TXT_EXTRACTION_METHOD,
  buildDocxPageRecords,
  buildPdfPageRecords,
  buildTxtPageRecords,
  extractDocumentPages,
  hasExtractableText,
  segmentUnpaginatedText,
} from './documentExtract.js'

describe('buildPdfPageRecords', () => {
  it('keeps one record per page with 1-based page numbers and the pdf_text method', () => {
    const records = buildPdfPageRecords([
      [{ str: '第一頁', hasEOL: true }, { str: '內容A', hasEOL: false }],
      [{ str: '第二頁內容B', hasEOL: false }],
    ])
    expect(records).toEqual([
      { page_number: 1, extracted_text: '第一頁\n內容A', extraction_method: PDF_EXTRACTION_METHOD },
      { page_number: 2, extracted_text: '第二頁內容B', extraction_method: PDF_EXTRACTION_METHOD },
    ])
  })

  it('preserves pdf.js end-of-line markers and section numbering', () => {
    const [page] = buildPdfPageRecords([[
      { str: '第十二條', hasEOL: true },
      { str: '施工廠商應於開工前', hasEOL: false },
      { str: '14 日內提送', hasEOL: true },
    ]])
    expect(page.extracted_text).toBe('第十二條\n施工廠商應於開工前 14 日內提送')
  })

  it('represents empty pages honestly instead of dropping them', () => {
    const records = buildPdfPageRecords([[], [{ str: '有字', hasEOL: false }]])
    expect(records[0]).toEqual(
      { page_number: 1, extracted_text: '', extraction_method: PDF_EXTRACTION_METHOD },
    )
    expect(records[1].page_number).toBe(2)
  })
})

describe('segmentUnpaginatedText / buildDocxPageRecords', () => {
  it('splits on paragraph boundaries within the segment budget', () => {
    const text = ['甲'.repeat(30), '乙'.repeat(30), '丙'.repeat(30)].join('\n')
    const segments = segmentUnpaginatedText(text, 65)
    expect(segments).toEqual([`${'甲'.repeat(30)}\n${'乙'.repeat(30)}`, '丙'.repeat(30)])
    // no content is lost
    expect(segments.join('\n').replace(/\n/g, '')).toBe(text.replace(/\n/g, ''))
  })

  it('hard-splits a single oversized paragraph without losing content', () => {
    const text = '丁'.repeat(90)
    const segments = segmentUnpaginatedText(text, 40)
    expect(segments.map((s) => s.length)).toEqual([40, 40, 10])
    expect(segments.join('')).toBe(text)
  })

  it('marks DOCX records as unpaginated storage segments', () => {
    const records = buildDocxPageRecords('第一段\n第二段')
    expect(records).toEqual([{
      page_number: 1,
      extracted_text: '第一段\n第二段',
      extraction_method: DOCX_EXTRACTION_METHOD,
    }])
  })

  it('returns no records for empty text', () => {
    expect(buildDocxPageRecords('')).toEqual([])
    expect(buildDocxPageRecords('   \n  ')).toEqual([])
  })
})

describe('buildTxtPageRecords', () => {
  it('stores UTF-8 text as unpaginated segments for Requirement ingestion', () => {
    expect(buildTxtPageRecords('第十條\n乙方應於期限前提送品質計畫')).toEqual([{
      page_number: 1,
      extracted_text: '第十條\n乙方應於期限前提送品質計畫',
      extraction_method: TXT_EXTRACTION_METHOD,
    }])
  })
})

describe('hasExtractableText', () => {
  it('detects scanned/empty documents so ingestion can fail honestly', () => {
    expect(hasExtractableText([])).toBe(false)
    expect(hasExtractableText([
      { page_number: 1, extracted_text: '', extraction_method: PDF_EXTRACTION_METHOD },
      { page_number: 2, extracted_text: ' . ', extraction_method: PDF_EXTRACTION_METHOD },
    ])).toBe(false)
  })

  it('accepts a document once any page carries verifiable text', () => {
    const text = '施工廠商應於開工前十四日內檢送施工計畫書予監造單位'
    expect(text.length).toBeGreaterThanOrEqual(MIN_PAGE_TEXT_LENGTH)
    expect(hasExtractableText([
      { page_number: 1, extracted_text: '', extraction_method: PDF_EXTRACTION_METHOD },
      { page_number: 2, extracted_text: text, extraction_method: PDF_EXTRACTION_METHOD },
    ])).toBe(true)
  })
})

// PR #7 審查修正:非 UTF-8 txt 必須誠實失敗,不能亂碼入庫(Big5)或讓 run 卡死(UTF-16 NUL)
describe('extractDocumentPages(.txt 編碼誠實)', () => {
  const txtFile = (bytes, name = '契約條款.txt') => ({
    name, type: 'text/plain',
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  })
  const utf8 = (s) => [...new TextEncoder().encode(s)]

  it('UTF-8 正常抽取,開頭 BOM 被去除', async () => {
    const { pages, pagination } = await extractDocumentPages(
      txtFile([0xef, 0xbb, 0xbf, ...utf8('第十條 乙方應於期限前提送品質計畫送審。')]))
    expect(pagination).toBe('unpaginated')
    expect(pages[0].extracted_text.startsWith('第十條')).toBe(true)
    expect(pages[0].extraction_method).toBe(TXT_EXTRACTION_METHOD)
  })

  it('Big5 位元組(對 UTF-8 非法)→ 拒收,不得變亂碼入庫', async () => {
    // 「契約」的 Big5 編碼:A5 D1 AC F9——皆為非法 UTF-8 序列
    await expect(extractDocumentPages(txtFile([0xa5, 0xd1, 0xac, 0xf9, 0x0a, ...utf8('clause text here')])))
      .rejects.toThrow(/無法以 UTF-8 讀取/)
  })

  it('UTF-16LE(帶 BOM)→ 拒收', async () => {
    // BOM FF FE 對 UTF-8 非法 → fatal 解碼丟例外
    await expect(extractDocumentPages(txtFile([0xff, 0xfe, 0x43, 0x00, 0x6f, 0x00])))
      .rejects.toThrow(/無法以 UTF-8 讀取/)
  })

  it('無 BOM 但含 NUL(UTF-16 無 BOM 的特徵)→ 拒收,擋 Postgres \\u0000 卡死', async () => {
    await expect(extractDocumentPages(txtFile([0x43, 0x00, 0x6f, 0x00, 0x6e, 0x00])))
      .rejects.toThrow(/NUL 字元/)
  })
})
