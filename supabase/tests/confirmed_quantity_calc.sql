-- P4a 監造確認量與估驗上限的純計算層(pgTAP):釘住需求 §8「監造確認量與計價」中所有能在
-- 純計算層表達的情境(設計 docs/architecture/confirmed-quantity-valuation.md §3.1、§11、§14)。
-- 函式只吃明確輸入(composite 陣列),不讀表;P4b 的表、guard、RPC 之後以表資料餵入。
-- 執行方式:本地 supabase(colima)+容器內 psql(npm run test:db),整份在交易內執行並 rollback。
begin;

select plan(83);

-- ── 存在、揮發性、權限 ─────────────────────────────────────────────────────────
select has_type('public', 'cq_confirmation', '確認紀錄輸入型別存在');
select has_type('public', 'cq_allocation', '分配輸入型別存在');
select has_function('public', 'fn_effective_by_batch', array['public.cq_confirmation[]', 'text[]', 'text', 'timestamptz'], 'fn_effective_by_batch 存在');
select has_function('public', 'fn_effective_confirmed', array['public.cq_confirmation[]', 'text[]', 'text', 'timestamptz', 'numeric'], 'fn_effective_confirmed 存在');
select has_function('public', 'fn_contract_qty', array['numeric', 'numeric[]'], 'fn_contract_qty 存在');
select has_function('public', 'fn_cap', array['numeric', 'numeric', 'numeric', 'text'], 'fn_cap 存在');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'fn\_%'
     and p.proname in ('fn_cq_normalize_text','fn_cq_batch_key','fn_cq_check_unit','fn_cq_qty','fn_cq_as_of',
       'fn_contract_qty','fn_effective_by_batch','fn_effective_confirmed','fn_cap','fn_period_increment',
       'fn_valuation_amount','fn_batch_allocation_check','fn_allocate_fifo','fn_pricing_basis_effective')
     and p.provolatile = 'i' and not p.prosecdef),
  14, '14 支純函式全部 IMMUTABLE 且 security invoker');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fn_cq_normalize_text','fn_cq_batch_key','fn_cq_check_unit','fn_cq_qty','fn_cq_as_of',
       'fn_contract_qty','fn_effective_by_batch','fn_effective_confirmed','fn_cap','fn_period_increment',
       'fn_valuation_amount','fn_batch_allocation_check','fn_allocate_fifo','fn_pricing_basis_effective')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'anon／authenticated 都不能直接呼叫純計算函式(上限與金額不在前端算)');

-- ── 測試用簡寫 ────────────────────────────────────────────────────────────────
create or replace function pg_temp.c(b text, s text, u text, q numeric, at timestamptz, st text default 'active')
returns public.cq_confirmation language sql immutable as $$ select (b, s, u, q, at, st)::public.cq_confirmation $$;
create or replace function pg_temp.a(b text, q numeric)
returns public.cq_allocation language sql immutable as $$ select (b, q)::public.cq_allocation $$;

-- ── 正規化與截止時點 ──────────────────────────────────────────────────────────
select is(public.fn_cq_normalize_text(' Ａ區　１Ｆ  M² '), 'a區1fm2', '正規化:去空白(含全形空白)、全形→半形、²→2、小寫');
select is(public.fn_cq_normalize_text('ｍ２／ｚ'), 'm2/z', '全形小寫字母與符號(對照表中反斜線之後的字元)也正確對齊');
select is(public.fn_cq_normalize_text(null), '', 'null 正規化為空字串');
select throws_like($$ select public.fn_cq_batch_key('　 ') $$, '%批次鍵不可為空%', '空批次鍵被拒絕');
select is(public.fn_cq_as_of('2026-09-30'), '2026-09-30 23:59:59.999999+08'::timestamptz, '截止日=該日台北整天(含 23:59:59.999999)');
select is(public.fn_cq_as_of(null), null::timestamptz, '無截止日=不設截止');

