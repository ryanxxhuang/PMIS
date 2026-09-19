-- P4b｜監造確認量的表、guard、RPC 與鎖(D-026 第 3 點;設計 docs/architecture/confirmed-quantity-valuation.md §1、§2、§4–§13)。
--
-- 為什麼:P4a 把「有效確認量／契約量／本期上限／來源分配」的算法固定成純函式並用 pgTAP 釘住,
-- 但 DB 裡還沒有任何表承載監造確認,估驗的送審／核定／請款也沒有任何數量檢查——
-- 客戶端 upsert 的 cum_qty 就是請款底稿,fillValuationFromSiteLogs 是不受限制的請款路徑。
-- 本支把「監造確認通過才有可估驗資格」變成 DB 強制:表、列級 guard、期別檢查點、RPC、鎖、稽核、舊資料過渡。
-- 全部計算都餵入 P4a 的 fn_effective_*／fn_cap／fn_allocate_fifo／fn_batch_allocation_check／
-- fn_period_increment／fn_valuation_amount／fn_pricing_basis_effective,本支不重寫任何算法。
--
-- 資料模型(全部新增;既有表只加欄):
--   inspection_confirmations   監造對 (工項, 批次, 階段) 簽的「累計」確認通過量;append-only,只能 active→revoked。
--   valuation_item_sources     期別對工項的來源分配(confirmation／legacy／clawback／adjustment);每一單位增量都追得到來源。
--   valuation_adjustments      已核定／已請款期別的更正流程(pending→applied／void),append-only 加狀態。
--   work_item_pricing_basis    總價／間接費的計價依據(缺列 → fn_pricing_basis_effective 推定;總價類缺依據 cap=0,Q3 使用者決定暫時隔離)。
--   valuations.recheck_required／recheck_note、valuation_items.backing、inspection_points.stage_key／required_for_billing。
--
-- 不變量(DB 強制;「所有寫入者」含 service role,admin_override 只放行角色不放行數量):
--   1. 本期增量 Δ(P,W) = Σ 本期來源分配(P,W)。
--   2. Σ_{所有期} 分配(·,W,b) ≤ E(W,b,now)(同批次不重複計價);送審／核定另加截止日版:Σ_{period_no ≤ P} ≤ E(W,b,P.period_end)。
--   3. cum_qty ≤ 契約量(標單量＋核准變更);cum_qty ≥ 0;Δ < 0 只能來自 clawback。
--   4. 草稿→監造審核、→已核定、登錄請款日／→已請款 三個檢查點重算 1–3,任何一項不成立即拒絕整期(errcode VQ004,detail 列出工項與原因)。
--   5. 已核定／已請款期別的 valuation_items 數量與分配永不改寫;更正走 valuation_adjustments。
--   列級:valuation_item_sources 每一列寫入時就檢查不變量 2(含截止日);valuation_items 非草稿期凍結;
--   inspection_confirmations 只由 RPC／簽署路徑寫入(authenticated 無 INSERT),確認人必須是本案監造成員。
--
-- 併發與重播:逐工項 pg_advisory_xact_lock(hashtext(project), hashtext(work_item))(依 work_item 排序取得),
--   valuations 列 for update;唯一鍵 (inspection_id, work_item_id, stage_key)、(project_id, client_request_id)、
--   (valuation_id, work_item_id, batch_key, kind);transition_valuation 帶 p_from 冪等;RPC lock_timeout 5s(VQ007)。
--
-- 錯誤代碼(RPC 與 guard 共用;前端以 code 分流,message 一律繁中):
--   VQ001 無權(未登入／非成員／非此角色)        VQ006 超出可計價上限或低於前期累計(detail 含 prev_cum／cap／wanted)
--   VQ002 目前狀態不允許此轉移                 VQ007 取鎖逾時(併發中,請重試)
--   VQ003 (保留不用;R1 20260919023220 已全面移除兩步驟驗證)  VQ008 找不到資料或跨專案
--   VQ004 檢查點不變量不成立(detail=[{work_item_id, code, message, …}])  VQ009 client_request_id 已用於不同請求
--   VQ005 輸入不合法(數量／單位／批次／原因)       VQ010 期別不是草稿(或欄位在此狀態不可改)
--
-- 舊資料過渡(正式庫 2026-09-19 唯讀盤點:草稿 7、監造審核 1、已核定 4;明細 26,已核定 5 筆 Δ>0、其中 1 筆掛非計價列、
--   1 筆工項無單位;超契約量 0、負值 0):
--   * 已核定期明細回填 valuation_item_sources(kind='legacy', batch_key='__legacy__')=「歷史遷移」,不是監造確認;
--     讓 B(W) 計入已計價量,之後不能再計一次。不偽造任何確認或簽署。
--   * 有 legacy 來源的期別:送審／核定一律擋(草稿由廠商重算;監造審核期需監造退回);登錄請款日／→已請款也擋並明示
--     「歷史遷移來源,需人工補證」——補證路徑 issue_supervisor_certificate(p_covers_valuation_id) 把該期該工項的 legacy
--     來源改掛到監造確認單的批次(數量不變、留痕),之後才可請款。
--   * 草稿／監造審核的既有數量保留(backing='legacy'),但送審時不變量 1 不成立即拒絕並列出缺來源工項。
--   * 已核定明細的金額不重算(歷史);新寫入才由 DB 以 fn_valuation_amount 算。
-- 相容:valuation_items 的直接 REST 寫入本支保留(P4e 才收回),但寫入時金額／百分比由 DB 算、超契約量拒絕、非草稿期凍結,
--   且無來源的數量在送審／核定被擋——舊前端與 fillValuationFromSiteLogs 都不能再產生未經確認的核定。
--   valuations_guard 新增 BEFORE INSERT(登入者只能建草稿)與狀態機(草稿→監造審核限廠商、監造審核→草稿限監造、
--   跨越已核定限監造;其他轉移 VQ002);period_end 在送審／核定必填;非草稿期不可改期別欄位(登入者)。
-- 回復:supabase/rollbacks/20260919040000_confirmed_quantity_enforcement.down.sql(drop 新表／欄／函式／trigger,
--   還原 valuations_guard／valuation_items_guard 為 20260712001300 版本;legacy 來源列隨表移除,valuation_items 原值不動)。
-- pgTAP:supabase/tests/confirmed_quantity_enforcement.sql(結構、guard、§8 全部情境、狀態機、撤銷／調整、權限矩陣、
--   service role 無 bypass)、confirmed_quantity_concurrency.sql(dblink 兩個 session 真併發)。

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. 既有表加欄
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.valuations
  add column if not exists recheck_required boolean not null default false,
  add column if not exists recheck_note text;
comment on column public.valuations.recheck_required is
  'P4b:監造審核中的期別因確認撤銷／減量而不符;核定與送審前必須由 sync_valuation_from_confirmations 重算清除。';

alter table public.valuation_items
  add column if not exists backing text not null default 'legacy'
    check (backing in ('legacy', 'confirmed', 'adjusted'));
comment on column public.valuation_items.backing is
  'P4b:數量依據。legacy=客戶端直接寫入或歷史遷移(無監造確認來源);confirmed=由確認量 RPC 分配;adjusted=平台管理員調整。';

alter table public.inspection_points
  add column if not exists stage_key text,
  add column if not exists required_for_billing boolean not null default true;
