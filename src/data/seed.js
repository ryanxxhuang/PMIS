// Fallback 種子資料 — 只在「未設定 Supabase」時用：
//  · project：store 在無真實專案時的展示用 fallback
//  · users：Login 在無 Supabase 金鑰時的假角色選單（RolePicker）
//  · 完整 demo storyline（估驗/日誌/查驗/工安…）見 demoSeed.js
// 真實模式（已設金鑰）完全不會用到這兩支。

// 常青日期：demo 永遠呈現「開工第 6 個月、預定進度 ~33%」的施工中專案，
// 不會因為時間流逝變成過期或未開工的死資料。
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monthsFromNow = (n, day) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + n, day) }

const START = monthsFromNow(-5, 15)   // 開工：5 個半月前
const END = monthsFromNow(12, 30)     // 竣工：約一年後（工期 ~18 個月）

export const project = {
  project_id: 'P-DEMO-001',
  project_name: 'A 區新建工程',
  project_code: 'TPE-A-2026',
  owner_name: '臺北市政府工務局',
  contractor_name: '大華營造股份有限公司',
  supervisor_name: '宏觀工程顧問有限公司',
  location: '臺北市信義區 A 區基地',
  start_date: iso(START),
  end_date: iso(END),
  status: '施工中',
  // 契約管制基準日（決標 → 通知 → 開工）
  award_date: iso(monthsFromNow(-7, 5)),
  notice_date: iso(monthsFromNow(-6, 1)),
  commencement_date: iso(START),
}

export const users = [
  { user_id: 'U1', name: '林志明', role: 'Contractor Field Engineer', company: '大華營造', label: '施工 / 現場工程師', org_type: 'contractor' },
  { user_id: 'U2', name: '陳怡君', role: 'Contractor QC Engineer', company: '大華營造', label: '施工 / 品管工程師', org_type: 'contractor' },
  { user_id: 'U3', name: '王建國', role: 'Supervisor Engineer', company: '宏觀顧問', label: '監造 / 監造工程師', org_type: 'supervisor' },
]
