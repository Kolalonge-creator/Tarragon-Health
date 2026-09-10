-- Supervised Weight Management: give a clinician a way to actually find and
-- confirm a freshly-enrolled patient.
--
-- THE GAP
-- -------
-- 20260910182555 (branch worktree-mobile-b2c-parity, applied live, not yet
-- merged to main-dev) closed the purchase-to-enrolment gap: paying for
-- weight_management_3m/6m/12m now creates a weight_management_enrolments row
-- at status = 'pending_eligibility'. But nothing ever surfaced that row to a
-- clinician. apps/web/.../clinician/weight-management/queue.tsx only lists
-- unreviewed weight_management_checkins, which do not exist yet for a patient
-- who has not even been confirmed eligible -- a clinician had no dedicated
-- list to find them, only a raw table query they would have to know to run.
-- RLS was already correct (wm_enrolments_select lets org staff read;
-- wm_enrolments_update lets org staff write); this was purely a missing
-- write path and a missing UI.
--
-- WHY THIS NEEDS AN RPC AND NOT A RAW UPDATE
-- -------------------------------------------
-- wm_enrolments_update (20260910011851) admits ANY org staff, deliberately --
-- a Care Coordinator can update the row for routing/logistics reasons. But
-- moving status to 'active' is what wme_active_needs_eligibility gates on
-- eligibility_confirmed_at/by, obesity_assessment_id and
-- supervising_clinician_id all being set together, and confirming a patient
-- is a suitable candidate for GLP-1 supervision is a prescribing-class
-- clinical judgement -- the same class of act as agreeing a dose-escalation
-- step (wm_dose_steps_write, gated on has_prescribing_authority) or approving
-- a psychiatry booking (private.enforce_therapy_approver_authority). Left to
-- a raw UPDATE, a Care Coordinator could set eligibility_confirmed_by to
-- themselves and self-approve. Same fix as those two: a SECURITY DEFINER RPC
-- that stamps confirmed_by/supervising_clinician_id from the session (never
-- from a parameter), plus a BEFORE UPDATE trigger so the authority rule holds
-- on every write path, not only this RPC.
--
-- The RPC also cross-checks that the assessment and medication it is
-- pointing at actually belong to the enrolment's own patient, in this
-- organisation -- the same class of mistake the "profiles vs clinical_staff
-- actor columns" gotcha warns about (wrong id, silently wrong row), except
-- here a wrong id would let a doctor accidentally start Patient A's
-- supervision on Patient B's medication record.

begin;

-- ---------------------------------------------------------------------------
-- 1. Confirming eligibility is a prescribing-class act
-- ---------------------------------------------------------------------------

create or replace function private.enforce_weight_management_eligibility_authority()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.eligibility_confirmed_by is null
     or new.eligibility_confirmed_by is not distinct from old.eligibility_confirmed_by then
    return new;
  end if;

  -- Checked against the NAMED confirmer, not the caller, so a service-role
  -- path cannot launder an unqualified one either -- same shape as
  -- private.enforce_therapy_approver_authority.
  if not exists (
    select 1
      from public.clinical_staff cs
     where cs.profile_id = new.eligibility_confirmed_by
       and cs.organisation_id = new.organisation_id
       and cs.active
       and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
  ) then
    raise exception 'Weight-management eligibility must be confirmed by a clinician with prescribing authority.'
      using errcode = '42501', detail = 'WEIGHT_MANAGEMENT_ELIGIBILITY_NOT_AUTHORISED';
  end if;

  return new;
end;
$function$;

comment on function private.enforce_weight_management_eligibility_authority() is
  'Makes weight_management_enrolments.eligibility_confirmed_by mean something. wm_enrolments_update (20260910011851) deliberately admits any org staff for routing/logistics reasons, so without this a Care Coordinator could self-approve GLP-1 supervision eligibility. Added 2026-09-10 alongside public.confirm_weight_management_eligibility.';

drop trigger if exists weight_management_eligibility_authority on public.weight_management_enrolments;
create trigger weight_management_eligibility_authority
  before update on public.weight_management_enrolments
  for each row execute function private.enforce_weight_management_eligibility_authority();

-- ---------------------------------------------------------------------------
-- 2. The RPC a clinician's "Confirm eligibility" action actually calls
-- ---------------------------------------------------------------------------

