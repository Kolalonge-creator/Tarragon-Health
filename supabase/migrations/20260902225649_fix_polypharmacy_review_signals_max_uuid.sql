-- Tarragon Health — fix a live bug in the polypharmacy review-signal sweep
-- (20260829160203_polypharmacy_review_signal.sql, pathway 64.15).
--
-- BACKGROUND. The function's grouping query used `max(organisation_id)` to
-- pick a representative organisation_id per patient_id group:
--
--   select patient_id, max(organisation_id) as organisation_id, count(*) as med_count
--   from public.medications
--   where is_active
--   group by patient_id
--   having count(*) >= 5
--
-- PostgreSQL has no built-in max()/min() aggregate for uuid — unlike types
-- such as integer/text/timestamp, uuid's btree opclass is not enough on its
-- own to give it the polymorphic max/min aggregate. Confirmed live: even
-- `select max(id) from public.profiles` raises `function max(uuid) does not
-- exist`. So every invocation of private.raise_polypharmacy_review_signals()
-- has unconditionally raised that error since it was created 2026-08-29 —
-- confirmed via pg_get_functiondef that the live definition is byte-for-byte
-- what that migration shipped, i.e. this was never a subsequent regression,
-- it never worked. It is scheduled nightly via pg_cron
-- ('polypharmacy-review-signals-nightly', 20 4 * * *) and has been failing
-- silently every night since.
--
-- Checked live: zero patients currently have 5+ active medications (this is
-- a pre-revenue platform with no real patient population yet), so this bug
-- has not actually suppressed any real signal so far — but it would have,
-- silently, the moment a real patient's medication list grew past the
-- threshold, with nothing surfacing the failure (pg_cron's own
-- job_run_details is empty for this job on this project, so there is no
-- built-in visibility into the nightly failures either).
--
-- FIX. Every row in a patient_id group shares the same organisation_id (a
-- patient belongs to exactly one organisation; organisation_id is a
-- multi-tenant boundary, not a per-medication attribute) — max() was never
-- doing real aggregation work, just picking "the" value. Replaced with
-- `(array_agg(organisation_id))[1]`, which works for any type and needs no
-- ordering, min/max aggregate, or DISTINCT ON re-plan.

create or replace function private.raise_polypharmacy_review_signals()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.raise_clinician_alert(
    m.organisation_id, m.patient_id, 'routine',
    format('Polypharmacy: %s active medications', m.med_count),
    format('This patient has %s active medications on file. Worth a step-back medication review for duplicate therapy, ongoing indication, and whether the regimen can be simplified.', m.med_count),
    'clinical', 'medication_safety'
  )
  from (
    select patient_id, (array_agg(organisation_id))[1] as organisation_id, count(*) as med_count
    from public.medications
    where is_active
    group by patient_id
    having count(*) >= 5
  ) m
  where not exists (
    select 1 from public.clinician_alerts ca
    where ca.type_code = 'medication_safety' and ca.patient_id = m.patient_id
      and ca.title like 'Polypharmacy:%'
      and ca.status in ('open', 'acknowledged') and ca.created_at > now() - interval '30 days'
  );
end;
$$;

comment on function private.raise_polypharmacy_review_signals() is
  'Medication pathway 64.15: nightly sweep raising a routine clinician_alerts row (medication_safety) for any patient with 5+ concurrent active medications, deduped per patient for 30 days. Fixed 2026-09-02: the original max(organisation_id) grouping expression raised "function max(uuid) does not exist" on every invocation since creation -- see 20260902225649_fix_polypharmacy_review_signals_max_uuid.sql.';

-- ===========================================================================
-- The migration is the test: actually CALL the function, not just check it
-- exists, since "exists" is exactly what the original migration's own
-- self-test already checked and it still shipped broken.
-- ===========================================================================
do $$
begin
  perform private.raise_polypharmacy_review_signals();
  raise notice 'PASS: private.raise_polypharmacy_review_signals() ran without error';
end $$;
