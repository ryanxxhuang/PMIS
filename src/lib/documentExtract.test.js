import { describe, expect, it } from 'vitest'
import {
  DOCX_EXTRACTION_METHOD,
  MIN_PAGE_TEXT_LENGTH,
  PDF_EXTRACTION_METHOD,
  buildDocxPageRecords,
  buildPdfPageRecords,
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
