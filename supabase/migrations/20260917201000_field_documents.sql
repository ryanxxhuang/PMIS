-- P2a｜現場文書家族的資料層(D-026;設計 docs/architecture/field-documents-lifecycle.md §2、§8、§9)。
--
-- 為什麼:四類現場文書(施工日誌／監造日誌／自主檢查表／監造查驗表單)目前沒有「版本＋內容雜湊＋
-- 簽署者＋伺服器時間＋簽署意願」的簽署模型,也沒有提送／退回歷史／回執;照片辨識結果上傳前
-- 只存在頁面 state,切頁即失;photos 沒有「誰上傳的」伺服器事實,廠商照片可被拿去冒充監造證據。
-- 本支只建資料層與其約束:表、RLS、欄位級 grant、guard trigger、稽核事件、索引、回填。
-- 簽署／提送 RPC(P2d)、Edge 起稿(P2b)、前端(P2c)之後才接;但「RPC 以外的路徑都繞不過」的
-- 不變量在這裡先釘死,之後的 RPC 只是這些不變量之上的窄門,不是唯一的防線。
--
-- 不變量(全部 DB 強制;「所有寫入者」=含 service role;「使用者」=auth.uid() 不為 null 的路徑,
-- 亦即 authenticated 直接寫入與 security definer RPC):
--   photos
--     * uploader_org 由伺服器決定:使用者插入一律蓋成 my_org_type();使用者路徑不可變更;
--       uploaded_by 同樣蓋成 auth.uid()。service 插入依 uploaded_by 的 profile 推得,推不出=null(未知),不猜。
--     * ai_status／ai_result／ai_run_at／work_item_hint／uploader_org:authenticated 無欄位級 grant
--       (辨識結果只能由 Edge service 寫,客戶端不能自稱「AI 說白板寫 100」)。
--     * intake_id、content_sha256 一旦登錄,使用者路徑不可改;掛進批次的照片必須與批次同專案、同上傳方。
--   photo_intakes(一次上傳=一批)
--     * created_by／uploader_org／status／進度欄由伺服器決定;使用者只能改 log_date、把批次捨棄
--       (discarded)、以及切換候選文書的 excluded;其餘處理狀態與候選清單由 Edge service 寫。
--     * 有照片或已起稿文件的批次不可刪除(照片是證據);只有 received 且空的批次可刪。
--   field_documents(文件本體,四類共用)
--     * owner_org／target_table 由 doc_type 決定(generated column,任何人都無法寫入不一致的值)。
--     * 使用者只能 INSERT(草稿;欄位級 grant 只開 id/project_id/doc_type/doc_date/intake_id/template_id);
--       沒有 UPDATE／DELETE grant:狀態、版本指標、必填欄、待補清單一律經 RPC(P2d)或 service。
--     * 狀態轉移矩陣與結構要件:signed 必須對應目前版本的簽署列;submitted／received／returned
--       必須對應提送／收件／退回列;簽後更正只能以「新版本」回到草稿;received／discarded／superseded 終態。
--     * 起稿批次的上傳方必須等於文件責任方(廠商批次不能起稿監造文件);範本、事實列必須同專案。
--   field_document_versions:不可變(UPDATE／DELETE 一律拒絕,只放行專案刪除 cascade);
--     content_hash 只由 DB 以 fn_field_document_content_hash 計算(客戶端傳值一律覆蓋);
--     version_no 只能是下一版;human 版本只能由登入者建立、ai 版本只能由 service 建立;
--     文件已有人工版本後 AI 不得再寫版本(重試不覆蓋人工修正);附件照片必須存在且同專案。
--   field_document_signatures:append-only;只能在有登入者的情境寫入(伺服器不得代簽);
--     所簽版本必須是目前版本、雜湊必須等於該版本雜湊;signer_id／signer_org／姓名快照／signed_at／aal／
--     IP／UA 全由伺服器取;method=platform_account_mfa 時 JWT aal 必須是 aal2(登記不得說謊);
--     簽署者必須是責任方成員(admin_override 例外)。「簽署必須 MFA」的產品政策在 P2d RPC。
--   field_document_submissions:append-only;只能在有登入者的情境寫入;submit 需該版本已簽署、
--     to_org 依 doc_type 矩陣;receive／return 必須由該版本的提送對象執行,to_org 由伺服器帶入;
--     return 必填 reason;再送時 diff 由 DB 比對前次退回版本與本版計算;client_request_id 唯一=送件重試防重複。
--   稽核:field_document.{created,version_saved,signed,submitted,received,returned,amended,discarded,
--     superseded,status_changed} 由 AFTER trigger 經 record_audit_event 寫入,所有路徑一致。
--
-- 可見性:四張文件表與 photo_intakes 都是專案範圍(與 photos／daily_logs／inspections 一致,含監造日誌
--   Q4 暫行「專案成員可讀」);契約分級(can_read_contract_package)只管 documents／requirements 家族,
--   本家族不掛契約包、不外洩契約分級內容;跨案由 my_project_ids() 隔離。
-- 資料保留:不動任何既有列的既有欄;photos 加欄全部 nullable;uploader_org 依 uploaded_by 的 profile
--   回填(profiles.org_type 自 20260728000200 起不可自改),推不出的維持 null=未知。
-- 相容:舊前端對 photos 的 insert／update 只用既有欄位,欄位級 grant 涵蓋全部既有欄;
--   daily_logs／checklist_records／inspections 不改。
-- 回復:supabase/rollbacks/20260917201000_field_documents.down.sql(drop 四表＋photo_intakes、photos 加欄、
--   函式與 trigger,還原 photos 表級 grant;已產生的簽署／提送資料隨表移除,回復前先匯出)。

-- ── 0. 純函式 helper(單一定義;trigger、generated column、之後的 RPC／列印共用)────────────
-- 內容雜湊:jsonb::text 的鍵序由 jsonb 正規化保證穩定;content 與 attachments 以換行分隔,
-- attachments 為 null 時以字面 'null' 參與。前端只顯示 DB 存的值,不重算(避免雙引擎)。
-- STABLE 而非 IMMUTABLE:convert_to 在 pg_proc 標為 stable(依伺服器編碼);不用於索引,只在 trigger 內呼叫。
create or replace function public.fn_field_document_content_hash(p_content jsonb, p_attachments jsonb)
returns text language sql stable security invoker set search_path = pg_catalog, public as $fn$
  select encode(sha256(convert_to(
    p_content::text || E'\n' || coalesce(p_attachments::text, 'null'), 'UTF8')), 'hex');
$fn$;
revoke all on function public.fn_field_document_content_hash(jsonb, jsonb) from public, anon, authenticated;
comment on function public.fn_field_document_content_hash(jsonb, jsonb) is
  'P2a:文件版本內容雜湊 sha256(content::text || \n || coalesce(attachments::text,''null''));只在 DB 計算。';

