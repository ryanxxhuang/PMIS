// 「下載 PDF」的護欄(廠商驗收 D)。在這之前列印頁只有 window.print(),
// 驗收報告 P1 指出那是列印視窗、不是交付 PDF 檔;這支測試釘住的是**真的下載到一個 .pdf**,
// 而且那份 PDF 是可選取的文字 + 內嵌字型,不是整頁截圖。
//
// 每個案例都把檔案存到 test-results/pdf(或 PDF_OUT_DIR),本機可以直接打開核對;
// CI 只做結構與文字層斷言(見 pdfText.js),不需要 poppler。
import { test, expect } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loginAs, gotoHash } from './helpers.js'
import { readPdf } from './pdfText.js'

const OUT = process.env.PDF_OUT_DIR || 'test-results/pdf'

async function downloadPdf(page, name) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    page.getByRole('button', { name: '下載 PDF' }).click(),
  ])
  mkdirSync(OUT, { recursive: true })
  const path = join(OUT, `${name}-${download.suggestedFilename()}`)
  await download.saveAs(path)
  return { suggestedFilename: download.suggestedFilename(), path, pdf: readPdf(readFileSync(path)) }
}

// 每份 PDF 都必須成立的事:真的是 PDF、字型有內嵌、有可還原的文字、沒有缺字(U+FFFD)、每頁有頁碼
function expectSoundPdf(result) {
  expect(result.suggestedFilename).toMatch(/\.pdf$/)
  expect(result.pdf.pageCount).toBeGreaterThan(0)
  expect(result.pdf.hasFontFile, '中文字型必須內嵌(FontFile2)').toBe(true)
  expect(result.pdf.text.length, '必須有可還原成文字的內容(截圖沒有文字層)').toBeGreaterThan(50)
  expect(result.pdf.text, '不得有無法對應 Unicode 的字').not.toContain('�')
  for (const t of result.pdf.pages) expect(t).toContain(`共 ${result.pdf.pageCount} 頁`)
}

// /site 的文件清單是唯一把四類文書的 id 都列出來的地方,測試從這裡取 id,
// 不要在測試裡硬抄示範種子的 uuid(種子一改測試就假紅)。
async function docLinks(page) {
  await gotoHash(page, '/site')
  await expect(page.locator('a[href*="doc="]').first()).toBeVisible({ timeout: 20_000 })
  return page.locator('a[href*="doc="]').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
}

const idOf = (hrefs, route) => {
  const hit = hrefs.find((h) => h && h.startsWith(`#/${route}?doc=`))
  return hit ? decodeURIComponent(hit.split('doc=')[1]) : null
}

// 產 PDF 要抓 5.4 MB 中文字型、逐字量整張紙、再子集化內嵌,長文件比一般 UI 操作久,
// 這支給 120 秒(全域預設 30 秒是給點擊互動用的)。
test.describe.configure({ timeout: 120_000 })

