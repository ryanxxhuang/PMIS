# 組長簡報 PowerPoint 版：怎麼重建

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

## 三支腳本各自在做什麼

| 檔 | 為什麼需要它 |
|---|---|
| `build.js` | 版面與內容。23 頁＝20 內容頁 ＋ 3 頁幕別分隔。用 pptxgenjs |
| `fix_ea.py` | **不能省**。pptxgenjs 只寫 `<a:latin>`，PowerPoint 碰到中文會改查佈景主題的 `minorFont/ea`，那格是空的 → Windows 上會落到新細明體。這支逐一補 `<a:ea>`／`<a:cs>` 為微軟正黑體。佈景主題檔要跳過（`majorFont` 的 schema 是 latin→ea→cs→font\*，再插一組會違反 XSD） |
| `check_fit.py` | 本機沒有 LibreOffice，沒辦法逐頁算圖檢查。改用確定性檢查：形狀有沒有出血／壓到頁尾，以及**表格會被 PowerPoint 撐到多高、會不會撞到下面手擺的文字**（pptxgenjs 寫進 XML 的列高只是估值，實際會更高——這是最容易出事的地方） |

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
