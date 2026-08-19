import { describe, it, expect } from 'vitest'
import { collectEvidence, photoEvidenceLine, OVER_TOL } from './evidence.js'

// 測試素材:A=混凝土工項、B=鋼筋工項(非混凝土)
const workItemA = { id: 'uuid-A', item_key: 'A', item_no: '01', description: '結構體混凝土 420kgf/cm²', unit: 'm3', quantity: 1000 }
const workItemB = { id: 'uuid-B', item_key: 'B', item_no: '02', description: '鋼筋 SD420W', unit: 't', quantity: 500 }
const wiMaps = { idToKey: new Map([['uuid-A', 'A'], ['uuid-B', 'B']]) }

const siteLogs = [
  { log_date: '2026-07-01', work_summary: '3F 澆置', items: { A: 180, B: 10 } },
  { log_date: '2026-07-05', work_summary: '4F 澆置', items: { A: 170 } },
  { log_date: '2026-07-03', work_summary: '綁紮', items: { B: 12, A: 0 } }, // A 數量 0:不算佐證
]

describe('collectEvidence', () => {
  it('日誌:取該工項數量 > 0 的日誌,新→舊,loggedTotal 加總正確', () => {
    const ev = collectEvidence('A', { siteLogs, wiMaps, workItem: workItemA })
    expect(ev.logs.map((l) => l.log_date)).toEqual(['2026-07-05', '2026-07-01']) // 0 不入列、日期新→舊
    expect(ev.logs[0]).toEqual({ log_date: '2026-07-05', qty: 170, note: '4F 澆置' })
    expect(ev.loggedTotal).toBe(350)
    expect(ev.counts.logs).toBe(2)
  })

  it('日誌:無該工項數量 → 空陣列、loggedTotal 0', () => {
    const ev = collectEvidence('C', { siteLogs, wiMaps, workItem: { item_key: 'C', description: '模板' } })
    expect(ev.logs).toEqual([])
    expect(ev.loggedTotal).toBe(0)
  })

  it('查驗:work_item_id 經 idToKey 對應命中;他項與 null 不誤配', () => {
    const inspections = [
      { id: 'I1', title: '3F 澆置前查驗', status: '合格', work_item_id: 'uuid-A', inspected_at: '2026-07-01T10:00:00Z' },
      { id: 'I2', title: '鋼筋查驗', status: '合格', work_item_id: 'uuid-B' },
      { id: 'I3', title: '標題含混凝土但無工項連結', status: '待查驗', work_item_id: null }, // 不做標題模糊比對
    ]
    const ev = collectEvidence('A', { inspections, wiMaps, workItem: workItemA })
    expect(ev.inspections).toEqual([{ id: 'I1', title: '3F 澆置前查驗', status: '合格', inspected_at: '2026-07-01T10:00:00Z' }])
    expect(ev.counts.inspections).toBe(1)
  })

  it('查驗:demo 資料 work_item_id 直接是 item_key 也命中(無 uuid 的精確對應)', () => {
    const inspections = [{ id: 'I1', title: '查驗', status: '合格', work_item_id: 'A' }]
    const ev = collectEvidence('A', { inspections, wiMaps: { idToKey: new Map() }, workItem: workItemA })
    expect(ev.inspections).toHaveLength(1)
    expect(ev.inspections[0].inspected_at).toBeNull()
  })

  it('檢查表:work_item_id 命中取 check_date/overall;null(舊資料)為空陣列', () => {
    const checklistRecords = [
      { id: 'R1', title: '場鑄混凝土檢查表', check_date: '2026-07-01', overall: '合格', work_item_id: 'uuid-A' },
      { id: 'R2', title: '舊紀錄未寫工項', check_date: '2026-07-02', overall: '合格', work_item_id: null },
    ]
    const evA = collectEvidence('A', { checklistRecords, wiMaps, workItem: workItemA })
    expect(evA.checklists).toEqual([{ id: 'R1', title: '場鑄混凝土檢查表', check_date: '2026-07-01', overall: '合格' }])
    const evB = collectEvidence('B', { checklistRecords, wiMaps, workItem: workItemB })
    expect(evB.checklists).toEqual([])
    expect(evB.counts.checklists).toBe(0)
  })

  it('試體:混凝土工項以「取樣日=澆置日」對應並標 matchedBy', () => {
    const testSamples = [
      { id: 'S1', sample_no: 'TS-0701', sampled_date: '2026-07-01', status: '合格' },
      { id: 'S2', sample_no: 'TS-0620', sampled_date: '2026-06-20', status: '待試驗' }, // 非澆置日:不配
    ]
    const ev = collectEvidence('A', { siteLogs, testSamples, wiMaps, workItem: workItemA })
    expect(ev.samples).toEqual([
      { id: 'S1', sample_no: 'TS-0701', sampled_date: '2026-07-01', status: '合格', matchedBy: 'pour_date' },
    ])
    expect(ev.counts.samples).toBe(1)
  })

  it('試體:模板類工項(含「混凝土」字樣但非澆置)不回試體', () => {
    // 「場鑄結構混凝土用模板」含「混凝土」但 isConcretePourItem=false —— 模板沒有試體
    const workItemF = { id: 'uuid-F', item_key: 'F', item_no: '03', description: '場鑄結構混凝土用模板，普通模板，(建築，建築物)', unit: 'm2', quantity: 800 }
    const logsF = [{ log_date: '2026-07-01', work_summary: '3F 模板組立', items: { F: 120 } }]
    const testSamples = [{ id: 'S1', sample_no: 'TS-0701', sampled_date: '2026-07-01', status: '合格' }]
    const ev = collectEvidence('F', { siteLogs: logsF, testSamples, wiMaps: { idToKey: new Map([['uuid-F', 'F']]) }, workItem: workItemF })
    expect(ev.logs).toHaveLength(1) // 日誌佐證照常
    expect(ev.samples).toEqual([])  // 但不掛試體
    expect(ev.counts.samples).toBe(0)
  })

  it('試體:非混凝土工項一律空陣列(即使取樣日撞到該工項的日誌日期)', () => {
    const testSamples = [{ id: 'S1', sample_no: 'TS-0701', sampled_date: '2026-07-01', status: '合格' }]
    const ev = collectEvidence('B', { siteLogs, testSamples, wiMaps, workItem: workItemB })
    expect(ev.samples).toEqual([])
  })

  it('試體:混凝土工項但無日誌 → 無澆置日可對,空陣列', () => {
    const testSamples = [{ id: 'S1', sample_no: 'TS-0701', sampled_date: '2026-07-01', status: '合格' }]
    const ev = collectEvidence('A', { siteLogs: [], testSamples, wiMaps, workItem: workItemA })
    expect(ev.samples).toEqual([])
  })

  it('無任何佐證:counts 全 0', () => {
    const ev = collectEvidence('A', { wiMaps, workItem: workItemA })
    expect(ev.counts).toEqual({ logs: 0, inspections: 0, checklists: 0, samples: 0 })
    expect(ev.loggedTotal).toBe(0)
  })

  it('OVER_TOL 與稽核共用同一容忍值', () => {
    expect(OVER_TOL).toBe(1.05)
  })
})

describe('photoEvidenceLine', () => {
  it('有施作區域時前綴帶出(區域・說明)', () => {
    expect(photoEvidenceLine({ location: 'A區1F', caption: '柱牆混凝土澆置' })).toBe('A區1F・柱牆混凝土澆置')
  })

  it('舊照片無 location(null/未帶欄位)只顯示說明,行為不變', () => {
    expect(photoEvidenceLine({ location: null, caption: '柱牆混凝土澆置' })).toBe('柱牆混凝土澆置')
    expect(photoEvidenceLine({ caption: '柱牆混凝土澆置' })).toBe('柱牆混凝土澆置')
  })

  it('只有 location(AI 讀到板子但沒生說明)仍要看得到區域', () => {
    expect(photoEvidenceLine({ location: 'B棟3F 柱牆', caption: null })).toBe('B棟3F 柱牆')
  })

  it('兩者皆無回空字串,佔位符交給呼叫端', () => {
    expect(photoEvidenceLine({})).toBe('')
    expect(photoEvidenceLine(null)).toBe('')
    expect(photoEvidenceLine({ location: '  ', caption: '  ' })).toBe('') // 空白字串不算辨識到
  })
})
