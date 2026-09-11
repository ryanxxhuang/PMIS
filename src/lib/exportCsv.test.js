// @vitest-environment jsdom
// B-14(弱點掃描處置項)的迴歸護欄:CSV formula injection 防護只有一行 regex,
// 改壞不會有任何紅燈——機關端匯出的 CSV 是給人用 Excel 開的,退化就是可被利用
// 的注入面,而且是已經向客戶交代過的處置項。
//
// 這支測的是「現行行為」,不是「理想行為」:負數例外與 typeof number 前置條件
// 都是刻意的,兩者都容易在重構時被順手拿掉(拿掉負數例外 → 所有金額欄變成
// 文字 '-1234,Excel 加總全失效;拿掉 typeof 判斷 → 數值 -1234 也被加前綴)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cell, exportCsv, stamp } from './exportCsv.js'

describe('cell:formula injection 防護(B-14)', () => {
  it('四種危險開頭都必須加 \' 前綴中和', () => {
    expect(cell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(cell('+1+1')).toBe("'+1+1")
    expect(cell('-cmd|calc')).toBe("'-cmd|calc")
    expect(cell('@foo')).toBe("'@foo")
  })

  it('真實攻擊字串:DDE 指令與超連結外洩都被中和(不得只擋 = 開頭)', () => {
    expect(cell('=cmd|\' /C calc\'!A0')).toMatch(/^'=cmd/)
    expect(cell('@SUM(1+9)*cmd|\' /C calc\'!A0')).toMatch(/^'@SUM/)
    // 帶逗號的攻擊字串:先加前綴、再整格 quote(順序反了會讓前綴跑到引號外)
    expect(cell('=HYPERLINK("http://evil","click")')).toBe('"\'=HYPERLINK(""http://evil"",""click"")"')
  })

  it('負數例外:真負數字串不得被加前綴(加了 Excel 就當文字,金額欄無法加總)', () => {
    expect(cell('-123')).toBe('-123')
    expect(cell('-1.5')).toBe('-1.5')
    expect(cell('-0')).toBe('-0')
    expect(cell('0')).toBe('0')
  })

  it('typeof v === \'number\' 的數值一律不加前綴(前置條件被拿掉就會紅)', () => {
    expect(cell(-123)).toBe('-123')
    expect(cell(-1500.5)).toBe('-1500.5')
    expect(cell(0)).toBe('0')
    expect(cell(1234567)).toBe('1234567')
  })

  it('負號例外只認純數字:單獨的 - 與 -- 仍要中和(才擋得住 -2+3+cmd 型)', () => {
    expect(cell('-')).toBe("'-")
    expect(cell('--')).toBe("'--")
    expect(cell('-2+3+cmd|\' /C calc\'!A0')).toMatch(/^'-2/)
  })

  it('+ 開頭的數字字串仍會被中和(現行行為:例外只放行 - 號)', () => {
    expect(cell('+1')).toBe("'+1")
  })

  it('不危險的開頭不動它(中文/一般文字/百分比/日期不得被加前綴)', () => {
    expect(cell('鋼筋加工及組立')).toBe('鋼筋加工及組立')
    expect(cell('2026-09-11')).toBe('2026-09-11')
    expect(cell('95%')).toBe('95%')
    expect(cell('A-1')).toBe('A-1')
  })
})

describe('cell:CSV 跳脫', () => {
  it('含逗號 → 整格 quote(否則欄位被切開,整列錯位)', () => {
    expect(cell('台北市,信義區')).toBe('"台北市,信義區"')
  })

  it('含雙引號 → quote 並把 " 加倍', () => {
    expect(cell('鋼筋 "SD420W"')).toBe('"鋼筋 ""SD420W"""')
  })

  it('含換行 → quote(否則一筆資料被當成兩列)', () => {
    expect(cell('第一行\n第二行')).toBe('"第一行\n第二行"')
  })

  it('不含特殊字元就不 quote(避免整份 CSV 無謂加引號)', () => {
    expect(cell('簡單文字')).toBe('簡單文字')
  })
})

describe('cell:空值與非字串', () => {
  it('null / undefined → 空字串(不得輸出 "null"/"undefined" 給機關看)', () => {
    expect(cell(null)).toBe('')
    expect(cell(undefined)).toBe('')
  })

  it('0 與 false 不是空值,照常輸出(== null 不可寫成 falsy 判斷)', () => {
    expect(cell(0)).toBe('0')
    expect(cell(false)).toBe('false')
  })

  it('非數字物件走 String() 後仍受防護(toString 回公式一樣要中和)', () => {
    expect(cell({ toString: () => '=1+1' })).toBe("'=1+1")
  })
})

// 現行行為的邊界:前置空白會繞過防護。測在這裡是為了「行為改變時有人看得到」,
// 不是背書——見本輪回報,是否收緊由人決定(收緊會讓 regex 需一併處理 \t\r)。
describe('cell:現行邊界行為(記錄用,非背書)', () => {
  it('前置空白/tab 讓危險開頭繞過防護(目前不加前綴)', () => {
    expect(cell(' =SUM(A1)')).toBe(' =SUM(A1)')
    expect(cell('\t=SUM(A1)')).toBe('\t=SUM(A1)')
  })

  it('單獨的 \\r 不觸發 quote(欄位含 CR 時不會被引號包住)', () => {
    expect(cell('a\rb')).toBe('a\rb')
  })

  it('科學記號字串不在數字例外內,會被加前綴(顯示成文字,非安全問題)', () => {
    expect(cell('-1.5e3')).toBe("'-1.5e3")
  })
})

describe('exportCsv:組檔與下載', () => {
  let blobs, clicked, anchors
  beforeEach(() => {
    blobs = []; clicked = 0; anchors = []
    URL.createObjectURL = vi.fn((b) => { blobs.push(b); return 'blob:fake' })
    URL.revokeObjectURL = vi.fn()
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag)
      if (tag === 'a') { el.click = () => { clicked++ }; anchors.push(el) }
      return el
    })
  })
  afterEach(() => { vi.restoreAllMocks() })

  // blob.text() 走 TextDecoder,預設會吃掉 BOM——要驗 BOM 只能看位元組
  const text = async () => blobs[0].text()
  const bytes = async () => new Uint8Array(await blobs[0].arrayBuffer())

  it('帶 UTF-8 BOM 位元組開頭(沒有 BOM,Excel 開中文就是亂碼)', async () => {
    exportCsv('x', [{ a: '中文' }])
    expect(Array.from((await bytes()).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
  })

  it('未給 columns → 用第一筆的 keys 當表頭與欄序', async () => {
    exportCsv('x', [{ item_no: '1', desc: '假設工程' }])
    expect(await text()).toBe('item_no,desc\n1,假設工程')
  })

  it('給 columns → 用 label 當表頭、key 取值,未列的欄不輸出', async () => {
    const cols = [{ key: 'no', label: '項次' }, { key: 'amt', label: '金額' }]
    exportCsv('x', [{ no: 'A1', amt: -1234, hidden: '不該出現' }], cols)
    const csv = await text()
    expect(csv).toBe('項次,金額\nA1,-1234')
    expect(csv).not.toContain('不該出現')
  })

  it('columns.get 取代 key(計算欄)', async () => {
    const cols = [{ label: '小計', get: (r) => r.qty * r.price }]
    exportCsv('x', [{ qty: 3, price: 100 }], cols)
    expect(await text()).toBe('小計\n300')
  })

  it('資料列的危險值在整份檔案裡同樣被中和(cell 沒被繞過)', async () => {
    exportCsv('x', [{ note: '=1+1' }, { note: '-9' }])
    expect(await text()).toBe("note\n'=1+1\n-9")
  })

  it('空 rows 且未給 columns → 只有一行空表頭,不丟例外', async () => {
    exportCsv('x', [])
    expect(await text()).toBe('\n')
  })

  it('檔名沒有 .csv 就補上,已有就不重複補', () => {
    exportCsv('報表', [{ a: 1 }])
    expect(anchors[0].download).toBe('報表.csv')
    exportCsv('報表.csv', [{ a: 1 }])
    expect(anchors[1].download).toBe('報表.csv')
  })

  it('點擊後移除 anchor 並釋放 objectURL(不漏 DOM/記憶體)', () => {
    exportCsv('x', [{ a: 1 }])
    expect(clicked).toBe(1)
    expect(anchors[0].isConnected).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })
})

describe('stamp:檔名日期戳', () => {
  it('YYYYMMDD 補零(9 月 5 日要是 0905,不是 95)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 5, 10, 0, 0))
    expect(stamp()).toBe('20260905')
    vi.setSystemTime(new Date(2026, 11, 31, 23, 0, 0))
    expect(stamp()).toBe('20261231')
    vi.useRealTimers()
  })
})
