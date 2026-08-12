import { describe, it, expect } from 'vitest'
import { matchLeaf } from './photoMatch.js'

// 描述取自真實 PCCES 標單的常見寫法——這組測試釘住 dry-run 抓到的「配對率 0%」bug:
// 短關鍵詞被長度比評分判死,完美包含卻不及格。
const LEAVES = [
  { item_key: 'A', description: '鋼筋,SD420W,#4(D13),加工及組立' },
  { item_key: 'B', description: '模板,普通模板,樓版,含支撐' },
  { item_key: 'C', description: '結構用混凝土,預拌,280kgf/cm2,澆置' },
  { item_key: 'D', description: '清除及掘除,t=20cm,表土' },
]

describe('matchLeaf(照片 AI 關鍵詞 → 標單工項)', () => {
  it('短關鍵詞「鋼筋」要配得上含鋼筋的工項(dry-run 0% 配對率的根因)', () => {
    expect(matchLeaf('鋼筋', LEAVES)?.item_key).toBe('A')
  })

  it('完整詞彙「鋼筋加工及組立」配鋼筋工項', () => {
    expect(matchLeaf('鋼筋加工及組立', LEAVES)?.item_key).toBe('A')
  })

  it('「混凝土澆置」配混凝土工項', () => {
    expect(matchLeaf('混凝土澆置', LEAVES)?.item_key).toBe('C')
  })

  it('完全不相干的詞寧可不配(不硬套)', () => {
    expect(matchLeaf('電梯機坑防水', LEAVES)).toBeNull()
  })

  it('空字串/空白不配', () => {
    expect(matchLeaf('', LEAVES)).toBeNull()
    expect(matchLeaf('  ', LEAVES)).toBeNull()
  })

  it('覆蓋率越高分越高:完整詞彙勝過同樣包含的短詞', () => {
    const short = matchLeaf('模板', LEAVES)
    const full = matchLeaf('普通模板含支撐', LEAVES)
    expect(short?.item_key).toBe('B')
    expect(full?.item_key).toBe('B')
  })
})
