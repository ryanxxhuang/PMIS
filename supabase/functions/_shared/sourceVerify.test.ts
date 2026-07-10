import { describe, expect, it } from 'vitest'
import {
  MIN_VERIFIABLE_QUOTATION_LENGTH,
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
