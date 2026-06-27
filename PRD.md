# Product Requirement Document — PMIS AI

## 1. Product Name

**PMIS AI**

中文名稱：**AI 工程現場管理平台**

---

## 2. Product Summary

PMIS AI 是一套針對台灣施工現場的 AI-native PMIS。

使用者只要匯入施工廠商或監造契約，系統就能自動解析契約、施工規範、三級品管表單與報表要求，並轉換成現場工程師可以執行的任務、表單、查驗流程、日誌、缺失追蹤與報表。

核心概念：

> 匯入契約，AI 自動建立工程現場任務；工程師用手機填寫一次，系統自動完成 PMIS 紀錄與正式報表。

---

## 2.1 Design Template — Procore

PMIS AI 的產品形態與資訊架構以 **Procore**（國際營建管理平台）為模板，但只取
「**施工廠商（GC）↔ 監造（CM）**」協作所需的模組，並對齊台灣三級品管與公共工程實務。
在 Procore 既有模組之上，加一層台灣特有的 **Contract-First × AI 解析**：契約 → AI 要求 → 表單 / 查驗 / 日誌 / 報表。

採用的 Procore 模組（對應台灣用語）：

| Procore 模組 | 台灣對應 | MVP |
|---|---|---|
| Inspections | 自主檢查 + 監造查驗 | ✅ 核心 |
| Punch List / Observations | 缺失追蹤 | ✅ 核心 |
| Daily Log | 施工日誌 / 監造日報 | ✅ 核心 |
| Photos | 照片紀錄 | ✅ |
| Reports | 報表中心 | ✅ |
| Submittals | 材料 / 施工送審 | 規畫中 |
| RFIs | 工程疑義 / 技術澄清 | 規畫中 |
| Inspections Template | 檢驗停留點 / ITP | 規畫中 |
| Meetings / Directory / Schedule | 會議紀錄 / 通訊錄 / 進度 | 後續 |

先不採用的 Procore 模組（超出 GC↔CM 協作範圍）：
Budget、Commitments、Change Orders、Invoicing、Bidding、Timesheets、發票付款、ERP 整合。

> 完整的模組範圍、權限矩陣、資料模型與分階段路線見 [SCOPE.md](SCOPE.md)。

---

## 3. Product Vision

台灣現有 PMIS 最大問題不是沒有功能，而是難用、分散、重複填寫，且無法把契約要求直接轉換成現場可執行流程。

PMIS AI 的目標是把契約、施工規範、三級品管表單，轉換成真正可執行的施工管理系統。

產品要幫現場工程師回答：

- 今天要做什麼？
- 這個工項要填哪張表？
- 要拍哪些照片？
- 要附哪些文件？
- 要不要送監造查驗？
- 查驗不合格後誰要改善？
- 哪些缺失逾期？
- 哪些報表可以自動產出？
- 這些要求是根據契約哪一頁、哪一條？

---

## 4. Target Users

## 4.1 施工廠商

主要使用者：

- 工地主任
- 現場工程師
- 品管工程師
- 安衛人員
- 分包商窗口

主要需求：

- 查看契約要求
- 填施工日誌
- 填自主檢查表
- 提出查驗申請
- 上傳施工照片
- 回覆監造缺失
- 產出施工日報、查驗紀錄、缺失改善表、照片紀錄表

---

## 4.2 監造單位

主要使用者：

- 監造主任
- 監造工程師
- 品管監造人員
- 顧問公司專案工程師

主要需求：

- 查看施工廠商提交資料
- 審查查驗申請
- 執行現場查驗
- 開立缺失
- 複查缺失改善
- 填監造日報
- 產出監造日報、查驗紀錄、缺失追蹤表、監造報表

---

## 5. Problem Statement

目前台灣工程現場常見問題：

1. 契約、施工規範、品質計畫書、三級品管表單散落在 PDF、Word、Excel 中。
2. 現場工程師不知道每個工項實際要完成哪些契約要求。
3. 自主檢查、監造查驗、缺失改善、照片紀錄、施工日誌彼此沒有連動。
4. 現場實際作業常依賴 Line、Excel、Word、PDF、紙本。
5. PMIS 表單難填，導致工程師事後補登資料。
6. 同一筆資料需要重複填在施工日誌、查驗紀錄、照片表、月報中。
7. 月報、週報、查驗紀錄、缺失追蹤表需要人工整理。
8. 監造與施工廠商資料不同步，容易產生版本與責任爭議。

---

## 6. Product Goal

PMIS AI 的產品目標：

1. 將契約與施工規範轉換成可執行任務。
2. 將三級品管表單轉換成手機可填寫表單。
3. 讓施工廠商與監造在同一平台完成查驗流程。
4. 讓照片、日誌、查驗、缺失與報表資料互相連動。
5. 讓現場工程師只填一次資料，即可自動產生多種正式工程紀錄。
6. 讓所有 AI 解析結果都能追溯到契約原文、頁碼與章節。

