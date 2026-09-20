# 監造確認量與估驗聯動（後端強制）

> 狀態：**ACTIVE（後端已實作：P4a 純計算層 `20260917120000`、P4b 表／guard／RPC／鎖 `20260919140000`；前端 P4c 估驗頁已接上（PR #144）；P4d 撤銷／減量／補證／調整 UI 已接上（PR #147，`20260919160000` 只改訊息格式）；P4e 封堵直接寫入已實作（PR #151，`20260920001500`））**｜2026-09-20｜依 [D-026](../DECISIONS.md)。§1–§13 是 P0 設計；實作與設計的偏差集中在 §16（後端）與 §17（前端），以這兩節為準（P4c／P4d／P4e 另見 §17–§19）；進度只看 [續接清單](../reviews/2026-09-17-product-slimming-worklog.md)。
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
| 直接 REST `valuation_items` INSERT／UPDATE／DELETE | **P4e 已實作（§19）**：`20260920001500` 收回 PUBLIC／anon／authenticated 的寫入 grant（42501）、刪寫入 policy 只留 SELECT，且 guard 對非重算路徑一律 `VQ010`（所有寫入者）；寫入只經 RPC |
| 直接 REST `valuations.status`／`period_end`／金流欄 | 保留可寫（相容），但 `valuations_guard` 擴充：送審必填 `period_end`；送審／核定／請款日三個轉移重算不變量；草稿→監造審核限廠商（admin_override 例外）、監造審核→草稿限監造 | **F2（§21）**：非登入者（服務憑證／DBA 直連）且無內部旗標時，INSERT 不得帶非草稿狀態，UPDATE 不得改 `status`／`invoice_date`／`paid_date`／`paid_amount`、非草稿期不得改期別欄位（`VQ010`）——狀態機不再只對登入者成立 |
| `inspection_confirmations`／`valuation_item_sources`／`valuation_adjustments` | authenticated 無寫入 grant；service role 也經 guard（不變量檢查**不看** `auth.uid() is null`） | **F2（§21）**：`inspection_confirmations` 的 INSERT 與 active→revoked 一進 guard 就要 `fn_cq_internal()`（不看內容是否合法）；只有 `issue_supervisor_certificate`／`revoke_inspection_confirmation`／查驗表單簽署分支在那一句寫入前後開旗標。`work_item_pricing_basis` 同：INSERT／UPDATE／DELETE 都要旗標，只有 `set_work_item_pricing_basis` 開 |
| RPC | 全部 security definer、`revoke from public, anon`；輸入驗證（UUID、非負、有限、單位） |
| Edge | 沒有 Edge 寫估驗表；**P4e 已加** `_shared/valuationWrites.scan.test.ts` 掃描 `supabase/functions` 全部原始碼：估驗六表（含 `valuations`、確認紀錄、計價依據）不得出現在寫入鏈、估驗寫入 RPC 與 `sign_field_document` 不得呼叫、不得原始 REST |
| `fillValuationFromSiteLogs` | 從 store 移除；估驗頁改為唯讀「日誌申報量 vs 確認量 vs 本期累計」差異比對（`valuationDiff.js` 延伸） |
| 標單匯入／重設 `reset_project_boq` | `work_items` FK on delete restrict：有 active 確認的工項不可重匯；先撤銷（留痕）再重匯 |
| 管理員例外 `admin_override`（非正式模式） | 只放行**角色**檢查（單人試用可兼簽），**不放行數量不變量** |
| service role | 無 bypass（P4e 起連草稿明細的直接寫入也 `VQ010`）；維護只能走 `admin_adjust_valuation_item(p_reason)`（平台管理員、必填原因、寫 audit、產生 `adjustment` 來源列） | **F2（§21）**：確認量、期別狀態／金流欄、計價依據也一律 `VQ010`；`fn_cq_set_internal` 雖可被 service_role 執行，旗標只活在該 PostgREST 交易，跨請求無效（chain 20 釘住） |
| 客戶端 `approved_qty`／`cum_qty`／金額 | RPC 只接受 `cum_qty` 目標值並重算；金額一律 DB 算 |
| 舊前端／舊 RPC | 部署順序 §12；封堵 migration 套用後舊前端的 upsert 會收到明確錯誤（42501，`friendlyError` 顯示「操作未完成…（代碼 42501）」，舊碼還原該格），不會靜默成功（§19.3） |
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
| P4b（已實作 `20260919140000`） | 四張新表＋加欄＋guards＋十支 RPC＋advisory lock＋可估驗清單 RPC（取代 view，理由見 §16.3）；全部以 §3.2 純函式為核心；pgTAP `confirmed_quantity_enforcement.sql`（§8 全部情境、狀態機、權限矩陣、service role 無 bypass）＋`confirmed_quantity_concurrency.sql`（`dblink` 兩個 session 真併發） |
| P4c | 前端：可估驗清單、來源展開、缺件、差異比對、移除 `fillValuationFromSiteLogs` |
| P4d（已實作，PR #147；migration `20260919160000` 只改 VQ005／VQ006 訊息數字格式） | 撤銷／減量／補證／作廢 UI（§18）、今日工作／早報的「待監造補證」「待機關處理扣回」（共用規則） |
| P4e（已實作，PR #151；`20260920001500`） | 封堵 migration（grant＋policy＋guard 三層）＋Edge 掃描測試＋舊客戶端相容驗證＋估驗鏈訊息數字（§19） |

