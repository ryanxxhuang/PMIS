-- ── RFI 兩步繞過修補:洗狀態→刪除的履約證據刪除路徑 ──────────────────────────
-- 撰寫 rfi_flow.sql(pgTAP)期間發現:
--   rfis_guard(20260712001300)只擋「answer 異動」與「狀態改成已回覆」;
--   rfis_delete_guard(20260712001600)只看 old.status = '待回覆'。
--   因此廠商可 ①把已回覆/已結案的 RFI 狀態洗回「待回覆」(answer 不動,guard 放行)
--   → ②刪除(delete guard 見待回覆即放行)。兩步刪掉監造正式回覆(履約證據)。
--   UI 沒有這個入口,但直接打 PostgREST API 可行。
-- 修法採雙層並用,互為保險:
--   1) rfis_guard:離開已回覆/已結案的狀態轉移僅監造可執行
--      (唯一例外:已回覆→已結案=廠商確認結案,維持既有分工)。
--   2) rfis_delete_guard:待回覆放行加驗 answer is null——狀態欄可被異動,
--      但 answer 只有監造寫得進去,以它作「監造是否已正式回覆」的權威判準。
--      監造撤回回覆(answer 清空)後,廠商仍可撤回疑義,不留死路。
-- 放行條件不變:service role、專案 cascade、admin_override(試用模式沙盒)。
-- 兩個 trigger 本體已掛在 rfis 上,僅替換函式。

create or replace function public.rfis_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare org text;
begin
  if auth.uid() is null or public.admin_override(new.project_id) then return new; end if;
  org := public.my_org_type();
  if (new.answer is distinct from old.answer
      or (new.status is distinct from old.status and new.status = '已回覆'))
     and org <> 'supervisor' then
    raise exception '回覆工程疑義僅監造可執行';
  end if;
  -- 已回覆/已結案=監造正式回覆已存在的證據狀態:離開它的轉移只有監造能做,
  -- 否則「洗回待回覆」可借道 delete guard 的待回覆放行條件
  if new.status is distinct from old.status
     and old.status in ('已回覆', '已結案')
     and not (old.status = '已回覆' and new.status = '已結案')
     and org <> 'supervisor' then
    raise exception '已回覆/已結案的工程疑義,狀態調整僅監造可執行';
  end if;
  return new;
end; $$;

create or replace function public.rfis_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.evidence_delete_bypass(old.project_id) then return old; end if;
  if old.status = '待回覆' and old.answer is null then return old; end if;
  raise exception '工程疑義已有回覆紀錄(狀態:%),不可刪除', old.status;
end; $$;
