# GovAgent／PMIS 開發基準

> 狀態：**ACTIVE**
> 最後更新：2026-08-13
> 用途：後續任何人或 AI 開發前都必須遵守的最小規則。

## 1. 開發前先讀什麼

依序讀：

1. [`CURRENT.md`](CURRENT.md)：系統現在真的怎麼運作。
2. [`docs/DECISIONS.md`](docs/DECISIONS.md)：已定案且不得自行推翻的決策。
3. [`docs/ROADMAP.md`](docs/ROADMAP.md)：下一步候選與是否已獲准實作。
4. 與本次功能直接相關的 [`docs/architecture/`](docs/architecture/) 文件。

長期產品方向才查 [`docs/北極星-政府機關-Agent-平台.md`](docs/北極星-政府機關-Agent-平台.md)。日期式報告、舊 PRD 與舊驗收報告只供追溯，不是開發規格。

## 2. 文件先行

每個新功能或重構都先用下面五行說清楚：

```text
問題：現在真正痛在哪裡？
目標：完成後使用者能做到什麼？
不做：這次刻意不處理什麼？
影響：會動到哪些頁面、資料表或流程？
驗收：最多五個可直接判定通過／失敗的條件。
```

若會改變產品邊界、角色、資料責任或安全規則，先更新 `docs/DECISIONS.md` 或對應架構文件，取得使用者確認後才實作。`PLANNED`、`CANDIDATE`、報告中的「建議」都不等於開發授權。

## 3. 簡單化原則

1. 一個概念只指定一個主要資料來源。
2. 沒有第二個實際使用點前，不新增抽象層、repository、service、plugin 或 DSL。
3. 單頁專屬且有界的資料可由頁面直接查詢；跨頁共享資料才放 Store。
4. 不為未開始的政府業務預建框架；公共工程領域功能可以清楚寫死。
5. 修正既有流程時做最小改動，不順手重寫相鄰模組。
6. 相容層只能有明確用途；移除前先盤點資料、讀寫端與回復方式。

## 4. 不可跨越的產品邊界

- 專案業務角色只有 `contractor`、`supervisor`、`owner`。
- 現場、品管、工安是廠商內部分工，不是授權角色。
- AI 只能查詢、彙整與產生草稿；核定、判定、結案與驗收必須由人完成。
- 金額、期限與合格判定必須由確定性程式或資料庫規則計算。
- RLS、RPC、Guard Trigger 與 migration 是安全邊界；前端隱藏按鈕不是權限控制。
- 所有前端路由都必須登記在 `src/lib/navConfig.js` 的 `routeRegistry`；未登記預設拒絕，公開與列印路由必須明確標註。
- 只有 `approved` Requirement 是權威契約要求。
- 成員模型以 [`docs/architecture/three-party-role-model.md`](docs/architecture/three-party-role-model.md#成員模型的唯一判斷規則) 為唯一規則：`project_members` 管授權，`project_memberships` 管身分快照；不得從 `project_role` 或 party 類型推導業務權限。

## 5. 資料與 migration

- `supabase/migrations/` 是資料庫結構的唯一真相；`schema.sql` 只供歷史參考。
- 已套用的 migration 不回頭修改；變更一律新增 migration。
- 新 migration 可以安全地新增、修改或移除結構，但必須寫清資料保留、相容與回復考量。
- 權限或狀態轉移變更必須有 pgTAP；確定性計算必須有單元測試。
- 讀取可能超過 1,000 列時必須使用既有分頁工具，不能接受 PostgREST 靜默截斷。

## 6. 完成定義

一項工作只有同時符合下列條件才算完成：

1. 實作符合已核准文件，沒有自行擴大範圍。
2. 相關單元測試、建置、E2E／pgTAP 依改動範圍通過。
3. `CURRENT.md`、架構文件、設定指南與數字基線已同步。
4. 沒有把未完成能力寫成現況，也沒有把歷史報告當現行規格。
5. commit、push、部署與正式資料 migration 只在使用者明確要求後執行。

## 7. 文件衝突怎麼處理

遇到文件與程式不一致時：

- 「現在怎麼運作」以程式、migration 與實測結果為證據，立即修正 `CURRENT.md`。
- 「應該怎麼運作」以已接受的 Decision 為準；沒有 Decision 就先停在文件階段。
- 不偷偷讓程式追一份歷史文件，也不為了配合現況而竄改舊報告。
