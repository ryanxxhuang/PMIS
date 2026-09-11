> 狀態：**EVIDENCE**（稽核代理原始報告，2026-09-06 唯讀讀碼）。不得作為開發依據。
> 燈號與數字以主報告 [`../全案健檢-2026-09-06.md`](../全案健檢-2026-09-06.md) 的「校正」節為準；本檔保留當日原始判斷，不回頭改寫。

# 全案健檢 · 維度 B：資料模型、migration 與查詢健康

> 稽核日期：2026-09-06｜唯讀稽核，未修改任何檔案、未連線正式庫
> 依據：`CLAUDE.md` §4、`CURRENT.md` §4／§7、`DEVELOPMENT.md` §5、`docs/architecture/*`
> 範圍：`supabase/migrations`（57 支）、`supabase/functions`、`src/store`、`src/lib`

---

## 總評

**🔴 紅燈 3 項｜🟡 黃燈 11 項｜🟢 綠燈 8 項（共 22 項）**

脊椎的 FK／唯一性、RLS helper 的索引支撐、`store/db.js` 的分頁紀律與時區分層都是同級專案少見的紮實水準；真正的風險集中在三處：**(1) 業務狀態機在 DB 端完全沒有 check constraint**、**(2) 大文件抽取的 `document_pages` 查詢會在 1000 頁靜默截斷**、**(3) 專案刪除不清 Storage，讓「終止時刪除個資」變成不實陳述**。

次要但會累積的債：雙引擎同步清單漏登 4 對（其中 D-020 已造成前後端實際規則不一致）、`schema.sql` 之外多份文件的數字與敘述已落後現況、rollback 慣例只覆蓋 4/57 支 migration。

---

## B-01｜Migration 數量與 schema.sql 現況｜P3｜🟢

**證據**
- `supabase/migrations/` 實際 57 支（`20260711000000_baseline.sql` … `20260901040000_materialize_all_requirement_types.sql`）。
- `supabase/schema.sql:1-7` 檔頭自我標記：「FROZEN 2026-07-11 — 歷史參考,非真相來源」「雙軌維護(schema.sql+migrations)是 2026-07-11 P0 事故的結構性成因之一」。檔案 mtime 停在 2026-07-12，內容＝baseline＋前兩支 RBAC。

**影響**：`schema.sql` 雖然落後 40 餘支 migration，但**檔頭已明確自我作廢**，不構成誤導。任何工具或人只要打開檔案就看得到警語。

**建議**：維持現狀即可；若要更保險，可在 CI 加一條「schema.sql 不得被修改」的檢查。若哪天決定重生 schema.sql，必須同時刪掉這段警語，否則變成雙重誤導。

**工作量**：S（或 0）

---

## B-02｜CURRENT.md 的資料庫數字已過期｜P2｜🟡

**證據**
- `CURRENT.md:105`「36 個 migrations」→ 實際 57 支。
- `CURRENT.md:103`「50 張 migration 建立的資料表」→ 之後至少新增 `demo_requests`（`20260824123253`）等表，未更新。
- `CURRENT.md:106`「23 組 pgTAP SQL 測試」→ `supabase/tests/` 實際 33 支。
- `CURRENT.md:102`「9 個 Store slices」→ `src/store/slices/` 實際 9 支非測試檔（此項正確）。

**影響**：`CURRENT.md` 是文件權威順序中的「現況權威」（`CURRENT.md:169-188`）。數字失準會讓下一輪續接的協作者低估變更面，也讓「pgTAP 全套進 CI」的覆蓋率宣稱失去校驗基準。

**建議**：在 §6 的數字後面加註「最後核對日期」，或改為由 CI 產生。至少把 migrations／pgTAP／資料表三個數字更新到 2026-09-06 現況。

**工作量**：S

---

## B-03｜同一物件被反覆 create or replace，歷史難追｜P2｜🟡

**證據**（`supabase/migrations/` 全域統計）

被重寫 ≥3 次的 function：

| 物件 | 次數 |
|---|---|
| `public.add_member_by_email(` | 4 |
| `public.submittals_guard(` | 3 |
| `public.safety_records_guard(` | 3 |
| `public.rfis_guard(` | 3 |
| `public.review_requirement(` | 3 |
| `public.defects_guard(` | 3 |
| `public.change_orders_guard(` | 3 |
| `public.apply_transcription_triage(` | 3 |

被重寫 3 次的 policy：`requirements_select`、`requirement_sources_select`、`requirement_work_items_select`、`requirement_artifact_links_select`、`contract_obligations_update`。

trigger 只有 `defects_guard` 被建立 2 次，其餘皆 1 次（🟢）。

**影響**：`review_requirement` 與 `change_orders_guard` 是紅線層物件（核定授權、變更核准），現行定義散在三支 migration，要回答「現在到底誰能核准變更」必須把 `20260711000000_baseline.sql:1145`、`20260712001300_formal_mode.sql:160`、`20260819111252_change_order_approval_owner_only.sql:18-30` 三段疊起來讀。稽核與交接成本高，也容易在下一次改寫時漏掉前一版的某個分支。

**建議**：不回頭改已套用 migration（符合 `DEVELOPMENT.md` §5）。改為建立 `docs/architecture/db-objects.md`（或在既有 `supabase/SETUP.md` 加一節）維護「物件 → 現行定義所在 migration」的索引表，每次改寫時同步一行。成本極低，收益是稽核時一眼定位。

**工作量**：S

---

## B-04｜rollback 慣例只覆蓋 4/57，且無規則說明｜P2｜🟡

**證據**
- `supabase/rollbacks/` 只有 4 支：`20260712001400_unified_defect_engine.down.sql`、`20260712001700_checklist_revisions.down.sql`、`20260812000500_requirement_obligation_one_way.down.sql`、`20260901040000_materialize_all_requirement_types.down.sql`。
- `DEVELOPMENT.md` §5 要求「清楚處理資料保留、相容與回復」，但沒有定義何時必須附 down 檔。
- 實際觀察到的隱含規則：**改動資料方向／破壞性資料轉換**的 migration 才寫 down（統一缺失引擎、requirement→obligation 單向化、D-020 全類型物化都是資料語意變更）。純加欄位／加 policy 的沒寫。

**影響**：規則存在但沒寫下來 → 下一支破壞性 migration 很可能漏寫 rollback。`20260821001000_identity_repair_unclassified.sql`（重掛 membership 的 party）與 `20260822000100_ingestion_run_active_unique.sql`（把所有 in-flight run 改成 failed）都是不可逆資料變更，**都沒有 down 檔**。

**建議**：在 `DEVELOPMENT.md` §5 補一條判準——「migration 內含 `update`／`delete` 既有資料列，或變更既有欄位語意者，必附 `supabase/rollbacks/<同名>.down.sql`；純新增結構免附」。

**工作量**：S

---

## B-05｜一次性資料修正混在結構 migration 流｜P2｜🟡

**證據**

獨立的 repair migration（檔名可辨識，🟢 的部分）：
- `supabase/migrations/20260821001000_identity_repair_unclassified.sql` — W12 修復掛在 `other` party 上的 membership；同一支裡**同時**改寫 `ensure_project_identity_for` 函式（結構）與一次性重掛（資料）。
- `supabase/migrations/20260822010200_repair_w14_run_counts.sql:1-25` — 純資料修正，按實際列數重算 `document_ingestion_runs` 計數器，冪等。