-- 責任方／事實表由 doc_type 決定。這兩支是 field_documents 的 generated column 表達式,
-- generated column 以寫入者的權限求值,因此 authenticated 必須可執行(純映射、無資料);anon 不給。
create or replace function public.fn_field_document_owner_org(p_doc_type text)
returns text language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select case p_doc_type
    when 'daily_log'       then 'contractor'
    when 'self_check'      then 'contractor'
    when 'supervisor_log'  then 'supervisor'
    when 'inspection_form' then 'supervisor'
  end;
$fn$;
revoke all on function public.fn_field_document_owner_org(text) from public, anon;
grant execute on function public.fn_field_document_owner_org(text) to authenticated;

create or replace function public.fn_field_document_target_table(p_doc_type text)
returns text language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select case p_doc_type
    when 'daily_log'       then 'daily_logs'
    when 'self_check'      then 'checklist_records'
    when 'supervisor_log'  then 'supervisor_logs'
    when 'inspection_form' then 'inspections'
  end;
$fn$;
revoke all on function public.fn_field_document_target_table(text) from public, anon;
grant execute on function public.fn_field_document_target_table(text) to authenticated;

-- 提送對象矩陣(設計 §4):施工日誌／自檢 廠商→監造;監造日誌 監造→機關;監造查驗表單 監造→廠商＋機關
create or replace function public.fn_field_document_to_org_allowed(p_doc_type text, p_to_org text)
returns boolean language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select case p_doc_type
    when 'daily_log'       then p_to_org = 'supervisor'
    when 'self_check'      then p_to_org = 'supervisor'
    when 'supervisor_log'  then p_to_org = 'owner'
    when 'inspection_form' then p_to_org in ('contractor', 'owner')
    else false
  end;
$fn$;
revoke all on function public.fn_field_document_to_org_allowed(text, text) from public, anon, authenticated;

-- 再送差異:兩版 content 的頂層鍵中值不同(含新增／移除)的鍵,排序後回傳
create or replace function public.fn_field_document_changed_keys(p_old jsonb, p_new jsonb)
returns jsonb language sql immutable security invoker set search_path = pg_catalog, public as $fn$
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
  from (
    select jsonb_object_keys(coalesce(p_old, '{}'::jsonb)) as k
    union
    select jsonb_object_keys(coalesce(p_new, '{}'::jsonb))
  ) keys
  where (p_old -> k) is distinct from (p_new -> k);
$fn$;
revoke all on function public.fn_field_document_changed_keys(jsonb, jsonb) from public, anon, authenticated;

-- JWT aal 與 User-Agent:與 current_request_ip(20260811000100)同一取法,非 HTTP 路徑留空、不編造
create or replace function public.current_jwt_aal()
returns text language plpgsql stable security definer set search_path = public as $$
declare claims jsonb;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return null;
  end;
  return nullif(btrim(coalesce(claims ->> 'aal', '')), '');
end; $$;
revoke all on function public.current_jwt_aal() from public, anon, authenticated;

create or replace function public.current_request_user_agent()
returns text language plpgsql stable security definer set search_path = public as $$
declare headers jsonb;
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  return left(nullif(btrim(coalesce(headers ->> 'user-agent', '')), ''), 512);
end; $$;
revoke all on function public.current_request_user_agent() from public, anon, authenticated;