---

## 7. Core Value Proposition

PMIS AI 的核心價值：

> 契約不再只是 PDF，而是可以被 AI 轉換成任務、表單、查驗流程、日誌與報表的工程管理系統。

對施工廠商：

> 系統告訴你這個工項要做什麼、要填什麼、要拍什麼、要送誰查驗。

對監造：

> 系統幫你追蹤施工廠商是否完成自主檢查、查驗申請、缺失改善與契約要求。

對現場工程師：

> 手機填一次，日誌、查驗紀錄、缺失追蹤表、照片表自動產出。

---

## 8. MVP Scope

MVP 只聚焦：

- 施工廠商
- 監造單位
- 現場手機作業
- 契約解析
- 表單生成
- 查驗流程
- 日誌
- 缺失
- 照片
- 報表

---

## 9. In Scope

MVP 包含以下功能：

1. 專案建立
2. 使用者角色與權限
3. 契約 / 施工規範 / 表單上傳
4. AI 契約要求解析
5. AI 表單產生器
6. 契約要求待辦清單
7. 施工日誌
8. 監造日報
9. 自主檢查表
10. 查驗申請
11. 監造查驗
12. 缺失追蹤
13. 照片管理
14. 報表產出
15. 契約要求完成率 Dashboard
16. Audit Trail

---

## 10. Out of Scope

MVP 不包含：

1. 業主端完整功能
2. 預算估驗計價
3. 契約變更
4. BIM 模型協作
5. CAD 圖面修改
6. Primavera / MS Project 深度排程
7. 政府採購流程
8. 發票與付款
9. 完整電子簽章法律驗證
10. ERP 整合
11. 複雜跨專案 Portfolio 管理

---

## 11. Key Workflow

主要流程：

1. 使用者建立工程專案。
2. 使用者上傳契約、施工規範、品質計畫書、三級品管表單。
3. AI 解析契約要求。
4. AI 產生表單、任務、查驗流程與報表需求。
5. 使用者審核 AI 解析結果。
6. 審核通過後，系統建立正式專案任務。
7. 施工廠商用手機填自主檢查表。
8. 施工廠商提出查驗申請。
9. 監造用手機執行查驗。
10. 查驗合格則結案。
11. 查驗不合格則自動建立缺失。
12. 施工廠商改善並上傳照片。
13. 監造複查。
14. 系統自動產生日誌、查驗紀錄、缺失追蹤表、照片紀錄表與報表。

---

## 12. User Roles

## 12.1 Contractor Admin

可以：

- 建立施工廠商端人員
- 查看契約要求
- 建立施工日誌
- 建立自主檢查
- 提出查驗申請
- 回覆缺失
- 匯出施工報表

不可：

- 修改監造查驗結果
- 關閉監造開立的缺失
- 刪除監造紀錄

---

## 12.2 Contractor Field Engineer

可以：

- 查看今日待辦
- 填施工日誌
- 上傳施工照片
- 填自主檢查表
- 提出查驗申請
- 回覆缺失

不可：

- 修改專案設定
- 修改 AI 解析規則
- 修改監造查驗紀錄

---

## 12.3 Contractor QC Engineer

可以：

- 查看契約品質要求
- 填自主檢查表
- 上傳試驗報告
- 提出查驗申請
- 回覆缺失改善
- 匯出自主檢查紀錄

不可：

- 修改監造查驗結果
- 關閉缺失

---

## 12.4 Supervisor Admin

可以：

- 查看施工廠商提交資料
- 審查查驗申請
- 指派監造工程師
- 開立缺失
- 複查缺失
- 關閉缺失
- 匯出監造報表
- 審核 AI 解析出的監造表單

---

## 12.5 Supervisor Engineer

可以：

- 查看施工廠商日誌
- 查看自主檢查表
- 執行監造查驗
- 填監造日報
- 開立缺失
- 複查缺失
- 上傳監造照片

不可：

- 修改施工廠商原始填報內容
- 刪除施工廠商送出的資料

---

## 13. Core Modules

## 13.1 Project Setup

目的：

建立工程專案空間，讓施工廠商與監造在同一專案下協作。

功能：

- 建立專案
- 設定工程名稱
- 設定工程編號
- 設定業主名稱
- 設定施工廠商
- 設定監造單位
- 設定工程地點
- 設定工期
- 設定工區
- 設定工項
- 邀請使用者
- 指派角色

主要欄位：

- project_id
- project_name
- project_code
- owner_name
- contractor_name
- supervisor_name
- location
- start_date
- end_date
- project_status

Acceptance Criteria：

