// 本機與 CI 共用的 pgTAP runner。
// 每次執行都用 Supabase CLI 從零建一個「一次性」資料庫:獨立 project_id(帶 pid)→ 獨立容器、
// volume、網路;`supabase db start` 會照 config.toml 跑服務 migration(auth／storage／realtime)、
// 套全部 supabase/migrations 與 seed.sql——與 CI 以前的 `supabase db reset` 是同一段 CLI 流程,
// 所以本機結果與 CI 一致且可重現。跑完 `supabase stop --no-backup` 刪掉。
// 絕不連接 `supabase start` 起的共用開發資料庫(`supabase_db_<project_id>`),它不需要在跑。
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { createServer } from 'node:net'
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

// 一次性專案 id 帶 pid:平行執行(兩個 worktree 同時跑)互不干擾,殘留也能辨識(pid 已不存在才算殘留)。
export function throwawayId(projectId, pid) {
  return `${projectId}_pgtap_${pid}`
}

// names:容器的 com.supabase.cli.project 標籤(就是 id)或 volume 名稱(supabase_<service>_<id>,
// service 可能含底線,如 edge_runtime),一律以結尾比對。
export function staleThrowaways(names, projectId, isAlive) {
  const pattern = new RegExp(`(?:^|_)${projectId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_pgtap_(\\d+)$`)
  const stale = new Set()
  for (const name of names) {
    const pid = name.match(pattern)?.[1]
    if (pid && !isAlive(Number(pid))) stale.add(throwawayId(projectId, pid))
  }
  return [...stale]
}

// 只改 project_id 與 [db] port,其餘設定原樣:一次性 DB 的前提(major_version、seed、各服務
// enabled 旗標)要與 config.toml 一致,CLI 才會跑同一組服務 migration。
export function throwawayConfig(toml, { projectId, dbPort }) {
  let section = ''
  let hasId = false, hasPort = false
  const lines = toml.split(/\r?\n/).map((line) => {
    const header = line.match(/^\[([^\]]+)\]\s*$/)
    if (header) { section = header[1]; return line }
    if (section === '' && /^project_id\s*=/.test(line)) { hasId = true; return `project_id = "${projectId}"` }
    if (section === 'db' && /^port\s*=/.test(line)) { hasPort = true; return `port = ${dbPort}` }
    return line
  })
  if (!hasId || !hasPort) throw new Error('supabase/config.toml 缺 project_id 或 [db] port')
  return lines.join('\n')
}

// 複製到臨時工作目錄的 supabase/ 內容:CLI 只需要 config、migrations、seed(與 roles.sql 之類的
// 設定引用檔);functions／tests 不需要,.temp／.branches 是 CLI 自己的狀態,不能帶過去。
export function keepInWorkdir(relPath) {
  return !['functions', 'tests', '.temp', '.branches'].includes(relPath.split(sep)[0])
}

const sh = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
const output = (result) => (result.error?.message || '') + (result.stdout || '') + (result.stderr || '')
const must = (result, what) => {
  if (result.status !== 0) throw new Error(`${what} 失敗\n${output(result)}`)
  return result
}
const lines = (result) => (result.stdout || '').split('\n').filter(Boolean)

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

// 容器有 com.supabase.cli.project 標籤;volume 只能靠名稱。
function throwawayNames() {
  return [
    ...lines(sh('docker', ['ps', '-a', '--filter', 'label=com.supabase.cli.project', '--format', '{{.Label "com.supabase.cli.project"}}'])),
    ...lines(sh('docker', ['volume', 'ls', '-q'])),
  ]
}

// `supabase stop` 依標籤刪容器／volume／網路;`db start` 另建的 edge_runtime volume 沒標籤,補刪。
function teardown(id) {
  const stop = sh('supabase', ['stop', '--project-id', id, '--no-backup', '--yes'])
  if (stop.status !== 0) console.error(`supabase stop ${id} 失敗:\n${output(stop)}`)
  const leftovers = lines(sh('docker', ['volume', 'ls', '-q'])).filter((name) => name.endsWith(`_${id}`))
  if (leftovers.length) sh('docker', ['volume', 'rm', ...leftovers])
}

async function main() {
  const configToml = readFileSync('supabase/config.toml', 'utf8')
  const projectId = configToml.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1]
  if (!projectId) throw new Error('supabase/config.toml 缺 project_id')
  const files = readdirSync('supabase/tests').filter((file) => file.endsWith('.sql')).sort()
  if (!files.length) throw new Error('沒有 pgTAP 測試')
  must(sh('supabase', ['--version']), '需要 Supabase CLI;supabase --version')
  must(sh('docker', ['info']), '需要 Docker;docker info')

  for (const id of staleThrowaways(throwawayNames(), projectId, isAlive)) {
    console.error(`清除上次中斷殘留的一次性資料庫 ${id}`)
    teardown(id)
  }

  const id = throwawayId(projectId, process.pid)
  const workdir = mkdtempSync(join(tmpdir(), 'pmis-pgtap-'))
  const supabaseDir = resolve('supabase')
  cpSync(supabaseDir, join(workdir, 'supabase'), { recursive: true, filter: (src) => keepInWorkdir(relative(supabaseDir, src)) })
  writeFileSync(join(workdir, 'supabase', 'config.toml'), throwawayConfig(configToml, { projectId: id, dbPort: await freePort() }))
  const cleanup = () => { teardown(id); rmSync(workdir, { recursive: true, force: true }) }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup(); process.exit(130) })

  try {
    const migrations = readdirSync('supabase/migrations').filter((file) => file.endsWith('.sql')).length
    console.log(`建立一次性資料庫 ${id}:supabase db start 從零套用 ${migrations} 支 migration 與 seed…`)
    const started = Date.now()
    must(sh('supabase', ['db', 'start', '--workdir', workdir, '--yes']), 'supabase db start')
    console.log(`一次性資料庫就緒(${Math.round((Date.now() - started) / 1000)} 秒)`)

    const container = `supabase_db_${id}`
    const psql = (sql) => sh('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-f', '-'], { input: sql })
    must(psql('create extension if not exists pgtap with schema public;'), '安裝 pgtap')
    let total = 0, failures = 0
    for (const file of files) {
      const result = psql('set search_path = extensions, public;\n' + readFileSync(`supabase/tests/${file}`, 'utf8'))
      const tap = tapResult(output(result), result.status)
      total += tap.passed
      if (!tap.ok) {
        failures++
        console.error(`${file}: FAIL ${JSON.stringify(tap)}\n${output(result)}`)
      } else console.log(`${file}: ${tap.passed} passed`)
    }
    console.log(`pgTAP: ${files.length} files, ${total} passed, ${failures} failed files (${container})`)
    process.exitCode = failures ? 1 : 0
  } finally {
    cleanup()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
