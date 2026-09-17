# 監造確認量與估驗聯動（後端強制）

> 狀態：**PROPOSED（P0 設計）**｜2026-09-17｜依 [D-026](../DECISIONS.md)。技術設計，尚未建 migration；進度只看 [續接清單](../reviews/2026-09-17-product-slimming-worklog.md)。
> 標記同 [現場文書文件](field-documents-lifecycle.md)：【已確認】／【設計】／【待決】。

## 0. 現況核對與差距（基準 `ab4be5f`）

| 現況 | 位置 | 差距 |
|---|---|---|
| 估驗明細 `valuation_items(cum_qty, cum_pct, amount_cum, source manual\|daily_log)`，`unique(valuation_id, work_item_id)`；金額由前端 `valuationItemRow` 算 | [`billing.js`](../../src/store/slices/billing.js) | 客戶端算金額並直接 upsert；沒有任何「數量來源」與「監造確認」約束 |
| `fillValuationFromSiteLogs`：加總施工日誌 `qty_today`，取不低於前期的累計、不超過契約量，upsert `source='daily_log'` | 同上 | 是不受確認量限制的請款路徑【已確認 必須關閉】 |
| `valuations_guard`：只擋「跨越已核定」非監造、機關只能碰金流三欄；`valuation_items_guard`：已核定後凍結（監造／admin 例外）；`valuations_payment_gate`：未核定不得有金流、請款→收款順序；`valuations_delete_guard` | [baseline](../../supabase/migrations/20260711000000_baseline.sql)、[formal_mode](../../supabase/migrations/20260712001300_formal_mode.sql)、[payment_flow](../../supabase/migrations/20260712001800_payment_flow.sql) | 草稿→監造審核、監造審核→草稿沒有角色限制（廠商可自行「退回」）；核定時沒有任何數量檢查 |
| `inspections` 只有 `status`／`work_item_id`／`location` 自由文字，沒有數量、單位、批次、階段 | baseline | 無法追到「確認了哪一批多少」 |
| 估驗頁佐證欄：`collectEvidence` 確定性 join 顯示日誌／查驗／檢查表／試體；超過日誌 5% 提示 | [`evidence.js`](../../src/lib/evidence.js)、[`Valuation.jsx`](../../src/pages/web/Valuation.jsx) | 只是顯示，不是控制 |
| `photo_frozen_reason` 以「工項出現在已核定估驗明細」凍結照片 | [photo_evidence_guard](../../supabase/migrations/20260822010000_photo_evidence_guard.sql) | 可沿用；新增確認量表後照片凍結事由再加一條（照片為已核定確認量的附件） |
| 期別截止日 `valuations.period_end` 已有欄位但前端不填 | baseline | 正式資料 12 期只有 3 期有 `period_end` |

正式資料（2026-09-17 唯讀盤點）：`valuations` 12（草稿 7、監造審核 1、已核定 4；有請款日 2、收款日 2、實收 3）；`valuation_items` 26（`daily_log` 21、`manual` 5），其中 22 筆同工項沒有任何合格查驗、17 筆同工項連查驗都沒有；已核定期有量的 5 筆中 4 筆無合格查驗；1 筆掛在非末端／非計價列；超契約量 0、負值 0。`inspections` 11 筆全無數量欄位可用。結論：**現有查驗紀錄不能推導任何確認量**；過渡只能「保留舊帳、新請款需依據」（§13）。

## 1. 名詞與不變量

