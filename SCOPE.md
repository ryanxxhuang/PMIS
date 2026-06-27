# PMIS AI — 施工廠商 ↔ 監造 範圍規畫

> 對標 Procore，但只先做「施工廠商（GC）↔ 監造（CM）」這一層協作。
> 核心脊椎：**三級品管 + Contract-First**。不碰業主端、估驗計價、發包、ERP。

---

## 0. 設計主軸：一張物件關係圖

整個系統掛在這條鏈上，每一節都能往回追到契約來源（Contract First），
且一筆資料可同時餵多個輸出（One Record, Many Outputs）。

```
契約 / 規範 (Document)
  └─ AI 解析 → Requirement（人工審核後生效）
       └─ ITP 檢驗停留點 (W/H/R 點)        ← 目前缺的中間層 = 脊椎
            └─ Form Template（自主檢查表 / 監造查驗表）
                 └─ 自主檢查 Self-Inspection（施工廠商送出）
                      └─ 查驗申請 Inspection Request
                           └─ 監造查驗 Supervisor Inspection
                                └─ 缺失 Defect（不合格時自動建立）
                                     └─ 改善 → 複查 → 結案
  ├─ 送審 Submittal（材料 / 施工計畫 / 配比 / 樣品）
  ├─ RFI 工程疑義（人對人正式往來）
  └─ 試驗 Test（取樣→送驗→報告→合格判定）

施工日誌 / 監造日報  ← 聚合當日：照片 + 查驗 + 缺失 + 送審 + 天氣 + 人機料
報表中心            ← 對以上物件做日期區間聚合
Audit Trail        ← 每個 submit / approve / close 都記錄
```

**ITP（檢驗停留點）是目前最大的結構缺口**：它回答「這個工項什麼時候必須通知監造」。
- W = 見證點（Witness，監造可到可不到）
- H = 停留 / 限制點（Hold，**監造未到場不得續作**）
- R = 文件審查點（Review）

---

## 1. 角色與權限矩陣（整併 PRD §12）

兩個組織、5 個角色。關鍵規則：**施工可提送 / 改善，但不能核准或結案自己的東西；
核准查驗、開立 / 結案缺失、核准送審只有監造能做。**

| 模組 \ 動作 | 施工 Admin | 施工 現場 | 施工 品管 | 監造 Admin | 監造 工程師 |
|---|---|---|---|---|---|
| 契約 / AI 解析審核 | 看 | 看 | 看 | 審核 | 看 |
| ITP 停留點 | 看 | 看 | 看 | 核定 | 維護 |
| 自主檢查 | 建/送 | 建/送 | 建/送 | 看 | 看 |
| 查驗申請 | 建/送 | 建/送 | 建/送 | 看 | 看 |
| 監造查驗 | 看 | 看 | 看 | 看 | **執行/核准** |
| 缺失 | 改善 | 改善 | 改善 | **開立/結案** | **開立/結案** |
| 送審 Submittal | 提送 | 提送 | 提送 | **審核** | **審核** |
| RFI | 提問 | 提問 | 提問 | 回覆 | 回覆 |
| 試驗 | 登錄/送驗 | 登錄 | 登錄/判定 | 看 | 抽查 |
| 施工日誌 | 建/送 | 建/送 | 建/送 | 看 | 看 |
| 監造日報 | 看 | 看 | 看 | 看 | **建/送** |
| 報表 | 匯出施工 | 看 | 匯出施工 | 匯出監造 | 匯出監造 |

Demo 用：加一個「視角切換」（施工 ⇄ 監造），免重新登入即可演兩方流程（類 Procore company switch）。

---

## 2. 模組清單（分階段）

### Phase 0 — 已建（PRD §21 主線）
契約上傳 · AI 解析審核 · AI 表單產生器 · 自主檢查 · 查驗申請 · 監造查驗 ·
缺失追蹤 · 照片(簡) · 報表中心 · Audit Trail

### Phase 1 — 補主線兩個洞（最高投報率）
- ✅ **M1 施工日誌 / 監造日報**（PRD §13.6 / 13.7）— 已完成：手機端 `/m/daily-log`（施工/監造 toggle、
  自動帶入當日天氣/工項/照片/查驗/缺失、AI 摘要可編輯、監造日報可引用施工廠商日誌）；Web 端 `/daily-logs`
  清單與明細；Dashboard 與手機首頁皆已串接。
- ⬜ **M2 檢驗停留點 / ITP**（把契約 ↔「何時叫監造」串起來；AI 解析的 wow factor）← 下一個

### Phase 2 — 撐起 platform 感
- ✅ **M3 材料 / 施工送審 Submittals**（GC↔監造 #1 高頻互動）— 已完成：Web `/submittals`，
  採 Procore **ball-in-court**（球在誰手上）；施工提出→監造審查（核准／核准具註記／退回修正／駁回）→
  退回則球回施工、重新送審版次 +1；完整審查往返歷程；Dashboard 已串接。
- ✅ **M4 RFI 工程疑義**（人對人正式往來，與 AI Spec Q&A 區分）— 已完成：Web `/rfi`，同樣 ball-in-court；
  施工提出→監造回覆→施工確認結案；可標**工期 / 費用影響**旗標與優先級；Dashboard 已串接。
