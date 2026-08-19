-- W8-7 照片先行→AI 填日誌:photos 加「施作區域」欄(location)。
-- 來源=AI 辨識查驗黑板/告示板/白板上抄錄的施作區域欄位(如「A區1F」「B棟3F 柱牆」),
-- 屬 AI 草稿:上傳前由人在覆核區確認或清除才落庫;板上沒寫/讀不清=NULL(寧缺勿錯)。
-- 既有照片不回填(維持 NULL),顯示端把 NULL 視為「無區域」即可,無相容問題。
-- nullable text、無預設值:純新增欄位,不動既有列,不需回復腳本(rollback=drop column)。
alter table public.photos add column if not exists location text;

comment on column public.photos.location is '施作區域/樓層(AI 自查驗黑板/白板抄錄之草稿,人覆核後寫入;辨識不到=NULL)';
