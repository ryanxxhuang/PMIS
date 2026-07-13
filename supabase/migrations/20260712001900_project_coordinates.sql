-- ── 工地座標(供中央氣象局天氣自動帶入)─────────────────────────────────────
-- 廠商輸入一次工地經緯度(之後可接手機 GPS),施工日誌「帶入天氣」用座標找最近
-- 鄉鎮向 CWA 撈預報。純資料欄位,寫入權沿用 projects 既有 RLS(建立者可改)。
alter table public.projects
  add column if not exists latitude  numeric,   -- WGS84 緯度
  add column if not exists longitude numeric;   -- WGS84 經度