- 使用者可以建立專案。
- 使用者可以邀請施工廠商與監造人員。
- 使用者可以設定不同角色權限。
- 使用者可以建立工區與工項。
- 專案 Dashboard 可以顯示基本資訊。

---

## 13.2 Contract Upload

目的：

讓使用者**上傳一份「整本」工程契約**（通常厚達數百頁、包山包海，內含施工規範、品質計畫書、三級品管表單等），
作為 AI 解析來源。**使用者不需要拆檔、也不需要手動標註文件類型** — 由 AI 自動辨識。

設計原則（與 Procore 文件上傳一致、再加 AI 自動分類）：

> 上傳這一個檔，其他都交給 AI。

支援格式：

- PDF
- Word
- Excel

AI 自動辨識的內含文件 / 章節（為 AI **輸出**，非使用者輸入）：

- 契約書本文
- 施工規範
- 品質計畫書
- 施工計畫書
- 三級品管表單（自主檢查表 / 監造查驗表）
- 材料送審要求
- 試驗報告要求
- 其他

功能：

- 上傳整本契約（單一檔案，可上百頁；不必分檔、不必選類型）
- 預覽文件
- 啟動 AI 解析
- 查看 AI 解析狀態
- 顯示 AI 自動辨識出的內含文件 / 章節
- 儲存文件版本
- 查看 AI 解析結果（連回原始文件、頁碼與章節）

Acceptance Criteria：

- 使用者只上傳一個契約檔即可，不需手動選擇文件類型。
- 系統可以上傳 PDF / Word / Excel 並記錄文件版本。
- AI 自動辨識契約內含的文件類型 / 章節，並顯示給使用者確認。
- 使用者可以啟動 AI 解析。
- AI 解析結果必須連回原始文件、頁碼與章節。

---

## 13.3 AI Contract Requirement Extraction

目的：

AI 從契約與規範中解析出工程現場需要完成的要求。

AI 需要解析：

- 工項
- 表單
- 自主檢查要求
- 監造查驗要求
- 照片要求
- 文件附件要求
- 試驗報告要求
- 日誌要求
- 報表要求
- 缺失改善要求
- 查驗頻率
- 監造審查要求
- 契約依據
- 頁碼
- 章節

AI 解析結果欄位：

- requirement_id
- requirement_title
- requirement_type
- work_item
- required_role
- reviewer_role
- required_form
- required_photo
- required_attachment
- frequency
- source_document
- source_page
- source_section
- confidence_score
- status

Requirement Type 包含：

- Form
- Inspection
- Daily Log
- Report
- Photo
- Attachment
- Defect
- Test Report
- Approval

重要規則：

AI 解析結果不能直接變成正式任務，必須經人工審核。

每個 AI 解析結果都必須顯示：

- 解析內容
- 原始文件來源
- 頁碼
- 章節
- 信心分數
- Approve
- Edit
- Reject

Acceptance Criteria：

- AI 可以解析契約要求。
- AI 可以將要求分類。
- AI 可以提供來源頁碼與章節。
- 使用者可以審核、修改或拒絕 AI 結果。
- 審核通過後，要求才會進入正式 PMIS workflow。

---

## 13.4 AI Form Builder

目的：

將契約與三級品管表單轉換成手機可填寫的 digital form。

支援欄位：

- 文字
- 長文字
- 數字
- 日期
- 時間
- 下拉選單
- 單選
- 多選
- 合格 / 不合格
- 照片上傳
- 文件上傳
- 簽名
- 工區
- 工項
- 自動帶入欄位

自動帶入欄位：

- 專案名稱
- 工程編號
- 日期
- 天氣
- 填寫人
- 填寫單位
- 工區
- 工項
- 表單版本
- 表單編號

功能：

- 從 AI 解析結果建立表單
- 手動建立表單
- 編輯表單欄位
- 預覽手機表單
- 發布表單
- 停用表單
- 表單版本控管
- 將表單綁定工項
- 將表單綁定契約要求

Acceptance Criteria：

- 使用者可以從 AI 解析結果建立表單。
- 使用者可以手動修改 AI 建立的表單。
- 使用者可以預覽手機表單。
- 發布後，現場工程師可以在手機上填寫。
- 表單修改後必須建立新版本，不能覆蓋舊紀錄。

---

## 13.5 Contract Compliance Dashboard

目的：

讓施工廠商與監造可以追蹤契約要求完成狀態。

Dashboard 顯示：

- 契約要求總數
- 已完成要求
- 未完成要求
- 逾期要求
- 待施工廠商處理事項
- 待監造處理事項
- 各工項完成率
- 各角色待辦數量

功能：

- 查看所有契約要求
- 依工項篩選
- 依角色篩選
- 依狀態篩選
- 依期限篩選
- 開啟來源文件
- 開啟相關表單
- 開啟相關查驗
- 匯出契約完成率報表

