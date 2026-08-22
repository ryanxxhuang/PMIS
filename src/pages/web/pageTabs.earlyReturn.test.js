// 工作面分頁列不得因為「載入中／空狀態」早退而整條消失(P1-F1)。
//
// 為什麼是死路而不只是難看:PageTabs 渲染在 ui.jsx 的 PageHeader 裡,頁面只要在
// PageHeader 之前 early return,那一頁就完全沒有分頁列。而側欄在兩種常見版面
// 「不列子頁」——平板 768–1279 強制 icon rail、桌機使用者自己收合側欄
// (Layout.jsx:385 的 collapsed → md:hidden)——此時使用者換不到同工作面的其他頁,
// 只剩瀏覽器上一頁可用。載入中是每次進頁都會經過的狀態,不是罕見分支。
//
// 這份測試走原始碼結構而非 render:repo 沒有 @testing-library,且要釘的正是
// 「每一個 early return 分支」——逐分支去 render 要餵各頁的 store 前置條件,
// 成本高又容易漏掉新加的分支;掃原始碼可以一次涵蓋全部工作面子頁,
// 新增早退分支忘了帶頁首時會直接紅。
//
// 已知界線:只認得縮排 2(頁面主體)與 4(包在 if 裡)的 return——早退分支就長在這兩層。
// 寫在更深層的 return 屬於 .map()/子元件,不在本合約範圍。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { navGroups } from '../../lib/navConfig.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoSrc = resolve(here, '../..')
const read = (p) => readFileSync(resolve(repoSrc, p), 'utf8')

// 只有「同一工作面有兩個以上子頁」才會渲染分頁列(PageTabs 的 tabs.length < 2 → null),
// 清單直接從 navConfig 推導:之後加子頁、改工作面,這份測試自動跟著擴大涵蓋範圍。
const tabRoutes = navGroups
  .flatMap((g) => g.items)
  .filter((i) => (i.tabs?.length ?? 0) >= 2)
  .flatMap((i) => i.tabs.map((t) => t.to))

// 路由 → 頁面檔:同樣不手抄,從 App.jsx 的 lazy import 與路由表推導。
function routeToFile() {
  const app = read('App.jsx')
  const lazyMap = new Map()
  for (const m of app.matchAll(/const (\w+) = lazy\(\(\) => import\('\.\/(pages\/web\/[\w.]+\.jsx)'\)\)/g)) {
    lazyMap.set(m[1], m[2])
  }
  const routes = new Map()
  for (const m of app.matchAll(/\{ path: '([^']+)', element: <(\w+) \/> \}/g)) {
    const file = lazyMap.get(m[2])
    if (file) routes.set(m[1], file)
  }
  return routes
}

// 一個頁面主體裡「會畫出頁面外觀」的 return 分支,連同它的整段 JSX。
function pageLevelReturns(source) {
  const lines = source.split('\n')
  const start = lines.findIndex((l) => l.startsWith('export default function'))
  if (start < 0) return []
  // 頁面主體結束於下一個頂層函式宣告(各頁的小元件都寫在主元件之後)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^(export )?function /.test(lines[i])) { end = i; break }
  }
  const body = lines.slice(start, end)
  const found = []
  for (let i = 0; i < body.length; i++) {
    const m = /^(  |    )(?:if \(.*\) )?return[ (]/.exec(body[i])
    if (!m) continue
    const indent = m[1].length
    const block = [body[i]]
    if (body[i].trimEnd().endsWith('(')) {
      for (let j = i + 1; j < body.length; j++) {
        block.push(body[j])
        if (new RegExp(`^ {${indent}}\\)\\s*$`).test(body[j])) break
      }
    }
    const text = block.join('\n')
    // 只管畫出頁面外觀的 return;return null / return [] / return 數值不在此列
    if (!/<(Card|div|Empty|Surface|PrerequisiteEmptyState)\b/.test(text)) continue
    found.push({ line: start + i + 1, text })
  }
  return found
}

