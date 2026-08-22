# 合作簡報 PowerPoint：怎麼重建

> **文件狀態：ACTIVE BUILD NOTE。** 只規範簡報產物的重建方式，不是產品或系統架構規格。

目前對外只有一份簡報：

| 檔 | 對象 | 目的 |
|---|---|---|
| `docs/pitch/PMIS-ai-合作簡報-事務所與顧問公司-2026-08-21.pptx`（16 頁） | 建築師事務所、工程顧問公司 | 一起做——他們自己用、一起投標、或出 know-how |

**2026-08-21 起，舊的簡報（合作簡報 08-19 銷售版／完整版、組長簡報 08-12 的 pptx 與 html、客戶簡報 07 html）
已依使用者指示移出 `docs/pitch/`，改由本份取代。** 對應的舊產生器 `build.js`（組長簡報）與
`build-partner.cjs`（08-19 合作簡報）與共用版面元件 `deck.cjs` 仍留在本目錄，但已無對應產物；
其中的文案判斷（採購歸類、資安一覽表、四階梯的措辭）仍有參考價值，要刪之前先讀過。

**要改內容請改 `build-2026.cjs`，不要直接改 .pptx**——否則下次重建就會蓋掉。

## 一次跑完

```bash
npm i pptxgenjs --no-save --os=darwin --cpu=arm64      # ~/.npmrc 全域寫死 os=linux，mac 不加會裝壞
python3 -m pip install pillow defusedxml
```

```bash
# demo 模式 dev server（另開一個 terminal）
VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --port 5188
```

```bash
node docs/pitch/pptx/shots.js \
  && python3 docs/pitch/pptx/crop.py \
  && node docs/pitch/pptx/build-2026.cjs /tmp/raw.pptx \
  && python3 docs/pitch/pptx/fix_ea.py /tmp/raw.pptx "docs/pitch/PMIS-ai-合作簡報-事務所與顧問公司-2026-08-21.pptx" \
  && python3 docs/pitch/pptx/check_fit.py "docs/pitch/PMIS-ai-合作簡報-事務所與顧問公司-2026-08-21.pptx"
```

## 每支腳本在做什麼

| 檔 | 為什麼需要它 |
|---|---|
| `shots.js` | demo 站截圖產生器（Playwright，1440×900 @2x，輸出 `docs/pitch/shots/`）。**簡報不要手動截圖**——UI 一直在動，手截會出現尺寸、捲動位置、側欄展開狀態都不一致，貼進 PPT 會很髒。22 張全部重截約 40 秒 |
| `crop.py` | 把整頁截圖裁成內容區（輸出 `docs/pitch/shots-crop/`）。整頁圖貼進半版空間後欄位名稱會小到讀不到；裁掉重複的側欄與頁首之後同寬可放大約 1.35 倍。`sv-rail` 反過來只留側欄，用來講「六個工作面」 |
| `build-2026.cjs` | 版面與內容，16 頁。視覺 token 直接抄產品 `src/index.css`（底 `#F8FAFD`、卡框 `#E3E6EA`、主色 `#0B57D0`、狀態色票同值）——簡報與產品放在一起要像同一家的東西 |
| `fix_ea.py` | **不能省**。pptxgenjs 只寫 `<a:latin>`，PowerPoint 碰到中文會改查佈景主題的 `minorFont/ea`，那格是空的 → Windows 上會落到新細明體。這支逐一補 `<a:ea>`／`<a:cs>` 為微軟正黑體 |
| `check_fit.py` | 確定性的版面檢查：形狀有沒有出血／壓到頁尾，以及表格會被 PowerPoint 撐到多高。pptxgenjs 寫進 XML 的列高只是估值，實際會更高——這是最容易出事的地方 |
| `pick.py` | 抽出單一頁做成單頁 pptx，用來逐頁目視（`python3 pick.py D.pptx p07.pptx 7` 再 `qlmanage -t`）。⚠️ QuickLook 的 Office 轉譯器不吃儲存格上下內距，表格會畫得比真實 PowerPoint 矮 |

有 LibreOffice 的環境可以整份轉圖逐頁看，比 QuickLook 準：

```bash
libreoffice --headless --convert-to pdf "docs/pitch/<檔名>.pptx" --outdir /tmp/render
pdftoppm -r 90 -png /tmp/render/<檔名>.pdf /tmp/render/p
```

## 16 頁的結構（改版時不要打散這個順序）

