-- Tarragon Health — Laboratory Engine, 14.13 (turnaround time).
--
-- Spec §14.13 asks the platform to track "Sample collected → final result" so
-- lab performance is measurable. The existing scorecard
-- (lab_provider_turnaround_stats/lab_partner_turnaround_stats,
-- 20260730215234_lab_turnaround_sla_stats.sql) measures
-- resulted_at - payment_confirmed_at instead — a real, useful number (it is
-- the patient's own "how long did this take" experience, payment to
-- result), but a different one: it also counts however long the *lab* took
-- to physically collect the specimen, which is outside the lab's own
-- turnaround. This migration adds the missing timestamp so the sample-to-
-- result number becomes possible to compute; it does not touch or replace
-- the existing payment-to-result scorecard, which stays exactly as-is.
--
-- Mirrors private.stamp_lab_order_payment_confirmed byte-for-byte in shape
-- (stamped once, first time status enters the target value, never
-- overwritten again) — same pattern, new column.
--
-- Blast radius: 0 live lab_orders rows are currently sample_collected or
-- past it, so there is nothing to backfill.

alter table public.lab_orders
  add column if not exists sample_collected_at timestamptz;

comment on column public.lab_orders.sample_collected_at is
  'Stamped once, the first time status enters sample_collected. Never overwritten again (including by a later sample_rejected — a rejected sample was still collected once). Basis for a sample-to-result turnaround metric (resulted_at - sample_collected_at), additive alongside the existing payment-to-result scorecard.';

create or replace function private.stamp_lab_order_sample_collected()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'sample_collected' and new.sample_collected_at is null then
    new.sample_collected_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists lab_orders_stamp_sample_collected on public.lab_orders;
create trigger lab_orders_stamp_sample_collected
  before insert or update on public.lab_orders
  for each row execute function private.stamp_lab_order_sample_collected();

create index if not exists lab_orders_sample_collected_pending_idx
  on public.lab_orders (sample_collected_at)
  where sample_collected_at is not null and resulted_at is null and status in ('sample_collected', 'processing');