- ⬜ **M5 試驗 / 取樣管理**（頻率驅動，種子已有 R4 抗壓試驗卻無處落地）← 下一個

### Phase 3 — 完整度
會議紀錄 · 分包商通訊錄 · 基本進度 / 里程碑 · 工安事件 ·
權限矩陣落地 · Web 版任務中心 · 通知

### 先不做（Procore 有但砍掉）
預算 · 估驗計價 · 變更 · 發包 Bidding · 工時 Timesheets · 發票付款 · ERP

---

## 3. 新增資料物件（沿用現有 seed / store 風格）

### 3.1 ITP 檢驗停留點
```
itp_id, project_id, requirement_id（來源契約要求）,
work_item, inspection_class（第一級自主檢查 / 第二級監造查驗）,
point_type（W 見證 / H 停留 / R 文審）,
form_template_id, required_role, reviewer_role,
acceptance_criteria（合格標準，AI 從規範抽）,
frequency, source_document_id, source_page, source_section,
status（Planned / Active / Done）
```
一個 Requirement 可展開多個 ITP 點。H 點觸發「該叫監造」任務。

### 3.2 Daily Log（施工 / 監造共用 schema，以 log_type 區分）
```
daily_log_id, project_id, log_type（contractor / supervisor）, log_date,
weather（自動帶）, work_areas[], work_items[],
manpower[{trade,count}], equipment[{name,count}], materials[{name,qty,status}],
work_summary（AI 摘要，可編輯）,
today_inspections[], today_defects[], today_submittals[], today_photos[]（自動帶當日）,
safety_notes, abnormal_events, supervisor_instructions, tomorrow_plan,
# 監造日報專屬：
ref_contractor_log_id（引用施工廠商當日日誌）, sampling_notes,
supervisor_opinion, progress_note,
status（Draft / Submitted）, submitted_by, submitted_at, version
```
重點：監造日報可「引用 / 不引用」施工廠商當日日誌（PRD §13.7）。

### 3.3 Submittal 送審
```
submittal_id, project_id, submittal_no（自動）, title,
type（材料 / 施工計畫 / 配比 / 出廠證明 / 樣品）, work_item, spec_section,
submitted_by, submitted_at, attachments[], revision（第幾版）, due_date,
review_role, reviewer, reviewed_at, review_comments[],
linked_requirement_id,
status（Draft → Submitted → Under Review →
        Approved | Approved as Noted | Revise & Resubmit | Rejected → Closed）
```
採 ball-in-court 概念（現在輪到誰）。可選 gating：核准前該工項不得開查驗。

### 3.4 RFI 工程疑義
```
rfi_id, rfi_no, project_id, subject, question,
asked_by（施工）, asked_at, assigned_to（監造 / 設計）, priority,
cost_impact（flag+說明）, schedule_impact（flag+說明）, due_date,
status（Open / Answered / Closed）,
answer, answered_by, answered_at, attachments[], linked_spec_section
```
與 §17.5 AI Spec Q&A 不同：RFI 是正式、編號、可標工期 / 費用影響的人對人往來。

### 3.5 Test 試驗 / 取樣
```
test_id, project_id, test_type（混凝土抗壓 / 鋼筋拉力 / 級配…）, work_item,
sample_no, sampled_at, sampled_by, required_frequency（每 100m³）,
lab, sent_at, report_no, report_url,
result_value, acceptance, pass,
linked_requirement_id（R4）,
status（取樣 / 送驗 / 報告待回 / 合格 / 不合格）
```

---

## 4. 跨模組串接（One Record → Many Outputs）

- 自主檢查送出 → 照片入庫、可被當日施工日誌帶入、可附到查驗申請
- 監造查驗不合格 → 自動建缺失 ＋ 入監造日報「缺失開立」＋ Audit
- 缺失改善 → 改善照片入庫 ＋ 入施工日誌
- ITP 的 H 點 → 觸發「該叫監造」任務到任務中心
- Submittal 核准 →（可選）解鎖該工項可施工 / 可開查驗
- 報表中心 = 對上述物件做 date-range 聚合

---

## 5. 導覽改版（Procore 式左欄分組）

**Web**
- 總覽：Dashboard / 任務中心
- 品質查驗：檢驗停留點(ITP) / 自主檢查 / 監造查驗 / 缺失追蹤 / 試驗
- 文件協作：契約與規範 / AI 解析審核 / 表單產生器 / 送審 / RFI
- 日報：施工日誌 / 監造日報
- 產出：報表中心 / Audit Trail

**手機底欄（5）**：首頁 / 日誌 / 自主檢查 / 查驗 / 缺失（＋更多）

---

## 6. 已拍板的決策（2026-06-17）

1. **Demo 線**：✅ 先維持單線（混凝土情境），新模組都掛在這條線上。
2. **資料持久化**：✅ 加 localStorage（key `siteflow-demo-v1`），附左下「重置 demo」按鈕。
3. **Phase 1 先後**：✅ 先 M1 施工日誌（已完成），再 M2 ITP。

待議：
- **送審 gating**：核准前該工項「不能開查驗」要不要做？（做 M3 送審時再決定）