部署順序：P4b（加法）→ 前端 P4c → **觀察一個完整期別** → P4e 封堵。P4b 之後、P4e 之前，舊前端的直接 upsert 仍可寫 `valuation_items`，但送審／核定已被 guard 擋下，不會產生未經確認的核定；這是刻意的相容窗。P4e（`20260920001500`）套用後相容窗關閉。

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

## 16. P4b 實作結果與偏差（2026-09-19，migration `20260919140000_confirmed_quantity_enforcement`；回復檔同名 `.down.sql`）

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
- 直接 REST 寫 `valuation_items`（舊前端、`fillValuationFromSiteLogs`）本支保留（P4e 收回），但寫入時：金額／百分比由 DB 算、超契約量與跨案拒絕、非草稿期凍結（含 service role；只有備註可由監造改）、非重算路徑寫入一律標 `backing='legacy'`。（P4e `20260920001500` 已收回，見 §19。）

### 16.5 其他 guard
- `work_items`：有 active 確認的工項不可刪除、不可改單位（`reset_project_boq`／標單重匯整包回滾；先撤銷）；專案刪除 cascade 放行。
- `inspection_points`：有 active 確認的工項不可變更必要階段集合（H 點、`required_for_billing`、`stage_key`）；先撤銷再調 ITP。
- `photo_frozen_reason` 未加「照片為已核定確認量之附件」：確認紀錄與照片的關聯要等 P3c 的簽署版本附件，P3c 一併補。

### 16.6 P3c 接口
簽署 `inspection_form` 時在同交易 INSERT `inspection_confirmations(project_id, work_item_id, batch_key, location_label, stage_key, unit, qty_cum, basis='inspection', inspection_id, document_id, document_version_no, content_hash, confirmed_by=簽署者, confirmed_at=signed_at)`；guard 會驗工項（末端、可計價、同案、單位）、階段（須在 ITP H 點集合內，單階段工項不可帶）、確認人（本案監造成員）、查驗（同案、已判定、工項一致）、文件（`inspection_form`、版本雜湊相等、該版本有確認人的簽署列）；`qty_delta`／`supersedes_id` 由 guard 導出，減量須填 `reason`。AFTER INSERT 自動收斂並同步到適用草稿期（截止日 ≥ 確認日的最早草稿）。部分通過（查驗 100、通過 60）的判定值如何對應 `inspections.status` 由 P3c 決定；guard 只要求「已判定」。

**P3c 落地結果（2026-09-19，migration `20260919222000_inspection_form_documents`；與本節的偏差）**：
- `inspections.status` 加 `'部分合格'`（check 釘住四值）：合格＝本次確認量等於申報量、部分合格＝0<確認<申報、不合格＝確認 0（不寫確認紀錄）；不合格／部分合格由 `inspections_defect_sync` 同交易開缺失（差額寫進說明）。
- 累計語意：簽署寫入的 `qty_cum`＝此工項此批次此階段「目前最新 active 累計」＋本次確認（`inspections.confirmed_qty` 記本次、確認紀錄記累計）；同一查驗同工項同階段同量重簽＝冪等不重複累加，不同量或改判不合格→`PD008` 要求先 `revoke_inspection_confirmation` 再重簽。
- **唯一索引改為只算 active**：`inspection_confirmations_inspection_stage_uidx` 加 `status='active'` 條件——原索引不論狀態，撤銷後同一查驗永遠寫不進新的確認（更正流程走不通）；已撤銷列仍保留 `inspection_id` 供追溯。
- `inspections_guard` 保護 P4b 的依據：有 active 確認的查驗不可撤銷判定回待查驗；已判定不可改工項／位置／階段／申報量；`confirmed_qty／results／document_id／document_version_no／template_id` 只由簽署路徑（GUC `pmis.field_document_sign`）寫入。
- `photo_frozen_reason` 的「照片為已核定確認量之附件」事由（§16.5）**未做**：確認紀錄已追溯文件版本（附件在版本內不可變），照片凍結另列待辦。

