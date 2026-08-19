# 組長簡報 PowerPoint 版：怎麼重建

> **文件狀態：ACTIVE BUILD NOTE。** 只規範簡報產物的重建方式，不是產品或系統架構規格。

`docs/pitch/組長簡報-產品資安與簽辦-2026-08-12.pptx` 不是手工做的，是這三支腳本產的。
**要改內容請改 `build.js`，不要直接改 .pptx**——否則下次重建就會蓋掉。

同源的網頁版在 `docs/pitch/組長簡報-產品資安與簽辦-2026-08-12.html`（兩份內容要一起改）。

```bash
npm i pptxgenjs --os=darwin --cpu=arm64
```

```bash
node build.js raw.pptx && python3 fix_ea.py raw.pptx ../組長簡報-產品資安與簽辦-2026-08-12.pptx && python3 check_fit.py ../組長簡報-產品資安與簽辦-2026-08-12.pptx
```

（`~/.npmrc` 全域寫死 `os=linux`，mac 本機不加 `--os=darwin --cpu=arm64` 會裝壞。）

## 四支腳本各自在做什麼

| 檔 | 為什麼需要它 |
|---|---|
| `build.js` | 版面與內容。25 頁＝22 內容頁 ＋ 3 頁幕別分隔（壹／貳／參）。用 pptxgenjs |
| `fix_ea.py` | **不能省**。pptxgenjs 只寫 `<a:latin>`，PowerPoint 碰到中文會改查佈景主題的 `minorFont/ea`，那格是空的 → Windows 上會落到新細明體。這支逐一補 `<a:ea>`／`<a:cs>` 為微軟正黑體。佈景主題檔要跳過（`majorFont` 的 schema 是 latin→ea→cs→font\*，再插一組會違反 XSD） |
| `pick.py` | 抽出單一頁做成單頁 pptx。QuickLook 只畫第一頁,靠這支才能逐頁目視檢查（`python3 pick.py D.pptx p20.pptx 20` 再 `qlmanage -t`）。⚠️ QuickLook 的 Office 轉譯器**不吃儲存格上下內距**,表格會畫得比真實 PowerPoint 矮——看到表格下方留白過多不用急著改,以 `check_fit.py` 的估算為準 |
| `check_fit.py` | 本機沒有 LibreOffice，沒辦法逐頁算圖檢查。改用確定性檢查：形狀有沒有出血／壓到頁尾，以及**表格會被 PowerPoint 撐到多高、會不會撞到下面手擺的文字**（pptxgenjs 寫進 XML 的列高只是估值，實際會更高——這是最容易出事的地方） |

## v3：這是**會後寄給組長自己看的文件**，不是簡報稿

會談已經發生，而且組長當時沒看到這份；他的狀態是「**還在想要怎麼合作**」。
所以任何「已確定／今天請您決定」的寫法都是錯位的，**不要改回去**：

- 第參幕從「請您決定的清單」整段改成「**供參的行政整理**」，標題也從「簽辦」改成「行政」。
- 新增 **P19 合作方式四個層級**（先看／用真文件跑一次／單一功能／單案訂閱），
  前兩格零採購零程序——這是這份文件的核心一頁，因為它直接回答他當下真正的問題。
- P20 的四項一律寫成「**我方查證與理解，如與貴校實務有出入請指正**」，
  會辦動線的核定節點改「依校內權責」，不再斷言組長可核。
- P21 驗收三方案保留但改成「屆時的行政細節（供參），三種我方都接受」，
  「建議」籤改成「實務常見」。
- 結尾只留**一個零承諾的 ask**：引薦計網中心。其他兩件標明「不急」。

## v2（會後改版）的四個實質改動——都是使用者當面指定的，不要改回去

1. **全案不用黑。** 場景頁（封面／幕別／結尾）改深鋼青藍 `#154C74`，最深的墨色也改藍灰 `#1D2B39`。
2. **採購方式已確定是小額採購逕洽、核定層級確定是組長**，不再花版面分析採購法
   → 壓成 P19「本案已經確定的四件事」。