| 名詞 | 定義 |
|---|---|
| 工項 `W` | `work_items` 末端且 `is_billable` 且非 `is_rollup` 的列；契約量 `Qc(W)`＝`quantity`＋已核准變更的 `qty_delta`（`change_orders.status='核准'` 且 `change_order_items.work_item_id=W`） |
| 批次 `b` | 「專案＋工項＋施作位置／批次」的正規化鍵 `batch_key`（去空白、全形轉半形、大小寫不分）；由監造查驗表單的位置／批次欄產生，**不可為空** |
| 階段 `s` | 多階段必要查驗的階段鍵；來源＝該工項的 ITP 停留點（`inspection_points.point_type='H'` 且有 `stage_key`）；沒有停留點＝單階段 |
| 確認紀錄 | `inspection_confirmations` 一列：監造對 `(W, b, s)` 簽署的**累計**確認通過量 `qty_cum` |
| 批次有效確認量 `E(W,b,t)` | 各必要階段在時點 `t` 前最新一筆 `active` 確認的 `qty_cum` 取**最小值**；缺任一必要階段＝0 |
| 有效可計價確認量 `E(W,t)` | `min(Σ_b E(W,b,t), Qc(W))` |
| 已計價量 `B(W)` | `valuation_item_sources` 中期別狀態 ∈ {已核定, 已請款} 的分配量總和（含 legacy 與 clawback） |
| 占用量 `O(W,P)` | 其他期別（≠P）且狀態 ∈ {草稿, 監造審核} 的分配量總和 |
| 本期可新增上限 | `cap(P,W) = max(0, E(W, P.period_end) − B(W) − O(W,P))` |
| 本期增量 | `Δ(P,W) = cum_qty(P,W) − cum_qty(prev(P),W)`，其中 `prev(P)` 是 `period_no` 較小的最近一期 |

不變量（DB 強制，無 service role 例外）【已確認】：

1. `Δ(P,W) = Σ 分配(P,W)`——每一單位增量都追得到確認紀錄（或明示的 legacy／clawback／adjustment 來源）。
2. `Σ_{所有期} 分配(·,W,b) ≤ E(W,b,now)`——同一批次不重複計價。
3. `cum_qty(P,W) ≤ Qc(W)`；`cum_qty ≥ 0`；`Δ ≥ 0` 除非分配含 `clawback`。
4. 狀態轉移 草稿→監造審核、監造審核→已核定、登錄請款日 三個時點都重算 1–3；任何一項不成立即拒絕整期。
5. 已核定／已請款期別的 `valuation_items` 與其分配永不改寫；更正走 `valuation_adjustments`。

## 2. 資料模型【設計】

**`inspection_confirmations`**

| 欄位 | 說明 |
|---|---|
| `id`, `project_id`, `created_at` | — |
| `work_item_id uuid not null` FK `work_items` **on delete restrict** | 有 active 確認的工項不可被標單重匯刪除（先撤銷） |
| `batch_key text not null`, `location_label text` | 正規化鍵＋顯示文字 |
| `stage_key text` | null＝單階段 |
| `unit text not null` | 簽署時快照，guard 檢查正規化後等於 `work_items.unit` |
| `qty_cum numeric(18,4) not null check (qty_cum >= 0 and qty_cum <> 'NaN' and qty_cum < 1e12)` | 該批次該階段**累計**確認通過量 |
| `qty_delta numeric(18,4) not null` | 導出：`qty_cum − 前一筆 active 的 qty_cum`（可負＝減量，需 `reason`） |
| `basis text not null check in ('inspection','supervisor_certificate','pro_rata_rule')` | 查驗／監造確認單／比例規則（§10） |
| `inspection_id uuid` FK, `document_id uuid` FK `field_documents`, `document_version_no int`, `content_hash text` | 追溯到簽署版本 |
| `confirmed_by uuid not null`, `confirmed_at timestamptz not null default now()` | 監造確認人與伺服器時間 |
| `status text not null default 'active' check in ('active','revoked')`, `revoked_at`, `revoked_by`, `reason text` | 撤銷／減量留痕 |
| `supersedes_id uuid` | 改量時指向被取代列 |

唯一：`(inspection_id, work_item_id, stage_key)` where `inspection_id not null`（同一次查驗對同工項同階段只能一筆＝重播冪等）。grants：authenticated 只有 SELECT；寫入只走 `sign_field_document`（查驗表單）與 `issue_supervisor_certificate`；`revoke_inspection_confirmation` 改狀態。

**`valuation_item_sources`（期別來源分配）**

`id`, `valuation_id` FK cascade, `work_item_id`, `batch_key`, `stage_key`, `qty numeric(18,4) not null check (qty <> 0)`, `kind text check in ('confirmation','legacy','clawback','adjustment')`, `confirmation_id uuid`（建立分配時的最新確認，追溯用）, `adjustment_id uuid`, `created_at`, `created_by`。唯一 `(valuation_id, work_item_id, batch_key, kind)`。authenticated 只有 SELECT。

