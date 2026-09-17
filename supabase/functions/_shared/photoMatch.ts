// 照片 AI 關鍵詞 → 標單工項的模糊比對(前後端唯一實作)。
// ---------------------------------------------------------------------------
// 這支演算法同時給前端(SiteLog 批次辨識／告示板帶入)與 Edge(draft-field-documents
// 起稿)用。P2b 之前只有 src/lib/photoMatch.js 一份;Edge 若再抄一份,同一張照片在
// 頁面上配到 A、伺服器起稿卻配到 B,人看到的與簽出去的就不是同一件事。所以實作
// 只留這裡:src/lib/photoMatch.js 只 re-export(Vite 可直接 import 本目錄的 .ts,
// 與 sourceVerify.ts／documentTypes.ts 同一慣例),Deno 部署只打包 functions 目錄,
// 反向 import 做不到,因此單一來源必須住在 _shared。
// 測試案例在 src/lib/photoMatch.test.js(以真實 PCCES 標單描述釘住),兩側共用。
//
// dry-run 2026-08-12 抓到配對率 0%,根因有兩層(都用真實標單描述寫成測試釘住):
// ① 舊評分用「長度比」——AI 回「鋼筋」,標單是「鋼筋,SD420W,#4(D13),加工及組立」,
//    2/20=0.1 < 0.5 門檻,完美包含卻永遠不及格。
// ② 子字串包含本身也靠不住——PCCES 描述把規格夾在中間(「鋼筋,SD420W,…,加工及組立」),
//    「鋼筋加工及組立」不是它的子字串,含逗號規格的描述連包含都測不到。
//
// 解法:只留 CJK 字元後取「字元 bigram 覆蓋率」——
//   primary   = hint 的 bigram 有多少出現在描述裡(hint 被涵蓋的程度,門檻 0.6)
//   secondary = 這些 bigram 佔描述的比例(同分時偏好更聚焦的工項,不挑又臭又長的)
// 「鋼筋加工及組立」清掉規格後 vs「鋼筋SDW4D13加工及組立」→ 覆蓋率 6/6=1.0。
// 工項因案而異,不寫死任何工項名稱(contract-driven 原則);配不到就回 null,寧可不配。

export type MatchableLeaf = { description?: string | null }

const cjkOnly = (x: unknown): string => String(x ?? '').replace(/[^一-鿿]/g, '')
const bigrams = (x: string): Set<string> => {
  const set = new Set<string>()
  for (let i = 0; i < x.length - 1; i++) set.add(x.slice(i, i + 2))
  return set
}

// 詞頭退階:完整 hint 配不到就退到頭 3 字、頭 2 字再試。
// 真實教訓(本案標單):AI 回「鋼筋加工及組立」,但這案的工項寫「鋼筋,SD280,連工帶料」——
// 沒有「加工組立」字樣,完整詞彙覆蓋率反而不及格;退到詞頭「鋼筋」就配上了。
// 各案標單措辭不可預測,完整詞彙與詞頭都要試,取先過門檻者。
export function matchLeaf<T extends MatchableLeaf>(text: unknown, leaves: T[]): T | null {
  const full = cjkOnly(text)
  if (!full) return null
  const tries = [...new Set([full, full.slice(0, 3), full.slice(0, 2)])].filter((x) => x.length >= 2 || x === full)
  for (const t of tries) {
    const hit = matchOne(t, leaves)
    if (hit) return hit
  }
  return null
}

function matchOne<T extends MatchableLeaf>(t: string, leaves: T[]): T | null {
  const tb = bigrams(t)
  let best: T | null = null, bestPrimary = 0, bestSecondary = 0
  for (const it of leaves) {
    const d = cjkOnly(it.description)
    if (!d) continue
    let primary: number, secondary: number
    if (!tb.size) {
      // 單一 CJK 字:退回子字串
      primary = d.includes(t) ? 1 : 0
      secondary = d.length ? t.length / d.length : 0
    } else {
      const db = bigrams(d)
      let common = 0
      for (const g of tb) if (db.has(g)) common++
      primary = common / tb.size
      secondary = db.size ? common / db.size : 0
    }
    if (primary > bestPrimary || (primary === bestPrimary && secondary > bestSecondary)) {
      bestPrimary = primary; bestSecondary = secondary; best = it
    }
  }
  return bestPrimary >= 0.6 ? best : null
}