create or replace function public.confirm_weight_management_eligibility(
  p_enrolment_id uuid,
  p_obesity_assessment_id uuid,
  p_medication_id uuid,
  p_notes text default null
)
returns public.weight_management_enrolments
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_row    public.weight_management_enrolments;
  v_assessment_patient uuid;
  v_medication_patient uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.weight_management_enrolments where id = p_enrolment_id;
  if v_row.id is null then
    raise exception 'That enrolment no longer exists.' using errcode = 'P0001';
  end if;

  if not private.is_org_staff(v_row.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- A specific, early error for a Care Coordinator who opens this without
  -- prescribing authority, rather than making them discover it from the
  -- trigger's generic message below.
  if not private.has_prescribing_authority(v_row.organisation_id) then
    raise exception 'Confirming eligibility for weight-management supervision requires prescribing authority.'
      using errcode = '42501', detail = 'WEIGHT_MANAGEMENT_ELIGIBILITY_NOT_AUTHORISED';
  end if;

  if v_row.status <> 'pending_eligibility' then
    raise exception 'This enrolment is not awaiting eligibility confirmation.' using errcode = 'P0001';
  end if;

  select patient_id into v_assessment_patient
    from public.obesity_assessments
   where id = p_obesity_assessment_id and organisation_id = v_row.organisation_id;
  if v_assessment_patient is null or v_assessment_patient <> v_row.patient_id then
    raise exception 'That obesity assessment does not belong to this patient.' using errcode = 'P0001';
  end if;

  select patient_id into v_medication_patient
    from public.medications
   where id = p_medication_id and organisation_id = v_row.organisation_id;
  if v_medication_patient is null or v_medication_patient <> v_row.patient_id then
    raise exception 'That medication does not belong to this patient.' using errcode = 'P0001';
  end if;

  -- source = 'patient' and a named prescriber are enforced by
  -- private.enforce_weight_management_supervision_only (already on this
  -- table since 20260910011851) the moment this UPDATE sets status =
  -- 'active' -- not duplicated here.
  update public.weight_management_enrolments
     set obesity_assessment_id    = p_obesity_assessment_id,
         medication_id            = p_medication_id,
         supervising_clinician_id = v_caller,
         eligibility_confirmed_at = now(),
         eligibility_confirmed_by = v_caller,
         eligibility_notes        = coalesce(p_notes, eligibility_notes),
         status                   = 'active',
         started_at               = now(),
         ends_at                  = (now() + (v_row.term_days || ' days')::interval)::date
   where id = p_enrolment_id
  returning * into v_row;

  return v_row;
end;
$function$;

comment on function public.confirm_weight_management_eligibility(uuid, uuid, uuid, text) is
  'Moves a weight_management_enrolments row from pending_eligibility to active. Stamps supervising_clinician_id and eligibility_confirmed_by from auth.uid(), never from a parameter; the authority check itself lives in private.enforce_weight_management_eligibility_authority so it holds on any write path, not only this one.';

revoke all on function public.confirm_weight_management_eligibility(uuid, uuid, uuid, text) from public;
grant execute on function public.confirm_weight_management_eligibility(uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Assertions -- both directions, and the cross-patient checks
-- ---------------------------------------------------------------------------

do $$
declare
  v_org       uuid;
  v_patient   uuid := gen_random_uuid();
  v_other     uuid := gen_random_uuid();
  v_coord     uuid;
  v_senior    uuid;
  v_med       uuid;
  v_other_med uuid;
  v_assess    uuid;
  v_other_assess uuid;
  v_enrol     uuid;
  v_refused   boolean := false;
  v_active    boolean;
begin
  select organisation_id into v_org
    from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  select cs.profile_id into v_coord
    from public.clinical_staff cs
   where cs.organisation_id = v_org and cs.active and cs.doctor_tier = 'care_coordinator' limit 1;
  select cs.profile_id into v_senior
    from public.clinical_staff cs
   where cs.organisation_id = v_org and cs.active
     and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer') limit 1;

  if v_org is null or v_senior is null then
    raise notice 'SKIP: need an organisation with an active senior clinician to prove the eligibility RPC';
  else
    begin
      insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values
        (v_patient, 'wm-eligibility-probe@example.invalid', 'x', now(), '{}', '{}'),
        (v_other, 'wm-eligibility-probe-other@example.invalid', 'x', now(), '{}', '{}');
      insert into public.profiles (id, organisation_id, role, full_name)
      values
        (v_patient, v_org, 'patient', 'WM Eligibility Probe'),
        (v_other, v_org, 'patient', 'WM Eligibility Probe Other')
      on conflict (id) do update set organisation_id = excluded.organisation_id, role = 'patient';

      insert into public.medications
        (organisation_id, patient_id, drug_name, source, prescriber_name, is_active)
      values (v_org, v_patient, 'ZZ probe: patient-supplied', 'patient', 'Dr External', true)
      returning id into v_med;
      insert into public.medications
        (organisation_id, patient_id, drug_name, source, prescriber_name, is_active)
      values (v_org, v_other, 'ZZ probe: another patient''s medication', 'patient', 'Dr External', true)
      returning id into v_other_med;

      insert into public.obesity_assessments
        (organisation_id, patient_id, height_cm, weight_kg, bmi, bmi_category)
      values (v_org, v_patient, 170, 100, 34.6, 'obesity_class_i')
      returning id into v_assess;
      insert into public.obesity_assessments
        (organisation_id, patient_id, height_cm, weight_kg, bmi, bmi_category)
      values (v_org, v_other, 170, 100, 34.6, 'obesity_class_i')
      returning id into v_other_assess;

      insert into public.weight_management_enrolments
        (organisation_id, patient_id, term_days, status)
      values (v_org, v_patient, 90, 'pending_eligibility')
      returning id into v_enrol;

      -- A Care Coordinator may not confirm eligibility. Simulated as a real
      -- session (v_coord), not the unauthenticated superuser context this
      -- block otherwise runs in, so a stray auth.uid() IS NULL cannot make
      -- this pass vacuously.
      if v_coord is not null then
        begin
          perform set_config('request.jwt.claims',
            json_build_object('sub', v_coord::text, 'role', 'authenticated')::text, true);
          set local role authenticated;
          perform public.confirm_weight_management_eligibility(v_enrol, v_assess, v_med, null);
          reset role;
        exception when others then
          reset role;
          if sqlerrm like '%prescribing authority%' then
            v_refused := true;
          else
            raise;
          end if;
        end;
        if not v_refused then
          raise exception 'FAIL: a Care Coordinator was allowed to confirm weight-management eligibility.';
        end if;
        raise notice 'PASS: Care Coordinator refused confirm_weight_management_eligibility';
      end if;

      -- A senior clinician may not confirm eligibility against another
      -- patient's assessment or medication.
      v_refused := false;
      begin
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_senior::text, 'role', 'authenticated')::text, true);
        set local role authenticated;
        perform public.confirm_weight_management_eligibility(v_enrol, v_other_assess, v_med, null);
        reset role;
      exception when others then
        reset role;
        if sqlerrm like '%does not belong to this patient%' then
          v_refused := true;
        else
          raise;
        end if;
      end;
      if not v_refused then
        raise exception 'FAIL: confirm_weight_management_eligibility accepted an assessment belonging to a different patient.';
      end if;

      v_refused := false;
      begin
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_senior::text, 'role', 'authenticated')::text, true);
        set local role authenticated;
        perform public.confirm_weight_management_eligibility(v_enrol, v_assess, v_other_med, null);
        reset role;
      exception when others then
        reset role;
        if sqlerrm like '%does not belong to this patient%' then
          v_refused := true;
        else
          raise;
        end if;
      end;
      if not v_refused then
        raise exception 'FAIL: confirm_weight_management_eligibility accepted a medication belonging to a different patient.';
      end if;
      raise notice 'PASS: cross-patient assessment/medication both refused';

      -- ...and correctly, a senior clinician CAN confirm eligibility.
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_senior::text, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.confirm_weight_management_eligibility(v_enrol, v_assess, v_med, 'Suitable candidate, no contraindications.');
      reset role;
      select (status = 'active' and eligibility_confirmed_by = v_senior
              and supervising_clinician_id = v_senior and started_at is not null and ends_at is not null)
        into v_active
        from public.weight_management_enrolments where id = v_enrol;
      if not v_active then
        raise exception 'FAIL: a qualified senior clinician was refused, or the confirmation did not stamp every expected field.';
      end if;
      raise notice 'PASS: senior clinician confirmed eligibility; enrolment is now active';

      raise exception 'ROLLBACK_PROBE';
    exception when others then
      if sqlerrm <> 'ROLLBACK_PROBE' then raise; end if;
    end;
  end if;

  if has_function_privilege('anon', 'public.confirm_weight_management_eligibility(uuid, uuid, uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can EXECUTE confirm_weight_management_eligibility';
  end if;
  raise notice 'PASS: confirm_weight_management_eligibility live and closed to anon';
end $$;

commit;
