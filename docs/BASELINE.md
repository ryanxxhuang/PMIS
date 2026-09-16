# 驗證與規模基線

> ACTIVE｜2026-09-14｜三方 UIUX 操作流程；保留 2026-09-12 的既有後端與全案驗證快照。
> 手動實跑快照，不是 CI 自動產物。前一版驗證紀錄可從 Git 追溯；正式環境狀態只見 [CURRENT §6.3](../CURRENT.md#63-正式環境最後核對不是即時狀態)。

## 1. 本輪驗證

### 2026-09-16 小包 D：Codex §5 版面與操作感受（五項；本機 diff，未發布）

- `npm test`：119 檔、1,241 項通過；新增 `BOQ.search.test.jsx`（預設只展開第一層；名稱／項次關鍵字只列符合列與所屬各層、符合列 `aria-current`、`role="status"` 報件數；找不到明說；清除回原展開）；`Submittals.review.test.jsx` 改為 AI 助手預設收合、展開後才列能力與「未啟用」說明，收合時決定鈕照樣在。
- `npm run test:e2e` 送審／監造／機關／廠商／a11y／routes／workflow-ux 七檔：59 項通過。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440×900：機關開 CO-002，「核准」鈕頂端由 y=844 → 754，詳情不再重複列狀態／淨額／明細筆數；監造開 SUB-003，「受理審核」由 y=941（首屏外）→ 770（AI 助手收合）／888（展開），點「受理審核」對話框標題「受理審核：SUB-003」、按鈕「取消／受理審核」；標單頁搜「鋼筋」找到 14 項、列 29 列（含祖先章節）並標記符合列、URL `#/boq?q=鋼筋`，搜「窯燒磚」明說沒有符合，清除回 37 列；廠商日誌未存檔時照片區寫「先按下方「存檔」建立本日日誌，存檔後這裡會出現「上傳照片(不辨識)」」；工安頁與品質缺失頁底部不再出現「狀態機」。
- 未做：提早顯示「上傳照片(不辨識)」；手機章節摘要不套搜尋；真專案、真人驗收、手機／平板。

### 2026-09-16 補強包 C 第二批：進度口徑 D-024（C1–C4 實作；本機 diff，未發布）

- `npm test`：118 檔、1,239 項通過；`progressPlan.test.js` 依月底累計語意重寫（月初低於月底、月底等於該列、跨年閏日、單月計畫）；新增 `progressAsOf.test.js`（過去月份取月底、本月取今天、未來月份不落在未來；未來日期的估驗期不算、未填日期一律納入、狀態不論）、`Reports.caliber.test.jsx`（施工月報與監造報表同月份同一天同一期；本月截至今天、過去月份截至月底；收款／請款截至截止日；意見草稿寫明截至何日）。
- `npm run test:e2e` 監造／廠商／機關／a11y／routes／workflow-ux／reachability 七檔：60 項通過。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px（監造，2026-09-16）：施工月報 09 月＝監造報表 09 月＝進度頁＝首頁風險＝跨案本案：預定 22.6%／實際 13.0%／落後 9.6%，三頁都標「統計截止日 2026-09-16（本月尚未結束，以今天為準）」與「第 5 期（監造審核）」；08 月兩份報表同為預定 18.9%／實際 10.5%／落後 8.4%、截止日 2026-08-31、第 4 期（已核定）；月報收款與請款期數標「（截至 …）」。改前 09 月是月報 25.9%／落後 6.0% 對監造報表 29.8%／落後 9.8%。
- 未做：DB `portfolio_summary`（跨案其他案）仍取最新期；真專案、真人驗收、手機／平板。

### 2026-09-16 補強包 C：報表口徑與資訊層級（W07 對照／W09 更名；本機 diff，未發布）

- `npm test`：116 檔、1,228 項通過（純文案與文件，無新測試）。
- `npm run test:e2e` 監造／廠商／a11y／routes／reachability 五檔：45 項通過。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px（監造，2026-09-16）：W07 逐條核對——施工月報 09 月預定 25.9%／實際 19.9%／落後 6.0%，08 月 18.9%／16.0%／2.9%；監造報表 09 月與 08 月同為預定 29.8%／實際 19.9%／落後 9.8%；進度頁今日預定 29.8%；月報累計已收款兩個月都是 NT$ 82,963,685、已請款 4 期。W09 改後 `/progress` 卡片標題為「估驗完成率差距（依金額權重）」、說明句明寫不是工項排程落後判定，排行內容與順序不變（前三列仍為利潤／管理費、營業稅、保險費）。
- 未做：W07 標示文案與任何公式修正（待 `docs/reviews/2026-09-16-uiux-w07-progress-caliber.md` §5 決策）；真專案、真人驗收、手機／平板。

### 2026-09-16 補強包 B：工作交接與回找（W05／W06／W08／D01；本機 diff，未發布）

- `npm test`：116 檔、1,228 項通過；擴充 `useUrlFilters.test.jsx`（改寫篩選保住 `location.state`）、`Quality.journey.test.jsx`（從待辦進來切分段後 `taskReturn` 仍在）、`Dashboard.setup.test.jsx`（原項離開清單時不指向今天已完成、給「回到剛才處理的那一筆」連結）、`Submittals.create.test.jsx`（不再要求建立後註明附件說明；示範模式無上傳鈕）；`Submittals.correction.test.jsx` 的 store 標為真專案以保留上傳測試。
- `npm run test:e2e` 監造／廠商／送審／機關／workflow-ux／a11y 六檔：55 項通過。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：監造從首頁查驗待辦進 `/quality?inspection=INSP-DEMO-4`，切到「缺失」分段（URL `seg=defects`）後「返回今日待辦」仍在；機關核准 CO-002 後返回，首頁顯示「剛才處理的事項已不在「現在輪到我」」與「回到剛才處理的那一筆」（連到 `/change-orders?co=CO-DEMO-2`，點擊後詳情為已核准的 CO-002）；廠商在示範模式開送審詳情看到「示範模式不支援上傳文件本體」且無檔案輸入框，文件區提示改為「附件說明只在建立時填寫」。未測：真人驗收、正式上傳。

### 2026-09-16 補強包 A：輸入與資訊可信度（W01–W04；本機 diff，未發布）

- `npm test`：116 檔、1,226 項通過；新增 `unsavedEdits.guard.test.jsx`（無登記不攔、有登記換路徑先問且取消不放行、確認後清登記並重觸發同一連結、同路徑／外部連結／修飾鍵不攔）、`qc.coverage.test.js`（只填一項 1／15 與 14 項未檢、全填、含不合格、未填、範本已刪除）；擴充 `Submittals.review.test.jsx`（受理後標「最新審查意見」不再標「上次退回原因」）、`supervisorReport.test.js`（無「按日到場／已促請／尚符合契約／均符合設計圖說／督導情形良好／追蹤改善」，含「請補充」）、`ChecklistSection.unsaved.test.jsx` 與 `Quality.journey.test.jsx`（編輯判定旁、存檔訊息、紀錄列、檢附選項的覆蓋程度）。
- `npm run test:e2e` 監造／廠商／送審／a11y／workflow-ux／reachability 六檔：52 項通過。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：廠商在日誌填摘要後點側欄「品質查驗」出現「離開將遺失未存檔內容」確認框，取消留在原頁且摘要仍在，確認後到 `/quality`；檢查表只填一項時判定旁顯示「已檢 1／15，14 項未檢；判定僅依已檢項」，紀錄列亦標覆蓋程度（Demo 種子紀錄顯示「已檢 9／15，6 項未檢」）；監造受理 SUB-003 後摘要改標「最新審查意見」；監造報表意見不含「按日到場／已促請／尚符合契約」。未測：瀏覽器返回鍵、正式 Edge 生成的佐證包文案、真人驗收。

### 2026-09-15 UIUX 階段 6：跨角色旅程驗收與收尾（本機 diff，未發布）

- `npm test`：114 檔、1,218 項通過；新增 `useUrlFilters.test.jsx`（寫入／函式型更新／等於預設即刪／由 URL 回填）、`useListDetailPane.missing.test.jsx`（失效深連結回報並清參數、有效深連結不回報）；擴充 `SiteLog.dailyLog.test.jsx`（`?d=` 直達）、`Dashboard.setup.test.jsx`（返回但原項已離開清單的說明）、`todayTasks.test.js`（日誌待辦帶 `?d=`）。
- `npm run test:e2e` 全部 10 檔：70 項通過（三角色側欄可達、深連結、篩選返回、375／1024 無溢位皆不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。先前各階段整批偶發的 `Requirements.integrity.test.jsx` unhandled error（深連結 60 ms 捲動計時器呼叫 jsdom 沒有的 `scrollIntoView`）已在 `useListDetailPane.js` 以可選呼叫修正（PR #86），本機連跑兩次無 Errors。
- Demo 預覽 1440 px 三組旅程實測：機關 CO-002 待辦→詳情摘要→確認框→核准→返回今日待辦顯示原項已離開；機關初驗待辦→`?stage=initial` 當前列；`/submittals?submittal=NOPE` 顯示找不到並清參數；提醒中心 `?bucket=overdue` 前往處理再返回篩選保留；廠商日誌待辦→`/site-log?d=今天`；監造 SUB-003 待辦→待受理摘要→受理→返回今日待辦原項取得焦點。矩陣見 `docs/reviews/2026-09-15-uiux-stage6-acceptance.md`。**真人驗收未完成；正式後端未測。**

### 2026-09-15 UIUX 階段 5C：驗收當前階段與下一步（本機 diff，未發布）

- `npm test`：112 檔、1,212 項通過；新增 `Acceptance.stage.test.jsx`（目前階段卡的可登錄者／前置／下一步、`?stage=` 指到當前階段定位且未到階段無輸入框、深連結到已完成／未輪到／不存在階段只說明實際狀態、監造等待機關而廠商報竣可登錄、核對句與登錄成功後的下一階段、不合格展開缺失改善）；`todayTasks.test.js` 的驗收待辦連結改斷言帶 `?stage=`。整批仍偶發既有 `Requirements.integrity.test.jsx` 的 `scrollIntoView` 時序 unhandled error（未動）。
- `npm run test:e2e` a11y／機關／廠商／監造／workflow-ux 五檔：53 項通過（機關待辦可見驗收法定期限、驗收頁 375／1024 無溢位不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px（機關）：`/acceptance?stage=initial` 顯示「目前階段」卡與下一步，初驗列為當前列；`?stage=report` 顯示「已於 2026-08-18 登錄完成；目前階段是「初驗」」的說明且不開編輯。未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 5B：機關變更核定的資訊順序（本機 diff，未發布）

- `npm test`：111 檔、1,208 項通過；新增 `ChangeOrderDetail.decision.test.jsx`（機關待你核定摘要、事由理由、核准後契約金額、未登錄三行、核准／駁回確認框指向單據與金額且取消不寫入；監造只有受理／退回；廠商只有刪除；已核准顯示已計入）。整批仍偶發既有 `Requirements.integrity.test.jsx` 的 `scrollIntoView` 時序 unhandled error（未動）。
- `npm run test:e2e` 機關／a11y／監造／廠商／workflow-ux 五檔：53 項通過；`owner.spec.js` 核准流程改為先取消確認框（列狀態仍為審核中）再確認核准，變更後契約金額跨頁一致的斷言不變。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px（機關）：CO-002 詳情頂端「待你核定 · CO-002」、事由與理由、「核准後變更後契約金額將為 NT$ 724,388,067（+0.24%）」、本系統未登錄三行、核准／駁回鈕附「兩者都會再確認」；全案金額卡位於清單之後。未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 5A：請款收款逐欄保存回饋（本機 diff，未發布）

- `npm test`：110 檔、1,205 項通過；新增 `Payments.cells.test.jsx`（請款日成功「已儲存」、失敗留輸入值並標「未儲存＋正式值」且可還原、晚於今日不打 API、缺前置日期鎖定並就近提示、溢收取消拉回正式值並說已取消、指定期別只列該期且統計標全案累計與匯出標全案 n 期、不存在期別不列任何列）。
- `npm run test:e2e` workflow-ux／機關／a11y／監造／廠商五檔：53 項通過（指定付款期返回、不存在期別、監造進不了請款收款皆不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px（機關）：頁首明示不執行付款、表上方保存語意提示、匯出「全案 5 期」；把第 1 期請款日改成 2999-01-01 離開欄位後，欄位下方顯示「未儲存：請款日不可晚於今日…正式值仍是 2026-06-05」與「還原」。未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 4：監造送審審查順序（本機 diff，未發布）

- `npm test`：109 檔、1,200 項通過；新增 `Submittals.review.test.jsx`（補正再送件的待受理摘要與上次退回／本次補正對照、受理後才出現審定鈕、退回補正空白原因不寫入、取消不寫入、核准失敗狀態不變、核准後留結果與「下一件待審」由人點才換單、AI 開啟時兩項能力說明與未上傳文件本體讀不了）。整批仍偶發既有 `Requirements.integrity.test.jsx` 的 `scrollIntoView` 時序 unhandled error（未動）。
- `npm run test:e2e` 送審／監造／廠商／a11y 四檔：40 項通過（監造核准後 SUB-002 移入已完成、廠商無審定鈕皆不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：監造開 SUB-003 詳情，頂端摘要「待受理 · Rev.1 補正再送」與上次退回原因，文件區有 AI 助手說明，「審查意見與決定」只列受理段按鈕。未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 3C：廠商每日填報的資訊層級（本機 diff，未發布）

- `npm test`：108 檔、1,197 項通過；新增 `SiteLog.dailyLog.test.jsx`（保存狀態章四態與未存檔登記、存檔失敗留值／成功「已存檔 ✓」、切日期先確認且拒絕不換日、公定欄位預設收合與「填寫」展開、照片區併入本日日誌且訊息不混入存檔列）。整批仍偶發既有 `Requirements.integrity.test.jsx` 的 `scrollIntoView` 時序 unhandled error（未動）。
- `npm run test:e2e` a11y／監造／廠商／路由四檔：42 項通過（存檔鈕 ≥44px、375／744 貼底存檔列不被底欄遮蔽、監造日誌唯讀且無存檔鈕、列印頁標題皆不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：施工日誌卡頭顯示「本日尚無日誌」狀態章與帶入天氣／複製昨日；本日施作數量在照片與公定欄位之前；照片為本日日誌內一節；公定欄位收合並列出「尚未填：出工人數／機具使用／材料使用」；存檔列 `position: sticky`。存檔失敗與切日期確認以 jsdom 驗證；未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 3B：廠商品質流程與未存檔保護（本機 diff，未發布）

- `npm test`：107 檔、1,194 項通過；新增 `ChecklistSection.unsaved.test.jsx`（填值登記未存檔、取消先確認、存檔失敗留值／成功解除）、`Quality.journey.test.jsx`（填一半→切查驗（URL `?seg=`、chip 標未存檔）→切回值仍在→存檔→提出查驗申請預填現行版檢附→送出→已送出／已檢附／等待監造並選中新查驗；送出失敗表單與檢附留著；切換專案未存檔表單不沿用）。整批仍偶發既有 `Requirements.integrity.test.jsx` 的 `scrollIntoView` 時序 unhandled error（未動）。
- `npm run test:e2e` 廠商／監造／workflow-ux／a11y 四檔：47 項通過（缺失分段深連結、判定開缺失、分段 44px、直達試體分段皆不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：廠商在檢查表填實測值後切到查驗分段，chip 顯示「未存檔」、URL 帶 `seg=inspections`；切回檢查表輸入仍在。切換專案的確認框需多專案真後端，未在 Demo 重現；未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 3A：廠商提送、附件與補正（本機 diff，未發布）

- `npm test`：105 檔、1,189 項通過；新增 `Submittals.correction.test.jsx`（退回補正件先看退回原因／版次／附件、修正再送只出現一次；上傳失敗附件狀態不變且可重選、成功只講文件已更換仍需再送；再送成功顯示 Rev.1 與等待監造、補正紀錄分列且原附件說明不被覆蓋；取消不寫入、失敗可重試），`Submittals.create.test.jsx` 加「提送紀錄已建立」與附件狀態斷言。整批仍偶發既有 `Requirements.integrity.test.jsx` 的 `scrollIntoView` 時序 unhandled error（未動的檔案）；新測試已自行 stub。
- `npm run test:e2e` 送審／廠商／監造／a11y 四檔：40 項通過（監造與機關看同件的動作與資料不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：廠商提送「5F 模板施工計畫」後表單收起、詳情為 SUB-004 並顯示「提送紀錄已建立（SUB-004，Rev.0，狀態：已提送）。尚未上傳文件本體…」；「文件與提送方式」區含上傳鈕與外部提送說明。退回補正與上傳失敗情境 Demo 種子沒有，以 jsdom 驗證；未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 2a：入口方案 B（側欄自動展開、PageTabs 條件渲染；本機 diff，未發布）

- `npm test`：104 檔、1,185 項通過；新增 `PageTabs.sidebar.test.jsx`（側欄列出同組時不畫分頁列；null 或別組時照畫且同組子頁皆為連結、`aria-current` 正確）。同次執行偶發 1 筆 unhandled error 來自既有 `Requirements.integrity.test.jsx` 的 60 ms 捲動計時器在 jsdom 缺 `scrollIntoView`（未動的檔案，單獨連跑三次皆無此錯誤），屬既有時序 flake，未修。
- `npm run test:e2e` 全部 10 檔：70 項通過。`reachability.spec.js` 改為：點群組列進第一子頁後自動展開、內容區無同組分頁列、逐一點到每個子頁、手動收合後分頁列出現、鍵盤 Enter 再展開又收掉；`routes.spec.js` 深連結段改為自動展開、收合後分頁列 `aria-current` 落在目前頁、同組換頁保持展開。三角色可達路由數：廠商 23、監造 21、機關 22（自 navConfig 推導）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：進 `/submittals` 側欄自動列出送審文件／工程疑義／變更設計、內容區無分頁列；按「收合審查與協作子頁」後側欄子頁隱藏、分頁列回到頁首且目前頁高亮。未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 2（部分）：初始化與待辦並存、提醒篩選進 URL、AI 入口名稱（本機 diff，未發布）

- `npm test`：103 檔、1,182 項通過；新增 `Dashboard.setup.test.jsx`（無標單真專案首頁同時有初始化卡與可點待辦、非管理者說明、等待對方不帶初始化卡）、`Alerts.filters.test.jsx`（篩選寫進 `?q=`／`?bucket=`、清除一起刪、由 URL 回填）。
- `npm run test:e2e` 全部 10 檔：70 項通過（含三角色側欄可達性、1024／375 全路由無溢位、功能搜尋鍵盤焦點）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- 未動 `PageTabs`、側欄展開行為與路由授權；入口方案 A／B 待採用。未改 DB／Edge；U05 的真案（無標單、有送審）以 jsdom 模擬 store 驗證，未在正式後端重現；未真人驗收。

### 2026-09-15 UIUX 階段 1：操作可信度（本機 diff，未發布）

- `npm test`：101 檔、1,177 項通過；新增 `Acceptance.stageRow.test.jsx`（未選結果不寫入、明選不合格照送、失敗保留輸入）、`Submittals.create.test.jsx` 與 `RFI.create.test.jsx`（建立失敗保留表單與同一份輸入物件、連點只建一筆、非預期例外收尾 busy、重試成功選中新紀錄）。
- `npm run test:e2e` 相關六檔（submittals／rfi／owner／contractor／supervisor／workflow-ux）：40 項通過。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過；build 仍有既有 >500 kB chunk 警告。
- 未改 DB／Edge；未跑真後端、未真人驗收。失敗情境以 jsdom 模擬 store 回傳錯誤與例外重現，不代表正式環境已重現。

### 2026-09-14 三方 UIUX 操作流程

- `npm test`：98 檔、1,169 項通過；待辦深連結涵蓋查驗、觀察、試體、ITP、估驗與請款。
- `npm run test:e2e`：10 檔、70 項通過，包括新增 9 條三方旅程、375／1024px 全路由無溢位、手機第一筆待辦在 400px 之前、指定期別及不存在期別、判定後返回清單、搜尋角色隔離與鍵盤焦點。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs`（43 份 Markdown、217 個本機連結）通過。build 仍有既有 >500 kB chunk 警告。
- 已透過本機示範站檢查機關付款定位／返回、廠商手機首頁的實際畫面。此輪未改 DB／Edge，未執行正式資料寫入或真人手機驗收；不以 Demo 通過代表正式三方驗收。

### 2026-09-12 既有驗證快照

| 項目 | 結果 | 指令／範圍 |
|---|---|---|
| Vitest | 98 檔、1158 測試通過 | `npm test`；含機關責任期限進待辦、Portfolio error state、Requirement 表單可及名稱、兩步驟驗證閘門（`auth.mfa.test.js`）。worktree 內 node_modules 為 symlink 時需以 `server.fs.allow` 覆寫設定執行 |
| 預定進度時區回歸 | 同日第一輪：14 測試在 UTC 與 America/Los_Angeles 各通過；此輪未再改公式 | `TZ=UTC node node_modules/vitest/vitest.mjs run src/lib/progressPlan.test.js`，另改 TZ 重跑 |
| Demo E2E | 9 檔、56 測試通過（含 `reachability.spec.js` 三角色側欄可達性、三頁 375px a11y） | `npm run test:e2e`，本機 Vite／Chromium，未連真 DB。5188 被其他 checkout 的 dev server 佔用時 `reuseExistingServer` 會打到別人的程式碼，改用獨立埠設定跑 |
| GitHub 合併檢查 | PR #67、#69、#70、#76、#78（整合 #71–#75、#77）的 unit／e2e／pgtap 全過後合併；#79 見 PR | 正常 merge commit 合併，未 bypass；Cloudflare main 建置由 push 觸發，正式版本見 CURRENT §6.3 |
| ESLint | 0 error／0 warning | `npm run lint` |
| production build | 通過；仍有 >500 kB chunk 警告 | `npm run build` |
| 文件檢查 | 47 份 Markdown 的本機檔案／標題連結通過 | `npm run check:docs`；不連網驗外部網址 |
| pgTAP | 40 檔、1048 通過、0 失敗 | `npm run test:db`；既有本機 Supabase DB，未 reset、未改 migration。跑法見 [SETUP](../supabase/SETUP.md) |
| 真後端 E2E | 6 測試通過；本機真 DB／Auth／Storage，固定契約資料模式 | `ANTHROPIC_API_KEY= npm run test:e2e:real`；測試自行建立／清理登入帳號。未呼叫真模型，見 [指南](REAL_BACKEND_E2E.md) |
| Deno 型別檢查 | 17 支入口及其共用依賴通過 | Deno 2.9.6，`npm run check:edge`；依賴鎖定於 functions/deno.lock，已納 CI。未部署或驗證線上 Edge |
| 腳本／設定語法 | 8 份 Python、7 份 JSON 通過 | AST／JSON parse；不代表外部素材匯入或簡報渲染已實跑 |
| 依賴 audit | production 0、dev 2 moderate | `npm audit --json`；Vitest／@vitest/mocker 同一 advisory，修補需大版升級，列 ROADMAP 獨立處理 |

## 2. 檔案規模

| 項目 | 本輪核對 | 現查方式 |
|---|---|---|
| migrations／rollbacks | 60／10 | `rg --files supabase/migrations supabase/rollbacks` |
| 待套正式 migration | 0 支（2026-09-11 `migration list --linked` 60／60 對齊） | 部署前 `supabase migration list --linked` |
| pgTAP | 40 檔、plan 加總 1048 | `rg 'plan\(' supabase/tests`；加總不等同實跑 |
| Edge／shared 非測試模組 | 17／29 | `rg --files supabase/functions` |
| web 非測試頁面／Store slices | 34／9 | `rg --files src/pages/web src/store/slices` |
| 架構文件（含索引） | 15 | `rg --files docs/architecture -g '*.md'` |

路由數與 AI 功能數直接查 `src/lib/navConfig.js`、`src/lib/aiFeatures.js`；不另維護重複計數。

## 3. 覆蓋與文件精簡

盤點前端、Store、Edge 的 291 個 JS／JSX／TS 模組之匯入／匯出使用點；移除無生產使用端的舊 requirement wrapper、摘要 helper 與空 logger。測試工具及前後端註冊鏡像保留，不按「只有測試 import」機械刪除。DB 以 migrations／pgTAP 核對，既有 migration 不回改。

第一輪已刪 50 個過期文件／handoff 資產；本輪再刪 7 個重複掃描報告、過時簡報產生器與 v1 設計稿。相對本輪起點 `6987ef7`，全部版控 Markdown 字元量由約 38.2 萬降至約 20.5 萬，減少約 46%；必讀入口相對原始 37,066 字元減少約 70%。這是字元量，不是 tokenizer 實測。

15 份架構文件與操作指南已對齊現行程式；歷史資安／採購證據、驗收原句、仍有效設計／簡報來源及選用設計 skills 保留。過期檔可用 Git 追溯。未完成產品能力集中 ROADMAP，正式版本集中 CURRENT，不在各文件複製交付計數。

尚未驗證真模型語意準確率、真人手機／真案三角色、正式後端部署與備份還原。所有通過結果只支持上述測試範圍，不代表零缺陷或正式驗收完成。