狀態：

- Not Started
- In Progress
- Submitted
- Under Review
- Approved
- Rejected
- Overdue
- Closed

Acceptance Criteria：

- 使用者可以看到所有已核准的契約要求。
- 使用者可以查看每項要求完成狀態。
- 系統可以顯示逾期項目。
- 使用者可以從要求點進相關表單、查驗或報表。
- Dashboard 會根據日誌、查驗、缺失、報表完成狀態自動更新。

---

## 13.6 Contractor Daily Log

目的：

讓施工廠商用手機快速填施工日誌，並自動產出施工日報。

欄位：

- 日期
- 天氣
- 工區
- 今日施工項目
- 工班人數
- 機具數量
- 材料進場
- 今日施工照片
- 今日查驗事項
- 今日缺失事項
- 安衛事項
- 異常事件
- 監造指示
- 明日預定施工項目
- 備註
- 填寫人
- 送出時間

自動帶入資料：

- 天氣
- 今日照片
- 今日查驗
- 今日缺失
- 今日工項
- 使用者資料
- 專案資料

流程：

1. 施工工程師開啟今日施工日誌。
2. 系統自動帶入天氣、照片、查驗、缺失。
3. 工程師補充人員、機具、材料、施工摘要。
4. AI 產生日誌摘要。
5. 使用者確認與編輯。
6. 送出日誌。
7. 系統產出施工日報。

Acceptance Criteria：

- 使用者可以用手機建立施工日誌。
- 系統可以自動帶入今日照片、查驗、缺失。
- AI 可以產生日誌摘要。
- 使用者可以編輯 AI 產生的摘要。
- 日誌送出後不可直接覆蓋，只能建立修正版。
- 日誌可以匯出 PDF / Word。

---

## 13.7 Supervisor Daily Log

目的：

讓監造工程師快速建立監造日報，並與施工廠商資料連動。

欄位：

- 日期
- 天氣
- 監造人員
- 施工廠商今日施工摘要
- 監造查驗事項
- 抽查事項
- 缺失開立
- 缺失複查
- 施工廠商人力機具概況
- 進度概況
- 重要指示
- 異常事件
- 安衛事項
- 監造意見
- 照片
- 簽名

自動帶入資料：

- 施工廠商日誌摘要
- 今日查驗紀錄
- 今日缺失
- 今日照片
- 今日工項

流程：

1. 監造工程師開啟監造日報。
2. 系統顯示施工廠商今日資料。
3. 監造選擇是否引用施工廠商資料。
4. 監造補充查驗、抽查、意見。
5. AI 產生監造日報摘要。
6. 監造確認並送出。
7. 系統產出監造日報。

Acceptance Criteria：

- 監造可以查看施工廠商日誌摘要。
- 監造可以選擇引用或不引用施工廠商資料。
- 監造可以補充獨立意見。
- AI 可以產生監造日報摘要。
- 監造日報可以匯出 PDF / Word。
- 所有修改必須保留版本紀錄。

---

## 13.8 Self-inspection Form

目的：

讓施工廠商依照契約與施工規範完成自主檢查。

使用者：

- 施工廠商品管工程師
- 現場工程師

功能：

- 選擇工項
- 選擇工區
- 開啟系統推薦的自主檢查表
- 填寫檢查項目
- 上傳照片
- 上傳文件
- 上傳試驗報告
- 填寫備註
- 簽名
- 送出自主檢查表

AI 輔助：

系統根據契約提醒：

- 此工項要填哪些表
- 此工項要拍哪些照片
- 此工項要附哪些文件
- 是否需要試驗報告
- 是否需要送監造查驗
- 是否屬於停留點或限制點
- 依據哪一頁契約或規範

Acceptance Criteria：

- 施工廠商可以用手機填自主檢查表。
- 必填欄位未完成時不能送出。
- 使用者可以上傳照片與附件。
- 表單送出後會連結到契約要求。
- 表單可以用於後續查驗申請。

---

## 13.9 Inspection Request

目的：

讓施工廠商完成自主檢查後，向監造提出查驗申請。

欄位：

- 查驗名稱
- 工項
- 工區
- 預定查驗時間
- 對應自主檢查表
- 對應照片
- 對應文件
- 備註
- 聯絡人

狀態：

- Draft
- Submitted
- Need More Info
- Scheduled
- Inspected
- Approved
- Rejected
- Closed

流程：

1. 施工廠商完成自主檢查。
2. 施工廠商建立查驗申請。
3. 系統自動帶入相關自主檢查表、照片與文件。
4. 施工廠商送出查驗申請。
5. 監造收到通知。
6. 監造接受、排程、退回補件或查驗。

Acceptance Criteria：