comment on column public.inspection_points.stage_key is
  'P4b:多階段必要查驗的階段鍵(Q6 使用者同意暫行:point_type=H 且 required_for_billing 的 stage_key 為計價必要階段;null=不構成階段)。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 新表
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.work_item_pricing_basis (
  work_item_id uuid primary key references public.work_items(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  basis        text not null check (basis in ('inspection', 'supervisor_certificate', 'pro_rata', 'excluded')),
  rule         jsonb check (rule is null or jsonb_typeof(rule) = 'object'),
  set_by       uuid references auth.users(id),
  set_at       timestamptz not null default now()
);
create index if not exists work_item_pricing_basis_project_idx on public.work_item_pricing_basis(project_id);
alter table public.work_item_pricing_basis enable row level security;
drop policy if exists "work_item_pricing_basis_select" on public.work_item_pricing_basis;
create policy "work_item_pricing_basis_select" on public.work_item_pricing_basis for select to authenticated
  using (project_id in (select public.my_project_ids()));
revoke insert, update, delete on public.work_item_pricing_basis from authenticated;

create table if not exists public.inspection_confirmations (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  work_item_id        uuid not null references public.work_items(id) on delete cascade,
  batch_key           text not null,                       -- 正規化批次鍵(guard 以 fn_cq_batch_key 覆寫)
  location_label      text,                                -- 顯示用原文
  stage_key           text,                                -- 正規化階段鍵;null=單階段
  unit                text not null,                       -- 簽署時單位快照;guard 檢查等於工項單位
  qty_cum             numeric(18,4) not null,              -- 該批次該階段的「累計」確認通過量
  qty_delta           numeric(18,4) not null default 0,    -- 導出:qty_cum − 前一筆 active 的 qty_cum(guard 覆寫)
  basis               text not null check (basis in ('inspection', 'supervisor_certificate', 'pro_rata_rule')),
  inspection_id       uuid references public.inspections(id) on delete set null,
  document_id         uuid references public.field_documents(id) on delete set null,
  document_version_no int,
  content_hash        text,
  client_request_id   text,                                -- 監造確認單 RPC 的冪等鍵
  confirmed_by        uuid not null references auth.users(id),
  confirmed_at        timestamptz not null default clock_timestamp(),   -- 伺服器寫入時刻(同交易多筆也不並列,累計語意才有先後)
  status              text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at          timestamptz,
  revoked_by          uuid references auth.users(id),
  reason              text,                                -- 減量／撤銷／補證原因
  supersedes_id       uuid references public.inspection_confirmations(id) on delete set null,
  created_at          timestamptz not null default clock_timestamp(),
  check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  check ((document_id is null) = (document_version_no is null)),
  check (status = 'active' or (revoked_at is not null and reason is not null)),
  foreign key (document_id, document_version_no)
    references public.field_document_versions(document_id, version_no) on delete set null
);
create index if not exists inspection_confirmations_wi_idx
  on public.inspection_confirmations(project_id, work_item_id, status, confirmed_at desc);
create unique index if not exists inspection_confirmations_inspection_stage_uidx
  on public.inspection_confirmations(inspection_id, work_item_id, coalesce(stage_key, ''))
  where inspection_id is not null;
create unique index if not exists inspection_confirmations_request_uidx
  on public.inspection_confirmations(project_id, client_request_id)
  where client_request_id is not null;
create index if not exists inspection_confirmations_document_idx
  on public.inspection_confirmations(document_id) where document_id is not null;
alter table public.inspection_confirmations enable row level security;
drop policy if exists "inspection_confirmations_select" on public.inspection_confirmations;
create policy "inspection_confirmations_select" on public.inspection_confirmations for select to authenticated
  using (project_id in (select public.my_project_ids()));
revoke insert, update, delete on public.inspection_confirmations from authenticated;
comment on table public.inspection_confirmations is
  'P4b:監造確認紀錄(累計語意)。寫入只走簽署路徑(P3c)與 issue_supervisor_certificate;撤銷走 revoke_inspection_confirmation。';

create table if not exists public.valuation_adjustments (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  work_item_id           uuid not null references public.work_items(id) on delete cascade,
  batch_key              text not null,
  qty_delta              numeric(18,4) not null check (qty_delta <> 0),   -- 負=扣回
  reason                 text not null check (btrim(reason) <> ''),
  source_confirmation_id uuid references public.inspection_confirmations(id) on delete set null,
  origin_valuation_id    uuid references public.valuations(id) on delete set null,  -- 被更正的已核定期
  status                 text not null default 'pending' check (status in ('pending', 'applied', 'void')),
  applied_valuation_id   uuid references public.valuations(id) on delete set null,   -- 草稿刪除:RI set null 與來源 after-delete trigger 誰先都可,調整回 pending
  created_by             uuid references auth.users(id),
  created_at             timestamptz not null default clock_timestamp(),
  applied_at             timestamptz,
  voided_at              timestamptz,
  voided_by              uuid references auth.users(id),
  void_reason            text,
  check (status <> 'applied' or applied_at is not null),   -- applied_valuation_id 可因草稿刪除暫為 null(trigger 隨即回 pending)
  check (status <> 'void' or (voided_at is not null and void_reason is not null))
);
create index if not exists valuation_adjustments_project_status_idx on public.valuation_adjustments(project_id, status);
create index if not exists valuation_adjustments_wi_idx on public.valuation_adjustments(work_item_id);
alter table public.valuation_adjustments enable row level security;
drop policy if exists "valuation_adjustments_select" on public.valuation_adjustments;
create policy "valuation_adjustments_select" on public.valuation_adjustments for select to authenticated
  using (project_id in (select public.my_project_ids()));
revoke insert, update, delete on public.valuation_adjustments from authenticated;

create table if not exists public.valuation_item_sources (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  valuation_id    uuid not null references public.valuations(id) on delete cascade,
  work_item_id    uuid not null references public.work_items(id) on delete cascade,
  batch_key       text not null,
  qty             numeric(18,4) not null check (qty <> 0),
  kind            text not null check (kind in ('confirmation', 'legacy', 'clawback', 'adjustment')),
  confirmation_id uuid references public.inspection_confirmations(id) on delete set null,
  adjustment_id   uuid references public.valuation_adjustments(id) on delete set null,
  created_at      timestamptz not null default clock_timestamp(),   -- 分配先後(撤銷時最晚分配先減)
  created_by      uuid references auth.users(id),
  unique (valuation_id, work_item_id, batch_key, kind),
  foreign key (valuation_id, work_item_id)
    references public.valuation_items(valuation_id, work_item_id) on delete cascade
);
create index if not exists valuation_item_sources_wi_idx on public.valuation_item_sources(project_id, work_item_id);
create index if not exists valuation_item_sources_val_idx on public.valuation_item_sources(valuation_id);
create index if not exists valuation_item_sources_adj_idx on public.valuation_item_sources(adjustment_id) where adjustment_id is not null;
alter table public.valuation_item_sources enable row level security;
drop policy if exists "valuation_item_sources_select" on public.valuation_item_sources;
create policy "valuation_item_sources_select" on public.valuation_item_sources for select to authenticated
  using (project_id in (select public.my_project_ids()));
revoke insert, update, delete on public.valuation_item_sources from authenticated;
comment on table public.valuation_item_sources is
  'P4b:期別來源分配。confirmation=監造確認批次的 FIFO 分配;legacy=歷史遷移(不是監造確認);clawback=撤銷後扣回(負);adjustment=平台管理員調整。';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 內部 helper(不 grant;只被 security definer 函式與 trigger 呼叫)
-- ═══════════════════════════════════════════════════════════════════════════
-- 內部寫入旗標:只有 postgres 擁有的 security definer 函式能設(PostgREST 無法執行 set_config),
-- 用來讓 guard 放行「由不變量重算所產生」的 valuation_items／sources／adjustments 寫入。
create or replace function public.fn_cq_internal()
returns boolean language sql stable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(current_setting('pmis.cq_internal', true), '') = '1';
$fn$;
revoke all on function public.fn_cq_internal() from public, anon, authenticated;

create or replace function public.fn_cq_set_internal(p_on boolean)
returns text language plpgsql security invoker set search_path = pg_catalog, public as $fn$
declare v_prev text := coalesce(current_setting('pmis.cq_internal', true), '');
begin
  perform set_config('pmis.cq_internal', case when p_on then '1' else '' end, true);
  return v_prev;
end $fn$;
revoke all on function public.fn_cq_set_internal(boolean) from public, anon, authenticated;

create or replace function public.fn_cq_restore_internal(p_prev text)
returns void language sql security invoker set search_path = pg_catalog, public as $fn$
  select set_config('pmis.cq_internal', coalesce(p_prev, ''), true);
$fn$;
revoke all on function public.fn_cq_restore_internal(text) from public, anon, authenticated;

-- 逐工項交易鎖(依 work_item 排序取得,避免死鎖)
create or replace function public.fn_cq_lock_internal(p_project uuid, p_work_item uuid)
returns void language sql security invoker set search_path = pg_catalog, public as $fn$
  select pg_advisory_xact_lock(hashtext(p_project::text), hashtext(p_work_item::text));
$fn$;
revoke all on function public.fn_cq_lock_internal(uuid, uuid) from public, anon, authenticated;

create or replace function public.fn_cq_raise_internal(p_code text, p_message text, p_detail jsonb default null)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $fn$
begin
  if p_detail is null then
    raise exception using errcode = p_code, message = p_message;
  end if;
  raise exception using errcode = p_code, message = p_message, detail = p_detail::text;
end $fn$;
revoke all on function public.fn_cq_raise_internal(text, text, jsonb) from public, anon, authenticated;

-- 確認人資格:本案成員且(監造身分,或非正式模式的專案管理者=admin_override 的資料層等價)
create or replace function public.fn_cq_can_confirm_internal(p_project uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.project_members m
    join public.profiles pr on pr.id = m.user_id
    left join public.projects p on p.id = m.project_id
    where m.project_id = p_project and m.user_id = p_user
      and (pr.org_type = 'supervisor' or (m.role = 'admin' and not coalesce(p.formal_mode, false)))
  );
$fn$;
revoke all on function public.fn_cq_can_confirm_internal(uuid, uuid) from public, anon, authenticated;

-- 工項的必要階段(ITP H 點;Q6 暫行)
create or replace function public.fn_cq_required_stages_internal(p_work_item uuid)
returns text[] language sql stable security definer set search_path = public as $fn$
  select coalesce(array_agg(distinct k order by k), '{}'::text[])
  from (select nullif(public.fn_cq_normalize_text(ip.stage_key), '') as k
        from public.inspection_points ip
        where ip.work_item_id = p_work_item and ip.point_type = 'H' and ip.required_for_billing) s
  where k is not null;
$fn$;
revoke all on function public.fn_cq_required_stages_internal(uuid) from public, anon, authenticated;

-- 契約量 = 標單量 + Σ核准變更(P4a fn_contract_qty)
create or replace function public.fn_cq_contract_qty_internal(p_work_item uuid)
returns numeric language sql stable security definer set search_path = public as $fn$
  select public.fn_contract_qty(w.quantity,
    (select coalesce(array_agg(coi.qty_delta), '{}'::numeric[])
     from public.change_order_items coi
     join public.change_orders co on co.id = coi.change_order_id
     where coi.work_item_id = w.id and co.status = '核准'))
  from public.work_items w where w.id = p_work_item;
$fn$;
revoke all on function public.fn_cq_contract_qty_internal(uuid) from public, anon, authenticated;

-- 有效計價依據(P4a fn_pricing_basis_effective;缺列→依單位推定,總價類→null=cap 0)
create or replace function public.fn_cq_basis_internal(p_work_item uuid)
returns text language sql stable security definer set search_path = public as $fn$
  select public.fn_pricing_basis_effective(w.unit, w.quantity, b.basis)
  from public.work_items w
  left join public.work_item_pricing_basis b on b.work_item_id = w.id
  where w.id = p_work_item;
$fn$;
revoke all on function public.fn_cq_basis_internal(uuid) from public, anon, authenticated;

-- 工項全部確認紀錄 → P4a 輸入型別
create or replace function public.fn_cq_confirmations_internal(p_project uuid, p_work_item uuid)
returns public.cq_confirmation[] language sql stable security definer set search_path = public as $fn$
  select coalesce(array_agg((c.batch_key, c.stage_key, c.unit, c.qty_cum, c.confirmed_at, c.status)::public.cq_confirmation
                            order by c.confirmed_at, c.created_at, c.id), '{}'::public.cq_confirmation[])
  from public.inspection_confirmations c
  where c.project_id = p_project and c.work_item_id = p_work_item;
$fn$;
revoke all on function public.fn_cq_confirmations_internal(uuid, uuid) from public, anon, authenticated;

-- 批次分配(confirmation＋clawback 兩種掛在批次上的來源)→ P4a 輸入型別;可限期別範圍、排除某列
create or replace function public.fn_cq_allocations_internal(
  p_project uuid, p_work_item uuid, p_max_period_no int default null, p_exclude_source uuid default null
) returns public.cq_allocation[] language sql stable security definer set search_path = public as $fn$
  select coalesce(array_agg((s.batch_key, s.qty)::public.cq_allocation order by s.created_at, s.id), '{}'::public.cq_allocation[])
  from public.valuation_item_sources s
  join public.valuations v on v.id = s.valuation_id
  where s.project_id = p_project and s.work_item_id = p_work_item
    and s.kind in ('confirmation', 'clawback')
    and (p_max_period_no is null or v.period_no <= p_max_period_no)
    and (p_exclude_source is null or s.id <> p_exclude_source);
$fn$;
revoke all on function public.fn_cq_allocations_internal(uuid, uuid, int, uuid) from public, anon, authenticated;

-- 機關作廢的調整=「撤銷後仍接受該量已計價」:檢查點不再把它當超額(否則作廢後該工項永遠卡住),
-- 但它永遠不產生新的可分配量(FIFO 與列級 guard 仍用真實分配),同一批次再確認也不能再計一次。
create or replace function public.fn_cq_voided_internal(p_project uuid, p_work_item uuid)
returns public.cq_allocation[] language sql stable security definer set search_path = public as $fn$
  select coalesce(array_agg((a.batch_key, a.qty_delta)::public.cq_allocation order by a.created_at, a.id), '{}'::public.cq_allocation[])
  from public.valuation_adjustments a
  where a.project_id = p_project and a.work_item_id = p_work_item and a.status = 'void';
$fn$;
revoke all on function public.fn_cq_voided_internal(uuid, uuid) from public, anon, authenticated;

-- 某批次缺哪些必要階段(無 active 確認);單階段工項回 {} 或 {'(單階段)'}
create or replace function public.fn_cq_missing_stages_internal(
  p_confirmations public.cq_confirmation[], p_required_stages text[], p_batch_key text
) returns text[] language plpgsql immutable security invoker set search_path = pg_catalog, public as $fn$
declare v_stage text; v_missing text[] := '{}';
begin
  foreach v_stage in array (case when cardinality(coalesce(p_required_stages, '{}'::text[])) = 0
                                 then array[null::text] else p_required_stages end) loop
    if not exists (select 1 from unnest(coalesce(p_confirmations, '{}'::public.cq_confirmation[])) c
                   where c.status = 'active' and public.fn_cq_batch_key(c.batch_key) = p_batch_key
                     and nullif(public.fn_cq_normalize_text(c.stage_key), '') is not distinct from v_stage) then
      v_missing := v_missing || coalesce(v_stage, '(單階段)');
    end if;
  end loop;
  return v_missing;
end $fn$;
revoke all on function public.fn_cq_missing_stages_internal(public.cq_confirmation[], text[], text) from public, anon, authenticated;

-- 前期累計:period_no 較小、最近一期有該工項明細的 cum_qty;無→0
create or replace function public.fn_cq_prev_cum_internal(p_project uuid, p_work_item uuid, p_period_no int)
returns numeric language sql stable security definer set search_path = public as $fn$
  select coalesce((select vi.cum_qty from public.valuation_items vi
                   join public.valuations v on v.id = vi.valuation_id
                   where v.project_id = p_project and vi.work_item_id = p_work_item and v.period_no < p_period_no
                   order by v.period_no desc limit 1), 0);
$fn$;
revoke all on function public.fn_cq_prev_cum_internal(uuid, uuid, int) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. 工項狀態(單一計算入口;guard、RPC、唯讀查詢都用它)
-- ═══════════════════════════════════════════════════════════════════════════
do $do$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'cq_item_state') then
    create type public.cq_item_state as (
      work_item_id      uuid,
      unit              text,
      contract_qty      numeric,
      basis             text,
      required_stages   text[],
      billable          boolean,
      prev_cum          numeric,
      cum_qty           numeric,     -- null=本期無明細
      delta             numeric,
      effective_cutoff  numeric,     -- E(W, period_end)
      effective_now     numeric,     -- E(W, now)
      billed            numeric,     -- B:已核定／已請款期別分配(不含本期)
      reserved          numeric,     -- O:其他未結束期別分配
      cap               numeric,     -- 本期可新增上限 fn_cap(E,B,O)(本期尚未分配時的上限)
      headroom          numeric,     -- 本期還能再分配的確認量 = 依據閘門後的 max(0, min(E−B−O−本期已分配, 契約量−前期累計−本期已分配))
      sources_sum       numeric,
      confirmation_qty  numeric,
      legacy_qty        numeric,
      clawback_qty      numeric,
      adjustment_qty    numeric,
      violations        jsonb        -- [{code, message, ...}]
    );
  end if;
end $do$;

-- p_valuation_id 可為 null(可估驗清單:無本期,prev_cum=0、其他期占用=全部未結束期)。呼叫端負責取鎖。
create or replace function public.fn_cq_item_state_internal(p_project uuid, p_work_item uuid, p_valuation_id uuid)
returns public.cq_item_state language plpgsql stable security definer set search_path = public as $fn$
declare
  st       public.cq_item_state;
  w        record;
  v        record;
  confs    public.cq_confirmation[];
  allocs   public.cq_allocation[];
  vio      jsonb := '[]'::jsonb;
  r        record;
  v_missing text[];