**`valuation_adjustments`（已核定後的更正流程）**

`id`, `project_id`, `work_item_id`, `batch_key`, `qty_delta numeric(18,4)`（負＝扣回）, `reason text not null`, `source_confirmation_id`, `origin_valuation_id`（被更正的已核定期）, `status text check in ('pending','applied','void')`, `applied_valuation_id`, `created_by`, `created_at`, `applied_at`。append-only 加狀態；每筆寫 `audit_events`。

**`work_item_pricing_basis`**：`work_item_id pk`, `basis text check in ('inspection','supervisor_certificate','pro_rata','excluded')`, `rule jsonb`, `set_by`, `set_at`。缺列＝依單位推定（§10）。

**`valuations` 加欄**：`recheck_required boolean not null default false`、`recheck_note text`（撤銷後標記，核定前必須清除）；`period_end` 改為送審時必填（guard）。**`valuation_items` 加欄**：`backing text not null default 'legacy'`（`legacy`／`confirmed`／`adjusted`），`amount_cum` 改由 DB 計算。

**`inspection_points` 加欄**：`stage_key text`、`required_for_billing boolean default true`（H 點預設必要）。

## 3. 有效確認量的計算（純函式，SQL）

`fn_effective_confirmed(p_work_item, p_as_of timestamptz) returns numeric` 與 `fn_effective_by_batch(...)`：

1. 取該工項必要階段集合 `S`＝`inspection_points where work_item_id=W and point_type='H' and required_for_billing and stage_key is not null` 的 `stage_key`；空集合→`S={null}`。
2. 對每個 `batch_key`、每個 `s∈S`：取 `confirmed_at ≤ p_as_of and status='active'` 的最新一筆 `qty_cum`；缺→0。
3. 批次量＝各階段最小值；工項量＝Σ批次；再與 `Qc(W)` 取 min。

### 3.1 需求案例對照【已確認 結果】

| 案例 | 紀錄 | 結果 |
|---|---|---|
| 申報 100 m²、未經監造通過 | 無確認 | `E=0`，可新增 0 |
| 監造通過 60；其中已計價 20 | `qty_cum=60`；`B=20` | `cap=40` |
| 同一批多張照片、兩次查驗、複查 | 第二次查驗對同批次簽 `qty_cum=60`（累計語意） | `E` 仍 60，不累加 |
| 不合格 40 改善後通過 | 複查簽 `qty_cum=100` | `E=100`，`qty_delta=40`，只新增 40 |
| 不同位置同工項 | `batch_key` 不同 | 各批相加，不誤混 |
| 多階段（鋼筋→模板→澆置） | 三階段各簽；澆置未簽 | 批次量＝0；三階段齊全取最小 |
| 部分通過 | 表單「查驗範圍 100，通過 60，待改善 40」 | 只寫 `qty_cum=60`；40 進缺失 |

累計語意的代價：監造在表單要填「本批累計通過量」而非「本次通過量」；UI 同時顯示「上次累計 60，本次新增 40，累計 100」，簽署前核對。寫入更小的累計＝減量，必填 `reason` 並走 §7。

## 4. 期別來源分配

- 截止日：`P.period_end`（台北日曆日）；送審前必填。分配只取 `confirmed_at::date（台北）≤ period_end` 的確認。
- 分配順序：同工項各批次依最早 active 確認的 `confirmed_at` 升冪（FIFO），每批次可分配量＝`E(W,b,period_end) − 該批次已被其他期別分配量`。
- RPC `sync_valuation_from_confirmations(p_valuation_id)`：只允許 `status='草稿'`；逐工項在 advisory lock 下重算分配到上限，upsert `valuation_items`（`cum_qty = prev_cum + Σ分配`，`backing='confirmed'`），回傳每工項 `{prev_cum, added, cap, sources[]}`；冪等（重跑結果相同）。
- RPC `set_valuation_item_cum(p_valuation_id, p_work_item_id, p_cum_qty)`：廠商可在 `[prev_cum, prev_cum + cap]` 內調整；RPC 重算分配（FIFO）而不是信任客戶端送來的分配或金額。低於 `prev_cum` 一律拒絕（減量走 §7）。
- 金額：`amount_cum = round(cum_qty × unit_price)`（元，四捨五入到整數，【待決 Q2 精度】）；`amount_period = amount_cum − prev_amount_cum`；由 DB 在 upsert 時計算，客戶端值忽略。

