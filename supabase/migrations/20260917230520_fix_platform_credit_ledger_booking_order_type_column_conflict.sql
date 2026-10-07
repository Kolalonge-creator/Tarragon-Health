-- Tarragon Health — Platform Credit reconciliation: booking_order_type
-- column-type collision between two concurrent sessions, found live while
-- verifying this session's own pharmacy/referral spend RPCs.
--
-- Two independent Platform Credit efforts landed a booking-order
-- correlation pair on platform_credit_ledger_entries within minutes of each
-- other:
--   * THIS session (pharmacy/referral spend):
--     20260917223811_platform_credit_ledger_entries_booking_order_columns.sql
--     added `booking_order_id uuid` + `booking_order_type public.commission_type`
--     — reusing the enum payment_transactions.booking_order_type already
--     uses for the identical polymorphic-id pattern, since commission_type
--     already covers exactly {lab, pharmacy, referral}.
--   * A CONCURRENT session (video visits), ~8 minutes later:
--     20260917230328_platform_credit_ledger_booking_order_link.sql found the
--     two columns already present via its own `add column if not exists`
--     guard (correctly a no-op) — but its own header explicitly anticipated
--     "a parallel pharmacy-orders Platform Credit effort may add the exact
--     same pair independently" and chose `text`, not `public.commission_type`,
--     specifically because that enum has no 'video_visit' member. It then
--     `create or replace`d private.platform_credit_apply with a new
--     `p_booking_order_type text` parameter written unconditionally into
--     that column on every call.
--
-- Neither side's own self-check caught the collision — both check "does the
-- column exist", never "is it the type the other side's write path
-- assumes". The result, confirmed live before this fix: every single call
-- to private.platform_credit_apply — topup, admin_grant, spend,
-- admin_correction, unrelated to booking orders entirely — started raising
--   ERROR 42804: column "booking_order_type" is of type public.commission_type
--   but expression is of type text
-- regardless of whether p_booking_order_type was actually NULL at runtime,
-- because Postgres type-checks a plpgsql INSERT against the *declared*
-- type of the referenced variable at plan time, not its runtime value. This
-- silently broke every Platform Credit write path in production the moment
-- the concurrent session's migration landed — not just the two new RPCs
-- this session added, every existing topup/spend too.
--
-- Resolution: keep `text`, not this session's original enum choice.
-- private.platform_credit_apply is already live with the text-typed
-- parameter and already has a real caller depending on that shape (the
-- video-visit spend path) — reopening that function's own migration to
-- convert it to the enum would be far more invasive than fixing the column
-- here. This session's own two RPCs
-- (pay_pharmacy_order_on_platform_credit / pay_specialist_referral_on_platform_credit,
-- 20260917224156 / 20260917224509) never went through
-- platform_credit_apply's new params in the first place — they write plain
-- 'pharmacy'/'referral' text literals into this column via their own
-- follow-up UPDATE after calling it — so they need no code change at all,
-- only the column's type was ever wrong.
--
-- Zero rows have this column populated yet (checked live immediately before
-- writing this migration: 6 total platform_credit_ledger_entries rows, 0
-- with booking_order_type set) — the safest possible moment to change a
-- column's type: no USING-cast, no backfill, no data at risk.

alter table public.platform_credit_ledger_entries
  alter column booking_order_type type text;

comment on column public.platform_credit_ledger_entries.booking_order_type is
  'Discriminator for booking_order_id. Deliberately text, not public.commission_type — this column briefly existed as commission_type (this session''s original choice) until a concurrent video-visit Platform Credit effort extended private.platform_credit_apply with a text-typed p_booking_order_type param, which commission_type cannot hold (no video_visit member); see 20260917230520''s header for the full collision. Values written today: ''pharmacy''/''referral'' (this session, via a follow-up UPDATE after private.platform_credit_apply — never through its own booking params) and ''video_visit'' (via platform_credit_apply''s p_booking_order_type param directly).';

do $$
declare
  v_col_type text;
begin
  select data_type into v_col_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'platform_credit_ledger_entries'
    and column_name = 'booking_order_type';
  if v_col_type <> 'text' then
    raise exception 'FAIL: platform_credit_ledger_entries.booking_order_type is % , expected text', v_col_type;
  end if;
  if exists (
    select 1 from public.platform_credit_ledger_entries where booking_order_type is not null
  ) then
    raise notice 'NOTE: booking_order_type now has real data — this fix landed later than assumed, but the type change itself is still safe (text can hold everything commission_type could and more)';
  end if;
  raise notice 'PASS: platform_credit_ledger_entries.booking_order_type is text — the cross-session enum/text collision is resolved. Full behavioural proof (that private.platform_credit_apply and both pharmacy/referral spend RPCs actually work end to end against this column) lives in packages/db/tests/platform_credit_ledger.sql, run separately.';
end $$;
