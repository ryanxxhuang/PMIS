-- ── 自主檢查表修訂版次(第三輪驗收 P1-07/§12-7) ─────────────────────────────
-- 背景:checklist_records 存檔後只能列印/刪除,不能修改——證據既不能更正
--   (量測登載錯誤無從翻案),也沒有保護(可整列刪除滅證)。
-- 改成修訂版次模型:
--   * 舊證據不可覆寫:checklist_records 一律禁止 UPDATE(service role 除外)。
--   * 更正=新增 Rev.N 列(supersedes_id 指向前一版,revision_reason 必填),
--     rev/root_id 由 guard 依鏈自動計算,不吃前端傳值(防竄改)。
--   * 修訂鏈為線性:同一列只能被一個新版取代(supersedes_id 唯一索引)。
--   * 刪除僅限「未判定且未被修訂引用」的列;已判定=品質證據,只能以修訂更正。
--   * 缺失關聯:defects.source_checklist_record_id 一律指向鏈根(root_id),
--     部分唯一索引保證同一張檢查表(鏈)最多一筆未結案缺失——修訂後再判不合格
--     不會重複開缺失;原缺失結案後再翻不合格才會開新缺失。
-- 可回退:supabase/rollbacks/20260712001600_checklist_revisions.down.sql

-- ── 1) checklist_records 版次欄位 ────────────────────────────────────────────
alter table public.checklist_records
  add column if not exists rev             int  not null default 0,
  add column if not exists supersedes_id   uuid references public.checklist_records(id),
  add column if not exists root_id         uuid,
  add column if not exists revision_reason text;

update public.checklist_records set root_id = id where root_id is null;
alter table public.checklist_records alter column root_id set not null;

-- 鏈為線性:一列最多被一個修訂版取代
create unique index if not exists checklist_records_supersedes_uidx
  on public.checklist_records(supersedes_id) where supersedes_id is not null;
create index if not exists checklist_records_root_idx on public.checklist_records(root_id);

-- ── 2) defects 來源關聯:同一張檢查表(鏈)最多一筆未結案缺失 ──────────────────
alter table public.defects
  add column if not exists source_checklist_record_id uuid
    references public.checklist_records(id) on delete set null;
create unique index if not exists defects_open_per_checklist_uidx
  on public.defects(source_checklist_record_id) where status <> '已結案';

-- ── 3) checklist_records_guard ───────────────────────────────────────────────
create or replace function public.checklist_records_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  base public.checklist_records%rowtype;
begin
  -- 版次/鏈完整性:所有來源一體適用(service role 也不能寫出斷鏈資料)
  if tg_op = 'INSERT' then
    if new.supersedes_id is not null then
      select * into base from public.checklist_records where id = new.supersedes_id;
      if not found then
        raise exception '被修訂的檢查紀錄不存在';
      end if;
      if base.project_id <> new.project_id then
        raise exception '修訂版必須與原檢查紀錄同一專案';
      end if;
      if base.template_id is distinct from new.template_id then
        raise exception '修訂版必須沿用原檢查表範本;換範本請另立新檢查';
      end if;
      if new.revision_reason is null or btrim(new.revision_reason) = '' then
        raise exception '建立修訂版次必須填寫更正原因';
      end if;
      new.rev     := base.rev + 1;
      new.root_id := coalesce(base.root_id, base.id);
    elsif uid is null then
      -- service role(遷移/還原):只補漏,不覆寫既有值
      new.rev     := coalesce(new.rev, 0);
      new.root_id := coalesce(new.root_id, new.id);
    else
      new.rev := 0; new.root_id := new.id;
    end if;
  end if;

  -- service role/SQL Editor 放行(資料修復仍可 UPDATE/DELETE)
  if uid is null then return coalesce(new, old); end if;
  -- 專案刪除 cascade:父專案列已先刪 → 放行,勿擋整案刪除
  if tg_op in ('UPDATE','DELETE')
     and not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    new.created_by := uid;  -- 登錄者即建立者,不可冒名
    return new;
  end if;

  -- 舊證據不可覆寫:任何就地修改一律拒絕,更正走修訂版次
  if tg_op = 'UPDATE' then
    raise exception '檢查紀錄為品質證據,不可就地修改;請以「修訂」建立 Rev.N 更正';
  end if;

  -- DELETE:已判定=證據不可刪;被修訂引用=鏈上證據不可刪
  if old.overall in ('合格','不合格') then
    raise exception '已判定的檢查紀錄不可刪除;如需更正請建立修訂版次';
  end if;
  if exists (select 1 from public.checklist_records c where c.supersedes_id = old.id) then
    raise exception '此檢查紀錄已被修訂版次引用,不可刪除';
  end if;
  return old;
end; $$;

drop trigger if exists checklist_records_guard on public.checklist_records;
create trigger checklist_records_guard
  before insert or update or delete on public.checklist_records
  for each row execute function public.checklist_records_guard();
