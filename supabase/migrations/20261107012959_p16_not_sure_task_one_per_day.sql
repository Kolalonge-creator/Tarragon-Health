-- P16 (CMO decision from chat, 2026-11-07): a patient's "Not sure" answer on a medication check-in, or "I'm not sure" on the
-- medicine-list confirmation, raises a routine care-team task through the EXISTING medicine-issue route: a
-- medication_dispense_flags row (flag_type 'patient_query'), which is what the /clinician/medication-issues worklist reads.
-- No new urgency, threshold, alert or page.
--
-- This migration only adds the de-duplication the CMO asked for: one such task per patient per Lagos calendar day, so repeated
-- taps cannot flood the worklist. The app writes these rows with a fixed note prefix (NOT_SURE_NOTE_PREFIX in
-- apps/web/src/lib/medications/not-sure.ts) and treats the unique violation as "already raised today". A patient's own free-text
-- concern (the "Report a problem" form, also 'patient_query') does not carry the prefix and is never limited by this.
-- The insert path is unchanged: medication_dispense_flags_insert admits only patient_id = auth.uid() (or org staff), so a
-- supporter acting for someone cannot raise one for them; the app refuses while acting.
-- Live rows matching the prefix before this migration: 0 (of 0), so the index cannot fail to build.

create unique index medication_dispense_flags_not_sure_one_per_day
  on public.medication_dispense_flags (patient_id, ((created_at at time zone 'Africa/Lagos')::date))
  where flag_type = 'patient_query' and note like 'Patient answered "Not sure"%';

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'medication_dispense_flags_not_sure_one_per_day') then
    raise exception 'medication_dispense_flags_not_sure_one_per_day was not created';
  end if;
end $$;
