# 真後端 E2E 操作指南

> 狀態：**ACTIVE**
> 最後更新：2026-08-13
> 範圍：W6 的手動 Supabase staging 測試；不取代快速 Demo E2E。

## 原則

- `npm run test:e2e`：既有 Demo 測試，仍是預設 CI 護欄。
- `npm run test:e2e:real`：真 Supabase 測試，只在本機手動執行。
- 測試目標必須是臨時／隔離環境；設定檔會直接拒絕正式 Supabase URL。
- 帳號與金鑰只放環境變數或未追蹤的 `.env.e2e.real`，不得提交。
- 可使用臨時 Supabase 專案，或用完整 migrations 重建的本機 Supabase；測完刪除臨時專案／帳號。

## 準備

1. 對隔離環境套用完整 `supabase/migrations/`。
2. 建立一個已確認 email 的廠商測試帳號；W6-1 不要求帳號先有專案。
3. 複製 `.env.e2e.real.example` 為 `.env.e2e.real`，填入：

```text
E2E_REAL_SUPABASE_URL=
E2E_REAL_SUPABASE_ANON_KEY=
E2E_REAL_EMAIL=
E2E_REAL_PASSWORD=
```

也可在 shell 直接注入同名變數，不必建立檔案。

## 執行與清理

```bash
npm run test:e2e:real
```

W6-1 冒煙只做登入、session 重整還原與登出，不建立業務資料。W6-2 起的鏈測試會建立臨時帳號與專案,由各 spec 的 afterAll 自動清理(見下)。鏈測試需要額外的 `E2E_REAL_SERVICE_ROLE_KEY`(建立/刪除 fixture 帳號用;只填 staging 的 key)。通過後刪除測試帳號；若使用臨時雲端專案，整個專案刪除，不保留常駐 staging。

若缺少環境變數、URL 無效或誤指向正式 Supabase，指令會在啟動瀏覽器前直接失敗。

## 清理原則(W6-2 起)

- 業務資料一律走產品窄門清理:以建立者帳號呼叫 `delete_project` RPC(cascade 清全案),不用 service role 直刪資料表——**新版 CLI 的本機 stack 對 `service_role` 沒有資料表 GRANT**(secure-by-default),直刪會 `permission denied`;hosted 專案雖有 grant,仍以真路徑為準。
- 帳號用 admin API 刪(先刪其專案,`projects.created_by` FK 會擋 `deleteUser`)。
- 清理失敗一律 throw:staging 殘留必須大聲失敗,不能靜默留資料。
- fixture email 一律帶時間戳唯一化,重跑不互撞。
- **Storage 物件不隨 DB cascade 刪除**:刪專案前先用 storage API(service key)清該案物件——`contract-documents` 在 `projects/<id>/` 之下、`photos` 直接以 `<id>/` 開頭(helpers 的 `removeProjectStorage`)。

## W6-1 基線

2026-08-13 已以完整 migrations 重建的本機 Supabase 作一次性 staging：登入、F5 session 還原、登出 1/1 通過，臨時帳號清理後殘留 0。既有 12 條 Demo E2E、523 個 Vitest 與 production build 亦全數通過。
