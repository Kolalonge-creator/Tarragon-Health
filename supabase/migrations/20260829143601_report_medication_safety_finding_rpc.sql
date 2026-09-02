-- Tarragon Health — medication safety pathway 64.16/64.17/64.18: turn the
-- existing drug-safety advisory engine's most severe findings into a real
-- clinician_alerts row, not just a panel a clinician has to remember to open.
--
-- apps/web/src/lib/rules/drug-safety.ts already detects interactions,
-- duplicate therapy, and allergy conflicts (assessMedicationSafety) and
-- surfaces them on MedicationSafetyPanel — pull-only, advisory. The Alert
-- System taxonomy (2026-08-28) already reserved exactly this: 'medication_
-- safety' and 'potential_interaction' are both seeded "currently clinician-
-- raised only" / "reserved for when [an interaction-detection engine] is
-- built" (20260828013011). That engine already exists; it just never told
-- the alert system anything. This is its first real generator for both.
--
-- The rule engine itself stays TypeScript-only and the single source of
-- truth (its own file header is explicit about that) — reimplementing ~35
-- interaction rules, duplicate-therapy/prescriber reasoning, and 3-tier
-- allergy cross-reactivity in SQL would fork the logic. Instead this adds
-- the narrow, governed WRITE PATH: a SECURITY DEFINER RPC the server-side
-- app layer calls once it has already run assessMedicationSafety and found
-- a contraindicated-severity finding, so alert creation still goes through
-- the same classify_and_assign_clinician_alert() / alert_rules governance
-- every other generator uses (severity derivation, dedup, ownership) rather
-- than the app layer inserting into clinician_alerts directly.
--
-- Deliberately advisory, matching drug-safety.ts's own SafetyReport.
-- isAdvisoryOnly contract: this only ever ADDS a review task, it never
-- blocks, reverses, or is called from the medications INSERT/UPDATE path
-- itself, so a slow or failed safety check can never stop a prescription
-- from being recorded.

create or replace function public.report_medication_safety_finding(
  p_patient_id      uuid,
  p_organisation_id uuid,
  p_title           text,
  p_detail          text,
  p_type_code       public.alert_type_code
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
begin
  if p_type_code not in ('medication_safety', 'potential_interaction') then
    raise exception 'report_medication_safety_finding may only raise a medication_safety or potential_interaction alert' using errcode = '42501';
  end if;

  if not private.is_org_staff(p_organisation_id) then
    raise exception 'not authorised: only org clinical staff may report a medication safety finding' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_patient_id and organisation_id = p_organisation_id
  ) then
    raise exception 'patient does not belong to the given organisation';
  end if;

  v_alert_id := private.raise_clinician_alert(
    p_organisation_id, p_patient_id, 'clinician_review', p_title, p_detail, 'clinical', p_type_code
  );

  return v_alert_id;
end;
$$;

comment on function public.report_medication_safety_finding(uuid, uuid, text, text, public.alert_type_code) is
  'Medication pathway 64.16-64.18: raises a real clinician_review clinician_alerts row (medication_safety or potential_interaction) from a contraindicated-severity finding the app layer already computed via assessMedicationSafety (apps/web/src/lib/rules/drug-safety.ts). Caller must be org staff for the patient''s own organisation. Never called from the medications write path itself — advisory only, additive.';

revoke all on function public.report_medication_safety_finding(uuid, uuid, text, text, public.alert_type_code) from public, anon;
grant execute on function public.report_medication_safety_finding(uuid, uuid, text, text, public.alert_type_code) to authenticated;

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'report_medication_safety_finding' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'public.report_medication_safety_finding was not created';
  end if;

  if has_function_privilege('anon', 'public.report_medication_safety_finding(uuid, uuid, text, text, public.alert_type_code)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.report_medication_safety_finding';
  end if;
  if not has_function_privilege('authenticated', 'public.report_medication_safety_finding(uuid, uuid, text, text, public.alert_type_code)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.report_medication_safety_finding';
  end if;

  raise notice 'PASS: public.report_medication_safety_finding installed, anon denied, authenticated granted';
end $$;