## 5. 自動更新規則【已確認】

`inspection_confirmations` AFTER INSERT（在簽署 RPC 同交易內）：

1. 找目標期：`valuations where project_id=… and status='草稿' and (period_end is null or period_end ≥ confirmed_at 台北日) order by period_no limit 1`。
2. 有→對該工項呼叫分配（只增不減，不動其他工項）；同時把查驗表單／照片掛進該期的 `sources`（透過 `confirmation_id` 追溯，不複製）。
3. 沒有草稿期（或草稿期截止日早於確認日）→不動任何期別；「可估驗清單」view `v_billable_backlog(project)` 列出 `E − B − O > 0` 的工項與批次，估驗頁「建立新期」時自動帶入。
4. `監造審核`／`已核定`／`已請款` 期別永不被自動改寫；新確認只影響下一個草稿期。

## 6. 草稿占用與釋放

占用＝`valuation_item_sources` 列存在且期別未終結。規則：

| 動作 | 效果 |
|---|---|
| 刪除草稿期 | 分配 cascade 刪除＝釋放 |
| 草稿期以 `set_valuation_item_cum` 降低累計 | RPC 依 FIFO 反向釋放最晚分配的批次 |
| 監造審核 → 草稿（退回） | 分配保留（仍占用），廠商可再調整 |
| 監造審核中 | 分配凍結，不可增減 |
| 已核定／已請款 | 分配永久（轉為已計價） |
| 草稿期長期閒置 | 不自動釋放；「可估驗清單」明示「被第 n 期草稿占用」並可一鍵開啟該期；避免靜默永久占用 |

## 7. 撤銷、減量與已核定後的調整【已確認 原則】

RPC `revoke_inspection_confirmation(p_id, p_reason)`（監造）與「重簽較小累計」都會導致某批次 `E` 下降。處理（同交易）：

1. 對受影響批次的分配依期別狀態：
   - 草稿：分配縮減至新可用量（最晚分配先減），重算 `cum_qty`／金額。
   - 監造審核：不改數字；`valuations.recheck_required=true` 並記錄不符工項；核定 guard 拒絕直到監造退回、廠商重算。
   - 已核定／已請款：分配不動；建立 `valuation_adjustments(qty_delta<0, status='pending')`；下一個草稿期存在或建立時自動加入 `kind='clawback'` 的負分配（`cum_qty` 相應減少，可為負增量），核定時 `pending` 調整必須已 `applied` 或 `void`（`void` 只有機關可執行並記原因）。
2. 每一步 `record_audit_event`（`confirmation.revoked`、`valuation.recheck_flagged`、`valuation_adjustment.created/applied`）。
3. 撤銷後的照片凍結：`photo_frozen_reason` 加事由「照片為已核定確認量之附件」，撤銷不解凍已核定期的照片。

## 8. 併發與重播【設計】

- **鎖**：所有改動分配／確認量的 RPC 與 `valuations_guard` 的狀態轉移檢查，先 `pg_advisory_xact_lock(hashtext(project_id::text || ':' || work_item_id::text))`（逐工項，依 `work_item_id` 排序取得，避免死鎖），再 `select … for update` 鎖 `valuations` 列。兩個期別／兩個使用者同時搶同一可用量會序列化，第二個看到已扣的量而失敗。
- **唯一鍵**：`inspection_confirmations(inspection_id, work_item_id, stage_key)`；`valuation_item_sources(valuation_id, work_item_id, batch_key, kind)`；`field_document_submissions(document_id, client_request_id)`。
- **狀態轉移冪等**：RPC `transition_valuation(p_id, p_from, p_to, p_note)`——當前狀態 ≠ `p_from` 時回「已非此狀態」而不是套用；直接 REST 改 `status` 仍會經 `valuations_guard` 做同一組檢查（檢查在 trigger，不在 RPC）。
- **重播同一確認**：唯一鍵擋第二筆；同步 RPC 重跑結果相同（純函式重算，不累加）。
- **超時**：RPC 內 `set local lock_timeout='5s'`，鎖不到回明確錯誤，前端提示重試。