begin
  st.work_item_id := p_work_item;
  select id, project_id, unit, quantity, coalesce(is_leaf, false) as is_leaf,
         coalesce(is_billable, true) as is_billable, coalesce(is_rollup, false) as is_rollup, unit_price
    into w from public.work_items where id = p_work_item;
  if not found then
    perform public.fn_cq_raise_internal('VQ008', '找不到工項');
  end if;
  if w.project_id <> p_project then
    perform public.fn_cq_raise_internal('VQ008', '工項不屬於本專案(跨專案)');
  end if;
  if p_valuation_id is not null then
    select id, project_id, period_no, period_end, status into v from public.valuations where id = p_valuation_id;
    if not found then perform public.fn_cq_raise_internal('VQ008', '找不到估驗期別'); end if;
    if v.project_id <> p_project then perform public.fn_cq_raise_internal('VQ008', '估驗期別不屬於本專案(跨專案)'); end if;
  end if;

  st.unit            := w.unit;
  st.billable        := w.is_leaf and w.is_billable and not w.is_rollup;
  st.contract_qty    := public.fn_cq_contract_qty_internal(p_work_item);
  st.basis           := public.fn_cq_basis_internal(p_work_item);
  st.required_stages := public.fn_cq_required_stages_internal(p_work_item);
  confs              := public.fn_cq_confirmations_internal(p_project, p_work_item);

  -- 有效確認量(截止日版與現況版);工項無單位而有確認紀錄時 fn_cq_check_unit 會 raise(fail-closed)
  st.effective_now := public.fn_effective_confirmed(confs, st.required_stages, w.unit, null, st.contract_qty);
  if p_valuation_id is not null then
    st.effective_cutoff := public.fn_effective_confirmed(confs, st.required_stages, w.unit,
                             public.fn_cq_as_of(v.period_end), st.contract_qty);
  else
    st.effective_cutoff := st.effective_now;
  end if;

  -- 已計價 B 與其他期占用 O(全部來源種類)
  select coalesce(sum(s.qty) filter (where x.status in ('已核定', '已請款')), 0),
         coalesce(sum(s.qty) filter (where x.status in ('草稿', '監造審核')), 0)
    into st.billed, st.reserved
  from public.valuation_item_sources s
  join public.valuations x on x.id = s.valuation_id
  where s.project_id = p_project and s.work_item_id = p_work_item
    and (p_valuation_id is null or s.valuation_id <> p_valuation_id);
  -- B／O 是淨額(扣回為負,可能小於 0):先相減再交給 fn_cap 做依據閘門與 max(0,·)
  st.cap := public.fn_cap(greatest(0, st.effective_cutoff - st.billed - st.reserved), 0, 0, st.basis);

  -- 本期明細與來源
  if p_valuation_id is not null then
    st.prev_cum := public.fn_cq_prev_cum_internal(p_project, p_work_item, v.period_no);
    select vi.cum_qty into st.cum_qty from public.valuation_items vi
      where vi.valuation_id = p_valuation_id and vi.work_item_id = p_work_item;
    select coalesce(sum(qty), 0),
           coalesce(sum(qty) filter (where kind = 'confirmation'), 0),
           coalesce(sum(qty) filter (where kind = 'legacy'), 0),
           coalesce(sum(qty) filter (where kind = 'clawback'), 0),
           coalesce(sum(qty) filter (where kind = 'adjustment'), 0)
      into st.sources_sum, st.confirmation_qty, st.legacy_qty, st.clawback_qty, st.adjustment_qty
    from public.valuation_item_sources where valuation_id = p_valuation_id and work_item_id = p_work_item;
    if st.cum_qty is not null then
      if st.cum_qty > st.contract_qty then
        vio := vio || jsonb_build_object('code', 'over_contract',
          'message', format('累計量 %s 超過契約量 %s', st.cum_qty, st.contract_qty));
        st.delta := st.cum_qty - st.prev_cum;
      else
        st.delta := public.fn_period_increment(st.cum_qty, st.prev_cum, st.contract_qty);
      end if;
    else
      st.delta := 0;
    end if;
    if st.delta <> 0 and not st.billable then
      vio := vio || jsonb_build_object('code', 'not_billable', 'message', '工項非末端／非計價列,不可計價');
    end if;
    if st.delta > 0 and st.basis is null then
      vio := vio || jsonb_build_object('code', 'basis_missing', 'message', '總價／間接費工項尚未設定計價依據(暫時隔離不計價)');
    end if;
    if st.delta > 0 and st.basis = 'excluded' then
      vio := vio || jsonb_build_object('code', 'basis_excluded', 'message', '此工項不由本系統計價');
    end if;
    if st.delta < 0 and st.clawback_qty = 0 then
      vio := vio || jsonb_build_object('code', 'negative_delta', 'message', '本期增量為負但沒有扣回來源(減量須走撤銷／調整流程)');
    end if;
    if round(st.delta, 4) <> round(st.sources_sum, 4) then
      vio := vio || jsonb_build_object('code', 'source_mismatch',
        'message', format('本期增量 %s 與來源分配 %s 不符(缺監造確認來源)', round(st.delta, 4), round(st.sources_sum, 4)),
        'delta', round(st.delta, 4), 'sources_sum', round(st.sources_sum, 4));
    end if;
    if st.legacy_qty <> 0 or exists (select 1 from public.valuation_item_sources
                                     where valuation_id = p_valuation_id and work_item_id = p_work_item and kind = 'legacy') then
      vio := vio || jsonb_build_object('code', 'legacy_source',
        'message', format('數量 %s 來自歷史遷移,不是監造確認;需人工補證(監造確認單)', st.legacy_qty));
    end if;
    -- 截止日(核定前的期別):period_no ≤ 本期的批次分配總和 ≤ E(W,b,period_end)。
    -- 已核定／已請款期別不再比截止日:補證確認單必然晚於歷史期別的截止日,其正當性由不變量 2(現況)與留痕保證。
    if v.status in ('草稿', '監造審核') then
      allocs := public.fn_cq_allocations_internal(p_project, p_work_item, v.period_no, null);
      for r in
        with e as (select * from public.fn_effective_by_batch(confs, st.required_stages, w.unit, public.fn_cq_as_of(v.period_end))),
             a as (select x.batch_key, sum(x.qty) as qty from unnest(allocs) x group by x.batch_key)
        select a.batch_key, coalesce(e.qty, 0) as eff, a.qty as alloc
        from a left join e on e.batch_key = a.batch_key
        where a.qty > coalesce(e.qty, 0)
      loop
        vio := vio || jsonb_build_object('code', 'cutoff',
          'message', format('批次「%s」截至 %s 的有效確認量 %s 少於累計分配 %s', r.batch_key, coalesce(v.period_end::text, '不設截止'), r.eff, r.alloc),
          'batch_key', r.batch_key);
      end loop;
    end if;
  else
    st.prev_cum := 0; st.delta := 0; st.sources_sum := 0; st.confirmation_qty := 0;
    st.legacy_qty := 0; st.clawback_qty := 0; st.adjustment_qty := 0;
  end if;
  -- 本期還能再分配的確認量:全域(E − 全部期別已分配)與契約量兩個上界取小,再過計價依據閘門(fn_cap 對 null／excluded 回 0)
  st.headroom := public.fn_cap(
    greatest(0, least(st.effective_cutoff - st.billed - st.reserved - st.sources_sum,
                      st.contract_qty - st.prev_cum - st.sources_sum)), 0, 0, st.basis);

  -- 不變量 2(全部期別、現況):逐批次 Σ分配 − 機關作廢的調整 ≤ E(W,b,now);附缺階段清單
  allocs := public.fn_cq_allocations_internal(p_project, p_work_item, null, null)
            || public.fn_cq_voided_internal(p_project, p_work_item);
  for r in
    select * from public.fn_batch_allocation_check(confs, st.required_stages, w.unit, allocs) x
    where x.available_qty < 0
  loop
    v_missing := public.fn_cq_missing_stages_internal(confs, st.required_stages, r.batch_key);
    vio := vio || jsonb_build_object('code', 'batch_over_allocated',
      'message', case when cardinality(v_missing) > 0
                      then format('批次「%s」缺必要查驗階段 %s,有效確認量 %s 少於分配 %s', r.batch_key, array_to_string(v_missing, '、'), r.effective_qty, r.allocated_qty)
                      else format('批次「%s」有效確認量 %s 少於分配 %s(確認已撤銷或減量)', r.batch_key, r.effective_qty, r.allocated_qty) end,
      'batch_key', r.batch_key, 'effective_qty', r.effective_qty, 'allocated_qty', r.allocated_qty,
      'missing_stages', to_jsonb(v_missing));
  end loop;

  st.violations := vio;
  return st;
end $fn$;
revoke all on function public.fn_cq_item_state_internal(uuid, uuid, uuid) from public, anon, authenticated;
comment on function public.fn_cq_item_state_internal(uuid, uuid, uuid) is
  'P4b:一個工項在某期的完整狀態(契約量、依據、前期累計、增量、有效確認量、已計價、占用、上限、來源、不變量違反)。唯一計算入口;全部餵入 P4a 純函式。';

-- 本期涉及的工項集合:有明細者(來源 FK 保證有明細)
create or replace function public.fn_cq_period_work_items_internal(p_valuation_id uuid)
returns uuid[] language sql stable security definer set search_path = public as $fn$
  select coalesce(array_agg(distinct work_item_id order by work_item_id), '{}'::uuid[])
  from public.valuation_items where valuation_id = p_valuation_id;
$fn$;
revoke all on function public.fn_cq_period_work_items_internal(uuid) from public, anon, authenticated;