## 17. P4c 估驗頁落地結果與偏差（2026-09-19，PR #144；純前端、無 migration）

前端只顯示 DB 的結果、只經 §16.3 的 RPC 寫入；與 §9 表「`fillValuationFromSiteLogs` → `valuationDiff.js` 延伸」不同之處與設計沒寫而實作必須決定的事：

### 17.1 讀寫路徑
- 讀：`get_valuation_state(選中期別)`（逐工項 `cq_item_state`＋`sources[]`＋`backing`＋整期 `violations`）、`list_billable_backlog(專案)`（可估驗清單；未開期先累積）、`inspection_confirmations`（RLS 成員可讀；來源展開要的批次／位置／確認量／查驗與文件版本／確認人與時間）、`list_project_members`（確認人名字）。任何寫入成功後 store 整批重載期別（`loadValuationsFromDB`），畫面上的數量與金額永遠是 DB 的值，`valuations` 一變就重取上述唯讀狀態。
- 寫：建期＝`insert valuations`（`period_end` 必填，建期對話框預填台北今天）→ `sync_valuation_from_confirmations`（失敗即刪掉剛建的期，不留半套）；改累計量＝`set_valuation_item_cum`（`VQ006` 的 `detail` 翻成「前期累計・本期起算值・本期最多可新增・可用確認量・你填的」，輸入框回到 DB 的值）；送審／退回／核定＝`transition_valuation(p_from=目前狀態)`（`applied:false` 視為未變更並重載；`VQ004.detail` 逐項翻成人話列在錯誤橫幅下）；同步＝`sync_valuation_from_confirmations`（全頁只有動作列一顆「同步確認量」）；計價依據＝`set_work_item_pricing_basis`（監造在明細列的下拉，選項 `supervisor_certificate`／`inspection`／`excluded`；`pro_rata` 需規則，待 Q3 定案後開放）；草稿期改截止日＝REST `update valuations.period_end`（guard 已限草稿）。請款日仍走 `/payments` 的 REST（第三個檢查點由 trigger 擋，錯誤含代碼與訊息原樣顯示）。
- 移除：`fillValuationFromSiteLogs`、`valuationItemRow`、建期複製前期明細、`valuation_items` 的任何客戶端寫入；`billing.test.js` 釘住「slice 不暴露 fill、改數量／建期不碰 `valuation_items`」。P4e 收回直接寫入前，舊客戶端的 REST 寫入在頁面上呈現為「缺監造確認來源・申報,不計價」（真後端 chain 9）；P4e 後舊路徑一律 42501，正式庫遺留的 legacy 草稿明細仍如此呈現（§19）。

### 17.2 金額與期別投影（設計未寫）
- `buildCumMap(roots, childrenMap, period)` 改吃期別物件的 `amounts`（DB `valuation_items.amount_cum`，Q2 逐工項到元），前端不再用「金額 × 比例」或「單價 × 數量」換算；`Payments`／`Progress`／`Dashboard`／`MonthlyReport`／`SupervisorReport`／`ValuationPrint`／`ValuationPackage`／`RiskAudit`／`assistantData` 十個呼叫端一併改傳期別物件，全站金額口徑單一。demo 沒有 DB，種子與 demo 改數量用 `boqCalc.valuationItemAmount`（`fn_valuation_amount` 的鏡像；DB 模式不得使用）。
- 一期沒有列的工項，累計量／金額往前帶（`lib/valuationPeriods.js`，與 `fn_cq_prev_cum_internal`「period_no 更早、最近一期有列者」同定義）；每期另留 `own`（本期自己的列含 `backing`）。P4b 的 `fn_cq_recompute_item_internal` 對 Σ來源＝0 且無既有列的工項不插列，所以投影是必要的，不是相容層。
- 可請款投影：核定前的期別（草稿／監造審核），`get_valuation_state.items[].violations` 非空的工項本期增量屬「申報,未確認,不計價」——該工項回到前期累計（仍是 DB 的值），本期可請款金額、保留款、應付都不含它，Stat 副文字列「另 n 項申報未確認,不計價」；已核定／已請款是歷史帳，不動。