-- ── 1. photo_intakes:一次上傳=一批 ───────────────────────────────────────────────
create table if not exists public.photo_intakes (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  created_by       uuid references auth.users(id),
  uploader_org     text not null check (uploader_org in ('contractor','supervisor','owner')),
  log_date         date,                                  -- 業務日期(台北日曆日);辨識不到=null=待補
  status           text not null default 'received'
                   check (status in ('received','recognizing','drafting','ready','partial','failed','discarded')),
  photo_count      int  not null default 0 check (photo_count >= 0),
  recognized_count int  not null default 0 check (recognized_count >= 0),
  failed_count     int  not null default 0 check (failed_count >= 0),
  shared_inputs    jsonb not null default '{}'::jsonb check (jsonb_typeof(shared_inputs) = 'object'),
  candidates       jsonb not null default '[]'::jsonb check (jsonb_typeof(candidates) = 'array'),
  run_started_at   timestamptz,
  last_progress_at timestamptz,
  attempts         int  not null default 0 check (attempts >= 0),
  error_summary    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.photo_intakes is
  'P2a:一次上傳=一批。uploader_org／created_by／status／進度欄由伺服器決定;使用者只能改 log_date、捨棄、切換候選 excluded。';
comment on column public.photo_intakes.candidates is
  '系統判斷的候選文書 [{doc_type, target_key, reason, excluded}];使用者只能切換 excluded。';
comment on column public.photo_intakes.shared_inputs is
  '跨文件共用補值(鍵=正規化欄位鍵);由 set_intake_shared_input RPC(P3e)寫入。';
create index if not exists photo_intakes_project_created_idx
  on public.photo_intakes(project_id, created_at desc);
create index if not exists photo_intakes_project_status_idx
  on public.photo_intakes(project_id, status);
create index if not exists photo_intakes_creator_open_idx
  on public.photo_intakes(created_by, created_at desc) where status <> 'discarded';

-- ── 2. photos 加欄與回填 ───────────────────────────────────────────────────────
alter table public.photos
  add column if not exists intake_id      uuid references public.photo_intakes(id) on delete set null,
  add column if not exists uploader_org   text check (uploader_org in ('contractor','supervisor','owner')),
  add column if not exists ai_status      text check (ai_status in ('pending','done','failed','not_site','unreadable','duplicate')),
  add column if not exists ai_result      jsonb,
  add column if not exists ai_run_at      timestamptz,
  add column if not exists work_item_hint text,
  add column if not exists content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$');
comment on column public.photos.uploader_org is
  '上傳方(伺服器事實):使用者插入一律蓋成 my_org_type();null=舊資料推不出(未知),不猜。角色隔離依據。';
comment on column public.photos.ai_status is
  '批次辨識狀態(只由 Edge service 寫):pending／done／failed／not_site／unreadable／duplicate;掛進批次的照片預設 pending;null=未經批次辨識。';
comment on column public.photos.ai_result is
  'classify-site-photo／read-whiteboard 的原始結構化輸出(只由 Edge service 寫);內容視為資料不是指令。';
comment on column public.photos.work_item_hint is
  '未配對時保存的 AI 工項關鍵詞(只由 Edge service 寫),匯標單後可再配。';
comment on column public.photos.content_sha256 is
  '客戶端計算的檔案內容 sha256(重複照片偵測用;同批次同雜湊標 duplicate、仍保存);登錄後使用者路徑不可改。';
comment on column public.photos.intake_id is
  '所屬上傳批次;登錄後使用者路徑不可改掛;必須與批次同專案、同上傳方。';

-- 回填:只依 uploaded_by 的 profile 推得(org_type 自 20260728000200 起使用者不可自改);推不出維持 null。
-- 此時 photos_org_stamp 尚未掛上、photos_update_guard 以 auth.uid() is null 放行,純資料修補。
update public.photos p
   set uploader_org = pr.org_type
  from public.profiles pr
 where pr.id = p.uploaded_by
   and p.uploader_org is null;

create index if not exists photos_intake_idx
  on public.photos(intake_id, created_at) where intake_id is not null;
create index if not exists photos_intake_sha_idx
  on public.photos(intake_id, content_sha256) where intake_id is not null and content_sha256 is not null;
create index if not exists photos_intake_ai_status_idx
  on public.photos(intake_id, ai_status) where intake_id is not null;

-- ── 3. field_documents 家族 ───────────────────────────────────────────────────
create table if not exists public.field_documents (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  doc_type           text not null check (doc_type in ('daily_log','supervisor_log','self_check','inspection_form')),
  owner_org          text not null generated always as (public.fn_field_document_owner_org(doc_type)) stored,
  target_table       text not null generated always as (public.fn_field_document_target_table(doc_type)) stored,
  target_id          uuid,                                 -- 事實列;草稿期可為 null,簽署時由 RPC 建立或綁定
  target_key         text,                                 -- 起稿冪等鍵(工項＋位置／查驗 id);日誌類為 null
  intake_id          uuid references public.photo_intakes(id) on delete set null,
  doc_date           date not null,
  status             text not null default 'draft'
                     check (status in ('draft','pending_input','in_review','signed','submitted','received','returned','discarded','superseded')),
  current_version_no int  not null default 0 check (current_version_no >= 0),
  template_id        uuid references public.checklist_templates(id) on delete set null,
  template_version   int,
  required_fields    jsonb not null default '[]'::jsonb check (jsonb_typeof(required_fields) = 'array'),
  recheck            jsonb not null default '[]'::jsonb check (jsonb_typeof(recheck) = 'array'),
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.field_documents is
  'P2a:四類現場文書的文件本體。owner_org／target_table 由 doc_type 產生;使用者只能建立草稿,狀態與版本指標經 RPC。';
-- 日誌類每案每日一份活文件(owner_org 由 doc_type 決定,不需入鍵)
create unique index if not exists field_documents_daily_uidx
  on public.field_documents(project_id, doc_type, doc_date)
  where doc_type in ('daily_log','supervisor_log') and status not in ('discarded','superseded');
-- 一個事實列最多一份文件
create unique index if not exists field_documents_target_uidx
  on public.field_documents(doc_type, target_id) where target_id is not null;
-- 起稿冪等:同批次同類同目標只有一份活文件(target_key 為 null 的日誌類亦視為同一目標)
create unique index if not exists field_documents_intake_target_uidx
  on public.field_documents(intake_id, doc_type, target_key) nulls not distinct
  where intake_id is not null and status not in ('discarded','superseded');
create index if not exists field_documents_project_type_date_idx
  on public.field_documents(project_id, doc_type, doc_date desc);
create index if not exists field_documents_project_status_idx
  on public.field_documents(project_id, status, updated_at desc);
create index if not exists field_documents_creator_open_idx
  on public.field_documents(created_by, updated_at desc)
  where status in ('draft','pending_input','returned');

create table if not exists public.field_document_versions (
  id                   uuid primary key default gen_random_uuid(),
  document_id          uuid not null references public.field_documents(id) on delete cascade,
  version_no           int  not null check (version_no >= 1),
  author_kind          text not null check (author_kind in ('ai','human')),
  created_by           uuid references auth.users(id),       -- ai 版本為 null
  content              jsonb not null check (jsonb_typeof(content) = 'object'),
  field_sources        jsonb not null default '{}'::jsonb check (jsonb_typeof(field_sources) = 'object'),
  attachments          jsonb check (attachments is null or jsonb_typeof(attachments) = 'array'),
  content_hash         text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  change_note          text,
  amended_from_version int  check (amended_from_version is null or amended_from_version >= 1),
  created_at           timestamptz not null default now(),
  unique (document_id, version_no)
);
comment on table public.field_document_versions is
  'P2a:文件版本(不可變)。content_hash 只由 DB 計算;human 版本只能由登入者建立、ai 版本只能由 service 建立。';

create table if not exists public.field_document_signatures (
  id                   uuid primary key default gen_random_uuid(),
  document_id          uuid not null references public.field_documents(id) on delete cascade,
  version_no           int  not null,
  content_hash         text not null,                       -- 簽署者所見版本的雜湊;必須等於該版本雜湊
  signer_id            uuid not null references auth.users(id),
  signer_org           text not null check (signer_org in ('contractor','supervisor','owner')),
  signer_name_snapshot text,
  signed_at            timestamptz not null default now(),  -- 伺服器時間,客戶端值作廢
  intent               text not null check (btrim(intent) <> ''),  -- 簽署意願聲明原文
  method               text not null check (method in ('platform_account','platform_account_mfa','paper_scan')),
  aal                  text,                                -- JWT aal,伺服器取
  request_ip           inet,
  user_agent           text,
  evidence             jsonb check (evidence is null or jsonb_typeof(evidence) = 'object'),
  created_at           timestamptz not null default now(),
  unique (document_id, version_no, signer_id),
  foreign key (document_id, version_no)
    references public.field_document_versions(document_id, version_no) on delete cascade
);
comment on table public.field_document_signatures is
  'P2a:簽署紀錄(append-only)。只能在有登入者的情境寫入;簽署者、時間、aal、IP、UA 由伺服器取;雜湊須等於所簽版本。';
create index if not exists field_document_signatures_signer_idx
  on public.field_document_signatures(signer_id, signed_at desc);

create table if not exists public.field_document_submissions (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid not null references public.field_documents(id) on delete cascade,
  version_no        int  not null,
  content_hash      text not null,
  action            text not null check (action in ('submit','receive','return')),
  actor_id          uuid not null references auth.users(id),
  actor_org         text not null check (actor_org in ('contractor','supervisor','owner')),
  to_org            text not null check (to_org in ('contractor','supervisor','owner')),
  reason            text,
  diff              jsonb check (diff is null or jsonb_typeof(diff) = 'object'),
  client_request_id text,
  created_at        timestamptz not null default now(),   -- 伺服器時間=送件／收件／退回回執
  foreign key (document_id, version_no)
    references public.field_document_versions(document_id, version_no) on delete cascade,
  check (action <> 'return' or (reason is not null and btrim(reason) <> ''))
);
comment on table public.field_document_submissions is
  'P2a:提送／收件／退回歷史(append-only)。submit 需已簽署;receive／return 由提送對象執行;diff 由 DB 比對前次退回版本。';
create unique index if not exists field_document_submissions_request_uidx
  on public.field_document_submissions(document_id, client_request_id) where client_request_id is not null;
create index if not exists field_document_submissions_document_idx
  on public.field_document_submissions(document_id, created_at desc);

-- ── 4. RLS ─────────────────────────────────────────────────────────────────────
alter table public.photo_intakes            enable row level security;
alter table public.field_documents          enable row level security;
alter table public.field_document_versions  enable row level security;
alter table public.field_document_signatures enable row level security;
alter table public.field_document_submissions enable row level security;

-- 子表讀權以文件反查(security definer,避免巢狀 RLS 重複評估)
create or replace function public.can_read_field_document(p_document uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.field_documents d
    where d.id = p_document and d.project_id in (select public.my_project_ids())
  );
$$;
revoke all on function public.can_read_field_document(uuid) from public, anon;
grant execute on function public.can_read_field_document(uuid) to authenticated;

drop policy if exists "photo_intakes_select" on public.photo_intakes;
create policy "photo_intakes_select" on public.photo_intakes for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "photo_intakes_insert" on public.photo_intakes;
create policy "photo_intakes_insert" on public.photo_intakes for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "photo_intakes_update" on public.photo_intakes;
create policy "photo_intakes_update" on public.photo_intakes for update to authenticated
  using (public.can_write(project_id)
    and (uploader_org = public.my_org_type() or public.admin_override(project_id)))
  with check (public.can_write(project_id)
    and (uploader_org = public.my_org_type() or public.admin_override(project_id)));
drop policy if exists "photo_intakes_delete" on public.photo_intakes;
create policy "photo_intakes_delete" on public.photo_intakes for delete to authenticated
  using (public.can_write(project_id)
    and (uploader_org = public.my_org_type() or public.admin_override(project_id)));

drop policy if exists "field_documents_select" on public.field_documents;
create policy "field_documents_select" on public.field_documents for select to authenticated
  using (project_id in (select public.my_project_ids()));
-- owner_org 是 generated column,BEFORE trigger 之後、WITH CHECK 之前算好,可直接比對
drop policy if exists "field_documents_insert" on public.field_documents;
create policy "field_documents_insert" on public.field_documents for insert to authenticated
  with check (public.can_write(project_id)
    and (owner_org = public.my_org_type() or public.admin_override(project_id)));
-- 刻意不建 UPDATE／DELETE policy(亦無 grant):狀態與版本指標只經 RPC／service

drop policy if exists "field_document_versions_select" on public.field_document_versions;
create policy "field_document_versions_select" on public.field_document_versions for select to authenticated
  using (public.can_read_field_document(document_id));
drop policy if exists "field_document_signatures_select" on public.field_document_signatures;
create policy "field_document_signatures_select" on public.field_document_signatures for select to authenticated
  using (public.can_read_field_document(document_id));
drop policy if exists "field_document_submissions_select" on public.field_document_submissions;
create policy "field_document_submissions_select" on public.field_document_submissions for select to authenticated
  using (public.can_read_field_document(document_id));

-- ── 5. grants(20260712001200 的 default privileges 會讓新表自動帶寫入授權,這裡明確收回並改欄位級)──
revoke all on public.photo_intakes from public, anon, authenticated;
grant select on public.photo_intakes to authenticated;
grant insert (id, project_id, log_date) on public.photo_intakes to authenticated;
grant update (log_date, status, candidates) on public.photo_intakes to authenticated;
grant delete on public.photo_intakes to authenticated;

revoke all on public.field_documents from public, anon, authenticated;
grant select on public.field_documents to authenticated;
grant insert (id, project_id, doc_type, doc_date, intake_id, template_id) on public.field_documents to authenticated;

revoke all on public.field_document_versions from public, anon, authenticated;
grant select on public.field_document_versions to authenticated;
revoke all on public.field_document_signatures from public, anon, authenticated;
grant select on public.field_document_signatures to authenticated;
revoke all on public.field_document_submissions from public, anon, authenticated;
grant select on public.field_document_submissions to authenticated;

-- photos:表級 insert／update 改為欄位級——既有欄位全部保留(舊前端不受影響),
-- 新的伺服器欄(uploader_org、ai_*、work_item_hint)不開給 authenticated。select／delete 不變。
revoke insert, update on public.photos from public, anon, authenticated;
grant insert (id, project_id, daily_log_id, work_item_id, storage_path, caption, taken_at,
              gps_lat, gps_lng, ai_source, uploaded_by, created_at, location, intake_id, content_sha256)
  on public.photos to authenticated;
grant update (id, project_id, daily_log_id, work_item_id, storage_path, caption, taken_at,
              gps_lat, gps_lng, ai_source, uploaded_by, created_at, location, intake_id, content_sha256)
  on public.photos to authenticated;

-- ── 6. guard triggers ─────────────────────────────────────────────────────────
-- 6.1 photos:上傳方由伺服器決定;批次一致性;登錄後不可改掛
create or replace function public.photos_org_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_intake record;
begin
  -- 專案刪除 cascade(批次列先消失 → FK set null 的參照動作):放行
  if tg_op = 'UPDATE'
     and not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if uid is not null then
      -- 登錄者即上傳者,不可冒名;上傳方=登錄者的組織別(profiles.org_type,使用者不可自改)
      new.uploaded_by  := uid;
      new.uploader_org := public.my_org_type();
    elsif new.uploader_org is null and new.uploaded_by is not null then
      -- service／遷移:只依 uploaded_by 的 profile 推,推不出維持 null(未知),不猜
      select p.org_type into new.uploader_org from public.profiles p where p.id = new.uploaded_by;
    end if;
    if new.intake_id is not null and new.ai_status is null then
      new.ai_status := 'pending';  -- 批次照片一律從待辨識開始
    end if;
  else
    if uid is not null then
      if new.uploader_org is distinct from old.uploader_org then
        raise exception '照片上傳方由伺服器決定,不可變更';
      end if;
      if new.uploaded_by is distinct from old.uploaded_by then
        raise exception '照片上傳者不可變更';
      end if;
      if old.intake_id is not null and new.intake_id is distinct from old.intake_id then
        raise exception '照片已屬於上傳批次,不可改掛或移除批次';
      end if;
      if old.content_sha256 is not null and new.content_sha256 is distinct from old.content_sha256 then
        raise exception '照片內容雜湊登錄後不可變更';
      end if;
    end if;
    if new.intake_id is not null and old.intake_id is null and new.ai_status is null then
      new.ai_status := 'pending';
    end if;
  end if;

  -- 批次一致性(所有寫入者):同專案、同上傳方;上傳方未知的舊照片不能掛進批次
  if new.intake_id is not null
     and (tg_op = 'INSERT' or new.intake_id is distinct from old.intake_id) then
    select i.project_id, i.uploader_org into v_intake
      from public.photo_intakes i where i.id = new.intake_id;
    if not found then
      raise exception '上傳批次不存在';
    end if;
    if v_intake.project_id <> new.project_id then
      raise exception '照片與上傳批次必須同一專案';
    end if;
    if new.uploader_org is null or new.uploader_org <> v_intake.uploader_org then
      raise exception '照片上傳方(%)與批次上傳方(%)不一致,不可掛進此批次',
        coalesce(new.uploader_org, '未知'), v_intake.uploader_org;
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.photos_org_stamp() from public, anon, authenticated;
drop trigger if exists photos_org_stamp on public.photos;
create trigger photos_org_stamp before insert or update on public.photos
  for each row execute function public.photos_org_stamp();

-- 6.2 photo_intakes
create or replace function public.photo_intakes_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op in ('UPDATE','DELETE')
     and not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);  -- 專案刪除 cascade
  end if;

  if tg_op = 'INSERT' then
    if uid is not null then
      -- 使用者建立:身分與處理狀態全由伺服器決定(欄位級 grant 之外的第二道)
      new.created_by       := uid;
      new.uploader_org     := public.my_org_type();
      new.status           := 'received';
      new.photo_count      := 0;
      new.recognized_count := 0;
      new.failed_count     := 0;
      new.attempts         := 0;
      new.run_started_at   := null;
      new.last_progress_at := null;
      new.error_summary    := null;
      new.shared_inputs    := '{}'::jsonb;
      new.candidates       := '[]'::jsonb;
      new.created_at       := now();
    elsif new.uploader_org is null then
      select p.org_type into new.uploader_org from public.profiles p where p.id = new.created_by;
      if new.uploader_org is null then
        raise exception '上傳批次必須有上傳方(uploader_org),無法由 created_by 推得';
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'DELETE' then
    if exists (select 1 from public.photos p where p.intake_id = old.id) then
      raise exception '上傳批次已有照片,不可刪除(照片為證據;可改為捨棄 discarded)';
    end if;
    if exists (select 1 from public.field_documents d where d.intake_id = old.id) then
      raise exception '上傳批次已起稿文件,不可刪除';
    end if;
    if uid is not null and old.status <> 'received' then
      raise exception '只有尚未處理(received)且沒有照片的上傳批次可刪除';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.id <> old.id or new.project_id <> old.project_id
     or new.created_by is distinct from old.created_by
     or new.uploader_org <> old.uploader_org
     or new.created_at <> old.created_at then
    raise exception '上傳批次的專案／建立者／上傳方／建立時間不可變更';
  end if;
  new.updated_at := now();
  if uid is not null then
    if old.status = 'discarded' then
      raise exception '已捨棄的上傳批次不可再變更';
    end if;
    if new.status is distinct from old.status and new.status <> 'discarded' then
      raise exception '上傳批次的處理狀態由伺服器更新;使用者只能捨棄(discarded)';
    end if;
    if new.candidates is distinct from old.candidates then
      -- 只允許切換 excluded:去掉 excluded 之後兩版必須逐項相同(含順序)
      select coalesce(jsonb_agg(c - 'excluded' order by ord), '[]'::jsonb) into v_old
        from jsonb_array_elements(old.candidates) with ordinality as t(c, ord);
      select coalesce(jsonb_agg(c - 'excluded' order by ord), '[]'::jsonb) into v_new
        from jsonb_array_elements(new.candidates) with ordinality as t(c, ord);
      if v_new is distinct from v_old then
        raise exception '候選文書清單由伺服器產生;使用者只能排除／取消排除(excluded)';
      end if;
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.photo_intakes_guard() from public, anon, authenticated;
drop trigger if exists photo_intakes_guard on public.photo_intakes;
create trigger photo_intakes_guard before insert or update or delete on public.photo_intakes
  for each row execute function public.photo_intakes_guard();

-- 6.3 field_documents:建立／不可變欄／版本指標／狀態轉移矩陣／結構要件／角色
create or replace function public.field_documents_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  v_intake record;
  v_max    int;
  v_org    text;
  v_exists boolean;
  v_owner  text;
begin
  if tg_op in ('UPDATE','DELETE')
     and not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);  -- 專案刪除 cascade
  end if;

  if tg_op = 'DELETE' then
    if old.status not in ('draft','pending_input','in_review') then
      raise exception '文件已簽署／提送(狀態:%),不可刪除;更正走新版本,作廢走 discarded／superseded', old.status;
    end if;
    if exists (select 1 from public.field_document_signatures s where s.document_id = old.id) then
      raise exception '文件已有簽署紀錄,不可刪除';
    end if;
    return old;
  end if;

  v_owner := public.fn_field_document_owner_org(new.doc_type);

  if tg_op = 'INSERT' then
    if uid is not null then
      new.created_by := uid;   -- 登錄者即建立者,不可冒名
      new.created_at := now();
    end if;
    if new.status not in ('draft','pending_input') then
      raise exception '文件建立時只能是草稿(draft)或待補件(pending_input)';
    end if;
    if new.current_version_no <> 0 then
      raise exception '文件建立時尚無版本,current_version_no 必須為 0';
    end if;
    new.updated_at := now();
  else
    if new.id <> old.id or new.project_id <> old.project_id or new.doc_type <> old.doc_type
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception '文件的專案／類型／建立者／建立時間不可變更';
    end if;
    -- 起稿批次不可變更;唯一例外=批次列已消失的 FK set null 參照動作
    if old.intake_id is not null and new.intake_id is distinct from old.intake_id
       and not (new.intake_id is null
                and not exists (select 1 from public.photo_intakes i where i.id = old.intake_id)) then
      raise exception '文件的起稿批次不可變更';
    end if;
    if new.doc_date <> old.doc_date
       and exists (select 1 from public.field_document_signatures s where s.document_id = old.id) then
      raise exception '已有簽署紀錄的文件不可變更業務日期';
    end if;
    new.updated_at := now();

    -- 版本指標只能前進,且必須指向已存在的最新版本
    if new.current_version_no <> old.current_version_no then
      if new.current_version_no < old.current_version_no then
        raise exception '目前版本號不可回退';
      end if;
      select coalesce(max(v.version_no), 0) into v_max
        from public.field_document_versions v where v.document_id = old.id;
      if new.current_version_no <> v_max then
        raise exception '目前版本號(%)必須等於已存在的最新版本(%)', new.current_version_no, v_max;
      end if;
    end if;

    if new.status is distinct from old.status then
      if old.status in ('discarded','superseded') then
        raise exception '文件已 %,不可再變更狀態', old.status;
      end if;
      if new.status in ('draft','pending_input') then
        if old.status in ('signed','submitted','returned') then
          if new.current_version_no <= old.current_version_no then
            raise exception '已簽署的文件要更正必須先建立新版本(版本號需大於 %)', old.current_version_no;
          end if;
        elsif old.status = 'received' then
          raise exception '對方已收件的文件不可再修訂;請另立新文件並將本件標為 superseded';
        end if;
      elsif new.status = 'in_review' then
        if old.status not in ('draft','pending_input') then
          raise exception '只有草稿／待補件可送內部核對(目前:%)', old.status;
        end if;
      elsif new.status = 'signed' then
        if old.status not in ('draft','pending_input','in_review') then
          raise exception '只有未簽署的文件可簽署(目前:%)', old.status;
        end if;
        if new.current_version_no < 1 then
          raise exception '尚無版本,不可簽署';
        end if;
        if not exists (select 1 from public.field_document_signatures s
                        where s.document_id = old.id and s.version_no = new.current_version_no) then
          raise exception '簽署狀態必須對應目前版本的簽署紀錄(請經簽署 RPC)';
        end if;
      elsif new.status = 'submitted' then
        if old.status <> 'signed' then
          raise exception '只有已簽署的文件可提送(目前:%)', old.status;
        end if;
        if not exists (select 1 from public.field_document_submissions s
                        where s.document_id = old.id and s.version_no = new.current_version_no
                          and s.action = 'submit') then
          raise exception '提送狀態必須對應目前版本的提送紀錄(請經提送 RPC)';
        end if;
      elsif new.status = 'received' then
        if old.status <> 'submitted' then
          raise exception '只有已提送的文件可收件(目前:%)', old.status;
        end if;
        if not exists (select 1 from public.field_document_submissions s
                        where s.document_id = old.id and s.version_no = new.current_version_no
                          and s.action = 'receive') then
          raise exception '收件狀態必須對應目前版本的收件紀錄(請經收件 RPC)';
        end if;
      elsif new.status = 'returned' then
        if old.status not in ('submitted','received') then
          raise exception '只有已提送／已收件的文件可退回(目前:%)', old.status;
        end if;
        if not exists (select 1 from public.field_document_submissions s
                        where s.document_id = old.id and s.version_no = new.current_version_no
                          and s.action = 'return') then
          raise exception '退回狀態必須對應目前版本的退回紀錄(請經退回 RPC)';
        end if;
      elsif new.status = 'discarded' then
        if old.status not in ('draft','pending_input','in_review')
           or exists (select 1 from public.field_document_signatures s where s.document_id = old.id) then
          raise exception '只有未簽署的文件可捨棄';
        end if;
      elsif new.status = 'superseded' then
        if old.status not in ('signed','submitted','received','returned') then
          raise exception '只有已簽署的文件可被新文件取代(未簽署請捨棄)';
        end if;
      end if;

      -- 人為轉移的角色:責任方才能簽／送／捨棄／修訂;收件／退回由提送對象(見提送紀錄)執行
      if uid is not null and not public.admin_override(old.project_id) then
        v_org := public.my_org_type();
        if new.status in ('received','returned') then
          if not exists (select 1 from public.field_document_submissions s
                          where s.document_id = old.id and s.version_no = old.current_version_no
                            and s.action = case new.status when 'received' then 'receive' else 'return' end
                            and s.actor_org = v_org) then
            raise exception '收件／退回必須由該版本的提送對象執行';
          end if;
        elsif v_org <> old.owner_org then
          raise exception '此文件屬%方,非責任方不可變更狀態',
            case old.owner_org when 'contractor' then '施工廠商' else '監造' end;
        end if;
      end if;
    end if;
  end if;

  -- 起稿批次:同專案,且批次上傳方=文件責任方(廠商照片不能起稿監造文件,反之亦然)
  if new.intake_id is not null
     and (tg_op = 'INSERT' or new.intake_id is distinct from old.intake_id) then
    select i.project_id, i.uploader_org into v_intake
      from public.photo_intakes i where i.id = new.intake_id;
    if not found then
      raise exception '起稿批次不存在';
    end if;
    if v_intake.project_id <> new.project_id then
      raise exception '起稿批次必須與文件同一專案';
    end if;
    if v_intake.uploader_org <> v_owner then
      raise exception '%方上傳的照片批次不能起稿%方文件',
        case v_intake.uploader_org when 'contractor' then '施工廠商' when 'supervisor' then '監造' else '機關' end,
        case v_owner when 'contractor' then '施工廠商' else '監造' end;
    end if;
  end if;
  -- 範本同專案
  if new.template_id is not null
     and (tg_op = 'INSERT' or new.template_id is distinct from old.template_id) then
    if not exists (select 1 from public.checklist_templates t
                    where t.id = new.template_id and t.project_id = new.project_id) then
      raise exception '範本必須屬於同一專案';
    end if;
  end if;
  -- 事實列:表必須存在(監造日誌表 P3a 才建;之前指向它一律拒絕),列必須存在且同專案
  if new.target_id is not null
     and (tg_op = 'INSERT' or new.target_id is distinct from old.target_id) then
    if to_regclass('public.' || public.fn_field_document_target_table(new.doc_type)) is null then
      raise exception '事實表 % 尚未建立,不可綁定', public.fn_field_document_target_table(new.doc_type);
    end if;
    execute format('select exists (select 1 from public.%I t where t.id = $1 and t.project_id = $2)',
                   public.fn_field_document_target_table(new.doc_type))
      into v_exists using new.target_id, new.project_id;
    if not v_exists then
      raise exception '事實列不存在或不屬於同一專案';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.field_documents_guard() from public, anon, authenticated;