- 施工廠商可以建立查驗申請。
- 查驗申請必須綁定至少一份自主檢查表。
- 查驗申請可以附照片與文件。
- 監造可以要求補件。
- 雙方都可以查看查驗狀態。
- 所有狀態變更都必須留下紀錄。

---

## 13.10 Supervisor Inspection

目的：

讓監造工程師在現場用手機完成查驗，並產出正式查驗紀錄。

功能：

- 查看施工廠商查驗申請
- 查看自主檢查表
- 查看相關照片與文件
- 開啟監造查驗表
- 填寫查驗結果
- 勾選合格 / 不合格
- 上傳監造照片
- 填寫備註
- 簽名
- 不合格時建立缺失
- 匯出查驗紀錄

查驗結果：

- Approved
- Rejected
- Partially Approved
- Need More Information
- Need Re-inspection

流程：

1. 監造開啟查驗申請。
2. 監造查看施工廠商自主檢查資料。
3. 監造在現場填查驗表。
4. 監造上傳查驗照片。
5. 若合格，查驗結案。
6. 若不合格，系統自動建立缺失。

Acceptance Criteria：

- 監造可以用手機完成查驗。
- 監造可以查看施工廠商提交資料。
- 查驗不合格時可以自動建立缺失。
- 查驗紀錄可以匯出 PDF。
- 查驗紀錄必須連結契約要求與來源表單。

---

## 13.11 Defect Tracking

目的：

讓缺失從開立、改善、複查到結案有完整紀錄。

欄位：

- defect_id
- 缺失名稱
- 缺失類型
- 工項
- 工區
- 缺失描述
- 規範依據
- 開立人
- 開立日期
- 責任單位
- 改善期限
- 缺失照片
- 改善說明
- 改善照片
- 複查結果
- 結案日期

狀態：

- Open
- Assigned
- In Progress
- Submitted for Review
- Rejected
- Closed
- Overdue

流程：

1. 監造開立缺失。
2. 系統通知施工廠商。
3. 施工廠商改善。
4. 施工廠商上傳改善照片與說明。
5. 監造複查。
6. 複查通過則結案。
7. 複查不通過則退回改善。

AI 輔助：

- 建議缺失分類
- 建議規範依據
- 建議改善期限
- 產生缺失摘要
- 產生改善追蹤表文字

Acceptance Criteria：

- 監造可以從查驗結果建立缺失。
- 施工廠商可以回覆改善。
- 施工廠商可以上傳改善照片。
- 監造可以複查並結案。
- 逾期缺失會被標示。
- 缺失歷程不可刪除。
- 缺失追蹤表可以匯出。

---

## 13.12 Photo Management

目的：

讓照片不再散落於 Line，而是可以被結構化用於日誌、查驗、缺失與報表。

功能：

- 手機拍照
- 上傳照片
- 自動記錄時間
- 自動記錄上傳者
- 選擇工區
- 選擇工項
- 選擇照片類型
- 綁定表單
- 綁定日誌
- 綁定查驗
- 綁定缺失
- AI 產生照片說明
- 匯出照片紀錄表

照片類型：

- 施工進度
- 自主檢查
- 監造查驗
- 缺失
- 改善完成
- 材料進場
- 試驗
- 安衛
- 其他

Acceptance Criteria：

- 使用者可以用手機拍照上傳。
- 使用者可以選擇工項與工區。
- 照片可以綁定查驗、缺失、日誌或表單。
- 照片可以自動出現在報表中。
- 系統可以產出照片紀錄表。

---

## 13.13 Report Generation

目的：

讓系統從現場資料自動產出正式工程報表。

MVP 報表：

- 施工日報
- 監造日報
- 自主檢查紀錄
- 監造查驗紀錄
- 缺失改善追蹤表
- 照片紀錄表
- 查驗申請紀錄
- 週報摘要
- 契約要求完成率報表

支援格式：

- PDF
- Word
- Excel

報表篩選條件：

- 專案
- 日期區間
- 工區
- 工項
- 表單類型
- 查驗狀態
- 缺失狀態
- 施工廠商 / 監造

報表內容：

- 專案基本資料
- 日期區間
- 施工摘要
- 查驗紀錄
- 缺失紀錄
- 照片
- 簽名
- 附件清單
- 產出時間
- 產出者

AI 報表摘要：

AI 可以根據日誌、查驗、缺失、照片自動產生摘要。

所有 AI 產生內容都必須允許使用者編輯後再匯出。

Acceptance Criteria：

- 使用者可以選擇報表類型。
- 使用者可以設定日期區間。
- 系統可以自動帶入相關資料。
- 系統可以產生報表預覽。
- 使用者可以匯出 PDF / Word / Excel。
- AI 文字可以編輯。

---

## 13.14 Notification & Task Center

目的：

讓施工廠商與監造清楚知道目前待辦事項。

任務類型：

