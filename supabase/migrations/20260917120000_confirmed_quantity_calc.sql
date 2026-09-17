-- P4a｜監造確認量與估驗上限的純計算層(D-026;設計 docs/architecture/confirmed-quantity-valuation.md §1、§3、§4、§10、§11)。
--
-- 為什麼:估驗數量目前沒有任何「監造確認」的約束,fillValuationFromSiteLogs 是不受限制的
-- 請款路徑。後端強制的第一步是把「有效確認量／契約量／本期可新增上限／來源分配」的算法
-- 固定在 DB、用 pgTAP 釘住需求 §8 的每一個情境,之後 P4b 的表、guard、RPC 才有可信的核心。
--
-- 這支只新增 2 個 composite type 與 14 個純函式(IMMUTABLE、security invoker、search_path 固定),
-- 不建表、不改任何既有表／trigger／policy、不影響現有功能。所有函式都接收明確輸入
-- (composite 陣列與純量),不讀任何表:P4b 之後以 inspection_confirmations／valuation_item_sources／
-- inspection_points／change_order_items 的查詢結果餵入。設計文件 §3／§12 的 v_billable_backlog
-- 是表驅動 view,順延到 P4b(本單元沒有它要讀的表)。
--
-- 介面(P4b 的餵入約定):
--   cq_confirmation(batch_key, stage_key, unit, qty_cum, confirmed_at, status)
--     ← inspection_confirmations 一列(qty_cum 是「該批次該階段的累計確認通過量」,累計語意)
--   cq_allocation(batch_key, qty) ← valuation_item_sources 一列(qty 可負=clawback)
--   p_required_stages ← inspection_points where point_type='H' and required_for_billing 的 stage_key;
--     空=單階段(所有確認的 stage_key 應為 null)
--   p_unit ← work_items.unit;p_as_of ← fn_cq_as_of(valuations.period_end)(null=不設截止)
--   p_contract_qty ← fn_contract_qty(work_items.quantity, 核准變更 qty_delta[])
--   p_billed ← 已核定／已請款期別的分配總和;p_reserved ← 其他未結束期別的分配總和
--
-- 規則(全部 fail-closed):
--   * 每 (批次, 必要階段) 取截止時點前最新一筆 active 確認的累計量;同時刻並列取最小。
--     批次量=各必要階段取最小(缺任一階段=0);工項有效量=Σ批次,再與契約量取 min。
--   * cap = max(0, 有效量 − 已計價 − 其他期占用);計價依據為 null(總價類缺依據)或 excluded → 0。
--   * 拒絕(raise):負值、NaN、無限大、≥1e12、單位不一致(正規化後)、空 batch_key、
--     狀態不明、缺確認時間、核准變更後契約量為負、累計量超契約量。壞資料不靜默略過。
--   * 精度:數量四捨五入到 4 位小數(對齊 numeric(18,4));金額逐工項四捨五入到元
--     (續接清單 §6 Q2 暫行做法,尚未定案;只有 fn_valuation_amount 一處要改)。
--   * 正規化(批次鍵、單位、階段鍵):去頭尾與內部空白、全形→半形、²³→23、小寫;沒有單位同義表
--     (「公尺」≠「m」),同義由 P4b guard 決定要不要擋。
--   * 台北日曆日:fn_cq_as_of(period_end) 回該日台北 23:59:59.999999,對齊全站 taipeiISODate。
--
-- 權限:全部 revoke from public, anon, authenticated(純計算、無資料,但前端不得自算上限或金額;
--   P4b 的 security definer RPC／view 以 owner 身分呼叫,需要對外顯示時再由 P4b 明示 grant)。
-- 資料保留:不動任何資料列。相容:只新增,舊前端與既有 RPC 不受影響。
-- 回復:supabase/rollbacks/20260917120000_confirmed_quantity_calc.down.sql(drop 14 函式與 2 型別)。

-- ── 0. 型別 ─────────────────────────────────────────────────────────────────
do $do$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'cq_confirmation') then
    create type public.cq_confirmation as (
      batch_key    text,         -- 施作位置／批次(未正規化亦可,函式內正規化;不可為空)
      stage_key    text,         -- 多階段必要查驗的階段鍵;null=單階段
      unit         text,         -- 簽署時的單位快照,必須與工項單位正規化後相等
      qty_cum      numeric,      -- 該批次該階段的累計確認通過量(累計語意)
      confirmed_at timestamptz,  -- 監造確認的伺服器時間
      status       text          -- 'active' | 'revoked'
    );
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'cq_allocation') then
    create type public.cq_allocation as (
      batch_key text,
      qty       numeric          -- 期別對該批次的分配量;可負(clawback)
    );
  end if;
