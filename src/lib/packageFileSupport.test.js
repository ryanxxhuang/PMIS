import { describe, expect, it } from 'vitest'
import {
  ACCEPT_ATTR, ACCEPTED_EXTENSIONS, analysisSupport, fileKind,
  isAnalyzable, storedLimitationLabel,
} from './packageFileSupport.js'

describe('file acceptance', () => {
  it('accepts every required package file type at the picker', () => {
    for (const ext of ['.pdf', '.docx', '.doc', '.txt', '.csv', '.xlsx', '.xls',
      '.jpg', '.jpeg', '.png', '.tif', '.tiff']) {
      expect(ACCEPTED_EXTENSIONS).toContain(ext)
      expect(ACCEPT_ATTR).toContain(ext)
    }
  })
})

describe('fileKind / analysisSupport', () => {
  it('fully analyzes selectable PDF, DOCX, and TXT', () => {
    expect(analysisSupport(fileKind('契約.pdf'))).toBe('full')
    expect(analysisSupport(fileKind('規範.docx'))).toBe('full')
    expect(analysisSupport(fileKind('備註.txt'))).toBe('full')
    expect(isAnalyzable('契約.PDF')).toBe(true)
  })

  it('accepts but does not analyze DOC/XLSX/XLS/CSV/images', () => {
    for (const name of ['舊契約.doc', '價目表.xlsx', '清單.xls', '數量.csv',
      '掃描附件.jpg', '照片.jpeg', '圖.png', '圖說.tif', '圖說.tiff']) {
      expect(analysisSupport(fileKind(name))).toBe('stored')
      expect(isAnalyzable(name)).toBe(false)
    }
  })

  it('falls back to MIME type when the extension is missing', () => {
    expect(fileKind('contract', 'application/pdf')).toBe('pdf')
    expect(fileKind('notes', 'text/plain')).toBe('txt')
    expect(fileKind('scan', 'image/png')).toBe('image')
  })

  it('labels unanalyzed files honestly - OCR wait for images, neutral otherwise', () => {
    expect(storedLimitationLabel('image')).toBe('已收到，等待 OCR 支援')
    expect(storedLimitationLabel('xlsx')).toBe('已收到，尚未支援內容分析')
  })
})