- 契約要求尚未完成
- 自主檢查表尚未填寫
- 查驗申請已送出
- 查驗申請需要補件
- 監造查驗待執行
- 缺失已指派
- 缺失逾期
- 改善已送複查
- 日誌尚未填寫
- 報表已產生

功能：

- 查看今日待辦
- 依角色查看待辦
- 依工項查看待辦
- 依逾期狀態查看待辦
- 點擊任務進入相關紀錄
- In-app 通知
- Email 通知

Acceptance Criteria：

- 使用者可以看到自己的待辦事項。
- 逾期任務會被標示。
- 點擊任務可進入對應表單、查驗、缺失或報表。
- 任務狀態會隨 workflow 自動更新。

---

## 13.15 Audit Trail

目的：

所有工程紀錄必須可追溯，避免爭議。

需要記錄的事件：

- 文件上傳
- AI 解析結果產生
- AI 解析結果核准
- 表單建立
- 表單送出
- 查驗申請送出
- 查驗結果更新
- 缺失建立
- 缺失改善回覆
- 缺失結案
- 日誌送出
- 報表產出
- 紀錄修正

Audit Trail 欄位：

- event_id
- user
- role
- action
- timestamp
- related_record
- previous_value
- new_value
- device_type

Acceptance Criteria：

- 所有送出紀錄都有 audit trail。
- 使用者不能直接覆蓋已送出紀錄。
- 修正紀錄必須建立新版本。
- Admin 可以查看歷史紀錄。
- 匯出報表包含產出時間與產出者。

---

## 14. Main Pages for Prototype

## 14.1 Web App Pages

需要做以下頁面：

1. Login Page
2. Project Dashboard
3. Contract Upload Page
4. AI Extraction Review Page
5. AI Form Builder Page
6. Contract Compliance Dashboard
7. Inspection Management Page
8. Defect Management Page
9. Report Center

---

## 14.2 Mobile App Pages

需要做以下頁面：

1. Mobile Home
2. Daily Log
3. Self-inspection Form
4. Inspection Request
5. Supervisor Inspection
6. Defect Response
7. Photo Upload

---

## 15. Prototype Screen Requirements

## 15.1 Project Dashboard

顯示：

- 專案名稱
- 契約要求完成率
- 今日待辦
- 待查驗項目
- 未完成日誌
- 逾期缺失
- 最近照片
- 本週報表產出狀態

---

## 15.2 Contract Upload Page

顯示：

- 文件上傳區
- 文件類型選擇
- 已上傳文件清單
- AI 解析按鈕
- AI 解析進度
- 文件狀態

---

## 15.3 AI Extraction Review Page

顯示 AI 解析出的要求：

| Requirement | Type | Work Item | Role | Source | Status |
|---|---|---|---|---|---|
| 混凝土澆置前自主檢查 | Inspection | 混凝土工程 | 施工廠商 | p.42 | Review |
| 施工日誌每日填寫 | Report | 全工項 | 施工廠商 | p.12 | Approved |
| 鋼筋綁紮監造查驗 | Inspection | 鋼筋工程 | 監造 | p.55 | Review |

操作：

- Approve
- Edit
- Reject
- Create Form
- Create Task

---

## 15.4 AI Form Builder Page

顯示：

- 表單名稱
- 表單類型
- 工項
- 來源頁碼
- 欄位清單
- 手機預覽
- 發布按鈕

---

## 15.5 Mobile Contractor Home

顯示：

- 今日施工日誌
- 今日自主檢查
- 待送查驗
- 待改善缺失
- 快速拍照
- 今日契約要求待辦

---

## 15.6 Mobile Self-inspection Form

顯示：

- 工項
- 工區
- 檢查項目
- 合格 / 不合格
- 照片上傳
- 文件上傳
- 備註
- 簽名
- 送出

---

## 15.7 Mobile Supervisor Inspection

顯示：

- 查驗申請
- 施工廠商自主檢查資料
- 相關照片
- 監造查驗表
- 合格 / 不合格
- 開立缺失
- 送出查驗結果

---

## 15.8 Defect Tracking Page

顯示：

- 缺失名稱
- 工項
- 工區
- 規範依據
- 缺失照片
- 改善期限
- 改善回覆
- 改善照片
- 狀態
- 複查 / 結案按鈕

---

## 15.9 Report Center

顯示：

- 報表類型
- 日期區間
- 工項篩選
- 產生報表
- 報表預覽
- 匯出 PDF
- 匯出 Word
- 匯出 Excel

---

## 16. Data Objects

## 16.1 Project

欄位：

- project_id
- project_name
- project_code
- owner_name
- contractor_name
- supervisor_name
- location
- start_date
- end_date
- status

---

## 16.2 User

欄位：

- user_id
- name
- email
- phone
- company
- role
- project_id
- status

---

## 16.3 Document

