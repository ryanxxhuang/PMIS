-- P6b-3｜品質查驗「快速判定」與自主檢查紀錄「直接登錄」退場:收回直接寫入,判定與檢查紀錄只由文件簽署寫入
-- (D-026;設計 docs/architecture/field-documents-lifecycle.md §2.2／§5、slimming-entrypoints-and-retirement.md §3)。
--
-- 為什麼:P3b(20260919141500)／P3c(20260919222000)已把自主檢查判定、查驗判定與「不合格開缺失」下沉 DB,並提供
--   文件簽署路徑(sign_field_document:自檢表簽署寫 checklist_records;監造查驗表單簽署即判定並寫入確認量)。但舊的兩條
--   直接寫入仍開著:品質頁的「合格／不合格」快速判定(直接 UPDATE inspections.status,不寫確認量、沒有簽署文件版本)與
--   檢查表分段的「直接登錄／修訂／刪除未判定」(直接 INSERT／DELETE checklist_records)。同一件事兩條路,後者沒有版本、
--   雜湊、簽署者可核對,也讓「判定」與「可估驗的確認量」脫鉤。P6b-3 前端已移除兩條路(先前端後 DB,收緊型)。
--
-- 三層(比照 P1b 20260917210000、P4e 20260920001500):
--   1. 表級 GRANT:收回 PUBLIC／anon／authenticated 對 checklist_records 的 INSERT／UPDATE／DELETE,以及對 inspections 的
--      UPDATE(PostgREST 直接回 42501)。SELECT 不動;inspections 的 INSERT(廠商提查驗申請)與 DELETE(刪待查驗申請)照舊。
--   2. RLS:刪 checklist_records_insert／_update／_delete 與 inspections_update policy——日後即使有人再下廣域 grant,RLS 仍不放行。
--   3. guard(縱深防禦,擋「日後新增的 security definer 路徑」):
--      * checklist_records_guard:使用者路徑(auth.uid() 非 null)的 INSERT 必須在自主檢查表簽署交易內——交易 GUC
--        pmis.field_document_sign 指向同案 self_check 文件(fn_checklist_sign_bypass);其餘判定重算、修訂鏈、證據不可改／
--        不可刪規則逐字沿用 P3b。
--      * inspections_guard:使用者路徑非簽署路徑的 UPDATE,判定欄(status／result_note／inspected_by／inspected_at)一律不可變;
--        INSERT 時 result_note 與 inspected_by／inspected_at 一樣清空(查驗申請不帶判定)。P3c 的三條使用者路徑判定規則
--        (部分合格只經簽署、有有效確認量不可撤銷判定、判定僅監造)被上一條完全涵蓋,成為不可達的程式,一併移除;
--        簽署專屬欄、已判定申報資料不可改、正規化、admin override 對非判定欄的既有行為不變。
--   service role／遷移路徑(auth.uid() 為 null)與簽署路徑行為不變(資料修復、還原仍可)。
--
-- 盤點(合併前):前端 src/ 無 inspections UPDATE 與 checklist_records 寫入(quality.test.js 釘住 slice 不再有寫入函式;
--   Agent 查驗草稿自 P6b-2 起改產生自主檢查表文件);Edge 不寫兩表(草稿只寫 field_documents／AI 版本／agent_actions);
--   正式庫 2026-09-17 盤點:inspections 11(判定 10 筆皆為舊流程快速判定)、checklist_records 5(舊流程直接登錄)——照常可讀、
--   可列印、可檢附查驗;舊快速判定要更正=由查驗申請建立監造查驗表單並簽署(簽署路徑可覆寫尚無表單判定的查驗)。
-- 資料保留:不刪表、不刪列、不改任何既有值。
-- 相容:舊版前端(P6b-3 前的快取分頁)按快速判定或直接存檔會收到 42501,friendlyError 顯示「操作未完成…(代碼 42501)」,
--   畫面不變(失敗不假成功);重新整理即載入新版。
-- 回復:supabase/rollbacks/20260920030000_quality_direct_writes_retire.down.sql(重授權＋回復 policy＋兩支 guard 回 P3b／P3c 版、
--   drop fn_checklist_sign_bypass)——前端的直接寫入入口已移除,回復 DB 不會讓舊入口回來。
-- pgTAP:quality_direct_writes_retired.sql(grant／policy 形狀、三角色＋管理者直接寫入 42501、查驗申請與刪待查驗照舊、
--   guard 縱深防禦、簽署路徑照常、service role 修復路徑);既有 checklist_revisions／inspection_* 等測試改走簽署路徑模擬。

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 表級 GRANT 與 RLS
-- ═══════════════════════════════════════════════════════════════════════════
revoke insert, update, delete on public.checklist_records from public, anon, authenticated;
revoke update on public.inspections from public, anon, authenticated;