-- 檢查點(review／approve／invoice):逐工項取鎖後重算,回傳違反清單(空=通過)
create or replace function public.fn_cq_period_check_internal(p_valuation_id uuid, p_checkpoint text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v      record;
  wi     uuid;
  st     public.cq_item_state;
  vio    jsonb := '[]'::jsonb;
  item   jsonb;
  n_pend int;
begin
  select id, project_id, period_no, period_end, status, recheck_required, recheck_note into v
  from public.valuations where id = p_valuation_id;
  if not found then perform public.fn_cq_raise_internal('VQ008', '找不到估驗期別'); end if;
  if p_checkpoint not in ('review', 'approve', 'invoice') then
    perform public.fn_cq_raise_internal('VQ005', format('未知檢查點:%s', p_checkpoint));
  end if;
  if p_checkpoint in ('review', 'approve') then
    if v.period_end is null then
      vio := vio || jsonb_build_object('code', 'period_end_missing', 'message', '計價截止日(period_end)未填,送審／核定前必填');
    end if;
    if v.recheck_required then
      vio := vio || jsonb_build_object('code', 'recheck_required',
        'message', format('本期因確認撤銷／減量需重算:%s', coalesce(v.recheck_note, '')));
    end if;
  end if;
  if p_checkpoint = 'approve' then
    select count(*) into n_pend from public.valuation_adjustments
      where project_id = v.project_id and status = 'pending';
    if n_pend > 0 then
      vio := vio || jsonb_build_object('code', 'pending_adjustment',
        'message', format('本案尚有 %s 筆待處理的估驗調整(扣回),需先併入草稿期或由機關作廢', n_pend));
    end if;
  end if;
  foreach wi in array public.fn_cq_period_work_items_internal(p_valuation_id) loop
    perform public.fn_cq_lock_internal(v.project_id, wi);
    st := public.fn_cq_item_state_internal(v.project_id, wi, p_valuation_id);
    for item in select * from jsonb_array_elements(st.violations) loop
      vio := vio || (item || jsonb_build_object('work_item_id', wi));
    end loop;
  end loop;
  return vio;
end $fn$;
revoke all on function public.fn_cq_period_check_internal(uuid, text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. 列級 guard
-- ═══════════════════════════════════════════════════════════════════════════
-- 4.1 inspection_confirmations:append-only;只能 active→revoked;插入時驗全部欄位
create or replace function public.inspection_confirmations_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  w       record;
  prev    record;
  stages  text[];
  v_stage text;
  ver     record;
  doc     record;
  insp    record;
begin
  if tg_op = 'DELETE' then
    -- 只放行 cascade(專案或工項已不存在);其他一律拒絕(留痕)
    if not exists (select 1 from public.projects where id = old.project_id)
       or not exists (select 1 from public.work_items where id = old.work_item_id) then
      return old;
    end if;
    perform public.fn_cq_raise_internal('VQ010', '監造確認紀錄不可刪除;請以撤銷留痕');
  end if;

  if tg_op = 'UPDATE' then
    -- RI set null(查驗／文件版本／被取代列被刪):只有這些參照欄位變 null、其餘不變 → 放行
    if (to_jsonb(new) - '{inspection_id,document_id,document_version_no,supersedes_id}'::text[])
         = (to_jsonb(old) - '{inspection_id,document_id,document_version_no,supersedes_id}'::text[])
       and (new.inspection_id is null or new.inspection_id = old.inspection_id)
       and (new.document_id is null or new.document_id = old.document_id)
       and (new.document_version_no is null or new.document_version_no = old.document_version_no)
       and (new.supersedes_id is null or new.supersedes_id = old.supersedes_id) then
      return new;
    end if;
    if old.status = 'active' and new.status = 'revoked' then
      if new.revoked_at is null then new.revoked_at := now(); end if;
      if new.reason is null or btrim(new.reason) = '' then
        perform public.fn_cq_raise_internal('VQ005', '撤銷確認必須填寫原因');
      end if;
      if new.revoked_by is null then new.revoked_by := auth.uid(); end if;
    elsif new.status is distinct from old.status then
      perform public.fn_cq_raise_internal('VQ010', '已撤銷的確認不可回復;請另簽新的累計確認');
    elsif new.reason is distinct from old.reason or new.revoked_at is distinct from old.revoked_at
          or new.revoked_by is distinct from old.revoked_by then
      perform public.fn_cq_raise_internal('VQ010', '監造確認紀錄不可改寫(只能撤銷);改量請另簽新的累計確認');
    end if;
    -- 其餘欄位一律不可變
    if new.project_id <> old.project_id or new.work_item_id <> old.work_item_id
       or new.batch_key <> old.batch_key or new.stage_key is distinct from old.stage_key
       or new.unit <> old.unit or new.qty_cum <> old.qty_cum or new.qty_delta <> old.qty_delta
       or new.basis <> old.basis or new.inspection_id is distinct from old.inspection_id
       or new.document_id is distinct from old.document_id
       or new.document_version_no is distinct from old.document_version_no
       or new.content_hash is distinct from old.content_hash
       or new.confirmed_by <> old.confirmed_by or new.confirmed_at <> old.confirmed_at
       or new.supersedes_id is distinct from old.supersedes_id
       or new.client_request_id is distinct from old.client_request_id
       or new.created_at <> old.created_at then
      perform public.fn_cq_raise_internal('VQ010', '監造確認紀錄的內容不可改寫');
    end if;
    return new;
  end if;

  -- INSERT
  if new.status <> 'active' then
    perform public.fn_cq_raise_internal('VQ005', '新確認紀錄必須是 active');
  end if;
  select id, project_id, unit, coalesce(is_leaf, false) as is_leaf, coalesce(is_billable, true) as is_billable,
         coalesce(is_rollup, false) as is_rollup
    into w from public.work_items where id = new.work_item_id;
  if not found then perform public.fn_cq_raise_internal('VQ008', '找不到工項'); end if;
  if w.project_id <> new.project_id then
    perform public.fn_cq_raise_internal('VQ008', '工項不屬於本專案(跨專案)');
  end if;
  if not (w.is_leaf and w.is_billable and not w.is_rollup) then
    perform public.fn_cq_raise_internal('VQ005', '只有末端且可計價的工項可簽確認量');
  end if;
  if w.unit is null or btrim(w.unit) = '' then
    perform public.fn_cq_raise_internal('VQ005', '工項沒有計量單位,不可簽確認量');
  end if;
  perform public.fn_cq_check_unit(new.unit, w.unit);
  new.batch_key := public.fn_cq_batch_key(new.batch_key);
  new.stage_key := nullif(public.fn_cq_normalize_text(new.stage_key), '');
  new.qty_cum   := public.fn_cq_qty(new.qty_cum, '確認量');
  stages := public.fn_cq_required_stages_internal(new.work_item_id);
  if cardinality(stages) = 0 then
    if new.stage_key is not null then
      perform public.fn_cq_raise_internal('VQ005', format('此工項沒有必要查驗階段,確認紀錄不可帶階段「%s」', new.stage_key));
    end if;
  elsif new.stage_key is null or not (new.stage_key = any(stages)) then
    perform public.fn_cq_raise_internal('VQ005',
      format('階段「%s」不在此工項的必要查驗階段 %s 之中', coalesce(new.stage_key, '(未填)'), array_to_string(stages, '、')));
  end if;
  if not public.fn_cq_can_confirm_internal(new.project_id, new.confirmed_by) then
    perform public.fn_cq_raise_internal('VQ001', '確認人必須是本案監造成員');
  end if;
  if new.basis = 'inspection' then
    if new.inspection_id is null then
      perform public.fn_cq_raise_internal('VQ005', '查驗依據的確認紀錄必須連結查驗');
    end if;
  end if;
  if new.inspection_id is not null then
    select project_id, work_item_id, status into insp from public.inspections where id = new.inspection_id;
    if not found or insp.project_id <> new.project_id then
      perform public.fn_cq_raise_internal('VQ008', '查驗不屬於本專案');
    end if;
    if insp.work_item_id is not null and insp.work_item_id <> new.work_item_id then
      perform public.fn_cq_raise_internal('VQ005', '查驗的工項與確認紀錄不同');
    end if;
    if insp.status = '待查驗' then
      perform public.fn_cq_raise_internal('VQ005', '查驗尚未判定,不可寫入確認量');
    end if;
  end if;
  if new.document_id is not null then
    select project_id, doc_type into doc from public.field_documents where id = new.document_id;
    if not found or doc.project_id <> new.project_id then
      perform public.fn_cq_raise_internal('VQ008', '文件不屬於本專案');
    end if;
    if doc.doc_type <> 'inspection_form' then
      perform public.fn_cq_raise_internal('VQ005', '確認紀錄只能追溯到監造查驗表單');
    end if;
    select content_hash into ver from public.field_document_versions
      where document_id = new.document_id and version_no = new.document_version_no;
    if not found or ver.content_hash is distinct from new.content_hash then
      perform public.fn_cq_raise_internal('VQ005', '確認紀錄的內容雜湊與文件版本不符');
    end if;
    if not exists (select 1 from public.field_document_signatures s
                   where s.document_id = new.document_id and s.version_no = new.document_version_no
                     and s.content_hash = new.content_hash and s.signer_id = new.confirmed_by) then
      perform public.fn_cq_raise_internal('VQ005', '文件版本尚未由確認人簽署');
    end if;
  end if;
  -- 累計語意:與同 (工項, 批次, 階段) 最新一筆 active 的差=本次增減;減量必填原因
  select id, qty_cum into prev from public.inspection_confirmations
    where project_id = new.project_id and work_item_id = new.work_item_id
      and batch_key = new.batch_key and stage_key is not distinct from new.stage_key and status = 'active'
    order by confirmed_at desc, created_at desc, id desc limit 1;
  if found then
    new.qty_delta := new.qty_cum - prev.qty_cum;
    new.supersedes_id := prev.id;
  else
    new.qty_delta := new.qty_cum;
    new.supersedes_id := null;
  end if;
  if new.qty_delta < 0 and (new.reason is null or btrim(new.reason) = '') then
    perform public.fn_cq_raise_internal('VQ005', format('累計確認量由 %s 減為 %s,減量必須填寫原因', prev.qty_cum, new.qty_cum));
  end if;
  new.revoked_at := null; new.revoked_by := null;
  return new;
end; $$;
drop trigger if exists inspection_confirmations_guard on public.inspection_confirmations;
create trigger inspection_confirmations_guard before insert or update or delete on public.inspection_confirmations
  for each row execute function public.inspection_confirmations_guard();

-- 4.2 valuation_item_sources:每列寫入即檢查不變量 2(含截止日);非草稿期只有內部重算可寫
create or replace function public.valuation_item_sources_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v       record;
  w       record;
  confs   public.cq_confirmation[];
  stages  text[];
  allocs  public.cq_allocation[];
  r       record;
  adj     record;
begin
  if tg_op = 'DELETE' then
    select id, project_id, status into v from public.valuations where id = old.valuation_id;
    if not found then return old; end if; -- 期別 cascade
    if not exists (select 1 from public.valuation_items where valuation_id = old.valuation_id and work_item_id = old.work_item_id) then
      return old; -- 明細 cascade(草稿明細刪除=釋放占用)
    end if;
    if v.status <> '草稿' and not public.fn_cq_internal() then
      perform public.fn_cq_raise_internal('VQ010', '非草稿期別的來源分配不可刪除');
    end if;
    if not public.fn_cq_internal() then
      perform public.fn_cq_raise_internal('VQ010', '來源分配只能由確認量重算寫入');
    end if;
    return old;
  end if;

  -- RI set null(確認紀錄／調整被 cascade 刪):只有參照欄位變 null → 放行
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - '{confirmation_id,adjustment_id}'::text[]) = (to_jsonb(old) - '{confirmation_id,adjustment_id}'::text[])
     and (new.confirmation_id is null or new.confirmation_id = old.confirmation_id)
     and (new.adjustment_id is null or new.adjustment_id = old.adjustment_id) then
    return new;
  end if;
  select id, project_id, period_no, period_end, status into v from public.valuations where id = new.valuation_id;
  if not found then perform public.fn_cq_raise_internal('VQ008', '找不到估驗期別'); end if;
  if new.project_id <> v.project_id then perform public.fn_cq_raise_internal('VQ008', '來源分配與期別不同專案'); end if;
  select project_id, unit into w from public.work_items where id = new.work_item_id;
  if not found or w.project_id <> v.project_id then perform public.fn_cq_raise_internal('VQ008', '工項不屬於本專案(跨專案)'); end if;
  if not public.fn_cq_internal() then
    perform public.fn_cq_raise_internal('VQ010', '來源分配只能由確認量重算寫入');
  end if;
  if v.status <> '草稿' and tg_op = 'INSERT' and new.kind not in ('legacy', 'confirmation') then
    perform public.fn_cq_raise_internal('VQ010', '非草稿期別不可新增來源分配');
  end if;
  if tg_op = 'UPDATE' then
    if v.status <> '草稿' then
      perform public.fn_cq_raise_internal('VQ010', '非草稿期別的來源分配不可改寫');
    end if;
    if new.valuation_id <> old.valuation_id or new.work_item_id <> old.work_item_id or new.kind <> old.kind then
      perform public.fn_cq_raise_internal('VQ010', '來源分配的期別／工項／種類不可改');
    end if;
  end if;
  new.batch_key := public.fn_cq_batch_key(new.batch_key);
  new.qty       := public.fn_cq_qty(new.qty, '分配量', true);
  if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.kind = 'confirmation' and new.qty <= 0 then
    perform public.fn_cq_raise_internal('VQ005', '確認來源的分配量必須為正');
  end if;
  if new.kind = 'clawback' and new.qty >= 0 then
    perform public.fn_cq_raise_internal('VQ005', '扣回來源的分配量必須為負');
  end if;
  if new.kind in ('clawback', 'adjustment') then
    if new.adjustment_id is null then
      perform public.fn_cq_raise_internal('VQ005', '扣回／調整來源必須連結估驗調整');
    end if;
    select project_id, work_item_id into adj from public.valuation_adjustments where id = new.adjustment_id;
    if not found or adj.project_id <> v.project_id or adj.work_item_id <> new.work_item_id then
      perform public.fn_cq_raise_internal('VQ008', '估驗調整與來源分配的專案／工項不符');
    end if;
  end if;
  if new.kind in ('confirmation', 'clawback') then
    confs  := public.fn_cq_confirmations_internal(v.project_id, new.work_item_id);
    stages := public.fn_cq_required_stages_internal(new.work_item_id);
    -- 不變量 2(全部期別、現況):含本列後,本列批次的 available ≥ 0(真實分配;作廢調整不產生可用量)
    allocs := public.fn_cq_allocations_internal(v.project_id, new.work_item_id, null,
                case when tg_op = 'UPDATE' then old.id else null end)
              || (new.batch_key, new.qty)::public.cq_allocation;
    for r in select * from public.fn_batch_allocation_check(confs, stages, w.unit, allocs) x
             where x.batch_key = new.batch_key and x.available_qty < 0 loop
      perform public.fn_cq_raise_internal('VQ004',
        format('批次「%s」的有效確認量 %s 少於全部期別分配 %s(同一批次不可重複計價或缺必要階段)', r.batch_key, r.effective_qty, r.allocated_qty),
        jsonb_build_array(jsonb_build_object('code', 'batch_over_allocated', 'work_item_id', new.work_item_id,
          'batch_key', r.batch_key, 'effective_qty', r.effective_qty, 'allocated_qty', r.allocated_qty)));
    end loop;
    -- 截止日:period_no ≤ 本期的分配 ≤ E(W,b,period_end)
    if new.kind = 'confirmation' then
      allocs := public.fn_cq_allocations_internal(v.project_id, new.work_item_id, v.period_no,
                  case when tg_op = 'UPDATE' then old.id else null end)
                || (new.batch_key, new.qty)::public.cq_allocation;
      for r in
        with e as (select * from public.fn_effective_by_batch(confs, stages, w.unit, public.fn_cq_as_of(v.period_end))),
             a as (select x.batch_key, sum(x.qty) as qty from unnest(allocs) x group by x.batch_key)
        select a.batch_key, coalesce(e.qty, 0) as eff, a.qty as alloc
        from a left join e on e.batch_key = a.batch_key
        where a.batch_key = new.batch_key and a.qty > coalesce(e.qty, 0)
      loop
        perform public.fn_cq_raise_internal('VQ004',
          format('批次「%s」截至 %s 的有效確認量 %s 少於累計分配 %s(截止日不符)', r.batch_key, coalesce(v.period_end::text, '不設截止'), r.eff, r.alloc),
          jsonb_build_array(jsonb_build_object('code', 'cutoff', 'work_item_id', new.work_item_id, 'batch_key', r.batch_key)));
      end loop;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists valuation_item_sources_guard on public.valuation_item_sources;
create trigger valuation_item_sources_guard before insert or update or delete on public.valuation_item_sources
  for each row execute function public.valuation_item_sources_guard();

-- 草稿期刪除(或其扣回來源被釋放)時,已套用的調整回到 pending,不會因刪草稿而消失
create or replace function public.valuation_item_sources_after_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prev text;
begin
  if old.kind = 'clawback' and old.adjustment_id is not null then
    v_prev := public.fn_cq_set_internal(true);
    -- 與 valuations 的 RI set null 順序不定:applied_valuation_id 可能已被清成 null
    update public.valuation_adjustments
      set status = 'pending', applied_valuation_id = null, applied_at = null
      where id = old.adjustment_id and status = 'applied'
        and (applied_valuation_id = old.valuation_id or applied_valuation_id is null)
        and exists (select 1 from public.projects where id = old.project_id);
    perform public.fn_cq_restore_internal(v_prev);
  end if;
  return old;
end; $$;
drop trigger if exists valuation_item_sources_after_delete on public.valuation_item_sources;
create trigger valuation_item_sources_after_delete after delete on public.valuation_item_sources
  for each row execute function public.valuation_item_sources_after_delete();

-- 4.3 valuation_adjustments:append-only 加狀態;只有內部流程可寫
create or replace function public.valuation_adjustments_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.projects where id = old.project_id)
       or not exists (select 1 from public.work_items where id = old.work_item_id) then
      return old;
    end if;
    perform public.fn_cq_raise_internal('VQ010', '估驗調整不可刪除(append-only)');
  end if;
  -- RI set null(被更正的期別／來源確認／併入的草稿期被 cascade 刪):只有參照欄位變 null → 放行
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - '{origin_valuation_id,source_confirmation_id,applied_valuation_id}'::text[])
         = (to_jsonb(old) - '{origin_valuation_id,source_confirmation_id,applied_valuation_id}'::text[])
     and (new.origin_valuation_id is null or new.origin_valuation_id = old.origin_valuation_id)
     and (new.source_confirmation_id is null or new.source_confirmation_id = old.source_confirmation_id)
     and (new.applied_valuation_id is null or new.applied_valuation_id = old.applied_valuation_id) then
    return new;
  end if;
  if not public.fn_cq_internal() then
    perform public.fn_cq_raise_internal('VQ010', '估驗調整只能由撤銷／調整流程寫入');
  end if;
  if tg_op = 'INSERT' then
    new.qty_delta := public.fn_cq_qty(new.qty_delta, '調整量', true);
    new.batch_key := public.fn_cq_batch_key(new.batch_key);
    if new.created_by is null then new.created_by := auth.uid(); end if;
    if not exists (select 1 from public.work_items w where w.id = new.work_item_id and w.project_id = new.project_id) then
      perform public.fn_cq_raise_internal('VQ008', '工項不屬於本專案(跨專案)');
    end if;
    return new;
  end if;
  -- UPDATE:只允許狀態轉移 pending→applied、pending→void、applied→pending(草稿期刪除釋放)
  if new.project_id <> old.project_id or new.work_item_id <> old.work_item_id or new.batch_key <> old.batch_key
     or new.qty_delta <> old.qty_delta or new.reason <> old.reason
     or new.origin_valuation_id is distinct from old.origin_valuation_id
     or new.source_confirmation_id is distinct from old.source_confirmation_id
     or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    perform public.fn_cq_raise_internal('VQ010', '估驗調整的內容不可改寫');
  end if;
  if not ((old.status = 'pending' and new.status in ('applied', 'void'))
          or (old.status = 'applied' and new.status = 'pending')) then
    perform public.fn_cq_raise_internal('VQ010', format('估驗調整狀態 %s → %s 不允許', old.status, new.status));
  end if;
  return new;
end; $$;
drop trigger if exists valuation_adjustments_guard on public.valuation_adjustments;
create trigger valuation_adjustments_guard before insert or update or delete on public.valuation_adjustments
  for each row execute function public.valuation_adjustments_guard();

-- 4.4 work_item_pricing_basis:專案一致性
create or replace function public.work_item_pricing_basis_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.work_items w where w.id = new.work_item_id and w.project_id = new.project_id) then
    perform public.fn_cq_raise_internal('VQ008', '工項不屬於本專案(跨專案)');
  end if;
  return new;
end; $$;
drop trigger if exists work_item_pricing_basis_guard on public.work_item_pricing_basis;
create trigger work_item_pricing_basis_guard before insert or update on public.work_item_pricing_basis
  for each row execute function public.work_item_pricing_basis_guard();

-- 4.5 valuation_items:金額／百分比由 DB 算、超契約量拒絕、非草稿期凍結、直接寫入標 legacy
create or replace function public.valuation_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v  record;
  w  record;
  qc numeric;
begin
  select id, project_id, status into v from public.valuations where id = coalesce(new.valuation_id, old.valuation_id);
  if not found then return coalesce(new, old); end if; -- 期別 cascade(專案刪除／草稿期刪除)

  -- 凍結類拒絕沿用 P0001(業務規則 raise;前端 friendlyError 原樣顯示,既有 pgTAP 斷言 P0001)
  if tg_op = 'DELETE' then
    if v.status <> '草稿' then
      raise exception '估驗已%,明細不可刪除;請由監造退回後重編', v.status;
    end if;
    return old;
  end if;

  select project_id, unit_price into w from public.work_items where id = new.work_item_id;
  if not found then perform public.fn_cq_raise_internal('VQ008', '找不到工項'); end if;
  if w.project_id <> v.project_id then perform public.fn_cq_raise_internal('VQ008', '工項不屬於本專案(跨專案)'); end if;

  if v.status <> '草稿' then
    if tg_op = 'INSERT' then
      raise exception '估驗已%,不可追加明細', v.status;
    end if;
    -- 已送審／核定／請款:數量、金額、依據永不改寫(含 service role);只有備註可改,
    -- 以及內部流程(補證)可把 backing 由 legacy 改為 confirmed
    if new.valuation_id <> old.valuation_id or new.work_item_id <> old.work_item_id
       or new.cum_qty is distinct from old.cum_qty or new.cum_pct is distinct from old.cum_pct
       or new.amount_cum is distinct from old.amount_cum or new.amount_period is distinct from old.amount_period
       or new.source is distinct from old.source
       or (new.backing is distinct from old.backing and not public.fn_cq_internal()) then
      raise exception '估驗已%,明細數量與金額不可改寫;更正走估驗調整(撤銷確認→扣回)', v.status;
    end if;
    if new.note is distinct from old.note and auth.uid() is not null
       and not public.admin_override(v.project_id) and public.my_org_type() <> 'supervisor' then
      raise exception '已核定估驗的明細備註只有監造可修正';
    end if;
    return new;
  end if;

  -- 草稿:數量驗證、金額由 DB 計算(客戶端值忽略)
  new.cum_qty := public.fn_cq_qty(coalesce(new.cum_qty, 0), '累計量');
  qc := public.fn_cq_contract_qty_internal(new.work_item_id);
  if new.cum_qty > qc then
    perform public.fn_cq_raise_internal('VQ005', format('累計量 %s 超過契約量 %s', new.cum_qty, qc));
  end if;
  new.amount_cum := public.fn_valuation_amount(new.cum_qty, w.unit_price);
  new.cum_pct    := case when qc > 0 then round(new.cum_qty / qc * 100, 4) else null end;
  if not public.fn_cq_internal() then
    -- 非重算路徑寫入的數量沒有來源依據(舊前端／直接 REST);送審時不變量 1 會擋
    if tg_op = 'INSERT' or new.cum_qty is distinct from old.cum_qty then
      new.backing := 'legacy';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists valuation_items_guard on public.valuation_items;
