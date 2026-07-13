-- ── R4 P1-02:金流三欄的流程順序約束 ──────────────────────────────────────────
-- (docs/PMIS-...-第四輪-2026-07-13.md P1-02)
-- 原 valuations_payment_gate(001100)只擋「未核定不得有金流」,但三欄各自可獨立
-- 寫入 → 可形成「有實收、無請款日、無收款日,狀態仍待請款」的不自洽帳。
-- 請款→收款是有序狀態機,補三條不變量(併入同一 trigger,不新增 trigger):
--   (a) 有收款日 ⇒ 必有請款日(未請款不得收款)
--   (b) 有實收金額 ⇒ 必有收款日(收了款必有收款日)
--   (c) 收款日 ≥ 請款日(不得早於請款)
-- 資料一致性,無 admin 例外;service role/SQL Editor(auth.uid() is null)照舊放行,
-- 讓既有矛盾列可由支援端清理。既有違規列不在 migration 內強改(保留現場),
-- 下次更新該列時被擋,依訊息修正。
create or replace function public.valuations_payment_gate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- ── 原:未核定不得有金流 ──
  if (new.invoice_date is not null or new.paid_date is not null or new.paid_amount is not null)
     and new.status not in ('已核定', '已請款') then
    if tg_op = 'UPDATE' and old.status in ('已核定', '已請款')
       and new.status is distinct from old.status then
      raise exception '此期已登錄請款/收款,不可直接退回核定:請先清空請款日/收款日/實收金額,再退回';
    end if;
    raise exception '估驗尚未核定,不可保有請款/收款資料:請先清空請款日/收款日/實收金額,或由監造核定後再登錄';
  end if;

  -- ── R4:請款→收款流程順序(service role 放行,讓支援端可清理既有矛盾)──
  if auth.uid() is not null then
    if new.paid_date is not null and new.invoice_date is null then
      raise exception '尚未請款,不可登錄收款日:請先填請款日';
    end if;
    if new.paid_amount is not null and new.paid_date is null then
      raise exception '登錄實收金額必須同時填收款日';
    end if;
    if new.paid_date is not null and new.invoice_date is not null
       and new.paid_date < new.invoice_date then
      raise exception '收款日不得早於請款日(請款 % / 收款 %)', new.invoice_date, new.paid_date;
    end if;
  end if;

  return new;
end; $$;
