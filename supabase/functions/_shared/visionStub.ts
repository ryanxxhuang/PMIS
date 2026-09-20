// 本機確定性視覺 stub(P2c 真後端 E2E 用):沒有模型金鑰也能走完「上傳→起稿→補缺→簽署→提送」
// 流程。**只在本機 `supabase functions serve` 生效、正式環境無法啟用**——兩個條件缺一不可:
//   1. 環境變數 PMIS_VISION_STUB=1(正式 Edge 不設);
//   2. SUPABASE_URL 是本機 stack 的明文 http 位址(kong／localhost／127.0.0.1／host.docker.internal);
//      正式 Edge 的 SUPABASE_URL 一律是 https://<ref>.supabase.co,永遠不符合。
// stub 輸出固定、不看影像內容:只證明流程,不證明辨識正確(模型品質見 P7b);起稿回應會在 notes 明示
// 「模型輸出為本機 stub」,前端與 BASELINE 都如實標示。work_item_hint 可由 PMIS_VISION_STUB_HINT 指定
// (E2E 用來讓照片配到標單工項、產生待補的當日數量欄)。
//
// 情境(F2,2026-09-20):預設情境 `site` 是一般工地照(無告示板)。另一個「紙本查驗表」情境的回傳值
// **逐字取自真實模型對一張真實紙表照片(LINE_A~4_0.JPG)的實際輸出**(docs/reviews/assets/2026-09-20-contractor-acceptance/
// vision-after-b2.json,condition=original,模型 claude-haiku-4-5-20251001;visionStub.test.ts 與該檔比對釘住不漂移),
// 用來在真後端鏈驗「辨識結果 → 草稿欄位 → 標待確認 → 未確認不能簽」整段(chain 21)。只挑這一張的原因:它的分類
// text_legible=true,真實流程是「整張轉錄兩次 → 逐格切塊」,stub 的 readBoard 就是那條路;另兩張紙表 text_legible=false,
// 實測值只來自逐格切塊(paperFormImaging),e2e 的 1×1 極小 JPEG 偵測不到紙張,走不到那條路,硬塞會變成重建而非逐字。它仍然是 stub:
// 不看影像、固定回傳、模型不會被呼叫;**只證明流程接得起來,不證明辨識正確**——真實模型的品質與抄錄率
// 只看續接清單 §9 B2 與 vision-after-b2.json,兩者不可混報。
// 情境怎麼選:e2e 把標記 `pmis-stub-scene=<name>` 附在 JPEG 資料之後(helpers.tinyJpeg 的 seed 位置;那張極小 JPEG
// 沒有 EOI 標記,所以不以 FF D9 定位,直接在位元組裡找 ASCII 標記);stub 從 base64 讀出標記決定回哪一組,沒有標記=`site`。
// 照片內容是資料不是指令——這個「標記」只在本機 stub 有意義,正式 Edge 永遠不會讀它(stubAllowed 為 false 就不會走到這裡)。
import type { SitePhotoResult, WhiteboardResult } from './sitePhotoVision.ts'

export const STUB_NOTE = '模型輸出為本機 stub(非真實辨識,只證明流程)'
export const STUB_MODEL = 'stub:local'

const LOCAL_HOSTS = new Set(['kong', 'localhost', '127.0.0.1', 'host.docker.internal'])

