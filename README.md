# PMIS AI — Prototype

PRD.md 的點擊式 demo（假資料、無真實後端/AI）。聚焦 PRD section 21 的「混凝土澆置前自主檢查」完整情境。

## 啟動

```bash
npm install
npm run dev      # http://localhost:5173
```

> 註：此機器在外接磁碟上，npm 對 optional native 套件有 bug。若 build/dev 報 `Cannot find module '@rollup/...'` 或 `lightningcss`，執行：
> `npm install --no-save @rollup/rollup-darwin-arm64 lightningcss-darwin-arm64 @tailwindcss/oxide-darwin-arm64`

## Demo 流程（依畫面最上方的 11 步進度條由左到右）

1. 登入頁選任一角色 → 進入 Web 管理端
2. **契約上傳** → 載入範例契約 → 啟動 AI 解析（非同步，約 2 秒）
3. **AI 解析審核** → Approve「混凝土澆置前自主檢查」→ 建立表單
4. **AI 表單產生器** → 看欄位與手機預覽 → 發布表單
5. 左下「切換到手機端」→ **自主檢查** 填表（全合格 + 照片 + 簽名）→ 送出
6. **查驗申請** → 送出（自動帶入自主檢查表與照片）
7. **監造查驗** → 選「不合格」→ 送出 → 系統自動建立缺失
8. 缺失自動帶到 **缺失改善**（施工端）→ 填說明 + 改善照片 → 送複查
9. **監造查驗** → 複查合格結案
10. 回 Web → **缺失追蹤** 看完整時間軸 / **報表中心** 一鍵產出報表 / **Audit Trail** 看事件紀錄

## 重點對應 PRD

- **Contract First**：每個 AI 要求、表單、缺失都帶來源文件頁碼 / 章節
- **Human-reviewed AI**：AI 解析需人工 Approve / Edit / Reject 才進正式流程
- **Mobile First**：手機框、少打字、多選擇、合格/不合格、拍照、簽名
- **One Record, Many Outputs**：一次填寫 → 日誌 / 查驗紀錄 / 缺失表 / 照片表
- **Auditability**：所有送出動作記入 Audit Trail（使用者 / 角色 / 時間 / 裝置）

## 技術

React 18 + Vite + Tailwind v4 + React Router。狀態在 `src/store.jsx`，並以 **localStorage 持久化**
（key：`siteflow-demo-v1`）— 整頁重新整理不會丟進度。要從頭走一次，用左下角「**重置 demo**」按鈕清空。

## 結構

```
src/
  store.jsx          全域狀態 + 所有 action + localStorage 持久化 + resetDemo
  data/seed.js       種子資料（A 區新建工程、AI 解析結果、表單欄位）
  components/         ui.jsx（共用元件）、Layout.jsx（Web 側欄 + 手機框 + 進度條 + 重置鈕）
  pages/web/         Dashboard / ContractUpload / AIReview / FormBuilder / DailyLogs / Defects / Reports / Audit
  pages/mobile/      Home / DailyLog / SelfInspection / InspectionRequest / SupervisorInspection / DefectResponse / PhotoUpload
```

## 模組進度

對應 [SCOPE.md](SCOPE.md) 的施工廠商 ↔ 監造分階段規畫：

- **Phase 0（已建）**：契約上傳 · AI 解析審核 · AI 表單產生器 · 自主檢查 · 查驗申請 · 監造查驗 · 缺失追蹤 · 照片 · 報表 · Audit
- **Phase 1**：✅ **M1 施工日誌 / 監造日報**（手機填寫、自動帶入當日照片/查驗/缺失、AI 摘要、監造日報可引用施工廠商日誌）｜✅ **M2 檢驗停留點 ITP**（W/H/R 停留點，AI 從契約要求展開）
- **Phase 2**：✅ **M3 送審 Submittals**（Procore ball-in-court：球在誰手上、審查往返、版次管理）｜✅ **M4 RFI 工程疑義**（ball-in-court、工期/費用影響旗標）｜⬜ M5 試驗管理
- **Phase 3**：會議紀錄 · 分包商 · 進度 · 工安 …（詳見 SCOPE.md）
