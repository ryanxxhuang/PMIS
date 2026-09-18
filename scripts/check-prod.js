// 部署後核對正式站與 demo 站的 HTML 與安全標頭(D-025:第三方腳本只能由 repo 明示引入,
// 邊緣層不得自動注入)。每個 HTML 頁面檢查:
//   1) 回 200;
//   2) Content-Security-Policy 回應標頭含 script-src 'self';
//   3) Cache-Control 含 no-transform——這是叫 Cloudflare 不要改寫 HTML(不注入 JavaScript
//      Detections、Web Analytics beacon 等)的機制,少了它注入隨時會回來;
//   4) HTML 裡的每個 <script> 都必須是 repo index.html 明示引入的那幾支(build 後的
//      ./theme-boot.js 與 Vite 入口 ./assets/index-<hash>.js);行內腳本一律不允許
//      (CSP script-src 'self' 本來就不讓 repo 出貨行內腳本,出現就是邊緣注入)。
//      以「允許清單」而不是「已知注入樣式黑名單」判定,cf-beacon、challenge-platform/jsd、
//      Rocket Loader、email-decode 或未來任何新玩意都會被抓到。
// 另外對每頁的 Vite 入口 chunk 做 HEAD:雜湊資產必須維持 immutable 且不得帶 no-transform
// (帶了會失去 brotli 壓縮,見 public/_headers 的說明),並確認仍有壓縮。
// 用法:npm run check:prod  (或 node scripts/check-prod.js https://其他網址/ ...)
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PAGES = [
  'https://app.gov-agent.ai/',
  'https://app.gov-agent.ai/login', // SPA fallback 路由:_headers 對它的套用方式與 / 不同,分開驗
  'https://app.gov-agent.ai/demo/', // build:demo 建到 dist/demo 的銷售簡報站,同一個 Worker
  'https://demo.gov-agent.ai/',
  'https://demo.gov-agent.ai/login',
]
// 邊緣注入的部分功能只對瀏覽器請求發生(Web Analytics beacon 就是),用瀏覽器 UA 才看得到
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36'
const TIMEOUT_MS = 20000

// 抽出 HTML 裡的 <script> 標籤(略過註解)。src 為 null 代表行內腳本。
export function scriptTags(html) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '')
  return [...withoutComments.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map(([, attrs, body]) => {
    const src = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    return { src: src ? (src[1] ?? src[2] ?? src[3]) : null, body: body.trim() }
  })
}