**藏在結構 migration 裡的一次性資料修正**（檔名看不出來，🟡）：
- `20260712000300_p0_01_requirement_domain.sql:493-497` — `update public.contract_obligations o set requirement_id = o.id …`
- `20260812000100_three_party_agent_roles.sql:22-24` — `update public.agent_actions set agent_role='contractor' where agent_role in ('field','qc')`
- `20260822000100_ingestion_run_active_unique.sql:11-17` — 建唯一索引前把所有 `pending/processing` 的 run 全部改成 `failed`
- `20260901040000_materialize_all_requirement_types.sql:33`、`:265` — 補物化既有 approved requirement

**影響**：這些都寫了充分的「為什麼」註解（品質高於一般專案），但檔名不揭露它們會動既有資料。做 staging→production 差異評估時，看檔名清單無法判斷哪幾支會改資料列，只能逐支開檔。

**建議**：往後採「結構歸結構、修資料歸修資料」的兩支拆法，或至少沿用 `repair_` 前綴命名（`20260822010200` 已示範）。既有的不追改。

**工作量**：S（僅慣例）

---

## B-06｜脊椎一：`work_item_id` 的 FK／NOT NULL 一致性｜P3｜🟢

**證據**（`supabase/migrations/20260711000000_baseline.sql`，除註明外）

| 表 | 行 | NOT NULL | on delete |
|---|---|---|---|
| `valuation_items` | 223 | ✅ | cascade |
| `daily_log_items` | 316 | ✅ | cascade |
| `item_schedules` | 608 | ✅ | cascade（另 `unique(work_item_id)`，610-613） |
| `requirement_work_items` | `20260712000300:341` | ✅ | cascade（PK = requirement_id + work_item_id） |
| `photos` | 355 | ✗ | set null |
| `inspections` | 403 | ✗ | set null |
| `defects` | 419 | ✗ | set null |
| `change_order_items` | 557 | ✗ | set null |
| `checklist_records` | 680 | ✗ | set null |
| `observations` | 762 | ✗ | set null |
| `submittals` | 796 | ✗ | set null |
| `inspection_points` | 856 | ✗ | set null |

**判讀：這個分佈是正確的，不是不一致。** 分界線清楚且有註解佐證：
- **「沒有工項就沒有意義」的明細列 → NOT NULL + cascade**（估驗明細、日誌明細、逐工項排程、需求↔工項橋接）。
- **「工項只是選填標籤」的業務列 → nullable + set null**，且金額欄位去正規化保留（`baseline:536-540` 註解明說「Line amounts are stored denormalised … so a CO survives a BOQ re-import even though work_item_id is set null on delete」）。

標單重匯（`reset_project_boq`／`import_work_items`，`20260812000200`）因此不會刪掉查驗、缺失、送審、變更的歷史，只會斷開工項連結——這正是 W1 的設計意圖。

**建議**：無。維持。

---

## B-07｜`cost_items` 沒有 `work_item_id`，與 CURRENT.md §4.1 圖不符｜P3｜🟡

**證據**
- `CURRENT.md:63-64` 的脊椎圖把 `cost_items` 畫在 `work_items` 底下：`→ cost_items / item_schedules / change_orders`。
- 實際 `supabase/migrations/20260711000000_baseline.sql:514-526` 的 `cost_items` 只有 `project_id`，**沒有任何 `work_item_id` 欄位**（全庫 `work_item_id` grep 也證實 cost_items 不在名單內）。它是「category／title／vendor／budget_amount／actual_amount」的成本分類帳，掛在專案層。

**影響**：文件承諾「所有數量、金額與進度都應沿 `work_item_id` 串接」（`CURRENT.md:69`），但成本這一支根本沒串。目前沒有壞掉的功能（`/cost` 是專案層毛利表），但只要有人依這張圖去做「逐工項成本 vs 估驗收入」的功能，就會發現資料模型不支援。

**建議**：二選一——(a) 改圖，把 `cost_items` 移到 `projects` 層並註明「成本目前不逐工項歸集」；(b) 若逐工項成本是路線圖上的事，先在 ROADMAP 立案，不要靠圖暗示已經有。建議 (a)，成本 S。

**工作量**：S

---

## B-08｜脊椎二：requirements → sources → obligations 的 FK 與 1:1 唯一性｜P3｜🟢

**證據**
- `requirements.project_id` NOT NULL cascade（`20260712000300:175`）；`status` 有 check（`:194-195`）；`is_authoritative` 是 generated column（`:205-206`），權威性無法被前端偽造。
- `requirement_sources.requirement_id` NOT NULL **cascade**（`20260712000300:272`）；`document_version_id` **刻意不寫 on delete**（`:273`）→ 預設 NO ACTION／RESTRICT，`20260822000300_document_delete.sql:7-9` 明文依賴這個 RESTRICT 當佐證鏈護欄：「核定過的契約重點永遠拉得回它的出處文件」。
- **1:1 requirement ↔ obligation 有硬約束**：`create unique index contract_obligations_requirement_uidx on contract_obligations(requirement_id)`（`20260712000300:498-499`）＋ `alter column requirement_id set not null`（`:500`）＋ FK cascade（`:503-511`）。`materialize_requirement_obligation` 的 `on conflict (requirement_id) do update`（`20260901040000:134`）正是靠它保證冪等。
- `requirement_work_items` PK = (requirement_id, work_item_id)（`20260712000300:346`），另有 `work_item_id` 反向索引（`:348`）。
- `requirement_artifact_links` 有 `unique (requirement_id, artifact_type, artifact_id)`（`20260712000700:349`）。

**判讀**：D-012 的「單向、一對一」在資料庫層是**真的被約束住的**，不是靠應用層自律。這是本次稽核中最扎實的一段。

**建議**：無。

---

## B-09｜`requirement_artifact_links.artifact_id` 是無 FK 的多型指標｜P3｜🟡

**證據**：`20260712000700_p0_07_requirement_review.sql:340-346`
```
artifact_type   text not null check (artifact_type in
  ('inspection_point','checklist','test','submittal','evidence','deadline')),
artifact_id     uuid not null,
```
`artifact_id` 沒有 FK（多型設計必然如此）。因此刪掉一個 `inspection_points` 或 `submittals` 列時，指向它的連結列會留下成為懸空指標。

**影響**：低。目前這張表只在 `/requirements-review` 詳情面板讀（`RequirementsReview.jsx:292`），懸空列頂多顯示一個點不到的連結。但它是「佐證鏈」的一環，長期會侵蝕可稽核性。

**建議**：不加 FK（多型本來就不能加）。改為在被指向的表上加 BEFORE DELETE trigger 清理對應連結列，或加一支定期對帳查詢。優先度低，等有實際懸空案例再做。

**工作量**：M

---

## B-10｜大表複合索引與 RLS 述詞索引｜P2｜🟡

**RLS 述詞側：🟢**
- 所有 policy 走 `project_id in (select public.my_project_ids())` 或 `can_write(project_id)`；`my_project_ids()`（`baseline:27-30`）掃 `project_members(user_id)`，有 `project_members_user_idx`（`baseline:1201`），PK 是 `(project_id, user_id)`（`baseline:126`）。
- 所有 helper 都是 `security definer stable`（`baseline:16-64`、`20260712001300:30-48`），同句查詢內可快取，不會每列重算。
- `20260822010100_profiles_select_scope.sql:19-27` 的 `shares_project_with()` 同樣走 `project_members`，有索引。

**逐表複合索引盤點**

