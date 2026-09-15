-- Tarragon Health — Mental Health & Wellbeing Platform (Module 46 §46.3):
-- add EPDS (Edinburgh Postnatal Depression Scale) as a fourth mental-health
-- screening instrument, alongside the existing PHQ-9/GAD-7/AUDIT-C.
--
-- Offered in addition to, never instead of, the other three when a patient
-- self-identifies as pregnant or within 12 months postpartum (app-layer
-- gate, apps/web/src/app/(dashboard)/patient/mental-health-form.tsx) — this
-- migration only widens what the table will accept. Scoring (item 10 is the
-- self-harm question, same crisis convention as PHQ-9 item 9) lives in
-- apps/web/src/lib/rules/mental-health-screening.ts, computed server-side,
-- same as the existing three instruments.

alter table public.mental_health_screens
  drop constraint if exists mental_health_screens_instrument_check;

alter table public.mental_health_screens
  add constraint mental_health_screens_instrument_check
    check (instrument in ('phq9', 'gad7', 'auditc', 'epds'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mental_health_screens_instrument_check'
      and conrelid = 'public.mental_health_screens'::regclass
  ) then
    raise exception 'mental_health_screens_instrument_check constraint was not created';
  end if;

  raise notice 'PASS: mental_health_screens.instrument now accepts epds';
end $$;
