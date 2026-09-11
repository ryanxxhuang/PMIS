# GovAgent／PMIS 已定案決策

> 狀態：**ACTIVE**
> 最後更新：2026-09-11（D-021 UIUX Apple style 補登；D-020 於 2026-09-01 定案）
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

## D-013｜前端路由預設拒絕

- **狀態**：ACCEPTED（2026-08-13）
- **決策**：每條前端路由都必須登記在單一路由表；未登記的業務路由預設拒絕。公開頁、重新導向、列印頁與 404 必須明確標註，列印頁仍須通過共同登入與專案守衛。
- **結果**：W7 只收口前端路由治理，不改三方角色、既有頁面權限、RLS、導覽資訊架構或資料庫。

## D-014｜保留專案初始化設定精靈

- **狀態**：ACCEPTED（2026-08-13）
- **決策**：保留新專案在尚未開啟正式模式時顯示的四步初始化設定精靈：上傳專案文件與標單 → 確認三方成員 → AI 整理契約重點 → 開啟正式模式。第 3 步以 AI 整理完成為完成條件，不要求清空全部待審建議，也不阻擋合法開啟正式模式。
- **結果**：後續 W8-3A 只能在既有 Dashboard 清單與既有四個目的頁上改善步驟、責任方、完成條件、單一下一步與手機呈現；不得移除設定精靈，也不新增 onboarding／wizard framework、路由、資料表或新的狀態來源。

## D-015｜W8 全產品 UI/UX 方向

- **狀態**：ACCEPTED（2026-08-13）
- **決策**：公共工程主品牌採 `GovAgent｜公共工程`；導覽固定為「今日待辦、現場與品質、審查與協作、進度與金流、文件與結案、專案」六個工作面；`問 GovAgent` 是全域入口，不是第七個模組。桌面側欄預設常駐且可收合；工作面子頁選單預設收合，展開後直接列在所屬工作面下方，目前所在工作面也可再次收合；手機抽屜使用同一套階層。內容區不再重複桌面橫向子分頁或手機子頁下拉。廠商／監造預設進今日待辦，機關預設進跨案總覽。
- **結果**：W8-1 已由 PR #11 交付品牌、六面導覽資料、共同頁首、角色落地與手機抽屜基礎。2026-08-14 真案目視後，使用者修訂其導覽呈現為常駐階層側欄，並已核准 W8-0 第三版與 W8-1R 實作；W8-1R 已由 PR #14 交付並部署，視覺採中性圓角選取區塊、安靜縮排與清楚父子層級。W8-3B 已依原核准範圍恢復審查，不新增角色、路由、資料庫或虛假工作流。W8 仍以使用體驗為主，核心頁穩定後由 W8-5 做一次有界的全站視覺一致性收尾，不另造設計語言。36 條路由、原三角色權限、RLS 與資料庫均不變；不得把 UI 修正擴張成後端重寫。

## D-016｜變更設計核定權責

- **狀態**：ACCEPTED（2026-08-19）
- **決策**：變更設計的核准／駁回（含撤銷已核准）為機關專屬；監造負責受理審查（提出→審核中）與退回（審核中→提出）；核准前必須經過「審核中」，不可從提出直接跳核准。狀態集合不變（提出／審核中／核准／駁回），順序與角色由 `change_orders_guard` trigger 在伺服器端強制，非正式模式的專案管理者例外（admin_override）照舊。
- **結果**：背景是 W8-5 真人驗收 O-3／O-4／ISSUE-8：舊 guard 讓監造可一步核准、也可撤銷機關已核准的變更，與三方權責（機關核定）矛盾。migration `20260819111252` 收斂 guard 並補順序 gate，pgTAP `change_order_approval.sql` 釘住角色×轉移矩陣；前端 `can.ratify` 收斂為機關、新增 `can.review` 供監造受理／退回，變更設計頁改為角色動作鈕，廠商送出後就地顯示「已送出申請，待監造受理審查」。

## D-017｜契約重點語意:確認轉錄而非核定生效+確定性分流

