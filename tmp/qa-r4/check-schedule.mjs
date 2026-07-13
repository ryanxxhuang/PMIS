import fs from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries((await fs.readFile(new URL('../../.env', import.meta.url), 'utf8'))
  .split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const i = line.indexOf('=')
    return [line.slice(0, i), line.slice(i + 1)]
  }))
const state = JSON.parse(await fs.readFile(new URL('./state.json', import.meta.url), 'utf8'))
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { error: signInError } = await db.auth.signInWithPassword({ email: state.emails.A, password: state.password })
if (signInError) throw signInError
const { data, error } = await db.from('item_schedules')
  .select('id,project_id,work_item_id,planned_start,planned_finish,work_items(item_no,description)')
  .eq('project_id', state.alpha.id)
if (error) throw error
console.log(JSON.stringify(data, null, 2))
