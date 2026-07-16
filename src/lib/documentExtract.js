// P0-06 page-aware document extraction (browser side).
// Unlike the legacy flat extractContractText() in store/db.js (kept for the
// parse-contract deadline flow), this layer preserves page boundaries so every
// stored page in document_pages can later ground an AI citation.
//
// PDF   → one record per rendered page, extraction_method 'pdf_text'.
// DOCX  → Mammoth raw text has NO reliable page boundaries. The text is split
//         into storage segments (page_number = storage index only) marked
//         'docx_text_unpaginated'; Requirement sources for these documents
//         never cite a page number.
// Scanned PDF / images → text extraction yields (near-)empty pages; callers
// must detect this via hasExtractableText() and fail honestly (no OCR in P0-06).
// pdf.js worker 自帶(B-12):不依賴 CDN,機關內網也能抽字。
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { normalizeSourceText } from '../../supabase/functions/_shared/sourceVerify.ts'

export const PDF_EXTRACTION_METHOD = 'pdf_text'
export const DOCX_EXTRACTION_METHOD = 'docx_text_unpaginated'
// Below this normalized length a page has no verifiable content.
export const MIN_PAGE_TEXT_LENGTH = 20
// DOCX storage segment size (characters, before normalization).
export const DOCX_SEGMENT_LENGTH = 4000

// rawPages: per-page arrays of pdf.js text items ({ str, hasEOL }). Items are
// joined preserving pdf.js end-of-line markers; section/clause numbering in
// the text is untouched (only whitespace runs are tidied).
export function buildPdfPageRecords(rawPages) {
  return rawPages.map((items, i) => {
    let text = ''
    for (const item of items || []) {
      text += item.str ?? ''
      text += item.hasEOL ? '\n' : ' '
    }
    const cleaned = text
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
    return {
      page_number: i + 1,
      extracted_text: cleaned,
      extraction_method: PDF_EXTRACTION_METHOD,
    }
  })
}

// Split unpaginated text into storage segments on paragraph boundaries;
// a single oversized paragraph is hard-split. Deterministic for a given input.
export function segmentUnpaginatedText(text, segmentLength = DOCX_SEGMENT_LENGTH) {
  const clean = (text || '').replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  const segments = []
  let current = ''
  for (const paragraph of clean.split('\n')) {
    const candidate = current ? `${current}\n${paragraph}` : paragraph
    if (candidate.length > segmentLength && current) {
      segments.push(current)
      current = paragraph
    } else {
      current = candidate
    }
    while (current.length > segmentLength) {
      segments.push(current.slice(0, segmentLength))
      current = current.slice(segmentLength)
    }
  }
  if (current) segments.push(current)
  return segments
}

export function buildDocxPageRecords(rawText, segmentLength = DOCX_SEGMENT_LENGTH) {
  return segmentUnpaginatedText(rawText, segmentLength).map((segment, i) => ({
    // Storage index only - NOT a citable page. Requirement sources for
    // unpaginated documents keep page_number null.
    page_number: i + 1,
    extracted_text: segment,
    extraction_method: DOCX_EXTRACTION_METHOD,
  }))
}

export function hasExtractableText(pages) {
  return (pages || []).some(
    (p) => normalizeSourceText(p.extracted_text).length >= MIN_PAGE_TEXT_LENGTH,
  )
}

// File → { pages, pagination, buffer }. Heavy parsers are loaded on demand
// (same pattern as store/db.js) so they stay out of the main bundle.
export async function extractDocumentPages(file) {
  const name = (file.name || '').toLowerCase()
  const type = file.type || ''
  const buffer = await file.arrayBuffer()
  if (name.endsWith('.docx') || type.includes('officedocument.wordprocessing')
    || type.includes('msword')) {
    const m = await import('mammoth/mammoth.browser')
    const extract = m.extractRawText || m.default?.extractRawText
    const { value } = await extract({ arrayBuffer: buffer })
    return { pages: buildDocxPageRecords(value || ''), pagination: 'unpaginated', buffer }
  }
  if (name.endsWith('.pdf') || type.includes('pdf')) {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
    const rawPages = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      rawPages.push(textContent.items)
    }
    return { pages: buildPdfPageRecords(rawPages), pagination: 'paginated', buffer }
  }
  throw new Error('僅支援 PDF 或 Word(.docx)文件')
}
