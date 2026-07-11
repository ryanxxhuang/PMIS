// P0-07.5 file acceptance vs analysis support (pure).
// The upload control ACCEPTS the whole contract package; only a subset is
// content-ANALYZED in this chapter. Accepted-but-unanalyzed files are stored
// with honest labels - never faked as analyzed, never rejected at the picker.

export const ACCEPTED_EXTENSIONS = Object.freeze([
  '.pdf', '.docx', '.doc', '.txt', '.csv', '.xlsx', '.xls',
  '.jpg', '.jpeg', '.png', '.tif', '.tiff',
])
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',')

const KIND_BY_EXTENSION = Object.freeze({
  pdf: 'pdf', docx: 'docx', doc: 'doc', txt: 'txt', csv: 'csv',
  xlsx: 'xlsx', xls: 'xls', jpg: 'image', jpeg: 'image', png: 'image',
  tif: 'image', tiff: 'image',
})

export function fileKind(filename = '', mimeType = '') {
  const ext = (filename.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || ''
  if (KIND_BY_EXTENSION[ext]) return KIND_BY_EXTENSION[ext]
  if (mimeType.includes('pdf')) return 'pdf'
  if (mimeType.includes('officedocument.wordprocessing')) return 'docx'
  if (mimeType === 'text/plain') return 'txt'
  if (mimeType.startsWith('image/')) return 'image'
  return 'other'
}

// 'full'  -> text is extracted, stored page-aware, and analyzable by AI
// 'stored'-> accepted + binary preserved + classified by filename only
export function analysisSupport(kind) {
  return kind === 'pdf' || kind === 'docx' || kind === 'txt' ? 'full' : 'stored'
}

export function isAnalyzable(filename, mimeType) {
  return analysisSupport(fileKind(filename, mimeType)) === 'full'
}

// Neutral limitation labels for accepted-but-unanalyzed files. Images/TIFF
// wait for OCR; spreadsheets/legacy formats wait for structured parsing.
export function storedLimitationLabel(kind) {
  return kind === 'image' ? '已收到，等待 OCR 支援' : '已收到，尚未支援內容分析'
}
