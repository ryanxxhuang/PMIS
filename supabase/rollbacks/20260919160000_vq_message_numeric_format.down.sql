-- 回復 20260919160000_vq_message_numeric_format:set_valuation_item_cum 重建為 P4b(20260919140000)版本、刪除 fn_cq_txt。
-- 資料不受影響(本支只改訊息文字)。

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

drop function if exists public.fn_cq_txt(numeric);
