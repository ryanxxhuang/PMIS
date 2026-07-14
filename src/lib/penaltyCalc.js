// 逾期違約金試算:從契約罰則文字抽出罰率,依「逾期天數 × 罰率 × 契約總價」估算,套用上限。
// ── 確定性(regex),不用 AI ──:金額計算不能靠幻覺;台灣公共工程逾期違約金格式標準
// (多為「契約總價千分之X/日,上限總價20%」),regex 可靠;抽不出罰率就不顯示估算(寧缺勿錯)。

const ZH = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
// 中文/阿拉伯數字 → 數值(支援 十=10、十五=15、二十=20、二十五=25、3.5)
export function zhNum(s) {
  if (s == null) return NaN
  s = String(s).trim()
  if (/^[\d,]+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, '')) // 支援千分位逗號
  if (/^[零一二兩三四五六七八九十]+$/.test(s)) {
    if (s === '十') return 10
    if (s.length === 1) return ZH[s] ?? NaN
    if (s.includes('十')) {
      const [a, b] = s.split('十')
      const tens = a ? (ZH[a] ?? NaN) : 1
      const ones = b ? (ZH[b] ?? 0) : 0
      return tens * 10 + ones
    }
    // 連寫如「一五」不常見,略
  }
  return NaN
}

const NUM = '([0-9][0-9,]*(?:\\.[0-9]+)?|[零一二兩三四五六七八九十]+)'

// 從罰則文字抽罰率 → { perDayFraction?, perDayFixed?, capFraction? };抽不出回 null。
export function parsePenaltyRate(text) {
  if (!text) return null
  const t = String(text)
  let perDayFraction = null, perDayFixed = null, capFraction = null, m
  if ((m = t.match(new RegExp('千分之\\s*' + NUM)))) perDayFraction = zhNum(m[1]) / 1000
  else if ((m = t.match(new RegExp(NUM + '\\s*‰')))) perDayFraction = zhNum(m[1]) / 1000  // 每日 N‰(公共工程契約常見寫法)
  else if ((m = t.match(new RegExp('萬分之\\s*' + NUM)))) perDayFraction = zhNum(m[1]) / 10000
  else if ((m = t.match(new RegExp('百分之\\s*' + NUM + '[^,，。;；]{0,6}?(?:每|逐|/)?[日天]')))) perDayFraction = zhNum(m[1]) / 100
  // 每日固定額:①「每日(新臺幣)? N (萬)? 元」②「N (萬)? 元 /日|每日|/天」(元在後、含千分位)
  if (perDayFraction == null && (m = t.match(new RegExp('每[日天][^0-9零一二兩三四五六七八九十]{0,6}' + NUM + '\\s*(萬)?\\s*元')))) {
    perDayFixed = zhNum(m[1]) * (m[2] ? 10000 : 1)
  } else if (perDayFraction == null && (m = t.match(new RegExp(NUM + '\\s*(萬)?\\s*元\\s*(?:/|每)?\\s*[日天]')))) {
    perDayFixed = zhNum(m[1]) * (m[2] ? 10000 : 1)
  }
  // 上限:上限/最高/不得超過 …(百分之N | N% | N成)。「百分之二十」本身即為百分比,毋須 % 符號。
  const CAP = '(?:上限|最高|不(?:得|超)過)[^0-9零一二兩三四五六七八九十]{0,8}'
  if ((m = t.match(new RegExp(CAP + '百分之\\s*' + NUM)))) capFraction = zhNum(m[1]) / 100
  else if ((m = t.match(new RegExp(CAP + NUM + '\\s*[%％]')))) capFraction = zhNum(m[1]) / 100
  else if ((m = t.match(new RegExp(CAP + NUM + '\\s*成')))) capFraction = zhNum(m[1]) / 10
  if (perDayFraction == null && perDayFixed == null) return null
  return { perDayFraction, perDayFixed, capFraction }
}

// 估算逾期罰款金額。回 { amount, basis, capped, capAmount } 或 null(無罰率/未逾期/百分比制但無契約總價)。
export function estimatePenalty({ penaltyText, overdueDays, contractTotal }) {
  const rate = parsePenaltyRate(penaltyText)
  if (!rate || !(overdueDays > 0)) return null
  let amount, basis
  if (rate.perDayFraction != null) {
    if (!(contractTotal > 0)) return null
    amount = overdueDays * rate.perDayFraction * contractTotal
    basis = `逾期 ${overdueDays} 天 × 契約總價 × 千分之 ${+(rate.perDayFraction * 1000).toFixed(2)}`
  } else if (rate.perDayFixed != null) {
    amount = overdueDays * rate.perDayFixed
    basis = `逾期 ${overdueDays} 天 × 每日 ${rate.perDayFixed.toLocaleString('en-US')} 元`
  } else return null
  let capped = false, capAmount = null
  if (rate.capFraction != null && contractTotal > 0) {
    capAmount = rate.capFraction * contractTotal
    if (amount > capAmount) { amount = capAmount; capped = true }
  }
  return { amount: Math.round(amount), basis, capped, capAmount: capAmount == null ? null : Math.round(capAmount) }
}