欄位：

- document_id
- project_id
- document_name
- document_type
- file_url
- version
- uploaded_by
- uploaded_at
- ai_processed
- status

---

## 16.4 Requirement

欄位：

- requirement_id
- project_id
- requirement_type
- title
- description
- work_item
- work_area
- required_role
- reviewer_role
- required_form_id
- required_photos
- required_attachments
- frequency
- due_rule
- source_document_id
- source_page
- source_section
- confidence_score
- status

---

## 16.5 Form Template

欄位：

- form_template_id
- project_id
- form_name
- form_type
- version
- source_document_id
- applicable_work_item
- created_by_ai
- reviewed_by_user
- status

---

## 16.6 Form Submission

欄位：

- submission_id
- form_template_id
- project_id
- submitted_by
- submitted_at
- status
- related_work_item
- related_location
- related_inspection_id
- version
- data

---

## 16.7 Inspection Request

欄位：

- inspection_id
- project_id
- requested_by
- work_item
- location
- requested_time
- status
- self_check_submission_id
- supervisor_result
- created_at

---

## 16.8 Defect

欄位：

- defect_id
- project_id
- inspection_id
- title
- description
- work_item
- location
- severity
- assigned_to
- due_date
- status
- created_by
- created_at
- closed_at

---

## 16.9 Daily Log

欄位：

- daily_log_id
- project_id
- log_date
- log_type
- weather
- work_summary
- manpower
- equipment
- materials
- inspections
- defects
- photos
- status
- submitted_by
- submitted_at

---

## 16.10 Photo

欄位：

- photo_id
- project_id
- file_url
- taken_by
- taken_at
- location
- work_item
- photo_type
- related_form_id
- related_inspection_id
- related_defect_id
- caption

---

## 16.11 Report

欄位：

- report_id
- project_id
- report_type
- date_range
- generated_by
- generated_at
- file_url
- status

---

## 17. AI Requirements

## 17.1 AI Contract Parser

Input：

- 契約 PDF
- 施工規範 PDF
- 品質計畫書
- 施工計畫書
- 自主檢查表
- 監造查驗表
- Excel 表單

Output：

- 契約要求
- 工項
- 表單
- 查驗要求
- 報表要求
- 照片要求
- 文件附件要求
- 規範依據
- 來源頁碼
- 來源章節

---

## 17.2 AI Form Generator

Input：

- AI 解析出的表單要求
- 原始文件內容

Output：

- 表單名稱
- 表單類型
- 工項
- 欄位清單
- 欄位型態
- 必填欄位
- 審核角色
- 手機可填寫表單

---

## 17.3 AI Daily Log Summary

Input：

- 今日工項
- 今日照片
- 今日查驗
- 今日缺失
- 人員
- 機具
- 材料
- 備註

Output：

- 可編輯的施工日誌摘要
- 可編輯的監造日報摘要

---

## 17.4 AI Report Summary

Input：

- 日期區間
- 日誌
- 查驗
- 缺失
- 照片

Output：

- 可編輯的報表摘要
- 完成事項
- 未完成事項
- 風險事項
- 逾期事項

---

## 17.5 AI Specification Q&A

使用者可以問：

- 這個工項要填哪張表？
- 這個查驗依據哪個規範？
- 混凝土澆置前要檢查什麼？
- 這個缺失需要附什麼照片？
- 這個材料進場要哪些文件？

AI 回答必須包含：

- 簡短答案
- 文件名稱
- 頁碼
- 章節
- 原文來源

---

## 18. Non-functional Requirements

## 18.1 Performance

- Mobile 頁面應在 3 秒內載入。
- Dashboard 應在 5 秒內載入。
- 照片上傳需顯示進度。
- AI 解析可以非同步執行。
- 報表產出可以非同步執行。

---

## 18.2 Security

- Role-based access control
- Project-level data isolation
- Secure file storage
- Audit trail
- Submitted records cannot be overwritten
- User permission must be enforced on every module

---

## 18.3 Data Integrity

- 已送出紀錄不可直接刪除。
- 修改必須建立新版本。
- AI 解析結果必須人工審核。
- 所有要求必須保留來源文件。
- 匯出報表必須包含產出時間與產出者。

---

## 18.4 Localization

MVP 語言：

- 繁體中文

未來可支援：

- 英文
- 中英雙語契約

---

## 18.5 Offline Mode

MVP 可不做，第二階段建議支援：

- 離線查看表單
- 離線填寫表單
- 離線拍照
- 網路恢復後同步

---

## 19. Success Metrics

## 19.1 Usage Metrics

- 建立專案數
- 上傳文件數
- AI 解析要求數
- 已核准 AI 要求數
- 表單填寫數
- 查驗完成數
- 缺失結案數
- 報表產出數

---

## 19.2 Efficiency Metrics