test.describe('列印頁下載 PDF', () => {
  test('一般案例(施工日誌):下載到 .pdf、中文可還原、印的是哪一版寫進檔名', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/site-log/print')
    await expect(page.getByRole('heading', { name: '公共工程施工日誌' })).toBeVisible()

    // 列印入口仍在,但不再自稱是下載(驗收報告 P1:不得把開列印視窗宣稱為匯出完成)
    await expect(page.getByRole('button', { name: '列印', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /存 PDF|另存 PDF/ })).toHaveCount(0)

    const r = await downloadPdf(page, '一般')
    expectSoundPdf(r)
    expect(r.pdf.text).toContain('公共工程施工日誌')
    expect(r.pdf.text).toContain('承攬廠商')
    expect(r.suggestedFilename).toMatch(/施工日誌_.*(已簽署|草稿未簽署|既有紀錄未簽署)\.pdf$/)
    // 紙面本身也要有版本揭露,不能只有檔名說
    expect(r.pdf.text).toMatch(/簽署|既有紀錄/)
  })

  test('長表(契約期限對照表):自動換頁,跨頁表格每一頁都重印表頭', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/contract/print')
    await expect(page.getByRole('heading', { name: '契約期限對照表' })).toBeVisible()

    const r = await downloadPdf(page, '長表')
    expectSoundPdf(r)
    expect(r.pdf.pageCount, '期限對照表應該超過一頁').toBeGreaterThan(1)

    // 表頭欄名在第一頁之後仍要出現 → 跨頁重印表頭
    const header = '到期日'
    const pagesWithHeader = r.pdf.pages.filter((t) => t.includes(header)).length
    expect(pagesWithHeader, '長表每一頁都要有表頭').toBe(r.pdf.pageCount)
  })

  test('多照片(估驗請款佐證包):照片與說明一起進 PDF,照片各自內嵌不是整頁截圖', async ({ page }) => {
    await loginAs(page, 'contractor')
    await gotoHash(page, '/valuation/package')
    await expect(page.getByRole('heading', { name: /佐\s*證\s*包/ })).toBeVisible()
    // 證據是非同步載入的:等它落地再輸出,免得把「照片載入中…」印進送審文件
    await expect(page.getByText(/示範模式不支援照片上傳|沒有附證據照片|證據讀取失敗/)).toBeVisible({ timeout: 20_000 })

    // 示範資料的查驗表單沒有附照片(示範模式不支援上傳),這裡在紙上補一組照片與說明,
    // 走的是產品同一條 <img>(object-fit: cover)→ 內嵌影像的路徑。
    const injected = await page.evaluate(async () => {
      const paper = document.querySelector('.paper')
      if (!paper) return 0
      const jpeg = (i) => {
        const c = document.createElement('canvas')
        c.width = 1280; c.height = 960
        const ctx = c.getContext('2d')
        const g = ctx.createLinearGradient(0, 0, 1280, 960)
        g.addColorStop(0, `hsl(${i * 37}, 70%, 55%)`)
        g.addColorStop(1, '#222')
        ctx.fillStyle = g; ctx.fillRect(0, 0, 1280, 960)
        ctx.fillStyle = '#fff'; ctx.font = '96px sans-serif'; ctx.fillText(`PHOTO ${i}`, 60, 520)
        return c.toDataURL('image/jpeg', 0.85)
      }
      const wrap = document.createElement('div')
      wrap.className = 'space-y-4'
      for (let group = 1; group <= 3; group++) {
        const block = document.createElement('div')
        block.className = 'break-inside-avoid'
        const title = document.createElement('div')
        title.className = 'text-footnote font-medium mb-1'
        title.textContent = `壹.一.2.${group} 測試工項 ${group}`
        const grid = document.createElement('div')
        grid.className = 'grid grid-cols-3 gap-2'
        for (let i = 1; i <= 4; i++) {
          const n = (group - 1) * 4 + i
          const fig = document.createElement('figure')
          fig.className = 'border paper-rule-2 rounded overflow-hidden break-inside-avoid'
          const img = document.createElement('img')
          img.src = jpeg(n)
          img.alt = `測試照片 ${n}`
          img.className = 'w-full h-28 object-cover'
          await img.decode()
          const cap = document.createElement('figcaption')
          cap.className = 'text-micro paper-mute px-1.5 py-1 leading-tight'
          cap.textContent = `測試照片說明 ${n}・鋼筋綁紮・3F`
          fig.append(img, cap)
          grid.appendChild(fig)
        }
        block.append(title, grid)
        wrap.appendChild(block)
      }
      paper.appendChild(wrap)
      return wrap.querySelectorAll('img').length
    })
    expect(injected).toBe(12)

    const r = await downloadPdf(page, '多照片')
    expectSoundPdf(r)
    // 每張照片的說明與它對應的工項都要在 PDF 裡
    expect(r.pdf.text).toContain('測試照片說明 1')
    expect(r.pdf.text).toContain('測試照片說明 12')
    expect(r.pdf.text).toContain('測試工項 3')
    // 照片是各自的內嵌影像,不是把整頁畫成一張圖
    const raw = readFileSync(r.path).toString('latin1')
    expect((raw.match(/\/Subtype\s*\/Image/g) || []).length, '每張照片各自內嵌').toBeGreaterThanOrEqual(12)
  })

  test('改版後重印:換一份文件就重新量、重新產,不會吐出上一次的檔', async ({ page }) => {
    await loginAs(page, 'contractor')
    const hrefs = await docLinks(page)
    const logs = hrefs.filter((h) => h && h.startsWith('#/site-log?doc=')).map((h) => decodeURIComponent(h.split('doc=')[1]))
    expect(logs.length, '示範資料要有一份以上的施工日誌文件').toBeGreaterThan(1)

    const out = []
    for (const [i, id] of [logs[0], logs[1]].entries()) {
      await gotoHash(page, `/site-log/print?doc=${encodeURIComponent(id)}`)
      await expect(page.getByRole('heading', { name: '公共工程施工日誌' })).toBeVisible()
      const r = await downloadPdf(page, `改版${i === 0 ? '前' : '後'}`)
      expectSoundPdf(r)
      out.push(r)
    }
    const dateOf = (t) => t.match(/\d+\s*年\s*\d+\s*月\s*\d+\s*日/)?.[0]
    expect(dateOf(out[0].pdf.text), '要印得出日期').toBeTruthy()
    expect(dateOf(out[1].pdf.text)).toBeTruthy()
    expect(dateOf(out[1].pdf.text), '第二份要是新的內容,不是快取').not.toBe(dateOf(out[0].pdf.text))
    expect(out[1].suggestedFilename).not.toBe(out[0].suggestedFilename)
  })

  // 紙是固定印刷品:手機按下載拿到的必須是同一份文件,不能因為手機字級階梯而變成另一份。
  test.describe('手機視窗', () => {
    test.use({ viewport: { width: 375, height: 812 } })
    test('手機下載到的 PDF 與桌面同一份(頁數與內容一致)', async ({ page }) => {
      await loginAs(page, 'contractor')
      await gotoHash(page, '/site-log/print')
      await expect(page.getByRole('heading', { name: '公共工程施工日誌' })).toBeVisible()
      const r = await downloadPdf(page, '手機')
      expectSoundPdf(r)
      expect(r.pdf.pageCount).toBe(2)
      // 表頭欄名不因手機字級被撐到折行
      expect(r.pdf.pages[0]).toContain('單位')
      expect(r.pdf.pages[0]).toContain('契約數量')
      expect(r.pdf.text).toContain('公共工程施工日誌')
    })
  })

  test('四類文書的列印頁都給得出 PDF,且印的是簽署列指向的版本', async ({ page }) => {
    await loginAs(page, 'supervisor')
    const hrefs = await docLinks(page)
    // 紙本標題本來就有字距(自 主 檢 查 表),比對一律容許字間空白
    const cases = [
      ['site-log', /公\s*共\s*工\s*程\s*施\s*工\s*日\s*誌/, '施工日誌'],
      ['self-check', /自\s*主\s*檢\s*查\s*表/, '自主檢查表'],
      ['inspection-form', /監\s*造\s*查\s*驗/, '監造查驗表單'],
      ['supervisor-log', /監\s*造\s*日\s*誌/, '監造日誌'],
    ]
    for (const [route, marker, label] of cases) {
      const id = idOf(hrefs, route)
      expect(id, `/site 的文件清單要有 ${label}`).toBeTruthy()
      await gotoHash(page, `/${route}/print?doc=${encodeURIComponent(id)}`)
      // 等這一份紙真的換上來再下載,否則會重複下載上一份
      await expect(page.locator('.paper')).toContainText(marker, { timeout: 20_000 })
      const r = await downloadPdf(page, label)
      expectSoundPdf(r)
      expect(r.pdf.text).toMatch(marker)
      // 檔名與紙面都要說得出「這是哪一版、簽了沒」
      expect(r.suggestedFilename).toMatch(/(已簽署|草稿未簽署|既有紀錄未簽署)\.pdf$/)
      if (/已簽署/.test(r.suggestedFilename)) {
        expect(r.pdf.text, '已簽署版本要印出版本與簽署資訊').toMatch(/版本\s*\d/)
      } else {
        expect(r.pdf.text, '草稿要印出未簽署標示').toMatch(/未簽署/)
      }
    }
  })
})