end $do$;
comment on type public.cq_confirmation is
  'P4a 純計算輸入:一筆監造確認(批次、階段、單位快照、累計確認量、時間、狀態)。P4b 由 inspection_confirmations 映射。';
comment on type public.cq_allocation is
  'P4a 純計算輸入:一期對一批次的分配量(可負=clawback)。P4b 由 valuation_item_sources 映射。';

-- ── 1. 正規化與驗證 ───────────────────────────────────────────────────────────
create or replace function public.fn_cq_normalize_text(p text)
returns text language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select lower(regexp_replace(
    translate(coalesce(p, ''),
      '！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝～' || chr(12288) || '²³',
      '!"#$%&''()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~' || ' 23'),
    '\s+', '', 'g'));
$fn$;
comment on function public.fn_cq_normalize_text(text) is
  'P4a:批次鍵／單位／階段鍵的正規化(去空白含全形空白、全形→半形、²³→23、小寫)。null→空字串。';

create or replace function public.fn_cq_batch_key(p text)
returns text language plpgsql immutable security invoker set search_path = pg_catalog, public as $fn$
declare v text := public.fn_cq_normalize_text(p);
begin
  if v = '' then raise exception '批次鍵不可為空(施作位置／批次必填)'; end if;
  return v;
end $fn$;
comment on function public.fn_cq_batch_key(text) is 'P4a:正規化批次鍵;空→raise。';

create or replace function public.fn_cq_check_unit(p_actual text, p_expected text)
returns boolean language plpgsql immutable security invoker set search_path = pg_catalog, public as $fn$
begin
  if public.fn_cq_normalize_text(p_actual) <> public.fn_cq_normalize_text(p_expected) then
    raise exception '單位不一致:確認單位「%」≠ 工項單位「%」', coalesce(p_actual, ''), coalesce(p_expected, '');
  end if;
  return true;
end $fn$;
comment on function public.fn_cq_check_unit(text, text) is 'P4a:單位正規化後必須相等,否則 raise;相等回 true。';

create or replace function public.fn_cq_qty(p numeric, p_label text, p_allow_negative boolean default false)
returns numeric language plpgsql immutable security invoker set search_path = pg_catalog, public as $fn$
begin
  if p is null then raise exception '%缺值', p_label; end if;
  if p = 'NaN'::numeric then raise exception '%非數值(NaN)', p_label; end if;
  if abs(p) >= 1e12 then raise exception '%非有限值或超出範圍:%', p_label, p; end if;
  if p < 0 and not p_allow_negative then raise exception '%不得為負:%', p_label, p; end if;
  return round(p, 4);
end $fn$;
comment on function public.fn_cq_qty(numeric, text, boolean) is
  'P4a:數量驗證(缺值／NaN／無限大／≥1e12／負值→raise)並四捨五入到 4 位小數。p_allow_negative 給變更量與 clawback 用。';

create or replace function public.fn_cq_as_of(p_period_end date)
returns timestamptz language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select case when p_period_end is null then null::timestamptz
         else ((p_period_end + 1)::timestamp at time zone 'Asia/Taipei') - interval '1 microsecond' end;
$fn$;
comment on function public.fn_cq_as_of(date) is
  'P4a:期別截止日(台北日曆日)→含該日整天的截止時點(台北 23:59:59.999999)。null=不設截止。';

-- ── 2. 契約量 ─────────────────────────────────────────────────────────────────
create or replace function public.fn_contract_qty(p_base_qty numeric, p_approved_deltas numeric[])
returns numeric language plpgsql immutable security invoker set search_path = pg_catalog, public as $fn$
declare
  v_base numeric := public.fn_cq_qty(coalesce(p_base_qty, 0), '契約量');
  v_delta numeric;
  v_sum numeric := 0;
begin
  foreach v_delta in array coalesce(p_approved_deltas, '{}'::numeric[]) loop
    v_sum := v_sum + public.fn_cq_qty(coalesce(v_delta, 0), '核准變更量', true);
  end loop;
  if v_base + v_sum < 0 then
    raise exception '核准變更後契約量為負:%', v_base + v_sum;
  end if;
  return v_base + v_sum;
end $fn$;
comment on function public.fn_contract_qty(numeric, numeric[]) is
  'P4a:核准變更後契約量 = 標單量 + Σ核准變更 qty_delta。標單量 null 視為 0(無契約量=不可計價);結果為負→raise。';