| 表 | 現有索引 | 判定 |
|---|---|---|
| `audit_events` | `(project_id, occurred_at desc)`、`(project_id, entity_type, entity_id, occurred_at)`、`(project_id, actor_user_id, occurred_at)`、`(project_id, event_type, occurred_at)`、`(correlation_id) where not null`（`20260712000500:35-44`） | 🟢 全部四種篩選路徑都覆蓋，且與 `Activity.jsx:39-52` 的實際查詢完全對應 |
| `ai_usage_events` | `(occurred_at desc)`、`(feature_key, occurred_at desc)`、`(project_id, occurred_at desc)`、`(user_id, occurred_at desc)`（`20260728000100:153-156`） | 🟢 |
| `agent_actions` | `(project_id, created_at desc)`、`(actor_user, status)`（`20260725000000:37-38`） | 🟢 |
| `requirements` | `(project_id)`、`(project_id, requirement_type)`、`(project_id) where is_authoritative`、`(ingestion_run_id)`、`(contract_package_id)`、`(legacy_contract_obligation_id) where not null` | 🟢 |
| `work_items` | `(project_id)`、`(parent_id)` | 🟡 缺 `(project_id, item_key)`，見 B-11 |
| `daily_logs` | `(project_id)` ＋ `unique(project_id, log_date)`（`baseline:303`） | 🟢 唯一約束本身即複合索引 |
| `photos` | `(project_id)`、`(daily_log_id)`、`(work_item_id)`、`(storage_path)` | 🟡 缺 `(project_id, taken_at)` |
| `document_pages` | `(document_version_id)`（`20260712000300:135`） | 🟡 缺 `page_number` 第二欄 |
| `daily_log_items` | `(daily_log_id)` ＋ `unique(daily_log_id, work_item_id)` | 🔴→🟡 **缺獨立 `work_item_id` 索引** |
| `valuation_items` | `(valuation_id)` ＋ `unique(valuation_id, work_item_id)` | 🟡 同上 |

**具體缺口與對應查詢**

1. **`daily_log_items(work_item_id)`**：`supabase/functions/_shared/agentTools.ts:586-590` 的佐證包工具用 `.eq('work_item_id', wi)` 直接篩明細表，**沒有任何可用索引**（唯一索引前導欄是 `daily_log_id`，用不上）。同樣模式在 `agentTools.ts:1009-1014`。大案（數萬列明細）每次呼叫都是全表掃。
2. **`valuation_items(work_item_id)`**：`agentTools.ts:1040-1045` 的勾稽對帳同樣模式。
3. **`photos(project_id, taken_at)`**：`agentTools.ts:829-833`、`:1373-1378` 用 `project_id` + `taken_at` 區間查當日照片；目前只能靠 `photos_project_idx` 撈完整案照片再過濾。
4. **`document_pages(document_version_id, page_number)`**：`extract-requirements/index.ts:236-240`、`classify-document/index.ts:61-66` 都是 `.eq(version).order('page_number')`，目前要額外排序。

**建議**：一支 migration 補四個索引，全部 `create index if not exists`，無資料風險：
```sql
create index if not exists daily_log_items_wi_idx  on public.daily_log_items(work_item_id);
create index if not exists valuation_items_wi_idx  on public.valuation_items(work_item_id);
create index if not exists photos_project_taken_idx on public.photos(project_id, taken_at desc);
create index if not exists document_pages_version_page_idx
  on public.document_pages(document_version_id, page_number);
```

**工作量**：S

---

## B-11｜`(project_id, item_key)` 唯一索引仍未做｜P2｜🟡

**證據**
- `docs/ROADMAP.md:237`：「`(project_id, item_key)` 部分唯一索引（待正式資料盤點：`select project_id, item_key, count(*) from work_items where item_key is not null group by 1,2 having count(*) > 1;` 回空＝可加索引）」——仍在**未排入清單**。
- `work_items.item_key` 目前只是 `text`（`baseline:167`），無唯一性。
- 前端大量依賴 `item_key` 當工項的穩定識別：`src/store/db.js:28-29`（載入後建 `wiMaps.byKey`）、`store.jsx:212-220` 的每個 loader 都吃 `wiMaps.idToKey`、`src/store/slices/site.js:167` 的 `listPhotosByWorkItems(workItemKeys)` 用 key 反查 id。

**影響**：`wiMaps.byKey` 是一個 `Map`，重複 `item_key` 會**靜默覆蓋**——最後一列贏。PCCES 匯入若因分項重複產生同 key，估驗／日誌的工項對應會指到錯的列，而且完全沒有錯誤訊號。這是典型的「數字錯了但畫面正常」，正是 `src/lib/pagedQuery.js:1-6` 註解裡點名的政府客戶致命類型。

**建議**：照 ROADMAP 已寫好的判準做——先在正式庫跑那一句盤點查詢；回空就補 `create unique index concurrently work_items_project_item_key_uidx on public.work_items(project_id, item_key) where item_key is not null;`；不回空就先做去重決策。這件事已經拖了一輪，且盤點查詢是唯讀的，成本極低。

**工作量**：S（盤點）＋ S（索引）

---

## B-12｜`extract-requirements` 的 `document_pages` 查詢會在 1000 頁靜默截斷｜P1｜🔴

**證據**
- `supabase/config.toml:7,18`：`[api]` → `max_rows = 1000`。
- `supabase/functions/extract-requirements/index.ts:235-241`：
```ts
const { data: pages, error: pagesError } = await userClient
  .from('document_pages')
  .select('page_number, extracted_text, extraction_method')
  .eq('document_version_id', documentVersionId)
  .order('page_number')
```
**沒有 `.range()`、沒有 `.limit()`、沒有走 `pagedQuery`**（`pagedQuery.js` 是前端模組，Edge 端沒有等價工具）。
- 回傳值直接當成完整文件用：`const pageRows = (pages ?? []) as PageRow[]`（`:242`），後續 `pageRows.length` 被當成 `total_page_count` 回報給前端（`:677`），並拿來切批次。
- 落庫端沒有這個限制：`src/lib/documentIngestion.js:28-31` 與 `src/lib/packageUpload.js:216-219` 都以 `PAGE_INSERT_BATCH` 分批 insert，**寫得進去 1000 頁以上**。

**影響**：這是**寫得進、讀不全**的不對稱。上傳一份 1200 頁的契約＋規範合訂本，`document_pages` 會有 1200 列，但抽取只會看到前 1000 頁，而且：
- 沒有錯誤、沒有警告；
- `total_page_count` 回報 1000，前端「解析到第幾頁」的揭露也跟著錯；
- 使用者拿到「AI 已讀完契約」的畫面（`obligationTimeline.js:29-31` 的頁首文案就是這麼寫的），但最後 200 頁（通常是附錄、罰則表、保固條款）從未被讀過。

這直接踩到北極星文件的信任紅線：對機關客戶宣稱「AI 已讀完契約」而實際漏讀，比功能沒做更糟。W13 的整套續跑架構（`20260822000100` 唯一索引、跨 request 批次、`last_progress_at`）就是為大文件設計的，卻在**入口第一步**被 1000 列上限卡住。

**建議**：在 `extract-requirements/index.ts:235` 加分頁迴圈（Edge 端自寫，或把 `pagedQuery` 的邏輯複製一份到 `_shared/`，比照 `contractDue.ts` 的雙份模式）。同時加一道健全性檢查：把 `pageRows.length` 與 `document_versions` 上的 `page_count`（若有）或 `count: 'exact'` 對照，不一致就 fail 而不是靜默續跑。
另外 `classify-document/index.ts:61-66` 已正確用 `.limit(SAMPLE_PAGES)`（只取樣），不受影響。

