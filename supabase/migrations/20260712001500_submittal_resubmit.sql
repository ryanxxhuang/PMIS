-- ── 送審修正再送(第二輪驗收 P0-01)────────────────────────────────────────────
-- 原 submittals_guard 把「old.status ∈ 審定結果」的一切轉移都限定監造,
-- 導致廠商的正當流程「退回補正 → 已提送(修正再送,版次+1)」被 400 擋下;
-- 前端又是樂觀更新不回滾,形成「畫面假成功、對方看不到」的協作死路。
-- 修正:放行唯一一條廠商合法路徑「退回補正 → 已提送」;其餘審定轉移
-- (核准/核備/駁回、退回、撤銷審定)維持僅監造。駁回=終局,不可再送。
create or replace function public.submittals_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.admin_override(new.project_id) then return new; end if;
  -- 廠商修正再送:退回補正 → 已提送(唯一放行的非監造審定轉移)
  if old.status = '退回補正' and new.status = '已提送' then return new; end if;
  if new.status is distinct from old.status
     and (new.status in ('核准','核備','退回補正','駁回')
       or old.status in ('核准','核備','退回補正','駁回'))
     and public.my_org_type() <> 'supervisor' then
    raise exception '送審審定僅監造可執行';
  end if;
  return new;
end; $$;
