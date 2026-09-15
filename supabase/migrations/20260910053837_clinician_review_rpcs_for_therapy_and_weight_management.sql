-- The clinician side of the two new clinical products: approving a psychiatry
-- booking, and reviewing a weight-management tolerability check-in.
-- Founder decision, 2026-09-10.
--
-- CLOSING A GAP I LEFT IN MY OWN COMMENT
-- --------------------------------------
-- 20260910014008 wrote, in the RLS block for therapy_sessions:
--
--   "a member of staff without prescribing authority cannot shortcut it by
--    setting approved_by to themselves; that is checked in the approval RPC
--    rather than here"
--
-- There was no approval RPC. The policy admitted any org staff to UPDATE, and
-- private.enforce_therapy_session_rules only checked that approved_by was NOT
-- NULL before a psychiatry booking could be confirmed -- not who it named. A
-- Care Coordinator could therefore have set approved_by to their own id and
-- confirmed a psychiatry referral, which is exactly the authority split the
-- clinical tier ladder exists to prevent (a coordinator never interprets, never
-- prescribes, never closes a clinical decision).
--
-- Two things fix it, and both are needed:
--   * public.approve_therapy_session, a SECURITY DEFINER RPC that demands
--     prescribing authority and stamps approved_by from auth.uid() rather than
--     from anything the caller sends;
--   * private.enforce_therapy_approver_authority, a trigger, because an RPC
--     nobody is forced to use is a convention rather than a control. The RLS
--     UPDATE policy stays as it is so a patient can still cancel; the trigger is
--     what makes the authority rule true regardless of path.
--
-- WEIGHT-MANAGEMENT REVIEW
-- ------------------------
-- Same shape and the same reason. Marking a tolerability check-in reviewed is a
-- clinical act -- it asserts a clinician read the symptom scores and was content
-- -- so reviewed_by is stamped from the session, and a Care Coordinator is
-- refused. A coordinator may still see the queue; they simply cannot sign it
-- off, which matches how every other clinical sign-off on this platform works.
--
-- RED FLAGS ARE ROUTED, NOT JUST DISPLAYED
-- ----------------------------------------
-- A check-in reporting severe persistent abdominal pain radiating to the back
-- (how pancreatitis presents on a GLP-1) or persistent vomiting with poor oral
-- intake now raises a clinician_alerts row on insert, with an SLA. Relying on a
-- clinician happening to open a queue is how a red flag gets missed, and this
-- platform already has one mechanism for "a doctor must be told"; a second one
-- made of dashboards is not a mechanism.

begin;

-- ---------------------------------------------------------------------------
-- 1. Only a clinician with prescribing authority may approve psychiatry
-- ---------------------------------------------------------------------------

create or replace function private.enforce_therapy_approver_authority()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.approved_by is null or new.approved_by is not distinct from old.approved_by then
    return new;
  end if;

  -- Whoever is named as the approver must actually be an active clinician in
  -- this organisation with prescribing authority. Checked against the NAMED
  -- approver rather than the caller, so a service-role path cannot launder an
  -- unqualified approver either.
  if not exists (
    select 1
      from public.clinical_staff cs
     where cs.profile_id = new.approved_by
       and cs.organisation_id = new.organisation_id
       and cs.active
       and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
  ) then
    raise exception 'A psychiatry booking must be approved by a doctor with prescribing authority.'
      using errcode = '42501', detail = 'THERAPY_APPROVER_NOT_AUTHORISED';
  end if;

  return new;
end;
$function$;

comment on function private.enforce_therapy_approver_authority() is
  'Makes therapy_sessions.approved_by mean something. Without it the RLS UPDATE policy admitted any org staff, and the session-rules trigger only checked that approved_by was non-null -- so a Care Coordinator could have approved a psychiatry referral by naming themselves. Added 2026-09-10 to close a gap left by a comment in 20260910014008 that described an approval RPC which did not exist.';

drop trigger if exists therapy_sessions_approver_authority on public.therapy_sessions;
create trigger therapy_sessions_approver_authority
  before update on public.therapy_sessions
  for each row execute function private.enforce_therapy_approver_authority();