-- ── 契約量(含核准變更) ────────────────────────────────────────────────────────
select is(public.fn_contract_qty(100, array[20, -5]), 115.0000, '契約量 = 標單量 + Σ核准變更(追加 20、減帳 5)');
select is(public.fn_contract_qty(100, null), 100.0000, '無變更=標單量');
select is(public.fn_contract_qty(null, null), 0.0000, '標單量缺值視為 0(無契約量=不可計價)');
select throws_like($$ select public.fn_contract_qty(10, array[-20]) $$, '%契約量為負%', '減帳超過標單量被拒絕');

-- ── §8:申報 100 未經監造通過 → 0 ────────────────────────────────────────────
select is(public.fn_effective_confirmed('{}', null, 'm2', null, 100), 0.0000, '無任何監造確認:有效確認量 0');
select is(public.fn_cap(public.fn_effective_confirmed(null, null, 'm2', null, 100), 0, 0), 0.0000, '申報 100 未經監造通過:可新增 0');

-- ── §8:通過 60 → 最多 60;已計價 20 → 剩 40 ──────────────────────────────────
select is(public.fn_effective_confirmed(array[pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08')], null, 'm2', null, 100),
  60.0000, '監造通過 60:有效確認量 60');
select is(public.fn_cap(60, 0, 0), 60.0000, '通過 60 未計價:本期最多新增 60');
select is(public.fn_cap(60, 20, 0), 40.0000, '通過 60、已計價 20:剩 40');
select is(public.fn_cap(60, 20, 30), 10.0000, '通過 60、已計價 20、他期草稿占用 30:剩 10');
select is(public.fn_cap(60, 20, 50), 0.0000, '已計價＋占用超過有效量:上限 0 不為負');
select is(public.fn_cap(60, null, null), 60.0000, '無分配列(null)視為 0');

-- ── §8:同批多照片／兩次查驗／複查/多階段不重複 ─────────────────────────────
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08'),
    pg_temp.c('A區', null, 'm2', 60, '2026-09-02 10:00+08'),
    pg_temp.c('A區', null, 'm2', 60, '2026-09-03 10:00+08')
  ], null, 'm2', null, 1000), 60.0000, '同一批次兩次查驗、複查各簽累計 60:仍是 60,不累加成 180');
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08'),
    pg_temp.c('Ａ區 ', null, 'm2', 60, '2026-09-02 10:00+08')
  ], null, 'm2', null, 1000), 60.0000, '批次鍵僅全形／空白差異視為同一批次');
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08'),
    pg_temp.c('A區', null, 'm2', 55, '2026-09-01 10:00+08')
  ], null, 'm2', null, 1000), 55.0000, '同時刻並列取最小(保守、可重現)');

-- ── §8:不合格 40 改善後通過 → 只增新確認的 40 ─────────────────────────────
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08'),
    pg_temp.c('A區', null, 'm2', 100, '2026-09-08 10:00+08')
  ], null, 'm2', null, 1000), 100.0000, '複查簽累計 100:有效量 100(不是 160)');
select is(public.fn_cap(100, 60, 0), 40.0000, '先前 60 已計價:改善後只能再新增 40');
select results_eq($$ select batch_key, qty from public.fn_allocate_fifo(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08'),
    pg_temp.c('A區', null, 'm2', 100, '2026-09-08 10:00+08')
  ], null, 'm2', null, array[pg_temp.a('A區', 60)], 40) $$,
  $$ values ('a區'::text, 40.0000::numeric) $$, '分配:扣除已分配 60 後只剩 40 可分');
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', null, 'm2', 100, '2026-09-01 10:00+08'),
    pg_temp.c('A區', null, 'm2', 70, '2026-09-08 10:00+08')
  ], null, 'm2', null, 1000), 70.0000, '重簽較小累計=減量:最新一筆生效');

-- ── §8:不同位置同工項不誤混 ─────────────────────────────────────────────────
select results_eq($$ select batch_key, qty from public.fn_effective_by_batch(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08'),
    pg_temp.c('B區', null, 'm2', 30, '2026-09-03 10:00+08'),
    pg_temp.c('A區', null, 'm2', 60, '2026-09-05 10:00+08')
  ], null, 'm2', null) $$,
  $$ values ('a區'::text, 60.0000::numeric), ('b區', 30.0000) $$, '各批次分開計:A 60、B 30');
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08'),
    pg_temp.c('B區', null, 'm2', 30, '2026-09-03 10:00+08')
  ], null, 'm2', null, 1000), 90.0000, '工項有效量=各批次相加 90');

