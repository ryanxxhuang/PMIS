# Apple Style 定調畫布（來源檔）

規範文件在 `docs/UIUX-Apple-設計規範.md`；本資料夾是產生它的設計來源。

線上畫布（可視覺微調、存檔會發新版本）：
https://claude.ai/code/artifact/068c4904-3bb3-41e8-9e79-d49672abba95

## 畫板

| 檔案 | 內容 |
|---|---|
| `Principles.dc.html` | **判準板**：Apple 八原則對照、流動性六條、三條不可退讓、動手前的六個問題 |
| `Main.dc.html` | 方向 B · 三欄檢閱台（**已核准為殼**） |
| `DirectionA.dc.html` | 方向 A · 收件匣（**已核准為落地點**：預設落在「待我處理」，不做 dashboard） |
| `DirectionC.dc.html` | 方向 C · 文件即介面（**已核准為詳情呈現**：履約事項的詳情欄＝契約原文＋條文高亮） |
| `Foundations.dc.html` | 基礎規格：色票亮暗雙軌、字級階梯、圓角、材質、元件、lucide 圖示樣本 |
| `Marketing.dc.html` | 行銷站首頁 hero（Apple.com 語彙，尚未套用到 `PMIS_site`） |
| `Login.dc.html` | 登入頁（v1，待依三欄殼重做） |
| `Requirements.dc.html`<br>`BOQ.dc.html` | **v1 換皮版（IA 已被疊合版取代）**。留著只當色票／字級／密度的參考，版面不要照抄——它們還是 W9 的側欄＋單頁骨架 |

三個方向不是互斥選項：A 回答「打開看到什麼」、B 回答「殼長什麼樣」、C 回答「詳情怎麼讀」，
2026-09-11 核准的是三者疊合版。

## 重新合成發佈檔

`pmis-apple-style.html` 不進版控（~2.7MB，內含畫布編輯器）。要重新產生：

```bash
node "<design skill 的 base directory>/seed-canvas.mjs" \
  --template "<同上>/payload.template.html" \
  --out pmis-apple-style.html --title "PMIS Apple 設計語言" \
  --artboard Main.dc.html --artboard Principles.dc.html \
  --artboard DirectionA.dc.html --artboard DirectionC.dc.html \
  --artboard Foundations.dc.html --artboard Marketing.dc.html --artboard Login.dc.html \
  --canvas canvas.json
```

`canvas.json` 是版面清單（座標、分頁、開啟落點）；改畫板後要同步確認它仍列到每一個 `.dc.html`。
