# GovAgent／PMIS

GovAgent 的第一個垂直領域是公共工程專案管理：施工廠商、監造與主辦機關共用標單、文件、履約時程與 AI 草稿。React／Vite／Tailwind 前端，Supabase 後端。

- [現況](CURRENT.md) · [開發規則](DEVELOPMENT.md) · [已定案決策](docs/DECISIONS.md)
- [文件索引](docs/README.md) · [待辦](docs/ROADMAP.md) · [驗證基線](docs/BASELINE.md)
- [App 正式站](https://app.gov-agent.ai) · [行銷站](https://gov-agent.ai)

## 本機開發

需要 Node.js 22.13.0 以上。

```bash
npm install
cp .env.example .env
npm run dev
```

`.env` 設定 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_ANON_KEY`；未設定時使用內建 Demo。macOS 套件安裝地雷見 [開發規則](DEVELOPMENT.md)。

## 驗證

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

真後端測試：`npm run test:e2e:real`，依 [操作指南](docs/REAL_BACKEND_E2E.md) 準備一次性 staging；DB 測試依 [Supabase 設定](supabase/SETUP.md) 跑 pgTAP。測試結果只維護在 [BASELINE](docs/BASELINE.md)。

## 程式入口

| 範圍 | 入口 |
|---|---|
| 頁面／路由守衛 | `src/App.jsx`、`src/lib/navConfig.js` |
| 業務頁面／共用 UI | `src/pages/web/`、`src/components/` |
| 跨頁狀態／資料操作 | `src/store.jsx`、`src/store/slices/` |
| 計算／共用查詢 | `src/lib/` |
| Edge／AI | `supabase/functions/`、`supabase/functions/_shared/` |
| DB 唯一真相／測試 | `supabase/migrations/`、`supabase/tests/` |
| Demo／真後端流程測試 | `e2e/`、`e2e-real/` |

部署流程見 [部署指南](docs/operations/deploy.md)。push 到 `main` 會觸發 Cloudflare 部署；DB migration 與 Edge 另行處理。
