// 全站顯示格式化的單一真相（金額、億元、日期時間）。
//
// 抽這一支的理由不是「少寫幾行」,是「同一筆缺值不能有三種畫法」:本檔之前,
// 同一個 null 金額在估驗頁畫成 '0'、在日誌頁畫成空白、在請款頁畫成 '—'。
// 機關對帳時 '0' 會把「沒有這筆資料」偽裝成「金額是零元」——這兩件事在
// 估驗/請款上的意義完全不同,所以預設一律 '—',真的要留白的地方
// 用 { empty: '' } 明寫出來(例:標單樹的分項列結構上就沒有數量與單價)。
//
// 數字本身仍由確定性引擎(boqCalc.js 等)算出,這裡只負責「怎麼畫」。

// 金額 → 千分位整數字串。四捨五入後正規化 -0:Math.round(-0.4) 是 -0,
// 直接 toLocaleString 會印出「-0」(R3 P2-01)。
export function fmtAmount(n, { empty = '—' } = {}) {
  if (n == null || isNaN(n)) return empty
  const r = Math.round(Number(n))
  return (r === 0 ? 0 : r).toLocaleString('en-US')
}

// 「NT$ 1,234,567」——AI 摘要、稽核意見與監造報表句子裡的金額。
// 缺值時整串回 '—' 而不是 'NT$ —':句子裡放一個沒有數字的幣別符號,
// 讀起來像「金額是零」,那正是這一波要消掉的歧義。
export function fmtNtd(n, { empty = '—' } = {}) {
  if (n == null || isNaN(n)) return empty
  return `NT$ ${fmtAmount(n)}`
}

// 億元版:Stat 卡的大字用,兩位小數。同一筆金額的「NT$ 千分位」版本放 sub,
// 兩者共用同一個缺值語意。
export function fmtYi(n, { empty = '—' } = {}) {
  if (n == null || isNaN(n)) return empty
  return `${(Number(n) / 1e8).toFixed(2)} 億`
}

// 系統時戳(created_at / resolved_at 等 timestamptz)→ 本地可讀字串。
// 這是「事情什麼時候被記下來」的呈現,不是業務日期,所以跟著瀏覽器時區走,
// 不套 dates.js 的台北日曆日規則(法定期限那條規則只適用業務日期)。
export function fmtDateTime(value, { empty = '—' } = {}) {
  if (!value) return empty
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d)) return empty
  return d.toLocaleString('zh-TW', { hour12: false })
}
