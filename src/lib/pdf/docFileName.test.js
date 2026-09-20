// 檔名是文件離開系統後唯一還在的揭露:草稿下載下來必須看得出它沒簽。
import { describe, it, expect } from 'vitest'
import { fieldDocFileName } from './docFileName.js'
import { safeFileName } from './downloadPaperPdf.js'

describe('fieldDocFileName', () => {
  it('已簽署版本帶版次與已簽署標示', () => {
    expect(fieldDocFileName({ label: '施工日誌', date: '2026-08-04', versionNo: 3, signed: true }))
      .toBe('施工日誌_2026-08-04_v3_已簽署')
  })

  it('沒有簽署列就標草稿未簽署', () => {
    expect(fieldDocFileName({ label: '自主檢查表', date: '2026-08-04', versionNo: 1, signed: false }))
      .toBe('自主檢查表_2026-08-04_v1_草稿未簽署')
  })

  it('舊流程既有紀錄用自己的註記,不會被說成已簽署', () => {
    expect(fieldDocFileName({ label: '施工日誌', date: '2026-08-04', note: '既有紀錄未簽署' }))
      .toBe('施工日誌_2026-08-04_既有紀錄未簽署')
  })
})

describe('safeFileName', () => {
  it('保留中文與全形括號,只換掉檔名不能用的字元', () => {
    expect(safeFileName('監造查驗表單（第 2 期）/v1')).toBe('監造查驗表單（第 2 期）_v1.pdf')
  })

  it('空字串退回 fallback', () => {
    expect(safeFileName('', '工程文件')).toBe('工程文件.pdf')
  })

  it('去掉控制字元與開頭的點', () => {
    expect(safeFileName('..施工日誌')).toBe('施工日誌.pdf')
  })
})
