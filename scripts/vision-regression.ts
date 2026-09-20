// 照片辨識回歸(真實模型)。2026-09-20 廠商驗收 B／B2 的驗收工具。
// ---------------------------------------------------------------------------
// 為什麼用 Deno 而不是 node:這支直接 import Edge 真正在用的 schema／prompt／normalize／切塊
//(supabase/functions/_shared/ 下同一批檔),與產品同一份定義、同一個執行期;
// 另寫一份 JS 鏡像就會出現「回歸測的不是上線的那一版」。
//
// 跑法(金鑰由 --env-file 讓執行期自己讀,**不要 cat、不要印出來**):
//   deno run --allow-read --allow-env --allow-net --allow-run --env-file=.env.e2e.real \
//     scripts/vision-regression.ts --photos-dir=/Volumes/GameSSD/Projects/PMIS --out=/tmp/vision.json
//
// 旗標:
//   --mode=original|upload|both   原圖 vs 前端壓縮圖(兩個條件,分開跑分開記)
//   --negatives                   加跑由原圖派生的負例(設計欄單獨、模糊卡尺、無紙表)
//   --no-cells                    關掉 B2 逐格辨識,量「只有 B 包」的對照組
//   --cells-model=<id>            逐格辨識改用別的模型(成本／品質對照;預設 MODELS.fast)
//   --keep-raw                    留模型原始輸出(**不要提交**,誤讀裡可能有憑空生出的公司名)
//
// 紅線:
//   * 五張現場照片是真實工地照(含可識別資訊),**不進版控**;這支只以本機路徑讀取,
//     缺檔一律 skip 並明說缺哪幾張,絕不改用合成圖假裝跑過。
//   * 這支**不硬編任何「檔名 → 正確答案」**。判定只用與檔案無關的通則(下方 checkRules):
//     設計值不得當實測、位置要有原文、空欄不得變成數字、完成數量與尺寸不得互換……
//     逐張的人工標註留在驗收報告裡由人比對,不寫進程式。
//   * 原圖與「前端壓縮後實際送出的圖」是**兩個條件**,分開跑、分開記(--mode)。
//   * 輸出 JSON 不含影像位元組、不含金鑰;只有雜湊、結構化結果、用量、延遲與換算成本。

import { claudeJson, MODELS } from '../supabase/functions/_shared/claude.ts'
import {
  SITE_PHOTO_PROMPT, WHITEBOARD_PROMPT, agreeRecords, groundedLocation, hasWrittenRecord, needsPaperCells, needsSecondPass,
  normalizeSitePhotoResult, normalizeWhiteboardResult, sitePhotoCall, whiteboardCall,
} from '../supabase/functions/_shared/sitePhotoVision.ts'
import type { SitePhotoResult, WhiteboardResult } from '../supabase/functions/_shared/sitePhotoVision.ts'
import { columnKindFromTitle, hasCellObservations, paperCellCall, paperCellPrompt, runPaperFormCells } from '../supabase/functions/_shared/paperFormCells.ts'
import type { PaperCellsResult } from '../supabase/functions/_shared/paperFormCells.ts'
import { COLUMN_BOUNDARY_RETRY_SHIFT_RATIO } from '../supabase/functions/_shared/paperFormLayout.ts'
import { preparePaperFormTiles } from '../supabase/functions/_shared/paperFormImaging.ts'
import { applyPaperCells } from '../supabase/functions/_shared/fieldDocDraftRun.ts'
// 壓縮參數取自前端唯一定義(src/lib/imageCompress.js),不另抄一份常數
import { MAX_EDGE_PX, SKIP_BELOW_BYTES } from '../src/lib/imageCompress.js'

const FILES = ['LI2995~1_0.JPG', 'LI89DE~1_0.JPG', 'LIEE66~1_0.JPG', 'LIFA1C~1_0.JPG', 'LINE_A~4_0.JPG']

// Anthropic 官方定價(USD / 百萬 token)。來源:claude-api skill 的 Current Models 表,
// 版本標記 cached 2026-06-24;報告要標明來源與日期,不要憑印象寫價錢。
const PRICING_SOURCE = 'Anthropic 官方定價表(claude-api skill「Current Models」,cached 2026-06-24)'
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-5': { input: 2.0, output: 10.0 },
  'claude-opus-5': { input: 5.0, output: 25.0 },
  'claude-fable-5-1': { input: 10.0, output: 50.0 },
}
const priceOf = (model: string) => {
  const key = Object.keys(PRICING).find((k) => model.startsWith(k))
  return key ? PRICING[key] : null
}

