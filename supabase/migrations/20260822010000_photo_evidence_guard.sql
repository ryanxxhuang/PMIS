-- 體檢 P1|佐證照片保全:photos 無 delete guard、無留痕——廠商成員可在估驗核定後
-- 把不利照片無痕滅證,機關勾稽時佐證缺圖且查無刪除紀錄,直接打臉「佐證鏈不可竄改」。
-- ---------------------------------------------------------------------------
-- 設計(比照 evidence_guards 的證據防護模式):
-- * 凍結條件走確定性判定 photo_frozen_reason:①照片的工項已列入「已核定/已請款」
--   估驗的明細(佐證包 listPhotosByWorkItems 以工項聚照片,核定即凍結;taken_at
--   晚於核定期別 period_end 的新照片不受影響,後續期別仍可正常補拍/清理);
--   ②照片被契約重點以 evidence 連結引用(requirement_artifact_links 只掛核定
--   Requirement,連結是多型無 FK,實體刪除會留下懸空佐證)。
-- * 凍結照片除了擋 DELETE,也擋「改掛」UPDATE(id/project_id/work_item_id/
--   daily_log_id/storage_path/taken_at/created_at/uploaded_by/gps)——與
--   20260822000200 RFI 修正同一課:只擋刪除的 guard 可先洗欄位再刪,一路繞光。
--   說明/施作區域等註記欄不凍結。
-- * 留痕:photos 每筆 DELETE 一律寫 audit_events(photo.deleted,before 快照含
--   storage_path 與 uploaded_by;actor/IP 由 record_audit_event 自取)。
-- * 放行沿用 evidence_delete_bypass:service role/專案刪除級聯/試用模式管理者。
--   注意:施工日誌刪除會級聯刪照片,凍結照片會把整筆日誌刪除一起擋下——這是
--   刻意的,否則「刪日誌」就是繞過照片 guard 的免費後門。reset_project_boq:
--   估驗來源的凍結(事由①)要嘛估驗非草稿先被 valuations_delete_guard 擋、
--   要嘛同交易內凍結來源已消失;契約重點連結的凍結(事由②)只凍照片本體,
--   work_items 刪除經 FK set null 解除工項連結屬參照動作,update guard 放行
--   (見下),標單重匯入不會被擋死。
-- * Storage 同步:DB 列擋了但 photos bucket 原始檔仍可直刪=半套。比照 W14
--   storage_path_in_use 的「只准清孤兒檔」:仍被 DB 引用(照片列/送審附件/
--   缺失·RFI·觀察的標註圖)的物件不可經 Storage API 刪除;合法流程(先刪 DB 列
--   再清檔,src/store/slices/site.js deleteSitePhoto)不受影響。

-- ── 凍結判定(確定性;回傳 null=未凍結,否則回傳中文事由) ─────────────────────
create or replace function public.photo_frozen_reason(
  p_project uuid, p_work_item uuid, p_taken timestamptz, p_created timestamptz, p_photo uuid
) returns text language plpgsql stable security definer set search_path = public as $$
declare v_period int; v_status text;
begin
  -- ① 已核定估驗涵蓋:期別無迄日(period_end null)時保守凍結
  if p_work_item is not null then
    select v.period_no, v.status into v_period, v_status
    from public.valuations v
    join public.valuation_items vi on vi.valuation_id = v.id
    where v.project_id = p_project
      and vi.work_item_id = p_work_item
      and v.status in ('已核定', '已請款')
      -- 業務日期=台北日曆日(全站原則,對齊 src/lib/dates.js taipeiISODate):
      -- timestamptz 直接 ::date 吃伺服器時區(UTC),台北 00:00–08:00 拍的
      -- 次期照片會被上一期誤凍結
      and (v.period_end is null
           or (coalesce(p_taken, p_created) at time zone 'Asia/Taipei')::date
              <= v.period_end)
    order by v.period_no
    limit 1;
    if found then
      return format('照片為第 %s 期估驗(%s)的佐證', v_period, v_status);
    end if;
  end if;
  -- ② 契約重點 evidence 連結(連結建立時已驗證 Requirement 為核定狀態)
  if exists (
    select 1 from public.requirement_artifact_links l
    where l.artifact_type = 'evidence' and l.artifact_id = p_photo
  ) then
    return '照片已連結契約重點作為佐證';
  end if;
  return null;
