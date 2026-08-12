// 照片 AI 關鍵詞 → 標單工項的模糊比對。
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
const cjkOnly = (x) => (x || '').replace(/[^一-鿿]/g, '')
const bigrams = (x) => {
  const set = new Set()
  for (let i = 0; i < x.length - 1; i++) set.add(x.slice(i, i + 2))
  return set
}

// 詞頭退階:完整 hint 配不到就退到頭 3 字、頭 2 字再試。
// 真實教訓(本案標單):AI 回「鋼筋加工及組立」,但這案的工項寫「鋼筋,SD280,連工帶料」——
// 沒有「加工組立」字樣,完整詞彙覆蓋率反而不及格;退到詞頭「鋼筋」就配上了。
// 各案標單措辭不可預測,完整詞彙與詞頭都要試,取先過門檻者。
export function matchLeaf(text, leaves) {
  const full = cjkOnly(text)
  if (!full) return null
  const tries = [...new Set([full, full.slice(0, 3), full.slice(0, 2)])].filter((x) => x.length >= 2 || x === full)
  for (const t of tries) {
    const hit = matchOne(t, leaves)
    if (hit) return hit
  }
  return null
}

function matchOne(t, leaves) {
  const tb = bigrams(t)
  let best = null, bestPrimary = 0, bestSecondary = 0
  for (const it of leaves) {
    const d = cjkOnly(it.description)
    if (!d) continue
    let primary, secondary
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