### 17.3 缺件與檢核單一口徑（取代 §9 表的「`valuationDiff.js` 延伸」）
- `lib/valuationChecks.js` 是唯一組裝：DB 檢查點違反代碼（§16.2 的十二種）→ `VIOLATION_TEXT` 對照表（短標、標題、人話、處理入口 `period_end`／`sync`／`basis`／`certificate`／`review`／`set`／`adjust`／`none`），同代碼一項缺件並列涉及工項；`integrityAudit.js` 六項勾稽發現照舊（每項附 `keys`，決策列「超前日誌申報／無日誌申報」計數與明細列的就地提示都用 `classifyLogDiff` 同一把尺；Edge `_shared/integrityAudit.ts` 鏡像同步）；逐工項標示 `itemFlags` 來自 `items[].violations`。`valuationDiff.js`（無日誌也算超計的第二套口徑）刪除。
- 缺件排在勾稽發現之前；demo／state 未載入時只有勾稽發現並明講「未經後端核對」，不假裝通過。缺件的處理入口在列上或動作列（同步、填截止日、設定計價依據），撤銷／補證／調整只指路，介面在 P4d。

### 17.4 未做與已知限制
- 監造確認單簽發、撤銷、補證（`p_covers_valuation_id`）、機關作廢調整的 UI 在 P4d（§18）；真後端 chain 7 仍以 RPC 簽發確認單、chain 11 走 UI。P3c 簽署 `inspection_form` 寫確認量未接（§16.6）。
- 手機（<md）維持唯讀期別摘要（§9.6），另列各期截止日與選中期別的未確認申報件數；寫入一律桌機。
- DB 的 `VQ006` 訊息把 numeric 印成 `60.0000`（P4b 的 `format('%s')`）：P4d 以 `20260919160000` 修掉 `set_valuation_item_cum` 的 VQ005／VQ006（§18.4）；逐工項違反 `message`（`fn_cq_item_state_internal`）等處由 P4e 改經 `fn_cq_txt`（§19.2）。

## 18. P4d 撤銷／減量／補證／調整落地結果與偏差（2026-09-19，PR #147；migration `20260919160000_vq_message_numeric_format` 只改訊息文字）

前端只傳意圖（哪一筆、原因、累計量），結果全部由 §16.3 的 RPC 決定；成功後 store 整批重載期別＋估驗調整。

### 18.1 三方的操作面
- **監造**（`my_org_type='supervisor'`，DB 強制；`can.approve` 只是 UX）：估驗頁明細列「來源」展開多一段「有效確認 n 筆」＝全案此工項的 active 確認（不限本期分配），逐筆「撤銷」（`revoke_inspection_confirmation`，原因必填，回傳 `effects` 翻成人話：草稿縮減／審核中標需重算／已核定量轉成待處理扣回）；監造確認單來源另有「減量」（同批次填較小累計，`issue_supervisor_certificate`，guard 導出負增量並要求原因）；查驗確認量的減量要重簽查驗表單（P3c），這裡只能撤銷。「簽發監造確認單」開就地表單（批次／位置、累計確認量、依據；`client_request_id` 每次開表單產生一次，重送回原筆）。已核定／已請款期有 legacy 來源時「補證此期」：同一張表帶 `p_covers_valuation_id`，介面明講「這會成為該期此工項已計價量的計價依據」與涵蓋範圍（期別、該期歷史遷移量、超出部分同步到適用草稿期、多階段工項不可補證），累計量預填遷移量、前端擋小於遷移量（DB 亦擋：批次有效量少於分配）。
- **機關**（`my_org_type='owner'`）：「估驗調整（扣回）」卡列全案 `valuation_adjustments`（pending 在前；applied 顯示扣回期別、void 顯示原因），pending 有「作廢（接受已計價）」（`void_valuation_adjustment`，原因必填；對話框明講不產生新可用量）。設計 §7 說的「接受」沒有另開 RPC：扣回由廠商在草稿期「同步確認量」時併入（`applied`），機關不作廢即等於接受扣回——卡上照實寫，不做假的「接受」按鈕。
- **廠商**：同一張卡與來源展開唯讀——看得到補證狀態（「待監造簽發監造確認單補證後才可登錄請款日」）、扣回影響與下一步由誰處理；缺件卡 `certificate`／`adjust`／`review` 三類指到上述入口（P4c 的「（P4d）」佔位文字移除）。

