-- P4d 順帶:VQ005／VQ006 訊息裡的數量不再帶 numeric 小數尾(60.0000 → 60、60.5000 → 60.5)。
-- 根因:確認量／分配量欄位是 numeric(18,4)、fn_cq_qty 也 round(·,4),format('%s') 直接印出定標數字;
-- 前端 friendlyError 原樣顯示 DB 訊息(設計 §16.3 要求訊息繁中可直接顯示),所以在訊息組裝處統一轉字串。
-- 新增純函式 fn_cq_txt(numeric) = trim_scale 後的文字(值不變、只去尾零),並以 create or replace 重建
-- set_valuation_item_cum(P4b 20260919140000 §6.2;本體除訊息數字外逐字相同)。
-- 其餘仍以 %s 印數量的訊息(fn_cq_item_state_internal 的逐工項違反 message、確認紀錄 guard 的減量訊息、
-- 批次 guard)留給 P4e 收回直接寫入時一併改用 fn_cq_txt(續接清單 §7 已列)。
-- 回復:supabase/rollbacks/20260919160000_vq_message_numeric_format.down.sql(重建 P4b 版本、刪 fn_cq_txt)。

create or replace function public.fn_cq_txt(p numeric)
returns text language sql immutable strict parallel safe set search_path = pg_catalog as $fn$
  select trim_scale(p)::text
$fn$;
comment on function public.fn_cq_txt(numeric) is 'P4d:錯誤訊息用的數量文字——trim_scale 去掉 numeric(18,4) 的尾零,值不變;只供訊息組裝,不參與計算。';
revoke all on function public.fn_cq_txt(numeric) from public, anon, authenticated;

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
    perform public.fn_cq_raise_internal('VQ005', format('累計量 %s 超過契約量 %s', public.fn_cq_txt(v_cum), public.fn_cq_txt(st.contract_qty)));
  end if;
  -- 本期的確認來源重新分配:先扣掉留在本期的扣回／調整(可負),再以 [0, limit] 檢查;
  -- limit = 依據閘門(E − B − O − 本期扣回／調整);legacy 與既有確認來源會被重算取代
  floor_q := st.prev_cum + st.clawback_qty + st.adjustment_qty;
  wanted  := v_cum - floor_q;
  limit_q := public.fn_cap(greatest(0, st.effective_cutoff - st.billed - st.reserved - st.clawback_qty - st.adjustment_qty), 0, 0, st.basis);
  if wanted < 0 then
    perform public.fn_cq_raise_internal('VQ006', format('累計量 %s 低於前期累計 %s;減量須走撤銷／調整流程', public.fn_cq_txt(v_cum), public.fn_cq_txt(floor_q)),
      jsonb_build_object('prev_cum', st.prev_cum, 'floor', floor_q, 'cap', st.cap, 'limit', limit_q, 'wanted', v_cum));
  end if;
  if wanted > limit_q then
    perform public.fn_cq_raise_internal('VQ006',
      format('本期最多可新增 %s(有效確認量 %s − 已計價 %s − 其他期占用 %s%s),要求新增 %s', public.fn_cq_txt(limit_q), public.fn_cq_txt(st.effective_cutoff), public.fn_cq_txt(st.billed), public.fn_cq_txt(st.reserved),
        case when st.basis is null then ';總價／間接費缺計價依據,暫時隔離' else '' end, public.fn_cq_txt(wanted)),
      jsonb_build_object('prev_cum', st.prev_cum, 'floor', floor_q, 'cap', st.cap, 'limit', limit_q, 'wanted', wanted,
        'effective', st.effective_cutoff, 'billed', st.billed, 'reserved', st.reserved, 'basis', st.basis));
  end if;
  v_prev := public.fn_cq_set_internal(true);
  delete from public.valuation_item_sources
    where valuation_id = v.id and work_item_id = p_work_item_id and kind in ('confirmation', 'legacy');
  got := public.fn_cq_allocate_internal(v.id, p_work_item_id, wanted);
  if round(got, 4) <> round(wanted, 4) then
    perform public.fn_cq_raise_internal('VQ006',
      format('可用確認量不足:要求新增 %s,依批次只能分配 %s', public.fn_cq_txt(wanted), public.fn_cq_txt(got)),
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

-- 對應 pgTAP:supabase/tests/confirmed_quantity_enforcement.sql(VQ006 訊息數字不帶小數尾;fn_cq_txt 授權)
