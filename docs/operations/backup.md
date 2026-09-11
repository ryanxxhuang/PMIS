# 備份與還原 Runbook（資料庫＋Storage）

> ACTIVE RUNBOOK｜2026-09-11。本文件不授權對正式環境執行還原；還原演練一律先在一次性 staging（跑完即刪，見 [E2E 指南](../REAL_BACKEND_E2E.md)）。

## 0. 兩份備份，缺一份就是斷鏈

| 面 | 由誰備 | 內容 | 缺口 |
|---|---|---|---|
| Postgres | Supabase 平台每日備份（Pro 方案 7 天；PITR 需另開） | 表、RLS、函式、稽核事件 | **不含 Storage 物件** |
| Storage | `scripts/backup-storage.mjs`（本 repo） | 私有 bucket 的原始文件、照片 | 要人排程跑；沒跑就沒有 |

DB 只存文件路徑（`documents`／`document_versions`／`photos`），Storage 物件不在 DB 備份內。只還 DB 不還 Storage，`/contract` 會列出每份文件但下載全部 404。

## 1. Storage 備份

```bash
# service role 只在執行當下由環境變數給,不寫進 .env、不進 repo。取得方式:Supabase Dashboard → Settings → API。
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY='...' \
  node scripts/backup-storage.mjs backup ./backups/storage-$(date +%F)
```

- 產出 `<dir>/<bucket>/<path>` 與 `manifest.json`（bucket、路徑、大小、更新時間、sha256）。
- `list` 子命令只列清單不下載，用來盤點與演練前核對；`verify <dir>` 比對本機 manifest 與線上（數量／大小）並核本機 hash。
- 備份目錄放外接磁碟或另一雲端，**不要放進 repo**（`backups/` 未進版控，請自行加到 `.gitignore` 或放 repo 外）。
- 頻率建議：每週一次全量；有真案文件上傳的日子當天再跑一次。

## 2. 還原順序（演練與正式相同）

1. **先 DB**：Dashboard → Database → Backups 還原到目標時間點，或對一次性 staging 用 `pg_restore`。
2. **再 Storage**：`node scripts/backup-storage.mjs restore ./backups/storage-<日期> [bucket]`（upsert 同名 bucket；bucket 不存在會建成私有）。
3. **核對**：`verify` 子命令 0 缺 0 不符；再登入 `/contract` 隨機下載三份文件、`/site-log` 開一天的照片。
4. **RTO 記錄**：把「從決定還原到核對完成」的時間寫回 CURRENT §6.3；目標值待第一次演練後訂。

## 3. 尚未演練

截至 2026-09-11：腳本已寫、lint 通過，**未對正式 bucket 實跑**（取得 service role 需人工），也未做過 DB＋Storage 的完整還原演練。ROADMAP 的「restore/RTO 演練」仍待執行；第一次演練請用 `list` → `backup` → 一次性 staging `restore` → `verify` 四步，並把數字寫回本節。
