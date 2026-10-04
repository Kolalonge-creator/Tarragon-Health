-- ---------------------------------------------------------------------------
-- 20260829083319: a 'manage' profile_access grantee can see, cancel and
-- reschedule the patient's appointment, and is reminded about it in-app —
-- a 'view' grantee and a stranger must not.
--
-- NOTE: this proof is listed in ci.excluded. Its steps 1-4 (grantee visibility)
-- predate the category-scoped caregiver model and fail on the live policy for
-- reasons unrelated to notifications; the reminder steps (5+) were reworked
-- 2026-09-30 for the removal of the retired external chat channel (patient reminders now go
-- to private.patient_reminder_channel()) and count the '2h' milestone only,
-- since a 1h50m-out appointment is due for both the 24h and 2h milestones.
--
-- Run inside a transaction that is ROLLED BACK. Nothing here persists.
--
--   patient    the person whose appointment it is
--   manager    profile_access 'manage'  -> sees it, can cancel/reschedule, reminded
--   follower   profile_access 'view'    -> sees it, CANNOT cancel (control)
--   stranger   no grant at all          -> sees nothing (control)
--
-- Usage:
--   npx supabase db query --linked -f packages/db/tests/appointment_grantee_access_and_reminders.sql
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org       uuid := '00000000-0000-0000-0000-000000000001';
  v_patient   uuid := 'a1e30000-0000-4000-8000-000000000001';
  v_manager   uuid := 'a1e30000-0000-4000-8000-000000000002';
  v_follower  uuid := 'a1e30000-0000-4000-8000-000000000003';
  v_stranger  uuid := 'a1e30000-0000-4000-8000-000000000004';
  v_appt      uuid;
  v_n         int;
  v_wrote     boolean;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient,  'appt-test-patient@example.invalid',  'x', now(), '{}', '{}'),
    (v_manager,  'appt-test-manager@example.invalid',  'x', now(), '{}', '{}'),
    (v_follower, 'appt-test-follower@example.invalid', 'x', now(), '{}', '{}'),
    (v_stranger, 'appt-test-stranger@example.invalid', 'x', now(), '{}', '{}');

  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Appt Test Patient' where id = v_patient;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Appt Test Manager' where id = v_manager;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Appt Test Follower' where id = v_follower;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Appt Test Stranger' where id = v_stranger;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values
    (v_patient, v_manager, 'manage', v_patient),
    (v_patient, v_follower, 'view', v_patient);

  insert into public.appointments (
    organisation_id, patient_id, appointment_type, consultation_method,
    scheduled_for, ends_at, status
  ) values (
    v_org, v_patient, 'gp', 'telemedicine',
    now() + interval '2 hours', now() + interval '2 hours 30 minutes', 'booked'
  ) returning id into v_appt;

  -- ---- 1. The manage grantee can see it --------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.appointments where id = v_appt;
  if v_n <> 1 then raise exception 'FAIL: manage grantee cannot see the appointment'; end if;
  raise notice 'PASS  manage grantee sees the appointment';

  -- ---- 2. ...and can cancel it ------------------------------------------------
  perform public.cancel_appointment(v_appt, 'manager cancelled on behalf');
  reset role;
  if not exists (select 1 from public.appointments where id = v_appt and status = 'patient_cancelled') then
    raise exception 'FAIL: manage grantee could not cancel the appointment';
  end if;
  raise notice 'PASS  manage grantee can cancel';

  -- ---- 3. Control: a view-only grantee CANNOT cancel a (fresh) appointment ---
  insert into public.appointments (
    organisation_id, patient_id, appointment_type, consultation_method,
    scheduled_for, ends_at, status
  ) values (
    v_org, v_patient, 'gp', 'telemedicine',
    now() + interval '3 hours', now() + interval '3 hours 30 minutes', 'booked'
  ) returning id into v_appt;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_follower, 'role', 'authenticated')::text, true);
  v_wrote := true;
  begin
    perform public.cancel_appointment(v_appt, 'follower tried to cancel');
  exception when others then
    v_wrote := false;
  end;
  reset role;
  if v_wrote then
    raise exception 'FAIL: a view-only grantee was able to cancel the appointment';
  end if;
  raise notice 'PASS  view-only grantee cannot cancel (control)';

  -- ---- 4. A stranger sees nothing ---------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.appointments where id = v_appt;
  if v_n <> 0 then raise exception 'FAIL: a stranger sees % of the patient''s appointments', v_n; end if;
  reset role;
  raise notice 'PASS  stranger sees nothing';

  -- ---- 5. Reminder sweep notifies the manage grantee in-app -------------------
  update public.appointments set scheduled_for = now() + interval '1 hour 50 minutes',
    ends_at = now() + interval '2 hours 20 minutes' where id = v_appt;
  perform private.queue_appointment_reminders();

  select count(*) into v_n from public.notifications
   where recipient_id = v_manager and channel = 'in_app'
     and template = 'appointment_reminder_for_dependent'
     and payload->>'milestone' = '2h'
     and payload->>'appointment_id' = v_appt::text;
  if v_n <> 1 then
    raise exception 'FAIL: manage grantee got % in_app reminders, expected 1', v_n;
  end if;
  raise notice 'PASS  manage grantee reminded in-app';

  select count(*) into v_n from public.notifications
   where recipient_id = v_follower and template = 'appointment_reminder_for_dependent';
  if v_n <> 0 then
    raise exception 'FAIL: a view-only grantee (not manage) was reminded';
  end if;
  raise notice 'PASS  view-only grantee not reminded (control)';

  select count(*) into v_n from public.notifications
   where recipient_id = v_patient and template = 'appointment_reminder'
     and channel = private.patient_reminder_channel(v_patient)
     and channel in ('push', 'email', 'in_app')
     and payload->>'milestone' = '2h'
     and payload->>'appointment_id' = v_appt::text;
  if v_n <> 1 then
    raise exception 'FAIL: the patient''s own reminder (on the patient_reminder_channel) regressed, found %', v_n;
  end if;
  raise notice 'PASS  patient''s own reminder unaffected';

  -- SABOTAGE: if the helper disagreed with the channel the sweep really used,
  -- the check above must stop matching. Swap the helper for one returning a
  -- channel nothing was queued on, re-run the same predicate, then undo.
  begin
    create or replace function private.patient_reminder_channel(p_recipient uuid, p_allow_email boolean default true)
    returns public.notification_channel language sql stable as $f$ select 'voice'::public.notification_channel $f$;
    select count(*) into v_n from public.notifications
     where recipient_id = v_patient and template = 'appointment_reminder'
       and channel = private.patient_reminder_channel(v_patient)
       and channel in ('push', 'email', 'in_app')
       and payload->>'milestone' = '2h'
       and payload->>'appointment_id' = v_appt::text;
    raise exception 'sabotage_undo';
  exception when others then
    if sqlerrm <> 'sabotage_undo' then raise; end if;
  end;
  if v_n <> 0 then
    raise exception 'VACUOUS: the reminder-channel check still matched with a sabotaged helper';
  end if;
  raise notice 'PASS  sabotage: a helper/queue channel mismatch is detected';

  raise notice '--- all checks passed ---';
end $$;

rollback;
