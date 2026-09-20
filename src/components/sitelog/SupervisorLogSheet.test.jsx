// @vitest-environment jsdom
// 公共工程監造報表(附表五)紙本＝監造的編輯畫面(2026-09-20 C2 包)。釘住:
//   1) 它是**日報**不是監造月報:標題、標示與註記都照原表,提到「月報」只能是否定句;
//   2) 版面用原表節次(一~五)與表頭欄名,格內可編;
//   3) 表頭的工期／進度／契約變更次數是確定性計算,算不出來印「待補」——不猜、不填 0;
//      契約金額兩格本系統沒有同口徑資料,不自動帶入、未填印「待補」;
//   4) 到場人員是原表沒有的格:標明「本系統欄位」,而且人填了只是「已填・待親自確認」;
//   5) 可編角色是監造:廠商與機關開同一張紙不長出輸入框,列印視角完全沒有 input;
//   6) 簽署版本印它自己當時的範本版本。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import SupervisorLogSheet from './SupervisorLogSheet.jsx'
import { supervisorReportHeaderFacts } from '../../lib/officialForms.js'

let container, root
const project = { project_name: 'A 標 道路改善工程', contractor_name: '甲營造', commencement_date: '2026-03-01', end_date: '2026-12-31' }
const doc = { id: 'DS', doc_type: 'supervisor_log', doc_date: '2026-09-20', status: 'draft', current_version_no: 1, owner_org: 'supervisor' }
const state = (over = {}) => ({
  content: {
    log_date: '2026-09-20', weather_am: '晴', weather_pm: '多雲',
    attendance: [], supervision_items: [], inspection_ids: [], notices: [], followups: [],
    contractor_summary: null, daily_log_receipt: null, note: null, ...over,
  },
  sources: {
    log_date: { status: 'confirmed', source: 'human' },
    weather_am: { status: 'filled', source: 'cwa' }, weather_pm: { status: 'filled', source: 'cwa' },
    attendance: { status: 'pending', source: null }, supervision_items: { status: 'pending', source: null },
    contractor_summary: { status: 'pending', source: null },
  },
})
const facts = (over = {}) => supervisorReportHeaderFacts({ project, logDate: '2026-09-20', changeOrders: [], ...over })

