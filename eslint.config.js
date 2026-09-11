// ESLint flat config。
//
// 為什麼只開這幾條規則:這個 repo 之前完全沒有 linter,卻已經散著 17 處
// `eslint-disable-next-line react-hooks/exhaustive-deps` —— 在沒有 linter 的
// repo 裡,那些抑制註解等於裝飾,而實際上其中真的藏著依賴錯誤(波次 4a 修掉
// 的 Requirements.jsx pool useMemo 就是一個:deps 寫 runsById,真正讀的是
// reqById/versionsById,靠 identity 恰好同步才沒壞)。
//
// 依 DEVELOPMENT.md §3「簡單化」:不引進整套風格規範(那會產生上千筆與正確性
// 無關的噪音,然後被整批 disable 掉,回到今天的狀態)。只開「會抓到真 bug」的
// 兩類:
//   1. react-hooks 的兩條核心規則——依賴漏列與 hook 呼叫順序
//   2. 未使用的 import/變數——搬移重構最容易留下的殘骸
// 格式化交給編輯器,不進 CI。

import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import react from 'eslint-plugin-react'
import globals from 'globals'

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**',
      // Deno edge functions:跑的是 Deno runtime(npm:/jsr: import、Deno 全域),
      // 用 Node 的 parser 掃只會得到滿屏假警報。它們該用 `deno check`(已列待辦)。
      'supabase/functions/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks, react },
    rules: {
      // 只借這一條:讓 no-unused-vars 認得「只在 JSX 裡出現」的元件,
      // 否則全站每個元件都會被誤報成未使用(實測 638 筆假警報)。
      // eslint-plugin-react 的其餘規則(propTypes、風格)一律不開。
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // 搬移重構留下的殘骸。args: 'none' —— 回呼常常收到用不到的參數,
      // 那不是債;真正會累積的是沒人用的 import 與區域變數。
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
      // js.configs.recommended 預設開著,但這個 repo 的 catch 常刻意吞掉
      // 錯誤再走既有的降級路徑,不是遺漏。
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 全形空白(U+3000)在繁中文案與註解裡是正當排版,只在程式碼本體才是問題。
      'no-irregular-whitespace': ['error', { skipStrings: true, skipComments: true, skipTemplates: true }],
    },
  },
  {
    files: ['**/*.test.{js,jsx}', 'src/testUtils/**', 'e2e/**', 'e2e-real/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // 簡報建置腳本:CommonJS + Node,不是前端模組。
    // 只套 .cjs:package.json 是 "type": "module",同目錄的 .js/.mjs(shots.js)本來就是 ESM,
    // 走上面的預設區塊;硬標 commonjs 會直接 parse error。
    files: ['docs/pitch/pptx/**/*.cjs', 'scripts/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // 首繪前的主題腳本:以 <script> 直接載入,不是 ES module。
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
]