### 18.2 今日工作／Agent／早報（共用規則 `_shared/ballInCourtRules.ts`，fixture `tests/fixtures/ball-in-court.cases.json` 擴充）
- `valuationBall`：已核定且無請款日的期別，若 `legacy_uncovered>0`（尚未補證的歷史遷移工項數）→ `supervisor`「待監造補證」（否則維持「待廠商請款」）。計數只有一支 `legacyUncoveredByValuation(valuation_item_sources kind='legacy')`：前端 `loadValuationsFromDB` 與 Edge `collectOpenBallItems` 都用它。
- 新事項類型「估驗調整」（`valuationAdjustmentBall`）：`pending` → `owner`「待機關處理扣回」，標題「第 N 期估驗扣回調整」（N＝`origin_valuation_id` 的期別），前端導 `/valuation?period=<origin>`；applied／void 不列。`WAITING_SCOPE` 廠商／監造對「估驗調整」等機關。
- 資料：store 新增 `valuationAdjustments`（`loadValuationAdjustmentsFromDB`，RLS 成員可讀），期別物件新增 `legacy_uncovered`；Edge 收集器多兩個查詢（`valuation_adjustments` pending、`valuation_item_sources` legacy）。

### 18.3 與設計 §7 的差異
- 「減量」對查驗確認量不在估驗頁做（P3c 重簽查驗表單才是同交易的減量路徑）；估驗頁只對監造確認單提供減量。
- 撤銷後的照片凍結事由（§7 第 3 點）仍留 P3c（§16.5）。
- 已核定期的確認被撤銷後，該期在扣回 `pending` 期間登錄請款日會被 `batch_over_allocated` 擋下（chain 11a 驗證），作廢或於草稿期扣回後才可登錄；設計 §7 沒寫這一點，實作以 P4b 的檢查點為準。

### 18.4 VQ005／VQ006 訊息數字（P4b 已知限制）
`20260919160000` 新增純函式 `fn_cq_txt(numeric)=trim_scale(·)::text`（值不變、只去 `numeric(18,4)` 的尾零；不對 authenticated 開放），`create or replace` 重建 `set_valuation_item_cum`，五處訊息數字改經它（`60.0000`→`60`、`60.5000`→`60.5`）；回復檔 `supabase/rollbacks/20260919160000_vq_message_numeric_format.down.sql`。仍以 `%s` 印數量的其他訊息（`fn_cq_item_state_internal` 的逐工項違反 `message`，例如缺件卡括號裡的「數量 50.0000 來自歷史遷移」；確認紀錄 guard 的減量訊息；批次 guard）留 P4e 一併改經 `fn_cq_txt`——P4e 本來就要重建這些 guard（已完成，§19.2）。

### 18.5 驗證
pgTAP `confirmed_quantity_enforcement.sql` 294→299（`fn_cq_txt` 三值＋授權、`throws_like` VQ006 訊息不帶小數尾）；Vitest 新增 `CertificateForm.test.jsx`、`AdjustmentsCard.test.jsx`、`SourceRow.test.jsx` P4d 兩條、`billing.test.js` §6 四條、`db.test.js` legacy 計數；共用案例 fixture 新增 `v6`（待監造補證）、`adj1`（待機關處理扣回）、`adj2`（void 不列），前端／Edge／Deno 三路徑同讀。真後端 `e2e-real/chain11-adjustments.spec.js`：11a 核定→UI 撤銷→請款被擋→UI 作廢→請款日登錄；11b 歷史遷移期別（DBA 邊界 `docker exec psql` 停用檢查點 trigger 核定＋`fn_cq_backfill_legacy_internal`，與正式庫回填同一支）→監造首頁「待監造補證」→缺件卡→「補證此期」→缺件清空→請款日登錄。

## 19. P4e 封堵直接寫入落地結果（2026-09-20，PR #151；migration `20260920001500_valuation_items_seal`，回復檔 `supabase/rollbacks/` 同名 `.down.sql`）