drop trigger if exists field_documents_guard on public.field_documents;
create trigger field_documents_guard before insert or update or delete on public.field_documents
  for each row execute function public.field_documents_guard();

-- 6.4 field_document_versions:不可變;雜湊由 DB;版本號連續;作者種類與情境一致;附件同專案
create or replace function public.field_document_versions_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid     uuid := auth.uid();
  v_doc   public.field_documents%rowtype;
  v_next  int;
  v_att   jsonb;
  v_pid   uuid;
  v_photo record;
begin
  if tg_op in ('UPDATE','DELETE') then
    if not exists (select 1 from public.field_documents d where d.id = old.document_id) then
      return coalesce(new, old);  -- 文件／專案刪除 cascade
    end if;
    raise exception '文件版本不可變(UPDATE／DELETE 一律拒絕);更正請建立新版本';
  end if;

  select * into v_doc from public.field_documents d where d.id = new.document_id for update;
  if not found then
    raise exception '文件不存在';
  end if;
  if v_doc.status in ('received','discarded','superseded') then
    raise exception '文件狀態為 %,不可再新增版本', v_doc.status;
  end if;

  select coalesce(max(v.version_no), 0) + 1 into v_next
    from public.field_document_versions v where v.document_id = new.document_id;
  if new.version_no is null then
    new.version_no := v_next;
  elsif new.version_no <> v_next then
    raise exception '版本號必須為下一版(%)', v_next;
  end if;

  if new.author_kind = 'human' then
    if uid is null then
      raise exception '人工版本必須由登入使用者建立(伺服器不得代寫人工版本)';
    end if;
    new.created_by := uid;
  else
    if uid is not null then
      raise exception 'AI 版本只能由伺服器處理程序建立';
    end if;
    new.created_by := null;
    if exists (select 1 from public.field_document_versions v
                where v.document_id = new.document_id and v.author_kind = 'human') then
      raise exception '文件已有人工版本,AI 不得再寫入版本(改以 suggest_field_update 建議)';
    end if;
  end if;

  if new.amended_from_version is not null then
    if new.amended_from_version >= new.version_no
       or not exists (select 1 from public.field_document_versions v
                       where v.document_id = new.document_id and v.version_no = new.amended_from_version) then
      raise exception '更正來源版本不存在或不早於本版';
    end if;
  end if;

  if new.attachments is not null then
    for v_att in select value from jsonb_array_elements(new.attachments) loop
      if jsonb_typeof(v_att) <> 'object' or (v_att ->> 'photo_id') is null then
        raise exception '附件格式錯誤:每筆需為物件並含 photo_id';
      end if;
      begin
        v_pid := (v_att ->> 'photo_id')::uuid;
      exception when others then
        raise exception '附件 photo_id 不是合法 UUID';
      end;
      select p.project_id, p.storage_path, p.content_sha256 into v_photo
        from public.photos p where p.id = v_pid;
      if not found or v_photo.project_id <> v_doc.project_id then
        raise exception '附件照片不存在或不屬於同一專案';
      end if;
      if (v_att ->> 'storage_path') is not null and v_att ->> 'storage_path' <> v_photo.storage_path then
        raise exception '附件檔案路徑與照片紀錄不符';
      end if;
      if (v_att ->> 'sha256') is not null and v_photo.content_sha256 is not null
         and v_att ->> 'sha256' <> v_photo.content_sha256 then
        raise exception '附件雜湊與照片紀錄不符';
      end if;
    end loop;
  end if;

  new.content_hash := public.fn_field_document_content_hash(new.content, new.attachments);
  new.created_at   := now();
  return new;
