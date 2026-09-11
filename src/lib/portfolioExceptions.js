// 跨案例外彙總(/portfolio 的摘要帶;原本住在 pages/web/Portfolio.jsx,
// 重構波次 8 搬來——測試要驗這條加總,不該為此把整頁的 store/demoSeed
// import 圖拉進來)。
//
// 機關承辦進來第一眼要看的是「哪裡出事」,不是逐卡自己加總。
// 卡片形狀有三種來源(本案即時計算 / demo 靜態 / portfolio_summary RPC),
// 欄位不齊是常態(RPC 還沒回來時陣列裡只有本案、demo 卡沒有 acceptance),
// 所以一律當可選欄位處理:少一張卡不能炸,也不能算錯——摘要帶算錯比不顯示更糟。

export function portfolioExceptions(cards = []) {
  const list = (cards || []).filter(Boolean)
  const sum = (pick) => list.reduce((acc, c) => acc + (Number(pick(c)) || 0), 0)
  return {
    projects: list.length,
    openDefects: sum((c) => c.openDefects),
    pendingInspections: sum((c) => c.pendingInspections),
    pendingCOs: sum((c) => c.pendingCOs),
    // 沒進驗收程序的案子 acceptance 是 null;已結案(finished)不算「驗收中」
    acceptanceActive: list.filter((c) => c.acceptance && !c.acceptance.finished).length,
    acceptanceOverdue: list.filter((c) => c.acceptance?.overdue).length,
  }
}