**工作量**：S（分頁）＋ S（健全性檢查）

---

## B-13｜其他未分頁的「載入全部」查詢｜P2｜🟡

**已完全合規的部分（🟢，先講好消息）**
`src/store/db.js` 全部 20 個 loader 一律走 `pageAll`／`pageAllIn`＋唯一鍵收尾排序（`db.js:28-244`），這是模範實作。`src/pages/web/Activity.jsx:49-52` 用 `.range()` 真分頁＋`count:'exact'`。`Requirements.jsx:126-148`、`RequirementsReview.jsx:240-269` 用 `pageAllInSafe`。`site.js:167-176` 的照片佐證包分頁＋分批簽名 URL。

**仍未分頁、可能超過 1000 列的查詢**

| # | 位置 | 查詢 | 風險評估 |
|---|---|---|---|
| 1 | `supabase/functions/extract-requirements/index.ts:236-240` | `document_pages` 全載 | 🔴 見 B-12 |
| 2 | `supabase/functions/send-reminders/index.ts:54-55` | `projects` **全表**（service role，跨租戶）無 limit | 🟡 現在專案數遠低於 1000；但這是唯一「租戶數成長就默默漏發提醒」的地方，且沒有任何警示 |
| 3 | `_shared/agentTools.ts:586-590` | `daily_log_items` by `work_item_id` | 🟡 單一工項的日誌明細通常 < 1000；長工期主要工項有可能逼近 |
| 4 | `_shared/agentTools.ts:612-617` | `photos` by `work_item_id` + 日期區間 | 🟡 同上 |
| 5 | `_shared/agentTools.ts:503` | `defects` 全部未結案 | 🟢 業務上不可能破千 |
| 6 | `_shared/agentTools.ts:506` | `valuations` 全部 | 🟢 期數有限 |
| 7 | `_shared/agentTools.ts:829-833` | `photos` 當日 | 🟢 |
| 8 | `src/store/slices/site.js:88-89` | `photos` by `daily_log_id` | 🟢 單日照片 |
| 9 | `src/pages/web/Contract.jsx:160-162` | `document_versions .in('document_id', docIds)`，**未分批**（`IN_CHUNK` 未套用） | 🟡 契約包文件數多時 URL 可能超長回 414；非截斷但同源問題 |
| 10 | `src/pages/web/RequirementsReview.jsx:228-229` | `requirements .limit(LIST_LIMIT)` | 🟢 明示有界，且 UI 有揭露 |

**建議**：優先修 #1（B-12）。#2 加 `.range()` 迴圈或至少加一條 `count` 對照的告警日誌。#3/#4 因 B-10 的索引缺口與此重疊，補索引時一併加分頁。#9 套用 `chunked()`（`pagedQuery.js:56-60` 已提供）。

**工作量**：#1 S、#2 S、#3/#4 M、#9 S

---

## B-14｜雙引擎同步：4 對未登記，其中 1 對已實際漂移｜P1｜🔴

`docs/architecture/dual-engine-sync.md` 登記了 9 對，狀態標記誠實（✅ 有共用純函式／測試 3 對；「無自動保證，人工同步」4 對；pgTAP 覆蓋 2 對）。以下是**清單上沒有、但程式裡確實存在**的同步點。

### B-14a｜D-020 之後：requirement→obligation 的欄位映射前後端規則不一致 🔴

**證據**
- DB 側：`supabase/migrations/20260901040000_materialize_all_requirement_types.sql:41-140` 的 `materialize_requirement_obligation`。migration 檔頭 `:12-13` 明說「唯一差異是拿掉 `requirement_type='deadline'` 過濾——任何已核定 requirement 都物化」。
- 前端側：`src/lib/requirements.js:30-43` 的 `deadlineRuleFromRequirement`，**第一行就是** `if (requirement?.requirement_type !== 'deadline') return null`。

**兩側規則逐項比對**

| 欄位 | DB（`20260901040000`） | 前端（`requirements.js`） |
|---|---|---|
| 類型閘門 | 無（D-020 起全類型物化） | `!== 'deadline'` → null ⚠️ |
| `offset_days` | 正規表示式 `^-?[0-9]+$` 驗證，不合則 null（`:66-70`） | `trigger.offset_days ?? null` 原值放行（`:36`） |
| `recurring` | 白名單 `daily/weekly/monthly/quarterly/yearly`（`:71-75`） | `requirement.frequency_type` 原值放行（`:39`） |
| `recurring_day` | 驗證 1..31（`:76-82`） | `frequency.day ?? null` 原值（`:40`） |
| `recurring_weekday` | 驗證 1..7（`:83-89`） | 原值（`:41`） |
| `recurring_month` | quarterly 1..3／yearly 1..12（`:90-99`） | 原值（`:42`） |

**影響**：DB 明顯較嚴。前端可以算出並顯示一個到期日，而 DB 物化時把同一個規則丟成 null——畫面說「10 月 15 日到期」，義務列上卻沒有期限。反向也成立：D-020 後 DB 會為 `submittal`／`inspection` 等類型建義務，前端 `computeRequirementDue` 對這些類型一律回 null。

**緩解因素（所以不是 P0）**：`computeRequirementDue`／`deadlineRuleFromRequirement` 目前**只被自己的測試檔引用**（`src/lib/requirements.test.js`，全 repo 無其他 caller）。實際畫面走的是 `obligationTimeline.js:210` → `deriveStatus` → `contractDue.js`，讀的是**已物化**的 `contract_obligations` 列，所以線上不會漂。

**但**：`src/lib/requirements.test.js:118-119` 主動釘住了 `deadlineRuleFromRequirement({requirement_type:'inspection'})` 必須回 `null`，也就是**測試正在保護一條已被 D-020 推翻的規則**。下一個人照這支函式做「核定前預覽到期日」的功能，就會做出跟 DB 不同的答案，而測試還是綠的。

**建議**：三選一——(a) 刪掉 `deadlineRuleFromRequirement`／`computeRequirementDue` 與對應測試（目前是死碼，最乾淨）；(b) 對齊 D-020：拿掉類型閘門並補上 DB 端的六道值域驗證，然後把這一對登記進 `dual-engine-sync.md`；(c) 保留但在函式上加註「D-020 後與 DB 不同，勿用於預覽」。建議 (a)。

**工作量**：(a) S｜(b) M

### B-14b｜`obligation_party` fallback 🟡

**證據**：`20260825120000_obligation_ownership_completed_at.sql:37-42` 的註解已經自己說了：
> ⚠️ 與前端 `obligationParty`(src/lib/obligationTimeline.js) 是同一條 fallback，兩邊必須同步改，否則「畫面說可操作、伺服器說不行」。

規則：`responsible` 不在 `('廠商','監造','機關')` 內 → 一律落回 `'廠商'`。前端對應在 `src/lib/obligationTimeline.js`（`obligationParty`，`buildTimelineItem` 於 `:209` 呼叫）。

**影響**：註解已到位，但**沒有登記進 `dual-engine-sync.md`**，也沒有共用測試案例。改任一側時只有讀到那支 migration 的人才會知道。

**建議**：登記為第 10 對，並比照第 4 項（contractDue）做共用測試案例。

### B-14c｜`canActOn` vs `contract_obligations_update` policy 🟡

**證據**：前端 `src/lib/obligationTimeline.js:206`
```js
export const canActOn = (item, viewerParty) => item.who === viewerParty
```
DB `20260825120000:44-56` 的 policy：`obligation_party(responsible) = my_party()` **or** `admin_override(project_id)`。

