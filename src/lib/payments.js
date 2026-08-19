// 請款收款的「口徑」集中在這裡。
// 原本列狀態與統計卡各自為政(ISSUE-13):列只看 paid_date 就寫「已收款」,統計卡卻只加總
// paid_amount,於是「收款日填了、實收沒登錄」時同一頁自打嘴巴——列說已收、卡片說 0。
// 統計卡另一個分裂點是它把未核定的估驗期也算進累計,和逐期表「未核定鎖金流」的閘門對不上。
// 這裡把「哪些期別算數」與「一期走到哪一步」定成單一真相,頁面只負責上色與排版。

// 金流閘門:估驗須經監造核定才能登錄請款/收款(DB trigger 同規則強制)。
// 「已請款」是核定後的後續狀態,同樣算已過閘門。
export const isPayable = (status) => status === '已核定' || status === '已請款'

// 一期的收款進度。實收未登錄時刻意不說「已收款」:現金流的憑據是入帳金額,
// 只有收款日代表帳還沒對完,用琥珀色提醒承辦補登,而不是讓它混進「已收款」。
// tone 只回語意色名,實際色票由頁面對應,避免 lib 綁死 Tailwind class。
export function paymentStatus(v) {
  if (!v) return { key: 'unbilled', label: '待請款', tone: 'slate' }
  if (v.paid_date && v.paid_amount != null) return { key: 'paid', label: '已收款', tone: 'green' }
  // 分隔號用「・」而非「(」:e2e 以子字串比對「已收款」,括號版在手機唯讀行會多出一個匹配
  if (v.paid_date) return { key: 'paid_unrecorded', label: '已收款・實收未登錄', tone: 'amber' }
  if (v.invoice_date) return { key: 'billed', label: '已請款', tone: 'blue' }
  return { key: 'unbilled', label: '待請款', tone: 'slate' }
}

// 統計卡只彙總已核定期別,與逐期表的鎖定閘門同一條線;未核定期數另外回報,
// 讓卡片能標註「差額從哪來」,而不是讓人以為系統少算了錢。
// rows 由頁面用確定性引擎(boqCalc)算好 net/retention 後傳入,這裡不重算金額。
export function summarizePayments(rows) {
  let net = 0, retention = 0, received = 0, draftCount = 0
  for (const r of rows || []) {
    if (!isPayable(r.v?.status)) { draftCount += 1; continue }
    net += r.net || 0
    retention += r.retention || 0
    received += r.v?.paid_amount || 0
  }
  return { net, retention, received, unreceived: net - received, draftCount }
}