type Args = {
  photosDir: string; out: string | null; mode: 'original' | 'upload' | 'both'
  negatives: boolean; workDir: string; keepRaw: boolean; cells: boolean; cellsModel: string
}
function parseArgs(): Args {
  const get = (k: string) => Deno.args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=')
  const mode = (get('mode') ?? 'original') as Args['mode']
  if (!['original', 'upload', 'both'].includes(mode)) throw new Error('--mode 只接受 original／upload／both')
  return {
    photosDir: get('photos-dir') ?? Deno.env.get('PMIS_VISION_PHOTOS') ?? '',
    out: get('out') ?? null,
    mode,
    negatives: Deno.args.includes('--negatives'),
    cells: !Deno.args.includes('--no-cells'),
    cellsModel: get('cells-model') ?? MODELS.fast,
    // 預設不留模型原始輸出:被丟掉的那些誤讀裡可能有模型憑空生出的單位／公司名,
    // 而這份 JSON 是要進版控的證據。除錯時才加 --keep-raw(輸出留在本機,不要提交)。
    keepRaw: Deno.args.includes('--keep-raw'),
    workDir: get('work-dir') ?? Deno.makeTempDirSync({ prefix: 'pmis-vision-' }),
  }
}

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const sha256Text = async (text: string): Promise<string> => sha256(new TextEncoder().encode(text))
const b64 = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

// 前端上傳前的壓縮(src/lib/imageCompress.js:長邊 2000px、JPEG 0.82、<300KB 跳過)。
// 這裡用 macOS sips 近似;sips 的品質刻度與瀏覽器 canvas.toBlob 不完全相同,回報要註明是近似條件。
async function sips(args: string[]): Promise<boolean> {
  try {
    const p = new Deno.Command('sips', { args, stdout: 'null', stderr: 'null' }).outputSync()
    return p.success
  } catch {
    return false
  }
}

async function uploadVariant(src: string, dst: string, size: number): Promise<{ ok: boolean; note: string }> {
  if (size < SKIP_BELOW_BYTES) return { ok: false, note: `小於 ${Math.round(SKIP_BELOW_BYTES / 1024)}KB,前端跳過壓縮 → 與原圖同一條件` }
  const ok = await sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', String(MAX_EDGE_PX), src, '--out', dst])
  return { ok, note: ok ? '以 sips 近似前端壓縮(長邊 2000、JPEG 82)' : 'sips 不可用,略過壓縮條件' }
}

// 裁切／模糊負例:全部由原圖派生,來源在輸出 JSON 的 derived_from 註明(不是憑空合成的假照片)
type Negative = { name: string; from: string; why: string; build: (src: string, dst: string) => Promise<boolean> }
const NEGATIVES: Negative[] = [
  {
    name: 'neg-design-column-only', from: 'LINE_A~4_0.JPG',
    why: '只保留紙表「設計值」左欄:實測欄根本不在畫面內,模型不得生出任何 kind=measured 的觀察',
    build: (src, dst) => sips(['-c', '620', '390', '--cropOffset', '470', '600', src, '--out', dst]),
  },
  {
    name: 'neg-illegible-caliper', from: 'LI89DE~1_0.JPG',
    why: '把卡尺特寫縮到刻度完全讀不出來:場景仍可辨(legible)但 text_legible 必須為 false,且不得生出讀數',
    build: async (src, dst) => (await sips(['-Z', '200', src, '--out', dst])) && (await sips(['-Z', '1400', dst, '--out', dst])),
  },
  {
    name: 'neg-formwork-no-record', from: 'LI2995~1_0.JPG',
    why: '只保留背景模板區、畫面內沒有任何紙表:不得有書面紀錄、不得有位置、工項不得沿用鋼筋查驗的內容',
    build: (src, dst) => sips(['-c', '380', '520', '--cropOffset', '20', '40', src, '--out', dst]),
  },
]

