-- S05f part 1 of 2 (piece B): the audited, tie-gated read of a patient's dose log history (INV-10, INV-12).
--
-- Counted first (live, 2026-10-01): medication_logs 0 rows, symptoms 1 row.
-- Inventory (code scan plus live pg_proc / pg_views / pg_policies scan):
--   * medication_logs: ONE staff user-session reader, the clinician chart's "Dose log history" card
--     (clinician/patients/[patientId]/medication-adherence-history.tsx, raw table plus an embedded medications(drug_name)). It moves onto
--     public.read_medication_dose_log_audited below. Every other `.from("medication_logs")` / `medication_logs_latest_per_slot` reader is
--     the patient's own screen or the mobile app (own rows), or the service role.
--   * symptoms: ZERO staff user-session readers. The readers are the patient's own history list, the patient's AI coach and the patient's
--     own insert. Staff reach symptoms only through read_patient_chart_audited (section `symptoms`), which already exists.
--   * database: every function that reads either table is SECURITY DEFINER (evaluate_adherence_escalation, route_missed_dose_reason,
--     queue_medication_dose_reminders, the red-flag handlers, patient_engagement_events, get_population_outcomes,
--     reproductive_health_analytics, read_patient_chart_audited, ...), so none breaks when the staff policy goes. The only invoker views
--     are the three security_invoker views dose_events, symptom_reports and medication_logs_latest_per_slot; the first two are reached only
--     through the audited chart function (definer), the third only by patients reading their own rows. No RLS policy on another table
--     references either table.
--   * NOT as the prompt expected: patient_timeline is a plain append-only TABLE (6 rows), not a view over symptoms / medications /
--     vitals, and hypertension_quality_metrics does not read medication_logs. Closing these two tables therefore changes neither; both
--     stay as they are (patient_timeline is not one of the ten health-record tables).
-- This migration is additive. The closing migration (policies) follows once the code that uses this function has deployed.

create or replace function public.read_medication_dose_log_audited(p_patient uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_page constant integer := 100;                      -- technical page size, the same 100 the card used before
  v_rows jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if (select auth.uid()) is null
     or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if not private.can_staff_read_clinical(p_patient, 'medications'::public.care_access_category) then
    perform private.audit_chart_read(p_patient, array['dose_events'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied', 'rows', '[]'::jsonb);
  end if;

  -- The raw append-only table, every entry including corrections (spec 1.4), newest first. `medication` carries the drug name the card
  -- used to read through an embedded select, so a closed medications table later cannot turn it into "Unknown medicine".
  select coalesce(jsonb_agg(to_jsonb(x) order by x.logged_at desc), '[]'::jsonb) into v_rows from (
    select l.id, l.status, l.reason, l.logged_at, l.scheduled_for_date, l.scheduled_time, l.logged_by_profile_id,
           jsonb_build_object('drug_name', m.drug_name) as medication
      from public.medication_logs l
      left join public.medications m on m.id = l.medication_id
     where l.patient_id = p_patient
     order by l.logged_at desc
     limit c_page) x;

  perform private.audit_chart_read(p_patient, array['dose_events'], p_reason, 'success');
  return jsonb_build_object('status', 'ok', 'rows', v_rows);
end;
$$;

revoke all on function public.read_medication_dose_log_audited(uuid, text) from public;
grant execute on function public.read_medication_dose_log_audited(uuid, text) to authenticated;

do $$
begin
  if not (select prosecdef from pg_proc where oid = 'public.read_medication_dose_log_audited(uuid,text)'::regprocedure) then
    raise exception 'S05f assertion: read_medication_dose_log_audited is not SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'public.read_medication_dose_log_audited(uuid,text)', 'EXECUTE') then
    raise exception 'S05f assertion: anon can execute read_medication_dose_log_audited';
  end if;
  if not has_function_privilege('authenticated', 'public.read_medication_dose_log_audited(uuid,text)', 'EXECUTE') then
    raise exception 'S05f assertion: authenticated cannot execute read_medication_dose_log_audited';
  end if;
end $$;