end; $$;
revoke all on function public.field_document_versions_guard() from public, anon, authenticated;
drop trigger if exists field_document_versions_guard on public.field_document_versions;
create trigger field_document_versions_guard
  before insert or update or delete on public.field_document_versions
  for each row execute function public.field_document_versions_guard();

-- 6.5 field_document_signatures:append-only;人為;目前版本;雜湊相符;伺服器取簽署者資料
create or replace function public.field_document_signatures_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  v_doc  public.field_documents%rowtype;
  v_hash text;
  v_org  text;
begin
  if tg_op in ('UPDATE','DELETE') then
    if not exists (select 1 from public.field_documents d where d.id = old.document_id) then
      return coalesce(new, old);
    end if;
    raise exception '簽署紀錄只可新增,不可修改或刪除';
  end if;

  if uid is null then
    raise exception '簽署必須由登入使用者執行(伺服器不得代簽)';
  end if;
  select * into v_doc from public.field_documents d where d.id = new.document_id for update;
  if not found then
    raise exception '文件不存在';
  end if;
  if not public.is_project_member(v_doc.project_id) then
    raise exception '非專案成員不可簽署';
  end if;
  if v_doc.status not in ('draft','pending_input','in_review','signed') then
    raise exception '文件狀態為 %,不可簽署', v_doc.status;
  end if;
  if new.version_no <> v_doc.current_version_no then
    raise exception '簽署的版本(%)不是目前版本(%):畫面可能是舊版,請重新載入後再簽',
      new.version_no, v_doc.current_version_no;
  end if;
  select v.content_hash into v_hash from public.field_document_versions v
    where v.document_id = new.document_id and v.version_no = new.version_no;
  if v_hash is null then
    raise exception '尚無版本,不可簽署';
  end if;
  if new.content_hash is null or new.content_hash <> v_hash then
    raise exception '簽署雜湊與版本內容不符(內容已變更或畫面為舊版)';
  end if;
  v_org := public.my_org_type();
  if v_org <> v_doc.owner_org and not public.admin_override(v_doc.project_id) then
    raise exception '此文件屬%方,只能由該方成員簽署',
      case v_doc.owner_org when 'contractor' then '施工廠商' else '監造' end;
  end if;

  new.signer_id  := uid;
  new.signer_org := v_org;
  select p.full_name into new.signer_name_snapshot from public.profiles p where p.id = uid;
  new.signed_at  := now();
  new.created_at := now();
  new.aal        := public.current_jwt_aal();
  new.request_ip := public.current_request_ip();
  new.user_agent := public.current_request_user_agent();

  if new.method = 'platform_account_mfa' and new.aal is distinct from 'aal2' then
    raise exception '簽署方式登記為平台帳號＋兩步驟驗證,但目前登入未完成兩步驟驗證(aal=%)',
      coalesce(new.aal, '無');
  end if;
  if new.method = 'paper_scan'
     and (new.evidence is null or (new.evidence ->> 'storage_path') is null or (new.evidence ->> 'sha256') is null) then
    raise exception '紙本簽回必須附掃描檔路徑與雜湊(evidence.storage_path／sha256)';
  end if;
  return new;
