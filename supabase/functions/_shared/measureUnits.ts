// 單位正規化與換算的確定性規則(唯一實作;無 IO、無依賴,vitest 與 deno 直接測)。
// ---------------------------------------------------------------------------
// 為什麼要有這支:照片／紙本讀到的數字帶的是「紙上的單位」(MM、CM、公分),標單工項帶的是
// 「契約單位」(M、M2、T)。2026-09-20 廠商驗收指出 fieldDocDraft 把告示板數量直接當成工項
// 的當日完成量,**完全沒有比對單位**——板上寫 15 CM 會變成標單 M2 的 15。這支把「同不同單位」
// 「能不能換算」變成一條確定性規則:
//   * 同一量綱(長度／面積／體積／質量／時間)→ 依固定係數換算,換算過程寫進來源說明。
//   * 不同量綱(CM vs M2)→ 明確拒絕,呼叫端標 pending 並列 recheck;**不得忽略、不得直接採用**。
//   * 認不得的單位(式、座、處、次/分、V/H…)→ 只有「正規化後字面完全相同」才算同單位;
//     不同就拒絕。寧可請人確認,也不換算沒有把握的東西。
// 誠實原則:這裡不做任何四捨五入以外的加工;換算只用固定係數,沒有模型參與。

export type UnitDimension = 'length' | 'area' | 'volume' | 'mass' | 'time' | 'temperature' | 'opaque'

// 正規化:去空白、全形→半形、上標、常見中文單位→代碼。認不得就回「去空白小寫」的原字串(opaque)。
const WIDE = /[！-～]/g
const toHalf = (s: string) => s.replace(WIDE, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))

const ALIASES: Record<string, string> = {
  // 長度
  'mm': 'mm', '公釐': 'mm', '毫米': 'mm', '厘米': 'cm',
  'cm': 'cm', '公分': 'cm',
  'm': 'm', '公尺': 'm', '米': 'm',
  'km': 'km', '公里': 'km',
  // 面積
  'm2': 'm2', '㎡': 'm2', '平方公尺': 'm2', '平方米': 'm2', 'sqm': 'm2',
  'cm2': 'cm2', '平方公分': 'cm2',
  'ha': 'ha', '公頃': 'ha',
  // 體積
  'm3': 'm3', '㎥': 'm3', '立方公尺': 'm3', '立方米': 'm3', 'cum': 'm3',
  'cm3': 'cm3', '立方公分': 'cm3',
  'l': 'l', '公升': 'l', 'liter': 'l',
  // 質量
  'g': 'g', '公克': 'g', '克': 'g',
  'kg': 'kg', '公斤': 'kg', '千克': 'kg',
  't': 't', '噸': 't', '公噸': 't', 'ton': 't', 'tonne': 't',
  // 時間(本 repo 既有檢查表以「分」表示分鐘、「天」表示日——沿用該慣例)
  'min': 'min', '分': 'min', '分鐘': 'min',
  'h': 'h', 'hr': 'h', '小時': 'h', '時': 'h',
  'd': 'd', '天': 'd', '日': 'd',
  // 溫度(只做同單位比對,不換算)
  '°c': 'degc', '℃': 'degc', 'degc': 'degc', '攝氏': 'degc', '度c': 'degc',
}

// 量綱與換算到基準單位的固定係數
const FACTORS: Record<string, { dim: UnitDimension; base: number }> = {
  mm: { dim: 'length', base: 0.001 }, cm: { dim: 'length', base: 0.01 }, m: { dim: 'length', base: 1 }, km: { dim: 'length', base: 1000 },
  cm2: { dim: 'area', base: 0.0001 }, m2: { dim: 'area', base: 1 }, ha: { dim: 'area', base: 10000 },
  cm3: { dim: 'volume', base: 0.000001 }, l: { dim: 'volume', base: 0.001 }, m3: { dim: 'volume', base: 1 },
  g: { dim: 'mass', base: 0.001 }, kg: { dim: 'mass', base: 1 }, t: { dim: 'mass', base: 1000 },
  min: { dim: 'time', base: 1 }, h: { dim: 'time', base: 60 }, d: { dim: 'time', base: 1440 },
  degc: { dim: 'temperature', base: 1 },
}

/** 正規化單位字串;空字串代表「沒寫單位」。認不得的單位原樣保留(opaque,只能字面比對)。 */
export function canonicalUnit(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let s = toHalf(raw).trim().replace(/\s+/g, '')
  if (!s) return ''
  s = s.replace(/[²㎠]/g, '2').replace(/[³㎤]/g, '3').toLowerCase()
  // 「m^2」「m**2」「m 2」等寫法
  s = s.replace(/\^|\*\*/g, '')
  return ALIASES[s] ?? s
}

export const unitDimension = (canonical: string): UnitDimension =>
  (FACTORS[canonical]?.dim ?? 'opaque')

export type UnitConversion =
  | { ok: true; value: number; converted: boolean; note: string | null }
  | { ok: false; code: 'missing_from' | 'missing_to' | 'incompatible'; reason: string }

/**
 * 把「紙上／板上讀到的數值」換算成「目標單位(標單工項或檢查項目)」。
 * 沒寫單位一律拒絕:沒有單位就無法證明同一件事,不能拿數字硬填。
 */
export function convertQuantity(value: number, fromRaw: unknown, toRaw: unknown): UnitConversion {
  const from = canonicalUnit(fromRaw)
  const to = canonicalUnit(toRaw)
  if (!from) return { ok: false, code: 'missing_from', reason: `紙本／告示板沒有寫單位,無法確認與${to ? `單位「${toRaw}」` : '應填單位'}相同` }
  if (!to) return { ok: false, code: 'missing_to', reason: `應填欄位沒有設定單位,無法核對紙本單位「${fromRaw}」` }
  if (from === to) return { ok: true, value, converted: false, note: null }
  const f = FACTORS[from]
  const t = FACTORS[to]
  if (!f || !t || f.dim !== t.dim || f.dim === 'temperature') {
    return { ok: false, code: 'incompatible', reason: `紙本單位「${fromRaw}」與應填單位「${toRaw}」不相容,未自動帶入` }
  }
  // 固定係數換算;只做浮點誤差修整(12 位有效位),不做業務四捨五入
  const converted = Number(((value * f.base) / t.base).toPrecision(12))
  return { ok: true, value: converted, converted: true, note: `已由 ${fromRaw} 換算為 ${toRaw}(${value} → ${converted})` }
}

/** 兩個單位是否指同一件事(同代碼,或同量綱可換算)。給「只需判斷相容」的呼叫端。 */
export function unitsCompatible(a: unknown, b: unknown): boolean {
  const ca = canonicalUnit(a)
  const cb = canonicalUnit(b)
  if (!ca || !cb) return false
  if (ca === cb) return true
  const fa = FACTORS[ca]
  const fb = FACTORS[cb]
  return !!fa && !!fb && fa.dim === fb.dim && fa.dim !== 'temperature'
}