## 9. 寫入路徑封堵清單【已確認 範圍，設計 手段】

| 路徑 | 控制 |
|---|---|
| 直接 REST `valuation_items` INSERT／UPDATE／DELETE | 第二支 migration `revoke insert, update, delete from authenticated`；只留 SELECT；寫入只經 RPC |
| 直接 REST `valuations.status`／`period_end`／金流欄 | 保留可寫（相容），但 `valuations_guard` 擴充：送審必填 `period_end`；送審／核定／請款日三個轉移重算不變量；草稿→監造審核限廠商（admin_override 例外）、監造審核→草稿限監造 |
| `inspection_confirmations`／`valuation_item_sources`／`valuation_adjustments` | authenticated 無寫入 grant；service role 也經 guard（不變量檢查**不看** `auth.uid() is null`） |
| RPC | 全部 security definer、`revoke from public, anon`；輸入驗證（UUID、非負、有限、單位） |
| Edge | 沒有 Edge 寫估驗表；新增掃描測試（比照 `agentToolWhitelist.scan.test.ts`）釘住 `supabase/functions` 內不出現 `from('valuation_items')` 的寫入 |
| `fillValuationFromSiteLogs` | 從 store 移除；估驗頁改為唯讀「日誌申報量 vs 確認量 vs 本期累計」差異比對（`valuationDiff.js` 延伸） |
| 標單匯入／重設 `reset_project_boq` | `work_items` FK on delete restrict：有 active 確認的工項不可重匯；先撤銷（留痕）再重匯 |
| 管理員例外 `admin_override`（非正式模式） | 只放行**角色**檢查（單人試用可兼簽），**不放行數量不變量** |
| service role | 無 bypass；維護只能走 `admin_adjust_valuation_item(p_reason)`（平台管理員、必填原因、寫 audit、產生 `adjustment` 來源列） |
| 客戶端 `approved_qty`／`cum_qty`／金額 | RPC 只接受 `cum_qty` 目標值並重算；金額一律 DB 算 |
| 舊前端／舊 RPC | 部署順序 §12；封堵 migration 套用後舊前端的 upsert 會收到明確錯誤（`mutationOutcome` 已能顯示），不會靜默成功 |
| 跨專案 | 所有 RPC 以 `p_valuation_id` 反查 `project_id`，工項與確認必須同案；RLS 縱深 |

## 10. 總價／間接費等非實體工項【已確認 不可豁免，待決 依據】

推定：`unit` 正規化後 ∈ {式, 項, 批, LS} 且 `quantity ≤ 1` 的末端工項＝總價類；`work_item_pricing_basis` 缺列時視為 `basis='inspection'` 但總價類工項一律標「計價依據待設定」，`cap=0`、估驗頁明示。

| basis | 行為 |
|---|---|
| `inspection` | 一般實體工項，依查驗確認量 |
| `supervisor_certificate` | 監造簽署「監造確認單」（`checklist_templates.kind='supervisor_certificate'`），確認本期累計完成比例或數量與契約依據條款；產生 `basis='supervisor_certificate'` 的確認紀錄 |
| `pro_rata` | 依規則（例如「直接工程費已核定金額 × 比例」）由 DB 在同步時計算本期量，仍需監造在該期核定時勾稽；`rule` 記公式與條款 |
| `excluded` | 不由本系統計價 |

【待決 Q3】實案的利潤及管理費、營業稅、保險費、假設工程等各用哪一種 basis；答覆前這些工項隔離不計價。

## 11. 精度與單位

- 數量 `numeric(18,4)`；金額 `numeric(18,2)` 儲存但依【待決 Q2】四捨五入到元；比較全部在 DB，前端不做浮點比較。
- 拒絕：負值、`NaN`、`≥1e12`、單位不一致（正規化比較）、缺 `batch_key`、缺 `work_item_id`、工項非末端／非計價、跨案。
- 前端顯示沿用 `format.js`；輸入框只送字串數字，由 RPC 轉型。

## 12. RPC／trigger／policy 與部署順序

