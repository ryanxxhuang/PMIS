-- ── 契約義務:動作權限只看歸屬 + 完成時間戳 ──────────────────────────────
-- 契約重點 · 履約時程改版(PR #55)的後端跟進,補兩個已揭露的缺口:
--
-- 1) update 政策從 can_write(專案級;機關唯讀)改為「自己方的義務才能改」,
--    對齊設計契約(design_handoff_contract_highlights_timeline README §1:
--    「動作權限與角色無關,只看歸屬」):
--      - 機關自此可標記自己的義務完成(估驗撥付/初驗/驗收);
--      - 廠商/監造不再能改「別方」的義務——前端本來就只給自己的義務渲染
--        操作,現在伺服器也擋(修掉 devtools 可跨方改狀態的縫);
--      - with check 同一條規則:改 responsible 把義務讓渡給別方也會被擋;
--      - admin_override(非正式模式的專案管理者)照舊放行,正式模式自動失效。
--    insert/delete 政策不動(仍 can_write):義務列是 system-managed,人工補登
--    走 requirement 審核流,不在本次範圍。
--    物化與審核 RPC(materialize_deadline_obligation/review_requirement)是
--    security definer,不受本政策影響。
--
-- 2) completed_at / completed_by:狀態進入完成態(已提送/已完成)時由 trigger
--    蓋伺服器時間戳與操作人、退回未完成態時清空;client 送來的值一律作廢
--    (時間戳不可竄改)。用途:執行紀錄可歸責到人與時間;準時率可升級為
--    「應完成項準時率」(完成時間 ≤ 到期日才算準時,遲交補完成不再灌高比率
--    ——handoff 待確認問題 3 的定案)。既有完成列不回填:completed_at 為空
--    的歷史資料在前端一律視為準時,不臆造歷史。

-- caller 的契約方:org_type → 責任方文字(值域對齊 contract_obligations.responsible)。
-- my_org_type() 對未知 org 落回 contractor,這裡對映後不會回 null。
create or replace function public.my_party()
returns text language sql security definer stable set search_path = public as $$
  select case public.my_org_type()
    when 'contractor' then '廠商'
    when 'supervisor' then '監造'
    when 'owner' then '機關'
    else null end;
$$;

-- 義務歸屬方:三方以外的值(null/空字串/自由文字)一律落回廠商。
-- ⚠️ 與前端 obligationParty(src/lib/obligationTimeline.js)是同一條 fallback,
-- 兩邊必須同步改,否則「畫面說可操作、伺服器說不行」。
create or replace function public.obligation_party(r text)
returns text language sql immutable as $$
  select case when r in ('廠商','監造','機關') then r else '廠商' end;
$$;

drop policy if exists "contract_obligations_update" on public.contract_obligations;
create policy "contract_obligations_update" on public.contract_obligations
  for update to authenticated
  using (
    project_id in (select public.my_project_ids())
    and (public.admin_override(project_id)
      or public.obligation_party(responsible) = public.my_party())
  )
  with check (
    project_id in (select public.my_project_ids())
    and (public.admin_override(project_id)
      or public.obligation_party(responsible) = public.my_party())
  );

alter table public.contract_obligations
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references auth.users(id) on delete set null;

comment on column public.contract_obligations.completed_at is
  '進入完成態(已提送/已完成)的伺服器時間戳;由 stamp_obligation_completion trigger 蓋,client 值一律作廢;退回未完成態清空。準時率=台北日 completed_at ≤ 到期日。';
comment on column public.contract_obligations.completed_by is
  '標記完成的操作人(auth.uid());與 completed_at 同進退,供執行紀錄歸責。';

-- 完成時間戳只有 trigger 能寫:先把 client 送來的值整組還原,再依狀態轉換蓋章。
-- 已提送 → 已完成 視為同一次履行的升級,不重蓋(保留首次完成時間,準時率才不失真)。
create or replace function public.stamp_obligation_completion()
returns trigger language plpgsql set search_path = public as $$
declare
  done_old boolean := old.status in ('已提送', '已完成');
  done_new boolean := new.status in ('已提送', '已完成');
begin
  new.completed_at := old.completed_at;
  new.completed_by := old.completed_by;
  if done_new and not done_old then
    new.completed_at := now();
    new.completed_by := auth.uid();
  elsif done_old and not done_new then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end $$;

drop trigger if exists contract_obligations_stamp_completion on public.contract_obligations;
create trigger contract_obligations_stamp_completion
  before update on public.contract_obligations
  for each row execute function public.stamp_obligation_completion();