| 頁 | 幕 | 這頁在回答什麼 |
|---|---|---|
| 01 | — | 封面：一句話定位 ＋ 今天要講的四件事 |
| 02 | 壹 背景 | 為什麼是我：監造／機關／系統三欄 ＋ 工程榮譽 ＋ 學歷 |
| 03 | 壹 背景 | 一頁講完：契約 → AI 讀出要求 → 人核定 → 現場填一次 → 紀錄自動長出 |
| 04 | 貳 痛點 | 同一件事被記在四個地方（LINE／Excel／紙本／信箱） |
| 05 | 貳 痛點 | 真正的成本不在打字，在「說不清楚」——期限、退件、佐證、爭議 |
| 06 | 參 產品 | 六個工作面（左側放產品真實側欄） |
| 07–11 | 參 產品 | 五個亮點，每頁一張真畫面：今日待辦／義務時程／AI 草稿收件匣／品質查驗鏈／估驗金流 |
| 12 | 參 產品 | 三條紅線 ＋ 第四條（可單獨關掉的 AI 模組）＋ 資安 |
| 13 | 參 產品 | 現況數字 ＋ 誠實頁（短處自己先講） |
| 14 | 肆 合作 | 四階梯：先看／用真文件跑一次／單一功能／年度訂閱 |
| 15 | 肆 合作 | 甲乙丙三種形狀 ＋ 共同投標分工 ＋ 兩件先講清楚 |
| 16 | 肆 合作 | 價格（**全案唯一出現金額的一頁**）＋ 下一步的單一 ask |

P02「為什麼是我」是核心頁：三欄刻意對齊產品的三方模型（監造／機關／系統），因為創辦人的經歷剛好就是那三方。
⚠️ **年資只寫了公務員的 4 年**；台灣世曦監造 1 年、AI 新創產品經理半年寫職稱不寫年資——不是隱瞞，是不把最短的
兩個數字放在最顯眼處，當面被問一定照實答，所以那頁不得出現任何暗示更久的字眼。獎項寫「擔任主辦的工程獲…」，
因為這兩個獎頒給工程與團隊、不是頒給個人。

## 兩條講話紅線（改文案時不要破壞）

1. **標的名稱一律「雲端訂閱服務（SaaS）」。** 一旦文件裡出現「開發／客製／建置」，工程會一覽表的歸類會從
   「SaaS 套裝型」掉到「應用軟體或系統開發服務」，普級要求暴增（主機弱點掃描、網站弱點掃描、資安維運、
   教育訓練…），預算做不完。
2. **時程不寫死；價格只寫在 P16 那一頁。** 對象是民間事務所與顧問公司，談合作不報價談不下去，所以價格要講；
   但**時程仍然不寫死**（導入節奏要一起排，寫死等於承諾交期）。
   ⚠️ 金額只能存在於 P16，其他頁一律不得再出現數字，否則兩處遲早漂掉。

## 數字的出處（2026-08-21 重數）

| 數字 | 怎麼來的 |
|---|---|
| App 路由 36 | `src/App.jsx` 的 `appRoutes` |
| AI 模組 16 | `src/lib/aiFeatures.js`（其中 1 個已退場） |
| migration 39 | `supabase/migrations/*.sql` |
| pgTAP 25 檔 | `supabase/tests/*.sql` |
| 單元測試 500＋ 項／55 檔 | `src/**/*.test.js*` 的靜態計數（保守寫成 500＋；要寫精確數字請跑 `npx vitest run`） |
| Demo E2E 32 條／6 檔 | `e2e/*.spec.js` |
| 真後端 E2E 5 條 | `e2e-real/*.spec.js` |

**改版前先重數一次，不要沿用簡報上的數字。**

**P16 的價格**：平台費四個級距的金額由使用者指定，不是算出來的。AI 額度與超額單價則是從正式站
`ai_usage_events` 的實測單次成本回推——改版前重跑這段：

```sql
select feature_key, model, count(*) calls,
       round(avg(input_tokens)) in_avg, round(avg(output_tokens)) out_avg,
       round(avg(cache_read_tokens)) cr_avg, round(avg(cache_write_tokens)) cw_avg,
       round(avg(cost_usd)::numeric, 6) avg_cost,
       round(sum(cost_usd)::numeric, 4) sum_cost
from ai_usage_events where status = 'ok'
group by feature_key, model order by avg_cost desc;
```

2026-08 期間實測（41 次呼叫、匯率 NT$32／US$）：履約要求抽取 NT$15.1／份、契約整包解析 NT$10.6／份、
Agent 問答 NT$0.72／次、施工照片辨識 NT$0.17／張、白板辨識 NT$0.11／次、估驗說明草稿 NT$0.06／次、
天氣帶入 NT$0（不呼叫模型，不佔額度）。超額 NT$1／次是按「問答＋照片辨識為主」的混合比抓的；
**若實際用量高度集中在 Agent 問答，倍率會掉到 1.4，屆時要重訂。**

## 兩個已知的 demo 限制（改截圖清單前先知道）

- `/requirements`（契約重點）在 demo 模式是空的，會顯示「需真實專案」——**不要放進簡報**。
  契約 AI 那一頁改用 `/contract` 的「義務時程」（有出處條號、罰則與逾期天數，說服力更強），
  且要用 `scrollTo: '義務時程'` 捲過頂端的上傳框，否則會截到「Demo 模式不支援」的橘字。
- `/agent` 的對話區預設是空的。用 `ask` 先點一顆建議問題，截到「問了就有出處連結」的樣子；
  demo 沒有後端，答案走離線確定性引擎，畫面上會有「離線快答」小標——這是誠實的，不要修掉。