// 頁首可以直接寫 <PageHeader …/>,也可以先存成區域變數再共用(避免同一組
// 標題字串在多個分支各抄一份而漂移)。兩種都算數,但變數必須真的綁到 PageHeader。
function headerRefs(source) {
  const names = new Set(['PageHeader'])
  for (const m of source.matchAll(/const (\w+) = <PageHeader\b/g)) names.add(m[1])
  // Progress 用小元件 Header 包住 PageHeader,同樣算數
  for (const m of source.matchAll(/function (\w+)\([^)]*\)\s*\{[\s\S]{0,400}?<PageHeader\b/g)) names.add(m[1])
  return names
}

function hasHeader(text, names) {
  for (const n of names) {
    if (n === 'PageHeader' ? /<PageHeader\b/.test(text) : new RegExp(`\\{${n}\\}|<${n}[\\s/>]`).test(text)) return true
  }
  return false
}

describe('PageTabs 掛在 PageHeader 裡(本測試的前提)', () => {
  it('ui.jsx 的 PageHeader 仍然渲染 PageTabs', () => {
    // 這條一旦紅,代表分頁列被搬走了,下面「每個分支都要有 PageHeader」的推論就不再成立,
    // 必須重寫本檔而不是把它刪掉。
    const ui = read('components/ui.jsx')
    expect(ui).toMatch(/export function PageHeader\(/)
    expect(ui).toMatch(/<PageTabs \/>/)
  })
  it('PageTabs 只在同工作面有 2 個以上子頁時渲染', () => {
    expect(read('components/PageTabs.jsx')).toMatch(/item\.tabs\.length < 2\) return null/)
  })
})

describe('工作面子頁:每個 early return 分支都要帶頁首(分頁列才不會消失)', () => {
  const files = routeToFile()

  it('每條分頁路由都對得到頁面檔(對照表沒有漏接)', () => {
    expect(tabRoutes.length).toBeGreaterThan(15)
    for (const route of tabRoutes) expect(files.get(route), `${route} 找不到對應頁面檔`).toBeTruthy()
  })

  for (const route of tabRoutes) {
    it(`${route}`, () => {
      const file = files.get(route)
      const source = read(file)
      const names = headerRefs(source)
      const branches = pageLevelReturns(source)
      expect(branches.length, `${file} 解析不到任何頁面層 return`).toBeGreaterThan(0)
      const naked = branches
        .filter((b) => !hasHeader(b.text, names))
        .map((b) => `${file}:${b.line}`)
      expect(naked, `這些 return 沒有 PageHeader,該分支的工作面分頁列會整條消失:\n${naked.join('\n')}`).toEqual([])
    })
  }
})

// 三個代表性頁面各自點名:上面的迴圈是通掃,失敗訊息不一定看得出「哪一種狀態」壞了。
// 這三條分別代表載入中、前置條件未滿足、非真實專案三種最常見的早退。
describe('代表性早退狀態(具名釘死)', () => {
  it('BOQ 載入中:骨架屏分支仍有頁首', () => {
    const branch = pageLevelReturns(read('pages/web/BOQ.jsx'))
      .find((b) => b.text.includes('載入標單工項中…'))
    expect(branch, '找不到 BOQ 載入中分支').toBeTruthy()
    expect(hasHeader(branch.text, headerRefs(read('pages/web/BOQ.jsx')))).toBe(true)
  })
  it('Payments 標單未匯入:空狀態分支仍有頁首', () => {
    const src = read('pages/web/Payments.jsx')
    const branch = pageLevelReturns(src).find((b) => b.text.includes('此專案的標單尚未匯入資料庫'))
    expect(branch, '找不到 Payments 空狀態分支').toBeTruthy()
    expect(hasHeader(branch.text, headerRefs(src))).toBe(true)
  })
  it('Cost 非真實專案:空狀態分支仍有頁首', () => {
    const src = read('pages/web/Cost.jsx')
    const branch = pageLevelReturns(src).find((b) => b.text.includes('此功能需真實專案'))
    expect(branch, '找不到 Cost 空狀態分支').toBeTruthy()
    expect(hasHeader(branch.text, headerRefs(src))).toBe(true)
  })
})