前端註解（`:202-205`）明說「呼叫端要放行 override 時自行 OR 上 `can.override`」——也就是這一對**故意不完全對齊**，由呼叫端補。

**建議**：登記為第 11 對，標記「刻意不對稱，override 由呼叫端補」。

### B-14d｜`VISIBLE` 三方可見範圍是展示 shim，RLS 未跟上 🟡

**證據**：`src/lib/obligationTimeline.js:5-8, 25` 自我揭露：
> ⚠️ VISIBLE 是前端的展示過濾(shim)…在那之前 `contract_obligations` 的 RLS 仍是全案成員可讀，這份過濾只是版面歸屬，**不是安全邊界，不可反過來依賴它保密**。

DB 端證實：`contract_obligations_select` policy 是 `project_id in (select my_project_ids())`（`baseline:496-498`），全案成員可讀，`20260825120000` 只改了 update 沒改 select。

**影響**：目前無外洩（義務內容本來就是三方共同的契約條款），但畫面呈現「廠商只看得到自己的」，會養出「這裡有分級保密」的錯誤心智模型。若日後有人往義務的 `note` 塞內部資訊，就會外洩。

**建議**：登記進清單並標記為「已知 shim，安全邊界在後端待補」；或在 `note` 欄位上加 comment 警告不得存放單方內部資訊。

**B-14 整體工作量**：S（登記 3 對）＋ S/M（B-14a 處置）

---

## B-15｜業務狀態機在 DB 端完全沒有 check constraint｜P1｜🔴

**證據**

`grep -c "check (status in" supabase/migrations/20260711000000_baseline.sql` → **0**。

baseline 裡所有中文業務狀態欄位都只有 `default` ＋**註解**，沒有值域約束：

| 表 | 行 | 宣告 |
|---|---|---|
| `valuations` | `baseline:214` | `status text not null default '草稿',   -- 草稿 \| 送審 \| 監造審核 \| 已核定 \| 已請款` |
| `daily_logs` | `:300` | `default '草稿'`（連註解都沒有） |
| `inspections` | `:409` | `-- 待查驗 \| 合格 \| 不合格` |
| `defects` | `:424` | `-- 開立 \| 改善中 \| 待複查 \| 已結案` |
| `contract_obligations` | `:488` | `-- 待辦 \| 已提送 \| 已完成 \| 不適用` |
| `change_orders` | `:547` | `-- 提出 \| 審核中 \| 核准 \| 駁回` |
| `safety_records` | `:642` | `-- 待改善 \| 改善中 \| 已完成` |
| `test_samples` | `:699` | `-- 待試驗\|合格\|不合格` |
| `observations` | `:760` | `-- 待處理\|已處理\|轉缺失` |
| `submittals` | `:790` | `-- 已提送\|審核中\|核准\|核備\|退回補正\|駁回` |
| `rfis` | `:807` | `-- 待回覆\|已回覆\|已結案` |

**唯一的例外是統一缺失引擎**：`20260712001400_unified_defect_engine.sql:74` 在 **trigger 裡**做值域檢查
```sql
and new.status not in ('開立','改善中','待複查','已結案') then
```
——這是唯一一個會擋下無效狀態值的地方，而且是 trigger 不是 constraint。

**對照組（🟢）**：平台層的表全部有 check constraint，且與前端常數完全一致——
- `requirements.status`（`20260712000300:194-195`）↔ `src/lib/requirements.js:16-22` `REQUIREMENT_STATUSES`：**五個值逐字一致** ✅
- `agent_actions.status`（`20260725000000:31-32`）、`agent_role`（`20260812000100:27-29`）↔ `src/lib/agentRole.js:3` `AGENT_ROLES`：**三方一致** ✅
- `document_ingestion_runs.status`（`20260712000600:26`）、`document_processing_runs.status`（`20260712000800:453`）↔ `src/lib/packageUpload.js:83` 的 terminal 判定：一致 ✅
- `ai_usage_events.status`（`20260728000100:150`）、`contract_packages.status`（`20260712000800:58`）✅

**影響**：領域層 11 張表的狀態欄位是**開放文字**。一次前端 typo、一次 Edge Function 寫錯、一次 SQL Editor 手動改，就會產生一列狀態值不在任何人預期內的資料。後果不是報錯，而是：
- 該列從所有 `filter(s => s.status === '…')` 中消失（`Submittals.jsx:123`、`Quality.jsx:189`、`ballInCourt.js:18-36` 全是精確比對）；
- 球權推導回 null，永遠不進任何人的今日待辦；
- guard trigger 只管「轉移」不管「值域」，所以擋不住。

一筆估驗卡在幽靈狀態、不出現在任何人清單裡，對機關客戶是很難解釋的事故。

**已存在的具體漂移**：`'送審'`
- DB 端接受並處理：`20260712000500_p0_05_audit_events.sql:158,160`
  ```sql
  if old.status = '草稿' and new.status in ('送審','監造審核') then
  elsif old.status in ('送審','監造審核','已核定') and new.status = '草稿' then
  ```
  `baseline:214` 的註解也列了它。
- 前端**從不產生**：`Valuation.jsx:17` 的 `statusColor` 只有 `{草稿, 監造審核, 已核定}`；`:506` 送審按鈕寫的是 `onStatus('監造審核')`；`ballInCourt.js:18-19` 只認 `草稿`／`監造審核`。全 repo 的 `'送審'` 字串都是「送審單」這個業務名詞（`requirementReview.js:19`、`ballInCourt.js:86`），與估驗狀態無關。
- **結論**：`'送審'` 是估驗狀態機裡的死值域。它不會造成 bug，但會讓任何讀 DB 註解或 audit trigger 的人以為估驗有五個狀態。

**另一項**：`safety_records.status`（`baseline:642`，`待改善/改善中/已完成`）在 `20260712001400` 統一缺失引擎把資料搬進 `defects` 之後仍然保留整個欄位與舊值域（migration `:38-41` 有轉換映射）。`send-reminders/index.ts:95-96` 的註解確認「舊版另查 `safety_records` 的路徑在統一缺失引擎後已是死碼」。所以這是**第二套已退役但仍可寫入的狀態機**。

**pgTAP 第三處**：`supabase/tests/` 33 支測試都在驗**轉移權限**（誰能從 A 改到 B），沒有任何一支斷言「值域內只有這幾個值」。所以三處中有兩處（DB constraint、pgTAP）根本沒有值域這個概念，第三處（前端）是散落的字串字面量。

**建議**（分三步，每步獨立可交付）
1. **先量測**：對正式庫跑唯讀盤點——`select 'valuations' t, status, count(*) from valuations group by 1,2 union all …`，確認現存資料是否已有非預期值。**這一步必須先做**，否則直接加 constraint 會讓 migration 失敗或鎖住既有列。
2. **加 check constraint**：盤點乾淨後，一支 migration 為 11 張表補 `check (status in (…))`，用 `not valid` ＋ `validate constraint` 兩段式避免長鎖。同時把 `'送審'` 的處置定案（保留相容或從 audit trigger 移除）。
3. **前端收斂**：把散落的狀態字面量抽成 `src/lib/domainStatus.js` 常數（比照已做對的 `src/lib/requirements.js`），加一支測試斷言常數與 DB 值域一致，並在 pgTAP 補值域測試。

**工作量**：步驟1 S｜步驟2 M｜步驟3 M

---

## B-16｜狀態值域第三處：API 詞彙與 DB 詞彙不同｜P3｜🟡