const render = async (props) => {
  await act(async () => { root.render(<SupervisorLogSheet project={project} doc={doc} stamp={null} {...props} />) })
}
const inputs = () => [...container.querySelectorAll('input, select, textarea')]
const byLabel = (l) => inputs().find((el) => el.getAttribute('aria-label') === l)
const text = () => container.textContent
const editCtx = (st, org = 'supervisor') => ({ org, editable: true, onChange: () => {}, state: st, photosById: new Map() })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('監造報表(附表五)紙本:監造直接在原表格子裡編輯', () => {
  it('是日報不是監造月報;原表五節與表頭欄名都在紙上', async () => {
    const st = state()
    await render({ content: st.content, sources: st.sources, facts: facts(), edit: editCtx(st) })
    expect(text()).toContain('公 共 工 程 監 造 報 表')
    expect(text()).toContain('附表五')
    expect(text()).toContain('按日填報')
    // 紙上提到「月報」的地方只能是否定句(它不是監造月報),不得把這張表當月報呈現
    const all = text()
    for (const m of all.matchAll(/月報/g)) expect(all.slice(Math.max(0, m.index - 4), m.index)).toMatch(/非|不是/)
    expect(text()).toContain('一、工程進行情況（含約定之重要施工項目及數量）')
    expect(text()).toContain('二、監督依照設計圖說及核定施工圖說施工（含約定之檢驗停留點及施工抽查等情形）')
    expect(text()).toContain('三、查核材料規格及品質（含約定之檢驗停留點、材料設備管制及檢（試）驗等抽驗情形）')
    expect(text()).toContain('四、督導工地職業安全衛生事項')
    expect(text()).toContain('（一）施工廠商施工前檢查事項辦理情形')
    expect(text()).toContain('五、其他約定監造事項（含重要事項紀錄、主辦機關指示及通知廠商辦理事項等）')
    expect(text()).toContain('監造單位簽章')
    expect(byLabel('本日天氣上午').value).toBe('晴')
  })

  it('表頭的工期與進度算得出來就印數字、算不出來印待補;契約變更次數由系統算', async () => {
    const st = state()
    const withCo = facts({ changeOrders: [{ status: '核准', co_date: '2026-05-01', items: [] }], progressPlan: null })
    await render({ content: st.content, sources: st.sources, facts: withCo, edit: editCtx(st) })
    expect(text()).toContain('306 天') // 2026-03-01 → 2026-12-31 含頭尾
    expect(text()).toContain('契約變更次數')
    expect(text()).toContain('1 次')
    expect(text()).toContain('預定進度(%)：')
    // 沒有預定進度表／沒有估驗 → 待補,不是 0
    expect(text()).not.toContain('0 %')
  })

  it('契約金額兩格不自動帶入:未填印待補,並說明為什麼不帶標單合計', async () => {
    const st = state()
    await render({ content: st.content, sources: st.sources, facts: facts(), edit: editCtx(st) })
    expect(text()).toContain('契約金額（原契約）')
    expect(text()).toContain('契約金額（變更後契約）')
    expect(text()).toContain('待補')
    expect(text()).toContain('發包末端工項合計')
    expect(byLabel('原契約金額').value).toBe('')
    // 填了就印填的數字,系統不替它產生
    const filled = state({ contract_amount_original: 12000000 })
    await render({ content: filled.content, sources: filled.sources, facts: facts() })
    expect(text()).toContain('NT$ 12,000,000')
  })

  it('到場人員標明是本系統欄位(原表註 3);人填了只是「已填・待親自確認」', async () => {
    const st = state({ attendance: [{ user_id: 'U1', name: '林監造', from: '09:00', to: '12:00' }] })
    st.sources.attendance = { status: 'filled', source: 'human' }
    await render({ content: st.content, sources: st.sources, facts: facts(), edit: editCtx(st), currentUser: { user_id: 'U1', name: '林監造' } })
    expect(text()).toContain('本系統欄位，非附表五原表欄位')
    expect(text()).toContain('依原表註 3')
    expect(text()).toContain('已填・待親自確認')
    expect(text()).toContain('確認到場人員')
    expect(byLabel('林監造 到場時間').value).toBe('09:00')
    // 確認過後仍看得到「已確認」:人填欄的確認本身就是本人的具結
    const confirmed = state({ attendance: st.content.attendance })
    confirmed.sources.attendance = { status: 'confirmed', source: 'human' }
    await render({ content: confirmed.content, sources: confirmed.sources, facts: facts(), edit: editCtx(confirmed) })
    expect(text()).toContain('已確認')
  })

  it('沒有來源的非必填格不會長出誤導的「待補」章', async () => {
    const st = state()
    await render({ content: st.content, sources: st.sources, facts: facts(), edit: editCtx(st) })
    const extended = container.querySelector('#field-extended_days')
    expect(extended.textContent).not.toContain('待補')
    // 反過來:來源說 pending 的必填格要看得到待補
    expect(container.querySelector('#field-contractor_summary').textContent).toContain('待補')
  })

  it('廠商／機關視角與列印視角:不長出監造欄位的輸入框', async () => {
    const st = state({ contractor_summary: '4F 版牆混凝土澆置' })
    await render({ content: st.content, sources: st.sources, facts: facts(), edit: editCtx(st, 'contractor') })
    expect(byLabel('施工情形摘要')).toBeUndefined()
    expect(text()).toContain('4F 版牆混凝土澆置')
    await render({ content: st.content, sources: st.sources, facts: facts() })
    expect(inputs()).toHaveLength(0)
    expect(text()).toContain('參考工程會格式')
    expect(text()).toContain('未經機關核定')
  })

  it('已簽署版本印它自己當時的範本版本', async () => {
    const st = state()
    await render({ content: { ...st.content, form_template: { key: 'pcc-supervisor-log-1080430', version: 0 } }, sources: st.sources, facts: facts() })
    expect(text()).toContain('本文件建立時使用 pcc-supervisor-log-1080430 v0')
  })
})
