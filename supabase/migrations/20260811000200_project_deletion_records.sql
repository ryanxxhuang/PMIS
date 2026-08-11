-- 專案刪除留痕:讓「日誌保存至少六個月」這句話是真的。
--
-- 依據:附表十「事件日誌與可歸責性」普級——「訂定日誌記錄週期及留存政策,保留日誌至少六個月」;
-- 一覽表「事件日誌保存與可歸責性」普級 ●——「應確保其完整與正確性並符合機關保存年限」。
--
-- 為什麼要有這張表:audit_events.project_id 是 on delete cascade,
-- 專案一旦被刪,該案的稽核事件會**整批消失**,而且刪除這件事本身**不留任何痕跡**
-- (agent_actions、ai_usage_events 同樣 cascade)。
-- 那會讓「保存六個月」的書面政策變成一句不實陳述——這是機關稽核最不能出現的東西。
--
-- 解法:一張**不掛外鍵**的平台級刪除紀錄表,在專案刪除前先記下
-- 「誰、什麼時候、刪了哪個專案、當時有多少稽核事件」。
-- 專案沒了,這一列還在,所以刪除行為本身可歸責;也正好是委外附約
--「委託關係終止時個資之刪除」那一項的佐證。

create table if not exists public.project_deletion_records (
  id                 uuid primary key default gen_random_uuid(),
  -- 刻意不設外鍵:被刪的專案列已經不存在,有外鍵這張表就跟著被清掉,失去意義。
  project_id         uuid not null,
  project_name       text,
  deleted_by         uuid,
  deleted_at         timestamptz not null default now(),
  audit_event_count  integer not null default 0,
  actor_ip           inet
);

create index if not exists project_deletion_records_time_idx
  on public.project_deletion_records(deleted_at desc);

alter table public.project_deletion_records enable row level security;
-- 只有平台管理員讀得到:這是跨租戶的營運紀錄,不屬於任何一個專案。
drop policy if exists "project_deletion_records_select_platform_admin"
  on public.project_deletion_records;
create policy "project_deletion_records_select_platform_admin"
  on public.project_deletion_records for select to authenticated
  using (public.is_platform_admin());

revoke insert, update, delete on public.project_deletion_records
  from public, anon, authenticated;
grant select on public.project_deletion_records to authenticated;

-- 與 audit_events 同樣的 append-only 語義:寫進去就不能改、不能刪。
-- 這裡不需要 audit_events 那個「父專案已不存在就放行」的例外——本表本來就沒有父列。
create or replace function public.guard_deletion_record_immutability()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'deletion records are append-only';
end; $$;
drop trigger if exists project_deletion_records_immutable on public.project_deletion_records;
create trigger project_deletion_records_immutable
  before update or delete on public.project_deletion_records
  for each row execute function public.guard_deletion_record_immutability();
revoke all on function public.guard_deletion_record_immutability()
  from public, anon, authenticated;

-- BEFORE DELETE:此時 audit_events 尚未被 cascade 清掉,才數得到當時的事件數。
create or replace function public.record_project_deletion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_deletion_records (
    project_id, project_name, deleted_by, audit_event_count, actor_ip
  ) values (
    old.id, old.name, auth.uid(),
    (select count(*) from public.audit_events ae where ae.project_id = old.id),
    public.current_request_ip()
  );
  return old;
end; $$;
drop trigger if exists projects_record_deletion on public.projects;
create trigger projects_record_deletion before delete on public.projects
  for each row execute function public.record_project_deletion();
revoke all on function public.record_project_deletion()
  from public, anon, authenticated;

comment on table public.project_deletion_records is
  '專案刪除留痕(append-only)。刻意不掛外鍵,否則會隨被刪專案一起消失。'
  '用於證明日誌留存政策與「終止時資料刪除」義務。';
comment on table public.audit_events is
  '稽核事件(append-only)。留存政策:不設自動清除機制,至少保存六個月;'
  '唯一的移除路徑是專案刪除 cascade,該刪除行為記於 project_deletion_records。';