create trigger valuation_items_guard before insert or update or delete on public.valuation_items
  for each row execute function public.valuation_items_guard();

-- 4.6 valuations:BEFORE(登入者只能建草稿;狀態機與角色;欄位規則)＋AFTER(三個檢查點,讀已更新的列,所有寫入者)
create or replace function public.valuations_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  org     text;
  is_user boolean := auth.uid() is not null;
  is_adm  boolean;
begin
  if tg_op = 'INSERT' then
    if is_user and new.status <> '草稿' then
      perform public.fn_cq_raise_internal('VQ002', format('估驗期別只能以草稿建立(狀態 %s 須經送審／核定流程)', new.status));
    end if;
    if is_user and (new.recheck_required or new.recheck_note is not null) then
      perform public.fn_cq_raise_internal('VQ010', 'recheck 欄位由系統維護,不可自行設定');
    end if;
    return new;
  end if;

  is_adm := is_user and public.admin_override(new.project_id);
  org := case when is_user then public.my_org_type() else null end;

  -- ── 角色與狀態機(登入者;admin_override 只放行角色,不放行數量) ──
  if is_user and new.status is distinct from old.status then
    -- 跨越已核定／已請款一律監造(既有規則;P0001 沿用)
    if (new.status in ('已核定', '已請款') or old.status in ('已核定', '已請款'))
       and not (org = 'supervisor' or is_adm) then
      raise exception '估驗核定/退回核定僅監造可執行';
    end if;
    if old.status = '草稿' and new.status = '監造審核' then
      if not (org = 'contractor' or is_adm) then
        raise exception '送監造審核僅施工廠商可執行';
      end if;
    elsif old.status = '監造審核' and new.status = '草稿' then
      if not (org = 'supervisor' or is_adm) then
        raise exception '退回估驗僅監造可執行';
      end if;
    elsif (old.status = '監造審核' and new.status = '已核定')
       or (old.status = '已核定' and new.status = '草稿')
       or (old.status = '已核定' and new.status = '已請款')
       or (old.status = '已請款' and new.status = '已核定') then
      null; -- 角色已在上面檢查
    else
      perform public.fn_cq_raise_internal('VQ002', format('估驗狀態 %s → %s 不是允許的轉移', old.status, new.status));
    end if;
  end if;
  if is_user and org = 'owner' and not is_adm and (
       new.period_no      is distinct from old.period_no
    or new.period_start   is distinct from old.period_start
    or new.period_end     is distinct from old.period_end
    or new.valuation_date is distinct from old.valuation_date
    or new.retention_pct  is distinct from old.retention_pct
    or new.status         is distinct from old.status
    or new.note           is distinct from old.note
  ) then
    raise exception '機關僅可登錄請款/撥款欄位(invoice_date / paid_date / paid_amount)';
  end if;
  -- 期別欄位只在草稿可改(登入者);recheck 欄位只由內部重算維護
  if is_user and old.status <> '草稿' and (
       new.period_no is distinct from old.period_no
    or new.period_start is distinct from old.period_start
    or new.period_end is distinct from old.period_end) then
    perform public.fn_cq_raise_internal('VQ010', format('估驗已%s,期別與截止日不可再改', old.status));
  end if;
  if is_user and not public.fn_cq_internal()
     and (new.recheck_required is distinct from old.recheck_required or new.recheck_note is distinct from old.recheck_note) then
    perform public.fn_cq_raise_internal('VQ010', 'recheck 欄位由系統維護,不可自行改寫');
  end if;
  return new;
end; $$;
drop trigger if exists valuations_guard on public.valuations;
create trigger valuations_guard before insert or update on public.valuations
  for each row execute function public.valuations_guard();

-- 檢查點:AFTER ROW(列已更新,檢查函式讀到的 period_end／status 是新值);raise 即整個敘述回滾(含同敘述的稽核列)。
-- 所有寫入者一體適用(service role、admin_override 都沒有數量 bypass)。
create or replace function public.valuations_checkpoint_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  checkpoint text;
  label      text;
  vio        jsonb;
  summary    text;
begin
  if new.status is distinct from old.status and new.status = '監造審核' then
    checkpoint := 'review'; label := '送審';
  elsif new.status is distinct from old.status and new.status = '已核定' then
    checkpoint := 'approve'; label := '核定';
  elsif (new.status is distinct from old.status and new.status = '已請款')
     or (new.invoice_date is not null and old.invoice_date is null) then
    checkpoint := 'invoice'; label := '請款';
  end if;
  if checkpoint is null then return new; end if;
  vio := public.fn_cq_period_check_internal(new.id, checkpoint);
  if jsonb_array_length(vio) > 0 then
    select string_agg(x.msg, ';') into summary
    from (select coalesce(e ->> 'message', e ->> 'code') as msg
          from jsonb_array_elements(vio) e limit 3) x;
    perform public.fn_cq_raise_internal('VQ004',
      format('估驗第 %s 期%s被擋(%s 項不符):%s', new.period_no, label, jsonb_array_length(vio), summary), vio);
  end if;
  return new;
end; $$;
drop trigger if exists valuations_checkpoint_guard on public.valuations;
create trigger valuations_checkpoint_guard after update on public.valuations
  for each row execute function public.valuations_checkpoint_guard();

-- 4.7 work_items:有 active 確認的工項不可刪、不可改單位(cascade 自專案刪除放行)
create or replace function public.work_items_confirmation_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.projects where id = old.project_id) then return old; end if;
    if exists (select 1 from public.inspection_confirmations c where c.work_item_id = old.id and c.status = 'active') then
      perform public.fn_cq_raise_internal('VQ010', format('工項「%s」已有有效的監造確認,不可刪除或重匯標單;請先撤銷確認', old.description));
    end if;
    return old;
  end if;
  if public.fn_cq_normalize_text(new.unit) <> public.fn_cq_normalize_text(old.unit)
     and exists (select 1 from public.inspection_confirmations c where c.work_item_id = new.id and c.status = 'active') then
    perform public.fn_cq_raise_internal('VQ010', format('工項「%s」已有有效的監造確認,單位不可變更;請先撤銷確認', old.description));
  end if;
  return new;
end; $$;
drop trigger if exists work_items_confirmation_guard on public.work_items;
create trigger work_items_confirmation_guard before update or delete on public.work_items
  for each row execute function public.work_items_confirmation_guard();

-- 4.8 inspection_points:改變有 active 確認之工項的必要階段集合=靜默改變有效量,拒絕(先撤銷)
create or replace function public.inspection_points_stage_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_c text; new_c text; wi uuid;
begin
  old_c := case when tg_op <> 'INSERT' and old.point_type = 'H' and old.required_for_billing
                then nullif(public.fn_cq_normalize_text(old.stage_key), '') end;
  new_c := case when tg_op <> 'DELETE' and new.point_type = 'H' and new.required_for_billing
                then nullif(public.fn_cq_normalize_text(new.stage_key), '') end;
  if tg_op <> 'DELETE' then
    new.stage_key := nullif(public.fn_cq_normalize_text(new.stage_key), '');
  end if;
  for wi in select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.work_item_id end,
      case when tg_op <> 'DELETE' then new.work_item_id end]) x where x is not null loop
    if exists (select 1 from public.inspection_confirmations c where c.work_item_id = wi and c.status = 'active')
       and (old_c is distinct from new_c
            or (tg_op = 'UPDATE' and old.work_item_id is distinct from new.work_item_id and (old_c is not null or new_c is not null))) then
      perform public.fn_cq_raise_internal('VQ010', '工項已有有效的監造確認,不可變更必要查驗階段;請先撤銷確認再調整 ITP');
    end if;
  end loop;
  return coalesce(new, old);
end; $$;
drop trigger if exists inspection_points_stage_guard on public.inspection_points;
create trigger inspection_points_stage_guard before insert or update or delete on public.inspection_points
  for each row execute function public.inspection_points_stage_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 內部重算流程(分配到上限、設定累計、撤銷後的收斂)
-- ═══════════════════════════════════════════════════════════════════════════
-- 重算本期某工項累計 = 前期累計 + Σ本期來源;並向後推到後續草稿期(監造審核／已核定不動,由檢查點擋)
create or replace function public.fn_cq_recompute_item_internal(p_valuation_id uuid, p_work_item uuid, p_backing text default null)
returns numeric language plpgsql security definer set search_path = public as $fn$
declare
  v      record;
  v_prev text;
  v_sum  numeric;
  v_cum  numeric;
  later  record;
begin
  select id, project_id, period_no into v from public.valuations where id = p_valuation_id;
  v_prev := public.fn_cq_set_internal(true);
  select coalesce(sum(qty), 0) into v_sum from public.valuation_item_sources
    where valuation_id = p_valuation_id and work_item_id = p_work_item;
  v_cum := public.fn_cq_prev_cum_internal(v.project_id, p_work_item, v.period_no) + v_sum;
  if exists (select 1 from public.valuation_items where valuation_id = p_valuation_id and work_item_id = p_work_item) then
    update public.valuation_items
      set cum_qty = v_cum, backing = coalesce(p_backing, backing)
      where valuation_id = p_valuation_id and work_item_id = p_work_item;
  elsif v_sum <> 0 then
    insert into public.valuation_items (valuation_id, work_item_id, cum_qty, source, backing)
      values (p_valuation_id, p_work_item, v_cum, 'manual', coalesce(p_backing, 'confirmed'));
  end if;
  -- 後續草稿期:自己的來源不變,只因前期累計改變而重算
  for later in
    select x.id from public.valuations x
    join public.valuation_items vi on vi.valuation_id = x.id and vi.work_item_id = p_work_item
    where x.project_id = v.project_id and x.period_no > v.period_no and x.status = '草稿'
    order by x.period_no
  loop
    select coalesce(sum(qty), 0) into v_sum from public.valuation_item_sources
      where valuation_id = later.id and work_item_id = p_work_item;
    update public.valuation_items vi
      set cum_qty = public.fn_cq_prev_cum_internal(v.project_id, p_work_item, (select period_no from public.valuations where id = later.id)) + v_sum
      where vi.valuation_id = later.id and vi.work_item_id = p_work_item
        and vi.cum_qty is distinct from public.fn_cq_prev_cum_internal(v.project_id, p_work_item, (select period_no from public.valuations where id = later.id)) + v_sum;
  end loop;
  perform public.fn_cq_restore_internal(v_prev);
  return v_cum;
end $fn$;
revoke all on function public.fn_cq_recompute_item_internal(uuid, uuid, text) from public, anon, authenticated;

-- 依 FIFO 把 p_wanted 的確認量分配進本期(只增不減);回傳實際分配量
create or replace function public.fn_cq_allocate_internal(p_valuation_id uuid, p_work_item uuid, p_wanted numeric)
returns numeric language plpgsql security definer set search_path = public as $fn$
declare
  v       record;
  w       record;
  confs   public.cq_confirmation[];
  stages  text[];
  allocs  public.cq_allocation[];
  r       record;
  v_prev  text;
  v_total numeric := 0;
  v_conf  uuid;
begin
  if p_wanted is null or p_wanted <= 0 then return 0; end if;
  select id, project_id, period_no, period_end into v from public.valuations where id = p_valuation_id;
  select unit into w from public.work_items where id = p_work_item;
  confs  := public.fn_cq_confirmations_internal(v.project_id, p_work_item);
  stages := public.fn_cq_required_stages_internal(p_work_item);
  allocs := public.fn_cq_allocations_internal(v.project_id, p_work_item, null, null);
  v_prev := public.fn_cq_set_internal(true);
  -- 明細列先存在(來源 FK 指向明細)
  if not exists (select 1 from public.valuation_items where valuation_id = p_valuation_id and work_item_id = p_work_item) then
    insert into public.valuation_items (valuation_id, work_item_id, cum_qty, source, backing)
      values (p_valuation_id, p_work_item,
              public.fn_cq_prev_cum_internal(v.project_id, p_work_item, v.period_no), 'manual', 'confirmed');
  end if;
  for r in select * from public.fn_allocate_fifo(confs, stages, w.unit, public.fn_cq_as_of(v.period_end), allocs, p_wanted) loop
    select c.id into v_conf from public.inspection_confirmations c
      where c.project_id = v.project_id and c.work_item_id = p_work_item and c.batch_key = r.batch_key and c.status = 'active'
      order by c.confirmed_at desc, c.created_at desc limit 1;
    insert into public.valuation_item_sources (project_id, valuation_id, work_item_id, batch_key, qty, kind, confirmation_id)
      values (v.project_id, p_valuation_id, p_work_item, r.batch_key, r.qty, 'confirmation', v_conf)
      on conflict (valuation_id, work_item_id, batch_key, kind)
      do update set qty = public.valuation_item_sources.qty + excluded.qty, confirmation_id = excluded.confirmation_id;
    v_total := v_total + r.qty;
  end loop;
  perform public.fn_cq_restore_internal(v_prev);
  return v_total;
end $fn$;
revoke all on function public.fn_cq_allocate_internal(uuid, uuid, numeric) from public, anon, authenticated;

