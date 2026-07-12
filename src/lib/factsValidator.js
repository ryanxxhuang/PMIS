// AI 草稿的確定性數字驗證(QA 報告 P1-1:AI 月報寫出「實際進度率 0.41%」
// 而真值是 0.0041%、憑空的「合格率 100%」)。
// 原則:數字一律由程式算(facts=前端彙整的 stats),AI 只能引用 facts 裡的值;
// 生成後掃描草稿中的每個數字,不在 facts 可導出集合裡就整份擋下,不得帶入表單。
//
// 可導出集合:每個數值 fact 的原值/絕對值/四捨五入/一位小數/兩位小數
// (涵蓋「落後 X.X%」取絕對值、金額取整千分位等正當格式化),
// 加上字串 fact(月份、工作摘要)內出現的數字——AI 引用日誌原文屬正當使用。

const canon = (s) => {
  const n = parseFloat(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? String(n) : null
}
const numbersInText = (text) =>
  [...String(text ?? '').matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => canon(m[0])).filter(Boolean)

export function allowedNumbers(payload) {
  const set = new Set(['0']) // 「0 件」「無」恆允許
  const addNum = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return
    for (const x of [v, Math.abs(v), Math.round(v), Math.abs(Math.round(v))]) {
      set.add(canon(x))
      set.add(canon(x.toFixed(1)))
      set.add(canon(x.toFixed(2)))
    }
  }
  const walk = (v) => {
    if (v == null) return
    if (typeof v === 'number') addNum(v)
    else if (typeof v === 'string') numbersInText(v).forEach((n) => set.add(n))
    else if (Array.isArray(v)) v.forEach(walk)
    else if (typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(payload)
  return set
}

// 回 { ok, violations }:violations = 草稿中不在 facts 可導出集合裡的數字(去重)
export function validateDraft(text, payload) {
  const allowed = allowedNumbers(payload)
  const violations = [...new Set(numbersInText(text))].filter((n) => !allowed.has(n))
  return { ok: violations.length === 0, violations }
}
