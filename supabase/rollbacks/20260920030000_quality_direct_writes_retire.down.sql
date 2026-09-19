-- 回復 20260920030000_quality_direct_writes_retire(P6b-3)。
-- 效果:重授權 authenticated 對 checklist_records 的 INSERT／UPDATE／DELETE 與 inspections 的 UPDATE、回復 baseline 的四條
--   policy、checklist_records_guard 回 P3b(20260919141500)版、inspections_guard 回 P3c(20260919222000)版、drop fn_checklist_sign_bypass。
-- 注意:前端的快速判定與直接登錄入口已於 P6b-3 移除,回復 DB 不會讓舊入口回來(要恢復舊行為須連前端一起還原)。
-- 資料:本 migration 不動任何列,回復也不動。

grant insert, update, delete on public.checklist_records to authenticated;
grant update on public.inspections to authenticated;

drop policy if exists "checklist_records_insert" on public.checklist_records;
create policy "checklist_records_insert" on public.checklist_records for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "checklist_records_update" on public.checklist_records;
create policy "checklist_records_update" on public.checklist_records for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "checklist_records_delete" on public.checklist_records;
create policy "checklist_records_delete" on public.checklist_records for delete to authenticated
  using (public.can_write(project_id));
drop policy if exists "inspections_update" on public.inspections;
create policy "inspections_update" on public.inspections for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));

-- ── checklist_records_guard:P3b 20260919141500 版(逐字) ──
create or replace function public.checklist_records_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  base  public.checklist_records%rowtype;
  v_items jsonb;
  v_judge jsonb;
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

  -- service role/SQL Editor 放行(資料修復仍可 UPDATE/DELETE;判定不重算——範本日後修改不得改判歷史證據)
  if uid is null then return coalesce(new, old); end if;
  -- 專案刪除 cascade:父專案列已先刪 → 放行,勿擋整案刪除
  if tg_op in ('UPDATE','DELETE')
     and not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    new.created_by := uid;  -- 登錄者即建立者,不可冒名
    -- P3b:判定由伺服器依範本量化標準重算(客戶端送來的 pass／overall 作廢);範本已刪或不存在則照客戶端值保存
    if new.template_id is not null then
      select t.items into v_items from public.checklist_templates t where t.id = new.template_id;
      if jsonb_typeof(v_items) = 'array' then
        v_judge := public.fn_checklist_judge(v_items, new.results);
        new.results := v_judge -> 'results';
        new.overall := v_judge ->> 'overall';
      end if;
    end if;
    return new;
  end if;

  -- 舊證據不可覆寫:任何就地修改一律拒絕,更正走修訂版次
  if tg_op = 'UPDATE' then
    raise exception '檢查紀錄為品質證據,不可就地修改;請以「修訂」建立 Rev.N 更正';
  end if;

  -- DELETE:已判定=證據不可刪;被修訂引用=鏈上證據不可刪;已綁簽署文件=簽署版本的事實列不可刪(P3b)
  if old.overall in ('合格','不合格') then
    raise exception '已判定的檢查紀錄不可刪除;如需更正請建立修訂版次';
  end if;
  if exists (select 1 from public.checklist_records c where c.supersedes_id = old.id) then
    raise exception '此檢查紀錄已被修訂版次引用,不可刪除';
  end if;
  if public.fn_field_document_target_signed('self_check', old.id) then
    raise exception '此檢查紀錄是已簽署自主檢查表文件的事實列,不可刪除;更正請在該文件建立新版本並重新簽署';
  end if;
  return old;
end; $$;
revoke all on function public.checklist_records_guard() from public, anon, authenticated;
-- trigger 已於 20260712001700 掛上(before insert or update or delete),函式 create or replace 即生效

-- ── inspections_guard:P3c 20260919222000 版(逐字) ──
create or replace function public.inspections_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  v_sign boolean := false;
  v_wi   record;
