# 已定案決策

> ACTIVE｜2026-09-11。保留決策編號與現行約束，實作歷程由 Git／PR 追溯；未完成事項見 [ROADMAP](ROADMAP.md)。D-019／D-020 優先於 D-012／D-017 的舊門檻，D-021 取代舊視覺方向。

## D-001｜產品名稱與範圍

狀態：ACCEPTED。最終產品是 GovAgent；PMIS 是公共工程垂直領域與 repo 名稱。現階段只做公共工程，不預建其他業務框架。

## D-002｜專案角色只有三方

狀態：ACCEPTED。業務角色只有 `contractor`／`supervisor`／`owner`。現場、品管、工安為廠商內部分工，不可成為 RLS、導覽、Agent 或功能開關角色。詳見 [三方模型](architecture/three-party-role-model.md)。

## D-003｜AI 只做草稿

狀態：ACCEPTED。AI 可查詢、彙整、擬稿，不可執行業務核定、判定、結案或驗收；數字由確定性引擎計算，正式狀態由人、RLS、RPC、Guard Trigger 保護。契約轉錄依 D-019 的明示例外。

## D-004｜簡單優先

狀態：ACCEPTED。第二個實際需求出現後才加抽象；一次處理一個清楚問題，不為形式搬動穩定功能。

## D-005｜文件先行

狀態：ACCEPTED。開發前寫清問題、目標、不做、影響與驗收。候選不等於授權，流程依 [DEVELOPMENT](../DEVELOPMENT.md)。

## D-006｜前端資料存取

狀態：ACCEPTED。跨頁共享資料進 Store；單頁有界資料可直接查 Supabase；同一查詢重複後才抽共用層，不新增形式上的 repository。

## D-007｜建案後第一站是專案文件

狀態：ACCEPTED。建案成功後導向專案文件；初始化走文件／標單上傳、三方成員與正式模式，不維護 BOQ-first 的第二條路。

## D-008｜主要 AI 入口是 /agent

狀態：ACCEPTED。`/agent` 是唯一完整 AI 入口；浮動 Copilot 是薄入口，`/assistant` 導向 `/agent`。`assistant.chat` 已停用，舊功能列、Edge 與歷史用量保留。

## D-009｜正式專案角色以邀請方確認為準

狀態：ACCEPTED。公開註冊自選 `org_type` 不作正式專案身分信任依據；邀請方指定三方身分，伺服器與帳戶身分比對，錯配拒絕。`project_members` 管授權，`project_memberships` 管身分快照。

## D-010｜AI 功能開關故障策略是 fail-closed

狀態：ACCEPTED。AI 功能閘門查詢失敗或 `allowed` 非 true 時拒絕服務；查詢不確定回 503，明確停用／禁止才回 403。用量記帳失敗不阻擋回應，但須記 log。

## D-011｜Requirement／obligation 先盤點再定向

狀態：ACCEPTED。已完成 Requirement／obligation 讀寫與正式資料盤點；採 D-012 的單向產生。原盤點由 Git 追溯，不能再把此項當待決。

## D-012｜Requirement 單向產生 obligation

狀態：ACCEPTED。`requirements` 是唯一契約要求權威；approved Requirement 單向產生／更新 obligation runtime，保留執行狀態、佐證、罰則與歷史，不反向改寫。取代已確認項時，只將仍待辦 runtime 標不適用。原「人工核定、僅 deadline」範圍已由 D-019／D-020 擴充。

## D-013｜前端路由預設拒絕

狀態：ACCEPTED。每個前端路由都登記在 `navConfig.js` 的 `routeRegistry`；未登記拒絕。公開、重新導向、列印與 404 須明確標註；列印仍受登入／專案守衛保護。

## D-014｜保留專案初始化設定精靈

狀態：ACCEPTED。保留專案初始化精靈；AI 整理步驟以有 completed run 為完成條件，不要求清空待確認建議，不阻擋合法開啟正式模式。原四步條文待修訂：PR #58 實作已增加「設定開工日」成五步。

