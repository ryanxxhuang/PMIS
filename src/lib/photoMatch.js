// 照片 AI 關鍵詞 → 標單工項的模糊比對:前端只 re-export,實作只有一份。
// P2b 起演算法住在 supabase/functions/_shared/photoMatch.ts(Edge 起稿也用同一支;
// Deno 部署只打包 functions 目錄,單一來源必須在那邊)。Vite 直接 import .ts,
// 與 sourceVerify.ts／documentTypes.ts 同一慣例。測試案例見 photoMatch.test.js。
export { matchLeaf } from '../../supabase/functions/_shared/photoMatch.ts'