// 與檔案無關的通則:每一條都是「不論這張是什麼照片都不該發生」的事
type Case = { name: string; path: string; condition: string; derivedFrom?: string; why?: string }
type Finding = { rule: string; detail: string }
function checkRules(c: SitePhotoResult, r: WhiteboardResult | null): Finding[] {
  const out: Finding[] = []
  const push = (rule: string, detail: string) => out.push({ rule, detail })
  if (c.location && !c.location_text) push('location-needs-source', `分類位置「${c.location}」沒有原文出處`)
  if (c.dropped.length) for (const d of c.dropped) push('post-check-dropped', d)
  const ground = groundedLocation(c, r)
  if (c.location && ground.value === null) push('location-not-grounded', ground.reason ?? '位置無原文佐證,未採用')
  if (!c.legible && (c.work_item_hint || c.visible_progress)) push('illegible-must-be-empty', '場景不可辨仍填了工項／施作內容')
  if (c.has_board && c.record_medium === 'none') push('medium-inconsistent', 'has_board=true 但 record_medium=none')
  if (!r) return out
  for (const o of r.observations) {
    if (o.kind === 'measured' && o.comparator) push('design-as-measured', `「${o.raw_text}」帶容許範圍符號卻標成實測`)
    if (!o.raw_text) push('observation-needs-raw-text', `「${o.label}」沒有原文`)
    if (o.value2 != null && o.value == null) push('two-way-dimension-halved', `「${o.raw_text}」只留了第二向`)
    // B2:逐格結果的 kind 必須與該塊印刷的欄位標題一致,且要帶得回原圖座標
    if (o.source) {
      if (columnKindFromTitle(o.source.column_title) !== o.kind) {
        push('cell-kind-not-from-title', `「${o.raw_text}」的 kind=${o.kind} 與欄位標題「${o.source.column_title}」不符`)
      }
      if (!(o.source.rect.w > 0 && o.source.rect.h > 0)) push('cell-source-rect-invalid', `「${o.raw_text}」的來源座標不合法`)
    }
  }
  for (const it of r.items) {
    if (it.quantity != null && !it.unit) push('quantity-needs-unit', `完成數量「${it.description}=${it.quantity}」沒有單位`)
    const dimLike = r.observations.some((o) => o.raw_text && it.raw_text && o.raw_text === it.raw_text)
    if (dimLike) push('dimension-as-quantity', `「${it.raw_text}」同時出現在尺寸與完成數量`)
  }
  for (const d of r.dropped) push('post-check-dropped', d)
  return out
}

type Usage = { input_tokens?: number; output_tokens?: number } | null
const uNum = (u: Usage, k: 'input_tokens' | 'output_tokens') => Number(u?.[k] ?? 0)

