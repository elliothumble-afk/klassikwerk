-- ─── quotes_commissions_trigger ────────────────────────────────────
-- Fires book_native_commission when status flips → approved, and
-- void_native_commissions when a previously-approved quote flips to
-- any non-approved status. source='builder' quotes are left alone
-- (the webhook handler owns those commissions).
create or replace function quotes_commissions_trigger()
returns trigger
language plpgsql
as $$
begin
  if new.source = 'builder' then return new; end if;
  if (tg_op = 'UPDATE' and new.status = 'approved' and coalesce(old.status, 'draft') <> 'approved') then
    perform book_native_commission(new.id);
  end if;
  if (tg_op = 'UPDATE' and coalesce(old.status, 'draft') = 'approved' and new.status <> 'approved') then
    perform void_native_commissions(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quotes_commissions on quotes;
create trigger trg_quotes_commissions
  after update of status on quotes
  for each row execute function quotes_commissions_trigger();
