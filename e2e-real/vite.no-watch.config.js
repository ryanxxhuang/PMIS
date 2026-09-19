// 真後端 E2E 的 dev server 設定(playwright.real.config.js 的 webServer 用):與 vite.config.js 完全相同,只關掉檔案監看。
//
// 為什麼(T1,chain 6 假紅的根因):一般 dev server 監看整個 worktree,@tailwindcss/vite 又把它掃到的原始檔
// (未 gitignore 的文字檔,連 e2e／e2e-real 的 spec 都算)登記成 CSS 的相依檔——其中任何一支被改,連 touch 都算,
// Vite 就對開著的頁面送 full-reload。跑真後端 E2E 時若同一 worktree 有人改檔(P3b 當時邊背景跑 chain 5／6、
// 邊改 e2e/contractor.spec.js),頁面會整頁重載:開著的確認對話框消失,下一步點對話框就一直等到整條鏈逾時。
// E2E 驗的是啟動當下的程式碼,不需要 HMR;關掉監看後跑測期間改檔不會再動到頁面(改了程式碼要重跑才生效)。
//
// Vite 的 mergeConfig 會略過 null,所以這裡直接展開覆寫 server.watch(null＝不建 watcher,Vite 6 createServer)。
import baseConfig from '../vite.config.js'

export default {
  ...baseConfig,
  server: { ...baseConfig.server, watch: null },
}