async function runCase(c: Case, args: Args) {
  const bytes = await Deno.readFile(c.path)
  const image = b64(bytes)
  const t0 = performance.now()
  const cls = await claudeJson({ ...sitePhotoCall(image, 'image/jpeg'), timeoutMs: 60_000, retries: 1, retryTimeouts: false })
  const classifyMs = Math.round(performance.now() - t0)
  const classify = cls.error ? null : normalizeSitePhotoResult(cls.data)

  // ── B2 逐格辨識(只在紙本表單;與 Edge 共用 runPaperFormCells,流程只有一份) ──
  let cellsSkipped: string | null = null
  let cellsMs: number | null = null
  let cellsRetried = false
  const cellsUsage: Usage[] = []
  const cellRaw: unknown[] = []
  let cellTiles: { index: number; column: string; rect: Record<string, number>; scale: number; title: string; kind: string | null; kept: number }[] = []
  let cells: PaperCellsResult | null = null
  if (classify && args.cells && needsPaperCells(classify)) {
    const t = performance.now()
    const run = await runPaperFormCells({
      tiles: (o) => preparePaperFormTiles(image, 'image/jpeg', o),
      read: async (tile, hint) => {
        const call = paperCellCall(tile.base64, tile.mime, hint)
        const res = await claudeJson({ ...call, model: args.cellsModel, timeoutMs: 60_000, retries: 1, retryTimeouts: false })
        cellsUsage.push(res.usage ?? null)
        cellRaw.push(res.error ? { error: res.errorCode } : res.data)
        return res.error ? { error: res.error, errorCode: res.errorCode ?? 'claude_error' } : { data: res.data }
      },
      retryShift: COLUMN_BOUNDARY_RETRY_SHIFT_RATIO,
    })
    cellsMs = Math.round(performance.now() - t)
    cells = run.cells
    cellsSkipped = run.skipped
    cellsRetried = run.retried
    cellTiles = run.reads.map((x) => ({
      index: x.tile.index, column: x.tile.column, rect: x.tile.rect, scale: x.tile.scale,
      title: x.columnTitle, kind: x.kind, kept: x.observations.length,
    }))
  } else if (classify && needsPaperCells(classify) && !args.cells) {
    cellsSkipped = 'disabled_by_flag'
  }
  const cellsUsed = !!cells && hasCellObservations(cells)

  // ── 整張圖轉錄(逐格成功時只讀一次) ───────────────────────────────────────
  let record: WhiteboardResult | null = null
  let recordFirst: WhiteboardResult | null = null
  let recordSecond: WhiteboardResult | null = null
  let recordMs: number | null = null
  const recordUsage: Usage[] = []
  const recordRaw: unknown[] = []
  if (classify && hasWrittenRecord(classify)) {
    const t1 = performance.now()
    const passes = needsSecondPass(classify) ? 2 : 1
    const got: WhiteboardResult[] = []
    for (let i = 0; i < passes; i++) {
      const wb = await claudeJson({ ...whiteboardCall(image, 'image/jpeg'), timeoutMs: 60_000, retries: 1, retryTimeouts: false })
      recordUsage.push(wb.usage ?? null)
      recordRaw.push(wb.error ? { error: wb.errorCode } : wb.data)
      const n = wb.error ? null : normalizeWhiteboardResult(wb.data)
      if (n) got.push(n)
    }
    recordMs = Math.round(performance.now() - t1)
    recordFirst = got[0] ?? null
    recordSecond = got[1] ?? null
    record = got.length === 2 ? agreeRecords(got[0], got[1]) : (got[0] ?? null)
  }
  if (cells) record = applyPaperCells(record, cells)

  // ── 成本 ────────────────────────────────────────────────────────────────
  const classifyPrice = priceOf(cls.model ?? MODELS.fast)
  const cellPrice = priceOf(args.cellsModel)
  const sumU = (list: Usage[], k: 'input_tokens' | 'output_tokens') => list.reduce((a, u) => a + uNum(u, k), 0)
  const inClassify = uNum(cls.usage ?? null, 'input_tokens'), outClassify = uNum(cls.usage ?? null, 'output_tokens')
  const inRecord = sumU(recordUsage, 'input_tokens'), outRecord = sumU(recordUsage, 'output_tokens')
  const inCells = sumU(cellsUsage, 'input_tokens'), outCells = sumU(cellsUsage, 'output_tokens')
  const usd = (i: number, o: number, p: { input: number; output: number } | null) =>
    p ? Number(((i / 1e6) * p.input + (o / 1e6) * p.output).toFixed(6)) : null
  const costClassify = usd(inClassify, outClassify, classifyPrice)
  const costRecord = usd(inRecord, outRecord, classifyPrice)
  const costCells = usd(inCells, outCells, cellPrice)
  const costTotal = [costClassify, costRecord, costCells].every((x) => x != null)
    ? Number(((costClassify! + costRecord! + costCells!)).toFixed(6))
    : null

  return {
    case: c.name,
    condition: c.condition,
    derived_from: c.derivedFrom ?? null,
    why: c.why ?? null,
    sha256: await sha256(bytes),
    bytes: bytes.length,
    model: cls.model ?? null,
    cells_model: args.cells ? args.cellsModel : null,
    classify_ms: classifyMs,
    record_ms: recordMs,
    record_passes: recordRaw.length,
    cells_ms: cellsMs,
    cells_calls: cellsUsage.length,
    cells_skipped: cellsSkipped,
    cells_retried: cellsRetried,
    cells_used: cellsUsed,
    cell_tiles: cellTiles,
    usage: { classify: cls.usage ?? null, record: recordUsage, cells: cellsUsage },
    tokens: { classify: [inClassify, outClassify], record: [inRecord, outRecord], cells: [inCells, outCells] },
    cost_usd: { classify: costClassify, record: costRecord, cells: costCells, total: costTotal },
    classify_error: cls.errorCode ?? null,
    ...(args.keepRaw ? { classify_raw: cls.error ? null : cls.data, record_raw: recordRaw, cells_raw: cellRaw, record_pass1: recordFirst, record_pass2: recordSecond } : {}),
    // 兩階段各自讀到幾筆(不含內容):看得出第二階段砍掉多少不穩定的讀數
    record_pass_counts: [recordFirst, recordSecond].map((x) => (x ? { observations: x.observations.length, items: x.items.length } : null)),
    classify,
    record,
    // 會真的落進草稿的位置(沒有原文佐證就是 null)
    grounded_location: classify ? groundedLocation(classify, record) : null,
    // 逐欄檢查(與檔案無關的通則)
    findings: classify ? checkRules(classify, record) : [{ rule: 'classify-failed', detail: cls.errorCode ?? 'unknown' }],
  }
}

