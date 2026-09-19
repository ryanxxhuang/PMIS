# 監造確認量與估驗聯動（後端強制）

> 狀態：**ACTIVE（後端已實作：P4a 純計算層 `20260917120000`、P4b 表／guard／RPC／鎖 `20260919040000`；前端 P4c、撤銷／調整 UI P4d、封堵 P4e 未做）**｜2026-09-19｜依 [D-026](../DECISIONS.md)。§1–§13 是 P0 設計；實作與設計的偏差集中在 §16（以 §16 為準）；進度只看 [續接清單](../reviews/2026-09-17-product-slimming-worklog.md)。
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

**與現場文書資料層的介面（P2a 已定案，P3c／P4b 依此接）**：`document_id` FK `field_documents(id)`，`(document_id, document_version_no)` 複合 FK `field_document_versions(document_id, version_no)`（版本列不可變，追溯永遠指向同一份內容）；`content_hash` 必須等於該版本 `field_document_versions.content_hash`（只由 DB 的 `fn_field_document_content_hash` 計算）並與簽署列 `field_document_signatures(document_id, version_no)` 的雜湊一致——P4b 的確認表 guard 以此檢查，確保「確認量」追得到一個被簽署過的版本。`confirmed_by`／`confirmed_at` 取簽署列的 `signer_id`／`signed_at`（伺服器時間），不另收客戶端值。寫入順序（同交易，見 [現場文書 §5](field-documents-lifecycle.md#5-簽署已確認-要求設計-機制)）：簽署列 → `field_documents.status='signed'` → 更新 `inspections`（判定、`document_id` 等）→ `inspection_confirmations`（AFTER INSERT 自動同步草稿期）。監造查驗表單的 `owner_org` 由 `doc_type='inspection_form'` 固定為 `supervisor`，簽署列的 `signer_org` 由伺服器取自簽署者 profile，因此「確認人是監造」在資料層已保證；`batch_key`／`stage_key`／`unit`／`qty_cum` 來自簽署版本的 `content`（P3c 的示範範本欄位），由 RPC 讀版本內容餵入 `fn_cq_*` 正規化，不信任客戶端另傳的數字。

**`valuation_item_sources`（期別來源分配）**

`id`, `valuation_id` FK cascade, `work_item_id`, `batch_key`, `stage_key`, `qty numeric(18,4) not null check (qty <> 0)`, `kind text check in ('confirmation','legacy','clawback','adjustment')`, `confirmation_id uuid`（建立分配時的最新確認，追溯用）, `adjustment_id uuid`, `created_at`, `created_by`。唯一 `(valuation_id, work_item_id, batch_key, kind)`。authenticated 只有 SELECT。

**`valuation_adjustments`（已核定後的更正流程）**

`id`, `project_id`, `work_item_id`, `batch_key`, `qty_delta numeric(18,4)`（負＝扣回）, `reason text not null`, `source_confirmation_id`, `origin_valuation_id`（被更正的已核定期）, `status text check in ('pending','applied','void')`, `applied_valuation_id`, `created_by`, `created_at`, `applied_at`。append-only 加狀態；每筆寫 `audit_events`。

**`work_item_pricing_basis`**：`work_item_id pk`, `basis text check in ('inspection','supervisor_certificate','pro_rata','excluded')`, `rule jsonb`, `set_by`, `set_at`。缺列＝依單位推定（§10）。

**`valuations` 加欄**：`recheck_required boolean not null default false`、`recheck_note text`（撤銷後標記，核定前必須清除）；`period_end` 改為送審時必填（guard）。**`valuation_items` 加欄**：`backing text not null default 'legacy'`（`legacy`／`confirmed`／`adjusted`），`amount_cum` 改由 DB 計算。

**`inspection_points` 加欄**：`stage_key text`、`required_for_billing boolean default true`（H 點預設必要）。

## 3. 有效確認量的計算（純函式，SQL）

`fn_effective_by_batch(p_confirmations, p_required_stages, p_unit, p_as_of)` 與 `fn_effective_confirmed(…, p_contract_qty)`（P4a 已實作；函式不讀表，輸入由 P4b 從表查出後餵入，介面見 §3.2）：

1. 必要階段集合 `S`＝`p_required_stages`（P4b 由 `inspection_points where work_item_id=W and point_type='H' and required_for_billing and stage_key is not null` 查出）；正規化、去空、去重；空集合→`S={null}`。
2. 對每個 `batch_key`、每個 `s∈S`：取 `confirmed_at ≤ p_as_of and status='active'` 的最新一筆 `qty_cum`（同時刻並列取最小）；缺→0。階段不在 `S` 的紀錄（含多階段工項的無階段紀錄）不計。
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

### 3.2 P4a 純計算介面【已實作 `20260917120000`；P4b 餵入約定】

全部 `IMMUTABLE`、`security invoker`、`search_path = pg_catalog, public`、`revoke from public, anon, authenticated`（P4b 的 security definer RPC／view 以 owner 呼叫；要對外顯示再明示 grant）。fail-closed：壞資料 raise，不靜默略過。回復檔 `supabase/rollbacks/20260917120000_confirmed_quantity_calc.down.sql`。

| 物件 | 用途 | P4b 餵入來源 |
|---|---|---|
| type `cq_confirmation(batch_key, stage_key, unit, qty_cum, confirmed_at, status)` | 一筆監造確認（累計語意） | `inspection_confirmations` 一列 |
| type `cq_allocation(batch_key, qty)` | 一期對一批次的分配（可負＝clawback） | `valuation_item_sources` 一列 |
| `fn_cq_normalize_text(text)`／`fn_cq_batch_key(text)`／`fn_cq_check_unit(actual, expected)` | 批次鍵／單位／階段鍵正規化（去空白含全形、全形→半形、²³→23、小寫）；空批次鍵 raise；單位不等 raise。沒有單位同義表 | 確認表 guard 在 insert 時用 |
| `fn_cq_qty(numeric, label, allow_negative)` | 缺值／NaN／無限大／≥1e12／負值 raise；四捨五入到 4 位小數 | 所有數量入口 |
| `fn_cq_as_of(period_end date)` | 截止日（台北日曆日）→ 該日 23:59:59.999999 的截止時點；null＝不設截止 | `valuations.period_end` |
| `fn_contract_qty(base, approved_deltas[])` | `Qc = quantity + Σ核准變更 qty_delta`；base null→0；結果為負 raise | `work_items.quantity`、`change_order_items` where `change_orders.status='核准'` |
| `fn_effective_by_batch(confirmations[], required_stages[], unit, as_of)` → `(batch_key, qty, first_confirmed_at)` | 各批次有效量（§3 規則），附最早確認時間供 FIFO | — |
| `fn_effective_confirmed(…, contract_qty)` | `E(W,t) = min(Σ批次, Qc)` | — |
| `fn_cap(effective, billed, reserved, basis default 'inspection')` | `max(0, E − B − O)`；`basis` null／`excluded` → 0；billed／reserved null 視為 0 | B＝已核定／已請款期分配和；O＝其他未結束期分配和 |
| `fn_batch_allocation_check(confirmations[], stages[], unit, allocations[])` → `(batch_key, effective_qty, allocated_qty, available_qty)` | 不變量 2 逐批次檢核；`available_qty < 0` 即違反 | 所有期別的分配列 |
| `fn_allocate_fifo(confirmations[], stages[], unit, as_of, allocated[], wanted)` → `(batch_key, qty)` | 扣除既有分配後依最早確認 FIFO 分配；不足只回部分，呼叫端比對總和後拒絕 | `sync_`／`set_valuation_item_cum` |
| `fn_period_increment(cum, prev_cum, contract_qty)` | `Δ = cum − prev_cum`；`cum > Qc` raise；可為負（是否允許依 clawback 由呼叫端判斷） | 不變量 1／3 |
| `fn_valuation_amount(cum_qty, unit_price)` | `round(cum × price)` 到元（Q2 使用者同意暫行；單一修改點） | `valuation_items.amount_cum` |
| `fn_pricing_basis_effective(unit, quantity, basis)` | 明示 basis 原樣（不明值 raise）；缺 basis 時總價類（單位 ∈ {式,項,批,LS} 且量 ≤ 1）回 null＝待設定（→ `fn_cap` 0），其餘 `inspection` | `work_item_pricing_basis` 缺列時 |

`v_billable_backlog` 是表驅動 view，順延到 P4b 與表一起建（本單元沒有它要讀的表）。

## 4. 期別來源分配

- 截止日：`P.period_end`（台北日曆日）；送審前必填。分配只取 `confirmed_at::date（台北）≤ period_end` 的確認。
- 分配順序：同工項各批次依最早 active 確認的 `confirmed_at` 升冪（FIFO），每批次可分配量＝`E(W,b,period_end) − 該批次已被其他期別分配量`。
- RPC `sync_valuation_from_confirmations(p_valuation_id)`：只允許 `status='草稿'`；逐工項在 advisory lock 下重算分配到上限，upsert `valuation_items`（`cum_qty = prev_cum + Σ分配`，`backing='confirmed'`），回傳每工項 `{prev_cum, added, cap, sources[]}`；冪等（重跑結果相同）。
- RPC `set_valuation_item_cum(p_valuation_id, p_work_item_id, p_cum_qty)`：廠商可在 `[prev_cum, prev_cum + cap]` 內調整；RPC 重算分配（FIFO）而不是信任客戶端送來的分配或金額。低於 `prev_cum` 一律拒絕（減量走 §7）。
- 金額：`amount_cum = fn_valuation_amount(cum_qty, unit_price)`＝`round(cum_qty × unit_price)`（元，逐工項四捨五入到整數；Q2 使用者同意暫行）；`amount_period = amount_cum − prev_amount_cum`；由 DB 在 upsert 時計算，客戶端值忽略。

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

## 10. 總價／間接費等非實體工項【已確認 不可豁免；使用者 2026-09-17 決定 暫時隔離】

推定：`unit` 正規化後 ∈ {式, 項, 批, LS} 且 `quantity ≤ 1` 的末端工項＝總價類；`work_item_pricing_basis` 缺列時實體工項視為 `basis='inspection'`，總價類工項一律標「計價依據待設定」，`cap=0`、估驗頁明示（P4a `fn_pricing_basis_effective` 回 null、`fn_cap` 對 null／`excluded` 回 0，pgTAP 釘住）。

| basis | 行為 |
|---|---|
| `inspection` | 一般實體工項，依查驗確認量 |
| `supervisor_certificate` | 監造簽署「監造確認單」（`checklist_templates.kind='supervisor_certificate'`），確認本期累計完成比例或數量與契約依據條款；產生 `basis='supervisor_certificate'` 的確認紀錄 |
| `pro_rata` | 依規則（例如「直接工程費已核定金額 × 比例」）由 DB 在同步時計算本期量，仍需監造在該期核定時勾稽；`rule` 記公式與條款 |
| `excluded` | 不由本系統計價 |

Q3：使用者 2026-09-17 決定**總價／間接費暫時隔離不計價**（缺 basis 一律 `cap=0` 並在估驗頁標示）；這是暫時措施，利潤及管理費、營業稅、保險費、假設工程等各用哪一種 basis 仍待後續決定。

## 11. 精度與單位

- 數量 `numeric(18,4)`（`fn_cq_qty` 四捨五入到 4 位）；金額 `numeric(18,2)` 儲存但依 Q2 暫行（使用者同意）由 `fn_valuation_amount` 四捨五入到元；比較全部在 DB，前端不做浮點比較。
- 拒絕：負值、`NaN`、`≥1e12`、單位不一致（正規化比較）、缺 `batch_key`、缺 `work_item_id`、工項非末端／非計價、跨案。
- 前端顯示沿用 `format.js`；輸入框只送字串數字，由 RPC 轉型。

## 12. RPC／trigger／policy 與部署順序

| 單元 | 內容 |
|---|---|
| P4a（已實作 `20260917120000`） | §3.2 的 2 型別＋14 支純函式（`fn_effective_by_batch`、`fn_effective_confirmed`、`fn_contract_qty`、`fn_cap`、`fn_allocate_fifo`、`fn_batch_allocation_check`、`fn_period_increment`、`fn_valuation_amount`、`fn_pricing_basis_effective`、`fn_cq_*`）；pgTAP `confirmed_quantity_calc.sql` 82 條（含 §3.1 全部案例與 §11 拒絕矩陣）。`v_billable_backlog` 移到 P4b |
| P4b（已實作 `20260919040000`） | 四張新表＋加欄＋guards＋十支 RPC＋advisory lock＋可估驗清單 RPC（取代 view，理由見 §16.3）；全部以 §3.2 純函式為核心；pgTAP `confirmed_quantity_enforcement.sql`（§8 全部情境、狀態機、權限矩陣、service role 無 bypass）＋`confirmed_quantity_concurrency.sql`（`dblink` 兩個 session 真併發） |
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

## 15. 待決題的使用者答覆（2026-09-17，記入 D-026 第 7 點）

- **Q2 金額精度**：使用者同意照暫行做法：逐工項四捨五入到元後加總（`fn_valuation_amount` 單一修改點）。
- **Q3 總價／間接費 basis**：使用者決定**暫時隔離不計價**（§10）；各類工項的計價依據仍待後續決定。
- **Q6 多階段來源**：使用者同意照暫行做法：ITP H 點為必要階段；R／W 點不作必要。
- **Q7 截止日語意**：使用者同意照暫行做法：`period_end`＝計價截止日，由廠商建期時填、送審前必填。

## 16. P4b 實作結果與偏差（2026-09-19，migration `20260919040000_confirmed_quantity_enforcement`；回復檔同名 `.down.sql`）

以下是實作與 §1–§13 設計不同、或設計沒寫而實作必須決定的事；P4c／P4d 以本節與 migration 檔頭為準。

### 16.1 資料模型
- 四張新表：`inspection_confirmations`、`valuation_item_sources`（多一欄 `project_id` 給 RLS／索引；**沒有 `stage_key`**——分配是批次層級，批次量已是各階段取最小）、`valuation_adjustments`、`work_item_pricing_basis`；加欄 `valuations.recheck_required／recheck_note`、`valuation_items.backing`（`legacy`／`confirmed`／`adjusted`）、`inspection_points.stage_key／required_for_billing`。`authenticated` 對四張新表只有 SELECT（RLS 限成員）；寫入只走 RPC／簽署路徑／內部重算。
- `confirmed_at`／`created_at` 預設 `clock_timestamp()`（不是 `now()`）：累計語意靠先後順序，同一交易寫兩筆不可並列（P4a「同時刻取最小」只剩理論保護）。P3c 的簽署路徑寫 `confirmed_at = 簽署列 signed_at` 即可。
- `inspection_confirmations` 唯一鍵 `(inspection_id, work_item_id, coalesce(stage_key,''))`、`(project_id, client_request_id)`；`valuation_item_sources` 唯一 `(valuation_id, work_item_id, batch_key, kind)` 並以複合 FK 指向 `valuation_items(valuation_id, work_item_id)`（每筆來源必有明細；草稿明細刪除即釋放）。
- `valuation_adjustments.applied_valuation_id` 是 `on delete set null`：刪草稿期時，RI set-null 與來源列的 AFTER DELETE trigger 誰先都可，trigger 把 `applied` 調整改回 `pending`（check 只要求 `applied` 必有 `applied_at`）。RI set-null（查驗、文件版本、被取代列、來源確認、被更正期別、併入的草稿期被 cascade 刪）在三個 append-only guard 內明示放行，其餘欄位仍不可改。

### 16.2 檢查點與狀態機
- 檢查點在 **AFTER UPDATE** trigger `valuations_checkpoint_guard`（設計寫在 `valuations_guard`）：BEFORE 讀不到同一敘述送進來的新 `period_end`，AFTER 讀已更新的列；raise 即整個敘述回滾（同敘述的稽核列一起消失）。角色、狀態機、欄位規則仍在 BEFORE 的 `valuations_guard`（新增 BEFORE INSERT：登入者只能建 `草稿`——直接 INSERT `已核定` 曾是繞過送審／核定的洞）。
- 狀態機（登入者；`admin_override` 只放行角色）：`草稿→監造審核` 廠商、`監造審核→草稿` 監造、跨越 `已核定`／`已請款` 監造；其他轉移 `VQ002`。三個檢查點：進 `監造審核`（review）、進 `已核定`（approve）、進 `已請款` 或 `invoice_date` 由空變有（invoice）；service role、admin 都沒有數量 bypass。
- `period_end` 在 review／approve 必填，invoice 不要求（歷史已核定期 3／4 沒有截止日，機關登錄請款不能被卡死）；截止日不變量只在 `草稿`／`監造審核` 期別檢查（已核定期的補證確認單必然晚於歷史截止日）。登入者在非草稿期不可改 `period_no／period_start／period_end`（superuser 支援路徑可）。
- 工項狀態單一計算入口 `fn_cq_item_state_internal(project, work_item, valuation|null)`：`cap = fn_cap(max(0, E−B−O))`（B／O 是淨額，扣回為負，先相減再交給 P4a 的依據閘門）；另有 `headroom`＝本期還能再分配的確認量 `= 依據閘門(max(0, min(E−B−O−本期已分配, 契約量−前期累計−本期已分配)))`，自動同步與 `sync` 用它，`set_valuation_item_cum` 的上限＝`依據閘門(E−B−O−本期扣回／調整)`。
- 違反代碼（`VQ004` 的 `detail` 陣列，每筆帶 `work_item_id`）：`period_end_missing`、`recheck_required`、`pending_adjustment`（approve）、`over_contract`、`not_billable`、`basis_missing`、`basis_excluded`、`negative_delta`（Δ<0 且無扣回）、`source_mismatch`（Δ≠Σ來源）、`legacy_source`、`cutoff`（批次 ≤本期分配 > 截止日前有效量）、`batch_over_allocated`（附 `missing_stages`）。

### 16.3 RPC 與唯讀查詢（十支，全部 `grant execute to authenticated`，pgTAP 允許清單同步）
| RPC | 誰 | 行為 |
|---|---|---|
| `sync_valuation_from_confirmations(p_valuation_id)` | `can_write`（廠商；非正式模式 admin；監造依既有 can_write 語意亦可協助填報）；只有 `草稿` | 逐工項取鎖 → 刪本期 legacy 來源 → 收斂（監造審核期退回後在這裡縮減） → 最早草稿期併入 `pending` 扣回 → 分配到 `headroom`（FIFO） → 累計＝前期累計＋Σ本期來源；清 `recheck_required`；冪等 |
| `set_valuation_item_cum(p_valuation_id, p_work_item_id, p_cum_qty)` | 同上 | 目標累計必須在 `[前期累計＋本期扣回／調整, 上限]`；重算本期確認來源（FIFO），不信任客戶端分配與金額；`VQ006` 帶 `prev_cum／floor／limit／cap／wanted` |
| `transition_valuation(p_valuation_id, p_from, p_to, p_note)` | 成員；角色由 guard 判 | `p_from` 不符回 `{applied:false, status}`（冪等），檢查在 trigger |
| `issue_supervisor_certificate(p_project_id, p_work_item_id, p_batch_key, p_location_label, p_stage_key, p_unit, p_qty_cum, p_reason, p_client_request_id, p_covers_valuation_id)` | 監造或非正式模式 admin；**不要求 aal2**（R1 已移除兩步驟驗證，`aal` 只記入稽核） | 寫 `basis='supervisor_certificate'` 的累計確認（單位由呼叫端傳、guard 比對工項單位）；同 `client_request_id` 重播回原筆、內容不同 `VQ009`；`p_covers_valuation_id`＝補證歷史已核定期：該期該工項的 legacy 來源改掛到本確認單批次（數量不變、`backing='confirmed'`、稽核 `valuation.legacy_covered`），確認量不足以涵蓋整筆拒絕 |
| `revoke_inspection_confirmation(p_id, p_reason)` | 監造或非正式模式 admin | `active→revoked`；收斂由 trigger：草稿縮減（最晚分配先減）、監造審核標 `recheck_required`、已核定／已請款建 `pending` 調整；回傳 `effects` |
| `void_valuation_adjustment(p_id, p_reason)` | 機關或非正式模式 admin | `pending→void`。語意＝機關接受該量已計價：檢查點不再把它當超額（否則該工項永遠卡住），但**永不產生新的可用量**（FIFO 與列級 guard 仍用真實分配；已計價量仍計入 B） |
| `admin_adjust_valuation_item(p_valuation_id, p_work_item_id, p_cum_qty, p_reason)` | 平台管理員；只有 `草稿` | 產生 `applied` 調整＋`kind='adjustment'` 來源列（合併歸零即移除）、`backing='adjusted'`；已核定期不可（走撤銷→扣回） |
| `set_work_item_pricing_basis(p_work_item_id, p_basis, p_rule)` | 監造或非正式模式 admin | upsert 計價依據（總價／間接費解除隔離的唯一路徑） |
| `get_valuation_state(p_valuation_id)` | 成員 | `{valuation, checkpoint, violations, pending_adjustments, items[]}`；items＝本期明細 ∪ 有 active 確認的工項 ∪ 有 pending 調整的工項，每項含 `cq_item_state` 全部欄位＋`sources[]`＋`backing`＋`amount_cum` |
| `list_billable_backlog(p_project_id)` | 成員 | 取代設計的 `v_billable_backlog` view：security definer view 會繞過 RLS、security invoker view 又呼叫不了已收回 EXECUTE 的純函式，RPC 才能同時做成員檢查與呼叫純函式。每工項 `effective／billed／reserved／available／batches[]（含 missing_stages）／occupied_by[]` |

錯誤代碼 `VQ001`–`VQ010` 見 migration 檔頭（`VQ003` 保留不用）。訊息一律繁中、冒號後仍含中文，`friendlyError` 會原樣顯示。

### 16.4 舊資料過渡（正式庫 2026-09-19 唯讀盤點與處置）
- 盤點：`valuations` 12（草稿 7、監造審核 1、已核定 4；截止日 1／1／1；請款日 2）；`valuation_items` 26（已核定 5 筆 Δ>0、其中 1 筆掛非計價列、1 筆工項無單位；草稿 21 筆 11 筆 Δ>0）；超契約量 0、負值 0；`inspection_points` H 3（2 有工項，皆無 `stage_key`）；核准變更連工項 3；總價類末端工項 4,914。
- 處置：migration 內 `fn_cq_backfill_legacy_internal()` 為已核定期每筆 Δ≠0 明細寫 `kind='legacy'`／`batch_key='__legacy__'` 來源（歷史遷移，不是監造確認）；歷史金額不重算。之後：有 legacy 來源的期別送審／核定／新請款一律擋並列出；補證路徑＝監造確認單 `p_covers_valuation_id`。草稿期的既有數量保留（`backing='legacy'`），送審時 `source_mismatch` 擋下，廠商 `sync` 後以確認量為準（無確認即歸零）。監造審核那 1 期沒有明細，可直接核定或退回。
- 直接 REST 寫 `valuation_items`（舊前端、`fillValuationFromSiteLogs`）本支保留（P4e 收回），但寫入時：金額／百分比由 DB 算、超契約量與跨案拒絕、非草稿期凍結（含 service role；只有備註可由監造改）、非重算路徑寫入一律標 `backing='legacy'`。

### 16.5 其他 guard
- `work_items`：有 active 確認的工項不可刪除、不可改單位（`reset_project_boq`／標單重匯整包回滾；先撤銷）；專案刪除 cascade 放行。
- `inspection_points`：有 active 確認的工項不可變更必要階段集合（H 點、`required_for_billing`、`stage_key`）；先撤銷再調 ITP。
- `photo_frozen_reason` 未加「照片為已核定確認量之附件」：確認紀錄與照片的關聯要等 P3c 的簽署版本附件，P3c 一併補。

### 16.6 P3c 接口
簽署 `inspection_form` 時在同交易 INSERT `inspection_confirmations(project_id, work_item_id, batch_key, location_label, stage_key, unit, qty_cum, basis='inspection', inspection_id, document_id, document_version_no, content_hash, confirmed_by=簽署者, confirmed_at=signed_at)`；guard 會驗工項（末端、可計價、同案、單位）、階段（須在 ITP H 點集合內，單階段工項不可帶）、確認人（本案監造成員）、查驗（同案、已判定、工項一致）、文件（`inspection_form`、版本雜湊相等、該版本有確認人的簽署列）；`qty_delta`／`supersedes_id` 由 guard 導出，減量須填 `reason`。AFTER INSERT 自動收斂並同步到適用草稿期（截止日 ≥ 確認日的最早草稿）。部分通過（查驗 100、通過 60）的判定值如何對應 `inspections.status` 由 P3c 決定；guard 只要求「已判定」。