// 從 repo 的 index.html(D-025 的「明示引入」唯一真相)推導 build 後允許出現的 script src。
// Vite 以 base './' 建置:/theme-boot.js 這種 public/ 檔案變成 ./theme-boot.js;
// /src/main.jsx 這種入口模組變成 ./assets/index-<hash>.js(入口 chunk 以 html 檔名為名)。
export function allowedScripts(indexHtml) {
  return scriptTags(indexHtml).filter(({ src }) => src).map(({ src }) => {
    if (src.startsWith('/src/')) return { source: src, pattern: /^\.\/assets\/index-[\w-]+\.js$/ }
    const literal = `./${src.replace(/^\//, '')}`
    return { source: src, pattern: new RegExp(`^${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }
  })
}

// 回傳不在允許清單內的 script(行內或 src 不符)的簡短描述;空陣列即乾淨。
export function foreignScripts(html, allowed) {
  return scriptTags(html).flatMap(({ src, body }) => {
    if (src === null) return [`行內腳本 ${JSON.stringify(body.slice(0, 80))}`]
    return allowed.some(({ pattern }) => pattern.test(src)) ? [] : [`外來腳本 src=${src}`]
  })
}

// CSP 的 script-src 來源清單;沒有這個 directive 回 null。
export function cspScriptSources(csp) {
  const directive = csp.split(';').map((part) => part.trim().split(/\s+/)).find(([name]) => name.toLowerCase() === 'script-src')
  return directive ? directive.slice(1) : null
}

// 純函式:把一個 HTML 頁面的回應狀態、標頭與內容對照規則,回傳問題清單。
export function evaluatePage({ status, headers, html, allowed }) {
  const problems = []
  const header = (name) => headers.get(name) || ''
  if (status !== 200) problems.push(`status=${status}`)
  // script-src 必須恰好是 'self':多任何一個來源(unsafe-inline、nonce、第三方主機)都是放寬
  const scriptSources = cspScriptSources(header('content-security-policy'))
  if (!scriptSources || scriptSources.join(' ') !== "'self'") problems.push(`CSP script-src 不是恰好 'self'(現值:${scriptSources ? scriptSources.join(' ') : '無'})`)
  if (!/\bno-transform\b/i.test(header('cache-control'))) problems.push(`Cache-Control 缺 no-transform(現值:${header('cache-control') || '無'})`)
  problems.push(...foreignScripts(html, allowed))
  return problems
}

// 純函式:雜湊資產的回應必須維持永久快取與壓縮。
export function evaluateAsset({ status, headers }) {
  const problems = []
  const cacheControl = headers.get('cache-control') || ''
  if (status !== 200) problems.push(`status=${status}`)
  if (!/\bimmutable\b/i.test(cacheControl)) problems.push(`資產 Cache-Control 缺 immutable(現值:${cacheControl || '無'})`)
  if (/\bno-transform\b/i.test(cacheControl)) problems.push('資產 Cache-Control 帶 no-transform(會失去壓縮)')
  if (!headers.get('content-encoding')) problems.push('資產未壓縮(無 content-encoding)')
  return problems
}

// 入口 chunk 的 src(相對於頁面網址)。
export function entryChunkUrl(pageUrl, html, allowed) {
  const entry = allowed.find(({ source }) => source.startsWith('/src/'))
  const tag = entry && scriptTags(html).find(({ src }) => src && entry.pattern.test(src))
  return tag ? new URL(tag.src, pageUrl).href : null
}

async function fetchWithHeaders(url, method = 'GET') {
  const response = await fetch(url, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': UA, accept: method === 'GET' ? 'text/html' : '*/*', 'accept-encoding': 'br, gzip' },
  })
  return { status: response.status, headers: response.headers, html: method === 'GET' ? await response.text() : '' }
}

async function main(pages) {
  const allowed = allowedScripts(readFileSync(resolve(repoRoot, 'index.html'), 'utf8'))
  // 本機若有 build 產物,先確認 index.html → dist 的推導仍成立(Vite 命名慣例一改,這裡先紅,
  // 不會等到正式站才誤報)。
  const distIndex = resolve(repoRoot, 'dist/index.html')
  if (existsSync(distIndex)) {
    const drift = foreignScripts(readFileSync(distIndex, 'utf8'), allowed)
    if (drift.length) {
      console.error(`FAIL dist/index.html 與 index.html 推導的允許清單不符,請更新 scripts/check-prod.js 的 Vite 命名對應:${drift.join(';')}`)
      return 1
    }
  }
  let failed = false
  for (const page of pages) {
    let problems
    try {
      const response = await fetchWithHeaders(page)
      problems = evaluatePage({ ...response, allowed })
      const chunk = entryChunkUrl(page, response.html, allowed)
      if (chunk) problems.push(...(await fetchWithHeaders(chunk, 'HEAD').then(evaluateAsset)).map((p) => `${p}(${chunk})`))
      else problems.push('找不到 Vite 入口 chunk')
    } catch (error) {
      problems = [`連不上:${error.message}`]
    }
    if (problems.length) {
      failed = true
      console.log(`FAIL ${page}\n  - ${problems.join('\n  - ')}`)
    } else {
      console.log(`OK   ${page}(200、CSP script-src 'self'、Cache-Control no-transform、只有 repo 引入的腳本、入口 chunk immutable 且壓縮)`)
    }
  }
  return failed ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pages = process.argv.slice(2)
  process.exitCode = await main(pages.length ? pages : DEFAULT_PAGES)
}
