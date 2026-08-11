# Cloudflare 搬家逐步設定指南

**建立日期**：2026-08-11
**目的**：把正式站從 `ryanxxhuang.github.io/PMIS` 搬到 `gov-agent.ai`，並讓 `public/_headers` 的安全標頭生效。

**為什麼要搬**：2026-08-11 弱點掃描 13 類警告中，**7 類的根因是 GitHub Pages 不支援自訂 HTTP 回應標頭**。
搬到 Cloudflare Pages 後，`_headers` 一次補齊。順便解決「賣 15 萬的系統掛在個人 GitHub 頁」的信任問題。

**網域現況**：`gov-agent.ai` 於 2026-08-11 註冊於 **Spaceship**，到期日 2028-08-11，
NS 目前指向 `launch1.spaceship.net` / `launch2.spaceship.net`（停放）。

---

## 第 1 步：Cloudflare 建帳號並加入網域（5 分鐘）

1. 到 `dash.cloudflare.com` 註冊免費帳號（email ＋ 密碼），完成信箱驗證
2. 登入後點 **「＋ Add」→「Connect a domain」**（或首頁的 Add a site）
3. 輸入 `gov-agent.ai` → Continue
4. 方案選 **Free** → Continue
5. Cloudflare 會掃描既有 DNS 紀錄。Spaceship 停放頁的紀錄可以**全部刪掉**（那是停放頁，不是你的服務）
6. 畫面會給你**兩組 nameserver**，長得像：
   ```
   xxxx.ns.cloudflare.com
   yyyy.ns.cloudflare.com
   ```
   **先把這兩行複製起來**，下一步要用

---

## 第 2 步：在 Spaceship 改 nameserver（3 分鐘 ＋ 等待生效）

1. 登入 `spaceship.com` → **Domains** → 點 `gov-agent.ai` → **Manage**
2. 找到 **Nameservers** 區塊，目前應該是 Spaceship 的預設值
3. 改成 **Custom nameservers**，貼上第 1 步的兩組 Cloudflare NS → Save
4. 回 Cloudflare，點 **「Check nameservers」**

> ⏱ **生效時間**：通常 5 分鐘～2 小時。Cloudflare 確認後會寄信通知。
> **這段等待期間可以直接做第 3 步，不用等。**

---

## 第 3 步：建立 Pages 專案（10 分鐘）← 最容易填錯的一步

1. Cloudflare 左側選單 → **Compute (Workers & Pages)** → **Create** → 切到 **Pages** 分頁
   → **「Connect to Git」**
2. 授權 GitHub，選擇 repo **`ryanxxhuang/PMIS`**
3. 設定建置：

   | 欄位 | 要填的值 |
   |---|---|
   | Production branch | `main` |
   | Framework preset | `Vite`（或 None 都可以，下面欄位才是關鍵） |
   | **Build command** | **`npm run build && npm run build:demo`** |
   | **Build output directory** | **`dist`** |
   | Root directory | 留空（就是 repo 根目錄） |

   > ⚠️ **Build command 一定要含 `&& npm run build:demo`**。
   > `npm run build` 只建主站；`/demo` 銷售簡報站是 `build:demo` 產生的（它靠把 Supabase
   > 環境變數設成空字串來觸發 demo 模式）。只填前者的話，**demo 站會直接消失**。

4. **Environment variables（Production）** — 展開後逐一新增，值從你本機 `.env` 複製：

   ```
   VITE_SUPABASE_URL       = https://buylyonwoyvqdbvkkkbx.supabase.co
   VITE_SUPABASE_ANON_KEY  = （.env 裡那串）
   VITE_SENTRY_DSN         = （.env 裡那串）
   ```

   > ⚠️ **漏了不會報錯**，會安靜地建出一個連不上資料庫的站。
   > anon key 是設計上就給前端用的公開金鑰，放這裡沒有問題；
   > **`service_role` 金鑰絕對不要出現在這裡**（全 repo 本來就零命中，維持下去）。

5. **Save and Deploy** → 第一次建置約 2–4 分鐘

   > Node 版本：repo 有 `.nvmrc`（`22`），Cloudflare 會自動採用。
   > 若建置報 Node 版本錯誤，補一個環境變數 `NODE_VERSION = 22`。

---

## 第 4 步：綁自有網域（2 分鐘，需第 2 步已生效）

1. Pages 專案 → **Custom domains** → **Set up a custom domain**
2. 輸入 `gov-agent.ai` → Continue → Activate
   （DNS 已在 Cloudflare，紀錄會自動建立，憑證自動簽發）
3. 建議同時加 `www.gov-agent.ai`，Cloudflare 會自動轉址到主網域

---

## 第 5 步：Email Routing 建 security@（5 分鐘）

這步是為了把 `/security` 頁上的個人 Gmail 換成網域信箱——機關會看這個細節。

1. Cloudflare 左側選 **你的網域** `gov-agent.ai` → **Email** → **Email Routing** → Get started
2. **Destination addresses**：新增你的 Gmail → Cloudflare 會寄驗證信，去收信點確認
3. **Custom addresses**：新增 `security@gov-agent.ai` → 指向剛才驗證的 Gmail
4. **Enable Email Routing**（會自動加 MX 與 SPF 紀錄）
5. 建議一併建 `hello@` 或 `service@` 當一般聯絡信箱

> 💡 也可以直接建一條 **catch-all**，`*@gov-agent.ai` 全部轉到 Gmail，之後不用再一個一個開。

---

## 第 6 步：完成後告訴 AI，由它接手驗證

搬完後要做的四件事（由 AI 執行，你不用動手）：

1. **實測回應標頭有沒有生效**（`curl -I` 逐項核對 `_headers`）
2. **瀏覽器 console 檢查 CSP 違規** ← **唯一可能出意外的地方**
   （若字型或 PDF 預覽被擋，當場調整 `_headers` 再部署）
3. **重跑 OWASP ZAP 掃描**，把 `docs/資安/弱點掃描-2026-08-11/` 的報告
   從「待移轉後修正」更新為「已清」——這份是要送計網中心的
4. **把 `security@gov-agent.ai` 換掉個人 Gmail**（三處：`VITE_SECURITY_CONTACT`、
   `public/.well-known/security.txt`、簽辦文件引用的網址）
5. **改 deploy 流程**：`package.json` 的 `deploy` 目前是推 gh-pages，
   之後改成 Cloudflare 自動部署（push 到 `main` 就部署）

---

## 注意事項

- **舊站先留著別關**。等新站驗證通過再停用 GitHub Pages。
  但**不要長期並存**——兩個站等於兩個攻擊面，機關看到兩個網址也會混淆。
- **HSTS preload 先不要送**。`_headers` 目前設了 `max-age` 但沒有 `preload` 指示；
  等網域穩定跑一段時間、確認全站 HTTPS 無誤後再考慮送 preload 申請
  （送出後很難撤回，網域若有子網域沒上 HTTPS 會整組壞掉）。
- **`/demo/_headers` 與 `/demo/_redirects` 會被當靜態檔公開**（Cloudflare Pages 只處理根目錄的）。
  內容只是標頭政策不是機密，但若在意，可日後讓 demo 建置不複製 `public/`。
- **HashRouter 維持不變**：目前網址是 `gov-agent.ai/#/security`。
  搬到根網域後其實可以改用 BrowserRouter 得到乾淨網址（`/security`），
  `public/_redirects` 的 SPA fallback 已經備好、e2e 也沒寫死 hash 路徑——
  **但這是獨立的一次改動，不要和搬家綁在一起做**，免得出事時分不清是哪個原因。