async function main() {
  const args = parseArgs()
  if (!args.photosDir) {
    console.error('缺 --photos-dir(或環境變數 PMIS_VISION_PHOTOS):五張回歸照片不進版控,請指定本機路徑。跳過整輪。')
    Deno.exit(2)
  }
  if (!Deno.env.get('ANTHROPIC_API_KEY')) {
    console.error('沒有 ANTHROPIC_API_KEY(請用 --env-file=.env.e2e.real 讓執行期自己讀,不要把金鑰貼進指令)。跳過整輪。')
    Deno.exit(2)
  }

  const present: string[] = []
  const missing: string[] = []
  for (const f of FILES) {
    try {
      Deno.statSync(`${args.photosDir}/${f}`)
      present.push(f)
    } catch {
      missing.push(f)
    }
  }
  if (missing.length) console.error(`⚠ 缺 ${missing.length} 張回歸照片(skip):${missing.join('、')}`)
  if (!present.length) {
    console.error('五張回歸照片都不在指定路徑,整輪 skip;不以合成圖替代。')
    Deno.exit(2)
  }

  const cases: Case[] = []
  for (const f of present) {
    const src = `${args.photosDir}/${f}`
    if (args.mode === 'original' || args.mode === 'both') cases.push({ name: f, path: src, condition: 'original' })
    if (args.mode === 'upload' || args.mode === 'both') {
      const dst = `${args.workDir}/upload-${f.replace(/[^\w.-]/g, '_')}`
      const size = Deno.statSync(src).size
      const v = await uploadVariant(src, dst, size)
      if (v.ok) cases.push({ name: f, path: dst, condition: 'upload-compressed', derivedFrom: f, why: v.note })
      else console.error(`⚠ ${f} 壓縮條件 skip:${v.note}`)
    }
  }
  if (args.negatives) {
    for (const n of NEGATIVES) {
      if (!present.includes(n.from)) { console.error(`⚠ 負例 ${n.name} skip:來源 ${n.from} 不在本機`); continue }
      const dst = `${args.workDir}/${n.name}.jpg`
      if (!(await n.build(`${args.photosDir}/${n.from}`, dst))) { console.error(`⚠ 負例 ${n.name} skip:sips 不可用`); continue }
      cases.push({ name: n.name, path: dst, condition: 'negative', derivedFrom: n.from, why: n.why })
    }
  }

  const results: Awaited<ReturnType<typeof runCase>>[] = []
  for (const c of cases) {
    const r = await runCase(c, args)
    results.push(r)
    const f = r.findings.length ? ` ⚠ ${r.findings.length} 項` : ''
    const cellNote = r.cells_calls ? ` + 逐格 ×${r.cells_calls} ${r.cells_ms}ms${r.cells_used ? '(採用)' : `(未採用:${r.cells_skipped})`}` : ''
    console.error(`· ${r.case} [${r.condition}] classify ${r.classify_ms}ms${r.record_ms != null ? ` + 轉錄 ×${r.record_passes} ${r.record_ms}ms` : ''}${cellNote}${f}`)
  }

  const sum = (pick: (r: typeof results[number]) => number) => results.reduce((a, r) => a + pick(r), 0)
  const costTotal = results.every((r) => r.cost_usd.total != null) ? Number(sum((r) => r.cost_usd.total!).toFixed(6)) : null
  const paper = results.filter((r) => r.classify?.record_medium === 'paper_form')

  const report = {
    tested_at_utc: new Date().toISOString(),
    scope: 'Edge 共用 sitePhotoCall + 條件式 whiteboardCall + B2 紙表逐格辨識(paperFormImaging／paperFormCells);' +
      '未走網頁上傳、標單配對、文件持久化、簽署或計價。',
    mode: args.mode,
    negatives: args.negatives,
    cells_enabled: args.cells,
    cells_model: args.cells ? args.cellsModel : null,
    prompt_sha256: {
      site_photo: await sha256Text(SITE_PHOTO_PROMPT),
      record: await sha256Text(WHITEBOARD_PROMPT),
      paper_cells: await sha256Text(paperCellPrompt('右半邊')),
    },
    missing_files: missing,
    calls: sum((r) => 1 + r.record_passes + r.cells_calls),
    usage_total: {
      input_tokens: sum((r) => r.tokens.classify[0] + r.tokens.record[0] + r.tokens.cells[0]),
      output_tokens: sum((r) => r.tokens.classify[1] + r.tokens.record[1] + r.tokens.cells[1]),
    },
    cost_usd_total: costTotal,
    // 每張紙表照片的平均成本(使用者最在意的數字;非紙表照片不走逐格,不納入)
    paper_form_photos: paper.length,
    cost_usd_per_paper_photo: paper.length && paper.every((r) => r.cost_usd.total != null)
      ? Number((paper.reduce((a, r) => a + r.cost_usd.total!, 0) / paper.length).toFixed(6))
      : null,
    pricing_source: PRICING_SOURCE,
    pricing_used: PRICING,
    results,
  }
  const json = JSON.stringify(report, null, 2)
  if (args.out) {
    Deno.writeTextFileSync(args.out, `${json}\n`)
    console.error(`→ ${args.out}`)
  } else {
    console.log(json)
  }
}

if (import.meta.main) await main()