### 19.1 三層封堵
- **表級 GRANT**：收回 PUBLIC／anon／authenticated 對 `valuation_items` 的 INSERT／UPDATE／DELETE（SELECT 不動）；PostgREST 直接回 `42501`。比照 P1b 成本表。
- **RLS**：刪 `valuation_items_write`（for all），只留 `valuation_items_select`；日後即使有人再下廣域 grant，RLS 仍不放行寫入。
- **guard（與設計 §9「revoke authenticated」的差異）**：`valuation_items_guard` 對非重算路徑（未設 `pmis.cq_internal`）的 INSERT／UPDATE／DELETE 一律 `VQ010`，**所有寫入者一體適用**——service role 保有平台預設表級 DML、繞過 RLS，只收 grant 擋不住它；DBA 直連也擋。與 P4b 對 `valuation_item_sources`／`valuation_adjustments` 的做法一致。cascade 照舊放行：期別已不在（草稿期刪除、專案刪除、標單重設）或工項已不在（單一工項刪除）；已送審／核定／請款期的明細不可被 cascade 刪（`P0001`，既有證據 guard 行為）。重算路徑本身在非草稿期只可改 `backing`（補證 legacy→confirmed），數量、金額、備註一律凍結。
- 隨之移除的相容分支：「非重算寫入標 `backing='legacy'`」（已沒有非重算寫入；`backing` 由重算路徑明示）、「已核定明細備註監造可改」（P4c 起前端沒有此入口；明細是投影，不保留任何直接改寫）。凍結訊息改「估驗目前為「狀態」」（舊寫法遇到已核定會印成「估驗已已核定」）。
- **盤點**：前端 `src/` 只有 `store/db.js` 讀明細（P4c 起無寫入，`billing.test.js` 釘住）；Edge 只讀（`ballInCourt`、`integrityAuditTool`、`agentQueryTools`），新增掃描測試釘住；RPC／trigger 的寫入全部經 `fn_cq_set_internal(true)`（`fn_cq_recompute_item_internal`、`fn_cq_allocate_internal`、`sync_valuation_from_confirmations`、`issue_supervisor_certificate` 補證、`admin_adjust_valuation_item`）；Demo 無 DB、`seed.sql` 不寫；pgTAP 與真後端需要「產品已不允許產生、但正式庫仍存在」的歷史明細時走 DBA 邊界（交易內開重算旗標並明示 `backing='legacy'`，真後端 `e2e-real/helpers.js` 的 `dbaSql`）。
- **`valuations` 的數量相關欄位（確認即可，未改）**：期別本身沒有數量欄；送審／核定／請款三個檢查點在 AFTER UPDATE trigger，對所有寫入者一體適用；service role 可建非草稿期別（`is_user` 才限草稿），但非草稿期不可追加明細、內部路徑也不會寫入，空期別不影響 B／O；service role 可改 `recheck_required`／`recheck_note`，但這兩欄是「送審中被減量」的提示旗標，同一超額必然同時觸發 `batch_over_allocated`／`cutoff`（兩者都在檢查點重算），不構成數量繞過。

### 19.2 訊息數字（P4d §18.4 的收尾）
`create or replace` 重建（簽章、ACL、H3 允許清單不變；本體除訊息參數外與 P4b 逐字相同）：`fn_cq_item_state_internal`（over_contract／source_mismatch／legacy_source／cutoff／batch_over_allocated）、`inspection_confirmations_guard`（減量）、`valuation_item_sources_guard`（批次、截止日）、`fn_cq_reconcile_internal`（`recheck_note` 超出量）、`admin_adjust_valuation_item`（超過契約量）、`valuation_items_guard`，數量一律經 `fn_cq_txt`。同一行另修：單階段工項的批次確認被撤銷後，`batch_over_allocated` 原本印「缺必要查驗階段 (單階段)」（缺階段清單的佔位字），改為只有多階段工項才說缺階段；`missing_stages` 欄位值不變。
**P3e 收尾**：P3c 的 `field_document_sign_inspection_form_internal`（6 處申報／確認量訊息）與 `inspections_defect_sync`（缺失說明「申報／確認／差額」）原本同樣以 `%s` 印 `numeric(18,4)`；P4e 交給並行改簽署路徑的 P3e，由 migration `20260920004000_intake_shared_inputs` 第 6 節 `create or replace` 改經 `fn_cq_txt`（本體除訊息參數外與 P3c 逐字相同；pgTAP `inspection_form_documents.sql` 以確切訊息與 `throws_like` 斷言無 `.0000`）。

