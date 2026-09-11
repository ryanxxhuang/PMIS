#!/usr/bin/env node
// Supabase Storage 物件備份／還原(DB 備份不含 Storage 物件,這是獨立的那一份)。
//
// 為什麼要有:ROADMAP「目前 DB 備份不包含 Storage 物件,需獨立備份與 restore/RTO 演練」。
// 專案文件的原始檔凍結在私有 bucket,DB 只存路徑;沒有這份,PITR 還原後文件會是斷鏈。
//
// 用法(service role 只在執行當下由環境變數給,絕不寫進 repo 或 .env):
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/backup-storage.mjs backup  ./backups/storage-2026-09-11      # 下載全部 bucket
//   node scripts/backup-storage.mjs list                                          # 只列清單(不下載),做盤點與演練前核對
//   node scripts/backup-storage.mjs restore ./backups/storage-2026-09-11 [bucket]  # 依 manifest 逐檔上傳(upsert)
//   node scripts/backup-storage.mjs verify  ./backups/storage-2026-09-11          # 比對本機 manifest 與線上(數量/大小)
//
// 設計取捨:
//   - 用 supabase-js 的 storage API 而不是 CLI 的 experimental `storage cp`:API 穩定、能拿到
//     每個物件的大小/更新時間寫進 manifest,還原後才有東西可核對。
//   - 逐檔序列下載(concurrency 4):bucket 是私有的,只能用 service role;不做並發風暴。
//   - manifest.json 記 bucket/路徑/大小/更新時間/sha256;verify 只比數量與大小(線上拿不到 hash)。
//   - restore 一律 upsert 到同名 bucket;bucket 不存在就建(private)。這是演練用途,
//     正式還原前先在一次性 staging 跑過(cloud-cost 原則:臨時開→驗完即刪)。
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

const [, , cmd, dir, onlyBucket] = process.argv
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!cmd || !['backup', 'list', 'restore', 'verify'].includes(cmd) || (cmd !== 'list' && !dir)) {
  console.error('用法:backup <dir> | list | restore <dir> [bucket] | verify <dir>')
  process.exit(2)
}
if (!url || !key) { console.error('缺 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 環境變數'); process.exit(2) }

const sb = createClient(url, key, { auth: { persistSession: false } })
const CONCURRENCY = 4

// Storage list 是分頁的(預設 100),且資料夾要遞迴;這裡走廣度優先把整個 bucket 攤平。
async function listAll(bucket) {
  const out = []
  const queue = ['']
  while (queue.length) {
    const prefix = queue.shift()
    let offset = 0
    for (;;) {
      const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`)
      for (const item of data) {
        const path = prefix ? `${prefix}/${item.name}` : item.name
        // 資料夾沒有 id/metadata;檔案有
        if (item.id == null && !item.metadata) queue.push(path)
        else out.push({ bucket, path, size: item.metadata?.size ?? null, updated_at: item.updated_at ?? null })
      }
      if (data.length < 1000) break
      offset += data.length
    }
  }
  return out
}

async function inventory() {
  const { data: buckets, error } = await sb.storage.listBuckets()
  if (error) throw error
  const objects = []
  for (const b of buckets) {
    if (onlyBucket && b.name !== onlyBucket) continue
    const items = await listAll(b.name)
    objects.push(...items)
    console.log(`${b.name}${b.public ? '(public)' : ''}: ${items.length} 個物件`)
  }
  return { buckets: buckets.map((b) => ({ name: b.name, public: b.public })), objects }
}

async function runPool(items, worker) {
  let i = 0
  const errors = []
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) {
      const item = items[i++]
      try { await worker(item) } catch (e) { errors.push({ item, message: e.message }) }
    }
  }))
  return errors
}

if (cmd === 'list') {
  const inv = await inventory()
  const total = inv.objects.reduce((s, o) => s + (o.size || 0), 0)
  console.log(`合計 ${inv.objects.length} 個物件,${(total / 1024 / 1024).toFixed(1)} MB`)
}

if (cmd === 'backup') {
  const inv = await inventory()
  await mkdir(dir, { recursive: true })
  const manifest = { taken_at: new Date().toISOString(), source: url, buckets: inv.buckets, objects: [] }
  const errors = await runPool(inv.objects, async (o) => {
    const { data, error } = await sb.storage.from(o.bucket).download(o.path)
    if (error) throw new Error(`${o.bucket}/${o.path}: ${error.message}`)
    const buf = Buffer.from(await data.arrayBuffer())
    const file = join(dir, o.bucket, o.path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, buf)
    manifest.objects.push({ ...o, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
  })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`已下載 ${manifest.objects.length}/${inv.objects.length} 個物件到 ${dir};失敗 ${errors.length}`)
  for (const e of errors) console.error('  失敗:', e.message)
  process.exit(errors.length ? 1 : 0)
}

if (cmd === 'restore') {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
  const { data: existing } = await sb.storage.listBuckets()
  const have = new Set((existing || []).map((b) => b.name))
  for (const b of manifest.buckets) {
    if (onlyBucket && b.name !== onlyBucket) continue
    if (!have.has(b.name)) {
      const { error } = await sb.storage.createBucket(b.name, { public: !!b.public })
      if (error) throw new Error(`建 bucket ${b.name} 失敗: ${error.message}`)
      console.log(`已建 bucket ${b.name}`)
    }
  }
  const targets = manifest.objects.filter((o) => !onlyBucket || o.bucket === onlyBucket)
  const errors = await runPool(targets, async (o) => {
    const buf = await readFile(join(dir, o.bucket, o.path))
    const { error } = await sb.storage.from(o.bucket).upload(o.path, buf, { upsert: true })
    if (error) throw new Error(`${o.bucket}/${o.path}: ${error.message}`)
  })
  console.log(`已上傳 ${targets.length - errors.length}/${targets.length};失敗 ${errors.length}`)
  for (const e of errors) console.error('  失敗:', e.message)
  process.exit(errors.length ? 1 : 0)
}

if (cmd === 'verify') {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
  const inv = await inventory()
  const online = new Map(inv.objects.map((o) => [`${o.bucket}/${o.path}`, o]))
  let missing = 0, sizeDiff = 0
  for (const o of manifest.objects) {
    const live = online.get(`${o.bucket}/${o.path}`)
    if (!live) { missing++; console.error('線上缺少:', o.bucket, o.path); continue }
    if (live.size != null && live.size !== o.size) { sizeDiff++; console.error('大小不符:', o.bucket, o.path, o.size, '→', live.size) }
  }
  // 本機檔案也核一次 hash,確認備份本身沒壞
  let corrupt = 0
  for (const o of manifest.objects) {
    const file = join(dir, o.bucket, o.path)
    try {
      const buf = await readFile(file)
      if (createHash('sha256').update(buf).digest('hex') !== o.sha256) { corrupt++; console.error('本機 hash 不符:', relative(dir, file)) }
    } catch { corrupt++; console.error('本機缺檔:', relative(dir, file)) }
  }
  const extra = inv.objects.length - (manifest.objects.length - missing)
  console.log(`manifest ${manifest.objects.length} 個;線上缺 ${missing}、大小不符 ${sizeDiff}、線上多出 ${extra};本機損壞/缺檔 ${corrupt}`)
  process.exit(missing || sizeDiff || corrupt ? 1 : 0)
}
