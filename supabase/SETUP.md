# Supabase 設定（真實版地基）

從 prototype 轉成「真的能用、能多人協作」的版本，只有「建立 Supabase 專案」這步需要你做。
照著做大約 5 分鐘，完成後把兩個值貼給我，我就接上真帳號登入與資料庫。

## 步驟

1. 到 https://supabase.com → 用 Google 或 email 註冊（免費方案就夠開始）。
2. 點 **New project**：
   - Name：`pmis-ai`（隨意）
   - Database Password：自己設一組並記下來
   - Region：選 **Northeast Asia (Tokyo)** 或 **Singapore**（離台灣近）
   - 按 Create，等約 1～2 分鐘建置。
3. 左側選 **SQL Editor** → New query → 把本資料夾 **`setup_all.sql`** 整個內容貼上 → **Run**。
   這支已合併 migrations 0001~0004，一次建好所有表（含標單工項 / 估驗 / 進度）。
   看到成功（沒有紅字錯誤）即可。
4. 左側 **Project Settings**（齒輪）→ **API**，複製這兩個值：
   - **Project URL**（像 `https://xxxxx.supabase.co`）
   - **anon public** key（很長一串）
5. 把這兩個值填到專案根目錄的 `.env`：
   ```
   VITE_SUPABASE_URL=你的 Project URL
   VITE_SUPABASE_ANON_KEY=你的 anon public key
   ```
   （或直接把兩個值貼給我，我幫你填。）

## 完成後

跟我說一聲「Supabase 好了」並提供上面兩個值，我就會：
1. 接上真正的註冊 / 登入（取代現在的假登入）。
2. 把「專案、契約文件、契約要求」改成存到真資料庫（多人、多裝置共用）。
3. 之後再逐一把 ITP、查驗、日誌、送審、RFI 等模組接到真後端。

## 安全須知

- `anon public` key 放在前端是正常的 —— 真正的資料權限由資料庫的 **RLS（Row Level Security）** 控管，
  schema 裡已設定「只有專案成員看得到 / 改得到該專案資料」。
- 千萬**不要**把 `service_role` key 放到前端或 `.env`（那把鑰匙能繞過所有權限）。
- `.env` 已加入 `.gitignore`，不會被版控上傳。
