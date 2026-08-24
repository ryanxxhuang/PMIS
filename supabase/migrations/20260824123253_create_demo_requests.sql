-- 收編:行銷站「申請 Demo」表單的收件表。
-- 此表由另一個工作階段於 2026-08-24 以 MCP apply_migration 直接套用到正式庫
-- (版本 20260824123253),repo 內原本沒有對應檔案,造成 migration tracker 與
-- 檔案目錄漂移、db push 被擋。本檔為依正式庫 catalog 如實重建的同版本收編檔,
-- 讓 repo 恢復單一真相;內容與線上定義逐項核對(欄位/約束/索引/RLS)。
--
-- 設計要點(照線上現狀):RLS 啟用且【零 policy】=API 角色全部 fail-closed,
-- 寫入只走 service role(行銷站後端);ip+created_at 索引供限流/稽核查詢。
create table if not exists public.demo_requests (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  role        text not null check (role in ('supervisor', 'owner', 'contractor')),
  name        text not null check (char_length(name) >= 1 and char_length(name) <= 100),
  org         text not null check (char_length(org) >= 1 and char_length(org) <= 200),
  email       text not null check (email ~ '.+@.+\..+' and char_length(email) <= 254),
  phone       text check (char_length(phone) <= 50),
  topics      text[] not null default '{}' check (cardinality(topics) <= 6),
  note        text check (char_length(note) <= 2000),
  user_agent  text check (char_length(user_agent) <= 500),
  ip          inet
);

create index if not exists demo_requests_ip_created_at_idx
  on public.demo_requests (ip, created_at desc);

alter table public.demo_requests enable row level security;