-- ── 3. 有效確認量 ─────────────────────────────────────────────────────────────
create or replace function public.fn_effective_by_batch(
  p_confirmations public.cq_confirmation[], p_required_stages text[], p_unit text, p_as_of timestamptz
) returns table (batch_key text, qty numeric, first_confirmed_at timestamptz)
language plpgsql immutable security invoker set search_path = pg_catalog, public as $fn$
declare
  v_rec    public.cq_confirmation;
  v_recs   public.cq_confirmation[] := '{}';
  v_stages text[];
begin
  -- 必要階段集合:正規化、去空、去重;空集合=單階段 {null}
  select coalesce(array_agg(distinct s.k), '{}'::text[]) into v_stages
  from (select nullif(public.fn_cq_normalize_text(x), '') as k
        from unnest(coalesce(p_required_stages, '{}'::text[])) x) s
  where s.k is not null;
  if cardinality(v_stages) = 0 then v_stages := array[null::text]; end if;

  -- 逐筆驗證(不論狀態:壞資料要浮上來,不靜默略過),只保留截止時點前的 active
  foreach v_rec in array coalesce(p_confirmations, '{}'::public.cq_confirmation[]) loop
    if v_rec.status is null or v_rec.status not in ('active', 'revoked') then
      raise exception '確認紀錄狀態不明:%', coalesce(v_rec.status, 'null');
    end if;
    if v_rec.confirmed_at is null then raise exception '確認紀錄缺確認時間'; end if;
    perform public.fn_cq_check_unit(v_rec.unit, p_unit);
    v_rec.batch_key := public.fn_cq_batch_key(v_rec.batch_key);
    v_rec.qty_cum   := public.fn_cq_qty(v_rec.qty_cum, '確認量');
    v_rec.stage_key := nullif(public.fn_cq_normalize_text(v_rec.stage_key), '');
    if v_rec.status = 'active' and (p_as_of is null or v_rec.confirmed_at <= p_as_of) then
      v_recs := v_recs || v_rec;
    end if;
  end loop;

  return query
  with s as (select x as k from unnest(v_stages) x),
  r as (select * from unnest(v_recs)),
  latest as (
    -- 每 (批次, 階段) 取最新一筆;同時刻並列取最小(保守且可重現)
    select x.batch_key, x.stage_key, min(x.qty_cum) as qty_cum
    from (select r.*, rank() over (partition by r.batch_key, r.stage_key order by r.confirmed_at desc) as rk
          from r) x
    where x.rk = 1
    group by x.batch_key, x.stage_key
  ),
  batches as (select r.batch_key, min(r.confirmed_at) as first_at from r group by r.batch_key)
  select b.batch_key,
         min(coalesce(l.qty_cum, 0)) as qty,      -- 各必要階段取最小;缺階段=0
         b.first_at
  from batches b
  cross join s
  left join latest l on l.batch_key = b.batch_key and l.stage_key is not distinct from s.k
  group by b.batch_key, b.first_at
  order by b.batch_key;
end $fn$;
comment on function public.fn_effective_by_batch(public.cq_confirmation[], text[], text, timestamptz) is
  'P4a:各批次在截止時點前的有效確認量(每必要階段取最新累計、各階段取最小、缺階段=0)。列出所有有 active 紀錄的批次,附最早確認時間(FIFO 用)。';

create or replace function public.fn_effective_confirmed(
  p_confirmations public.cq_confirmation[], p_required_stages text[], p_unit text, p_as_of timestamptz,
  p_contract_qty numeric
) returns numeric language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select least(
    coalesce((select sum(e.qty) from public.fn_effective_by_batch(p_confirmations, p_required_stages, p_unit, p_as_of) e), 0),
    public.fn_cq_qty(p_contract_qty, '契約量'));
$fn$;
comment on function public.fn_effective_confirmed(public.cq_confirmation[], text[], text, timestamptz, numeric) is
  'P4a:工項有效可計價確認量 E(W,t) = min(Σ批次有效量, 契約量)。無確認=0。';

-- ── 4. 本期可新增上限、期別增量、金額 ─────────────────────────────────────────
create or replace function public.fn_cap(
  p_effective numeric, p_billed numeric, p_reserved numeric, p_basis text default 'inspection'
) returns numeric language plpgsql immutable security invoker set search_path = pg_catalog, public as $fn$
declare
  v_e numeric := public.fn_cq_qty(p_effective, '有效確認量');
  v_b numeric := public.fn_cq_qty(coalesce(p_billed, 0), '已計價量');
  v_o numeric := public.fn_cq_qty(coalesce(p_reserved, 0), '其他期占用量');