drop policy if exists "checklist_records_insert" on public.checklist_records;
drop policy if exists "checklist_records_update" on public.checklist_records;
drop policy if exists "checklist_records_delete" on public.checklist_records;
drop policy if exists "inspections_update" on public.inspections;
-- checklist_records_select、inspections_select／_insert／_delete 不動

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 自主檢查紀錄:使用者路徑只在自主檢查表簽署交易內
-- ═══════════════════════════════════════════════════════════════════════════
-- 簽署路徑判定:sign_field_document 在呼叫 self_check 分支前把交易 GUC pmis.field_document_sign 設為文件 id、呼叫後清空
create or replace function public.fn_checklist_sign_bypass(p_project uuid)
returns boolean language plpgsql stable security invoker set search_path = public as $$
declare
  v_doc uuid;
begin
  begin
    v_doc := nullif(current_setting('pmis.field_document_sign', true), '')::uuid;
  exception when others then
    return false;
  end;
  if v_doc is null then return false; end if;
  return exists (select 1 from public.field_documents d
                  where d.id = v_doc and d.doc_type = 'self_check' and d.project_id = p_project);
end; $$;
revoke all on function public.fn_checklist_sign_bypass(uuid) from public, anon, authenticated;
comment on function public.fn_checklist_sign_bypass(uuid) is
  'P6b-3:本交易是否在同案自主檢查表的簽署路徑內(sign_field_document 設的 pmis.field_document_sign)。checklist_records_guard 用。';

-- checklist_records_guard(取代 P3b 20260919141500 定義):只多「使用者路徑 INSERT 須在簽署交易內」一條,其餘逐字沿用
create or replace function public.checklist_records_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  base  public.checklist_records%rowtype;
  v_items jsonb;
  v_judge jsonb;
begin
  -- P6b-3:使用者路徑的新紀錄只能來自自主檢查表文件簽署(直接登錄退場;判定、版本、雜湊、簽署者都要可核對)
  if tg_op = 'INSERT' and uid is not null and not public.fn_checklist_sign_bypass(new.project_id) then
    raise exception '自主檢查紀錄只由自主檢查表文件簽署寫入(直接登錄已退場);請到自主檢查表頁起稿、逐項確認後簽署';
  end if;

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. inspections_guard(取代 P3c 20260919222000 定義):判定欄只由監造查驗表單簽署寫入
-- ═══════════════════════════════════════════════════════════════════════════
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
        raise exception '查驗申請建立時只能是待查驗;判定請由監造以查驗表單簽署';
      end if;
      if new.confirmed_qty is not null or new.document_id is not null or new.results is not null or new.template_id is not null then
        raise exception '確認量／查驗項目結果／查驗文件只由監造查驗表單簽署寫入';
      end if;
      -- 查驗申請不帶判定(判定人、時間、判定說明只由簽署路徑寫)
      new.inspected_by := null; new.inspected_at := null; new.result_note := null;
    end if;
    return new;
  end if;

  -- UPDATE:專案刪除 cascade、service／遷移路徑、簽署路徑(內容已由簽署分支驗過)放行
  if not exists (select 1 from public.projects p where p.id = old.project_id) then return new; end if;
  if uid is null then return new; end if;
  v_sign := public.fn_inspection_sign_bypass(old.id);
  if v_sign then return new; end if;

  -- P6b-3:判定(合格／部分合格／不合格／撤銷回待查驗)、判定說明、判定人與時間只由監造查驗表單簽署寫入;
  -- 快速判定退場(判定必有簽署文件版本,且與可估驗的確認量同一個動作)。原 P3c 的三條使用者路徑判定規則由本條涵蓋。
  if new.status is distinct from old.status or new.result_note is distinct from old.result_note
     or new.inspected_by is distinct from old.inspected_by or new.inspected_at is distinct from old.inspected_at then
    raise exception '查驗判定只能經監造查驗表單簽署(快速判定已退場);請由查驗申請建立監造查驗表單,判定並填本次確認數量後簽署';
  end if;

  -- 簽署專屬欄:只放行 FK set null(文件／版本／範本被刪),其餘不可由使用者路徑改
  if new.confirmed_qty is distinct from old.confirmed_qty or new.results is distinct from old.results
     or not (new.document_id is null or new.document_id = old.document_id)
     or not (new.document_version_no is null or new.document_version_no = old.document_version_no)
     or not (new.template_id is null or new.template_id = old.template_id) then
    raise exception '確認量／查驗項目結果／查驗文件只由監造查驗表單簽署寫入';
  end if;
  -- 已判定的查驗:申報資料不可改(工項被刪的 FK set null 放行)
  if old.status <> '待查驗'
     and (new.declared_qty is distinct from old.declared_qty
          or (new.work_item_id is distinct from old.work_item_id
              and not (new.work_item_id is null and not exists (select 1 from public.work_items w where w.id = old.work_item_id)))
          or new.batch_key is distinct from old.batch_key or new.stage_key is distinct from old.stage_key) then
    raise exception '已判定的查驗不可變更工項／位置／階段／申報數量';
  end if;
  return new;
end; $$;
revoke all on function public.inspections_guard() from public, anon, authenticated;
-- trigger 已於 20260919222000 掛上(before insert or update),函式 create or replace 即生效
