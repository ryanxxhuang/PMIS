-- PMIS AI — 標單工項 work_items（Increment 2）
-- 整個 PMIS 的「脊椎」：從 PCCES 預算書/標單（DetailList）匯入的工項階層。
-- 估驗計價、進度 S 曲線、數量管制、品質檢驗點，全部掛在工項底下。
-- 在 Supabase 後台 → SQL Editor 接著 0001 之後執行。

create table if not exists public.work_items (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  parent_id    uuid references public.work_items(id) on delete cascade,

  -- ── PCCES 原始欄位 ───────────────────────────────────────────────
  item_key     text,            -- PCCES itemKey（同一份文件內唯一，用於建父子關係）
  item_no      text,            -- 項次，如 壹.一.6.3.28
  ref_item_code text,           -- PCCES 工項代碼（可掛單價分析 / 施工綱要規範章節）
  item_kind    text,            -- mainItem | general | analysis | subtotal | variablePrice | formula
  description  text not null,   -- 工項名稱
  unit         text,            -- 單位（M2、式、t…）
  quantity     numeric,         -- 契約數量
  unit_price   numeric,         -- 單價
  amount       numeric,         -- 複價（數量×單價）

  -- ── 衍生 / 管理欄位 ──────────────────────────────────────────────
  section      text,            -- 所屬頂層分段（壹/貳/參/肆）
  depth        int,             -- 階層深度（頂層=1）
  sort_order   int,             -- 文件原始順序（保留標單排序）
  is_leaf      boolean default false,  -- 末端工項（無子項，才是真正計價單元）
  is_rollup    boolean default false,  -- subtotal/formula 合計列 → 加總時排除避免重複
  is_price_adjustable boolean default false, -- variablePrice 物價調整項
  is_billable  boolean default true,   -- 發包工程費(壹/貳)=true；非發包(參/肆)=false
  weight       numeric,         -- 進度權重 = amount / 發包工程費總額（僅發包末端工項）
  remark       text,

  -- ── 估驗累計（估驗模組會更新；施工日誌之後可回填 qty_completed）─────
  qty_completed numeric default 0,     -- 累計完成數量

  created_at   timestamptz not null default now()
);

create index if not exists work_items_project_idx on public.work_items(project_id);
create index if not exists work_items_parent_idx  on public.work_items(parent_id);

alter table public.work_items enable row level security;

create policy "work_items_members_all"
  on public.work_items for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));