end; $$;
revoke all on function public.photo_frozen_reason(uuid, uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;

-- ── 刪除:凍結即擋;放行的刪除一律留痕 ───────────────────────────────────────
create or replace function public.photos_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_reason text;
begin
  if not public.evidence_delete_bypass(old.project_id) then
    v_reason := public.photo_frozen_reason(
      old.project_id, old.work_item_id, old.taken_at, old.created_at, old.id);
    if v_reason is not null then
      raise exception '%;為保全佐證鏈不可刪除(誤配照片可於佐證包列印時排除,或由監造退回估驗後處理)', v_reason;
    end if;
  end if;
  -- 留痕不分路徑(試用模式/整批刪除也要查得到誰刪了什麼);專案刪除級聯時
  -- record_audit_event 見父專案已消失會自行略過
  perform public.record_audit_event(old.project_id, 'photo.deleted',
    'photo', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
  return old;
end; $$;
revoke all on function public.photos_delete_guard() from public, anon, authenticated;
drop trigger if exists photos_delete_guard on public.photos;
create trigger photos_delete_guard before delete on public.photos
  for each row execute function public.photos_delete_guard();

-- ── 改掛:凍結照片不可變更身分/證據欄位(先洗再刪的繞道) ───────────────────
-- 白名單三類缺一不可:①連結身分(project_id/work_item_id/daily_log_id)
-- ②識別與檔案(id/storage_path——改 PK 會讓 requirement_artifact_links 的
--   多型連結懸空,凍結事由②瞬間消失)③證據內容(taken_at/created_at——
--   taken_at 為 null 時 created_at 是凍結判定的後備依據,洗到 period_end 之後
--   即解凍;uploaded_by/gps 是來歷與現場位置證明)。
-- ai_source 刻意不凍:它標記「說明/工項是 AI 填的」,而 AI 批次辨識回寫
-- (site.js updateSitePhotoMeta)連補說明都會帶 ai_source=true——凍它等於
-- 把明文放行的 caption 註記欄一起鎖死;它也不參與任何凍結判定或連結。
create or replace function public.photos_update_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_reason text; v_ref_detach boolean;
begin
  if public.evidence_delete_bypass(old.project_id) then return new; end if;
  -- 參照動作放行:work_items 刪除(reset_project_boq 標單重匯/單項刪除)由
  -- FK on delete set null 把 work_item_id 洗成 null——照片本體與其餘欄位原封
  -- 不動,不是滅證,不該把 BOQ 重匯入擋死。「真的是參照動作」採雙重判定:
  -- ① pg_trigger_depth()>1:從另一個觸發器內部來(RI 內部觸發器算深度;
  --    使用者無 DDL 權限,造不出自己的觸發器來偽裝);
  -- ② 原工項列已不存在:RI 觸發器在父列刪除後才跑;手動 update 時父列仍在
  --    (FK 也不允許殘留懸空值),直接洗 work_item_id=null 依然被擋。
  v_ref_detach := old.work_item_id is not null
    and new.work_item_id is null
    and pg_trigger_depth() > 1
    and not exists (select 1 from public.work_items w where w.id = old.work_item_id);
  if (new.work_item_id is distinct from old.work_item_id and not v_ref_detach)
     or new.id           is distinct from old.id
     or new.daily_log_id is distinct from old.daily_log_id
     or new.storage_path is distinct from old.storage_path
     or new.taken_at     is distinct from old.taken_at
     or new.created_at   is distinct from old.created_at
     or new.uploaded_by  is distinct from old.uploaded_by
     or new.gps_lat      is distinct from old.gps_lat
     or new.gps_lng      is distinct from old.gps_lng
     or new.project_id   is distinct from old.project_id then
    v_reason := public.photo_frozen_reason(
      old.project_id, old.work_item_id, old.taken_at, old.created_at, old.id);
    if v_reason is not null then
      raise exception '%;不可改掛工項/日誌、變更檔案路徑或竄改拍攝紀錄(說明等註記欄不受限)', v_reason;
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.photos_update_guard() from public, anon, authenticated;
drop trigger if exists photos_update_guard on public.photos;
create trigger photos_update_guard before update on public.photos
  for each row execute function public.photos_update_guard();

-- ── Storage 同步:photos bucket 只准清孤兒檔 ─────────────────────────────────
-- 仍被 DB 引用的活檔不可經 Storage API 直刪,否則 DB 側 guard 形同虛設
-- (檔案沒了、列還在=佐證已毀)。photos bucket 除照片本體外還放送審附件與
-- 缺失/RFI/觀察的標註圖,一併視為活檔。helper 走 security definer:
-- 呼叫者的 RLS 看不見別人建的列,直接寫 exists 子查詢會誤判成孤兒。
create or replace function public.photo_storage_path_in_use(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.photos p where p.storage_path = p_name)
      or exists (select 1 from public.submittals s where s.attachment_path = p_name)
      or exists (select 1 from public.defects d where d.markup_path = p_name)
      or exists (select 1 from public.rfis r where r.markup_path = p_name)
      or exists (select 1 from public.observations o where o.markup_path = p_name)
$$;
revoke all on function public.photo_storage_path_in_use(text) from public, anon;
grant execute on function public.photo_storage_path_in_use(text) to authenticated;

-- 活檔判定的熱路徑:photos 是這個 bucket 的大表,policy 逐物件呼叫要走索引
create index if not exists photos_storage_path_idx on public.photos(storage_path);

drop policy if exists "photos_objects_delete" on storage.objects;
create policy "photos_objects_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos'
    and public.can_write(((storage.foldername(name))[1])::uuid)
    and not public.photo_storage_path_in_use(name));