- 施工日誌完成時間低於 5 分鐘
- 監造查驗紀錄完成時間低於 5 分鐘
- 缺失建立時間低於 1 分鐘
- 報表整理時間降低 70%
- 照片紀錄表整理時間降低 70%

---

## 19.3 Quality Metrics

- 表單漏填率下降
- 缺失逾期率下降
- 查驗紀錄完整率提升
- 日誌完成率提升
- 月報重工次數下降

---

## 19.4 Business Metrics

- 3 個 pilot projects
- 10 位以上現場活躍使用者
- 每週活躍率高於 60%
- 至少 1 家顧問公司或營造廠願意付費試用
- 至少 1 個專案完整使用系統產生日誌與查驗報表

---

## 20. Prototype Requirement

Prototype 需要展示以下情境：

1. 建立專案
2. 上傳契約
3. AI 解析契約要求
4. 審核 AI 解析結果
5. AI 建立表單
6. 施工廠商手機填自主檢查
7. 施工廠商提出查驗申請
8. 監造手機查驗
9. 監造開立缺失
10. 施工廠商回覆改善
11. 監造複查結案
12. 系統產出報表

---

## 21. Recommended Demo Scenario

Demo 專案：

- 專案名稱：A 區新建工程
- 工項：混凝土工程
- 契約要求：混凝土澆置前需完成自主檢查並送監造查驗
- 表單：混凝土澆置前自主檢查表
- 查驗結果：不合格
- 缺失：鋼筋保護層不足
- 改善：施工廠商上傳改善照片
- 結果：監造複查合格，系統產出查驗紀錄與缺失改善表

Demo Flow：

1. 上傳契約。
2. AI 解析出「混凝土澆置前自主檢查」。
3. 使用者核准此要求。
4. AI 建立自主檢查表。
5. 施工廠商手機填表並上傳照片。
6. 施工廠商送出查驗申請。
7. 監造手機查驗。
8. 監造標記不合格並建立缺失。
9. 施工廠商上傳改善照片。
10. 監造複查結案。
11. 系統自動產出：
    - 施工日誌
    - 監造查驗紀錄
    - 缺失改善表
    - 照片紀錄表

---

## 22. Design Principles

## 22.1 Contract First

所有任務、表單、查驗、日誌與報表都應該能回到契約來源。

使用者要知道：

- 為什麼要填
- 根據哪個契約條文
- 誰要填
- 誰要審
- 什麼時候要完成
- 完成後產出什麼紀錄

---

## 22.2 Mobile First

現場工程師主要用手機完成工作。

手機體驗原則：

- 少打字
- 多選擇
- 可拍照
- 可語音輸入
- 自動帶入資料
- 快速送出
- 自動產生報表

---

## 22.3 Human-reviewed AI

AI 可以解析契約，但不能直接決定正式工程流程。

所有 AI 結果必須：

- 顯示來源
- 顯示信心分數
- 允許修改
- 允許核准
- 允許拒絕
- 核准後才成為正式任務

---

## 22.4 One Record, Many Outputs

同一筆資料只填一次。

一筆資料可以同時用於：

- 施工日誌
- 監造日報
- 查驗紀錄
- 缺失追蹤表
- 照片紀錄表
- 週報
- 月報

---

## 22.5 Auditability

所有工程紀錄都必須可追溯。

每一筆紀錄都要知道：

- 誰建立
- 什麼時間建立
- 根據哪個契約要求
- 修改了什麼
- 誰審核
- 什麼時候結案

---

## 23. MVP Definition

PMIS AI MVP 是一套給施工廠商與監造使用的 AI 工程現場管理工具。

MVP 必須做到：

1. 可以匯入契約與施工規範。
2. AI 可以解析契約要求。
3. 使用者可以審核 AI 解析結果。
4. 系統可以把契約要求變成表單、任務與查驗流程。
5. 施工廠商可以用手機填自主檢查與施工日誌。
6. 施工廠商可以送出查驗申請。
7. 監造可以用手機完成查驗。
8. 查驗不合格時可以建立缺失。
9. 施工廠商可以回覆缺失改善。
10. 監造可以複查並結案。
11. 系統可以自動產出日誌、查驗紀錄、缺失表與照片表。

---

## 24. Final Product Statement

PMIS AI 是一套針對台灣工程現場的 AI-native PMIS。

使用者只要匯入施工廠商或監造契約，系統就能自動解析契約要求，建立現場需要完成的任務、表單、查驗、日誌、缺失追蹤與報表。

施工廠商與監造工程師可以直接用手機完成現場作業，所有資料只需填寫一次，即可自動產出正式工程紀錄。

核心定位：

> 匯入契約，AI 自動建立工程現場任務；工程師手機填寫一次，系統自動完成 PMIS 紀錄與正式報表。