create or replace function public.approve_therapy_session(p_session_id uuid, p_confirm boolean default true)
returns public.therapy_sessions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_row    public.therapy_sessions;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.therapy_sessions where id = p_session_id;
  if v_row.id is null then
    raise exception 'That request no longer exists.' using errcode = 'P0001';
  end if;
  if not private.is_org_staff(v_row.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- approved_by is taken from the SESSION, never from a parameter. A caller
  -- cannot nominate someone else as the approver, which is what would make the
  -- attribution a fiction.
  update public.therapy_sessions
     set approved_by = v_caller,
         approved_at = now(),
         status      = case when p_confirm then 'confirmed'::public.therapy_session_status
                            else 'cancelled'::public.therapy_session_status end,
         cancelled_at = case when p_confirm then null else now() end,
         cancelled_reason = case when p_confirm then null
                                 else 'Not approved by the care team' end
   where id = p_session_id
  returning * into v_row;

  return v_row;
end;
$function$;

comment on function public.approve_therapy_session(uuid, boolean) is
  'Approve or decline a psychiatry booking. Stamps approved_by from auth.uid(); the authority check itself lives in private.enforce_therapy_approver_authority so it holds on any write path, not only this one.';

revoke all on function public.approve_therapy_session(uuid, boolean) from public;
grant execute on function public.approve_therapy_session(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reviewing a tolerability check-in is a clinical act
-- ---------------------------------------------------------------------------

create or replace function private.enforce_weight_checkin_reviewer_authority()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.reviewed_by is null or new.reviewed_by is not distinct from old.reviewed_by then
    return new;
  end if;

  -- Any clinical tier may read a check-in and sign it off. A Care Coordinator
  -- may not: they never interpret a clinical finding, per the tier ladder.
  if not exists (
    select 1
      from public.clinical_staff cs
     where cs.profile_id = new.reviewed_by
       and cs.organisation_id = new.organisation_id
       and cs.active
       and cs.doctor_tier <> 'care_coordinator'
  ) then
    raise exception 'A tolerability check-in must be reviewed by a clinician, not a coordinator.'
      using errcode = '42501', detail = 'WEIGHT_CHECKIN_REVIEWER_NOT_CLINICAL';
  end if;

  if new.reviewed_at is null then
    new.reviewed_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists weight_checkins_reviewer_authority on public.weight_management_checkins;
create trigger weight_checkins_reviewer_authority
  before update on public.weight_management_checkins
  for each row execute function private.enforce_weight_checkin_reviewer_authority();

create or replace function public.review_weight_management_checkin(p_checkin_id uuid, p_note text default null)
returns public.weight_management_checkins
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_row    public.weight_management_checkins;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.weight_management_checkins where id = p_checkin_id;
  if v_row.id is null then
    raise exception 'That check-in no longer exists.' using errcode = 'P0001';
  end if;
  if not private.is_org_staff(v_row.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  update public.weight_management_checkins
     set reviewed_by    = v_caller,
         reviewed_at    = now(),
         clinician_note = coalesce(p_note, clinician_note)
   where id = p_checkin_id
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.review_weight_management_checkin(uuid, text) from public;
grant execute on function public.review_weight_management_checkin(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A red-flag check-in reaches a doctor, rather than waiting in a queue
-- ---------------------------------------------------------------------------

create or replace function private.raise_weight_checkin_red_flag()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_reason text;
begin
  if new.red_flag_reported then
    v_reason := 'reported severe, persistent abdominal pain (the presentation that matters most on a GLP-1)';
  elsif new.poor_oral_intake and coalesce(new.vomiting, 0) >= 2 then
    v_reason := 'reported persistent vomiting and is unable to keep food or fluids down';
  else
    return new;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at)
  values (
    new.organisation_id,
    new.patient_id,
    'urgent_escalation',
    'open',
    'Weight-management check-in: red flag',
    format('Patient %s in supervised weight management %s. Check-in %s.',
           new.patient_id, v_reason, new.id),
    now() + interval '24 hours'
  );

  return new;
end;
$function$;

comment on function private.raise_weight_checkin_red_flag() is
  'Routes a dangerous tolerability check-in to a clinician instead of relying on someone opening a queue. This platform already has one mechanism for "a doctor must be told"; a dashboard is not a second one.';

drop trigger if exists weight_checkins_red_flag on public.weight_management_checkins;
create trigger weight_checkins_red_flag
  after insert on public.weight_management_checkins
  for each row execute function private.raise_weight_checkin_red_flag();

-- ---------------------------------------------------------------------------
-- 4. Assertions -- both directions, and the red-flag route actually fires
-- ---------------------------------------------------------------------------

do $$
declare
  v_org      uuid;
  v_patient  uuid := gen_random_uuid();
  v_coord    uuid;
  v_senior   uuid;
  v_med      uuid;
  v_enrol    uuid;
  v_checkin  uuid;
  v_refused  boolean := false;
  v_alerts   int;
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
    raise notice 'SKIP: need an organisation with an active senior clinician to prove the authority rules';
  else
    begin
      insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_patient, 'wm-review-probe@example.invalid', 'x', now(), '{}', '{}');
      insert into public.profiles (id, organisation_id, role, full_name)
      values (v_patient, v_org, 'patient', 'WM Review Probe')
      on conflict (id) do update set organisation_id = excluded.organisation_id, role = 'patient';

      insert into public.medications
        (organisation_id, patient_id, drug_name, source, prescriber_name, is_active)
      values (v_org, v_patient, 'ZZ probe: patient-supplied', 'patient', 'Dr External', true)
      returning id into v_med;

      insert into public.weight_management_enrolments
        (organisation_id, patient_id, medication_id, term_days, status)
      values (v_org, v_patient, v_med, 90, 'pending_eligibility')
      returning id into v_enrol;

      -- A red-flag check-in must raise an alert on its own.
      insert into public.weight_management_checkins
        (organisation_id, enrolment_id, patient_id, nausea, vomiting, diarrhoea,
         constipation, abdominal_pain, poor_oral_intake, red_flag_reported)
      values (v_org, v_enrol, v_patient, 1, 1, 0, 0, 3, false, true)
      returning id into v_checkin;

      select count(*) into v_alerts
        from public.clinician_alerts
       where patient_id = v_patient and title = 'Weight-management check-in: red flag';
      if v_alerts = 0 then
        raise exception 'FAIL: a red-flag check-in raised no clinician alert.';
      end if;

      -- A coordinator may not sign it off...
      if v_coord is not null then
        begin
          update public.weight_management_checkins
             set reviewed_by = v_coord where id = v_checkin;
        exception when others then
          if sqlerrm like '%not a coordinator%' then
            v_refused := true;
          else
            raise;
          end if;
        end;
        if not v_refused then
          raise exception 'FAIL: a Care Coordinator was allowed to sign off a tolerability check-in.';
        end if;
      end if;

      -- ...and a clinician may.
      update public.weight_management_checkins
         set reviewed_by = v_senior where id = v_checkin;
      if not exists (select 1 from public.weight_management_checkins
                      where id = v_checkin and reviewed_at is not null) then
        raise exception 'FAIL: a clinician sign-off did not stamp reviewed_at.';
      end if;

      raise exception 'ROLLBACK_PROBE';
    exception when others then
      if sqlerrm <> 'ROLLBACK_PROBE' then raise; end if;
    end;
    raise notice 'PASS: red flag routes to a clinician; coordinator refused, clinician accepted';
  end if;

  if has_function_privilege('anon', 'public.approve_therapy_session(uuid, boolean)', 'EXECUTE') then
    raise exception 'FAIL: anon can EXECUTE approve_therapy_session';
  end if;
  if has_function_privilege('anon', 'public.review_weight_management_checkin(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can EXECUTE review_weight_management_checkin';
  end if;
  raise notice 'PASS: clinician review RPCs live and closed to anon';
end $$;

commit;
