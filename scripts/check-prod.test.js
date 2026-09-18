import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { allowedScripts, cspScriptSources, entryChunkUrl, evaluateAsset, evaluatePage, foreignScripts, scriptTags } from './check-prod.js'

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const allowed = allowedScripts(indexSource)
const builtHtml = `<!doctype html><html><head>
  <!-- 註解裡的 <script src="/cdn-cgi/x.js"></script> 不算 -->
  <script src="./theme-boot.js"></script>
  <script type="module" crossorigin src="./assets/index-CMvR_psV.js"></script>
</head><body><div id="root"></div></body></html>`
const headers = (extra = {}) => new Headers({
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  'cache-control': 'public, max-age=0, must-revalidate, no-transform',
  ...extra,
})

describe('允許清單由 repo index.html 推導', () => {
  it('index.html 只明示引入 theme-boot.js 與 Vite 入口,build 後對應 ./theme-boot.js 與 ./assets/index-<hash>.js', () => {
    expect(allowed.map(({ source }) => source)).toEqual(['/theme-boot.js', '/src/main.jsx'])
    expect(foreignScripts(builtHtml, allowed)).toEqual([])
    expect(foreignScripts(builtHtml.replace('index-CMvR_psV', 'index-n1P9w2eA'), allowed)).toEqual([])
  })
  it('雜湊以外的 assets 檔名、其他路徑與外部主機都不在清單內', () => {
    expect(foreignScripts('<script src="./assets/vendor-abc12345.js"></script>', allowed)).toEqual(['外來腳本 src=./assets/vendor-abc12345.js'])
    expect(foreignScripts('<script src="https://app.gov-agent.ai/theme-boot.js"></script>', allowed)).toHaveLength(1)
    expect(foreignScripts('<script src="./theme-boot.js.evil"></script>', allowed)).toHaveLength(1)
  })
})

describe('抓到已知與未知的邊緣注入', () => {
  it('Cloudflare JavaScript Detections(Bot Fight Mode)的行內載入器:2026-09-19 正式站實抓樣本', () => {
    const html = readFileSync(new URL('../tests/fixtures/edge-injected-jsd.html', import.meta.url), 'utf8')
    const found = foreignScripts(html, allowed)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/^行內腳本 /)
    expect(html).toContain('/cdn-cgi/challenge-platform/scripts/jsd/main.js')
  })
  it('Web Analytics beacon(cf-beacon)', () => {
    expect(foreignScripts(`${builtHtml}<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "abc"}'></script>`, allowed))
      .toEqual(['外來腳本 src=https://static.cloudflareinsights.com/beacon.min.js'])
  })
  it('Rocket Loader 與 Email Obfuscation 的 /cdn-cgi/scripts', () => {
    expect(foreignScripts(`${builtHtml}<script src="/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js" data-cf-settings="abc-|49"></script>`, allowed))
      .toEqual(['外來腳本 src=/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js'])
    expect(foreignScripts(`${builtHtml}<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>`, allowed))
      .toEqual(['外來腳本 src=/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js'])
  })
  it('任何行內腳本都算注入(repo 在 CSP script-src self 下不可能出貨行內腳本)', () => {
    expect(foreignScripts(`${builtHtml}<script>window.x = 1</script>`, allowed)).toEqual(['行內腳本 "window.x = 1"'])
    expect(foreignScripts('<SCRIPT TYPE="text/javascript" >\n  alert(1)\n</SCRIPT >', allowed)).toEqual(['行內腳本 "alert(1)"'])
  })
  it('src 支援單引號與不加引號的寫法', () => {
    expect(scriptTags(`<script src='./theme-boot.js'></script><script src=./assets/index-abc.js></script>`).map(({ src }) => src))
      .toEqual(['./theme-boot.js', './assets/index-abc.js'])
  })
})

describe('頁面與資產的回應規則', () => {
  it('200、CSP script-src self、no-transform、腳本乾淨 → 無問題', () => {
    expect(evaluatePage({ status: 200, headers: headers(), html: builtHtml, allowed })).toEqual([])
  })
  it('缺 no-transform 就是缺了「邊緣不得改寫」的機制,即使當下沒注入也紅', () => {
    expect(evaluatePage({ status: 200, headers: headers({ 'cache-control': 'public, max-age=0, must-revalidate' }), html: builtHtml, allowed }))
      .toEqual(['Cache-Control 缺 no-transform(現值:public, max-age=0, must-revalidate)'])
  })
  it('非 200、CSP 缺 script-src、注入腳本各自列出', () => {
    const html = readFileSync(new URL('../tests/fixtures/edge-injected-jsd.html', import.meta.url), 'utf8')
    const problems = evaluatePage({ status: 404, headers: headers({ 'content-security-policy': "default-src 'self'", 'cache-control': '' }), html, allowed })
    expect(problems[0]).toBe('status=404')
    expect(problems).toContain("CSP script-src 不是恰好 'self'(現值:無)")
    expect(problems).toContain('Cache-Control 缺 no-transform(現值:無)')
    expect(problems.some((p) => p.startsWith('行內腳本'))).toBe(true)
  })
  it("script-src 多任何一個來源都算放寬(unsafe-inline、nonce、第三方主機),不是子字串比對", () => {
    for (const csp of ["script-src 'self' 'unsafe-inline'", "script-src 'nonce-abc' 'self'", "script-src 'self' https://static.cloudflareinsights.com"]) {
      const problems = evaluatePage({ status: 200, headers: headers({ 'content-security-policy': csp }), html: builtHtml, allowed })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toMatch(/^CSP script-src 不是恰好 'self'/)
    }
    expect(cspScriptSources("default-src 'self'; Script-Src 'self' ;style-src 'self'")).toEqual(["'self'"])
    expect(cspScriptSources('')).toBeNull()
  })
  it('雜湊資產必須 immutable、壓縮,且不得帶 no-transform', () => {
    expect(evaluateAsset({ status: 200, headers: new Headers({ 'cache-control': 'public, max-age=31536000, immutable', 'content-encoding': 'br' }) })).toEqual([])
    expect(evaluateAsset({ status: 200, headers: new Headers({ 'cache-control': 'public, max-age=0, must-revalidate, no-transform, public, max-age=31536000, immutable' }) }))
      .toEqual(['資產 Cache-Control 帶 no-transform(會失去壓縮)', '資產未壓縮(無 content-encoding)'])
    expect(evaluateAsset({ status: 404, headers: new Headers() })[0]).toBe('status=404')
  })
  it('入口 chunk 網址相對於頁面解析(/demo/ 底下的 ./assets 指向 /demo/assets)', () => {
    expect(entryChunkUrl('https://app.gov-agent.ai/demo/', builtHtml, allowed)).toBe('https://app.gov-agent.ai/demo/assets/index-CMvR_psV.js')
    expect(entryChunkUrl('https://app.gov-agent.ai/login', builtHtml, allowed)).toBe('https://app.gov-agent.ai/assets/index-CMvR_psV.js')
    expect(entryChunkUrl('https://app.gov-agent.ai/', '<script src="./theme-boot.js"></script>', allowed)).toBeNull()
  })
})