### 19.3 相容與部署
- 舊版前端（P4c 前、仍開著的分頁；HTML `must-revalidate`、無 service worker，重新整理即換新版）：`upsert`／`insert` 明細收到 42501，`friendlyError` 顯示「操作未完成…（代碼 42501）」，舊碼在失敗時還原該格、建期複製前期明細失敗會刪掉剛建的期別並回報，不白畫面、不靜默成功。真後端 chain 9 斷言 upsert／update／delete 皆 42501。
- 正式庫既有資料不動：26 列明細（已核定 5、草稿 21）照舊可讀；草稿期 legacy 明細仍由檢查點擋，廠商「同步確認量」即以確認量為準；4 個歷史遷移期別的補證路徑不變（§18.1）。
- 回復檔已在本機一次性棧實跑：套 `.down.sql` → P4b 版 `valuation_items_guard.sql` 11 條與 `confirmed_quantity_enforcement.sql` 299 條全綠 → 重套 migration → 新版全綠。

### 19.4 驗證
pgTAP `valuation_items_guard.sql` 11→50（三角色＋專案管理者＋非成員直接 INSERT／UPDATE／DELETE 皆 42501、service role 與 DBA 皆 `VQ010`、權限與 policy 結構、RPC 路徑照常且金額由 DB 算、重算路徑凍結、cascade、訊息無小數尾）；`confirmed_quantity_enforcement.sql` 299→307（舊前端路徑改斷言 42501、歷史資料走 DBA 邊界、五種違反與減量／批次／recheck／維護調整訊息無小數尾）；`boq_reset_import`／`photos_storage` fixture 改走 DBA 邊界。Vitest `_shared/valuationWrites.scan.test.ts` 4 條（合成片段證明會抓、不誤判；真實原始碼無估驗寫入且確實讀到估驗表）。真後端 chain 2／7／9／11。

## 20. P6a 估驗佐證包改讀確認量來源與簽署版本（2026-09-20，PR #153；純前端、無 migration）

`/valuation/package` 的本期證據不再是「同工項所有照片／日誌」，改為本期期別的確認量來源與它們指向的簽署文件版本；挑選與組裝在 `lib/valuationPackage.js`（純函式），數量、金額、缺件全是 DB 的值。

- **本期來源**：`get_valuation_state.items[].sources`（`valuation_item_sources`）→ 確認紀錄（`inspection_confirmations`，前端讀取加帶 `content_hash`）→ 確認紀錄記的 `document_id`／`document_version_no`／`content_hash`（簽署當下的查驗表單版本，append-only）。每筆列批次／階段／累計、依據、查驗與判定、簽署者與時間；legacy 來源標「歷史遷移，非監造確認，需補證」、扣回與管理員調整照實列；逐工項 `violations` 翻成「缺件：…」（`describeViolation`，與估驗頁同一張對照表）。明細表「依據」欄＝監造確認量或缺件短標（取代原「佐證照片張數」）。
- **照片**：只取來源查驗表單版本的附件中 `role` 為證據（預設 evidence）者；他方照片只能以 reference 附上，不列為佐證。版本雜湊涵蓋附件，所以照片跟著版本凍結。原「點 ✕ 排除誤配照片」移除（照片已不是 AI 自動歸位，而是監造簽署的證據）；`listPhotosByWorkItems` 退場。
- **檢附自主檢查**：來源版本內容的 `self_check_record_id`（已簽署的 `checklist_records` 修訂列不可改）→ 列檢查日、Rev、判定；若該列就是某份自主檢查表文件目前綁定的列，另附該文件的簽署版本標示。
- **施工日誌**：本期範圍＝前期計價截止日（不含；有本期起日則用起日含）至本期計價截止日（含），第 1 期自開工起；缺本期或前期截止日時回缺件、不退回列全部日誌。版本取**送審時點**（最近一次 `valuation.submitted` 稽核事件的 `occurred_at`）以前的最後一次簽署——已送審／核定的包保留當時使用的版本，之後的簽後更正只標「之後另有 vN，不影響本包」；草稿期取目前已簽署版本；已送審卻查無稽核事件（稽核上線前的歷史期）如實揭露。內容讀該版本（`contentToLogShape`＋版本 `field_sources`，數量標不適用者不算，與簽署分支寫 `daily_log_items` 同規則），只列含本期工項數量者；範圍內送審時尚未簽署（或至今未簽署）的日期與施工月報同一支 `unsignedDays` 列出、不列入。
- **凍結依據**：非草稿期的來源分配由 DB 凍結（§16.1／§19），確認紀錄與文件版本不可變，日誌以送審時點釘住——前端不另存「包的快照」，每次開頁都能從 DB 重建同一份內容。
- 任何一步讀取失敗就整包標「本期證據讀取失敗，不產生佐證內容」，不以半份資料冒充；示範模式沒有確認紀錄與簽署，明示未經後端核對。
- 已知限制：列印頁只印文件目前的簽署版本，來源版本已被更正或文件已被取代時只給版本標示不給連結（見續接清單 §7「P6a 發現」）。


