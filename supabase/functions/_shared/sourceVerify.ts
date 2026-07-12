// P0-06 deterministic requirement-source verification (pure, no I/O).
// The LLM proposes a citation (page + quotation); THIS module decides whether
// source_verified is true by comparing the quotation against the stored
// document_pages text. No LLM verifies another LLM's citation, and no
// semantic/vector matching is used - only normalized text containment.
//
// Shared between the extract-requirements Edge Function (Deno) and the web
// client (Vite bundles this .ts directly), so both sides agree on what
// "verifiable text" means. Keep this file free of Deno/browser APIs.

// Zero-width characters that PDF extractors leak into text runs.
const ZERO_WIDTH = /[\u200b\u200c\u200d\u2060\ufeff]/g

// Normalization contract (conservative, deterministic):
// * NFKC folds full-width ASCII/punctuation and compatibility CJK forms
//   (e.g. '，' -> ',', 'Ａ' -> 'A', ideographic space -> space).
// * soft hyphens (PDF line-wrap artifact) are dropped.
// * ALL Unicode whitespace - spaces, tabs, line breaks - is removed, because
//   PDF text extraction inserts arbitrary breaks between CJK glyph runs.
//   Both sides of every comparison are normalized identically, so matching
//   stays an exact character-sequence containment check.
export function normalizeSourceText(text: unknown): string {
  if (typeof text !== 'string') return ''
  return text
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(/\u00ad/g, '')
    .replace(/\s+/g, '')
}

// Bounded secondary comparison: strip a fixed list of punctuation on BOTH
// sides. This only forgives punctuation drift (model normalizing '、' vs ',');
// every content character must still match in order. It is not a fuzzy score.
const COMPARABLE_PUNCTUATION =
  /[,.;:!?"'()[\]{}<>«»‧·．，、。；：！？（）【】〔〕「」『』〈〉《》―—–\-_/\\|~*]/g
export function stripComparablePunctuation(text: string): string {
  return text.replace(COMPARABLE_PUNCTUATION, '')
}

// Quotations shorter than this (after normalization) match too easily to
// prove anything; they stay unverified and fall to human review.
export const MIN_VERIFIABLE_QUOTATION_LENGTH = 6

export function verifySourceQuotation(
  { quotation, pageText }: { quotation: unknown; pageText: unknown },
): boolean {
  const q = normalizeSourceText(quotation)
  const p = normalizeSourceText(pageText)
  if (q.length < MIN_VERIFIABLE_QUOTATION_LENGTH || !p) return false
  if (p.includes(q)) return true
  const q2 = stripComparablePunctuation(q)
  return q2.length >= MIN_VERIFIABLE_QUOTATION_LENGTH &&
    stripComparablePunctuation(p).includes(q2)
}

export interface StoredPage {
  page_number: number
  extracted_text: string | null
  extraction_method?: string
}

export interface SourceClaim {
  page_number?: number | null
  quotation?: string | null
}

// System verdict for one AI source claim against the stored pages of the
// exact processed document version.
//
// Paginated documents (PDF):
// * the claimed page must exist in document_pages, and the quotation must be
//   contained in THAT page's stored text - a quotation found on a different
//   page stays unverified (wrong page is rejected, not repaired);
// * pageNumber is returned only when the claim is grounded in a stored page,
//   so fabricated page numbers are never persisted.
// Unpaginated documents (DOCX raw text): there is no reliable page boundary,
// so the quotation is matched against the whole stored text and pageNumber is
// always null - a verified DOCX source deliberately has no page citation.
export function verifySuggestionSource(
  { source, pages, paginated }:
    { source: SourceClaim | null | undefined; pages: StoredPage[]; paginated: boolean },
): { verified: boolean; pageNumber: number | null } {
  const quotation = source?.quotation ?? ''
  if (paginated) {
    const claimed = source?.page_number
    const pageNumber = Number.isInteger(claimed) && (claimed as number) > 0
      ? (claimed as number)
      : null
    const page = pageNumber == null
      ? undefined
      : pages.find((p) => p.page_number === pageNumber)
    if (!page) return { verified: false, pageNumber: null }
    return {
      verified: verifySourceQuotation({ quotation, pageText: page.extracted_text }),
      pageNumber,
    }
  }
  const fullText = pages.map((p) => p.extracted_text ?? '').join('\n')
  return {
    verified: verifySourceQuotation({ quotation, pageText: fullText }),
    pageNumber: null,
  }
}
