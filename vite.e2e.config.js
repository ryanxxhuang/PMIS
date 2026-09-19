// E2E 受測 dev server 的共用設定(Demo E2E 的 playwright.config.js 與真後端的 playwright.real.config.js 都用這支):
// 與 vite.config.js 完全相同,只改兩件事——關掉檔案監看、埠被佔用就直接失敗。
//
// 關掉監看(T1 找到 chain 6 假紅的根因,T2 擴及 Demo E2E):一般 dev server 監看整個 worktree,@tailwindcss/vite 又把它掃到的
// 原始檔(未 gitignore 的文字檔,連 e2e／e2e-real 的 spec 都算)登記成 CSS 的相依檔——其中任何一支被改,連 touch 都算,
// Vite 就對開著的頁面送 full-reload。跑 E2E 時若同一 worktree 有人改檔,頁面會整頁重載:開著的對話框消失、Demo 模式的
// 記憶體狀態被清空,下一步就等到逾時(P3b 當時邊背景跑 chain 5／6 邊改 e2e/contractor.spec.js;T2 實測 Demo E2E 全套
// 邊跑邊每秒 touch 一支 spec,76 項紅 20 項)。E2E 驗的是啟動當下的程式碼,不需要 HMR;關掉監看後跑測期間改檔不會再動到
// 頁面(改了程式碼要重跑才生效)。
//
// strictPort(T2):Vite 預設遇到埠被佔用會默默改用下一個埠,Playwright 卻仍去等設定的那個埠——那個埠上若是別的 worktree
// 的 server,就會測到別人的程式碼。兩套 config 都設 reuseExistingServer: false(Playwright 啟動前先確認埠是空的),
// 這裡再讓 Vite 在啟動瞬間被搶埠時直接失敗;兩道一起保證受測的一定是本 worktree 剛起的 server。
//
// Vite 的 mergeConfig 會略過 null,所以這裡直接展開覆寫 server.watch(null＝不建 watcher,Vite 6 createServer)。
import baseConfig from './vite.config.js'

export default {
  ...baseConfig,
  server: { ...baseConfig.server, watch: null, strictPort: true },
}
