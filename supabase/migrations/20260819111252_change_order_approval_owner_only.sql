-- ── 變更設計核定權責收斂(D-016;W8-5 真人驗收 O-3/O-4/ISSUE-8)──────────────
-- 舊 guard 把核准/駁回開給「監造或機關」,且沒有順序 gate——監造可以一步核准
-- (提出→核准),也可以撤銷機關已核准的變更,與三方權責(機關核定、監造審查,
-- 見 docs/architecture/three-party-role-model.md 與 ballInCourt 的責任語言)矛盾。
-- 新規則(狀態集合不變:提出/審核中/核准/駁回):
--   * 進入或離開 核准/駁回(含撤銷)=機關專屬;監造只剩受理審查/退回。
--   * →核准 必須從審核中(先經監造受理);→駁回 必須從提出或審核中。
--   * 提出↔審核中(受理審查/退回)=監造為主,機關亦可代行(單機關小案不卡死)。
--   * admin_override(非正式模式的專案管理者)照舊整段放行——試用行為不變。
-- 僅 replace 函式;trigger 不重掛,RLS 與「機關僅可改狀態欄」的欄位限制不動。
create or replace function public.change_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare org text;
begin
  if auth.uid() is null or public.admin_override(new.project_id) then return new; end if;
  org := public.my_org_type();
  if new.status is distinct from old.status then
    if new.status in ('核准','駁回') or old.status in ('核准','駁回') then
      -- 契約級核定(含撤銷已核准/已駁回)=機關專屬
      if org <> 'owner' then
        raise exception '變更設計核准/駁回(含撤銷)僅機關可執行;監造請用受理審查/退回';
      end if;
      -- 順序 gate:核准必經監造受理審查(審核中),不可從提出直跳
      if new.status = '核准' and old.status <> '審核中' then
        raise exception '變更設計須先由監造受理審查(審核中),機關才可核准';
      end if;
      if new.status = '駁回' and old.status not in ('提出','審核中') then
        raise exception '僅提出或審核中的變更設計可駁回';
      end if;
    elsif new.status in ('提出','審核中') and old.status in ('提出','審核中')
        and org not in ('supervisor','owner') then
      raise exception '變更設計受理審查/退回僅監造或機關可執行';
    end if;
  end if;
  if org = 'owner' and (
       new.co_no      is distinct from old.co_no
    or new.title      is distinct from old.title
    or new.co_date    is distinct from old.co_date
    or new.reason     is distinct from old.reason
    or new.sort_order is distinct from old.sort_order
  ) then
    raise exception '機關僅可核定變更設計狀態,不可修改內容';
  end if;
  return new;
end; $$;
