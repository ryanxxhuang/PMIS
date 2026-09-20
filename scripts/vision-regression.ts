// 照片辨識回歸(真實模型)。2026-09-20 廠商驗收 B 的驗收工具。
// ---------------------------------------------------------------------------
// 為什麼用 Deno 而不是 node:這支直接 import Edge 真正在用的 schema／prompt／normalize
//(supabase/functions/_shared/sitePhotoVision.ts),與產品同一份定義、同一個執行期;
// 另寫一份 JS 鏡像就會出現「回歸測的不是上線的那一版」。
//
// 跑法(金鑰由 --env-file 讓執行期自己讀,**不要 cat、不要印出來**):
//   deno run --allow-read --allow-env --allow-net --allow-run --env-file=.env.e2e.real \
//     scripts/vision-regression.ts --photos-dir=/Volumes/GameSSD/Projects/PMIS --out=/tmp/vision.json
//
// 紅線:
//   * 五張現場照片是真實工地照(含可識別資訊),**不進版控**;這支只以本機路徑讀取,
//     缺檔一律 skip 並明說缺哪幾張,絕不改用合成圖假裝跑過。
//   * 這支**不硬編任何「檔名 → 正確答案」**。判定只用與檔案無關的通則(下方 RULES):
//     設計值不得當實測、位置要有原文、空欄不得變成數字、完成數量與尺寸不得互換……
//     逐張的人工標註留在驗收報告裡由人比對,不寫進程式。
//   * 原圖與「前端壓縮後實際送出的圖」是**兩個條件**,分開跑、分開記(--mode)。
//   * 輸出 JSON 不含影像位元組、不含金鑰;只有雜湊、結構化結果、用量與延遲。預設也**不含模型原始輸出**
//     ——被第二階段砍掉的誤讀裡可能有憑空生出的公司名;除錯要看就加 --keep-raw,那份留本機不要提交。

import { claudeJson } from '../supabase/functions/_shared/claude.ts'
import {
  SITE_PHOTO_PROMPT, WHITEBOARD_PROMPT, agreeRecords, groundedLocation, hasWrittenRecord, needsSecondPass,
  normalizeSitePhotoResult, normalizeWhiteboardResult, sitePhotoCall, whiteboardCall,
} from '../supabase/functions/_shared/sitePhotoVision.ts'
import type { SitePhotoResult, WhiteboardResult } from '../supabase/functions/_shared/sitePhotoVision.ts'
// 壓縮參數取自前端唯一定義(src/lib/imageCompress.js),不另抄一份常數
import { MAX_EDGE_PX, SKIP_BELOW_BYTES } from '../src/lib/imageCompress.js'

const FILES = ['LI2995~1_0.JPG', 'LI89DE~1_0.JPG', 'LIEE66~1_0.JPG', 'LIFA1C~1_0.JPG', 'LINE_A~4_0.JPG']

type Args = { photosDir: string; out: string | null; mode: 'original' | 'upload' | 'both'; negatives: boolean; workDir: string; keepRaw: boolean }
function parseArgs(): Args {
  const get = (k: string) => Deno.args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=')
  const mode = (get('mode') ?? 'original') as Args['mode']
  if (!['original', 'upload', 'both'].includes(mode)) throw new Error('--mode 只接受 original／upload／both')
  return {
    photosDir: get('photos-dir') ?? Deno.env.get('PMIS_VISION_PHOTOS') ?? '',
    out: get('out') ?? null,
    mode,
    negatives: Deno.args.includes('--negatives'),
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
  }
  for (const it of r.items) {
    if (it.quantity != null && !it.unit) push('quantity-needs-unit', `完成數量「${it.description}=${it.quantity}」沒有單位`)
    const dimLike = r.observations.some((o) => o.raw_text && it.raw_text && o.raw_text === it.raw_text)
    if (dimLike) push('dimension-as-quantity', `「${it.raw_text}」同時出現在尺寸與完成數量`)
  }
  for (const d of r.dropped) push('post-check-dropped', d)
  return out
}

async function runCase(c: Case, keepRaw: boolean) {
  const bytes = await Deno.readFile(c.path)
  const image = b64(bytes)
  const t0 = performance.now()
  const cls = await claudeJson({ ...sitePhotoCall(image, 'image/jpeg'), timeoutMs: 60_000, retries: 1, retryTimeouts: false })
  const classifyMs = Math.round(performance.now() - t0)
  const classify = cls.error ? null : normalizeSitePhotoResult(cls.data)
  let record: WhiteboardResult | null = null
  let recordFirst: WhiteboardResult | null = null
  let recordSecond: WhiteboardResult | null = null
  let recordMs: number | null = null
  const recordUsage: unknown[] = []
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
  return {
    case: c.name,
    condition: c.condition,
    derived_from: c.derivedFrom ?? null,
    why: c.why ?? null,
    sha256: await sha256(bytes),
    bytes: bytes.length,
    model: cls.model ?? null,
    classify_ms: classifyMs,
    record_ms: recordMs,
    record_passes: recordRaw.length,
    usage: { classify: cls.usage ?? null, record: recordUsage },
    classify_error: cls.errorCode ?? null,
    ...(keepRaw ? { classify_raw: cls.error ? null : cls.data, record_raw: recordRaw, record_pass1: recordFirst, record_pass2: recordSecond } : {}),
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
    const r = await runCase(c, args.keepRaw)
    results.push(r)
    const f = r.findings.length ? ` ⚠ ${r.findings.length} 項` : ''
    console.error(`· ${r.case} [${r.condition}] classify ${r.classify_ms}ms${r.record_ms != null ? ` + 轉錄 ×${r.record_passes} ${r.record_ms}ms` : ''}${f}`)
  }

  const sum = (k: 'input_tokens' | 'output_tokens') => results.reduce((a, r) => {
    const u = (x: unknown) => (x && typeof x === 'object' ? Number((x as Record<string, unknown>)[k] ?? 0) : 0)
    return a + u(r.usage.classify) + r.usage.record.reduce((b: number, x: unknown) => b + u(x), 0)
  }, 0)

  const report = {
    tested_at_utc: new Date().toISOString(),
    scope: 'Edge 共用 sitePhotoCall + 條件式 whiteboardCall(2026-09-20 B 新 schema);未走網頁上傳、標單配對、文件持久化、簽署或計價。',
    mode: args.mode,
    negatives: args.negatives,
    prompt_sha256: {
      site_photo: await sha256Text(SITE_PHOTO_PROMPT),
      record: await sha256Text(WHITEBOARD_PROMPT),
    },
    missing_files: missing,
    calls: results.reduce((a, r) => a + 1 + r.record_passes, 0),
    usage_total: { input_tokens: sum('input_tokens'), output_tokens: sum('output_tokens') },
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