| 單元 | 內容 |
|---|---|
| P4a | `fn_effective_confirmed`、`fn_effective_by_batch`、`fn_contract_qty`、`fn_cap`、`v_billable_backlog`；pgTAP 純計算（含 §3.1 全部案例） |
| P4b | 三張新表＋加欄＋guards（`valuations_guard` 擴充、`valuation_items` 寫入 guard、確認表 guard）＋RPC（`sync_`、`set_valuation_item_cum`、`transition_valuation`、`revoke_`、`issue_supervisor_certificate`、`admin_adjust_valuation_item`）＋advisory lock；pgTAP 併發（兩個 session 用 `dblink` 或 pg_background 不可用時以序列化情境＋唯一鍵測試替代並明列限制） |
| P4c | 前端：可估驗清單、來源展開、缺件、差異比對、移除 `fillValuationFromSiteLogs` |
| P4d | 撤銷／減量／調整 UI 與核定、請款整合 |
| P4e | 封堵 migration（revoke）＋Edge 掃描測試＋舊客戶端相容驗證 |

部署順序：P4b（加法）→ 前端 P4c → **觀察一個完整期別** → P4e 封堵。P4b 之後、P4e 之前，舊前端的直接 upsert 仍可寫 `valuation_items`，但送審／核定已被 guard 擋下，不會產生未經確認的核定；這是刻意的相容窗。

## 13. 舊資料過渡（依正式盤點）【已確認 原則】

- 已核定 4 期（含有量明細 5 筆）：保留；為每筆插入 `valuation_item_sources(kind='legacy')`，讓 `B(W)` 計入已計價量，之後不能再計一次。不偽造任何確認或簽署。
- 草稿 7 期＋監造審核 1 期：數量保留但 `backing='legacy'`；送審／核定時不變量不成立→拒絕並列出「缺監造確認來源」工項；補證路徑＝監造以 `supervisor_certificate` 對該批次簽署確認（`reason` 註明「補證：既有紀錄」），或廠商重新申請查驗。監造審核那一期需監造退回後重算。
- 沒有 `period_end` 的期別：送審時要求補填；歷史已核定期不補。
- 1 筆掛在非末端／非計價列的明細：不刪；新規則下無法再增量，UI 標示。
- 回復：drop 三張新表與加欄、還原 `valuations_guard` 舊版本（rollback 檔）；`legacy` 來源列隨表移除，不影響 `valuation_items` 原值。

## 14. 驗收情境對應（需求 §8「監造確認量與計價」）

| 情境 | 驗證位置 |
|---|---|
| 申報 100 未通過→0；通過 60 已計價 20→40 | pgTAP `fn_cap` |
| 多照片／兩次查驗／複查／多階段不重複；不同位置不誤混 | pgTAP `fn_effective_*` |
| 改善後通過只增 40 | pgTAP 累計語意 |
| 兩期／兩人同時占用；重播不重複入帳 | pgTAP 唯一鍵＋advisory lock 序列化情境；真後端 E2E 兩分頁同時送 |
| 草稿釋放；送審／核定不被改寫；跨期累計正確 | pgTAP 狀態情境 |
| 撤銷／減量後未核定阻擋、已核定走調整 | pgTAP `revoke_` |
| 超契約量、缺階段、截止日不符、錯單位、缺來源、跨案 | pgTAP 拒絕矩陣 |
| 舊日誌帶入、手動改量、直接 REST／RPC、舊客戶端、管理員、非成員 | pgTAP 權限矩陣（三角色＋非成員＋admin_override 正式／非正式） |
| 總價／間接費缺規則不放行 | pgTAP `basis` |

## 15. 待決

- **Q2 金額精度**：逐工項四捨五入到元後加總，或加總後才取整。暫行：逐工項到元（與現行列印口徑相近）。
- **Q3 總價／間接費 basis**：見 §10。暫行：隔離不計價。
- **Q6 多階段來源**：以 ITP H 點為必要階段是否符合實案品質計畫。暫行：H 點；R／W 點不作必要。
- **Q7 截止日語意**：`period_end` 是否等於估驗計價截止日（契約）或提送日。暫行：計價截止日，由廠商建期時填、送審前必填。
