-- Migration: 送審主文件附件(單一主文件)——供「送審檔案上傳 + AI 審讀」。
-- 檔案存既有 photos bucket(路徑首段=project_id,沿用其 storage RLS);此處僅存 metadata。
-- submittals 既有 RLS 不變;additive,不動既有資料。

alter table public.submittals
  add column if not exists attachment_path text,   -- photos bucket 內的物件路徑 <project_id>/submittals/...
  add column if not exists attachment_name text,   -- 原始檔名(顯示用)
  add column if not exists attachment_mime text;    -- application/pdf | image/jpeg | image/png …
