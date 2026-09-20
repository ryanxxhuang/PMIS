// 紙本快照 → A4 分頁計畫(純函式,不碰 DOM,所以可以單元測)。
//
// 為什麼要自己分頁:四份紙本(施工日誌／監造日誌／自主檢查／監造查驗)與估驗佐證包都是
// 「一張連續的長紙」,分頁本來是交給瀏覽器列印引擎做的。改成直接下載 PDF 之後沒有列印引擎,
// 這裡就要自己決定切在哪裡,而且要滿足三件事:
//   ① 不切在「不可切的東西」中間——表格列、單行文字、照片、標了 break-inside-avoid 的區塊;
//   ② 表格跨頁時下一頁要重印表頭(長表的必要條件,機關逐頁核對時沒表頭等於看不懂);
//   ③ 分頁點只能往上找,不能硬切——硬切只在「單一原子比整頁還高」時發生(例如一張超高的圖),
//      那種情況照實切並讓呼叫端記錄,不假裝沒事。
//
// 座標一律是「相對於紙張內容框左上角的 CSS px、y 向下」。換算成 PDF 點在 renderPaperPdf.js。

const EPS = 0.5

// 依 top 排序 + 前綴最大 bottom:判斷「y 有沒有被某個原子橫跨」只要一次二分搜。
// 樸素做法是每個候選點掃全部原子(O(n²)),長表有兩三千個原子時會卡住畫面。
function buildStraddleIndex(atoms) {
  const sorted = [...atoms].sort((a, b) => a.top - b.top)
  const tops = new Array(sorted.length)
  const maxBottom = new Array(sorted.length)
  let running = -Infinity
  for (let i = 0; i < sorted.length; i++) {
    tops[i] = sorted[i].top
    running = Math.max(running, sorted[i].bottom)
    maxBottom[i] = running
  }
  return { tops, maxBottom }
}

// 有沒有原子滿足 top < y 且 bottom > y
function straddles({ tops, maxBottom }, y) {
  let lo = 0
  let hi = tops.length - 1
  let idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (tops[mid] < y - EPS) { idx = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  if (idx < 0) return false
  return maxBottom[idx] > y + EPS
}

// 在 (from, limit] 內找最靠下的合法分頁點;找不到回傳 null(由呼叫端決定硬切)
function bestBreak(atoms, index, from, limit) {
  const candidates = new Set()
  for (const a of atoms) {
    if (a.top > from + EPS && a.top <= limit + EPS) candidates.add(a.top)
    if (a.bottom > from + EPS && a.bottom <= limit + EPS) candidates.add(a.bottom)
  }
  let best = null
  for (const c of candidates) {
    if (best !== null && c <= best) continue
    if (!straddles(index, c)) best = c
  }
  return best
}

/**
 * @param {number} totalHeight 內容總高(px)
 * @param {{top:number,bottom:number}[]} atoms 不可切割單位
 * @param {{id:string,top:number,bottom:number,headTop:number,headBottom:number}[]} tables 有表頭的表格
 * @param {number} pageHeight 每頁可用內容高(px)
 * @param {number} maxPages 失控保護
 * @returns {{pages:Array,forcedCuts:number}}
 */
export function planPages(totalHeight, atoms, tables, pageHeight, maxPages = 400) {
  if (!(pageHeight > 1)) throw new Error('分頁高度無效')
  const index = buildStraddleIndex(atoms)
  const pages = []
  let forcedCuts = 0
  let cursor = 0

  while (cursor < totalHeight - EPS) {
    if (pages.length >= maxPages) throw new Error(`分頁超過 ${maxPages} 頁上限,已中止`)

    // 這一頁開頭時「正在中間」的表格(表頭已在前面頁印過)→ 本頁要重印表頭
    const headers = tables.filter((t) => t.headBottom <= cursor + EPS && t.top < cursor - EPS && t.bottom > cursor + EPS)
    const headerHeight = headers.reduce((s, t) => s + Math.max(0, t.headBottom - t.headTop), 0)
    const limit = cursor + pageHeight - headerHeight

    let end
    if (limit >= totalHeight - EPS) {
      end = totalHeight
    } else {
      const br = bestBreak(atoms, index, cursor, limit)
      if (br != null && br > cursor + EPS) {
        end = br
      } else {
        // 單一原子比一整頁還高:照實切,呼叫端會記錄(不靜默)
        end = limit
        forcedCuts += 1
      }
    }
    if (!(end > cursor + EPS)) { end = Math.min(totalHeight, cursor + pageHeight); forcedCuts += 1 }
    pages.push({ top: cursor, bottom: end, headers, headerHeight })
    cursor = end
  }

  if (pages.length === 0) pages.push({ top: 0, bottom: Math.max(totalHeight, 1), headers: [], headerHeight: 0 })
  return { pages, forcedCuts }
}