3. **政府採購沒有「不想用就退掉」。** v1 結尾那套「四週後不想用就結束」的試辦話術整段拿掉，
   改成 P21 一頁可寫進契約的服務承諾（可用率、回應時限、資料可攜、期滿刪除切結…）。
   ⚠️ 那六項是會被寫進契約的義務，改數字前先確認做得到。
4. **新增 P20「履約期間與驗收時點」。** 簽一定要寫到何時驗收，這是本案唯一還沒定的事；
   提甲／乙／丙三方案並建議乙（開通驗收）。法源只引兩條，不展開：
   施行細則 §90-1（勞務得書面驗收）、§94（可得驗收後三十日內辦理）。

## 兩條講話紅線（改文案時不要破壞）

1. **標的名稱一律「雲端訂閱服務（SaaS）」。** 一旦文件裡出現「開發／客製／建置」，
   工程會一覽表的歸類會從「SaaS 套裝型」掉到「應用軟體或系統開發服務」，
   普級要求暴增（主機弱點掃描、網站弱點掃描、資安維運、教育訓練…），15 萬做不完。
   P11 出現這三個詞是**刻意的**——那頁在講「要排除的類型」。
2. **不寫死價格與時程。** 行號尚未核准，開不出估價單；報了價卻交不出估價單傷更大。

## 數字的出處

功能頁面 36（`src/App.jsx` 路由數）、AI 模組 16（`src/lib/aiFeatures.js`）、
單元測試 503（`npx vitest run`）、資料庫權限測試 20 套（`supabase/tests/`）。
**改版前先重跑一次，不要沿用舊數字。**

---

# 合作簡報（事務所／顧問公司）：怎麼重建

`build-partner.cjs` 一支產兩份。**跟組長簡報是不同對象、不同說法，不要互相抄文案**：

| | 組長簡報 `build.js` | 合作簡報 `build-partner.cjs` |
|---|---|---|
| 對象 | 機關承辦／組長 | 建築師事務所、工程顧問公司 |
| 目的 | 把系統賣進該機關，過採購與資安 | 一起做——他們自己用、一起投標、或出 know-how |
| 主軸 | 採購歸類、資通安全基本要求一覽表 | 監造日常痛點、共同投標分工、低承諾合作階梯 |

```bash
npm i pptxgenjs --no-save --os=darwin --cpu=arm64
```

## 兩個版本：預設是銷售版

| | 頁數 | 給誰 | 怎麼產 |
|---|---|---|---|
| **銷售版（預設）** | 20 | 帶去談的那一場。只留「你的痛 → 產品畫面 → 為什麼信得過 → 怎麼開始」 | `node build-partner.cjs out.pptx` |
| 完整版 | 29 | 已經有興趣、要深談，或會後寄出去讓對方自己看 | `node build-partner.cjs out.pptx --full` |

P02「為什麼是我」是**兩個版本都有**的核心頁：三欄刻意對齊產品的三方模型（監造／機關／系統），
因為創辦人的經歷剛好就是那三方。⚠️ **年資只寫了公務員的 4 年**；台灣世曦監造 1 年、AI 新創產品經理
半年寫職稱不寫年資——不是隱瞞，是不把最短的兩個數字放在最顯眼處，當面被問一定照實答，
所以那頁不得出現任何暗示更久的字眼。獎項寫「**經手工程獲**公共工程金質獎、金品獎」，
因為這兩個獎頒給工程與團隊、不是頒給個人；若確實是主辦或承辦人，可自行改寫得更強。

⚠️ **使用者明確要求銷售版不要講那 9 頁**（幕別 ×3、北極星三層定位、兩條資料脊椎、AI 模組總表、
技術現況數字、機關端趨勢、誠實頁），理由是「我就是 sales，不需要的東西不用講」。
它們沒有被刪，是包在 `if (FULL)` 裡——**不要把它們改回預設**。