**證據**：`extract-requirements/index.ts:673` 回傳 `status: 'in_progress'`，但 `document_ingestion_runs.status` 的 check（`20260712000600:26`）只有 `pending/processing/completed/failed`——DB 列在暫停時仍是 `processing`，`awaiting_continue` 存在 `metadata` 裡（`:655-657`、`:665-667`）。

**影響**：低，設計上是刻意的（HTTP 回應狀態 ≠ 資料列狀態）。但前端如果拿 API 回的 `status` 去跟 DB 列的 `status` 比對就會錯。

**建議**：把 API 回應欄位改名為 `run_state` 或 `phase`，或在 `index.ts:673` 加一行註解說明它不是 DB 值域。

**工作量**：S

---

## B-17｜Store slices 的表歸屬與重複真相｜P2｜🟡

**檔案規模**（`src/store/slices/*.js`，不含測試）

| 檔案 | 行數 | 管的表 |
|---|---|---|
| `quality.js` | 420 | `inspections`, `defects`, `checklist_templates`, `checklist_records`, `test_samples`, `inspection_points` |
| `collab.js` | 375 | `submittals`, `rfis`, `observations`, `requirements`(讀), `requirement_work_items`(讀) |
| `site.js` | 370 | `daily_logs`, `daily_log_items`, `photos`, `safety_records` |
| `ledger.js` | 332 | `cost_items`, `item_schedules`, `change_orders`, `change_order_items`, `contract_obligations`, `acceptance_events` |
| `projects.js` | 318 | `projects`, `project_members`, `project_memberships`, `work_items`(count), `ai_features`, `project_ai_overrides` |
| `billing.js` | 229 | `valuations`, `valuation_items`, `schedule_periods` |
| `agent.js` | 229 | `agent_actions` |
| `admin.js` | 167 | `ai_features`, `project_ai_overrides` |
| `auth.js` | 141 | `profiles` |

**（a）`ai_features` / `project_ai_overrides` 被兩個 slice 各自載入 🟡**
- `projects.js:149-150`：`select('key, enabled, min_plan')` ＋ overrides，供 `aiEnabled()` 前端閘門。
- `admin.js:120,133`：`select('*')` ＋ overrides，供 `/admin` 後台。

兩份快取、兩個生命週期。後台切換開關後，`projects.js` 那份不會自動失效，同一個 session 裡「後台顯示已關」而「業務頁按鈕還在」是可重現的。**紅線四的伺服器端閘門（`_shared/aiGate.ts`）仍會擋下**，所以不是安全問題，是使用者困惑問題。

**（b）`defects` 被兩個 effect 各自載入，覆蓋順序無保證 🟡**

`src/store.jsx` 有兩個並行的載入 effect：
- effect A（`:202-234`，依賴 `dbMode`）：`loadQualityFromDB(pid, wiMaps.byId)`（`:215`），而 `db.js:161-169` 的 `loadQualityFromDB` **內部會呼叫 `loadDefectsFromDB`**，帶工項去正規化欄位。
- effect B（`:236-265`，依賴 `isPersistedProject`）：`dbMode ? null : loadDefectsFromDB(pid)`（`:250`），不帶工項資訊。

effect B 的依賴陣列是 `[isPersistedProject, currentProject?.project_id, domainReloadKey]`——**不含 `dbMode`**。所以 `dbMode` 在標單載完後 flip 時，B 不會重跑，但 B 這一輪捕捉到的 `dbMode` 是舊值 `false`，因此**兩個 effect 會同時在飛**，各自對同一個 `setDefects` 收斂。誰後回誰贏，網路抖動下 A 的（帶工項資訊的）結果可能被 B 的（沒工項資訊的）覆蓋。

程式碼註解（`:243`）寫的是「dbMode 載入會再帶工項資訊覆蓋」——**這個假設依賴 A 一定比 B 晚回，沒有任何機制保證**。症狀是缺失列的工項欄位偶爾空白，重整就好，很難被當成 bug 回報。

同一個檔案的 `dual-engine-sync.md`「W-03」段落（該文件末段）已經很仔細地論證過三個 effect 的順序設計，但這一條漏了。

**（c）`persistedWrites` 沒有重試／衝突處理層 🟡**

**沒有 `persistedWrites.js` 模組**——只有 `src/store/slices/persistedWrites.test.js`（237 行），它是一支**迴歸測試**，用來釘住「不依賴標單的領域寫入必須用 `isPersistedProject` 而非 `dbMode`」（檔頭 `:1-4` 說明：走錯分支會讓寫入只進記憶體、重整就消失＝假成功）。

實際的寫入健全性機制只有一個：`mutationOutcome`（定義在 `src/store/slices/billing.js:19`，跨 slice 使用，例：`quality.js:150`、`ledger.js:258`）——把「RLS 靜默擋下、回 0 列」轉成明確錯誤，避免偽裝成功。這是好設計。

**但完全沒有**：
- 重試（網路瞬斷＝直接失敗，由使用者手動再按一次）；
- 樂觀鎖／版本欄位（沒有任何表有 `version` 或 update 時比對 `updated_at`）；
- 衝突偵測（兩人同時改同一筆缺失，後寫的無聲覆蓋前寫的）。

**影響評估**：多數表的併發衝突風險低（單方操作為主）。**但 `daily_logs` 例外**——`unique(project_id, log_date)`（`baseline:303`）＋ `site.js:40` 用 `upsert`，兩個廠商人員同日填報會互相覆蓋整份日誌，且沒有任何提示。W8-6 的 dirty 防護只擋「本機未存檔被清空」，擋不了「別人剛存過」。

**建議**
- (a)：讓 `/admin` 的開關寫入後呼叫 `projects.js` 的 reload，或把 `ai_features` 提到單一 slice 由兩邊共用。S。
- (b)：把 effect B 的 `defects` 分支條件改為以 ref 記錄「A 是否已接手」，或直接讓 `defects` 只由 A 負責、B 在 `!dbMode` 時才註冊。S。
- (c)：先不做通用重試框架（過度設計）。針對 `daily_logs` 這一個高衝突點，在 upsert 前比對 `updated_at`／`created_at`，不一致就提示「這份日誌已被他人更新」。M。

**工作量**：S ＋ S ＋ M

---

## B-18｜專案刪除不清 Storage，孤兒檔案永久殘留｜P1｜🔴

**證據**
- `delete_project` 全文（`supabase/migrations/20260711000000_baseline.sql:1006-1012`）：
```sql
create or replace function public.delete_project(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_project_admin(p_id) then raise exception '只有專案建立者/管理者可以刪除專案'; end if;
  delete from public.projects where id = p_id;
end; $$;
```
**只刪 DB 列，不碰 Storage。**
- 前端 `src/store/slices/projects.js:285-286`：`await supabase.rpc('delete_project', { p_id: id })`，之後只清本機 state 與 localStorage，**沒有任何 `supabase.storage.remove()`**。
- 全庫 grep `storage.objects` 在 migrations 中沒有任何 `delete from` — 也不應該有（SQL 刪 `storage.objects` 列只會留下孤兒實體檔案）。

**對照組：文件刪除做對了 🟢**
`20260822000300_document_delete.sql:14-16` 的設計註解：
> Storage：RPC 回傳該文件所有版本的 storage 路徑，前端用新開的 DELETE policy 移除原始檔…storage 物件刪除必須走 Storage API，SQL 刪 storage.objects 列會留孤兒檔案。

