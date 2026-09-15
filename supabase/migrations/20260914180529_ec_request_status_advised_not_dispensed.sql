-- Emergency contraception fast track (20260829090400): 'dispensed' was never
-- an accurate status for this table. Tarragon has no owned clinics/pharmacy
-- that could dispense emergency contraception itself (see CLAUDE.md's Care
-- Coordination model) — this pathway creates no pharmacy_orders row and
-- routes through no partner pharmacy, unlike the real medication-dispensing
-- fulfilment pipeline (20260829142844 onward). All a clinician actually does
-- here is review the request and advise a method: an over-the-counter pill
-- the patient buys themselves, or a referral to have a copper IUD fitted.
-- Renamed rather than dropped — it still marks the request as actioned with
-- a method communicated, the same meaning the "Dispensed" button was already
-- reaching for, just honestly named. Zero rows carried 'dispensed' at the
-- time of this migration (checked live: only one row exists at all, status
-- 'pending'), so this is a pure structural rename with nothing to convert.

alter type public.ec_request_status rename value 'dispensed' to 'advised';

comment on table public.emergency_contraception_requests is
  'Fast-track emergency contraception guidance request (spec §47.8). Every insert raises an urgent_escalation clinician_alerts row with a short (1-hour) SLA — see private.raise_ec_request_alert. Guidance-only: Tarragon has no pharmacy fulfilment for this pathway (no owned clinics/pharmacy — see CLAUDE.md), so status tracks whether a clinician reviewed/advised/declined the request, never an actual dispense. Never routed through emergency_events (no collapse, no family auto-notify).';

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'ec_request_status' and e.enumlabel = 'advised'
  ) then
    raise exception 'FAIL: ec_request_status.advised was not created';
  end if;
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'ec_request_status' and e.enumlabel = 'dispensed'
  ) then
    raise exception 'FAIL: ec_request_status.dispensed still exists';
  end if;
  raise notice 'PASS: ec_request_status dispensed renamed to advised';
end $$;
