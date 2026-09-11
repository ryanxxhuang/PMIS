# 行銷站產品畫面(appshots)

> ACTIVE｜2026-09-11

這個目錄放的是**行銷站 Hero 用的產品畫面**:從 demo 建置的真實 App 自動截圖,不是手繪的複製品。

| 檔名 | 內容 | 尺寸 |
|---|---|---|
| `dashboard-desktop@2x.png` | 監造角色登入後的 `/dashboard`(今日待辦),桌機版 | 1440×900 邏輯像素,2x → 2880×1800 |
| `dashboard-phone@2x.png` | 同一頁,手機版(iPhone 邏輯解析度) | 390×844 邏輯像素,2x → 780×1688 |

畫面內容全部來自 `src/data/seed.js` 的 demo 種子(專案名、人名、公司名皆為既有 demo 資料),日期是截圖當天。

## 重新產生

```sh
npm run capture:appshots                                  # 寫到本目錄
npm run capture:appshots -- --out ../PMIS_site/public/appshots   # 直接寫進行銷站
```

腳本是 [`scripts/capture-appshots.mjs`](../../scripts/capture-appshots.mjs):跑 `npm run build:demo` → Node 靜態伺服 `dist/demo` → Playwright 用 e2e 同一支 `loginAs` 以「監造」登入 → 等 h1「今日待辦」與「現在輪到我」第一列都出現、字型載完 → 截圖。等待條件是畫面狀態,不是 sleep。需要本機已裝 Playwright 的 Chromium(與 `npm run test:e2e` 同一套)。

產出的 PNG 是可重建的產物,本 repo 不入版控(見 `.gitignore`);入版控的是行銷站那份。

## 跨 repo 邊界(要誠實面對的部分)

- **圖由本 repo 產、行銷站消費**:App 在這裡,只有這裡能產出「產品本人」的畫面。行銷站 repo(`PMIS_site`)的 `public/appshots/` 是消費端,`Hero.astro` 用 `<img>` 引用固定檔名。
- **沒有自動同步**。App 改版(主畫面版面、側欄、token、圖示)後要:重跑上面的指令 → 把兩張圖複製(或用 `--out` 直接寫)到行銷站 `public/appshots/` → 在行銷站 repo 另外 commit。忘了這一步,行銷站就又回到「賣舊畫面」。
- 檔名兩邊寫死;改名要兩邊一起改。
- 截圖尺寸、角色、等待條件改了,也要看行銷站 `Hero.astro` 的 `width`／`height` 與 `alt` 是否仍對得上。