-- 分配到上限(自動同步與 sync RPC 共用):wanted = cap − 本期既有確認分配
create or replace function public.fn_cq_allocate_to_cap_internal(p_valuation_id uuid, p_work_item uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v      record;
  st     public.cq_item_state;
  added  numeric := 0;
  wanted numeric;
begin
  select id, project_id into v from public.valuations where id = p_valuation_id;
  perform public.fn_cq_lock_internal(v.project_id, p_work_item);
  st := public.fn_cq_item_state_internal(v.project_id, p_work_item, p_valuation_id);
  if st.billable then
    wanted := st.headroom;   -- 已過依據閘門(總價類缺依據=0)、契約量與全域可用量
    added  := public.fn_cq_allocate_internal(p_valuation_id, p_work_item, wanted);
  end if;
  perform public.fn_cq_recompute_item_internal(p_valuation_id, p_work_item, 'confirmed');
  st := public.fn_cq_item_state_internal(v.project_id, p_work_item, p_valuation_id);
  return jsonb_build_object('work_item_id', p_work_item, 'prev_cum', st.prev_cum, 'cum_qty', st.cum_qty,
    'added', added, 'cap', st.cap, 'headroom', st.headroom, 'effective', st.effective_cutoff, 'billed', st.billed,
    'reserved', st.reserved, 'basis', st.basis);
end $fn$;
revoke all on function public.fn_cq_allocate_to_cap_internal(uuid, uuid) from public, anon, authenticated;

-- 自動同步的目標草稿期:最早的草稿且(無截止日或截止日 ≥ 確認日的台北日曆日)
create or replace function public.fn_cq_target_draft_internal(p_project uuid, p_confirmed_at timestamptz)
returns uuid language sql stable security definer set search_path = public as $fn$
  select id from public.valuations
  where project_id = p_project and status = '草稿'
    and (period_end is null or period_end >= (p_confirmed_at at time zone 'Asia/Taipei')::date)
  order by period_no limit 1;
$fn$;
revoke all on function public.fn_cq_target_draft_internal(uuid, timestamptz) from public, anon, authenticated;

-- 撤銷／減量後的收斂:逐批次依 period_no FIFO 保留,超出的部分——草稿縮減、監造審核標記 recheck、已核定建立 pending 調整
create or replace function public.fn_cq_reconcile_internal(p_project uuid, p_work_item uuid, p_reason text, p_confirmation uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  w        record;
  confs    public.cq_confirmation[];
  stages   text[];
  eff      record;
  s        record;
  running  numeric;
  keep     numeric;
  excess   numeric;
  existing numeric;
  v_prev   text;
  effects  jsonb := '[]'::jsonb;
  touched  uuid[] := '{}';
  vid      uuid;
begin
  perform public.fn_cq_lock_internal(p_project, p_work_item);
  select unit into w from public.work_items where id = p_work_item;
  confs  := public.fn_cq_confirmations_internal(p_project, p_work_item);
  stages := public.fn_cq_required_stages_internal(p_work_item);
  v_prev := public.fn_cq_set_internal(true);
  for eff in
    with e as (select * from public.fn_effective_by_batch(confs, stages, w.unit, null)),
         b as (select distinct batch_key from public.valuation_item_sources
               where project_id = p_project and work_item_id = p_work_item and kind in ('confirmation', 'clawback'))
    select b.batch_key, coalesce(e.qty, 0) as qty from b left join e on e.batch_key = b.batch_key
  loop
    running := 0;
    for s in
      select src.id, src.valuation_id, src.qty, src.kind, v.status, v.period_no
      from public.valuation_item_sources src join public.valuations v on v.id = src.valuation_id
      where src.project_id = p_project and src.work_item_id = p_work_item and src.batch_key = eff.batch_key
        and src.kind in ('confirmation', 'clawback')
      order by v.period_no, src.created_at, src.id
    loop
      if s.kind = 'clawback' then
        running := running + s.qty; -- 扣回為負,先前的超額已被扣回
        continue;
      end if;
      keep   := greatest(0, least(s.qty, eff.qty - running));
      excess := s.qty - keep;
      running := running + s.qty;
      if excess <= 0 then continue; end if;
      if s.status = '草稿' then
        if keep = 0 then
          delete from public.valuation_item_sources where id = s.id;
        else
          update public.valuation_item_sources set qty = keep where id = s.id;
        end if;
        touched := touched || s.valuation_id;
        effects := effects || jsonb_build_object('valuation_id', s.valuation_id, 'batch_key', eff.batch_key,
          'action', 'reduced', 'qty', excess);
        perform public.record_audit_event(p_project, 'valuation.allocation_reduced', 'valuation', s.valuation_id, 'reduced',
          null, null, jsonb_build_object('work_item_id', p_work_item, 'batch_key', eff.batch_key, 'qty', excess,
            'confirmation_id', p_confirmation, 'reason', p_reason), null);
      elsif s.status = '監造審核' then
        update public.valuations
          set recheck_required = true,
              recheck_note = concat_ws(E'\n', recheck_note,
                format('工項 %s 批次「%s」超出有效確認量 %s(%s)', p_work_item, eff.batch_key, excess, coalesce(p_reason, '')))
          where id = s.valuation_id;
        effects := effects || jsonb_build_object('valuation_id', s.valuation_id, 'batch_key', eff.batch_key,
          'action', 'recheck_flagged', 'qty', excess);
        perform public.record_audit_event(p_project, 'valuation.recheck_flagged', 'valuation', s.valuation_id, 'recheck_flagged',
          null, null, jsonb_build_object('work_item_id', p_work_item, 'batch_key', eff.batch_key, 'qty', excess,
            'confirmation_id', p_confirmation, 'reason', p_reason), null);
      else
        -- 已核定／已請款:保留歷史,建立 pending 調整(已建立的 pending／applied 調整先抵掉)
        -- 已建立的調整(含機關作廢=接受該量已計價)都算已處理,不重複建立
        select coalesce(-sum(qty_delta), 0) into existing from public.valuation_adjustments
          where origin_valuation_id = s.valuation_id and work_item_id = p_work_item and batch_key = eff.batch_key
            and status in ('pending', 'applied', 'void');
        -- 已核定期在此批次的超額須以「本期以前的累計超額」計:running − 已扣回 − 之前已建立的調整
        excess := excess - existing;
        if excess > 0 then
          insert into public.valuation_adjustments (project_id, work_item_id, batch_key, qty_delta, reason,
            source_confirmation_id, origin_valuation_id, status)
            values (p_project, p_work_item, eff.batch_key, -excess,
              coalesce(nullif(btrim(p_reason), ''), '監造確認撤銷／減量'), p_confirmation, s.valuation_id, 'pending')
            returning id into vid;
          effects := effects || jsonb_build_object('valuation_id', s.valuation_id, 'batch_key', eff.batch_key,
            'action', 'adjustment_created', 'qty', -excess, 'adjustment_id', vid);
          perform public.record_audit_event(p_project, 'valuation_adjustment.created', 'valuation_adjustment', vid, 'created',
            null, null, jsonb_build_object('work_item_id', p_work_item, 'batch_key', eff.batch_key, 'qty_delta', -excess,
              'origin_valuation_id', s.valuation_id, 'confirmation_id', p_confirmation, 'reason', p_reason), null);
        end if;
      end if;
    end loop;
  end loop;
  -- 被縮減的草稿期重算累計(含後續草稿)
  for vid in select distinct x from unnest(touched) x loop
    perform public.fn_cq_recompute_item_internal(vid, p_work_item, null);
  end loop;
  perform public.fn_cq_restore_internal(v_prev);
  return effects;
end $fn$;
revoke all on function public.fn_cq_reconcile_internal(uuid, uuid, text, uuid) from public, anon, authenticated;

-- 確認紀錄變動 → 收斂(減量／撤銷)＋自動同步到適用草稿期(新增確認時)
create or replace function public.inspection_confirmations_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target uuid;
  v_prev text;
begin
  if tg_op = 'UPDATE' and not (old.status = 'active' and new.status = 'revoked') then
    return new;
  end if;
  perform public.fn_cq_reconcile_internal(new.project_id, new.work_item_id,
    case when tg_op = 'UPDATE' then new.reason else new.reason end, new.id);
  if tg_op = 'INSERT' and new.qty_delta > 0
     and coalesce(current_setting('pmis.cq_defer_allocate', true), '') <> '1' then
    target := public.fn_cq_target_draft_internal(new.project_id, new.confirmed_at);
    if target is not null then
      v_prev := public.fn_cq_set_internal(true);
      perform public.fn_cq_allocate_to_cap_internal(target, new.work_item_id);
      perform public.fn_cq_restore_internal(v_prev);
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists inspection_confirmations_after_change on public.inspection_confirmations;
create trigger inspection_confirmations_after_change after insert or update of status on public.inspection_confirmations
  for each row execute function public.inspection_confirmations_after_change();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. RPC(security definer;明示 grant 給 authenticated;pgTAP 允許清單同步)
-- ═══════════════════════════════════════════════════════════════════════════
-- 共用前置:登入、鎖逾時、期別存取
create or replace function public.fn_cq_rpc_valuation_internal(p_valuation_id uuid, p_require_write boolean, p_require_draft boolean)
returns public.valuations language plpgsql security definer set search_path = public as $fn$
declare v public.valuations;
begin
  if auth.uid() is null then perform public.fn_cq_raise_internal('VQ001', '請先登入'); end if;
  perform set_config('lock_timeout', '5s', true);
  select * into v from public.valuations where id = p_valuation_id for update;
  if not found or v.project_id not in (select public.my_project_ids()) then
    perform public.fn_cq_raise_internal('VQ008', '找不到估驗期別或無權存取');
  end if;
  if p_require_write and not public.can_write(v.project_id) then
    perform public.fn_cq_raise_internal('VQ001', '只有施工廠商可編輯估驗草稿');
  end if;
  if p_require_draft and v.status <> '草稿' then
    perform public.fn_cq_raise_internal('VQ010', format('估驗已%s,不可再變更數量;請由監造退回', v.status));
  end if;
  return v;
exception when lock_not_available then
  perform public.fn_cq_raise_internal('VQ007', '估驗期別正被其他操作使用,請稍後再試');
end $fn$;
revoke all on function public.fn_cq_rpc_valuation_internal(uuid, boolean, boolean) from public, anon, authenticated;

-- 6.1 同步可估驗明細到草稿期(冪等;分配到上限;套用待處理扣回;清除 recheck)
create or replace function public.sync_valuation_from_confirmations(p_valuation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v        public.valuations;
  v_prev   text;
  wi       uuid;
  items    jsonb := '[]'::jsonb;
  is_first boolean;
  adj      record;
  applied  int := 0;
begin
  v := public.fn_cq_rpc_valuation_internal(p_valuation_id, true, true);
  v_prev := public.fn_cq_set_internal(true);
  is_first := not exists (select 1 from public.valuations x
                          where x.project_id = v.project_id and x.status = '草稿' and x.period_no < v.period_no);
  for wi in
    select distinct x from (
      select c.work_item_id as x from public.inspection_confirmations c where c.project_id = v.project_id and c.status = 'active'
      union select vi.work_item_id from public.valuation_items vi where vi.valuation_id = v.id
      union select a.work_item_id from public.valuation_adjustments a where a.project_id = v.project_id and a.status = 'pending'
    ) u order by x
  loop
    perform public.fn_cq_lock_internal(v.project_id, wi);
    -- 舊前端寫入的無依據數量(legacy)在重算時以來源為準
    delete from public.valuation_item_sources where valuation_id = v.id and work_item_id = wi and kind = 'legacy';
    -- 先收斂:監造審核期被退回後,超出有效量的分配在這裡縮減(撤銷／減量當時只標 recheck、不動送審中的數字)
    perform public.fn_cq_reconcile_internal(v.project_id, wi, '同步重算', null);
    -- 待處理扣回:併入最早的草稿期
    if is_first then
      for adj in select * from public.valuation_adjustments
                 where project_id = v.project_id and work_item_id = wi and status = 'pending' order by created_at, id loop
        if not exists (select 1 from public.valuation_items where valuation_id = v.id and work_item_id = wi) then
          insert into public.valuation_items (valuation_id, work_item_id, cum_qty, source, backing)
            values (v.id, wi, public.fn_cq_prev_cum_internal(v.project_id, wi, v.period_no), 'manual', 'confirmed');
        end if;
        insert into public.valuation_item_sources (project_id, valuation_id, work_item_id, batch_key, qty, kind, adjustment_id)
          values (v.project_id, v.id, wi, adj.batch_key, adj.qty_delta, 'clawback', adj.id)
          on conflict (valuation_id, work_item_id, batch_key, kind)
          do update set qty = public.valuation_item_sources.qty + excluded.qty, adjustment_id = excluded.adjustment_id;
        update public.valuation_adjustments set status = 'applied', applied_valuation_id = v.id, applied_at = now() where id = adj.id;
        applied := applied + 1;
        perform public.record_audit_event(v.project_id, 'valuation_adjustment.applied', 'valuation_adjustment', adj.id, 'applied',
          null, null, jsonb_build_object('valuation_id', v.id, 'work_item_id', wi, 'qty_delta', adj.qty_delta), null);
      end loop;
    end if;
    items := items || public.fn_cq_allocate_to_cap_internal(v.id, wi);
  end loop;
  update public.valuations set recheck_required = false, recheck_note = null where id = v.id;
  perform public.fn_cq_restore_internal(v_prev);
  perform public.record_audit_event(v.project_id, 'valuation.synced', 'valuation', v.id, 'synced', null, null,
    jsonb_build_object('items', jsonb_array_length(items), 'adjustments_applied', applied), null);
  return jsonb_build_object('valuation_id', v.id, 'period_no', v.period_no, 'adjustments_applied', applied, 'items', items);
end; $$;
revoke all on function public.sync_valuation_from_confirmations(uuid) from public, anon;
grant execute on function public.sync_valuation_from_confirmations(uuid) to authenticated;
comment on function public.sync_valuation_from_confirmations(uuid) is
  'P4b:把可估驗的監造確認量同步到草稿期(逐工項 FIFO 分配到上限、併入待處理扣回、重算累計與金額);只有草稿;冪等。';

-- 6.2 設定草稿期某工項的累計量(在 [floor, floor+cap] 內;分配由 DB 重算,不信任客戶端的分配與金額)
create or replace function public.set_valuation_item_cum(p_valuation_id uuid, p_work_item_id uuid, p_cum_qty numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v       public.valuations;
  st      public.cq_item_state;
  v_prev  text;
  v_cum   numeric;
  floor_q numeric;
  limit_q numeric;
  wanted  numeric;
  got     numeric;
begin
  v := public.fn_cq_rpc_valuation_internal(p_valuation_id, true, true);
  v_cum := public.fn_cq_qty(p_cum_qty, '累計量');
  perform public.fn_cq_lock_internal(v.project_id, p_work_item_id);
  st := public.fn_cq_item_state_internal(v.project_id, p_work_item_id, v.id);
  if not st.billable then perform public.fn_cq_raise_internal('VQ005', '工項非末端／非計價列,不可計價'); end if;
  if v_cum > st.contract_qty then
    perform public.fn_cq_raise_internal('VQ005', format('累計量 %s 超過契約量 %s', v_cum, st.contract_qty));
  end if;
  -- 本期的確認來源重新分配:先扣掉留在本期的扣回／調整(可負),再以 [0, limit] 檢查;
  -- limit = 依據閘門(E − B − O − 本期扣回／調整);legacy 與既有確認來源會被重算取代
  floor_q := st.prev_cum + st.clawback_qty + st.adjustment_qty;
  wanted  := v_cum - floor_q;
  limit_q := public.fn_cap(greatest(0, st.effective_cutoff - st.billed - st.reserved - st.clawback_qty - st.adjustment_qty), 0, 0, st.basis);
  if wanted < 0 then
    perform public.fn_cq_raise_internal('VQ006', format('累計量 %s 低於前期累計 %s;減量須走撤銷／調整流程', v_cum, floor_q),
      jsonb_build_object('prev_cum', st.prev_cum, 'floor', floor_q, 'cap', st.cap, 'limit', limit_q, 'wanted', v_cum));
  end if;
  if wanted > limit_q then
    perform public.fn_cq_raise_internal('VQ006',
      format('本期最多可新增 %s(有效確認量 %s − 已計價 %s − 其他期占用 %s%s),要求新增 %s', limit_q, st.effective_cutoff, st.billed, st.reserved,
        case when st.basis is null then ';總價／間接費缺計價依據,暫時隔離' else '' end, wanted),
      jsonb_build_object('prev_cum', st.prev_cum, 'floor', floor_q, 'cap', st.cap, 'limit', limit_q, 'wanted', wanted,
        'effective', st.effective_cutoff, 'billed', st.billed, 'reserved', st.reserved, 'basis', st.basis));
  end if;
  v_prev := public.fn_cq_set_internal(true);
  delete from public.valuation_item_sources
    where valuation_id = v.id and work_item_id = p_work_item_id and kind in ('confirmation', 'legacy');
  got := public.fn_cq_allocate_internal(v.id, p_work_item_id, wanted);
  if round(got, 4) <> round(wanted, 4) then
    perform public.fn_cq_raise_internal('VQ006',
      format('可用確認量不足:要求新增 %s,依批次只能分配 %s', wanted, got),
      jsonb_build_object('prev_cum', st.prev_cum, 'floor', floor_q, 'cap', st.cap, 'wanted', wanted, 'allocated', got));
  end if;
  perform public.fn_cq_recompute_item_internal(v.id, p_work_item_id, 'confirmed');
  perform public.fn_cq_restore_internal(v_prev);
  st := public.fn_cq_item_state_internal(v.project_id, p_work_item_id, v.id);
  perform public.record_audit_event(v.project_id, 'valuation.item_set', 'valuation', v.id, 'item_set', null, null,
    jsonb_build_object('work_item_id', p_work_item_id, 'cum_qty', st.cum_qty, 'delta', st.delta), null);
  return jsonb_build_object('valuation_id', v.id, 'work_item_id', p_work_item_id, 'prev_cum', st.prev_cum,
    'cum_qty', st.cum_qty, 'delta', st.delta, 'cap', st.cap);
end; $$;
revoke all on function public.set_valuation_item_cum(uuid, uuid, numeric) from public, anon;
grant execute on function public.set_valuation_item_cum(uuid, uuid, numeric) to authenticated;

-- 6.3 狀態轉移(帶 p_from 冪等;檢查在 valuations_guard,不在這裡)
create or replace function public.transition_valuation(p_valuation_id uuid, p_from text, p_to text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.valuations;
begin
  v := public.fn_cq_rpc_valuation_internal(p_valuation_id, false, false);
  if p_to is null or p_to not in ('草稿', '監造審核', '已核定', '已請款') then
    perform public.fn_cq_raise_internal('VQ005', format('未知的估驗狀態:%s', coalesce(p_to, '(空)')));
  end if;
  if v.status is distinct from p_from then
    return jsonb_build_object('applied', false, 'status', v.status, 'message',
      format('估驗第 %s 期目前狀態是「%s」,不是「%s」', v.period_no, v.status, coalesce(p_from, '(空)')));
  end if;
  if v.status = p_to then
    return jsonb_build_object('applied', false, 'status', v.status, 'message', '狀態未變更');
  end if;
  update public.valuations set status = p_to, note = coalesce(p_note, note) where id = v.id;
  return jsonb_build_object('applied', true, 'status', p_to);
end; $$;
revoke all on function public.transition_valuation(uuid, text, text, text) from public, anon;
grant execute on function public.transition_valuation(uuid, text, text, text) to authenticated;

-- 6.4 撤銷確認(監造;收斂由 trigger 執行)
create or replace function public.revoke_inspection_confirmation(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c       public.inspection_confirmations;
  effects jsonb;
begin
  if auth.uid() is null then perform public.fn_cq_raise_internal('VQ001', '請先登入'); end if;
  perform set_config('lock_timeout', '5s', true);
  select * into c from public.inspection_confirmations where id = p_id for update;
  if not found or c.project_id not in (select public.my_project_ids()) then
    perform public.fn_cq_raise_internal('VQ008', '找不到確認紀錄或無權存取');
  end if;
  if not (public.my_org_type() = 'supervisor' or public.admin_override(c.project_id)) then
    perform public.fn_cq_raise_internal('VQ001', '只有監造可撤銷確認');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    perform public.fn_cq_raise_internal('VQ005', '撤銷確認必須填寫原因');
  end if;
  if c.status = 'revoked' then
    return jsonb_build_object('applied', false, 'status', 'revoked', 'message', '此確認已撤銷');
  end if;
  update public.inspection_confirmations
    set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), reason = btrim(p_reason)
    where id = p_id;
  perform public.record_audit_event(c.project_id, 'confirmation.revoked', 'inspection_confirmation', c.id, 'revoked',
    to_jsonb(c), null, jsonb_build_object('reason', btrim(p_reason)), null);
  -- 收斂結果(trigger 已執行)彙整給前端
  select coalesce(jsonb_agg(jsonb_build_object('event_type', e.event_type, 'entity_id', e.entity_id, 'metadata', e.metadata)), '[]'::jsonb)
    into effects
  from public.audit_events e
  where e.project_id = c.project_id and e.metadata ->> 'confirmation_id' = c.id::text
    and e.event_type in ('valuation.allocation_reduced', 'valuation.recheck_flagged', 'valuation_adjustment.created');
  return jsonb_build_object('applied', true, 'status', 'revoked', 'effects', effects);
exception when lock_not_available then
  perform public.fn_cq_raise_internal('VQ007', '確認紀錄正被其他操作使用,請稍後再試');
end; $$;
revoke all on function public.revoke_inspection_confirmation(uuid, text) from public, anon;
grant execute on function public.revoke_inspection_confirmation(uuid, text) to authenticated;

-- 6.5 監造確認單(supervisor_certificate):監造親簽的累計確認量;冪等;可補證歷史已核定期
create or replace function public.issue_supervisor_certificate(
  p_project_id uuid, p_work_item_id uuid, p_batch_key text, p_location_label text, p_stage_key text,
  p_unit text, p_qty_cum numeric, p_reason text, p_client_request_id text default null,
  p_covers_valuation_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  existing public.inspection_confirmations;
  c        public.inspection_confirmations;
  v_aal    text;
  v_prev   text;
  cov      public.valuations;
  legacy_q numeric;
  target   uuid;
  v_key    text;
begin
  if auth.uid() is null then perform public.fn_cq_raise_internal('VQ001', '請先登入'); end if;
  if p_project_id not in (select public.my_project_ids()) then
    perform public.fn_cq_raise_internal('VQ008', '找不到專案或無權存取');
  end if;
  if not (public.my_org_type() = 'supervisor' or public.admin_override(p_project_id)) then
    perform public.fn_cq_raise_internal('VQ001', '只有監造可簽發監造確認單');
  end if;
  -- R1(20260919023220)全面移除兩步驟驗證:簽發身分=已登入的本案監造成員;aal 只作證據欄位記入稽核
  v_aal := public.current_jwt_aal();
  if p_reason is null or btrim(p_reason) = '' then
    perform public.fn_cq_raise_internal('VQ005', '確認單必須填寫依據／說明');
  end if;
  perform set_config('lock_timeout', '5s', true);
  perform public.fn_cq_lock_internal(p_project_id, p_work_item_id);
  v_key := public.fn_cq_batch_key(p_batch_key);
  -- 冪等:同 client_request_id 重播回同一筆;內容不同 VQ009
  if p_client_request_id is not null then
    select * into existing from public.inspection_confirmations
      where project_id = p_project_id and client_request_id = p_client_request_id;
    if found then
      if existing.work_item_id = p_work_item_id and existing.batch_key = v_key
         and existing.stage_key is not distinct from nullif(public.fn_cq_normalize_text(p_stage_key), '')
         and existing.qty_cum = public.fn_cq_qty(p_qty_cum, '確認量') then
        return jsonb_build_object('applied', false, 'confirmation_id', existing.id, 'qty_delta', existing.qty_delta,
          'message', '同一請求已處理(冪等)');
      end if;
      perform public.fn_cq_raise_internal('VQ009', 'client_request_id 已用於不同內容的請求');
    end if;
  end if;
  if p_covers_valuation_id is not null then
    perform set_config('pmis.cq_defer_allocate', '1', true);
  end if;
  insert into public.inspection_confirmations (project_id, work_item_id, batch_key, location_label, stage_key, unit, qty_cum,
    basis, client_request_id, confirmed_by, confirmed_at, reason)
    values (p_project_id, p_work_item_id, v_key, p_location_label, p_stage_key, p_unit, p_qty_cum,
      'supervisor_certificate', p_client_request_id, auth.uid(), clock_timestamp(), btrim(p_reason))
    returning * into c;
  perform public.record_audit_event(p_project_id, 'confirmation.issued', 'inspection_confirmation', c.id, 'issued',
    null, to_jsonb(c), jsonb_build_object('basis', 'supervisor_certificate', 'aal', v_aal, 'covers_valuation_id', p_covers_valuation_id), null);
  -- 補證:已核定／已請款期別的 legacy 來源改掛到本確認單的批次(數量不變;留痕)
  if p_covers_valuation_id is not null then
    select * into cov from public.valuations where id = p_covers_valuation_id for update;
    if not found or cov.project_id <> p_project_id then
      perform public.fn_cq_raise_internal('VQ008', '被補證的估驗期別不屬於本專案');
    end if;
    if cov.status not in ('已核定', '已請款') then
      perform public.fn_cq_raise_internal('VQ010', '只有已核定／已請款的期別需要補證;草稿請直接重算');
    end if;
    select coalesce(sum(qty), 0) into legacy_q from public.valuation_item_sources
      where valuation_id = cov.id and work_item_id = p_work_item_id and kind = 'legacy';
    if legacy_q = 0 then
      perform public.fn_cq_raise_internal('VQ005', '該期別此工項沒有歷史遷移來源需要補證');
    end if;
    if c.stage_key is not null then
      perform public.fn_cq_raise_internal('VQ005', '補證確認單不可帶階段(多階段工項請逐階段簽後再補證)');
    end if;
    v_prev := public.fn_cq_set_internal(true);
    delete from public.valuation_item_sources where valuation_id = cov.id and work_item_id = p_work_item_id and kind = 'legacy';
    insert into public.valuation_item_sources (project_id, valuation_id, work_item_id, batch_key, qty, kind, confirmation_id)
      values (p_project_id, cov.id, p_work_item_id, c.batch_key, legacy_q, 'confirmation', c.id);
    update public.valuation_items set backing = 'confirmed'
      where valuation_id = cov.id and work_item_id = p_work_item_id
        and not exists (select 1 from public.valuation_item_sources s
                        where s.valuation_id = cov.id and s.work_item_id = p_work_item_id and s.kind = 'legacy');
    perform public.fn_cq_restore_internal(v_prev);
    perform public.record_audit_event(p_project_id, 'valuation.legacy_covered', 'valuation', cov.id, 'legacy_covered',
      null, null, jsonb_build_object('work_item_id', p_work_item_id, 'qty', legacy_q, 'confirmation_id', c.id,
        'batch_key', c.batch_key, 'reason', btrim(p_reason)), null);
    perform set_config('pmis.cq_defer_allocate', '', true);
    -- 補證後剩餘的可用量再同步到適用草稿期
    target := public.fn_cq_target_draft_internal(p_project_id, c.confirmed_at);
    if target is not null then
      v_prev := public.fn_cq_set_internal(true);
      perform public.fn_cq_allocate_to_cap_internal(target, p_work_item_id);
      perform public.fn_cq_restore_internal(v_prev);
    end if;
  end if;
  return jsonb_build_object('applied', true, 'confirmation_id', c.id, 'qty_cum', c.qty_cum, 'qty_delta', c.qty_delta,
    'batch_key', c.batch_key, 'stage_key', c.stage_key, 'supersedes_id', c.supersedes_id);
exception when lock_not_available then
  perform public.fn_cq_raise_internal('VQ007', '工項正被其他操作使用,請稍後再試');
end; $$;
revoke all on function public.issue_supervisor_certificate(uuid, uuid, text, text, text, text, numeric, text, text, uuid) from public, anon;
grant execute on function public.issue_supervisor_certificate(uuid, uuid, text, text, text, text, numeric, text, text, uuid) to authenticated;

-- 6.6 作廢調整(機關;留原因)
create or replace function public.void_valuation_adjustment(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.valuation_adjustments; v_prev text;
begin
  if auth.uid() is null then perform public.fn_cq_raise_internal('VQ001', '請先登入'); end if;
  perform set_config('lock_timeout', '5s', true);
  select * into a from public.valuation_adjustments where id = p_id for update;
  if not found or a.project_id not in (select public.my_project_ids()) then
    perform public.fn_cq_raise_internal('VQ008', '找不到估驗調整或無權存取');
  end if;
  if not (public.my_org_type() = 'owner' or public.admin_override(a.project_id)) then
    perform public.fn_cq_raise_internal('VQ001', '只有機關可作廢估驗調整');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    perform public.fn_cq_raise_internal('VQ005', '作廢必須填寫原因');
  end if;
  if a.status <> 'pending' then
    return jsonb_build_object('applied', false, 'status', a.status, 'message', format('調整已是 %s,不可作廢', a.status));
  end if;
  v_prev := public.fn_cq_set_internal(true);
  update public.valuation_adjustments set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
    where id = p_id;
  perform public.fn_cq_restore_internal(v_prev);
  perform public.record_audit_event(a.project_id, 'valuation_adjustment.voided', 'valuation_adjustment', a.id, 'voided',
    to_jsonb(a), null, jsonb_build_object('reason', btrim(p_reason)), null);
  return jsonb_build_object('applied', true, 'status', 'void');
exception when lock_not_available then
  perform public.fn_cq_raise_internal('VQ007', '估驗調整正被其他操作使用,請稍後再試');
end; $$;
revoke all on function public.void_valuation_adjustment(uuid, text) from public, anon;
grant execute on function public.void_valuation_adjustment(uuid, text) to authenticated;

-- 6.7 平台管理員調整草稿期明細(必填原因、寫 audit、產生 adjustment 來源列;不動已核定期)
create or replace function public.admin_adjust_valuation_item(p_valuation_id uuid, p_work_item_id uuid, p_cum_qty numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v      public.valuations;
  st     public.cq_item_state;
  v_prev text;
  v_cum  numeric;
  delta  numeric;
  aid    uuid;
  existing_q numeric;
begin
  if auth.uid() is null then perform public.fn_cq_raise_internal('VQ001', '請先登入'); end if;
  if not public.is_platform_admin() then perform public.fn_cq_raise_internal('VQ001', '只有平台管理員可執行維護調整'); end if;
  if p_reason is null or btrim(p_reason) = '' then perform public.fn_cq_raise_internal('VQ005', '維護調整必須填寫原因'); end if;
  perform set_config('lock_timeout', '5s', true);
  select * into v from public.valuations where id = p_valuation_id for update;
  if not found then perform public.fn_cq_raise_internal('VQ008', '找不到估驗期別'); end if;
  if v.status <> '草稿' then
    perform public.fn_cq_raise_internal('VQ010', format('估驗已%s,不可維護調整;已核定期的更正走撤銷／調整流程', v.status));
  end if;
  v_cum := public.fn_cq_qty(p_cum_qty, '累計量');
  perform public.fn_cq_lock_internal(v.project_id, p_work_item_id);
  st := public.fn_cq_item_state_internal(v.project_id, p_work_item_id, v.id);
  if v_cum > st.contract_qty then
    perform public.fn_cq_raise_internal('VQ005', format('累計量 %s 超過契約量 %s', v_cum, st.contract_qty));
  end if;
  v_prev := public.fn_cq_set_internal(true);
  delete from public.valuation_item_sources where valuation_id = v.id and work_item_id = p_work_item_id and kind = 'legacy';
  st := public.fn_cq_item_state_internal(v.project_id, p_work_item_id, v.id);
  delta := v_cum - (st.prev_cum + st.sources_sum);
  if delta <> 0 then
    if not exists (select 1 from public.valuation_items where valuation_id = v.id and work_item_id = p_work_item_id) then
      insert into public.valuation_items (valuation_id, work_item_id, cum_qty, source, backing)
        values (v.id, p_work_item_id, st.prev_cum, 'manual', 'adjusted');
    end if;
    insert into public.valuation_adjustments (project_id, work_item_id, batch_key, qty_delta, reason, status, applied_valuation_id, applied_at)
      values (v.project_id, p_work_item_id, '__adjustment__', delta, btrim(p_reason), 'applied', v.id, now())
      returning id into aid;
    -- 同期同工項的調整來源合併成一列;合併後歸零就移除(check qty <> 0)
    select qty into existing_q from public.valuation_item_sources
      where valuation_id = v.id and work_item_id = p_work_item_id and batch_key = '__adjustment__' and kind = 'adjustment';
    if found and existing_q + delta = 0 then
      delete from public.valuation_item_sources
        where valuation_id = v.id and work_item_id = p_work_item_id and batch_key = '__adjustment__' and kind = 'adjustment';
    else
      insert into public.valuation_item_sources (project_id, valuation_id, work_item_id, batch_key, qty, kind, adjustment_id)
        values (v.project_id, v.id, p_work_item_id, '__adjustment__', delta, 'adjustment', aid)
        on conflict (valuation_id, work_item_id, batch_key, kind)
        do update set qty = public.valuation_item_sources.qty + excluded.qty, adjustment_id = excluded.adjustment_id;
    end if;
  end if;
  perform public.fn_cq_recompute_item_internal(v.id, p_work_item_id, 'adjusted');
  perform public.fn_cq_restore_internal(v_prev);
  perform public.record_audit_event(v.project_id, 'valuation.admin_adjusted', 'valuation', v.id, 'admin_adjusted', null, null,
    jsonb_build_object('work_item_id', p_work_item_id, 'cum_qty', v_cum, 'delta', delta, 'adjustment_id', aid, 'reason', btrim(p_reason)), null);
  return jsonb_build_object('valuation_id', v.id, 'work_item_id', p_work_item_id, 'cum_qty', v_cum, 'delta', delta, 'adjustment_id', aid);
exception when lock_not_available then
  perform public.fn_cq_raise_internal('VQ007', '估驗期別正被其他操作使用,請稍後再試');
end; $$;
revoke all on function public.admin_adjust_valuation_item(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.admin_adjust_valuation_item(uuid, uuid, numeric, text) to authenticated;

-- 6.8 設定工項計價依據(監造;總價／間接費的暫時隔離由此解除)
create or replace function public.set_work_item_pricing_basis(p_work_item_id uuid, p_basis text, p_rule jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w record;
begin
  if auth.uid() is null then perform public.fn_cq_raise_internal('VQ001', '請先登入'); end if;
  select id, project_id into w from public.work_items where id = p_work_item_id;
  if not found or w.project_id not in (select public.my_project_ids()) then
    perform public.fn_cq_raise_internal('VQ008', '找不到工項或無權存取');
  end if;
  if not (public.my_org_type() = 'supervisor' or public.admin_override(w.project_id)) then
    perform public.fn_cq_raise_internal('VQ001', '只有監造可設定計價依據');
  end if;
  if p_basis is null or p_basis not in ('inspection', 'supervisor_certificate', 'pro_rata', 'excluded') then
    perform public.fn_cq_raise_internal('VQ005', format('計價依據不明:%s', coalesce(p_basis, '(空)')));
  end if;
  insert into public.work_item_pricing_basis (work_item_id, project_id, basis, rule, set_by, set_at)
    values (p_work_item_id, w.project_id, p_basis, p_rule, auth.uid(), now())
    on conflict (work_item_id) do update set basis = excluded.basis, rule = excluded.rule, set_by = excluded.set_by, set_at = excluded.set_at;
  perform public.record_audit_event(w.project_id, 'work_item.pricing_basis_set', 'work_item', p_work_item_id, 'pricing_basis_set',
    null, null, jsonb_build_object('basis', p_basis, 'rule', p_rule), null);
  return jsonb_build_object('work_item_id', p_work_item_id, 'basis', p_basis);
end; $$;
revoke all on function public.set_work_item_pricing_basis(uuid, text, jsonb) from public, anon;
grant execute on function public.set_work_item_pricing_basis(uuid, text, jsonb) to authenticated;

-- 6.9 唯讀:期別狀態(估驗頁用;含每工項上限、來源、缺件)
create or replace function public.get_valuation_state(p_valuation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v          record;
  wi         uuid;
  st         public.cq_item_state;
  items      jsonb := '[]'::jsonb;
  checkpoint text;
begin
  if auth.uid() is null then perform public.fn_cq_raise_internal('VQ001', '請先登入'); end if;
  select * into v from public.valuations where id = p_valuation_id;
  if not found or v.project_id not in (select public.my_project_ids()) then
    perform public.fn_cq_raise_internal('VQ008', '找不到估驗期別或無權存取');
  end if;
  checkpoint := case v.status when '草稿' then 'review' when '監造審核' then 'approve' else 'invoice' end;
  for wi in
    select distinct x from (
      select vi.work_item_id as x from public.valuation_items vi where vi.valuation_id = v.id
      union select c.work_item_id from public.inspection_confirmations c where c.project_id = v.project_id and c.status = 'active'
      union select a.work_item_id from public.valuation_adjustments a where a.project_id = v.project_id and a.status = 'pending'
    ) u order by x
  loop
    st := public.fn_cq_item_state_internal(v.project_id, wi, v.id);
    items := items || (to_jsonb(st) || jsonb_build_object('sources',
      coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'batch_key', s.batch_key, 'qty', s.qty, 'kind', s.kind,
                  'confirmation_id', s.confirmation_id, 'adjustment_id', s.adjustment_id, 'created_at', s.created_at) order by s.created_at)
                from public.valuation_item_sources s where s.valuation_id = v.id and s.work_item_id = wi), '[]'::jsonb),
      'backing', (select backing from public.valuation_items where valuation_id = v.id and work_item_id = wi),
      'amount_cum', (select amount_cum from public.valuation_items where valuation_id = v.id and work_item_id = wi)));
  end loop;
  return jsonb_build_object(
    'valuation', jsonb_build_object('id', v.id, 'project_id', v.project_id, 'period_no', v.period_no, 'period_end', v.period_end,
      'status', v.status, 'recheck_required', v.recheck_required, 'recheck_note', v.recheck_note, 'invoice_date', v.invoice_date),
    'checkpoint', checkpoint,
    'violations', public.fn_cq_period_check_internal(v.id, checkpoint),
    'pending_adjustments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'work_item_id', a.work_item_id,
        'batch_key', a.batch_key, 'qty_delta', a.qty_delta, 'reason', a.reason, 'origin_valuation_id', a.origin_valuation_id,
        'created_at', a.created_at) order by a.created_at)
      from public.valuation_adjustments a where a.project_id = v.project_id and a.status = 'pending'), '[]'::jsonb),
    'items', items);
end; $$;
revoke all on function public.get_valuation_state(uuid) from public, anon;
grant execute on function public.get_valuation_state(uuid) to authenticated;

-- 6.10 唯讀:可估驗清單(有 active 確認的工項:E − B − O > 0 者,附批次與占用的草稿期)
create or replace function public.list_billable_backlog(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  wi    uuid;
  st    public.cq_item_state;
  w     record;
  confs public.cq_confirmation[];
  rows_ jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then perform public.fn_cq_raise_internal('VQ001', '請先登入'); end if;
  if p_project_id not in (select public.my_project_ids()) then
    perform public.fn_cq_raise_internal('VQ008', '找不到專案或無權存取');
  end if;
  for wi in select distinct c.work_item_id from public.inspection_confirmations c
            where c.project_id = p_project_id and c.status = 'active' order by 1 loop
    st := public.fn_cq_item_state_internal(p_project_id, wi, null);
    confs := public.fn_cq_confirmations_internal(p_project_id, wi);
    select description, item_no into w from public.work_items where id = wi;
    rows_ := rows_ || jsonb_build_object('work_item_id', wi, 'item_no', w.item_no, 'description', w.description,
      'unit', st.unit, 'contract_qty', st.contract_qty, 'basis', st.basis,
      'effective', st.effective_now, 'billed', st.billed, 'reserved', st.reserved, 'available', st.cap,
      'violations', st.violations,
      'batches', coalesce((select jsonb_agg(jsonb_build_object('batch_key', e.batch_key, 'effective_qty', e.effective_qty,
                    'allocated_qty', e.allocated_qty, 'available_qty', e.available_qty,
                    'missing_stages', to_jsonb(public.fn_cq_missing_stages_internal(confs, st.required_stages, e.batch_key))) order by e.batch_key)
                  from public.fn_batch_allocation_check(confs, st.required_stages, st.unit,
                    public.fn_cq_allocations_internal(p_project_id, wi, null, null)) e), '[]'::jsonb),
      'occupied_by', coalesce((select jsonb_agg(distinct jsonb_build_object('valuation_id', x.id, 'period_no', x.period_no, 'status', x.status))
                    from public.valuation_item_sources s join public.valuations x on x.id = s.valuation_id
                    where s.project_id = p_project_id and s.work_item_id = wi and x.status in ('草稿', '監造審核')), '[]'::jsonb));
  end loop;
  return rows_;
end; $$;
revoke all on function public.list_billable_backlog(uuid) from public, anon;
grant execute on function public.list_billable_backlog(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. 舊資料過渡:已核定／已請款期別明細回填 legacy 來源(=歷史遷移,不是監造確認;冪等)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_cq_backfill_legacy_internal(p_project uuid default null)
returns int language plpgsql security definer set search_path = public as $fn$
declare
  r      record;
  v_prev text;
  n      int := 0;
  delta  numeric;
begin
  v_prev := public.fn_cq_set_internal(true);
  for r in
    select vi.valuation_id, vi.work_item_id, vi.cum_qty, v.project_id, v.period_no
    from public.valuation_items vi join public.valuations v on v.id = vi.valuation_id
    where v.status in ('已核定', '已請款') and (p_project is null or v.project_id = p_project)
      and not exists (select 1 from public.valuation_item_sources s
                      where s.valuation_id = vi.valuation_id and s.work_item_id = vi.work_item_id)
    order by v.project_id, v.period_no, vi.work_item_id
  loop
    delta := round(coalesce(r.cum_qty, 0) - public.fn_cq_prev_cum_internal(r.project_id, r.work_item_id, r.period_no), 4);
    if delta = 0 then continue; end if;
    insert into public.valuation_item_sources (project_id, valuation_id, work_item_id, batch_key, qty, kind)
      values (r.project_id, r.valuation_id, r.work_item_id, '__legacy__', delta, 'legacy');
    n := n + 1;
  end loop;
  perform public.fn_cq_restore_internal(v_prev);
  return n;
end $fn$;
revoke all on function public.fn_cq_backfill_legacy_internal(uuid) from public, anon, authenticated;
select public.fn_cq_backfill_legacy_internal(null);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. 權限總表(H3:新函式預設對 anon／authenticated／PUBLIC 不可執行;上面已逐支明示)
-- ═══════════════════════════════════════════════════════════════════════════
-- trigger 函式一律不 grant:
revoke all on function public.inspection_confirmations_guard() from public, anon, authenticated;
revoke all on function public.inspection_confirmations_after_change() from public, anon, authenticated;
revoke all on function public.valuation_item_sources_guard() from public, anon, authenticated;
revoke all on function public.valuation_item_sources_after_delete() from public, anon, authenticated;
revoke all on function public.valuation_adjustments_guard() from public, anon, authenticated;
revoke all on function public.work_item_pricing_basis_guard() from public, anon, authenticated;
revoke all on function public.work_items_confirmation_guard() from public, anon, authenticated;
revoke all on function public.inspection_points_stage_guard() from public, anon, authenticated;
revoke all on function public.valuations_guard() from public, anon, authenticated;
revoke all on function public.valuations_checkpoint_guard() from public, anon, authenticated;
revoke all on function public.valuation_items_guard() from public, anon, authenticated;