begin
  -- 計價依據:null=總價／間接費缺依據(使用者 2026-09-17 決定暫時隔離不計價)、excluded=不由本系統計價
  if p_basis is null or p_basis = 'excluded' then return 0; end if;
  if p_basis not in ('inspection', 'supervisor_certificate', 'pro_rata') then
    raise exception '計價依據不明:%', p_basis;
  end if;
  return greatest(0, v_e - v_b - v_o);
end $fn$;
comment on function public.fn_cap(numeric, numeric, numeric, text) is
  'P4a:本期可新增上限 cap = max(0, 有效確認量 − 已計價 − 其他未結束期占用);計價依據 null／excluded → 0。已計價／占用 null 視為 0。';

create or replace function public.fn_period_increment(p_cum_qty numeric, p_prev_cum_qty numeric, p_contract_qty numeric)
returns numeric language plpgsql immutable security invoker set search_path = pg_catalog, public as $fn$
declare
  v_cum  numeric := public.fn_cq_qty(p_cum_qty, '累計量');
  v_prev numeric := public.fn_cq_qty(coalesce(p_prev_cum_qty, 0), '前期累計量');
  v_qc   numeric := public.fn_cq_qty(p_contract_qty, '契約量');
begin
  if v_cum > v_qc then raise exception '累計量 % 超過契約量 %', v_cum, v_qc; end if;
  return v_cum - v_prev;
end $fn$;
comment on function public.fn_period_increment(numeric, numeric, numeric) is
  'P4a:本期增量 Δ = 累計量 − 前期累計量;累計量超契約量→raise。可為負(是否允許由呼叫端依 clawback 判斷)。';

create or replace function public.fn_valuation_amount(p_cum_qty numeric, p_unit_price numeric)
returns numeric language plpgsql immutable security invoker set search_path = pg_catalog, public as $fn$
declare
  v_q numeric := public.fn_cq_qty(p_cum_qty, '累計量');
  v_p numeric := coalesce(p_unit_price, 0);
begin
  if v_p = 'NaN'::numeric or abs(v_p) >= 1e12 then
    raise exception '單價非有限值或超出範圍:%', p_unit_price;
  end if;
  -- 續接清單 §6 Q2 暫行:逐工項四捨五入到元後再加總(尚未定案;要改口徑只改這裡)
  return round(v_q * v_p, 0);
end $fn$;
comment on function public.fn_valuation_amount(numeric, numeric) is
  'P4a:累計金額 = round(累計量 × 單價) 到元(Q2 暫行口徑,單一修改點)。單價 null 視為 0。';

-- ── 5. 來源分配:不變量 2 檢核與 FIFO 分配 ─────────────────────────────────────
create or replace function public.fn_batch_allocation_check(
  p_confirmations public.cq_confirmation[], p_required_stages text[], p_unit text,
  p_allocations public.cq_allocation[]
) returns table (batch_key text, effective_qty numeric, allocated_qty numeric, available_qty numeric)
language plpgsql immutable security invoker set search_path = pg_catalog, public as $fn$
declare
  v_a      public.cq_allocation;
  v_allocs public.cq_allocation[] := '{}';
begin
  foreach v_a in array coalesce(p_allocations, '{}'::public.cq_allocation[]) loop
    v_a.batch_key := public.fn_cq_batch_key(v_a.batch_key);
    v_a.qty       := public.fn_cq_qty(v_a.qty, '分配量', true);
    v_allocs := v_allocs || v_a;
  end loop;
  return query
  with e as (select * from public.fn_effective_by_batch(p_confirmations, p_required_stages, p_unit, null)),
       a as (select x.batch_key, sum(x.qty) as qty from unnest(v_allocs) x group by x.batch_key)
  select coalesce(e.batch_key, a.batch_key),
         coalesce(e.qty, 0),
         coalesce(a.qty, 0),
         coalesce(e.qty, 0) - coalesce(a.qty, 0)   -- 負=超額占用(不變量 2 不成立)
  from e full join a on a.batch_key = e.batch_key
  order by 1;
end $fn$;
comment on function public.fn_batch_allocation_check(public.cq_confirmation[], text[], text, public.cq_allocation[]) is
  'P4a:不變量 2「Σ所有期別分配(·,W,b) ≤ E(W,b,now)」逐批次檢核;available_qty < 0 即違反。分配到無確認批次的列 effective=0。';