begin
  -- 正規化(所有路徑):單位由工項、批次鍵由位置、階段鍵正規化、申報量四位小數
  if new.work_item_id is not null then
    select w.unit, w.project_id into v_wi from public.work_items w where w.id = new.work_item_id;
    if not found or v_wi.project_id <> new.project_id then
      raise exception '查驗的工項不存在或不屬於本專案';
    end if;
    new.unit := nullif(btrim(coalesce(v_wi.unit, '')), '');
  else
    new.unit := null;
  end if;
  new.batch_key := case when nullif(btrim(coalesce(new.location, '')), '') is null then null
                        else public.fn_cq_batch_key(new.location) end;
  new.stage_key := nullif(public.fn_cq_normalize_text(new.stage_key), '');
  if new.declared_qty is not null then new.declared_qty := public.fn_cq_qty(new.declared_qty, '申報數量'); end if;

  if tg_op = 'INSERT' then
    if uid is not null then
      if new.status <> '待查驗' then
        raise exception '查驗申請建立時只能是待查驗;判定請由監造執行';
      end if;
      if new.confirmed_qty is not null or new.document_id is not null or new.results is not null or new.template_id is not null then
        raise exception '確認量／查驗項目結果／查驗文件只由監造查驗表單簽署寫入';
      end if;
      new.inspected_by := null; new.inspected_at := null;
    end if;
    return new;
  end if;

  -- UPDATE:專案刪除 cascade、service／遷移路徑、簽署路徑(內容已由簽署分支驗過)放行
  if not exists (select 1 from public.projects p where p.id = old.project_id) then return new; end if;
  if uid is null then return new; end if;
  v_sign := public.fn_inspection_sign_bypass(old.id);
  if v_sign then return new; end if;

  -- 簽署專屬欄:只放行 FK set null(文件／版本／範本被刪),其餘不可由使用者路徑改
  if new.confirmed_qty is distinct from old.confirmed_qty or new.results is distinct from old.results
     or not (new.document_id is null or new.document_id = old.document_id)
     or not (new.document_version_no is null or new.document_version_no = old.document_version_no)
     or not (new.template_id is null or new.template_id = old.template_id) then
    raise exception '確認量／查驗項目結果／查驗文件只由監造查驗表單簽署寫入';
  end if;
  if new.status = '部分合格' and old.status is distinct from '部分合格' then
    raise exception '部分合格只能經監造查驗表單簽署判定(須填本次確認數量)';
  end if;
  -- 有有效確認量的查驗不可撤銷判定(確認量以判定為依據);先撤銷確認
  if old.status <> '待查驗' and new.status = '待查驗'
     and exists (select 1 from public.inspection_confirmations c where c.inspection_id = old.id and c.status = 'active') then
    raise exception '此查驗已有有效的監造確認量,不可撤銷判定;請先撤銷該確認紀錄';
  end if;
  -- 已判定的查驗:申報資料不可改(工項被刪的 FK set null 放行)
  if old.status <> '待查驗' and new.status <> '待查驗'
     and (new.declared_qty is distinct from old.declared_qty
          or (new.work_item_id is distinct from old.work_item_id
              and not (new.work_item_id is null and not exists (select 1 from public.work_items w where w.id = old.work_item_id)))
          or new.batch_key is distinct from old.batch_key or new.stage_key is distinct from old.stage_key) then
    raise exception '已判定的查驗不可變更工項／位置／階段／申報數量;請先撤銷判定';
  end if;

  if public.admin_override(new.project_id) then return new; end if;
  if new.status is distinct from old.status
     and (new.status <> '待查驗' or old.status <> '待查驗')
     and public.my_org_type() <> 'supervisor' then
    raise exception '查驗判定(合格/部分合格/不合格)僅監造可執行';
  end if;
  return new;
end; $$;
revoke all on function public.inspections_guard() from public, anon, authenticated;

drop function if exists public.fn_checklist_sign_bypass(uuid);
