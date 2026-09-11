# Repository instructions

> 狀態：**ACTIVE**
> 最後更新：2026-09-11
> 用途：AI 協作者的 repo 入口規則；細節以 `DEVELOPMENT.md` 為準。

後續 AI 協作者在修改本 repo 前必須：

1. 先讀 [`DEVELOPMENT.md`](DEVELOPMENT.md)、[`CURRENT.md`](CURRENT.md) 與 [`docs/DECISIONS.md`](docs/DECISIONS.md)。
2. 只實作使用者明確核准的項目；`PLANNED`、`CANDIDATE` 與歷史報告不是實作授權。
3. 專案角色只使用 `contractor`、`supervisor`、`owner`；現場／品管／工安不得成為新授權角色。
4. 採最小改動；沒有第二個實際使用點前不新增抽象層。
5. 已套用 migration 不回頭修改；資料庫變更新增 migration 並補對應 pgTAP。
6. 修改完成時同步現況與架構文件；不得把未完成能力寫成已實作。
7. commit、push、合併、部署與正式 migration 依 [D-023](docs/DECISIONS.md#d-023commitpush部署的常設授權) 常設授權：驗證通過即可執行，不逐次詢問；會產生新雲端費用、刪除正式資料或遠端資源的操作仍須先問。

其餘開發、測試、文件衝突與完成定義以 [`DEVELOPMENT.md`](DEVELOPMENT.md) 為準。
