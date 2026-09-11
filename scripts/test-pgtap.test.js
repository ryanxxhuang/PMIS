import { expect, it } from 'vitest'
import { tapResult } from './test-pgtap.js'

it('接受完整的 TAP 計畫,也接受 finish() 最後印出計畫', () => {
  expect(tapResult('1..2\nok 1 - 權限\nok 2 - 交易\n', 0).ok).toBe(true)
  expect(tapResult('ok 1 - 權限\n1..1\n', 0).ok).toBe(true)
})
it.each([
  ['', 0], ['1..0', 0], ['1..2\nok 1 - 半途 SQL 失敗', 3],
  ['1..2\nok 1 - 只跑一半', 0], ['1..1\nnot ok 1 - 不該放行', 0],
  ['ok 1 - 沒有計畫', 0], ['1..1\nok 1\nBail out! database broken', 0],
  ['1..1\nok 1\n1..1', 0], ['1..1\nok 1', null],
])('缺測、SQL 錯誤與測試失敗都讓檢查失敗 %j', (output, status) => {
  expect(tapResult(output, status).ok).toBe(false)
})