end; $$;
revoke all on function public.field_document_signatures_guard() from public, anon, authenticated;
drop trigger if exists field_document_signatures_guard on public.field_document_signatures;
create trigger field_document_signatures_guard
  before insert or update or delete on public.field_document_signatures
  for each row execute function public.field_document_signatures_guard();

-- 6.6 field_document_submissions:append-only;人為;目前版本;submit 需簽署;receive／return 由提送對象
create or replace function public.field_document_submissions_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid       uuid := auth.uid();
  v_doc     public.field_documents%rowtype;
  v_hash    text;
  v_org     text;
  v_to      text;
  v_ret_no  int;
  v_ret_ct  jsonb;
  v_cur_ct  jsonb;
begin
  if tg_op in ('UPDATE','DELETE') then
    if not exists (select 1 from public.field_documents d where d.id = old.document_id) then
      return coalesce(new, old);
    end if;
    raise exception '提送／收件／退回紀錄只可新增,不可修改或刪除';
  end if;

  if uid is null then
    raise exception '提送／收件／退回必須由登入使用者執行';
  end if;
  select * into v_doc from public.field_documents d where d.id = new.document_id for update;
  if not found then
    raise exception '文件不存在';
  end if;
  if not public.is_project_member(v_doc.project_id) then
    raise exception '非專案成員不可提送／收件／退回';
  end if;
  if new.version_no <> v_doc.current_version_no then
    raise exception '提送的版本(%)不是目前版本(%):畫面可能是舊版', new.version_no, v_doc.current_version_no;
  end if;
  select v.content_hash, v.content into v_hash, v_cur_ct from public.field_document_versions v
    where v.document_id = new.document_id and v.version_no = new.version_no;
  if v_hash is null then
    raise exception '尚無版本,不可提送';
  end if;
  if new.content_hash is null or new.content_hash <> v_hash then
    raise exception '提送雜湊與版本內容不符';
  end if;

  v_org := public.my_org_type();
  new.actor_id   := uid;
  new.actor_org  := v_org;
  new.created_at := now();
  new.reason     := nullif(btrim(coalesce(new.reason, '')), '');

  if new.action = 'submit' then
    if v_doc.status not in ('signed','submitted') then
      raise exception '只有已簽署的文件可提送(目前:%)', v_doc.status;
    end if;
    if not exists (select 1 from public.field_document_signatures s
                    where s.document_id = new.document_id and s.version_no = new.version_no) then
      raise exception '此版本尚未簽署,不可提送';
    end if;
    if v_org <> v_doc.owner_org and not public.admin_override(v_doc.project_id) then
      raise exception '只有責任方可提送此文件';
    end if;
    if new.to_org is null or not public.fn_field_document_to_org_allowed(v_doc.doc_type, new.to_org) then
      raise exception '文件類型 % 不可提送給 %', v_doc.doc_type, coalesce(new.to_org, '(未指定)');
    end if;
    -- 再送差異:與前次退回時的版本比對頂層鍵;首次提送無差異
    select s.version_no into v_ret_no from public.field_document_submissions s
      where s.document_id = new.document_id and s.action = 'return'
      order by s.created_at desc limit 1;
    if v_ret_no is not null then
      select v.content into v_ret_ct from public.field_document_versions v
        where v.document_id = new.document_id and v.version_no = v_ret_no;
      new.diff := jsonb_build_object(
        'against_version_no', v_ret_no,
        'changed_keys', public.fn_field_document_changed_keys(v_ret_ct, v_cur_ct));
    else
      new.diff := null;
    end if;
  else
    select s.to_org into v_to from public.field_document_submissions s
      where s.document_id = new.document_id and s.version_no = new.version_no and s.action = 'submit'
        and (s.to_org = v_org or public.admin_override(v_doc.project_id))
      order by s.created_at desc limit 1;
    if v_to is null then
      raise exception '此版本尚未提送給%方,不可收件／退回',
        case v_org when 'contractor' then '施工廠商' when 'supervisor' then '監造' else '機關' end;
    end if;
    if v_doc.status not in ('submitted','received') then
      raise exception '文件狀態為 %,不可收件／退回', v_doc.status;
    end if;
    if new.action = 'return' and new.reason is null then
      raise exception '退回必須填寫原因';
    end if;
    new.to_org := v_to;
    new.diff   := null;
  end if;
  return new;