`delete_document` 回傳 `text[]`（`:57`、`:75-78` 收集 `storage_path`），`src/pages/web/Contract.jsx:464` 接住路徑後呼叫 Storage API 移除。**同一個問題，文件刪除解了，專案刪除沒解。**

**影響**：刪掉一個專案後，`photos` bucket（施工照片，含 GPS `gps_lat/gps_lng`、`taken_at`、AI 判讀的 `location`）與 `contract-documents` bucket（契約原文）的檔案**全部留在 Storage，永久，無人可見也無人可刪**（因為 DB 裡指向它們的 `photos.storage_path`／`document_versions.storage_path` 列已隨 cascade 消失，路徑資訊完全遺失）。

這直接牴觸兩份合規基線：
- 委外附約「委託關係終止時個資之刪除」——`20260811000200_project_deletion_records.sql:14-15` 的檔頭自己就把這一條列為設計理由；
- 個資最小化。施工照片會拍到人（工人臉、車牌），且帶 GPS。

而且 `project_deletion_records` 那張表的存在讓情況更尷尬：我們**留了一筆「已於某時刪除某專案」的可稽核紀錄**，但實際上檔案沒刪。這是「書面政策與實際不符」的教科書案例——正是那份 migration 檔頭第 12 行想避免的：「那會讓『保存六個月』的書面政策變成一句不實陳述——這是機關稽核最不能出現的東西。」

**建議**：完全比照已驗證的 `delete_document` 模式：
1. `delete_project` 改為 `returns text[]`，在 `delete from projects` **之前**收集
   `select array_agg(storage_path) from photos where project_id = p_id`
   ＋ `document_versions` 經 `documents.project_id` join 的路徑
   ＋ `submittals.attachment_path`（`collab.js:157` 顯示送審附件也在 `photos` bucket）
   ＋ `defects.markup_path`、`observations.markup_path`。
2. 前端 `projects.js:286` 接住回傳陣列，用 `chunked()`（`pagedQuery.js:56-60`）分批 `supabase.storage.from(bucket).remove(paths)`。
3. 因為前端可能在中途失敗，把路徑清單一併寫進 `project_deletion_records`（新增 `pending_storage_paths text[]` 欄位），讓平台管理員可以事後對帳補刪。**這一步是關鍵**——沒有它，前端關掉瀏覽器就再也找不回路徑。
4. pgTAP 補一條：`delete_project` 回傳的路徑數 = 刪除前該專案的檔案列數。

**注意**：`project_deletion_records` 有 append-only trigger（`20260811000200:47-53`），新增欄位要在 insert 時一次寫入，不能事後 update。

**工作量**：M

---

## B-19｜`docs/architecture/project-delete-contract-first-hotfix.md` 描述的實作不存在｜P2｜🟡

**證據**
- 該文件狀態標記為 **CURRENT NOTE**（「記錄目前仍有效的窄邊界」），內文寫：
  > `delete_project` authorizes `can_manage_project_identity`, locks the exact project, and sets a transaction-local `pmis.project_delete_id`. Protected DELETE triggers skip their normal row-level guard only when that exact project ID matches.
- 全 `supabase/` 目錄 grep `pmis.project_delete_id` 與 `can_manage_project_identity` → **零命中**。
- 實際的 `delete_project`（`baseline:1006-1012`）用的是 `is_project_admin(p_id)`，沒有 session 變數、沒有 transaction-local 旗標。
- 保護型 trigger 實際採用的是「父列已不存在就放行」模式，例：`20260822000300_document_delete.sql:29-33`
  ```sql
  not exists (select 1 from public.projects pr where pr.id = old.project_id)
  ```

**影響**：功能上沒壞（parent-row-gone 模式運作正常，多支 pgTAP 的 `lives_ok(delete_project(...))` 都通過）。但這是一份**標記為現行有效、內容卻描述從未存在過的機制**的架構文件。按 `CURRENT.md:169-188` 的權威順序，「已定案產品／架構決策」要看 `docs/DECISIONS.md` 與**對應 ACTIVE 架構文件**——這份就是其中之一。有人依它去改 trigger，會找不到那個 session 變數而做出錯誤推論。

**建議**：改寫該文件的第三段，改述實際採用的 parent-row-gone 模式並引用 `20260822000300:26-33` 的註解；或把該段標為「原規劃，未實作」。前兩段（`isPersistedProject` vs `dbMode` 的邊界）是準確的，保留。

**工作量**：S

---

## B-20｜個資最小化：`profiles` 欄位與可見範圍｜P3｜🟢

**證據**
- `profiles` 欄位（`baseline:70-77`）：`id`(→auth.users, cascade)、`full_name`、`company`、`org_type`(有 check)、`role`、`created_at`；後由 `20260728000000_platform_admin.sql:10` 加 `is_platform_admin`。**沒有電話、地址、身分證號、生日**——email 留在 `auth.users`，不複製到 public schema。個資最小化做得乾淨。
- 可見範圍已收斂：`20260822010100_profiles_select_scope.sql:33-41` 把 baseline 的 `using (true)`（全平台可枚舉所有人）改為「自己 ∪ 共案成員 ∪ 平台管理員」，並在 `:52-54` 用**欄級 grant** 把 `is_platform_admin` 挖掉：
```sql
revoke select on public.profiles from public, anon, authenticated;
grant select (id, full_name, company, org_type, role, created_at) on public.profiles to authenticated;
```
理由寫得很清楚（`:44-46`）：管理員名單本身就是釣魚攻擊面。
- 有 pgTAP 覆蓋：`supabase/tests/profiles_select_scope.sql`、`profiles_org_type_guard.sql`。
- `auth.users` 刪除 → `profiles` cascade（`baseline:71`），使用者帳號刪除時 profile 跟著走。

**建議**：無。這一項是本次稽核的正面範例。

---

## B-21｜稽核事件的保存與 cascade｜P3｜🟢

**證據**
- `audit_events.project_id` 是 `on delete cascade`（`20260712000500:16`），專案刪除會清掉稽核事件。
- 這個取捨**已被明確處理**：`20260811000200_project_deletion_records.sql` 建了一張**刻意不掛外鍵**的平台級刪除紀錄表（`:19-20` 註解），BEFORE DELETE trigger 在 cascade 發生前先數好事件筆數並記下誰刪的、IP 是什麼（`:58-71`）。
- append-only 由 trigger 強制（`:45-53`），RLS 只給平台管理員讀（`:34-39`），`revoke insert,update,delete … from authenticated`（`:40-41`）。
- 表註解（`:78-81`）直接把留存政策寫進資料庫：「至少保存六個月；唯一的移除路徑是專案刪除 cascade，該刪除行為記於 project_deletion_records」。

**建議**：無。**唯一的缺口是 B-18**——刪除紀錄留了痕，Storage 卻沒清，兩者合起來才是完整的「終止時刪除」證據鏈。

---

## B-22｜時區：`date` vs `timestamptz` 與 `Asia/Taipei` 判日集中度｜P2｜🟢（附一項 🟡）

**欄位型別分層：🟢 一致且正確**

