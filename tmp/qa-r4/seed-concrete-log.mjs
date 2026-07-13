import fs from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  (await fs.readFile(new URL('../../.env', import.meta.url), 'utf8'))
    .split(/\r?\n/).filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1)]
    }),
)
const state = JSON.parse(await fs.readFile(new URL('./state.json', import.meta.url), 'utf8'))
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data: auth, error: authError } = await db.auth.signInWithPassword({
  email: state.emails.A, password: state.password,
})
if (authError) throw authError
const logDate = '2026-06-10'
const { data: existing } = await db.from('daily_logs').select('*')
  .eq('project_id', state.alpha.id).eq('log_date', logDate).maybeSingle()
if (existing) {
  console.log(JSON.stringify({ skipped: true, row: existing }))
  process.exit(0)
}
const { data, error } = await db.from('daily_logs').insert({
  project_id: state.alpha.id,
  log_date: logDate,
  weather: '晴', weather_am: '晴', weather_pm: '晴',
  work_summary: 'R4 甲案 5F 梁版混凝土澆置（另一組，避開既有同日去重）',
  materials: [{ name: '預拌混凝土 280 kgf/cm²', unit: 'm³', qty: 36 }],
  extras: { sampling: '已依 03310 取樣 6 顆試體' },
  status: '已送出', created_by: auth.user.id,
}).select().single()
if (error) throw error
console.log(JSON.stringify({ row: data }))
