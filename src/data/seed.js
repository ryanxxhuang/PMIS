// Fallback 種子資料 — 只在「未設定 Supabase」時用：
//  · project：store 在無真實專案時的展示用 fallback
//  · users：Login 在無 Supabase 金鑰時的假角色選單（RolePicker）
// 真實模式（已設金鑰）完全不會用到這支。

export const project = {
  project_id: 'P-2026-001',
  project_name: 'A 區新建工程',
  project_code: 'TPE-A-2026',
  owner_name: '臺北市政府工務局',
  contractor_name: '大華營造股份有限公司',
  supervisor_name: '宏觀工程顧問有限公司',
  location: '臺北市信義區 A 區基地',
  start_date: '2026-01-15',
  end_date: '2027-06-30',
  status: '施工中',
}

export const users = [
  { user_id: 'U1', name: '林志明', role: 'Contractor Field Engineer', company: '大華營造', label: '施工 / 現場工程師' },
  { user_id: 'U2', name: '陳怡君', role: 'Contractor QC Engineer', company: '大華營造', label: '施工 / 品管工程師' },
  { user_id: 'U3', name: '王建國', role: 'Supervisor Engineer', company: '宏觀顧問', label: '監造 / 監造工程師' },
]
