# GovAgent／PMIS 已定案決策

> 狀態：**ACTIVE**
> 最後更新：2026-08-13
> 這裡只記已確認的決策。想法、建議與待辦放在 [`ROADMAP.md`](ROADMAP.md)。

## D-001｜產品名稱與範圍

- **狀態**：ACCEPTED
- **決策**：最終產品是 GovAgent；PMIS 是目前公共工程垂直領域與 repo 名稱。
- **結果**：現階段只做公共工程，不為尚未開始的其他政府業務預建外掛架構。

## D-002｜專案角色只有三方

- **狀態**：ACCEPTED
- **決策**：業務角色只有廠商、監造、機關。
- **結果**：現場、品管、工安是廠商內部分工；不得成為 RLS、導覽、Agent persona 或功能開關的角色來源。
- **詳細規格**：[`architecture/three-party-role-model.md`](architecture/three-party-role-model.md)

## D-003｜AI 只做草稿

- **狀態**：ACCEPTED
- **決策**：AI 可查詢、彙整、擬稿，不可核定、判定、結案或驗收。
- **結果**：正式狀態轉移由人、RLS、RPC 與 Guard Trigger 保護；數字由確定性引擎計算。

## D-004｜簡單優先

- **狀態**：ACCEPTED
- **決策**：不把簡單事情複雜化。
- **結果**：沒有重複需求前不加抽象層；一次只處理一個清楚問題；不因架構形式漂亮而搬動已穩定功能。

## D-005｜文件先行

- **狀態**：ACCEPTED
- **決策**：先把現況、目標、非目標與驗收條件寫清楚，確認後才開發。
- **結果**：`PLANNED` 文件不代表已授權實作；後續開發遵守根目錄 [`DEVELOPMENT.md`](../DEVELOPMENT.md)。

## D-006｜前端資料存取

- **狀態**：ACCEPTED
- **決策**：跨頁共享資料進 Store；單頁專屬且有界的資料可由頁面直接查 Supabase；相同查詢真的重複後才抽共用層。
- **結果**：不為形式統一新增 repository 層。

## D-007｜建案後第一站是專案文件

- **狀態**：ACCEPTED（2026-08-12，使用者依產品全案評估報告 §10 定案）
- **決策**：建案成功後導向「專案文件」；初始化只有一條路：建案 → 上傳專案文件（含 PCCES）→ 確認三方成員 → 開啟正式模式。
- **結果**：不再維護 BOQ-first onboarding；所有空狀態指向同一下一步。

## D-008｜主要 AI 入口是 /agent

- **狀態**：ACCEPTED（2026-08-12）
- **決策**：`/agent` 是唯一完整 AI 產品；浮動按鈕只做同一 Agent 的薄快速入口；`/assistant` 確認無獨有能力後導向 `/agent`。
- **結果**：W3 已完成；`/assistant` 導向 `/agent`，浮動入口明示為同一 Agent 的新對話，前端不再呼叫 `assistant.chat`。舊功能列、Edge Function 與用量歷史保留，但功能開關已停用。

## D-009｜正式專案角色以邀請方確認為準

- **狀態**：ACCEPTED（2026-08-12）
- **決策**：公開註冊自選的 org_type 不作為正式專案身分信任依據；正式身分由邀請方／專案管理者在邀請時確認。
- **結果**：W4 已完成；邀請方必須指定三方身分，伺服器與受邀帳號的 `profiles.org_type` 比對，錯配即拒絕。未建立新角色或組織樹。W5-3 再把 `project_members`＝授權、`project_memberships`＝身分快照固定為唯一開發規則與 schema metadata，已由 PR #6 與 migration `20260812000600` 部署。

## D-010｜AI 功能開關故障策略是 fail-closed

- **狀態**：ACCEPTED（2026-08-12）
- **決策**：`ai_feature_allowed` 查詢失敗時拒絕服務（fail-closed），不得保守放行。
- **結果**：W3 已完成；kill switch 在 DB 故障時仍有效，前端會顯示清楚錯誤與重試。用量記錄失敗不阻擋 AI 回應，但會寫既有 log 告警；補記後台不在目前範圍。

## D-011｜Requirement／obligation 先盤點再定向

- **狀態**：ACCEPTED（2026-08-12）
- **決策**：先完成正式資料盤點（雙寫點、同步殘料、數量），再由使用者在「單向產生」與「完全解耦」之間定案。
- **結果**：W5-1 已完成唯讀盤點，見 [`W5-1-Requirement-Obligation-決策書.md`](W5-1-Requirement-Obligation-決策書.md)；使用者已於 D-012 選擇 A。

## D-012｜Requirement 單向產生 obligation

- **狀態**：ACCEPTED（2026-08-12）
- **決策**：`requirements` 是唯一契約要求權威；只有經人工核定且 `requirement_type = 'deadline'` 的 Requirement，才能單向產生／更新 `contract_obligations` 相容 runtime。obligation 的執行狀態與佐證不反向改寫 Requirement。
- **結果**：W5-2 已由 PR #6 與 migration `20260812000500` 部署：新文件只跑 `extract-requirements` 一次，舊 `parse-contract` Edge Function 檔案保留但沒有前端呼叫者；受控核准會冪等產生 deadline obligation，並保留既有 `status`、`evidence_submittal_id`、`penalty` 與歷史連結。已核准期限被人工取代時，只有仍待辦的相容提醒會改為「不適用」並退出現行清單，資料列、佐證與歷史不刪除。