- **狀態**：ACCEPTED（2026-08-24）
- **決策**：契約本身已是生效文件,系統不「核定」契約——人工動作的對象是「AI 轉錄是否與原文一致」。全站文案改版:待核定→待確認、核定生效→確認無誤、已生效→已確認、駁回→不採用。新增確定性轉錄分流(migration `20260824130000`):引文經 sourceVerify 逐字核對、且期限數字(天數/每月幾號/指定日期,含中文數字與民國年)與引文交叉比對一致的 AI 建議,由 DB 函式自動確認(`reviewed_by` null=系統,期限型照 D-012 物化義務);任一疑慮(來源未核對/數字對不上)標記 `triage_doubts` 進人工,由監造/機關對照原文確認。引擎看不懂的寫法一律進人工(保守偏誤)。
- **結果**:紅線一相容——狀態轉移由確定性 DB 引擎執行,AI 模型全程無決定權;提醒信/罰款試算仍只吃確認過的義務。抽取完成時 edge fn 呼叫 `apply_transcription_triage`,歷史待審已在 migration 一次性回填。人工確認負擔從「每條都要按」降為「只看引擎標出疑慮的」。pgTAP `transcription_triage.sql` 17 項釘住數字引擎誤配防護與分流矩陣。

## D-018｜契約分級可見性補完

- **狀態**：ACCEPTED（2026-08-24）
- **決策**:機關看全部、監造看施工契約+自己的、廠商只看自己的——此分級自 20260712000800 已涵蓋文件與 AI 出處鏈,migration `20260824000900` 補完最後兩個缺口:contract_obligations 依 requirement 可見範圍分級(SELECT+UPDATE 一起收,擋盲寫);手動補登以 `requirements.contract_package_id` 歸包(guard:同專案+不可歸入無權讀取的包),null 維持全案可見(legacy 相容)。
- **結果**:上傳不需額外限制使用者——上傳權本來就是「文件管理權+看得到該包」。pgTAP `contract_grading_completion.sql` 15 項釘住三方矩陣。

## D-019｜AI 整理全自動確認(修訂 D-017 的分流門檻)

- **狀態**：ACCEPTED(2026-08-25)
- **決策**:使用者拍板——AI 從已核定的契約整理出的內容**全部自動確認歸檔**,不留待確認佇列;頁面與抽取完成訊息明示「內容如有出入,以契約原文為準」。確定性核對(引文逐字+期限數字)從「確認門檻」改為**透明度註記**:核對全過顯示「系統核對無誤・自動確認」,有疑慮照樣確認但保留 `triage_doubts`,詳情標示「未逐字核對,以契約原文為準」,紀錄行改顯「AI 整理・自動確認」。人工補登(manual/migration)不在此列,仍由監造/機關確認。
- **結果**:紅線一在此流程放寬,依據=使用者風險決策+三重揭露(頁面聲明/逐條註記/稽核事件 actor=system);提醒信與罰款試算自此會消費未逐字核對的期限——風險已向使用者揭露並由其承擔。migration `20260825000100` 改寫 apply_transcription_triage 並回填;pgTAP 18 項改釘全自動語意。

## D-020｜履約時程接入全部契約重點類型

- **狀態**：ACCEPTED(2026-09-01)
- **決策**:D-012 轉接器只物化 `requirement_type='deadline'`,其餘八型(送審/檢驗/試驗/檢查表/佐證/照片/報告/其他)核定後卡在 requirements 表、永不出現在「契約重點 · 履約時程」——與頁首「把你要遵守的每一條排到時程上」不符(正式庫實測 91/106 條卡住)。改為**任何已核定 Requirement 都物化一列義務**:轉接器更名 `materialize_requirement_obligation`(映射逐欄不變,只放寬型別),`apply_transcription_triage` 與 `review_requirement` 的核定/取代不再分型別,既有卡住的核定項一次回填。
- **結果**:無時點的型別映出來是無到期日義務——前端語意「未觸發」,期程段照 `lifecycle_phase` 歸位;timeline 的類型標籤/篩選本已按 `requirement_type` 實作,前端零邏輯改動(只改文案)。今日待辦/提醒信只消費推得出到期日且七日內的項目,無時點義務不產生提醒;期限追蹤頁會多出「無期限」列(排序在後),是否過濾屬後續 UX 決定。migration `20260901040000` + rollback 檔;pgTAP 改釘全型別物化(one_way 34 項、triage 18 項)。

