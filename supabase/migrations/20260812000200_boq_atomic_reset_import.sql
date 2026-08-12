-- W1｜標單資料安全:重設與匯入原子化(產品全案評估報告 2026-08-12 P0-01/P0-02)。
--
-- 問題:
--   P0-01 前端 resetProjectBoq 逐表 delete 且不檢查錯誤——daily_logs 沒有 guard 會被
--         靜默刪光,work_items 卻可能被證據 guard(品質檢查紀錄/已核定估驗)擋下,
--         結果「日誌全滅、標單還在、畫面說成功」。
--   P0-02 前端 importWorkItems 每 500 筆分批 insert,後批失敗時前批已永久寫入,
--         大標單留下半份資料,重試又因殘留而錯亂。
--
-- 修法:兩個 security definer RPC,各自單一交易內全成或全敗。
--   權限沿用 can_write(與既有八張表的 RLS 寫入條件一致,不改變授權語意)。
--   既有證據 guard trigger(已核定估驗明細、已判定查驗、品質檢查紀錄 set-null、
--   已結案缺失 set-null、已核准變更明細 set-null)照常觸發——任何一條 raise,
--   整包 rollback,資料與現況完全相同。這是刻意行為:正式資料有簽核證據時,
--   重設本來就該被擋下,而不是半刪。
--
-- 資料保留/相容/回復:不動任何既有資料與表結構,只新增兩個函式;
--   回復方式= drop function。前端同批改為呼叫 RPC(src/store.jsx、
--   src/store/slices/projects.js),舊的逐表/分批寫入路徑同批移除。

