-- Tarragon Health — medication safety pathway §64.4: "I'm no longer taking
-- this" creates a review task, not a silent drop.
--
-- StopMedicationForm (apps/web/src/app/(dashboard)/patient/medications-list.tsx)
-- already lets a patient flip is_active=false on ANY of their own medications
-- with a free-text reason — including a clinician/specialist-prescribed one —
-- because enforce_medication_confirm_only (20260827200208) leaves a patient
-- editing their own row entirely unrestricted. That write has always
-- succeeded silently: the medication disappears from the active list and
-- nothing reaches the care team. For a self-added medication that is fine
-- (nothing to review), but for a clinician/specialist-prescribed one it is
-- exactly the gap the spec calls out — the record updates, but no one who
-- prescribed it ever finds out the patient stopped taking it, which could be
-- a genuine safety event (an untreated condition, an unreported side effect)
-- as easily as a benign one.
--
-- This adds a real generator for the 'medication_safety' alert_type_code —
-- seeded 2026-08-28 as category 'clinical', "currently clinician-raised
-- only" — following the exact pattern alert_generators_previously_uncovered_
-- types.sql used for missed_appointment/failed_referral: a single AFTER
-- UPDATE trigger, gated to the real transition, reusing the shared
-- private.raise_clinician_alert() insert helper so severity/routing/dedup
-- stay governed by classify_and_assign_clinician_alert() + alert_rules.
--
-- Gated to firing only when the PATIENT'S OWN account made the change
-- (new.patient_id = auth.uid()) on a clinician/specialist-sourced row — an
-- org-staff-driven stop is already a reviewed clinical decision, and a
-- patient's own self-added medication needs no clinical review when they
-- stop it. No caregiver/"acting for" gap here: unlike medication_logs,
-- medications was never extended with an acting-for-supporter update policy
-- (20260809232922_medication_logs_acting_for.sql only touched
-- medication_logs), so patient_id = auth.uid() fully covers every path that
-- can reach this trigger as a patient-initiated change.
--
-- The medication record itself is still updated exactly as before — this
-- adds a review task alongside that write, it does not block or reverse it.

create or replace function private.raise_review_on_patient_stopped_prescribed_medication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active = false
    and old.is_active = true
    and new.patient_id = (select auth.uid())
    and old.source in ('clinician', 'specialist')
  then
    perform private.raise_clinician_alert(
      new.organisation_id, new.patient_id, 'clinician_review',
      'Patient reported they stopped a prescribed medication',
      format(
        'The patient marked %s as no longer being taken.%s',
        new.drug_name,
        case
          when new.stopped_reason is not null and length(trim(new.stopped_reason)) > 0
            then ' Reason given: ' || new.stopped_reason || '.'
          else ' No reason was given — check in before assuming this is benign.'
        end
      ),
      'clinical', 'medication_safety'
    );
  end if;

  return new;
end;
$$;

comment on function private.raise_review_on_patient_stopped_prescribed_medication() is
  'Medication pathway 64.4: a patient self-stopping their own clinician/specialist-prescribed medication raises a clinician_review clinician_alerts row (medication_safety) instead of the change reaching no one. Never fires for a patient''s own self-added medication, and never fires when org staff made the change (that is already a reviewed decision).';

revoke all on function private.raise_review_on_patient_stopped_prescribed_medication() from public, anon;

drop trigger if exists medications_raise_review_on_patient_stop on public.medications;
create trigger medications_raise_review_on_patient_stop
  after update of is_active on public.medications
  for each row execute function private.raise_review_on_patient_stopped_prescribed_medication();

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'medications_raise_review_on_patient_stop'
      and tgrelid = 'public.medications'::regclass
      and not tgisinternal
  ) then
    raise exception 'medications_raise_review_on_patient_stop trigger was not created';
  end if;

  if has_function_privilege('anon', 'private.raise_review_on_patient_stopped_prescribed_medication()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.raise_review_on_patient_stopped_prescribed_medication';
  end if;

  raise notice 'PASS: patient-stopped-prescribed-medication review-alert generator installed';
end $$;
