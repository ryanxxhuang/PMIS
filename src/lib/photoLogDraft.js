// 照片先行→AI 填日誌(W8-7,W8-5 驗收 C-6/ISSUE-4):把「批次辨識確認上傳」成功的照片
// 彙整成施工日誌表單的「草稿」。全純函式好測。
// 紅線:AI 只產草稿——這裡只計算「要預填什麼」;寫進表單 state 由人按「全部上傳」觸發,
// 日誌本體落庫仍由人按「存檔」,兩步都是人的動作。

// 配到工項的照片 → 當日 items 加「列骨架」:工項 key 進表、數量留空由人填
// (數量抽驗本來就要工程師手動調整,AI 不編數字——數字紅線)。
// 已在表上的列一律不動:不覆蓋人已填的數量。空數量與 C-4「複製昨日」同口徑,存檔時被丟棄。
export function mergeDraftItems(existingItems = {}, photos = []) {
  const items = { ...existingItems }
  let added = 0
  for (const p of photos) {
    const k = p?.work_item_key
    if (k && !(k in items)) { items[k] = ''; added++ }
  }
  return { items, added }
}

// 各張照片的 AI 說明(caption)彙整成工作摘要草稿。
// 只在摘要為「空」時給草稿(已有內容=人填過,一律不覆蓋 → 回 null 表示不要動);
// 前綴「AI 草稿:」讓人一眼知道這段要覆核,可改可刪。去空、去重後以「;」串接。
export function draftSummaryFromCaptions(existingSummary, photos = []) {
  if ((existingSummary || '').trim()) return null
  const caps = [...new Set(photos.map((p) => (p?.caption || '').trim()).filter(Boolean))]
  if (!caps.length) return null
  return `AI 草稿:${caps.join(';')}`
}