`baseline` 逐欄檢查，**業務日期一律 `date`、系統時間戳一律 `timestamptz`**，沒有一個混用：
- `date`：`projects.start_date/end_date/award_date/notice_date/commencement_date`（`:114-115,469-470`）、`valuations.period_start/period_end/valuation_date`（`:210-212`）、`paid_date`（`:264`）、`daily_logs.log_date`（`:297`）、`inspections.requested_date`（`:407`）、`defects.due_date`（`:425`）、`contract_obligations.fixed_date`（`:481`）、`change_orders.co_date`（`:546`）、`item_schedules.planned_start/finish`（`:609-610`）、`checklist_records.check_date`（`:678`）、`test_samples.sampled_date/d7_due/d28_due`（`:693,696`）、`submittals.submitted_date/due_date/decided_date`（`:791-793`）、`rfis.asked_date/due_date/answered_date`（`:808-810`）、`acceptance_events.event_date`（`:890`）
- `timestamptz`：`photos.taken_at`（`:358`）、`inspections.inspected_at`（`:412`）、`defects.closed_at`（`:430`）、所有 `created_at`、`contract_obligations.completed_at`（`20260825120000:57`）

這個分層讓「法定期限用日曆日、操作留痕用瞬時」的語意在型別層就分開了，是正確設計。

**前端判日集中度：🟢**

`src/lib/dates.js` 是單一真相，三支函式各有明確職責與「為什麼」註解：
- `parseLocalDate`（`:3-12`）——`new Date('YYYY-MM-DD')` 是 UTC 午夜的坑
- `taipeiISODate`（`:19-25`）＋ `taipeiToday`（`:29`）——用 `Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei'})`，不依賴瀏覽器時區
- `localISODate`（`:32-34`）——本地午夜轉字串不能用 `toISOString()`

註解（`:15-17`）明說這是從 `todayTasks.js` 抽出來當「全站業務日期的單一真相」。W8-2B 的期限正規化（`dual-engine-sync.md` 該段）也記錄了「傍晚開頁第 8 天被壓成 7」的實際 bug 與修法。

**Edge 端：🟢**

`supabase/functions/_shared/contractDue.ts:34` 的 `taipeiTodayUTC()` 是伺服器側對應實作，被 `send-reminders/index.ts:52`、`fetch-weather`、`agentTools.ts:428,565,812,1313` 共用。這一對已登記在 `dual-engine-sync.md` 第 4 項，且是唯一標記為「✅ 同一組測試案例對齊」的一對（`contractDue.test.js` 149 行 ↔ `contractDue.test.ts` 76 行）。

**唯一的 🟡：散落的 `+08:00` 字面量**

不走 `dates.js`／`contractDue.ts` 的手寫時區偏移共 5 處：
- `supabase/functions/_shared/agentTools.ts:616-617`（工項佐證包照片區間）
- `agentTools.ts:832-833`（當日照片撈取）
- `agentTools.ts:1377-1378`（檢查表照片）
- `src/lib/auditEvents.js:118-120`（`taipeiDayStart`，**有註解說明理由**，可接受）

SQL 側則正確使用 `at time zone 'Asia/Taipei'`（`20260822010000_photo_evidence_guard.sql:46`、`20260728000100_ai_platform.sql:394`）。

**影響**：`+08:00` 是寫死的固定偏移。台灣目前不實施日光節約時間，所以**現在完全正確**。風險純屬理論（若未來恢復 DST，或這套系統賣到其他時區）。但它讓「台北判日集中在 `dates.js`」這句話有 4 個例外。

**建議**：在 `_shared/contractDue.ts` 補一支 `taipeiDayRange(ymd) => [start, end]`，讓 `agentTools.ts` 那三處共用。純重構，低風險。

**工作量**：S

---

# 本維度所有檢查項清單

| 編號 | 標題 | 等級 | 狀態 |
|---|---|---|---|
| B-01 | Migration 數量與 schema.sql 現況（57 支；schema.sql 檔頭已自我作廢） | P3 | 🟢 |
| B-02 | CURRENT.md 的資料庫數字已過期（36→57 migrations、23→33 pgTAP） | P2 | 🟡 |
| B-03 | 同一物件被反覆 create or replace（8 個 function ≥3 次、5 個 policy 3 次） | P2 | 🟡 |
| B-04 | rollback 慣例只覆蓋 4/57，規則未成文 | P2 | 🟡 |
| B-05 | 一次性資料修正混在結構 migration 流（4 處藏在結構檔內） | P2 | 🟡 |
| B-06 | 脊椎一：`work_item_id` 的 FK／NOT NULL 一致性（明細 cascade／業務 set null 分界正確） | P3 | 🟢 |
| B-07 | `cost_items` 無 `work_item_id`，與 CURRENT.md §4.1 圖不符 | P3 | 🟡 |
| B-08 | 脊椎二：requirements→sources→obligations 的 FK 與 1:1 唯一性（有硬約束） | P3 | 🟢 |
| B-09 | `requirement_artifact_links.artifact_id` 是無 FK 的多型指標 | P3 | 🟡 |
| B-10 | 大表複合索引與 RLS 述詞索引（RLS 側全綠；4 個查詢熱點缺索引） | P2 | 🟡 |
| B-11 | `(project_id, item_key)` 唯一索引仍未做（ROADMAP:237 未排入） | P2 | 🟡 |
| B-12 | **`extract-requirements` 的 `document_pages` 在 1000 頁靜默截斷** | **P1** | **🔴** |
| B-13 | 其他未分頁的「載入全部」查詢（`store/db.js` 全綠；Edge 側 4 處待補） | P2 | 🟡 |
| B-14 | **雙引擎同步：4 對未登記，D-020 造成 1 對實際規則不一致** | **P1** | **🔴** |
| B-15 | **業務狀態機在 DB 端完全沒有 check constraint（11 張表）；`'送審'` 為死值域** | **P1** | **🔴** |
| B-16 | 狀態值域第三處：API 詞彙（`in_progress`）與 DB 詞彙不同 | P3 | 🟡 |
| B-17 | Store slices 的表歸屬與重複真相（`ai_features` ×2、`defects` 覆蓋競態、無衝突處理） | P2 | 🟡 |
| B-18 | **專案刪除不清 Storage，孤兒檔案永久殘留（與已留痕的刪除紀錄自相矛盾）** | **P1** | **🔴** |
| B-19 | `project-delete-contract-first-hotfix.md` 描述的實作不存在 | P2 | 🟡 |
| B-20 | 個資最小化：`profiles` 欄位與欄級 grant 收斂 | P3 | 🟢 |
| B-21 | 稽核事件的保存與 cascade（`project_deletion_records` 設計正確） | P3 | 🟢 |
| B-22 | 時區：`date`/`timestamptz` 分層與台北判日集中度（4 處 `+08:00` 字面量） | P2 | 🟢 |

**紅燈 3｜黃燈 11｜綠燈 8**

---

## 建議處理順序

| 順位 | 項目 | 理由 | 工作量 |
|---|---|---|---|
| 1 | B-12 大文件截斷 | 直接讓「AI 已讀完契約」變成不實陳述；修法單純 | S |
| 2 | B-18 專案刪除不清 Storage | 合規紅線；已有 `delete_document` 可完全比照 | M |
| 3 | B-15 步驟 1（唯讀盤點狀態值） | 唯讀、零風險，且是後續加 constraint 的前提 | S |
| 4 | B-14a D-020 死碼處置 | 刪掉最乾淨；避免下個人照著做出不一致功能 | S |
| 5 | B-11 `item_key` 盤點＋唯一索引 | ROADMAP 已寫好判準，盤點唯讀 | S+S |
| 6 | B-10 補四個索引 | 純 `if not exists`，無資料風險 | S |
| 7 | B-15 步驟 2、3 | 需要停機窗與較大改動面 | M+M |
| 8 | B-02 / B-19 / B-14b-d 文件同步 | 低風險，可與任一批次搭車 | S |
