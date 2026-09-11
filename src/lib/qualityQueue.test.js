// W8-4A:品質頁工作佇列的三條紅線,用測試釘住——
// 1) 佇列只收 quality domain:工安缺失屬 /safety,點了卻在下方分段找不到的項目不准出現。
// 2) 試驗到期只給廠商:填試驗值吃 can.edit(=廠商),給監造/機關就是做不到的假待辦。
// 3) AI 草稿(agent_actions)與未核定 Requirement 是「結構上進不來」——函式根本不收
//    這兩種輸入,塞了也不改變輸出;這是紅線的保證方式,不是靠呼叫端自律。
import { describe, it, expect } from 'vitest'
import { buildQualityQueue, QUALITY_QUEUE_LIMIT } from './Quality.jsx'

// today 固定注入:純函式不讀時鐘,逾期天數才能寫死斷言
const TODAY = '2026-08-15'

const fixture = () => ({
  inspections: [
    { id: 'I1', title: '4F 柱牆鋼筋查驗', status: '待查驗' },       // 球在監造
    { id: 'I2', title: '3F 柱牆鋼筋查驗', status: '合格' },         // done,不進佇列
  ],
  defects: [
    { id: 'D1', domain: 'quality', title: '3F 西側牆面蜂窩', status: '開立' },     // 球在廠商
    { id: 'D2', domain: 'quality', title: '打樣缺失', status: '改善中' },          // 球在廠商
    { id: 'D3', domain: 'quality', title: '模板缺失', status: '待複查' },          // 球在監造
    { id: 'D4', domain: 'quality', title: '已結案缺失', status: '已結案' },        // done
    { id: 'DS', domain: 'safety', title: '臨邊開口未設護欄', status: '開立' },     // 工安,不屬本頁
  ],
  observations: [
    { id: 'O1', title: '開口未設護欄', status: '待處理', assigned_to: 'contractor' },
    { id: 'O2', title: '模板支撐間距', status: '待處理', assigned_to: 'supervisor' },
    { id: 'O3', title: '鋼筋堆置未墊高', status: '已處理', assigned_to: 'contractor' }, // done
  ],
  testSamples: [
    { id: 'T1', sample_no: 'TS-1', test_item: '混凝土抗壓', status: '待試驗',
      d7_due: '2026-08-10', d7_value: null, d28_due: '2026-09-05', d28_values: null }, // 7天逾期5天;28天在7日門檻外
    { id: 'T2', sample_no: 'TS-2', test_item: '混凝土抗壓', status: '合格',
      d7_due: '2026-08-01', d7_value: 300, d28_due: '2026-08-10', d28_values: [448, 431, 442] }, // 已判定,不再提醒
  ],
})

describe('三角色分流', () => {
  it('contractor:開立/改善中缺失＋指派給廠商的觀察＋試驗到期', () => {
    const q = buildQualityQueue('contractor', fixture(), TODAY)
    expect(q.map((x) => x.key)).toEqual(['缺失:D1', '缺失:D2', '觀察:O1', '試驗:T1:7天試驗'])
    expect(q.map((x) => x.segment)).toEqual(['缺失', '缺失', '觀察', '試驗'])
  })
  it('supervisor:待查驗＋待複查缺失＋指派給監造的觀察,沒有試驗', () => {
    const q = buildQualityQueue('supervisor', fixture(), TODAY)
    expect(q.map((x) => x.key)).toEqual(['查驗:I1', '缺失:D3', '觀察:O2'])
    expect(q.map((x) => x.segment)).toEqual(['查驗', '缺失', '觀察'])
  })
  it('owner:皆空(本頁對機關是唯讀觀察,不製造做不到的待辦)', () => {
    expect(buildQualityQueue('owner', fixture(), TODAY)).toEqual([])
  })
})

describe('範圍紅線', () => {
  it('safety domain 缺失不出現在任何角色的佇列(本頁只管品質)', () => {
    for (const org of ['contractor', 'supervisor', 'owner']) {
      const q = buildQualityQueue(org, fixture(), TODAY)
      expect(q.some((x) => x.title.includes('臨邊開口'))).toBe(false)
    }
  })
  it('試驗只給 contractor;固定 today 斷言逾期天數與呈現詞彙(W8-2 dueText)', () => {
    const item = buildQualityQueue('contractor', fixture(), TODAY).find((x) => x.tag === '試驗')
    expect(item.title).toBe('TS-1 混凝土抗壓 7天試驗')
    expect(item.meta).toBe('逾期 5 天（到期 2026-08-10）')
    expect(item.segment).toBe('試驗')
    // 28 天在 7 日門檻外不提醒;監造/機關完全沒有試驗項
    expect(buildQualityQueue('contractor', fixture(), TODAY).filter((x) => x.tag === '試驗')).toHaveLength(1)
    expect(buildQualityQueue('supervisor', fixture(), TODAY).some((x) => x.tag === '試驗')).toBe(false)
    expect(buildQualityQueue('owner', fixture(), TODAY).some((x) => x.tag === '試驗')).toBe(false)
  })
})

describe('上限與排序穩定', () => {
  it('同輸入兩次呼叫結果相等(排序穩定,無隨機因素)', () => {
    const a = buildQualityQueue('contractor', fixture(), TODAY)
    const b = buildQualityQueue('contractor', fixture(), TODAY)
    expect(a).toEqual(b)
  })
  it('函式回傳完整清單,上限由 UI 依 QUALITY_QUEUE_LIMIT 截斷並顯示「還有 N 項」', () => {
    expect(QUALITY_QUEUE_LIMIT).toBe(6)
    const data = fixture()
    // 灌到超過上限:函式不截斷(UI 才知道總數,才算得出「還有 N 項」)
    data.defects = Array.from({ length: 9 }, (_, i) => (
      { id: `DX${i}`, domain: 'quality', title: `缺失 ${i}`, status: '開立' }
    ))
    const q = buildQualityQueue('contractor', data, TODAY)
    expect(q.length).toBeGreaterThan(QUALITY_QUEUE_LIMIT)
    expect(q.filter((x) => x.tag === '缺失')).toHaveLength(9)
  })
})

describe('AI 不進佇列(結構保證)', () => {
  it('傳入 agentActions / requirements 等多餘欄位不改變輸出', () => {
    const base = buildQualityQueue('contractor', fixture(), TODAY)
    const polluted = buildQualityQueue('contractor', {
      ...fixture(),
      agentActions: [{ id: 'AA1', kind: 'draft', title: 'AI 草稿缺失', status: 'pending' }],
      requirements: [{ id: 'R1', title: '未核定建議', status: '待審' }],
      rfis: [{ id: 'RFI1', title: '不屬本頁的協作項', status: '待回覆' }],
    }, TODAY)
    expect(polluted).toEqual(base)
  })
})