export function stubAllowed(env: { flag?: string | null; supabaseUrl?: string | null }): boolean {
  if ((env.flag ?? '').trim() !== '1') return false
  let url: URL
  try {
    url = new URL(env.supabaseUrl ?? '')
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  return LOCAL_HOSTS.has(host) || host.startsWith('supabase_kong')
}

export type StubScene = 'site' | 'paper_form_line_a'
export const STUB_SCENES: readonly StubScene[] = ['site', 'paper_form_line_a']
export const STUB_SCENE_MARKER = 'pmis-stub-scene='

// 從照片位元組讀情境標記(ASCII,附在 JPEG 資料之後);沒有、解不開、或不是已知情境 → site
export function stubSceneOf(base64: string | null | undefined): StubScene {
  if (!base64) return 'site'
  let bin: string
  try {
    bin = atob(base64)
  } catch {
    return 'site'
  }
  const m = new RegExp(`${STUB_SCENE_MARKER}([a-z0-9_]+)`).exec(bin)
  const name = m?.[1]
  return name && (STUB_SCENES as readonly string[]).includes(name) ? name as StubScene : 'site'
}

// LINE_A~4_0.JPG(condition=original,sha256 5e637af8aba7ee002f075b8cef07b17507d4b0b378e4c94af0690a13631c164b,模型 claude-haiku-4-5-20251001):分類與整張轉錄的實際輸出,逐字。
const PAPER_FORM_LINE_A_CLASSIFY: SitePhotoResult = {"caption": "鋼筋籠與查驗紀錄表", "category": "查驗會勘", "is_construction": true, "legible": true, "text_legible": true, "has_board": true, "record_medium": "paper_form", "work_item_hint": "鋼筋籠組立", "visible_progress": "組裝鋼筋籠，掛設查驗紀錄表", "location": "B5-4-4-25m", "location_text": "基礎樁號位置:B5-4-4-25m", "dropped": []}
const PAPER_FORM_LINE_A_RECORD: WhiteboardResult = {"record_medium": "paper_form", "log_date": "2026-08-04", "log_date_text": "2026年8月4日", "log_date_conflict": null, "weather": "", "location": "", "location_text": "4-H-25m", "work_item_text": "", "work_summary": "", "observations": [{"kind": "design", "label": "線徑", "entry_no": "1", "raw_text": "13 * 11 MM", "value": 13, "value2": 11, "unit": "MM", "comparator": "", "location": "", "note": "", "source": {"method": "paper_cells", "column": "left", "column_title": "設計值：", "rect": {"x": 522, "y": 444, "w": 437, "h": 664}, "scale": 2, "passes": 2}}, {"kind": "design", "label": "網目", "entry_no": "1", "raw_text": "15 * 15 CM", "value": 15, "value2": 15, "unit": "CM", "comparator": "", "location": "", "note": "", "source": {"method": "paper_cells", "column": "left", "column_title": "設計值：", "rect": {"x": 522, "y": 444, "w": 437, "h": 664}, "scale": 2, "passes": 2}}, {"kind": "design", "label": "線徑", "entry_no": "4", "raw_text": "11 * 11 MM", "value": 11, "value2": 11, "unit": "MM", "comparator": "", "location": "", "note": "", "source": {"method": "paper_cells", "column": "left", "column_title": "設計值：", "rect": {"x": 522, "y": 444, "w": 437, "h": 664}, "scale": 2, "passes": 2}}, {"kind": "design", "label": "網目", "entry_no": "4", "raw_text": "15 * 15 CM", "value": 15, "value2": 15, "unit": "CM", "comparator": "", "location": "", "note": "", "source": {"method": "paper_cells", "column": "left", "column_title": "設計值：", "rect": {"x": 522, "y": 444, "w": 437, "h": 664}, "scale": 2, "passes": 2}}, {"kind": "measured", "label": "線徑", "entry_no": "1", "raw_text": "13 * 11 MM", "value": 13, "value2": 11, "unit": "MM", "comparator": "", "location": "", "note": "", "source": {"method": "paper_cells", "column": "right", "column_title": "實測值：", "rect": {"x": 983, "y": 444, "w": 494, "h": 664}, "scale": 2, "passes": 2}}, {"kind": "measured", "label": "網目", "entry_no": "1", "raw_text": "15 * 15 CM", "value": 15, "value2": 15, "unit": "CM", "comparator": "", "location": "", "note": "", "source": {"method": "paper_cells", "column": "right", "column_title": "實測值：", "rect": {"x": 983, "y": 444, "w": 494, "h": 664}, "scale": 2, "passes": 2}}, {"kind": "measured", "label": "線徑", "entry_no": "4", "raw_text": "11 * 11 MM", "value": 11, "value2": 11, "unit": "MM", "comparator": "", "location": "", "note": "", "source": {"method": "paper_cells", "column": "right", "column_title": "實測值：", "rect": {"x": 983, "y": 444, "w": 494, "h": 664}, "scale": 2, "passes": 2}}, {"kind": "measured", "label": "網目", "entry_no": "4", "raw_text": "15 * 15 CM", "value": 15, "value2": 15, "unit": "CM", "comparator": "", "location": "", "note": "", "source": {"method": "paper_cells", "column": "right", "column_title": "實測值：", "rect": {"x": 983, "y": 444, "w": 494, "h": 664}, "scale": 2, "passes": 2}}], "items": [], "dropped": ["observations「搭接長度」:原文「≧ CM」沒有可用數值,未採用", "observations「搭接長度」:原文「≧ CM」沒有可用數值,未採用", "observations「搭接長度」:原文「(3)搭接長度: ≧ CM」沒有可用數值,未採用", "observations「搭接長度」:原文「(4)搭接長度: ≧ CM」沒有可用數值,未採用", "observations「搭接長度」:原文「(1)搭接長度: = CM」沒有可用數值,未採用", "位置:兩次辨識不一致(「4-H-25m」vs「4-E-25m」),未採用", "表上工項:兩次辨識不一致(「鋼筋網鋪設」vs「鋼筋綁紮檢查」),未採用", "實測／設計紀錄「線徑 Φ9 DⅡΦ20CM」:兩次辨識不一致,未採用(不確定的讀數一律留空待人填)", "實測／設計紀錄「網目 Φ9 DⅡΦ20CM」:兩次辨識不一致,未採用(不確定的讀數一律留空待人填)", "實測／設計紀錄「線徑 Φ9 DⅡΦ20CM」:兩次辨識不一致,未採用(不確定的讀數一律留空待人填)", "實測／設計紀錄「網目 Φ9 DⅡΦ20CM」:兩次辨識不一致,未採用(不確定的讀數一律留空待人填)", "實測／設計紀錄「搭接長度 ≧ 27 CM」:兩次辨識不一致,未採用(不確定的讀數一律留空待人填)", "實測／設計紀錄「搭接長度 ≧ 27 CM」:兩次辨識不一致,未採用(不確定的讀數一律留空待人填)", "實測／設計紀錄「搭接長度 (1)搭接長度: 11 ≧ 27 CM」:兩次辨識不一致,未採用", "實測／設計紀錄「搭接長度 (2)搭接長度: 11 ≧ 27 CM」:兩次辨識不一致,未採用", "實測／設計紀錄「線徑 線徑( )：線徑 11 MM」:兩次辨識不一致,未採用", "實測／設計紀錄「網目 網目 15 × 15 CM」:兩次辨識不一致,未採用", "實測／設計紀錄「線徑 線徑( )：線徑 11 MM」:兩次辨識不一致,未採用", "實測／設計紀錄「網目 網目 15 × 15 CM」:兩次辨識不一致,未採用", "設計「搭接長度 11 ≥ 29 CM」:兩次辨識不一致,未採用(不確定的讀數一律留空待人填)", "設計「搭接長度 11 ≥ 29 CM」:兩次辨識不一致,未採用(不確定的讀數一律留空待人填)", "設計「搭接長度 11 ≥ 27 CM」:兩次辨識不一致,未採用", "設計「搭接長度 11 ≥ 27 CM」:兩次辨識不一致,未採用", "「搭接長度」:數值 2 未出現在原文「二  CM」,未採用", "「搭接長度」:原文「亲  CM」沒有可用數值,未採用", "「搭接長度」:數值 2 未出現在原文「二  CM」,未採用", "實測欄「搭接長度」:原文「≧  CM」帶容許範圍符號(>=),可能讀到設計欄,整筆未採用", "「搭接長度」:數值 2 未出現在原文「二 CM」,未採用", "「搭接長度」:原文「等 CM」沒有可用數值,未採用", "「搭接長度」:數值 2 未出現在原文「二 CM」,未採用", "實測欄「搭接長度」:原文「≧ CM」帶容許範圍符號(>=),可能讀到設計欄,整筆未採用"]}

// 深拷貝:呼叫端(normalize／agreeRecords)不得改到常數
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function stubClassify(hint?: string | null, scene: StubScene = 'site'): SitePhotoResult {
  if (scene === 'paper_form_line_a') return clone(PAPER_FORM_LINE_A_CLASSIFY)
  return {
    caption: '本機 stub:現場照片(非真實辨識)', category: '施工作業', is_construction: true, legible: true,
    text_legible: false, has_board: false, record_medium: 'none',
    work_item_hint: (hint ?? '').trim(), visible_progress: '', location: null, location_text: '', dropped: [],
  }
}

export function stubWhiteboard(scene: StubScene = 'site'): WhiteboardResult {
  if (scene === 'paper_form_line_a') return clone(PAPER_FORM_LINE_A_RECORD)
  return {
    record_medium: 'other', log_date: '', log_date_text: '', log_date_conflict: null, weather: '',
    location: '', location_text: '', work_item_text: '', work_summary: '', observations: [], items: [], dropped: [],
  }
}

/**
 * 紙表逐格辨識的 stub(B2)。紙表情境下 run 會先切塊(paperFormImaging)再逐格;e2e 的照片是 1×1 的極小 JPEG,
 * 偵測不到紙張區域就退回整張路徑(stubWhiteboard 已帶真實輸出的 observations,含 paper_cells 來源矩形)。
 * 萬一走到這裡也不會憑空生出實測值——空的 column_seen 會讓 normalizePaperCellRead 整塊丟掉,退回整張圖的結果。
 */
export function stubPaperCells(): { column_seen: string; rows: [] } {
  return { column_seen: '', rows: [] }
}

// 供測試與工具比對:各情境的原始輸出(與 vision-after-b2.json 逐字相同)
export const STUB_SCENE_SOURCES = {
  paper_form_line_a: { case: 'LINE_A~4_0.JPG', condition: 'original', classify: PAPER_FORM_LINE_A_CLASSIFY, record: PAPER_FORM_LINE_A_RECORD },
} as const
