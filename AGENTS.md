# Repository instructions

後續 AI 協作者在修改本 repo 前必須：

1. 先讀 [`DEVELOPMENT.md`](DEVELOPMENT.md)、[`CURRENT.md`](CURRENT.md) 與 [`docs/DECISIONS.md`](docs/DECISIONS.md)。
2. 只實作使用者明確核准的項目；`PLANNED`、`CANDIDATE` 與歷史報告不是實作授權。
3. 專案角色只使用 `contractor`、`supervisor`、`owner`；現場／品管／工安不得成為新授權角色。
4. 採最小改動；沒有第二個實際使用點前不新增抽象層。
5. 已套用 migration 不回頭修改；資料庫變更新增 migration 並補對應 pgTAP。
6. 修改完成時同步現況與架構文件；不得把未完成能力寫成已實作。
7. 未經使用者明確要求，不 commit、push、部署或套用正式環境 migration。

其餘開發、測試、文件衝突與完成定義以 [`DEVELOPMENT.md`](DEVELOPMENT.md) 為準。
