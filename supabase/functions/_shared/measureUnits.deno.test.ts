// 單位正規化與換算的確定性規則(2026-09-20 廠商驗收 B)。Deno 直接跑:npm run test:edge
// 釘住的紅線:沒寫單位不得採用;不同量綱不得換算;認不得的單位只有字面相同才算同一件事。
import assert from 'node:assert/strict'
import { canonicalUnit, convertQuantity, unitDimension, unitsCompatible } from './measureUnits.ts'

Deno.test('canonicalUnit:全形、上標、中文單位都收斂到同一個代碼', () => {
  assert.equal(canonicalUnit('CM'), 'cm')
  assert.equal(canonicalUnit('公分'), 'cm')
  assert.equal(canonicalUnit(' MM '), 'mm')
  assert.equal(canonicalUnit('M2'), 'm2')
  assert.equal(canonicalUnit('㎡'), 'm2')
  assert.equal(canonicalUnit('m²'), 'm2')
  assert.equal(canonicalUnit('平方公尺'), 'm2')
  assert.equal(canonicalUnit('公噸'), 't')
  assert.equal(canonicalUnit('小時'), 'h')
  assert.equal(canonicalUnit(''), '')
  assert.equal(canonicalUnit(null), '')
  // 認不得的單位保留原字面(只能字面比對)
  assert.equal(canonicalUnit('式'), '式')
  assert.equal(unitDimension('cm'), 'length')
  assert.equal(unitDimension('式'), 'opaque')
})

Deno.test('convertQuantity:同量綱依固定係數換算,換算過程寫進說明', () => {
  const same = convertQuantity(18, 'cm', 'CM')
  assert.ok(same.ok && same.value === 18 && same.converted === false)
  const mm = convertQuantity(150, 'MM', 'cm')
  assert.ok(mm.ok && mm.value === 15 && mm.converted === true)
  assert.ok(mm.ok && (mm.note ?? '').includes('換算'))
  const t = convertQuantity(2500, 'kg', '公噸')
  assert.ok(t.ok && t.value === 2.5)
  const area = convertQuantity(30000, 'cm2', 'M2')
  assert.ok(area.ok && area.value === 3)
})

Deno.test('convertQuantity:沒寫單位、不同量綱、認不得的單位一律拒絕(不忽略、不硬填)', () => {
  const noFrom = convertQuantity(15, '', 'M2')
  assert.ok(!noFrom.ok && noFrom.code === 'missing_from')
  const noTo = convertQuantity(15, 'CM', '')
  assert.ok(!noTo.ok && noTo.code === 'missing_to')
  // 驗收指出的實際風險:板上「15 CM」不得變成標單 M2 的 15
  const bad = convertQuantity(15, 'CM', 'M2')
  assert.ok(!bad.ok && bad.code === 'incompatible')
  assert.ok(!bad.ok && bad.reason.includes('不相容'))
  // 溫度只比對不換算:同代碼通過
  assert.ok(convertQuantity(28, '℃', '°C').ok)
  const opaque = convertQuantity(1, '式', '座')
  assert.ok(!opaque.ok && opaque.code === 'incompatible')
  const sameOpaque = convertQuantity(3, '式', '式')
  assert.ok(sameOpaque.ok && sameOpaque.value === 3)
})

Deno.test('unitsCompatible:同代碼或同量綱才算相容', () => {
  assert.ok(unitsCompatible('MM', '公分'))
  assert.ok(unitsCompatible('T', '公噸'))
  assert.ok(!unitsCompatible('CM', 'M2'))
  assert.ok(!unitsCompatible('', 'M'))
  assert.ok(!unitsCompatible('式', '座'))
})