-- ── 重設:清空本專案 work_items 與相依資料(估驗/進度/日誌/查驗) ────────────────
-- 刪除順序與原前端一致:估驗/查驗先於工項——估驗先刪,其明細 cascade 時
-- valuation_items_guard 查父列已刪會放行(真正的擋關在 valuations_delete_guard)。
-- 缺失不清:統一引擎後缺失是履約證據且不依賴標單,只因 work_items 刪除被解除
-- 工項連結(FK set null;已結案缺失的 set-null 會被 defects_guard 擋→整包 rollback)。
create or replace function public.reset_project_boq(p_project_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  n_inspections int; n_valuations int; n_schedule int; n_logs int; n_items int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.can_write(p_project_id) then
    raise exception '此帳號無權清空此專案的標單資料';
  end if;
  -- 與 import_work_items 共用同一把 per-project 交易鎖:
  -- 重設/匯入互相序列化,並發下不會出現「邊刪邊插」的交錯結果
  perform pg_advisory_xact_lock(hashtextextended('boq:' || p_project_id::text, 0));

  delete from public.inspections      where project_id = p_project_id;
  get diagnostics n_inspections = row_count;
  delete from public.valuations       where project_id = p_project_id;
  get diagnostics n_valuations = row_count;
  delete from public.schedule_periods where project_id = p_project_id;
  get diagnostics n_schedule = row_count;
  delete from public.daily_logs       where project_id = p_project_id;
  get diagnostics n_logs = row_count;
  delete from public.work_items       where project_id = p_project_id;
  get diagnostics n_items = row_count;

  -- 大量銷毀留痕:刪了幾筆什麼,稽核端看得到(actor 資訊由 record_audit_event 自取)
  perform public.record_audit_event(
    p_project_id, 'boq.reset', 'boq', p_project_id, 'reset',
    null, null,
    jsonb_build_object(
      'work_items', n_items, 'daily_logs', n_logs, 'valuations', n_valuations,
      'inspections', n_inspections, 'schedule_periods', n_schedule),
    null);
end; $$;
revoke all on function public.reset_project_boq(uuid) from public, anon;
grant execute on function public.reset_project_boq(uuid) to authenticated;

-- ── 匯入:整份標單一次進,全成或全敗 ─────────────────────────────────────────
-- p_items = PCCES 解析結果陣列,元素鍵與 work_items 欄位同名(item_key/parent_key/…)。
-- id 改由伺服器產生;父子關係用「先全部插入(parent_id null)、再依 payload 的
-- parent_key 一次 update 回填」建立——不依賴 sort_order 排序保 FK 的脆弱假設。
-- 只允許匯入空專案:重複匯入(兩份標單混在一起)是資料災難,擋在伺服器端。
create or replace function public.import_work_items(p_project_id uuid, p_items jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n_items int;
  bad_key text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.can_write(p_project_id) then
    raise exception '此帳號無權匯入標單工項';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception '匯入內容是空的,請重新選擇標單 XML';
  end if;
  -- per-project 交易鎖必須在「空專案」檢查之前:read committed 下兩個並發匯入
  -- 都看不到彼此未提交的列,沒有鎖會雙雙通過檢查、留下兩份交錯的標單
  -- (work_items 無 (project_id, item_key) 唯一約束,DB 不會擋)。
  perform pg_advisory_xact_lock(hashtextextended('boq:' || p_project_id::text, 0));
  if exists (select 1 from public.work_items w where w.project_id = p_project_id) then
    raise exception '此專案已有標單工項,請先清空重匯';
  end if;

  -- payload 一致性檢查:壞資料整包拒收,不能半份進庫。
  -- (舊前端行為:重複 item_key 會撞主鍵半途爆掉、缺父項會被靜默當成根節點)
  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(item_key text)
    where coalesce(btrim(x.item_key), '') = ''
  ) then
    raise exception '標單資料含空白項次鍵(item_key),請確認 XML 解析結果';
  end if;

  select x.item_key into bad_key
  from jsonb_to_recordset(p_items) as x(item_key text)
  group by x.item_key having count(*) > 1 limit 1;
  if found then
    raise exception '標單資料的項次鍵重複:%', bad_key;
  end if;

  select p.pk into bad_key
  from (select distinct nullif(x.parent_key, '') as pk
          from jsonb_to_recordset(p_items) as x(item_key text, parent_key text)
         where nullif(x.parent_key, '') is not null) p
  left join jsonb_to_recordset(p_items) as y(item_key text) on y.item_key = p.pk
  where y.item_key is null
  limit 1;
  if found then
    raise exception '標單資料的父項不存在:%', bad_key;
  end if;

  -- 布林/預設值用 coalesce 對齊欄位 default——jsonb 缺鍵是 null,
  -- 不能像舊 insert 那樣靠「undefined 鍵被丟棄→吃欄位 default」。
  insert into public.work_items (
    project_id, item_key, item_no, ref_item_code, item_kind, description, unit,
    quantity, unit_price, amount, section, depth, sort_order,
    is_leaf, is_rollup, is_price_adjustable, is_billable, weight, remark
  )
  select
    p_project_id, x.item_key, x.item_no, x.ref_item_code, x.item_kind,
    x.description, x.unit, x.quantity, x.unit_price, x.amount, x.section,
    x.depth, x.sort_order,
    coalesce(x.is_leaf, false), coalesce(x.is_rollup, false),
    coalesce(x.is_price_adjustable, false), coalesce(x.is_billable, true),
    x.weight, x.remark
  from jsonb_to_recordset(p_items) as x(
    item_key text, parent_key text, item_no text, ref_item_code text,
    item_kind text, description text, unit text,
    quantity numeric, unit_price numeric, amount numeric,
    section text, depth int, sort_order int,
    is_leaf boolean, is_rollup boolean, is_price_adjustable boolean,
    is_billable boolean, weight numeric, remark text
  );
  get diagnostics n_items = row_count;

  update public.work_items c
     set parent_id = p.id
    from jsonb_to_recordset(p_items) as x(item_key text, parent_key text),
         public.work_items p
   where c.project_id = p_project_id
     and c.item_key = x.item_key
     and nullif(x.parent_key, '') is not null
     and p.project_id = p_project_id
     and p.item_key = x.parent_key;

  perform public.record_audit_event(
    p_project_id, 'boq.imported', 'boq', p_project_id, 'imported',
    null, null, jsonb_build_object('work_items', n_items), null);

  return n_items;
end; $$;
revoke all on function public.import_work_items(uuid, jsonb) from public, anon;
grant execute on function public.import_work_items(uuid, jsonb) to authenticated;
