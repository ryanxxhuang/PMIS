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

// ── 引述定位(方向 C:詳情欄的契約原文＋條文高亮)──────────────────────
// 正規化後的字串與原文之間沒有位置對應:NFKC 會把一個字展開成多個
// ('㎡' → 'm2')、空白與零寬字元整段移除,所以「驗得了」不等於「標得出來」。
// 這裡把 normalizeSourceText 的每一步逐 code point 重做,同時記下每個產出
// 字元來自原文的哪一段,得到 normalized index → 原文 index 的對照。
// 放在同一檔是刻意的:正規化規則只要在這裡和驗證器之間漂移,高亮的位置
// 就會跟 source_verified 講不同的話。
interface NormalizedMap {
  normalized: string
  starts: number[]   // normalized[i] 來自原文哪個 code point(UTF-16 起點)
  ends: number[]     // 該 code point 的終點(exclusive;代理對佔 2)
}

function mapNormalizedToSource(text: string): NormalizedMap | null {
  let normalized = ''
  const starts: number[] = []
  const ends: number[] = []
  let at = 0
  // for-of 逐 code point 走:代理對不能拆半做 normalize,slice 也要落在整字邊界
  for (const ch of text) {
    const out = ch
      .normalize('NFKC')
      .replace(ZERO_WIDTH, '')
      .replace(/\u00ad/g, '')
      .replace(/\s+/g, '')
    for (let k = 0; k < out.length; k++) {
      starts.push(at)
      ends.push(at + ch.length)
    }
    normalized += out
    at += ch.length
  }
  // 守門:String.prototype.normalize('NFKC') 逐字元套用不保證等於整串套用——
  // 組合字元要跨 code point 邊界才會結合('e' + U+0301 整串正規化成 'é',
  // 逐字元則各留原樣;半形片假名 + 濁點亦同)。對照表是逐字元建的,只有在
  // 兩者相等時,在它上面找到的索引才對應得回原文;不等就整頁放棄,寧可
  // 不高亮,也不標錯位置(標錯位置比沒有高亮更傷信任)。
  if (normalized !== normalizeSourceText(text)) return null
  return { normalized, starts, ends }
}

// 在一頁原文裡定位一段引述,回傳可直接 slice 原文的 UTF-16 區間;定不到回 null。
// 只走 verifySourceQuotation 的主路徑(正規化後精確包含)。stripComparablePunctuation
// 那條標點寬容的次要路徑不回位置:去掉標點後對照關係就斷了。所以「有高亮」
// 等於「位置是精確比對出來的」;靠標點寬容才驗過的引述只會有 source_verified,
// 沒有高亮——語意誠實,不用「大概在這附近」糊弄使用者。
// 這一支只做加法:不改 verifySourceQuotation / verifySuggestionSource /
// normalizeSourceText 的任何行為,source_verified 的判定是既有契約。
export function locateQuotationInPage(
  { quotation, pageText }: { quotation: unknown; pageText: unknown },
): { start: number; end: number } | null {
  if (typeof pageText !== 'string') return null
  const q = normalizeSourceText(quotation)
  // 與驗證器同一條門檻:太短的引述驗不了,自然也不該標
  if (q.length < MIN_VERIFIABLE_QUOTATION_LENGTH) return null
  const map = mapNormalizedToSource(pageText)
  if (!map) return null
  // 同頁多次出現取第一處:確定性,且與 includes 講的是同一個事實
  const found = map.normalized.indexOf(q)
  if (found < 0) return null
  const start = map.starts[found]
  const end = map.ends[found + q.length - 1]
  // 最後一道:回傳的區段本身正規化後必須恰等於引述。一個原文字元可展開成多個
  // 正規化字元('㎡' → 'm2'),引述若恰好切在展開的中間,區段會多含半個字——
  // 這種邊界一樣寧可不高亮。
  if (normalizeSourceText(pageText.slice(start, end)) !== q) return null
  return { start, end }
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
