// 本機與 CI 共用;只跑交易內的 SQL 測試,不 reset 資料庫。
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export function tapResult(output, exitCode) {
  const lines = output.split(/\r?\n/).map((line) => line.trim())
  const passed = lines.filter((line) => /^ok \d+\b/.test(line)).length
  const failed = lines.filter((line) => /^not ok\b/.test(line)).length
  const plans = lines.filter((line) => /^1\.\.\d+$/.test(line))
  const planned = plans.length === 1 ? Number(plans[0].slice(3)) : null
  const ok = exitCode === 0 && passed > 0 && failed === 0 && planned === passed
    && !lines.some((line) => /^(Bail out!|# Looks like you planned)/.test(line))
  return { ok, passed, failed, planned }
}

function main() {
  const projectId = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1]
  if (!projectId) throw new Error('supabase/config.toml 缺 project_id')
  // 不挑 docker ps 的第一台,避免另一個專案也啟動 Supabase 時測錯資料庫。
  const container = process.env.DB_CONTAINER || `supabase_db_${projectId}`
  const psql = (sql) => spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  const setup = psql('create extension if not exists pgtap with schema public;')
  if (setup.status !== 0) throw new Error(setup.error?.message || setup.stderr || '無法連接本機 DB')
  const files = readdirSync('supabase/tests').filter((file) => file.endsWith('.sql')).sort()
  if (!files.length) throw new Error('沒有 pgTAP 測試')
  let total = 0, failures = 0
  for (const file of files) {
    const result = psql('set search_path = extensions, public;\n' + readFileSync(`supabase/tests/${file}`, 'utf8'))
    const output = (result.stdout || '') + (result.stderr || '')
    const tap = tapResult(output, result.status)
    total += tap.passed
    if (!tap.ok) {
      failures++
      console.error(`${file}: FAIL ${JSON.stringify(tap)}\n${result.error?.message || output}`)
    } else console.log(`${file}: ${tap.passed} passed`)
  }
  console.log(`pgTAP: ${files.length} files, ${total} passed, ${failures} failed files (${container})`)
  process.exitCode = failures ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
