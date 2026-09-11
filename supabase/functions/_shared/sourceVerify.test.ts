import { describe, expect, it } from 'vitest'
import {
  MIN_VERIFIABLE_QUOTATION_LENGTH,
  locateQuotationInPage,
  normalizeSourceText,
  stripComparablePunctuation,
  verifySourceQuotation,
  verifySuggestionSource,
} from './sourceVerify.ts'

describe('normalizeSourceText', () => {
  it('removes all Unicode whitespace including line breaks and full-width spaces', () => {
    expect(normalizeSourceText('施工 廠商\n應於　開工前\t提送')).toBe('施工廠商應於開工前提送')
  })

  it('folds full-width forms and strips zero-width/soft-hyphen artifacts', () => {
    expect(normalizeSourceText('Ｑ１０，項\u200b目\u00ad表')).toBe('Q10,項目表')
  })

  it('returns empty string for non-string input', () => {
    expect(normalizeSourceText(null)).toBe('')
    expect(normalizeSourceText(undefined)).toBe('')
    expect(normalizeSourceText(42)).toBe('')
  })
})

describe('verifySourceQuotation', () => {
  const pageText =
    '第十二條 施工計畫\n施工廠商應於開工前 14 日內,檢送施工計畫書予監造單位審查,' +
    '未經核定不得施工。\n第十三條 品質計畫…'

  it('verifies an exact quotation', () => {
    expect(verifySourceQuotation({
      quotation: '施工廠商應於開工前 14 日內,檢送施工計畫書予監造單位審查',
      pageText,
    })).toBe(true)
  })

  it('verifies across PDF line-break and spacing artifacts', () => {
    expect(verifySourceQuotation({
      quotation: '施工廠商應於開工前14日內,檢送施工計畫書',
      pageText: '施工 廠商 應於 開工前\n14 日內,檢送\n施工 計畫書',
    })).toBe(true)
  })

  it('verifies through bounded punctuation drift only', () => {
    expect(verifySourceQuotation({
      quotation: '施工廠商應於開工前14日內、檢送施工計畫書',
      pageText,
    })).toBe(true)
  })

  it('rejects a quotation that is not in the page text', () => {
    expect(verifySourceQuotation({
      quotation: '施工廠商應於開工前 30 日內提送品質計畫',
      pageText,
    })).toBe(false)
  })

  it('rejects paraphrased wording even when semantically equivalent', () => {
    expect(verifySourceQuotation({
      quotation: '承包商必須在開工之前兩週內交付施工計畫',
      pageText,
    })).toBe(false)
  })

  it('rejects quotations too short to prove anything', () => {
    expect('施工計畫'.length).toBeLessThan(MIN_VERIFIABLE_QUOTATION_LENGTH)
    expect(verifySourceQuotation({ quotation: '施工計畫', pageText })).toBe(false)
  })

  it('rejects empty or missing inputs', () => {
    expect(verifySourceQuotation({ quotation: '', pageText })).toBe(false)
    expect(verifySourceQuotation({ quotation: '施工廠商應於開工前提送', pageText: '' })).toBe(false)
    expect(verifySourceQuotation({ quotation: null, pageText: null })).toBe(false)
  })
})

describe('verifySuggestionSource', () => {
  const pages = [
    { page_number: 1, extracted_text: '第一章 總則。本章為背景說明,無需求。', extraction_method: 'pdf_text' },
    { page_number: 2, extracted_text: '施工廠商應於開工前14日內檢送施工計畫書。', extraction_method: 'pdf_text' },
  ]

  it('verifies a quotation on the cited page and keeps the grounded page number', () => {
    expect(verifySuggestionSource({
      source: { page_number: 2, quotation: '施工廠商應於開工前14日內檢送施工計畫書' },
      pages, paginated: true,
    })).toEqual({ verified: true, pageNumber: 2 })
  })

  it('rejects a correct quotation cited on the wrong page', () => {
    expect(verifySuggestionSource({
      source: { page_number: 1, quotation: '施工廠商應於開工前14日內檢送施工計畫書' },
      pages, paginated: true,
    })).toEqual({ verified: false, pageNumber: 1 })
  })

  it('drops fabricated page numbers that do not exist in stored pages', () => {
    expect(verifySuggestionSource({
      source: { page_number: 47, quotation: '施工廠商應於開工前14日內檢送施工計畫書' },
      pages, paginated: true,
    })).toEqual({ verified: false, pageNumber: null })
    expect(verifySuggestionSource({
      source: { page_number: 0, quotation: '施工廠商應於開工前14日內檢送施工計畫書' },
      pages, paginated: true,
    })).toEqual({ verified: false, pageNumber: null })
  })

  it('verifies unpaginated documents against the whole text with a null page', () => {
    const segments = [
      { page_number: 1, extracted_text: '…施工廠商應於開工前14日內', extraction_method: 'docx_text_unpaginated' },
      { page_number: 2, extracted_text: '檢送施工計畫書予監造單位…', extraction_method: 'docx_text_unpaginated' },
    ]
    expect(verifySuggestionSource({
      source: { page_number: 1, quotation: '施工廠商應於開工前14日內檢送施工計畫書' },
      pages: segments, paginated: false,
    })).toEqual({ verified: true, pageNumber: null })
  })

  it('leaves a missing quotation unverified', () => {
    expect(verifySuggestionSource({
      source: { page_number: 2, quotation: '' }, pages, paginated: true,
    })).toEqual({ verified: false, pageNumber: 2 })
    expect(verifySuggestionSource({ source: null, pages, paginated: true }))
      .toEqual({ verified: false, pageNumber: null })
  })
})