## 21. F2 服務憑證寫入封堵落地結果（2026-09-21，PR #<F2>；migration `20260920230000_edge_credential_writer_seal`，回復檔 `supabase/rollbacks/` 同名 `.down.sql`）

### 21.1 查出的缺口（本機隔離棧 `set local role service_role`、`auth.uid()` 為 null 實測，`388daa4` 起的 main 仍成立）
- `inspection_confirmations_guard` INSERT 只驗內容不驗來源：內容合法的列（`confirmed_by` 填任一位監造成員）被接受，`qty_delta=60`；active→revoked 只驗原因。
- `valuations_guard` 的角色與狀態機全掛 `is_user`：非登入者可 INSERT `已核定`、UPDATE 成 `已請款`；檢查點只在 AFTER UPDATE 驗數量，空期別或廠商備妥的期別都可被服務憑證代替監造核定。§19「service role 可建…」那一句對此沒有防線。
- `work_item_pricing_basis_guard` 只驗工項屬本案：服務憑證可直接標 `excluded`／改 `pro_rata`。

### 21.2 做法（與 P4e §19 同一原則：所有寫入者一體適用，只認交易內 `pmis.cq_internal`）
- 確認量 guard：INSERT 第一行、active→revoked 第一行都 `if not fn_cq_internal() then VQ010`；RI set-null 放行、DELETE 只放行 cascade、內容檢查逐字不變。
- 三個合法寫入者只在那一句 insert／update 前後 `fn_cq_set_internal(true)`／`fn_cq_restore_internal`（`issue_supervisor_certificate`、`revoke_inspection_confirmation`、`field_document_sign_inspection_form_internal`；其餘本體逐字沿用前一版）。異常時 GUC 隨子交易回滾。
- `valuations_guard`：非登入者且無旗標 → INSERT 非草稿 `VQ010`；UPDATE `status`／`invoice_date`／`paid_date`／`paid_amount`、非草稿期的 `period_no`／`period_start`／`period_end` `VQ010`。登入者規則、內部重算路徑不變。
- `work_item_pricing_basis_guard`：INSERT／UPDATE／DELETE 都要旗標（DELETE 只放行工項／專案 cascade），trigger 加 `or delete`；`set_work_item_pricing_basis` 在 upsert 前後開關旗標。
- 服務憑證拿不到旗標：`fn_cq_set_internal` 可被 service_role 執行，但 PostgREST 一個 request 一個交易，`set_config(…, true)` 只活在該交易。

### 21.3 相容與 fixture
前端只經 RPC 寫這些表、Edge 本來就不寫（`valuationWrites.scan`＋F2 `edgeWriteAllowlist.scan` 釘住），行為不變；不動任何一列。歷史遷移與 pgTAP fixture 以 DBA 邊界（交易內 `set local pmis.cq_internal='1'`）重現：`confirmed_quantity_enforcement`／`confirmed_quantity_concurrency` 的直寫確認 fixture、七個直接建非草稿期別的 fixture、e2e-real chain 11b 的 DBA 區塊；`payment_flow` 的「service role 放行清理矛盾資料」改為旗標內才放行。

### 21.4 驗證
pgTAP `edge_credential_writes.sql` 50 條（service_role／superuser 直寫矩陣、十四支 RPC、旗標還原與不放寬內容檢查、登入者狀態機照常）；真後端 chain 20 以真 PostgREST 與 Edge 同一把 service role key 打同一條通道（十三種直寫、十四支 RPC、旗標跨請求、狀態一列未變、同一 payload 由監造經 RPC 寫得進）；chain 4 第二段驗有效確認量擋重匯。
