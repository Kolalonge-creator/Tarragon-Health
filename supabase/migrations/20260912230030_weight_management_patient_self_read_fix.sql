-- Supervised Weight Management: a patient could never read their own record.
--
-- THE BUG, FOUND BY ACTUALLY SIGNING IN AS A PATIENT
-- ----------------------------------------------------
-- 20260910011851 wrote wm_enrolments_select / wm_dose_steps_select /
-- wm_checkins_select as:
--
--   private.can_read_clinical(patient_id, 'medications'::care_access_category)
--   or private.is_org_staff(organisation_id)
--
-- private.can_read_clinical(uuid, care_access_category) is a grant check --
-- it walks profile_access for a CAREGIVER's consented access to someone
-- else's record. It was never a self-access check and was never meant to be
-- one; every other clinical table on this platform spells self-access out as
-- its own explicit clause (see therapy_sessions_select, written the same day:
-- `patient_id = (select auth.uid()) or private.is_org_staff(organisation_id)`).
-- Whoever wrote this table's RLS copied the caregiver-access half of that
-- pattern and dropped the patient's own half, which every migration
-- assertion in 20260910011851 and 20260910182555 (this session's own
-- purchase-activation fix) failed to catch -- both proved the trigger creates
-- the row and that unauthorized writers are refused, never that the patient
-- the row is ABOUT could read it back.
--
-- Found live, 2026-09-12, by actually opening the mobile app as
-- patient.complete.test after confirming their enrolment's eligibility
-- end-to-end: the enrolment was 'active' in the database and the app still
-- showed "Losing weight on medication?" -- the empty, not-enrolled state --
-- forever. A patient who paid for supervised weight management and was
-- confirmed eligible by a doctor could never see any of it: not their
-- enrolment status, not their dose plan, not their own check-in history.
-- That is the same class of failure as the purchase-activation gap this
-- session already fixed once (money/clinical-work in, nothing visible out),
-- just one layer further down the stack.
--
-- THE FIX
-- -------
-- Add the missing self-access clause everywhere can_read_clinical appears on
-- these three tables. Nothing else about the access model changes: a
-- consented caregiver proxy still reads via can_read_clinical exactly as
-- before, org staff still read via is_org_staff, and the write policies
-- (wm_enrolments_update, wm_dose_steps_write, wm_checkins_update) are
-- correctly untouched -- a patient still cannot mark themselves eligible,
-- agree their own dose step, or edit a clinician's review of their check-in.

begin;

drop policy if exists wm_enrolments_select on public.weight_management_enrolments;
create policy wm_enrolments_select on public.weight_management_enrolments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
    or private.is_org_staff(organisation_id)
  );

drop policy if exists wm_dose_steps_select on public.weight_management_dose_steps;
create policy wm_dose_steps_select on public.weight_management_dose_steps
  for select to authenticated
  using (exists (
    select 1 from public.weight_management_enrolments e
     where e.id = enrolment_id
       and (e.patient_id = (select auth.uid())
            or private.can_read_clinical(e.patient_id, 'medications'::public.care_access_category)
            or private.is_org_staff(e.organisation_id))));

drop policy if exists wm_checkins_select on public.weight_management_checkins;
create policy wm_checkins_select on public.weight_management_checkins
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
    or private.is_org_staff(organisation_id)
  );

-- ---------------------------------------------------------------------------
-- Assertion: prove the patient can now read their own row. This is the exact
-- gap that shipped -- every prior assertion on this table proved the trigger
-- and the authority checks, never the self-read, so this one specifically
-- simulates the PATIENT's own session rather than an org-staff or superuser
-- context. Rolled back via the sentinel-exception convention.
-- ---------------------------------------------------------------------------

do $$
declare
  v_patient  uuid := gen_random_uuid();
  v_org      uuid;
  v_enrol    uuid;
  v_step     uuid;
  v_checkin  uuid;
  v_seen     boolean;
begin
  select organisation_id into v_org from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  if v_org is null then
    raise notice 'SKIP: no organisation to prove the self-read fix against';
  else
    begin
      insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_patient, 'wm-self-read-probe@example.invalid', 'x', now(), '{}', '{}');
      insert into public.profiles (id, organisation_id, role, full_name)
      values (v_patient, v_org, 'patient', 'WM Self-Read Probe')
      on conflict (id) do update set organisation_id = excluded.organisation_id, role = 'patient';

      insert into public.weight_management_enrolments (organisation_id, patient_id, term_days, status)
      values (v_org, v_patient, 90, 'pending_eligibility')
      returning id into v_enrol;

      insert into public.weight_management_dose_steps (organisation_id, enrolment_id, step_number, dose_label, planned_from)
      values (v_org, v_enrol, 1, '0.25mg weekly', current_date)
      returning id into v_step;

      insert into public.weight_management_checkins (organisation_id, enrolment_id, patient_id, nausea, vomiting, diarrhoea, constipation, abdominal_pain)
      values (v_org, v_enrol, v_patient, 0, 0, 0, 0, 0)
      returning id into v_checkin;

      perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
      set local role authenticated;

      select exists(select 1 from public.weight_management_enrolments where id = v_enrol) into v_seen;
      if not v_seen then
        raise exception 'FAIL: patient still cannot read their own weight_management_enrolments row';
      end if;

      select exists(select 1 from public.weight_management_dose_steps where id = v_step) into v_seen;
      if not v_seen then
        raise exception 'FAIL: patient still cannot read their own weight_management_dose_steps row';
      end if;

      select exists(select 1 from public.weight_management_checkins where id = v_checkin) into v_seen;
      if not v_seen then
        raise exception 'FAIL: patient still cannot read their own weight_management_checkins row';
      end if;

      reset role;
      raise exception 'ROLLBACK_PROBE';
    exception when others then
      reset role;
      if sqlerrm <> 'ROLLBACK_PROBE' then raise; end if;
    end;
    raise notice 'PASS: a patient can now read their own enrolment, dose steps and check-ins';
  end if;
end $$;

commit;
