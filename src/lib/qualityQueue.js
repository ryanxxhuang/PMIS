// W8-4A 品質工作佇列「現在要處理」的確定性組裝(原本住在 pages/web/Quality.jsx,
// 重構波次 8 搬來)。搬家的理由只有一個:測試要驗這條規則,卻得先把整頁的
// import 圖(store.jsx → supabase client、十幾個元件)拉進來,一支純函式的
// 單元測試不該付那個代價。
//
// 這裡只組合既有引擎(collaborationItems + sampleAlerts),不自創任何狀態規則。
import { sampleAlerts } from './qc.js'
import { dueText } from './todayTasks.js' // 到期句與今日待辦同一支(TaskRow OVERDUE_RE / e2e 綁死句型)
import { collaborationItems } from './ballInCourt.js'

// 佇列超過上限只顯示前幾筆＋「還有 N 項」:佇列是入口不是清單,完整內容在各分段。
export const QUALITY_QUEUE_LIMIT = 6

// collaborationItems 的 tag → 品質頁分段。走白名單:未列的 tag(估驗/送審/工安缺失…)
// 一律不進佇列——品質頁只管品質 domain,佇列點了卻在下方找不到的項目不准出現。
const QUEUE_SEGMENT_OF = { 查驗: '查驗', 缺失: '缺失', 觀察: '觀察' }

// 結構上只收 { inspections, defects, observations, testSamples } 四種輸入——
// AI 草稿(agent_actions)與未核定 Requirement 根本進不來,是紅線 1 的結構保證,
// 不是靠呼叫端自律。today 由呼叫端注入(頁面 render 時的當天),純函式不讀時鐘,
// 測試才能用固定日期斷言逾期天數。
export function buildQualityQueue(org, data = {}, today) {
  const { inspections = [], observations = [], testSamples = [] } = data
  // 工安缺失屬 /safety;品質頁 DefectTracker 只列 quality domain,佇列必須同一份範圍
  const defects = (data.defects || []).filter((d) => d.domain !== 'safety')
  const out = []
  collaborationItems({ defects, inspections, observations }).forEach((it, i) => {
    if (it.who !== org) return
    const segment = QUEUE_SEGMENT_OF[it.tag]
    if (!segment) return
    // id 給頁面寫 URL 單條連結(點佇列直接選中那一筆);沒有 id 的項目只切段
    out.push({ key: `${it.tag}:${it.id ?? `${it.title}#${i}`}`, id: it.id ?? null, tag: it.tag, title: it.title, meta: it.meta, segment })
  })
  // 試驗到期只給廠商:填試驗值的欄位在試驗分段吃 can.edit(=廠商),
  // 塞給監造/機關只會是點了做不到的假待辦
  if (org === 'contractor') {
    for (const a of sampleAlerts(testSamples, today)) {
      out.push({
        key: `試驗:${a.sample.id ?? a.sample.sample_no}:${a.label}`,
        id: a.sample.id ?? null,
        tag: '試驗',
        title: `${a.sample.sample_no || ''} ${a.sample.test_item || ''} ${a.label}`.trim(),
        meta: dueText(a.days, a.due),
        segment: '試驗',
      })
    }
  }
  return out
}