end; $$;
revoke all on function public.field_document_submissions_guard() from public, anon, authenticated;
drop trigger if exists field_document_submissions_guard on public.field_document_submissions;
create trigger field_document_submissions_guard
  before insert or update or delete on public.field_document_submissions
  for each row execute function public.field_document_submissions_guard();

-- ── 7. 稽核事件(AFTER trigger;所有路徑一致) ────────────────────────────────────
create or replace function public.field_documents_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_event text;
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'field_document.created', 'field_document', new.id,
      'created', null, to_jsonb(new), jsonb_build_object('doc_type', new.doc_type), null);
    return new;
  end if;
  if new.status is distinct from old.status then
    -- signed／submitted／received／returned 由簽署／提送紀錄的 trigger 留痕,這裡不重複
    v_event := case
      when new.status = 'discarded' then 'field_document.discarded'
      when new.status = 'superseded' then 'field_document.superseded'
      when new.status in ('draft','pending_input') and old.status in ('signed','submitted','returned')
        then 'field_document.amended'
      when new.status in ('signed','submitted','received','returned') then null
      else 'field_document.status_changed'
    end;
    if v_event is not null then
      perform public.record_audit_event(new.project_id, v_event, 'field_document', new.id,
        new.status, to_jsonb(old), to_jsonb(new),
        jsonb_build_object('doc_type', new.doc_type, 'version_no', new.current_version_no), null);
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.field_documents_audit() from public, anon, authenticated;
drop trigger if exists field_documents_audit on public.field_documents;
create trigger field_documents_audit after insert or update on public.field_documents
  for each row execute function public.field_documents_audit();

