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
const stage = process.argv[2]
const cases = {
  report:      { role: 'A', event_date: '2026-07-13', result: null, note: 'R4 甲案竣工申報' },
  confirm:     { role: 'B', event_date: '2026-07-15', result: null, note: 'R4 竣工確認會勘完成' },
  initial:     { role: 'C', event_date: '2026-07-17', result: '不合格', note: 'R4 初驗不合格：門窗收邊待改善' },
  fix:         { role: 'A', event_date: '2026-07-19', result: null, note: 'R4 已完成門窗收邊改善並提送' },
  reinspect:   { role: 'B', event_date: '2026-07-21', result: '合格', note: 'R4 複驗合格' },
  final:       { role: 'C', event_date: '2026-07-25', result: '合格', note: 'R4 正式驗收合格' },
  certificate: { role: 'C', event_date: '2026-07-30', result: null, note: 'R4 結算驗收證明書核發' },
  warranty:    { role: 'C', event_date: '2026-07-25', result: null, note: 'R4 保固自正式驗收合格日起算' },
}
if (!cases[stage]) throw new Error(`unknown stage ${stage}`)
const cfg = cases[stage]
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { error: authError } = await db.auth.signInWithPassword({
  email: state.emails[cfg.role], password: state.password,
})
if (authError) throw authError
const { data: existing } = await db.from('acceptance_events').select('*')
  .eq('project_id', state.alpha.id).eq('stage_key', stage).maybeSingle()
if (existing) {
  console.log(JSON.stringify({ stage, role: cfg.role, skipped: true, row: existing }))
  process.exit(0)
}
const { data, error } = await db.from('acceptance_events').insert({
  project_id: state.alpha.id, stage_key: stage,
  event_date: cfg.event_date, result: cfg.result, note: cfg.note,
}).select().single()
if (error) throw error
console.log(JSON.stringify({ stage, role: cfg.role, row: data }))