```bash
node docs/pitch/pptx/shots.js && node docs/pitch/pptx/build-partner.cjs /tmp/sales-raw.pptx && python3 docs/pitch/pptx/fix_ea.py /tmp/sales-raw.pptx "docs/pitch/PMIS-ai-合作簡報-事務所顧問公司-2026-08-19.pptx" && python3 docs/pitch/pptx/check_fit.py "docs/pitch/PMIS-ai-合作簡報-事務所顧問公司-2026-08-19.pptx"
```

```bash
node docs/pitch/pptx/build-partner.cjs /tmp/full-raw.pptx --full && python3 docs/pitch/pptx/fix_ea.py /tmp/full-raw.pptx "docs/pitch/PMIS-ai-合作簡報-完整版-2026-08-19.pptx" && python3 docs/pitch/pptx/check_fit.py "docs/pitch/PMIS-ai-合作簡報-完整版-2026-08-19.pptx"
```

（`check_fit.py` 需要 `defusedxml`：`python3 -m pip install defusedxml`。）

## 多出來的兩支檔

| 檔 | 為什麼需要它 |
|---|---|
| `deck.cjs` | 版面元件（色票、卡片、表格、chip、chain、stat、截圖框）。從 `build.js` 抽出來讓兩份簡報同一套視覺。⚠️ **`build.js` 仍保留自己那份副本，沒有改它**——它是已寄出的成品，重構風險大於重複這 200 行。改 `deck.cjs` 不影響組長簡報 |
| `shots.js` | demo 站截圖產生器（Playwright，1440×900 @2x）。**簡報不要手動截圖**——UI 一直在動，手截會出現尺寸、捲動位置、側欄展開狀態都不一致，貼進 PPT 會很髒。輸出在 `docs/pitch/shots/` |

專案名的副檔名是 `.cjs` 不是 `.js`：`package.json` 有 `"type": "module"`，新檔用 CommonJS 必須顯式標示。

## 跑截圖的前置

`shots.js` 打的是 **demo 模式**的本機 dev server（清空 Supabase 環境變數 → 走 `demoSeed`）：

```bash
VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --port 5188
```

22 張全部重截約 40 秒。三個角色各開一個 fresh context，demoSeed 在記憶體重種，角色之間不互相污染。

**兩個已知的 demo 限制，改截圖清單前先知道：**

- `/requirements`（契約重點）在 demo 模式是空的，會顯示「需真實專案」——**不要放進簡報**。
  契約 AI 那一頁改用 `/contract` 的「義務時程」（有出處條號、罰則與逾期天數，說服力更強），
  且要用 `scrollTo: '義務時程'` 捲過頂端的上傳框，否則會截到「Demo 模式不支援」的橘字。
- `/agent` 的對話區預設是空的。用 `ask` 先點一顆建議問題，截到「問了就有出處連結」的樣子；
  demo 沒有後端，答案走離線確定性引擎，畫面上會有「離線快答」小標——這是誠實的，不要修掉。

**2026-08-19 起截圖裡的品牌是 `PMIS`**（PR #24）。頁首標誌、登入頁、公開漏洞頁與分頁標題都已改；
頁首的全域 Agent 入口改稱「問 PMIS」。舊截圖顯示 `GovAgent` 的一律重跑 `shots.js`，
不要在簡報上用註腳解釋兩個名字——那正是這次改掉的原因。

## 數字的出處（2026-08-19 重跑）

App 路由 36（`src/App.jsx` 的 `appRoutes`）、AI 模組 16（`src/lib/aiFeatures.js`，其中 1 個已退場）、
單元測試 587／60 檔（`npx vitest run`）、Demo E2E 19（`npx playwright test --list`）、
真後端 E2E 5（`e2e-real/`）、pgTAP 23 檔（`supabase/tests/`）、migration 36、Edge Functions 16。
**改版前先重跑一次，不要沿用舊數字。**