create or replace function public.field_document_versions_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_type text;
begin
  select d.project_id, d.doc_type into v_project, v_type from public.field_documents d where d.id = new.document_id;
  perform public.record_audit_event(v_project, 'field_document.version_saved', 'field_document', new.document_id,
    'version_saved', null, to_jsonb(new) - 'content' - 'field_sources',
    jsonb_build_object('doc_type', v_type, 'version_no', new.version_no,
                       'author_kind', new.author_kind, 'content_hash', new.content_hash), null);
  return new;
end; $$;
revoke all on function public.field_document_versions_audit() from public, anon, authenticated;
drop trigger if exists field_document_versions_audit on public.field_document_versions;
create trigger field_document_versions_audit after insert on public.field_document_versions
  for each row execute function public.field_document_versions_audit();

create or replace function public.field_document_signatures_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_type text;
begin
  select d.project_id, d.doc_type into v_project, v_type from public.field_documents d where d.id = new.document_id;
  -- IP／UA 已由 record_audit_event 的 actor_ip 與留存政策處理,不在 after_data 重複保存
  perform public.record_audit_event(v_project, 'field_document.signed', 'field_document', new.document_id,
    'signed', null, to_jsonb(new) - 'request_ip' - 'user_agent',
    jsonb_build_object('doc_type', v_type, 'version_no', new.version_no, 'content_hash', new.content_hash,
                       'method', new.method, 'aal', new.aal, 'signer_org', new.signer_org), null);
  return new;
end; $$;
revoke all on function public.field_document_signatures_audit() from public, anon, authenticated;
drop trigger if exists field_document_signatures_audit on public.field_document_signatures;
create trigger field_document_signatures_audit after insert on public.field_document_signatures
  for each row execute function public.field_document_signatures_audit();

create or replace function public.field_document_submissions_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_type text;
begin
  select d.project_id, d.doc_type into v_project, v_type from public.field_documents d where d.id = new.document_id;
  perform public.record_audit_event(v_project,
    case new.action when 'submit' then 'field_document.submitted'
                    when 'receive' then 'field_document.received'
                    else 'field_document.returned' end,
    'field_document', new.document_id, new.action, null, to_jsonb(new),
    jsonb_build_object('doc_type', v_type, 'version_no', new.version_no, 'to_org', new.to_org,
                       'actor_org', new.actor_org, 'reason', new.reason,
                       'client_request_id', new.client_request_id), null);
  return new;
end; $$;
revoke all on function public.field_document_submissions_audit() from public, anon, authenticated;
drop trigger if exists field_document_submissions_audit on public.field_document_submissions;
create trigger field_document_submissions_audit after insert on public.field_document_submissions
  for each row execute function public.field_document_submissions_audit();