## D-015｜W8 全產品 UI/UX 方向

狀態：ACCEPTED。保留階層導覽與全域 Agent 入口；桌面側欄可收合、子頁可展開／收合，手機同一階層，內容區不重複子頁導覽。原六工作面視覺與 Google／Material 方向由 D-021 取代；現行 hidden 集合依 navConfig，不因重構自行復出。

## D-016｜變更設計核定權責

狀態：ACCEPTED。變更設計核准／駁回與撤銷核准為機關專屬；監造受理（提出→審核中）／退回（審核中→提出）。核准必經審核中。`change_orders_guard` 強制，非正式模式 admin_override 例外維持。migration `20260819111252`、pgTAP `change_order_approval.sql`。

## D-017｜契約重點語意:確認轉錄而非核定生效+確定性分流

狀態：ACCEPTED。契約早已生效，人工確認對象是 AI 轉錄；介面使用「待確認／確認無誤／已確認／不採用」。原逐字與期限核對分流門檻已由 D-019 取代；核對引擎保留為透明度註記。

## D-018｜契約分級可見性補完

狀態：ACCEPTED。契約分級：機關全部、監造施工契約與自己的、廠商自己的；文件、來源鏈與 obligation SELECT／UPDATE 都受 RLS 保護。人工補登用 contract_package_id 歸包，guard 檢查同案與可見性；legacy null 維持全案可見。migration `20260824000900`。

## D-019｜AI 整理全自動確認(修訂 D-017 的分流門檻)

狀態：ACCEPTED。AI-origin 整理全部由伺服器自動確認歸檔；逐字／期限核對只是透明度註記，有疑慮仍物化且保存 triage_doubts。頁面與項目明示原文優先，actor=system 留痕。提醒／罰款試算會消費未逐字核對期限，此風險已由使用者接受。manual／migration 人工補登仍需監造／機關確認。migration `20260825000100`。

## D-020｜履約時程接入全部契約重點類型

狀態：ACCEPTED。所有已確認 Requirement 類型均冪等物化一列 obligation（`materialize_requirement_obligation`），不再僅限期限型。無時點者無到期日、不產生到期提醒；保留既有執行狀態與歷史。migration `20260901040000`，附 rollback／pgTAP。

## D-021｜全產品 UIUX 改採 Apple style（取代 W9 的 Google／Material 3 方向）

狀態：ACCEPTED。App 與行銷站依 [Apple 設計規範](UIUX-Apple-設計規範.md)：收件匣落地、來源→清單→詳情、契約原文與條文高亮方向。token／字級／材質集中 index.css，圖示 lucide-react。舊 Google handoff 退場。路由／三方角色／RLS 不變；圓角改 token 值須保留仍被 E2E 使用的 class 名。

落地：token、圖示、字級、球權側欄、收件匣與契約／工安共用清單詳情殼已實作並隨 PR #64 的前端部署上線；清單／詳情殼已於 2026-09-11 推廣到十四頁（見規範 §8），表格型頁（估驗／請款／成本／排程）與施工日誌依規範不套殼；行銷站整合仍待續接；登入頁（登入／註冊／忘記密碼／demo 入口）已於 2026-09-11 依規範 §2～§6 套用 Apple style，流程與 Supabase 呼叫不變。

## D-022｜專案授權只有 `project_members` 一個來源

狀態：ACCEPTED。`is_project_admin()` 只看 `project_members.role='admin'`；成員邀請／移除、members 管理 policy 與 projects 更新 policy 統一用該函式，非建立者 admin 也可管理成員。`created_by` 欄位、建案完整性約束、組織自己的 created_by policy 保留。

建立者依賴 `on_project_created`／create_project RPC 補 admin 列，沒有該列就沒有管理權。2026-09-11 正式庫唯讀盤點：13 案建立者均有 admin、無非建立者 admin，當時套用不改任何人的權限。migration `20260911110000_project_admin_single_source` 與 rollback、pgTAP 角色矩陣已提交；**尚未套用正式庫**。
