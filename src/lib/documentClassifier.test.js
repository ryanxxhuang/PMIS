import { describe, expect, it } from 'vitest'
import {
  AUTO_ACCEPT_THRESHOLD, CLASSIFIABLE_DOCUMENT_TYPES,
  classifyDocument, shouldExtractRequirements, presentationGroup,
} from './documentClassifier.js'

describe('classifyDocument', () => {
  it('classifies by filename with auto-accept confidence', () => {
    const result = classifyDocument({ filename: '工程採購契約.pdf', firstText: '' })
    expect(result.document_type).toBe('contract')
    expect(result.confidence).toBeGreaterThanOrEqual(AUTO_ACCEPT_THRESHOLD)
    expect(result.classification_status).toBe('auto_accepted')
  })

  it('never classifies a price list as contract prose', () => {
    const result = classifyDocument({
      filename: '詳細價目表.xlsx',
      firstText: '本契約工程之詳細價目',
      analyzable: false,
    })
    expect(result.document_type).toBe('other')
    expect(result.reason).toBe('價格/標單文件')
    // and price-like files are never routed to requirement extraction
    expect(shouldExtractRequirements({
      document_type: result.document_type,
      classification_status: 'auto_accepted',
    })).toBe(false)
  })

  it('classifies specifications, quality plans, and ITP by filename', () => {
    expect(classifyDocument({ filename: '施工規範第09章.pdf' }).document_type).toBe('specification')
    expect(classifyDocument({ filename: '品質計畫書.docx' }).document_type).toBe('quality_plan')
    expect(classifyDocument({ filename: '檢驗停留點計畫.pdf' }).document_type).toBe('itp')
    expect(classifyDocument({ filename: '竣工圖說.pdf' }).document_type).toBe('drawing')
  })

  it('falls back to content keywords with review-required confidence', () => {
    const result = classifyDocument({
      filename: '附件三.pdf',
      firstText: '立契約書人 甲方:臺北市政府 乙方:大華營造 契約總價新臺幣壹億元',
    })
    expect(result.document_type).toBe('contract')
    expect(result.confidence).toBeLessThan(AUTO_ACCEPT_THRESHOLD)
    expect(result.classification_status).toBe('needs_review')
  })

  it('marks unknown files as other + needs_review instead of guessing', () => {
    const result = classifyDocument({ filename: 'scan_0012.pdf', firstText: '無意義內容' })
    expect(result.document_type).toBe('other')
    expect(result.classification_status).toBe('needs_review')
  })

  it('uses filename-only classification for unsupported-analysis files', () => {
    const result = classifyDocument({
      filename: '品質計畫書.doc', firstText: '', analyzable: false,
    })
    expect(result.document_type).toBe('quality_plan')
    expect(result.classification_status).toBe('auto_accepted')
  })

  it('only ever produces persistent document types', () => {
    for (const filename of ['契約.pdf', '規範.pdf', 'x.pdf', '報告.pdf', '表單.xlsx']) {
      const { document_type } = classifyDocument({ filename })
      expect(CLASSIFIABLE_DOCUMENT_TYPES).toContain(document_type)
    }
  })
})

describe('shouldExtractRequirements routing', () => {
  it('routes trusted obligation-bearing types only', () => {
    for (const type of ['contract', 'specification', 'quality_plan', 'itp']) {
      expect(shouldExtractRequirements({ document_type: type, classification_status: 'auto_accepted' })).toBe(true)
      expect(shouldExtractRequirements({ document_type: type, classification_status: 'confirmed' })).toBe(true)
    }
  })

  it('never routes low-confidence, price-like, or non-obligation types', () => {
    expect(shouldExtractRequirements({ document_type: 'contract', classification_status: 'needs_review' })).toBe(false)
    for (const type of ['other', 'drawing', 'form_package', 'report', 'submittal_document']) {
      expect(shouldExtractRequirements({ document_type: type, classification_status: 'auto_accepted' })).toBe(false)
    }
  })
})

describe('presentationGroup', () => {
  it('maps persistent types to display groups without new enums', () => {
    expect(presentationGroup('contract')).toBe('契約核心文件')
    expect(presentationGroup('specification')).toBe('施工規範')
    expect(presentationGroup('quality_plan')).toBe('品質管理文件')
    expect(presentationGroup('itp')).toBe('品質管理文件')
    expect(presentationGroup('form_package')).toBe('表單與附件')
    expect(presentationGroup('drawing')).toBe('圖說')
    expect(presentationGroup('other', '價格/標單文件')).toBe('價格與標單')
    expect(presentationGroup('other')).toBe('其他')
  })
})