create or replace function public.fn_allocate_fifo(
  p_confirmations public.cq_confirmation[], p_required_stages text[], p_unit text, p_as_of timestamptz,
  p_allocated public.cq_allocation[], p_wanted numeric
) returns table (batch_key text, qty numeric)
language plpgsql immutable security invoker set search_path = pg_catalog, public as $fn$
declare
  v_a         public.cq_allocation;
  v_allocs    public.cq_allocation[] := '{}';
  v_remaining numeric := public.fn_cq_qty(p_wanted, '欲分配量');
  v_row       record;
begin
  foreach v_a in array coalesce(p_allocated, '{}'::public.cq_allocation[]) loop
    v_a.batch_key := public.fn_cq_batch_key(v_a.batch_key);
    v_a.qty       := public.fn_cq_qty(v_a.qty, '分配量', true);
    v_allocs := v_allocs || v_a;
  end loop;
  for v_row in
    with e as (select * from public.fn_effective_by_batch(p_confirmations, p_required_stages, p_unit, p_as_of)),
         a as (select x.batch_key, sum(x.qty) as qty from unnest(v_allocs) x group by x.batch_key)
    select e.batch_key, e.qty - coalesce(a.qty, 0) as available
    from e left join a on a.batch_key = e.batch_key
    where e.qty - coalesce(a.qty, 0) > 0
    order by e.first_confirmed_at, e.batch_key     -- FIFO:最早確認的批次先分配
  loop
    exit when v_remaining <= 0;
    batch_key := v_row.batch_key;
    qty       := least(v_row.available, v_remaining);
    v_remaining := v_remaining - qty;
    return next;
  end loop;
end $fn$;
comment on function public.fn_allocate_fifo(public.cq_confirmation[], text[], text, timestamptz, public.cq_allocation[], numeric) is
  'P4a:在截止時點前的有效量扣除既有分配後,依最早確認時間 FIFO 分配 p_wanted;可用量不足只回部分(呼叫端比對總和後決定拒絕)。';

-- ── 6. 計價依據(總價／間接費隔離) ────────────────────────────────────────────
create or replace function public.fn_pricing_basis_effective(p_unit text, p_quantity numeric, p_basis text)
returns text language plpgsql immutable security invoker set search_path = pg_catalog, public as $fn$
begin
  if p_basis is not null then
    if p_basis not in ('inspection', 'supervisor_certificate', 'pro_rata', 'excluded') then
      raise exception '計價依據不明:%', p_basis;
    end if;
    return p_basis;
  end if;
  -- 總價類推定(設計 §10):單位 ∈ {式,項,批,LS} 且數量 ≤ 1;缺依據 → null(=待設定,cap 0)
  if public.fn_cq_normalize_text(p_unit) in ('式', '項', '批', 'ls') and coalesce(p_quantity, 0) <= 1 then
    return null;
  end if;
  return 'inspection';
end $fn$;
comment on function public.fn_pricing_basis_effective(text, numeric, text) is
  'P4a:工項的有效計價依據。明示 basis 原樣回傳(不明值 raise);缺 basis 時總價類回 null(待設定→fn_cap 0),其餘 inspection。';

-- ── 7. 權限:純計算層不對外 ───────────────────────────────────────────────────
revoke all on function public.fn_cq_normalize_text(text) from public, anon, authenticated;
revoke all on function public.fn_cq_batch_key(text) from public, anon, authenticated;
revoke all on function public.fn_cq_check_unit(text, text) from public, anon, authenticated;
revoke all on function public.fn_cq_qty(numeric, text, boolean) from public, anon, authenticated;
revoke all on function public.fn_cq_as_of(date) from public, anon, authenticated;
revoke all on function public.fn_contract_qty(numeric, numeric[]) from public, anon, authenticated;
revoke all on function public.fn_effective_by_batch(public.cq_confirmation[], text[], text, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_effective_confirmed(public.cq_confirmation[], text[], text, timestamptz, numeric) from public, anon, authenticated;
revoke all on function public.fn_cap(numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.fn_period_increment(numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.fn_valuation_amount(numeric, numeric) from public, anon, authenticated;
revoke all on function public.fn_batch_allocation_check(public.cq_confirmation[], text[], text, public.cq_allocation[]) from public, anon, authenticated;
revoke all on function public.fn_allocate_fifo(public.cq_confirmation[], text[], text, timestamptz, public.cq_allocation[], numeric) from public, anon, authenticated;
revoke all on function public.fn_pricing_basis_effective(text, numeric, text) from public, anon, authenticated;
