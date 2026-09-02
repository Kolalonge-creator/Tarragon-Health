-- Episodic-fee rebuild — correction.
--
-- price_kobo/duration_weeks are always overwritten by the BEFORE INSERT
-- trigger (private.set_programme_purchase_computed_price), same as
-- lab_orders.total_kobo's own "not null default 0" convention
-- (20260705211315_care_coordination.sql) — a placeholder the trigger
-- unconditionally replaces, needed only so the generated TypeScript Insert
-- type doesn't demand these from the client (which correctly has no
-- business supplying them).

alter table public.programme_purchases
  alter column price_kobo set default 0,
  alter column duration_weeks set default 0;

do $$
begin
  -- default 0 briefly violates duration_weeks > 0 only if nothing ever
  -- overwrites it — confirm the trigger still does, so this default is
  -- never actually what gets stored.
  if pg_get_functiondef('private.set_programme_purchase_computed_price()'::regprocedure)
     !~ 'new\.duration_weeks := v_programme\.default_duration_weeks' then
    raise exception 'FAIL: price trigger no longer overwrites duration_weeks — default 0 would persist';
  end if;
end $$;