-- ── §8:多階段必要查驗(鋼筋→模板→澆置)取最小、缺階段=0 ──────────────────────
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', '鋼筋', 'm3', 100, '2026-09-01 10:00+08'),
    pg_temp.c('A區', '模板', 'm3', 100, '2026-09-02 10:00+08')
  ], array['鋼筋', '模板', '澆置'], 'm3', null, 1000), 0.0000, '三階段缺澆置:批次量 0');
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', '鋼筋', 'm3', 100, '2026-09-01 10:00+08'),
    pg_temp.c('A區', '模板', 'm3', 100, '2026-09-02 10:00+08'),
    pg_temp.c('A區', '澆置', 'm3', 80, '2026-09-03 10:00+08')
  ], array['鋼筋', '模板', '澆置'], 'm3', null, 1000), 80.0000, '三階段齊全取最小 80,不是相加 280');
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', '鋼筋', 'm3', 100, '2026-09-01 10:00+08'),
    pg_temp.c('A區', '模板', 'm3', 100, '2026-09-02 10:00+08'),
    pg_temp.c('A區', '澆置', 'm3', 80, '2026-09-03 10:00+08'),
    pg_temp.c('A區', '澆置', 'm3', 80, '2026-09-04 10:00+08'),
    pg_temp.c('A區', '外觀', 'm3', 100, '2026-09-05 10:00+08')
  ], array['鋼筋', '模板', '澆置'], 'm3', null, 1000), 80.0000, '澆置重複簽與非必要階段(外觀)都不加量');
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', null, 'm3', 100, '2026-09-01 10:00+08')
  ], array['鋼筋', '模板', '澆置'], 'm3', null, 1000), 0.0000, '多階段工項的無階段確認不計(缺必要階段)');
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', '鋼筋', 'm3', 100, '2026-09-01 10:00+08')
  ], null, 'm3', null, 1000), 0.0000, '單階段工項的帶階段確認不計(階段不在必要集合)');
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', ' 鋼筋 ', 'm3', 50, '2026-09-01 10:00+08')
  ], array['鋼筋', '', null], 'm3', null, 1000), 50.0000, '階段鍵正規化;必要集合中的空值忽略');

-- ── §8:部分通過(查驗範圍 100、通過 60)只寫 60 ───────────────────────────────
select is(public.fn_effective_confirmed(array[pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08')], null, 'm2', null, 100),
  60.0000, '部分通過:只計監造簽的累計通過量 60(待改善 40 不進確認量)');

-- ── 撤銷 ─────────────────────────────────────────────────────────────────────
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08', 'revoked')
  ], null, 'm2', null, 100), 0.0000, '撤銷的確認不計');
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08'),
    pg_temp.c('A區', null, 'm2', 100, '2026-09-08 10:00+08', 'revoked')
  ], null, 'm2', null, 1000), 60.0000, '撤銷最新一筆後退回前一筆 active 的累計 60');

-- ── §8:截止日 ────────────────────────────────────────────────────────────────
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-30 23:30+08'),
    pg_temp.c('A區', null, 'm2', 100, '2026-10-01 00:30+08')
  ], null, 'm2', public.fn_cq_as_of('2026-09-30'), 1000), 60.0000, '截止日後(台北 10/1 00:30)的確認排除;9/30 23:30 仍算');
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', null, 'm2', 100, '2026-10-01 00:30+08')
  ], null, 'm2', public.fn_cq_as_of('2026-09-30'), 1000), 0.0000, '截止日前無確認=0(UTC 9/30 16:30 不會被當成 9/30)');

-- ── §8:超契約量 ──────────────────────────────────────────────────────────────
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08'),
    pg_temp.c('B區', null, 'm2', 60, '2026-09-02 10:00+08')
  ], null, 'm2', null, 100), 100.0000, '確認總量 120 受契約量 100 約束');
