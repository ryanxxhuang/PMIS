-- 回復 20260920001500_valuation_items_seal(P4e):重開 authenticated 對 valuation_items 的直接寫入(回到 P4b 相容窗)。
-- 以資料庫擁有者在 SQL Editor／psql 執行。
-- 資料:前向 migration 不刪列、不改值,這裡只回復權限、policy 與六支函式的 P4b(20260919140000)版本;
--   回復後舊前端／直接 REST 又能寫草稿明細(標 backing='legacy'、送審／核定仍被檢查點擋),訊息數字回到 60.0000 格式。
-- 注意:只在需要重開舊客戶端寫入時才回復;P4c 起前端已無此路徑,回復本支不會讓任何頁面恢復功能。
begin;

grant insert, update, delete on public.valuation_items to authenticated;

drop policy if exists "valuation_items_write" on public.valuation_items;
create policy "valuation_items_write" on public.valuation_items for all to authenticated
  using (valuation_id in (select id from public.valuations v where public.can_write(v.project_id)))
  with check (valuation_id in (select id from public.valuations v where public.can_write(v.project_id)));

-- valuation_items_guard:P4b 版本(非重算寫入標 legacy;已核定明細備註監造可改)
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
revoke all on function public.valuation_items_guard() from public, anon, authenticated;

-- 以下五支:P4b 版本(訊息以 %s 印 numeric)
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
revoke all on function public.inspection_confirmations_guard() from public, anon, authenticated;

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
revoke all on function public.valuation_item_sources_guard() from public, anon, authenticated;

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

commit;