## D-021｜全產品 UIUX 改採 Apple style（取代 W9 的 Google／Material 3 方向）

- **狀態**：ACCEPTED（2026-09-11，使用者拍板）
- **決策**：PMIS 全產品——App 與行銷站——的 UI/UX 一律依 [`UIUX-Apple-設計規範.md`](UIUX-Apple-設計規範.md)，此後所有 UIUX 工作都 follow 這一份。D-015 與 W9 建立的 Google Workspace／Material 3 視覺方向退場；`UIUX/design_handoff_pmis_google_ui/` 與兩份契約重點 handoff 降為 `SUPERSEDED`（資訊架構部分仍可參考，視覺部分作廢）。資訊架構採**疊合版**：落地點是收件匣（開啟 App 直接落在「現在輪到我」，不做 dashboard 指標卡）、殼是「來源欄 → 清單欄 → 詳情欄」、履約事項的詳情呈現契約原文＋條文高亮。「工作面」從導覽單位降級為「來源」。
- **不變的邊界**：`navConfig.js` 的 `routeRegistry`、角色限制、RLS 與四條紅線不因改版鬆動；D-013 路由 fail-closed、D-002 三方角色、D-003 AI 只做草稿照舊。改版只動視覺、互動與導覽呈現，不動權限與資料。
- **落地狀況（2026-09-11，四個 commit，已提交於 `refactor/product-wide`，未合併 `main`、未部署）**：
  - `c848c59` 基礎層——`src/index.css` 色票換 Apple 系統色（亮暗雙軌、每個值實算對比度並寫回註解）、字級階梯進 `@theme`、毛玻璃只給 chrome（側欄／工具列／彈出層）內容卡一律實心、reduced-motion／reduced-transparency／contrast-more 三訊號分開處理；`ui.jsx` 按鈕去藥丸並改 Apple 焦點環，新增 `Segmented` 與 `Dot`，既有 26 個匯出的 API 形狀不變；新增常駐規範 `docs/UIUX-Apple-設計規範.md`，`CLAUDE.md` 指向它為 UIUX 單一真相。
  - `2d3068f` 落地點——側欄新增「球在誰手上」群組（現在輪到我／等待對方／今天已完成，走 `?ball=` query param 不新增路由），主畫面移除四張指標卡改收件匣式單桶聚焦；`navGroups`／`routeRegistry`／`routeAllowed`／`defaultLandingPath` 一行未動，未解封任何 `hidden` 工作面。
  - `7aa94e9` 字級——全站 13 種任意字級（含 11.5／12.5／10.5 半像素）收斂到七階；Tailwind 內建 `--text-xs/sm/base/lg` 對映同一份階梯（只改值不改名），另逐處改寫 35 檔 158 處任意值。`Contract.jsx`／`Requirements.jsx`／`RequirementsReview.jsx` 共 78 處刻意未處理，避免與契約抽取那條工作線混進同一個 commit。
  - `8b87c9e` 圖示——Material Symbols 自架 subset 字型退場，改 `lucide-react`（1.5px 描邊 `absoluteStrokeWidth`）；`MSym` 元件名與 props 不變，271 個呼叫點零改動，98 個對映逐一對照 lucide 1.44 實際匯出驗證；漏對映退路是中性圓圈＋dev console 警告，不畫成像真圖示的東西。bundle 924.51→980.88 kB（gzip 286.93→300.99）。
- **結果**：圓角 class 名一個都不能改——e2e 有 15 條選擇器綁死視覺 class 名，其中 10 條綁圓角；沿用 W9 的「`@theme` 只改值不改名」繞法。本決策是既成事實補登（四個 commit 早於本條寫入），不是新提案；補登原因是 DEVELOPMENT.md §2 要求改變產品邊界先進 DECISIONS，當時未辦。尚未做的部分（三欄殼實作、行銷站套用、登入頁依三欄殼重做、`Contract`／`Requirements`／`RequirementsReview` 字級收尾）仍在 ROADMAP，不得當成已完成。