describe('stripComparablePunctuation', () => {
  it('strips only the bounded punctuation list, never content characters', () => {
    expect(stripComparablePunctuation('第12條:提送(監造)審查。')).toBe('第12條提送監造審查')
  })
})

describe('locateQuotationInPage', () => {
  // 高亮的定義:回傳區段 slice 原文後,正規化結果恰等於引述的正規化結果
  const sliceOf = (pageText: string, quotation: string) => {
    const loc = locateQuotationInPage({ quotation, pageText })
    expect(loc).not.toBeNull()
    const text = pageText.slice(loc!.start, loc!.end)
    expect(normalizeSourceText(text)).toBe(normalizeSourceText(quotation))
    return text
  }

  it('locates a clause across line breaks, full-width punctuation and zero-width characters', () => {
    const pageText =
      '第十二條\u3000施工計畫\n施工\u200b廠商應於開工前 14 日內，檢送施工計畫書\n' +
      '予監造單位審查，未經核定不得施工。\n第十三條 品質計畫'
    const quotation = '施工廠商應於開工前14日內,檢送施工計畫書予監造單位審查'
    const text = sliceOf(pageText, quotation)
    // 區段起訖落在條文本身:不吃到前面的標題換行,也不吃到後面的句號
    expect(text.startsWith('施工')).toBe(true)
    expect(text.endsWith('審查')).toBe(true)
    expect(text).toContain('\n')
    // 和驗證器講同一個事實
    expect(verifySourceQuotation({ quotation, pageText })).toBe(true)
  })

  it('returns UTF-16 offsets that survive astral characters before the clause', () => {
    // 𠀋(CJK Ext-B,代理對佔 2 個 code unit)在條文前面:偏移仍要對得上 slice
    const pageText = '𠀋 補充說明\n施工廠商應於開工前14日內檢送施工計畫書予監造單位審查'
    const text = sliceOf(pageText, '施工廠商應於開工前14日內檢送施工計畫書予監造單位審查')
    expect(text).toBe('施工廠商應於開工前14日內檢送施工計畫書予監造單位審查')
  })

  it('picks the first occurrence when the clause appears more than once', () => {
    const clause = '施工廠商應於開工前14日內檢送施工計畫書予監造單位審查'
    const pageText = `${clause}。\n(重申)${clause}。`
    expect(locateQuotationInPage({ quotation: clause, pageText })).toEqual({ start: 0, end: clause.length })
  })

  it('returns null when the quotation is not on the page', () => {
    expect(locateQuotationInPage({
      quotation: '施工廠商應於開工前 30 日內提送品質計畫',
      pageText: '施工廠商應於開工前14日內檢送施工計畫書予監造單位審查',
    })).toBeNull()
  })

  it('returns null for quotations too short to prove anything', () => {
    expect('施工計畫'.length).toBeLessThan(MIN_VERIFIABLE_QUOTATION_LENGTH)
    expect(locateQuotationInPage({ quotation: '施工計畫', pageText: '第十二條 施工計畫' })).toBeNull()
  })

  it('returns null when only punctuation-tolerant matching succeeds (verified, but not locatable)', () => {
    const pageText = '施工廠商應於開工前14日內,檢送施工計畫書予監造單位審查'
    const quotation = '施工廠商應於開工前14日內、檢送施工計畫書予監造單位審查'
    expect(verifySourceQuotation({ quotation, pageText })).toBe(true)
    expect(locateQuotationInPage({ quotation, pageText })).toBeNull()
  })

  it('returns null when per-character normalization diverges from whole-string normalization', () => {
    // 'e' + U+0301 整串 NFKC 會結合成 'é',逐字元不會:對照表不可信,整頁放棄——
    // 即使引述本身在別處完全比得上、驗證器判 true,也不高亮
    const pageText = 'Cafe\u0301 附錄\n施工廠商應於開工前14日內檢送施工計畫書予監造單位審查'
    const quotation = '施工廠商應於開工前14日內檢送施工計畫書予監造單位審查'
    expect(verifySourceQuotation({ quotation, pageText })).toBe(true)
    expect(locateQuotationInPage({ quotation, pageText })).toBeNull()
  })

  it('returns null instead of cutting through a character that NFKC expands', () => {
    // '㎡' → 'm2':引述從展開後的 '2' 起頭,區段勢必多含 'm' 那半個字
    const pageText = '面積 100㎡ 以上之工程應設置圍籬'
    const quotation = '2以上之工程應設置圍籬'
    expect(verifySourceQuotation({ quotation, pageText })).toBe(true)
    expect(locateQuotationInPage({ quotation, pageText })).toBeNull()
    // 整個字都在引述裡就沒問題
    expect(sliceOf(pageText, '100㎡以上之工程')).toBe('100㎡ 以上之工程')
  })

  it('returns null for non-string inputs', () => {
    expect(locateQuotationInPage({ quotation: null, pageText: '施工廠商應於開工前14日內檢送' })).toBeNull()
    expect(locateQuotationInPage({ quotation: '施工廠商應於開工前14日內檢送', pageText: null })).toBeNull()
    expect(locateQuotationInPage({ quotation: '施工廠商應於開工前14日內檢送', pageText: 42 })).toBeNull()
  })
})
