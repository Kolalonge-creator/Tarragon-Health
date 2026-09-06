-- Tarragon Health — medication safety pathway 64.15: polypharmacy generates
-- a "needs medication review" signal.
--
-- A patient on many concurrent active medications is at raised risk of
-- interactions, duplicate therapy and adherence burden even when every
-- individual medicine is individually appropriate — the platform's own
-- duplicate-therapy/interaction engine (drug-safety.ts) already checks
-- PAIRWISE combinations, but nothing flags "this list, as a whole, is worth
-- a step back" the way a human pharmacist would on sight of a long list.
--
-- 5+ concurrent medications is the standard clinical polypharmacy threshold
-- (WHO / geriatric-medicine literature); this sweep is deliberately not
-- tied to any one care_plan_id — medication_reviews is scoped per care
-- plan, but polypharmacy is fundamentally a whole-patient, often
-- cross-condition concern (e.g. hypertension + diabetes + CKD medications
-- together), so forcing it onto one arbitrarily-chosen care plan would
-- misrepresent the actual concern. Raised as a clinician_alerts row
-- instead, category 'clinical' / type_code 'medication_safety' (an
-- appropriate fit — "a medication safety concern... needs clinician
-- attention" per its own 20260828013011 seed description), 'routine' level:
-- this is a worth-a-scheduled-look signal, not an urgent one.
--
-- Nightly sweep, matching the staleness-sweep pattern from
-- alert_generators_previously_uncovered_types.sql (raise_overdue_task_
-- alerts / raise_laboratory_failure_alerts / raise_pharmacy_problem_alerts):
-- a not-exists dedup guard, its own cron job. The dedup window here is 30
-- days rather than those sweeps' ~20-24h — a medication count doesn't
-- meaningfully change night to night, so a daily re-raise would just be
-- alert fatigue for a condition that is genuinely persistent, not fresh.

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
    select patient_id, max(organisation_id) as organisation_id, count(*) as med_count
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
  'Medication pathway 64.15: nightly sweep raising a routine clinician_alerts row (medication_safety) for any patient with 5+ concurrent active medications, deduped per patient for 30 days.';

revoke all on function private.raise_polypharmacy_review_signals() from public, anon;

select cron.schedule('polypharmacy-review-signals-nightly', '20 4 * * *', $$select private.raise_polypharmacy_review_signals()$$);

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'raise_polypharmacy_review_signals' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'private.raise_polypharmacy_review_signals was not created';
  end if;

  if not exists (select 1 from cron.job where jobname = 'polypharmacy-review-signals-nightly') then
    raise exception 'polypharmacy-review-signals-nightly cron job was not scheduled';
  end if;

  if has_function_privilege('anon', 'private.raise_polypharmacy_review_signals()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.raise_polypharmacy_review_signals';
  end if;

  raise notice 'PASS: polypharmacy review signal sweep installed and scheduled';
end $$;
