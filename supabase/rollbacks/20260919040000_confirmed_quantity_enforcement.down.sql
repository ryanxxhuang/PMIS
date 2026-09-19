-- 回復 20260919040000_confirmed_quantity_enforcement(P4b):drop 新表／欄／函式／trigger,
-- 還原 valuations_guard／valuation_items_guard 為 20260712001300_formal_mode 版本(trigger 定義回 baseline:
-- valuations_guard 只在 UPDATE)。legacy 來源列隨 valuation_item_sources 一起移除;valuation_items 原值(cum_qty／
-- amount_cum)本支沒有改寫既有列,不需還原。確認紀錄／調整是履約證據:回復前先匯出
-- (select * from inspection_confirmations / valuation_adjustments),本檔會連同資料 drop。
-- 執行方式:supabase db query --linked -f supabase/rollbacks/20260919040000_confirmed_quantity_enforcement.down.sql
begin;

-- ── trigger ─────────────────────────────────────────────────────────────────
drop trigger if exists inspection_points_stage_guard on public.inspection_points;
drop trigger if exists work_items_confirmation_guard on public.work_items;
drop trigger if exists valuations_checkpoint_guard on public.valuations;
drop trigger if exists inspection_confirmations_after_change on public.inspection_confirmations;
drop trigger if exists inspection_confirmations_guard on public.inspection_confirmations;
drop trigger if exists valuation_item_sources_after_delete on public.valuation_item_sources;
drop trigger if exists valuation_item_sources_guard on public.valuation_item_sources;
drop trigger if exists valuation_adjustments_guard on public.valuation_adjustments;
drop trigger if exists work_item_pricing_basis_guard on public.work_item_pricing_basis;

-- ── RPC ─────────────────────────────────────────────────────────────────────
drop function if exists public.list_billable_backlog(uuid);
drop function if exists public.get_valuation_state(uuid);
drop function if exists public.set_work_item_pricing_basis(uuid, text, jsonb);
drop function if exists public.admin_adjust_valuation_item(uuid, uuid, numeric, text);
drop function if exists public.void_valuation_adjustment(uuid, text);
drop function if exists public.issue_supervisor_certificate(uuid, uuid, text, text, text, text, numeric, text, text, uuid);
drop function if exists public.revoke_inspection_confirmation(uuid, text);
drop function if exists public.transition_valuation(uuid, text, text, text);
drop function if exists public.set_valuation_item_cum(uuid, uuid, numeric);
drop function if exists public.sync_valuation_from_confirmations(uuid);
drop function if exists public.fn_cq_rpc_valuation_internal(uuid, boolean, boolean);

-- ── 內部流程與 trigger 函式 ──────────────────────────────────────────────────
drop function if exists public.fn_cq_backfill_legacy_internal(uuid);
drop function if exists public.inspection_confirmations_after_change();
drop function if exists public.fn_cq_reconcile_internal(uuid, uuid, text, uuid);
drop function if exists public.fn_cq_target_draft_internal(uuid, timestamptz);
drop function if exists public.fn_cq_allocate_to_cap_internal(uuid, uuid);
drop function if exists public.fn_cq_allocate_internal(uuid, uuid, numeric);
drop function if exists public.fn_cq_recompute_item_internal(uuid, uuid, text);
drop function if exists public.inspection_points_stage_guard();
drop function if exists public.work_items_confirmation_guard();
drop function if exists public.valuations_checkpoint_guard();
drop function if exists public.work_item_pricing_basis_guard();
drop function if exists public.valuation_adjustments_guard();
drop function if exists public.valuation_item_sources_after_delete();
drop function if exists public.valuation_item_sources_guard();
drop function if exists public.inspection_confirmations_guard();
drop function if exists public.fn_cq_period_check_internal(uuid, text);
drop function if exists public.fn_cq_period_work_items_internal(uuid);
drop function if exists public.fn_cq_item_state_internal(uuid, uuid, uuid);
drop type if exists public.cq_item_state;
drop function if exists public.fn_cq_prev_cum_internal(uuid, uuid, int);
drop function if exists public.fn_cq_missing_stages_internal(public.cq_confirmation[], text[], text);
drop function if exists public.fn_cq_voided_internal(uuid, uuid);
drop function if exists public.fn_cq_allocations_internal(uuid, uuid, int, uuid);
drop function if exists public.fn_cq_confirmations_internal(uuid, uuid);
drop function if exists public.fn_cq_basis_internal(uuid);
drop function if exists public.fn_cq_contract_qty_internal(uuid);
drop function if exists public.fn_cq_required_stages_internal(uuid);
drop function if exists public.fn_cq_can_confirm_internal(uuid, uuid);
drop function if exists public.fn_cq_raise_internal(text, text, jsonb);
drop function if exists public.fn_cq_lock_internal(uuid, uuid);
drop function if exists public.fn_cq_restore_internal(text);
drop function if exists public.fn_cq_set_internal(boolean);
drop function if exists public.fn_cq_internal();

-- ── 表(順序:來源 → 調整 → 確認 → 依據) ─────────────────────────────────────
drop table if exists public.valuation_item_sources;
drop table if exists public.valuation_adjustments;
drop table if exists public.inspection_confirmations;
drop table if exists public.work_item_pricing_basis;

-- ── 既有表加欄 ─────────────────────────────────────────────────────────────
alter table public.inspection_points drop column if exists required_for_billing, drop column if exists stage_key;
alter table public.valuation_items drop column if exists backing;
alter table public.valuations drop column if exists recheck_note, drop column if exists recheck_required;

-- ── 還原 guard(20260712001300_formal_mode 版本;trigger 定義同 baseline) ──────────
create or replace function public.valuations_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare org text;
begin
  if auth.uid() is null or public.admin_override(new.project_id) then return new; end if;
  org := public.my_org_type();
  if new.status is distinct from old.status
     and (new.status = '已核定' or old.status = '已核定')
     and org <> 'supervisor' then
    raise exception '估驗核定/退回核定僅監造可執行';
  end if;
  if org = 'owner' and (
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
  return new;
end; $$;
drop trigger if exists valuations_guard on public.valuations;
create trigger valuations_guard before update on public.valuations
  for each row execute function public.valuations_guard();

create or replace function public.valuation_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select project_id, status into v from public.valuations
    where id = coalesce(new.valuation_id, old.valuation_id);
  if v.status = '已核定'
     and not public.admin_override(v.project_id)
     and public.my_org_type() <> 'supervisor' then
    raise exception '已核定估驗的明細不可再修改(需監造退回後重編)';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists valuation_items_guard on public.valuation_items;
create trigger valuation_items_guard before insert or update or delete on public.valuation_items
  for each row execute function public.valuation_items_guard();

-- H3 之後 trigger 函式本來就不給 authenticated;保持一致
revoke all on function public.valuations_guard() from public, anon, authenticated;
revoke all on function public.valuation_items_guard() from public, anon, authenticated;

commit;