select is(public.fn_effective_confirmed(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08'),
    pg_temp.c('B區', null, 'm2', 60, '2026-09-02 10:00+08')
  ], null, 'm2', null, public.fn_contract_qty(100, array[10])), 110.0000, '核准追加 10 後契約量 110');
select throws_like($$ select public.fn_period_increment(120, 20, 100) $$, '%超過契約量%', '累計量超契約量被拒絕');

-- ── §8:跨期累計與本期差額 ────────────────────────────────────────────────────
select is(public.fn_period_increment(60, 20, 100), 40.0000, '前期累計 20、本期累計 60:本期增量 40');
select is(public.fn_period_increment(60, null, 100), 60.0000, '第一期無前期:增量=累計');
select is(public.fn_period_increment(50, 60, 100), -10.0000, '累計下降回負增量(是否允許由 clawback 規則決定,不在此吞掉)');

-- ── §8:兩期占用不超過可用量(不變量 2:分配總和檢核) ──────────────────────────
select results_eq($$ select batch_key, effective_qty, allocated_qty, available_qty from public.fn_batch_allocation_check(
    array[pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08')], null, 'm2',
    array[pg_temp.a('A區', 40), pg_temp.a('A區', 20)]) $$,
  $$ values ('a區'::text, 60.0000::numeric, 60.0000::numeric, 0.0000::numeric) $$, '兩期各占 40、20=剛好用完(可用 0)');
select is((select available_qty from public.fn_batch_allocation_check(
    array[pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08')], null, 'm2',
    array[pg_temp.a('A區', 40), pg_temp.a('A區', 30)])), -10.0000, '兩期各占 40、30=超額 10(available 為負→拒絕)');
select is((select available_qty from public.fn_batch_allocation_check(
    array[pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08')], null, 'm2',
    array[pg_temp.a('B區', 10)]) where batch_key = 'b區'), -10.0000, '分配到沒有確認的批次=超額');
select is((select available_qty from public.fn_batch_allocation_check(
    array[pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08')], null, 'm2',
    array[pg_temp.a('A區', 60), pg_temp.a('A區', -20)])), 20.0000, 'clawback(負分配)釋放可用量');
select results_eq($$ select batch_key, qty from public.fn_allocate_fifo(array[
    pg_temp.c('B區', null, 'm2', 30, '2026-09-03 10:00+08'),
    pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08')
  ], null, 'm2', null, array[pg_temp.a('A區', 50)], 25) $$,
  $$ values ('a區'::text, 10.0000::numeric), ('b區', 15.0000) $$, 'FIFO:最早確認的 A 先分剩餘 10,再分 B 15');
select is((select coalesce(sum(qty), 0) from public.fn_allocate_fifo(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08')
  ], null, 'm2', null, array[pg_temp.a('A區', 50)], 25)), 10.0000, '可用量不足只分得 10(呼叫端比對 25 後拒絕,不會多分)');
select is((select count(*)::int from public.fn_allocate_fifo(array[
    pg_temp.c('A區', null, 'm2', 60, '2026-09-30 23:30+08'),
    pg_temp.c('B區', null, 'm2', 30, '2026-10-01 00:30+08')
  ], null, 'm2', public.fn_cq_as_of('2026-09-30'), null, 100) where batch_key = 'b區'), 0, '截止日後才確認的批次不參與本期分配');

-- ── §8:錯單位、負值、非有限值 ───────────────────────────────────────────────
select throws_like($$ select public.fn_effective_confirmed(array[pg_temp.c('A區', null, 'm3', 60, '2026-09-01 10:00+08')], null, 'm2', null, 100) $$,
  '%單位不一致%', '確認單位 m3 ≠ 工項單位 m2 被拒絕');
select throws_like($$ select public.fn_effective_confirmed(array[pg_temp.c('A區', null, null, 60, '2026-09-01 10:00+08')], null, 'm2', null, 100) $$,
  '%單位不一致%', '確認缺單位被拒絕');
select lives_ok($$ select public.fn_effective_confirmed(array[pg_temp.c('A區', null, 'M²', 60, '2026-09-01 10:00+08')], null, 'm2', null, 100) $$,
  '單位 M² 與 m2 正規化後相等');
select throws_like($$ select public.fn_effective_confirmed(array[pg_temp.c('A區', null, 'm2', -1, '2026-09-01 10:00+08')], null, 'm2', null, 100) $$,
  '%不得為負%', '負確認量被拒絕');
select throws_like($$ select public.fn_effective_confirmed(array[pg_temp.c('A區', null, 'm2', 'NaN', '2026-09-01 10:00+08')], null, 'm2', null, 100) $$,
  '%NaN%', 'NaN 確認量被拒絕');
select throws_like($$ select public.fn_effective_confirmed(array[pg_temp.c('A區', null, 'm2', 'Infinity', '2026-09-01 10:00+08')], null, 'm2', null, 100) $$,
  '%非有限值%', '無限大確認量被拒絕');
select throws_like($$ select public.fn_effective_confirmed(array[pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08', 'revoked')], null, 'm2', null, -5) $$,
  '%契約量不得為負%', '負契約量被拒絕');
select throws_like($$ select public.fn_cap(60, -1, 0) $$, '%不得為負%', '負已計價量被拒絕');
select throws_like($$ select public.fn_cap(null, 0, 0) $$, '%缺值%', '有效量缺值被拒絕(呼叫端不得省略)');
select throws_like($$ select public.fn_effective_confirmed(array[pg_temp.c('A區', null, 'm2', 60, '2026-09-01 10:00+08', 'pending')], null, 'm2', null, 100) $$,
  '%狀態不明%', '狀態不明的確認紀錄被拒絕(不靜默略過)');
select throws_like($$ select public.fn_effective_confirmed(array[pg_temp.c('A區', null, 'm2', 60, null)], null, 'm2', null, 100) $$,
  '%缺確認時間%', '缺確認時間被拒絕');
select throws_like($$ select public.fn_effective_confirmed(array[pg_temp.c('', null, 'm2', 60, '2026-09-01 10:00+08')], null, 'm2', null, 100) $$,
  '%批次鍵不可為空%', '缺批次鍵被拒絕');

-- ── 精度與金額 ────────────────────────────────────────────────────────────────
select is(public.fn_cq_qty(60.00005, 'x'), 60.0001, '數量四捨五入到 4 位小數(對齊 numeric(18,4))');
select is(public.fn_valuation_amount(33.3333, 3), 100::numeric, '金額逐工項四捨五入到元(Q2 暫行):33.3333×3=99.9999→100');
select is(public.fn_valuation_amount(10, null), 0::numeric, '單價缺值視為 0');
select throws_like($$ select public.fn_valuation_amount(10, 'NaN') $$, '%單價%', 'NaN 單價被拒絕');

-- ── 總價／間接費:缺計價依據 → cap 0 ────────────────────────────────────────
select is(public.fn_pricing_basis_effective('式', 1, null), null, '總價類(式、數量 1)缺依據=待設定');
select is(public.fn_pricing_basis_effective('ＬＳ', null, null), null, 'LS 缺依據=待設定(全形亦辨識)');
select is(public.fn_pricing_basis_effective('m2', 100, null), 'inspection', '實體工項缺列=依查驗');
select is(public.fn_pricing_basis_effective('式', 1, 'supervisor_certificate'), 'supervisor_certificate', '明示依據原樣回傳');
select throws_like($$ select public.fn_pricing_basis_effective('式', 1, 'guess') $$, '%計價依據不明%', '不明依據被拒絕');
select is(public.fn_cap(100, 0, 0, public.fn_pricing_basis_effective('式', 1, null)), 0.0000, '總價工項缺 basis:即使有確認量 cap 也是 0');
select is(public.fn_cap(100, 0, 0, 'excluded'), 0.0000, 'excluded:不由本系統計價,cap 0');
select is(public.fn_cap(100, 0, 0, 'supervisor_certificate'), 100.0000, '監造確認單依據:依有效量計');

select * from finish();
rollback;
